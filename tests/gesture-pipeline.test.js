import test from 'node:test';
import assert from 'node:assert/strict';
import { credibleHand, GestureMetrics, GestureResponse, VideoFramePump } from '../src/gesture-pipeline.js';

const open = { x: 0.4, y: 0.5, openness: 0.95 };
const fist = { ...open, openness: 0.05 };

test('first credible trend pre-responds immediately; full motion needs fresh 80ms confirmation', () => {
  const controller = new GestureResponse();
  const first = controller.update(open, 0);
  assert.equal(first.activation, 0.14); assert.equal(first.feedback, 1);
  assert.equal(controller.confirmed, null);
  assert.equal(controller.update(open, 40).activation, 0.14);
  assert.equal(controller.update(open, 79).activation, 0.14);
  const confirmed = controller.update(open, 80);
  assert.equal(confirmed.activation, 1); assert.equal(confirmed.feedback, 0);
  assert.equal(controller.confirmationMs, 80);
  assert.equal(first.response.id, confirmed.response.id);
});

test('uncertain or alternating samples cannot trigger full deconstruction', () => {
  const controller = new GestureResponse();
  controller.update(open, 0);
  assert.equal(controller.update({ ...open, openness: 0.5 }, 90).activation, 0);
  controller.update(open, 100);
  assert.equal(controller.update(open, 150).activation, 0.14);
  assert.equal(controller.update(fist, 160).activation, 0);
  assert.equal(controller.confirmed, null);
});

test('fist immediately pre-responds in reverse; jitter preserves stable confirmed state', () => {
  const controller = new GestureResponse(); controller.update(open, 0); controller.update(open, 80);
  const response = controller.update(fist, 100);
  assert.equal(response.activation, 0.86); assert.equal(response.feedback, -1);
  assert.equal(controller.update({ ...fist, openness: 0.5 }, 150).activation, 1);
  controller.update(fist, 200);
  assert.equal(controller.update(fist, 280).activation, 0);
  assert.equal(controller.confirmationMs, 100);
  assert.equal(controller.update(null, 290).targetActivation, 0);
  assert.equal(controller.update(null, 640), null);
  assert.equal(controller.candidate, null);
});

test('invalid, tiny or nonfinite landmark sets cannot trigger a credible trend', () => {
  assert.equal(credibleHand([]), null);
  assert.equal(credibleHand(Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))), null);
  assert.equal(credibleHand(Array.from({ length: 21 }, () => ({ x: NaN, y: 0.5 }))), null);
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  points[0].y = 0.8; points[9].y = 0.6;
  for (const tip of [8, 12, 16, 20]) points[tip].y = 0.35;
  assert.ok(credibleHand(points).openness > 0.68);
});

function fakeVideo() {
  let callback, cancelled = 0, requests = 0;
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 0,
    requestVideoFrameCallback(cb) { callback = cb; return ++requests; },
    cancelVideoFrameCallback() { cancelled++; },
  };
  return { video, fire: (now, mediaTime) => callback(now, { mediaTime }), cancelled: () => cancelled, requests: () => requests };
}

test('frame pump avoids duplicate inference and handles 30fps timestamp jitter', () => {
  const fake = fakeVideo(); let now = 0, processed = 0;
  const pump = new VideoFramePump(fake.video, () => { processed++; return 5; }, () => {}, () => now);
  pump.start(); pump.start(); assert.equal(fake.requests(), 1);
  fake.fire(0, 0); fake.fire(0, 0);
  assert.equal(processed, 1);
  for (let i = 1; i <= 6; i++) { now = i * 33; fake.fire(now, i / 30); }
  assert.equal(processed, 7, 'fresh 30fps frames are not accidentally halved to 15fps');
  pump.stop(); assert.equal(fake.cancelled(), 1);
  now += 100; fake.fire(now, 99); assert.equal(processed, 7);
});

test('slow inference adapts duty cycle without parallel or repeated processing', () => {
  const fake = fakeVideo(); let now = 0, processed = 0;
  const pump = new VideoFramePump(fake.video, () => { processed++; return 60; }, () => {}, () => now);
  pump.start();
  for (let i = 0; i < 10; i++) { now = i * 33; fake.fire(now, i / 30); }
  assert.equal(processed, 4);
  pump.stop();
});

test('asynchronous worker inference has only one pending frame and does not stop camera callbacks', async () => {
  const fake = fakeVideo(); let now = 0, processed = 0, frames = 0, finish;
  const pump = new VideoFramePump(fake.video, () => { processed++; return new Promise(resolve => { finish = resolve; }); }, () => frames++, () => now);
  pump.start();
  fake.fire(0, 0);
  for (let i = 1; i < 6; i++) { now = i * 33; fake.fire(now, i / 30); }
  assert.equal(processed, 1); assert.equal(frames, 6);
  finish(30); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  now += 33; fake.fire(now, 7 / 30); assert.equal(processed, 2);
  pump.stop(); finish(30); await Promise.resolve();
});

test('worker pacing uses measured end-to-end cost without adding the blocking fallback idle budget', () => {
  const fake = fakeVideo(); let now = 0, processed = 0;
  const pump = new VideoFramePump(fake.video, () => { processed++; return 40; }, () => {}, () => now);
  pump.costFactor = 1; pump.start();
  fake.fire(0, 0); assert.equal(pump.intervalMs, 40);
  now = 33; fake.fire(now, 1 / 30); assert.equal(processed, 1);
  now = 66; fake.fire(now, 2 / 30); assert.equal(processed, 2);
  pump.stop();
});

test('RAF fallback deduplicates video time and cancels its own callback', t => {
  let callback, cancelled = 0, now = 0, calls = 0;
  const raf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const caf = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  globalThis.requestAnimationFrame = cb => { callback = cb; return 1; };
  globalThis.cancelAnimationFrame = () => cancelled++;
  t.after(() => {
    if (raf) Object.defineProperty(globalThis, 'requestAnimationFrame', raf); else delete globalThis.requestAnimationFrame;
    if (caf) Object.defineProperty(globalThis, 'cancelAnimationFrame', caf); else delete globalThis.cancelAnimationFrame;
  });
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 0 };
  const pump = new VideoFramePump(video, () => { calls++; return 1; }, () => {}, () => now);
  pump.start(); callback(0); now = 40; callback(40);
  assert.equal(calls, 1);
  video.currentTime = 0.04; callback(40); assert.equal(calls, 2);
  pump.stop(); assert.equal(cancelled, 1);
});

test('metrics separate inference, confirmation and animation; stale responses are ignored', () => {
  const metrics = new GestureMetrics(), controller = new GestureResponse();
  const first = controller.update(open, 0);
  metrics.frame(0); metrics.frame(33); metrics.frame(66);
  metrics.inference(5, 5, first, controller);
  metrics.rendered({ id: first.response.id, animationStartMs: 32, renderQueueMs: 27 });
  const next = controller.update(open, 80); metrics.inference(85, 6, next, controller);
  const snapshot = metrics.snapshot(90);
  assert.ok(snapshot.cameraFPS > 30 && snapshot.cameraFPS < 31);
  assert.equal(snapshot.inferenceMs, 6); assert.equal(snapshot.confirmationMs, 80);
  assert.equal(snapshot.animationStartMs, 32);
  metrics.rendered({ id: 99, animationStartMs: 999 });
  assert.equal(metrics.animationStartMs, 32);
  assert.equal(metrics.snapshot(2000).cameraFPS, 0);
});

test('late video metadata and invalid frame timestamps never enter inference', () => {
  const fake = fakeVideo(); let calls = 0, now = 0;
  const pump = new VideoFramePump(fake.video, () => { calls++; return 1; }, () => {}, () => now);
  fake.video.videoWidth = 0; fake.video.videoHeight = 0;
  pump.start(); fake.fire(0, 0); assert.equal(calls, 0);
  fake.video.videoWidth = 640; fake.video.videoHeight = 480;
  fake.video.currentTime = NaN; now = 40; fake.fire(now, NaN); assert.equal(calls, 0);
  now = 80; fake.fire(now, 0.08); assert.equal(calls, 1);
  now = 120; fake.video.currentTime = 0.12; fake.fire(now, 0.08);
  assert.equal(calls, 2, 'valid currentTime can recover stalled metadata.mediaTime');
  pump.stop();
});

test('a browser that exposes rVFC but stops delivering frames switches once to RAF polling', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const fake = fakeVideo(); let now = 0, callback, requests = 0, calls = 0;
  const before = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const cancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  globalThis.requestAnimationFrame = cb => { callback = cb; return ++requests; }; globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    if (before) Object.defineProperty(globalThis, 'requestAnimationFrame', before); else delete globalThis.requestAnimationFrame;
    if (cancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancel); else delete globalThis.cancelAnimationFrame;
  });
  const pump = new VideoFramePump(fake.video, () => { calls++; return 1; }, () => {}, () => now);
  pump.start(); now = 1600; t.mock.timers.tick(1600);
  assert.equal(fake.cancelled(), 1); assert.equal(requests, 1);
  fake.video.currentTime = 1.6; callback(now); assert.equal(calls, 1);
  pump.stop();
});

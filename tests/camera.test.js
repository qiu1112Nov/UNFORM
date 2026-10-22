import test from 'node:test';
import assert from 'node:assert/strict';
import { HandCamera } from '../src/camera.js';

function landmarks(open = true, x = 0.5) {
  const p = Array.from({ length: 21 }, () => ({ x, y: 0.5 }));
  p[0].y = 0.8; for (const i of [5, 9, 13, 17]) p[i].y = 0.6;
  for (const i of [8, 12, 16, 20]) p[i].y = open ? 0.35 : 0.64;
  return [p];
}

function setup(t, { supported = true, workerFails = false, initFails = false, facing = 'user' } = {}) {
  let now = 0, callback, streamStopped = 0, workerClosed = 0, mainCalls = 0, workerCalls = 0;
  const packets = [], outputs = [], sizes = [], states = [];
  const video = { style: {}, readyState: 2, videoWidth: 0, videoHeight: 0, currentTime: 0,
    async play() {}, pause() {}, requestVideoFrameCallback(cb) { callback = cb; return 1; }, cancelVideoFrameCallback() {} };
  const track = { stop() { streamStopped++; }, addEventListener() {}, getSettings: () => ({ facingMode: facing }) };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() { sizes.push([canvas.width, canvas.height]); } }) };
  for (const [name, value] of Object.entries({
    window: { isSecureContext: true }, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }) } },
    document: { createElement: () => canvas },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  let result = { landmarks: landmarks() };
  const camera = new HandCamera(video, (...state) => states.push(state), hand => outputs.push(hand), {
    mobile: true, clock: () => now, workerSupported: () => supported,
    createWorker: () => ({ init: async () => { if (initFails) throw new Error('Worker initialization incompatible'); }, close() { workerClosed++; }, async detect(input, timestamp) {
      workerCalls++; packets.push(timestamp); if (workerFails) throw new Error('ImageBitmap incompatible');
      return { ...result, inferenceMs: 10, bitmapMs: 1 };
    } }),
    createDetector: async () => ({ detectForVideo(input, timestamp) { mainCalls++; packets.push(timestamp); return result; }, close() {} }),
  });
  t.after(() => camera.stop());
  return { camera, video, outputs, sizes, states,
    result: value => { result = value; }, counts: () => ({ workerClosed, streamStopped, workerCalls, mainCalls }),
    async frame(time) { now = time; video.currentTime = time / 1000; callback(time, { mediaTime: video.currentTime });
      // Drain async detection, fallback initialization, and pump completion.
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
}

test('video dimensions may become ready late; portrait/landscape inputs are aspect-correct without crop', async t => {
  const env = setup(t); await env.camera.start();
  await env.frame(0); await env.frame(100);
  assert.equal(env.counts().workerCalls, 0);
  assert.equal(env.camera.diagnostics().inference, 'waiting for video');
  env.video.videoWidth = 480; env.video.videoHeight = 640; await env.frame(200);
  assert.deepEqual(env.sizes.at(-1), [360, 480]);
  env.video.videoWidth = 640; env.video.videoHeight = 480; await env.frame(300);
  assert.deepEqual(env.sizes.at(-1), [480, 360]);
  assert.equal(env.camera.hasHand, true); assert.equal(env.camera.response.confirmed, 1);
  assert.equal(env.camera.diagnostics(400).lastRecognitionAt, 300);
});

test('Worker runtime failure switches once to serial main-thread inference without reopening the camera', async t => {
  const env = setup(t, { workerFails: true }); await env.camera.start();
  env.video.videoWidth = 640; env.video.videoHeight = 480;
  await env.frame(100);
  assert.equal(env.camera.inferenceMode, 'main-thread fallback');
  assert.equal(env.counts().workerClosed, 1); assert.equal(env.counts().streamStopped, 0);
  assert.match(env.camera.diagnostics().error, /ImageBitmap incompatible/);
  await env.frame(200); await env.frame(300);
  assert.equal(env.counts().workerCalls, 1); assert.equal(env.counts().mainCalls, 2);
  assert.equal(env.camera.response.confirmed, 1); assert.equal(env.camera.active, true);
});

test('Worker and fallback produce identical gesture/continuous outputs from identical result sequences', async t => {
  const runs = [];
  // Reuse one fixture's globals; both backends share the same actual receive method.
  const env = setup(t); await env.camera.start();
  env.video.videoWidth = 640; env.video.videoHeight = 480;
  for (const supported of [true, false]) {
    env.camera.stop(); env.outputs.length = 0; env.camera.workerSupported = () => supported;
    await env.camera.start();
    for (const [time, pose] of [[0, landmarks()], [100, landmarks()], [150, []], [200, landmarks(false, 0.6)], [300, landmarks(false, 0.7)], [500, landmarks(false)]]) {
      env.result({ landmarks: pose }); await env.frame(time);
    }
    runs.push(env.outputs.map(hand => hand && ({ x: hand.x, activation: hand.activation, target: hand.targetActivation, feedback: hand.feedback, tracked: hand.tracked })));
  }
  assert.deepEqual(runs[0], runs[1]);
});

test('empty results remain diagnosable without inventing a hand or repeatedly changing backends', async t => {
  const env = setup(t); env.result({ landmarks: [] }); await env.camera.start();
  env.video.videoWidth = 640; env.video.videoHeight = 480;
  await env.frame(100); await env.frame(200);
  assert.equal(env.camera.diagnostics().inference, 'running / no hand');
  assert.equal(env.camera.diagnostics().hasHand, false); assert.equal(env.camera.lastRecognitionAt, null);
  assert.equal(env.counts().mainCalls, 0); assert.equal(env.camera.inferenceMode, 'worker');
});

test('actual rear camera mirrors neither preview nor horizontal gesture mapping', async t => {
  const env = setup(t, { facing: 'environment' }); await env.camera.start();
  env.video.videoWidth = 640; env.video.videoHeight = 480;
  env.result({ landmarks: landmarks(true, 0.2) }); await env.frame(100);
  assert.equal(env.video.style.transform, 'none'); assert.ok(Math.abs(env.outputs.at(-1).x - 0.2) < 1e-9);
  assert.equal(env.camera.diagnostics().facingMode, 'environment');
});

test('initialization failure and absent Worker capabilities both select a working serial fallback', async t => {
  const env = setup(t, { initFails: true }); await env.camera.start();
  assert.equal(env.camera.inferenceMode, 'main-thread fallback');
  assert.equal(env.camera.modelStage, 'ready'); assert.match(env.camera.lastError, /initialization incompatible/);
  env.video.videoWidth = 640; env.video.videoHeight = 480; await env.frame(100);
  assert.equal(env.counts().mainCalls, 1);
  env.camera.stop(); env.camera.workerSupported = () => false; await env.camera.start(); await env.frame(200);
  assert.equal(env.counts().workerCalls, 0); assert.equal(env.counts().mainCalls, 2);
});

test('stopping during a runtime backend switch disposes a late detector and does not revive tracking', async t => {
  const env = setup(t, { workerFails: true }); await env.camera.start();
  let resolve, closed = 0;
  env.camera.createDetector = () => new Promise(done => { resolve = done; });
  env.video.videoWidth = 640; env.video.videoHeight = 480; await env.frame(100);
  assert.equal(env.camera.pump.busy, true);
  env.camera.stop(); resolve({ close() { closed++; } });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(closed, 1); assert.equal(env.camera.active, false); assert.equal(env.camera.landmarker, null);
});

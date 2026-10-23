import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPRINT, ShapeMemory } from '../src/imprint.js';

const tick = (m, seconds, fps = 60, feedback = true) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) m.update(1 / fps, 0.65, feedback);
};
const start = (m, id = 1) => {
  m.begin(id, [0, 0, 0], 0, 0, 0);
  m.move(id, 30, 0, 100, [0.2, 0, 0]);
};
const at = m => [...m.deform([0, 0, 0], new Float64Array(3))];

test('SCULPT 2.1 makes a short drag perceptible within 100ms without raising long-drag limits', () => {
  const m = new ShapeMemory(); m.begin(1, [0, 0, 0], 0, 0, 0, 120);
  m.move(1, 20, 0, 100, [20 / 120, 0, 0]); tick(m, 0.1);
  assert.ok(at(m)[0] * 120 > 14, '20px input should already move the center visibly');
  m.end(1, true); tick(m, 4);
  assert.ok(Math.abs(at(m)[0] * 120 - 16.2) < 1e-6);
  m.begin(2, [0, 0, 0], 0, 0, 5000); m.move(2, 1000, 0, 5100, [10, 0, 0]);
  assert.ok(Math.abs(m.sessions.get(2).goal[0] - 0.32) < 1e-10);
  assert.equal(IMPRINT.maxOffset, 0.24); assert.equal(IMPRINT.retention, 0.6);
  assert.equal(IMPRINT.minDragPixels, 8); assert.equal(IMPRINT.minDeformationPixels, 3);
});

test('material influence has a strong center, progressively softer shoulders and a smooth bounded edge', () => {
  const m = new ShapeMemory(); start(m); m.end(1, true); tick(m, 4);
  const scratch = new Float64Array(3);
  const influence = distance => m.deform([0, distance, 0], scratch)[0];
  const distances = [0, 0.15, 0.3, 0.45, 0.6, IMPRINT.radius, IMPRINT.radius + 0.1];
  const weights = distances.map(influence);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i] <= weights[i - 1]);
  assert.ok(weights[2] > weights[0] * 0.55, 'middle shoulder stays visible');
  assert.ok(weights[4] < weights[0] * 0.01, 'edge remains restrained');
  assert.equal(weights.at(-1), 0);
  assert.ok(influence(IMPRINT.radius - 0.0001) < 1e-7, 'falloff approaches zero smoothly');
});

for (const fps of [10, 30, 60, 120]) test(`save is immediate; success feedback waits for rest then expires at ${fps} FPS`, () => {
  const m = new ShapeMemory(); start(m); tick(m, 0.1, fps); m.end(1, true);
  assert.equal(m.commits.length, 1); assert.equal(m.notice.displayed, false);
  const events = [];
  for (let i = 0; i < fps * 3; i++) {
    const event = m.update(1 / fps, 0.65, false);
    if (event) events.push({ event, time: (i + 1) / fps });
  }
  assert.deepEqual(events.map(e => e.event), ['SETTLED', 'CLEAR']);
  assert.ok(events[0].time > 0.1 && events[0].time < 1.2);
  assert.ok(Math.abs(events[1].time - events[0].time - IMPRINT.noticeSeconds) <= 1 / fps + 1e-6);
  assert.equal(m.commits.length, 1); assert.equal(m.notice, null);
});

test('new input, Undo, Restore and navigation cancel old acknowledgments without delayed callbacks', () => {
  for (const delay of [0, 0.8]) for (const interrupt of [m => start(m, 2), m => m.undo(), m => m.restore(), m => m.cancelAll(), m => m.blockActive()]) {
    const m = new ShapeMemory(); start(m); m.end(1, true); tick(m, delay);
    interrupt(m); assert.equal(m.notice, null);
    const events = [];
    for (let i = 0; i < 180; i++) { const event = m.update(1 / 60, 0.65, true); if (event) events.push(event); }
    assert.deepEqual(events, []);
  }
});

test('effective drag commits on immediate release without waiting for any animation frame or pause', () => {
  const m = new ShapeMemory(); start(m);
  assert.equal(m.commits.length, 0); assert.equal(m.end(1, true), true);
  assert.equal(m.commits.length, 1); tick(m, 4);
  assert.ok(Math.abs(at(m)[0] - 0.162) < 1e-6);
});

for (const fps of [10, 30, 60, 120]) test(`release keeps the same full remembered amplitude at ${fps} FPS`, () => {
  const m = new ShapeMemory(); start(m); tick(m, 0.1, fps);
  const before = at(m); assert.equal(m.end(1, true), true);
  assert.ok(Math.abs(at(m)[0] - before[0]) < 1e-12, 'commit cannot jump the live sum');
  tick(m, 4, fps); assert.ok(Math.abs(at(m)[0] - 0.162) < 1e-6);
  const saved = JSON.stringify(m.commits); tick(m, 120, fps);
  assert.equal(JSON.stringify(m.commits), saved); assert.ok(Math.abs(at(m)[0] - 0.162) < 1e-6);
});

test('0.6s pause produces a finite visual cue and never commits while the finger is down', () => {
  const m = new ShapeMemory(); start(m); tick(m, 0.4);
  assert.equal(m.sessions.get(1).pulseAge, Infinity); tick(m, 0.2);
  const s = m.sessions.get(1); assert.equal(s.stage, 'PAUSE');
  assert.ok(s.pulseAge >= 0 && s.pulseAge < IMPRINT.pulseSeconds);
  assert.equal(m.commits.length, 0); tick(m, 3);
  assert.ok(s.pulseAge > IMPRINT.pulseSeconds); assert.equal(m.commits.length, 0);
  assert.equal(m.end(1, true), true);
});

test('multiple pauses reset the cue but only a single release creates history', () => {
  const m = new ShapeMemory(); start(m); tick(m, 0.6);
  m.move(1, 45, 0, 800, [0.25, 0, 0]); assert.equal(m.sessions.get(1).dwell, 0);
  tick(m, 0.6); assert.equal(m.sessions.get(1).stage, 'PAUSE');
  assert.equal(m.commits.length, 0); m.end(1, true); m.end(1, true); tick(m, 4);
  assert.equal(m.commits.length, 1);
});

test('tap, tiny movement, negligible material displacement and returning to the start create no history', () => {
  for (const [pixels, offset] of [[0, 0], [3, 0.2], [15, 0.01], [15, 0.045], [0, 0.2]]) {
    const m = new ShapeMemory(); m.begin(1, [0, 0, 0], 0, 0, 0);
    m.move(1, pixels, 0, 100, [offset, 0, 0]); tick(m, 1);
    assert.equal(m.end(1, true), false); assert.equal(m.commits.length, 0);
  }
});

test('pixel deformation threshold respects scale instead of depending on particle count or DPR', () => {
  for (const pixelScale of [40, 100, 220]) {
    const m = new ShapeMemory(); m.begin(1, [0, 0, 0], 0, 0, 0, pixelScale);
    m.move(1, 12, 0, 100, [8 / pixelScale, 0, 0]);
    assert.equal(m.end(1, true), true);
  }
});

test('cancel and mode/ORIGIN input boundaries never commit, even after a visual pause', () => {
  for (const cancel of [m => m.end(1), m => m.cancelAll()]) {
    const m = new ShapeMemory(); start(m); tick(m, 0.6); cancel(m); tick(m, 4);
    assert.equal(m.commits.length, 0); assert.ok(Math.abs(at(m)[0]) < 1e-6);
  }
});

test('multitouch invalidation remains latched after one finger lifts', () => {
  const m = new ShapeMemory(); start(m); start(m, 2); m.blockActive();
  m.end(2, true); tick(m, 0.8); m.move(1, 60, 0, 1000, [0.3, 0, 0]);
  assert.equal(m.end(1, true), false); assert.equal(m.commits.length, 0);
});

test('completed memory survives cancellation; Undo removes exactly one release and Restore clears all', () => {
  const m = new ShapeMemory(); start(m); m.end(1, true); tick(m, 4);
  const first = at(m)[0]; start(m); m.end(1, true); m.cancelAll(); tick(m, 4);
  assert.equal(m.commits.length, 2); assert.ok(at(m)[0] > first);
  assert.equal(m.undo(), true); assert.ok(Math.abs(at(m)[0] - first) < 1e-8);
  m.restore(); assert.deepEqual(at(m), [0, 0, 0]); assert.equal(m.undo(), false);
});

test('reuse of a touch id preserves the previous release residual and cannot double-commit', () => {
  const m = new ShapeMemory(); start(m); tick(m, 0.1); m.end(1, true);
  const before = at(m); start(m);
  assert.deepEqual(at(m), before); assert.equal(m.commits.length, 1);
  m.cancelAll(); tick(m, 4); assert.ok(Math.abs(at(m)[0] - 0.162) < 1e-6);
});

test('rapid consecutive releases do not lose strokes because earlier release springs are still active', () => {
  const m = new ShapeMemory();
  for (let i = 0; i < IMPRINT.maxCommits; i++) {
    start(m); assert.equal(m.end(1, true), true);
  }
  assert.equal(m.commits.length, IMPRINT.maxCommits);
  start(m); assert.equal(m.end(1, true), false);
  assert.equal(m.sessions.get(1).stage, 'LIMIT');
  assert.ok(m.sessions.size <= IMPRINT.maxSessions + IMPRINT.maxReleaseTails);
});

test('shared material field stays local, bounded, alias-safe and resource capped', () => {
  const m = new ShapeMemory();
  for (let i = 0; i < IMPRINT.maxCommits + 3; i++) { start(m); m.end(1, true); tick(m, 3); }
  assert.equal(m.commits.length, IMPRINT.maxCommits);
  assert.ok(Math.hypot(...at(m)) <= IMPRINT.maxOffset + 1e-8);
  const far = [1, 0, 0]; assert.deepEqual([...m.deform(far, new Float64Array(3))], far);
  const near = [0.1, 0, 0], expected = [...m.deform(near, new Float64Array(3))];
  assert.deepEqual([...m.deform(near, near)], expected);
  m.restore(); for (let i = 0; i < 20; i++) m.begin(i, [0, 0, 0], 0, 0, 0);
  assert.equal(m.sessions.size, IMPRINT.maxSessions);
});

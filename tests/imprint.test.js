import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPRINT, ShapeMemory } from '../src/imprint.js';

const tick = (m, seconds, fps = 60, allowed = true) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) m.update(1 / fps, 0.65, allowed);
};
const start = m => {
  m.begin(1, [0, 0, 0], 0, 0, 0);
  for (let i = 1; i <= 6; i++) m.move(1, i * 5, 0, i * 100, [0.2 * i / 6, 0, 0]);
};
const at = m => [...m.deform([0, 0, 0], new Float64Array(3))];

test('fast drag stays elastic even when held; release returns to original', () => {
  const m = new ShapeMemory(); m.begin(1, [0, 0, 0], 0, 0, 0);
  m.move(1, 80, 0, 30, [0.3, 0, 0]); tick(m, 4);
  assert.equal(m.commits.length, 0); assert.ok(at(m)[0] > 0.2);
  m.end(1); tick(m, 4); assert.ok(Math.abs(at(m)[0]) < 1e-6);
});

test('a fast swipe after a long idle and tiny subsequent jitter cannot gain imprint eligibility', () => {
  const m = new ShapeMemory(); m.begin(1, [0, 0, 0], 0, 0, 0); tick(m, 4);
  m.move(1, 80, 0, 4030, [0.3, 0, 0]);
  m.move(1, 81, 0, 4100, [0.3, 0, 0]); tick(m, 4);
  assert.equal(m.commits.length, 0);
});

for (const fps of [10, 30, 60, 120]) test(`slow drag imprints after 3s without further move events at ${fps} FPS`, () => {
  const m = new ShapeMemory(); start(m); tick(m, 2.8, fps);
  assert.equal(m.commits.length, 0);
  tick(m, 0.3, fps); assert.equal(m.commits.length, 1);
  assert.equal(m.sessions.get(1).stage, 'COMMIT');
  m.end(1); tick(m, 6, fps);
  assert.ok(Math.abs(at(m)[0] - 0.12) < 0.002);
  const saved = JSON.stringify(m.commits); tick(m, 120, fps);
  assert.equal(JSON.stringify(m.commits), saved);
  assert.ok(Math.abs(at(m)[0] - 0.12) < 0.002);
});

test('commit transfers the same displacement between layers without jumping', () => {
  const m = new ShapeMemory(); start(m); tick(m, 2.9);
  const before = at(m); tick(m, 0.2);
  assert.equal(m.commits.length, 1);
  assert.ok(Math.abs(at(m)[0] - before[0]) < 0.0001);
  tick(m, 10); assert.equal(m.commits.length, 1, 'a stationary finger cannot repeatedly imprint');
});

test('movement resets dwell, tiny cumulative motion also resets, and a tap does not imprint', () => {
  const m = new ShapeMemory(); start(m); tick(m, 2);
  m.move(1, 34, 0, 2700, [0.21, 0, 0]);
  m.move(1, 38, 0, 2800, [0.22, 0, 0]); tick(m, 1.2);
  assert.equal(m.commits.length, 0); tick(m, 2); assert.equal(m.commits.length, 1);
  m.restore(); m.begin(2, [0, 0, 0], 10, 10, 0); tick(m, 10);
  assert.equal(m.commits.length, 0);
});

test('cancel, mode boundary and multitouch cannot commit a pending imprint', () => {
  for (const end of [m => m.end(1), m => m.cancelAll()]) {
    const m = new ShapeMemory(); start(m); tick(m, 2.9); end(m); tick(m, 4);
    assert.equal(m.commits.length, 0); assert.ok(Math.abs(at(m)[0]) < 1e-6);
  }
  const m = new ShapeMemory(); start(m); tick(m, 5, 60, false);
  assert.equal(m.commits.length, 0);
});

test('completed memory survives cancellation; Undo removes exactly one commit; Restore clears all', () => {
  const m = new ShapeMemory(); start(m); tick(m, 3.2); m.end(1); tick(m, 4);
  const first = at(m)[0]; start(m); tick(m, 3.2); m.cancelAll(); tick(m, 4);
  assert.equal(m.commits.length, 2); assert.ok(at(m)[0] > first);
  assert.equal(m.undo(), true); assert.ok(Math.abs(at(m)[0] - first) < 1e-8);
  m.restore(); assert.deepEqual(at(m), [0, 0, 0]); assert.equal(m.undo(), false);
});

test('shared material field is local, bounded, independent of input/output aliasing and resource capped', () => {
  const m = new ShapeMemory();
  for (let i = 0; i < IMPRINT.maxCommits + 3; i++) { start(m); tick(m, 3.2); m.end(1); tick(m, 3); }
  assert.equal(m.commits.length, IMPRINT.maxCommits);
  assert.ok(Math.hypot(...at(m)) <= IMPRINT.maxOffset + 1e-8);
  const far = [1, 0, 0]; assert.deepEqual([...m.deform(far, new Float64Array(3))], far);
  const near = [0.1, 0, 0], expected = [...m.deform(near, new Float64Array(3))];
  assert.deepEqual([...m.deform(near, near)], expected);
  m.restore(); for (let i = 0; i < 20; i++) m.begin(i, [0, 0, 0], 0, 0, 0);
  assert.equal(m.sessions.size, IMPRINT.maxSessions);
});

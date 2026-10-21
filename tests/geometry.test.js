import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, formPoint, handGesture } from '../src/geometry.js';

test('all shapes produce finite coordinates for desktop and mobile budgets', () => {
  for (const count of [850, 1900]) for (const form of ['circle', 'lines', 'grid']) {
    for (let i = 0; i < count; i++) {
      const point = formPoint(form, i, count);
      assert.equal(point.length, 3);
      assert.ok(point.every(value => Number.isFinite(value) && Math.abs(value) <= 1.3));
    }
  }
});
test('orbital form distributes points on a unit sphere', () => {
  for (let i = 0; i < 850; i++) assert.ok(Math.abs(Math.hypot(...formPoint('circle', i, 850)) - 1) < 1e-10);
});
test('shape correspondence is deterministic and forms are distinct', () => {
  assert.deepEqual(formPoint('circle', 27, 850), formPoint('circle', 27, 850));
  assert.notDeepEqual(formPoint('circle', 27, 850), formPoint('grid', 27, 850));
  assert.notDeepEqual(formPoint('lines', 27, 850), formPoint('grid', 27, 850));
});
function landmarks(open, scale = 1) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  points[0] = { x: 0.5, y: 0.8 };
  for (const i of [5, 9, 13, 17]) points[i] = { x: 0.5, y: 0.6 };
  for (const i of [8, 12, 16, 20]) points[i] = { x: 0.5, y: open ? 0.36 : 0.64 };
  return points.map(p => ({ x: 0.2 + p.x * scale, y: p.y * scale }));
}
test('open palm disperses and a fist gathers', () => {
  assert.equal(handGesture(landmarks(true)).openness, 1);
  assert.equal(handGesture(landmarks(false)).openness, 0);
});
test('hand openness is invariant to camera distance', () => {
  assert.equal(handGesture(landmarks(true, 0.4)).openness, handGesture(landmarks(true)).openness);
});
test('hand position is mirrored and degenerate landmarks remain finite', () => {
  const result = handGesture(Array.from({ length: 21 }, () => ({ x: 0.25, y: 0.5 })));
  assert.ok(Math.abs(result.x - 0.75) < 1e-10);
  assert.equal(result.y, 0.5);
  assert.ok(Number.isFinite(result.openness));
});
test('dispersion is bounded', () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(0.4), 0.4);
});

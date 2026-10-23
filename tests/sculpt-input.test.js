import test from 'node:test';
import assert from 'node:assert/strict';
import { strokeIntent } from '../src/sculpt-input.js';

function run(samples) {
  const point = { x: 0, y: 0, time: 0, intent: 'SCULPT', fastCandidate: false };
  for (const [x, y, now] of samples) {
    strokeIntent(point, x, y, now); Object.assign(point, { x, y, time: now });
  }
  return point.intent;
}

for (const ms of [4, 8, 16, 33]) test(`500px/s is detected with ${ms}ms event spacing`, () => {
  assert.equal(run(Array.from({ length: 10 }, (_, i) => [(i + 1) * ms * 0.5, 0, (i + 1) * ms])), 'SCATTER');
});
test('natural slow drag is SCULPT while tiny high-frequency directional jitter is rejected', () => {
  assert.equal(run(Array.from({ length: 10 }, (_, i) => [(i + 1) * 5, 0, (i + 1) * 100])), 'SCULPT');
  assert.equal(run(Array.from({ length: 20 }, (_, i) => [i % 2 ? 0 : 2, 0, (i + 1) * 2])), 'SCULPT');
});
test('an idle hold does not dilute a subsequent flick; scatter stays latched through slow moves', () => {
  assert.equal(run([[0, 0, 3000], [40, 0, 3020], [42, 0, 3500], [44, 0, 4000]]), 'SCATTER');
});

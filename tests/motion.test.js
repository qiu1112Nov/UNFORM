import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSpring, MOTION, retained, springCoefficients } from '../src/motion.js';

test('final defaults are centralized and immutable', () => {
  assert.deepEqual(MOTION, { deconstructionStrength: 0.55, motionInertia: 0.65, dynamicStyle: 'C' });
  assert.ok(Object.isFrozen(MOTION));
});

test('spring response is frame-rate independent and has a bounded elastic return', () => {
  const run = fps => {
    const state = { value: 1, velocity: 0 };
    let minimum = 1;
    for (let i = 0; i < fps * 2; i++) {
      advanceSpring(state, 0, springCoefficients(1 / fps)); minimum = Math.min(minimum, state.value);
    }
    assert.ok(minimum < 0 && minimum > -0.03);
    return state;
  };
  const a = run(30), b = run(60), c = run(120);
  assert.ok(Math.abs(a.value - b.value) < 1e-10 && Math.abs(b.value - c.value) < 1e-10);
});

test('65% inertia slows release compared with zero inertia and remains interruptible', () => {
  const slow = { value: 1, velocity: 0 }, fast = { ...slow };
  for (let i = 0; i < 10; i++) {
    advanceSpring(slow, 0, springCoefficients(1 / 60, 0.65));
    advanceSpring(fast, 0, springCoefficients(1 / 60, 0));
  }
  assert.ok(slow.value > fast.value);
  const before = slow.value;
  advanceSpring(slow, 1, springCoefficients(1 / 120));
  assert.ok(Math.abs(slow.value - before) < 0.08);
  for (let i = 0; i < 300; i++) advanceSpring(slow, i < 120 ? 1 : 0, springCoefficients(1 / 60));
  assert.ok(Math.abs(slow.value) < 0.001);
});

test('55% deconstruction preserves about 45% of geometric anchors', () => {
  const ratio = Array.from({ length: 997 }, (_, i) => retained(i, 0.55)).filter(Boolean).length / 997;
  assert.ok(Math.abs(ratio - 0.45) < 0.002);
  assert.ok(Array.from({ length: 997 }, (_, i) => retained(i, 0)).every(Boolean));
  assert.ok(Array.from({ length: 997 }, (_, i) => retained(i, 1)).every(v => !v));
});

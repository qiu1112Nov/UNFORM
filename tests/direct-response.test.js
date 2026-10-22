import test from 'node:test';
import assert from 'node:assert/strict';
import { FragmentLayers } from '../src/flow-state.js';
import { GestureResponse, gestureLabel } from '../src/gesture-pipeline.js';

for (const goal of [1, 0]) for (const fps of [10, 20, 30, 60, 120]) {
  test(`${goal ? 'palm' : 'fist'} preview → confirmation has no uncommanded return at ${fps} FPS`, () => {
    const layers = new FragmentLayers(), response = new GestureResponse();
    const base = { x: 0.5, y: 0.5, openness: 1 - goal };
    response.update(base, 0); response.update(base, 100);
    layers.update(1 - goal, 3);
    const initial = layers.states.map(s => Math.min(1, Math.max(0, s.value)));
    const events = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];
    let hand = response.update({ ...base, openness: goal }, 1000), event = 1, previous = initial;
    for (let frame = 1; frame <= fps * 1.2; frame++) {
      const now = frame * 1000 / fps;
      if (event < events.length && now + 1e-6 >= events[event]) {
        // A short unknown and a missing result must not remove preview or reset
        // a confirmed pose. Neither supplies evidence of the opposite gesture.
        const sample = events[event] === 200 ? null : events[event] === 300 ? { ...base, openness: 0.5 } : { ...base, openness: goal };
        hand = response.update(sample, 1000 + now); event++;
      }
      layers.update(hand.targetActivation, 1 / fps, 0.65, hand.previewGoal);
      const values = layers.states.map(s => Math.min(1, Math.max(0, s.value)));
      values.forEach((value, i) => assert.ok((value - previous[i]) * (goal ? 1 : -1) >= -0.001,
        `layer ${i} returned at ${now}ms: ${previous[i]} → ${value}`));
      previous = values;
      if (frame === 1) assert.ok(values.some((value, i) => (value - initial[i]) * (goal ? 1 : -1) > 0), 'first available render frame responds');
    }
    assert.ok(previous.every(value => Math.abs(value - goal) < 0.002));
  });
}

test('confirmation preserves exact state objects, values and velocities; layer delay never returns to home', () => {
  const layers = new FragmentLayers(); layers.update(0, 0.07, 0.65, 1);
  const states = layers.states, snapshot = states.map(state => ({ ...state }));
  layers.update(1, 0, 0.65, null);
  assert.equal(layers.states, states); assert.deepEqual(layers.states, snapshot);
  for (let i = 0; i < 20; i++) {
    const before = layers.states.map(state => state.value);
    layers.update(1, 1 / 120);
    layers.states.forEach((state, j) => assert.ok(state.value >= before[j] - 1e-9));
  }
});

test('an uncertain sample holds bounded preview; only a clear contrary pose reverses it', () => {
  const response = new GestureResponse(), layers = new FragmentLayers();
  const palm = { x: 0.5, y: 0.5, openness: 1 };
  let hand = response.update(palm, 0);
  layers.update(hand.targetActivation, 0.06, 0.65, hand.previewGoal);
  for (const now of [70, 100, 160]) {
    hand = response.update(now === 100 ? null : { ...palm, openness: 0.5 }, now);
    const before = layers.states.map(state => state.value);
    layers.update(hand.targetActivation, 0.03, 0.65, hand.previewGoal);
    layers.states.forEach((state, i) => assert.ok(state.value >= before[i]));
  }
  hand = response.update({ ...palm, openness: 0 }, 200);
  const before = layers.states[2].value;
  layers.update(hand.targetActivation, 0.1, 0.65, hand.previewGoal);
  assert.ok(layers.states[2].value < before);
});

test('display uses confirmed pose through threshold jitter and dropout without delaying the control output', () => {
  const response = new GestureResponse(), palm = { x: 0.5, y: 0.5, openness: 1 };
  let hand = response.update(palm, 0);
  assert.equal(hand.previewGoal, 1); assert.equal(gestureLabel(hand), 'HAND DETECTED');
  hand = response.update(palm, 80); assert.equal(gestureLabel(hand), 'OPEN PALM / DISPERSE');
  for (const [now, openness] of [[100, 0.54], [120, 0.56], [140, 0.48]]) {
    hand = response.update({ ...palm, openness }, now);
    assert.equal(gestureLabel(hand), 'OPEN PALM / DISPERSE');
  }
  assert.equal(gestureLabel(response.update(null, 160)), 'OPEN PALM / DISPERSE');
  hand = response.update({ ...palm, openness: 0 }, 180);
  assert.equal(hand.previewGoal, 0, 'reverse control starts before display changes');
  assert.equal(gestureLabel(hand), 'OPEN PALM / DISPERSE');
  hand = response.update({ ...palm, openness: 0 }, 260);
  assert.equal(hand.targetActivation, 0); assert.equal(gestureLabel(hand), 'CLOSED HAND / GATHER');
});

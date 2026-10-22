import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureResponse } from '../src/gesture-pipeline.js';
import { FragmentLayers, SpatialTrace } from '../src/flow-state.js';

const palm = { x: 0.3, y: 0.5, openness: 1 };
const fist = { ...palm, openness: 0 };

test('a confirmed short palm survives immediate reversal, with only the latest opposite target retained', () => {
  const response = new GestureResponse();
  response.update(palm, 0);
  assert.equal(response.update(palm, 80).targetActivation, 1);
  const reverse = response.update(fist, 100);
  assert.equal(reverse.feedback, -1);
  assert.equal(reverse.targetActivation, 1, 'preview cannot shrink a confirmed fragment goal');
  assert.equal(response.update(fist, 180).targetActivation, 1, 'bounded short latch retains observed action');
  assert.equal(response.confirmed, 0);
  assert.equal(response.update(fist, 270).targetActivation, 0, 'reverse is applied without requiring it to stay held for an animation');
});

test('low-rate observations and brief tracking loss preserve a full target; long loss releases it', () => {
  const response = new GestureResponse();
  response.update(palm, 0);
  assert.equal(response.update(palm, 250).targetActivation, 1, '4Hz tracking is not permanently stuck in preview');
  assert.equal(response.update(null, 300).targetActivation, 1);
  const held = response.update(null, 500);
  assert.equal(held.tracked, false); assert.equal(held.validUntil, 875);
  assert.equal(response.update(null, 876), null);
  assert.equal(response.update(palm, 1000).targetActivation, 0, 'reacquisition requires new evidence');
  response.update(palm, 1100);
  assert.equal(response.update(fist, 5000).targetActivation, 0, 'silent backend stalls expire previous evidence too');
});

test('isolated or alternating observations never latch a large unconfirmed motion', () => {
  const response = new GestureResponse();
  for (let i = 0; i < 50; i++) {
    const result = response.update(i % 2 ? palm : fist, i * 60);
    assert.equal(result.targetActivation, 0);
  }
  response.reset(); response.update(palm, 0);
  assert.equal(response.update(palm, 400).targetActivation, 0, 'stale evidence cannot confirm');
});

test('continuous hand movement is unfiltered and independent of the pending pose', () => {
  const response = new GestureResponse(); response.update(palm, 0);
  const moved = response.update({ ...fist, x: 0.8 }, 50);
  assert.equal(moved.x, 0.8); assert.equal(moved.vx, 10);
  assert.equal(moved.targetActivation, 0);
  const trace = new SpatialTrace(850, true, 4);
  trace.hand(palm, 0); trace.hand(moved, 200); trace.update(1 / 60, 350);
  assert.equal(trace.emitting, true, 'low-frequency tracking does not hit the old fixed 120ms cutoff');
  trace.update(1 / 60, 600); assert.equal(trace.emitting, false);
});

test('layer amplitude and reversal agree across 10/20/30/60/120 FPS with elapsed-time staggering', () => {
  const results = [];
  for (const fps of [10, 20, 30, 60, 120]) {
    const layers = new FragmentLayers();
    for (let i = 0; i < fps; i++) layers.update(1, 1 / fps);
    const peak = layers.states.map(state => state.value);
    for (let i = 0; i < fps; i++) layers.update(0, 1 / fps);
    results.push([...peak, ...layers.states.map(state => state.value)]);
  }
  for (const result of results) result.forEach((value, i) => assert.ok(Math.abs(value - results[0][i]) < 1e-9));
});

test('five minutes of low-rate mixed gestures and dropouts do not attenuate endpoint amplitude', () => {
  const response = new GestureResponse(), layers = new FragmentLayers(), peaks = [];
  let output = null;
  for (let frame = 0; frame < 300 * 30; frame++) {
    const now = frame * 1000 / 30, phase = Math.floor(now / 2000) % 2;
    if (frame % 6 === 0) output = response.update(frame % 90 === 0 ? null : phase ? fist : palm, now);
    layers.update(output?.targetActivation ?? 0, 1 / 30);
    if (frame % 120 === 59) peaks.push(Math.min(...layers.states.map(s => s.value)));
  }
  assert.equal(peaks.length, 75);
  assert.ok(peaks.every(value => value > 0.999), 'each open endpoint still reaches full normalized amplitude');
  assert.ok(Math.abs(peaks.at(-1) - peaks[0]) < 0.001);
});

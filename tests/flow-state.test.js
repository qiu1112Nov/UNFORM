import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceEdgeFlow, createEdgeFlow, FLOW_STATE, FragmentLayers, SpatialTrace } from '../src/flow-state.js';
import { octahedronParticle } from '../src/octahedron.js';

test('exactly 12% of particles flow, all confined to the original octahedron edges', () => {
  for (const count of [850, 1900]) {
    const flows = [];
    for (let i = 0; i < count; i++) {
      const sample = octahedronParticle(i, count), flow = createEdgeFlow(i, count, sample.point);
      if (!flow) continue;
      assert.equal(sample.kind, 'edge'); flows.push(flow);
      advanceEdgeFlow(flow, 0);
      assert.ok(flow.position.every((v, axis) => Math.abs(v - sample.point[axis]) < 1e-6));
      for (const time of [0.1, 1, 10, 100]) {
        advanceEdgeFlow(flow, time);
        assert.ok(Math.abs(flow.position.reduce((sum, v) => sum + Math.abs(v), 0) - 1) < 1e-6);
        assert.ok([...flow.position].some(v => Math.abs(v) < 1e-6));
      }
    }
    assert.equal(flows.length, Math.round(count * 0.12));
    assert.ok(new Set(flows.map(f => f.speed)).size > 20);
    assert.ok(new Set(flows.map(f => f.phase.toFixed(3))).size > 10);
  }
});

test('FLOW reverses smoothly at endpoints instead of teleporting across an edge', () => {
  const home = octahedronParticle(2, 850).point;
  const flow = Array.from({ length: 100 }, (_, i) => createEdgeFlow(i, 850, octahedronParticle(i, 850).point)).find(Boolean);
  assert.ok(home);
  let previous = new Float32Array(flow.position);
  for (let frame = 0; frame < 3000; frame++) {
    advanceEdgeFlow(flow, frame / 60);
    assert.ok(Math.hypot(...flow.position.map((v, axis) => v - previous[axis])) < 0.015);
    previous.set(flow.position);
  }
});

test('fragment layers start 60–100ms apart at common display frame rates', () => {
  for (const fps of [30, 60, 120]) {
    const layers = new FragmentLayers(), starts = [null, null, null];
    for (let frame = 0; frame < fps; frame++) {
      layers.update(1, 1 / fps);
      layers.states.forEach((state, i) => { if (starts[i] === null && state.value > 1e-6) starts[i] = frame / fps; });
    }
    assert.equal(starts[0], 0);
    for (let i = 1; i < 3; i++) assert.ok(starts[i] - starts[i - 1] >= 0.06 && starts[i] - starts[i - 1] <= 0.10001);
  }
});

test('fist reconstruction reverses layer order and a new palm interrupts pending stages', () => {
  const layers = new FragmentLayers();
  for (let i = 0; i < 180; i++) layers.update(1, 1 / 60);
  const starts = [null, null, null];
  for (let i = 0; i < 30; i++) {
    layers.update(0, 1 / 60);
    layers.states.forEach((s, layer) => { if (starts[layer] === null && s.value < 0.999) starts[layer] = i / 60; });
  }
  assert.ok(starts[2] < starts[1] && starts[1] < starts[0]);
  const before = layers.states.map(s => s.value);
  layers.update(1, 1 / 120);
  assert.equal(layers.direction, 1); assert.equal(layers.goal, 1);
  assert.ok(layers.states.every((s, i) => Math.abs(s.value - before[i]) < 0.04));
  for (let i = 0; i < 180; i++) layers.update(1, 1 / 60);
  assert.ok(layers.states.every(s => Math.abs(s.value - 1) < 0.001));
});

test('trace storage is bounded typed arrays with lower mobile budgets and 450ms lifetime', () => {
  const desktop = new SpatialTrace(1900, false), mobile = new SpatialTrace(850, true);
  assert.ok(mobile.capacity < desktop.capacity && mobile.samples < desktop.samples);
  assert.ok(mobile.positions instanceof Float32Array && mobile.times instanceof Float64Array);
  const storage = mobile.positions;
  for (let i = 0; i < 1000; i++) mobile.capture(0, [i / 10000, 0, 0], i / 60, 1);
  assert.equal(mobile.positions, storage);
  assert.equal(mobile.positions.length, mobile.capacity * mobile.samples * 3);
  const index = mobile.heads[0], capturedAt = mobile.times[index];
  assert.ok(mobile.opacity(index, capturedAt + 0.1) > mobile.opacity(index, capturedAt + 0.3));
  assert.equal(mobile.opacity(index, capturedAt + FLOW_STATE.trace.duration + 0.001), 0);
  mobile.clear(); assert.ok(mobile.times.every(t => t === -Infinity));
});

test('TRACE requires fresh fast hand movement and stops emitting immediately when still', () => {
  const trace = new SpatialTrace(850, true);
  trace.hand({ x: 0.4, y: 0.5 }, 0); trace.update(1 / 60, 0);
  assert.equal(trace.energy.value, 0);
  trace.hand({ x: 0.65, y: 0.5 }, 50);
  for (let i = 0; i < 6; i++) trace.update(1 / 60, 50 + i * 16);
  assert.ok(trace.energy.value > 0.1 && trace.emitting);
  trace.hand({ x: 0.65, y: 0.5 }, 150); trace.update(1 / 60, 150);
  assert.equal(trace.emitting, false);
  for (let i = 0; i < 90; i++) trace.update(1 / 60, 150 + i * 16);
  assert.ok(Math.abs(trace.energy.value) < 0.001);
});

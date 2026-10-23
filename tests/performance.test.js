import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality, MOBILE_PERFORMANCE, ParticleBudget } from '../src/performance.js';
import { octahedronParticle } from '../src/octahedron.js';
import { createEdgeFlow } from '../src/flow-state.js';

test('quality changes require sustained pressure, respect cooldown and recover more slowly', () => {
  const quality = new AdaptiveQuality(true);
  assert.equal(quality.count, 595);
  for (let i = 0; i < 20; i++) quality.observe(33, 15, 15);
  assert.equal(quality.count, 595, 'short spikes do not trigger a switch');
  for (let i = 0; i < 100; i++) quality.observe(33, 15, 15);
  assert.equal(quality.count, 510);
  const changedAt = quality.lastChange;
  for (let i = 0; i < 60; i++) quality.observe(33, 15, 15);
  assert.equal(quality.lastChange, changedAt, 'cooldown prevents repeated immediate cuts');
  for (let i = 0; i < 100; i++) quality.observe(33, 15, 15);
  assert.equal(quality.count, 425);
  for (let i = 0; i < 300; i++) quality.observe(16.67, 1, 2);
  assert.equal(quality.count, 425, 'recovery waits for a sustained healthy window');
  for (let i = 0; i < 500; i++) quality.observe(16.67, 1, 2);
  assert.ok(quality.count > 425);
  assert.equal(MOBILE_PERFORMANCE.traceSamples - 1, (7 - 1) / 2, 'half as many potential trail segments');
});

test('desktop quality stays unchanged and hidden/background gaps are ignored', () => {
  const quality = new AdaptiveQuality(false);
  for (let i = 0; i < 500; i++) quality.observe(33, 20, 20);
  assert.equal(quality.count, 1900);
  const age = quality.age;
  quality.observe(5000, 0, 0); assert.equal(quality.age, age);
});

test('observation keeps the visible budget fixed while still measuring frame and work metrics', () => {
  const quality = new AdaptiveQuality(true);
  for (let i = 0; i < 1000; i++) quality.observe(16.67, 1, 2, 10, false);
  assert.equal(quality.count, 595);
  assert.ok(quality.fps > 55); assert.equal(quality.updateMs, 1); assert.equal(quality.inferenceMs, 10);
  quality.resetTiming();
  for (let i = 0; i < 1000; i++) quality.observe(16.67, 1, 2);
  assert.ok(quality.count > 595, 'SCULPT can resume the existing adaptive budget');
});

test('camera pressure first reduces recognition input, but expensive rendering can still reduce visuals', () => {
  const quality = new AdaptiveQuality(true);
  quality.recognitionPriority = true;
  for (let i = 0; i < 250; i++) quality.observe(33, 1, 2, 70);
  assert.equal(quality.count, 595, 'slow frames alone do not remove sculpture detail while input can adapt');
  for (let i = 0; i < 150; i++) quality.observe(33, 10, 10, 70);
  assert.ok(quality.count < 595, 'actual render work still has a visual safety valve');
});

test('all mobile budgets preserve density, flow fraction and stable pooled identities', () => {
  const points = Array.from({ length: 850 }, (_, i) => {
    const sample = octahedronParticle(i, 850);
    return { kind: sample.kind, flow: createEdgeFlow(i, 850, sample.point) };
  });
  const budget = new ParticleBudget(points, 595), indices = budget.indices, opacity = budget.opacity;
  for (const count of MOBILE_PERFORMANCE.tiers) {
    budget.setCount(count); budget.advance(1);
    const totals = { edge: 0, surface: 0, interior: 0, flow: 0 };
    for (let slot = 0; slot < budget.length; slot++) {
      const p = points[budget.indices[slot]]; totals[p.kind]++; if (p.flow) totals.flow++;
    }
    assert.equal(budget.length, count);
    assert.equal(totals.edge, Math.round(count * 0.35)); assert.equal(totals.surface, Math.round(count * 0.45));
    assert.equal(totals.interior, count - totals.edge - totals.surface); assert.equal(totals.flow, Math.round(count * 0.12));
  }
  assert.equal(indices, budget.indices); assert.equal(opacity, budget.opacity);
  budget.setCount(425); budget.advance(1 / 60);
  assert.ok(budget.length > 425 && budget.opacity.some(v => v > 0 && v < 1), 'retiring particles fade rather than disappear');
  budget.advance(1); assert.equal(budget.length, 425);
});

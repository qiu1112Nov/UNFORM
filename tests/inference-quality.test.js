import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceQuality } from '../src/inference-quality.js';

test('input sizing preserves aspect, handles orientation and never upscales', () => {
  const mobile = new InferenceQuality(true);
  assert.deepEqual(mobile.dimensions(1920, 1080), { width: 480, height: 270 });
  assert.deepEqual(mobile.dimensions(480, 640), { width: 360, height: 480 });
  assert.deepEqual(mobile.dimensions(160, 120), { width: 160, height: 120 });
});

test('recognition load adapts input before visuals with cooldown and slower recovery', () => {
  const quality = new InferenceQuality(true);
  quality.observe(0, 90, 100);
  quality.observe(100, 90, 100); assert.equal(quality.size, 480, 'isolated stalls do not lower input');
  for (let now = 200; now <= 600; now += 100) quality.observe(now, 90, 100);
  assert.equal(quality.size, 384);
  for (let now = 700; now <= 1800; now += 100) quality.observe(now, 90, 100);
  assert.equal(quality.size, 384, 'cooldown avoids oscillation');
  quality.observe(2100, 90, 100); assert.equal(quality.size, 320);
  for (let now = 2200; now <= 9000; now += 100) quality.observe(now, 10, 15);
  assert.equal(quality.size, 320);
  for (let now = 9100; now <= 10300; now += 100) quality.observe(now, 10, 15);
  assert.equal(quality.size, 384);
});

test('transfer overhead and external render pressure also reduce camera input; desktop stays full', () => {
  for (const [model, total, render] of [[10, 65, null], [10, 15, { frameEMA: 30, workEMA: 3 }]]) {
    const quality = new InferenceQuality(true);
    for (let now = 0; now <= 1000; now += 100) quality.observe(now, model, total, render);
    assert.equal(quality.size, 384);
  }
  const desktop = new InferenceQuality(false);
  for (let now = 0; now <= 10000; now += 100) desktop.observe(now, 200, 250);
  assert.equal(desktop.size, 640);
});

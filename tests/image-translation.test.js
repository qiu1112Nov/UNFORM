import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, ImageMaterial, TranslationJob } from '../src/image-translation.js';
const input = (w, h, pixel) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x / w, y / h), (y * w + x) * 4);
  return { pixels: { width: w, height: h, data } };
};
const fast = { yieldTask: async () => {} };

test('local analysis is bounded across portrait, landscape, tiny and full-size inputs', async () => {
  for (const [w, h] of [[1, 1], [2, 30], [90, 18], [512, 512]]) {
    const f = await analyzeImage(input(w, h, () => [120, 120, 120, 255]), fast);
    assert.equal(f.luma.length, 4096); assert.equal(f.edges.length, 4096);
    assert.equal(f.histogram.reduce((a, b) => a + b), 4096);
    assert.ok(f.lowContrast); assert.ok(Math.abs(f.centroid.x - .5) < .01);
    assert.ok(Math.abs(f.centroid.y - .5) < .01);
  }
});

test('bright regions determine real luminance, contours, direction and visual center', async () => {
  const f = await analyzeImage(input(64, 64, x => x > .7 ? [255, 255, 255, 255] : [0, 0, 0, 255]), fast);
  assert.ok(f.centroid.x > .7); assert.ok(f.edges.some(v => v > .5));
  assert.ok(f.direction.confidence > .9); assert.ok(Math.abs(f.direction.angle - Math.PI / 2) < .01);
  assert.ok(f.contrast > .3);
});

test('rotated luminance structure rotates its measured direction and centroid', async () => {
  const f = await analyzeImage(input(32, 64, (x, y) => y < .3 ? [255, 255, 255, 255] : [0, 0, 0, 255]), fast);
  assert.ok(f.centroid.y < .3); assert.ok(f.direction.confidence > .9);
  assert.ok(Math.abs(Math.sin(f.direction.angle)) < .01);
});

test('hidden RGB does not create false contours or mass; empty alpha is an explicit error', async () => {
  await assert.rejects(analyzeImage(input(64, 64, () => [255, 200, 100, 0]), fast), /transparent/);
  const a = await analyzeImage(input(64, 64, x => x < .5 ? [200, 200, 200, 255] : [255, 0, 0, 0]), fast);
  const b = await analyzeImage(input(64, 64, x => x < .5 ? [200, 200, 200, 255] : [0, 255, 255, 0]), fast);
  assert.deepEqual(a.luma, b.luma); assert.deepEqual(a.edges, b.edges); assert.ok(a.centroid.x < .4);
});

test('invalid and oversized analysis input fails before processing', async () => {
  for (const bad of [null, {}, { pixels: { width: 1024, height: 1024, data: [] } }, { pixels: { width: 1, height: 1, data: [] } }]) await assert.rejects(analyzeImage(bad, fast), /invalid/);
});

test('material preserves bounded 3D volume and exact outer-dense 35/45/20 distribution', async () => {
  const f = await analyzeImage(input(64, 64, x => [x * 255, x * 255, x * 255, 255]), fast);
  const material = new ImageMaterial(f), count = 1000, kinds = {}, points = [];
  for (let i = 0; i < count; i++) {
    const p = material.sample(i, count); kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    assert.ok(p.point.every(v => Number.isFinite(v) && Math.abs(v) < 1.5)); points.push(p.point);
  }
  assert.deepEqual(kinds, { edge: 350, surface: 450, interior: 200 });
  assert.ok(Math.max(...points.map(p => p[2])) - Math.min(...points.map(p => p[2])) > 1.4);
  const scratch = new Float64Array(3); assert.equal(material.map([0, 0, 1], scratch), scratch);
});

test('density and geometric skeleton actually respond to different images; regeneration varies sampling', async () => {
  const make = async reverse => new ImageMaterial(await analyzeImage(input(64, 64, x => (x > .5) !== reverse ? [255, 255, 255, 255] : [0, 0, 0, 255]), fast));
  const right = await make(false), left = await make(true);
  const mean = m => Array.from({ length: 450 }, (_, j) => m.sample(350 + j, 1000).canonical[0]).reduce((a, b) => a + b) / 450;
  assert.ok(mean(right) > mean(left) + .08);
  assert.notDeepEqual(right.map([.6, .2, .2]), left.map([.6, .2, .2]));
  assert.notDeepEqual(right.sample(440, 1000), new ImageMaterial(right.features, 3).sample(440, 1000));
});

test('cancellation during analysis cannot publish a result; retry works after an error', async () => {
  const job = new TranslationJob();
  await assert.rejects(job.run(input(64, 64, () => [100, 100, 100, 255]), { yieldTask: async () => job.cancel() }), { name: 'AbortError' });
  assert.equal(job.result, null);
  await assert.rejects(job.run({}, fast)); assert.equal(job.result, null);
  assert.ok(await job.run(input(1, 1, () => [100, 100, 100, 255]), fast));
});

test('superseded jobs cannot overwrite regenerated materials and progress reports completed work', async () => {
  const job = new TranslationJob(); let release;
  const old = job.run(input(64, 64, () => [0, 0, 0, 255]), { yieldTask: () => new Promise(r => { release = r; }) });
  const values = [];
  const latest = await job.run(input(64, 64, () => [255, 255, 255, 255]), { ...fast, progress: (phase, v) => values.push(v) });
  release(); await assert.rejects(old, { name: 'AbortError' });
  assert.equal(job.result, latest); assert.equal(values.at(-1), 1);
  assert.ok(values.every((v, i) => !i || v >= values[i - 1]));
});

test('alpha silhouette contributes real contours even for a black shape on transparency', async () => {
  const f = await analyzeImage(input(64, 64, x => x < .4 ? [0, 0, 0, 255] : [100, 10, 255, 0]), fast);
  assert.ok(f.edges.some(v => v > .5)); assert.ok(f.centroid.x < .5);
});

test('generation is bounded to the device budget and cancellation during it cannot publish', async () => {
  const image = input(1, 1, () => [128,128,128,255]), job = new TranslationJob();
  await assert.rejects(job.run(image, { ...fast, progress(phase) { if (phase === 'STRUCTURE') job.cancel(); } }), { name: 'AbortError' });
  assert.equal(job.result, null);
  const result = await job.run(image, { ...fast, count: 850 });
  assert.equal(result.cached.length, 850); assert.equal(result.sample(10, 850), result.cached[10]);
  await assert.rejects(job.run(image, { ...fast, count: 1000000 }), /budget/);
});

test('image-down to geometry-up orientation is respected and FLOW sampling is continuous across cells', async () => {
  const f = await analyzeImage(input(64, 64, x => [x * 255,x * 255,x * 255,255]), fast);
  const material = new ImageMaterial({ ...f, direction: { angle: Math.PI / 4, confidence: 1 } });
  // Same x => same luminance/radius; opposite y flips image/world handedness.
  const along = material.map([.4,-.4,0]), across = material.map([.4,.4,0]);
  assert.ok(Math.hypot(...along) > Math.hypot(...across));
  assert.ok(Math.abs(material.at(f.luma, .5 - 1e-6, .5) - material.at(f.luma, .5 + 1e-6, .5)) < .0001);
});

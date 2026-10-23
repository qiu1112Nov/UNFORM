import test from 'node:test';
import assert from 'node:assert/strict';
import { cropRect, FUSION, FusionSession, validateImage } from '../src/fusion.js';

const file = { type: 'image/jpeg', size: 1000 };
function source(width = 1600, height = 900) {
  return { width, height, disposed: false, dispose() { this.disposed = true; } };
}
const sample = (image, rect, size) => ({ data: new Uint8ClampedArray(size * size * 4), width: size, height: size });

test('image validation accepts bounded JPEG/PNG/WebP and rejects non-images, SVG, HEIC and oversized files', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.doesNotThrow(() => validateImage({ ...file, type }));
  for (const type of ['', 'text/html', 'image/svg+xml', 'image/heic']) assert.throws(() => validateImage({ ...file, type }));
  assert.throws(() => validateImage(null));
  assert.throws(() => validateImage({ ...file, size: 0 }));
  assert.throws(() => validateImage({ ...file, size: FUSION.maxBytes + 1 }));
});

test('square crop covers the centered landscape, portrait and square images without stretching', () => {
  assert.deepEqual(cropRect(1600, 900, { x: .5, y: .5, zoom: 1 }), { x: 350, y: 0, width: 900, height: 900 });
  assert.deepEqual(cropRect(900, 1600, { x: .5, y: .5, zoom: 1 }), { x: 0, y: 350, width: 900, height: 900 });
  assert.deepEqual(cropRect(512, 512, { x: .5, y: .5, zoom: 1 }), { x: 0, y: 0, width: 512, height: 512 });
});

test('zoom and pan stay inside image at all four crop corners', () => {
  for (const [width, height] of [[1600, 900], [900, 1600]]) {
    for (const x of [-1, 0, 1, 2]) for (const y of [-1, 0, 1, 2]) for (const zoom of [.5, 1, 2, 3, 8]) {
      const r = cropRect(width, height, { x, y, zoom });
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height);
      assert.equal(r.width, r.height);
    }
  }
});

test('confirm requires a decoded source and creates a bounded versioned sampling interface', async () => {
  const s = new FusionSession();
  assert.equal(s.confirm(sample), false); assert.equal(s.getTranslationInput(), null);
  await s.select(file, async () => source());
  assert.equal(s.getTranslationInput(), null, 'no pretend translation during selection');
  assert.equal(s.confirm(sample), true);
  const input = s.getTranslationInput();
  assert.equal(input.version, 1); assert.equal(input.kind, 'LOCAL_IMAGE'); assert.equal(input.colorSpace, 'srgb');
  assert.equal(input.width, 512); assert.equal(input.height, 512);
  assert.equal(input.pixels.data.length, 512 * 512 * 4); assert.ok(!('file' in input));
});

test('changing the crop invalidates confirmation; selecting another image resets framing and disposes the old source', async () => {
  const s = new FusionSession(), first = source();
  await s.select(file, async () => first); s.confirm(sample);
  s.adjust({ x: 1, y: 0, zoom: 2 }); assert.equal(s.output, null);
  s.confirm(sample); assert.equal(s.output.crop.width, 450);
  await s.select(file, async () => source(900, 1600));
  assert.equal(first.disposed, true); assert.equal(s.output, null);
  assert.deepEqual(s.crop, { x: .5, y: .5, zoom: 1 });
});

test('invalid selection or corrupt image preserves prior crop for reselection and clears busy state', async () => {
  const s = new FusionSession(), first = source();
  await s.select(file, async () => first); s.adjust({ zoom: 2 }); s.confirm(sample);
  await assert.rejects(s.select({ ...file, type: 'text/html' }, () => assert.fail('must not decode')));
  assert.equal(s.source, first); assert.equal(s.crop.zoom, 2); assert.equal(s.output, null); assert.equal(s.loading, false);
  await assert.rejects(s.select(file, async () => { throw new Error('decode failed'); }));
  assert.equal(s.loading, false); assert.equal(first.disposed, false);
});

test('cancel during delayed decoding ignores the stale completion and releases decoded pixels', async () => {
  const s = new FusionSession(), late = source(); let resolve;
  const pending = s.select(file, () => new Promise(r => { resolve = r; }));
  assert.equal(s.loading, true); assert.equal(s.confirm(sample), false); assert.equal(s.adjust({ zoom: 2 }), false);
  s.clear(); resolve(late);
  assert.equal(await pending, false); assert.equal(late.disposed, true);
  assert.equal(s.source, null); assert.equal(s.output, null); assert.equal(s.loading, false);
});

test('the latest selection wins even if the old decoder finishes afterward', async () => {
  const s = new FusionSession(), old = source(), current = source(600, 800); let resolve;
  const pending = s.select(file, () => new Promise(r => { resolve = r; }));
  await s.select(file, async () => current); resolve(old); await pending;
  assert.equal(s.source, current); assert.equal(old.disposed, true); assert.equal(s.loading, false);
});

test('cancel clears pixels and confirmation; a new session cannot consume an old crop', async () => {
  const s = new FusionSession(), image = source();
  await s.select(file, async () => image); s.confirm(sample); s.clear();
  assert.equal(image.disposed, true); assert.equal(s.confirm(sample), false);
  assert.equal(s.getTranslationInput(), null); assert.equal(s.adjust({ x: 1 }), false);
  s.clear(); assert.equal(s.source, null);
});

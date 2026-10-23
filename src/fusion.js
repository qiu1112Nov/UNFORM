import { TranslationJob } from './image-translation.js';
// Local-only preparation contract. Translation consumes getTranslationInput(),
// never the original File. Coordinates refer to the bounded, orientation-corrected source.
export const FUSION = Object.freeze({ maxBytes: 20 * 1024 * 1024, sourceSize: 2048, outputSize: 512, maxZoom: 3 });
const types = new Set(['image/jpeg', 'image/png', 'image/webp']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function validateImage(file) {
  if (!file || !types.has(file.type)) throw new Error('Choose a JPEG, PNG or WebP image. Convert HEIC images to JPEG first.');
  if (!file.size || file.size > FUSION.maxBytes) throw new Error('Choose an image smaller than 20 MB.');
}
export function cropRect(width, height, crop) {
  const size = Math.min(width, height) / clamp(crop.zoom, 1, FUSION.maxZoom);
  return { x: (width - size) * clamp(crop.x, 0, 1), y: (height - size) * clamp(crop.y, 0, 1), width: size, height: size };
}
export class FusionSession {
  constructor() { this.revision = 0; this.source = null; this.output = null; this.loading = false; this.crop = { x: .5, y: .5, zoom: 1 }; }
  async select(file, decode) {
    const revision = ++this.revision;
    this.loading = true;
    // Keep the previous image on failure, but invalidate its old confirmation.
    this.output = null;
    try {
      validateImage(file);
      const source = await decode(file);
      if (revision !== this.revision) { source.dispose?.(); return false; }
      this.source?.dispose?.(); this.source = source;
      this.crop = { x: .5, y: .5, zoom: 1 };
      return true;
    } finally { if (revision === this.revision) this.loading = false; }
  }
  adjust(patch) {
    if (!this.source || this.loading) return false;
    this.crop = { x: clamp(patch.x ?? this.crop.x, 0, 1), y: clamp(patch.y ?? this.crop.y, 0, 1), zoom: clamp(patch.zoom ?? this.crop.zoom, 1, FUSION.maxZoom) };
    this.output = null; return true;
  }
  confirm(sample) {
    if (!this.source || this.loading) return false;
    const crop = cropRect(this.source.width, this.source.height, this.crop);
    this.output = { version: 1, kind: 'LOCAL_IMAGE', width: FUSION.outputSize, height: FUSION.outputSize,
      colorSpace: 'srgb', crop, pixels: sample(this.source, crop, FUSION.outputSize) };
    return true;
  }
  getTranslationInput() { return this.output; }
  clear() {
    ++this.revision; this.source?.dispose?.(); this.source = null; this.output = null; this.loading = false;
    this.crop = { x: .5, y: .5, zoom: 1 };
  }
}

export async function decodeLocalImage(file) {
  // Object URLs stay in the page; revoke on both success and error. Browsers
  // apply EXIF orientation when drawing HTML images. No network upload occurs.
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > 40_000_000) throw new Error('This image is too large. Choose an image under 40 megapixels.');
    const ratio = Math.min(1, FUSION.sourceSize / Math.max(width, height));
    const surface = document.createElement('canvas');
    surface.width = Math.max(1, Math.round(width * ratio)); surface.height = Math.max(1, Math.round(height * ratio));
    const ctx = surface.getContext('2d');
    if (!ctx) throw new Error('Image editing requires Canvas 2D support.');
    ctx.drawImage(image, 0, 0, surface.width, surface.height);
    return { width: surface.width, height: surface.height, surface, dispose() { surface.width = surface.height = 0; } };
  } finally { URL.revokeObjectURL(url); }
}

export function mountFusion({ flow, root, beforeCreate = () => true, particleCount = () => 850 }) {
  const $ = selector => root.querySelector(selector);
  const session = new FusionSession();
  const job = new TranslationJob();
  const input = $('#fusion-file'), preview = $('#fusion-preview'), confirmed = $('#translate-preview');
  const message = $('#fusion-message');
  let pointer = null, uiRevision = 0;
  const controls = ['x', 'y', 'zoom'];
  function sync() {
    const ready = !!session.source && !session.loading;
    $('#fusion-confirm').disabled = !ready;
    $('#fusion-empty').hidden = !!session.source;
    preview.hidden = !session.source;
    for (const key of controls) {
      const control = $(`#crop-${key}`); control.disabled = !ready;
      control.value = session.crop[key];
    }
    if (session.source) {
      const rect = cropRect(session.source.width, session.source.height, session.crop);
      const ctx = preview.getContext('2d');
      ctx.clearRect(0, 0, preview.width, preview.height);
      ctx.drawImage(session.source.surface, rect.x, rect.y, rect.width, rect.height, 0, 0, preview.width, preview.height);
    }
  }
  function resetTranslation() {
    job.cancel(); $('#translate-create').disabled = true;
    $('#translate-progress').value = 0;
    $('#translation-details').textContent = '';
    $('#translation-map').getContext('2d').clearRect(0, 0, 128, 128);
  }
  async function translate() {
    resetTranslation();
    const revision = job.revision + 1;
    try {
      const result = await job.run(session.getTranslationInput(), { count: particleCount(), progress(phase, fraction) {
        if (flow.screen !== 'TRANSLATE') return;
        $('#translate-progress').value = fraction;
        $('#translate-status').textContent = `${Math.round(fraction * 100)}% / ${phase === 'READY' ? 'ANALYSIS COMPLETE · MATERIAL READY' : phase}`;
      } });
      if (!result || flow.screen !== 'TRANSLATE' || job.revision !== revision) return;
      const f = result.features, center = result.field?.centroid ?? result.features.centroid, ctx = $('#translation-map').getContext('2d'), n = f.resolution;
      const pixels = ctx.createImageData(n, n);
      for (let i = 0; i < n * n; i++) { const value = Math.round((result.field?.density[i] ?? Math.min(1, f.luma[i] * .65 + f.edges[i] * .8)) * 255); pixels.data.set([value, value, value, 255], i * 4); }
      const map = document.createElement('canvas'); map.width = map.height = n; map.getContext('2d').putImageData(pixels, 0, 0);
      ctx.drawImage(map, 0, 0, 128, 128);
      ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(center.x * 128, center.y * 128, 5, 0, Math.PI * 2); ctx.stroke();
      const distribution = Array.from(f.histogram, v => Math.round(v / (n * n) * 100)).join(' / ');
      $('#translation-details').textContent = `64 × 64 analysis · brightness ${Math.round(f.mean * 100)}% · contrast ${Math.round(f.contrast * 100)}%\nDark → light bins (%): ${distribution}\nVisual center: ${Math.round(center.x * 100)}%, ${Math.round(center.y * 100)}% · circle on map\nContour tangent: ${(f.direction.angle * 180 / Math.PI).toFixed(0)}° · coherence ${Math.round(f.direction.confidence * 100)}%\n${result.field?.noiseDominated ? 'Fine texture dominates: weak details are suppressed; a restrained volume is used.' : f.lowContrast ? 'Low contrast: restrained geometry; no invented contours.' : 'Multi-scale density follows image structure; no fixed geometric shell.'}`;
      $('#translation-details').textContent += `\n${result.stats.nodes} shared nodes · ${result.stats.lines} links · ${result.stats.faces} faces\n${result.stats.isolated} independent nodes · face area budget ${(result.stats.areaRatio * 100).toFixed(2)}% of XY bounds (3D triangle area)\nDensity combines silhouette, contours, local contrast, structure and corners; not object recognition.`;
      $('#translate-create').disabled = false;
    } catch (error) {
      if (error.name !== 'AbortError' && job.revision === revision && flow.screen === 'TRANSLATE') $('#translate-status').textContent = error.message || 'Analysis failed. Edit the frame or retry.';
    }
  }
  function clear() {
    resetTranslation();
    ++uiRevision; pointer = null;
    session.clear(); input.value = ''; message.textContent = 'Your image stays in this tab. Nothing is uploaded.';
    confirmed.getContext('2d').clearRect(0, 0, confirmed.width, confirmed.height);
    sync();
  }
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; input.value = '';
    if (!file) return; // Dismissing the system picker keeps the current crop.
    const revision = ++uiRevision;
    pointer = null; message.textContent = 'Opening image locally…';
    const pending = session.select(file, decodeLocalImage); sync();
    try {
      if (await pending && revision === uiRevision) message.textContent = 'Drag to frame your image. Adjust zoom or position below.';
    } catch (error) { if (revision === uiRevision) message.textContent = error.message || 'Could not open this image. Please choose another.'; }
    if (revision === uiRevision) sync();
  });
  for (const key of controls) $(`#crop-${key}`).addEventListener('input', event => {
    session.adjust({ [key]: Number(event.target.value) }); sync();
  });
  preview.addEventListener('pointerdown', event => {
    if (flow.screen !== 'IMPORT' || session.loading || !session.source || pointer || (event.pointerType === 'mouse' && event.button !== 0)) return;
    preview.setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  preview.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId || !session.source) return;
    const rect = cropRect(session.source.width, session.source.height, session.crop);
    const scale = rect.width / preview.getBoundingClientRect().width;
    session.adjust({ x: session.crop.x - (event.clientX - pointer.x) * scale / Math.max(1, session.source.width - rect.width),
      y: session.crop.y - (event.clientY - pointer.y) * scale / Math.max(1, session.source.height - rect.height) });
    pointer.x = event.clientX; pointer.y = event.clientY; sync();
  });
  const endPointer = event => { if (pointer?.id === event.pointerId) pointer = null; };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) preview.addEventListener(name, endPointer);
  $('#fusion-confirm').addEventListener('click', () => {
    if (flow.screen !== 'IMPORT') return;
    try {
      const ready = session.confirm((source, rect, size) => {
        confirmed.width = confirmed.height = size;
        const ctx = confirmed.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source.surface, rect.x, rect.y, rect.width, rect.height, 0, 0, size, size);
        return ctx.getImageData(0, 0, size, size);
      });
      pointer = null;
      if (flow.translate(ready)) { $('#translate-title').focus({ preventScroll: true }); translate(); }
    } catch { message.textContent = 'Could not prepare this image. Please choose another.'; }
  });
  $('#fusion-cancel').addEventListener('click', () => { clear(); flow.back(); $('#fusion-start').focus({ preventScroll: true }); });
  $('#translate-cancel').addEventListener('click', () => { clear(); flow.back(); $('#fusion-start').focus({ preventScroll: true }); });
  $('#translate-edit').addEventListener('click', () => { resetTranslation(); flow.editImage(); sync(); $('#fusion-title').focus({ preventScroll: true }); });
  $('#translate-regenerate').addEventListener('click', () => { if (flow.screen === 'TRANSLATE') translate(); });
  $('#translate-create').addEventListener('click', () => {
    if (flow.screen !== 'TRANSLATE' || !job.result) return;
    if (job.result.cachedCount !== particleCount()) { translate(); return; }
    if (beforeCreate(job.result)) flow.createFusion(job.result);
  });
  window.addEventListener('pagehide', () => {
    clear();
    if (flow.screen === 'IMPORT' || flow.screen === 'TRANSLATE') flow.back();
  });
  window.addEventListener('blur', () => { pointer = null; });
  sync();
  return { session, clear };
}

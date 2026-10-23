import { octahedronParticle } from './octahedron.js';
import { buildDensityField, DensityMaterial } from './density-field.js';

export const TRANSLATION = Object.freeze({ resolution: 64, maxInputPixels: 512 * 512, maxCandidates: 6 });
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
const abort = signal => { if (signal?.aborted) throw new DOMException('Translation cancelled', 'AbortError'); };

// Bounded block averages avoid aliasing and ignore hidden RGB in transparent pixels.
export async function analyzeImage(input, { signal, progress = () => {}, yieldTask = yieldFrame } = {}) {
  const { width, height, data } = input?.pixels ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > TRANSLATION.maxInputPixels || data?.length !== width * height * 4) {
    throw new Error('The confirmed image is invalid. Return to Edit Frame and choose it again.');
  }
  const n = TRANSLATION.resolution, luma = new Float32Array(n * n), alpha = new Float32Array(n * n), edges = new Float32Array(n * n);
  const histogram = new Uint32Array(8);
  let coverage = 0, sum = 0, square = 0;
  for (let y = 0; y < n; y++) {
    abort(signal);
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor(x * width / n), x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / n));
      const y0 = Math.floor(y * height / n), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / n));
      let light = 0, opacity = 0, count = 0;
      for (let py = y0; py < Math.min(y1, height); py++) for (let px = x0; px < Math.min(x1, width); px++) {
        const i = (py * width + px) * 4, a = data[i + 3] / 255;
        light += (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255 * a;
        opacity += a; count++;
      }
      const i = y * n + x, a = opacity / count, value = light / count;
      luma[i] = value; alpha[i] = a; coverage += a; sum += value; square += value * value;
      histogram[Math.min(7, Math.floor(value * 8))]++;
    }
    if (y % 8 === 7) { progress('LUMINANCE', (y + 1) / n * .4); await yieldTask(); }
  }
  if (coverage < n * n * .005) throw new Error('The crop is fully transparent. Choose a visible part of the image.');
  let gx2 = 0, gy2 = 0, gxy = 0, maxEdge = 0;
  for (let y = 1; y < n - 1; y++) {
    abort(signal);
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const gx = (luma[i + 1] - luma[i - 1] + .25 * (alpha[i + 1] - alpha[i - 1])) / 2, gy = (luma[i + n] - luma[i - n] + .25 * (alpha[i + n] - alpha[i - n])) / 2;
      const edge = Math.hypot(gx, gy); edges[i] = edge; maxEdge = Math.max(maxEdge, edge);
      gx2 += gx * gx; gy2 += gy * gy; gxy += gx * gy;
    }
    if (y % 8 === 0) { progress('CONTOURS', .4 + y / n * .3); await yieldTask(); }
  }
  let mass = 0, cx = 0, cy = 0;
  for (let i = 0; i < luma.length; i++) {
    edges[i] /= Math.max(.06, maxEdge);
    const w = (luma[i] + edges[i] * .35 + alpha[i] * .015);
    mass += w; cx += (i % n + .5) / n * w; cy += (Math.floor(i / n) + .5) / n * w;
  }
  const mean = sum / (n * n), contrast = Math.sqrt(Math.max(0, square / (n * n) - mean * mean));
  const confidence = Math.hypot(gx2 - gy2, 2 * gxy) / (gx2 + gy2 || 1);
  // Structure-tensor tangent direction, rather than a fabricated object label.
  const angle = .5 * Math.atan2(2 * gxy, gx2 - gy2) + Math.PI / 2;
  abort(signal); progress('ANALYZED', .75); await yieldTask(); abort(signal);
  return { resolution: n, luma, edges, alpha, histogram, mean, contrast, coverage: coverage / (n * n),
    centroid: { x: cx / mass, y: cy / mass }, direction: { angle, confidence }, lowContrast: contrast < .035 };
}

export class ImageMaterial {
  constructor(features, seed = 1) { this.features = features; this.seed = seed; }
  at(array, x, y) {
    const n = this.features.resolution;
    const px = clamp(x) * (n - 1), py = clamp(y) * (n - 1);
    const ix = Math.floor(px), iy = Math.floor(py), jx = Math.min(n - 1, ix + 1), jy = Math.min(n - 1, iy + 1);
    const fx = px - ix, fy = py - iy;
    return (array[iy * n + ix] * (1 - fx) + array[iy * n + jx] * fx) * (1 - fy) + (array[jy * n + ix] * (1 - fx) + array[jy * n + jx] * fx) * fy;
  }
  map(point, out = new Float64Array(3)) {
    const f = this.features, x = point[0], y = point[1], z = point[2], u = (x + 1) / 2, v = (1 - y) / 2;
    const light = this.at(f.luma, u, v), edge = this.at(f.edges, u, v);
    // Smooth local contour envelope (not pixel-height extrusion). All three axes
    // retain volume; radial sampling still has 35% edges / 45% surface / 20% interior.
    const angle = -f.direction.angle, strength = f.direction.confidence * .13;
    const c = Math.cos(angle), s = Math.sin(angle), a = x * c + y * s, b = -x * s + y * c;
    const radius = .88 + light * .16 + edge * .055;
    const cluster = Math.exp(-((u - f.centroid.x) ** 2 + (v - f.centroid.y) ** 2) / .16);
    out[0] = (a * (1 + strength) * c - b * (1 - strength) * s) * radius + (f.centroid.x * 2 - 1 - x) * .09 * cluster;
    out[1] = (a * (1 + strength) * s + b * (1 - strength) * c) * radius + (1 - f.centroid.y * 2 - y) * .09 * cluster;
    out[2] = z * (.88 + f.contrast * .35 + edge * .07) + (light - f.mean) * .10 * (1 - Math.abs(z));
    return out;
  }
  sample(index, count) {
    if (count === this.cachedCount && this.cached) return this.cached[index];
    const edgeCount = Math.round(count * .35), surfaceEnd = edgeCount + Math.round(count * .45);
    const lo = index < edgeCount ? 0 : index < surfaceEnd ? edgeCount : surfaceEnd;
    const hi = index < edgeCount ? edgeCount : index < surfaceEnd ? surfaceEnd : count;
    let best, bestScore = -Infinity;
    for (let k = 0; k < TRANSLATION.maxCandidates; k++) {
      const random = ((Math.imul(index + 1, 1664525) + Math.imul(k + this.seed, 1013904223)) >>> 0) / 4294967296;
      let candidate = lo + Math.floor(random * (hi - lo));
      if (lo === 0) { candidate = index % 12 + 12 * Math.floor(random * Math.ceil((hi - index % 12) / 12)); }
      const sample = octahedronParticle(candidate, count), p = sample.point;
      const u = (p[0] + 1) / 2, v = (1 - p[1]) / 2;
      const f = this.features;
      const cluster = Math.exp(-((u - f.centroid.x) ** 2 + (v - f.centroid.y) ** 2) / .12);
      const weight = .18 + this.at(f.luma, u, v) * .6 + this.at(f.edges, u, v) * .25 + this.at(f.alpha, u, v) * .05 + cluster * .15;
      // Weighted exponential race; deterministic but varied per particle/candidate.
      const noise = (((Math.imul(index + k * 7919 + this.seed, 374761393) ^ 668265263) >>> 0) + 1) / 4294967297;
      const score = Math.log(noise) / weight;
      if (score > bestScore) { bestScore = score; best = sample; }
    }
    return { kind: best.kind, canonical: best.point, point: Array.from(this.map(best.point)) };
  }
}

// Cancellation is checked after each real phase, so old jobs cannot publish over
// a newer crop or leave a generated-but-cancelled artwork behind.
export class TranslationJob {
  constructor() { this.controller = null; this.result = null; this.revision = 0; }
  cancel() { this.controller?.abort(); this.result = null; this.revision++; }
  async run(input, options = {}) {
    this.cancel(); const revision = this.revision;
    const controller = this.controller = new AbortController();
    const features = await analyzeImage(input, { ...options, signal: controller.signal });
    abort(controller.signal);
    const count = options.count ?? 850;
    if (!Number.isInteger(count) || count < 128 || count > 1900) throw new Error('Unsupported particle budget.');
    const task = { ...options, signal: controller.signal };
    const field = await buildDensityField(features, task);
    const material = new DensityMaterial(features, field, revision, options.base);
    await material.prepare(count, task); abort(controller.signal);
    if (revision !== this.revision) return null;
    this.result = material; options.progress?.('READY', 1); return material;
  }
}

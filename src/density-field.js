import { OCTAHEDRON_BASE, GEOMETRY_CONSTRAINT } from './base-topology.js';

// Geometry is a reference only; visible nodes and topology come from the image.
export const DENSITY_FIELD = Object.freeze({
  weights: Object.freeze({ silhouette: .55, contour: 1.4, contrast: .65, structure: .5, corner: .8, center: .15 }),
  mobile: Object.freeze({ lines: 720, faces: 14, glyphs: 24 }),
  desktop: Object.freeze({ lines: 1600, faces: 28, glyphs: 48 }),
  referenceMix: .12, maxRadius: 1.55,
  degree: 4, candidates: 48, faceAreaRatio: .035, isolatedFraction: .12,
});
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const random = (i, salt) => {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const check = signal => { if (signal?.aborted) throw new DOMException('Translation cancelled', 'AbortError'); };
const NEIGHBORS = [];
for (let x=-1;x<=1;x++) for (let y=-1;y<=1;y++) for (let z=-1;z<=1;z++) NEIGHBORS.push([x,y,z]);
NEIGHBORS.sort((a,b)=>a[0]**2+a[1]**2+a[2]**2-b[0]**2-b[1]**2-b[2]**2);
const wait = () => new Promise(resolve => setTimeout(resolve, 0));

function blur(source, n, radius) {
  const temp = new Float32Array(source.length), out = new Float32Array(source.length);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let sum = 0; for (let k = -radius; k <= radius; k++) sum += source[y * n + clamp(x + k, 0, n - 1)];
    temp[y * n + x] = sum / (radius * 2 + 1);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let sum = 0; for (let k = -radius; k <= radius; k++) sum += temp[clamp(y + k, 0, n - 1) * n + x];
    out[y * n + x] = sum / (radius * 2 + 1);
  }
  return out;
}
function gradient(source, n) {
  const x = new Float32Array(source.length), y = new Float32Array(source.length);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const i = row * n + col;
    x[i] = (source[row * n + Math.min(n - 1, col + 1)] - source[row * n + Math.max(0, col - 1)]) / 2;
    y[i] = (source[Math.min(n - 1, row + 1) * n + col] - source[Math.max(0, row - 1) * n + col]) / 2;
  }
  return { x, y };
}
function cumulative(values) {
  const result = new Float64Array(values.length); let total = 0;
  for (let i = 0; i < values.length; i++) result[i] = total += values[i];
  if (!(total > 0)) throw new Error('No visible image structure. Choose another crop.');
  for (let i = 0; i < result.length; i++) result[i] /= total;
  return result;
}
function pick(cdf, value) {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (cdf[mid] < value) lo = mid + 1; else hi = mid; }
  return lo;
}

export async function buildDensityField(features, { signal, yieldTask = wait, progress = () => {}, weights = {} } = {}) {
  const n = features.resolution, alpha = features.alpha;
  const fine = blur(features.luma, n, 1), middle = blur(fine, n, 3), coarse = blur(middle, n, 7);
  const alphaSoft = blur(alpha, n, 1), g = gradient(fine, n), gm = gradient(middle, n), ga = gradient(alphaSoft, n);
  const xx = new Float32Array(n * n), yy = new Float32Array(n * n), xy = new Float32Array(n * n);
  let background = 0, borderAlpha = 0, border = 0;
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = Math.floor(i / n);
    if (x < 3 || y < 3 || x >= n - 3 || y >= n - 3) { background += fine[i]; borderAlpha += alpha[i]; border++; }
    const dx = g.x[i] + ga.x[i] * .35, dy = g.y[i] + ga.y[i] * .35;
    xx[i] = dx * dx; yy[i] = dy * dy; xy[i] = dx * dy;
  }
  background /= border; borderAlpha /= border;
  const tx = blur(xx, n, 2), ty = blur(yy, n, 2), txy = blur(xy, n, 2);
  const squared = Float32Array.from(fine, v => v * v), variance = blur(squared, n, 3);
  const density = new Float32Array(n * n), contour = new Float32Array(n * n), corner = new Float32Array(n * n);
  const coherence = new Float32Array(n * n), tangent = new Float32Array(n * n), foreground = new Float32Array(n * n);
  const w = { ...DENSITY_FIELD.weights };
  for (const key of Object.keys(w)) if (Number.isFinite(weights[key])) w[key] = clamp(weights[key], 0, 3);
  let peak = 0, contourPeak = 0, cornerPeak = 0;
  for (let i = 0; i < n * n; i++) {
    const energy = tx[i] + ty[i], disc = Math.hypot(tx[i] - ty[i], 2 * txy[i]);
    coherence[i] = disc / (energy + 1e-8);
    tangent[i] = .5 * Math.atan2(2 * txy[i], tx[i] - ty[i]) + Math.PI / 2;
    corner[i] = Math.max(0, (energy - disc) / 2); cornerPeak = Math.max(cornerPeak, corner[i]);
    // Fine edges need medium-scale support. This suppresses isolated texture.
    contour[i] = Math.hypot(gm.x[i], gm.y[i]) * 2 + Math.hypot(ga.x[i], ga.y[i]) * .6 + Math.sqrt(energy) * .35 * coherence[i];
    contourPeak = Math.max(contourPeak, contour[i]);
    foreground[i] = borderAlpha < .5 ? alphaSoft[i] : clamp(Math.abs(fine[i] - background) / Math.max(.09, features.contrast * 1.4));
  }
  check(signal); progress('DENSITY FIELD', .79); await yieldTask(); check(signal);
  const spread = values => {
    let sum = 0, squared = 0;
    for (const value of values) { sum += value; squared += value * value; }
    return Math.sqrt(Math.max(0, squared / values.length - (sum / values.length) ** 2));
  };
  const fineSpread = spread(fine), middleSpread = spread(middle);
  const noiseDominated = fineSpread > .012 && middleSpread / fineSpread < .45 && middleSpread < .035 && spread(alphaSoft) < .01;
  const flat = contourPeak < .008 && features.lowContrast || noiseDominated;
  let centerX = 0, centerY = 0, centerMass = 0;
  for (let i = 0; i < density.length; i++) {
    const mass = alphaSoft[i] * (foreground[i] + contour[i] / Math.max(.035, contourPeak) * .4);
    centerX += (i % n + .5) / n * mass; centerY += (Math.floor(i / n) + .5) / n * mass; centerMass += mass;
  }
  const centroid = centerMass > 1e-5 ? { x: centerX / centerMass, y: centerY / centerMass } : { x: .5, y: .5 };
  for (let i = 0; i < density.length; i++) {
    contour[i] = clamp(contour[i] / Math.max(.035, contourPeak));
    corner[i] = Math.sqrt(corner[i] / Math.max(1e-5, cornerPeak));
    const x = (i % n + .5) / n, y = (Math.floor(i / n) + .5) / n;
    const local = Math.sqrt(Math.max(0, variance[i] - middle[i] ** 2));
    const center = Math.exp(-((x - centroid.x) ** 2 + (y - centroid.y) ** 2) / .12);
    const support = clamp(foreground[i] + contour[i] * .65);
    const envelope = flat ? Math.exp(-((x - .5) ** 2 + (y - .5) ** 2) / .22) : support;
    const value = (w.silhouette * foreground[i] + w.contour * contour[i] + w.contrast * clamp(local * 5) +
      w.structure * Math.abs(middle[i] - coarse[i]) * 3 + w.corner * corner[i] * contour[i] + w.center * center * support);
    density[i] = alphaSoft[i] * (.00015 + Math.pow((flat ? .18 : value) * envelope, 1.35));
    peak = Math.max(peak, density[i]);
  }
  for (let i = 0; i < density.length; i++) density[i] /= Math.max(1e-8, peak);
  const contourWeights = Float32Array.from(density, (v, i) => v * (.03 + (flat ? 0 : contour[i])));
  return { resolution: n, density, contour, corner, coherence, tangent, foreground, coarse, alpha: alphaSoft, flat, noiseDominated,
    centroid, weights: w, cdf: cumulative(density), contourCDF: cumulative(contourWeights) };
}

export class DensityMaterial {
  constructor(features, field, seed = 1, base = OCTAHEDRON_BASE) { this.features = features; this.field = field; this.seed = seed; this.base = base; this.densityField = true; }
  map(point, out = new Float64Array(3)) { for (let i = 0; i < 3; i++) out[i] = point[i]; return out; }
  sample(index, count) {
    if (count !== this.cachedCount || !this.cached) throw new Error('Prepare the density graph before entering CREATE.');
    return this.cached[index];
  }
  embed(u, v, depth, cell) {
    const f=this.field, sx=(u-.5)*2, sy=(.5-v)*2;
    // Continuous, feature-dependent thickness: no parallel slab faces, constant
    // box extrusion, or equal-radius spherical shell. XY retains image silhouette.
    const taper=.35+.65*Math.exp(-(sx*sx+sy*sy)*1.15);
    const thickness=(.18+.24*f.foreground[cell]+.14*f.density[cell]+.08*f.coarse[cell])*taper;
    const image=[sx*.94,sy*.94,depth*thickness+(f.coarse[cell]-this.features.mean)*.06];
    const guide=this.base.embedImage(u,v,depth);
    const blend=f.flat?0:DENSITY_FIELD.referenceMix*(.25+.75*f.coherence[cell]);
    return image.map((value,a)=>value*(1-blend)+guide[a]*blend);
  }
  deform(point, u, v, cell) {
    const f=this.field, strength=f.flat?0:f.contour[cell], angle=f.tangent[cell];
    const cluster=Math.exp(-((u-f.centroid.x)**2+(v-f.centroid.y)**2)/.12);
    const offset=[Math.cos(angle)*strength*.028+(f.centroid.x-u)*cluster*.045,
      -Math.sin(angle)*strength*.028-(f.centroid.y-v)*cluster*.045,
      (f.coarse[cell]-this.features.mean)*.035];
    const maximum=GEOMETRY_CONSTRAINT.maxOffset;
    const magnitude=Math.hypot(...offset), scale=Math.min(1,maximum/(magnitude||1));
    const result=point.map((value,a)=>value+offset[a]*scale);
    // A numerical safety radius, not an octahedral silhouette constraint.
    const radius=Math.hypot(...result);
    if(radius>DENSITY_FIELD.maxRadius)for(let a=0;a<3;a++)result[a]*=DENSITY_FIELD.maxRadius/radius;
    const shift=Math.hypot(...result.map((value,a)=>value-point[a]));
    if(shift>maximum)for(let a=0;a<3;a++)result[a]=point[a]+(result[a]-point[a])*maximum/shift;
    return result;
  }
  async prepare(count, { signal, progress = () => {}, yieldTask = wait } = {}) {
    const f = this.field, n = f.resolution, samples = new Array(count), occupancy = new Uint16Array(n * n);
    const active = f.density.reduce((s, v) => s + (v > .05), 0), cellLimit = Math.max(3, Math.ceil(count / Math.max(1, active) * 2.5));
    const limits = count <= 850 ? DENSITY_FIELD.mobile : DENSITY_FIELD.desktop;
    let glyphs = 0;
    for (let i = 0; i < count; i++) {
      check(signal);
      const cdf = i % 4 === 0 ? f.contourCDF : f.cdf;
      let cell = 0;
      for (let attempt = 0; attempt < 8; attempt++) { cell = pick(cdf, random(i * 8 + attempt, this.seed)); if (occupancy[cell] < cellLimit) break; }
      occupancy[cell]++;
      const u = (cell % n + .15 + random(i, this.seed + 5) * .7) / n;
      const v = (Math.floor(cell / n) + .15 + random(i, this.seed + 7) * .7) / n;
      const edge = f.flat ? 0 : f.contour[cell], important = f.flat ? 0 : f.corner[cell], coherent = f.flat ? 0 : f.coherence[cell];
      const interior = random(i, 21) < .2;
      const side = random(i, 25) < .5 ? -1 : 1;
      const depth=interior?(random(i,27)*2-1)*.7:side*(.45+.55*random(i,29));
      const canonical=this.embed(u,v,depth,cell);
      const point=this.deform(canonical,u,v,cell);
      const angle=f.tangent[cell];
      let glyph = 'point';
      if (glyphs < limits.glyphs && !interior && random(i, 39) < .12) {
        if (important > .28 && edge > .2) glyph = 'tetra';
        else if (edge > .35 && coherent > .4) glyph = 'octa';
        if (glyph !== 'point') glyphs++;
      }
      samples[i] = { point, canonical, density: f.density[cell], cell, uv: [u, v],
        kind: interior ? 'interior' : edge > .3 ? 'edge' : 'surface', glyph, tangent: -angle, coherence: coherent, corner: important };
      if (i % 64 === 63 || i === count - 1) { progress('STRUCTURE', .8 + .12 * (i + 1) / count); await yieldTask(); }
    }
    this.cached = samples; this.cachedCount = count;
    this.mesh = await buildTopology(samples, limits, { signal, yieldTask, progress, reference:this.base, field:f });
    check(signal); this.stats = this.mesh.stats;
    return this;
  }
  createFlow(index) {
    if (index % 8 !== 0 || this.cached[index].kind !== 'edge') return null;
    const neighbors = this.mesh.adjacency[index]; if (!neighbors.length) return null;
    const a = this.mesh.nodes[index], b = this.mesh.nodes[neighbors[index % neighbors.length]];
    return { graph: true, a, b, phase: 0, angularSpeed: .12 * (.6 + random(index, 81)), position: new Float32Array(a), materialPosition: new Float64Array(a) };
  }
}

export async function buildTopology(samples, limits, { signal, yieldTask = wait, progress = () => {}, reference = null, field = null } = {}) {
  const nodes = samples.map(p => p.point), adjacency = nodes.map(() => []), links = [], linkWeights = [], triangles = [], faceWeights = [];
  const cells = new Map(), size = .16, key = (x, y, z) => `${x},${y},${z}`;
  nodes.forEach((p, i) => { const k = key(...p.map(v => Math.floor(v / size))); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); });
  const pairs = new Set(), incident = new Int32Array(nodes.length).fill(-1), primary=[];
  let checked = 0, totalLength = 0;
  for (let i = 0; i < nodes.length && links.length < limits.lines; i++) {
    check(signal);
    if (random(i, 97) < DENSITY_FIELD.isolatedFraction) continue;
    const a = nodes[i], p = samples[i], [x, y, z] = a.map(v => Math.floor(v / size)), candidates = [];
    let scanned = 0;
    search: for (const [dx,dy,dz] of NEIGHBORS) {
      const bucket = cells.get(key(x + dx, y + dy, z + dz)); if (!bucket) continue;
      const offset = Math.floor(random(i, 101) * bucket.length);
      for (let slot = 0; slot < bucket.length; slot++) {
        if (scanned++ >= DENSITY_FIELD.candidates) break search;
        checked++;
        const j = bucket[(slot + offset) % bucket.length];
        if (j === i || random(j, 97) < DENSITY_FIELD.isolatedFraction || adjacency[j].length >= DENSITY_FIELD.degree) continue;
        const q = samples[j];
        if(field && p.uv && q.uv){
          const u=(p.uv[0]+q.uv[0])/2,v=(p.uv[1]+q.uv[1])/2,n=field.resolution;
          const middle=field.density[Math.min(n-1,Math.floor(v*n))*n+Math.min(n-1,Math.floor(u*n))];
          if(middle<Math.max(.008,Math.min(p.density,q.density)*.1))continue;
        }
        const b = nodes[j], vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2], d = Math.hypot(vx, vy, vz);
        const radius = .11 + (1 - Math.min(p.density, q.density)) * .12;
        if (d < .018 || d > radius || Math.abs(vz) > .13) continue;
        const alignment = Math.abs((vx * Math.cos(p.tangent) + vy * Math.sin(p.tangent)) / d);
        if (p.kind === 'edge' && p.coherence > .5 && alignment < .28) continue;
        candidates.push({ j, d, score: d / (.6 + alignment * .4) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const c of candidates) {
      if (adjacency[i].length >= DENSITY_FIELD.degree || links.length >= limits.lines) break;
      const j = c.j; if (adjacency[j].length >= DENSITY_FIELD.degree) continue;
      const pair = `${Math.min(i,j)},${Math.max(i,j)}`; if (pairs.has(pair)) continue;
      pairs.add(pair); incident[i] = incident[j] = links.length;
      links.push([i,j]); primary.push(false); linkWeights.push(.5 + Math.min(samples[i].density, samples[j].density) * .5);
      adjacency[i].push(j); adjacency[j].push(i); totalLength += c.d;
    }
    if (i % 64 === 63) { progress('CONNECTIONS', .92 + .05 * i / nodes.length); await yieldTask(); }
  }
  const xs = nodes.map(p => p[0]), ys = nodes.map(p => p[1]);
  const footprint = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  let areaSum = 0;
  for (let i = 0; i < nodes.length && triangles.length < limits.faces; i++) {
    check(signal);
    for (const j of adjacency[i]) for (const k of adjacency[j]) {
      if (triangles.length >= limits.faces || j <= i || k <= j || !adjacency[i].includes(k)) continue;
      const p = samples[i], q = samples[j], r = samples[k], density = (p.density + q.density + r.density) / 3;
      const coherence = (p.coherence + q.coherence + r.coherence) / 3;
      const direction = Math.abs(Math.cos(p.tangent - q.tangent)) * Math.abs(Math.cos(p.tangent - r.tangent));
      if (density < .18 || density > .9 || coherence < .22 || direction < .4) continue;
      const a = nodes[i], b = nodes[j], c = nodes[k], ab = b.map((v, d) => v - a[d]), ac = c.map((v, d) => v - a[d]);
      const area = Math.hypot(ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]) / 2;
      const longest = Math.max(Math.hypot(...ab), Math.hypot(...ac), Math.hypot(...b.map((v,d)=>v-c[d])));
      if (area < .0003 || area > .008 || area / longest ** 2 < .12 || areaSum + area > footprint * DENSITY_FIELD.faceAreaRatio) continue;
      triangles.push([i,j,k]); faceWeights.push(coherence * direction); areaSum += area;
      if (triangles.length >= limits.faces) break;
    }
    if (i % 128 === 127) { await yieldTask(); check(signal); }
  }
  progress('TOPOLOGY READY', .99);
  return { nodes, links, adjacency, triangles, boundary: links.map(() => true), linkWeights, faceWeights, incident,
    primary, referenceTopology:reference,
    step: totalLength / Math.max(1, links.length), stats: { nodes: nodes.length, lines: links.length, faces: triangles.length,
      referenceVertices:reference?.vertices.length??0,referenceEdges:reference?.edges.length??0,referenceFaces:reference?.faces.length??0,
      isolated: adjacency.filter(a => !a.length).length, areaRatio: areaSum / Math.max(1e-8, footprint), candidateChecks: checked } };
}

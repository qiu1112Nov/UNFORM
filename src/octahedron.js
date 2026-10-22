import { clamp } from './geometry.js';

export const VERTICES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const FACES = [];
for (const x of [0, 1]) for (const y of [2, 3]) for (const z of [4, 5]) FACES.push([x, y, z]);
export const EDGES = [];
for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
  if (Math.floor(a / 2) !== Math.floor(b / 2)) EDGES.push([a, b]);
}

const random = (index, salt) => {
  let n = Math.imul(index + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

// Equal-area faces and cube-root radial sampling yield uniform volume samples.
export function octahedronParticle(index, count) {
  const edgeCount = Math.round(count * 0.35);
  const surfaceCount = Math.round(count * 0.45);
  if (index < edgeCount) {
    const edge = EDGES[index % EDGES.length];
    const t = (Math.floor(index / 12) + 0.5) / Math.ceil(edgeCount / 12);
    return { kind: 'edge', point: VERTICES[edge[0]].map((v, axis) => v * (1 - t) + VERTICES[edge[1]][axis] * t) };
  }
  const face = FACES[(index - edgeCount) % 8];
  const root = Math.sqrt(random(index, 0));
  const weights = [1 - root, root * (1 - random(index, 1)), root * random(index, 1)];
  const interior = index >= edgeCount + surfaceCount;
  const radius = interior ? Math.cbrt(random(index, 2)) * 0.98 : 1;
  return { kind: interior ? 'interior' : 'surface', point: [0, 1, 2].map(axis => weights.reduce((sum, w, j) => sum + w * VERTICES[face[j]][axis], 0) * radius) };
}

// Shared nodes along face boundaries allow a wave to cross all eight faces.
export function buildSurfaceMesh(divisions = 6) {
  const nodes = [], links = [], triangles = [], map = new Map(), seenLinks = new Set();
  const node = point => {
    const key = point.map(v => Math.round(v * divisions)).join(',');
    if (!map.has(key)) { map.set(key, nodes.length); nodes.push(point); }
    return map.get(key);
  };
  const triangle = indices => {
    triangles.push(indices);
    for (let i = 0; i < 3; i++) {
      const a = Math.min(indices[i], indices[(i + 1) % 3]);
      const b = Math.max(indices[i], indices[(i + 1) % 3]);
      const key = `${a},${b}`;
      if (!seenLinks.has(key)) { links.push([a, b]); seenLinks.add(key); }
    }
  };
  for (const face of FACES) {
    const rows = [];
    for (let i = 0; i <= divisions; i++) {
      rows[i] = [];
      for (let j = 0; j <= divisions - i; j++) {
        const weights = [i / divisions, j / divisions, 1 - (i + j) / divisions];
        rows[i][j] = node([0, 1, 2].map(axis => weights.reduce((sum, w, k) => sum + w * VERTICES[face[k]][axis], 0)));
      }
    }
    for (let i = 0; i < divisions; i++) for (let j = 0; j < divisions - i; j++) {
      triangle([rows[i][j], rows[i + 1][j], rows[i][j + 1]]);
      if (j < divisions - i - 1) triangle([rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]]);
    }
  }
  const adjacency = nodes.map(() => []);
  for (const [a, b] of links) { adjacency[a].push(b); adjacency[b].push(a); }
  const boundary = links.map(([a, b]) => nodes[a].some((v, axis) => Math.abs(v) < 1e-8 && Math.abs(nodes[b][axis]) < 1e-8));
  return { nodes, links, triangles, adjacency, boundary, step: Math.SQRT2 / divisions };
}

export function nearestThread(point, mesh) {
  let best = { link: 0, point: mesh.nodes[0], distance: Infinity };
  mesh.links.forEach(([ia, ib], link) => {
    const a = mesh.nodes[ia], b = mesh.nodes[ib];
    const delta = b.map((v, axis) => v - a[axis]);
    const t = clamp(point.reduce((sum, v, axis) => sum + (v - a[axis]) * delta[axis], 0) / delta.reduce((sum, v) => sum + v * v, 0));
    const target = a.map((v, axis) => v + delta[axis] * t);
    const distance = target.reduce((sum, v, axis) => sum + (v - point[axis]) ** 2, 0);
    if (distance < best.distance) best = { link, point: target, distance };
  });
  return best;
}

export function segmentDistance(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
}

export class WeaveNetwork {
  constructor(mesh) {
    this.mesh = mesh;
    this.charge = new Float32Array(mesh.nodes.length);
    this.damage = new Float32Array(mesh.nodes.length);
    this.sources = new Map();
  }

  begin(id, index) {
    if (this.sources.size >= 2 && !this.sources.has(id)) return;
    // Every mesh edge has the same length: breadth-first traversal is geodesic.
    const distances = new Float32Array(this.mesh.nodes.length).fill(Infinity);
    distances[index] = 0;
    const queue = [index];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const a = queue[cursor];
      for (const b of this.mesh.adjacency[a]) if (!Number.isFinite(distances[b])) {
        distances[b] = distances[a] + this.mesh.step; queue.push(b);
      }
    }
    this.sources.set(id, { distances, age: 0, released: false });
    this.charge[index] = Math.max(this.charge[index], 0.22);
  }

  release(id) { const source = this.sources.get(id); if (source) source.released = true; }
  cancel(id) { this.sources.delete(id); }
  clear() { this.charge.fill(0); this.damage.fill(0); this.sources.clear(); }

  update(dt, damageRecovery = 1.8) {
    for (const [id, source] of this.sources) {
      source.age += dt;
      if (source.released && source.age > 0.85) this.sources.delete(id);
    }
    for (let i = 0; i < this.charge.length; i++) {
      this.damage[i] *= Math.exp(-dt * damageRecovery);
      let target = 0;
      for (const source of this.sources.values()) {
        const arrival = source.age - source.distances[i] / 0.65;
        target = Math.max(target, clamp(arrival / 0.75));
      }
      target *= 1 - this.damage[i];
      const rate = target > this.charge[i] ? 5 : 0.075;
      this.charge[i] += (target - this.charge[i]) * (1 - Math.exp(-dt * rate));
    }
  }

  breakNodes(indices, amount = 1) {
    for (const i of indices) {
      this.charge[i] *= 1 - clamp(amount);
      this.damage[i] = Math.max(this.damage[i], clamp(amount));
    }
  }

  strength(link) {
    const [a, b] = this.mesh.links[link];
    return Math.min(this.charge[a], this.charge[b]) * (1 - Math.max(this.damage[a], this.damage[b]));
  }
}

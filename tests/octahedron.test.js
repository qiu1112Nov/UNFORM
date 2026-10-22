import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurfaceMesh, EDGES, FACES, nearestThread, octahedronParticle, segmentDistance, VERTICES, WeaveNetwork } from '../src/octahedron.js';

test('regular octahedron has 6 vertices, 12 equal edges and 8 equilateral faces', () => {
  assert.equal(VERTICES.length, 6); assert.equal(EDGES.length, 12); assert.equal(FACES.length, 8);
  for (const [a, b] of EDGES) assert.ok(Math.abs(Math.hypot(...VERTICES[a].map((v, i) => v - VERTICES[b][i])) - Math.SQRT2) < 1e-10);
  for (const face of FACES) assert.equal(new Set(face.map(i => Math.floor(i / 2))).size, 3);
});

test('mobile and desktop budgets follow 35/45/20 distribution and geometric constraints', () => {
  for (const count of [850, 1900]) {
    const totals = { edge: 0, surface: 0, interior: 0 };
    for (let i = 0; i < count; i++) {
      const { kind, point } = octahedronParticle(i, count); totals[kind]++;
      const norm = point.reduce((sum, v) => sum + Math.abs(v), 0);
      assert.ok(point.every(Number.isFinite));
      if (kind === 'interior') assert.ok(norm < 1);
      else assert.ok(Math.abs(norm - 1) < 1e-10);
      if (kind === 'edge') assert.equal(point.filter(v => Math.abs(v) < 1e-10).length, 1);
    }
    assert.equal(totals.edge, Math.round(count * 0.35));
    assert.equal(totals.surface, Math.round(count * 0.45));
    assert.equal(totals.interior, count - totals.edge - totals.surface);
  }
});

test('surface graph is closed, connected and bounded, with shared face seams', () => {
  for (const n of [6, 8]) {
    const mesh = buildSurfaceMesh(n);
    assert.equal(mesh.nodes.length, 4 * n * n + 2);
    assert.equal(mesh.triangles.length, 8 * n * n);
    assert.equal(mesh.nodes.length - mesh.links.length + mesh.triangles.length, 2);
    for (const [a, b] of mesh.links) assert.ok(Math.abs(Math.hypot(...mesh.nodes[a].map((v, i) => v - mesh.nodes[b][i])) - mesh.step) < 1e-10);
    const visited = new Set([0]), queue = [0];
    for (let i = 0; i < queue.length; i++) for (const next of mesh.adjacency[queue[i]]) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    assert.equal(visited.size, mesh.nodes.length);
    assert.equal(mesh.boundary.filter(Boolean).length, 12 * n);
  }
});

const advance = (network, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) network.update(1 / 60); };

test('weaving starts locally, progresses from dashes to stable lines and reaches other faces', () => {
  const mesh = buildSurfaceMesh(6), network = new WeaveNetwork(mesh);
  network.begin(1, 0); advance(network, 0.65);
  const near = mesh.adjacency[0][0];
  assert.ok(network.charge[0] > network.charge[near]);
  assert.ok(network.charge.some(value => value === 0), 'distant nodes have not been reached');
  const edge = mesh.links.findIndex(([a, b]) => a === 0 && b === near || a === near && b === 0);
  assert.ok(network.strength(edge) > 0.025 && network.strength(edge) < 0.7, 'initial thread is dashed');
  advance(network, 6);
  assert.ok(network.strength(edge) > 0.88, 'a sustained hold produces solid, stable connections');
  assert.ok([...network.charge].every(value => value > 0.88), 'wave crosses shared face seams');
});

test('tearing breaks local links, preserves distant links and can be woven again', () => {
  const mesh = buildSurfaceMesh(6), network = new WeaveNetwork(mesh);
  network.begin(1, 0); advance(network, 7); network.cancel(1);
  const [a, b] = mesh.links[0];
  const distant = mesh.links.findIndex(([x, y]) => ![a, b].includes(x) && ![a, b].includes(y));
  network.breakNodes([a, b]);
  assert.equal(network.strength(0), 0);
  assert.ok(network.strength(distant) > 0.88);
  advance(network, 3);
  assert.ok(network.damage[a] < 0.01);
  network.begin(2, a); advance(network, 3);
  assert.ok(network.strength(0) > 0.88);
});

test('tap wave completes, cancel and reset clear sources; touch sources are capped', () => {
  const network = new WeaveNetwork(buildSurfaceMesh());
  network.begin(1, 0); network.release(1); advance(network, 1);
  assert.equal(network.sources.size, 0);
  assert.ok(network.charge.some(v => v > 0), 'tap leaves a local woven trace');
  network.begin(1, 0); network.begin(2, 1); network.begin(3, 2);
  assert.equal(network.sources.size, 2);
  network.cancel(1); assert.equal(network.sources.size, 1);
  network.clear(); assert.equal(network.sources.size, 0);
  assert.ok(network.charge.every(v => v === 0));
});

test('particle weaving targets lie on the triangular surface network', () => {
  const mesh = buildSurfaceMesh();
  for (let i = 0; i < 100; i++) {
    const original = octahedronParticle(i + 350, 1000).point;
    const target = nearestThread(original, mesh);
    assert.ok(target.distance >= 0 && target.distance < 0.03);
    assert.ok(Math.abs(target.point.reduce((sum, v) => sum + Math.abs(v), 0) - 1) < 1e-10);
  }
});

test('swipe distance handles segments and stationary touches without NaN', () => {
  assert.equal(segmentDistance(5, 3, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
  assert.equal(segmentDistance(3, 4, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
});

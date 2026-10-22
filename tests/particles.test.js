import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleField } from '../src/particles.js';
import { GestureResponse } from '../src/gesture-pipeline.js';

function createField(t, { width = 390, context: providedContext } = {}) {
  // Exercise the real simulation without requiring a GPU or granting camera access.
  const globals = {
    window: { innerWidth: width, innerHeight: 844, addEventListener() {} },
    navigator: { hardwareConcurrency: 8 },
    document: { querySelector: selector => ({ getBoundingClientRect: () => selector === '.intro' ? { bottom: 196 } : { top: 620 } }), addEventListener() {} },
    matchMedia: query => ({ matches: query.includes('max-width') && width <= 800 }),
    devicePixelRatio: 3,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  const context = providedContext ?? new Proxy({}, { get: () => () => {} });
  return new ParticleField({ getContext: () => context });
}

const visiblePoints = field => Array.from(field.budget.indices.subarray(0, field.budget.length), index => field.points[index]);

test('a fast swipe after a stationary hold tears locally and particles recover', t => {
  const field = createField(t);
  assert.equal(field.count, 595); assert.equal(field.dpr, 1.5);
  assert.equal(field.centerX, 195);
  const start = { ...field.nodeScreens[20] };
  field.pointerDown(1, start.x, start.y, 0);
  for (let i = 0; i < 200; i++) field.update(1 / 60);
  assert.ok(field.weave.charge.some(v => v > 0.88));
  // The first movement arrives more than three seconds after pointerdown.
  // Dwell time must not dilute this movement's swipe velocity.
  field.pointerMove(1, start.x + 90, start.y, 3400);
  assert.ok(field.weave.damage.some(v => Math.abs(v - 0.55) < 1e-6));
  assert.ok(field.weave.damage.some(v => v === 0), 'distant structure is intact');
  assert.ok(field.points.some(p => p.scatter > 0.1));
  field.pointerUp(1);
  for (let i = 0; i < 200; i++) field.update(1 / 60);
  assert.ok(field.points.every(p => p.scatter < 0.01));
  assert.ok(field.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.equal(field.pointers.size, 0);
  field.setForm('lines'); field.update(1);
  assert.ok(field.points.some((p, i) => Math.abs(p.target[0] - p.home[0]) > 0.1));
  field.reset();
  assert.equal(field.form, 'octahedron'); assert.equal(field.dispersion, 0.55);
  assert.equal(field.inertia, 0.65);
  assert.ok(field.weave.charge.every(v => v === 0));
});

test('FLOW STATE deconstructs vertices first and rebuilds the interior before edges and vertices', t => {
  const field = createField(t);
  assert.equal(field.dispersion, 0.55);
  assert.ok(field.points.every(p => p.deformation.value === 0), 'idle strength does not explode the sculpture');
  field.hand = { x: 0.5, y: 0.5, openness: 1 };
  for (let i = 0; i < 180; i++) field.update(1 / 60);
  assert.ok(visiblePoints(field).every(p => p.deformation.value > 0.99));
  field.dispersion = 0; field.projectAll();
  const baseline = field.points.map(p => ({ x: p.x, y: p.y }));
  const displacement = () => field.points.reduce((sum, p, i) => sum + Math.hypot(p.x - baseline[i].x, p.y - baseline[i].y), 0);
  field.dispersion = 0.55; field.projectAll();
  const medium = displacement();
  field.dispersion = 0.85; field.projectAll();
  assert.ok(medium > 0 && displacement() > medium, 'strength actually controls spread and retained geometry');
  field.dispersion = 0.55;
  const vertex = visiblePoints(field).find(p => p.layer === 0);
  const surface = visiblePoints(field).find(p => p.layer === 1);
  const interior = visiblePoints(field).find(p => p.layer === 2);
  field.hand.openness = 0;
  for (let i = 0; i < 12; i++) field.update(1 / 60);
  assert.ok(interior.deformation.value < surface.deformation.value);
  assert.ok(surface.deformation.value < vertex.deformation.value);
  const before = surface.deformation.value;
  field.hand.openness = 1; field.update(1 / 120);
  assert.ok(Math.abs(surface.deformation.value - before) < 0.08, 'interrupting recovery does not jump or reset velocity');
  for (let i = 0; i < 180; i++) field.update(1 / 60);
  assert.ok(surface.deformation.value > 0.99, 'new gesture interrupts and reverses recovery');
  field.hand = null;
  for (let i = 0; i < 240; i++) field.update(1 / 60);
  assert.ok(field.points.every(p => Math.abs(p.deformation.value) < 0.001));
});

test('pre-response reaches particle projection before confirmation without changing inertia', t => {
  const field = createField(t), controller = new GestureResponse();
  const before = field.points.map(p => ({ x: p.x, y: p.y }));
  const hand = controller.update({ x: 0.5, y: 0.5, openness: 1 }, 0);
  field.setHand({ ...hand, dispatchedAt: 0 });
  field.update(1 / 60); field.update(1 / 60);
  assert.equal(controller.confirmed, null);
  const displacement = Math.max(...field.points.map((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y)));
  assert.ok(displacement > 0.5 && displacement < field.scale * 0.1);
  const continuous = field.points[400].x;
  field.setHand({ ...controller.update({ x: 0.5, y: 0.5, openness: 1 }, 80), dispatchedAt: 80 });
  assert.equal(field.points[400].x, continuous, 'confirming input does not jump particle coordinates');
  field.update(1 / 60);
  assert.ok(Math.abs(field.points[400].x - continuous) < field.scale * 0.05);
  assert.equal(field.dispersion, 0.55); assert.equal(field.inertia, 0.65);
});

test('reverse pre-response retargets live motion rather than an unreached confirmed endpoint', t => {
  const field = createField(t), controller = new GestureResponse();
  const opened = { x: 0.5, y: 0.5, openness: 1 };
  controller.update(opened, 0);
  field.setHand({ ...controller.update(opened, 80), dispatchedAt: 80 });
  field.update(1 / 60);
  assert.ok(field.activation.value < 0.14, 'formal opening has only just started');
  const closing = controller.update({ ...opened, openness: 0 }, 90);
  field.setHand({ ...closing, dispatchedAt: 90 });
  assert.equal(closing.activation, 0.86, 'controller retains its confirmed endpoint');
  assert.equal(field.previewTarget, 0, 'renderer starts gathering from its actual current state');
});

test('fast hand input creates only budgeted local 3D traces which expire after stillness', t => {
  const field = createField(t);
  assert.equal(field.points.filter(p => p.flow).length, 102);
  assert.equal(field.points.filter(p => p.traceSlot >= 0).length, 15);
  const storage = field.trace.positions;
  const captured = new Float32Array(3), projected = { x: 0, y: 0 };
  let checkedScenePoses = 0;
  let x = 0.5;
  for (let i = 0; i < 30; i++) {
    const now = i * 1000 / 30;
    x = 0.5 + Math.sin(i * 0.45) * 0.3;
    field.setHand({ x, y: 0.5, openness: 0, activation: 0, feedback: 0, dispatchedAt: now });
    field.time += 1 / 30; field.update(1 / 30, now);
    for (let slot = 0; slot < field.trace.capacity; slot++) {
      const index = slot * field.trace.samples + field.trace.heads[slot];
      if (Math.abs(field.trace.times[index] - field.time) > 1e-6) continue;
      for (let axis = 0; axis < 3; axis++) captured[axis] = field.trace.positions[index * 3 + axis];
      field.projectTracePoint(captured, projected);
      const p = field.points[field.trace.owners[slot]];
      assert.ok(Math.hypot(projected.x - p.x, projected.y - p.y) < 0.001, 'history includes the current scene translation and perspective');
      checkedScenePoses++;
    }
  }
  assert.ok(field.trace.times.some(Number.isFinite), 'projected hand path captured local model-space history');
  assert.ok(checkedScenePoses > 0);
  assert.ok(field.points.every(p => p.traceSlot >= 0 || p.traceWeight === 0));
  assert.equal(field.trace.positions, storage);
  for (let i = 30; i < 60; i++) {
    const now = i * 1000 / 30;
    field.setHand({ x, y: 0.5, openness: 0, activation: 0, feedback: 0, dispatchedAt: now });
    field.time += 1 / 30; field.update(1 / 30, now);
  }
  assert.equal(field.trace.emitting, false);
  assert.ok(field.trace.times.every((_, index) => field.trace.opacity(index, field.time) === 0));
  field.setForm('lines');
  assert.ok(field.trace.times.every(time => time === -Infinity));
});

test('mobile weave batches preserve geometry with at most 12 stroke submissions', t => {
  let strokes = 0;
  const context = new Proxy({}, { get: (_, name) => name === 'stroke' ? () => { strokes++; } : () => {} });
  const field = createField(t, { context });
  field.weave.charge.fill(1); strokes = 0;
  field.drawWeave();
  assert.ok(strokes > 0 && strokes <= 12);
  assert.equal(field.trace.samples, 4);
  const oldPool = field.points, oldIndices = field.budget.indices;
  field.setParticleCount(425); field.update(0.1);
  assert.ok(field.budget.length > 425);
  field.update(0.5);
  assert.equal(field.budget.length, 425);
  field.setParticleCount(850); field.update(0.5);
  assert.equal(field.points, oldPool); assert.equal(field.budget.indices, oldIndices);
  assert.ok(visiblePoints(field).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('DPR and backing canvas resize correctly across phone orientations', t => {
  const field = createField(t);
  assert.equal(field.canvas.width, 585); assert.equal(field.canvas.height, 1266);
  window.innerWidth = 844; window.innerHeight = 390;
  field.resize();
  assert.equal(field.dpr, 1.5);
  assert.equal(field.canvas.width, 1266); assert.equal(field.canvas.height, 585);
});

test('desktop keeps 1900 particles, 12 trace samples and full per-link weave rendering', t => {
  let strokes = 0;
  const context = new Proxy({}, { get: (_, name) => name === 'stroke' ? () => { strokes++; } : () => {} });
  const field = createField(t, { width: 1440, context });
  assert.equal(field.count, 1900); assert.equal(field.dpr, 2); assert.equal(field.trace.samples, 12);
  field.weave.charge.fill(1); strokes = 0; field.drawWeave();
  assert.equal(strokes, field.mesh.links.length);
});

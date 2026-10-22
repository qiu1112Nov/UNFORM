import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleField } from '../src/particles.js';

function createField(t) {
  // Exercise the real simulation without requiring a GPU or granting camera access.
  const globals = {
    window: { innerWidth: 390, innerHeight: 844, addEventListener() {} },
    document: { querySelector: selector => ({ getBoundingClientRect: () => selector === '.intro' ? { bottom: 196 } : { top: 620 } }), addEventListener() {} },
    matchMedia: query => ({ matches: query.includes('max-width') }),
    devicePixelRatio: 3,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  const context = new Proxy({}, { get: () => () => {} });
  return new ParticleField({ getContext: () => context });
}

test('a fast swipe after a stationary hold tears locally and particles recover', t => {
  const field = createField(t);
  assert.equal(field.count, 850); assert.equal(field.dpr, 1.5);
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

test('continuous open palm deconstructs; a fist rebuilds edges, faces, then interior', t => {
  const field = createField(t);
  assert.equal(field.dispersion, 0.55);
  assert.ok(field.points.every(p => p.deformation.value === 0), 'idle strength does not explode the sculpture');
  field.hand = { x: 0.5, y: 0.5, openness: 1 };
  for (let i = 0; i < 180; i++) field.update(1 / 60);
  assert.ok(field.points.every(p => p.deformation.value > 0.99));
  field.dispersion = 0; field.projectAll();
  const baseline = field.points.map(p => ({ x: p.x, y: p.y }));
  const displacement = () => field.points.reduce((sum, p, i) => sum + Math.hypot(p.x - baseline[i].x, p.y - baseline[i].y), 0);
  field.dispersion = 0.55; field.projectAll();
  const medium = displacement();
  field.dispersion = 0.85; field.projectAll();
  assert.ok(medium > 0 && displacement() > medium, 'strength actually controls spread and retained geometry');
  field.dispersion = 0.55;
  const edge = field.points.find(p => p.kind === 'edge');
  const surface = field.points.find(p => p.kind === 'surface');
  const interior = field.points.find(p => p.kind === 'interior');
  field.hand.openness = 0;
  for (let i = 0; i < 12; i++) field.update(1 / 60);
  assert.ok(edge.deformation.value < surface.deformation.value);
  assert.ok(surface.deformation.value < interior.deformation.value);
  const before = surface.deformation.value;
  field.hand.openness = 1; field.update(1 / 120);
  assert.ok(Math.abs(surface.deformation.value - before) < 0.08, 'interrupting recovery does not jump or reset velocity');
  for (let i = 0; i < 180; i++) field.update(1 / 60);
  assert.ok(surface.deformation.value > 0.99, 'new gesture interrupts and reverses recovery');
  field.hand = null;
  for (let i = 0; i < 240; i++) field.update(1 / 60);
  assert.ok(field.points.every(p => Math.abs(p.deformation.value) < 0.001));
});

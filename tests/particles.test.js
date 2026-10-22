import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleField } from '../src/particles.js';

test('a fast swipe after a stationary hold tears locally and particles recover', t => {
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
  const field = new ParticleField({ getContext: () => context });
  assert.equal(field.count, 850); assert.equal(field.dpr, 1.5);
  assert.equal(field.centerX, 195);
  const start = { ...field.nodeScreens[20] };
  field.pointerDown(1, start.x, start.y, 0);
  for (let i = 0; i < 200; i++) field.update(1 / 60);
  assert.ok(field.weave.charge.some(v => v > 0.88));
  // The first movement arrives more than three seconds after pointerdown.
  // Dwell time must not dilute this movement's swipe velocity.
  field.pointerMove(1, start.x + 90, start.y, 3400);
  assert.ok(field.weave.damage.some(v => v === 1));
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
  assert.equal(field.form, 'octahedron'); assert.equal(field.dispersion, 0.06);
  assert.ok(field.weave.charge.every(v => v === 0));
});

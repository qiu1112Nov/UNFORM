import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleField } from '../src/particles.js';
import { GestureResponse } from '../src/gesture-pipeline.js';
import { FragmentLayers } from '../src/flow-state.js';

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

function slowSculpt(field, { hold = 3.2 } = {}) {
  const start = visiblePoints(field).find(p => p.kind === 'surface');
  field.pointerDown(91, start.x, start.y, 0);
  assert.ok(field.memory.sessions.has(91));
  for (let i = 1; i <= 5; i++) field.pointerMove(91, start.x + i * 5, start.y + i, i * 100);
  for (let i = 0; i < Math.round(hold * 60); i++) field.update(1 / 60, 600 + i * 1000 / 60);
  return field.memory.sessions.get(91);
}

test('slow mobile drag holds for 3s, commits without moving events and survives touch release', t => {
  const field = createField(t), original = field.points.map(p => [...p.home]);
  const session = slowSculpt(field);
  assert.equal(field.memory.commits.length, 1);
  const saved = JSON.stringify(field.memory.commits);
  field.pointerUp(91); field.weave.clear();
  for (let i = 0; i < 400; i++) field.update(1 / 60, 4000 + i * 1000 / 60);
  assert.equal(JSON.stringify(field.memory.commits), saved);
  const result = field.memory.deform(session.anchor, new Float64Array(3));
  assert.ok(Math.hypot(...result.map((v, a) => v - session.anchor[a])) > 0.04);
  assert.deepEqual(field.points.map(p => p.home), original);
  assert.ok(field.points.every(p => p.target.every((v, a) => v === p.home[a])));
});

test('mobile pointercancel/lost capture cannot submit a pending imprint; completed memory survives cancel', t => {
  const field = createField(t); slowSculpt(field, { hold: 2.8 });
  field.pointerUp(91, true);
  for (let i = 0; i < 240; i++) field.update(1 / 60, 4000 + i * 1000 / 60);
  assert.equal(field.memory.commits.length, 0);
  slowSculpt(field); field.pointerUp(91, true);
  assert.equal(field.memory.commits.length, 1);
});

test('VIEW neither commits pending dwell nor modifies completed memory; new SCULPT drag is required', t => {
  const field = createField(t); slowSculpt(field, { hold: 2.8 }); field.setMode('VIEW', 3500);
  for (let i = 0; i < 50; i++) field.update(0.1, 3600 + i * 100);
  assert.equal(field.memory.commits.length, 0);
  field.setMode('SCULPT', 9000); field.pointerMove(91, 250, 400, 9100);
  field.update(0.1, 9200); assert.equal(field.memory.commits.length, 0);
  // Start a fresh stroke with timestamps after the boundary.
  field.inputStartedAt = -Infinity; slowSculpt(field); field.pointerUp(91);
  const memory = JSON.stringify(field.memory.commits); field.setMode('VIEW', 10000);
  assert.equal(field.undoImprint(), false); assert.equal(field.reset(), false);
  field.pointerDown(8, 100, 300, 10001); field.pointerMove(8, 200, 330, 10030);
  for (let i = 0; i < 50; i++) field.update(0.1, 11000 + i * 100);
  assert.equal(JSON.stringify(field.memory.commits), memory);
});

test('Undo and Restore clear the correct memory and cancel pending touch input', t => {
  const field = createField(t); slowSculpt(field); field.pointerUp(91);
  const first = JSON.stringify(field.memory.commits); slowSculpt(field); field.pointerUp(91);
  assert.equal(field.memory.commits.length, 2);
  assert.equal(field.undoImprint(), true); assert.equal(JSON.stringify(field.memory.commits), first);
  slowSculpt(field, { hold: 2 }); field.reset();
  assert.equal(field.memory.commits.length, 0); assert.equal(field.memory.sessions.size, 0);
  assert.equal(field.pointers.size, 0); assert.equal(field.undoImprint(), false);
});

test('FLOW particles and woven skeleton project through the same bounded material field', t => {
  const field = createField(t); slowSculpt(field); field.pointerUp(91); field.weave.clear();
  for (let i = 0; i < 240; i++) field.update(1 / 60, 5000 + i * 1000 / 60);
  const scratch = new Float64Array(3), screen = {};
  let affectedFlow = false;
  for (const p of visiblePoints(field)) {
    const material = field.memory.deform(p.position, scratch);
    if (p.flow && Math.hypot(...material.map((v, a) => v - p.position[a])) > 0.005) affectedFlow = true;
    const drift = p.kind === 'interior' ? 0.009 : 0.001;
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(p.world[a] - (material[a] + p.driftSin[a] * drift)) < 1e-5);
  }
  assert.ok(affectedFlow, 'edge flow is carried by the remembered surface');
  field.mesh.nodes.forEach((p, i) => {
    field.project(field.memory.deform(p, scratch), screen);
    assert.ok(Math.hypot(screen.x - field.nodeScreens[i].x, screen.y - field.nodeScreens[i].y) < 1e-8);
  });
});

test('ORIGIN suspension preserves imprints and pose, blocks old touch/hand input, and resumes the same pool', t => {
  const field = createField(t); slowSculpt(field); field.pointerUp(91);
  const pool = field.points, memory = JSON.stringify(field.memory.commits);
  field.setWorkspaceActive(false, 5000);
  const snapshot = artworkState(field);
  field.pointerDown(2, 180, 400, 5100); field.pointerMove(2, 250, 410, 5200);
  assert.equal(field.setHand({ tracked: true, sampledAt: 5300, activation: 1 }), false);
  for (let i = 0; i < 60; i++) field.animate(6000 + i * 16);
  field.resize(); assert.equal(artworkState(field), snapshot);
  assert.equal(field.pointers.size, 0); assert.equal(field.memory.commits.length, 1);
  field.setWorkspaceActive(true, 10000);
  field.pointerDown(2, 180, 400, 9000);
  assert.equal(field.setHand({ tracked: true, sampledAt: 9999, activation: 1 }), false);
  field.update(0.1, 10010); assert.equal(artworkState(field), snapshot);
  const p = visiblePoints(field)[10]; field.pointerDown(3, p.x, p.y, 10100);
  assert.equal(field.sculptHeld, false); assert.equal(field.pointers.size, 1);
  assert.equal(field.points, pool); assert.equal(JSON.stringify(field.memory.commits), memory);
});

test('unsaved shape detection ignores idle rotation and VIEW, includes imprints and form edits', t => {
  const field = createField(t); assert.equal(field.hasUnsavedShape(), false);
  field.update(0.1); assert.equal(field.hasUnsavedShape(), false);
  field.setMode('VIEW', 0); field.pointerDown(1, 100, 200, 10); field.pointerMove(1, 200, 220, 20);
  assert.equal(field.hasUnsavedShape(), false);
  field.setMode('SCULPT', 30); field.inputStartedAt = -Infinity; slowSculpt(field);
  assert.equal(field.hasUnsavedShape(), true); field.reset();
  assert.equal(field.hasUnsavedShape(), false);
  field.setForm('grid'); assert.equal(field.hasUnsavedShape(), true);
});

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
  field.update(1 / 60, 16); field.update(1 / 60, 33);
  assert.equal(controller.confirmed, null);
  const displacement = Math.max(...field.points.map((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y)));
  assert.ok(displacement > 0.5 && displacement < field.scale * 0.1);
  const continuous = field.points[400].x;
  field.setHand({ ...controller.update({ x: 0.5, y: 0.5, openness: 1 }, 80), dispatchedAt: 80 });
  assert.equal(field.points[400].x, continuous, 'confirming input does not jump particle coordinates');
  field.update(1 / 60, 97);
  assert.ok(Math.abs(field.points[400].x - continuous) < field.scale * 0.05);
  assert.equal(field.dispersion, 0.55); assert.equal(field.inertia, 0.65);
});

test('reverse pre-response retargets live motion rather than an unreached confirmed endpoint', t => {
  const field = createField(t), controller = new GestureResponse();
  const opened = { x: 0.5, y: 0.5, openness: 1 };
  controller.update(opened, 0);
  field.setHand({ ...controller.update(opened, 80), dispatchedAt: 80 });
  field.update(1 / 60, 90);
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

for (const fps of [10, 30, 60]) test(`real render loop preserves elapsed-time amplitude at ${fps} FPS`, t => {
  const field = createField(t), expected = new FragmentLayers();
  field.setHand({ x: 0.5, y: 0.5, openness: 1, activation: 1, targetActivation: 1 });
  field.last = 100;
  for (let frame = 1; frame <= fps; frame++) field.animate(100 + frame * 1000 / fps);
  expected.update(1, 1);
  field.fragments.states.forEach((state, i) => assert.ok(Math.abs(state.value - expected.states[i].value) < 1e-9));
  assert.equal(field.targetActivation, 1); assert.equal(field.dispersion, 0.55); assert.equal(field.inertia, 0.65);
});

test('an opposite preview retains the confirmed endpoint while moving the same springs, and stalled input expires', t => {
  const field = createField(t), response = new GestureResponse();
  const palm = { x: 0.5, y: 0.5, openness: 1 };
  response.update(palm, 0); field.setHand(response.update(palm, 80)); field.update(1 / 60, 80);
  field.setHand(response.update({ ...palm, openness: 0 }, 100));
  for (let i = 0; i < 15; i++) field.update(1 / 60, 100 + i * 16);
  assert.equal(field.fragments.goal, 1);
  assert.ok(field.fragments.states[0].value < 0.14, 'explicit opposite intent can immediately gather within the preview range');
  field.update(1 / 60, 451);
  assert.equal(field.hand, null); assert.equal(field.targetActivation, 0);
});

test('a bounded preview moves real layers; changing the brightness hint cannot move geometry', t => {
  const field = createField(t), response = new GestureResponse();
  const before = visiblePoints(field).map(p => [p.x, p.y]);
  field.setHand(response.update({ x: 0.5, y: 0.5, openness: 1 }, 0));
  for (let i = 1; i <= 4; i++) field.update(1 / 60, i * 1000 / 60);
  const displacement = Math.max(...visiblePoints(field).map((p, i) => Math.hypot(p.x - before[i][0], p.y - before[i][1])));
  assert.ok(displacement > 2 && displacement < field.scale * 0.2);
  const projected = visiblePoints(field).map(p => [p.x, p.y]);
  field.quickFeedback.value = 0; field.projectAll();
  assert.deepEqual(visiblePoints(field).map(p => [p.x, p.y]), projected);
  assert.equal(response.confirmed, null); assert.equal(field.fragments.goal, 0);
  assert.ok(field.fragments.states.every(s => s.value > 0.05 && s.value <= 0.14));
});

for (const goal of [1, 0]) test(`projected particle ${goal ? 'opening' : 'gathering'} stays continuous through missing preview frames and confirmation`, t => {
  const field = createField(t), response = new GestureResponse();
  const base = { x: 0.5, y: 0.5, openness: 1 - goal };
  response.update(base, 0); field.setHand(response.update(base, 80)); field.update(3, 80);
  const points = visiblePoints(field), start = points.map(p => [p.x, p.y]);
  const saved = points.map(p => p.deformation.value);
  points.forEach(p => { p.deformation.value = goal; }); field.projectAll();
  const end = points.map(p => [p.x, p.y]);
  points.forEach((p, i) => { p.deformation.value = saved[i]; }); field.projectAll();
  let index = -1, distance = 0;
  points.forEach((p, i) => {
    const d = Math.hypot(end[i][0] - start[i][0], end[i][1] - start[i][1]);
    if (p.layer === (goal ? 2 : 0) && d > distance) { index = i; distance = d; }
  });
  assert.ok(distance > 1);
  const point = points[index], dx = end[index][0] - start[index][0], dy = end[index][1] - start[index][1];
  let previous = 0;
  field.setHand(response.update({ ...base, openness: goal }, 100));
  for (let frame = 1; frame <= 72; frame++) {
    const now = 100 + frame * 1000 / 60;
    if (frame % 6 === 0) {
      const before = [point.x, point.y];
      field.setHand(response.update(frame === 6 ? null : frame === 18 ? { ...base, openness: 0.5 } : { ...base, openness: goal }, now));
      assert.deepEqual([point.x, point.y], before, 'new input never resets projected coordinates');
    }
    // Freeze idle rotation/FLOW time so this measures gesture displacement,
    // rather than mistaking an unrelated orbit for a gesture reversal.
    field.update(1 / 60, now);
    const progress = ((point.x - start[index][0]) * dx + (point.y - start[index][1]) * dy) / (distance * distance);
    assert.ok(progress >= previous - 0.001, `uncommanded return at ${now}ms: ${previous} → ${progress}`);
    previous = progress;
    if (frame === 3) assert.ok(progress > 0.02, 'preview remains visibly responsive');
  }
  assert.ok(previous > 0.99);
});

// Projection coordinates are presentation data. Snapshot the underlying shape,
// simulation and history to prove that observation cannot perform an edit.
const artworkState = field => JSON.stringify({
  time: field.time, form: field.form, dispersion: field.dispersion, inertia: field.inertia,
  points: field.points.map(p => [p.home, p.position, p.target, [...p.world], p.motion, p.deformation, p.scatter, p.scatterMotion, p.flow && [...p.flow.position]]),
  nodes: field.mesh.nodes, charge: [...field.weave.charge], damage: [...field.weave.damage],
  layers: field.fragments, tracePositions: [...field.trace.positions], traceTimes: [...field.trace.times],
  traceWeights: [...field.trace.weights], count: field.count, opacity: [...field.budget.opacity],
});

test('SCULPT is the default; VIEW only changes observation, even with camera and destructive inputs', t => {
  const field = createField(t);
  assert.equal(field.mode, 'SCULPT'); assert.equal(field.sculptHeld, false);
  field.pointerDown(7, field.centerX, field.centerY, 0); field.update(0.3, 300);
  assert.ok(field.weave.sources.size > 0);
  const before = visiblePoints(field).map(p => [p.x, p.y]);
  field.setMode('VIEW', 400);
  assert.deepEqual(visiblePoints(field).map(p => [p.x, p.y]), before, 'switching does not jump the pose');
  assert.equal(field.pointers.size, 0); assert.equal(field.weave.sources.size, 0);
  const snapshot = artworkState(field), pool = field.points;
  field.pointerMove(7, field.centerX + 100, field.centerY, 410); // old captured drag
  assert.equal(field.viewYaw, 0);
  field.pointerDown(10, 100, 100, 420); field.pointerMove(10, 180, 125, 450);
  field.pointerDown(11, 200, 150, 455); field.pointerMove(11, 300, 200, 460);
  field.setHand({ x: 0.8, y: 0.8, activation: 1, openness: 1, sampledAt: 470 });
  field.tear({ x: 0, y: 0 }, { x: 400, y: 400 });
  assert.equal(field.setForm('grid'), false); assert.equal(field.setDispersion(1), false); assert.equal(field.reset(), false);
  for (let frame = 0; frame < 60; frame++) field.animate(500 + frame * 1000 / 60);
  assert.ok(field.viewYaw !== 0 && field.viewPitch !== 0);
  assert.ok(visiblePoints(field).some((p, i) => Math.hypot(p.x - before[i][0], p.y - before[i][1]) > 5));
  assert.equal(artworkState(field), snapshot); assert.equal(field.points, pool);
  assert.equal(field.hand, null); assert.equal(field.pointers.size, 0);
});

test('mode changes discard old drags and hold the pose until a new SCULPT press', t => {
  const field = createField(t);
  field.pointerDown(1, 160, 300, 0); field.setMode('VIEW', 100);
  field.pointerDown(2, 160, 300, 120); field.pointerMove(2, 220, 310, 150);
  const angle = field.viewYaw;
  field.setMode('SCULPT', 200);
  const snapshot = artworkState(field);
  field.pointerMove(1, 300, 400, 210); field.pointerMove(2, 320, 410, 220); field.pointerUp(2);
  field.pointerDown(3, 160, 300, 180); // queued before mode boundary
  field.setHand(null);
  for (let i = 0; i < 20; i++) field.animate(230 + i * 16);
  assert.equal(field.sculptHeld, true); assert.equal(field.focus, null);
  assert.equal(field.viewPointers.size, 0); assert.equal(field.pointers.size, 0);
  assert.equal(artworkState(field), snapshot); assert.equal(field.viewYaw, angle);
  field.pointerDown(3, field.centerX, field.centerY, 600);
  assert.equal(field.sculptHeld, false); assert.equal(field.pointers.size, 1);
  assert.equal(field.weave.sources.size, 1);
  field.pointerUp(3); assert.equal(field.pointers.size, 0);
});

test('returning to SCULPT rejects cached/old hand packets and requires a new tracked sample', t => {
  const field = createField(t);
  const packet = { x: 0.5, y: 0.5, activation: 1, targetActivation: 1, openness: 1, tracked: true, sampledAt: 90 };
  field.setHand(packet); field.update(0.1, 100);
  field.setMode('VIEW', 120); field.setMode('SCULPT', 200);
  const snapshot = artworkState(field);
  assert.equal(field.setHand(packet), false);
  assert.equal(field.setHand({ ...packet, sampledAt: 210, tracked: false }), false);
  assert.equal(field.setHand({ ...packet, sampledAt: undefined }), false);
  field.update(0.1, 220); assert.equal(artworkState(field), snapshot);
  field.setHand({ ...packet, sampledAt: 230 }); assert.equal(field.sculptHeld, false);
  assert.equal(field.setHand(packet), false, 'old packets remain rejected after rearming');
  field.update(0.1, 240); assert.ok(field.fragments.states[0].value > 0);
  assert.equal(field.setMode('SCULPT', 250), false, 'reselecting current mode does not interrupt live input');
  assert.throws(() => field.setMode('UNKNOWN'), RangeError);
});

test('VIEW drag works while paused, keeps orientation through resize, and cancels cleanly', t => {
  const field = createField(t);
  field.paused = true; field.setMode('VIEW', 0);
  const snapshot = artworkState(field), before = field.points[0].x;
  field.pointerDown(1, 100, 200, 10); field.pointerMove(1, 170, 220, 20);
  assert.notEqual(field.points[0].x, before); assert.equal(artworkState(field), snapshot);
  const angle = field.viewYaw;
  window.innerWidth = 844; window.innerHeight = 390; field.resize();
  assert.equal(field.viewYaw, angle); assert.equal(field.dpr, 1.5);
  field.clearPointers(); field.pointerMove(1, 290, 300, 30);
  assert.equal(field.viewYaw, angle); assert.equal(artworkState(field), snapshot);
});

test('TRACE projects consistently after rotating in VIEW and resuming SCULPT', t => {
  const field = createField(t), projected = { x: 0, y: 0 }, world = new Float32Array(3);
  field.setMode('VIEW', 0); field.pointerDown(1, 50, 200, 1); field.pointerMove(1, 140, 220, 2);
  field.setMode('SCULPT', 10);
  let captures = 0;
  for (let frame = 0; frame < 40; frame++) {
    const now = 20 + frame * 40;
    field.setHand({ x: 0.5 + Math.sin(frame * 0.4) * 0.3, y: 0.5, activation: 0, openness: 0, sampledAt: now });
    field.time += 0.04; field.update(0.04, now);
    for (let slot = 0; slot < field.trace.capacity; slot++) {
      const index = slot * field.trace.samples + field.trace.heads[slot];
      if (Math.abs(field.trace.times[index] - field.time) > 1e-6) continue;
      for (let axis = 0; axis < 3; axis++) world[axis] = field.trace.positions[index * 3 + axis];
      field.projectTracePoint(world, projected);
      const point = field.points[field.trace.owners[slot]];
      assert.ok(Math.hypot(projected.x - point.x, projected.y - point.y) < 0.001);
      captures++;
    }
  }
  assert.ok(captures > 0);
});

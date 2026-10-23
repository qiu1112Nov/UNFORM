import { clamp, formPoint } from './geometry.js';
import { advanceSpring, MOTION, recoveryRate, retained, springCoefficients } from './motion.js';
import { GESTURE_TIMING } from './gesture-pipeline.js';
import { advanceEdgeFlow, createEdgeFlow, FLOW_STATE, fragmentLayer, FragmentLayers, SpatialTrace } from './flow-state.js';
import { buildSurfaceMesh, nearestThread, octahedronParticle, segmentDistance, WeaveNetwork } from './octahedron.js';
import { AdaptiveQuality, MOBILE_PERFORMANCE, ParticleBudget } from './performance.js';
import { IMPRINT, ShapeMemory } from './imprint.js';
import { SCULPT_INPUT, strokeIntent } from './sculpt-input.js';

const GLYPH_OCTA = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const GLYPH_TETRA = [[0,1,0],[-.85,-.5,.5],[.85,-.5,.5],[0,-.5,-1]];
const GLYPH_OCTA_LINKS = [];
for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) if (Math.floor(a / 2) !== Math.floor(b / 2)) GLYPH_OCTA_LINKS.push([a,b]);
const GLYPH_TETRA_LINKS = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];

const ARTWORK_KEYS = [
  'material', 'fragments', 'trace', 'traceWorldA', 'traceWorldB', 'traceCapture', 'traceSourceProjection',
  'traceScreenA', 'traceScreenB', 'mesh', 'weave', 'memory', 'materialPoint', 'sculptOffset',
  'points', 'budget', 'weavePaths', 'weavePathSizes', 'form', 'dispersion', 'inertia',
  'activation', 'impulse', 'quickFeedback', 'pendingGesture', 'lastResponseId', 'previewTarget', 'targetActivation',
  'handYaw', 'handPitch', 'centerMotionX', 'centerMotionY', 'focus', 'hand', 'pointers',
  'workspaceActive', 'mode', 'sculptHeld', 'inputStartedAt', 'viewPointers', 'viewYaw', 'viewPitch',
  'time', 'paused', 'reducedMotion', 'nodeScreens', 'glyphWorld', 'glyphScreens',
];

export class ParticleField {
  static capacity() {
    return matchMedia('(max-width: 800px)').matches || matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 4) <= 4 ? MOBILE_PERFORMANCE.poolCount : 1900;
  }
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas 2D is unavailable.');
    this.poolCount = ParticleField.capacity(); this.mobile = this.poolCount !== 1900;
    this.quality = new AdaptiveQuality(this.mobile);
    this.count = this.quality.count; this.inferenceMs = null;
    this.artworks = new Map(); this.artworkName = 'GEOMETRY'; this.frame = 0; this.last = 0;
    this.initializeArtwork();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(this.frame);
      if (document.hidden) this.clearPointers();
      else { this.last = 0; this.quality.resetTiming(); this.frame = requestAnimationFrame(this.animate); }
    });
  }

  initializeArtwork(material = null) {
    this.material = material;
    this.fragments = new FragmentLayers();
    this.trace = new SpatialTrace(this.poolCount, this.mobile, this.mobile ? MOBILE_PERFORMANCE.traceSamples : undefined);
    this.traceWorldA = new Float32Array(3); this.traceWorldB = new Float32Array(3);
    this.traceCapture = new Float32Array(3);
    this.traceSourceProjection = { x: 0, y: 0, depth: 0 };
    this.traceScreenA = { x: 0, y: 0 }; this.traceScreenB = { x: 0, y: 0 };
    this.mesh = material?.densityField ? material.mesh : buildSurfaceMesh(this.mobile ? 6 : 8);
    if (material && !material.densityField) this.mesh.nodes = this.mesh.nodes.map(point => Array.from(material.map(point)));
    this.weave = new WeaveNetwork(this.mesh);
    this.memory = new ShapeMemory(); this.materialPoint = new Float64Array(3);
    this.sculptOffset = new Float64Array(3);
    this.points = Array.from({ length: this.poolCount }, (_, i) => {
      const sample = material ? material.sample(i, this.poolCount) : octahedronParticle(i, this.poolCount);
      const flow = material?.densityField ? material.createFlow(i) : createEdgeFlow(i, this.poolCount, sample.canonical ?? sample.point);
      if (flow && material) flow.materialPosition = new Float64Array(sample.point);
      return {
        kind: sample.kind, pinned: !!sample.pinned, density: material?.densityField ? sample.density : undefined, glyph: sample.glyph ?? 'point', home: sample.point, position: [...sample.point], target: [...sample.point],
        layer: material?.densityField ? (sample.kind === 'interior' ? 2 : sample.baseVertex || sample.corner > .35 ? 0 : 1) : fragmentLayer(sample.kind, sample.canonical ?? sample.point), flow,
        world: new Float32Array(sample.point), traceSlot: -1, traceWeight: 0,
        motion: sample.point.map(value => ({ value, velocity: 0 })),
        deformation: { value: 0, velocity: 0 },
        scatterMotion: { value: 0, velocity: 0 },
        thread: material?.densityField ? (this.mesh.incident[i] < 0 ? null : { link: this.mesh.incident[i], point: sample.point, distance: 0 }) : sample.kind === 'interior' ? null : nearestThread(sample.point, this.mesh),
        seed: i * 2.399963, radius: 0.5 + ((i * 7919) % 997) / 997 * 0.7,
        driftSin: new Float32Array([0, 1, 2].map(axis => Math.sin(i * 2.399963 + axis * 2.1))),
        driftCos: new Float32Array([0, 1, 2].map(axis => Math.cos(i * 2.399963 + axis * 2.1))),
        scatter: 0, x: 0, y: 0, depth: 0,
      };
    });
    this.budget = new ParticleBudget(this.points, this.count);
    const buckets = MOBILE_PERFORMANCE.weaveOpacityBuckets * 2;
    this.weavePaths = this.mobile ? Array.from({ length: buckets }, () => new Float32Array(this.mesh.links.length * 4)) : null;
    this.weavePathSizes = new Uint16Array(buckets);
    for (let slot = 0; slot < this.trace.capacity; slot++) this.points[this.trace.owners[slot]].traceSlot = slot;
    this.form = 'octahedron'; this.dispersion = MOTION.deconstructionStrength;
    this.inertia = MOTION.motionInertia;
    this.activation = { value: 0, velocity: 0 }; this.impulse = 0;
    this.quickFeedback = { value: 0, velocity: 0 };
    this.pendingGesture = null; this.lastResponseId = null;
    this.previewTarget = 0; this.targetActivation = 0;
    this.handYaw = { value: 0, velocity: 0 }; this.handPitch = { value: 0, velocity: 0 };
    this.centerMotionX = { value: 0, velocity: 0 }; this.centerMotionY = { value: 0, velocity: 0 };
    this.focus = null; this.hand = null; this.pointers = new Map();
    this.workspaceActive = true;
    this.mode = 'SCULPT'; this.sculptHeld = false; this.inputStartedAt = -Infinity;
    this.viewPointers = new Map(); this.viewYaw = 0; this.viewPitch = 0;
    this.time = 0; this.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reducedMotion = this.paused;
    this.nodeScreens = material?.densityField ? this.points : this.mesh.nodes.map(() => ({ x: 0, y: 0, depth: 0 }));
    this.glyphWorld = new Float64Array(3);
    this.glyphScreens = Array.from({ length: 6 }, () => ({ x: 0, y: 0, depth: 0 }));
  }

  switchArtwork(name, material = null) {
    if (!['GEOMETRY', 'FUSION'].includes(name)) throw new RangeError('Unknown artwork');
    if (name === this.artworkName && (!material || material === this.material)) return false;
    this.clearPointers();
    this.artworks.set(this.artworkName, Object.fromEntries(ARTWORK_KEYS.map(key => [key, this[key]])));
    const saved = this.artworks.get(name);
    const fresh = !saved || (material && saved.material !== material);
    if (name === 'FUSION' && fresh && !material) throw new Error('Analyze an image before entering FUSION.');
    if (saved && (!material || saved.material === material)) Object.assign(this, saved);
    else this.initializeArtwork(material);
    this.artworkName = name;
    this.budget.setCount(this.quality.count); this.count = this.quality.count;
    this.workspaceActive = true; this.holdInput(performance.now());
    // New image sculptures enter VIEW; returning sessions keep their chosen mode.
    if (name === 'FUSION' && fresh) this.mode = 'VIEW';
    this.resize(); this.onMemoryChange?.('CLEAR');
    return true;
  }

  resize() {
    if (!this.workspaceActive) return;
    this.width = window.innerWidth; this.height = window.innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, this.mobile || this.width <= 800 ? MOBILE_PERFORMANCE.maxDPR : 2);
    const pixelWidth = Math.round(this.width * this.dpr), pixelHeight = Math.round(this.height * this.dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Read the actual layout, reserving separate title, sculpture and control bands.
    const intro = document.querySelector('.intro')?.getBoundingClientRect();
    const status = document.querySelector('.status-line')?.getBoundingClientRect();
    this.artTop = (intro?.bottom ?? this.height * 0.2) + 12;
    this.artBottom = Math.max(this.artTop + 32, (status?.top ?? this.height * 0.8) - 12);
    this.originX = this.width / 2;
    this.originY = (this.artTop + this.artBottom) / 2;
    this.scale = Math.max(12, Math.min(this.width * 0.37, (this.artBottom - this.artTop) * 0.43));
    this.centerX = this.originX; this.centerY = this.originY;
    this.centerMotionX = { value: this.centerX, velocity: 0 };
    this.centerMotionY = { value: this.centerY, velocity: 0 };
    this.projectAll(); this.draw();
  }

  setMode(mode, now = performance.now()) {
    if (mode !== 'SCULPT' && mode !== 'VIEW') throw new RangeError('Unknown interaction mode');
    if (mode === this.mode) return false;
    this.mode = mode; this.holdInput(now);
    this.projectAll(); this.draw();
    return true;
  }

  setWorkspaceActive(active, now = performance.now()) {
    if (active === this.workspaceActive) return;
    this.workspaceActive = active; this.holdInput(now);
  }

  holdInput(now) {
    this.inputStartedAt = now; this.sculptHeld = true;
    this.clearPointers(); this.hand = null; this.trace.hand(null, now);
    this.pendingGesture = null; this.lastResponseId = null;
    // Stop old motion without changing current positions, connectivity or pose.
    for (const state of [this.activation, this.quickFeedback, this.handYaw, this.handPitch, this.centerMotionX, this.centerMotionY, ...this.fragments.states]) state.velocity = 0;
    for (const point of this.points) {
      point.deformation.velocity = 0; point.scatterMotion.velocity = 0;
      for (const state of point.motion) state.velocity = 0;
    }
    this.last = 0; this.quality.resetTiming();
  }

  hasUnsavedShape() {
    return this.memory.commits.length > 0 || this.form !== 'octahedron' || this.dispersion !== MOTION.deconstructionStrength ||
      this.fragments.states.some(s => Math.abs(s.value) > 0.01) ||
      this.weave.charge.some(v => v > 0.1) ||
      this.points.some(p => p.scatter > 0.01) ||
      [...this.memory.sessions.values()].some(s => s.motion.some(m => Math.abs(m.value) > 0.001));
  }

  setDispersion(value) {
    if (this.mode !== 'SCULPT') return false;
    this.sculptHeld = false; this.dispersion = clamp(value); return true;
  }

  setForm(form) {
    if (this.mode !== 'SCULPT') return false;
    this.sculptHeld = false;
    this.form = form; this.clearPointers(); this.weave.clear();
    this.trace.clear();
    this.points.forEach((p, i) => { p.target = form === 'octahedron' ? p.home : formPoint(form, i, this.poolCount); });
  }

  reset() {
    if (this.mode !== 'SCULPT') return false;
    this.memory.restore(); this.onMemoryChange?.('RESTORE');
    this.focus = null; this.setHand(null);
    this.dispersion = MOTION.deconstructionStrength; this.inertia = MOTION.motionInertia;
    this.setForm('octahedron');
  }

  undoImprint() {
    if (this.mode !== 'SCULPT' || !this.memory.commits.length) return false;
    this.clearPointers(); this.sculptHeld = false;
    this.memory.undo(); this.onMemoryChange?.('UNDO');
    this.projectAll(); this.draw(); return true;
  }

  // Invert the current observation and sculpture rotations once per touch.
  localDragVector(x, y, depth) {
    let z = 0;
    const factor = (4.5 - depth) / (4.5 * this.scale);
    x *= factor; y *= -factor;
    if (this.viewRotated) {
      z = -y * this.viewPitchSin; y *= this.viewPitchCos;
      const oldX = x; x = x * this.viewYawCos - z * this.viewYawSin;
      z = oldX * this.viewYawSin + z * this.viewYawCos;
    }
    const oldY = y; y = y * this.pitchCos + z * this.pitchSin;
    z = -oldY * this.pitchSin + z * this.pitchCos;
    return [x * this.yawCos - z * this.yawSin, y, x * this.yawSin + z * this.yawCos];
  }

  nearestNode(point) {
    let index = -1, distance = Math.max(34, this.scale * 0.3);
    this.nodeScreens.forEach((node, i) => {
      const d = Math.hypot(node.x - point.x, node.y - point.y);
      if (d < distance) { index = i; distance = d; }
    });
    return index;
  }

  setHand(hand) {
    if (!this.workspaceActive || this.mode !== 'SCULPT') return false;
    const sampledAt = hand?.sampledAt ?? hand?.dispatchedAt;
    if (Number.isFinite(sampledAt) && sampledAt < this.inputStartedAt) return false;
    if (this.sculptHeld) {
      if (!hand || hand.tracked === false || !Number.isFinite(sampledAt) || sampledAt < this.inputStartedAt) return false;
      this.sculptHeld = false;
    }
    this.hand = hand;
    this.trace.hand(hand, hand?.dispatchedAt ?? performance.now());
    if (!hand) { this.pendingGesture = null; this.lastResponseId = null; return; }
    if (hand.response && hand.response.id !== this.lastResponseId) {
      this.lastResponseId = hand.response.id;
      const direction = Math.sign(hand.feedback || hand.activation - this.activation.value);
      this.previewTarget = clamp(this.activation.value + direction * GESTURE_TIMING.previewActivation);
      this.pendingGesture = { ...hand.response, direction, dispatchedAt: hand.dispatchedAt, baseline: this.activation.value };
    }
  }

  pointerDown(id, x, y, now) {
    if (!this.workspaceActive || now < this.inputStartedAt) return;
    if (this.mode === 'VIEW') { this.viewPointers.set(id, { x, y }); return; }
    this.sculptHeld = false;
    this.memory.notice = null;
    this.onMemoryChange?.('INPUT');
    const point = { x, y, time: now, quiet: 0, tearing: false, intent: 'SCULPT', fastCandidate: false };
    this.pointers.set(id, point); this.focus = point;
    if (this.form === 'octahedron') {
      let nearest = null, distance = Math.max(38, this.scale * 0.3);
      for (let slot = 0; slot < this.budget.length; slot++) {
        const particle = this.points[this.budget.indices[slot]];
        const d = Math.hypot(particle.x - x, particle.y - y);
        if (d < distance) { distance = d; nearest = particle; }
      }
      if (nearest) {
        point.dragX = x; point.dragY = y;
        point.basisX = this.localDragVector(1, 0, nearest.depth);
        point.basisY = this.localDragVector(0, 1, nearest.depth);
        this.memory.begin(id, nearest.position, x, y, now, this.scale * 4.5 / (4.5 - nearest.depth));
      }
      const node = this.nearestNode(point);
      if (node >= 0) this.weave.begin(id, node);
    }
    if (this.pointers.size > 1) this.memory.blockActive();
  }

  pointerMove(id, x, y, now) {
    if (!this.workspaceActive || now < this.inputStartedAt) return;
    if (this.mode === 'VIEW') {
      const previous = this.viewPointers.get(id);
      if (!previous) return;
      if (id === this.viewPointers.keys().next().value) {
        const sensitivity = Math.PI * 1.2 / Math.max(200, Math.min(this.width, this.height));
        this.viewYaw = (this.viewYaw + (x - previous.x) * sensitivity) % (Math.PI * 2);
        this.viewPitch = clamp(this.viewPitch + (y - previous.y) * sensitivity, -1.3, 1.3);
      }
      previous.x = x; previous.y = y;
      if (this.paused) { this.projectAll(); this.draw(); }
      return;
    }
    if (this.sculptHeld) return;
    const previous = this.pointers.get(id);
    this.focus = { x, y };
    if (!previous) return;
    const point = { x, y };
    const wasScattering = previous.intent === 'SCATTER';
    const intent = this.form === 'octahedron' ? strokeIntent(previous, x, y, now) : previous.intent;
    if (intent === 'SCATTER' && !wasScattering) this.onMemoryChange?.('SCATTER');
    if (intent === 'SCULPT' && previous.basisX) {
      for (let a = 0; a < 3; a++) this.sculptOffset[a] = (x - previous.dragX) * previous.basisX[a] + (y - previous.dragY) * previous.basisY[a];
      this.memory.move(id, x, y, now, this.sculptOffset);
    }
    const distance = Math.hypot(x - previous.x, y - previous.y);
    if (this.form === 'octahedron' && intent === 'SCATTER') {
      this.memory.cancelStroke(id);
      if (!wasScattering) { previous.tearX = previous.x; previous.tearY = previous.y; previous.tearTime = -Infinity; }
      if (distance > 0 && now - previous.tearTime >= SCULPT_INPUT.scatterSampleMs) {
        this.tear({ x: previous.tearX, y: previous.tearY }, point);
        previous.tearX = x; previous.tearY = y; previous.tearTime = now;
      }
      this.weave.cancel(id); previous.tearing = true; previous.quiet = 0;
    }
    previous.x = x; previous.y = y; previous.time = now;
  }

  pointerUp(id, cancelled = false) {
    if (this.mode === 'VIEW') { this.viewPointers.delete(id); return; }
    const pointer = this.pointers.get(id);
    const scattering = pointer?.intent === 'SCATTER';
    if (scattering && !cancelled && this.workspaceActive && (pointer.x !== pointer.tearX || pointer.y !== pointer.tearY)) {
      this.tear({ x: pointer.tearX, y: pointer.tearY }, pointer);
    }
    const commit = !cancelled && !scattering && this.workspaceActive && this.form === 'octahedron' && this.pointers.size === 1;
    if (this.memory.end(id, commit)) this.onMemoryChange?.('COMMIT');
    else if (this.memory.sessions.get(id)?.stage === 'LIMIT') this.onMemoryChange?.('LIMIT');
    if (scattering) this.onMemoryChange?.('SCATTER_END');
    if (cancelled || scattering) this.weave.cancel(id); else this.weave.release(id);
    this.pointers.delete(id);
    this.focus = this.pointers.size ? [...this.pointers.values()][0] : null;
  }

  clearPointers() {
    this.memory.cancelAll();
    this.pointers.clear(); this.viewPointers.clear(); this.weave.sources.clear(); this.focus = null;
  }

  tear(a, b) {
    if (this.mode !== 'SCULPT' || this.sculptHeld) return;
    const radius = Math.max(24, this.scale * 0.24) * (0.65 + this.dispersion * 0.7);
    const damaged = [];
    this.nodeScreens.forEach((node, i) => {
      if (segmentDistance(node.x, node.y, a, b) < radius) damaged.push(i);
    });
    this.weave.breakNodes(damaged, this.dispersion);
    for (let slot = 0; slot < this.budget.length; slot++) {
      const p = this.points[this.budget.indices[slot]];
      const weight = clamp(1 - segmentDistance(p.x, p.y, a, b) / (radius * 1.4));
      p.scatter = Math.max(p.scatter, weight * 0.7);
      p.scatterMotion.velocity = Math.max(p.scatterMotion.velocity, weight * SCULPT_INPUT.scatterVelocity);
    }
  }

  animate(now) {
    const interval = this.last ? now - this.last : 1000 / 60;
    const dt = Math.max(0, Math.min(interval / 1000, 0.25));
    this.last = now;
    if (this.workspaceActive && !this.paused) {
      const started = performance.now();
      if (this.mode === 'SCULPT' && !this.sculptHeld) this.time += dt;
      this.update(dt, now);
      const updated = performance.now(); this.draw();
      const drawn = performance.now();
      if (this.quality.observe(interval, updated - started, drawn - updated, this.inferenceMs, this.mode === 'SCULPT' && !this.sculptHeld)) this.setParticleCount(this.quality.count);
      const pending = this.pendingGesture;
      // A rendering proxy excludes idle rotation: it measures gesture-driven
      // deformation, approximately >=0.5 CSS px, after Canvas commands submit.
      const responseAmount = pending ? Math.max(pending.direction * (this.activation.value - pending.baseline), 0) : 0;
      if (pending && this.scale * this.dispersion * responseAmount >= 0.5) {
        const renderedAt = performance.now();
        this.onGestureRendered?.({ id: pending.id, animationStartMs: renderedAt - pending.observedAt, renderQueueMs: renderedAt - pending.dispatchedAt });
        this.pendingGesture = null;
      }
    }
    this.frame = requestAnimationFrame(this.animate);
  }

  setParticleCount(count) {
    if (count === this.count) return;
    this.count = count; this.budget.setCount(count);
  }

  update(dt, now = performance.now()) {
    if (!this.workspaceActive) return;
    if (this.mode === 'VIEW' || this.sculptHeld) { this.projectAll(); return; }
    if (this.hand?.validUntil !== undefined && now > this.hand.validUntil) this.setHand(null);
    this.budget.advance(dt);
    const coefficients = springCoefficients(dt, this.inertia);
    const feedback = this.memory.update(dt, this.inertia, this.pointers.size === 1 && this.form === 'octahedron');
    if (feedback) this.onMemoryChange?.(feedback);
    const scatterCoefficients = springCoefficients(dt, this.inertia, 2);
    const layers = {
      edge: springCoefficients(dt, this.inertia, 1.3),
      surface: coefficients,
      interior: springCoefficients(dt, this.inertia, 0.72),
    };
    for (const [id, point] of this.pointers) {
      point.quiet += dt;
      if (point.tearing && point.intent !== 'SCATTER' && point.quiet > 0.4) {
        point.tearing = false;
        const node = this.nearestNode(point);
        if (node >= 0) this.weave.begin(id, node);
      }
    }
    this.weave.update(dt, recoveryRate(this.inertia));
    let spread = 0;
    if (this.hand) spread = this.hand.openness;
    else if (this.pointers.size > 1) {
      const [a, b] = [...this.pointers.values()];
      spread = clamp(Math.hypot(a.x - b.x, a.y - b.y) / (Math.min(this.width, this.height) * 0.65));
    } else if (this.pointers.size && this.form !== 'octahedron') spread = Math.max(spread, 0.82);
    // A single set of layer states owns preview and formal geometry. Missing
    // samples preserve intent upstream; confirmation never resets these springs.
    const previewGoal = this.hand?.previewGoal ?? (this.hand?.feedback ? (this.hand.feedback > 0 ? 1 : 0) : null);
    const target = previewGoal !== null ? this.previewTarget : this.hand?.targetActivation ?? this.hand?.activation ?? spread * spread;
    this.targetActivation = this.hand?.targetActivation ?? (previewGoal !== null ? this.fragments.goal : target);
    this.fragments.update(this.targetActivation, dt, this.inertia, previewGoal);
    this.trace.update(dt, now, this.inertia);
    const rotation = springCoefficients(dt, this.inertia, 1.6);
    const moving = this.trace.emitting ? 1 : 0;
    advanceSpring(this.handYaw, clamp(this.trace.vx || 0, -3, 3) * 0.05 * moving, rotation);
    advanceSpring(this.handPitch, clamp(this.trace.vy || 0, -3, 3) * 0.035 * moving, rotation);
    if (this.form === 'octahedron') {
      this.activation.value = this.fragments.states.reduce((sum, state) => sum + clamp(state.value), 0) / 3;
      this.activation.velocity = this.fragments.states.reduce((sum, state) => sum + state.velocity, 0) / 3;
      this.impulse = clamp(this.activation.value);
    } else this.impulse = clamp(advanceSpring(this.activation, target, coefficients));
    // A brightness hint only: it must never add or subtract geometry progress.
    advanceSpring(this.quickFeedback, this.hand?.feedback ?? 0, springCoefficients(dt, this.inertia, 4));
    const legacyPointer = this.form !== 'octahedron' && this.focus;
    const hx = this.hand ? (this.hand.x - 0.5) * this.scale * 0.4 : legacyPointer ? clamp((this.focus.x - this.originX) * 0.3, -this.scale * 0.4, this.scale * 0.4) : 0;
    const hy = this.hand ? (this.hand.y - 0.5) * this.scale * 0.25 : legacyPointer ? clamp((this.focus.y - this.originY) * 0.3, -this.scale * 0.25, this.scale * 0.25) : 0;
    this.centerX = advanceSpring(this.centerMotionX, this.originX + hx, coefficients);
    this.centerY = advanceSpring(this.centerMotionY, this.originY + hy, coefficients);
    const scatterDecay = Math.exp(-dt * recoveryRate(this.inertia));
    for (let slot = 0; slot < this.budget.length; slot++) {
      const p = this.points[this.budget.indices[slot]];
      const layer = layers[p.kind];
      if (this.form === 'octahedron') {
        const state = this.fragments.states[p.layer];
        p.deformation.value = state.value; p.deformation.velocity = state.velocity;
      } else advanceSpring(p.deformation, target, layer);
      const thread = this.form === 'octahedron' && p.thread;
      const pull = thread ? this.weave.strength(thread.link) * 0.92 : 0;
      const flowing = this.form === 'octahedron' && p.flow;
      if (flowing) advanceEdgeFlow(flowing, this.time);
      const base = flowing ? (this.material ? this.material.map(flowing.position, flowing.materialPosition) : flowing.position) : p.target;
      for (let axis = 0; axis < 3; axis++) {
        const target = base[axis] + (thread ? (thread.point[axis] - base[axis]) * pull : 0);
        p.position[axis] = advanceSpring(p.motion[axis], target, layer);
      }
      p.scatter *= scatterDecay;
      advanceSpring(p.scatterMotion, p.scatter, scatterCoefficients);
    }
    this.projectAll();
    if (this.form === 'octahedron') for (let slot = 0; slot < this.trace.capacity; slot++) {
      const p = this.points[this.trace.owners[slot]];
      if (!this.budget.selected[this.trace.owners[slot]]) continue;
      // Preserve the scene pose at capture time, including hand translation.
      // Object-local history would move with the sculpture and erase its trail.
      let source = p;
      if (this.viewRotated) { this.project(p.world, this.traceSourceProjection, false); source = this.traceSourceProjection; }
      const inversePerspective = (4.5 - source.depth) / 4.5;
      this.traceCapture[0] = (source.x - this.originX) / this.scale * inversePerspective;
      this.traceCapture[1] = -(source.y - this.originY) / this.scale * inversePerspective;
      this.traceCapture[2] = source.depth;
      this.trace.capture(slot, this.traceCapture, this.time, p.traceWeight * this.budget.opacity[this.trace.owners[slot]]);
    }
  }

  project(point, destination, observe = true) {
    const x = point[0] * this.yawCos + point[2] * this.yawSin;
    const z = -point[0] * this.yawSin + point[2] * this.yawCos;
    const y = point[1] * this.pitchCos - z * this.pitchSin;
    const depth = point[1] * this.pitchSin + z * this.pitchCos;
    this.projectScene(x, y, depth, destination, observe);
  }

  projectScene(x, y, depth, destination, observe = true) {
    if (observe && this.viewRotated) {
      const rotatedX = x * this.viewYawCos + depth * this.viewYawSin;
      const rotatedZ = -x * this.viewYawSin + depth * this.viewYawCos;
      depth = y * this.viewPitchSin + rotatedZ * this.viewPitchCos;
      y = y * this.viewPitchCos - rotatedZ * this.viewPitchSin; x = rotatedX;
    }
    const perspective = 4.5 / (4.5 - depth);
    destination.x = this.centerX + x * this.scale * perspective;
    destination.y = this.centerY - y * this.scale * perspective;
    destination.depth = depth;
  }

  projectAll() {
    this.viewRotated = this.viewYaw !== 0 || this.viewPitch !== 0;
    this.viewYawCos = Math.cos(this.viewYaw); this.viewYawSin = Math.sin(this.viewYaw);
    this.viewPitchCos = Math.cos(this.viewPitch); this.viewPitchSin = Math.sin(this.viewPitch);
    const frozen = this.mode === 'VIEW' || this.sculptHeld;
    const yaw = this.time * 0.075 + 0.6 + this.handYaw.value, pitch = -0.12 + Math.sin(this.time * 0.1) * 0.035 + this.handPitch.value;
    this.yawCos = Math.cos(yaw); this.yawSin = Math.sin(yaw);
    this.pitchCos = Math.cos(pitch); this.pitchSin = Math.sin(pitch);
    const driftSin = Math.sin(this.time * 0.28), driftCos = Math.cos(this.time * 0.28);
    this.pulseSin = Math.sin(this.time * 0.9); this.pulseCos = Math.cos(this.time * 0.9);
    const tx = this.originX + (this.trace.handX - 0.5) * this.scale * 1.8;
    const ty = this.originY + (this.trace.handY - 0.5) * this.scale * 1.8;
    const traceEnergy = this.form === 'octahedron' ? clamp(this.trace.energy.value) : 0;
    for (let slot = 0; slot < this.budget.length; slot++) {
      const i = this.budget.indices[slot];
      const p = this.points[i];
      if (frozen) { this.project(p.world, p); continue; }
      const anchor = this.form === 'octahedron' && p.kind === 'edge' && retained(i, this.dispersion);
      const amount = (clamp(p.deformation.value) * p.radius * (anchor ? 0.08 : 1) + clamp(p.scatterMotion.value)) * this.dispersion;
      const drift = this.form === 'octahedron' && p.kind === 'interior' ? 0.009 : 0.001;
      const material = this.form === 'octahedron' ? this.memory.deform(p.position, this.materialPoint) : p.position;
      for (let axis = 0; axis < 3; axis++) p.world[axis] = material[axis] * (1 + amount * 0.45) + (p.driftSin[axis] * driftCos + p.driftCos[axis] * driftSin) * (amount + drift);
      p.traceWeight = 0;
      if (p.traceSlot >= 0 && traceEnergy > 0.005) {
        const dx = (p.x - tx) / this.scale, dy = (p.y - ty) / this.scale;
        const local = traceEnergy * clamp(1 - Math.hypot(dx, dy) / FLOW_STATE.trace.radius);
        p.world[0] -= dy * local * FLOW_STATE.trace.swirl;
        p.world[1] -= dx * local * FLOW_STATE.trace.swirl;
        p.traceWeight = this.trace.emitting ? local : 0;
      }
      this.project(p.world, p);
    }
    if (!this.material?.densityField) this.mesh.nodes.forEach((point, i) => this.project(this.memory.deform(point, this.materialPoint), this.nodeScreens[i]));
  }

  drawTraces() {
    const ctx = this.ctx, trace = this.trace;
    ctx.lineWidth = 0.6; ctx.setLineDash([]);
    const stride = this.mobile && this.quality.level === 0 ? 2 : 1;
    const maxGap = Math.max(0.12, FLOW_STATE.trace.duration / (trace.samples - 1) * stride * 1.8);
    for (let slot = 0; slot < trace.capacity; slot++) for (let step = 0; step < trace.samples - stride; step += stride) {
      const a = slot * trace.samples + (trace.heads[slot] + trace.samples - step) % trace.samples;
      const b = slot * trace.samples + (trace.heads[slot] + trace.samples - step - stride) % trace.samples;
      const opacity = Math.min(trace.opacity(a, this.time), trace.opacity(b, this.time));
      if (opacity < 0.003 || trace.times[a] - trace.times[b] > maxGap) continue;
      let distance = 0;
      for (let axis = 0; axis < 3; axis++) {
        this.traceWorldA[axis] = trace.positions[a * 3 + axis]; this.traceWorldB[axis] = trace.positions[b * 3 + axis];
        distance += (this.traceWorldA[axis] - this.traceWorldB[axis]) ** 2;
      }
      if (distance > 0.35 ** 2) continue;
      this.projectTracePoint(this.traceWorldA, this.traceScreenA); this.projectTracePoint(this.traceWorldB, this.traceScreenB);
      ctx.strokeStyle = `rgba(255,255,255,${opacity})`;
      ctx.beginPath(); ctx.moveTo(this.traceScreenA.x, this.traceScreenA.y); ctx.lineTo(this.traceScreenB.x, this.traceScreenB.y); ctx.stroke();
    }
  }

  projectTracePoint(point, destination) {
    if (this.viewRotated) {
      // TRACE history already contains scene rotation and screen translation;
      // remove only the latter before applying the observation transform once.
      const inversePerspective = (4.5 - point[2]) / 4.5;
      this.projectScene(point[0] - (this.centerX - this.originX) / this.scale * inversePerspective,
        point[1] + (this.centerY - this.originY) / this.scale * inversePerspective, point[2], destination);
      return;
    }
    const perspective = 4.5 / (4.5 - point[2]);
    destination.x = this.originX + point[0] * this.scale * perspective;
    destination.y = this.originY - point[1] * this.scale * perspective;
  }

  drawWeave() {
    const ctx = this.ctx;
    const coherence = 1 - this.impulse * this.dispersion;
    // Faces are only local, sparse and almost transparent after all corners settle.
    let filled = 0;
    const density = this.material?.densityField;
    const facetLimit = density ? (this.mobile ? (this.quality.level === 0 ? 4 : 14) : 28) : this.mobile ? (this.quality.level === 0 ? 4 : this.quality.level === 1 ? 8 : 14) : 14;
    for (let i = 0; i < this.mesh.triangles.length && filled < facetLimit; i += density ? 1 : 5) {
      const indices = this.mesh.triangles[i];
      const ia = indices[0], ib = indices[1], ic = indices[2];
      let strength = Math.min(this.weave.charge[ia] * (1 - this.weave.damage[ia]), this.weave.charge[ib] * (1 - this.weave.damage[ib]), this.weave.charge[ic] * (1 - this.weave.damage[ic]));
      if (density) {
        if (!this.budget.selected[ia] || !this.budget.selected[ib] || !this.budget.selected[ic]) continue;
        const a = this.points[ia], b = this.points[ib], c = this.points[ic];
        const damage = Math.max(this.weave.damage[ia], this.weave.damage[ib], this.weave.damage[ic]);
        if (damage > .15 || this.impulse > .25 || Math.max(a.scatterMotion.value, b.scatterMotion.value, c.scatterMotion.value) > .05) continue;
        let stable = true;
        for (let side = 0; side < 3; side++) {
          const p = this.points[side === 0 ? ia : side === 1 ? ib : ic], q = this.points[side === 0 ? ib : side === 1 ? ic : ia];
          const rest = Math.hypot(p.home[0]-q.home[0], p.home[1]-q.home[1], p.home[2]-q.home[2]);
          const live = Math.hypot(p.world[0]-q.world[0], p.world[1]-q.world[1], p.world[2]-q.world[2]);
          if (live > rest * 1.5 || live < rest * .5) stable = false;
        }
        if (!stable) continue;
        strength = Math.max(strength, .90 + this.mesh.faceWeights[i] * .05);
      }
      if (strength < 0.88) continue;
      const a = this.nodeScreens[ia], b = this.nodeScreens[ib], c = this.nodeScreens[ic];
      ctx.fillStyle = `rgba(255,255,255,${(strength - 0.88) * 0.22 * coherence})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.fill(); filled++;
    }
    const edgeActivation = this.form === 'octahedron' ? clamp(this.fragments.states[1].value) : this.impulse;
    if (this.mobile) this.weavePathSizes.fill(0);
    for (let i = 0; i < this.mesh.links.length; i++) {
      // Reference edges never become display edges, even if a caller provides them.
      if (density && this.mesh.primary?.[i]) continue;
      const [ia, ib] = this.mesh.links[i];
      const a = this.nodeScreens[ia], b = this.nodeScreens[ib];
      const strength = this.weave.strength(i);
      const integrity = 1 - edgeActivation * (retained(i, this.dispersion) ? 0.12 : 1);
      const intact = 1 - Math.max(this.weave.damage[ia], this.weave.damage[ib]);
      const visibility = density ? Math.min(this.budget.opacity[ia], this.budget.opacity[ib]) : 1;
      if (visibility < .001) continue;
      const base = this.mesh.boundary[i] ? (density ? (.08 + this.mesh.linkWeights[i] * .09) : .12) * intact * visibility : 0;
      if ((strength < 0.025 && base < 0.005) || integrity < 0.025) continue;
      if (this.mobile) {
        const opacity = (base + strength * 0.43 * visibility) * integrity;
        const dashed = integrity < 0.7 || strength < 0.7 && strength > 0.025;
        const buckets = MOBILE_PERFORMANCE.weaveOpacityBuckets;
        const bucket = Math.min(buckets - 1, Math.floor(opacity / 0.6 * buckets)) + (dashed ? buckets : 0);
        const offset = this.weavePathSizes[bucket] * 4, path = this.weavePaths[bucket];
        path[offset] = a.x; path[offset + 1] = a.y;
        path[offset + 2] = a.x + (b.x - a.x) * integrity; path[offset + 3] = a.y + (b.y - a.y) * integrity;
        this.weavePathSizes[bucket]++;
        continue;
      }
      ctx.strokeStyle = `rgba(255,255,255,${(base + strength * 0.43 * visibility) * integrity})`;
      ctx.lineWidth = 0.55;
      ctx.setLineDash(integrity < 0.7 ? [2, 4] : strength < 0.7 && strength > 0.025 ? [1.5 + strength * 3, 4 * (1 - strength)] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + (b.x - a.x) * integrity, a.y + (b.y - a.y) * integrity); ctx.stroke();
    }
    if (this.mobile) {
      const buckets = MOBILE_PERFORMANCE.weaveOpacityBuckets;
      for (let bucket = 0; bucket < this.weavePaths.length; bucket++) {
        const size = this.weavePathSizes[bucket]; if (!size) continue;
        const path = this.weavePaths[bucket];
        ctx.strokeStyle = `rgba(255,255,255,${((bucket % buckets) + 0.5) / buckets * 0.6})`;
        ctx.setLineDash(bucket >= buckets ? [2, 3] : []); ctx.lineWidth = .55; ctx.beginPath();
        for (let segment = 0; segment < size * 4; segment += 4) { ctx.moveTo(path[segment], path[segment + 1]); ctx.lineTo(path[segment + 2], path[segment + 3]); }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  drawDensityGlyphs() {
    const ctx = this.ctx;
    ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = .45; ctx.setLineDash([]); ctx.beginPath();
    for (let slot = 0; slot < this.budget.length; slot++) {
      const i = this.budget.indices[slot], p = this.points[i];
      if (p.glyph === 'point' || this.budget.opacity[i] < .5) continue;
      const vertices = p.glyph === 'octa' ? GLYPH_OCTA : GLYPH_TETRA;
      const links = p.glyph === 'octa' ? GLYPH_OCTA_LINKS : GLYPH_TETRA_LINKS;
      const radius = .014 + Math.min(.008, (p.density ?? 0) * .008);
      for (let v = 0; v < vertices.length; v++) {
        for (let a = 0; a < 3; a++) this.glyphWorld[a] = p.world[a] + vertices[v][a] * radius;
        this.project(this.glyphWorld, this.glyphScreens[v]);
      }
      for (const [a, b] of links) { ctx.moveTo(this.glyphScreens[a].x, this.glyphScreens[a].y); ctx.lineTo(this.glyphScreens[b].x, this.glyphScreens[b].y); }
    }
    ctx.stroke();
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#101111'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.save(); ctx.beginPath(); ctx.rect(12, this.artTop, this.width - 24, this.artBottom - this.artTop); ctx.clip();
    if (this.form === 'octahedron') this.drawWeave();
    if (this.form === 'octahedron') this.drawTraces();
    // Batch tiny light points; a few shards provide scale without heavy glow.
    for (let group = 0; group < 3; group++) {
      // A tiny light pulse also acknowledges a reversal while retained inertia
      // still carries the sculpture in the previous direction.
      const hint = Math.min(1, Math.abs(this.quickFeedback.value)) * 0.08;
      ctx.fillStyle = `rgba(255,255,255,${[0.27, 0.55, 0.88][group] + hint})`; ctx.beginPath();
      for (let slot = 0; slot < this.budget.length; slot++) {
        const i = this.budget.indices[slot]; if (i % 3 !== group) continue;
        const p = this.points[i];
        if (this.material?.densityField && this.form === 'octahedron' && p.glyph !== 'point') continue;
        const pulse = p.flow && this.form === 'octahedron' ? 1 + FLOW_STATE.flow.luminance * (p.driftSin[0] * this.pulseCos + p.driftCos[0] * this.pulseSin) : 1;
        const visibility = this.budget.opacity[i];
        const radius = ((p.kind === 'interior' ? 0.45 : 0.65) + (p.depth + 1) * 0.22) * pulse * (visibility < 1 ? Math.sqrt(visibility) : 1);
        if (!this.material?.densityField && i % 23 === 0) {
          const r = radius * 1.8;
          ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r * 0.55, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r * 0.55, p.y); ctx.closePath();
        } else if (!this.material?.densityField && i % 31 === 0) {
          ctx.moveTo(p.x, p.y - radius * 1.5); ctx.lineTo(p.x + radius, p.y + radius); ctx.lineTo(p.x - radius, p.y + radius); ctx.closePath();
        } else { ctx.moveTo(p.x + radius, p.y); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); }
      }
      ctx.fill();
    }
    if (this.material?.densityField && this.form === 'octahedron') this.drawDensityGlyphs();
    if (this.form === 'lines' || this.form === 'grid') {
      ctx.strokeStyle = '#ffffff1a'; ctx.lineWidth = 0.5; ctx.beginPath();
      const step = this.form === 'lines' ? 9 : 1;
      for (let i = 0; i < this.poolCount - step; i += 2) {
        if (!this.budget.selected[i] || !this.budget.selected[i + step]) continue;
        const a = this.points[i], b = this.points[i + step];
        if (Math.hypot(a.x - b.x, a.y - b.y) < this.scale * 0.2) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke();
    }
    if (this.mode === 'SCULPT' && this.form === 'octahedron') {
      for (const s of this.memory.sessions.values()) {
        if (!s.active || s.blocked || s.pulseAge >= IMPRINT.pulseSeconds) continue;
        const phase = s.pulseAge / IMPRINT.pulseSeconds;
        ctx.strokeStyle = `rgba(255,255,255,${Math.sin(phase * Math.PI) * 0.22})`;
        ctx.lineWidth = 0.8; ctx.setLineDash([]); ctx.beginPath();
        ctx.arc(s.x, s.y, 12 + phase * 12, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }
}

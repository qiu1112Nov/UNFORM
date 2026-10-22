import { clamp, formPoint } from './geometry.js';
import { advanceSpring, MOTION, recoveryRate, retained, springCoefficients } from './motion.js';
import { GESTURE_TIMING } from './gesture-pipeline.js';
import { advanceEdgeFlow, createEdgeFlow, FLOW_STATE, fragmentLayer, FragmentLayers, SpatialTrace } from './flow-state.js';
import { buildSurfaceMesh, nearestThread, octahedronParticle, segmentDistance, WeaveNetwork } from './octahedron.js';
import { AdaptiveQuality, MOBILE_PERFORMANCE, ParticleBudget } from './performance.js';

export class ParticleField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas 2D is unavailable.');
    this.mobile = matchMedia('(max-width: 800px)').matches || matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 4) <= 4;
    this.poolCount = this.mobile ? MOBILE_PERFORMANCE.poolCount : 1900;
    this.quality = new AdaptiveQuality(this.mobile);
    this.count = this.quality.count; this.inferenceMs = null;
    this.fragments = new FragmentLayers();
    this.trace = new SpatialTrace(this.poolCount, this.mobile, this.mobile ? MOBILE_PERFORMANCE.traceSamples : undefined);
    this.traceWorldA = new Float32Array(3); this.traceWorldB = new Float32Array(3);
    this.traceCapture = new Float32Array(3);
    this.traceScreenA = { x: 0, y: 0 }; this.traceScreenB = { x: 0, y: 0 };
    this.mesh = buildSurfaceMesh(this.mobile ? 6 : 8);
    this.weave = new WeaveNetwork(this.mesh);
    this.points = Array.from({ length: this.poolCount }, (_, i) => {
      const sample = octahedronParticle(i, this.poolCount);
      return {
        kind: sample.kind, home: sample.point, position: [...sample.point], target: [...sample.point],
        layer: fragmentLayer(sample.kind, sample.point), flow: createEdgeFlow(i, this.poolCount, sample.point),
        world: new Float32Array(sample.point), traceSlot: -1, traceWeight: 0,
        motion: sample.point.map(value => ({ value, velocity: 0 })),
        deformation: { value: 0, velocity: 0 },
        scatterMotion: { value: 0, velocity: 0 },
        thread: sample.kind === 'interior' ? null : nearestThread(sample.point, this.mesh),
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
    this.previewTarget = 0;
    this.centerMotionX = { value: 0, velocity: 0 }; this.centerMotionY = { value: 0, velocity: 0 };
    this.focus = null; this.hand = null; this.pointers = new Map();
    this.time = 0; this.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reducedMotion = this.paused;
    this.frame = 0; this.last = 0;
    this.nodeScreens = this.mesh.nodes.map(() => ({ x: 0, y: 0, depth: 0 }));
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

  resize() {
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

  setForm(form) {
    this.form = form; this.clearPointers(); this.weave.clear();
    this.trace.clear();
    this.points.forEach((p, i) => { p.target = form === 'octahedron' ? p.home : formPoint(form, i, this.poolCount); });
  }

  reset() {
    this.focus = null; this.setHand(null);
    this.dispersion = MOTION.deconstructionStrength; this.inertia = MOTION.motionInertia;
    this.setForm('octahedron');
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
    this.hand = hand;
    this.trace.hand(hand, hand?.dispatchedAt ?? performance.now());
    if (!hand) { this.pendingGesture = null; this.lastResponseId = null; return; }
    if (hand.response && hand.response.id !== this.lastResponseId) {
      this.lastResponseId = hand.response.id;
      const direction = Math.sign(hand.feedback || hand.activation - this.activation.value);
      this.previewTarget = clamp(this.activation.value + direction * GESTURE_TIMING.previewActivation);
      this.pendingGesture = { ...hand.response, direction, dispatchedAt: hand.dispatchedAt, baseline: this.activation.value, feedback: this.quickFeedback.value };
    }
  }

  pointerDown(id, x, y, now) {
    const point = { x, y, time: now, quiet: 0, tearing: false };
    this.pointers.set(id, point); this.focus = point;
    if (this.form === 'octahedron') {
      const node = this.nearestNode(point);
      if (node >= 0) this.weave.begin(id, node);
    }
  }

  pointerMove(id, x, y, now) {
    const previous = this.pointers.get(id);
    this.focus = { x, y };
    if (!previous) return;
    const point = { x, y };
    const distance = Math.hypot(x - previous.x, y - previous.y);
    // A stationary hold can last seconds before the first move. Exclude dwell
    // time so that the first fast swipe after a long press still tears threads.
    const speed = distance / Math.max(8, Math.min(50, now - previous.time)) * 1000;
    if (this.form === 'octahedron' && distance > 3 && speed > Math.max(330, this.scale * 3)) {
      this.tear(previous, point);
      this.weave.cancel(id); previous.tearing = true; previous.quiet = 0;
    }
    previous.x = x; previous.y = y; previous.time = now;
  }

  pointerUp(id, cancelled = false) {
    if (cancelled) this.weave.cancel(id); else this.weave.release(id);
    this.pointers.delete(id);
    this.focus = this.pointers.size ? [...this.pointers.values()][0] : null;
  }

  clearPointers() {
    this.pointers.clear(); this.weave.sources.clear(); this.focus = null;
  }

  tear(a, b) {
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
    }
  }

  animate(now) {
    const interval = this.last ? now - this.last : 1000 / 60;
    const dt = Math.min(interval / 1000, 0.05);
    this.last = now;
    if (!this.paused) {
      const started = performance.now();
      this.time += dt; this.update(dt, now);
      const updated = performance.now(); this.draw();
      const drawn = performance.now();
      if (this.quality.observe(interval, updated - started, drawn - updated, this.inferenceMs)) this.setParticleCount(this.quality.count);
      const pending = this.pendingGesture;
      // A rendering proxy excludes idle rotation: it measures gesture-driven
      // deformation, approximately >=0.5 CSS px, after Canvas commands submit.
      const responseAmount = pending ? Math.max(pending.direction * (this.activation.value - pending.baseline), pending.direction * (this.quickFeedback.value - pending.feedback) * 0.025) : 0;
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
    this.budget.advance(dt);
    const coefficients = springCoefficients(dt, this.inertia);
    const scatterCoefficients = springCoefficients(dt, this.inertia, 2);
    const layers = {
      edge: springCoefficients(dt, this.inertia, 1.3),
      surface: coefficients,
      interior: springCoefficients(dt, this.inertia, 0.72),
    };
    for (const [id, point] of this.pointers) {
      point.quiet += dt;
      if (point.tearing && point.quiet > 0.4) {
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
    // Strength is the effect amplitude; activation comes from hands or touch.
    // No queued timelines: a new gesture changes the live spring target now.
    // Retarget the preview relative to the live animation, not a previous
    // confirmed endpoint: a fist can interrupt a still-opening sculpture.
    const target = this.hand?.feedback ? this.previewTarget : this.hand?.activation ?? spread * spread;
    // Confirmation gates only the staged fragment wave. The independent quick
    // response still renders immediately, without consuming its 80ms staggering.
    this.fragments.update(this.hand?.feedback ? this.fragments.goal : target, dt, this.inertia);
    this.trace.update(dt, now, this.inertia);
    this.impulse = clamp(advanceSpring(this.activation, target, coefficients));
    // Small, fast additive feedback. It fades into the unchanged 65% inertia
    // spring on confirmation or cancellation instead of snapping particle positions.
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
      const base = flowing ? flowing.position : p.target;
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
      const inversePerspective = (4.5 - p.depth) / 4.5;
      this.traceCapture[0] = (p.x - this.originX) / this.scale * inversePerspective;
      this.traceCapture[1] = -(p.y - this.originY) / this.scale * inversePerspective;
      this.traceCapture[2] = p.depth;
      this.trace.capture(slot, this.traceCapture, this.time, p.traceWeight * this.budget.opacity[this.trace.owners[slot]]);
    }
  }

  project(point, destination) {
    const x = point[0] * this.yawCos + point[2] * this.yawSin;
    const z = -point[0] * this.yawSin + point[2] * this.yawCos;
    const y = point[1] * this.pitchCos - z * this.pitchSin;
    const depth = point[1] * this.pitchSin + z * this.pitchCos;
    const perspective = 4.5 / (4.5 - depth);
    destination.x = this.centerX + x * this.scale * perspective;
    destination.y = this.centerY - y * this.scale * perspective;
    destination.depth = depth;
  }

  projectAll() {
    const yaw = this.time * 0.075 + 0.6, pitch = -0.12 + Math.sin(this.time * 0.1) * 0.035;
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
      const anchor = this.form === 'octahedron' && p.kind === 'edge' && retained(i, this.dispersion);
      const amount = (clamp(p.deformation.value + this.quickFeedback.value * 0.025) * p.radius * (anchor ? 0.08 : 1) + clamp(p.scatterMotion.value)) * this.dispersion;
      const drift = this.form === 'octahedron' && p.kind === 'interior' ? 0.009 : 0.001;
      for (let axis = 0; axis < 3; axis++) p.world[axis] = p.position[axis] * (1 + amount * 0.45) + (p.driftSin[axis] * driftCos + p.driftCos[axis] * driftSin) * (amount + drift);
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
    this.mesh.nodes.forEach((point, i) => this.project(point, this.nodeScreens[i]));
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
    const perspective = 4.5 / (4.5 - point[2]);
    destination.x = this.originX + point[0] * this.scale * perspective;
    destination.y = this.originY - point[1] * this.scale * perspective;
  }

  drawWeave() {
    const ctx = this.ctx;
    const coherence = 1 - this.impulse * this.dispersion;
    // Faces are only local, sparse and almost transparent after all corners settle.
    let filled = 0;
    const facetLimit = this.mobile ? (this.quality.level === 0 ? 4 : this.quality.level === 1 ? 8 : 14) : 14;
    for (let i = 0; i < this.mesh.triangles.length && filled < facetLimit; i += 5) {
      const indices = this.mesh.triangles[i];
      const ia = indices[0], ib = indices[1], ic = indices[2];
      const strength = Math.min(this.weave.charge[ia] * (1 - this.weave.damage[ia]), this.weave.charge[ib] * (1 - this.weave.damage[ib]), this.weave.charge[ic] * (1 - this.weave.damage[ic]));
      if (strength < 0.88) continue;
      const a = this.nodeScreens[ia], b = this.nodeScreens[ib], c = this.nodeScreens[ic];
      ctx.fillStyle = `rgba(255,255,255,${(strength - 0.88) * 0.22 * coherence})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.fill(); filled++;
    }
    const edgeActivation = this.form === 'octahedron' ? clamp(this.fragments.states[1].value) : this.impulse;
    if (this.mobile) this.weavePathSizes.fill(0);
    for (let i = 0; i < this.mesh.links.length; i++) {
      const [ia, ib] = this.mesh.links[i];
      const a = this.nodeScreens[ia], b = this.nodeScreens[ib];
      const strength = this.weave.strength(i);
      const integrity = 1 - edgeActivation * (retained(i, this.dispersion) ? 0.12 : 1);
      const intact = 1 - Math.max(this.weave.damage[ia], this.weave.damage[ib]);
      const base = this.mesh.boundary[i] ? 0.12 * intact : 0;
      if ((strength < 0.025 && base < 0.005) || integrity < 0.025) continue;
      if (this.mobile) {
        const opacity = (base + strength * 0.43) * integrity;
        const dashed = integrity < 0.7 || strength < 0.7 && strength > 0.025;
        const buckets = MOBILE_PERFORMANCE.weaveOpacityBuckets;
        const bucket = Math.min(buckets - 1, Math.floor(opacity / 0.6 * buckets)) + (dashed ? buckets : 0);
        const offset = this.weavePathSizes[bucket] * 4, path = this.weavePaths[bucket];
        path[offset] = a.x; path[offset + 1] = a.y;
        path[offset + 2] = a.x + (b.x - a.x) * integrity; path[offset + 3] = a.y + (b.y - a.y) * integrity;
        this.weavePathSizes[bucket]++;
        continue;
      }
      ctx.strokeStyle = `rgba(255,255,255,${(base + strength * 0.43) * integrity})`;
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
        ctx.setLineDash(bucket >= buckets ? [2, 3] : []); ctx.lineWidth = 0.55; ctx.beginPath();
        for (let segment = 0; segment < size * 4; segment += 4) { ctx.moveTo(path[segment], path[segment + 1]); ctx.lineTo(path[segment + 2], path[segment + 3]); }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
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
        const pulse = p.flow && this.form === 'octahedron' ? 1 + FLOW_STATE.flow.luminance * (p.driftSin[0] * this.pulseCos + p.driftCos[0] * this.pulseSin) : 1;
        const visibility = this.budget.opacity[i];
        const radius = ((p.kind === 'interior' ? 0.45 : 0.65) + (p.depth + 1) * 0.22) * pulse * (visibility < 1 ? Math.sqrt(visibility) : 1);
        if (i % 23 === 0) {
          const r = radius * 1.8;
          ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r * 0.55, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r * 0.55, p.y); ctx.closePath();
        } else if (i % 31 === 0) {
          ctx.moveTo(p.x, p.y - radius * 1.5); ctx.lineTo(p.x + radius, p.y + radius); ctx.lineTo(p.x - radius, p.y + radius); ctx.closePath();
        } else { ctx.moveTo(p.x + radius, p.y); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); }
      }
      ctx.fill();
    }
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
    ctx.restore();
  }
}

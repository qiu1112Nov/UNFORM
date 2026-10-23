import { clamp } from './geometry.js';
import { advanceSpring, MOTION, springCoefficients } from './motion.js';
import { GESTURE_TIMING } from './gesture-pipeline.js';
import { EDGES, VERTICES } from './octahedron.js';

export const FLOW_STATE = Object.freeze({
  flow: Object.freeze({ fraction: 0.12, cyclesPerSecond: 0.045, luminance: 0.04 }),
  fragment: Object.freeze({ staggerSeconds: 0.08, vertexThreshold: 0.84 }),
  trace: Object.freeze({ desktopFraction: 0.04, mobileFraction: 0.018, desktopSamples: 12, mobileSamples: 7,
    duration: 0.45, speedThreshold: 0.6, speedRange: 2.2, radius: 0.48, swirl: 0.035, opacity: 0.22 }),
});

export function fragmentLayer(kind, home) {
  if (kind === 'interior') return 2;
  return Math.max(Math.abs(home[0]), Math.abs(home[1]), Math.abs(home[2])) >= FLOW_STATE.fragment.vertexThreshold ? 0 : 1;
}

// No timers or queued animations. A reversal replaces the pending wave while
// each spring keeps its live position and velocity across preview/confirmation.
export class FragmentLayers {
  constructor() {
    this.states = Array.from({ length: 3 }, () => ({ value: 0, velocity: 0 }));
    this.previewGoal = null; this.targets = [0, 0, 0]; this.goal = 0; this.direction = 1; this.age = 0;
  }
  update(target, dt, inertia = MOTION.motionInertia, previewGoal = null) {
    if (previewGoal !== null) {
      if (previewGoal !== this.previewGoal) {
        this.previewGoal = previewGoal;
        this.states.forEach((state, i) => {
          this.targets[i] = clamp(state.value + Math.sign(previewGoal - state.value) * GESTURE_TIMING.previewActivation);
        });
      }
      // Preview advances the real layer springs, never a temporary additive pose.
      this.states.forEach((state, i) => this.advancePreview(state, this.targets[i], dt, inertia));
      return;
    }
    const confirmedFromPreview = this.previewGoal !== null;
    this.previewGoal = null;
    if (Math.abs(target - this.goal) > 0.0001 || confirmedFromPreview) {
      this.direction = target > this.states.reduce((sum, state) => sum + state.value, 0) / 3 ? 1 : -1;
      this.goal = target; this.age = 0;
    }
    for (let layer = 0; layer < 3; layer++) {
      const rank = this.direction > 0 ? layer : 2 - layer;
      const state = this.states[layer];
      const waiting = Math.min(dt, Math.max(0, rank * FLOW_STATE.fragment.staggerSeconds - this.age));
      if (waiting > 0) {
        // Delayed layers hold/approach their preview target, not their old home.
        this.advancePreview(state, this.targets[layer], waiting, inertia);
      }
      const active = dt - waiting;
      if (active > 0) {
        this.targets[layer] = this.goal;
        advanceSpring(state, this.goal, springCoefficients(active, inertia));
      }
    }
    this.age += dt;
  }
  advancePreview(state, target, dt, inertia) {
    const before = state.value - target;
    advanceSpring(state, target, springCoefficients(dt, inertia, 4));
    // Stop at the bounded preview destination, avoiding an overshoot/rebound
    // while waiting for low-frequency confirmation. Formal springs keep inertia.
    if ((state.value - target) * before <= 0) { state.value = target; state.velocity = 0; }
  }
}

export function createEdgeFlow(index, count, home) {
  const edgeCount = Math.round(count * 0.35), flowCount = Math.round(count * FLOW_STATE.flow.fraction);
  if (index >= edgeCount || Math.floor((index + 1) * flowCount / edgeCount) === Math.floor(index * flowCount / edgeCount)) return null;
  const edge = EDGES[index % EDGES.length];
  const a = VERTICES[edge[0]], b = VERTICES[edge[1]];
  const t = Math.abs(home[b.findIndex(v => v !== 0)]);
  const speed = FLOW_STATE.flow.cyclesPerSecond * (0.65 + ((index * 613) % 997) / 997 * 0.7), direction = index % 2 ? -1 : 1;
  return { a, b, phase: Math.acos(clamp(1 - 2 * t, -1, 1)), direction, speed, angularSpeed: direction * speed * Math.PI * 2,
    axisA: a.findIndex(v => v !== 0), axisB: b.findIndex(v => v !== 0), position: new Float32Array(home) };
}

export function advanceEdgeFlow(flow, time) {
  const t = (1 - Math.cos(flow.phase + time * flow.angularSpeed)) / 2;
  if (flow.graph) {
    for (let axis = 0; axis < 3; axis++) flow.position[axis] = flow.a[axis] * (1 - t) + flow.b[axis] * t;
    return;
  }
  flow.position[flow.axisA] = flow.a[flow.axisA] * (1 - t);
  flow.position[flow.axisB] = flow.b[flow.axisB] * t;
}

export class SpatialTrace {
  constructor(count, mobile, sampleCount) {
    const config = FLOW_STATE.trace;
    this.capacity = Math.max(1, Math.round(count * (mobile ? config.mobileFraction : config.desktopFraction)));
    this.samples = sampleCount ?? (mobile ? config.mobileSamples : config.desktopSamples);
    this.owners = new Uint16Array(this.capacity);
    this.positions = new Float32Array(this.capacity * this.samples * 3);
    this.times = new Float64Array(this.capacity * this.samples).fill(-Infinity);
    this.weights = new Float32Array(this.capacity * this.samples);
    this.heads = new Uint8Array(this.capacity);
    this.lastSample = new Float64Array(this.capacity).fill(-Infinity);
    for (let slot = 0; slot < this.capacity; slot++) this.owners[slot] = Math.floor((slot + 0.5) * count / this.capacity);
    this.energy = { value: 0, velocity: 0 };
    this.handX = 0.5; this.handY = 0.5; this.lastHandAt = null; this.speed = 0; this.vx = 0; this.vy = 0; this.intervalMs = 60; this.peakSpeed = 0; this.peakAt = -Infinity; this.tracked = false; this.emitting = false;
  }
  hand(hand, now) {
    if (!hand || hand.tracked === false) { this.tracked = false; this.lastHandAt = null; this.speed = 0; this.vx = 0; this.vy = 0; this.peakSpeed = 0; this.peakAt = -Infinity; this.emitting = false; return; }
    if (this.lastHandAt !== null) {
      const dt = Math.max(8, now - this.lastHandAt) / 1000;
      this.vx = hand.vx ?? (hand.x - this.handX) / dt; this.vy = hand.vy ?? (hand.y - this.handY) / dt;
      this.speed = Math.hypot(this.vx, this.vy);
      this.intervalMs = Math.min(300, dt * 1000);
    } else this.speed = 0;
    if (this.speed > FLOW_STATE.trace.speedThreshold) { this.peakSpeed = this.speed; this.peakAt = now; }
    this.handX = hand.x; this.handY = hand.y; this.lastHandAt = now; this.tracked = true;
  }
  update(dt, now, inertia = MOTION.motionInertia) {
    const fresh = this.tracked && now - this.lastHandAt < Math.max(120, this.intervalMs * 1.8);
    const speed = Math.max(this.speed, this.peakSpeed * Math.max(0, 1 - (now - this.peakAt) / 160));
    const target = fresh ? clamp((speed - FLOW_STATE.trace.speedThreshold) / FLOW_STATE.trace.speedRange) : 0;
    this.emitting = target > 0;
    advanceSpring(this.energy, target, springCoefficients(dt, inertia, 1.6));
  }
  clear() {
    this.times.fill(-Infinity); this.weights.fill(0); this.lastSample.fill(-Infinity);
    this.energy.value = 0; this.energy.velocity = 0; this.hand(null, 0);
  }
  capture(slot, world, time, weight) {
    if (weight < 0.035 || time - this.lastSample[slot] < FLOW_STATE.trace.duration / (this.samples - 1)) return;
    const head = (this.heads[slot] + 1) % this.samples;
    this.heads[slot] = head;
    const index = slot * this.samples + head;
    for (let axis = 0; axis < 3; axis++) this.positions[index * 3 + axis] = world[axis];
    this.times[index] = time; this.weights[index] = weight; this.lastSample[slot] = time;
  }
  opacity(index, time) {
    const age = time - this.times[index];
    return age >= 0 && age < FLOW_STATE.trace.duration ? this.weights[index] * (1 - age / FLOW_STATE.trace.duration) ** 2 * FLOW_STATE.trace.opacity : 0;
  }
}

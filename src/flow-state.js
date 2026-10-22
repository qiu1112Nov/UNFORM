import { clamp } from './geometry.js';
import { advanceSpring, MOTION, springCoefficients } from './motion.js';
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
// each spring keeps its live position and velocity. Preview bypasses this wave.
export class FragmentLayers {
  constructor() {
    this.states = Array.from({ length: 3 }, () => ({ value: 0, velocity: 0 }));
    this.goal = 0; this.direction = 1; this.age = 0;
  }
  update(target, dt, inertia = MOTION.motionInertia) {
    if (Math.abs(target - this.goal) > 0.0001) {
      this.direction = target > this.goal ? 1 : -1;
      this.goal = target; this.age = 0;
    }
    const coefficients = springCoefficients(dt, inertia);
    for (let layer = 0; layer < 3; layer++) {
      const rank = this.direction > 0 ? layer : 2 - layer;
      const state = this.states[layer];
      const active = this.age + 1e-8 >= rank * FLOW_STATE.fragment.staggerSeconds;
      advanceSpring(state, active ? this.goal : state.value, coefficients);
    }
    this.age += dt;
  }
}

export function createEdgeFlow(index, count, home) {
  const edgeCount = Math.round(count * 0.35), flowCount = Math.round(count * FLOW_STATE.flow.fraction);
  if (index >= edgeCount || Math.floor((index + 1) * flowCount / edgeCount) === Math.floor(index * flowCount / edgeCount)) return null;
  const edge = EDGES[index % EDGES.length];
  const a = VERTICES[edge[0]], b = VERTICES[edge[1]];
  const t = Math.abs(home[b.findIndex(v => v !== 0)]);
  return { a, b, phase: Math.acos(clamp(1 - 2 * t, -1, 1)), direction: index % 2 ? -1 : 1,
    speed: FLOW_STATE.flow.cyclesPerSecond * (0.65 + ((index * 613) % 997) / 997 * 0.7), position: new Float32Array(home) };
}

export function advanceEdgeFlow(flow, time) {
  const t = (1 - Math.cos(flow.phase + flow.direction * time * flow.speed * Math.PI * 2)) / 2;
  for (let axis = 0; axis < 3; axis++) flow.position[axis] = flow.a[axis] * (1 - t) + flow.b[axis] * t;
}

export class SpatialTrace {
  constructor(count, mobile) {
    const config = FLOW_STATE.trace;
    this.capacity = Math.max(1, Math.round(count * (mobile ? config.mobileFraction : config.desktopFraction)));
    this.samples = mobile ? config.mobileSamples : config.desktopSamples;
    this.owners = new Uint16Array(this.capacity);
    this.positions = new Float32Array(this.capacity * this.samples * 3);
    this.times = new Float64Array(this.capacity * this.samples).fill(-Infinity);
    this.weights = new Float32Array(this.capacity * this.samples);
    this.heads = new Uint8Array(this.capacity);
    this.lastSample = new Float64Array(this.capacity).fill(-Infinity);
    for (let slot = 0; slot < this.capacity; slot++) this.owners[slot] = Math.floor((slot + 0.5) * count / this.capacity);
    this.energy = { value: 0, velocity: 0 };
    this.handX = 0.5; this.handY = 0.5; this.lastHandAt = null; this.speed = 0; this.tracked = false; this.emitting = false;
  }
  hand(hand, now) {
    if (!hand) { this.tracked = false; this.lastHandAt = null; this.speed = 0; this.emitting = false; return; }
    if (this.lastHandAt !== null) {
      const dt = Math.max(8, now - this.lastHandAt) / 1000;
      this.speed = Math.hypot(hand.x - this.handX, hand.y - this.handY) / dt;
    } else this.speed = 0;
    this.handX = hand.x; this.handY = hand.y; this.lastHandAt = now; this.tracked = true;
  }
  update(dt, now, inertia = MOTION.motionInertia) {
    const fresh = this.tracked && now - this.lastHandAt < 120;
    const target = fresh ? clamp((this.speed - FLOW_STATE.trace.speedThreshold) / FLOW_STATE.trace.speedRange) : 0;
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

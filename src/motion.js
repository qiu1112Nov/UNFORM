import { clamp } from './geometry.js';

// UNFORM 3.1 final tuning. Keep the public defaults in one place.
export const MOTION = Object.freeze({
  deconstructionStrength: 0.55,
  motionInertia: 0.65,
  dynamicStyle: 'C', // Hybrid: retained geometric anchors + flowing fragments.
});

// Exact underdamped spring integration, stable across frame rates and pauses.
// Each frame reuses coefficients; interruptions retain current velocity.
export function springCoefficients(dt, inertia = MOTION.motionInertia, rate = 1) {
  const omega = (15 - clamp(inertia) * 9) * rate;
  const damping = 0.98 - clamp(inertia) * 0.24;
  const decay = Math.exp(-damping * omega * dt);
  const frequency = omega * Math.sqrt(1 - damping * damping);
  return { omega, damping, decay, cosine: Math.cos(frequency * dt), sine: Math.sin(frequency * dt) / frequency };
}

export function advanceSpring(state, target, coefficients) {
  const { omega, damping, decay, cosine, sine } = coefficients;
  const offset = state.value - target, velocity = state.velocity;
  state.value = target + decay * (offset * cosine + (velocity + damping * omega * offset) * sine);
  state.velocity = decay * (velocity * cosine - (damping * omega * velocity + omega * omega * offset) * sine);
  return state.value;
}

export const recoveryRate = inertia => 3.4 - clamp(inertia) * 2.5;
export const retained = (index, strength) => ((index * 613) % 997) / 997 >= clamp(strength);

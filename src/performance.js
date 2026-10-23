export const MOBILE_PERFORMANCE = Object.freeze({
  poolCount: 850, initialCount: 595, tiers: Object.freeze([425, 510, 595, 722, 850]),
  traceSamples: 4, maxDPR: 1.5, fadeSeconds: 0.45,
  slowFrameMs: 23, fastFrameMs: 18, slowWorkMs: 12, fastWorkMs: 8,
  downSeconds: 2, upSeconds: 8, cooldownSeconds: 4, warmupSeconds: 1,
  weaveOpacityBuckets: 6,
});

// No frame skipping or changes to hand inference scheduling. Only the visual
// budget changes, with separate sustained-pressure/recovery windows.
export class AdaptiveQuality {
  constructor(mobile) {
    this.mobile = mobile; this.level = 2; this.age = 0; this.lastChange = -Infinity;
    this.slowAge = 0; this.fastAge = 0; this.frameEMA = 16.67; this.workEMA = 0;
    this.fps = 0; this.updateMs = 0; this.drawMs = 0; this.inferenceMs = null;
    this.recognitionPriority = false;
  }
  get count() { return this.mobile ? MOBILE_PERFORMANCE.tiers[this.level] : 1900; }
  observe(intervalMs, updateMs, drawMs, inferenceMs = null, adapt = true) {
    this.updateMs = updateMs; this.drawMs = drawMs; this.inferenceMs = inferenceMs;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 250) return false;
    const dt = intervalMs / 1000, alpha = 1 - Math.exp(-dt);
    this.age += dt;
    this.frameEMA += (intervalMs - this.frameEMA) * alpha;
    this.workEMA += (updateMs + drawMs - this.workEMA) * alpha;
    this.fps = 1000 / this.frameEMA;
    if (!adapt || !this.mobile || this.age < MOBILE_PERFORMANCE.warmupSeconds) return false;
    const slow = (!this.recognitionPriority && this.frameEMA > MOBILE_PERFORMANCE.slowFrameMs) || this.workEMA > MOBILE_PERFORMANCE.slowWorkMs;
    const fast = this.frameEMA < MOBILE_PERFORMANCE.fastFrameMs && this.workEMA < MOBILE_PERFORMANCE.fastWorkMs;
    this.slowAge = slow ? this.slowAge + dt : 0;
    this.fastAge = fast ? this.fastAge + dt : 0;
    if (this.age - this.lastChange < MOBILE_PERFORMANCE.cooldownSeconds) return false;
    let next = this.level;
    if (this.slowAge >= MOBILE_PERFORMANCE.downSeconds) next = Math.max(0, next - 1);
    else if (this.fastAge >= MOBILE_PERFORMANCE.upSeconds) next = Math.min(MOBILE_PERFORMANCE.tiers.length - 1, next + 1);
    if (next === this.level) return false;
    this.level = next; this.lastChange = this.age; this.slowAge = 0; this.fastAge = 0;
    return true;
  }
  resetTiming() { this.slowAge = 0; this.fastAge = 0; this.frameEMA = 16.67; }
}

// A stable, nested selection preserves exact edge/surface/interior proportions
// and 12% FLOW participation without rebuilding particle objects on retuning.
export class ParticleBudget {
  constructor(points, count) {
    this.points = points; this.selected = new Uint8Array(points.length);
    this.opacity = new Float32Array(points.length);
    this.indices = new Uint16Array(points.length); this.length = 0;
    this.groups = [[], [], [], []];
    points.forEach((p, i) => this.groups[p.kind === 'edge' ? (p.flow ? 0 : 1) : p.kind === 'surface' ? 2 : 3].push(i));
    for (const group of this.groups) group.sort((a, b) => ((a * 613) % 997) - ((b * 613) % 997));
    this.setCount(count, true);
  }
  setCount(count, initial = false) {
    this.selected.fill(0);
    const edge = Math.round(count * 0.35), surface = Math.round(count * 0.45), flow = Math.round(count * 0.12);
    const sizes = [flow, edge - flow, surface, count - edge - surface];
    for (let group = 0; group < 4; group++) for (let j = 0; j < sizes[group]; j++) this.selected[this.groups[group][j]] = 1;
    this.length = 0;
    for (let i = 0; i < this.points.length; i++) {
      if (initial) this.opacity[i] = this.selected[i];
      if (this.selected[i] || this.opacity[i] > 0.001) this.indices[this.length++] = i;
    }
    this.count = count;
    this.transitioning = !initial;
  }
  advance(dt) {
    if (!this.transitioning) return;
    const change = dt / MOBILE_PERFORMANCE.fadeSeconds;
    let length = 0, transitioning = false;
    for (let slot = 0; slot < this.length; slot++) {
      const index = this.indices[slot], target = this.selected[index], value = this.opacity[index];
      this.opacity[index] = target ? Math.min(1, value + change) : Math.max(0, value - change);
      if (this.opacity[index] !== target) transitioning = true;
      if (target || this.opacity[index] > 0) this.indices[length++] = index;
    }
    this.length = length;
    this.transitioning = transitioning;
  }
}

// Recognition load adapts before removing visual detail. Model tensor sizes
// are fixed upstream: smaller frames reduce capture/preprocessing, not all CNN work.
export const INFERENCE_PERFORMANCE = Object.freeze({
  mobileSizes: Object.freeze([256, 320, 384, 480]), desktopSize: 640,
  downMs: 500, upMs: 8000, cooldownMs: 1500,
  slowModelMs: 35, slowRoundTripMs: 48, fastModelMs: 22, fastRoundTripMs: 32,
});

export class InferenceQuality {
  constructor(mobile) {
    this.mobile = mobile; this.level = INFERENCE_PERFORMANCE.mobileSizes.length - 1;
    this.last = null; this.changedAt = -Infinity; this.slowMs = 0; this.fastMs = 0;
  }
  get size() { return this.mobile ? INFERENCE_PERFORMANCE.mobileSizes[this.level] : INFERENCE_PERFORMANCE.desktopSize; }
  dimensions(width, height) {
    const scale = Math.min(1, this.size / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  observe(now, modelMs, roundTripMs, render = null) {
    const elapsed = this.last === null ? 0 : Math.min(250, Math.max(0, now - this.last));
    this.last = now;
    if (!this.mobile || !Number.isFinite(modelMs) || !Number.isFinite(roundTripMs)) return false;
    const p = INFERENCE_PERFORMANCE;
    const renderPressure = render && render.frameEMA > 23 && render.workEMA < 12;
    const slow = modelMs > p.slowModelMs || roundTripMs > p.slowRoundTripMs || renderPressure;
    const fast = modelMs < p.fastModelMs && roundTripMs < p.fastRoundTripMs && (!render || render.frameEMA < 19);
    this.slowMs = slow ? this.slowMs + elapsed : 0;
    this.fastMs = fast ? this.fastMs + elapsed : 0;
    if (now - this.changedAt < p.cooldownMs) return false;
    let next = this.level;
    if (this.slowMs >= p.downMs) next = Math.max(0, next - 1);
    else if (this.fastMs >= p.upMs) next = Math.min(p.mobileSizes.length - 1, next + 1);
    if (next === this.level) return false;
    this.level = next; this.changedAt = now; this.slowMs = 0; this.fastMs = 0;
    return true;
  }
}

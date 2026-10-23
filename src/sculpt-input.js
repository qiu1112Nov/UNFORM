export const SCULPT_INPUT = Object.freeze({ fastSpeed: 420, fastDistance: 6,
  maxSampleMs: 50, scatterVelocity: 3.5, scatterSampleMs: 16 });

// CSS-pixel velocity, independent of event frequency and canvas DPR. A short
// directional run rejects isolated tiny jitter. Scatter stays latched until up.
export function strokeIntent(point, x, y, now) {
  if (point.intent === 'SCATTER') return 'SCATTER';
  const distance = Math.hypot(x - point.x, y - point.y);
  const elapsed = Math.max(1, Math.min(SCULPT_INPUT.maxSampleMs, now - point.time));
  if (distance / elapsed * 1000 >= SCULPT_INPUT.fastSpeed) {
    if (!point.fastCandidate) {
      point.fastX = point.x; point.fastY = point.y; point.fastCandidate = true;
    }
    if (Math.hypot(x - point.fastX, y - point.fastY) >= SCULPT_INPUT.fastDistance) point.intent = 'SCATTER';
  } else point.fastCandidate = false;
  return point.intent;
}

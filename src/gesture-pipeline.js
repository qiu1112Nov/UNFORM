import { clamp, handGesture } from './geometry.js';

export const GESTURE_TIMING = Object.freeze({ confirmMs: 80, maxFPS: 30, previewActivation: 0.14, lossGraceMs: 350, evidenceGapMs: 350, latchMs: 180 });

// Landmark validity is a quality gate, not a fabricated model confidence score.
// MediaPipe's own detection/presence/tracking thresholds still apply upstream.
export function credibleHand(landmarks) {
  if (landmarks?.length !== 21 || !landmarks.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > -0.25 && p.x < 1.25 && p.y > -0.25 && p.y < 1.25)) return null;
  if (Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y) < 0.015) return null;
  return handGesture(landmarks);
}

export class GestureResponse {
  constructor() { this.reset(); }
  reset() {
    this.confirmed = null; this.candidate = null; this.position = null;
    this.lastTime = null; this.lastSeen = null; this.serial = 0; this.event = null;
    this.confirmationMs = null; this.stage = 'waiting';
    this.target = null; this.holdUntil = -Infinity;
    this.lastUpdate = null; this.cadenceMs = 60; this.graceMs = GESTURE_TIMING.lossGraceMs;
  }
  update(hand, now, sampledAt = now) {
    if (hand && this.lastSeen !== null && now - this.lastSeen > this.graceMs) {
      const serial = this.serial; this.reset(); this.serial = serial;
    }
    if (this.lastUpdate !== null && now > this.lastUpdate && now - this.lastUpdate < 1000) {
      this.cadenceMs = Math.min(300, now - this.lastUpdate);
    }
    this.lastUpdate = now;
    if (!hand) {
      if (this.lastSeen === null || now - this.lastSeen > this.graceMs) {
        // Keep event IDs monotonic even after tracking loss.
        const serial = this.serial; this.reset(); this.serial = serial; this.stage = 'no hand';
        return null;
      }
      if (this.candidate && now - this.candidate.last > Math.max(GESTURE_TIMING.evidenceGapMs, this.graceMs)) this.candidate = null;
      this.stage = 'tracking grace';
      return this.output(now, false);
    }
    this.graceMs = Math.max(GESTURE_TIMING.lossGraceMs, Math.min(750, this.cadenceMs * 2.5));
    // Continuous movement is independent of pose confirmation. The renderer
    // already has a dt spring; do not low-pass positions a second time here.
    const dt = this.lastTime === null ? 0 : (sampledAt - this.lastTime) / 1000;
    const vx = dt > 0 && this.position ? (hand.x - this.position.x) / dt : 0;
    const vy = dt > 0 && this.position ? (hand.y - this.position.y) / dt : 0;
    this.position = { x: clamp(hand.x), y: clamp(hand.y), openness: hand.openness, vx, vy };
    this.lastTime = sampledAt; this.lastSeen = now;
    const trend = hand.openness >= 0.68 ? 1 : hand.openness <= 0.32 ? 0 : null;
    if (this.candidate && now - this.candidate.last > Math.max(GESTURE_TIMING.evidenceGapMs, this.graceMs)) this.candidate = null;
    if (trend !== null && trend !== this.confirmed) {
      if (this.candidate?.goal !== trend) {
        this.candidate = { goal: trend, since: now, last: now, samples: 0 };
        this.event = { id: ++this.serial, observedAt: now };
        this.confirmationMs = null;
      }
      this.candidate.last = now; this.candidate.samples++;
      const age = now - this.candidate.since;
      if (age >= GESTURE_TIMING.confirmMs && this.candidate.samples >= 2) {
        this.confirmed = trend; this.confirmationMs = age; this.candidate = null;
        this.stage = 'confirmed';
      } else this.stage = 'pre-response';
    } else {
      // An uncertain frame may bridge a brief dropout, but adds no evidence.
      if (trend === this.confirmed) this.candidate = null;
      this.stage = this.confirmed === null ? 'uncertain' : 'tracking';
    }
    return this.output(now, true, trend !== null);
  }
  output(now, tracked, preview = tracked) {
    if (this.confirmed !== null && (this.target === null || now >= this.holdUntil) && this.target !== this.confirmed) {
      this.target = this.confirmed; this.holdUntil = now + GESTURE_TIMING.latchMs;
    }
    const baseline = this.target ?? 0;
    const feedback = preview && this.candidate ? Math.sign(this.candidate.goal - baseline) : 0;
    return { ...this.position, sampledAt: this.lastTime, tracked, validUntil: this.lastSeen + this.graceMs,
      targetActivation: baseline, activation: baseline + feedback * GESTURE_TIMING.previewActivation,
      feedback, response: this.event };
  }
}

// One serial inference per fresh decoded frame. rVFC follows camera delivery;
// RAF is only a fallback. Slow inference automatically lowers the duty cycle.
export class VideoFramePump {
  constructor(video, process, onFrame = () => {}, clock = () => performance.now()) {
    this.video = video; this.process = process; this.onFrame = onFrame; this.clock = clock;
    this.running = false; this.handle = null; this.kind = null;
    this.lastMediaTime = -1; this.lastDetection = -Infinity; this.cost = 0;
    this.busy = false; this.lastCallback = 0; this.watchdog = null; this.forceRAF = false;
    this.costFactor = 1.5;
  }
  start() {
    if (this.running) return;
    this.running = true; this.lastCallback = this.clock(); this.schedule();
    this.watchdog = setInterval(() => {
      if (this.running && this.kind === 'video' && this.clock() - this.lastCallback > 1500) {
        this.video.cancelVideoFrameCallback?.(this.handle);
        this.forceRAF = true; this.schedule();
      }
    }, 500);
    this.watchdog.unref?.();
  }
  schedule() {
    if (!this.running) return;
    const callback = (now, metadata) => this.tick(now, metadata);
    if (!this.forceRAF && typeof this.video.requestVideoFrameCallback === 'function') {
      this.kind = 'video'; this.handle = this.video.requestVideoFrameCallback(callback);
    } else { this.kind = 'raf'; this.handle = requestAnimationFrame(callback); }
  }
  tick(_now, metadata) {
    if (!this.running) return;
    const mediaTime = Math.max(Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime : -1,
      Number.isFinite(this.video.currentTime) ? this.video.currentTime : -1);
    if (this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0 && mediaTime >= 0 && mediaTime !== this.lastMediaTime) {
      this.lastCallback = this.clock(); this.lastMediaTime = mediaTime;
      const now = this.clock(); this.onFrame(now);
      // Small timestamp jitter must not turn a 30fps camera into 15fps inference.
      if (!this.busy && now - this.lastDetection + 2 >= this.intervalMs) {
        this.lastDetection = now;
        const cost = this.process(now);
        if (cost && typeof cost.then === 'function') {
          this.busy = true;
          cost.then(value => { if (this.running) this.recordCost(value); }).catch(() => this.stop()).finally(() => { this.busy = false; });
        } else this.recordCost(cost);
      }
    }
    this.schedule();
  }
  recordCost(cost) { if (Number.isFinite(cost)) this.cost = this.cost ? this.cost * 0.7 + cost * 0.3 : cost; }
  get intervalMs() { return Math.max(1000 / GESTURE_TIMING.maxFPS, this.cost * this.costFactor); }
  stop() {
    this.running = false; clearInterval(this.watchdog); this.watchdog = null;
    if (this.handle !== null) {
      if (this.kind === 'video') this.video.cancelVideoFrameCallback?.(this.handle);
      else cancelAnimationFrame(this.handle);
    }
    this.handle = null;
  }
}

export class GestureMetrics {
  constructor() { this.reset(); }
  reset() {
    this.frames = []; this.inferences = [];
    this.inferenceMs = null; this.confirmationMs = null;
    this.animationStartMs = null; this.renderQueueMs = null; this.responseId = null;
    this.stage = 'waiting';
  }
  frame(now) { this.frames.push(now); this.trim(this.frames, now); }
  trim(list, now) { while (list.length && now - list[0] > 1000) list.shift(); }
  inference(now, duration, response, controller) {
    this.inferences.push(now); this.trim(this.inferences, now);
    this.inferenceMs = duration; this.stage = controller.stage;
    this.confirmationMs = controller.confirmationMs;
    if ((response?.response?.id ?? null) !== this.responseId) {
      this.responseId = response?.response?.id ?? null;
      this.animationStartMs = null; this.renderQueueMs = null;
    }
  }
  rendered(sample) {
    if (sample.id !== this.responseId) return;
    this.animationStartMs = sample.animationStartMs; this.renderQueueMs = sample.renderQueueMs;
  }
  snapshot(now) {
    this.trim(this.frames, now); this.trim(this.inferences, now);
    const fps = list => list.length > 1 ? (list.length - 1) * 1000 / Math.max(1, list.at(-1) - list[0]) : 0;
    return { cameraFPS: fps(this.frames), inferenceFPS: fps(this.inferences), inferenceMs: this.inferenceMs, confirmationMs: this.confirmationMs, animationStartMs: this.animationStartMs, renderQueueMs: this.renderQueueMs, stage: this.stage };
  }
}

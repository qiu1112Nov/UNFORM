import { clamp, handGesture } from './geometry.js';

export const GESTURE_TIMING = Object.freeze({ confirmMs: 80, maxFPS: 30, previewActivation: 0.14 });

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
    this.lastTime = null; this.serial = 0; this.event = null;
    this.confirmationMs = null; this.stage = 'waiting';
  }

  update(hand, now) {
    if (!hand) {
      this.candidate = null; this.position = null; this.lastTime = null;
      this.confirmed = null; this.event = null; this.stage = 'no hand';
      this.confirmationMs = null;
      return null;
    }
    const dt = this.lastTime === null ? 100 : Math.max(0, now - this.lastTime);
    const alpha = 1 - Math.exp(-dt / 30);
    this.position = this.position ? { x: this.position.x + (hand.x - this.position.x) * alpha, y: this.position.y + (hand.y - this.position.y) * alpha } : { x: hand.x, y: hand.y };
    this.lastTime = now;
    // Separate open/closed thresholds provide hysteresis; uncertain poses cannot
    // confirm a large change. No openness EMA precedes the confirmation clock.
    const trend = hand.openness >= 0.68 ? 1 : hand.openness <= 0.32 ? 0 : null;
    const baseline = this.confirmed ?? 0;
    let activation = baseline, feedback = 0;
    if (trend !== null && trend !== this.confirmed) {
      if (this.candidate?.goal !== trend) {
        this.candidate = { goal: trend, since: now, samples: 0 };
        this.event = { id: ++this.serial, observedAt: now };
        this.confirmationMs = null;
      }
      this.candidate.samples++;
      const age = now - this.candidate.since;
      if (age >= GESTURE_TIMING.confirmMs && this.candidate.samples >= 2) {
        this.confirmed = trend; this.confirmationMs = age;
        this.candidate = null; this.stage = 'confirmed'; activation = trend;
      } else {
        this.stage = 'pre-response';
        activation = baseline + clamp(trend - baseline, -GESTURE_TIMING.previewActivation, GESTURE_TIMING.previewActivation);
        feedback = Math.sign(trend - baseline);
      }
    } else {
      this.candidate = null;
      this.stage = this.confirmed === null ? 'uncertain' : 'tracking';
    }
    return { ...this.position, openness: hand.openness, activation, feedback, response: this.event };
  }
}

// One serial inference per fresh decoded frame. rVFC follows camera delivery;
// RAF is only a fallback. Slow inference automatically lowers the duty cycle.
export class VideoFramePump {
  constructor(video, process, onFrame = () => {}, clock = () => performance.now()) {
    this.video = video; this.process = process; this.onFrame = onFrame; this.clock = clock;
    this.running = false; this.handle = null; this.kind = null;
    this.lastMediaTime = -1; this.lastDetection = -Infinity; this.cost = 0;
  }
  start() { if (!this.running) { this.running = true; this.schedule(); } }
  schedule() {
    if (!this.running) return;
    const callback = (now, metadata) => this.tick(now, metadata);
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.kind = 'video'; this.handle = this.video.requestVideoFrameCallback(callback);
    } else { this.kind = 'raf'; this.handle = requestAnimationFrame(callback); }
  }
  tick(_now, metadata) {
    if (!this.running) return;
    const mediaTime = metadata?.mediaTime ?? this.video.currentTime;
    if (this.video.readyState >= 2 && mediaTime !== this.lastMediaTime) {
      this.lastMediaTime = mediaTime;
      const now = this.clock(); this.onFrame(now);
      // Small timestamp jitter must not turn a 30fps camera into 15fps inference.
      if (now - this.lastDetection + 2 >= Math.max(1000 / GESTURE_TIMING.maxFPS, this.cost * 1.5)) {
        this.lastDetection = now;
        const cost = this.process(now);
        if (Number.isFinite(cost)) this.cost = this.cost ? this.cost * 0.7 + cost * 0.3 : cost;
      }
    }
    this.schedule();
  }
  stop() {
    this.running = false;
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

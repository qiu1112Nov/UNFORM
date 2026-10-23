import { springCoefficients, advanceSpring } from './motion.js';

// CSS-pixel thresholds are independent of mobile particle count and canvas DPR.
export const IMPRINT = Object.freeze({ pauseSeconds: 0.55, pulseSeconds: 0.45, stablePixels: 4,
  minDragPixels: 8, minDeformationPixels: 3, radius: 0.62, retention: 0.6,
  dragGain: 1.35, activeRate: 1.8, releaseRate: 1.3,
  settlePixels: 0.6, settleSpeedPixels: 3, noticeSeconds: 0.9,
  maxDrag: 0.32, maxOffset: 0.24, maxCommits: 24, maxSessions: 4, maxReleaseTails: 24 });

export class ShapeMemory {
  constructor() { this.commits = []; this.sessions = new Map(); this.result = new Float64Array(3); this.notice = null; }
  begin(id, anchor, x, y, now, pixelScale = 100) {
    if (this.sessions.get(id)?.active) return;
    let active = 0, quietestKey, quietest = Infinity;
    for (const [key, session] of this.sessions) {
      if (session.active) active++;
      else {
        const magnitude = session.motion.reduce((sum, m) => sum + m.value ** 2, 0);
        if (magnitude < quietest) { quietest = magnitude; quietestKey = key; }
      }
    }
    if (active >= IMPRINT.maxSessions) return;
    this.notice = null;
    // Release springs must not occupy the slots for new active strokes.
    if (this.sessions.size >= IMPRINT.maxSessions + IMPRINT.maxReleaseTails) this.sessions.delete(quietestKey);
    const previous = this.sessions.get(id);
    if (previous) { this.sessions.delete(id); this.sessions.set(Symbol('release'), previous); }
    this.sessions.set(id, { anchor: [...anchor], x, y, startX: x, startY: y, stableX: x, stableY: y,
      time: now, pixelScale, dwell: 0, active: true, blocked: false, committed: false, stage: 'ELASTIC',
      hinted: false, pulseAge: Infinity, rawGoalLength: 0, goal: new Float64Array(3),
      motion: Array.from({ length: 3 }, () => ({ value: 0, velocity: 0 })) });
  }
  move(id, x, y, now, offset) {
    const s = this.sessions.get(id); if (!s?.active) return;
    if (Math.hypot(x - s.stableX, y - s.stableY) > IMPRINT.stablePixels) {
      s.dwell = 0; s.hinted = false; s.pulseAge = Infinity; s.stage = 'ELASTIC';
      s.stableX = x; s.stableY = y;
    }
    s.x = x; s.y = y; s.time = now;
    const length = Math.hypot(...offset);
    s.rawGoalLength = Math.min(length, IMPRINT.maxDrag);
    const scale = Math.min(IMPRINT.dragGain, IMPRINT.maxDrag / (length || 1));
    for (let a = 0; a < 3; a++) s.goal[a] = offset[a] * scale;
  }
  effective(s) {
    return !s.blocked && Math.hypot(s.x - s.startX, s.y - s.startY) >= IMPRINT.minDragPixels &&
      s.rawGoalLength * IMPRINT.retention * s.pixelScale >= IMPRINT.minDeformationPixels;
  }
  // Only a normal pointer release may commit. Never called by hand inference.
  end(id, commit = false) {
    const s = this.sessions.get(id); if (!s?.active) return false;
    s.active = false; s.dwell = 0; s.pulseAge = Infinity;
    if (!commit || !this.effective(s)) return false;
    if (this.commits.length >= IMPRINT.maxCommits) { s.stage = 'LIMIT'; return false; }
    const offset = Array.from(s.goal, value => value * IMPRINT.retention);
    this.commits.push({ anchor: [...s.anchor], offset });
    // Preserve the exact live sum and velocity, even if release precedes the next
    // animation frame. The residual spring settles around the new material rest.
    for (let a = 0; a < 3; a++) s.motion[a].value -= offset[a];
    s.committed = true; s.stage = 'COMMIT';
    this.notice = { session: s, displayed: false, age: 0 };
    return true;
  }
  blockActive() {
    this.notice = null;
    // A stroke that ever joined multitouch stays ineligible until all fingers lift.
    for (const s of this.sessions.values()) if (s.active) {
      s.blocked = true; s.dwell = 0; s.pulseAge = Infinity;
    }
  }
  cancelAll() { this.notice = null; for (const id of this.sessions.keys()) this.end(id); }
  update(dt, inertia, allowFeedback) {
    const activeCoefficients = springCoefficients(dt, inertia, IMPRINT.activeRate);
    const releaseCoefficients = springCoefficients(dt, inertia, IMPRINT.releaseRate);
    let feedback = null;
    if (this.notice?.displayed) {
      this.notice.age += dt;
      if (this.notice.age >= IMPRINT.noticeSeconds) { this.notice = null; feedback = 'CLEAR'; }
    }
    for (const [id, s] of this.sessions) {
      let speedSquared = 0, magnitudeSquared = 0;
      for (let a = 0; a < 3; a++) {
        advanceSpring(s.motion[a], s.active ? s.goal[a] : 0, s.active ? activeCoefficients : releaseCoefficients);
        speedSquared += s.motion[a].velocity ** 2; magnitudeSquared += s.motion[a].value ** 2;
      }
      s.pulseAge += dt;
      const eligible = allowFeedback && s.active && this.effective(s);
      s.dwell = eligible ? s.dwell + dt : 0;
      if (!allowFeedback) s.pulseAge = Infinity;
      if (s.dwell >= IMPRINT.pauseSeconds && !s.hinted) {
        s.hinted = true; s.pulseAge = 0; s.stage = 'PAUSE';
      }
      if (this.notice?.session === s && !this.notice.displayed &&
          magnitudeSquared * s.pixelScale ** 2 <= IMPRINT.settlePixels ** 2 &&
          speedSquared * s.pixelScale ** 2 <= IMPRINT.settleSpeedPixels ** 2) {
        this.notice.displayed = true; feedback = 'SETTLED';
      }
      if (!s.active && magnitudeSquared < 1e-10 && speedSquared < 1e-8) this.sessions.delete(id);
    }
    return feedback;
  }
  deform(point, destination) {
    if (!this.commits.length && !this.sessions.size) {
      for (let a = 0; a < 3; a++) destination[a] = point[a];
      return destination;
    }
    const sum = this.result; sum.fill(0);
    for (const patch of this.commits) this.add(point, patch.anchor, patch.offset, sum);
    for (const s of this.sessions.values()) {
      const dx = point[0] - s.anchor[0], dy = point[1] - s.anchor[1], dz = point[2] - s.anchor[2];
      const w = Math.max(0, 1 - (dx * dx + dy * dy + dz * dz) / IMPRINT.radius ** 2) ** 2;
      for (let a = 0; a < 3; a++) sum[a] += s.motion[a].value * w;
    }
    const scale = Math.min(1, IMPRINT.maxOffset / (Math.hypot(...sum) || 1));
    for (let a = 0; a < 3; a++) destination[a] = point[a] + sum[a] * scale;
    return destination;
  }
  add(point, anchor, offset, sum) {
    const dx = point[0] - anchor[0], dy = point[1] - anchor[1], dz = point[2] - anchor[2];
    const w = Math.max(0, 1 - (dx * dx + dy * dy + dz * dz) / IMPRINT.radius ** 2) ** 2;
    for (let a = 0; a < 3; a++) sum[a] += offset[a] * w;
  }
  undo() { this.notice = null; this.sessions.clear(); return Boolean(this.commits.pop()); }
  restore() { this.notice = null; this.sessions.clear(); this.commits.length = 0; }
}

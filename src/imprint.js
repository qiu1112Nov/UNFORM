import { springCoefficients, advanceSpring } from './motion.js';

// Object-space material field shared by particles, FLOW and the woven skeleton.
export const IMPRINT = Object.freeze({ dwellSeconds: 3, stablePixels: 6, minDragPixels: 10,
  maxSlowSpeed: 180, radius: 0.55, retention: 0.6, maxDrag: 0.32, maxOffset: 0.24,
  maxCommits: 24, maxSessions: 4 });

export class ShapeMemory {
  constructor() { this.commits = []; this.sessions = new Map(); this.result = new Float64Array(3); }
  begin(id, anchor, x, y, now) {
    if (this.sessions.size >= IMPRINT.maxSessions) return;
    this.sessions.set(id, { anchor: [...anchor], x, y, startX: x, startY: y, stableX: x, stableY: y,
      time: now, dwell: 0, slow: false, slowTravel: 0, active: true, committed: false, stage: 'ELASTIC',
      goal: new Float64Array(3), retained: new Float64Array(3),
      motion: Array.from({ length: 3 }, () => ({ value: 0, velocity: 0 })) });
  }
  move(id, x, y, now, offset) {
    const s = this.sessions.get(id); if (!s?.active) return;
    const distance = Math.hypot(x - s.x, y - s.y);
    if (distance > 0.5) {
      // Idle time before a swipe must not make that swipe appear slow.
      const speed = distance / Math.max(0.008, Math.min(0.1, (now - s.time) / 1000));
      s.slowTravel = speed <= IMPRINT.maxSlowSpeed ? s.slowTravel + distance : 0;
      s.slow = s.slowTravel >= IMPRINT.minDragPixels;
      if (!s.slow) s.dwell = 0;
    }
    if (Math.hypot(x - s.stableX, y - s.stableY) > IMPRINT.stablePixels) {
      s.dwell = 0; s.stableX = x; s.stableY = y;
    }
    s.x = x; s.y = y; s.time = now;
    const length = Math.hypot(...offset), scale = Math.min(1, IMPRINT.maxDrag / (length || 1));
    for (let a = 0; a < 3; a++) s.goal[a] = offset[a] * scale;
  }
  end(id) { const s = this.sessions.get(id); if (s) { s.active = false; s.dwell = 0; } }
  cancelAll() { for (const id of this.sessions.keys()) this.end(id); }
  update(dt, inertia, allowCommit) {
    const coefficients = springCoefficients(dt, inertia, 1.3);
    let committed = false;
    for (const [id, s] of this.sessions) {
      let speedSquared = 0, magnitudeSquared = 0;
      for (let a = 0; a < 3; a++) {
        advanceSpring(s.motion[a], s.active ? s.goal[a] - s.retained[a] : 0, coefficients);
        speedSquared += s.motion[a].velocity ** 2; magnitudeSquared += s.motion[a].value ** 2;
      }
      const eligible = allowCommit && s.active && !s.committed && s.slow &&
        Math.hypot(s.x - s.startX, s.y - s.startY) >= IMPRINT.minDragPixels;
      s.dwell = eligible ? s.dwell + dt : 0;
      if (s.dwell >= IMPRINT.dwellSeconds && speedSquared < 0.0004 && this.commits.length < IMPRINT.maxCommits) {
        s.stage = 'IMPRINT';
        const offset = s.motion.map(m => m.value * IMPRINT.retention);
        this.commits.push({ anchor: [...s.anchor], offset });
        // Transfer displacement between layers, retaining the exact visible sum.
        for (let a = 0; a < 3; a++) { s.retained[a] += offset[a]; s.motion[a].value -= offset[a]; }
        s.committed = true; s.stage = 'COMMIT'; committed = true;
      }
      if (!s.active && magnitudeSquared < 1e-10 && speedSquared < 1e-8) this.sessions.delete(id);
    }
    return committed;
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
  undo() { this.sessions.clear(); return Boolean(this.commits.pop()); }
  restore() { this.sessions.clear(); this.commits.length = 0; }
}

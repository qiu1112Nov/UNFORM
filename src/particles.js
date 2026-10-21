import { clamp, formPoint } from './geometry.js';

export class ParticleField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas 2D is unavailable.');
    this.mobile = matchMedia('(max-width: 800px)').matches || (navigator.hardwareConcurrency || 4) <= 4;
    this.count = this.mobile ? 850 : 1900;
    this.points = Array.from({ length: this.count }, (_, i) => ({
      position: [0, 0, 0], target: formPoint('circle', i, this.count),
      seed: ((i * 16807) % 2147483647) / 2147483647 * 90,
      angle: i * 2.399963, radius: 0.55 + ((i * 7919) % 997) / 997 * 0.8,
    }));
    this.form = 'circle'; this.dispersion = 0.18; this.impulse = 0;
    this.focus = null; this.hand = null; this.pointers = new Map();
    this.time = 0; this.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reducedMotion = this.paused;
    this.frame = 0; this.last = 0; this.centerX = 0; this.centerY = 0;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(this.frame);
      if (!document.hidden) { this.last = 0; this.frame = requestAnimationFrame(this.animate); }
    });
  }

  resize() {
    this.width = window.innerWidth; this.height = window.innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, this.mobile ? 1.5 : 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.compact = this.width <= 800;
    this.originX = this.width * (this.compact ? 0.51 : 0.67);
    this.originY = this.height * (this.compact ? 0.55 : 0.47);
    this.scale = this.compact ? Math.min(this.width * 0.36, this.height * 0.19) : Math.min(this.width * 0.23, this.height * 0.31);
    if (!this.centerX) { this.centerX = this.originX; this.centerY = this.originY; }
    this.draw();
  }

  setForm(form) {
    this.form = form;
    this.points.forEach((p, i) => { p.target = formPoint(form, i, this.count); });
  }

  reset() {
    this.focus = null; this.hand = null; this.pointers.clear(); this.impulse = 0;
    this.dispersion = 0.18; this.setForm('circle');
  }

  animate(now) {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60;
    this.last = now;
    if (!this.paused) { this.time += dt; this.update(dt); this.draw(); }
    this.frame = requestAnimationFrame(this.animate);
  }

  update(dt) {
    const follow = 1 - Math.exp(-dt * 4.5);
    const hand = this.hand;
    let targetX = this.originX, targetY = this.originY;
    if (hand) {
      targetX = this.width * (0.15 + hand.x * 0.7);
      targetY = this.height * (0.2 + hand.y * 0.5);
    } else if (this.focus) {
      targetX += (this.focus.x - this.originX) * 0.38;
      targetY += (this.focus.y - this.originY) * 0.38;
    }
    this.centerX += (targetX - this.centerX) * follow;
    this.centerY += (targetY - this.centerY) * follow;
    let spread = this.dispersion;
    if (hand) spread = hand.openness;
    else if (this.pointers.size > 1) {
      const [a, b] = [...this.pointers.values()];
      spread = clamp(Math.hypot(a.x - b.x, a.y - b.y) / (Math.min(this.width, this.height) * 0.65));
    } else if (this.pointers.size) spread = Math.max(spread, 0.82);
    this.impulse += (spread - this.impulse) * follow;
    const t = this.time;
    for (const p of this.points) {
      for (let axis = 0; axis < 3; axis++) p.position[axis] += (p.target[axis] - p.position[axis]) * follow;
      const [x, y, z] = p.position;
      const rotate = this.form === 'circle' ? t * 0.12 : Math.sin(t * 0.13) * 0.12;
      const rx = x * Math.cos(rotate) + z * Math.sin(rotate);
      const rz = -x * Math.sin(rotate) + z * Math.cos(rotate);
      const a = p.angle + t * 0.045;
      const burst = this.impulse * p.radius;
      let sx = rx * (1 + this.impulse * 0.5) + Math.cos(a) * burst;
      let sy = y * (1 + this.impulse * 0.5) + Math.sin(a) * burst;
      sx += Math.sin(t * 0.5 + p.seed) * (0.012 + this.impulse * 0.08);
      sy += Math.cos(t * 0.4 + p.seed) * (0.012 + this.impulse * 0.08);
      const tilt = -0.23;
      const px = (sx * Math.cos(tilt) - sy * Math.sin(tilt)) * this.scale + this.centerX;
      const py = (sx * Math.sin(tilt) + sy * Math.cos(tilt)) * this.scale + this.centerY;
      p.x = px; p.y = py; p.depth = rz;
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#101111'; ctx.fillRect(0, 0, this.width, this.height);
    // Quiet drafting marks give the field a measured, editorial frame.
    ctx.strokeStyle = '#ffffff07'; ctx.lineWidth = 1;
    const cx = this.originX, cy = this.originY, r = this.scale * 1.25;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([2, 8]); ctx.beginPath();
    ctx.moveTo(cx - r - 25, cy); ctx.lineTo(cx + r + 25, cy);
    ctx.moveTo(cx, cy - r - 25); ctx.lineTo(cx, cy + r + 25); ctx.stroke(); ctx.setLineDash([]);
    if (!this.points[0].x) this.update(1);
    // One path per opacity group avoids thousands of state changes per frame.
    for (let group = 0; group < 3; group++) {
      ctx.fillStyle = ['#777b7266', '#bfc3b4aa', '#eeede7'][group];
      ctx.beginPath();
      for (let i = group; i < this.count; i += 3) {
        const p = this.points[i];
        const radius = (this.mobile ? 0.8 : 0.85) + (p.depth + 1) * 0.32;
        ctx.moveTo(p.x + radius, p.y); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    if (this.form === 'lines' || this.form === 'grid') {
      ctx.strokeStyle = '#eeede710'; ctx.lineWidth = 0.5; ctx.beginPath();
      const step = this.form === 'lines' ? 9 : 1;
      for (let i = 0; i < this.count - step; i += 2) {
        const a = this.points[i], b = this.points[i + step];
        if (Math.hypot(a.x - b.x, a.y - b.y) < this.scale * 0.2) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke();
    }
  }
}

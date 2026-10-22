import { clamp, formPoint } from './geometry.js';
import { advanceSpring, MOTION, recoveryRate, retained, springCoefficients } from './motion.js';
import { buildSurfaceMesh, nearestThread, octahedronParticle, segmentDistance, WeaveNetwork } from './octahedron.js';

export class ParticleField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas 2D is unavailable.');
    this.mobile = matchMedia('(max-width: 800px)').matches || (navigator.hardwareConcurrency || 4) <= 4;
    this.count = this.mobile ? 850 : 1900;
    this.mesh = buildSurfaceMesh(this.mobile ? 6 : 8);
    this.weave = new WeaveNetwork(this.mesh);
    this.points = Array.from({ length: this.count }, (_, i) => {
      const sample = octahedronParticle(i, this.count);
      return {
        kind: sample.kind, home: sample.point, position: [...sample.point], target: [...sample.point],
        motion: sample.point.map(value => ({ value, velocity: 0 })),
        deformation: { value: 0, velocity: 0 },
        scatterMotion: { value: 0, velocity: 0 },
        thread: sample.kind === 'interior' ? null : nearestThread(sample.point, this.mesh),
        seed: i * 2.399963, radius: 0.5 + ((i * 7919) % 997) / 997 * 0.7,
        scatter: 0, x: 0, y: 0, depth: 0,
      };
    });
    this.form = 'octahedron'; this.dispersion = MOTION.deconstructionStrength;
    this.inertia = MOTION.motionInertia;
    this.activation = { value: 0, velocity: 0 }; this.impulse = 0;
    this.centerMotionX = { value: 0, velocity: 0 }; this.centerMotionY = { value: 0, velocity: 0 };
    this.focus = null; this.hand = null; this.pointers = new Map();
    this.time = 0; this.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reducedMotion = this.paused;
    this.frame = 0; this.last = 0;
    this.nodeScreens = this.mesh.nodes.map(() => ({ x: 0, y: 0, depth: 0 }));
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(this.frame);
      if (document.hidden) this.clearPointers();
      else { this.last = 0; this.frame = requestAnimationFrame(this.animate); }
    });
  }

  resize() {
    this.width = window.innerWidth; this.height = window.innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, this.mobile ? 1.5 : 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Read the actual layout, reserving separate title, sculpture and control bands.
    const intro = document.querySelector('.intro')?.getBoundingClientRect();
    const status = document.querySelector('.status-line')?.getBoundingClientRect();
    this.artTop = (intro?.bottom ?? this.height * 0.2) + 12;
    this.artBottom = Math.max(this.artTop + 32, (status?.top ?? this.height * 0.8) - 12);
    this.originX = this.width / 2;
    this.originY = (this.artTop + this.artBottom) / 2;
    this.scale = Math.max(12, Math.min(this.width * 0.37, (this.artBottom - this.artTop) * 0.43));
    this.centerX = this.originX; this.centerY = this.originY;
    this.centerMotionX = { value: this.centerX, velocity: 0 };
    this.centerMotionY = { value: this.centerY, velocity: 0 };
    this.projectAll(); this.draw();
  }

  setForm(form) {
    this.form = form; this.clearPointers(); this.weave.clear();
    this.points.forEach((p, i) => { p.target = form === 'octahedron' ? p.home : formPoint(form, i, this.count); });
  }

  reset() {
    this.focus = null; this.hand = null;
    this.dispersion = MOTION.deconstructionStrength; this.inertia = MOTION.motionInertia;
    this.setForm('octahedron');
  }

  nearestNode(point) {
    let index = -1, distance = Math.max(34, this.scale * 0.3);
    this.nodeScreens.forEach((node, i) => {
      const d = Math.hypot(node.x - point.x, node.y - point.y);
      if (d < distance) { index = i; distance = d; }
    });
    return index;
  }

  pointerDown(id, x, y, now) {
    const point = { x, y, time: now, quiet: 0, tearing: false };
    this.pointers.set(id, point); this.focus = point;
    if (this.form === 'octahedron') {
      const node = this.nearestNode(point);
      if (node >= 0) this.weave.begin(id, node);
    }
  }

  pointerMove(id, x, y, now) {
    const previous = this.pointers.get(id);
    this.focus = { x, y };
    if (!previous) return;
    const point = { x, y };
    const distance = Math.hypot(x - previous.x, y - previous.y);
    // A stationary hold can last seconds before the first move. Exclude dwell
    // time so that the first fast swipe after a long press still tears threads.
    const speed = distance / Math.max(8, Math.min(50, now - previous.time)) * 1000;
    if (this.form === 'octahedron' && distance > 3 && speed > Math.max(330, this.scale * 3)) {
      this.tear(previous, point);
      this.weave.cancel(id); previous.tearing = true; previous.quiet = 0;
    }
    previous.x = x; previous.y = y; previous.time = now;
  }

  pointerUp(id, cancelled = false) {
    if (cancelled) this.weave.cancel(id); else this.weave.release(id);
    this.pointers.delete(id);
    this.focus = this.pointers.size ? [...this.pointers.values()][0] : null;
  }

  clearPointers() {
    this.pointers.clear(); this.weave.sources.clear(); this.focus = null;
  }

  tear(a, b) {
    const radius = Math.max(24, this.scale * 0.24) * (0.65 + this.dispersion * 0.7);
    const damaged = [];
    this.nodeScreens.forEach((node, i) => {
      if (segmentDistance(node.x, node.y, a, b) < radius) damaged.push(i);
    });
    this.weave.breakNodes(damaged, this.dispersion);
    for (const p of this.points) {
      const weight = clamp(1 - segmentDistance(p.x, p.y, a, b) / (radius * 1.4));
      p.scatter = Math.max(p.scatter, weight * 0.7);
    }
  }

  animate(now) {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60;
    this.last = now;
    if (!this.paused) { this.time += dt; this.update(dt); this.draw(); }
    this.frame = requestAnimationFrame(this.animate);
  }

  update(dt) {
    const coefficients = springCoefficients(dt, this.inertia);
    const scatterCoefficients = springCoefficients(dt, this.inertia, 2);
    const layers = {
      edge: springCoefficients(dt, this.inertia, 1.3),
      surface: coefficients,
      interior: springCoefficients(dt, this.inertia, 0.72),
    };
    for (const [id, point] of this.pointers) {
      point.quiet += dt;
      if (point.tearing && point.quiet > 0.4) {
        point.tearing = false;
        const node = this.nearestNode(point);
        if (node >= 0) this.weave.begin(id, node);
      }
    }
    this.weave.update(dt, recoveryRate(this.inertia));
    let spread = 0;
    if (this.hand) spread = this.hand.openness;
    else if (this.pointers.size > 1) {
      const [a, b] = [...this.pointers.values()];
      spread = clamp(Math.hypot(a.x - b.x, a.y - b.y) / (Math.min(this.width, this.height) * 0.65));
    } else if (this.pointers.size && this.form !== 'octahedron') spread = Math.max(spread, 0.82);
    // Strength is the effect amplitude; activation comes from hands or touch.
    // No queued timelines: a new gesture changes the live spring target now.
    this.impulse = clamp(advanceSpring(this.activation, spread * spread, coefficients));
    const legacyPointer = this.form !== 'octahedron' && this.focus;
    const hx = this.hand ? (this.hand.x - 0.5) * this.scale * 0.4 : legacyPointer ? clamp((this.focus.x - this.originX) * 0.3, -this.scale * 0.4, this.scale * 0.4) : 0;
    const hy = this.hand ? (this.hand.y - 0.5) * this.scale * 0.25 : legacyPointer ? clamp((this.focus.y - this.originY) * 0.3, -this.scale * 0.25, this.scale * 0.25) : 0;
    this.centerX = advanceSpring(this.centerMotionX, this.originX + hx, coefficients);
    this.centerY = advanceSpring(this.centerMotionY, this.originY + hy, coefficients);
    for (const p of this.points) {
      const layer = layers[p.kind];
      advanceSpring(p.deformation, spread * spread, layer);
      const thread = this.form === 'octahedron' && p.thread;
      const pull = thread ? this.weave.strength(thread.link) * 0.92 : 0;
      for (let axis = 0; axis < 3; axis++) {
        const target = p.target[axis] + (thread ? (thread.point[axis] - p.target[axis]) * pull : 0);
        p.position[axis] = advanceSpring(p.motion[axis], target, layer);
      }
      p.scatter *= Math.exp(-dt * recoveryRate(this.inertia));
      advanceSpring(p.scatterMotion, p.scatter, scatterCoefficients);
    }
    this.projectAll();
  }

  project(point, destination) {
    const yaw = this.time * 0.075 + 0.6, pitch = -0.12 + Math.sin(this.time * 0.1) * 0.035;
    const x = point[0] * Math.cos(yaw) + point[2] * Math.sin(yaw);
    const z = -point[0] * Math.sin(yaw) + point[2] * Math.cos(yaw);
    const y = point[1] * Math.cos(pitch) - z * Math.sin(pitch);
    const depth = point[1] * Math.sin(pitch) + z * Math.cos(pitch);
    const perspective = 4.5 / (4.5 - depth);
    destination.x = this.centerX + x * this.scale * perspective;
    destination.y = this.centerY - y * this.scale * perspective;
    destination.depth = depth;
  }

  projectAll() {
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const anchor = this.form === 'octahedron' && p.kind === 'edge' && retained(i, this.dispersion);
      const amount = (clamp(p.deformation.value) * p.radius * (anchor ? 0.08 : 1) + clamp(p.scatterMotion.value)) * this.dispersion;
      const drift = this.form === 'octahedron' && p.kind === 'interior' ? 0.009 : 0.001;
      const position = p.position.map((v, axis) => v * (1 + amount * 0.45) + Math.sin(p.seed + axis * 2.1 + this.time * 0.28) * (amount + drift));
      this.project(position, p);
    }
    this.mesh.nodes.forEach((point, i) => this.project(point, this.nodeScreens[i]));
  }

  drawWeave() {
    const ctx = this.ctx;
    const coherence = 1 - this.impulse * this.dispersion;
    // Faces are only local, sparse and almost transparent after all corners settle.
    let filled = 0;
    for (let i = 0; i < this.mesh.triangles.length && filled < 14; i += 5) {
      const indices = this.mesh.triangles[i];
      const strength = Math.min(...indices.map(index => this.weave.charge[index] * (1 - this.weave.damage[index])));
      if (strength < 0.88) continue;
      const [a, b, c] = indices.map(index => this.nodeScreens[index]);
      ctx.fillStyle = `rgba(255,255,255,${(strength - 0.88) * 0.22 * coherence})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.fill(); filled++;
    }
    for (let i = 0; i < this.mesh.links.length; i++) {
      const [ia, ib] = this.mesh.links[i];
      const a = this.nodeScreens[ia], b = this.nodeScreens[ib];
      const strength = this.weave.strength(i);
      const integrity = 1 - this.impulse * (retained(i, this.dispersion) ? 0.12 : 1);
      const intact = 1 - Math.max(this.weave.damage[ia], this.weave.damage[ib]);
      const base = this.mesh.boundary[i] ? 0.12 * intact : 0;
      if ((strength < 0.025 && base < 0.005) || integrity < 0.025) continue;
      ctx.strokeStyle = `rgba(255,255,255,${(base + strength * 0.43) * integrity})`;
      ctx.lineWidth = 0.55;
      ctx.setLineDash(integrity < 0.7 ? [2, 4] : strength < 0.7 && strength > 0.025 ? [1.5 + strength * 3, 4 * (1 - strength)] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + (b.x - a.x) * integrity, a.y + (b.y - a.y) * integrity); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#101111'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.save(); ctx.beginPath(); ctx.rect(12, this.artTop, this.width - 24, this.artBottom - this.artTop); ctx.clip();
    if (this.form === 'octahedron') this.drawWeave();
    // Batch tiny light points; a few shards provide scale without heavy glow.
    for (let group = 0; group < 3; group++) {
      ctx.fillStyle = ['#ffffff45', '#ffffff8c', '#ffffffe0'][group]; ctx.beginPath();
      for (let i = group; i < this.count; i += 3) {
        const p = this.points[i];
        const radius = (p.kind === 'interior' ? 0.45 : 0.65) + (p.depth + 1) * 0.22;
        if (i % 23 === 0) {
          const r = radius * 1.8;
          ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r * 0.55, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r * 0.55, p.y); ctx.closePath();
        } else if (i % 31 === 0) {
          ctx.moveTo(p.x, p.y - radius * 1.5); ctx.lineTo(p.x + radius, p.y + radius); ctx.lineTo(p.x - radius, p.y + radius); ctx.closePath();
        } else { ctx.moveTo(p.x + radius, p.y); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); }
      }
      ctx.fill();
    }
    if (this.form === 'lines' || this.form === 'grid') {
      ctx.strokeStyle = '#ffffff1a'; ctx.lineWidth = 0.5; ctx.beginPath();
      const step = this.form === 'lines' ? 9 : 1;
      for (let i = 0; i < this.count - step; i += 2) {
        const a = this.points[i], b = this.points[i + step];
        if (Math.hypot(a.x - b.x, a.y - b.y) < this.scale * 0.2) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

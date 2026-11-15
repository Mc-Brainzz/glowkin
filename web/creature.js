// The glowkin renderer. Draws one creature from a genome onto a 2D canvas.
// It never paints a background, so the same file works on a web page and in a
// transparent desktop overlay.

import { auraSprite, dotSprite, haloSprite, stamp } from './glow.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const hsla = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;
const mixHue = (a, b, t) => a + ((((b - a + 540) % 360) - 180) * t);
const INK = 'rgba(9, 11, 32, 0.92)';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_GENOME = {
  version: 1, seed: 1, hue: 190, accentHue: 320, stretch: 0.4, size: 0.5,
  tendrils: 5, tendrilLength: 0.5, pulse: 0.4, jitter: 0.1, motes: 3,
  eyeSize: 0.5, glow: 0.6, archetype: 'wanderer',
};

export class Creature {
  constructor(genome, x, y) {
    const g = (this.g = { ...DEFAULT_GENOME, ...genome });
    const rnd = mulberry32(g.seed);
    this.R = 40 + 30 * g.size;
    this.rx = this.R * (1 - 0.1 * g.stretch);
    this.ry = this.R * (1 + 0.55 * g.stretch);
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.home = { x, y };
    this.grabOffset = { x: 0, y: 0 };
    this.bounds = null;
    this.t = rnd() * 100;
    this.ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU, rnd() * TAU];
    this.held = false;
    this.solid = 0; // 0 = glassy (dark pages), 1 = fully opaque body (busy desktops)
    this.joy = 0;
    this.tilt = 0;
    this.blink = 1;
    this.nextBlink = 1.5 + rnd() * 3;
    this.look = { x: 0, y: 0 };
    this.sparks = [];
    this.sparkDebt = 0;

    this.speckles = Array.from({ length: 6 + Math.floor(rnd() * 7) }, () => ({
      a: rnd() * TAU, d: 0.2 + rnd() * 0.6, r: 1 + rnd() * 1.8, ph: rnd() * TAU,
    }));

    const ring = g.archetype === 'conductor';
    this.motes = Array.from({ length: g.motes }, (_, i) => ({
      a: ring ? (i / g.motes) * TAU : rnd() * TAU,
      d: ring ? 1.9 : 1.55 + rnd() * 0.8,
      sp: ring ? 0.55 : (0.25 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1),
      r: ring ? 3.6 : 2 + rnd() * 2.2,
      tilt: ring ? 0.42 : 0.3 + rnd() * 0.5,
      accent: i % 2 === 0,
    }));
    this.moteCenter = { x, y };

    this.tendrils = Array.from({ length: g.tendrils }, (_, i) => {
      const th = lerp(0.16 * Math.PI, 0.84 * Math.PI, (i + 0.5) / g.tendrils);
      const ax = Math.cos(th) * this.rx * 0.8;
      const ay = Math.sin(th) * this.ry * 0.78;
      const n = 7 + Math.round(9 * g.tendrilLength);
      const seg = (5 + 7 * g.tendrilLength) * (0.75 + 0.5 * rnd()) * (0.7 + 0.3 * Math.sin(th));
      const pts = Array.from({ length: n }, (_, j) => {
        const px = x + ax, py = y + ay + j * seg;
        return { x: px, y: py, px, py };
      });
      return { ax, ay, seg, pts, ph: rnd() * TAU };
    });
  }

  get reach() { return Math.max(this.rx, this.ry); }

  hitTest(px, py, factor = 1.25) {
    return Math.hypot(px - this.pos.x, py - this.pos.y) < this.reach * factor;
  }

  // The frame of reference moved (the overlay window was dragged). Trailing parts
  // keep their place in the world; the body follows by `bodyFactor` and springs back.
  shiftWorld(dx, dy, bodyFactor = 0.6) {
    this.pos.x += dx * bodyFactor; this.pos.y += dy * bodyFactor;
    this.moteCenter.x += dx; this.moteCenter.y += dy;
    for (const s of this.sparks) { s.x += dx; s.y += dy; }
    for (const td of this.tendrils) {
      for (const p of td.pts) { p.x += dx; p.y += dy; p.px += dx; p.py += dy; }
    }
  }

  // Teleport without whipping the tendrils (used when the window is resized).
  moveTo(x, y) {
    const dx = x - this.pos.x, dy = y - this.pos.y;
    this.pos = { x, y };
    this.home = { x, y };
    this.vel = { x: 0, y: 0 };
    this.moteCenter.x += dx; this.moteCenter.y += dy;
    for (const s of this.sparks) { s.x += dx; s.y += dy; }
    for (const td of this.tendrils) {
      for (const p of td.pts) { p.x += dx; p.y += dy; p.px += dx; p.py += dy; }
    }
  }

  grab(px, py) {
    this.held = true;
    this.grabOffset = { x: px - this.pos.x, y: py - this.pos.y };
  }

  release() {
    if (!this.held) return;
    this.held = false;
    this.home = { x: this.pos.x + this.vel.x * 0.25, y: this.pos.y + this.vel.y * 0.25 };
    this.clampHome();
    this.joy = 1;
    this.burst(16);
  }

  poke() {
    this.joy = 1;
    this.vel.y -= 260;
    this.burst(22);
  }

  clampHome() {
    if (!this.bounds) return;
    const m = this.reach * 1.4;
    this.home.x = clamp(this.home.x, m, Math.max(m, this.bounds.w - m));
    this.home.y = clamp(this.home.y, m, Math.max(m, this.bounds.h - m * 1.6));
  }

  burst(n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = 60 + Math.random() * 160;
      this.spawnSpark(a, Math.cos(a) * s, Math.sin(a) * s);
    }
  }

  spawnSpark(a, vx, vy) {
    if (this.sparks.length > 160) this.sparks.shift();
    const life = 0.7 + Math.random() * 1.1;
    this.sparks.push({
      x: this.pos.x + Math.cos(a) * this.rx * 0.9,
      y: this.pos.y + Math.sin(a) * this.ry * 0.9,
      vx, vy, life, max: life, r: 0.8 + Math.random() * 1.6,
      hue: Math.random() < 0.5 ? this.g.hue : this.g.accentHue,
    });
  }

  // Advance in small fixed steps so the motion stays stable and real-time even
  // when the browser delivers frames slowly (background tabs, busy machines).
  update(dt, pointer) {
    let left = Math.min(dt, 0.25);
    while (left > 1e-4) {
      const h = Math.min(left, 1 / 60);
      this.step(h, pointer);
      left -= h;
    }
  }

  step(dt, pointer) {
    const g = this.g;
    this.t += dt;
    const t = this.t;

    // Spring toward the pointer while held, otherwise toward a slowly wandering home.
    let tx, ty, k, c;
    if (this.held) {
      tx = pointer.x - this.grabOffset.x; ty = pointer.y - this.grabOffset.y; k = 220; c = 22;
    } else {
      tx = this.home.x + Math.sin(t * 0.31 + this.ph[0]) * 16;
      ty = this.home.y + Math.sin(t * 0.47 + this.ph[1]) * 11;
      k = 10; c = 4.5;
    }
    this.vel.x += ((tx - this.pos.x) * k - this.vel.x * c) * dt;
    this.vel.y += ((ty - this.pos.y) * k - this.vel.y * c) * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    const speed = Math.hypot(this.vel.x, this.vel.y);
    this.tilt = lerp(this.tilt, clamp(this.vel.x * 0.0006, -0.35, 0.35), 1 - Math.exp(-dt * 10));

    // Eyes follow the pointer.
    const dx = pointer.x - this.pos.x, dy = pointer.y - this.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const pull = Math.min(1, d / 220);
    const ease = 1 - Math.exp(-dt * 8);
    this.look.x = lerp(this.look.x, (dx / d) * pull, ease);
    this.look.y = lerp(this.look.y, (dy / d) * pull, ease);

    this.nextBlink -= dt;
    if (this.nextBlink < 0) this.nextBlink = 2.2 + Math.random() * 3.8;
    this.blink = this.nextBlink < 0.13 ? 0.12 : 1;
    this.joy = Math.max(0, this.joy - dt / 1.3);

    const ease2 = 1 - Math.exp(-dt * 5);
    this.moteCenter.x = lerp(this.moteCenter.x, this.pos.x, ease2);
    this.moteCenter.y = lerp(this.moteCenter.y, this.pos.y, ease2);
    for (const m of this.motes) m.a += m.sp * dt;

    this.stepTendrils(dt);

    this.sparkDebt += dt * (2.5 + speed * 0.045 + g.jitter * 5);
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      const a = Math.random() * TAU;
      this.spawnSpark(a, (Math.random() - 0.5) * 22 - this.vel.x * 0.08, -12 - Math.random() * 24 - this.vel.y * 0.08);
    }
    for (const s of this.sparks) {
      s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt;
      s.vx *= 1 - dt * 1.6; s.vy = s.vy * (1 - dt * 1.6) - 8 * dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  stepTendrils(dt) {
    const f = dt * 60, cos = Math.cos(this.tilt), sin = Math.sin(this.tilt);
    for (const td of this.tendrils) {
      const p = td.pts;
      p[0].x = this.pos.x + td.ax * cos - td.ay * sin;
      p[0].y = this.pos.y + td.ax * sin + td.ay * cos;
      for (let j = 1; j < p.length; j++) {
        const q = p[j];
        const vx = (q.x - q.px) * 0.9, vy = (q.y - q.py) * 0.9;
        q.px = q.x; q.py = q.y;
        q.x += vx + Math.sin(this.t * 1.4 + td.ph + j * 0.55) * 0.1 * f;
        q.y += vy + 0.16 * f;
      }
      for (let pass = 0; pass < 3; pass++) {
        for (let j = 1; j < p.length; j++) {
          const a = p[j - 1], b = p[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const m = (d - td.seg) / d;
          b.x -= dx * m; b.y -= dy * m;
        }
      }
    }
  }

  draw(ctx) {
    const g = this.g, t = this.t, R = this.R;
    const beat = 0.5 + 0.5 * Math.sin(t * (1.3 + 3 * g.pulse));
    const lum = 0.6 + 0.4 * g.glow + (this.held ? 0.25 : 0) + this.joy * 0.2;
    const x = this.pos.x + Math.sin(t * 37) * g.jitter * 1.4;
    const y = this.pos.y + Math.cos(t * 31) * g.jitter * 1.4;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    stamp(ctx, auraSprite(g.hue), x, y, R * 3.6, 0.65 * lum * (0.8 + 0.2 * beat));
    this.drawTendrils(ctx, beat);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed > 1) {
      const ang = Math.atan2(this.vel.y, this.vel.x), s = 1 + Math.min(speed / 1800, 0.22);
      ctx.rotate(ang); ctx.scale(s, 1 / s); ctx.rotate(-ang);
    }
    ctx.rotate(this.tilt);
    this.drawCrownBack(ctx, beat);
    this.drawBody(ctx, beat, lum);
    this.drawFace(ctx);
    this.drawCrownFront(ctx, beat);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const mx = this.moteCenter.x + Math.cos(m.a) * m.d * R;
      const my = this.moteCenter.y + Math.sin(m.a) * m.d * R * m.tilt;
      this.glowDot(ctx, mx, my, m.r * (0.85 + 0.3 * beat), m.accent ? g.accentHue : g.hue, 0.9);
    }
    for (const s of this.sparks) {
      ctx.fillStyle = hsla(s.hue, 100, 78, (s.life / s.max) * 0.85);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  glowDot(ctx, x, y, r, hue, alpha) {
    stamp(ctx, dotSprite(hue), x, y, r * 3.2, alpha);
  }

  drawTendrils(ctx, beat) {
    const g = this.g, w0 = 2.6 + 2.2 * g.size;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const td of this.tendrils) {
      const p = td.pts, n = p.length;
      ctx.strokeStyle = hsla(g.hue, 100, 62, 0.07);
      ctx.lineWidth = w0 * 3.2;
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
      for (let j = 1; j < n; j++) ctx.lineTo(p[j].x, p[j].y);
      ctx.stroke();
      for (let j = 1; j < n - 1; j++) {
        const u = j / (n - 1);
        ctx.strokeStyle = hsla(mixHue(g.hue, g.accentHue, u), 100, 70, lerp(0.8, 0.28, u));
        ctx.lineWidth = lerp(w0, 0.7, u);
        ctx.beginPath();
        ctx.moveTo((p[j - 1].x + p[j].x) / 2, (p[j - 1].y + p[j].y) / 2);
        ctx.quadraticCurveTo(p[j].x, p[j].y, (p[j].x + p[j + 1].x) / 2, (p[j].y + p[j + 1].y) / 2);
        ctx.stroke();
      }
      const tip = p[n - 1];
      this.glowDot(ctx, tip.x, tip.y, 1.5 + 0.8 * beat, g.accentHue, 0.9);
    }
  }

  bodyPath(ctx, beat) {
    const g = this.g, t = this.t, K = 56;
    const bx = 1 + 0.035 * (beat * 2 - 1), by = 2 - bx;
    const pts = [];
    for (let i = 0; i < K; i++) {
      const th = (i / K) * TAU;
      const r = 1 + 0.05 * Math.sin(3 * th + t * 0.9 + this.ph[0])
        + 0.035 * Math.sin(5 * th - t * 1.3 + this.ph[1])
        + 0.022 * g.jitter * Math.sin(13 * th + t * 11 + this.ph[2]);
      const belly = Math.sin(th) > 0 ? 0.88 : 1;
      pts.push([Math.cos(th) * this.rx * r * bx, Math.sin(th) * this.ry * r * belly * by]);
    }
    ctx.beginPath();
    for (let i = 0; i <= K; i++) {
      const a = pts[i % K], b = pts[(i + 1) % K];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(a[0], a[1], mx, my);
    }
    ctx.closePath();
  }

  drawBody(ctx, beat, lum) {
    const g = this.g, R = this.R, far = this.reach * 1.15;
    const fill = ctx.createRadialGradient(-this.rx * 0.25, -this.ry * 0.35, R * 0.08, 0, 0, far);
    const a = (alpha) => alpha + (1 - alpha) * this.solid;
    fill.addColorStop(0, hsla(g.hue, 100, 93, a(0.98)));
    fill.addColorStop(0.35, hsla(g.hue, 98, 69, a(0.92)));
    fill.addColorStop(0.8, hsla(g.hue + 12, 92, 49, a(0.66)));
    fill.addColorStop(1, hsla(g.hue + 25, 90, 38, a(0.4)));
    ctx.save();
    // A stamped halo behind the body stands in for a (costly) blurred shadow.
    ctx.globalCompositeOperation = 'lighter';
    stamp(ctx, haloSprite(g.hue), 0, 0, this.reach * (1.5 + 0.12 * beat), 0.6 * lum);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = fill;
    this.bodyPath(ctx, beat);
    ctx.fill();
    ctx.strokeStyle = hsla(g.hue, 100, 88, 0.55);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Inner light and speckles stay inside the body outline.
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const heart = ctx.createRadialGradient(0, this.ry * 0.3, 0, 0, this.ry * 0.3, R * 0.75);
    heart.addColorStop(0, hsla(g.accentHue, 100, 72, 0.22 + 0.3 * beat));
    heart.addColorStop(1, hsla(g.accentHue, 100, 60, 0));
    ctx.fillStyle = heart;
    ctx.fillRect(-far, -far, far * 2, far * 2);
    for (const s of this.speckles) {
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * 1.7 + s.ph));
      ctx.fillStyle = hsla(g.accentHue, 100, 82, 0.55 * tw);
      ctx.beginPath();
      ctx.arc(Math.cos(s.a) * s.d * this.rx, Math.sin(s.a) * s.d * this.ry * 0.85 + this.ry * 0.12, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFace(ctx) {
    const g = this.g, R = this.R;
    const lx = this.look.x * R * 0.08, ly = this.look.y * R * 0.07;
    const ex = this.rx * 0.36, ey = -this.ry * 0.1 + ly;
    const er = R * (0.105 + 0.07 * g.eyeSize) * (this.held ? 1.18 : 1);
    const happy = this.joy > 0.25 && !this.held;

    ctx.fillStyle = hsla(g.accentHue, 100, 70, 0.3);
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.arc(side * this.rx * 0.6 + lx, ey + er * 1.9, R * 0.12, 0, TAU); ctx.fill();
    }

    for (const side of [-1, 1]) {
      const cx = side * ex + lx;
      if (happy) {
        ctx.strokeStyle = INK; ctx.lineWidth = er * 0.42; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, ey + er * 0.35, er * 0.85, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        continue;
      }
      ctx.save();
      ctx.translate(cx, ey); ctx.scale(1, this.blink);
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.ellipse(0, 0, er * 0.88, er, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath(); ctx.arc(-er * 0.28 + this.look.x * er * 0.2, -er * 0.34 + this.look.y * er * 0.2, er * 0.32, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(er * 0.3, er * 0.36, er * 0.13, 0, TAU); ctx.fill();
      ctx.restore();
    }

    const my = ey + er * 1.55;
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.6, R * 0.035);
    ctx.beginPath();
    if (this.held) { ctx.ellipse(lx, my + R * 0.03, R * 0.055, R * 0.075, 0, 0, TAU); ctx.fill(); }
    else if (happy) { ctx.arc(lx, my - R * 0.02, R * 0.13, 0, Math.PI); ctx.closePath(); ctx.fill(); }
    else { ctx.arc(lx, my - R * 0.06, R * 0.1, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke(); }
  }

  drawCrownBack(ctx, beat) {
    const g = this.g, t = this.t, rx = this.rx, ry = this.ry, R = this.R;
    const light = hsla(g.hue, 100, 82, 0.85), accent = hsla(g.accentHue, 100, 72, 0.9);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (g.archetype === 'builder') {
      // Crystal shards: someone who mostly writes and edits.
      for (const [a, len, w] of [[-0.5, 0.5, 0.15], [0, 0.72, 0.19], [0.5, 0.5, 0.15]]) {
        const bx = Math.sin(a) * rx * 0.8, by = -Math.cos(a) * ry * 0.8;
        const tx = Math.sin(a) * (rx + R * len), ty = -Math.cos(a) * (ry + R * len);
        const nx = Math.cos(a) * R * w, ny = Math.sin(a) * R * w;
        const grad = ctx.createLinearGradient(bx, by, tx, ty);
        grad.addColorStop(0, hsla(g.hue, 100, 70, 0.5)); grad.addColorStop(1, hsla(g.accentHue, 100, 82, 0.95));
        ctx.fillStyle = grad; ctx.strokeStyle = hsla(g.accentHue, 100, 90, 0.7); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx - nx, by - ny); ctx.lineTo(tx, ty); ctx.lineTo(bx + nx, by + ny); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    } else if (g.archetype === 'explorer') {
      // Lantern antennae: someone who mostly reads and searches.
      for (const side of [-1, 1]) {
        const sway = Math.sin(t * 1.6 + side) * R * 0.1;
        const tx = side * rx * 0.85 + sway, ty = -ry - R * 0.62;
        ctx.strokeStyle = light; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(side * rx * 0.3, -ry * 0.8);
        ctx.quadraticCurveTo(side * rx * 0.35, -ry - R * 0.55, tx, ty); ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        this.glowDot(ctx, tx, ty, 3.4 + 1.4 * beat, g.accentHue, 1);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else if (g.archetype === 'operator') {
      // Fins: someone who mostly runs commands.
      const flap = Math.sin(t * 3.4) * ry * 0.14;
      const grad = ctx.createLinearGradient(-rx * 1.7, 0, rx * 1.7, 0);
      grad.addColorStop(0, accent); grad.addColorStop(0.5, hsla(g.hue, 100, 70, 0.5)); grad.addColorStop(1, accent);
      ctx.fillStyle = grad; ctx.strokeStyle = hsla(g.accentHue, 100, 88, 0.6); ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(side * rx * 0.8, -ry * 0.22);
        ctx.quadraticCurveTo(side * rx * 1.35, -ry * 0.3 + flap * 0.5, side * (rx + R * 0.7), ry * 0.02 + flap);
        ctx.quadraticCurveTo(side * rx * 1.2, ry * 0.22 + flap * 0.4, side * rx * 0.8, ry * 0.3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-rx * 0.2, -ry * 0.86);
      ctx.quadraticCurveTo(rx * 0.05, -ry - R * 0.5, rx * 0.32, -ry - R * 0.34);
      ctx.quadraticCurveTo(rx * 0.2, -ry * 0.98, rx * 0.26, -ry * 0.84);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (g.archetype === 'wanderer') {
      ctx.strokeStyle = light; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(0, -ry * 0.9);
      ctx.bezierCurveTo(R * 0.3, -ry - R * 0.3, -R * 0.3, -ry - R * 0.45, Math.sin(t * 1.3) * R * 0.12, -ry - R * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCrownFront(ctx, beat) {
    const g = this.g, t = this.t, rx = this.rx, ry = this.ry, R = this.R;
    ctx.save();
    if (g.archetype === 'researcher') {
      // Halo: someone who mostly searches and browses the web.
      ctx.strokeStyle = hsla(g.accentHue, 100, 80, 0.9); ctx.lineWidth = 3;
      ctx.shadowColor = hsla(g.accentHue, 100, 65, 1); ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.ellipse(0, -ry - R * 0.3 + Math.sin(t * 1.5) * 2.5, rx * 0.62, rx * 0.16, -0.08, 0, TAU); ctx.stroke();
    } else if (g.archetype === 'conductor') {
      // Crown of lights: someone who mostly delegates to other agents.
      ctx.globalCompositeOperation = 'lighter';
      for (const [a, lift] of [[-0.5, 0.2], [0, 0.34], [0.5, 0.2]]) {
        this.glowDot(ctx, Math.sin(a) * rx * 0.75, -ry - R * lift + Math.sin(t * 2 + a * 3) * 2, 3 + beat, g.accentHue, 1);
      }
    }
    ctx.restore();
  }
}

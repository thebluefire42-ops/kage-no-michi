// Pooled particles, ground decals, slash trails, shockwave rings and floating damage numbers.
import { TAU, rand, isoX, isoY, clamp, ease } from './util.js';

const MAX = 1600;

export class Particles {
  constructor() { this.list = []; this.pool = []; }

  emit(type, x, y, z, vx, vy, vz, life, size, color, opts) {
    if (this.list.length >= MAX) return null;
    const p = this.pool.pop() || {};
    p.type = type; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life; p.size = size; p.color = color;
    p.rot = rand(0, TAU); p.vr = rand(-6, 6);
    p.grav = 0; p.drag = 1.5; p.under = false; p.bounce = false; p.glow = false;
    p.seed = Math.random() * 100;
    if (opts) Object.assign(p, opts);
    this.list.push(p);
    return p;
  }

  burst(type, x, y, z, n, speed, life, size, color, opts) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(speed * 0.3, speed);
      this.emit(type, x, y, z, Math.cos(a) * s, Math.sin(a) * s, rand(0, speed * 0.6), life * rand(0.6, 1.2), size * rand(0.6, 1.3), color, opts);
    }
  }

  update(dt, windFn, time) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); this.pool.push(p); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      if (p.type === 'petal' || p.type === 'leaf' || p.type === 'feather') {
        const w = windFn ? windFn(p.x, p.y, time) : 0;
        p.vx += (w * 1.5 + Math.sin(time * 3 + p.seed) * 0.6) * dt;
        p.vy += Math.cos(time * 2.3 + p.seed) * 0.5 * dt;
        p.vz = Math.max(p.vz - 1.2 * dt, -0.35 - Math.sin(time * 4 + p.seed) * 0.15);
      } else {
        p.vz -= p.grav * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 0) {
        if (p.bounce && p.vz < -1) { p.vz *= -0.35; p.z = 0; p.vx *= 0.6; p.vy *= 0.6; }
        else { p.z = 0; p.vz = 0; if (p.type === 'petal' || p.type === 'leaf') { p.vx *= 0.9; p.vy *= 0.9; p.vr *= 0.9; } }
      }
      p.rot += p.vr * dt;
    }
  }

  draw(ctx, under) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (p.under !== under) continue;
      const k = p.life / p.max;
      const sx = isoX(p.x, p.y), sy = isoY(p.x, p.y, p.z);
      switch (p.type) {
        case 'dot': case 'blood': case 'ink': {
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, sy, p.size * (0.4 + k * 0.6), 0, TAU); ctx.fill();
          break;
        }
        case 'spark': {
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
          const vx = (p.vx - p.vy) * 32 * 0.03, vy = (p.vx + p.vy) * 16 * 0.03 - p.vz * 32 * 0.03;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - vx, sy - vy); ctx.stroke();
          break;
        }
        case 'smoke': case 'dust': case 'steam': {
          const grow = 1 + (1 - k) * (p.type === 'steam' ? 2.5 : 1.8);
          ctx.globalAlpha = (p.type === 'steam' ? 0.25 : 0.45) * k;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, sy, p.size * grow, 0, TAU); ctx.fill();
          break;
        }
        case 'ember': case 'glow': {
          ctx.globalAlpha = k * (0.6 + 0.4 * Math.sin(p.seed + p.life * 20));
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, sy, p.size * (0.5 + k * 0.5), 0, TAU); ctx.fill();
          break;
        }
        case 'petal': case 'leaf': case 'feather': {
          ctx.globalAlpha = Math.min(1, k * 3);
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rot);
          ctx.scale(1, 0.4 + 0.6 * Math.abs(Math.sin(p.rot * 1.3)));
          ctx.fillStyle = p.color;
          ctx.beginPath();
          if (p.type === 'feather') ctx.ellipse(0, 0, p.size * 1.8, p.size * 0.5, 0, 0, TAU);
          else ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, TAU);
          ctx.fill(); ctx.restore();
          break;
        }
        case 'shard': {
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

// Ground splatters that slowly fade (drawn under everything).
export class Decals {
  constructor() { this.list = []; }
  add(x, y, r, color, life = 12) {
    if (this.list.length > 220) this.list.shift();
    const blobs = [];
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) blobs.push([rand(-r, r), rand(-r, r) * 0.5, rand(r * 0.25, r * 0.6)]);
    this.list.push({ x, y, color, life, max: life, blobs });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) { const d = this.list[i]; d.life -= dt; if (d.life <= 0) this.list.splice(i, 1); }
  }
  draw(ctx) {
    for (const d of this.list) {
      const sx = isoX(d.x, d.y), sy = isoY(d.x, d.y);
      ctx.globalAlpha = 0.55 * Math.min(1, d.life / (d.max * 0.4));
      ctx.fillStyle = d.color;
      ctx.beginPath();
      for (const b of d.blobs) { ctx.moveTo(sx + b[0] * 32 + b[2] * 32, sy + b[1] * 16); ctx.ellipse(sx + b[0] * 32, sy + b[1] * 16, b[2] * 32, b[2] * 16, 0, 0, TAU); }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// Visual effects: slashes, rings, floating texts, flashes.
export class Effects {
  constructor() { this.slashes = []; this.rings = []; this.texts = []; this.bolts = []; this.thrusts = []; }

  // jagged lightning arc between two world points (z = height)
  bolt(x1, y1, z1, x2, y2, z2) {
    const pts = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const k = i / n, j = i === 0 || i === n ? 0 : 1;
      pts.push([isoX(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k) + rand(-9, 9) * j, isoY(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, z1 + (z2 - z1) * k) + rand(-9, 9) * j]);
    }
    this.bolts.push({ pts, t: 0, dur: 0.18 });
  }

  drawBolts(ctx) {
    if (!this.bolts.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
    for (const b of this.bolts) {
      const a = 1 - b.t / b.dur;
      for (const [w, c] of [[7, `rgba(255,230,90,${0.35 * a})`], [2.5, `rgba(255,255,220,${a})`]]) {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); b.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
      }
    }
    ctx.restore();
  }

  slash(x, y, angle, radius, arc, color, width, dur = 0.16, z = 0.55, dirSign = 1) {
    this.slashes.push({ x, y, angle, radius, arc, color, width, t: 0, dur, z, dirSign });
  }
  // straight streak (bo jab): from (x,y) along world dir (dx,dy) for len units
  thrust(x, y, dx, dy, len, color, width = 6, dur = 0.14, z = 0.6) {
    this.thrusts.push({ x, y, dx, dy, len, color, width, t: 0, dur, z });
  }
  ring(x, y, radius, color, dur = 0.4, width = 6) {
    this.rings.push({ x, y, radius, color, t: 0, dur, width });
  }
  text(x, y, str, color, size = 16, crit = false) {
    this.texts.push({ x: x + rand(-0.2, 0.2), y: y + rand(-0.2, 0.2), z: 1.2, str, color, size, crit, t: 0, dur: crit ? 0.95 : 0.7, vx: rand(-14, 14) });
  }

  update(dt) {
    for (const arr of [this.slashes, this.rings, this.texts, this.bolts, this.thrusts]) {
      for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t >= arr[i].dur) arr.splice(i, 1); }
    }
  }

  drawGround(ctx) {
    for (const r of this.rings) {
      const k = r.t / r.dur;
      const rad = r.radius * ease.outCubic(k);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color; ctx.lineWidth = r.width * (1 - k * 0.6);
      ctx.beginPath(); ctx.ellipse(isoX(r.x, r.y), isoY(r.x, r.y), rad * 45.25, rad * 22.6, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawSlashes(ctx) {
    for (const s of this.thrusts) {
      const k = s.t / s.dur, ext = Math.min(1, k * 3);
      const x0 = isoX(s.x, s.y), y0 = isoY(s.x, s.y, s.z);
      const x1 = isoX(s.x + s.dx * s.len * ext, s.y + s.dy * s.len * ext), y1 = isoY(s.x + s.dx * s.len * ext, s.y + s.dy * s.len * ext, s.z);
      const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1, w = s.width * (1 - k * 0.6) / 2;
      ctx.globalAlpha = 1 - ease.inQuad(k);
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo((x0 + x1) / 2 + (nx / nl) * w, (y0 + y1) / 2 + (ny / nl) * w); ctx.lineTo(x1, y1); ctx.lineTo((x0 + x1) / 2 - (nx / nl) * w, (y0 + y1) / 2 - (ny / nl) * w); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const s of this.slashes) {
      const k = s.t / s.dur;
      const cx = isoX(s.x, s.y), cy = isoY(s.x, s.y, s.z);
      // slash drawn as a crescent in the ground plane (squashed ellipse)
      const sweep = s.arc * Math.min(1, k * 2.2);
      const a0 = s.angle - (s.arc / 2) * s.dirSign;
      const a1 = a0 + sweep * s.dirSign;
      const R = s.radius * 40;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(1, 0.55);
      ctx.globalAlpha = 1 - ease.inQuad(k);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (a1 - a0) * (i / steps);
        const w = Math.sin((i / steps) * Math.PI) * s.width * (1 - k * 0.5);
        const r = R + w * 0.5;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      for (let i = steps; i >= 0; i--) {
        const a = a0 + (a1 - a0) * (i / steps);
        const w = Math.sin((i / steps) * Math.PI) * s.width * (1 - k * 0.5);
        const r = R - w * 0.5;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.t / t.dur;
      const pop = t.t < 0.12 ? ease.outBack(t.t / 0.12) : 1;
      const sx = isoX(t.x, t.y) + t.vx * k, sy = isoY(t.x, t.y, t.z) - k * 34;
      const size = t.size * pop * (t.crit ? 1.35 : 1);
      ctx.globalAlpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      ctx.font = `800 ${size.toFixed(1)}px "Zen Kaku Gothic New", sans-serif`;
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,10,20,0.85)';
      ctx.strokeText(t.str, sx, sy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, sx, sy);
    }
    ctx.globalAlpha = 1;
  }
}

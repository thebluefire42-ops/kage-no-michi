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
  constructor() { this.slashes = []; this.rings = []; this.texts = []; this.bolts = []; this.thrusts = []; this.spirits = []; this.pools = []; this.pulls = []; this.roars = []; this.quakes = []; this.rises = []; this.halos = []; this.crags = []; this.splashes = []; this.ghostsUp = []; }
  // a shimmering golden pool on the ground (staff: Sacred Pool)
  pool(x, y, radius, dur) { this.pools.push({ x, y, radius, t: 0, dur }); }

  // staff spirit burst: a soft glowing disc that blooms out, an outer ring, a turning ring of lotus
  // petals and a faint inner sigil, all on the ground plane
  // opts.kanji: a glyph in the middle of the seal; opts.dur; opts.pillar: a column of light rises from it
  spirit(x, y, radius, opts = {}) { this.spirits.push({ x, y, radius, t: 0, dur: opts.dur || 0.7, rot: Math.random() * TAU, kanji: opts.kanji || null, pillar: opts.pillar ?? 1, col: opts.col || null }); }
  drawSpirits(ctx) {
    if (!this.spirits.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const s of this.spirits) {
      const k = s.t / s.dur, grow = ease.outCubic(Math.min(1, k * 1.6)), fade = 1 - ease.inQuad(k);
      const R = s.radius * grow, cx = isoX(s.x, s.y), cy = isoY(s.x, s.y);
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.5);
      const RX = R * 45.25;
      // a holy seal of warm light: glowing disc, double ring with sutra ticks, an eight-point star, lotus petals, a glyph
      const C = s.col || '255,236,180';
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, RX);
      gr.addColorStop(0, `rgba(255,252,236,${0.6 * fade})`); gr.addColorStop(0.5, `rgba(${C},${0.3 * fade})`); gr.addColorStop(1, `rgba(${C},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, RX, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255,246,214,${0.9 * fade})`; ctx.lineWidth = 3.5 * (1 - k * 0.5);
      ctx.beginPath(); ctx.arc(0, 0, RX, 0, TAU); ctx.stroke();
      ctx.strokeStyle = `rgba(${C},${0.6 * fade})`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, RX * 0.8, 0, TAU); ctx.stroke();
      const rot = s.rot + k * 1.6;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) { const a = -rot * 0.5 + (i / 24) * TAU, r0 = RX * 0.8, r1 = RX * (i % 3 ? 0.86 : 0.93); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); }
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,240,200,${0.55 * fade})`; ctx.lineWidth = 1.3;
      for (const off of [0, Math.PI / 4]) { ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = rot * 0.7 + off + (i / 4) * TAU, r = RX * 0.62; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.stroke(); }
      // turning lotus petals around the rim
      ctx.fillStyle = `rgba(255,250,232,${0.75 * fade})`;
      for (let i = 0; i < 8; i++) {
        const a = rot + (i / 8) * TAU, px = Math.cos(a) * RX * 0.86, py = Math.sin(a) * RX * 0.86;
        ctx.save(); ctx.translate(px, py); ctx.rotate(a + Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, -RX * 0.13); ctx.quadraticCurveTo(RX * 0.06, 0, 0, RX * 0.13); ctx.quadraticCurveTo(-RX * 0.06, 0, 0, -RX * 0.13); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      // the glyph, standing up out of the seal, and a soft column of light
      const ga = Math.min(1, k * 5) * fade;
      if (s.pillar) {
        const ph = 110 * (0.6 + 0.4 * grow) * (R / 2), pw = RX * 0.32;
        const pg = ctx.createLinearGradient(0, cy - ph, 0, cy);
        pg.addColorStop(0, `rgba(${C},0)`); pg.addColorStop(1, `rgba(255,250,230,${0.35 * ga})`);
        ctx.fillStyle = pg; ctx.fillRect(cx - pw / 2, cy - ph, pw, ph);
      }
      if (s.kanji) {
        ctx.font = `800 ${Math.round(RX * 0.5)}px "Shippori Mincho", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(255,248,224,${0.85 * ga})`; ctx.fillText(s.kanji, cx, cy - RX * 0.18 - k * 10);
      }
    }
    ctx.restore();
  }

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
  // kunai pulled out of an enemy: a steel splash bursts from the body, the kunai spin out and fly back to the
  // player's hand (to = the player, followed while they fly)
  kunaiPull(x, y, to, n) {
    const base = Math.atan2(to.y - y, to.x - x) + Math.PI;
    const knives = [];
    for (let i = 0; i < n; i++) {
      const a = base + (n === 1 ? 0 : (i / (n - 1) - 0.5) * 2.4) + rand(-0.25, 0.25);
      knives.push({ a, out: rand(1.2, 1.8), up: rand(0.6, 1.2), spin: rand(16, 24) * (Math.random() < 0.5 ? -1 : 1), d: i * 0.025 });
    }
    const rays = [];
    for (let i = 0; i < 18; i++) rays.push({ a: (i / 18) * TAU + rand(-0.12, 0.12), l: rand(0.7, 1.4), w: rand(2.5, 5.5) });
    const drops = [];
    for (let i = 0; i < 16; i++) drops.push({ a: rand(0, TAU), v: rand(1.6, 3.2), up: rand(1.4, 3.0), s: rand(2.5, 4.5) });
    this.pulls.push({ x, y, to, knives, rays, drops, t: 0, dur: 0.6 });
  }
  drawPulls(ctx) {
    if (!this.pulls.length) return;
    ctx.save(); ctx.lineCap = 'round';
    for (const P of this.pulls) {
      const t = P.t, cx = isoX(P.x, P.y), cy = isoY(P.x, P.y, 0.6);
      // the splash: a white flash and steel-blue spikes thrown out in the ground plane
      if (t < 0.22) {
        const k = t / 0.22;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const fr = 46 * (0.5 + k);
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
        gr.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - k)})`); gr.addColorStop(0.4, `rgba(190,225,255,${0.5 * (1 - k)})`); gr.addColorStop(1, 'rgba(120,170,255,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, fr, 0, TAU); ctx.fill();
        ctx.translate(cx, cy); ctx.scale(1, 0.6);
        for (const R of P.rays) {
          const r0 = 12 + 56 * R.l * ease.outCubic(k), r1 = r0 + 34 * R.l * (1 - k);
          ctx.strokeStyle = `rgba(225,240,255,${1 - k})`; ctx.lineWidth = R.w * (1 - k * 0.7);
          ctx.beginPath(); ctx.moveTo(Math.cos(R.a) * r0, Math.sin(R.a) * r0); ctx.lineTo(Math.cos(R.a) * r1, Math.sin(R.a) * r1); ctx.stroke();
        }
        ctx.restore();
      }
      // flung droplets of light that fall back under gravity
      for (const D of P.drops) {
        const k = t / P.dur; if (k > 0.7) continue;
        const dx = Math.cos(D.a) * D.v * t, dy = Math.sin(D.a) * D.v * t, z = 0.6 + D.up * t - 6 * t * t;
        if (z < 0) continue;
        ctx.fillStyle = `rgba(220,236,255,${1 - k / 0.7})`;
        ctx.beginPath(); ctx.arc(isoX(P.x + dx, P.y + dy), isoY(P.x + dx, P.y + dy, z), D.s * (1 - k * 0.6), 0, TAU); ctx.fill();
      }
      // the kunai: spin out of the body, hang for a beat, then whip back into the player's hand
      for (const K of P.knives) {
        const lt = t - K.d; if (lt < 0) continue;
        const out = Math.min(1, lt / 0.16), back = clamp((lt - 0.2) / 0.26, 0, 1);
        if (back >= 1) continue;
        const ox = P.x + Math.cos(K.a) * K.out * ease.outCubic(out), oy = P.y + Math.sin(K.a) * K.out * ease.outCubic(out), oz = 0.6 + K.up * Math.sin(out * Math.PI * 0.5);
        const e = ease.inQuad(back), tx = P.to.x, ty = P.to.y, tz = 0.7;
        const wx = ox + (tx - ox) * e, wy = oy + (ty - oy) * e, wz = oz + (tz - oz) * e + Math.sin(back * Math.PI) * 0.4;
        const sx = isoX(wx, wy), sy = isoY(wx, wy, wz);
        let rot;
        if (back > 0) { const hx = isoX(tx, ty), hy = isoY(tx, ty, tz); rot = Math.atan2(hy - sy, hx - sx); } else rot = K.a + lt * K.spin; // ring first, back into the hand
        // a streak behind it on the way back
        if (back > 0) {
          ctx.strokeStyle = `rgba(200,225,255,${0.55 * (1 - back)})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(rot) * 26, sy - Math.sin(rot) * 26); ctx.stroke();
        }
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot); ctx.scale(0.9, 0.9); // (about the size of a thrown / stuck kunai)
        ctx.fillStyle = '#dfe8f2'; ctx.strokeStyle = '#1c1820'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-2, -3.2); ctx.lineTo(1, 0); ctx.lineTo(-2, 3.2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a2a2a'; ctx.fillRect(1, -1.2, 7, 2.4);
        ctx.beginPath(); ctx.arc(10, 0, 2.2, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      // a glint where they land in the hand
      const last = Math.max(...P.knives.map((K) => K.d)) + 0.46;
      if (t > last - 0.06 && t < last + 0.12) {
        const k = (t - last + 0.06) / 0.18, hx = isoX(P.to.x, P.to.y), hy = isoY(P.to.x, P.to.y, 0.7);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,250,220,${1 - k})`; ctx.lineWidth = 2;
        const L = 8 + 14 * k;
        ctx.beginPath(); ctx.moveTo(hx - L, hy); ctx.lineTo(hx + L, hy); ctx.moveTo(hx, hy - L); ctx.lineTo(hx, hy + L); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }
  // the Shishi shield's Bulwark release: a lion's mane of gold spikes bursting outward (its own look, no other weapon's)
  roar(x, y, r, dur = 0.7) { this.roars.push({ x, y, r, t: 0, dur, rot: rand(0, TAU) }); }
  // the Earth Shaper's gloves: jagged cracks splitting the ground out to r (seeded per quake)
  quake(x, y, r, dur = 0.9) {
    const cracks = [];
    const n = Math.max(6, Math.round(5 + r * 1.5));
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + rand(-0.2, 0.2), pts = []; let d = 0; while (d < r) { d = Math.min(r, d + rand(0.3, 0.6) * Math.max(1, r / 3)); pts.push([a + rand(-0.18, 0.18), d]); } cracks.push(pts); }
    this.quakes.push({ x, y, r, t: 0, dur, cracks });
  }
  // the holy staff's Halo Sweep: a thin band of gold light sweeping a narrow arc far out in front (side = sweep direction)
  halo(x, y, ang, range, arcDeg, side = 1, dur = 0.4, inner = 0.25) { this.halos.push({ x, y, ang, range, arc: arcDeg * Math.PI / 180, side, t: 0, dur, inner }); } // inner: where the band starts (share of range)
  // the spirit orb breaking: little ghosts fly up out of where it shattered, swaying, and fade away
  ghosts(x, y, r, n = 6, dur = 1.3) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), d = rand(0.1, r); this.ghostsUp.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, t: -rand(0, 0.25), dur: dur * rand(0.8, 1.15), ph: rand(0, TAU), s: rand(0.75, 1.15), drift: rand(-14, 14) }); } }
  // the gloves' Rising Crag: a great dark slab of rock bursting out of the ground at an angle along (ux, uy)
  crag(x, y, ux, uy, dur = 1.1) { this.crags.push({ x, y, ux, uy, t: 0, dur, seed: rand(0, 9) }); }
  // the spirit orb's Soul Drop: a pale splash of souls on the ground, rippling out, with wisps curling up
  soulSplash(x, y, r, dur = 0.7) { this.splashes.push({ x, y, r, t: 0, dur, rot: rand(0, TAU) }); }
  // the gloves' rock breaking up out of the ground before the punch
  rise(x, y, dur = 0.32) { this.rises.push({ x, y, t: 0, dur, seed: rand(0, 9) }); }
  drawEarth(ctx) {
    for (const G of this.ghostsUp) { // a round head, two dark eyes and a curling tail, rising and fading
      if (G.t < 0) continue;
      const k = G.t / G.dur, a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      const sx = isoX(G.x, G.y) + Math.sin(G.ph + k * 7) * 6 + G.drift * k, sy = isoY(G.x, G.y, 0.3) - 70 * ease.outQuad(k), R = 6.5 * G.s;
      ctx.save(); ctx.translate(sx, sy); ctx.globalAlpha *= Math.max(0, a) * 0.85;
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.4); gl.addColorStop(0, 'rgba(170,220,255,0.45)'); gl.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, R * 2.4, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      const sw = Math.sin(G.ph + k * 12) * R * 0.6;
      ctx.fillStyle = 'rgba(232,246,255,0.92)';
      ctx.beginPath(); ctx.arc(0, 0, R, Math.PI, 0); ctx.quadraticCurveTo(R, R * 1.2, sw + R * 0.3, R * 2.4); ctx.quadraticCurveTo(sw - R * 0.2, R * 1.5, -R, R * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(30,40,70,0.85)'; ctx.beginPath(); ctx.ellipse(-R * 0.35, -R * 0.1, R * 0.17, R * 0.24, 0, 0, TAU); ctx.ellipse(R * 0.35, -R * 0.1, R * 0.17, R * 0.24, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const H of this.halos) { // drawn on the ground plane: a crescent band with a bright leading edge
      const k = H.t / H.dur, sweep = ease.outCubic(Math.min(1, k / 0.45)), a = 1 - Math.max(0, (k - 0.35) / 0.65);
      ctx.save(); ctx.translate(isoX(H.x, H.y), isoY(H.x, H.y, 0.5)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4 + H.ang);
      const R = H.range * 45.25, h = H.arc / 2, from = -h * H.side, to = from + H.arc * H.side * sweep;
      const a0 = Math.min(from, to), a1 = Math.max(from, to);
      ctx.globalCompositeOperation = 'lighter';
      const R0 = R * (H.inner ?? 0.25), g2 = ctx.createRadialGradient(0, 0, R0, 0, 0, R);
      g2.addColorStop(0, 'rgba(255,230,150,0)'); g2.addColorStop(0.75, `rgba(255,226,140,${0.28 * a})`); g2.addColorStop(1, `rgba(255,248,220,${0.55 * a})`);
      ctx.fillStyle = g2; ctx.beginPath(); ctx.moveTo(Math.cos(a0) * R0, Math.sin(a0) * R0); ctx.arc(0, 0, R, a0, a1); ctx.arc(0, 0, R0, a1, a0, true); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(255,250,225,${0.9 * a})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(Math.cos(to) * R0, Math.sin(to) * R0); ctx.lineTo(Math.cos(to) * R, Math.sin(to) * R); ctx.stroke();
      ctx.strokeStyle = `rgba(255,226,140,${0.35 * a})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, R0, a0, a1); ctx.stroke(); // the inner edge of the band
      ctx.strokeStyle = `rgba(255,214,120,${0.7 * a})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.stroke();
      for (let q = 0; q < 5; q++) { const aa = a0 + (a1 - a0) * (q + 0.5) / 5, rr = R0 + (R - R0) * (0.2 + 0.7 * ((q * 7) % 5) / 5); ctx.fillStyle = `rgba(255,250,230,${0.8 * a})`; ctx.beginPath(); ctx.arc(Math.cos(aa) * rr, Math.sin(aa) * rr, 2.2, 0, TAU); ctx.fill(); } // motes of light
      ctx.restore();
    }
    for (const C of this.crags) { // a slab of dark rock leaning toward the enemy, rising fast, then crumbling away
      const k = C.t / C.dur, up = ease.outBack ? ease.outBack(Math.min(1, C.t / 0.14)) : ease.outCubic(Math.min(1, C.t / 0.14)), fall = k > 0.7 ? (k - 0.7) / 0.3 : 0;
      const sx = isoX(C.x, C.y), sy = isoY(C.x, C.y), dir = Math.atan2(isoY(C.x + C.ux, C.y + C.uy) - isoY(C.x, C.y), isoX(C.x + C.ux, C.y + C.uy) - sx);
      const lean = Math.cos(dir) >= 0 ? 0.6 : -0.6, H = 62 * up * (1 - fall * 0.6), W = 22;
      ctx.save(); ctx.translate(sx, sy); ctx.globalAlpha *= 1 - fall;
      // the ground it tore open: a dark hole, then a raised lip of earth behind the rock
      ctx.fillStyle = 'rgba(30,18,10,0.75)'; ctx.beginPath(); ctx.ellipse(0, 0, W * 1.25, W * 0.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a3c22'; ctx.beginPath(); ctx.ellipse(0, -2, W * 1.3, W * 0.42, 0, Math.PI, TAU); ctx.ellipse(0, -2, W * 0.95, W * 0.28, 0, TAU, Math.PI, true); ctx.fill();
      ctx.save(); ctx.translate(0, fall * 12); // (it sinks back into the hole as it crumbles)
      ctx.beginPath(); ctx.rect(-W * 3, -H * 2, W * 6, H * 2 + 3); ctx.clip(); // nothing of it below the ground line
      ctx.transform(1, 0, -lean, 1, 0, 0); // lean toward the enemy, the base flat on the floor
      const pts = [[-W, 0], [-W * 0.8, -H * 0.45], [-W * 0.35, -H * 0.9], [W * 0.05, -H], [W * 0.5, -H * 0.62], [W * 0.75, -H * 0.2], [W, 0]];
      ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath();
      const gr = ctx.createLinearGradient(-W, 0, W, -H); gr.addColorStop(0, '#2e1c10'); gr.addColorStop(0.55, '#4a2f1a'); gr.addColorStop(1, '#6a4428');
      ctx.fillStyle = gr; ctx.fill(); ctx.strokeStyle = '#140c08'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(150,100,60,0.55)'; ctx.lineWidth = 1.4; // a few cracks and a lit edge
      ctx.beginPath(); ctx.moveTo(-W * 0.3, -H * 0.2); ctx.lineTo(-W * 0.05, -H * 0.5); ctx.lineTo(-W * 0.2, -H * 0.72); ctx.moveTo(W * 0.3, -H * 0.15); ctx.lineTo(W * 0.15, -H * 0.4); ctx.stroke();
      ctx.strokeStyle = 'rgba(190,140,90,0.6)'; ctx.beginPath(); ctx.moveTo(-W * 0.35, -H * 0.9); ctx.lineTo(W * 0.05, -H); ctx.lineTo(W * 0.5, -H * 0.62); ctx.stroke();
      ctx.restore();
      // the near lip of the hole and loose rubble heaped against the foot of the rock
      ctx.fillStyle = '#6a4828'; ctx.beginPath(); ctx.ellipse(0, 1, W * 1.3, W * 0.45, 0, 0, Math.PI); ctx.ellipse(0, 1, W * 1.0, W * 0.3, 0, Math.PI, 0, true); ctx.fill();
      ctx.strokeStyle = '#140c08'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(0, 1, W * 1.3, W * 0.45, 0, 0, Math.PI); ctx.stroke();
      for (let q = 0; q < 7; q++) { const a = (q / 7) * Math.PI + 0.2, rx = Math.cos(a) * W * (1.05 + 0.25 * ((q * 5) % 3) / 2), ry = Math.sin(a) * W * 0.42 + 2, rr = 2.5 + ((q * 7 + C.seed * 3) % 3);
        ctx.fillStyle = q % 2 ? '#4a2f1a' : '#7a5634'; ctx.beginPath(); ctx.ellipse(rx, ry, rr * 1.3, rr, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#140c08'; ctx.lineWidth = 0.8; ctx.stroke(); }
      ctx.restore();
    }
    for (const R of this.rises) {
      const k = Math.min(1, R.t / R.dur), sx = isoX(R.x, R.y), sy = isoY(R.x, R.y, 0.15 + 0.55 * ease.outCubic(k)), s = 0.5 + 0.5 * k;
      ctx.save(); ctx.translate(sx, sy); ctx.scale(s, s); ctx.rotate(R.seed + k * 0.6);
      ctx.beginPath(); for (let q = 0; q < 7; q++) { const a = (q / 7) * TAU, rr = 10 * (0.78 + 0.22 * ((q * 3) % 4) / 3); q ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath();
      ctx.fillStyle = '#5a3a22'; ctx.fill(); ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
    for (const Rr of this.roars) {
      const k = Rr.t / Rr.dur, e = ease.outCubic(k), a = 1 - k, sx = isoX(Rr.x, Rr.y), sy = isoY(Rr.x, Rr.y, 0.3);
      ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.55); ctx.globalCompositeOperation = 'lighter';
      const R0 = Rr.r * 45.25 * (0.25 + 0.75 * e), n = 18;
      for (let i = 0; i < n; i++) { // the mane: long gold spikes with crimson-gold tips
        const ang = Rr.rot + (i / n) * TAU + k * 0.4, L = R0 * (i % 2 ? 0.75 : 1), w = 0.12;
        ctx.fillStyle = `rgba(255,196,90,${0.75 * a})`;
        ctx.beginPath(); ctx.moveTo(Math.cos(ang - w) * L * 0.35, Math.sin(ang - w) * L * 0.35); ctx.lineTo(Math.cos(ang) * L, Math.sin(ang) * L); ctx.lineTo(Math.cos(ang + w) * L * 0.35, Math.sin(ang + w) * L * 0.35); ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgba(255,110,60,${0.6 * a})`; ctx.beginPath(); ctx.arc(Math.cos(ang) * L, Math.sin(ang) * L, 4, 0, TAU); ctx.fill();
      }
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, R0 * 0.5); gr.addColorStop(0, `rgba(255,236,170,${0.7 * a})`); gr.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R0 * 0.5, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  drawQuakes(ctx) {
    for (const P of this.splashes) { // pale rings rippling out from where the orb struck, souls curling up off them
      const k = P.t / P.dur, e = ease.outCubic(k), a = 1 - k;
      ctx.save(); ctx.translate(isoX(P.x, P.y), isoY(P.x, P.y)); ctx.scale(1, 0.5);
      const R = P.r * 45.25;
      for (let i = 0; i < 3; i++) { const rr = R * Math.min(1, e * (1 - i * 0.18)); ctx.strokeStyle = `rgba(170,220,255,${(0.75 - i * 0.2) * a})`; ctx.lineWidth = 4 - i; ctx.setLineDash([10 - i * 2, 6]); ctx.lineDashOffset = P.rot * 20 + k * 40 * (i % 2 ? -1 : 1); ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke(); }
      ctx.setLineDash([]);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, R * e); gr.addColorStop(0, `rgba(210,240,255,${0.35 * a})`); gr.addColorStop(1, 'rgba(120,180,240,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R * e, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const Q of this.quakes) {
      const k = Q.t / Q.dur, grow = Math.min(1, Q.t / 0.18), a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      ctx.save(); ctx.translate(isoX(Q.x, Q.y), isoY(Q.x, Q.y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [lw, col] of [[4.5, `rgba(40,24,12,${0.7 * a})`], [1.6, `rgba(200,140,80,${0.55 * a})`]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
        for (const pts of Q.cracks) { ctx.moveTo(0, 0); for (const [ang, d] of pts) { if (d > Q.r * grow) break; ctx.lineTo(Math.cos(ang) * d * 45.25, Math.sin(ang) * d * 45.25); } }
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ring(x, y, radius, color, dur = 0.4, width = 6) {
    this.rings.push({ x, y, radius, color, t: 0, dur, width });
  }
  text(x, y, str, color, size = 16, crit = false) {
    this.texts.push({ x: x + rand(-0.2, 0.2), y: y + rand(-0.2, 0.2), z: 1.2, str, color, size, crit, t: 0, dur: crit ? 0.95 : 0.7, vx: rand(-14, 14) });
  }

  update(dt) {
    for (const arr of [this.slashes, this.rings, this.texts, this.bolts, this.thrusts, this.spirits, this.pools, this.pulls, this.roars, this.quakes, this.rises, this.halos, this.crags, this.splashes, this.ghostsUp]) {
      for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t >= arr[i].dur) arr.splice(i, 1); }
    }
  }

  drawGround(ctx) {
    for (const P of this.pools) {
      const k = P.t / P.dur, a = Math.min(1, P.t * 4) * Math.min(1, (P.dur - P.t) * 2), RX = P.radius * 45.25;
      ctx.save(); ctx.translate(isoX(P.x, P.y), isoY(P.x, P.y)); ctx.scale(1, 0.5); ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, RX);
      gr.addColorStop(0, `rgba(255,236,170,${0.3 * a})`); gr.addColorStop(0.8, `rgba(255,210,120,${0.18 * a})`); gr.addColorStop(1, 'rgba(255,210,120,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, RX, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255,240,200,${0.5 * a})`; ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) { const r = RX * (((P.t * 0.6 + i * 0.5) % 1)); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
    this.drawSpirits(ctx);
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

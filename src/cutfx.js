// Atmosphere for the cutscenes: drifting particles (fireflies, dust in the light, embers, ghost lights),
// fog bands, light shafts and vignettes, plus background life drawn as soft silhouettes: townsfolk,
// guards, monks, farmers, crows, cats, herons, hanging lanterns and banners. All in screen space;
// k is the view scale, t the scene time. Nothing here keeps state except the Motes particle field.
import { TAU, clamp, lerp, rand } from './util.js';

const hsh = (i, s = 0) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------- particles
// kinds: 'firefly' (blinking green-gold, wandering), 'dust' (warm specks floating in light),
// 'ember' (sparks rising from fires), 'wisp' (pale blue spirit lights, slow and bobbing),
// 'ash' (grey flakes drifting down). area = [x0, y0, x1, y1] as fractions of the screen.
export class Motes {
  constructor(n, kind, area = [0, 0, 1, 1], opts = {}) {
    this.kind = kind; this.area = area; this.opts = opts;
    this.list = Array.from({ length: n }, () => this.spawn(true));
  }
  spawn(anywhere) {
    const [x0, y0, x1, y1] = this.area, K = this.kind;
    const p = { x: rand(x0, x1), y: anywhere ? rand(y0, y1) : K === 'ember' || K === 'wisp' ? y1 : K === 'ash' ? y0 : rand(y0, y1), t: rand(0, 10), life: rand(4, 10), ph: rand(0, TAU), s: rand(0.6, 1.3) };
    if (K === 'ember' && this.opts.sources) { const s = this.opts.sources[Math.floor(Math.random() * this.opts.sources.length)]; p.x = s[0] + rand(-0.01, 0.01); p.y = s[1]; p.life = rand(1.2, 2.6); }
    return p;
  }
  update(dt) {
    const K = this.kind;
    for (const p of this.list) {
      p.t += dt;
      if (K === 'firefly') { p.x += Math.sin(p.t * 0.7 + p.ph) * 0.012 * dt; p.y += Math.cos(p.t * 0.5 + p.ph) * 0.01 * dt; }
      else if (K === 'dust') { p.x += (0.004 + Math.sin(p.t * 0.3 + p.ph) * 0.004) * dt; p.y += Math.sin(p.t * 0.4 + p.ph) * 0.003 * dt - 0.002 * dt; }
      else if (K === 'ember') { p.y -= 0.07 * p.s * dt; p.x += Math.sin(p.t * 3 + p.ph) * 0.01 * dt + 0.006 * dt; }
      else if (K === 'wisp') { p.y -= 0.008 * dt; p.x += Math.sin(p.t * 0.6 + p.ph) * 0.01 * dt; }
      else if (K === 'ash') { p.y += 0.02 * p.s * dt; p.x += Math.sin(p.t * 0.9 + p.ph) * 0.008 * dt + 0.004 * dt; }
      if (p.t > p.life) Object.assign(p, this.spawn(false));
    }
  }
  draw(ctx, W, H, k) {
    const K = this.kind;
    ctx.save(); ctx.globalCompositeOperation = K === 'ash' ? 'source-over' : 'lighter';
    for (const p of this.list) {
      const fade = Math.sin(clamp(p.t / p.life, 0, 1) * Math.PI), x = p.x * W, y = p.y * H;
      if (K === 'firefly') {
        const b = Math.max(0, Math.sin(p.t * 2.2 + p.ph)) * fade;
        if (b < 0.02) continue;
        const r = 9 * k * p.s, g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(230,255,140,${0.9 * b})`); g.addColorStop(0.25, `rgba(190,240,90,${0.45 * b})`); g.addColorStop(1, 'rgba(190,240,90,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      } else if (K === 'dust') {
        ctx.fillStyle = `rgba(255,236,190,${0.55 * fade})`; ctx.beginPath(); ctx.arc(x, y, 1.3 * k * p.s, 0, TAU); ctx.fill();
      } else if (K === 'ember') {
        ctx.fillStyle = `rgba(255,${150 + Math.round(60 * Math.sin(p.t * 9))},60,${0.85 * fade})`; ctx.beginPath(); ctx.arc(x, y, 1.6 * k * p.s, 0, TAU); ctx.fill();
      } else if (K === 'wisp') {
        const r = 14 * k * p.s, bob = Math.sin(p.t * 1.7 + p.ph) * 3 * k, g = ctx.createRadialGradient(x, y + bob, 0, x, y + bob, r);
        g.addColorStop(0, `rgba(210,240,255,${0.75 * fade})`); g.addColorStop(0.3, `rgba(130,190,255,${0.35 * fade})`); g.addColorStop(1, 'rgba(130,190,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y + bob, r, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(150,200,255,${0.25 * fade})`; ctx.beginPath(); ctx.ellipse(x, y + bob + r * 0.6, r * 0.25, r * 0.7, 0, 0, TAU); ctx.fill(); // a little tail
      } else {
        ctx.fillStyle = `rgba(150,150,160,${0.5 * fade})`; ctx.fillRect(x, y, 2 * k * p.s, 1.4 * k * p.s);
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- light and air
// a band of drifting fog at height y (px), h tall
export function fog(ctx, W, H, k, t, y, h, rgb, alpha, speed = 10, seed = 0, blobs = 5) {
  ctx.save();
  for (let i = 0; i < blobs; i++) {
    const span = W + 700 * k, x = ((t * speed * (0.7 + hsh(i, seed) * 0.6) * k + hsh(i, seed + 1) * span) % span) - 350 * k;
    const yy = y + (hsh(i, seed + 2) - 0.5) * h * 0.6, r = (180 + hsh(i, seed + 3) * 160) * k;
    const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
    g.addColorStop(0, `rgba(${rgb},${alpha})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.save(); ctx.translate(x, yy); ctx.scale(2.6, (h / r) * 0.45 + 0.12); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.restore(); ctx.fill();
  }
  ctx.restore();
}
// slanted shafts of light falling from (x, y)
export function lightShafts(ctx, W, H, k, t, x, y, rgb, n = 5, alpha = 0.09, spread = 0.9, dirA = Math.PI / 2) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const a = dirA + (i / (n - 1) - 0.5) * spread + Math.sin(t * 0.2 + i) * 0.03;
    const len = H * 1.1, w0 = 6 * k, w1 = (60 + hsh(i, 4) * 60) * k, al = alpha * (0.6 + 0.4 * Math.sin(t * 0.5 + i * 1.7));
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len, nx = -Math.sin(a), ny = Math.cos(a);
    const g = ctx.createLinearGradient(x, y, ex, ey); g.addColorStop(0, `rgba(${rgb},${al})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x + nx * w0, y + ny * w0); ctx.lineTo(ex + nx * w1, ey + ny * w1); ctx.lineTo(ex - nx * w1, ey - ny * w1); ctx.lineTo(x - nx * w0, y - ny * w0); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
export function vignette(ctx, W, H, rgb = '0,0,0', strength = 0.55) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(1, `rgba(${rgb},${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
// a soft glow (additive)
export function glow(ctx, x, y, r, rgb, a) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
}

// ---------------------------------------------------------------- props
// a paper lantern hanging from a cord at (x, y), swaying; lit = glowing
export function hangingLantern(ctx, x, y, k, t, seed, { col = '#d84a32', len = 18, lit = true, label = '' } = {}) {
  const sw = Math.sin(t * 1.3 + seed) * 0.12, lx = x + Math.sin(sw) * len * k, ly = y + Math.cos(sw) * len * k;
  ctx.strokeStyle = '#141018'; ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(lx, ly); ctx.stroke();
  if (lit) glow(ctx, lx, ly + 10 * k, 46 * k, '255,150,70', 0.32 + 0.06 * Math.sin(t * 7 + seed));
  ctx.save(); ctx.translate(lx, ly + 10 * k); ctx.rotate(sw * 0.6);
  ctx.fillStyle = '#1a1214'; ctx.fillRect(-6 * k, -11 * k, 12 * k, 3 * k); ctx.fillRect(-6 * k, 8 * k, 12 * k, 3 * k);
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 12 * k); g.addColorStop(0, lit ? '#ffd9a0' : col); g.addColorStop(1, col);
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 9 * k, 9 * k, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(40,10,10,0.45)'; ctx.lineWidth = 0.8 * k; for (const yy of [-5, 0, 5]) { ctx.beginPath(); ctx.ellipse(0, yy * k, 8.6 * k * Math.cos(Math.asin(yy / 9)), 1.2 * k, 0, 0, TAU); ctx.stroke(); }
  if (label) { ctx.fillStyle = '#1a0a08'; ctx.font = `800 ${Math.round(8 * k)}px "Shippori Mincho", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, 0.5 * k); }
  ctx.restore();
}
// a tall nobori banner on a pole at (x, y = foot), cloth flapping
export function nobori(ctx, x, y, k, t, seed, { col = '#7a1420', h = 120, mon = '#d8a838' } = {}) {
  ctx.strokeStyle = '#120e14'; ctx.lineWidth = 2.5 * k; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h * k); ctx.stroke();
  const top = y - (h - 4) * k, bh = (h * 0.62) * k, bw = 16 * k;
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, top);
  for (let i = 0; i <= 8; i++) { const u = i / 8; ctx.lineTo(x + bw + Math.sin(t * 3 + seed + u * 4) * 3 * k * u, top + u * bh); }
  ctx.lineTo(x, top + bh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = mon; ctx.beginPath(); ctx.arc(x + bw * 0.5 + Math.sin(t * 3 + seed + 1) * k, top + bh * 0.28, 4 * k, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#120e14'; ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + bw + 2 * k, top); ctx.stroke();
}
// a stone toro lantern at its foot (x, y)
export function stoneLantern(ctx, x, y, k, t, lit = true, col = '#4a4650') {
  ctx.fillStyle = col;
  ctx.fillRect(x - 3 * k, y - 26 * k, 6 * k, 26 * k); ctx.fillRect(x - 9 * k, y - 4 * k, 18 * k, 4 * k);
  ctx.fillRect(x - 8 * k, y - 38 * k, 16 * k, 12 * k);
  ctx.beginPath(); ctx.moveTo(x - 13 * k, y - 38 * k); ctx.lineTo(x, y - 48 * k); ctx.lineTo(x + 13 * k, y - 38 * k); ctx.closePath(); ctx.fill();
  if (lit) { ctx.fillStyle = `rgba(255,170,90,${0.7 + 0.2 * Math.sin(t * 6 + x)})`; ctx.fillRect(x - 4 * k, y - 35 * k, 8 * k, 6 * k); glow(ctx, x, y - 32 * k, 40 * k, '255,150,70', 0.25); }
}

// ---------------------------------------------------------------- background life: silhouettes
// a person drawn as a soft dark shape standing on (x, y), h px tall.
// kind: guard (jingasa + spear), archer (bow), courtier (wide robe + tall hat), monk (straw kasa + ringed staff),
// farmer (bent over, straw hat), traveler (kasa, bundle, stick), child, townsman. o.walk animates the legs,
// o.dir faces left (-1) or right (1), o.lantern carries a lit lantern.
export function figure(ctx, x, y, h, kind, t, o = {}) {
  const col = o.col || '#0d0b12', dir = o.dir || 1, s = h / 60, w = o.walk ? Math.sin(t * 7 + (o.seed || 0)) : 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s);
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round';
  const bent = kind === 'farmer';
  const legs = () => { ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(-2, -22); ctx.lineTo(-3 + w * 5, 0); ctx.moveTo(2, -22); ctx.lineTo(3 - w * 5, 0); ctx.stroke(); };
  if (kind === 'courtier' || kind === 'monk') { // long robes to the ground
    ctx.beginPath(); ctx.moveTo(-6, -44); ctx.lineTo(6, -44); ctx.lineTo(kind === 'courtier' ? 15 : 10, 0); ctx.lineTo(kind === 'courtier' ? -15 : -10, 0); ctx.closePath(); ctx.fill();
  } else if (bent) {
    legs();
    ctx.beginPath(); ctx.moveTo(-3, -24); ctx.quadraticCurveTo(4, -36, 16, -34); ctx.lineTo(18, -28); ctx.quadraticCurveTo(6, -26, 3, -18); ctx.closePath(); ctx.fill(); // bent back
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(14, -30); ctx.lineTo(18 + Math.sin(t * 2 + (o.seed || 0)) * 2, -10); ctx.stroke(); // arm reaching down
  } else {
    legs();
    ctx.beginPath(); ctx.moveTo(-7, -44); ctx.lineTo(7, -44); ctx.lineTo(8, -20); ctx.lineTo(-8, -20); ctx.closePath(); ctx.fill();
  }
  const hx = bent ? 17 : 0, hy = bent ? -36 : -49;
  ctx.beginPath(); ctx.arc(hx, hy, kind === 'child' ? 6 : 5.5, 0, TAU); ctx.fill();
  if (kind === 'guard' || kind === 'archer') { ctx.beginPath(); ctx.moveTo(hx - 11, hy + 1); ctx.lineTo(hx, hy - 7); ctx.lineTo(hx + 11, hy + 1); ctx.closePath(); ctx.fill(); } // jingasa
  if (kind === 'monk' || kind === 'farmer' || kind === 'traveler') { ctx.fillStyle = o.hat || col; ctx.beginPath(); ctx.moveTo(hx - 13, hy + 2); ctx.quadraticCurveTo(hx, hy - 12, hx + 13, hy + 2); ctx.closePath(); ctx.fill(); ctx.fillStyle = col; } // straw kasa (o.hat: its colour)
  if (kind === 'courtier') { ctx.fillRect(hx - 3, hy - 16, 6, 12); } // eboshi
  if (kind === 'guard') { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(10, -80); ctx.stroke(); ctx.beginPath(); ctx.moveTo(10, -80); ctx.lineTo(7, -72); ctx.lineTo(13, -72); ctx.closePath(); ctx.fill(); }
  if (kind === 'archer') { ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(-6, -34, 22, -1.3, 1.3); ctx.stroke(); }
  if (kind === 'monk') { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(12, -64); ctx.stroke(); ctx.beginPath(); ctx.arc(12, -68, 4, 0, TAU); ctx.lineWidth = 1.4; ctx.stroke(); }
  if (kind === 'traveler') { ctx.beginPath(); ctx.ellipse(-9, -36, 7, 9, 0.3, 0, TAU); ctx.fill(); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(9, -46); ctx.stroke(); }
  if (o.lantern) { ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(8, -30); ctx.lineTo(18, -44); ctx.stroke(); }
  ctx.restore();
  if (o.lantern) { // the lantern itself, lit
    const lx = x + dir * 18 * s, ly = y - 40 * s + Math.sin(t * 3 + (o.seed || 0)) * s;
    glow(ctx, lx, ly, 34 * s, '255,160,80', 0.35);
    ctx.fillStyle = '#ffb860'; ctx.beginPath(); ctx.ellipse(lx, ly, 3.4 * s, 4.4 * s, 0, 0, TAU); ctx.fill();
  }
}
// a crow, perched (bobbing, now and then a head turn) or flying (flapping)
export function crow(ctx, x, y, s, t, perched = true, col = '#0c0a10') {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = col; ctx.strokeStyle = col;
  if (perched) {
    const look = Math.sin(t * 0.8) > 0.6 ? -1 : 1;
    ctx.beginPath(); ctx.ellipse(0, -6, 6, 4.5, -0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(5 * look, -10, 3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(7.5 * look, -10.5); ctx.lineTo(11 * look, -9.5); ctx.lineTo(7.5 * look, -9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-5 * look, -5); ctx.lineTo(-12 * look, -1); ctx.lineTo(-5 * look, -3); ctx.fill();
    ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-1, -2); ctx.lineTo(-1, 0); ctx.moveTo(2, -2); ctx.lineTo(2, 0); ctx.stroke();
  } else {
    const f = Math.sin(t * 9) * 5;
    ctx.beginPath(); ctx.moveTo(-12, -2 + f); ctx.quadraticCurveTo(-5, -4, 0, 0); ctx.quadraticCurveTo(5, -4, 12, -2 + f); ctx.quadraticCurveTo(5, 1, 0, 2); ctx.quadraticCurveTo(-5, 1, -12, -2 + f); ctx.fill();
  }
  ctx.restore();
}
// a small V-shaped bird in flight
export function flyingBird(ctx, x, y, s, t, col = 'rgba(30,24,30,0.7)') {
  const f = Math.sin(t * 8) * 3 * s;
  ctx.strokeStyle = col; ctx.lineWidth = 1.4 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 7 * s, y - 2 * s + f); ctx.quadraticCurveTo(x - 3 * s, y - 3 * s, x, y); ctx.quadraticCurveTo(x + 3 * s, y - 3 * s, x + 7 * s, y - 2 * s + f); ctx.stroke();
}
// a bat: jagged wings flickering
export function bat(ctx, x, y, s, t, col = '#08060c') {
  const f = Math.sin(t * 18) * 0.7;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s * (0.6 + Math.abs(f) * 0.6)); ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-4, -3); ctx.lineTo(-9, -1); ctx.lineTo(-7, 2); ctx.lineTo(-4, 1); ctx.lineTo(0, 3); ctx.lineTo(4, 1); ctx.lineTo(7, 2); ctx.lineTo(9, -1); ctx.lineTo(4, -3); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// a cat sitting (tail swishing) or slinking (walking)
export function cat(ctx, x, y, s, t, walking = false, dir = 1, col = '#0c0a10') {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round';
  if (walking) {
    const w = Math.sin(t * 8);
    ctx.beginPath(); ctx.ellipse(0, -7, 9, 3.6, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = 1.6; for (const [lx, ph] of [[-6, 0], [-3, 1], [4, 1], [7, 0]]) { ctx.beginPath(); ctx.moveTo(lx, -5); ctx.lineTo(lx + (ph ? w : -w) * 2, 0); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(10, -9, 3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8.5, -11); ctx.lineTo(9, -14); ctx.lineTo(10.5, -11.5); ctx.moveTo(11, -11.5); ctx.lineTo(12.5, -14); ctx.lineTo(12.5, -10.5); ctx.fill();
    ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-9, -8); ctx.quadraticCurveTo(-15, -14, -13, -18 + w); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.ellipse(0, -6, 5.5, 6.5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(1, -14, 3.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-1.5, -16.5); ctx.lineTo(-1.2, -20); ctx.lineTo(0.8, -17); ctx.moveTo(1.8, -17); ctx.lineTo(3.6, -20); ctx.lineTo(4.2, -16); ctx.fill();
    ctx.lineWidth = 1.4; const sw = Math.sin(t * 1.5) * 3; ctx.beginPath(); ctx.moveTo(-4, -1); ctx.quadraticCurveTo(-10, 0, -11 + sw, -6); ctx.stroke();
  }
  ctx.restore();
}
// a heron standing in shallow water, now and then dipping its head
export function heron(ctx, x, y, s, t, seed = 0, col = 'rgba(240,240,236,0.95)') {
  const dip = Math.max(0, Math.sin(t * 0.4 + seed) - 0.85) * 6;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = '#3a3438'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(-1, -12); ctx.moveTo(1.5, 0); ctx.lineTo(1, -12); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, -16, 7, 4.5, -0.25, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(4, -18); ctx.quadraticCurveTo(4, -27 + dip, 7, -29 + dip * 2); ctx.stroke();
  ctx.fillStyle = '#d8a838'; ctx.beginPath(); ctx.moveTo(8, -30 + dip * 2); ctx.lineTo(14, -28 + dip * 2.6); ctx.lineTo(8, -28 + dip * 2); ctx.fill();
  ctx.fillStyle = '#1a1418'; ctx.fillRect(5, -32 + dip * 2, 5, 1.2);
  ctx.restore();
}
// a butterfly or dragonfly flitting around (x, y)
export function flitter(ctx, x, y, s, t, seed, kind = 'butterfly', col = '#f8e8a0') {
  const fx = x + Math.sin(t * 1.3 + seed) * 18 * s + Math.sin(t * 3.1 + seed * 2) * 6 * s, fy = y + Math.cos(t * 1.7 + seed) * 10 * s;
  ctx.save(); ctx.translate(fx, fy); ctx.scale(s, s);
  if (kind === 'dragonfly') {
    ctx.strokeStyle = '#4a7aa8'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
    ctx.fillStyle = 'rgba(220,240,255,0.55)'; const f = Math.sin(t * 40) * 0.4;
    for (const sx of [-1, 1]) for (const dx of [-1, 1.5]) { ctx.beginPath(); ctx.ellipse(dx, sx * 3, 4, 1.4, sx * (0.3 + f), 0, TAU); ctx.fill(); }
  } else {
    const f = Math.abs(Math.sin(t * 12 + seed));
    ctx.fillStyle = col; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * 3 * f, -1, 3.2 * f + 0.4, 3, sx * 0.4, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#2a2020'; ctx.fillRect(-0.4, -3, 0.8, 5);
  }
  ctx.restore();
}
// a hitodama: a pale blue spirit flame with a tail, floating
export function spiritFlame(ctx, x, y, s, t, seed, a = 1) {
  const bob = Math.sin(t * 1.4 + seed) * 4 * s, px = x + Math.sin(t * 0.6 + seed) * 6 * s;
  glow(ctx, px, y + bob, 30 * s, '140,200,255', 0.3 * a);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(200,236,255,${0.75 * a})`;
  ctx.beginPath(); ctx.arc(px, y + bob, 5 * s, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(140,200,255,${0.4 * a})`; ctx.beginPath(); ctx.moveTo(px - 4 * s, y + bob); ctx.quadraticCurveTo(px - 2 * s + Math.sin(t * 5 + seed) * 3 * s, y + bob + 12 * s, px + Math.sin(t * 4 + seed) * 4 * s, y + bob + 20 * s); ctx.quadraticCurveTo(px + 2 * s, y + bob + 8 * s, px + 4 * s, y + bob); ctx.fill();
  ctx.restore();
}
// a lightning flash value for scene time t (0 most of the time, a sharp double flash now and then)
export function lightning(t, every = 9, seed = 0) {
  const c = (t + seed) % every, f1 = c > every - 0.5 ? Math.max(0, 1 - (c - (every - 0.5)) / 0.12) : 0, f2 = c > every - 0.3 ? Math.max(0, 1 - (c - (every - 0.3)) / 0.25) : 0;
  return clamp(Math.max(f1, f2 * 0.8), 0, 1);
}
export { hsh, lerp };

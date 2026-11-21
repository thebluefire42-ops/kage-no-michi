// Corrupted nodes: after a route node is chosen it can turn out to be corrupted, changing the level:
//   mist      – the colours drain to grey and thick clouds drift over the arena, hiding what is under them
//   storm     – rain, a darker sky, and lightning that strikes near / at the players after a short red warning,
//               hurting players and enemies alike in a small spot
//   bloodmoon – enemies deal +25% damage and everything turns dark red
// The host (or a solo game) rolls it when the node is chosen (rollCorruption); it travels in the level info, so the
// joiner sees the same. Lightning strikes are decided by the host and sent to the joiner ('cstrike') to show.
// Holy Water (tea house) keeps it away for a number of levels (game.holyWater).
import { CORRUPTION, BOSSES } from './config.js';
import { TAU, rand, isoX, isoY, clamp, dist } from './util.js';
import { sfx } from './audio.js';
import { net } from './net.js';
import { SHADOW } from './rig.js';

export const CORRUPT_INFO = {
  mist: { name: 'Mist', jp: '霧', sub: 'Grey clouds hang low over the field' },
  storm: { name: 'Storm', jp: '嵐', sub: 'Watch the ground: lightning strikes where it glows red' },
  bloodmoon: { name: 'Blood Moon', jp: '血月', sub: 'Enemies strike 25% harder' },
};

// can a node of this kind on this level be corrupted at all (not tea houses, training halls or boss fights)
export const canCorrupt = (level, r) => !BOSSES[level] && r !== 'item' && r !== 'art' && r !== 'training';
// a corruption kind by weight, never `not` (the map's corrupt button picks one different from the last)
function pickKind(not = null) {
  const kinds = Object.keys(CORRUPTION.weights).filter((k) => k !== not), total = kinds.reduce((a, k) => a + CORRUPTION.weights[k], 0);
  let v = Math.random() * total;
  for (const k of kinds) { v -= CORRUPTION.weights[k]; if (v <= 0) return k; }
  return kinds[0];
}

// the chance that a node of this level turns out corrupted (0 for tea houses, training halls and boss fights)
export function corruptionChance(level, r) {
  if (!canCorrupt(level, r)) return 0;
  const area = level > 30 ? 3 : Math.floor((level - 1) / 10), inArea = ((level - 1) % 10) + 1;
  if (area === 0) return inArea >= CORRUPTION.area1From ? CORRUPTION.chance[0] : 0;
  return CORRUPTION.chance[area];
}

// called when the players choose a node: maybe corrupt it (Holy Water keeps it pure, and says so)
export function rollCorruption(g, nd, level) {
  if (!nd) return;
  nd.corrupt = null; nd.purified = false;
  // the map's corner button: this node is corrupted for sure, with a different corruption than last time
  // (it waits for a node that can be corrupted; it beats Holy Water, since the player asked for it)
  if (g.forceCorrupt && canCorrupt(level, nd.r)) { g.forceCorrupt = false; nd.corrupt = pickKind(g.lastCorrupt || null); return; }
  if (Math.random() >= corruptionChance(level, nd.r)) return;
  if ((g.holyWater || 0) > 0) { nd.purified = true; return; }
  nd.corrupt = pickKind();
}

// a new level: set up its corruption state (clouds, rain, strike timer)
export function startCorruption(g) {
  const kind = g.levelInfo && g.levelInfo.corrupt;
  g.corrupt = kind ? { kind, t: 0, strikes: [], next: CORRUPTION.storm.firstDelay, clouds: [], rain: [], flash: 0, sky: 0, sheet: rand(2, 5) } : null;
  // the blood moon covers the sun: night, and no shadows anywhere
  const blood = kind === 'bloodmoon';
  SHADOW.off = blood;
  if (g.world) { g.world.noShadows = blood; g.world.forceNight = blood ? CORRUPTION.bloodmoon.dark : null; }
  if (!kind) return;
  g.lastCorrupt = kind;
  const N = g.world.N, C = g.corrupt;
  if (kind === 'mist') {
    const n = Math.round((N * N) / CORRUPTION.mist.tilesPerCloud);
    for (let i = 0; i < n; i++) {
      const puffs = [];
      const m = 5 + Math.floor(Math.random() * 4);
      const thick = Math.random() < CORRUPTION.mist.thick; // thick clouds hide everything under them; thin ones only some
      for (let j = 0; j < m; j++) puffs.push({ dx: rand(-1.6, 1.6), dy: rand(-1.0, 1.0), r: rand(1.1, 2.0) * (thick ? 1.1 : 1), z: rand(1.3, 2.2), ph: rand(0, TAU) });
      C.clouds.push({ x: rand(-2, N + 2), y: rand(-2, N + 2), vx: rand(0.1, 0.26), vy: rand(-0.1, 0.05), puffs, thick, a: thick ? rand(0.93, 0.99) : rand(0.4, 0.58) });
    }
  }
}

// every step: strikes (host / solo decide them; everyone ages them), drifting clouds
export function updateCorruption(g, dt, authoritative) {
  const C = g.corrupt;
  if (!C) return;
  C.t += dt; C.flash = Math.max(0, C.flash - dt * 2.2); C.sky = Math.max(0, C.sky - dt * 1.8);
  if (C.kind === 'mist') {
    const N = g.world.N;
    for (const c of C.clouds) {
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.x > N + 4) c.x = -4; if (c.y < -4) c.y = N + 4; if (c.y > N + 4) c.y = -4;
    }
  }
  if (C.kind !== 'storm') return;
  const S = CORRUPTION.storm;
  // sheet lightning far off in the clouds now and then (only a glow and a distant rumble)
  C.sheet -= dt;
  C.rumble = (C.rumble ?? 1) - dt;
  if (C.rumble <= 0) { C.rumble = rand(2.4, 4.2); sfx.rumble(); } // the storm grumbles on in the background
  if (C.sheet <= 0) { C.sheet = rand(S.sheet[0], S.sheet[1]); C.sky = 1; g.later(rand(0.3, 1.1), () => sfx.thunder(true)); } // (the rumble comes a moment after the light)
  if (authoritative && g.state === 'play' && !g.cleared) {
    C.next -= dt;
    const alive = g.players.filter((p) => p.active);
    if (C.next <= 0 && alive.length) {
      C.next = rand(S.every[0], S.every[1]);
      const p = alive[Math.floor(Math.random() * alive.length)];
      let x = p.x, y = p.y;
      if (Math.random() > S.direct) { const a = rand(0, TAU), d = rand(0.6, S.spread); x += Math.cos(a) * d; y += Math.sin(a) * d; }
      // a burst: strike after strike, each hopping on from the last (one of them comes back toward the player)
      const n = S.burst[0] + Math.floor(Math.random() * (S.burst[1] - S.burst[0] + 1));
      let delay = 0;
      for (let k = 0; k < n; k++) {
        if (k) { delay += rand(S.gap[0], S.gap[1]); const a = k === 2 ? Math.atan2(p.y - y, p.x - x) + rand(-0.6, 0.6) : rand(0, TAU), d = rand(S.hop[0], S.hop[1]); x += Math.cos(a) * d; y += Math.sin(a) * d; }
        x = clamp(x, 0.8, g.world.N - 0.8); y = clamp(y, 0.8, g.world.N - 0.8);
        addStrike(g, x, y, delay);
        if (g.role === 'host') net.send('cstrike', { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, d: Math.round(delay * 100) / 100 });
      }
    }
  }
  for (const s of C.strikes) {
    s.t += dt;
    if (!s.hit && s.t >= S.warn) { s.hit = true; strike(g, s, authoritative); }
  }
  C.strikes = C.strikes.filter((s) => s.t < S.warn + 0.6);
}

export function addStrike(g, x, y, delay = 0) {
  if (!g.corrupt) return;
  g.corrupt.strikes.push({ x, y, t: -delay, hit: false }); // (t < 0: not shown yet, the burst's later strikes)
  if (!delay) sfx.zap();
}

// the bolt lands: everyone in the spot is hurt (players and enemies alike)
function strike(g, s, authoritative) {
  const S = CORRUPTION.storm;
  g.fx.bolt(s.x + rand(-0.4, 0.4), s.y + rand(-0.4, 0.4), 9, s.x, s.y, 0);
  g.fx.bolt(s.x, s.y, 9, s.x, s.y, 0);
  g.fx.ring(s.x, s.y, S.radius, 'rgba(220,235,255,0.95)', 0.35, 6); // (exactly the warned circle)
  g.particles.burst('spark', s.x, s.y, 0.2, 22, 7, 0.4, 2, '#e8f2ff');
  g.particles.burst('dust', s.x, s.y, 0.05, 10, 3, 0.6, 5, '#3a3a44', { under: true });
  g.decals.add(s.x, s.y, S.radius * 0.7, 'rgba(25,22,30,1)', 8);
  g.corrupt.flash = 1;
  g.shake(11); sfx.thunder(); sfx.zap();
  if (!authoritative) return; // (the joiner only shows it; the host deals the damage)
  for (const p of g.players) if (p.active && dist(p.x, p.y, s.x, s.y) < S.radius) p.hurt(S.playerDmg, s.x, s.y, 7);
  for (const e of g.enemies) {
    if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden || dist(e.x, e.y, s.x, s.y) > S.radius + e.r) continue;
    const dx = e.x - s.x, dy = e.y - s.y, l = Math.hypot(dx, dy) || 1;
    g.damageEnemy(e, Math.round(S.enemyDmg * rand(0.9, 1.1)), false, dx / l, dy / l, 4, 0.5, null);
  }
}

// on the ground, under everyone: the red warning circles that fill up before a strike, then a scorch glow
export function drawCorruptionGround(ctx, g, t) {
  const C = g.corrupt;
  if (!C || C.kind !== 'storm') return;
  const S = CORRUPTION.storm, RX = S.radius * 45.25, RY = S.radius * 22.6;
  for (const s of C.strikes) {
    if (s.t < 0) continue;
    const cx = isoX(s.x, s.y), cy = isoY(s.x, s.y);
    ctx.save(); ctx.translate(cx, cy);
    if (s.t < S.warn) {
      const k = s.t / S.warn, pulse = 0.5 + 0.5 * Math.sin(t * 22);
      ctx.fillStyle = `rgba(230,40,40,${0.12 + 0.2 * k})`; ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(255,70,60,${0.25 + 0.3 * k})`; ctx.beginPath(); ctx.ellipse(0, 0, RX * k, RY * k, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255,${120 + 80 * pulse},110,${0.6 + 0.35 * k})`; ctx.lineWidth = 2 + k * 1.5; ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, 0, TAU); ctx.stroke();
    } else {
      const k = (s.t - S.warn) / 0.6;
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, RX * 1.3);
      gr.addColorStop(0, `rgba(210,230,255,${0.8 * (1 - k)})`); gr.addColorStop(1, 'rgba(120,160,255,0)');
      ctx.fillStyle = gr; ctx.scale(1, 0.5); ctx.beginPath(); ctx.arc(0, 0, RX * 1.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

// over the world (world space): the mist's clouds, thinner right around the players so they can still see themselves
export function drawCorruptionOver(ctx, g, t) {
  const C = g.corrupt;
  if (!C || C.kind !== 'mist') return;
  const pls = g.players.filter((p) => !p.dead);
  for (const c of C.clouds) {
    let near = 1;
    for (const p of pls) near = Math.min(near, clamp((dist(p.x, p.y, c.x, c.y) - 0.6) / 1.9, 0, 1));
    const a = c.a * (0.3 + 0.7 * near);
    for (const q of c.puffs) {
      const x = c.x + q.dx + Math.sin(t * 0.3 + q.ph) * 0.15, y = c.y + q.dy;
      const sx = isoX(x, y), sy = isoY(x, y, q.z), R = q.r * 46;
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
      gr.addColorStop(0, `rgba(214,220,228,${a})`); gr.addColorStop(c.thick ? 0.7 : 0.5, `rgba(200,208,218,${a * (c.thick ? 0.95 : 0.7)})`); gr.addColorStop(1, 'rgba(190,198,210,0)');
      ctx.fillStyle = gr; ctx.save(); ctx.translate(sx, sy); ctx.scale(1.35, 0.8); ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.restore(); ctx.fill();
    }
  }
}

// screen space, over everything but the HUD: the corruption's colour grade, rain and lightning flashes
export function drawCorruptionScreen(ctx, g, v, t) {
  const C = g.corrupt;
  if (!C) return;
  const W = v.W, H = v.H;
  ctx.save();
  if (C.kind === 'mist') { // drain the colour, then a cold pale wash
    ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'rgba(128,128,128,0.3)'; ctx.fillRect(0, 0, W, H); // only a little colour drained
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(150,172,188,0.16)'; ctx.fillRect(0, 0, W, H); // a cold blue-grey haze
    for (let i = 0; i < 4; i++) { // low banks of fog sliding across the screen
      const x = ((t * (14 + i * 6) + i * 520) % (W + 1000)) - 500, y = H * (0.2 + i * 0.22);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, 420 * (v.k || 1));
      gr.addColorStop(0, 'rgba(225,232,238,0.22)'); gr.addColorStop(1, 'rgba(225,232,238,0)');
      ctx.fillStyle = gr; ctx.save(); ctx.translate(x, y); ctx.scale(2, 0.5); ctx.beginPath(); ctx.arc(0, 0, 420 * (v.k || 1), 0, TAU); ctx.restore(); ctx.fill();
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(20,28,40,0)'); vg.addColorStop(1, 'rgba(20,28,40,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  } else if (C.kind === 'bloodmoon') { // a dark night (the world's night lighting does the darkness) with a hint of red
    ctx.fillStyle = 'rgba(70,10,24,0.12)'; ctx.fillRect(0, 0, W, H);
    const a = 0.5 + 0.06 * Math.sin(t * 0.7);
    const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
    gr.addColorStop(0, 'rgba(8,2,12,0)'); gr.addColorStop(1, `rgba(8,2,12,${a})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  } else if (C.kind === 'storm') { // darker sky, slanting rain, white flash on a strike
    ctx.fillStyle = 'rgba(12,18,34,0.42)'; ctx.fillRect(0, 0, W, H); // a dark sky
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(6,8,18,0)'); vg.addColorStop(1, 'rgba(6,8,18,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // heavy, wind-driven rain
    const k = v.k || 1, n = Math.round((W * H) / (5200 * k));
    while (C.rain.length < n) C.rain.push({ x: rand(0, W), y: rand(0, H), l: rand(14, 30), s: rand(0.75, 1.25) });
    ctx.strokeStyle = 'rgba(190,205,235,0.34)'; ctx.lineWidth = 1.2 * k; ctx.beginPath();
    for (const d of C.rain) {
      const y = (d.y + t * 1050 * d.s * k) % (H + 60) - 30, x = (d.x + t * 380 * d.s * k) % (W + 60) - 30;
      ctx.moveTo(x, y); ctx.lineTo(x - d.l * 0.36 * k, y - d.l * k);
    }
    ctx.stroke();
    // far-off sheet lightning lights the clouds; a strike blinds: a white burst that flickers once and fades
    // (a flicker: a quick bright pulse, a dip, a second pulse, then it fades; a strike close by, sheet lightning far off)
    const flicker = (f) => (f > 0.82 ? 1 : f > 0.68 ? 0.25 : f > 0.55 ? 0.75 : f * f);
    if (C.sky > 0) { ctx.fillStyle = `rgba(180,196,240,${0.13 * flicker(C.sky)})`; ctx.fillRect(0, 0, W, H); }
    if (C.flash > 0) { ctx.fillStyle = `rgba(230,236,255,${0.32 * flicker(C.flash)})`; ctx.fillRect(0, 0, W, H); }
  }
  ctx.restore();
}

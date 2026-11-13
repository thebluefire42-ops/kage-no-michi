// Level arenas: biome palettes, procedural layout, cached ground, animated props, weather and lighting.
import { TAU, clamp, lerp, rand, isoX, isoY, seededRng, hash2, dist } from './util.js';
import { INK } from './rig.js';
import { sfx } from './audio.js';

export const BIOMES = [
  {
    key: 'spring', name: 'Haruno Rice Paddies', jp: '春野の里',
    grass: ['#80ad58', '#87b35e', '#8eb963', '#96bf69'], outer: '#5b8746', path: '#c9a878', pathDark: '#a98a5e',
    skyTop: '#a9cfe3', skyBot: '#efe7cf', mountains: ['#9db6c2', '#7d9aa8'], weather: 'petal',
    tuft: ['#5f9440', '#78ad4c', '#4f8035'], grade: 'rgba(255,226,200,0.10)', vignette: 'rgba(60,35,30,0.4)',
    trees: ['cherry', 'cherry', 'green'], night: false,
  },
  {
    key: 'autumn', name: 'Momiji Mountain Pass', jp: '紅葉峠',
    grass: ['#a48d4b', '#ad9550', '#b69d56', '#bfa55c'], outer: '#6f5b34', path: '#a49a8a', pathDark: '#7f776a',
    skyTop: '#e8a87a', skyBot: '#f5dcc0', mountains: ['#b0705e', '#8a5048'], weather: 'leaf',
    tuft: ['#9a8040', '#b8983e', '#7f6a34'], grade: 'rgba(255,170,90,0.08)', vignette: 'rgba(60,25,10,0.38)',
    trees: ['maple', 'maple', 'ginkgo'], night: false, fog: true,
  },
  {
    key: 'winter', name: 'Yukishiro Castle Town', jp: '雪城下町',
    grass: ['#d8e0ea', '#dfe6ef', '#e5ebf3', '#ebf0f7'], outer: '#a7b4c6', path: '#8b8e99', pathDark: '#6c6f7a',
    skyTop: '#0e1430', skyBot: '#2c3458', mountains: ['#2a3152', '#1d2340'], weather: 'snow',
    tuft: ['#6b6450', '#58523f', '#7a735c'], grade: 'rgba(90,120,200,0.10)', vignette: 'rgba(5,8,25,0.55)',
    trees: ['pine'], night: true,
  },
  {
    key: 'fortress', name: 'Kagerō Fortress', jp: '陽炎城',
    grass: ['#56525c', '#5c5862', '#625e68', '#68646e'], outer: '#2e2a32', path: '#8a8478', pathDark: '#6a645a',
    skyTop: '#07050e', skyBot: '#3a1420', mountains: ['#1c1420', '#140e18'], weather: 'ash',
    tuft: ['#4a4a3a', '#3e3e30', '#555540'], grade: 'rgba(220,70,50,0.07)', vignette: 'rgba(10,2,8,0.6)',
    trees: ['pine'], night: true, dark: 'rgba(14,6,16,0.58)',
  },
];
// Gensai's grand hall (level 33): lacquered floor, gold screens, warm brazier light
const HALL_BIOME = {
  ...BIOMES[3], key: 'hall', name: "The Regent's Grand Hall", jp: '大広間',
  grass: ['#4a2418', '#4f2719', '#542a1b', '#592d1d'], outer: '#140806', weather: 'none',
  grade: 'rgba(255,170,80,0.06)', vignette: 'rgba(12,2,2,0.62)', dark: 'rgba(24,8,6,0.42)',
};

const P = (x, y, z = 0) => [isoX(x, y), isoY(x, y, z)];
function poly(ctx, pts, fill, stroke = INK, lw = 1.5) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; } else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export class World {
  constructor(levelNum, biomeIdx, seed, opts = {}) {
    this.level = levelNum;
    this.bi = biomeIdx;
    this.biome = opts.hall ? HALL_BIOME : BIOMES[biomeIdx];
    this.rng = seededRng(seed);
    // every level is a little different: arena size, gate/spawn spots and the road's curve vary
    this.N = opts.hall ? 24 : this.rng.int(26, 32);
    // the throne hall: the throne sits in the back corner, the players enter at the front
    this.hall = opts.hall ? { throne: { x: 3.3, y: 3.3 } } : null;
    this.props = [];
    this.rects = [];
    this.circles = [];
    this.tufts = [];
    this.paddies = [];
    this.ponds = [];
    this.lights = [];
    this.emitters = [];
    this.weather = [];
    this.clouds = [];
    const r = this.rng, N = this.N;
    this.gate = { x: r.range(3.2, 6), y: r.range(3.2, 6), active: false, glow: 0 };
    this.spawn = { x: N - r.range(3.5, 6), y: N - r.range(3.5, 6) };
    if (this.hall) { this.gate = { x: N - 2.5, y: 2.5, active: false, glow: 0 }; this.spawn = { x: N - 4, y: N - 4 }; }
    this.path = this.makePath();
    this.generate();
    // spring atmosphere: butterflies and passing bird flocks
    this.butterflies = [];
    this.birds = null; this.birdT = rand(3, 8);
    if (biomeIdx === 0) {
      for (let i = 0; i < 12; i++) this.butterflies.push({ x: rand(2, N - 2), y: rand(2, N - 2), z: rand(0.4, 1.2), a: rand(0, TAU), ph: rand(0, 10), col: ['#fff6e0', '#ffd84a', '#f7a8c8', '#ffffff', '#ffb050'][i % 5] });
    }
  }

  // house doorways enemies can step out of: inside point (x,y) -> outside point (ox,oy)
  doors() {
    const out = [];
    for (const p of this.props) if (p.kind === 'house') { const mx = (p.x0 + p.x1) / 2; out.push({ house: p, x: mx, y: p.y1 - 0.2, ox: mx, oy: p.y1 + 0.9 }); }
    for (const p of this.props) if (p.kind === 'hdoor') out.push({ house: p, x: p.dx, y: p.dy, ox: p.ox, oy: p.oy });
    return out;
  }

  // winding road from the spawn to the gate (cubic bezier with random bends), sampled every ~0.12 tiles
  makePath() {
    const r = this.rng, s = this.spawn, g = this.gate;
    const dx = g.x - s.x, dy = g.y - s.y, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    const b1 = r.range(-5, 5), b2 = r.range(-5, 5);
    const p1 = [s.x + dx * 0.33 + nx * b1, s.y + dy * 0.33 + ny * b1];
    const p2 = [s.x + dx * 0.66 + nx * b2, s.y + dy * 0.66 + ny * b2];
    const pts = [];
    const n = Math.ceil(len / 0.12);
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * u * s.x + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * g.x;
      const y = u * u * u * s.y + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * g.y;
      pts.push([clamp(x, 1.5, this.N - 1.5), clamp(y, 1.5, this.N - 1.5)]);
    }
    return pts;
  }
  nearPath(x, y, d) { for (let i = 0; i < this.path.length; i += 3) { const p = this.path[i]; if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < d * d) return true; } return false; }

  // ---------- generation ----------
  generate() {
    if (this.hall) { this.generateHall(); return; }
    const r = this.rng, N = this.N, b = this.biome;
    const area = (N * N) / (22 * 22); // more content on bigger maps
    const occ = [];
    for (let i = 0; i < N; i++) { occ.push(new Array(N).fill(false)); }
    const mark = (x0, y0, x1, y1) => { for (let i = Math.max(0, Math.floor(x0)); i < Math.min(N, Math.ceil(x1)); i++) for (let j = Math.max(0, Math.floor(y0)); j < Math.min(N, Math.ceil(y1)); j++) occ[i][j] = true; };
    const free = (x0, y0, x1, y1) => {
      if (x0 < 1 || y0 < 1 || x1 > N - 1 || y1 > N - 1) return false;
      for (let i = Math.floor(x0); i < Math.ceil(x1); i++) for (let j = Math.floor(y0); j < Math.ceil(y1); j++) if (occ[i][j]) return false;
      return true;
    };
    // reserve the road, gate area, spawn area and a central fighting space (boss arena)
    const gt = this.gate, sp = this.spawn;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const cx = i + 0.5, cy = j + 0.5;
      if (this.nearPath(cx, cy, 1.4)) occ[i][j] = true;
      if (Math.hypot(cx - gt.x, cy - gt.y) < 3.6) occ[i][j] = true;
      if (Math.hypot(cx - sp.x, cy - sp.y) < 3.6) occ[i][j] = true;
      if (Math.hypot(cx - N / 2, cy - N / 2) < 3.4) occ[i][j] = true;
    }
    // paddies (spring) / onsen (autumn) / frozen pond (winter)
    if (this.bi === 0) {
      const n = r.int(2, 3) + (area > 1.6 ? 1 : 0);
      for (let k = 0; k < n * 20 && this.paddies.length < n; k++) {
        const w = r.int(3, 5), h = r.int(3, 4), x = r.int(1, N - w - 1), y = r.int(1, N - h - 1);
        if (free(x, y, x + w, y + h)) { this.paddies.push({ x0: x, y0: y, x1: x + w, y1: y + h }); mark(x, y, x + w, y + h); }
      }
    } else if (this.bi !== 3) {
      const np = area > 1.6 ? 2 : 1;
      for (let k = 0; k < 60 && this.ponds.length < np; k++) {
        const x = r.int(3, N - 6), y = r.int(3, N - 6);
        if (free(x - 0.5, y - 0.5, x + 3.5, y + 3.5)) {
          const pond = { x: x + 1.5, y: y + 1.5, r: 1.35, kind: this.bi === 1 ? 'onsen' : 'ice' };
          this.ponds.push(pond); mark(x - 0.5, y - 0.5, x + 3.5, y + 3.5);
          if (pond.kind === 'onsen') this.circles.push({ x: pond.x, y: pond.y, r: pond.r + 0.15 });
        }
      }
    }
    // houses
    const nh = Math.round((this.bi === 1 ? r.int(2, 4) : r.int(3, 5)) * Math.sqrt(area) + r.int(0, 1));
    let tries = 0;
    while (this.props.filter((p) => p.kind === 'house').length < nh && tries++ < 300) {
      const w = r.int(2, 4), h = r.int(2, 3);
      const x = r.int(1, N - w - 1), y = r.int(1, N - h - 1);
      if (!free(x - 1, y - 1, x + w + 1, y + h + 1)) continue;
      mark(x - 0.6, y - 0.6, x + w + 0.6, y + h + 0.6);
      const burning = this.bi === 2 && r() < 0.45;
      this.props.push({ kind: 'house', x0: x, y0: y, x1: x + w, y1: y + h, x: x + w / 2, y: y + h / 2, burning, seed: r() * 100 });
      this.rects.push({ x0: x, y0: y, x1: x + w, y1: y + h });
      if (!burning && this.bi < 2 && r() < 0.8) this.emitters.push({ kind: 'chimney', x: x + w / 2, y: y + h / 2, z: 2.4, t: 0 });
      if (burning) {
        this.emitters.push({ kind: 'fire', x: x + w / 2, y: y + h / 2, z: 2, w, h, t: 0 });
        this.lights.push({ x: x + w / 2, y: y + h / 2, z: 1.5, r: 5.5, color: '255,140,60', flicker: 1, i: 1 });
      } else if (this.bi >= 2) {
        this.lights.push({ x: x + w / 2, y: y + h, z: 0.4, r: 2.6, color: '255,200,120', flicker: 0.3, i: 0.75 });
      }
    }
    const place = (kind, count, rr, extra = {}, margin = 0.5) => {
      let n = 0, t = 0;
      while (n < count && t++ < 200) {
        const x = r.int(1, N - 2) + 0.5, y = r.int(1, N - 2) + 0.5;
        if (!free(x - margin, y - margin, x + margin, y + margin)) continue;
        mark(x - margin, y - margin, x + margin, y + margin);
        const p = Object.assign({ kind, x, y, seed: r() * 100 }, typeof extra === 'function' ? extra() : extra);
        this.props.push(p);
        if (rr > 0) this.circles.push({ x, y, r: rr });
        n++;
      }
    };
    // trees
    const A = (lo, hi) => Math.round(r.int(lo, hi) * area);
    place('tree', this.bi === 3 ? A(2, 4) : A(5, 9), 0.36, () => ({ variant: r.pick(b.trees), h: r.range(2.4, 3.3), blobs: makeBlobs(r) }));
    if (this.bi === 1) place('bamboo', A(3, 5), 0.55, () => ({ stalks: Array.from({ length: r.int(5, 8) }, () => [r.range(-0.45, 0.45), r.range(-0.45, 0.45), r.range(3, 4.3), r() * 10]) }), 0.8);
    place('lantern', this.bi === 3 ? A(4, 6) : A(2, 4), 0.28);
    if (this.bi === 3) place('brazier', A(2, 3), 0.3);
    place('rock', A(2, 5), 0.42, () => ({ s: r.range(0.7, 1.2), pts: Array.from({ length: 8 }, (_, i) => r.range(0.75, 1.1)) }));
    if (this.bi === 0) place('scarecrow', A(1, 2), 0.2);
    if (this.bi !== 3) place('bales', A(1, 2), 0.5);
    if (this.bi !== 3) place('jizo', A(1, 2), 0.25);
    place('banner', this.bi === 3 ? A(4, 5) : A(2, 3), 0.12, () => ({ color: this.bi === 3 ? r.pick(['#8a1420', '#1a1418']) : r.pick(['#c23b2e', '#2e4a8a', '#e8e0cc']) }));
    if (this.bi !== 3 && r() < 0.6) place('well', 1 + (r() < area - 1 ? 1 : 0), 0.55);

    // lights for lanterns
    for (const p of this.props) if (p.kind === 'lantern') this.lights.push({ x: p.x, y: p.y, z: 0.9, r: this.bi >= 2 ? 3.2 : 2.2, color: '255,190,110', flicker: 0.5, i: 0.9, prop: p });
    for (const p of this.props) if (p.kind === 'brazier') { this.lights.push({ x: p.x, y: p.y, z: 1, r: 4.2, color: '255,140,60', flicker: 1, i: 1 }); this.emitters.push({ kind: 'brazier', x: p.x, y: p.y, z: 1.1, t: 0 }); }

    // torii gate (exit)
    const g = this.gate;
    this.props.push({ kind: 'torii', x: g.x, y: g.y });
    this.circles.push({ x: g.x - 1, y: g.y + 1, r: 0.2 }, { x: g.x + 1, y: g.y - 1, r: 0.2 });

    // outer decor (no collision)
    for (let k = 0; k < Math.round(26 * Math.sqrt(area)); k++) {
      const side = r.int(0, 1), along = r.range(-3, N + 3), out = r.range(1.2, 4);
      const x = side ? along : -out, y = side ? -out : along;
      this.props.push({ kind: 'tree', x, y, variant: r.pick(b.trees), h: r.range(2.6, 3.8), blobs: makeBlobs(r), outer: true, seed: r() * 100 });
    }
    for (let k = 0; k < 14; k++) {
      const side = r.int(0, 1), along = r.range(0, N), out = r.range(0.8, 2.5);
      const x = side ? along : N + out, y = side ? N + out : along;
      this.props.push({ kind: r() < 0.5 ? 'bush' : 'rock', x, y, s: r.range(0.6, 1), pts: Array.from({ length: 8 }, () => r.range(0.75, 1.1)), outer: true, seed: r() * 100 });
    }
    // fences along back edges
    for (let i = 0; i < N; i += 1) {
      const fk = this.bi === 3 ? 'fwall' : 'fence';
      if (Math.abs(i + 0.5 - g.x) > 2.6) this.props.push({ kind: fk, x: i + 0.5, y: -0.1, axis: 'x', outer: true });
      if (Math.abs(i + 0.5 - g.y) > 2.6) this.props.push({ kind: fk, x: -0.1, y: i + 0.5, axis: 'y', outer: true });
    }

    // grass tufts
    const nt = Math.round((this.bi === 0 ? 260 : this.bi === 1 ? 190 : this.bi === 3 ? 25 : 70) * area);
    for (let k = 0; k < nt; k++) {
      const x = r.range(-1, N + 1), y = r.range(-1, N + 1);
      if (this.nearPath(x, y, 1.1)) continue;
      if (this.paddies.some((p) => x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1)) continue;
      this.tufts.push({ x, y, h: r.range(0.5, 1), c: r.int(0, 2), ph: r() * 10, flower: this.bi === 0 && r() < 0.18 ? r.pick(['#f7d6e0', '#fff6d0', '#f2a0b8', '#e8e0ff']) : null });
    }
    for (const p of this.paddies) {
      for (let x = p.x0 + 0.35; x < p.x1 - 0.2; x += 0.5) for (let y = p.y0 + 0.35; y < p.y1 - 0.2; y += 0.55) {
        this.tufts.push({ x: x + r.range(-0.05, 0.05), y, h: r.range(0.6, 0.8), c: 3, ph: r() * 10, rice: true });
      }
    }
    this.tufts.sort((a, b2) => a.x + a.y - (b2.x + b2.y));

    // cherry petal / leaf emitters
    for (const p of this.props) {
      if (p.kind === 'tree' && (p.variant === 'cherry' || p.variant === 'maple' || p.variant === 'ginkgo')) this.emitters.push({ kind: 'leaves', x: p.x, y: p.y, z: p.h, variant: p.variant, t: rand(0, 2) });
      if (p.kind === 'lantern' && this.bi !== 2) { /* lanterns softly glow in day too */ }
    }
    for (const pond of this.ponds) if (pond.kind === 'onsen') this.emitters.push({ kind: 'steam', x: pond.x, y: pond.y, z: 0.1, r: pond.r, t: 0 });

    for (let k = 0; k < 3; k++) this.clouds.push({ x: r.range(-10, 30), y: r.range(-10, 30), s: r.range(4, 7), v: r.range(0.3, 0.6) });
    this.mountainSeed = r() * 1000;
  }

  // Gensai's grand hall: throne and dais in the back corner, a red carpet down the middle, two rows
  // of lacquered pillars, gold folding screens on the back walls with sliding doors for his guard.
  generateHall() {
    const N = this.N, T = this.hall.throne;
    this.props.push({ kind: 'throne', x: T.x - 0.9, y: T.y - 0.9 });
    this.circles.push({ x: T.x - 0.9, y: T.y - 0.9, r: 0.75 });
    for (const d of [8, 13, 18]) for (const s of [-1, 1]) {
      const x = d + s * 3.2, y = d - s * 3.2;
      this.props.push({ kind: 'pillar', x, y }); this.circles.push({ x, y, r: 0.38 });
    }
    for (const [x, y] of [[6.2, 2.0], [2.0, 6.2], [11, 5.5], [5.5, 11], [16.5, 10.5], [10.5, 16.5]]) {
      this.props.push({ kind: 'brazier', x, y, seed: x }); this.circles.push({ x, y, r: 0.3 });
      this.lights.push({ x, y, z: 1, r: 4.6, color: '255,150,70', flicker: 1, i: 1 });
      this.emitters.push({ kind: 'brazier', x, y, z: 1.1, t: 0 });
    }
    this.lights.push({ x: T.x, y: T.y, z: 1.5, r: 5, color: '255,200,120', flicker: 0.2, i: 0.8 });
    // back walls: gold screens, with sliding doors the guard steps out of
    const doorsAt = [7.5, 13.5, 19.5];
    for (let i = 0; i < N; i++) {
      const c = i + 0.5;
      const door = doorsAt.includes(c);
      this.props.push(door ? { kind: 'hdoor', axis: 'x', x: c, y: -0.1, dx: c, dy: 0.4, ox: c, oy: 1.5, outer: true } : { kind: 'screen', axis: 'x', x: c, y: -0.1, seed: i, outer: true });
      this.props.push(door ? { kind: 'hdoor', axis: 'y', x: -0.1, y: c, dx: 0.4, dy: c, ox: 1.5, oy: c, outer: true } : { kind: 'screen', axis: 'y', x: -0.1, y: c, seed: i + 50, outer: true });
      this.props.push({ kind: 'rail', axis: 'x', x: c, y: N + 0.1, outer: true }, { kind: 'rail', axis: 'y', x: N + 0.1, y: c, outer: true });
    }
    for (const [x, y] of [[0.4, 10.5], [0.4, 16.5], [10.5, 0.4], [16.5, 0.4]]) this.props.push({ kind: 'banner', x: x + 0.5, y: y + 0.5, color: '#8a1420', seed: x + y });
    this.mountainSeed = 0;
  }

  // ---------- collision ----------
  collide(e) {
    const N = this.N, rad = e.r;
    if (e.x < 0.3 + rad) e.x = 0.3 + rad; if (e.y < 0.3 + rad) e.y = 0.3 + rad;
    if (e.x > N - 0.3 - rad) e.x = N - 0.3 - rad; if (e.y > N - 0.3 - rad) e.y = N - 0.3 - rad;
    let hit = false;
    for (const q of this.rects) {
      const cx = clamp(e.x, q.x0, q.x1), cy = clamp(e.y, q.y0, q.y1);
      const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
      if (d2 < rad * rad) {
        hit = true;
        if (d2 > 1e-6) { const d = Math.sqrt(d2), push = rad - d; e.x += (dx / d) * push; e.y += (dy / d) * push; }
        else { // inside: push out along shortest axis
          const l = e.x - q.x0, rr = q.x1 - e.x, t = e.y - q.y0, bb = q.y1 - e.y, m = Math.min(l, rr, t, bb);
          if (m === l) e.x = q.x0 - rad; else if (m === rr) e.x = q.x1 + rad; else if (m === t) e.y = q.y0 - rad; else e.y = q.y1 + rad;
        }
      }
    }
    for (const c of this.circles) {
      const dx = e.x - c.x, dy = e.y - c.y, rr = rad + c.r, d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); e.x += (dx / d) * (rr - d); e.y += (dy / d) * (rr - d); hit = true; }
    }
    return hit;
  }
  blocked(x, y, rad = 0.1) {
    const N = this.N;
    if (x < 0.3 || y < 0.3 || x > N - 0.3 || y > N - 0.3) return true;
    for (const q of this.rects) if (x > q.x0 - rad && x < q.x1 + rad && y > q.y0 - rad && y < q.y1 + rad) return true;
    for (const c of this.circles) if ((x - c.x) ** 2 + (y - c.y) ** 2 < (c.r + rad) ** 2) return true;
    return false;
  }
  randomFreePoint(avoidX, avoidY, minDist = 5, rad = 0.5) {
    for (let k = 0; k < 200; k++) {
      const x = rand(1.2, this.N - 1.2), y = rand(1.2, this.N - 1.2);
      if (dist(x, y, avoidX, avoidY) < minDist) continue;
      if (this.blocked(x, y, rad)) continue;
      return [x, y];
    }
    return [this.N / 2, this.N / 2];
  }
  inPaddy(x, y) { return this.paddies.some((p) => x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1); }

  wind(x, y, t) {
    const gust = Math.pow(Math.max(0, Math.sin(t * 0.35 + 1)), 6) * 0.9;
    return Math.sin(t * 1.3 + x * 0.35 + y * 0.2) * 0.45 + Math.sin(t * 2.7 + x * 0.9 - y * 0.4) * 0.18 + gust;
  }

  // ---------- ground cache ----------
  buildGround(scale) {
    const N = this.N, E = 9, b = this.biome, r = seededRng(this.level * 7919 + 13);
    const minX = -(N + 2 * E) * 32, minY = -2 * E * 16;
    const w = 64 * (N + 2 * E), h = 16 * (2 * N + 4 * E);
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
    const g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
    this.groundCanvas = c; this.groundRect = [minX, minY, w, h];

    if (this.hall) { this.buildHallGround(g, N, E, r); return; }
    // tiles
    for (let i = -E; i < N + E; i++) for (let j = -E; j < N + E; j++) {
      const out = Math.max(0, -i, -j, i - N + 1, j - N + 1);
      // smooth large-scale variation instead of per-tile checkerboard
      const hv = clamp(0.5 + Math.sin(i * 0.35 + j * 0.21) * 0.25 + Math.sin(j * 0.47 - i * 0.13) * 0.2 + (hash2(i, j) - 0.5) * 0.18, 0, 0.999);
      let col = b.grass[Math.floor(hv * b.grass.length)];
      g.globalAlpha = out > 0 ? clamp(1 - (out - 1) / (E - 1), 0, 1) : 1;
      if (out > 0) col = shade(b.outer, (hv - 0.5) * 0.12);
      const pts = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      poly(g, pts, col, col, 1.2);
    }
    g.globalAlpha = 1;
    // watercolor blotches
    for (let k = 0; k < 320; k++) {
      const x = r.range(-3, N + 3), y = r.range(-3, N + 3), rad = r.range(0.6, 2.4);
      const [sx, sy] = P(x, y);
      const light = r() < 0.5;
      const grd = g.createRadialGradient(sx, sy, 0, sx, sy, rad * 45);
      const base = light ? '255,255,235' : (this.bi === 2 ? '90,110,150' : this.bi === 3 ? '20,10,24' : '40,60,20');
      grd.addColorStop(0, `rgba(${base},${r.range(0.05, 0.12)})`); grd.addColorStop(1, `rgba(${base},0)`);
      g.fillStyle = grd; g.save(); g.translate(sx, sy); g.scale(1, 0.5); g.translate(-sx, -sy);
      g.beginPath(); g.arc(sx, sy, rad * 45, 0, TAU); g.fill(); g.restore();
    }
    // texture strokes
    g.lineCap = 'round';
    for (let k = 0; k < 1400; k++) {
      const x = r.range(-1, N + 1), y = r.range(-1, N + 1);
      const [sx, sy] = P(x, y);
      g.strokeStyle = this.bi === 2 ? `rgba(140,160,190,${r.range(0.1, 0.25)})` : this.bi === 3 ? `rgba(20,16,24,${r.range(0.08, 0.18)})` : `rgba(40,60,20,${r.range(0.08, 0.2)})`;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + r.range(-2, 2), sy - r.range(2, 5)); g.stroke();
    }
    // the winding road (spawn -> gate), extended a little past both ends so it leads off the map
    const path = this.path;
    const ext = (a, b2, n) => { const dx = a[0] - b2[0], dy = a[1] - b2[1], l = Math.hypot(dx, dy) || 1; const o = []; for (let i = 1; i <= n; i++) o.push([a[0] + (dx / l) * i * 0.12, a[1] + (dy / l) * i * 0.12]); return o; };
    const road = [...ext(path[0], path[3], 30).reverse(), ...path, ...ext(path[path.length - 1], path[path.length - 4], 30)];
    road.forEach(([x, y], i) => {
      const [sx, sy] = P(x, y);
      const edge = Math.min(i, road.length - 1 - i);
      g.globalAlpha = 0.35 * clamp(edge / 30, 0, 1);
      g.fillStyle = b.path;
      g.beginPath(); g.ellipse(sx, sy, 50, 22, 0, 0, TAU); g.fill();
    });
    g.globalAlpha = 1;
    const stepEvery = this.bi === 0 ? 4 : 6; // path samples are 0.12 apart
    for (let i = 0; i < road.length; i += stepEvery) {
      const [px, py] = road[i];
      if (this.bi === 0) { // ruts and pebbles
        for (let k = 0; k < 3; k++) {
          const [sx, sy] = P(px + r.range(-0.5, 0.5), py + r.range(-0.5, 0.5));
          g.fillStyle = `rgba(110,80,50,${r.range(0.15, 0.35)})`; g.beginPath(); g.ellipse(sx, sy, r.range(1, 2.5), r.range(0.6, 1.4), 0, 0, TAU); g.fill();
        }
      } else { // stepping stones
        const x = px, y = py, sz = r.range(0.32, 0.42);
        const pts = [P(x - sz, y - sz), P(x + sz, y - sz), P(x + sz, y + sz), P(x - sz, y + sz)];
        poly(g, pts, shade(b.path, r.range(-0.1, 0.1)), 'rgba(30,25,30,0.6)', 1.2);
        if (this.bi === 2 && r() < 0.6) { g.fillStyle = 'rgba(240,245,255,0.75)'; const [cx, cy] = P(x - sz * 0.3, y - sz * 0.2); g.beginPath(); g.ellipse(cx, cy, 10, 4, 0, 0, TAU); g.fill(); }
      }
    }
    // paddies
    for (const p of this.paddies) {
      const pts = [P(p.x0, p.y0), P(p.x1, p.y0), P(p.x1, p.y1), P(p.x0, p.y1)];
      g.lineJoin = 'round';
      poly(g, pts, '#7a5c3a', '#6a4c2c', 9);
      const inset = 0.15;
      const ip = [P(p.x0 + inset, p.y0 + inset), P(p.x1 - inset, p.y0 + inset), P(p.x1 - inset, p.y1 - inset), P(p.x0 + inset, p.y1 - inset)];
      const [ax, ay] = P(p.x0, p.y0), [bx, by] = P(p.x1, p.y1);
      const grd = g.createLinearGradient(ax, ay, bx, by);
      grd.addColorStop(0, '#9fcbd8'); grd.addColorStop(1, '#6f9fb0');
      poly(g, ip, grd, null);
      g.save(); poly(g, ip, null, null); g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
      for (let k = 0; k < 10; k++) { const [sx, sy] = P(r.range(p.x0, p.x1), r.range(p.y0, p.y1)); g.beginPath(); g.moveTo(sx - 14, sy); g.lineTo(sx + 14, sy); g.stroke(); }
      g.restore();
    }
    // ponds
    for (const pd of this.ponds) {
      const [sx, sy] = P(pd.x, pd.y);
      const R = pd.r * 45;
      if (pd.kind === 'onsen') {
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * TAU; const rx = sx + Math.cos(a) * (R + 6), ry = sy + Math.sin(a) * (R + 6) * 0.5;
          g.fillStyle = shade('#7a7468', r.range(-0.15, 0.15)); g.strokeStyle = INK; g.lineWidth = 1.2;
          g.beginPath(); g.ellipse(rx, ry, r.range(8, 12), r.range(5, 7), 0, 0, TAU); g.fill(); g.stroke();
        }
        const grd = g.createRadialGradient(sx, sy, 0, sx, sy, R);
        grd.addColorStop(0, '#bfeee6'); grd.addColorStop(1, '#6fb8b0');
        g.fillStyle = grd; g.beginPath(); g.ellipse(sx, sy, R, R * 0.5, 0, 0, TAU); g.fill();
      } else {
        const grd = g.createRadialGradient(sx, sy, 0, sx, sy, R * 1.2);
        grd.addColorStop(0, '#d8ecf8'); grd.addColorStop(1, '#a8c8e0');
        g.fillStyle = grd; g.beginPath(); g.ellipse(sx, sy, R * 1.3, R * 0.65, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
        for (let k = 0; k < 6; k++) { g.beginPath(); let cx = sx + r.range(-R, R) * 0.8, cy = sy + r.range(-R, R) * 0.3; g.moveTo(cx, cy); for (let s = 0; s < 3; s++) { cx += r.range(-14, 14); cy += r.range(-5, 5); g.lineTo(cx, cy); } g.stroke(); }
      }
    }
    // biome ground details
    if (this.bi === 1) {
      const cols = ['#d9482b', '#e8742f', '#c23a22', '#f0b040', '#b5302a'];
      for (let k = 0; k < 500; k++) {
        const [sx, sy] = P(r.range(-1, N + 1), r.range(-1, N + 1));
        g.fillStyle = r.pick(cols); g.globalAlpha = r.range(0.5, 0.9);
        g.beginPath(); g.ellipse(sx, sy, r.range(1.5, 3), r.range(0.8, 1.5), r() * TAU, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    } else if (this.bi === 3) { // courtyard flagstones: seams, cracks and a little moss
      g.strokeStyle = 'rgba(20,16,26,0.45)'; g.lineWidth = 1.4;
      for (let i = 0; i <= N; i++) { const a = P(i, 0), c = P(i, N); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); const d = P(0, i), e = P(N, i); g.beginPath(); g.moveTo(d[0], d[1]); g.lineTo(e[0], e[1]); g.stroke(); }
      for (let k = 0; k < 60; k++) { let [sx, sy] = P(r.range(0, N), r.range(0, N)); g.strokeStyle = 'rgba(15,10,20,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(sx, sy); for (let s = 0; s < 3; s++) { sx += r.range(-10, 10); sy += r.range(-4, 4); g.lineTo(sx, sy); } g.stroke(); }
      for (let k = 0; k < 80; k++) { const [sx, sy] = P(r.range(0, N), r.range(0, N)); g.fillStyle = `rgba(70,90,50,${r.range(0.15, 0.35)})`; g.beginPath(); g.ellipse(sx, sy, r.range(2, 6), r.range(1, 3), 0, 0, TAU); g.fill(); }
    } else if (this.bi === 2) {
      for (let k = 0; k < 40; k++) { // footprint trails
        let x = r.range(1, N - 1), y = r.range(1, N - 1); const a = r() * TAU;
        for (let s = 0; s < 8; s++) {
          x += Math.cos(a) * 0.35; y += Math.sin(a) * 0.35;
          const [sx, sy] = P(x + (s % 2 ? 0.08 : -0.08), y);
          g.fillStyle = 'rgba(120,140,170,0.25)'; g.beginPath(); g.ellipse(sx, sy, 2.4, 1.3, 0, 0, TAU); g.fill();
        }
      }
    } else {
      for (let k = 0; k < 180; k++) {
        const [sx, sy] = P(r.range(0, N), r.range(0, N));
        g.fillStyle = r.pick(['#fff', '#ffe08a', '#f7c0d0', '#d8d0ff']); g.globalAlpha = 0.85;
        g.beginPath(); g.arc(sx, sy, r.range(0.8, 1.6), 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    // arena rim: soft darker edge
    g.strokeStyle = this.bi === 2 ? 'rgba(80,95,130,0.25)' : 'rgba(40,40,20,0.18)'; g.lineWidth = 10;
    poly(g, [P(0, 0), P(N, 0), P(N, N), P(0, N)], null, g.strokeStyle, 10);
  }

  // lacquered floorboards, the dais in the back corner and the regent's red carpet
  buildHallGround(g, N, E, r) {
    const b = this.biome;
    for (let i = -E; i < N + E; i++) for (let j = -E; j < N + E; j++) {
      const out = Math.max(0, -i, -j, i - N + 1, j - N + 1);
      const hv = clamp(0.5 + Math.sin(i * 0.9) * 0.2 + (hash2(i, j) - 0.5) * 0.2, 0, 0.999);
      const col = out > 0 ? shade(b.outer, (hv - 0.5) * 0.1) : b.grass[Math.floor(hv * b.grass.length)];
      g.globalAlpha = out > 0 ? clamp(1 - (out - 1) / (E - 1), 0, 1) : 1;
      const pts = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      poly(g, pts, col, col, 1.2);
    }
    g.globalAlpha = 1;
    // plank seams and a lacquer sheen
    g.strokeStyle = 'rgba(20,6,4,0.45)'; g.lineWidth = 1.2;
    for (let i = 0; i <= N * 2; i++) { const a = P(i / 2, 0), c = P(i / 2, N); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    for (let k = 0; k < 120; k++) { const x = r.range(0, N), y = r.range(0, N), a = P(x, y), c = P(x, y + r.range(0.6, 1.6)); g.strokeStyle = 'rgba(255,200,150,0.06)'; g.lineWidth = 3; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    // dais
    const D = 5.6;
    poly(g, [P(0, 0), P(D, 0), P(D, D), P(0, D)], '#2a120e', '#d8a838', 3);
    poly(g, [P(0.5, 0.5), P(D - 0.5, 0.5), P(D - 0.5, D - 0.5), P(0.5, D - 0.5)], '#3a1a12', 'rgba(216,168,56,0.6)', 1.5);
    poly(g, [P(D, 0), P(D + 0.25, 0.25), P(D + 0.25, D + 0.25), P(D, D)], '#1a0a08', null);
    poly(g, [P(0, D), P(D, D), P(D + 0.25, D + 0.25), P(0.25, D + 0.25)], '#120604', null);
    // red carpet from the entrance to the dais
    const w = 1.25, s0 = D - 0.4, s1 = N + 3;
    poly(g, [P(s0 + w, s0 - w), P(s1 + w, s1 - w), P(s1 - w, s1 + w), P(s0 - w, s0 + w)], '#8a1420', null);
    for (const o of [0.95, -0.95]) { const a = P(s0 + o, s0 - o), c = P(s1 + o, s1 - o); g.strokeStyle = '#d8a838'; g.lineWidth = 3; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    for (let d = s0 + 1; d < N; d += 2.2) { const [sx, sy] = P(d, d); g.fillStyle = 'rgba(216,168,56,0.55)'; g.beginPath(); g.ellipse(sx, sy, 12, 6, 0, 0, TAU); g.fill(); }
    // arena rim
    poly(g, [P(0, 0), P(N, 0), P(N, N), P(0, N)], null, 'rgba(216,168,56,0.35)', 4);
  }

  // ---------- update ----------
  update(dt, t, parts, view) {
    this.gate.glow = lerp(this.gate.glow, this.gate.active ? 1 : 0, 1 - Math.exp(-3 * dt));
    for (const p of this.props) if (p.doorT > 0) p.doorT -= dt;
    // butterflies wander in lazy loops
    for (const b of this.butterflies) {
      b.a += Math.sin(t * 0.7 + b.ph) * dt * 2.2;
      b.x += Math.cos(b.a) * dt * 0.9; b.y += Math.sin(b.a) * dt * 0.9;
      b.z = 0.7 + Math.sin(t * 1.3 + b.ph) * 0.35;
      if (b.x < 1 || b.x > this.N - 1 || b.y < 1 || b.y > this.N - 1) b.a += Math.PI * dt * 3;
    }
    if (this.bi === 0) {
      this.birdT -= dt;
      if (this.birdT <= 0 && !this.birds) {
        this.birds = { x: -8, y: rand(0, this.N), vx: 5.5, vy: rand(-1.5, 1.5), n: randiSafe(4, 7), t: 0 };
        this.birdT = rand(10, 18);
      }
      if (this.birds) { const B = this.birds; B.t += dt; B.x += B.vx * dt; B.y += B.vy * dt; if (B.x > this.N + 14) this.birds = null; }
      if (Math.random() < dt * 0.25) sfx.bird();
      // gusts send swirls of petals through the village
      if (this.wind(0, 0, t) > 0.9 && Math.random() < dt * 20) parts.emit('petal', rand(-2, this.N), rand(-2, this.N), rand(1, 3), rand(1.5, 3), rand(-0.5, 0.5), -0.1, 6, rand(2, 3), Math.random() < 0.5 ? '#f7c3d2' : '#fde3ea', { drag: 0.3 });
    }
    for (const e of this.emitters) {
      e.t -= dt;
      if (e.t > 0) continue;
      const w = this.wind(e.x, e.y, t);
      switch (e.kind) {
        case 'chimney':
          e.t = 0.35;
          parts.emit('smoke', e.x, e.y, e.z, 0.4 + w * 0.6, -0.2, 0.7, 3.5, rand(5, 8), 'rgba(235,235,235,1)', { drag: 0.2 });
          break;
        case 'fire':
          e.t = 0.03;
          parts.emit('ember', e.x + rand(-e.w / 2, e.w / 2), e.y + rand(-e.h / 2, e.h / 2), e.z + rand(0, 0.8), rand(-0.5, 0.5) + w, rand(-0.5, 0.5), rand(1.2, 3), rand(0.8, 2), rand(1, 2.4), Math.random() < 0.5 ? '#ffb040' : '#ff6a20', { drag: 0.5 });
          if (Math.random() < 0.25) parts.emit('smoke', e.x + rand(-1, 1), e.y + rand(-1, 1), e.z + 1, w * 0.5, -0.1, 1, 3, rand(8, 12), 'rgba(40,35,45,1)', { drag: 0.2 });
          break;
        case 'leaves':
          e.t = rand(0.4, 1.4);
          if (e.variant === 'cherry') parts.emit('petal', e.x + rand(-0.8, 0.8), e.y + rand(-0.8, 0.8), e.z, rand(-0.3, 0.3), rand(-0.3, 0.3), -0.2, 7, rand(2, 3), Math.random() < 0.5 ? '#f7c3d2' : '#fbdde6', { drag: 0.6 });
          else parts.emit('leaf', e.x + rand(-0.8, 0.8), e.y + rand(-0.8, 0.8), e.z, rand(-0.3, 0.3), rand(-0.3, 0.3), -0.2, 7, rand(2.2, 3.4), e.variant === 'ginkgo' ? '#f0c040' : (Math.random() < 0.5 ? '#d9482b' : '#ef7a30'), { drag: 0.6 });
          break;
        case 'brazier':
          e.t = 0.05;
          parts.emit('ember', e.x + rand(-0.2, 0.2), e.y + rand(-0.2, 0.2), e.z + 0.2, rand(-0.3, 0.3) + w * 0.3, rand(-0.3, 0.3), rand(1.2, 2.6), rand(0.5, 1.2), rand(1, 2), Math.random() < 0.5 ? '#ffb040' : '#ff6a20', { drag: 0.5 });
          break;
        case 'steam':
          e.t = 0.12;
          parts.emit('steam', e.x + rand(-e.r, e.r) * 0.7, e.y + rand(-e.r, e.r) * 0.7, 0.1, w * 0.3, 0, 0.5, 2.6, rand(6, 10), 'rgba(250,250,250,1)', { drag: 0.3 });
          break;
      }
    }
    // fireflies / dust motes
    if (!this.biome.night && Math.random() < dt * 2) {
      const x = rand(0, this.N), y = rand(0, this.N);
      parts.emit('glow', x, y, rand(0.3, 1.5), rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.05, 0.1), rand(3, 6), 1.6, this.bi === 0 ? '#fffbd0' : '#ffe0a0', { drag: 0.1 });
    }
    for (const c of this.clouds) { c.x += c.v * dt; c.y -= c.v * 0.5 * dt; if (c.x > 34) { c.x = -12; c.y = rand(-5, 30); } }
    this.updateWeather(dt, t, view);
  }

  // ---------- weather (screen space) ----------
  updateWeather(dt, t, view) {
    const kind = this.biome.weather, W = view.W, H = view.H;
    if (kind === 'none') { this.weather.length = 0; return; }
    const target = kind === 'snow' ? 170 : kind === 'ash' ? 110 : kind === 'petal' ? 95 : 50;
    while (this.weather.length < target) this.weather.push({ x: rand(0, W), y: rand(-H * 0.2, H), z: rand(0.5, 1.4), ph: rand(0, 10), rot: rand(0, TAU) });
    const dx = view.dcx, dy = view.dcy;
    const w = this.wind(0, 0, t);
    for (const p of this.weather) {
      if (kind === 'snow') { p.x += (w * 30 + Math.sin(t + p.ph) * 12) * p.z * dt * view.k; p.y += 38 * p.z * dt * view.k; }
      else if (kind === 'ash') { p.x += (w * 22 + Math.sin(t * 0.8 + p.ph) * 10) * p.z * dt * view.k; p.y -= (10 + p.z * 8) * dt * view.k; }
      else { p.x += (w * 60 + 25 + Math.sin(t * 2 + p.ph) * 20) * p.z * dt * view.k; p.y += (26 + Math.cos(t * 1.7 + p.ph) * 18) * p.z * dt * view.k; p.rot += dt * 2 * p.z; }
      p.x -= dx * p.z; p.y -= dy * p.z;
      if (p.y > H + 20) { p.y = -20; p.x = rand(0, W); }
      if (p.y < -30) p.y = H + 10;
      if (p.x > W + 20) p.x = -20; if (p.x < -30) p.x = W + 10;
    }
  }

  drawWeather(ctx, view, t) {
    const kind = this.biome.weather, k = view.k;
    for (const p of this.weather) {
      if (kind === 'snow') {
        ctx.fillStyle = `rgba(255,255,255,${0.45 + p.z * 0.35})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.3 * p.z * k, 0, TAU); ctx.fill();
      } else if (kind === 'ash') { // drifting ash, a few glowing embers
        const ember = p.ph > 7.5;
        ctx.fillStyle = ember ? `rgba(255,${140 + Math.round(60 * Math.sin(t * 6 + p.ph))},60,${0.5 + 0.4 * Math.sin(t * 4 + p.ph)})` : `rgba(190,180,185,${0.25 + p.z * 0.25})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, (ember ? 1.4 : 1.1) * p.z * k, 0, TAU); ctx.fill();
      } else if (kind === 'none') {
        break;
      } else {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(p.rot * 1.3 + p.ph)));
        ctx.fillStyle = kind === 'petal' ? (p.ph > 5 ? '#f8c6d4' : '#fde3ea') : (p.ph > 6 ? '#e0542c' : p.ph > 3 ? '#f09a34' : '#c43a26');
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.ellipse(0, 0, 3.4 * p.z * k, 2 * p.z * k, 0, 0, TAU); ctx.fill();
        ctx.restore(); ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- background (screen space) ----------
  drawBackground(ctx, view, t) {
    const b = this.biome, W = view.W, H = view.H;
    if (this.hall) { // indoors: dark lacquered beams, glints of gold
      const hg = ctx.createLinearGradient(0, 0, 0, H);
      hg.addColorStop(0, '#0c0404'); hg.addColorStop(1, '#2a0e0a');
      ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(216,168,56,0.06)';
      for (let i = 0; i < 6; i++) ctx.fillRect(0, H * (0.08 + i * 0.07), W, 2 * view.k);
      return;
    }
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, b.skyTop); grd.addColorStop(1, b.skyBot);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    // horizon in screen coords follows the arena top with parallax
    const topY = view.toScreenY(0, 0) - 120 * view.k;
    const hz = lerp(topY, H * 0.35, 0.35);
    if (b.night) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 90; i++) { const x = hash2(i, 1) * W, y = hash2(i, 2) * hz; ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(t * (0.5 + hash2(i, 3)) + i)); ctx.fillRect(x, y, 1.6, 1.6); }
      ctx.globalAlpha = 1;
      const mx = W * 0.78, my = Math.max(60, hz - 180 * view.k);
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 140 * view.k);
      mg.addColorStop(0, 'rgba(255,250,225,0.5)'); mg.addColorStop(1, 'rgba(255,250,225,0)');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 140 * view.k, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fbf6e2'; ctx.beginPath(); ctx.arc(mx, my, 34 * view.k, 0, TAU); ctx.fill();
    } else {
      const sx = W * 0.2, sy = Math.max(50, hz - 160 * view.k);
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 200 * view.k);
      sg.addColorStop(0, this.bi === 1 ? 'rgba(255,200,140,0.7)' : 'rgba(255,255,230,0.7)'); sg.addColorStop(1, 'rgba(255,255,230,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 200 * view.k, 0, TAU); ctx.fill();
    }
    // mountain ranges with parallax
    const off = view.camX * 0.15 * view.k;
    for (let L = 0; L < 2; L++) {
      ctx.fillStyle = b.mountains[L];
      ctx.beginPath(); ctx.moveTo(0, H);
      const base = hz + L * 40 * view.k;
      for (let x = -20; x <= W + 20; x += 16) {
        const u = (x + off * (L + 1)) / (220 * view.k) + this.mountainSeed + L * 50;
        const y = base - (Math.sin(u) * 0.5 + Math.sin(u * 2.3 + 1) * 0.3 + Math.sin(u * 5.1) * 0.1 + 0.9) * (90 - L * 30) * view.k;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 20, H); ctx.closePath(); ctx.fill();
      if (L === 0 && this.bi !== 2) { // misty band
        const mg = ctx.createLinearGradient(0, base - 40 * view.k, 0, base + 30 * view.k);
        mg.addColorStop(0, 'rgba(255,255,255,0)'); mg.addColorStop(1, 'rgba(255,255,255,0.35)');
        ctx.fillStyle = mg; ctx.fillRect(0, base - 40 * view.k, W, 70 * view.k);
      }
    }
    if (this.bi === 2) this.drawCastle(ctx, W * 0.32 - off * 0.6, hz + 10 * view.k, view.k, t);
    if (this.bi === 3) this.drawCastle(ctx, W * 0.5 - off * 0.8, hz + 40 * view.k, view.k * 2.1, t); // the keep looms right above
    const groundTop = Math.max(-10, hz + 60 * view.k);
    ctx.fillStyle = b.outer; ctx.fillRect(0, groundTop, W, H - groundTop + 10);
  }

  drawCastle(ctx, x, y, k, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.fillStyle = '#141830';
    ctx.fillRect(-70, -40, 140, 40);
    const tiers = [[110, 26], [86, 22], [62, 20], [40, 18]];
    let yy = -40;
    for (const [w, h] of tiers) {
      ctx.fillRect(-w / 2 + 8, yy - h, w - 16, h);
      ctx.beginPath(); ctx.moveTo(-w / 2 - 6, yy - h + 6); ctx.quadraticCurveTo(0, yy - h - 10, w / 2 + 6, yy - h + 6); ctx.lineTo(w / 2 - 4, yy - h - 2); ctx.lineTo(-w / 2 + 4, yy - h - 2); ctx.closePath(); ctx.fill();
      for (let i = -w / 2 + 16; i < w / 2 - 14; i += 12) { ctx.fillStyle = `rgba(255,180,90,${0.5 + 0.3 * Math.sin(t * 3 + i)})`; ctx.fillRect(i, yy - h + 8, 4, 6); ctx.fillStyle = '#141830'; }
      yy -= h + 2;
    }
    // fire glow over the castle town
    const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, 160);
    fg.addColorStop(0, 'rgba(255,110,40,0.28)'); fg.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, 160, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------- ground layer (world space) ----------
  drawGround(ctx, t, players, view) {
    const [x, y, w, h] = this.groundRect;
    // only blit the visible part of the cached ground
    const gs = this.groundCanvas.width / w;
    const cx0 = clamp(view.x0, x, x + w), cx1 = clamp(view.x1, x, x + w), cy0 = clamp(view.y0, y, y + h), cy1 = clamp(view.y1, y, y + h);
    if (cx1 > cx0 && cy1 > cy0) ctx.drawImage(this.groundCanvas, (cx0 - x) * gs, (cy0 - y) * gs, (cx1 - cx0) * gs, (cy1 - cy0) * gs, cx0, cy0, cx1 - cx0, cy1 - cy0);
    this.view = view;
    // paddy glints
    for (const p of this.paddies) {
      for (let k = 0; k < 8; k++) {
        const fx = p.x0 + ((hash2(k, p.x0) * (p.x1 - p.x0) + t * 0.15) % (p.x1 - p.x0)), fy = p.y0 + hash2(p.y0, k) * (p.y1 - p.y0);
        const a = Math.max(0, Math.sin(t * 1.5 + k * 1.7));
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * a})`; ctx.lineWidth = 1.5;
        const sx = isoX(fx, fy), sy = isoY(fx, fy);
        ctx.beginPath(); ctx.moveTo(sx - 8, sy); ctx.lineTo(sx + 8, sy); ctx.stroke();
      }
    }
    // onsen shimmer
    for (const pd of this.ponds) if (pd.kind === 'onsen') {
      const sx = isoX(pd.x, pd.y), sy = isoY(pd.x, pd.y);
      for (let k = 0; k < 3; k++) {
        const rr = ((t * 0.4 + k / 3) % 1);
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - rr)})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(sx, sy, rr * pd.r * 40, rr * pd.r * 20, 0, 0, TAU); ctx.stroke();
      }
    }
    // cloud shadows
    if (!this.biome.night) {
      for (const c of this.clouds) {
        const sx = isoX(c.x, c.y), sy = isoY(c.x, c.y);
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, c.s * 45);
        g.addColorStop(0, 'rgba(30,40,60,0.12)'); g.addColorStop(1, 'rgba(30,40,60,0)');
        ctx.fillStyle = g; ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.5); ctx.beginPath(); ctx.arc(0, 0, c.s * 45, 0, TAU); ctx.restore(); ctx.fill();
      }
    }
    this.drawTufts(ctx, t, players || []);
    // passing flock: soft V-shaped shadows sweeping over the fields
    if (this.birds) {
      const B = this.birds;
      ctx.fillStyle = 'rgba(30,40,40,0.18)';
      for (let i = 0; i < B.n; i++) {
        const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        const bx = B.x - row * 0.9, by = B.y + side * row * 0.7;
        const sx = isoX(bx, by), sy = isoY(bx, by), f = Math.sin(B.t * 9 + i) * 3;
        ctx.beginPath(); ctx.moveTo(sx - 9, sy - 2 + f); ctx.quadraticCurveTo(sx - 3, sy - 1, sx, sy + 2); ctx.quadraticCurveTo(sx + 3, sy - 1, sx + 9, sy - 2 + f); ctx.quadraticCurveTo(sx, sy + 4, sx - 9, sy - 2 + f); ctx.fill();
      }
    }
    // gate glow on the ground
    if (this.gate.glow > 0.01) {
      const sx = isoX(this.gate.x, this.gate.y), sy = isoY(this.gate.x, this.gate.y);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
      g.addColorStop(0, `rgba(255,220,140,${0.55 * this.gate.glow})`); g.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = g; ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.5); ctx.beginPath(); ctx.arc(0, 0, 90, 0, TAU); ctx.restore(); ctx.fill();
    }
  }

  drawTufts(ctx, t, players) {
    const cols = [...this.biome.tuft, '#6fae3a'];
    const p0 = players[0], p1 = players[1];
    const px = p0 ? p0.x : -99, py = p0 ? p0.y : -99, qx = p1 ? p1.x : -99, qy = p1 ? p1.y : -99;
    const v = this.view;
    const vis = (sx, sy) => !v || (sx > v.x0 && sx < v.x1 && sy > v.y0 && sy < v.y1);
    for (let c = 0; c < 4; c++) {
      ctx.strokeStyle = cols[c]; ctx.lineWidth = c === 3 ? 1.3 : 1.6; ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const tf of this.tufts) {
        if (tf.c !== c) continue;
        const sx = isoX(tf.x, tf.y), sy = isoY(tf.x, tf.y);
        if (!vis(sx, sy)) continue;
        let bend = this.wind(tf.x, tf.y, t) * 5 * tf.h + Math.sin(t * 3 + tf.ph) * 0.8;
        const dx = tf.x - px, dy = tf.y - py, d2 = dx * dx + dy * dy;
        if (d2 < 1) bend += ((dx - dy) > 0 ? 1 : -1) * (1 - Math.sqrt(d2)) * 7;
        const ex = tf.x - qx, ey = tf.y - qy, e2 = ex * ex + ey * ey;
        if (e2 < 1) bend += ((ex - ey) > 0 ? 1 : -1) * (1 - Math.sqrt(e2)) * 7;
        const hgt = tf.h * (tf.rice ? 13 : 11);
        for (let i = -1; i <= 1; i++) {
          ctx.moveTo(sx + i * 2, sy);
          ctx.quadraticCurveTo(sx + i * 3 + bend * 0.4, sy - hgt * 0.6, sx + i * 4.5 + bend, sy - hgt * (1 - Math.abs(i) * 0.2));
        }
      }
      ctx.stroke();
    }
    for (const tf of this.tufts) {
      if (!tf.flower) continue;
      const sx = isoX(tf.x, tf.y), sy = isoY(tf.x, tf.y);
      if (!vis(sx, sy)) continue;
      const bend = this.wind(tf.x, tf.y, t) * 5 * tf.h;
      ctx.fillStyle = tf.flower; ctx.beginPath(); ctx.arc(sx + bend, sy - tf.h * 11, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f5d040'; ctx.beginPath(); ctx.arc(sx + bend, sy - tf.h * 11, 0.9, 0, TAU); ctx.fill();
    }
  }

  // ---------- props ----------
  depthOf(p) { return p.kind === 'house' ? p.x + p.y + 0.6 : p.x + p.y; }

  // returns screen-space bounding box (for occlusion fading)
  boundsOf(p) {
    const sx = isoX(p.x, p.y), sy = isoY(p.x, p.y);
    switch (p.kind) {
      case 'house': { const w = (p.x1 - p.x0 + p.y1 - p.y0) * 32 + 30; return [sx - w / 2, sy - 130, w, 150]; }
      case 'tree': return [sx - 60, sy - p.h * 32 - 60, 120, p.h * 32 + 60];
      case 'bamboo': return [sx - 40, sy - 150, 80, 150];
      case 'torii': return [sx - 90, sy - 100, 180, 110];
      case 'pillar': return [sx - 14, sy - 130, 28, 135];
      case 'throne': return [sx - 50, sy - 120, 100, 125];
      case 'screen': case 'hdoor': case 'fwall': return [sx - 40, sy - 100, 80, 105];
      case 'banner': return [sx - 10, sy - 100, 50, 100];
      default: return [sx - 25, sy - 50, 50, 55];
    }
  }

  drawProp(ctx, p, t) {
    switch (p.kind) {
      case 'house': return this.drawHouse(ctx, p, t);
      case 'tree': return this.drawTree(ctx, p, t);
      case 'bamboo': return this.drawBamboo(ctx, p, t);
      case 'lantern': return this.drawLantern(ctx, p, t);
      case 'rock': return this.drawRock(ctx, p);
      case 'bush': return this.drawBush(ctx, p, t);
      case 'scarecrow': return this.drawScarecrow(ctx, p, t);
      case 'bales': return this.drawBales(ctx, p);
      case 'jizo': return this.drawJizo(ctx, p);
      case 'banner': return this.drawBanner(ctx, p, t);
      case 'well': return this.drawWell(ctx, p);
      case 'fence': return this.drawFence(ctx, p);
      case 'torii': return this.drawTorii(ctx, p, t);
      case 'fwall': return this.drawFortressWall(ctx, p);
      case 'brazier': return this.drawBrazier(ctx, p, t);
      case 'pillar': return this.drawPillar(ctx, p);
      case 'throne': return this.drawThrone(ctx, p, t);
      case 'screen': return this.drawScreen(ctx, p, t);
      case 'hdoor': return this.drawHallDoor(ctx, p, t);
      case 'rail': return this.drawRail(ctx, p);
    }
  }

  drawHouse(ctx, h, t) {
    const { x0, y0, x1, y1 } = h, H = 1.15, o = 0.38, b = this.bi;
    const night = this.biome.night;
    // shadow
    ctx.fillStyle = 'rgba(20,20,40,0.22)';
    poly(ctx, [P(x0 - 0.2, y0), P(x1 + 0.6, y0), P(x1 + 0.9, y1 + 0.5), P(x0, y1 + 0.4)], ctx.fillStyle, null);
    const plaster = b === 3 ? '#e2dcd0' : night ? '#c9c4bc' : b === 1 ? '#e6d8bf' : '#efe6d2';
    const wood = b === 3 ? '#1e1418' : '#4a3426';
    // left-front wall (y = y1)
    poly(ctx, [P(x0, y1), P(x1, y1), P(x1, y1, H), P(x0, y1, H)], plaster, INK, 1.6);
    // right-front wall (x = x1)
    poly(ctx, [P(x1, y1), P(x1, y0), P(x1, y0, H), P(x1, y1, H)], shade(plaster.startsWith('#') ? plaster : '#e0d6c4', -0.18), INK, 1.6);
    // beams
    ctx.strokeStyle = wood; ctx.lineWidth = 3;
    const line = (a, c) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); };
    for (let x = x0; x <= x1 + 0.01; x += 1) line(P(x, y1, 0), P(x, y1, H));
    for (let y = y0; y <= y1 + 0.01; y += 1) line(P(x1, y, 0), P(x1, y, H));
    line(P(x0, y1, H * 0.12), P(x1, y1, H * 0.12)); line(P(x1, y1, H * 0.12), P(x1, y0, H * 0.12));
    line(P(x0, y1, H * 0.95), P(x1, y1, H * 0.95)); line(P(x1, y1, H * 0.95), P(x1, y0, H * 0.95));
    // shoji door on front-left wall
    const mx = (x0 + x1) / 2;
    const lit = night || h.burning;
    const door = [P(mx - 0.42, y1, 0.12), P(mx + 0.42, y1, 0.12), P(mx + 0.42, y1, 0.92), P(mx - 0.42, y1, 0.92)];
    const flick = 0.85 + Math.sin(t * 9 + h.seed) * 0.08 + Math.sin(t * 23 + h.seed) * 0.05;
    // sliding shoji: opens when an enemy steps out (doorT counts down from 1.6)
    const dT = h.doorT || 0;
    const open = dT <= 0 ? 0 : dT > 1.3 ? (1.6 - dT) / 0.3 : dT < 0.35 ? dT / 0.35 : 1;
    const paper = lit ? `rgba(255,${h.burning ? 150 : 205},${h.burning ? 70 : 120},${flick})` : '#f1e7cf';
    if (open > 0) {
      poly(ctx, door, lit ? '#3a1a10' : '#1e1418', wood, 2); // dark interior
      const gl = ctx.createRadialGradient(...P(mx, y1, 0.4), 0, ...P(mx, y1, 0.4), 30);
      gl.addColorStop(0, `rgba(255,170,90,${0.35 * open})`); gl.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = gl; poly(ctx, door, gl, null);
    }
    for (const side of [-1, 1]) { // two panels slide apart
      const s0 = side < 0 ? mx - 0.42 : mx, s1 = side < 0 ? mx : mx + 0.42;
      const off = side * open * 0.4;
      const panel = [P(s0 + off, y1, 0.12), P(s1 + off, y1, 0.12), P(s1 + off, y1, 0.92), P(s0 + off, y1, 0.92)];
      poly(ctx, panel, paper, wood, 1.6);
      ctx.strokeStyle = 'rgba(74,52,38,0.8)'; ctx.lineWidth = 1;
      line(P((s0 + s1) / 2 + off, y1, 0.12), P((s0 + s1) / 2 + off, y1, 0.92));
      for (let k = 1; k < 4; k++) line(P(s0 + off, y1, 0.12 + k * 0.2), P(s1 + off, y1, 0.12 + k * 0.2));
    }
    // window on right wall
    const my = (y0 + y1) / 2;
    poly(ctx, [P(x1, my + 0.3, 0.45), P(x1, my - 0.3, 0.45), P(x1, my - 0.3, 0.85), P(x1, my + 0.3, 0.85)], lit ? `rgba(255,200,110,${flick * 0.9})` : '#3a2c24', wood, 1.5);
    ctx.strokeStyle = wood; ctx.lineWidth = 1; for (let k = 1; k < 3; k++) line(P(x1, my + 0.3 - k * 0.2, 0.45), P(x1, my + 0.3 - k * 0.2, 0.85));

    // roof
    const He = H - 0.05, Zr = H + 1.15;
    const roofCol = b === 0 ? '#ad8f57' : b === 1 ? '#5b4a44' : b === 3 ? '#26242e' : '#3d455c';
    const along = x1 - x0 >= y1 - y0;
    let back, gable, front, ridgeA, ridgeB;
    if (along) {
      const cy = (y0 + y1) / 2;
      back = [P(x0 - o, y0 - o, He), P(x1 + o, y0 - o, He), P(x1 + o, cy, Zr), P(x0 - o, cy, Zr)];
      gable = [P(x1 + o * 0.6, y0 - o * 0.4, He), P(x1 + o * 0.6, y1 + o * 0.4, He), P(x1 + o * 0.6, cy, Zr - 0.05)];
      front = [P(x0 - o, y1 + o, He), P(x1 + o, y1 + o, He), P(x1 + o, cy, Zr), P(x0 - o, cy, Zr)];
      ridgeA = [x0 - o, cy]; ridgeB = [x1 + o, cy];
    } else {
      const cx = (x0 + x1) / 2;
      back = [P(x0 - o, y0 - o, He), P(x0 - o, y1 + o, He), P(cx, y1 + o, Zr), P(cx, y0 - o, Zr)];
      gable = [P(x0 - o * 0.4, y1 + o * 0.6, He), P(x1 + o * 0.4, y1 + o * 0.6, He), P(cx, y1 + o * 0.6, Zr - 0.05)];
      front = [P(x1 + o, y0 - o, He), P(x1 + o, y1 + o, He), P(cx, y1 + o, Zr), P(cx, y0 - o, Zr)];
      ridgeA = [cx, y0 - o]; ridgeB = [cx, y1 + o];
    }
    poly(ctx, back, shade(roofCol, -0.2), INK, 1.6);
    poly(ctx, gable, '#5a4030', INK, 1.4);
    poly(ctx, front, roofCol, INK, 1.8);
    // roof texture
    ctx.save(); poly(ctx, front, null, null); ctx.clip();
    ctx.strokeStyle = b === 0 ? 'rgba(90,65,30,0.45)' : 'rgba(20,20,30,0.35)'; ctx.lineWidth = b === 0 ? 1 : 1.4;
    if (b === 0) { // thatch strands
      for (let k = 0; k <= 40; k++) {
        const u = k / 40;
        const a = along ? P(lerp(x0 - o, x1 + o, u), y1 + o, He) : P(x1 + o, lerp(y0 - o, y1 + o, u), He);
        const c = along ? P(lerp(x0 - o, x1 + o, u), (y0 + y1) / 2, Zr) : P((x0 + x1) / 2, lerp(y0 - o, y1 + o, u), Zr);
        line(a, c);
      }
    } else { // tile rows
      for (let k = 1; k < 7; k++) {
        const u = k / 7;
        const a = along ? P(x0 - o, lerp(y1 + o, (y0 + y1) / 2, u), lerp(He, Zr, u)) : P(lerp(x1 + o, (x0 + x1) / 2, u), y0 - o, lerp(He, Zr, u));
        const c = along ? P(x1 + o, lerp(y1 + o, (y0 + y1) / 2, u), lerp(He, Zr, u)) : P(lerp(x1 + o, (x0 + x1) / 2, u), y1 + o, lerp(He, Zr, u));
        line(a, c);
      }
    }
    if (b === 2) { // snow cover
      ctx.fillStyle = 'rgba(240,245,255,0.92)';
      const sn = along
        ? [P(x0 - o, (y0 + y1) / 2 + 0.9, lerp(Zr, He, 0.55)), P(x1 + o, (y0 + y1) / 2 + 0.9, lerp(Zr, He, 0.55)), P(x1 + o, (y0 + y1) / 2, Zr), P(x0 - o, (y0 + y1) / 2, Zr)]
        : [P((x0 + x1) / 2 + 0.9, y0 - o, lerp(Zr, He, 0.55)), P((x0 + x1) / 2 + 0.9, y1 + o, lerp(Zr, He, 0.55)), P((x0 + x1) / 2, y1 + o, Zr), P((x0 + x1) / 2, y0 - o, Zr)];
      poly(ctx, sn, ctx.fillStyle, null);
    }
    ctx.restore();
    // ridge cap
    ctx.strokeStyle = b === 0 ? '#3a2a1c' : '#1e1c26'; ctx.lineWidth = 5;
    line(P(ridgeA[0], ridgeA[1], Zr + 0.04), P(ridgeB[0], ridgeB[1], Zr + 0.04));
    if (b === 0) { // chigi crossed sticks
      ctx.lineWidth = 2.5;
      for (const e of [ridgeA, ridgeB]) {
        const [sx, sy] = P(e[0], e[1], Zr);
        line([sx - 7, sy - 12], [sx + 4, sy + 2]); line([sx + 7, sy - 12], [sx - 4, sy + 2]);
      }
    }
    if (h.burning) this.drawFlames(ctx, (x0 + x1) / 2, (y0 + y1) / 2, Zr - 0.3, Math.max(x1 - x0, y1 - y0), t, h.seed);
  }

  drawFlames(ctx, x, y, z, w, t, seed) {
    const [sx, sy] = P(x, y, z);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const n = 4 + Math.round(w);
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1) - 0.5) * w * 38;
      const hgt = 26 + Math.sin(t * 7 + i * 2 + seed) * 10 + Math.sin(t * 13 + i) * 5;
      const sway = Math.sin(t * 5 + i) * 5;
      for (const [c, s] of [['rgba(255,90,20,0.55)', 1], ['rgba(255,170,40,0.6)', 0.7], ['rgba(255,240,170,0.7)', 0.4]]) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(sx + u - 9 * s, sy + 4);
        ctx.quadraticCurveTo(sx + u - 10 * s + sway * 0.5, sy - hgt * s * 0.6, sx + u + sway, sy - hgt * s);
        ctx.quadraticCurveTo(sx + u + 10 * s + sway * 0.5, sy - hgt * s * 0.6, sx + u + 9 * s, sy + 4);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawTree(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y);
    const H = p.h * 32;
    const sway = this.wind(p.x, p.y, t) * 6;
    ctx.fillStyle = 'rgba(20,25,35,0.22)'; ctx.beginPath(); ctx.ellipse(sx + 10, sy + 2, 40, 16, 0, 0, TAU); ctx.fill();
    if (p.variant === 'pine') {
      ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sway * 0.3, sy - H * 0.4); ctx.stroke();
      ctx.strokeStyle = '#4a3a30'; ctx.lineWidth = 4.5; ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const ty = sy - H * 0.25 - k * H * 0.2, w = 34 - k * 7, s2 = sway * (0.4 + k * 0.25);
        ctx.beginPath(); ctx.moveTo(sx - w + s2 * 0.6, ty); ctx.lineTo(sx + s2, ty - H * 0.32); ctx.lineTo(sx + w + s2 * 0.6, ty); ctx.quadraticCurveTo(sx + s2 * 0.6, ty + 6, sx - w + s2 * 0.6, ty); ctx.closePath();
        ctx.fillStyle = k % 2 ? '#2f4c42' : '#284238'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = 'rgba(245,248,255,0.95)';
        ctx.beginPath(); ctx.moveTo(sx - w * 0.55 + s2 * 0.7, ty - H * 0.13); ctx.lineTo(sx + s2, ty - H * 0.32); ctx.lineTo(sx + w * 0.55 + s2 * 0.7, ty - H * 0.13); ctx.quadraticCurveTo(sx + s2 * 0.7, ty - H * 0.09, sx - w * 0.55 + s2 * 0.7, ty - H * 0.13); ctx.fill();
      }
      return;
    }
    // trunk
    ctx.lineCap = 'round';
    const tx = sx + sway * 0.5, ty = sy - H * 0.55;
    ctx.strokeStyle = INK; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx - 6, sy - H * 0.3, tx, ty); ctx.stroke();
    ctx.strokeStyle = p.variant === 'cherry' ? '#5a3a36' : '#4e3a2a'; ctx.lineWidth = 6; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.moveTo(tx - 2, ty + 10); ctx.lineTo(tx - 16 + sway * 0.6, ty - 6); ctx.moveTo(tx + 1, ty + 6); ctx.lineTo(tx + 14 + sway * 0.6, ty - 8); ctx.stroke();
    const pal = p.variant === 'cherry' ? ['#e993ae', '#f4b5c8', '#fbd3df', '#fde8ee']
      : p.variant === 'maple' ? ['#a8281c', '#d2442a', '#ea6c30', '#f6a24a']
        : p.variant === 'ginkgo' ? ['#c8901c', '#e2b030', '#f2cc50', '#fbe48a']
          : ['#4c7f3c', '#62984a', '#7db35c', '#a0cc78'];
    // canopy: ink outline pass then fills
    const cx = tx, cy = ty - H * 0.2;
    ctx.fillStyle = INK;
    for (const bl of p.blobs) {
      if (bl[3] === 3 && bl[2] < 10) continue; // small highlights sit inside the canopy
      const layer = bl[3];
      const s3 = sway * (1 + bl[1] * -0.02) + Math.sin(t * 2 + bl[0]) * 0.8;
      ctx.beginPath(); ctx.arc(cx + bl[0] + s3 - layer * 0.8, cy + bl[1] - layer * 1.2, bl[2] * (1 - layer * 0.12) + 1.8, 0, TAU); ctx.fill();
    }
    for (let layer = 0; layer < 4; layer++) {
      ctx.fillStyle = pal[layer];
      for (const bl of p.blobs) {
        if (bl[3] !== layer) continue;
        const s3 = sway * (1 + bl[1] * -0.02) + Math.sin(t * 2 + bl[0]) * 0.8;
        ctx.beginPath(); ctx.arc(cx + bl[0] + s3 - layer * 0.8, cy + bl[1] - layer * 1.2, bl[2] * (1 - layer * 0.12), 0, TAU); ctx.fill();
      }
    }
  }

  drawBush(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y);
    const sway = this.wind(p.x, p.y, t) * 2;
    const col = this.bi === 2 ? ['#2c4a40', '#eef3fa'] : this.bi === 1 ? ['#8a5a2a', '#c87a34'] : ['#4f8a3a', '#7ab35a'];
    ctx.fillStyle = INK; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(sx + (k - 1.5) * 9 * p.s + sway, sy - 8 * p.s - (k % 2) * 4, 10 * p.s + 1.5, 0, TAU); ctx.fill(); }
    for (let k = 0; k < 4; k++) { ctx.fillStyle = col[k % 2 ? 1 : 0]; ctx.beginPath(); ctx.arc(sx + (k - 1.5) * 9 * p.s + sway, sy - 8 * p.s - (k % 2) * 4, 10 * p.s, 0, TAU); ctx.fill(); }
  }

  drawBamboo(ctx, p, t) {
    const [bx, by] = P(p.x, p.y);
    ctx.fillStyle = 'rgba(20,25,35,0.2)'; ctx.beginPath(); ctx.ellipse(bx, by, 30, 12, 0, 0, TAU); ctx.fill();
    const stalks = [...p.stalks].sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    for (const [dx, dy, h, ph] of stalks) {
      const [sx, sy] = P(p.x + dx, p.y + dy);
      const H = h * 32;
      const sway = this.wind(p.x, p.y, t) * 10 + Math.sin(t * 1.7 + ph) * 3;
      const tipX = sx + sway, tipY = sy - H;
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx, sy - H * 0.6, tipX, tipY); ctx.stroke();
      ctx.strokeStyle = '#7fa64a'; ctx.lineWidth = 3.8; ctx.stroke();
      ctx.strokeStyle = '#3e5a26'; ctx.lineWidth = 1.2;
      for (let k = 1; k < 6; k++) {
        const u = k / 6, qx = (1 - u) * (1 - u) * sx + 2 * u * (1 - u) * sx + u * u * tipX, qy = (1 - u) * (1 - u) * sy + 2 * u * (1 - u) * (sy - H * 0.6) + u * u * tipY;
        ctx.beginPath(); ctx.moveTo(qx - 2.5, qy); ctx.lineTo(qx + 2.5, qy); ctx.stroke();
      }
      for (let k = 0; k < 5; k++) {
        const a = -1.2 + k * 0.6 + Math.sin(t * 3 + ph + k) * 0.15;
        ctx.save(); ctx.translate(tipX - sway * 0.15 * k, tipY + k * 9); ctx.rotate(a);
        ctx.fillStyle = k % 2 ? '#6e9a3c' : '#8cbc54'; ctx.beginPath(); ctx.ellipse(10, 0, 11, 2.4, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
  }

  drawLantern(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y);
    const stone = this.bi === 2 ? '#8a8e9c' : '#9c978a';
    ctx.fillStyle = 'rgba(20,25,35,0.22)'; ctx.beginPath(); ctx.ellipse(sx, sy, 14, 6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    ctx.fillStyle = shade(stone, -0.1); ctx.fillRect(sx - 9, sy - 5, 18, 5); ctx.strokeRect(sx - 9, sy - 5, 18, 5);
    ctx.fillStyle = stone; ctx.fillRect(sx - 3.5, sy - 22, 7, 17); ctx.strokeRect(sx - 3.5, sy - 22, 7, 17);
    ctx.fillRect(sx - 9, sy - 26, 18, 4); ctx.strokeRect(sx - 9, sy - 26, 18, 4);
    const fl = 0.75 + Math.sin(t * 11 + p.seed) * 0.12 + Math.sin(t * 27 + p.seed) * 0.08;
    ctx.fillStyle = this.biome.night || this.bi === 1 ? `rgba(255,200,110,${fl})` : '#d8cfb8'; ctx.fillRect(sx - 6, sy - 36, 12, 10);
    ctx.strokeRect(sx - 6, sy - 36, 12, 10);
    ctx.fillStyle = INK; ctx.fillRect(sx - 1, sy - 36, 2, 10);
    ctx.beginPath(); ctx.moveTo(sx - 13, sy - 36); ctx.quadraticCurveTo(sx, sy - 44, sx + 13, sy - 36); ctx.lineTo(sx, sy - 47); ctx.closePath();
    ctx.fillStyle = shade(stone, -0.05); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy - 48, 2.5, 0, TAU); ctx.fill(); ctx.stroke();
    if (this.bi === 2) { ctx.fillStyle = 'rgba(245,248,255,0.95)'; ctx.beginPath(); ctx.ellipse(sx, sy - 42, 9, 3, 0, 0, TAU); ctx.fill(); }
  }

  drawRock(ctx, p) {
    const [sx, sy] = P(p.x, p.y);
    const s = (p.s || 1) * 14;
    ctx.fillStyle = 'rgba(20,25,35,0.2)'; ctx.beginPath(); ctx.ellipse(sx + 3, sy + 2, s * 1.2, s * 0.5, 0, 0, TAU); ctx.fill();
    ctx.beginPath();
    p.pts.forEach((k, i) => { const a = (i / p.pts.length) * TAU; const x = sx + Math.cos(a) * s * k, y = sy - s * 0.5 + Math.sin(a) * s * 0.7 * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = this.bi === 2 ? '#7a7f8e' : '#8f8a80'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = this.bi === 2 ? 'rgba(245,248,255,0.95)' : 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.ellipse(sx - s * 0.2, sy - s * 0.95, s * 0.6, s * 0.25, 0, 0, TAU); ctx.fill();
    if (this.bi === 0) { ctx.fillStyle = 'rgba(80,130,60,0.5)'; ctx.beginPath(); ctx.ellipse(sx + s * 0.3, sy - s * 0.2, s * 0.4, s * 0.15, 0, 0, TAU); ctx.fill(); }
  }

  drawScarecrow(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y);
    const w = this.wind(p.x, p.y, t);
    ctx.fillStyle = 'rgba(20,25,35,0.2)'; ctx.beginPath(); ctx.ellipse(sx, sy, 12, 5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 52); ctx.moveTo(sx - 20, sy - 38); ctx.lineTo(sx + 20, sy - 38); ctx.stroke();
    ctx.strokeStyle = '#7a5a34'; ctx.lineWidth = 2.4; ctx.stroke();
    // shirt flapping
    ctx.beginPath(); ctx.moveTo(sx - 18, sy - 40);
    for (let k = 0; k <= 6; k++) ctx.lineTo(sx - 18 + k * 6, sy - 24 + Math.sin(t * 6 + k) * 2 * (1 + w));
    ctx.lineTo(sx + 18, sy - 40); ctx.closePath();
    ctx.fillStyle = '#5873a8'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy - 48, 6, 0, TAU); ctx.fillStyle = '#efe6cc'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.font = '7px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('へ', sx, sy - 46);
    ctx.save(); ctx.translate(sx, sy - 52); ctx.rotate(w * 0.1);
    ctx.beginPath(); ctx.moveTo(-14, 2); ctx.quadraticCurveTo(0, -1, 14, 2); ctx.lineTo(0, -8); ctx.closePath(); ctx.fillStyle = '#d8b46a'; ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  drawBales(ctx, p) {
    const [sx, sy] = P(p.x, p.y);
    ctx.fillStyle = 'rgba(20,25,35,0.2)'; ctx.beginPath(); ctx.ellipse(sx, sy, 22, 8, 0, 0, TAU); ctx.fill();
    const bale = (x, y) => {
      ctx.beginPath(); ctx.ellipse(x, y, 10, 7, 0, 0, TAU); ctx.fillStyle = this.bi === 2 ? '#c8b07a' : '#d8bc78'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 4, y - 6.5); ctx.lineTo(x - 4, y + 6.5); ctx.moveTo(x + 4, y - 6.5); ctx.lineTo(x + 4, y + 6.5); ctx.stroke();
    };
    bale(sx - 9, sy - 6); bale(sx + 9, sy - 6); bale(sx, sy - 16);
    if (this.bi === 2) { ctx.fillStyle = 'rgba(245,248,255,0.95)'; ctx.beginPath(); ctx.ellipse(sx, sy - 22, 8, 3, 0, 0, TAU); ctx.fill(); }
  }

  drawJizo(ctx, p) {
    const [sx, sy] = P(p.x, p.y);
    ctx.fillStyle = 'rgba(20,25,35,0.2)'; ctx.beginPath(); ctx.ellipse(sx, sy, 10, 4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(sx, sy - 9, 6.5, 9, 0, 0, TAU); ctx.fillStyle = '#9c9890'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy - 21, 5, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 6, sy - 15); ctx.lineTo(sx + 6, sy - 15); ctx.lineTo(sx, sy - 8); ctx.closePath(); ctx.fillStyle = '#c8302a'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy - 24, 5.5, Math.PI, TAU); ctx.fillStyle = '#c8302a'; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(sx - 2, sy - 21); ctx.lineTo(sx - 0.5, sy - 21); ctx.moveTo(sx + 0.5, sy - 21); ctx.lineTo(sx + 2, sy - 21); ctx.stroke();
  }

  drawBanner(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y);
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 92); ctx.stroke();
    ctx.strokeStyle = '#3a2a1e'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx, sy - 88); ctx.lineTo(sx + 18, sy - 88); ctx.stroke();
    const w = this.wind(p.x, p.y, t);
    ctx.beginPath(); ctx.moveTo(sx + 1, sy - 87);
    const pts = [];
    for (let k = 0; k <= 8; k++) { const u = k / 8; pts.push([sx + 1 + 17 + Math.sin(t * 5 - u * 4 + p.seed) * 3 * (0.5 + w) * u, sy - 87 + u * 62]); }
    for (const q of pts) ctx.lineTo(q[0], q[1]);
    for (let k = 8; k >= 0; k--) ctx.lineTo(sx + 1 + Math.sin(t * 5 - (k / 8) * 4 + p.seed) * 2 * (k / 8) * (0.5 + w), sy - 87 + (k / 8) * 62);
    ctx.closePath();
    ctx.fillStyle = p.color; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
    const mid = pts[3];
    ctx.beginPath(); ctx.arc(mid[0] - 8, mid[1], 5, 0, TAU); ctx.fillStyle = p.color === '#e8e0cc' ? '#c23b2e' : '#f4ecd8'; ctx.fill();
  }

  drawWell(ctx, p) {
    const [sx, sy] = P(p.x, p.y);
    ctx.fillStyle = 'rgba(20,25,35,0.2)'; ctx.beginPath(); ctx.ellipse(sx, sy, 24, 10, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
    ctx.fillStyle = '#8f8a80'; ctx.beginPath(); ctx.ellipse(sx, sy - 4, 18, 8, 0, 0, Math.PI); ctx.lineTo(sx - 18, sy - 14); ctx.ellipse(sx, sy - 14, 18, 8, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2a3440'; ctx.beginPath(); ctx.ellipse(sx, sy - 14, 14, 6, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx - 16, sy - 12); ctx.lineTo(sx - 16, sy - 46); ctx.moveTo(sx + 16, sy - 12); ctx.lineTo(sx + 16, sy - 46); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 24, sy - 42); ctx.lineTo(sx, sy - 56); ctx.lineTo(sx + 24, sy - 42); ctx.closePath(); ctx.fillStyle = '#5a4030'; ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
  }

  // ---- fortress / hall props
  // a segment of plastered fortress wall with a black tile cap (along the back edges)
  drawFortressWall(ctx, p) {
    const H = 1.3, [a0, a1] = p.axis === 'x' ? [[p.x - 0.5, p.y], [p.x + 0.5, p.y]] : [[p.x, p.y - 0.5], [p.x, p.y + 0.5]];
    poly(ctx, [P(a0[0], a0[1]), P(a1[0], a1[1]), P(a1[0], a1[1], H), P(a0[0], a0[1], H)], '#d8d2c6', INK, 1.4);
    poly(ctx, [P(a0[0], a0[1]), P(a1[0], a1[1]), P(a1[0], a1[1], 0.25), P(a0[0], a0[1], 0.25)], '#4a4450', null);
    const o = 0.18;
    const c0 = p.axis === 'x' ? [a0[0], a0[1] + o] : [a0[0] + o, a0[1]], c1 = p.axis === 'x' ? [a1[0], a1[1] + o] : [a1[0] + o, a1[1]];
    poly(ctx, [P(a0[0], a0[1], H), P(a1[0], a1[1], H), P(c1[0], c1[1], H - 0.05), P(c0[0], c0[1], H - 0.05)], '#1e1c26', INK, 1.2);
    poly(ctx, [P(a0[0], a0[1], H), P(a1[0], a1[1], H), P(a1[0], a1[1], H + 0.22), P(a0[0], a0[1], H + 0.22)], '#2a2832', INK, 1.2);
    // arrow slit
    const m = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2];
    poly(ctx, [P(m[0], m[1], 0.6), P(m[0], m[1], 0.95)], null, '#14121a', 3);
  }

  drawBrazier(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y);
    ctx.fillStyle = 'rgba(20,10,10,0.3)'; ctx.beginPath(); ctx.ellipse(sx, sy, 14, 6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
    for (const d of [-7, 0, 7]) { ctx.beginPath(); ctx.moveTo(sx + d, sy); ctx.lineTo(sx + d * 0.4, sy - 22); ctx.stroke(); }
    ctx.fillStyle = '#2a2228'; ctx.beginPath(); ctx.ellipse(sx, sy - 24, 13, 5, 0, 0, Math.PI); ctx.lineTo(sx - 13, sy - 28); ctx.ellipse(sx, sy - 28, 13, 5, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill(); ctx.stroke();
    const fl = 1 + Math.sin(t * 13 + (p.seed || p.x)) * 0.12;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#ff6a20', '#ffb040', '#fff0a0'][i];
      ctx.beginPath(); ctx.moveTo(sx - (11 - i * 4), sy - 28); ctx.quadraticCurveTo(sx + Math.sin(t * 9 + i) * 3, sy - 28 - (24 - i * 7) * fl, sx + (11 - i * 4), sy - 28); ctx.fill();
    }
  }

  drawPillar(ctx, p) {
    const [sx, sy] = P(p.x, p.y), Hh = 4.2 * 32, w = 11;
    ctx.fillStyle = 'rgba(20,6,6,0.35)'; ctx.beginPath(); ctx.ellipse(sx + 6, sy + 2, 18, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1214'; ctx.fillRect(sx - w - 3, sy - 10, (w + 3) * 2, 10); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.strokeRect(sx - w - 3, sy - 10, (w + 3) * 2, 10);
    const g = ctx.createLinearGradient(sx - w, 0, sx + w, 0);
    g.addColorStop(0, '#5a0c16'); g.addColorStop(0.35, '#b02030'); g.addColorStop(0.6, '#8a1420'); g.addColorStop(1, '#3a0810');
    ctx.fillStyle = g; ctx.fillRect(sx - w, sy - Hh, w * 2, Hh - 10);
    ctx.strokeRect(sx - w, sy - Hh, w * 2, Hh - 10);
    ctx.fillStyle = '#d8a838';
    for (const z of [0.15, 0.55, 0.9]) { ctx.fillRect(sx - w - 1, sy - Hh * z - 3, w * 2 + 2, 5); }
  }

  drawThrone(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y);
    ctx.fillStyle = 'rgba(10,4,4,0.35)'; ctx.beginPath(); ctx.ellipse(sx, sy + 4, 46, 18, 0, 0, TAU); ctx.fill();
    // golden screen behind the throne
    const bg = ctx.createLinearGradient(sx - 60, sy - 140, sx + 60, sy - 40);
    bg.addColorStop(0, '#f0c860'); bg.addColorStop(0.5, '#c89030'); bg.addColorStop(1, '#f6d880');
    ctx.fillStyle = bg; ctx.fillRect(sx - 56, sy - 140, 112, 96); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(sx - 56, sy - 140, 112, 96);
    ctx.strokeStyle = 'rgba(90,50,10,0.5)'; ctx.lineWidth = 1; for (const x of [-28, 0, 28]) { ctx.beginPath(); ctx.moveTo(sx + x, sy - 140); ctx.lineTo(sx + x, sy - 44); ctx.stroke(); }
    ctx.fillStyle = 'rgba(40,80,40,0.55)'; ctx.beginPath(); ctx.ellipse(sx - 26, sy - 104, 22, 9, -0.2, 0, TAU); ctx.ellipse(sx + 18, sy - 92, 26, 8, 0.2, 0, TAU); ctx.fill(); // painted pines
    // crest
    ctx.fillStyle = '#8a1420'; ctx.beginPath(); ctx.arc(sx, sy - 118, 13, 0, TAU); ctx.fill(); ctx.strokeStyle = '#1a0a08'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#f0c860'; ctx.font = '800 15px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('陽', sx, sy - 117);
    // seat
    ctx.fillStyle = '#5a0c16'; ctx.fillRect(sx - 30, sy - 70, 60, 46); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(sx - 30, sy - 70, 60, 46);
    ctx.fillStyle = '#d8a838'; ctx.fillRect(sx - 34, sy - 30, 68, 8); ctx.fillRect(sx - 34, sy - 74, 6, 50); ctx.fillRect(sx + 28, sy - 74, 6, 50);
    ctx.fillStyle = '#1a0a08'; ctx.fillRect(sx - 34, sy - 22, 68, 22);
  }

  // a gold folding-screen panel on a back wall
  drawScreen(ctx, p, t) {
    const H = 2.7, [a0, a1] = p.axis === 'x' ? [[p.x - 0.5, p.y], [p.x + 0.5, p.y]] : [[p.x, p.y - 0.5], [p.x, p.y + 0.5]];
    const q = [P(a0[0], a0[1]), P(a1[0], a1[1]), P(a1[0], a1[1], H), P(a0[0], a0[1], H)];
    const g = ctx.createLinearGradient(q[3][0], q[3][1], q[1][0], q[1][1]);
    g.addColorStop(0, '#f2cc66'); g.addColorStop(0.5, p.axis === 'x' ? '#c8922e' : '#b07e26'); g.addColorStop(1, '#ecc45a');
    poly(ctx, q, g, '#1a0a08', 2.2);
    // painted clouds and pine (varies per panel)
    const m = (z, f) => P(lerp(a0[0], a1[0], f), lerp(a0[1], a1[1], f), z);
    ctx.fillStyle = 'rgba(255,245,210,0.55)';
    const [cx, cy] = m(H * (0.55 + 0.25 * Math.sin(p.seed)), 0.5); ctx.beginPath(); ctx.ellipse(cx, cy, 20, 4, 0, 0, TAU); ctx.fill();
    if (p.seed % 3 === 0) { const [tx, ty] = m(H * 0.35, 0.4); ctx.fillStyle = 'rgba(40,80,40,0.6)'; ctx.beginPath(); ctx.ellipse(tx, ty, 14, 6, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(60,30,10,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, ty + 4); ctx.lineTo(tx + 3, ty + 26); ctx.stroke(); }
    // lacquer frame
    poly(ctx, [P(a0[0], a0[1]), P(a1[0], a1[1]), P(a1[0], a1[1], 0.25), P(a0[0], a0[1], 0.25)], '#1a0a08', null);
    poly(ctx, [P(a0[0], a0[1], H - 0.12), P(a1[0], a1[1], H - 0.12), P(a1[0], a1[1], H), P(a0[0], a0[1], H)], '#1a0a08', null);
  }

  // a red-lacquered sliding door in the back wall; slides open when a guard steps out
  drawHallDoor(ctx, p, t) {
    const H = 2.7, [a0, a1] = p.axis === 'x' ? [[p.x - 0.5, p.y], [p.x + 0.5, p.y]] : [[p.x, p.y - 0.5], [p.x, p.y + 0.5]];
    const dT = p.doorT || 0;
    const open = dT <= 0 ? 0 : dT > 1.3 ? (1.6 - dT) / 0.3 : dT < 0.35 ? dT / 0.35 : 1;
    poly(ctx, [P(a0[0], a0[1]), P(a1[0], a1[1]), P(a1[0], a1[1], H), P(a0[0], a0[1], H)], '#0a0404', '#1a0a08', 2);
    const m = (f, z) => P(lerp(a0[0], a1[0], f), lerp(a0[1], a1[1], f), z);
    for (const side of [0, 1]) {
      const f0 = side ? 0.5 + open * 0.42 : 0 - open * 0.0, f1 = side ? 1 : 0.5 - open * 0.42;
      if (f1 - f0 < 0.02) continue;
      poly(ctx, [m(f0, 0.2), m(f1, 0.2), m(f1, 2.2), m(f0, 2.2)], '#7a1420', '#1a0a08', 1.6);
      ctx.fillStyle = '#d8a838'; const [hx, hy] = m(side ? f0 + 0.08 : f1 - 0.08, 1.1); ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, TAU); ctx.fill();
    }
    poly(ctx, [m(0, 2.2), m(1, 2.2), m(1, H), m(0, H)], '#d8a838', '#1a0a08', 1.6); // gold transom
    if (open > 0) { const [gx, gy] = m(0.5, 1); const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, 40); gl.addColorStop(0, `rgba(255,120,60,${0.35 * open})`); gl.addColorStop(1, 'rgba(255,120,60,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(gx, gy, 40, 0, TAU); ctx.fill(); }
  }

  drawRail(ctx, p) {
    const a = p.axis === 'x' ? [P(p.x - 0.5, p.y), P(p.x + 0.5, p.y)] : [P(p.x, p.y - 0.5), P(p.x, p.y + 0.5)];
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a[0][0], a[0][1] - 12); ctx.lineTo(a[1][0], a[1][1] - 12); ctx.stroke();
    ctx.strokeStyle = '#8a1420'; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.strokeStyle = '#1a0a08'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a[0][0], a[0][1]); ctx.lineTo(a[0][0], a[0][1] - 13); ctx.stroke();
    ctx.fillStyle = '#d8a838'; ctx.beginPath(); ctx.arc(a[0][0], a[0][1] - 14, 2.2, 0, TAU); ctx.fill();
  }

  drawFence(ctx, p) {
    const a = p.axis === 'x' ? [P(p.x - 0.5, p.y), P(p.x + 0.5, p.y)] : [P(p.x, p.y - 0.5), P(p.x, p.y + 0.5)];
    ctx.strokeStyle = INK; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    for (const q of a) { ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0], q[1] - 16); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(a[0][0], a[0][1] - 13); ctx.lineTo(a[1][0], a[1][1] - 13); ctx.moveTo(a[0][0], a[0][1] - 6); ctx.lineTo(a[1][0], a[1][1] - 6); ctx.stroke();
    ctx.strokeStyle = this.bi === 2 ? '#6a6058' : '#9a7a4a'; ctx.lineWidth = 1.8; ctx.stroke();
    for (const q of a) { ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0], q[1] - 16); ctx.stroke(); }
  }

  drawTorii(ctx, p, t) {
    const g = this.gate, gl = g.glow;
    const L = P(p.x - 1, p.y + 1), R = P(p.x + 1, p.y - 1);
    const H = 2.5 * 32;
    // light pillar behind
    if (gl > 0.01) {
      const cx = (L[0] + R[0]) / 2, cy = (L[1] + R[1]) / 2;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const grd = ctx.createLinearGradient(0, cy - H * 1.6, 0, cy);
      grd.addColorStop(0, 'rgba(255,220,150,0)'); grd.addColorStop(1, `rgba(255,220,150,${0.45 * gl})`);
      ctx.fillStyle = grd;
      const wv = 48 + Math.sin(t * 3) * 4;
      ctx.beginPath(); ctx.moveTo(cx - wv, cy); ctx.lineTo(cx - wv * 0.6, cy - H * 1.6); ctx.lineTo(cx + wv * 0.6, cy - H * 1.6); ctx.lineTo(cx + wv, cy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(255,240,200,${0.3 * gl})`;
      ctx.beginPath(); ctx.ellipse(cx, cy - H * 0.45, 40, H * 0.5, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const red = gl > 0.5 ? '#f0502e' : '#c9381f';
    ctx.lineCap = 'butt';
    for (const q of [L, R]) {
      ctx.fillStyle = 'rgba(20,25,35,0.25)'; ctx.beginPath(); ctx.ellipse(q[0], q[1], 10, 4, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0], q[1] - H); ctx.stroke();
      ctx.strokeStyle = red; ctx.lineWidth = 6.5; ctx.stroke();
      ctx.strokeStyle = '#1a1720'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0], q[1] - 6); ctx.stroke();
    }
    // nuki (lower beam)
    const nz = H * 0.72;
    ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(L[0] - 10, L[1] - nz + 5); ctx.lineTo(R[0] + 10, R[1] - nz - 5); ctx.stroke();
    ctx.strokeStyle = red; ctx.lineWidth = 4.5; ctx.stroke();
    // kasagi (top beam) with upturned ends
    const kz = H * 0.98;
    ctx.beginPath();
    ctx.moveTo(L[0] - 22, L[1] - kz - 2); ctx.quadraticCurveTo((L[0] + R[0]) / 2, (L[1] + R[1]) / 2 - kz + 8, R[0] + 22, R[1] - kz - 14);
    ctx.lineTo(R[0] + 22, R[1] - kz - 6); ctx.quadraticCurveTo((L[0] + R[0]) / 2, (L[1] + R[1]) / 2 - kz + 16, L[0] - 22, L[1] - kz + 6); ctx.closePath();
    ctx.fillStyle = red; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(L[0] - 26, L[1] - kz - 8); ctx.quadraticCurveTo((L[0] + R[0]) / 2, (L[1] + R[1]) / 2 - kz + 2, R[0] + 26, R[1] - kz - 20);
    ctx.lineTo(R[0] + 22, R[1] - kz - 14); ctx.quadraticCurveTo((L[0] + R[0]) / 2, (L[1] + R[1]) / 2 - kz + 8, L[0] - 22, L[1] - kz - 2); ctx.closePath();
    ctx.fillStyle = '#1a1720'; ctx.fill();
    // plaque
    const cx = (L[0] + R[0]) / 2, cy = (L[1] + R[1]) / 2 - kz + 14;
    ctx.fillStyle = '#1a1720'; ctx.fillRect(cx - 6, cy, 12, 16);
    ctx.fillStyle = gl > 0.3 ? '#ffe7a0' : '#c9a54a'; ctx.font = '700 9px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('道', cx, cy + 8);
    if (this.bi === 2) { ctx.fillStyle = 'rgba(245,248,255,0.9)'; ctx.beginPath(); ctx.ellipse(cx, cy - 18, 50, 3, -0.27, 0, TAU); ctx.fill(); }
  }

  // ---------- overlays ----------
  drawLighting(ctx, view, t, extraLights) {
    if (!this.biome.night) return;
    const W = view.W, H = view.H;
    if (!this.lightCanvas) { this.lightCanvas = document.createElement('canvas'); this.lctx = this.lightCanvas.getContext('2d'); }
    const s = 0.25;
    const lw = Math.ceil(W * s), lh = Math.ceil(H * s);
    if (this.lightCanvas.width !== lw || this.lightCanvas.height !== lh) { this.lightCanvas.width = lw; this.lightCanvas.height = lh; }
    const l = this.lctx;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, lw, lh);
    l.fillStyle = this.biome.dark || 'rgba(8,12,38,0.6)'; l.fillRect(0, 0, lw, lh);
    l.globalCompositeOperation = 'destination-out';
    const all = this.lights.concat(extraLights);
    for (const L of all) {
      const fl = 1 + Math.sin(t * 9 + L.x * 3) * 0.06 * L.flicker + Math.sin(t * 23 + L.y) * 0.04 * L.flicker;
      const [sx, sy] = view.toScreen(L.x, L.y, L.z || 0);
      const R = L.r * 30 * view.k * fl * s;
      const g = l.createRadialGradient(sx * s, sy * s, 0, sx * s, sy * s, R);
      g.addColorStop(0, `rgba(0,0,0,${L.i * 0.8})`); g.addColorStop(0.45, `rgba(0,0,0,${L.i * 0.4})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g; l.beginPath(); l.arc(sx * s, sy * s, R, 0, TAU); l.fill();
    }
    ctx.drawImage(this.lightCanvas, 0, 0, W, H);
    // warm additive glows
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const L of all) {
      if (!L.color) continue;
      const [sx, sy] = view.toScreen(L.x, L.y, L.z || 0);
      const R = L.r * 22 * view.k;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
      g.addColorStop(0, `rgba(${L.color},${0.3 * L.i})`); g.addColorStop(1, `rgba(${L.color},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // Spring only: sun shafts, low morning mist and butterflies (screen space, projected from the world)
  drawAtmosphere(ctx, view, t) {
    if (this.bi !== 0) return;
    const W = view.W, H = view.H, k = view.s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // god rays from the upper left
    for (let i = 0; i < 6; i++) {
      const x = W * (-0.1 + i * 0.22) - view.camX * 0.05 * k + Math.sin(t * 0.15 + i) * 30 * k;
      const a = 0.075 + 0.045 * Math.sin(t * 0.4 + i * 1.7);
      const w = (60 + (i % 3) * 40) * k;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, 'rgba(255,236,190,0)'); g.addColorStop(0.5, `rgba(255,236,190,${a})`); g.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x + w, -10); ctx.lineTo(x + w + H * 0.55, H + 10); ctx.lineTo(x + H * 0.55, H + 10); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // low drifting morning mist
    for (let i = 0; i < 5; i++) {
      const x = ((t * (8 + i * 3) + i * 330 - view.camX * 0.4 * k) % (W + 900)) - 450;
      const y = H * (0.35 + i * 0.15) + Math.sin(t * 0.2 + i) * 20 * k - view.camY * 0.08 * k % (H * 0.2);
      const r = 300 * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,248,250,0.13)'); g.addColorStop(1, 'rgba(255,248,250,0)');
      ctx.fillStyle = g; ctx.save(); ctx.translate(x, y); ctx.scale(2.2, 0.45); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.restore(); ctx.fill();
    }
    // butterflies
    for (const b of this.butterflies) {
      const [sx, sy] = view.toScreen(b.x, b.y, b.z);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const flap = Math.abs(Math.sin(t * 14 + b.ph));
      const s = 6.5 * k * 0.5;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.cos(b.a) * 0.4);
      ctx.fillStyle = b.col; ctx.strokeStyle = 'rgba(40,30,30,0.6)'; ctx.lineWidth = 0.6 * k * 0.5;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(side * s * flap * 0.9, -s * 0.3, s * flap, s * 0.8, side * 0.4, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(side * s * flap * 0.6, s * 0.5, s * flap * 0.6, s * 0.5, -side * 0.4, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#2a2020'; ctx.fillRect(-0.6 * k * 0.5, -s * 0.8, 1.2 * k * 0.5, s * 1.6);
      ctx.restore();
      // tiny shadow on the ground
      const [gx, gy] = view.toScreen(b.x, b.y, 0);
      ctx.fillStyle = 'rgba(30,40,30,0.15)'; ctx.beginPath(); ctx.ellipse(gx, gy, s * 0.9, s * 0.35, 0, 0, TAU); ctx.fill();
    }
  }

  drawFog(ctx, view, t) {
    if (!this.biome.fog) return;
    const W = view.W, H = view.H;
    for (let i = 0; i < 4; i++) {
      const x = ((t * (12 + i * 5) + i * 400 - view.camX * 0.3 * view.k) % (W + 800)) - 400;
      const y = H * (0.2 + i * 0.22);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 380 * view.k);
      g.addColorStop(0, 'rgba(255,245,235,0.16)'); g.addColorStop(1, 'rgba(255,245,235,0)');
      ctx.fillStyle = g; ctx.save(); ctx.translate(x, y); ctx.scale(1.8, 0.6); ctx.beginPath(); ctx.arc(0, 0, 380 * view.k, 0, TAU); ctx.restore(); ctx.fill();
    }
  }

  drawGrade(ctx, view) {
    const W = view.W, H = view.H;
    ctx.fillStyle = this.biome.grade; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, this.biome.vignette);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

function randiSafe(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }

function makeBlobs(r) {
  const blobs = [];
  const n = r.int(9, 14);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = r.range(0, 22);
    blobs.push([Math.cos(a) * d * 1.3, Math.sin(a) * d * 0.8 - 6, r.range(10, 17), Math.min(3, Math.floor(r() * 4))]);
  }
  // highlights near the top
  for (let i = 0; i < 4; i++) blobs.push([r.range(-12, 12), r.range(-24, -12), r.range(6, 9), 3]);
  return blobs;
}

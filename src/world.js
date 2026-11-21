// Level arenas: biome palettes, procedural layout, cached ground, animated props, weather and lighting.
import { TAU, clamp, lerp, rand, isoX, isoY, seededRng, hash2, dist } from './util.js';
import { INK } from './rig.js';
import { sfx } from './audio.js';
import { POND, DECOR } from './config.js';

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

// a training hall (dojo): warm wooden floor, indoors in every area
const DOJO_BIOME = {
  ...BIOMES[0], key: 'dojo', name: 'Training Hall', jp: '道場',
  grass: ['#b68654', '#bb8b58', '#c0905c', '#c59560'], outer: '#2a1a10', weather: 'none', night: false, fog: false,
  trees: [], grade: 'rgba(255,200,140,0.05)', vignette: 'rgba(30,14,6,0.5)',
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
    // kind: 'town' | 'temple' | 'dojo' | 'library' (the route node's arena) or null (an ordinary level)
    this.kind = opts.kind || null;
    // 'training' (the training mode from the main menu) is a small version of the training hall
    this.dojoLike = this.kind === 'dojo' || this.kind === 'training';
    this.indoor = !!opts.hall || this.dojoLike;
    this.biome = opts.hall ? HALL_BIOME : this.dojoLike ? DOJO_BIOME : BIOMES[biomeIdx];
    this.rng = seededRng(seed);
    // every level is a little different: arena size, gate/spawn spots and the road's curve vary
    this.N = opts.hall ? 24 : this.kind === 'dojo' ? 22 : this.kind === 'training' ? 14 : this.rng.int(26, 32);
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
    this.temple = null; this.library = null; this.shrine = null;
    if (this.kind === 'temple') {
      // the temple stands somewhere near the middle; you climb up to it from the bottom, and leave the way you came
      const x0 = N / 2 - 3 + r.range(-2.5, 2.5), y0 = N / 2 - 2.5 + r.range(-3, 0.5), x1 = x0 + 6, y1 = y0 + 5, mx = (x0 + x1) / 2;
      this.temple = { x0, y0, x1, y1, door: null };
      this.spawn = { x: N - 4.8, y: N - 4.8 };
      this.gate = { x: r.range(3, 4.5), y: r.range(3, 4.5), active: false, glow: 0 }; // the way on: past the temple, at the top
      this.path = [...this.makePath(this.spawn, { x: mx, y: y1 + 1.6 }), ...this.makePath({ x: x0 - 1.6, y: y0 - 1.6 }, this.gate)];
    } else if (this.kind === 'shrine') {
      // an imbuement shrine somewhere near the middle; after the fight you kneel before it to imbue a weapon
      const cx = N / 2 + r.range(-2.5, 2.5), cy = N / 2 + r.range(-2.5, 2.5), x0 = cx - 1.2, y0 = cy - 1.2, x1 = cx + 1.2, y1 = cy + 1.2;
      this.shrine = { x0, y0, x1, y1, desk: { x: cx, y: y1 + 1.0 }, ready: false, taken: false };
      this.path = [...this.makePath(this.spawn, { x: cx, y: y1 + 2.2 }), ...this.makePath({ x: x0 - 1.8, y: y0 - 1.8 }, this.gate)];
    } else if (this.kind === 'library') {
      // the library stands in the middle; the road leads up to its open front, and on from behind it to the gate
      const c = N / 2, x0 = c - 3, y0 = c - 2.5, x1 = c + 3, y1 = c + 2.5;
      this.library = { x0, y0, x1, y1, desk: { x: c + 0.4, y: c + 0.7 }, ready: false, taken: false };
      this.path = [...this.makePath(this.spawn, { x: c + 0.5, y: y1 + 1.6 }), ...this.makePath({ x: x0 - 1.6, y: y0 - 1.6 }, this.gate)];
    } else if (this.dojoLike) {
      this.spawn = this.kind === 'training' ? { x: N - 3.5, y: N - 3.5 } : { x: N - 4, y: N - 4 };
      this.gate = { x: N - (this.kind === 'training' ? 4.5 : 5.5), y: 1.0, active: false, glow: 0 }; // the hall's back door
      this.path = [];
    }
    if (!this.path) this.path = this.makePath();
    this.generate();
    // spring atmosphere: butterflies and passing bird flocks
    this.butterflies = [];
    this.birds = null; this.birdT = rand(3, 8);
    if (biomeIdx === 0 && !this.indoor) {
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
  makePath(s = this.spawn, g = this.gate) {
    const r = this.rng;
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
    if (this.dojoLike) { this.generateDojo(); return; }
    const r = this.rng, N = this.N, b = this.biome, K = this.kind;
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
    // the temple / library and a clear space around it
    const big = this.temple || this.library || this.shrine;
    if (big) {
      mark(big.x0 - 1.2, big.y0 - 1.2, big.x1 + 1.6, big.y1 + 1.6);
      if (this.temple) mark((big.x0 + big.x1) / 2 - 2.5, big.y1, (big.x0 + big.x1) / 2 + 2.5, big.y1 + 4.5); // the forecourt
      if (this.shrine) mark(big.x0 - 1.5, big.y1, big.x1 + 1.5, big.y1 + 2.6); // the clearing in front of the shrine
    }
    if (this.temple) this.buildTemple();
    if (this.shrine) this.buildShrine();
    if (this.library) this.buildLibrary();
    // paddies (spring) / onsen (autumn) / frozen pond (winter)
    if (false) { // (no rice paddies in the levels any more, by request; kept for reference)
      const n = r.int(2, 3) + (area > 1.6 ? 1 : 0);
      for (let k = 0; k < n * 20 && this.paddies.length < n; k++) {
        const w = r.int(3, 5), h = r.int(3, 4), x = r.int(1, N - w - 1), y = r.int(1, N - h - 1);
        if (free(x, y, x + w, y + h)) { this.paddies.push({ x0: x, y0: y, x1: x + w, y1: y + h }); mark(x, y, x + w, y + h); }
      }
    } else if (this.bi !== 3 && K !== 'town') {
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
    // a large garden pond with a bridge across it (areas 1-2): the water blocks walking (not shots), the bridge doesn't
    this.bigPond = null;
    if ((this.bi === 0 || this.bi === 1) && !big && r() < POND.chance * (K === 'town' ? 0.5 : 1)) {
      for (let k = 0; k < 80 && !this.bigPond; k++) {
        const along = r() < 0.5 ? 'y' : 'x'; // the direction the bridge runs
        const L = r.int(POND.long[0], POND.long[1]), S = r.int(POND.short[0], POND.short[1]);
        const wx = along === 'y' ? L : S, wy = along === 'y' ? S : L;
        const x0 = r.int(2, N - wx - 2), y0 = r.int(2, N - wy - 2);
        if (!free(x0 - 1.5, y0 - 1.5, x0 + wx + 1.5, y0 + wy + 1.5)) continue;
        mark(x0 - 1, y0 - 1, x0 + wx + 1, y0 + wy + 1);
        const hw = POND.bridgeHalf, c = along === 'y' ? x0 + Math.floor(wx / 2) + 0.5 : y0 + Math.floor(wy / 2) + 0.5;
        this.bigPond = { x0, y0, x1: x0 + wx, y1: y0 + wy, along, c, hw, koi: [r() * TAU, r() * TAU] };
        if (along === 'y') this.rects.push({ x0, y0, x1: c - hw, y1: y0 + wy, water: true }, { x0: c + hw, y0, x1: x0 + wx, y1: y0 + wy, water: true });
        else this.rects.push({ x0, y0, x1: x0 + wx, y1: c - hw, water: true }, { x0, y0: c + hw, x1: x0 + wx, y1: y0 + wy, water: true });
      }
    }
    // houses
    let nh = Math.round((this.bi === 1 ? r.int(2, 4) : r.int(3, 5)) * Math.sqrt(area) + r.int(0, 1));
    if (K === 'town') nh = Math.round(nh * 2 + 2); else if (K === 'temple') nh = r.int(0, 1); else if (K === 'library') nh = Math.round(nh * 1.2);
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
    // decorations keep their distance from each other (DECOR.gap) so a level never gets cluttered; a few may still group up
    const decor = [];
    const place = (kind, count, rr, extra = {}, margin = 0.5) => {
      let n = 0, t = 0;
      while (n < count && t++ < 200) {
        const x = r.int(1, N - 2) + 0.5, y = r.int(1, N - 2) + 0.5;
        if (!free(x - margin, y - margin, x + margin, y + margin)) continue;
        const gap = r() < DECOR.cluster ? 0.3 : DECOR.gap;
        if (decor.some((d) => Math.hypot(d.x - x, d.y - y) < d.m + margin + gap)) continue;
        decor.push({ x, y, m: margin });
        mark(x - margin, y - margin, x + margin, y + margin);
        const p = Object.assign({ kind, x, y, seed: r() * 100 }, typeof extra === 'function' ? extra() : extra);
        this.props.push(p);
        if (rr > 0) this.circles.push({ x, y, r: rr });
        n++;
      }
    };
    // trees
    const A = (lo, hi) => Math.round(r.int(lo, hi) * area * DECOR.amount);
    const treeMul = K === 'town' ? 0.55 : K === 'temple' ? 1.3 : 1;
    place('tree', Math.round((this.bi === 3 ? A(2, 4) : A(5, 9)) * treeMul), 0.36, () => ({ variant: r.pick(b.trees), h: r.range(2.4, 3.3), blobs: makeBlobs(r) }));
    // the old trees: broad, thick-stumped, many-limbed (green in area 1, thinning orange in area 2, bare in area 3)
    if (this.bi <= 2) place('tree', Math.max(1, Math.round(A(1, 2) * treeMul)), 0.6, () => ({ variant: 'old', h: r.range(3.4, 4.2), limbs: makeLimbs(r), blobs: makeBlobs(r) }), 1.0);
    // area 1: bushes (bandits, ninjas and archers can step out of them); area 2: piles of fallen leaves (any enemy)
    if (this.bi === 0) place('hidebush', A(4, 6), 0.42, () => ({ s: r.range(0.85, 1.2), puffs: Array.from({ length: r.int(5, 7) }, () => [r.range(-13, 13), r.range(-7, 3), r.range(7, 11)]) }));
    if (this.bi === 1) place('leafpile', A(4, 6), 0, () => ({ s: r.range(0.85, 1.25), leaves: Array.from({ length: r.int(22, 30) }, () => [r.range(-1, 1), r.range(-1, 1), r.range(0, TAU), r.int(0, 3)]) }));
    if (this.bi === 1) place('bamboo', A(3, 5), 0.55, () => ({ stalks: Array.from({ length: r.int(5, 8) }, () => [r.range(-0.45, 0.45), r.range(-0.45, 0.45), r.range(3, 4.3), r() * 10]) }), 0.8);
    place('lantern', this.bi === 3 ? A(4, 6) : A(2, 4), 0.28);
    if (this.bi === 3) place('brazier', A(2, 3), 0.3);
    place('rock', A(2, 5), 0.42, () => ({ s: r.range(0.7, 1.2), pts: Array.from({ length: 8 }, (_, i) => r.range(0.75, 1.1)) }));
    if (this.bi === 0 && !K) place('scarecrow', A(1, 2), 0.2);
    // (no rice bales or jizo statues in any area any more, by request; drawBales / drawJizo kept for reference)
    place('banner', this.bi === 3 ? A(4, 5) : A(2, 3), 0.12, () => ({ color: this.bi === 3 ? r.pick(['#8a1420', '#1a1418']) : r.pick(['#c23b2e', '#2e4a8a', '#e8e0cc']) }));
    if (this.bi !== 3 && (r() < 0.6 || K === 'town')) place('well', 1 + (r() < area - 1 || K === 'town' ? 1 : 0), 0.55);

    // lights for lanterns
    for (const p of this.props) if (p.kind === 'lantern') this.lights.push({ x: p.x, y: p.y, z: 0.9, r: this.bi >= 2 ? 3.2 : 2.2, color: '255,190,110', flicker: 0.5, i: 0.9, prop: p });
    for (const p of this.props) if (p.kind === 'brazier') { this.lights.push({ x: p.x, y: p.y, z: 1, r: 4.2, color: '255,140,60', flicker: 1, i: 1 }); this.emitters.push({ kind: 'brazier', x: p.x, y: p.y, z: 1.1, t: 0 }); }

    // torii gate (exit)
    const g = this.gate;
    this.props.push({ kind: 'torii', x: g.x, y: g.y });
    this.circles.push({ x: g.x - 1, y: g.y + 1, r: 0.2 }, { x: g.x + 1, y: g.y - 1, r: 0.2 });

    // outer decor (no collision)
    const outer = [], outerFree = (x, y) => { if (outer.some((o) => Math.hypot(o.x - x, o.y - y) < DECOR.outerGap)) return false; outer.push({ x, y }); return true; };
    for (let k = 0; k < Math.round(26 * Math.sqrt(area) * DECOR.outer); k++) {
      const side = r.int(0, 1), along = r.range(-3, N + 3), out = r.range(1.2, 4);
      const x = side ? along : -out, y = side ? -out : along;
      if (!outerFree(x, y)) continue;
      this.props.push({ kind: 'tree', x, y, variant: r.pick(b.trees), h: r.range(2.6, 3.8), blobs: makeBlobs(r), outer: true, seed: r() * 100 });
    }
    for (let k = 0; k < Math.round(14 * DECOR.outer); k++) {
      const side = r.int(0, 1), along = r.range(0, N), out = r.range(0.8, 2.5);
      const x = side ? along : N + out, y = side ? N + out : along;
      if (!outerFree(x, y)) continue;
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
      const BP = this.bigPond; if (BP && x > BP.x0 - 0.3 && x < BP.x1 + 0.3 && y > BP.y0 - 0.3 && y < BP.y1 + 0.3) continue;
      if (big && x > big.x0 - 0.4 && x < big.x1 + 0.4 && y > big.y0 - 0.4 && y < big.y1 + (this.temple ? 4.5 : this.shrine ? 2.6 : 0.4)) continue;
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
      if (p.kind === 'tree' && p.variant === 'old' && this.bi === 1) this.emitters.push({ kind: 'leaves', x: p.x, y: p.y, z: p.h, variant: 'maple', t: rand(0, 2) }); // (the old tree sheds its last leaves)
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

  // ---------- special arenas (route nodes) ----------
  // Temple: the hall on its stone platform at the top of the map, a gravel forecourt with paired stone
  // lanterns and an incense burner in front of the steps. The monk steps out of its doors.
  buildTemple() {
    const T = this.temple, mx = (T.x0 + T.x1) / 2;
    const prop = { kind: 'temple', x: mx, y: (T.y0 + T.y1) / 2, x0: T.x0, y0: T.y0, x1: T.x1, y1: T.y1, seed: this.rng() * 100 };
    this.props.push(prop);
    this.rects.push({ x0: T.x0, y0: T.y0, x1: T.x1, y1: T.y1 });
    T.door = { house: prop, x: mx, y: T.y1 + 0.2, ox: mx, oy: T.y1 + 1.6 };
    for (const d of [1.6, 3.4]) for (const s of [-1, 1]) { const x = mx + s * 2.2, y = T.y1 + d; this.props.push({ kind: 'lantern', x, y, seed: d * 10 + s }); this.circles.push({ x, y, r: 0.28 }); }
    const ky = T.y1 + 3.0;
    this.props.push({ kind: 'koro', x: mx, y: ky }); this.circles.push({ x: mx, y: ky, r: 0.38 });
    this.emitters.push({ kind: 'incense', x: mx, y: ky, z: 0.9, t: 0 });
  }

  // Imbuement shrine: a small hokora on a stone platform with a shimenawa rope, two fox guardians and lanterns.
  // Elemental lights gather around it once the fight is over (world.shrine.ready).
  buildShrine() {
    const S = this.shrine, { x0, y0, x1, y1 } = S, cx = (x0 + x1) / 2;
    this.props.push({ kind: 'shrine', x: cx, y: (y0 + y1) / 2, x0, y0, x1, y1 });
    this.rects.push({ x0: x0 + 0.1, y0: y0 + 0.1, x1: x1 - 0.1, y1: y1 - 0.1 });
    for (const s of [-1, 1]) { const x = cx + s * 1.9, y = y1 + 0.4; this.props.push({ kind: 'kitsune', x, y, side: s }); this.circles.push({ x, y, r: 0.3 }); }
    for (const s of [-1, 1]) { const x = cx + s * 2.0, y = y1 + 1.9; this.props.push({ kind: 'lantern', x, y, seed: s * 3 }); this.circles.push({ x, y, r: 0.28 }); }
    this.lights.push({ x: cx, y: y1, z: 1, r: 4, color: '200,220,255', flicker: 0.4, i: 0.7 });
  }

  // Library: an open-fronted hall in the middle of a town. Bookshelves line its back walls, two more stand
  // inside, the front is open between pillars, and the scroll waits on the desk.
  buildLibrary() {
    const Lb = this.library, { x0, y0, x1, y1 } = Lb;
    // the back walls, one tile per prop so whoever walks behind the library is hidden by them
    for (let c = x0 + 0.5; c < x1; c += 1) this.props.push({ kind: 'libwall', axis: 'x', x: c, y: y0, seed: c * 3.1 });
    for (let c = y0 + 0.5; c < y1; c += 1) this.props.push({ kind: 'libwall', axis: 'y', x: x0, y: c, seed: c * 5.7 });
    this.rects.push({ x0: x0 - 0.3, y0: y0 - 0.3, x1, y1: y0 + 0.3 }, { x0: x0 - 0.3, y0: y0 - 0.3, x1: x0 + 0.3, y1 });
    for (const x of [x0 + 2, x0 + 4, x1]) { this.props.push({ kind: 'libpillar', x, y: y1 }); this.circles.push({ x, y: y1, r: 0.2 }); }
    this.props.push({ kind: 'libpillar', x: x0, y: y1 }); this.circles.push({ x: x0, y: y1, r: 0.2 });
    for (const y of [y0, y0 + 2.5]) { this.props.push({ kind: 'libpillar', x: x1, y }); this.circles.push({ x: x1, y, r: 0.2 }); }
    const shelves = [{ axis: 'x', x: x0 + 3.6, y: y0 + 1.5, len: 2.2 }, { axis: 'y', x: x0 + 1.5, y: y0 + 3.0, len: 1.8 }];
    for (const s of shelves) {
      this.props.push({ kind: 'shelf', ...s, seed: s.x * 7 + s.y });
      const hx = s.axis === 'x' ? s.len / 2 : 0.25, hy = s.axis === 'x' ? 0.25 : s.len / 2;
      this.rects.push({ x0: s.x - hx, y0: s.y - hy, x1: s.x + hx, y1: s.y + hy });
    }
    const D = Lb.desk;
    this.props.push({ kind: 'desk', x: D.x, y: D.y });
    this.rects.push({ x0: D.x - 0.65, y0: D.y - 0.32, x1: D.x + 0.65, y1: D.y + 0.32 });
    this.props.push({ kind: 'libroof', x: x1, y: y1, x0, y0, x1, y1 });
    this.lights.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 1.2, r: 4.5, color: '255,200,120', flicker: 0.3, i: 0.8 });
    for (const [x, y] of [[x0 - 0.9, y1 + 1.0], [x1 + 1.0, y0 - 0.9]]) { this.props.push({ kind: 'lantern', x, y, seed: x }); this.circles.push({ x, y, r: 0.28 }); }
  }

  // Training hall: one big wooden hall with a tatami floor, four pillars, shoji walls with sliding doors
  // the fighters step out of, weapon racks, a small shrine shelf, a hanging scroll and a drum.
  // Every hall is a little different (from the level's seed): the wood of the floor, the age of the tatami and
  // the colour of their borders, the shape of the mat area, where the pillars stand and where the racks,
  // shrine shelf, scroll and drum are.
  generateDojo() {
    const N = this.N, small = this.kind === 'training', r = this.rng; // the training room: no pillars, no doors for fighters
    const WOODS = [
      ['#b68654', '#bb8b58', '#c0905c', '#c59560'], // honey
      ['#8a5a34', '#8f5e37', '#94623a', '#99663d'], // dark walnut
      ['#d0ad78', '#d4b17c', '#d8b580', '#dcb984'], // pale hinoki
      ['#a8643e', '#ad6841', '#b26c44', '#b77047'], // red pine
    ];
    const TATAMI = [['#c8c088', '#c2b880'], ['#b6bc7c', '#b0b676'], ['#d2bc7a', '#cab474']]; // aged, fresh, golden
    const BORDERS = ['#2e4a2a', '#24324e', '#1e1a18', '#5a2420'];
    this.biome = { ...DOJO_BIOME, grass: r.pick(WOODS) };
    this.dojo = { tatami: r.pick(TATAMI), border: r.pick(BORDERS), inset: small ? 4 : r.pick([3, 4, 4, 5]), layout: small ? 'square' : r.pick(['square', 'ring', 'twin']) };
    if (!small) {
      const k = r.pick([5.5, 6.5]), pil = [[k, k], [k, N - k], [N - k, k], [N - k, N - k]];
      if (r() < 0.35) pil.push([N / 2, k], [N / 2, N - k]); // a long hall: two more pillars down the middle
      for (const [x, y] of pil) { this.props.push({ kind: 'pillar', style: 'dojo', x, y }); this.circles.push({ x, y, r: 0.36 }); }
    }
    const doorsX = small ? [] : [5.5, 11.5], doorsY = small ? [] : [7.5, 14.5], exitX = this.gate.x;
    // the drum stands in one of three corners, its head turned to the room
    const drum = small ? { x: 2.2, y: N - 2.6, axis: 'x' } : r.pick([{ x: 2.2, y: N - 2.6, axis: 'x' }, { x: N - 2.6, y: 2.4, axis: 'y' }, { x: 2.6, y: 2.6, axis: r() < 0.5 ? 'x' : 'y' }]);
    const shrineAt = small ? 4.5 : r.pick([2.5, 8.5, 13.5, 19.5].filter((x) => Math.hypot(x - drum.x, drum.y) > 3)), scrollAt = small ? 6.5 : r.pick([3.5, 11.5, 18.5].filter((y) => Math.hypot(drum.x, y - drum.y) > 3));
    for (let i = 0; i < N; i++) {
      const c = i + 0.5;
      if (c === exitX) this.props.push({ kind: 'exitdoor', axis: 'x', x: c, y: -0.1, outer: true });
      else if (doorsX.includes(c)) this.props.push({ kind: 'hdoor', style: 'dojo', axis: 'x', x: c, y: -0.1, dx: c, dy: 0.4, ox: c, oy: 1.5, outer: true });
      else this.props.push({ kind: 'screen', style: 'dojo', axis: 'x', x: c, y: -0.1, seed: i, deco: c === shrineAt ? 'shrine' : null, outer: true });
      if (doorsY.includes(c)) this.props.push({ kind: 'hdoor', style: 'dojo', axis: 'y', x: -0.1, y: c, dx: 0.4, dy: c, ox: 1.5, oy: c, outer: true });
      else this.props.push({ kind: 'screen', style: 'dojo', axis: 'y', x: -0.1, y: c, seed: i + 50, deco: c === scrollAt ? 'scroll' : null, outer: true });
      this.props.push({ kind: 'rail', style: 'dojo', axis: 'x', x: c, y: N + 0.1, outer: true }, { kind: 'rail', style: 'dojo', axis: 'y', x: N + 0.1, y: c, outer: true });
    }
    // weapon racks against the walls (clear of the doors)
    // (two of the free spots on each wall, never in front of the shrine shelf / scroll or beside the drum)
    const free = (list, deco, far) => list.filter((c) => Math.abs(c - deco) > 1.3 && far(c));
    const pick2 = (list) => { const L = [...list]; const a = L.splice(r.int(0, L.length - 1), 1)[0]; return L.length ? [a, L[r.int(0, L.length - 1)]] : [a]; };
    const nearDrum = (x, y) => Math.hypot(x - drum.x, y - drum.y) < 2.2;
    const racksX = small ? [2.2] : pick2(free([2.6, 8.6, 14.0, 19.6], shrineAt, (x) => !nearDrum(x, 0.7) && Math.abs(x - exitX) > 1.6));
    const racksY = small ? [3.2, 10.6] : pick2(free([3.6, 11.0, 18.0], scrollAt, (y) => !nearDrum(0.7, y)));
    for (const x of racksX) { this.props.push({ kind: 'rack', axis: 'x', x, y: 0.7, seed: x }); this.rects.push({ x0: x - 0.75, y0: 0.45, x1: x + 0.75, y1: 0.95 }); }
    for (const y of racksY) { this.props.push({ kind: 'rack', axis: 'y', x: 0.7, y, seed: y }); this.rects.push({ x0: 0.45, y0: y - 0.75, x1: 0.95, y1: y + 0.75 }); }
    this.props.push({ kind: 'taiko', ...drum }); this.circles.push({ x: drum.x, y: drum.y, r: 0.75 });
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
  // shot: a projectile asking (they fly over water)
  blocked(x, y, rad = 0.1, shot = false) {
    const N = this.N;
    if (x < 0.3 || y < 0.3 || x > N - 0.3 || y > N - 0.3) return true;
    for (const q of this.rects) if (!(shot && q.water) && x > q.x0 - rad && x < q.x1 + rad && y > q.y0 - rad && y < q.y1 + rad) return true;
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
    if (this.dojoLike) { this.buildDojoGround(g, N, E, r); return; }
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
    if (this.bigPond) this.bakeBigPond(g, r);
    if (this.temple) this.bakeTempleCourt(g, r);
    if (this.library) this.bakeLibraryFloor(g, r);
    if (this.shrine) { const S = this.shrine, cx = (S.x0 + S.x1) / 2; poly(g, [P(S.x0 - 1.4, S.y1), P(S.x1 + 1.4, S.y1), P(S.x1 + 1.4, S.y1 + 2.6), P(S.x0 - 1.4, S.y1 + 2.6)], this.bi === 2 ? '#dfe4ec' : '#d2c8b2', 'rgba(60,50,40,0.3)', 1.5); g.strokeStyle = 'rgba(120,110,90,0.3)'; g.lineWidth = 1; for (let y = S.y1 + 0.25; y < S.y1 + 2.6; y += 0.25) { const a = P(S.x0 - 1.4, y), c = P(S.x1 + 1.4, y); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); } void cx; }
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
    if (this.bi === 0 && !this.indoor) {
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
        case 'incense': // a thin thread of incense smoke from the temple's burner
          e.t = 0.18;
          parts.emit('smoke', e.x + rand(-0.1, 0.1), e.y + rand(-0.1, 0.1), e.z, w * 0.25, -0.05, 0.55, 3.2, rand(2.5, 4), 'rgba(225,225,235,1)', { drag: 0.2 });
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
    if (this.dojoLike) { // indoors: dark wooden walls and beams
      const hg = ctx.createLinearGradient(0, 0, 0, H);
      hg.addColorStop(0, '#120a06'); hg.addColorStop(1, '#2e1c10');
      ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,220,170,0.05)';
      for (let i = 0; i < 6; i++) ctx.fillRect(0, H * (0.08 + i * 0.07), W, 3 * view.k);
      return;
    }
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
        const rr = (((t * 0.4 + k / 3) % 1) + 1) % 1; // always 0..1, even if the clock dips below zero
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - rr)})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(sx, sy, rr * pd.r * 40, rr * pd.r * 20, 0, 0, TAU); ctx.stroke();
      }
    }
    if (this.bigPond) this.drawBigPond(ctx, t);
    // cloud shadows
    if (!this.biome.night && !this.noShadows) {
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

  // ---- the large garden pond
  // its outline: a rounded rectangle in world space, sampled into points
  pondOutline(inset = 0.08, rad = 0.6) {
    const B = this.bigPond, x0 = B.x0 + inset, y0 = B.y0 + inset, x1 = B.x1 - inset, y1 = B.y1 - inset, pts = [];
    const corners = [[x1 - rad, y0 + rad, -Math.PI / 2], [x1 - rad, y1 - rad, 0], [x0 + rad, y1 - rad, Math.PI / 2], [x0 + rad, y0 + rad, Math.PI]];
    for (const [cx, cy, a0] of corners) for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); }
    return pts;
  }
  bakeBigPond(g, r) {
    const B = this.bigPond, autumn = this.bi === 1;
    const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = P(x, y); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); }); g.closePath(); };
    const out = this.pondOutline(0.08), [ax, ay] = P(B.x0, B.y0), [bx, by] = P(B.x1, B.y1);
    // damp earth bank, then the water (deeper toward the middle)
    path(out); g.strokeStyle = 'rgba(70,56,40,0.55)'; g.lineWidth = 12; g.lineJoin = 'round'; g.stroke();
    const wg = g.createLinearGradient(0, Math.min(ay, by) - 40, 0, Math.max(ay, by) + 40);
    wg.addColorStop(0, autumn ? '#7aa8a8' : '#86c6d6'); wg.addColorStop(1, autumn ? '#2e5a64' : '#3a7896');
    path(out); g.fillStyle = wg; g.fill();
    g.save(); path(out); g.clip();
    path(out); g.strokeStyle = 'rgba(20,40,60,0.35)'; g.lineWidth = 14; g.stroke(); // darker water along the edge
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 2; // sky reflections
    for (let k = 0; k < 9; k++) { const [sx, sy] = P(r.range(B.x0 + 0.6, B.x1 - 0.6), r.range(B.y0 + 0.6, B.y1 - 0.6)); g.beginPath(); g.moveTo(sx - 18, sy); g.lineTo(sx + 18, sy); g.stroke(); }
    // lily pads with a few flowers (spring) / fallen maple leaves (autumn)
    for (let k = 0; k < (autumn ? 16 : 9); k++) {
      const [sx, sy] = P(r.range(B.x0 + 0.5, B.x1 - 0.5), r.range(B.y0 + 0.5, B.y1 - 0.5));
      if (autumn) { g.fillStyle = ['#c8301e', '#e0602a', '#f0a030'][k % 3]; g.beginPath(); g.ellipse(sx, sy, 4, 2.4, r.range(0, 3), 0, TAU); g.fill(); continue; }
      const s = r.range(7, 11);
      g.fillStyle = '#4e8a3a'; g.beginPath(); g.ellipse(sx, sy, s, s * 0.5, 0, 0.35, TAU - 0.15); g.lineTo(sx, sy); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(20,40,20,0.5)'; g.lineWidth = 1; g.stroke();
      if (k % 3 === 0) { g.fillStyle = '#f7c8d8'; g.beginPath(); g.arc(sx + 2, sy - 3, 3, 0, TAU); g.fill(); g.fillStyle = '#fff4c0'; g.beginPath(); g.arc(sx + 2, sy - 3, 1.2, 0, TAU); g.fill(); }
    }
    g.restore();
    // rim stones all around
    const rim = this.pondOutline(0.02);
    for (let i = 0; i < rim.length; i++) {
      const [x0, y0] = rim[i], [x1, y1] = rim[(i + 1) % rim.length], n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.42));
      for (let k = 0; k < n; k++) {
        const u = k / n, [sx, sy] = P(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
        const s = r.range(5.5, 9);
        g.fillStyle = shade(autumn ? '#8a8276' : '#9a968c', r.range(-0.15, 0.12)); g.strokeStyle = INK; g.lineWidth = 1.1;
        g.beginPath(); g.ellipse(sx, sy - 2, s, s * 0.62, r.range(-0.3, 0.3), 0, TAU); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.ellipse(sx - s * 0.25, sy - 2 - s * 0.25, s * 0.45, s * 0.22, 0, 0, TAU); g.fill();
      }
    }
  }
  // drawn every frame over the ground: water glints, two koi and the bridge
  drawBigPond(ctx, t) {
    const B = this.bigPond, cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2;
    for (let k = 0; k < 7; k++) {
      const fx = B.x0 + 0.6 + hash2(k, B.x0) * (B.x1 - B.x0 - 1.2), fy = B.y0 + 0.6 + hash2(B.y0, k) * (B.y1 - B.y0 - 1.2);
      const a = Math.max(0, Math.sin(t * 1.3 + k * 1.9));
      ctx.strokeStyle = `rgba(255,255,255,${0.45 * a})`; ctx.lineWidth = 1.5;
      const sx = isoX(fx, fy), sy = isoY(fx, fy); ctx.beginPath(); ctx.moveTo(sx - 9, sy); ctx.lineTo(sx + 9, sy); ctx.stroke();
    }
    // koi circling slowly in the open water on either side of the bridge
    B.koi.forEach((ph, i) => {
      const side = i ? 1 : -1, half = B.along === 'y' ? (B.x1 - B.x0) / 4 : (B.y1 - B.y0) / 4;
      const ox = B.along === 'y' ? cx + side * half * 1.1 : cx, oy = B.along === 'y' ? cy : cy + side * half * 1.1;
      const a = ph + t * 0.35 * (i ? 1 : -1), rx = 0.9, ry = 0.6;
      const x = ox + Math.cos(a) * rx, y = oy + Math.sin(a) * ry;
      const dx = -Math.sin(a) * rx * (i ? 1 : -1), dy = Math.cos(a) * ry * (i ? 1 : -1), ang = Math.atan2(isoY(dx, dy) - isoY(0, 0), isoX(dx, dy) - isoX(0, 0));
      ctx.save(); ctx.translate(isoX(x, y), isoY(x, y)); ctx.rotate(ang); ctx.globalAlpha = 0.85;
      ctx.fillStyle = i ? '#f08a3a' : '#f4f0e8'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 3, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-12, -3 + Math.sin(t * 8 + i) * 1.5); ctx.lineTo(-12, 3 + Math.sin(t * 8 + i) * 1.5); ctx.closePath(); ctx.fill();
      if (!i) { ctx.fillStyle = '#e04a2a'; ctx.beginPath(); ctx.arc(2, 0, 2, 0, TAU); ctx.fill(); }
      ctx.restore();
    });
    // the bridge: a gently arched wooden deck with vermilion rails
    const len0 = (B.along === 'y' ? B.y0 : B.x0) - 0.55, len1 = (B.along === 'y' ? B.y1 : B.x1) + 0.55, W = B.hw * 0.92, arc = 0.22;
    const pt = (a, u, z = 0) => { const b = len0 + (len1 - len0) * u, x = B.along === 'y' ? B.c + a : b, y = B.along === 'y' ? b : B.c + a; return [isoX(x, y), isoY(x, y, z + arc * Math.sin(Math.PI * u))]; };
    const n = 16;
    const rail = (a) => { // posts and a top rail along one edge
      ctx.strokeStyle = INK; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
      ctx.beginPath(); for (let i = 0; i <= n; i++) { const [sx, sy] = pt(a, i / n, 0.5); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); } ctx.stroke();
      for (let i = 0; i <= n; i += 2) { const [bx, by] = pt(a, i / n), [tx, ty] = pt(a, i / n, 0.55); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke(); }
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2.6;
      ctx.beginPath(); for (let i = 0; i <= n; i++) { const [sx, sy] = pt(a, i / n, 0.5); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); } ctx.stroke();
      for (let i = 0; i <= n; i += 2) { const [bx, by] = pt(a, i / n), [tx, ty] = pt(a, i / n, 0.55); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke(); }
      for (const u of [0, 1]) { const [tx, ty] = pt(a, u, 0.62); ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(tx, ty, 3, 0, TAU); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke(); } // giboshi caps
    };
    rail(-W); // the far rail first
    ctx.beginPath(); // the deck
    for (let i = 0; i <= n; i++) { const [sx, sy] = pt(-W, i / n); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
    for (let i = n; i >= 0; i--) { const [sx, sy] = pt(W, i / n); ctx.lineTo(sx, sy); }
    ctx.closePath(); ctx.fillStyle = '#8a5e3a'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(40,24,12,0.45)'; ctx.lineWidth = 1; // planks
    for (let i = 1; i < n * 2; i++) { const [ax, ay] = pt(-W, i / (n * 2)), [bx, by] = pt(W, i / (n * 2)); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    rail(W); // the near rail
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
  depthOf(p) {
    switch (p.kind) {
      case 'house': return p.x + p.y + 0.6;
      case 'temple': return Math.min(p.x0 + p.y1, p.x1 + p.y0) - 0.3;
      case 'shrine': return p.x + p.y + 0.4;
      case 'libroof': return p.x1 + p.y1 + 1.2;
      default: return p.x + p.y;
    }
  }

  // returns screen-space bounding box (for occlusion fading)
  boundsOf(p) {
    const sx = isoX(p.x, p.y), sy = isoY(p.x, p.y);
    switch (p.kind) {
      case 'house': { const w = (p.x1 - p.x0 + p.y1 - p.y0) * 32 + 30; return [sx - w / 2, sy - 130, w, 150]; }
      case 'tree': return p.variant === 'old' ? [sx - 110, sy - p.h * 32 - 80, 220, p.h * 32 + 90] : [sx - 60, sy - p.h * 32 - 60, 120, p.h * 32 + 60];
      case 'hidebush': return [sx - 34, sy - 36, 68, 44];
      case 'leafpile': return [sx - 40, sy - 18, 80, 30];
      case 'bamboo': return [sx - 40, sy - 150, 80, 150];
      case 'torii': return [sx - 90, sy - 100, 180, 110];
      case 'pillar': return [sx - 14, sy - 130, 28, 135];
      case 'throne': return [sx - 50, sy - 120, 100, 125];
      case 'screen': case 'hdoor': case 'fwall': return [sx - 40, sy - 100, 80, 105];
      case 'banner': return [sx - 10, sy - 100, 50, 100];
      case 'temple': return boxBounds(p.x0 - 1, p.y0 - 1, p.x1 + 1, p.y1 + 1.2, 5);
      case 'shrine': return boxBounds(p.x0 - 1.2, p.y0 - 1.2, p.x1 + 1.2, p.y1 + 1.2, 4);
      case 'kitsune': return [sx - 20, sy - 50, 40, 55];
      case 'libwall': return [sx - 40, sy - 90, 80, 100];
      case 'libroof': return boxBounds(p.x0 - 0.6, p.y0 - 0.6, p.x1 + 0.6, p.y1 + 0.6, 3.8);
      case 'libpillar': return [sx - 12, sy - 75, 24, 80];
      case 'shelf': return [sx - 50, sy - 80, 100, 95];
      case 'desk': return [sx - 50, sy - 60, 100, 70];
      case 'rack': return [sx - 50, sy - 70, 100, 80];
      case 'exitdoor': return [sx - 40, sy - 100, 80, 105];
      case 'taiko': return [sx - 56, sy - 76, 112, 96];
      default: return [sx - 25, sy - 50, 50, 55];
    }
  }

  drawProp(ctx, p, t) {
    switch (p.kind) {
      case 'house': return this.drawHouse(ctx, p, t);
      case 'tree': return p.variant === 'old' ? this.drawOldTree(ctx, p, t) : this.drawTree(ctx, p, t);
      case 'hidebush': return this.drawHideBush(ctx, p, t);
      case 'leafpile': return this.drawLeafPile(ctx, p, t);
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
      case 'temple': return this.drawTemple(ctx, p, t);
      case 'shrine': return this.drawShrine(ctx, p, t);
      case 'kitsune': return this.drawKitsuneStatue(ctx, p);
      case 'koro': return this.drawKoro(ctx, p);
      case 'libwall': return this.drawLibWall(ctx, p);
      case 'libpillar': return this.drawLibPillar(ctx, p);
      case 'libroof': return this.drawLibRoof(ctx, p);
      case 'shelf': return this.drawShelf(ctx, p);
      case 'desk': return this.drawDesk(ctx, p, t);
      case 'rack': return this.drawRack(ctx, p);
      case 'taiko': return this.drawTaiko(ctx, p);
      case 'exitdoor': return this.drawExitDoor(ctx, p, t);
    }
  }

  drawHouse(ctx, h, t) {
    const { x0, y0, x1, y1 } = h, H = 1.15, o = 0.38, b = this.bi;
    const night = this.biome.night;
    // shadow
    if (!this.noShadows) { ctx.fillStyle = 'rgba(20,20,40,0.22)'; poly(ctx, [P(x0 - 0.2, y0), P(x1 + 0.6, y0), P(x1 + 0.9, y1 + 0.5), P(x0, y1 + 0.4)], ctx.fillStyle, null); }
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
    if (!this.noShadows) { ctx.fillStyle = 'rgba(20,25,35,0.22)'; ctx.beginPath(); ctx.ellipse(sx + 10, sy + 2, 40, 16, 0, 0, TAU); ctx.fill(); }
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
    // two side branches, rooted on the trunk's own curve and reaching up into the canopy (which hides their ends)
    const onTrunk = (u) => [(1 - u) * (1 - u) * sx + 2 * u * (1 - u) * (sx - 6) + u * u * tx, (1 - u) * (1 - u) * sy + 2 * u * (1 - u) * (sy - H * 0.3) + u * u * ty];
    const bark = p.variant === 'cherry' ? '#5a3a36' : '#4e3a2a';
    for (const [u, ex, ey] of [[0.72, -18, -H * 0.16], [0.84, 16, -H * 0.2]]) {
      const [bx, by] = onTrunk(u), x2 = tx + ex + sway * 0.9, y2 = ty + ey;
      ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo((bx + x2) / 2, by - 4, x2, y2); ctx.stroke();
      ctx.strokeStyle = bark; ctx.lineWidth = 2.6; ctx.stroke();
    }
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
      if (p.variant === 'cherry' && layer === 1) { // dark branches showing through the blossom
        ctx.strokeStyle = 'rgba(70,40,40,0.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        for (const [bx, by] of [[-22, -14], [20, -18], [-6, -30], [10, 4], [-26, 4]]) { ctx.moveTo(tx, ty); ctx.quadraticCurveTo(cx + bx * 0.5 + sway * 0.6, cy + by * 0.3, cx + bx + sway, cy + by); } // (from the top of the trunk)
        ctx.stroke();
      }
    }
    if (p.variant === 'cherry') this.drawBlossoms(ctx, p, cx, cy, sway, t);
  }
  // the old tree: flared roots, a thick dark stump, five or six long limbs forking into twigs; leaves by area
  drawOldTree(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y), H = p.h * 32, sway = this.wind(p.x, p.y, t) * 5, area = this.bi;
    if (!this.noShadows) { ctx.fillStyle = 'rgba(20,25,35,0.24)'; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 4, 84, 30, 0, 0, TAU); ctx.fill(); }
    const bark = '#3a2618', bark2 = '#4e3422', top = sy - H * 0.42;
    // roots and stump: a wide flared base narrowing up to where the limbs split
    ctx.beginPath();
    ctx.moveTo(sx - 30, sy + 4); ctx.quadraticCurveTo(sx - 16, sy - 2, sx - 13, sy - H * 0.14); ctx.quadraticCurveTo(sx - 11, sy - H * 0.3, sx - 15, top);
    ctx.lineTo(sx + 15, top); ctx.quadraticCurveTo(sx + 12, sy - H * 0.3, sx + 14, sy - H * 0.14); ctx.quadraticCurveTo(sx + 18, sy - 2, sx + 32, sy + 5);
    ctx.quadraticCurveTo(sx + 12, sy + 6, sx + 4, sy + 2); ctx.quadraticCurveTo(sx - 6, sy + 7, sx - 30, sy + 4); ctx.closePath();
    ctx.fillStyle = bark; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(20,10,4,0.55)'; ctx.lineWidth = 1.2; ctx.beginPath(); // bark furrows and a knot
    for (const k of [-7, -1, 6]) { ctx.moveTo(sx + k, sy - 4); ctx.quadraticCurveTo(sx + k * 1.3, sy - H * 0.2, sx + k * 0.9, top + 6); }
    ctx.stroke(); ctx.beginPath(); ctx.ellipse(sx + 4, sy - H * 0.22, 3, 4.5, 0, 0, TAU); ctx.stroke();
    // limbs (ink, then bark), each with a twig or two; their tips sway
    const tips = [];
    const limb = (x0, y0, a, len, w, depth, s) => {
      const x1 = x0 + Math.sin(a) * len + sway * (0.4 + depth * 0.4), y1 = y0 - Math.cos(a) * len;
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = w + 2.6; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + Math.sin(a + 1.2) * len * 0.12, (y0 + y1) / 2, x1, y1); ctx.stroke();
      ctx.strokeStyle = depth ? bark2 : bark; ctx.lineWidth = w; ctx.stroke();
      tips.push([x1, y1, depth]);
      return [x1, y1];
    };
    for (const L of p.limbs) {
      const [x1, y1] = limb(sx + L.dx, top + 4, L.a, H * L.len, 6, 0);
      for (const K of L.kids) { const [x2, y2] = limb(x1 + (x0lerp(sx + L.dx, x1, K.at) - x1), y1 + (lerpY(top + 4, y1, K.at) - y1), L.a + K.da, H * K.len, 3, 1); for (const T2 of K.twigs) limb(x2, y2, L.a + K.da + T2, H * 0.08, 1.4, 2); }
    }
    // leaves: lush green clumps (area 1), a few orange-brown ones (area 2), none but a last brown leaf or two (area 3)
    if (area === 2) { ctx.fillStyle = '#6a4a2a'; for (const [x, y, d] of tips.slice(0, 3)) if (d === 2) { ctx.beginPath(); ctx.ellipse(x + 2, y + 3, 2.2, 1.2, 0.5, 0, TAU); ctx.fill(); } return; }
    const pal = area === 0 ? ['#3e6e34', '#558a40', '#6ea24e', '#8cbc66'] : ['#8a4a1c', '#b8622a', '#d88a3a', '#e8a85a'];
    const keep = area === 0 ? tips : tips.filter((_, k) => k % 2 === 0);
    const clump = (x, y, r, k) => { const c2 = Math.sin(t * 2 + x * 0.05) * 0.8; ctx.beginPath(); ctx.arc(x + c2, y, r, 0, TAU); ctx.fillStyle = pal[k]; ctx.fill(); };
    if (area === 1) { // autumn: a few ragged little clusters of turning leaves clinging to the twigs (no outline)
      for (const [x, y, d] of keep) if (d >= 1) for (let j = 0; j < 5; j++) { const ox = Math.sin(x * 0.7 + j * 2.1) * 6, oy = Math.cos(y * 0.9 + j * 1.7) * 4; ctx.beginPath(); ctx.ellipse(x + ox + Math.sin(t * 2 + j) * 0.6, y + oy, 3.2, 2, j, 0, TAU); ctx.fillStyle = pal[(j + Math.round(x)) % 4]; ctx.fill(); }
      return;
    }
    ctx.fillStyle = INK;
    for (const [x, y, d] of keep) if (d >= 1) { ctx.beginPath(); ctx.arc(x, y, 15 + 1.8, 0, TAU); ctx.fill(); }
    for (let k = 0; k < 4; k++) for (const [x, y, d] of keep) if (d >= 1) clump(x - k * 0.8, y - k * 1.6, 15 * (1 - k * 0.18), k);
  }
  // area 1: a low, round hiding bush (dark leaves, a few lighter tops); it shakes when someone steps out of it
  drawHideBush(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y), s = p.s || 1, k = p.rustleT != null ? clamp(1 - (t - p.rustleT) / 0.8, 0, 1) : 0;
    const jig = Math.sin(t * 40) * 2.5 * k, sway = this.wind(p.x, p.y, t) * 1.2;
    if (!this.noShadows) { ctx.fillStyle = 'rgba(20,25,35,0.2)'; ctx.beginPath(); ctx.ellipse(sx + 3, sy + 2, 22 * s, 9 * s, 0, 0, TAU); ctx.fill(); }
    ctx.save(); ctx.translate(sx + jig, sy); ctx.scale(s, s);
    ctx.fillStyle = INK; for (const [x, y, r] of p.puffs) { ctx.beginPath(); ctx.arc(x + sway * (1 - y / 10) * 0.3, y - 10, r + 1.8, 0, TAU); ctx.fill(); }
    for (const [col, dy, rm] of [['#365e2c', 0, 1], ['#4a7a38', -1.6, 0.8], ['#62944a', -3.2, 0.55]]) {
      ctx.fillStyle = col; for (const [x, y, r] of p.puffs) { ctx.beginPath(); ctx.arc(x + sway * (1 - y / 10) * 0.3 - (1 - rm) * 2, y - 10 + dy, r * rm, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }
  // area 2: a heap of fallen maple and ginkgo leaves; leaves fly up when something bursts out of it
  drawLeafPile(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y), s = p.s || 1, k = p.rustleT != null ? clamp(1 - (t - p.rustleT) / 0.8, 0, 1) : 0;
    const cols = ['#a8401c', '#d2642a', '#e89a3a', '#8a5a2a'];
    ctx.save(); ctx.translate(sx, sy); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(90,40,14,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, 30, 12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a3a1a'; ctx.beginPath(); ctx.ellipse(0, -4, 24, 9, 0, Math.PI, TAU); ctx.ellipse(0, -4, 24, 5, 0, 0, Math.PI); ctx.fill();
    for (const [u, v, a, c] of p.leaves) {
      const x = u * 24, y = v * 8 - 5 - (1 - Math.abs(u)) * 5 - (1 - Math.abs(v)) * 2, lift = k * (6 + Math.abs(u) * 8);
      ctx.save(); ctx.translate(x + u * lift, y - lift); ctx.rotate(a + k * 3);
      ctx.fillStyle = cols[c]; ctx.beginPath(); ctx.ellipse(0, 0, 4.2, 2.2, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(60,24,8,0.6)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-3.4, 0); ctx.lineTo(3.4, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  // cherry blossom: little five-petal flowers scattered over the canopy (pale, with a pink heart)
  drawBlossoms(ctx, p, cx, cy, sway, t) {
    if (!p.flowers) { // place them once per tree
      const f = []; let s = (p.seed || 1) * 9301 + 49297;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (const bl of p.blobs) { if (bl[3] === 3 && bl[2] < 10) continue; const n = Math.round(bl[2] / 5); for (let i = 0; i < n; i++) { const a = rnd() * TAU, d = rnd() * bl[2] * 0.85; f.push([bl[0] + Math.cos(a) * d, bl[1] + Math.sin(a) * d * 0.85, bl, 1.3 + rnd() * 0.9, rnd() < 0.3]); } }
      p.flowers = f;
    }
    const petals = new Path2D(), pale = new Path2D(), hearts = new Path2D();
    for (const [fx, fy, bl, s, deep] of p.flowers) {
      const s3 = sway * (1 + bl[1] * -0.02) + Math.sin(t * 2 + bl[0]) * 0.8;
      const x = cx + fx + s3 - bl[3] * 0.8, y = cy + fy - bl[3] * 1.2;
      const P2 = deep ? petals : pale;
      for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU - Math.PI / 2, px = x + Math.cos(a) * s, py = y + Math.sin(a) * s; P2.moveTo(px + s * 0.75, py); P2.arc(px, py, s * 0.75, 0, TAU); }
      hearts.moveTo(x + s * 0.45, y); hearts.arc(x, y, s * 0.45, 0, TAU);
    }
    ctx.fillStyle = '#fff3f6'; ctx.fill(pale);
    ctx.fillStyle = '#ffd0de'; ctx.fill(petals);
    ctx.fillStyle = '#d8506e'; ctx.fill(hearts);
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

  // a square stone block in iso view: half-size a (tiles), from height z0 up by h (px); lit from the upper left
  isoBlock(ctx, sx, sy, a, z0, h, col) {
    const X = a * 32, Y = a * 16, b = sy - z0;
    const L = [sx - X, b], F = [sx, b + Y], R = [sx + X, b], Bk = [sx, b - Y];
    const quad = (pts, fill) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
    quad([L, F, [F[0], F[1] - h], [L[0], L[1] - h]], shade(col, -0.08));
    quad([F, R, [R[0], R[1] - h], [F[0], F[1] - h]], shade(col, -0.22));
    quad([[L[0], L[1] - h], [F[0], F[1] - h], [R[0], R[1] - h], [Bk[0], Bk[1] - h]], shade(col, 0.1));
  }
  // stone lantern (tōrō): base, post, platform, a lit firebox with windows on both visible sides, a hipped roof and a jewel
  drawLantern(ctx, p, t) {
    const [sx, sy] = P(p.x, p.y);
    const stone = this.bi === 2 ? '#8a8e9c' : '#9c978a';
    ctx.fillStyle = 'rgba(20,25,35,0.24)'; ctx.beginPath(); ctx.ellipse(sx + 4, sy + 1, 17, 7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
    this.isoBlock(ctx, sx, sy, 0.3, 0, 5, shade(stone, -0.06));   // base
    this.isoBlock(ctx, sx, sy, 0.21, 5, 3, stone);                 // step
    this.isoBlock(ctx, sx, sy, 0.085, 8, 15, stone);               // post
    this.isoBlock(ctx, sx, sy, 0.23, 23, 4, stone);                // platform
    this.isoBlock(ctx, sx, sy, 0.16, 27, 11, stone);               // firebox
    const fl = 0.75 + Math.sin(t * 11 + p.seed) * 0.12 + Math.sin(t * 27 + p.seed) * 0.08;
    const lit = this.biome.night || this.bi === 1 ? `rgba(255,200,110,${fl})` : 'rgba(60,46,36,0.85)';
    const X = 0.16 * 32, Y = 0.16 * 16, b = sy - 27;
    ctx.fillStyle = lit; // a window in each visible face
    ctx.beginPath(); ctx.moveTo(sx - X * 0.65, b + Y * 0.35 - 2); ctx.lineTo(sx - X * 0.2, b + Y * 0.8 - 2); ctx.lineTo(sx - X * 0.2, b + Y * 0.8 - 9); ctx.lineTo(sx - X * 0.65, b + Y * 0.35 - 9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + X * 0.2, b + Y * 0.8 - 2); ctx.lineTo(sx + X * 0.65, b + Y * 0.35 - 2); ctx.lineTo(sx + X * 0.65, b + Y * 0.35 - 9); ctx.lineTo(sx + X * 0.2, b + Y * 0.8 - 9); ctx.closePath(); ctx.fill();
    // hipped roof: two visible slopes rising to a point, with upturned eaves
    const rX = 0.34 * 32, rY = 0.34 * 16, rb = sy - 38, peak = [sx, rb - 13];
    const L = [sx - rX, rb], F = [sx, rb + rY], R = [sx + rX, rb];
    ctx.beginPath(); ctx.moveTo(L[0] - 2, L[1] - 2); ctx.lineTo(F[0], F[1]); ctx.lineTo(peak[0], peak[1]); ctx.closePath(); ctx.fillStyle = shade(stone, -0.02); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(F[0], F[1]); ctx.lineTo(R[0] + 2, R[1] - 2); ctx.lineTo(peak[0], peak[1]); ctx.closePath(); ctx.fillStyle = shade(stone, -0.2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = shade(stone, -0.05); ctx.beginPath(); ctx.arc(peak[0], peak[1] - 2, 3, 0, TAU); ctx.fill(); ctx.stroke(); // hōju jewel
    if (this.bi === 2) { ctx.fillStyle = 'rgba(245,248,255,0.95)'; ctx.beginPath(); ctx.moveTo(L[0] + 3, L[1] - 3); ctx.lineTo(peak[0], peak[1] + 1); ctx.lineTo(R[0] - 3, R[1] - 3); ctx.quadraticCurveTo(sx, rb - 2, L[0] + 3, L[1] - 3); ctx.fill(); }
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
    // gable roof: the ridge runs between the posts; the front slope faces us, the back slope peeks over it
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sx - 22, sy - 54); ctx.lineTo(sx + 22, sy - 54); ctx.lineTo(sx + 26, sy - 60); ctx.lineTo(sx - 18, sy - 60); ctx.closePath(); ctx.fillStyle = '#4a3226'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 22, sy - 54); ctx.lineTo(sx + 22, sy - 54); ctx.lineTo(sx + 28, sy - 40); ctx.lineTo(sx - 28, sy - 40); ctx.closePath(); ctx.fillStyle = '#6a4a34'; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,20,14,0.45)'; ctx.lineWidth = 1; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(sx + k * 9, sy - 54); ctx.lineTo(sx + k * 11, sy - 40); ctx.stroke(); }
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx - 23, sy - 54.5); ctx.lineTo(sx + 23, sy - 54.5); ctx.stroke(); // ridge beam
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
    if (p.style === 'dojo') return this.drawDojoPillar(ctx, p);
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
    if (p.style === 'dojo') return this.drawDojoScreen(ctx, p);
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
    if (p.style === 'dojo') return this.drawDojoDoor(ctx, p);
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

  // ---------- special arena props ----------
  // a hip roof over (ex0..ex1, ey0..ey1): eaves at height z, ridge at rz along the long side; eaves turn up at the corners
  hipRoof(ctx, ex0, ey0, ex1, ey1, z, rz, col, snow = false) {
    const along = ex1 - ex0 >= ey1 - ey0, mx = (ex0 + ex1) / 2, my = (ey0 + ey1) / 2;
    const inset = Math.min(ex1 - ex0, ey1 - ey0) / 2;
    const rA = along ? [ex0 + inset, my] : [mx, ey0 + inset], rB = along ? [ex1 - inset, my] : [mx, ey1 - inset];
    const c00 = P(ex0, ey0, z), c10 = P(ex1, ey0, z), c01 = P(ex0, ey1, z), c11 = P(ex1, ey1, z), A = P(rA[0], rA[1], rz), B = P(rB[0], rB[1], rz);
    const faces = along
      ? { back: [c00, c10, B, A], left: [c00, c01, A], right: [c10, c11, B], front: [c01, c11, B, A] }
      : { back: [c00, c10, A], left: [c00, c01, B, A], right: [c10, c11, B, A], front: [c01, c11, B] };
    poly(ctx, faces.back, shade(col, -0.35), INK, 1.4);
    poly(ctx, faces.left, shade(col, -0.3), INK, 1.4);
    poly(ctx, faces.right, shade(col, -0.16), INK, 1.6);
    poly(ctx, faces.front, col, INK, 1.8);
    // tile rows on the two faces we look at
    ctx.strokeStyle = 'rgba(10,10,20,0.3)'; ctx.lineWidth = 1.2;
    for (const f of [faces.front, faces.right]) {
      const e0 = f[0], e1 = f[1], t0 = f.length === 4 ? f[3] : f[2], t1 = f[2];
      for (let k = 1; k < 6; k++) { const u = k / 6; ctx.beginPath(); ctx.moveTo(lerp(e0[0], t0[0], u), lerp(e0[1], t0[1], u)); ctx.lineTo(lerp(e1[0], t1[0], u), lerp(e1[1], t1[1], u)); ctx.stroke(); }
    }
    if (snow) { // snow over the upper part of the slopes
      ctx.fillStyle = 'rgba(240,245,255,0.92)';
      for (const f of [faces.front, faces.right]) {
        const top = f.length === 4 ? [f[3], f[2]] : [f[2], f[2]], lo = (q, a) => [lerp(top[q][0], f[q][0], a), lerp(top[q][1], f[q][1], a)];
        ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); ctx.lineTo(top[1][0], top[1][1]); const b1 = lo(1, 0.4), b0 = lo(0, 0.4); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(b0[0], b0[1]); ctx.closePath(); ctx.fill();
      }
    }
    // upturned eave tips and the ridge cap
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const [c, dx] of [[c01, -1], [c11, 0], [c10, 1]]) { ctx.beginPath(); ctx.moveTo(c[0] - dx * 10, c[1] + 3); ctx.quadraticCurveTo(c[0] + dx * 2, c[1] + 2, c[0] + dx * 7, c[1] - 9); ctx.stroke(); }
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(A[0], A[1] - 1); ctx.lineTo(B[0], B[1] - 1); ctx.stroke();
    for (const e of [A, B]) { ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(e[0], e[1] - 5, 4, 6, 0, 0, TAU); ctx.fill(); }
    return { A, B };
  }

  // the temple hall: stone platform, white walls between vermilion pillars, lattice doors, a two-tier roof
  drawTemple(ctx, p, t) {
    const { x0, y0, x1, y1 } = p, b = this.bi, mx = (x0 + x1) / 2;
    const plat = 0.32, ins = 0.45, wx0 = x0 + ins, wy0 = y0 + ins, wx1 = x1 - ins, wy1 = y1 - ins, Hw = plat + 1.5;
    const line = (a, c) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); };
    ctx.fillStyle = 'rgba(20,20,40,0.22)'; poly(ctx, [P(x0 - 0.4, y0), P(x1 + 1.4, y0), P(x1 + 1.6, y1 + 0.8), P(x0, y1 + 0.6)], ctx.fillStyle, null);
    // the stone platform
    const stone = b === 2 ? '#a8adb9' : b === 3 ? '#77727c' : '#a89f92';
    poly(ctx, [P(x0, y0, plat), P(x1, y0, plat), P(x1, y1, plat), P(x0, y1, plat)], shade(stone, 0.12), INK, 1.4);
    poly(ctx, [P(x0, y1), P(x1, y1), P(x1, y1, plat), P(x0, y1, plat)], stone, INK, 1.4);
    poly(ctx, [P(x1, y1), P(x1, y0), P(x1, y0, plat), P(x1, y1, plat)], shade(stone, -0.2), INK, 1.4);
    ctx.strokeStyle = 'rgba(40,36,40,0.35)'; ctx.lineWidth = 1;
    for (let x = x0 + 1; x < x1; x += 1) line(P(x, y1), P(x, y1, plat));
    for (let y = y0 + 1; y < y1; y += 1) line(P(x1, y), P(x1, y, plat));
    // walls
    const plaster = b === 3 ? '#d8d2c6' : '#f0e8d6', red = b === 3 ? '#6a1420' : '#b3392a', wood = '#3a2218';
    poly(ctx, [P(wx0, wy1, plat), P(wx1, wy1, plat), P(wx1, wy1, Hw), P(wx0, wy1, Hw)], plaster, INK, 1.6);
    poly(ctx, [P(wx1, wy1, plat), P(wx1, wy0, plat), P(wx1, wy0, Hw), P(wx1, wy1, Hw)], shade(plaster, -0.16), INK, 1.6);
    // lattice windows on the side wall
    for (const f of [0.28, 0.72]) {
      const yy = lerp(wy1, wy0, f);
      poly(ctx, [P(wx1, yy + 0.45, plat + 0.55), P(wx1, yy - 0.45, plat + 0.55), P(wx1, yy - 0.45, plat + 1.15), P(wx1, yy + 0.45, plat + 1.15)], '#4a3020', INK, 1.2);
      ctx.strokeStyle = 'rgba(240,220,170,0.6)'; ctx.lineWidth = 1;
      for (let k = 1; k < 4; k++) line(P(wx1, yy + 0.45 - k * 0.225, plat + 0.55), P(wx1, yy + 0.45 - k * 0.225, plat + 1.15));
      for (let k = 1; k < 3; k++) line(P(wx1, yy + 0.45, plat + 0.55 + k * 0.2), P(wx1, yy - 0.45, plat + 0.55 + k * 0.2));
    }
    // the lattice doors (slide open when the monk steps out)
    const dT = p.doorT || 0, open = dT <= 0 ? 0 : dT > 1.9 ? (2.2 - dT) / 0.3 : dT < 0.4 ? dT / 0.4 : 1;
    poly(ctx, [P(mx - 0.9, wy1, plat), P(mx + 0.9, wy1, plat), P(mx + 0.9, wy1, plat + 1.25), P(mx - 0.9, wy1, plat + 1.25)], open > 0 ? '#1a0e08' : '#4a2a18', INK, 1.4);
    if (open > 0) { const [gx, gy] = P(mx, wy1, plat + 0.6); const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, 46); gl.addColorStop(0, `rgba(255,200,120,${0.5 * open})`); gl.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(gx, gy, 46, 0, TAU); ctx.fill(); }
    for (const side of [-1, 1]) {
      const off = side * open * 0.85, a0 = side < 0 ? mx - 0.9 : mx, a1 = side < 0 ? mx : mx + 0.9;
      const q = [P(a0 + off, wy1, plat), P(a1 + off, wy1, plat), P(a1 + off, wy1, plat + 1.25), P(a0 + off, wy1, plat + 1.25)];
      poly(ctx, q, '#6a3a22', INK, 1.4);
      ctx.strokeStyle = 'rgba(240,210,150,0.55)'; ctx.lineWidth = 1;
      for (let k = 1; k < 5; k++) line(P(lerp(a0, a1, k / 5) + off, wy1, plat + 0.1), P(lerp(a0, a1, k / 5) + off, wy1, plat + 1.15));
      for (let k = 1; k < 6; k++) line(P(a0 + off, wy1, plat + k * 0.2), P(a1 + off, wy1, plat + k * 0.2));
    }
    // vermilion pillars and beams
    ctx.strokeStyle = red; ctx.lineWidth = 5;
    for (let x = wx0; x <= wx1 + 0.01; x += (wx1 - wx0) / 4) line(P(x, wy1, plat), P(x, wy1, Hw));
    for (let y = wy0; y <= wy1 + 0.01; y += (wy1 - wy0) / 3) line(P(wx1, y, plat), P(wx1, y, Hw));
    ctx.lineWidth = 4; line(P(wx0, wy1, Hw - 0.08), P(wx1, wy1, Hw - 0.08)); line(P(wx1, wy1, Hw - 0.08), P(wx1, wy0, Hw - 0.08));
    ctx.strokeStyle = wood; ctx.lineWidth = 2; line(P(wx0, wy1, plat + 0.08), P(wx1, wy1, plat + 0.08)); line(P(wx1, wy1, plat + 0.08), P(wx1, wy0, plat + 0.08));
    // lower roof skirt, upper body, upper roof
    const roof = b === 3 ? '#26242e' : b === 2 ? '#3d455c' : b === 1 ? '#4a3c3a' : '#3c4252', snow = b === 2;
    const o = 0.75, He = Hw, ux0 = wx0 + 1.1, uy0 = wy0 + 0.9, ux1 = wx1 - 1.1, uy1 = wy1 - 0.9, Hs = He + 0.7;
    poly(ctx, [P(wx1 + o, wy1 + o, He), P(wx1 + o, wy0 - o, He), P(ux1, uy0, Hs), P(ux1, uy1, Hs)], shade(roof, -0.16), INK, 1.6);
    poly(ctx, [P(wx0 - o, wy1 + o, He), P(wx1 + o, wy1 + o, He), P(ux1, uy1, Hs), P(ux0, uy1, Hs)], roof, INK, 1.8);
    ctx.strokeStyle = 'rgba(10,10,20,0.3)'; ctx.lineWidth = 1.2;
    for (let k = 1; k < 4; k++) { const u = k / 4; line(P(lerp(wx0 - o, ux0, u), lerp(wy1 + o, uy1, u), lerp(He, Hs, u)), P(lerp(wx1 + o, ux1, u), lerp(wy1 + o, uy1, u), lerp(He, Hs, u))); }
    if (snow) { ctx.fillStyle = 'rgba(240,245,255,0.85)'; poly(ctx, [P(lerp(wx0 - o, ux0, 0.5), lerp(wy1 + o, uy1, 0.5), lerp(He, Hs, 0.5)), P(lerp(wx1 + o, ux1, 0.5), lerp(wy1 + o, uy1, 0.5), lerp(He, Hs, 0.5)), P(ux1, uy1, Hs), P(ux0, uy1, Hs)], ctx.fillStyle, null); }
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const [c, dx] of [[P(wx0 - o, wy1 + o, He), -1], [P(wx1 + o, wy1 + o, He), 0], [P(wx1 + o, wy0 - o, He), 1]]) { ctx.beginPath(); ctx.moveTo(c[0] - dx * 10, c[1] + 3); ctx.quadraticCurveTo(c[0] + dx * 2, c[1] + 2, c[0] + dx * 7, c[1] - 9); ctx.stroke(); }
    const Hu = Hs + 0.75;
    poly(ctx, [P(ux0, uy1, Hs), P(ux1, uy1, Hs), P(ux1, uy1, Hu), P(ux0, uy1, Hu)], plaster, INK, 1.4);
    poly(ctx, [P(ux1, uy1, Hs), P(ux1, uy0, Hs), P(ux1, uy0, Hu), P(ux1, uy1, Hu)], shade(plaster, -0.16), INK, 1.4);
    ctx.strokeStyle = red; ctx.lineWidth = 4;
    for (let x = ux0; x <= ux1 + 0.01; x += (ux1 - ux0) / 2) line(P(x, uy1, Hs), P(x, uy1, Hu));
    for (let y = uy0; y <= uy1 + 0.01; y += (uy1 - uy0) / 2) line(P(ux1, y, Hs), P(ux1, y, Hu));
    const { A } = this.hipRoof(ctx, ux0 - 0.8, uy0 - 0.8, ux1 + 0.8, uy1 + 0.8, Hu, Hu + 1.25, roof, snow);
    // gold finial on the ridge, and the name plaque under the upper eave
    ctx.fillStyle = '#d8a838'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    const fx = (ux0 + ux1) / 2, fy = (uy0 + uy1) / 2, [px, py] = P(fx, fy, Hu + 1.25);
    ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.lineTo(px, py - 16); ctx.lineTo(px + 4, py); ctx.closePath(); ctx.fill(); ctx.stroke();
    void A;
    const [qx, qy] = P(mx, uy1, Hs + 0.38);
    ctx.fillStyle = '#2a1810'; ctx.fillRect(qx - 11, qy - 15, 22, 28); ctx.strokeStyle = '#d8a838'; ctx.lineWidth = 1.5; ctx.strokeRect(qx - 11, qy - 15, 22, 28);
    ctx.fillStyle = '#e8c060'; ctx.font = '800 16px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('寺', qx, qy);
  }

  // the imbuement shrine: stone platform, a red-pillared hokora with a curved roof, rope and paper streamers,
  // an offering box; when the fight is over, coloured element lights circle it and a marker bobs over the kneeling spot
  drawShrine(ctx, p, t) {
    const { x0, y0, x1, y1 } = p, S = this.shrine, b = this.bi, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const line = (a, c) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); };
    ctx.fillStyle = 'rgba(20,20,40,0.22)'; poly(ctx, [P(x0 - 0.2, y0), P(x1 + 0.7, y0), P(x1 + 0.9, y1 + 0.5), P(x0, y1 + 0.4)], ctx.fillStyle, null);
    const stone = b === 2 ? '#a8adb9' : b === 3 ? '#77727c' : '#a39a8e', ph = 0.4;
    poly(ctx, [P(x0, y0, ph), P(x1, y0, ph), P(x1, y1, ph), P(x0, y1, ph)], shade(stone, 0.12), INK, 1.3);
    poly(ctx, [P(x0, y1), P(x1, y1), P(x1, y1, ph), P(x0, y1, ph)], stone, INK, 1.3);
    poly(ctx, [P(x1, y1), P(x1, y0), P(x1, y0, ph), P(x1, y1, ph)], shade(stone, -0.2), INK, 1.3);
    // the hokora body
    const bx0 = cx - 0.6, bx1 = cx + 0.6, by0 = cy - 0.55, by1 = cy + 0.55, H = ph + 1.05, wood = '#6a3a22', red = b === 3 ? '#6a1420' : '#b3392a';
    poly(ctx, [P(bx0, by1, ph), P(bx1, by1, ph), P(bx1, by1, H), P(bx0, by1, H)], '#7a4a2c', INK, 1.4);
    poly(ctx, [P(bx1, by1, ph), P(bx1, by0, ph), P(bx1, by0, H), P(bx1, by1, H)], shade('#7a4a2c', -0.2), INK, 1.4);
    ctx.strokeStyle = red; ctx.lineWidth = 4; line(P(bx0, by1, ph), P(bx0, by1, H)); line(P(bx1, by1, ph), P(bx1, by1, H)); line(P(bx1, by0, ph), P(bx1, by0, H));
    // doors with a little mirror glinting inside
    poly(ctx, [P(cx - 0.32, by1, ph + 0.1), P(cx + 0.32, by1, ph + 0.1), P(cx + 0.32, by1, ph + 0.8), P(cx - 0.32, by1, ph + 0.8)], '#2a1810', INK, 1.1);
    const [mx, my] = P(cx, by1, ph + 0.48); ctx.fillStyle = S && S.ready ? '#fff4c8' : '#c8b480'; ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, TAU); ctx.fill();
    // a curved gable roof
    const rf = b === 3 ? '#26242e' : b === 2 ? '#3d455c' : '#4a3c3a', Hr = H + 0.75, o = 0.35;
    poly(ctx, [P(bx0 - o, by1 + o, H), P(bx1 + o, by1 + o, H), P(bx1 + o, cy, Hr), P(bx0 - o, cy, Hr)], rf, INK, 1.6);
    poly(ctx, [P(bx1 + o, by1 + o, H), P(bx1 + o, by0 - o, H), P(bx1 + o, cy, Hr)], shade(rf, -0.2), INK, 1.4);
    if (b === 2) { ctx.fillStyle = 'rgba(240,245,255,0.85)'; poly(ctx, [P(bx0 - o, cy + 0.4, lerp(Hr, H, 0.45)), P(bx1 + o, cy + 0.4, lerp(Hr, H, 0.45)), P(bx1 + o, cy, Hr), P(bx0 - o, cy, Hr)], ctx.fillStyle, null); }
    ctx.strokeStyle = INK; ctx.lineWidth = 4; line(P(bx0 - o, cy, Hr + 0.03), P(bx1 + o, cy, Hr + 0.03));
    for (const e of [P(bx0 - o, cy, Hr), P(bx1 + o, cy, Hr)]) { ctx.lineWidth = 2.4; line([e[0] - 6, e[1] - 10], [e[0] + 4, e[1] + 2]); line([e[0] + 6, e[1] - 10], [e[0] - 4, e[1] + 2]); } // chigi
    // the shimenawa rope with paper streamers across the front
    const r0 = P(bx0 - 0.1, by1 + 0.05, H - 0.08), r1 = P(bx1 + 0.1, by1 + 0.05, H - 0.08);
    ctx.strokeStyle = '#c8a868'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.quadraticCurveTo((r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2 + 9, r1[0], r1[1]); ctx.stroke();
    ctx.strokeStyle = '#f4efe4'; ctx.lineWidth = 2; for (const f of [0.3, 0.7]) { const sx = lerp(r0[0], r1[0], f), sy = lerp(r0[1], r1[1], f) + 6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 3, sy + 4); ctx.lineTo(sx - 2, sy + 8); ctx.lineTo(sx + 3, sy + 12); ctx.stroke(); }
    // the offering box in front
    const ob = [cx - 0.35, by1 + 0.15, cx + 0.35, by1 + 0.5];
    poly(ctx, [P(ob[0], ob[3], ph), P(ob[2], ob[3], ph), P(ob[2], ob[3], ph + 0.32), P(ob[0], ob[3], ph + 0.32)], '#5a3420', INK, 1.1);
    poly(ctx, [P(ob[0], ob[1], ph + 0.32), P(ob[2], ob[1], ph + 0.32), P(ob[2], ob[3], ph + 0.32), P(ob[0], ob[3], ph + 0.32)], '#7a4a2a', INK, 1.1);
    ctx.fillStyle = '#d8a838'; const [kx, ky] = P(cx, ob[3], ph + 0.18); ctx.font = '800 10px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('宿', kx, ky);
    // once the level is clear: element lights circling, and a marker over the kneeling spot
    if (S && S.ready && !S.taken) {
      const cols = ['255,120,60', '120,200,255', '255,236,110', '140,230,110', '200,160,255'];
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      cols.forEach((c, i) => {
        const a = t * 1.4 + (i / cols.length) * TAU, [ox, oy] = P(cx + Math.cos(a) * 1.4, cy + Math.sin(a) * 1.4, H + 0.4 + Math.sin(t * 2 + i) * 0.15);
        const gg = ctx.createRadialGradient(ox, oy, 0, ox, oy, 14); gg.addColorStop(0, `rgba(${c},0.9)`); gg.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(ox, oy, 14, 0, TAU); ctx.fill();
      });
      ctx.restore();
      const [dx, dy] = P(S.desk.x, S.desk.y, 1.6 + Math.sin(t * 3) * 0.12);
      ctx.fillStyle = '#ffd86a'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(dx - 8, dy - 8); ctx.lineTo(dx + 8, dy - 8); ctx.lineTo(dx, dy + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  // a stone kitsune guardian (fox) sitting on a plinth, facing the path
  drawKitsuneStatue(ctx, p) {
    const [sx, sy] = P(p.x, p.y), stone = this.bi === 2 ? '#b8bcc6' : '#8e8a82', d = p.side;
    ctx.fillStyle = 'rgba(20,20,40,0.22)'; ctx.beginPath(); ctx.ellipse(sx, sy, 14, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(stone, -0.15); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.fillRect(sx - 9, sy - 12, 18, 12); ctx.strokeRect(sx - 9, sy - 12, 18, 12);
    ctx.fillStyle = stone;
    ctx.beginPath(); ctx.ellipse(sx, sy - 22, 7, 10, 0, 0, TAU); ctx.fill(); ctx.stroke(); // body
    ctx.beginPath(); ctx.arc(sx + d * 2, sy - 34, 5, 0, TAU); ctx.fill(); ctx.stroke(); // head
    ctx.beginPath(); ctx.moveTo(sx + d * 2 - 4, sy - 37); ctx.lineTo(sx + d * 2 - 3, sy - 44); ctx.lineTo(sx + d * 2, sy - 38); ctx.moveTo(sx + d * 2 + 1, sy - 38); ctx.lineTo(sx + d * 2 + 4, sy - 44); ctx.lineTo(sx + d * 2 + 5, sy - 36); ctx.fill(); // ears
    ctx.beginPath(); ctx.moveTo(sx - d * 5, sy - 16); ctx.quadraticCurveTo(sx - d * 14, sy - 24, sx - d * 10, sy - 34); ctx.lineWidth = 4; ctx.strokeStyle = stone; ctx.stroke(); // tail
    ctx.fillStyle = '#b52a22'; ctx.beginPath(); ctx.moveTo(sx + d * 2 - 5, sy - 29); ctx.lineTo(sx + d * 2 + 5, sy - 29); ctx.lineTo(sx + d * 2, sy - 23); ctx.closePath(); ctx.fill(); // red bib
  }

  // a bronze incense burner on three legs
  drawKoro(ctx, p) {
    const [sx, sy] = P(p.x, p.y);
    ctx.fillStyle = 'rgba(20,20,30,0.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, 18, 7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    for (const d of [-9, 0, 9]) { ctx.beginPath(); ctx.moveTo(sx + d, sy + (d ? 0 : 3)); ctx.lineTo(sx + d * 0.8, sy - 12); ctx.stroke(); }
    const g = ctx.createLinearGradient(sx - 16, 0, sx + 16, 0); g.addColorStop(0, '#3a3a2a'); g.addColorStop(0.4, '#7a7048'); g.addColorStop(1, '#2a2a1e');
    ctx.fillStyle = g; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(sx - 16, sy - 26); ctx.quadraticCurveTo(sx - 17, sy - 8, sx, sy - 9); ctx.quadraticCurveTo(sx + 17, sy - 8, sx + 16, sy - 26); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5a5238'; ctx.beginPath(); ctx.ellipse(sx, sy - 26, 16, 5, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(160,150,130,0.9)'; ctx.beginPath(); ctx.ellipse(sx, sy - 26, 12, 3.4, 0, 0, TAU); ctx.fill(); // ash
    ctx.fillStyle = '#ff8a40'; for (const d of [-4, 1, 5]) ctx.fillRect(sx + d, sy - 33, 1.4, 7); // incense sticks
  }

  // one tile of the library's back wall: dark wood with shelves full of books and scrolls
  drawLibWall(ctx, p) {
    const H = 2.1, [a0, a1] = p.axis === 'x' ? [[p.x - 0.5, p.y], [p.x + 0.5, p.y]] : [[p.x, p.y - 0.5], [p.x, p.y + 0.5]];
    const m = (f, z) => P(lerp(a0[0], a1[0], f), lerp(a0[1], a1[1], f), z);
    poly(ctx, [m(0, 0), m(1, 0), m(1, H), m(0, H)], p.axis === 'x' ? '#4a3020' : '#3e281a', INK, 1.4);
    const cols = ['#8a2a22', '#2e4a6a', '#3e5a2e', '#c8a050', '#5a3a6a', '#d8cbb0', '#6a2a1a'];
    for (const [z0, z1] of [[0.12, 0.55], [0.62, 1.05], [1.12, 1.55], [1.62, 2.0]]) {
      let f = 0.06, k = Math.floor(p.seed * 7 + z0 * 13);
      while (f < 0.94) {
        const w = 0.06 + ((k * 37) % 5) * 0.012, hh = (z1 - z0) * (0.7 + ((k * 13) % 4) * 0.08);
        if ((k * 11) % 9 === 0) { // a stack of rolled scrolls lying down
          for (let s = 0; s < 3; s++) { const [cx, cy] = m(Math.min(0.94, f + 0.05), z0 + 0.06 + s * 0.11); ctx.fillStyle = '#efe4c8'; ctx.beginPath(); ctx.ellipse(cx, cy, 5, 2.6, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 1; ctx.stroke(); }
          f += 0.16;
        } else {
          poly(ctx, [m(f, z0), m(Math.min(0.94, f + w), z0), m(Math.min(0.94, f + w), z0 + hh), m(f, z0 + hh)], cols[k % cols.length], 'rgba(20,10,6,0.6)', 0.8);
          f += w + 0.008;
        }
        k++;
      }
      ctx.strokeStyle = '#2a1810'; ctx.lineWidth = 2.5; ctx.beginPath(); const s0 = m(0, z0), s1 = m(1, z0); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke(); // the shelf board
    }
    ctx.strokeStyle = '#2a1810'; ctx.lineWidth = 3; const t0 = m(0, H), t1 = m(1, H); ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke();
  }

  drawLibPillar(ctx, p) {
    const [sx, sy] = P(p.x, p.y), Hh = 2.1 * 32, w = 6;
    ctx.fillStyle = 'rgba(20,10,6,0.3)'; ctx.beginPath(); ctx.ellipse(sx + 4, sy + 1, 11, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a8478'; ctx.fillRect(sx - w - 2, sy - 6, (w + 2) * 2, 6); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.strokeRect(sx - w - 2, sy - 6, (w + 2) * 2, 6); // stone footing
    const g = ctx.createLinearGradient(sx - w, 0, sx + w, 0); g.addColorStop(0, '#3a2414'); g.addColorStop(0.4, '#7a5232'); g.addColorStop(1, '#2a180e');
    ctx.fillStyle = g; ctx.fillRect(sx - w, sy - Hh, w * 2, Hh - 6); ctx.strokeRect(sx - w, sy - Hh, w * 2, Hh - 6);
  }

  // a freestanding bookcase
  drawShelf(ctx, p) {
    const H = 1.6, hx = p.axis === 'x' ? p.len / 2 : 0.25, hy = p.axis === 'x' ? 0.25 : p.len / 2;
    const x0 = p.x - hx, x1 = p.x + hx, y0 = p.y - hy, y1 = p.y + hy;
    ctx.fillStyle = 'rgba(20,10,6,0.25)'; poly(ctx, [P(x0, y1), P(x1, y1), P(x1 + 0.4, y1 + 0.3), P(x0 + 0.3, y1 + 0.35)], ctx.fillStyle, null);
    poly(ctx, [P(x0, y0, H), P(x1, y0, H), P(x1, y1, H), P(x0, y1, H)], '#5a3a24', INK, 1.3);
    const face = p.axis === 'x' ? [P(x0, y1), P(x1, y1), P(x1, y1, H), P(x0, y1, H)] : [P(x1, y1), P(x1, y0), P(x1, y0, H), P(x1, y1, H)];
    const side = p.axis === 'x' ? [P(x1, y1), P(x1, y0), P(x1, y0, H), P(x1, y1, H)] : [P(x0, y1), P(x1, y1), P(x1, y1, H), P(x0, y1, H)];
    poly(ctx, side, '#3a2416', INK, 1.3);
    poly(ctx, face, '#4a3020', INK, 1.4);
    const cols = ['#8a2a22', '#2e4a6a', '#3e5a2e', '#c8a050', '#5a3a6a', '#d8cbb0'];
    const L = p.axis === 'x' ? (f, z) => P(lerp(x0, x1, f), y1, z) : (f, z) => P(x1, lerp(y1, y0, f), z);
    let k = Math.floor(p.seed);
    for (const z0 of [0.1, 0.6, 1.1]) {
      for (let f = 0.05; f < 0.93; f += 0.075) { const hh = 0.32 + ((k * 7) % 4) * 0.03; poly(ctx, [L(f, z0), L(f + 0.065, z0), L(f + 0.065, z0 + hh), L(f, z0 + hh)], cols[k++ % cols.length], 'rgba(20,10,6,0.6)', 0.8); }
      ctx.strokeStyle = '#2a1810'; ctx.lineWidth = 2; const a = L(0, z0), c = L(1, z0); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    }
  }

  // the library desk; the scroll on it glows once the fighting is over, and is gone once taken
  drawDesk(ctx, p, t) {
    const Lb = this.library, H = 0.5, x0 = p.x - 0.65, x1 = p.x + 0.65, y0 = p.y - 0.32, y1 = p.y + 0.32;
    ctx.fillStyle = 'rgba(20,10,6,0.25)'; ctx.beginPath(); ctx.ellipse(...P(p.x + 0.15, p.y + 0.15), 46, 16, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    for (const [lx, ly] of [[x0 + 0.08, y1 - 0.05], [x1 - 0.08, y1 - 0.05], [x1 - 0.08, y0 + 0.05]]) { const a = P(lx, ly), c = P(lx, ly, H); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); }
    poly(ctx, [P(x0, y1, H - 0.08), P(x1, y1, H - 0.08), P(x1, y1, H), P(x0, y1, H)], '#3a2010', INK, 1.2);
    poly(ctx, [P(x1, y1, H - 0.08), P(x1, y0, H - 0.08), P(x1, y0, H), P(x1, y1, H)], '#2a1608', INK, 1.2);
    poly(ctx, [P(x0, y0, H), P(x1, y0, H), P(x1, y1, H), P(x0, y1, H)], '#6a4024', INK, 1.4);
    // an inkstone and a brush
    const [ix, iy] = P(x0 + 0.3, p.y, H); ctx.fillStyle = '#1a1a20'; ctx.fillRect(ix - 7, iy - 4, 14, 7);
    ctx.strokeStyle = '#c8a878'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ix + 9, iy - 2); ctx.lineTo(ix + 22, iy - 7); ctx.stroke();
    if (Lb && !Lb.taken) {
      const [sx, sy] = P(p.x + 0.2, p.y, H + 0.1);
      if (Lb.ready) { // glow, and a bobbing marker above
        const pulse = 0.6 + 0.4 * Math.sin(t * 4);
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 50); g.addColorStop(0, `rgba(255,220,130,${0.55 * pulse})`); g.addColorStop(1, 'rgba(255,220,130,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 50, 0, TAU); ctx.fill();
        const by = sy - 46 + Math.sin(t * 3) * 5;
        ctx.fillStyle = '#ffd86a'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx - 8, by - 8); ctx.lineTo(sx + 8, by - 8); ctx.lineTo(sx, by + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // the rolled scroll: paper, wooden ends, a red cord
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.46);
      ctx.fillStyle = '#f2e6c4'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.fillRect(-15, -4, 30, 8); ctx.strokeRect(-15, -4, 30, 8);
      ctx.fillStyle = '#5a3418'; ctx.fillRect(-18, -5, 3, 10); ctx.fillRect(15, -5, 3, 10);
      ctx.fillStyle = '#b52a22'; ctx.fillRect(-2, -4.5, 3, 9);
      ctx.restore();
    }
  }

  // the library's roof with its front beams and name board; fades when someone is inside (see Game.draw)
  drawLibRoof(ctx, p) {
    const { x0, y0, x1, y1 } = p, H = 2.1, b = this.bi;
    const line = (a, c) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); };
    ctx.strokeStyle = '#3a2214'; ctx.lineWidth = 6; line(P(x0, y1, H - 0.1), P(x1, y1, H - 0.1)); line(P(x1, y1, H - 0.1), P(x1, y0, H - 0.1));
    ctx.strokeStyle = INK; ctx.lineWidth = 1; line(P(x0, y1, H - 0.2), P(x1, y1, H - 0.2));
    const roof = b === 3 ? '#26242e' : b === 2 ? '#3d455c' : b === 1 ? '#4e3e3a' : '#44485a';
    this.hipRoof(ctx, x0 - 0.6, y0 - 0.6, x1 + 0.6, y1 + 0.6, H, H + 1.5, roof, b === 2);
    const [qx, qy] = P((x0 + x1) / 2, y1 + 0.6, H + 0.32);
    ctx.fillStyle = '#2a1810'; ctx.fillRect(qx - 24, qy - 11, 48, 20); ctx.strokeStyle = '#d8a838'; ctx.lineWidth = 1.5; ctx.strokeRect(qx - 24, qy - 11, 48, 20);
    ctx.fillStyle = '#f0d070'; ctx.font = '800 14px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('書 庫', qx, qy);
  }

  // training hall: a rack of wooden swords and staffs against the wall
  drawRack(ctx, p) {
    const [a0, a1] = p.axis === 'x' ? [[p.x - 0.7, p.y], [p.x + 0.7, p.y]] : [[p.x, p.y - 0.7], [p.x, p.y + 0.7]];
    const m = (f, z) => P(lerp(a0[0], a1[0], f), lerp(a0[1], a1[1], f), z);
    ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) { // the weapons leaning in the rack
      const f = 0.12 + k * 0.15, top = k % 3 === 2 ? 1.9 : 1.45, b0 = m(f, 0.05), t0 = m(f + 0.03, top);
      ctx.strokeStyle = INK; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(t0[0], t0[1]); ctx.stroke();
      ctx.strokeStyle = k % 3 === 2 ? '#a07a48' : '#c8a46c'; ctx.lineWidth = 2.6; ctx.stroke();
      if (k % 3 !== 2) { const g0 = m(f + 0.01, 0.4); ctx.fillStyle = '#2a1810'; ctx.beginPath(); ctx.ellipse(g0[0], g0[1], 4, 1.6, 0, 0, TAU); ctx.fill(); }
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 4;
    for (const f of [0, 1]) { const a = m(f, 0), c = m(f, 1.2); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); }
    for (const z of [0.35, 1.1]) { const a = m(0, z), c = m(1, z); ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2.4; ctx.stroke(); }
  }

  // a big taiko drum on its stand
  // A nagado-daiko lying on its side in a low wooden cradle, drawn in 3D: the bulging lacquered barrel is built
  // from slices back to front, the front head (always the one facing the room/camera) carries a cream skin
  // with a mitsudomoe, and a row of brass tacks holds the skin. p.axis = the world axis the drum lies along.
  drawTaiko(ctx, p) {
    const R = 0.6, L = 0.95, zc = R + 0.4;
    // (a = along the drum's axis, l = sideways (+ is toward the camera), z = height)
    const W = p.axis === 'y' ? (a, l, z) => P(p.x + l, p.y + a, z) : (a, l, z) => P(p.x + a, p.y + l, z);
    const bulge = (a) => R * (1 + 0.1 * (1 - (2 * a / L) ** 2));
    const ring = (a, rad, n = 28) => { const pts = []; for (let i = 0; i < n; i++) { const th = (i / n) * TAU; pts.push(W(a, rad * Math.cos(th), zc + rad * Math.sin(th))); } return pts; };
    const fillPts = (pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); };
    const line = (a, b, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
    const beam = (a, b) => { line(a, b, 5.5, INK); line(a, b, 3, '#5a3a22'); };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // shadow
    { const [sx, sy] = P(p.x, p.y); ctx.fillStyle = 'rgba(20,10,6,0.32)'; ctx.beginPath(); ctx.ellipse(sx, sy + 2, 40, 17, 0, 0, TAU); ctx.fill(); }
    // the cradle: two runners on the floor and a pair of slanted legs at each end hugging the barrel
    const legs = (side) => {
      line(W(-0.48, side * 0.62, 0.05), W(0.48, side * 0.62, 0.05), 6, INK); line(W(-0.48, side * 0.62, 0.05), W(0.48, side * 0.62, 0.05), 3.5, '#6a4428');
      for (const a of [-0.3, 0.3]) beam(W(a, side * 0.62, 0.06), W(a, side * 0.38, zc - R * 0.78));
    };
    legs(-1);
    for (const a of [-0.3, 0.3]) beam(W(a, -0.62, 0.12), W(a, 0.62, 0.12)); // cross pieces
    // the barrel: an ink outline pass, then shaded lacquer slices from the back to the front
    const S = 16, A = (i) => -L / 2 + (i / S) * L;
    ctx.fillStyle = INK; for (let i = 0; i <= S; i++) fillPts(ring(A(i), bulge(A(i)) + 0.05));
    for (let i = 0; i <= S; i++) {
      const a = A(i), rad = bulge(a), top = W(a, 0, zc + rad), bot = W(a, 0, zc - rad);
      const gr = ctx.createLinearGradient(top[0], top[1], bot[0], bot[1]);
      gr.addColorStop(0, '#c86a3c'); gr.addColorStop(0.3, '#9a3e22'); gr.addColorStop(0.75, '#6a2414'); gr.addColorStop(1, '#3a120a');
      ctx.fillStyle = gr; fillPts(ring(a, rad));
    }
    // the staves and a lacquer sheen along the top (only the side that faces us)
    const seen = (th) => Math.cos(th) + 1.3 * Math.sin(th) > 0.1;
    const along = (th, k = 1, a0 = -L / 2 + 0.02, a1 = L / 2 - 0.02) => { const pts = []; for (let i = 0; i <= 10; i++) { const a = a0 + (a1 - a0) * (i / 10), rad = bulge(a) * k; pts.push(W(a, rad * Math.cos(th), zc + rad * Math.sin(th))); } return pts; };
    const poly2 = (pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke(); };
    ctx.strokeStyle = 'rgba(30,8,4,0.45)'; ctx.lineWidth = 1;
    for (let k = 0; k < 18; k++) { const th = (k / 18) * TAU + 0.1; if (seen(th)) poly2(along(th)); }
    ctx.strokeStyle = 'rgba(255,214,170,0.35)'; ctx.lineWidth = 3.5; poly2(along(1.75, 1, -L / 2 + 0.12, L / 2 - 0.12));
    ctx.strokeStyle = 'rgba(255,236,210,0.55)'; ctx.lineWidth = 1.4; poly2(along(1.7, 1, -L / 2 + 0.16, L / 2 - 0.16));
    // a brass carrying ring (kan) on the near side
    { const c = W(0, bulge(0) * 0.98, zc + 0.05);
      ctx.fillStyle = '#2a1a10'; ctx.beginPath(); ctx.ellipse(c[0], c[1] - 3, 4.5, 3.5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.ellipse(c[0], c[1] + 4, 5.5, 7, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#e0b048'; ctx.lineWidth = 1.8; ctx.stroke(); }
    // two rows of brass tacks just behind the front head
    for (const [a, n, s] of [[L / 2 - 0.05, 30, 1.7], [L / 2 - 0.12, 30, 1.3]]) {
      for (let k = 0; k < n; k++) {
        const th = (k / n) * TAU + (a < L / 2 - 0.08 ? Math.PI / n : 0); if (!seen(th)) continue;
        const rad = bulge(a), q = W(a, rad * Math.cos(th), zc + rad * Math.sin(th));
        ctx.fillStyle = '#3a2410'; ctx.beginPath(); ctx.arc(q[0], q[1] + 0.5, s + 0.6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e8c060'; ctx.beginPath(); ctx.arc(q[0], q[1], s, 0, TAU); ctx.fill();
      }
    }
    // the front head, drawn in its own plane (unit circle = the rim; +y is up)
    {
      const O = W(L / 2, 0, zc), U = W(L / 2, 1, zc), V = W(L / 2, 0, zc + 1);
      ctx.save(); ctx.transform((U[0] - O[0]) * R, (U[1] - O[1]) * R, (V[0] - O[0]) * R, (V[1] - O[1]) * R, O[0], O[1]);
      const lw = 1 / (R * 26);
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0, 0, 1.04, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a2010'; ctx.beginPath(); ctx.arc(0, 0, 1.0, 0, TAU); ctx.fill(); // the barrel's lip
      const sk = ctx.createRadialGradient(-0.3, 0.35, 0.1, 0, 0, 0.95);
      sk.addColorStop(0, '#f8eed2'); sk.addColorStop(0.7, '#e6d6ae'); sk.addColorStop(1, '#c8b488');
      ctx.fillStyle = sk; ctx.beginPath(); ctx.arc(0, 0, 0.93, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,50,0.6)'; ctx.lineWidth = 1.2 * lw; ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, TAU); ctx.stroke(); // the worn ring where it is struck
      ctx.strokeStyle = INK; ctx.lineWidth = 1.6 * lw; ctx.beginPath(); ctx.arc(0, 0, 0.93, 0, TAU); ctx.stroke();
      // the mitsudomoe: three swirling commas
      ctx.fillStyle = '#1e1414';
      for (let k = 0; k < 3; k++) {
        const ph = (k / 3) * TAU + 0.4, hd = 0.2, hr = 0.11;
        ctx.beginPath(); ctx.arc(Math.cos(ph) * hd, Math.sin(ph) * hd, hr, 0, TAU); ctx.fill();
        ctx.beginPath();
        const out = [], inn = [];
        for (let i = 0; i <= 14; i++) { const s = i / 14, an = ph + s * 2.0, rc = hd + 0.17 * s, hw = hr * (1 - s) ** 1.2; out.push([Math.cos(an) * (rc + hw), Math.sin(an) * (rc + hw)]); inn.push([Math.cos(an) * (rc - hw), Math.sin(an) * (rc - hw)]); }
        [...out, ...inn.reverse()].forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(160,40,30,0.85)'; ctx.lineWidth = 2.2 * lw; ctx.beginPath(); ctx.arc(0, 0, 0.56, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // the near legs in front of the barrel, and two bachi resting on the near runner
    legs(1);
    for (const [a0, a1, o] of [[-0.42, 0.3, 0.86], [-0.34, 0.38, 0.97]]) {
      const b0 = W(a0, o, 0.06), b1 = W(a1, o + 0.05, 0.06);
      line(b0, b1, 4.5, INK); line(b0, b1, 2.4, '#d8b07a');
    }
    ctx.restore();
  }

  // the training hall's way out: a big wooden door in the back wall that slides open when the level is done
  drawExitDoor(ctx, p, t) {
    const H = 2.7, [a0, a1] = [[p.x - 0.5, p.y], [p.x + 0.5, p.y]], gl = this.gate.glow;
    const m = (f, z) => P(lerp(a0[0], a1[0], f), lerp(a0[1], a1[1], f), z);
    poly(ctx, [m(0, 0), m(1, 0), m(1, H), m(0, H)], gl > 0.05 ? `rgba(255,${200 + 30 * gl},${130 + 60 * gl},1)` : '#0e0804', '#1a0e06', 2);
    for (const side of [0, 1]) {
      const f0 = side ? 0.5 + gl * 0.44 : 0, f1 = side ? 1 : 0.5 - gl * 0.44;
      if (f1 - f0 < 0.02) continue;
      poly(ctx, [m(f0, 0.1), m(f1, 0.1), m(f1, 2.25), m(f0, 2.25)], '#7a5634', '#1a0e06', 1.6);
      ctx.strokeStyle = 'rgba(30,16,6,0.5)'; ctx.lineWidth = 1; for (const z of [0.7, 1.4]) { const a = m(f0, z), c = m(f1, z); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); }
    }
    poly(ctx, [m(0, 2.25), m(1, 2.25), m(1, H), m(0, H)], '#3a2414', '#1a0e06', 1.6);
    const [qx, qy] = m(0.5, 2.48); ctx.fillStyle = gl > 0.05 ? '#ffe0a0' : '#c8a878'; ctx.font = '800 13px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('出口', qx, qy);
    if (gl > 0.05) { const [gx, gy] = m(0.5, 1); const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 70); g.addColorStop(0, `rgba(255,220,150,${0.4 * gl})`); g.addColorStop(1, 'rgba(255,220,150,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, 70, 0, TAU); ctx.fill(); }
  }

  // training hall walls: shoji panels (white paper in a wooden lattice), a shrine shelf and a hanging scroll
  drawDojoScreen(ctx, p) {
    const H = 2.7, [a0, a1] = p.axis === 'x' ? [[p.x - 0.5, p.y], [p.x + 0.5, p.y]] : [[p.x, p.y - 0.5], [p.x, p.y + 0.5]];
    const m = (f, z) => P(lerp(a0[0], a1[0], f), lerp(a0[1], a1[1], f), z);
    const line = (a, c) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); };
    poly(ctx, [m(0, 0), m(1, 0), m(1, H), m(0, H)], p.axis === 'x' ? '#efe6d0' : '#e2d8c0', '#2a1a0e', 2);
    ctx.strokeStyle = 'rgba(70,46,26,0.75)'; ctx.lineWidth = 1.2;
    for (const f of [0.25, 0.5, 0.75]) line(m(f, 0.35), m(f, 2.2));
    for (let z = 0.35; z < 2.2; z += 0.37) line(m(0, z), m(1, z));
    poly(ctx, [m(0, 0), m(1, 0), m(1, 0.35), m(0, 0.35)], '#5a3a20', null); // wainscot
    poly(ctx, [m(0, 2.2), m(1, 2.2), m(1, H), m(0, H)], '#4a2e18', null); // lintel band
    ctx.strokeStyle = '#2a1a0e'; ctx.lineWidth = 3; line(m(0, 0), m(0, H));
    if (p.deco === 'shrine') { // kamidana: a little shrine on a shelf, with sakaki branches
      poly(ctx, [m(0.1, 1.7), m(0.9, 1.7), m(0.9, 1.78), m(0.1, 1.78)], '#c8a46c', INK, 1);
      poly(ctx, [m(0.3, 1.78), m(0.7, 1.78), m(0.7, 2.05), m(0.3, 2.05)], '#d8c09a', INK, 1);
      const r0 = m(0.22, 2.03), r1 = m(0.78, 2.03), rt = m(0.5, 2.22); ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(rt[0], rt[1]); ctx.lineTo(r1[0], r1[1]); ctx.closePath(); ctx.fill();
      for (const f of [0.15, 0.85]) { const s = m(f, 1.8); ctx.fillStyle = '#3e6a2e'; ctx.beginPath(); ctx.ellipse(s[0], s[1] - 6, 4, 8, 0, 0, TAU); ctx.fill(); }
      const s = m(0.5, 1.6); ctx.strokeStyle = '#efe6d0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s[0] - 12, s[1]); ctx.quadraticCurveTo(s[0], s[1] + 5, s[0] + 12, s[1]); ctx.stroke(); // a rope
    } else if (p.deco === 'scroll') { // kakejiku: 武 (martial way) in brush ink
      poly(ctx, [m(0.22, 0.6), m(0.78, 0.6), m(0.78, 2.15), m(0.22, 2.15)], '#f6eedc', INK, 1.2);
      poly(ctx, [m(0.22, 2.0), m(0.78, 2.0), m(0.78, 2.15), m(0.22, 2.15)], '#6a3a22', null);
      const c = m(0.5, 1.35); ctx.fillStyle = '#16100c'; ctx.font = '800 26px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('武', c[0], c[1]);
      const sl = m(0.5, 0.82); ctx.fillStyle = '#b52a22'; ctx.fillRect(sl[0] - 3, sl[1] - 3, 6, 6);
    }
  }
  drawDojoDoor(ctx, p) {
    const H = 2.7, [a0, a1] = p.axis === 'x' ? [[p.x - 0.5, p.y], [p.x + 0.5, p.y]] : [[p.x, p.y - 0.5], [p.x, p.y + 0.5]];
    const dT = p.doorT || 0, open = dT <= 0 ? 0 : dT > 1.3 ? (1.6 - dT) / 0.3 : dT < 0.35 ? dT / 0.35 : 1;
    const m = (f, z) => P(lerp(a0[0], a1[0], f), lerp(a0[1], a1[1], f), z);
    poly(ctx, [m(0, 0), m(1, 0), m(1, H), m(0, H)], '#140a04', '#2a1a0e', 2);
    for (const side of [0, 1]) {
      const f0 = side ? 0.5 + open * 0.42 : 0, f1 = side ? 1 : 0.5 - open * 0.42;
      if (f1 - f0 < 0.02) continue;
      poly(ctx, [m(f0, 0.12), m(f1, 0.12), m(f1, 2.2), m(f0, 2.2)], '#9a7448', '#2a1a0e', 1.6);
      ctx.strokeStyle = 'rgba(40,24,10,0.45)'; ctx.lineWidth = 1; for (const z of [0.6, 1.2, 1.8]) { const a = m(f0, z), c = m(f1, z); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); }
      ctx.fillStyle = '#2a1a0e'; const [hx, hy] = m(side ? f0 + 0.08 : f1 - 0.08, 1.1); ctx.beginPath(); ctx.arc(hx, hy, 2.2, 0, TAU); ctx.fill();
    }
    poly(ctx, [m(0, 2.2), m(1, 2.2), m(1, H), m(0, H)], '#4a2e18', '#2a1a0e', 1.6);
  }
  drawDojoPillar(ctx, p) {
    const [sx, sy] = P(p.x, p.y), Hh = 4.2 * 32, w = 10;
    ctx.fillStyle = 'rgba(20,10,6,0.3)'; ctx.beginPath(); ctx.ellipse(sx + 6, sy + 2, 17, 6, 0, 0, TAU); ctx.fill();
    const g = ctx.createLinearGradient(sx - w, 0, sx + w, 0); g.addColorStop(0, '#3a2414'); g.addColorStop(0.4, '#8a6038'); g.addColorStop(1, '#2a180c');
    ctx.fillStyle = g; ctx.fillRect(sx - w, sy - Hh, w * 2, Hh); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.strokeRect(sx - w, sy - Hh, w * 2, Hh);
    ctx.fillStyle = 'rgba(20,10,4,0.35)'; for (const z of [0.3, 0.62]) ctx.fillRect(sx - w, sy - Hh * z, w * 2, 2);
  }

  // training hall floor: pale boards around a big tatami square
  buildDojoGround(g, N, E, r) {
    const b = this.biome;
    for (let i = -E; i < N + E; i++) for (let j = -E; j < N + E; j++) {
      const out = Math.max(0, -i, -j, i - N + 1, j - N + 1);
      const hv = clamp(0.5 + Math.sin(i * 0.9) * 0.2 + (hash2(i, j) - 0.5) * 0.2, 0, 0.999);
      const col = out > 0 ? shade(b.outer, (hv - 0.5) * 0.1) : b.grass[Math.floor(hv * b.grass.length)];
      g.globalAlpha = out > 0 ? clamp(1 - (out - 1) / (E - 1), 0, 1) : 1;
      poly(g, [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], col, col, 1.2);
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(60,34,14,0.4)'; g.lineWidth = 1.2;
    for (let i = 0; i <= N * 2; i++) { const a = P(i / 2, 0), c = P(i / 2, N); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    for (let k = 0; k < 140; k++) { const x = r.range(0, N), y = r.range(0, N), a = P(x, y), c = P(x, y + r.range(0.6, 1.6)); g.strokeStyle = 'rgba(255,240,210,0.08)'; g.lineWidth = 3; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    // the tatami square: 2x1 mats in alternating directions, dark cloth borders
    // (layout per hall: one big square, a ring around a wooden middle, or two squares side by side)
    const D = this.dojo || { tatami: ['#c8c088', '#c2b880'], border: '#2e4a2a', inset: 4, layout: 'square' };
    const t0 = D.inset, t1 = N - D.inset, mid = N / 2;
    const has = (x, y) => {
      if (x < t0 || y < t0 || x + 2 > t1 || y + 2 > t1) return false;
      if (D.layout === 'ring') return !(x >= t0 + 4 && x + 2 <= t1 - 4 && y >= t0 + 4 && y + 2 <= t1 - 4);
      if (D.layout === 'twin') return Math.abs(x + 1 - mid) >= 1.5;
      return true;
    };
    for (let x = t0; x < t1; x += 2) for (let y = t0; y < t1; y += 2) {
      if (!has(x, y)) continue;
      const flip = ((x + y) / 2) % 2 === 0;
      const mats = flip ? [[x, y, x + 2, y + 1], [x, y + 1, x + 2, y + 2]] : [[x, y, x + 1, y + 2], [x + 1, y, x + 2, y + 2]];
      for (const [ax, ay, bx, by] of mats) {
        poly(g, [P(ax, ay), P(bx, ay), P(bx, by), P(ax, by)], (ax + ay) % 3 === 0 ? D.tatami[0] : D.tatami[1], null);
        g.strokeStyle = 'rgba(150,140,90,0.35)'; g.lineWidth = 1;
        for (let q = 1; q < 8; q++) { const u = q / 8; const a = flip ? P(ax + (bx - ax) * u, ay) : P(ax, ay + (by - ay) * u), c = flip ? P(ax + (bx - ax) * u, by) : P(bx, ay + (by - ay) * u); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
        g.strokeStyle = D.border; g.lineWidth = 3;
        const e = flip ? [[P(ax, ay), P(bx, ay)], [P(ax, by), P(bx, by)]] : [[P(ax, ay), P(ax, by)], [P(bx, ay), P(bx, by)]];
        for (const [a, c] of e) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
      }
    }
    // a dark edge wherever the mats meet the boards
    g.strokeStyle = 'rgba(40,24,10,0.6)'; g.lineWidth = 3; g.lineCap = 'round';
    const edge = (a, c) => { const A = P(a[0], a[1]), C = P(c[0], c[1]); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(C[0], C[1]); g.stroke(); };
    for (let x = t0; x < t1; x += 2) for (let y = t0; y < t1; y += 2) {
      if (!has(x, y)) continue;
      if (!has(x - 2, y)) edge([x, y], [x, y + 2]);
      if (!has(x + 2, y)) edge([x + 2, y], [x + 2, y + 2]);
      if (!has(x, y - 2)) edge([x, y], [x + 2, y]);
      if (!has(x, y + 2)) edge([x, y + 2], [x + 2, y + 2]);
    }
    g.lineCap = 'butt';
    poly(g, [P(0, 0), P(N, 0), P(N, N), P(0, N)], null, 'rgba(40,24,10,0.45)', 4);
  }

  // temple: a raked gravel forecourt with stone steps up to the platform
  bakeTempleCourt(g, r) {
    const T = this.temple, mx = (T.x0 + T.x1) / 2, x0 = mx - 2.8, x1 = mx + 2.8, y0 = T.y1, y1 = T.y1 + 4.4;
    const gravel = this.bi === 2 ? '#dfe4ec' : this.bi === 3 ? '#8a8690' : '#d8cfbc';
    poly(g, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], gravel, 'rgba(60,50,40,0.35)', 2);
    g.strokeStyle = 'rgba(120,110,90,0.35)'; g.lineWidth = 1;
    for (let y = y0 + 0.25; y < y1; y += 0.25) { const a = P(x0, y), c = P(x1, y); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    // the stone path up the middle and three steps onto the platform
    for (let y = y0 + 0.9; y < y1; y += 0.6) poly(g, [P(mx - 0.6, y), P(mx + 0.6, y), P(mx + 0.6, y + 0.5), P(mx - 0.6, y + 0.5)], shade('#9a948a', r.range(-0.08, 0.08)), 'rgba(30,25,30,0.55)', 1.1);
    const plat = 0.32;
    for (let k = 0; k < 3; k++) {
      const zt = plat * (1 - k / 3), ya = y0 + k * 0.28, yb = ya + 0.28;
      poly(g, [P(mx - 1.1, ya, zt), P(mx + 1.1, ya, zt), P(mx + 1.1, yb, zt), P(mx - 1.1, yb, zt)], '#b8b0a2', INK, 1.1);
      poly(g, [P(mx - 1.1, yb, zt), P(mx + 1.1, yb, zt), P(mx + 1.1, yb, zt - plat / 3), P(mx - 1.1, yb, zt - plat / 3)], '#8a8274', INK, 1.1);
    }
  }
  // library: polished floorboards inside
  bakeLibraryFloor(g, r) {
    const { x0, y0, x1, y1 } = this.library;
    poly(g, [P(x0 - 0.15, y0 - 0.15), P(x1 + 0.15, y0 - 0.15), P(x1 + 0.15, y1 + 0.15), P(x0 - 0.15, y1 + 0.15)], '#8a8478', INK, 1.4); // stone edge
    poly(g, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], '#9a6a40', null);
    g.strokeStyle = 'rgba(50,28,12,0.45)'; g.lineWidth = 1;
    for (let x = x0 + 0.5; x < x1; x += 0.5) { const a = P(x, y0), c = P(x, y1); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    for (let k = 0; k < 30; k++) { const x = r.range(x0, x1), y = r.range(y0, y1 - 1), a = P(x, y), c = P(x, y + r.range(0.5, 1)); g.strokeStyle = 'rgba(255,230,190,0.1)'; g.lineWidth = 3; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    // a rug in front of the desk
    const D = this.library.desk;
    poly(g, [P(D.x - 1.1, D.y + 0.5), P(D.x + 1.1, D.y + 0.5), P(D.x + 1.1, D.y + 1.6), P(D.x - 1.1, D.y + 1.6)], '#7a2a24', '#d8a838', 1.5);
  }

  drawRail(ctx, p) {
    if (p.style === 'dojo') { // a low wooden rail along the open front of the training hall
      const a = p.axis === 'x' ? [P(p.x - 0.5, p.y), P(p.x + 0.5, p.y)] : [P(p.x, p.y - 0.5), P(p.x, p.y + 0.5)];
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a[0][0], a[0][1] - 12); ctx.lineTo(a[1][0], a[1][1] - 12); ctx.stroke();
      ctx.strokeStyle = '#8a6038'; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.strokeStyle = '#2a180c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a[0][0], a[0][1]); ctx.lineTo(a[0][0], a[0][1] - 13); ctx.stroke();
      return;
    }
    const a =p.axis === 'x' ? [P(p.x - 0.5, p.y), P(p.x + 0.5, p.y)] : [P(p.x, p.y - 0.5), P(p.x, p.y + 0.5)];
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
    if (!this.biome.night && !this.forceNight) return; // (forceNight: a corruption turns the level into night)
    const W = view.W, H = view.H;
    if (!this.lightCanvas) { this.lightCanvas = document.createElement('canvas'); this.lctx = this.lightCanvas.getContext('2d'); }
    const s = 0.25;
    const lw = Math.ceil(W * s), lh = Math.ceil(H * s);
    if (this.lightCanvas.width !== lw || this.lightCanvas.height !== lh) { this.lightCanvas.width = lw; this.lightCanvas.height = lh; }
    const l = this.lctx;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, lw, lh);
    l.fillStyle = this.forceNight || this.biome.dark || 'rgba(8,12,38,0.6)'; l.fillRect(0, 0, lw, lh);
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
    if (this.bi !== 0 || this.indoor || this.forceNight) return; // (no sun shafts or butterflies under a blood moon)
    const W = view.W, H = view.H, k = view.s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // god rays from the upper left
    for (let i = 0; i < 6; i++) {
      const x = W * (-0.1 + i * 0.22) - view.camX * 0.05 * k + Math.sin(t * 0.15 + i) * 30 * k;
      const a = 0.075 + 0.045 * Math.sin(t * 0.4 + i * 1.7);
      const w = (60 + (i % 3) * 40) * k;
      // drawn in a sheared space so the soft fade leans with the ray (a straight fade on a slanted band left a hard
      // diagonal edge where the band slid out of its own gradient)
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, 'rgba(255,236,190,0)'); g.addColorStop(0.5, `rgba(255,236,190,${a})`); g.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.save(); ctx.transform(1, 0, 0.55, 1, 0, 0);
      ctx.fillStyle = g; ctx.fillRect(x, -10, w, H + 20);
      ctx.restore();
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

// screen-space box around a block of the world (x0..x1, y0..y1) up to height z
function boxBounds(x0, y0, x1, y1, z) {
  const l = isoX(x0, y1), r = isoX(x1, y0), top = isoY(x0, y0, z), bot = isoY(x1, y1);
  return [l, top, r - l, bot - top];
}
function randiSafe(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }

// the old tree's limbs: 5-6 long limbs fanning out from the stump, each forking into 1-2 branches with twigs
function makeLimbs(r) {
  const n = r.int(5, 6), limbs = [];
  for (let i = 0; i < n; i++) {
    const a = -1.15 + (i / (n - 1)) * 2.3 + r.range(-0.12, 0.12);
    const kids = Array.from({ length: r.int(1, 2) }, () => ({ at: r.range(0.55, 0.85), da: r.range(-0.7, 0.7), len: r.range(0.18, 0.28), twigs: [r.range(-0.6, -0.2), r.range(0.2, 0.6)].slice(0, r.int(1, 2)) }));
    limbs.push({ dx: (i / (n - 1) - 0.5) * 18, a, len: r.range(0.32, 0.46) * (Math.abs(a) > 0.9 ? 0.85 : 1), kids });
  }
  return limbs;
}
const x0lerp = (a, b, k) => a + (b - a) * k, lerpY = (a, b, k) => a + (b - a) * k;
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

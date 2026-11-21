// Route map between levels: an ink-and-washi scroll map of the current area. After each level the
// players pick one of two paths to the next level; every path shows the reward that level gives
// when it is cleared (stat upgrades, an imbuement, a talent, supplies or the monk's sacrifice).
import { TAU, clamp, lerp, ease, seededRng } from './util.js';
import { ROUTE_ODDS, ROUTE_SHIFT, BOSSES, DIFFICULTY, DIFFICULTY_ODDS, REWARD_ODDS, REWARD_TIERS, RARITIES } from './config.js';
import { TOWN_NAMES, LIBRARY_NAMES, MONK_NAMES, monkIndexForArea, pickName } from './names.js';
import { BIOMES } from './world.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { INK } from './rig.js';
import { CORRUPT_INFO } from './corruption.js';

const FONT_SERIF = '"Shippori Mincho", serif';
const FONT_SANS = '"Zen Kaku Gothic New", sans-serif';

// area index (0-3) -> first and last level
export const AREAS = [[1, 10], [11, 20], [21, 30], [31, 33]];
export const areaOf = (level) => (level > 30 ? 3 : Math.floor((level - 1) / 10));

export const REWARDS = {
  stat:      { name: 'Town',       jp: '町', color: '#b8302a', desc: 'Choose 1 of 3 trainings' },
  element:   { name: 'Shrine',     jp: '宿', color: '#2a5a9a', desc: 'Choose 1 of 2 weapon imbuements' },
  talent:    { name: 'Library',    jp: '書', color: '#a87a1a', desc: 'Choose 1 of 2 talent scrolls' },
  item:      { name: 'Tea House',  jp: '薬', color: '#2a7a4a', desc: 'Rest at a tea house: no fight, pick a consumable' },
  art:       { name: 'Training Hall', jp: '道', color: '#7a1a3a', desc: 'Choose 1 of 2 techniques (one per weapon)' },
  sacrifice: { name: 'Temple',     jp: '寺', color: '#5a0a12', desc: 'The temple monk offers a dark pact' },
};

// ---------------------------------------------------------------- map generation
// The map branches: every path on offer leads on to two paths of its own. The players see the two paths they
// can take now and, greyed out, the two that follow each of them (four), so they can plan a little ahead.
// A node's two follow-ups (kids) are rolled when the node is first shown, with the odds of the part of the area
// the next level falls in (ROUTE_ODDS) and the run's shifting weights for sacrifices and techniques (wmul).
export const sectionOf = (level) => { if (level > 30) return 'area4'; const l = ((level - 1) % 10) + 1; return l === 3 || l === 6 || l === 9 ? 'inter' : 'section'; };
function rollType(rng, level, wmul = {}, not = null) {
  const W = ROUTE_ODDS[sectionOf(level)], keys = Object.keys(W).filter((k) => k !== not && !(not === 'sacrifice' && k === 'sacrifice'));
  const w = keys.map((k) => W[k] * (wmul[k] || 1)), tot = w.reduce((s, x) => s + x, 0);
  let v = rng() * tot;
  for (let i = 0; i < keys.length; i++) { v -= w[i]; if (v < 0) return keys[i]; }
  return keys[0];
}
// two different paths for a level
function rollPair(rng, level, area, used, wmul, y0 = 0.3, y1 = 0.7) {
  const a = rollType(rng, level, wmul), b = rollType(rng, level, wmul, a);
  return [decorateNode({ r: a, y: y0 }, area, rng, used), decorateNode({ r: b, y: y1 }, area, rng, used)];
}
// the run's shifting weights: choosing a sacrifice / technique makes the next ones rarer for a while, passing
// them by makes them a little more likely each time
export function shiftWeights(wmul, chosen) {
  const S = ROUTE_SHIFT;
  for (const k of S.keys) wmul[k] = Math.min(S.max, Math.max(S.min, (wmul[k] || 1) * (chosen === k ? S.drop : S.rise)));
  return wmul;
}
// make sure every node in column c knows its two follow-ups (the boss column: the boss)
export function ensureKids(route, c, wmul = {}) {
  const n = route.cols.length, col = route.cols[c];
  if (!col || c >= n - 1) return;
  const rng = Math.random, used = new Set(route.used || []), level = col.level + 1;
  col.nodes.forEach((nd) => {
    if (nd.kids) return;
    if (c + 1 === n - 1 && BOSSES[route.cols[n - 1].level]) { nd.kids = [route.cols[n - 1].nodes[0]]; return; }
    nd.kids = rollPair(rng, level, route.area, used, wmul, clamp(nd.y - 0.12, 0.14, 0.86), clamp(nd.y + 0.12, 0.14, 0.86));
  });
  route.used = [...used];
}
// the team chose path i in column c: its follow-ups become the next column's paths (placed at the usual heights)
export function takePath(route, c, i) {
  route.path[c] = i;
  const nd = route.cols[c] && route.cols[c].nodes[i], next = route.cols[c + 1];
  if (!nd || !next || c + 1 >= route.cols.length - 1 || !nd.kids) return;
  next.nodes = nd.kids.map((k, j) => ({ ...k, y: nd.kids.length > 1 ? [0.3, 0.7][j] : 0.5 }));
}
// Smuggler's Map: these paths are better (tier 0..3, see ITEM_CARDS.map)
export function smuggle(nodes, area, tier) {
  if (!nodes || !nodes.length) return;
  if (!nodes.some((nd) => nd.q !== undefined) && tier >= 1) Object.assign(nodes[0], decorateNode({ r: 'stat', y: nodes[0].y }, area), { kids: nodes[0].kids });
  for (const nd of nodes) {
    if (nd.d !== undefined && (tier === 0 || tier === 3)) nd.d = tier === 3 ? 0 : Math.min(nd.d, 1);
    if (nd.q !== undefined && tier >= 1) nd.q = Math.max(nd.q, tier >= 2 ? 2 : 1);
    nd.smuggled = true;
  }
}

// cols[i] = { level, nodes: [{ r: rewardType, y: 0..1 }] }. The first column (the area's opening level)
// and the boss column have one node; every other column offers two paths.
export function makeAreaMap(area, seed = Math.floor(Math.random() * 1e9), wmul = {}) {
  const [first, last] = AREAS[area];
  const rng = seededRng(seed), used = new Set();
  const n = last - first + 1, cols = [];
  for (let c = 0; c < n; c++) cols.push({ level: first + c, nodes: [] });
  // the boss at the end; the first level of every area is a town (in the fortress: the castle town inside its walls)
  cols[n - 1].nodes = [{ r: 'stat', y: 0.5 }];
  cols[0].nodes = [decorateNode({ r: 'stat', y: 0.5 }, area, rng, used)];
  if (area === 3) cols[0].nodes[0].name = 'Kagerō Castle Town';
  const route = { area, first, last, seed, cols, path: [], used: [...used] };
  ensureKids(route, 0, wmul);
  return route;
}

// does this node's reward roll card rarities / is it a fight?
export const HAS_RARITY = (r) => r === 'stat' || r === 'element' || r === 'talent' || r === 'item';
export const IS_FIGHT = (r) => r !== 'item';
const roll = (rng, odds) => { let v = rng(); for (let i = 0; i < odds.length; i++) { v -= odds[i]; if (v < 0) return i; } return odds.length - 1; };
// every node gets its difficulty (fights) and reward tier (rarity cards) before the player chooses,
// plus a name for towns, temples (the monk's) and libraries
export function decorateNodes(cols, area, rng) {
  const used = new Set(), n = cols.length;
  cols.forEach((col, c) => col.nodes.forEach((nd) => {
    if (c === n - 1 && BOSSES[col.level]) return; // the boss: no indicators
    decorateNode(nd, area, rng, used);
  }));
}
export function decorateNode(nd, area, rng = Math.random, used = new Set()) {
  nd.d = IS_FIGHT(nd.r) ? roll(rng, DIFFICULTY_ODDS) : undefined;
  nd.q = HAS_RARITY(nd.r) ? roll(rng, REWARD_ODDS[nd.d ?? 1]) : undefined;
  if (nd.r === 'stat') nd.name = pickName(TOWN_NAMES, rng, used);
  else if (nd.r === 'talent') nd.name = 'Library of ' + pickName(LIBRARY_NAMES, rng, used);
  else if (nd.r === 'sacrifice') { nd.monk = monkIndexForArea(area); nd.monkName = pickName(MONK_NAMES[nd.monk], rng, used); nd.name = 'Temple of ' + nd.monkName; }
  return nd;
}
// the node the team travelled to for a level (null outside the map)
export function nodeOf(route, level) {
  if (!route || level < route.first || level > route.last) return null;
  const c = level - route.first, col = route.cols[c];
  return col.nodes[route.path[c] ?? 0] || null;
}

// the reward of the level just played (the node the team travelled to)
export function rewardOf(route, level) {
  if (!route || level < route.first || level > route.last) return 'stat';
  const c = level - route.first, col = route.cols[c];
  return col.nodes[route.path[c] ?? 0].r;
}

// ---------------------------------------------------------------- drawing helpers
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function txt(ctx, s, x, y, size, color, weight = 700, font = FONT_SANS, align = 'center') {
  ctx.font = `${weight} ${Math.round(size)}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}
// ink-wash mountain: two soft layers and a dark ridge line
function mountain(ctx, x, y, w, h, rng, tint) {
  const peak = x + w * (0.35 + rng() * 0.3);
  const shape = (k) => {
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(lerp(x, peak, 0.55), y - h * 0.55 * k, peak, y - h * k);
    ctx.quadraticCurveTo(lerp(peak, x + w, 0.45), y - h * 0.5 * k, x + w, y); ctx.closePath();
  };
  ctx.fillStyle = tint; shape(1); ctx.fill();
  ctx.fillStyle = 'rgba(40,36,44,0.10)'; shape(0.72); ctx.fill();
  ctx.strokeStyle = 'rgba(30,26,34,0.55)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x + w * 0.12, y - h * 0.18); ctx.quadraticCurveTo(lerp(x, peak, 0.6), y - h * 0.62, peak, y - h); ctx.quadraticCurveTo(lerp(peak, x + w, 0.4), y - h * 0.55, x + w * 0.88, y - h * 0.15); ctx.stroke();
  // snow / mist cap
  ctx.fillStyle = 'rgba(255,252,240,0.55)'; ctx.beginPath(); ctx.moveTo(peak, y - h); ctx.lineTo(peak - w * 0.08, y - h * 0.8); ctx.lineTo(peak + w * 0.07, y - h * 0.82); ctx.closePath(); ctx.fill();
}
function pine(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(34,48,40,0.6)';
  for (let i = 0; i < 3; i++) { const w = s * (1 - i * 0.25), yy = y - i * s * 0.45; ctx.beginPath(); ctx.ellipse(x, yy, w, s * 0.22, 0, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = 'rgba(40,30,24,0.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y + s * 0.3); ctx.lineTo(x, y - s); ctx.stroke();
}
function hut(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(60,44,36,0.55)'; ctx.fillRect(x - s * 0.6, y - s * 0.6, s * 1.2, s * 0.6);
  ctx.fillStyle = 'rgba(40,30,30,0.7)'; ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.55); ctx.lineTo(x, y - s * 1.2); ctx.lineTo(x + s, y - s * 0.55); ctx.closePath(); ctx.fill();
}
// kasumi: long rounded gold-edged cloud bands, as on old painted maps
function kasumi(ctx, x, y, w, h, a) {
  ctx.save(); ctx.globalAlpha *= a;
  rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = '#f3e9cf'; ctx.fill();
  ctx.strokeStyle = 'rgba(190,150,70,0.8)'; ctx.lineWidth = 1.4; ctx.stroke();
  rr(ctx, x + w * 0.18, y - h * 0.45, w * 0.5, h * 0.9, h * 0.45); ctx.fillStyle = '#f3e9cf'; ctx.fill(); ctx.stroke();
  ctx.restore();
}
// ---------------------------------------------------------------- nodes: little reward cards
// Each path shows a small card in the colours of the reward cards it leads to (training: cream washi,
// imbuement: night blue, consumable: tea-house green, talent: old gold, technique: crimson, sacrifice: blood).
const NODE = {
  stat:      { paper: ['#f4ead2', '#e2d2ae'], band: '#3a3028', ink: '#2a1e14', accent: '#b8302a', edge: '#5a4a38' }, // town: light washi, dark ring
  element:   { paper: ['#2a3060', '#121634'], band: '#3a4a8a', ink: '#d8e6ff', accent: '#7ab0ff', edge: '#0a0c20', glow: 'rgba(120,170,255,0.55)' },
  item:      { paper: ['#f1e4c6', '#dcc597'], band: '#3f6e34', ink: '#2a1e14', accent: '#3f6e34', edge: '#5a3a20', glow: 'rgba(110,210,130,0.6)', halo: '90,190,110' }, // tea house: warm paper, green band, a green glow
  talent:    { paper: ['#6a4c14', '#281a04'], band: '#8a6a20', ink: '#ffe6a0', accent: '#f0c050', edge: '#0e0904', glow: 'rgba(240,200,90,0.55)' }, // library: gold
  art:       { paper: ['#6a1420', '#2a060c'], band: '#0e0406', ink: '#f0c870', accent: '#f0c870', edge: '#0e0406' },
  sacrifice: { paper: ['#2c2c2e', '#0a0a0c'], band: '#1a1a1c', ink: '#9a1018', accent: '#6a0c12', edge: '#000', glow: 'rgba(150,20,30,0.55)' }, // temple: near black, a dark red drop of blood
  boss:      { paper: ['#2a2228', '#0e0a0e'], band: '#a8322a', ink: '#f6e2bc', accent: '#a8322a', edge: '#000' },
};
// a short line for the tooltip
const TIP = {
  stat: 'Improve your core skills',
  element: 'Add an imbuement to your weapon',
  item: 'Rest at a tea house: no fight, pick a consumable',
  talent: 'Learn new active talents',
  art: 'Learn new weapon techniques',
  sacrifice: 'Gain insights for a sacrifice…',
};
// indicator colours: dark green = good, white/grey = middling, dark red = bad
const IND = [
  { fill: '#1c4a1a', glyph: '#f4f0e0', edge: '#081c06' },
  { fill: '#e8e4da', glyph: '#3a3028', edge: '#4a4038' },
  { fill: '#7a1418', glyph: '#f8e8e0', edge: '#2a0406' },
];
// how good an indicator reads (0 good .. 2 bad): Easy is good, Epic+ / Legendary rewards are good
export const diffTone = (d) => d;
export const rewardTone = (q) => Math.max(0, 2 - q);
// a small round badge next to a node: kind 'diff' shows a blade, kind 'rew' a jewel
const IND_FIXED = { diff: { fill: '#a81e1e', glyph: '#fff2e4', edge: '#3a0606' }, rew: { fill: '#d0a030', glyph: '#3a2608', edge: '#5a3c0a' } };
// Legendary in a tooltip: a bright band sweeps across the gold letters every ~1.6 s, and two little stars twinkle
function legendaryShine(ctx, val, x, y, w, u, t) {
  ctx.save();
  const k = (t % 1.6) / 1.6, bx = x - 20 * u + (w + 40 * u) * k;
  const g = ctx.createLinearGradient(bx - 12 * u, 0, bx + 12 * u, 0);
  g.addColorStop(0, 'rgba(255,248,220,0)'); g.addColorStop(0.5, 'rgba(255,252,236,0.95)'); g.addColorStop(1, 'rgba(255,248,220,0)');
  ctx.font = `800 ${Math.round(12 * u)}px ${FONT_SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = g; ctx.fillText(val, x, y);
  ctx.globalCompositeOperation = 'lighter';
  for (const [ox, oy, ph] of [[w * 0.78, -7 * u, 0], [w * 0.12, 6 * u, 0.5]]) {
    const a = Math.max(0, Math.sin((t * 2.2 + ph) * Math.PI)), r = (2 + 2.5 * a) * u;
    if (a < 0.05) continue;
    ctx.fillStyle = `rgba(255,236,160,${a})`;
    ctx.beginPath(); ctx.moveTo(x + ox, y + oy - r); ctx.lineTo(x + ox + r * 0.28, y + oy); ctx.lineTo(x + ox, y + oy + r); ctx.lineTo(x + ox - r * 0.28, y + oy); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + ox - r, y + oy); ctx.lineTo(x + ox, y + oy + r * 0.28); ctx.lineTo(x + ox + r, y + oy); ctx.lineTo(x + ox, y + oy - r * 0.28); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
export function indicator(ctx, x, y, r, tone, kind, fixed = false) {
  const C = fixed ? { fill: '#181014', glyph: '#ffffff', edge: '#181014' } : IND[tone]; // fixed: just the white icon, no badge (fill = the tooltip's dark, for the cut-out details)
  ctx.save(); ctx.translate(x, y);
  if (fixed) ctx.scale(1.3, 1.3);
  ctx.shadowColor = 'rgba(30,16,8,0.45)'; ctx.shadowBlur = r * 0.5; ctx.shadowOffsetY = r * 0.12;
  if (!fixed) { ctx.fillStyle = C.fill; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); }
  ctx.shadowColor = 'transparent';
  if (!fixed) { ctx.strokeStyle = C.edge; ctx.lineWidth = Math.max(1, r * 0.16); ctx.stroke(); }
  ctx.fillStyle = C.glyph; ctx.strokeStyle = C.glyph; ctx.lineCap = 'round';
  if (kind === 'diff') { // danger: a warning triangle with an exclamation mark
    ctx.lineJoin = 'round'; ctx.lineWidth = r * 0.12;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.62); ctx.lineTo(r * 0.62, r * 0.5); ctx.lineTo(-r * 0.62, r * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = C.fill; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.24); ctx.lineTo(0, r * 0.14); ctx.stroke();
    ctx.fillStyle = C.fill; ctx.beginPath(); ctx.arc(0, r * 0.32, r * 0.09, 0, TAU); ctx.fill();
  } else { // rewards: a small treasure chest (domed lid, a band and a lock)
    const w = r * 0.62, top = -r * 0.5, mid = -r * 0.05, bot = r * 0.5;
    ctx.beginPath(); ctx.moveTo(-w, mid); ctx.lineTo(-w, top + r * 0.18); ctx.quadraticCurveTo(0, top - r * 0.2, w, top + r * 0.18); ctx.lineTo(w, mid); ctx.closePath(); ctx.fill(); // lid
    ctx.fillRect(-w, mid + r * 0.08, w * 2, bot - mid - r * 0.08); // box
    ctx.fillStyle = C.fill; ctx.fillRect(-r * 0.1, mid - r * 0.12, r * 0.2, r * 0.3); // the lock
    ctx.strokeStyle = C.fill; ctx.lineWidth = r * 0.06; ctx.beginPath(); ctx.moveTo(-w, mid + r * 0.04); ctx.lineTo(w, mid + r * 0.04); ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- node icons (drawn in the card's ink, s = half size)
function roofShape(ctx, s, yb, w, h) { // a curved temple-style roof, the eaves swept up at the ends
  ctx.beginPath(); ctx.moveTo(-w * s, (yb - 0.1) * s);
  ctx.quadraticCurveTo(-w * 0.62 * s, yb * s, -w * 0.42 * s, (yb - h) * s);
  ctx.lineTo(w * 0.42 * s, (yb - h) * s);
  ctx.quadraticCurveTo(w * 0.62 * s, yb * s, w * s, (yb - 0.1) * s);
  ctx.quadraticCurveTo(w * 0.7 * s, (yb + 0.06) * s, w * 0.55 * s, (yb + 0.04) * s);
  ctx.lineTo(-w * 0.55 * s, (yb + 0.04) * s);
  ctx.quadraticCurveTo(-w * 0.7 * s, (yb + 0.06) * s, -w * s, (yb - 0.1) * s);
  ctx.closePath(); ctx.fill();
}
function townIcon(ctx, s, ink) { // two machiya houses
  const house = (x, y, w, h) => {
    ctx.fillStyle = 'rgba(255,250,236,0.95)'; ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, s * 0.07); ctx.strokeRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(x - w * 0.68, y - h + s * 0.04); ctx.lineTo(x - w * 0.36, y - h - h * 0.62); ctx.lineTo(x + w * 0.36, y - h - h * 0.62); ctx.lineTo(x + w * 0.68, y - h + s * 0.04); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - w * 0.12, y - h * 0.62, w * 0.24, h * 0.62); // the doorway
    ctx.fillRect(x + w * 0.22, y - h * 0.75, w * 0.14, h * 0.2); // a window
  };
  house(-s * 0.32, s * 0.18, s * 0.82, s * 0.46);
  house(s * 0.36, s * 0.6, s * 0.74, s * 0.4);
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, s * 0.07); ctx.beginPath(); ctx.moveTo(-s * 0.85, s * 0.62); ctx.lineTo(-s * 0.05, s * 0.62); ctx.stroke();
}
function templeIcon(ctx, s, ink) { // a two-tier hall on a stepped base
  ctx.fillStyle = ink;
  ctx.fillRect(-s * 0.8, s * 0.6, s * 1.6, s * 0.13); ctx.fillRect(-s * 0.62, s * 0.48, s * 1.24, s * 0.1);
  for (const x of [-0.46, -0.16, 0.16, 0.46]) ctx.fillRect(x * s - s * 0.05, s * 0.0, s * 0.1, s * 0.5);
  roofShape(ctx, s, 0.02, 0.92, 0.3);
  ctx.fillRect(-s * 0.36, -s * 0.36, s * 0.72, s * 0.1);
  roofShape(ctx, s, -0.36, 0.62, 0.26);
  ctx.fillRect(-s * 0.035, -s * 0.85, s * 0.07, s * 0.25); // the finial
}
function dojoIcon(ctx, s, ink) { // two katana crossed
  ctx.lineCap = 'round';
  for (const k of [-1, 1]) {
    ctx.save(); ctx.rotate(k * Math.PI / 4);
    ctx.strokeStyle = ink; ctx.lineWidth = s * 0.13; // the blade, gently curved
    ctx.beginPath(); ctx.moveTo(0, s * 0.42); ctx.quadraticCurveTo(k * s * 0.08, -s * 0.2, 0, -s * 0.85); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.ellipse(0, s * 0.45, s * 0.17, s * 0.06, 0, 0, TAU); ctx.fill(); // tsuba
    ctx.lineWidth = s * 0.18; ctx.beginPath(); ctx.moveTo(0, s * 0.52); ctx.lineTo(0, s * 0.86); ctx.stroke(); // grip
    ctx.restore();
  }
}
function libraryIcon(ctx, s, ink) { // an open book
  ctx.fillStyle = 'rgba(255,250,236,0.95)'; ctx.strokeStyle = ink; ctx.lineJoin = 'round';
  for (const k of [-1, 1]) {
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath(); ctx.moveTo(0, -s * 0.38); ctx.quadraticCurveTo(k * s * 0.4, -s * 0.6, k * s * 0.86, -s * 0.44);
    ctx.lineTo(k * s * 0.86, s * 0.44); ctx.quadraticCurveTo(k * s * 0.4, s * 0.3, 0, s * 0.52); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = Math.max(1, s * 0.05);
    for (let i = 0; i < 4; i++) { const yy = -s * 0.28 + i * s * 0.18; ctx.beginPath(); ctx.moveTo(k * s * 0.16, yy); ctx.lineTo(k * s * 0.7, yy - s * 0.06); ctx.stroke(); } // lines of text
  }
  ctx.lineWidth = Math.max(1, s * 0.08); ctx.beginPath(); ctx.moveTo(0, -s * 0.38); ctx.lineTo(0, s * 0.52); ctx.stroke();
}
function shrineIcon(ctx, s, ink) { // a shrine's torii gate: two pillars, the curved top beam with upturned ends, the tie beam
  ctx.fillStyle = ink;
  for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(k * s * 0.44 - s * 0.07, -s * 0.5); ctx.lineTo(k * s * 0.44 + s * 0.07, -s * 0.5); ctx.lineTo(k * s * 0.5 + s * 0.08, s * 0.82); ctx.lineTo(k * s * 0.5 - s * 0.08, s * 0.82); ctx.closePath(); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(-s * 0.95, -s * 0.8); ctx.quadraticCurveTo(0, -s * 0.6, s * 0.95, -s * 0.8); // kasagi
  ctx.lineTo(s * 0.86, -s * 0.6); ctx.quadraticCurveTo(0, -s * 0.46, -s * 0.86, -s * 0.6); ctx.closePath(); ctx.fill();
  ctx.fillRect(-s * 0.7, -s * 0.34, s * 1.4, s * 0.13); // nuki
  ctx.fillRect(-s * 0.05, -s * 0.52, s * 0.1, s * 0.2); // the plaque between the beams
}
function teapotIcon(ctx, s, ink) { // a simple flat teapot seen from the side: squat body, lid with a knob, short spout right, loop handle left
  ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.ellipse(0, s * 0.22, s * 0.56, s * 0.42, 0, 0, TAU); ctx.fill(); // body
  ctx.fillRect(-s * 0.32, s * 0.56, s * 0.64, s * 0.1); // foot
  ctx.beginPath(); ctx.ellipse(0, -s * 0.2, s * 0.3, s * 0.11, 0, Math.PI, 0); ctx.fill(); // lid
  ctx.beginPath(); ctx.arc(0, -s * 0.36, s * 0.08, 0, TAU); ctx.fill(); // knob
  ctx.beginPath(); ctx.moveTo(s * 0.44, s * 0.08); ctx.lineTo(s * 0.86, -s * 0.18); ctx.lineTo(s * 0.92, -s * 0.06); ctx.lineTo(s * 0.5, s * 0.36); ctx.closePath(); ctx.fill(); // spout
  ctx.lineWidth = s * 0.12; ctx.beginPath(); ctx.arc(-s * 0.56, s * 0.2, s * 0.22, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke(); // handle
}
function bloodDropIcon(ctx, s) { // a single drop of blood, bright enough to read on the near-black temple node, with a glint
  const shape = () => { ctx.beginPath(); ctx.moveTo(0, -s * 0.92); ctx.bezierCurveTo(s * 0.18, -s * 0.5, s * 0.66, -s * 0.05, s * 0.6, s * 0.34);
    ctx.bezierCurveTo(s * 0.55, s * 0.78, -s * 0.55, s * 0.78, -s * 0.6, s * 0.34); ctx.bezierCurveTo(-s * 0.66, -s * 0.05, -s * 0.18, -s * 0.5, 0, -s * 0.92); };
  const gr = ctx.createLinearGradient(-s * 0.4, -s * 0.6, s * 0.4, s * 0.7);
  gr.addColorStop(0, '#ff4a52'); gr.addColorStop(0.55, '#e0202e'); gr.addColorStop(1, '#a8101c');
  shape(); ctx.fillStyle = gr; ctx.fill();
  ctx.strokeStyle = 'rgba(255,150,150,0.55)'; ctx.lineWidth = Math.max(1, s * 0.06); ctx.stroke(); // a light rim so it stands off the dark
  ctx.fillStyle = 'rgba(255,230,230,0.75)'; ctx.beginPath(); ctx.ellipse(-s * 0.26, s * 0.2, s * 0.1, s * 0.22, 0.35, 0, TAU); ctx.fill();
}
const NODE_ICON = { stat: townIcon, sacrifice: bloodDropIcon, art: dojoIcon, talent: libraryIcon, element: shrineIcon, item: teapotIcon };

// a round node centred on (x, y), h across, in the colours of its reward card:
// the card's paper inside, its header band as the ring, its ink for the kanji.
// option = a path on offer now (halo), sel = the selected one, past = already walked (smaller, faded)
function nodeCard(ctx, x, y, h, type, jp, { hidden = false, sel = false, option = false, past = false, t = 0 } = {}) {
  const r = h / 2, S = NODE[type] || NODE.stat;
  ctx.save(); ctx.translate(x, y);
  if (past) ctx.globalAlpha *= 0.6;
  if (option) { // a halo that keeps rippling outwards, so the way on is easy to spot
    for (let k = 0; k < 2; k++) {
      const q = (t * 0.8 + k * 0.5) % 1;
      ctx.strokeStyle = sel ? `rgba(${S.halo || '240,200,96'},${0.8 * (1 - q)})` : `rgba(${S.halo || '200,48,46'},${0.55 * (1 - q)})`; ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.beginPath(); ctx.arc(0, 0, r * (1.05 + q * 0.55), 0, TAU); ctx.stroke();
    }
  }
  ctx.shadowColor = sel ? (S.glow || 'rgba(255,200,90,0.9)') : 'rgba(40,24,10,0.4)'; ctx.shadowBlur = sel ? r * 1.1 : r * 0.3; ctx.shadowOffsetY = sel ? 0 : r * 0.12;
  ctx.fillStyle = hidden ? '#7a6a58' : S.band; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); // the ring
  ctx.shadowColor = 'transparent';
  if (hidden) { txt(ctx, '?', 0, r * 0.05, r * 1.0, 'rgba(250,240,220,0.8)', 800, FONT_SERIF); ctx.restore(); return; }
  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r * 0.8); g.addColorStop(0, S.paper[0]); g.addColorStop(1, S.paper[1]);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 0.76, 0, TAU); ctx.fill(); // the card's paper
  ctx.strokeStyle = S.accent; ctx.lineWidth = Math.max(1, r * 0.07); ctx.beginPath(); ctx.arc(0, 0, r * 0.76, 0, TAU); ctx.stroke();
  if (NODE_ICON[type]) NODE_ICON[type](ctx, r * 0.56, S.ink);
  else txt(ctx, jp, 0, r * 0.05, r * 0.92, S.ink, 800, FONT_SERIF);
  ctx.strokeStyle = sel ? '#f0c860' : S.edge; ctx.lineWidth = sel ? Math.max(2.5, r * 0.12) : Math.max(1, r * 0.06); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.restore();
}

// a node card drawn once into its own canvas and desaturated by hand (cached per type, size and amount)
const GREY = new Map();
function greyCard(type, h, amount) {
  const key = type + '|' + Math.round(h) + '|' + amount;
  let c = GREY.get(key);
  if (c) return c;
  if (GREY.size > 120) GREY.clear(); // (sizes change when the window is resized)
  const pad = Math.ceil(h * 0.4), size = Math.ceil(h) + pad * 2;
  c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  nodeCard(x, size / 2, size / 2, h, type, REWARDS[type] ? REWARDS[type].jp : '', {});
  const img = x.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] += (l - d[i]) * amount; d[i + 1] += (l - d[i + 1]) * amount; d[i + 2] += (l - d[i + 2]) * amount;
  }
  x.putImageData(img, 0, 0);
  GREY.set(key, c);
  return c;
}

// a small hash for steady, seeded jitter
const hash = (a, b, c) => { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------- paper map decorations
// little map symbols for the things you meet in each area's levels
function blossomTree(ctx, x, y, s, cols) { // cherry / maple / ginkgo: a trunk and a few round clumps
  ctx.strokeStyle = 'rgba(70,46,30,0.75)'; ctx.lineWidth = s * 0.18; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.5, x + s * 0.05, y - s * 0.9); ctx.stroke();
  for (const [dx, dy, rr2, k] of [[-0.45, -1.0, 0.5, 0], [0.4, -1.05, 0.48, 1], [0, -1.35, 0.55, 2], [-0.1, -0.85, 0.42, 1]]) { ctx.fillStyle = cols[k % cols.length]; ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, rr2 * s, 0, TAU); ctx.fill(); }
}
function snowPine(ctx, x, y, s, snow) {
  ctx.fillStyle = 'rgba(40,60,46,0.75)';
  for (let i = 0; i < 3; i++) { const w = s * (0.9 - i * 0.22), yy = y - s * 0.3 - i * s * 0.45; ctx.beginPath(); ctx.moveTo(x - w, yy); ctx.lineTo(x, yy - s * 0.65); ctx.lineTo(x + w, yy); ctx.closePath(); ctx.fill(); if (snow) { ctx.fillStyle = 'rgba(250,252,255,0.9)'; ctx.beginPath(); ctx.moveTo(x - w * 0.45, yy - s * 0.35); ctx.lineTo(x, yy - s * 0.65); ctx.lineTo(x + w * 0.45, yy - s * 0.35); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(40,60,46,0.75)'; } }
  ctx.fillStyle = 'rgba(60,40,26,0.8)'; ctx.fillRect(x - s * 0.07, y - s * 0.3, s * 0.14, s * 0.3);
}
function house(ctx, x, y, s, roof, snow) { // a farmhouse / town house: white walls, a dark roof
  ctx.fillStyle = 'rgba(244,236,214,0.95)'; ctx.fillRect(x - s * 0.7, y - s * 0.55, s * 1.4, s * 0.55);
  ctx.strokeStyle = 'rgba(70,50,36,0.7)'; ctx.lineWidth = Math.max(1, s * 0.08); ctx.strokeRect(x - s * 0.7, y - s * 0.55, s * 1.4, s * 0.55);
  ctx.fillStyle = 'rgba(70,50,36,0.7)'; ctx.fillRect(x - s * 0.15, y - s * 0.35, s * 0.3, s * 0.35);
  ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(x - s * 0.95, y - s * 0.5); ctx.lineTo(x - s * 0.5, y - s * 1.05); ctx.lineTo(x + s * 0.5, y - s * 1.05); ctx.lineTo(x + s * 0.95, y - s * 0.5); ctx.closePath(); ctx.fill();
  if (snow) { ctx.fillStyle = 'rgba(252,253,255,0.95)'; ctx.beginPath(); ctx.moveTo(x - s * 0.62, y - s * 0.9); ctx.lineTo(x - s * 0.5, y - s * 1.05); ctx.lineTo(x + s * 0.5, y - s * 1.05); ctx.lineTo(x + s * 0.62, y - s * 0.9); ctx.closePath(); ctx.fill(); }
}
function paddy(ctx, x, y, w, h, u) { // rice fields in full growth: lush green plots with rows of rice
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const px = x + i * (w / 3) + 1.5 * u, py = y + j * (h / 2) + 1.5 * u, pw = w / 3 - 3 * u, ph = h / 2 - 3 * u;
    ctx.fillStyle = (i + j) % 2 ? 'rgba(96,158,58,0.78)' : 'rgba(118,176,66,0.78)'; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = 'rgba(60,110,36,0.6)'; ctx.lineWidth = 0.8 * u; // the rows of rice
    for (let r = py + 3 * u; r < py + ph - 1 * u; r += 3.2 * u) { ctx.beginPath(); ctx.moveTo(px + 1.5 * u, r); ctx.lineTo(px + pw - 1.5 * u, r); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(110,80,50,0.5)'; ctx.lineWidth = 1 * u; ctx.strokeRect(px, py, pw, ph);
  }
}
function pond(ctx, x, y, rx, ry, frozen, bridge, u) {
  ctx.fillStyle = frozen ? 'rgba(200,225,240,0.75)' : 'rgba(110,160,180,0.5)'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(90,80,70,0.55)'; ctx.lineWidth = 1.2 * u; ctx.stroke();
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; ctx.fillStyle = 'rgba(130,120,110,0.6)'; ctx.beginPath(); ctx.arc(x + Math.cos(a) * rx, y + Math.sin(a) * ry, 2.2 * u, 0, TAU); ctx.fill(); } // edge stones
  if (bridge) { ctx.strokeStyle = 'rgba(190,50,40,0.85)'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(x - rx * 0.55, y + ry * 0.1); ctx.quadraticCurveTo(x, y - ry * 0.9, x + rx * 0.55, y + ry * 0.1); ctx.stroke(); }
}
function bamboo(ctx, x, y, s) {
  ctx.strokeStyle = 'rgba(90,130,70,0.7)'; ctx.lineWidth = s * 0.12;
  for (const dx of [-0.3, 0, 0.3]) { ctx.beginPath(); ctx.moveTo(x + dx * s, y); ctx.lineTo(x + dx * s * 1.4, y - s * 1.6); ctx.stroke(); }
  ctx.fillStyle = 'rgba(110,150,80,0.6)'; for (const [dx, dy] of [[-0.5, -1.5], [0.5, -1.3], [0, -1.7]]) { ctx.beginPath(); ctx.ellipse(x + dx * s, y + dy * s, s * 0.35, s * 0.12, dx, 0, TAU); ctx.fill(); }
}
function lanternStone(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(110,104,100,0.8)';
  ctx.fillRect(x - s * 0.12, y - s * 0.7, s * 0.24, s * 0.7); ctx.fillRect(x - s * 0.3, y - s * 0.95, s * 0.6, s * 0.28);
  ctx.beginPath(); ctx.moveTo(x - s * 0.4, y - s * 0.95); ctx.lineTo(x, y - s * 1.25); ctx.lineTo(x + s * 0.4, y - s * 0.95); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,180,90,0.75)'; ctx.fillRect(x - s * 0.12, y - s * 0.88, s * 0.24, s * 0.14);
}
function castle(ctx, x, y, s, dark) { // a keep: stone base, white walls, layered dark roofs
  ctx.fillStyle = 'rgba(120,112,104,0.8)'; ctx.beginPath(); ctx.moveTo(x - s * 1.1, y); ctx.lineTo(x - s * 0.85, y - s * 0.5); ctx.lineTo(x + s * 0.85, y - s * 0.5); ctx.lineTo(x + s * 1.1, y); ctx.closePath(); ctx.fill();
  for (let k = 0; k < 3; k++) {
    const w = s * (0.8 - k * 0.2), yy = y - s * 0.5 - k * s * 0.5;
    ctx.fillStyle = dark ? 'rgba(60,40,50,0.85)' : 'rgba(246,240,226,0.95)'; ctx.fillRect(x - w * 0.8, yy - s * 0.38, w * 1.6, s * 0.38);
    ctx.fillStyle = dark ? 'rgba(30,14,20,0.9)' : 'rgba(60,64,80,0.85)'; ctx.beginPath(); ctx.moveTo(x - w * 1.15, yy - s * 0.32); ctx.quadraticCurveTo(x, yy - s * 0.6, x + w * 1.15, yy - s * 0.32); ctx.lineTo(x + w * 0.8, yy - s * 0.48); ctx.lineTo(x - w * 0.8, yy - s * 0.48); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#c9a54a'; ctx.fillRect(x - s * 0.04, y - s * 2.15, s * 0.08, s * 0.18);
}
function wall(ctx, x, y, w, s) { // fortress wall with a tiled top
  ctx.fillStyle = 'rgba(110,100,96,0.75)'; ctx.fillRect(x, y - s, w, s);
  ctx.fillStyle = 'rgba(40,24,30,0.85)'; ctx.fillRect(x - s * 0.15, y - s * 1.15, w + s * 0.3, s * 0.2);
  ctx.strokeStyle = 'rgba(60,50,46,0.5)'; ctx.lineWidth = 1; for (let k = 1; k < w / (s * 0.8); k++) { ctx.beginPath(); ctx.moveTo(x + k * s * 0.8, y - s); ctx.lineTo(x + k * s * 0.8, y); ctx.stroke(); }
}
function banner(ctx, x, y, s) {
  ctx.strokeStyle = 'rgba(40,30,24,0.8)'; ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 1.6); ctx.stroke();
  ctx.fillStyle = 'rgba(150,30,40,0.85)'; ctx.fillRect(x + s * 0.05, y - s * 1.55, s * 0.4, s * 0.9);
}
// a tea house by a consumable path: a small house with a green noren and a 茶 lantern
function teaHouseIcon(ctx, x, y, s) {
  house(ctx, x, y, s, 'rgba(70,52,40,0.9)', false);
  ctx.fillStyle = '#3f6e34'; ctx.fillRect(x - s * 0.45, y - s * 0.55, s * 0.9, s * 0.22);
  ctx.fillStyle = 'rgba(248,226,176,0.95)'; ctx.beginPath(); ctx.ellipse(x + s * 0.95, y - s * 0.55, s * 0.18, s * 0.25, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#b52a22'; ctx.font = `800 ${Math.round(s * 0.28)}px ${FONT_SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('茶', x + s * 0.95, y - s * 0.54);
}
function wavesAlong(ctx, pts, u) { // little seigaiha wave marks on the river
  ctx.strokeStyle = 'rgba(60,100,130,0.35)'; ctx.lineWidth = 1.2 * u;
  for (let i = 2; i < pts.length - 2; i += 3) { const [x, y] = pts[i]; for (const dy of [-4, 4]) { ctx.beginPath(); ctx.arc(x, y + dy * u, 4 * u, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); } }
}
function compass(ctx, x, y, r, u) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(90,50,30,0.7)'; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, TAU); ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU - Math.PI / 2, l = k % 2 ? r * 0.5 : r * 0.78;
    ctx.fillStyle = k === 0 ? '#a8322a' : k % 2 ? 'rgba(90,60,40,0.5)' : 'rgba(60,40,30,0.75)';
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * l, Math.sin(a) * l); ctx.lineTo(Math.cos(a + 0.35) * r * 0.16, Math.sin(a + 0.35) * r * 0.16); ctx.lineTo(Math.cos(a - 0.35) * r * 0.16, Math.sin(a - 0.35) * r * 0.16); ctx.closePath(); ctx.fill();
  }
  txt(ctx, '北', 0, -r - 9 * u, 12 * u, '#a8322a', 800, FONT_SERIF);
  ctx.restore();
}
function cranes(ctx, x, y, u, t) { // a few cranes in flight, ink strokes
  ctx.strokeStyle = 'rgba(40,30,30,0.55)'; ctx.lineWidth = 1.4 * u; ctx.lineCap = 'round';
  for (const [dx, dy, s] of [[0, 0, 1], [18, 8, 0.8], [-14, 10, 0.75], [34, 16, 0.65]]) {
    const f = Math.sin(t * 3 + dx) * 2 * u * s, cx = x + dx * u + t * 3 * u % 1, cy = y + dy * u;
    ctx.beginPath(); ctx.moveTo(cx - 8 * u * s, cy - 2 * u * s + f); ctx.quadraticCurveTo(cx - 3 * u * s, cy - 4 * u * s, cx, cy); ctx.quadraticCurveTo(cx + 3 * u * s, cy - 4 * u * s, cx + 8 * u * s, cy - 2 * u * s + f); ctx.stroke();
  }
}
function pagoda(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(60,40,36,0.6)';
  for (let k = 0; k < 3; k++) { const w = s * (1 - k * 0.22), yy = y - k * s * 0.55; ctx.fillRect(x - w * 0.35, yy - s * 0.35, w * 0.7, s * 0.35); ctx.beginPath(); ctx.moveTo(x - w * 0.7, yy - s * 0.3); ctx.quadraticCurveTo(x, yy - s * 0.55, x + w * 0.7, yy - s * 0.3); ctx.lineTo(x + w * 0.45, yy - s * 0.42); ctx.lineTo(x - w * 0.45, yy - s * 0.42); ctx.closePath(); ctx.fill(); }
  ctx.fillRect(x - s * 0.03, y - s * 1.9, s * 0.06, s * 0.4);
}
function torii(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(168,50,42,0.7)';
  ctx.fillRect(x - s * 0.5, y - s, s * 0.12, s); ctx.fillRect(x + s * 0.38, y - s, s * 0.12, s);
  ctx.beginPath(); ctx.moveTo(x - s * 0.75, y - s * 1.05); ctx.quadraticCurveTo(x, y - s * 0.95, x + s * 0.75, y - s * 1.05); ctx.lineTo(x + s * 0.68, y - s * 0.9); ctx.lineTo(x - s * 0.68, y - s * 0.9); ctx.closePath(); ctx.fill();
  ctx.fillRect(x - s * 0.6, y - s * 0.78, s * 1.2, s * 0.08);
}
function boat(ctx, x, y, u) {
  ctx.fillStyle = 'rgba(60,40,30,0.65)'; ctx.beginPath(); ctx.moveTo(x - 12 * u, y); ctx.quadraticCurveTo(x, y + 6 * u, x + 12 * u, y); ctx.lineTo(x + 9 * u, y - 2 * u); ctx.lineTo(x - 9 * u, y - 2 * u); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(40,30,24,0.6)'; ctx.lineWidth = 1 * u; ctx.beginPath(); ctx.moveTo(x + 4 * u, y - 2 * u); ctx.lineTo(x + 10 * u, y - 14 * u); ctx.stroke();
  ctx.fillStyle = 'rgba(200,160,80,0.6)'; ctx.beginPath(); ctx.moveTo(x - 4 * u, y - 4 * u); ctx.lineTo(x + 1 * u, y - 9 * u); ctx.lineTo(x + 6 * u, y - 4 * u); ctx.closePath(); ctx.fill(); // a straw hat
}

// ---------------------------------------------------------------- the screen
export class RouteScreen {
  constructor(g) { this.g = g; this.active = false; }

  // next = the level about to be chosen; readonly = online joiner (the host picks)
  open(route, next, { readonly = false, onChoose = () => {}, sel = 0 } = {}) {
    this.peek = false; this.route = route; this.next = next; this.readonly = readonly; this.onChoose = onChoose;
    this.col = next - route.first;
    this.reveal = null; this.sel = clamp(sel, 0, this.options.length - 1); this.t = 0; this.chosen = -1; this.goT = 0; this.active = true;
    this.hover = -1; this.hoverKid = null; this.look = null;
    this.lastMouse = input.mouse.lastMove;
    sfx.flip();
  }
  get options() { return this.route.cols[this.col].nodes; }

  setSel(i) { if (i !== this.sel && i >= 0 && i < this.options.length) { this.sel = i; sfx.move(); if (this.onSel) this.onSel(i); } }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    if (this.reveal) { // the chosen node turns out corrupted: play it out, then go
      const R = this.reveal, t0 = R.t; R.t += dt;
      for (const at of R.thunder) if (t0 < at && R.t >= at) sfx.thunder();
      if (R.t >= R.dur && !R.done) { R.done = true; this.active = false; if (R.cb) R.cb(); }
      return;
    }
    if (this.chosen >= 0) {
      this.goT += dt;
      if (this.goT > 1.05) { this.active = false; this.onChoose(this.chosen); }
      return;
    }
    if (this.t < 0.8) return;
    const n = this.options.length, kids = this.kidList();
    // keys / controller: up and down pick a path; right looks ahead at the greyed paths beyond (up and down then
    // step through them, showing their tooltips), left comes back. The joiner can look ahead too.
    if (this.look != null && !kids.length) this.look = null;
    if (input.pressed('right') && kids.length && this.look == null) { this.look = Math.max(0, kids.findIndex((K) => K.i === this.sel)); sfx.move(); }
    else if (input.pressed('left') && this.look != null) { this.look = null; sfx.move(); }
    else if (input.pressed('up') || input.pressed('down')) {
      const d = input.pressed('up') ? -1 : 1;
      if (this.look != null) { this.look = (this.look + d + kids.length) % kids.length; sfx.move(); if (!this.readonly) this.setSel(kids[this.look].i); }
      else if (!this.readonly) this.setSel((this.sel + d + n) % n);
    }
    // mouse: hover a path's card to select it (and see its tooltip), click to travel
    const m = input.mouse, v = this.g.view;
    let hov = -1, kid = null;
    if (this.layoutCache) {
      const mx = m.x * v.dpr, my = m.y * v.dpr, h = this.L.nodeH;
      this.options.forEach((nd, i) => { const [x, y] = this.nodePos(this.col, i); if (Math.hypot(mx - x, my - y) < h * 0.7) hov = i; });
      // the greyed paths after these: hover one to see what it is
      if (hov < 0) kids.forEach((K) => { const [x, y] = this.kidPos(K.i, K.k); if (Math.hypot(mx - x, my - y) < h * 0.6) kid = K; });
    }
    if ((hov >= 0 || kid) && m.lastMove !== this.lastMouse) this.look = null; // the mouse takes over
    this.hover = hov; this.hoverKid = kid || (this.look != null ? kids[this.look] : null);
    if (this.readonly) return; // online joiner: sees the tooltips (the host's pick, or a path they hover) but the host chooses
    if (hov >= 0 && m.lastMove !== this.lastMouse) { this.setSel(hov); this.lastMouse = m.lastMove; }
    // the corner button (mouse only): the next node turns out corrupted
    if (m.clicked && this.corruptRect) {
      const [bx, by, bw, bh] = this.corruptRect, mx = m.x * v.dpr, my = m.y * v.dpr;
      if (mx > bx && mx < bx + bw && my > by && my < by + bh) { this.g.forceCorrupt = !this.g.forceCorrupt; sfx.select(); m.clicked = false; return; }
    }
    if (input.pressed('confirm') || (m.clicked && hov >= 0)) {
      input.eat('confirm');
      this.choose(hov >= 0 && m.clicked ? hov : this.look != null && kids[this.look] ? kids[this.look].i : this.sel);
    }
  }
  choose(i) {
    if (this.chosen >= 0) return;
    this.sel = i; this.chosen = i; this.goT = 0;
    sfx.select(); sfx.gate();
  }

  layout() {
    const v = this.g.view, u = clamp(Math.min(v.W / 1280, v.H / 760), 0.5, 4);
    const sw = Math.min(v.W * 0.92, 1500 * u), sh = Math.min(v.H * 0.6, sw * 0.42);
    const sx = (v.W - sw) / 2, sy = v.H * 0.15;
    const rollW = 18 * u;
    const px = sx + rollW, pw = sw - rollW * 2;
    this.L = { u, sx, sy, sw, sh, px, pw, py: sy, ph: sh, rollW, nodeR: 22 * u, nodeH: 40 * u, pad: 70 * u };
    this.layoutCache = true;
    return this.L;
  }
  // where a node sits: its column, its row, and a little seeded wandering so the road is not a grid
  nodePos(c, i) {
    const L = this.L, R = this.route, n = R.cols.length;
    const step = (L.pw - L.pad * 2) / (n - 1);
    const nodes = (R.cols[c] && R.cols[c].nodes) || [];
    if (!nodes[i]) i = clamp(i | 0, 0, Math.max(0, nodes.length - 1)); // (an index from another map: snap to a real node)
    const jx = c === 0 || c === n - 1 ? 0 : (hash(R.seed % 997, c, i) - 0.5) * step * 0.35;
    const jy = (hash(R.seed % 991, c, i + 7) - 0.5) * (nodes.length > 1 ? 0.14 : 0.3);
    const x = L.px + L.pad + c * step + jx;
    const y = L.py + L.ph * clamp((nodes[i] ? nodes[i].y : 0.5) + jy, 0.24, 0.78);
    return [x, y];
  }
  // a crooked trail between two nodes: a curve with a couple of seeded bends
  trail(c, i, j) {
    const [x1, y1] = this.nodePos(c, i), [x2, y2] = this.nodePos(c + 1, j), u = this.L.u, S = this.route.seed % 983;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    const amp = (10 + hash(S, c, i * 3 + j) * 14) * u, waves = 1 + Math.floor(hash(S, c + 5, j) * 2), ph = hash(S, c, j + 9) * TAU;
    const pts = [];
    for (let k = 0; k <= 28; k++) {
      const q = k / 28, off = Math.sin(q * Math.PI * waves + ph) * Math.sin(q * Math.PI) * amp;
      pts.push([x1 + dx * q + nx * off, y1 + dy * q + ny * off]);
    }
    return pts;
  }
  // the greyed-out paths one level further: the two follow-ups of each path on offer (not the boss)
  kidList() {
    const out = [], n = this.route.cols.length;
    if (this.col + 1 >= n - 1) return out;
    this.options.forEach((nd, i) => (nd.kids || []).forEach((kd, k) => out.push({ i, k, nd: kd })));
    return out;
  }
  kidPos(i, k) {
    const L = this.L, R = this.route, n = R.cols.length, step = (L.pw - L.pad * 2) / (n - 1), c = this.col + 1;
    const nd = this.options[i], kd = nd && nd.kids && nd.kids[k];
    const jx = (hash(R.seed % 997, c, i * 2 + k + 11) - 0.5) * step * 0.3;
    const y = clamp(kd ? kd.y : 0.5, 0.12, 0.88);
    return [L.px + L.pad + c * step + jx, L.py + L.ph * y];
  }
  // a crooked trail between two points (seeded by a, b)
  trailPts(x1, y1, x2, y2, a, b) {
    const u = this.L.u, S = this.route.seed % 983;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    const amp = (8 + hash(S, a, b * 3) * 10) * u, ph = hash(S, a + 3, b + 5) * TAU, pts = [];
    for (let k = 0; k <= 20; k++) { const q = k / 20, off = Math.sin(q * Math.PI * 1.5 + ph) * Math.sin(q * Math.PI) * amp; pts.push([x1 + dx * q + nx * off, y1 + dy * q + ny * off]); }
    return pts;
  }
  // path index the team took in column c (null if this run started later in the area)
  taken(c) { const p = this.route.path[c], col = this.route.cols[c]; return p === undefined || p === null || !col || !col.nodes[p] ? null : p; }

  draw(ctx) {
    if (!this.active || !this.route) return;
    const v = this.g.view, L = this.layout(), u = L.u, t = this.t, R = this.route;
    const open = ease.outCubic(clamp(t / 0.7, 0, 1));
    const area = R.area, biome = BIOMES[Math.min(area, BIOMES.length - 1)];
    ctx.save();
    // darkened backdrop
    ctx.fillStyle = `rgba(8,6,12,${0.86 * clamp(t / 0.3, 0, 1)})`; ctx.fillRect(0, 0, v.W, v.H);
    // header
    ctx.globalAlpha = clamp((t - 0.2) / 0.4, 0, 1);
    if (this.peek) { // looked at from the pause menu
      txt(ctx, `Area ${area + 1} · ${biome.name}`, v.W / 2, L.sy - 52 * u, 34 * u, '#f8f0de', 800, FONT_SERIF);
      txt(ctx, `Your route · hover a node to see it · ${input.mode === 'pad' ? 'Ⓑ' : 'Esc'} to close`, v.W / 2, L.sy - 20 * u, 14 * u, 'rgba(248,240,222,0.8)', 700);
    } else {
    txt(ctx, this.col === 0 ? `Area ${area + 1} · ${biome.name}` : 'Choose your route', v.W / 2, L.sy - 52 * u, 34 * u, '#f8f0de', 800, FONT_SERIF);
    txt(ctx, this.col === 0 ? 'A new land lies ahead' : `Level ${this.next} · each node shows the reward that path leads to`, v.W / 2, L.sy - 20 * u, 14 * u, 'rgba(248,240,222,0.8)', 700);
    }
    ctx.globalAlpha = 1;

    // ---- the scroll unrolls from the centre
    const cx = v.W / 2, half = (L.pw / 2) * open;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - half, L.py - 4, half * 2, L.ph + 8); ctx.clip();
    this.drawPaper(ctx, L, biome, area, t);
    this.drawPaths(ctx, L, t);
    this.drawNodes(ctx, L, t);
    this.drawFog(ctx, L, t);
    this.drawMarker(ctx, L, t);
    this.drawBossTrack(ctx, L, t);
    ctx.restore();
    // rollers at both ends
    for (const s of [-1, 1]) {
      const rx = cx + s * (half + L.rollW / 2);
      const g = ctx.createLinearGradient(rx - L.rollW / 2, 0, rx + L.rollW / 2, 0);
      g.addColorStop(0, '#2a1610'); g.addColorStop(0.45, '#6a3a22'); g.addColorStop(1, '#1a0c08');
      ctx.fillStyle = g; ctx.fillRect(rx - L.rollW / 2, L.py - 10 * u, L.rollW, L.ph + 20 * u);
      ctx.fillStyle = '#c9a54a';
      for (const yy of [L.py - 18 * u, L.py + L.ph + 10 * u]) { rr(ctx, rx - L.rollW * 0.4, yy, L.rollW * 0.8, 8 * u, 3 * u); ctx.fill(); }
    }
    this.drawTooltip(ctx, L, t);
    this.drawInfo(ctx, L, t);
    this.drawCorruptButton(ctx, L, t);
    if (this.reveal) this.drawReveal(ctx, L);
    ctx.restore();
  }

  drawPaper(ctx, L, biome, area, t) {
    const { px, py, pw, ph, u } = L;
    const g = ctx.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, '#efe0bc'); g.addColorStop(0.5, '#f3e7c8'); g.addColorStop(1, '#e2cc9c');
    ctx.fillStyle = g; ctx.fillRect(px, py, pw, ph);
    const rng = seededRng(this.route.seed);
    // fibres and age spots
    ctx.strokeStyle = 'rgba(150,120,80,0.12)'; ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) { const x = px + rng() * pw, y = py + rng() * ph, l = 6 + rng() * 18; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + (rng() - 0.5) * 4); ctx.stroke(); }
    for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(150,100,50,${0.04 + rng() * 0.05})`; ctx.beginPath(); ctx.arc(px + rng() * pw, py + rng() * ph, (8 + rng() * 26) * u, 0, TAU); ctx.fill(); }
    if (area === 3) { this.fortressPlan(ctx, L, rng, t); return; }
    // a river winding across the middle, with wave marks and a ferryman
    const river = [];
    for (let i = 0; i <= 40; i++) { const k = i / 40; river.push([px + k * pw, py + ph * (0.52 + Math.sin(k * 7 + area) * 0.09 + (k - 0.5) * 0.06)]); }
    ctx.strokeStyle = 'rgba(90,130,150,0.26)'; ctx.lineWidth = 18 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); river.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.strokeStyle = 'rgba(60,100,130,0.4)'; ctx.lineWidth = 1.2 * u; ctx.stroke();
    wavesAlong(ctx, river, u);
    const bi = 8 + Math.floor(rng() * 20); boat(ctx, river[bi][0], river[bi][1] + 2 * u, u);
    // mountains along the top and bottom edges
    const tint = ['rgba(120,140,150,0.32)', 'rgba(160,90,70,0.3)', 'rgba(70,80,120,0.32)', 'rgba(70,64,70,0.36)'][area] || 'rgba(100,100,110,0.3)';
    for (let i = 0; i < 9; i++) { const w = (90 + rng() * 120) * u, x = px + rng() * (pw - w); mountain(ctx, x, py + ph * 0.17, w, (40 + rng() * 45) * u, rng, tint); }
    for (let i = 0; i < 6; i++) { const w = (80 + rng() * 100) * u, x = px + rng() * (pw - w); mountain(ctx, x, py + ph * 0.99, w, (30 + rng() * 30) * u, rng, tint); }
    // the area's scenery, kept clear of the nodes
    const spots = [], nC = this.route.cols.length, stepX = (L.pw - L.pad * 2) / (nC - 1);
    for (let c = 0; c < nC; c++) for (const yy of [0.18, 0.3, 0.42, 0.5, 0.58, 0.7, 0.82]) spots.push([L.px + L.pad + c * stepX, L.py + L.ph * yy]);
    const free = (x, y, d) => spots.every(([nx, ny]) => Math.hypot(nx - x, ny - y) > d);
    const place = (count, d, draw, band = 'any') => {
      for (let i = 0, made = 0; i < count * 6 && made < count; i++) {
        const x = px + 50 * u + rng() * (pw - 100 * u);
        const y = band === 'edge' ? (rng() < 0.5 ? py + ph * (0.1 + rng() * 0.1) : py + ph * (0.84 + rng() * 0.1)) : py + ph * (0.1 + rng() * 0.84);
        if (!free(x, y, d)) continue;
        draw(x, y); made++;
      }
    };
    if (area === 0) { // Haruno: rice paddies, cherry trees, farmhouses, a pond with a red bridge
      place(2, 80 * u, (x, y) => pond(ctx, x, y, 46 * u, 22 * u, false, true, u));
      place(18, 40 * u, (x, y) => blossomTree(ctx, x, y, 15 * u, ['rgba(244,170,190,0.85)', 'rgba(250,200,214,0.85)', 'rgba(236,140,168,0.85)']));
      place(8, 46 * u, (x, y) => house(ctx, x, y, 16 * u, 'rgba(150,110,60,0.85)', false));
      place(7, 36 * u, (x, y) => blossomTree(ctx, x, y, 13 * u, ['rgba(90,140,80,0.75)', 'rgba(110,160,90,0.75)']));
    } else if (area === 1) { // Momiji: big mountains, maples and ginkgo, bamboo, a shrine gate
      for (let i = 0; i < 4; i++) { const w = (120 + rng() * 120) * u, x = px + rng() * (pw - w); mountain(ctx, x, py + ph * (0.3 + rng() * 0.5), w, (40 + rng() * 40) * u, rng, 'rgba(170,100,70,0.22)'); }
      place(20, 38 * u, (x, y) => blossomTree(ctx, x, y, 15 * u, ['rgba(210,70,40,0.85)', 'rgba(230,110,50,0.85)', 'rgba(190,50,40,0.85)']));
      place(8, 38 * u, (x, y) => blossomTree(ctx, x, y, 14 * u, ['rgba(236,190,60,0.85)', 'rgba(246,210,90,0.85)']));
      place(6, 40 * u, (x, y) => bamboo(ctx, x, y, 17 * u));
      place(2, 56 * u, (x, y) => torii(ctx, x, y, 26 * u));
      place(4, 46 * u, (x, y) => house(ctx, x, y, 15 * u, 'rgba(110,70,50,0.85)', false));
    } else if (area === 2) { // Yukishiro: snow, pines, a castle town with lanterns, a frozen pond
      ctx.fillStyle = 'rgba(220,232,245,0.22)'; ctx.fillRect(px, py, pw, ph);
      place(1, 90 * u, (x, y) => castle(ctx, x, y, 34 * u, false), 'edge');
      place(12, 46 * u, (x, y) => house(ctx, x, y, 16 * u, 'rgba(70,74,90,0.85)', true));
      place(20, 36 * u, (x, y) => snowPine(ctx, x, y, 17 * u, true));
      place(6, 34 * u, (x, y) => lanternStone(ctx, x, y, 17 * u));
      place(1, 80 * u, (x, y) => pond(ctx, x, y, 46 * u, 20 * u, true, false, u));
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < 60; i++) { ctx.beginPath(); ctx.arc(px + rng() * pw, py + rng() * ph, (0.8 + rng() * 1.2) * u, 0, TAU); ctx.fill(); }
    } else { // Kagerō: the dark fortress, walls, pines, war banners
      ctx.fillStyle = 'rgba(60,30,40,0.1)'; ctx.fillRect(px, py, pw, ph);
      place(1, 100 * u, (x, y) => castle(ctx, x, y, 40 * u, true), 'edge');
      place(6, 60 * u, (x, y) => wall(ctx, x - 45 * u, y, 90 * u, 14 * u));
      place(16, 36 * u, (x, y) => snowPine(ctx, x, y, 16 * u, false));
      place(10, 34 * u, (x, y) => banner(ctx, x, y, 18 * u));
      place(5, 34 * u, (x, y) => lanternStone(ctx, x, y, 16 * u));
    }
    cranes(ctx, px + pw * (0.45 + rng() * 0.2), py + ph * 0.08, u, t);
    compass(ctx, px + pw - 46 * u, py + ph - 40 * u, 24 * u, u);
    // aged, darker edges and a thin ink border
    const e = ctx.createRadialGradient(px + pw / 2, py + ph / 2, Math.min(pw, ph) * 0.4, px + pw / 2, py + ph / 2, Math.max(pw, ph) * 0.62);
    e.addColorStop(0, 'rgba(120,80,40,0)'); e.addColorStop(1, 'rgba(110,70,30,0.32)');
    ctx.fillStyle = e; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = 'rgba(90,50,30,0.55)'; ctx.lineWidth = 1.5 * u; ctx.strokeRect(px + 8 * u, py + 8 * u, pw - 16 * u, ph - 16 * u);
    ctx.lineWidth = 0.7 * u; ctx.strokeRect(px + 12 * u, py + 12 * u, pw - 24 * u, ph - 24 * u);
    // title cartouche (vertical, top-left) with the area's name in kanji
    const cw = 30 * u, chh = Math.min(ph * 0.55, (biome.jp.length * 26 + 20) * u), cxx = px + 20 * u, cyy = py + 18 * u;
    ctx.fillStyle = '#f8f0dc'; ctx.fillRect(cxx, cyy, cw, chh);
    ctx.strokeStyle = '#a8322a'; ctx.lineWidth = 2 * u; ctx.strokeRect(cxx, cyy, cw, chh);
    ctx.lineWidth = 0.8 * u; ctx.strokeRect(cxx + 3 * u, cyy + 3 * u, cw - 6 * u, chh - 6 * u);
    [...biome.jp].forEach((ch, i) => txt(ctx, ch, cxx + cw / 2, cyy + 18 * u + i * 24 * u, 19 * u, INK, 800, FONT_SERIF));
    // the map maker's seal
    ctx.save(); ctx.translate(px + 40 * u, py + ph - 38 * u); ctx.rotate(-0.06);
    ctx.fillStyle = 'rgba(181,42,34,0.85)'; rr(ctx, -15 * u, -15 * u, 30 * u, 30 * u, 3 * u); ctx.fill();
    txt(ctx, '影', 0, -6 * u, 11 * u, '#fbefe0', 800, FONT_SERIF); txt(ctx, '道', 0, 7 * u, 11 * u, '#fbefe0', 800, FONT_SERIF);
    ctx.restore();
  }

  // only the road the team walked, and the paths on offer now
  drawPaths(ctx, L, t) {
    const R = this.route, u = L.u;
    const line = (pts) => { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // the road behind: a solid ink trail with footsteps
    for (let c = 0; c < this.col - 1; c++) {
      const a = this.taken(c), b = this.taken(c + 1);
      if (a === null || b === null) continue;
      const pts = this.trail(c, a, b);
      ctx.strokeStyle = 'rgba(120,40,30,0.25)'; ctx.lineWidth = 9 * u; line(pts);
      ctx.strokeStyle = '#8a2a22'; ctx.lineWidth = 3 * u; line(pts);
    }
    // the paths on offer: dashed, the selected one bold and moving
    const from = this.col - 1;
    if (from >= 0 && this.taken(from) !== null) {
      this.options.forEach((_, j) => {
        const pts = this.trail(from, this.taken(from), j), isSel = j === this.sel;
        ctx.setLineDash([9 * u, 7 * u]); ctx.lineDashOffset = isSel ? -t * 30 * u : 0;
        ctx.strokeStyle = isSel ? '#c8302e' : 'rgba(110,70,50,0.55)'; ctx.lineWidth = (isSel ? 4 : 2.2) * u; line(pts);
      });
      ctx.setLineDash([]);
    }
    // the paths beyond: faint dotted trails from each path on offer to its two follow-ups (or to the boss)
    ctx.setLineDash([3 * u, 6 * u]); ctx.lineWidth = 1.6 * u;
    for (const K of this.kidList()) {
      const [x1, y1] = this.nodePos(this.col, K.i), [x2, y2] = this.kidPos(K.i, K.k), lit = (this.hover >= 0 ? this.hover : this.sel) === K.i && this.chosen < 0;
      ctx.strokeStyle = lit ? 'rgba(140,60,40,0.55)' : 'rgba(110,80,60,0.3)'; line(this.trailPts(x1, y1, x2, y2, this.col * 7 + K.i, K.k));
    }
    if (this.col + 1 === R.cols.length - 1) this.options.forEach((_, i) => { const [x1, y1] = this.nodePos(this.col, i), [x2, y2] = this.nodePos(this.col + 1, 0); ctx.strokeStyle = 'rgba(110,60,50,0.35)'; line(this.trailPts(x1, y1, x2, y2, this.col * 7 + i, 9)); });
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawNodes(ctx, L, t) {
    const R = this.route, u = L.u, n = R.cols.length;
    R.cols.forEach((col, c) => {
      const boss = c === n - 1 && BOSSES[col.level];
      col.nodes.forEach((nd, i) => {
        const [x, y] = this.nodePos(c, i);
        const past = c < this.col, choice = c === this.col, hidden = c > this.col;
        const tk = this.taken(c), walked = past && tk === i;
        if (nd.r === 'item' && !boss && !hidden && (!past || walked)) teaHouseIcon(ctx, x + L.nodeH * 0.55 + 22 * u, y + 6 * u, 20 * u); // the tea house you rest at
        if (past && !walked) { // a path not taken: just a faint dot
          ctx.fillStyle = 'rgba(90,60,40,0.3)'; ctx.beginPath(); ctx.arc(x, y, 3 * u, 0, TAU); ctx.fill();
          return;
        }
        const sel = choice && i === this.sel;
        let h = L.nodeH * (choice ? 1.1 : walked ? 0.62 : 0.7);
        if (sel) h *= 1.12 + 0.04 * Math.sin(t * 5) + (this.chosen >= 0 ? 0.06 : 0);
        ctx.save();
        if (boss) this.drawBossNode(ctx, x, y, h, col.level, hidden, t);
        else nodeCard(ctx, x, y, h, nd.r, REWARDS[nd.r].jp, { hidden, sel, option: choice && this.chosen < 0, past: walked, t });
        if (walked) { // visited: an ink tick
          ctx.strokeStyle = 'rgba(20,14,14,0.7)'; ctx.lineWidth = 2.5 * u; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x - h * 0.22, y + h * 0.05); ctx.lineTo(x - h * 0.05, y + h * 0.22); ctx.lineTo(x + h * 0.28, y - h * 0.22); ctx.stroke();
        }
        if (choice && !boss) { // the reward's name on a little paper label
          ctx.font = `800 ${Math.round(12 * u)}px ${FONT_SERIF}`; const lw = ctx.measureText(REWARDS[nd.r].name).width + 14 * u, ly = y + h * 0.5 + 14 * u;
          rr(ctx, x - lw / 2, ly - 9 * u, lw, 18 * u, 9 * u); ctx.fillStyle = sel ? '#7a1a14' : 'rgba(250,242,222,0.92)'; ctx.fill(); ctx.strokeStyle = 'rgba(90,60,40,0.6)'; ctx.lineWidth = 1 * u; ctx.stroke();
          txt(ctx, REWARDS[nd.r].name, x, ly, 12 * u, sel ? '#fbefe0' : '#3a2418', 800, FONT_SERIF);
        }
        ctx.restore();
      });
    });
    // the greyed-out paths one level further (hover one to see what it holds)
    for (const K of this.kidList()) {
      const [x, y] = this.kidPos(K.i, K.k), hv = this.hoverKid && this.hoverKid.i === K.i && this.hoverKid.k === K.k;
      const lit = (this.hover >= 0 ? this.hover : this.sel) === K.i && this.chosen < 0;
      // pre-rendered greyed sprites: a live ctx.filter here cost ~13 ms a frame and made the map lag
      const spr = greyCard(K.nd.r, L.nodeH * 0.66, hv ? 0.25 : 0.85);
      ctx.save(); ctx.globalAlpha = hv ? 0.95 : lit ? 0.7 : 0.48;
      ctx.drawImage(spr, x - spr.width / 2, y - spr.height / 2);
      ctx.restore();
    }
  }

  drawBossNode(ctx, x, y, h, level, hidden, t) {
    const u = this.L.u, r = h * 0.55;
    // a small torii over the boss card
    ctx.save(); ctx.translate(x, y - h * 0.15);
    ctx.fillStyle = '#a8322a'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5 * u;
    ctx.fillRect(-r * 0.95, -r * 1.25, 4 * u, r * 1.1); ctx.fillRect(r * 0.95 - 4 * u, -r * 1.25, 4 * u, r * 1.1);
    ctx.beginPath(); ctx.moveTo(-r * 1.25, -r * 1.35); ctx.quadraticCurveTo(0, -r * 1.25, r * 1.25, -r * 1.35); ctx.lineTo(r * 1.15, -r * 1.18); ctx.lineTo(-r * 1.15, -r * 1.18); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillRect(-r * 1.05, -r * 1.02, r * 2.1, 3 * u);
    ctx.restore();
    nodeCard(ctx, x, y, h * 1.15, 'boss', '鬼', { hidden: false, option: !hidden && this.col === this.route.cols.length - 1 && this.chosen < 0, t });
    const B = BOSSES[level];
    if (B && !hidden) txt(ctx, B.name, x, y + h * 0.5 + 11 * u, 11 * u, '#5a0a12', 800, FONT_SERIF);
  }

  // undiscovered levels hide under drifting kasumi clouds
  drawFog(ctx, L, t) {
    if (this.col + 1 >= this.route.cols.length - 1) return;
    const u = L.u;
    const [nx] = this.kidPos(0, 0);
    const [nx2] = this.nodePos(Math.min(this.route.cols.length - 1, this.col + 2), 0);
    const fx = Math.max(nx + L.nodeH * 0.9, nx + (nx2 - nx) * 0.72);
    const g = ctx.createLinearGradient(fx - 30 * u, 0, fx + 60 * u, 0);
    g.addColorStop(0, 'rgba(240,230,205,0)'); g.addColorStop(1, 'rgba(240,230,205,0.82)');
    ctx.fillStyle = g; ctx.fillRect(fx - 30 * u, L.py, L.px + L.pw - fx + 30 * u, L.ph);
    ctx.save(); ctx.beginPath(); ctx.rect(fx - 10 * u, L.py, L.px + L.pw - fx + 10 * u, L.ph); ctx.clip();
    const rng = seededRng(this.route.seed + 7);
    for (let i = 0; i < 16; i++) {
      const w = (110 + rng() * 140) * u, h = (14 + rng() * 10) * u;
      const x = fx + ((rng() * (L.px + L.pw - fx + w) + t * (6 + rng() * 8) * u) % (L.px + L.pw - fx + w)) - w * 0.5;
      kasumi(ctx, x, L.py + rng() * L.ph, w, h, 0.85);
    }
    ctx.restore();
  }

  // the team's banner: on the current node, or travelling along the chosen path
  drawMarker(ctx, L, t) {
    const u = L.u, prev = this.col - 1;
    let x, y;
    const target = this.chosen >= 0 ? this.chosen : this.sel;
    const [tx, ty] = this.nodePos(this.col, target);
    if (prev < 0 || this.taken(prev) === null) { x = tx - 60 * u; y = ty; }
    else { [x, y] = this.nodePos(prev, this.taken(prev)); }
    if (this.chosen >= 0) { // walk along the crooked trail
      const k = ease.inOutSine(clamp(this.goT / 0.9, 0, 1));
      if (prev >= 0 && this.taken(prev) !== null) { const pts = this.trail(prev, this.taken(prev), target), f = k * (pts.length - 1), a = Math.floor(f), b = Math.min(pts.length - 1, a + 1), q = f - a; x = lerp(pts[a][0], pts[b][0], q); y = lerp(pts[a][1], pts[b][1], q); }
      else { x = lerp(x, tx, k); y = lerp(y, ty, k); }
    }
    const bob = Math.sin(t * 4) * 2 * u, lift = this.chosen >= 0 ? 26 * u : L.nodeH * 0.36 + 22 * u;
    ctx.save(); ctx.translate(x, y - lift + bob);
    ctx.strokeStyle = INK; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(0, 22 * u); ctx.lineTo(0, -14 * u); ctx.stroke();
    ctx.fillStyle = '#c8302e'; ctx.beginPath(); ctx.moveTo(1, -14 * u); ctx.lineTo(16 * u, -11 * u + Math.sin(t * 6) * 1.5 * u); ctx.lineTo(1, -4 * u); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1 * u; ctx.stroke();
    ctx.restore();
  }

  // a small tooltip over the path under the cursor (or the selected one): what that reward is
  drawTooltip(ctx, L, t) {
    if (this.chosen >= 0 || this.t < 0.8) return;
    const K = this.hoverKid, i = this.hover >= 0 ? this.hover : this.sel, nd = K ? K.nd : this.options[i], col = this.route.cols[this.col + (K ? 1 : 0)];
    if (!nd || !col || BOSSES[col.level]) return;
    const u = L.u, R = REWARDS[nd.r], [x, y] = K ? this.kidPos(K.i, K.k) : this.nodePos(this.col, i);
    ctx.save(); ctx.globalAlpha = clamp((this.t - 0.8) / 0.25, 0, 1);
    const tip = TIP[nd.r] || R.desc;
    // lines: the place's name (towns, temples, libraries), what it gives, then its difficulty and rewards
    const lines = [];
    if (nd.name) lines.push({ text: nd.name, size: 12.5, col: '#f0c870', font: FONT_SERIF, weight: 800 });
    lines.push({ text: tip, size: 12, col: 'rgba(248,240,222,0.85)' });
    if (K) lines.push({ text: `Level ${this.next + 1} · after ${REWARDS[this.options[K.i].r].name}`, size: 11, col: 'rgba(200,190,170,0.75)' });
    if (nd.smuggled) lines.push({ text: "Smuggler's Map: a better road", size: 11, col: '#e8c070' });
    const stats = [];
    const TIERS = REWARD_TIERS.map((x) => x.name), DANGER = DIFFICULTY.map((x) => x.name); // Common+ / Rare+ / Epic+ / Legendary; Easy / Normal / Hard
    if (nd.d !== undefined) stats.push(['', DANGER[nd.d], diffTone(nd.d), 'diff']);
    // the rewards are only hinted: a Hard fight shows its tier one step low, Normal two, Easy three (never below Common+),
    // so an easy road is more of a gamble. (The cards themselves still roll on the real tier, nd.q.)
    if (nd.q !== undefined) { const shown = Math.max(0, nd.q - (nd.d === undefined ? 0 : 3 - nd.d)); stats.push(['', TIERS[shown], rewardTone(shown), 'rew']); }
    const font = (size, weight = 700, f = FONT_SANS) => { ctx.font = `${weight} ${Math.round(size * u)}px ${f}`; };
    let w = 90 * u;
    for (const l of lines) { font(l.size, l.weight, l.font); w = Math.max(w, ctx.measureText(l.text).width); }
    let statW = 0;
    for (const s2 of stats) { font(12); statW += ctx.measureText(s2[0]).width; font(12, 800); statW += ctx.measureText(s2[1]).width + 30 * u; }
    w = Math.max(w, statW) + 24 * u;
    const LH = 22 * u; // line spacing
    const h = 30 * u + lines.length * LH + (stats.length ? 26 * u : 0);
    const bx = clamp(x - w / 2, L.px + 6 * u, L.px + L.pw - w - 6 * u), by = y - L.nodeH * 0.7 - h - 14 * u;
    rr(ctx, bx, by, w, h, 6 * u); ctx.fillStyle = 'rgba(24,16,20,0.94)'; ctx.fill();
    ctx.strokeStyle = (NODE[nd.r] || NODE.stat).accent; ctx.lineWidth = 1.5 * u; ctx.stroke();
    ctx.fillStyle = 'rgba(24,16,20,0.94)'; ctx.beginPath(); ctx.moveTo(x - 7 * u, by + h); ctx.lineTo(x + 7 * u, by + h); ctx.lineTo(x, by + h + 8 * u); ctx.closePath(); ctx.fill();
    txt(ctx, `${R.jp}  ${R.name}`, bx + 12 * u, by + 17 * u, 14 * u, '#fff4d8', 800, FONT_SERIF, 'left');
    lines.forEach((l, k) => txt(ctx, l.text, bx + 12 * u, by + 38 * u + k * LH, l.size * u, l.col, l.weight || 700, l.font || FONT_SANS, 'left'));
    // the bottom row, always in the same places: danger bottom left (icon, then text), rewards bottom right (text, then icon)
    const sy = by + 38 * u + lines.length * LH + 4 * u;
    for (const [, val, tone, kind] of stats) {
      // danger Easy/Normal/Hard = green/orange/red; rewards in the card rarity colours (Common+ beige .. Legendary gold)
      const q = TIERS.indexOf(val), col = kind === 'diff' ? ['#ff3b2e', '#ffa22e', '#3ee05a'][2 - DANGER.indexOf(val)] : RARITIES[q].color;
      font(12, 800); const vw = ctx.measureText(val).width;
      const left = kind === 'diff', ix = left ? bx + 19 * u : bx + w - 19 * u, tx = left ? bx + 32 * u : bx + w - 32 * u - vw;
      indicator(ctx, ix, sy, 7.5 * u, tone, kind, true);
      txt(ctx, val, tx + 1 * u, sy + 1 * u, 12 * u, 'rgba(0,0,0,0.75)', 800, FONT_SANS, 'left'); // a dark drop so the colour stands off the paper
      txt(ctx, val, tx, sy, 12 * u, col, 800, FONT_SANS, 'left');
      if (kind === 'rew' && q === 3) legendaryShine(ctx, val, tx, sy, vw, u, t);
    }
    ctx.restore();
  }

  // the chosen node turned out corrupted: the map darkens and the corruption takes it (mist rolls in, lightning
  // strikes it, a blood moon rises), then its name. cb continues to the level.
  startReveal(kind, i, cb) {
    const v = this.g.view, u = this.L ? this.L.u : 1, [nx, ny] = this.layoutCache ? this.nodePos(this.col, i) : [v.W / 2, v.H / 2];
    const bolts = kind === 'storm' ? [0.45, 0.95, 1.35, 1.6].map((at) => {
      const pts = [], x0 = nx + (Math.random() - 0.5) * 220 * u;
      for (let k = 0; k <= 10; k++) { const f = k / 10; pts.push([x0 + (nx - x0) * f + (k && k < 10 ? (Math.random() - 0.5) * 46 * u : 0), -20 + (ny + 20) * f]); }
      return { at, pts };
    }) : [];
    this.active = true;
    this.reveal = { kind, i, cb, t: 0, dur: 2.6, nx, ny, bolts, thunder: bolts.map((b) => b.at), done: false };
    if (kind === 'mist') sfx.haunt(); else if (kind === 'bloodmoon') sfx.bossRoar();
  }
  drawReveal(ctx, L) {
    const R = this.reveal, u = L.u, v = this.g.view, W = v.W, H = v.H, t = R.t;
    const intro = clamp(t / 0.7, 0, 1), out = clamp((R.dur - t) / 0.35, 0, 1), e = ease.outCubic(intro);
    const CI = CORRUPT_INFO[R.kind], { nx, ny } = R;
    ctx.save();
    const tint = { mist: '24,28,36', storm: '6,8,22', bloodmoon: '10,2,8' }[R.kind];
    ctx.fillStyle = `rgba(${tint},${0.7 * e})`; ctx.fillRect(0, 0, W, H);
    if (R.kind === 'mist') { // banks of mist roll in from both sides and swallow the node
      for (let k = 0; k < 14; k++) {
        const side = k % 2 ? -1 : 1, row = Math.floor(k / 2), y = H * (0.12 + row * 0.13);
        const x = side > 0 ? -W * 0.25 + (W * 0.5 + 60 * u * row) * e : W * 1.25 - (W * 0.5 + 60 * u * row) * e;
        const r = (150 + (k * 37) % 90) * u, gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(208,214,222,${0.75 * e})`); gr.addColorStop(1, 'rgba(200,206,214,0)');
        ctx.fillStyle = gr; ctx.save(); ctx.translate(x, y); ctx.scale(1.8, 0.7); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.restore(); ctx.fill();
      }
    } else if (R.kind === 'storm') { // rain, and bolts that hit the node one after another
      ctx.strokeStyle = 'rgba(180,200,235,0.35)'; ctx.lineWidth = 1.2 * u; ctx.beginPath();
      for (let k = 0; k < 140; k++) { const x = ((k * 97.3 + t * 260) % (W + 60)) - 30, y = ((k * 53.7 + t * 1100) % (H + 60)) - 30; ctx.moveTo(x, y); ctx.lineTo(x - 5 * u, y - 22 * u); }
      ctx.stroke();
      for (const b of R.bolts) {
        const a = t >= b.at ? 1 - clamp((t - b.at) / 0.3, 0, 1) : 0;
        if (a <= 0) continue;
        ctx.fillStyle = `rgba(230,238,255,${0.55 * a})`; ctx.fillRect(0, 0, W, H); // the flash
        for (const [lw, col] of [[10 * u, `rgba(150,180,255,${0.45 * a})`], [3 * u, `rgba(255,255,255,${a})`]]) {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.beginPath(); b.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
        }
      }
    } else { // a blood moon rises behind the map
      const r = Math.min(W, H) * 0.17, mx = W * 0.5, my = H * (0.95 - 0.55 * ease.outCubic(clamp(t / 1.8, 0, 1)));
      const halo = ctx.createRadialGradient(mx, my, r * 0.8, mx, my, r * 2.6);
      halo.addColorStop(0, `rgba(170,30,40,${0.45 * e})`); halo.addColorStop(1, 'rgba(120,10,20,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, r * 2.6, 0, TAU); ctx.fill();
      const disc = ctx.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.1, mx, my, r);
      disc.addColorStop(0, `rgba(226,92,70,${0.95 * e})`); disc.addColorStop(1, `rgba(110,16,22,${0.95 * e})`);
      ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(mx, my, r, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(70,8,14,${0.35 * e})`;
      for (const [cx, cy, cr] of [[-0.3, -0.1, 0.18], [0.25, 0.2, 0.13], [0.1, -0.35, 0.09], [-0.1, 0.4, 0.11]]) { ctx.beginPath(); ctx.arc(mx + cx * r, my + cy * r, cr * r, 0, TAU); ctx.fill(); }
    }
    // the node itself: rings of the corruption pulsing outward
    const ring = { mist: '214,220,230', storm: '170,200,255', bloodmoon: '255,70,90' }[R.kind];
    for (let k = 0; k < 3; k++) {
      const f = ((t * 0.9 + k / 3) % 1), r = (20 + f * 90) * u;
      ctx.strokeStyle = `rgba(${ring},${(1 - f) * 0.8 * intro})`; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(nx, ny, r, 0, TAU); ctx.stroke();
    }
    // its name
    const a = clamp((t - 0.5) / 0.5, 0, 1) * out, sc = 1 + 0.25 * (1 - ease.outCubic(clamp((t - 0.5) / 0.6, 0, 1)));
    ctx.globalAlpha = a;
    ctx.save(); ctx.translate(W / 2, H * 0.4); ctx.scale(sc, sc);
    txt(ctx, CI.jp, 2 * u, 4 * u, 92 * u, 'rgba(0,0,0,0.6)', 800, FONT_SERIF);
    txt(ctx, CI.jp, 0, 0, 92 * u, `rgb(${ring})`, 800, FONT_SERIF);
    ctx.restore();
    txt(ctx, `Corrupted · ${CI.name}`, W / 2, H * 0.4 + 82 * u, 32 * u, '#f6eee6', 800, FONT_SERIF);
    txt(ctx, CI.sub, W / 2, H * 0.4 + 116 * u, 15 * u, 'rgba(240,226,220,0.8)', 700);
    ctx.restore();
  }

  // bottom right, mouse only (not for the online joiner): a small button that makes the next node corrupted
  drawCorruptButton(ctx, L, t) {
    this.corruptRect = null;
    if (this.readonly || this.chosen >= 0 || input.players[0].mode !== 'kbm' || t < 0.6) return;
    const u = L.u, v = this.g.view, on = !!this.g.forceCorrupt;
    const w = 192 * u, h = 30 * u, x = v.W - w - 18 * u, y = v.H - h - 18 * u;
    this.corruptRect = [x, y, w, h];
    const m = input.mouse, mx = m.x * v.dpr, my = m.y * v.dpr, hov = mx > x && mx < x + w && my > y && my < y + h;
    ctx.save();
    rr(ctx, x, y, w, h, 5 * u);
    ctx.fillStyle = on ? 'rgba(112,18,46,0.94)' : hov ? 'rgba(46,24,40,0.9)' : 'rgba(20,14,22,0.72)'; ctx.fill();
    ctx.strokeStyle = on ? '#ff7a96' : hov ? 'rgba(255,190,210,0.7)' : 'rgba(240,220,200,0.32)'; ctx.lineWidth = 1.5 * u; ctx.stroke();
    // a small blood-red eye-of-the-storm swirl as the icon
    const ix = x + 16 * u, iy = y + h / 2;
    ctx.strokeStyle = on ? '#ffd0dc' : '#d8607a'; ctx.lineWidth = 2 * u; ctx.beginPath();
    for (let a = 0; a < TAU * 1.6; a += 0.2) { const r = (1.5 + a * 1.25) * u; const px = ix + Math.cos(a + t * 2) * r, py = iy + Math.sin(a + t * 2) * r; a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    txt(ctx, on ? 'Next node: corrupted' : 'Corrupt next node', x + 32 * u, y + h / 2 + 0.5 * u, 12 * u, on ? '#fff0f4' : 'rgba(248,232,226,0.85)', 800, FONT_SANS, 'left');
    ctx.restore();
  }

  // under the scroll: just the controls
  drawInfo(ctx, L, t) {
    const u = L.u, v = this.g.view;
    ctx.save(); ctx.globalAlpha = clamp((t - 0.5) / 0.4, 0, 1);
    const pad = input.players[0] && input.players[0].mode === 'pad';
    const n = this.options.length;
    if (this.peek) { ctx.restore(); return; } // (from the pause menu: the header says how to close it)
    const how = this.readonly ? 'The host is choosing the route…'
      : (n > 1 ? (pad ? '▲ ▼ choose a path · ' : '↑ ↓ or click a path · ') : '') + (this.kidList().length ? (this.look != null ? (pad ? '◀ back · ' : '← back · ') : (pad ? '▶ look ahead · ' : '→ look ahead · ')) : '') + (pad ? 'Ⓐ travel' : 'Enter to travel');
    txt(ctx, how, v.W / 2, L.py + L.ph + 34 * u, 14 * u, this.readonly ? '#8fd0ff' : 'rgba(248,240,222,0.8)', 800);
    ctx.restore();
  }

  // along the foot of the map: one mark per level of the area, the ones behind you inked in, the boss at the end
  drawBossTrack(ctx, L, t) {
    const R = this.route, u = L.u, n = R.cols.length, y = L.py + L.ph - 24 * u;
    const xs = R.cols.map((_, c) => L.px + L.pad + (c / (n - 1)) * (L.pw - L.pad * 2));
    ctx.save();
    // a paper strip behind the track so it reads over scenery and fog
    rr(ctx, xs[0] - 22 * u, y - 13 * u, xs[n - 1] - xs[0] + 44 * u, 26 * u, 13 * u);
    ctx.fillStyle = 'rgba(246,236,210,0.92)'; ctx.fill(); ctx.strokeStyle = 'rgba(120,80,50,0.55)'; ctx.lineWidth = 1 * u; ctx.stroke();
    ctx.strokeStyle = 'rgba(90,60,40,0.6)'; ctx.lineWidth = 2 * u; ctx.setLineDash([4 * u, 4 * u]);
    ctx.beginPath(); ctx.moveTo(xs[0], y); ctx.lineTo(xs[n - 1], y); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#8a2a22'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(xs[0], y); ctx.lineTo(xs[Math.min(this.col, n - 1)], y); ctx.stroke(); // the way walked
    for (let c = 0; c < n - 1; c++) {
      const x = xs[c], here = c === this.col;
      // passed: a solid ink node with a pale centre; to go: a hollow ring; here: gold
      const passed = c < this.col, r = (here ? 7 : 5.5) * u;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = passed ? '#5a1a14' : here ? '#f0c860' : '#fbf4e2'; ctx.fill();
      ctx.strokeStyle = passed ? '#5a1a14' : here ? '#7a1a14' : 'rgba(90,60,40,0.85)'; ctx.lineWidth = (here ? 2.2 : 1.6) * u; ctx.stroke();
      if (passed) { ctx.fillStyle = '#e8a090'; ctx.beginPath(); ctx.arc(x, y, 1.8 * u, 0, TAU); ctx.fill(); }
      if (here) { ctx.strokeStyle = `rgba(240,200,96,${0.7 - ((t * 0.8) % 1) * 0.7})`; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(x, y, (8 + ((t * 0.8) % 1) * 8) * u, 0, TAU); ctx.stroke(); }
    }
    // the boss: a black seal with 鬼, and how far it is
    const bx = xs[n - 1];
    ctx.fillStyle = '#1e1418'; ctx.beginPath(); ctx.arc(bx, y, 11 * u, 0, TAU); ctx.fill(); ctx.strokeStyle = '#a8322a'; ctx.lineWidth = 2 * u; ctx.stroke();
    txt(ctx, '鬼', bx, y + 0.5 * u, 12 * u, '#f6e2bc', 800, FONT_SERIF);
    const left = n - 1 - this.col, B = BOSSES[R.cols[n - 1].level];
    const label = left <= 0 ? `${B ? B.name : 'The boss'} awaits` : `${B ? B.name : 'Boss'} in ${left} level${left > 1 ? 's' : ''}`;
    ctx.font = `800 ${Math.round(12 * u)}px ${FONT_SERIF}`; const lw = ctx.measureText(label).width + 18 * u;
    rr(ctx, bx - 16 * u - lw, y - 28 * u - 9 * u, lw, 18 * u, 9 * u); ctx.fillStyle = '#2a1418'; ctx.fill();
    txt(ctx, label, bx - 16 * u - lw / 2, y - 28 * u, 12 * u, '#f6e2bc', 800, FONT_SERIF);
    ctx.restore();
  }

  // area 4: the map is a floor plan of the fortress: tatami halls, wooden corridors, a gravel courtyard, walls and pillars
  fortressPlan(ctx, L, rng, t) {
    const { px, py, pw, ph, u } = L;
    ctx.save();
    ctx.fillStyle = 'rgba(120,90,60,0.12)'; ctx.fillRect(px, py, pw, ph);
    const x0 = px + 18 * u, y0 = py + 18 * u, W = pw - 36 * u, H = ph - 36 * u;
    // rooms: three bands (the corridor runs through the middle one) cut into halls of different widths
    const rows = [[y0, H * 0.3], [y0 + H * 0.3, H * 0.4], [y0 + H * 0.7, H * 0.3]];
    rows.forEach(([ry, rh], bi) => {
      let x = x0;
      while (x < x0 + W - 10 * u) {
        const w = Math.min(x0 + W - x, (bi === 1 ? 260 : 120 + rng() * 140) * u);
        const kind = bi === 1 ? 'corridor' : rng() < 0.18 ? 'garden' : rng() < 0.6 ? 'tatami' : 'wood';
        this.room(ctx, x, ry, w, rh, kind, rng, u);
        x += w;
      }
    });
    // pillars along the walls
    ctx.fillStyle = 'rgba(40,24,18,0.8)';
    for (const [ry] of rows.slice(1)) for (let x = x0; x <= x0 + W; x += 52 * u) ctx.fillRect(x - 3 * u, ry - 3 * u, 6 * u, 6 * u);
    // outer wall: thick and dark, with corner towers
    ctx.strokeStyle = 'rgba(40,24,20,0.85)'; ctx.lineWidth = 6 * u; ctx.strokeRect(x0, y0, W, H);
    ctx.fillStyle = 'rgba(60,36,30,0.85)'; for (const [cx, cy] of [[x0, y0], [x0 + W, y0], [x0, y0 + H], [x0 + W, y0 + H]]) ctx.fillRect(cx - 9 * u, cy - 9 * u, 18 * u, 18 * u);
    ctx.restore();
    // the scroll's own border, cartouche and seals still go on top (as in the other areas)
    const biome = BIOMES[3];
    ctx.strokeStyle = 'rgba(90,50,30,0.55)'; ctx.lineWidth = 0.7 * u; ctx.strokeRect(px + 12 * u, py + 12 * u, pw - 24 * u, ph - 24 * u);
    const cw = 30 * u, chh = Math.min(ph * 0.55, (biome.jp.length * 26 + 20) * u), cxx = px + 26 * u, cyy = py + 26 * u;
    ctx.fillStyle = '#f8f0dc'; ctx.fillRect(cxx, cyy, cw, chh);
    ctx.strokeStyle = '#a8322a'; ctx.lineWidth = 2 * u; ctx.strokeRect(cxx, cyy, cw, chh);
    [...biome.jp].forEach((ch, i) => txt(ctx, ch, cxx + cw / 2, cyy + 18 * u + i * 24 * u, 19 * u, INK, 800, FONT_SERIF));
    compass(ctx, px + pw - 50 * u, py + 54 * u, 22 * u, u);
  }
  room(ctx, x, y, w, h, kind, rng, u) {
    const m = 3 * u, L_MID = this.L.py + this.L.ph * 0.5;
    if (kind === 'tatami') { // mats in a pinwheel-ish grid with dark borders
      ctx.save(); ctx.beginPath(); ctx.rect(x + m, y + m, w - m * 2, h - m * 2); ctx.clip();
      const mw = 64 * u, mh = 32 * u;
      for (let yy = y + m, row = 0; yy < y + h - m; yy += mh, row++) for (let xx = x + m - (row % 2 ? mw / 2 : 0), k = 0; xx < x + w - m; xx += mw, k++) {
        ctx.fillStyle = (row + k) % 2 ? 'rgba(200,190,128,0.6)' : 'rgba(186,176,112,0.6)'; ctx.fillRect(xx, yy, mw, mh);
        ctx.strokeStyle = 'rgba(160,150,96,0.35)'; ctx.lineWidth = 0.8 * u; for (let q = 1; q < 8; q++) { ctx.beginPath(); ctx.moveTo(xx + (mw * q) / 8, yy); ctx.lineTo(xx + (mw * q) / 8, yy + mh); ctx.stroke(); } // the weave
        ctx.strokeStyle = 'rgba(46,74,42,0.75)'; ctx.lineWidth = 2.4 * u; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + mw, yy); ctx.moveTo(xx, yy + mh); ctx.lineTo(xx + mw, yy + mh); ctx.stroke(); // the cloth borders on the long sides
        ctx.strokeStyle = 'rgba(90,70,40,0.4)'; ctx.lineWidth = 1 * u; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + mh); ctx.stroke();
      }
      ctx.restore();
    } else if (kind === 'wood') { // plank floor
      ctx.fillStyle = 'rgba(150,104,64,0.45)'; ctx.fillRect(x + m, y + m, w - m * 2, h - m * 2);
      ctx.strokeStyle = 'rgba(90,56,30,0.35)'; ctx.lineWidth = 1 * u; for (let yy = y + m + 7 * u; yy < y + h - m; yy += 7 * u) { ctx.beginPath(); ctx.moveTo(x + m, yy); ctx.lineTo(x + w - m, yy); ctx.stroke(); }
      if (rng() < 0.5) { ctx.fillStyle = 'rgba(160,40,40,0.6)'; ctx.fillRect(x + w / 2 - 14 * u, y + h / 2 - 3 * u, 28 * u, 6 * u); } // a low table / armour rack
    } else if (kind === 'garden') { // raked gravel with a rock and a pine
      ctx.fillStyle = 'rgba(214,208,192,0.75)'; ctx.fillRect(x + m, y + m, w - m * 2, h - m * 2);
      ctx.strokeStyle = 'rgba(140,130,110,0.5)'; ctx.lineWidth = 1 * u; for (let yy = y + m + 5 * u; yy < y + h - m; yy += 5 * u) { ctx.beginPath(); ctx.moveTo(x + m, yy); ctx.lineTo(x + w - m, yy); ctx.stroke(); }
      const rx = x + w * (0.3 + rng() * 0.4), ry2 = y + h * (0.4 + rng() * 0.3);
      ctx.fillStyle = 'rgba(214,208,192,1)'; ctx.beginPath(); ctx.ellipse(rx, ry2, 18 * u, 11 * u, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(100,96,92,0.85)'; ctx.beginPath(); ctx.ellipse(rx, ry2, 9 * u, 6 * u, 0, 0, TAU); ctx.fill();
      snowPine(ctx, x + w * 0.8, y + h * 0.8, 12 * u, false);
    } else { // the long corridor: polished boards, lanterns, sliding doors along both sides
      ctx.fillStyle = 'rgba(126,84,50,0.35)'; ctx.fillRect(x, y + m, w, h - m * 2);
      ctx.strokeStyle = 'rgba(90,56,30,0.3)'; ctx.lineWidth = 1 * u; for (let xx = x; xx < x + w; xx += 16 * u) { ctx.beginPath(); ctx.moveTo(xx, y + m); ctx.lineTo(xx, y + h - m); ctx.stroke(); }
      for (let xx = x + 40 * u; xx < x + w - 20 * u; xx += 120 * u) { lanternStone(ctx, xx, y + 20 * u, 12 * u); banner(ctx, xx + 60 * u, y + h - 6 * u, 13 * u); }
    }
    // walls with sliding-door gaps
    ctx.strokeStyle = 'rgba(40,24,20,0.75)'; ctx.lineWidth = 3 * u;
    if (kind !== 'corridor') {
      ctx.strokeRect(x, y, w, h);
      const dx = x + w * (0.25 + rng() * 0.5);
      ctx.strokeStyle = 'rgba(246,236,210,1)'; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(dx - 12 * u, y + (y > L_MID ? 0 : h)); ctx.lineTo(dx + 12 * u, y + (y > L_MID ? 0 : h)); ctx.stroke();
      ctx.strokeStyle = 'rgba(40,24,20,0.6)'; ctx.lineWidth = 1 * u; ctx.beginPath(); ctx.moveTo(dx - 12 * u, y + (y > L_MID ? 2 * u : h - 2 * u)); ctx.lineTo(dx + 12 * u, y + (y > L_MID ? 2 * u : h - 2 * u)); ctx.stroke();
    }
  }

}

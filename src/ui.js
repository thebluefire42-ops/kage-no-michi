// HUD, title screen, weapon select (solo/co-op), pause, end screens, banners, boss intro and the F3 debug overlay.
import { MAX_TALENTS } from './config.js';
import { TAU, clamp, lerp, ease, seededRng } from './util.js';
import { WEAPONS, WEAPON_ORDER, UPGRADES, PLAYER_BASE, ELEMENTS, PLAYER_COLORS } from './config.js';
import { drawWeapon, drawHumanoid, INK } from './rig.js';
import { EQUIPMENT } from './equipment.js';
import { RouteScreen } from './route.js';
import { net } from './net.js';
import { input } from './input.js';
import { sfx, music } from './audio.js';
import { fmtStat, drawIcon, drawCard } from './cards.js';
import { SACRIFICES } from './sacrifice.js';
import { drawStatIcon, STAT_STYLE } from './staticons.js';
import { portrait } from './dialogue.js';
import { ARTS } from './arts.js';
import { hasPadToken, richWidth, drawRich, drawPadButton } from './padicons.js';
import { CardGallery } from './gallery.js';

// stats in display order, and how each one reads on screen
const STAT_ORDER = ['baseDamage', 'critChance', 'critDamage', 'cooldownMul', 'moveSpeed', 'dashCd', 'kiCost', 'healthRegen']; // (energy regen has no cards any more)
// move speed is shown with the weapons' own speed included
const statText = (p, k) => (k === 'moveSpeed' ? `${Math.round(p.stats.moveSpeed * (p.weaponMove || 1) * 100)}%` : k === 'dashCd' ? `${p.dashCooldown.toFixed(1)}s` : fmtStat(k, p.stats[k]));

const FONT_SERIF = '"Shippori Mincho", serif';
const FONT_SANS = '"Zen Kaku Gothic New", sans-serif';
const WPAL = { metal: '#e6edf5', wood: '#8a5a32', accent: '#c0392b' };
const WICON = { katanas: 'katana', crossbow: 'crossbow', heavy: 'nodachi', knives: 'kunai', staff: 'holystaff', bo: 'bo', shield: 'shield_icon', orb: 'orb_icon', gloves: 'gauntlet' };
const INTRO_DUR = 4.8;
const NW = WEAPON_ORDER.length;

export function uiScale(v) { return clamp(Math.min(v.W / 1280, v.H / 760), 0.5, 4); }

export { FONT_SERIF, FONT_SANS, WPAL, WICON };
export function text(ctx, str, x, y, size, color, weight = 700, font = FONT_SANS, align = 'center', base = 'middle') {
  ctx.font = `${weight} ${Math.round(size)}px ${font}`;
  ctx.textAlign = align; ctx.textBaseline = base; ctx.fillStyle = color;
  if (base === 'middle' && hasPadToken(str)) { // controller buttons (LB / LT / RB / RT) drawn as button icons
    const h = size * 1.25, w = richWidth(ctx, str, h);
    drawRich(ctx, str, align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y, h);
    return;
  }
  ctx.fillText(str, x, y);
}
export function outlinedText(ctx, str, x, y, size, color, stroke = 'rgba(15,10,20,0.85)', weight = 800, font = FONT_SERIF, lw = 4) {
  ctx.font = `${weight} ${Math.round(size)}px ${font}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(str, x, y);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

// brush-stroke shaped bar
function brushBar(ctx, x, y, w, h, k, fill, back, trail = null) {
  const path = (len) => {
    ctx.beginPath();
    ctx.moveTo(x + 4, y + h * 0.15);
    ctx.lineTo(x + len - 2, y);
    ctx.quadraticCurveTo(x + len + 5, y + h * 0.5, x + len - 4, y + h);
    ctx.lineTo(x + 2, y + h * 0.88);
    ctx.quadraticCurveTo(x - 4, y + h * 0.5, x + 4, y + h * 0.15);
    ctx.closePath();
  };
  path(w); ctx.fillStyle = back; ctx.fill();
  if (trail !== null && trail > k) { path(Math.max(6, w * trail)); ctx.fillStyle = 'rgba(255,240,220,0.75)'; ctx.fill(); }
  if (k > 0.005) { path(Math.max(6, w * k)); ctx.fillStyle = fill; ctx.fill(); }
  path(w); ctx.strokeStyle = 'rgba(10,8,14,0.9)'; ctx.lineWidth = 2; ctx.stroke();
}

function drawSpecialIcon(ctx, key, s, color) {
  ctx.save(); ctx.scale(s, s); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  switch (key) {
    case 'katanas': // Blade Waltz: a zigzag of blinks, a slash at every turn
      ctx.lineWidth = 1.6; ctx.setLineDash([2.5, 3]);
      ctx.beginPath(); ctx.moveTo(-14, 10); ctx.lineTo(-5, -9); ctx.lineTo(4, 9); ctx.lineTo(13, -10); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 2.6;
      for (const [x, y, a] of [[-5, -9, 0.6], [4, 9, -0.6], [13, -10, 0.6]]) { ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 6, y - Math.sin(a) * 6); ctx.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); ctx.stroke(); }
      break;
    case 'gloves': // Earthen Prison: spikes of stone breaking out of the ground
      for (const [x, h, w] of [[-9, 16, 6], [0, 22, 7], [9, 15, 6]]) { ctx.beginPath(); ctx.moveTo(x - w, 11); ctx.lineTo(x - 1, 11 - h); ctx.lineTo(x + w, 11); ctx.closePath(); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(-15, 12); ctx.lineTo(15, 12); ctx.stroke();
      break;
    case 'crossbow':
      for (const a of [-0.35, 0, 0.35]) { ctx.save(); ctx.rotate(a - 0.8); ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(7, -3); ctx.lineTo(7, 3); ctx.fill(); ctx.restore(); }
      break;
    case 'heavy':
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(0, 4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(0, 6); ctx.lineTo(5, -1); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 10, 13, 3.5, 0, 0, TAU); ctx.stroke();
      break;
    case 'knives': // Blade Storm: kunai flying out all around
      for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate(i * TAU / 8 + 0.2); ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(12, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(12, -2.2); ctx.lineTo(16.5, 0); ctx.lineTo(12, 2.2); ctx.fill(); ctx.restore(); }
      break;
    case 'knivesFan':
      for (let i = -2; i <= 2; i++) { ctx.save(); ctx.rotate(-Math.PI / 2 + i * 0.32); ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(14, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(14, -2.5); ctx.lineTo(19, 0); ctx.lineTo(14, 2.5); ctx.fill(); ctx.restore(); }
      break;
    case 'bo': // hourglass (slowed time) with strike marks
      ctx.beginPath(); ctx.moveTo(-8, -12); ctx.lineTo(8, -12); ctx.lineTo(-8, 12); ctx.lineTo(8, 12); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-14, -14); ctx.lineTo(-11, -7); ctx.moveTo(14, -14); ctx.lineTo(11, -7); ctx.moveTo(-14, 14); ctx.lineTo(-11, 7); ctx.moveTo(14, 14); ctx.lineTo(11, 7); ctx.stroke();
      break;
    case 'shield': // Bulwark: a shield with a shockwave around it
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, 12.5, -2.4, -0.7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 12.5, 0.7, 2.4); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 12.5, 2.6, 3.7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 12.5, -0.55, 0.55); ctx.stroke();
      break;
    case 'orb': // Call the Fallen: a little ghost rising, with its wavy hem
      ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(-8, -2); ctx.arc(0, -2, 8, Math.PI, 0); ctx.lineTo(8, 10);
      for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(6 - i * 4, 6, 4 - i * 4, 10);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.arc(-3, -2, 1.7, 0, TAU); ctx.arc(3, -2, 1.7, 0, TAU); ctx.fill();
      break;
    case 'staff': // healing cross inside a circle
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.stroke();
      ctx.fillRect(-2.5, -8, 5, 16); ctx.fillRect(-8, -2.5, 16, 5);
      break;
  }
  ctx.restore();
}

// an element's small mark, the same shapes that drift over its imbuement card (cards.js imbueParticles):
// a lightning zigzag, a poison bubble, a snowflake, a flame (burn), a drop (arcane), a + (syphon on its card)
export function drawElementMark(ctx, el, x, y, u, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(u, u);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (el === 'lightning') { ctx.beginPath(); ctx.moveTo(-1.5, -6); ctx.lineTo(2.5, -1); ctx.lineTo(-2, 0.5); ctx.lineTo(2, 6); ctx.stroke(); }
  else if (el === 'poison') { ctx.beginPath(); ctx.arc(-0.5, 1, 3.6, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(2.6, -4, 1.4, 0, TAU); ctx.stroke(); }
  else if (el === 'burn') { ctx.beginPath(); ctx.moveTo(-3.5, 5); ctx.quadraticCurveTo(-4.5, -1, 0, -6); ctx.quadraticCurveTo(4.5, -1, 3.5, 5); ctx.closePath(); ctx.fill(); }
  else if (el === 'ice') { ctx.beginPath(); for (let k = 0; k < 3; k++) { const a = (k * Math.PI) / 3 + Math.PI / 2; ctx.moveTo(-Math.cos(a) * 5.5, -Math.sin(a) * 5.5); ctx.lineTo(Math.cos(a) * 5.5, Math.sin(a) * 5.5); } ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(4.2, 0, 0, 4); ctx.quadraticCurveTo(-4.2, 0, 0, -6); ctx.fill(); }
  ctx.restore();
}

// the basic-attack slot shows the weapon exactly as on its weapon-select card, centred and fitted to the slot
// the secondary attack's icon (drawn in a pale steel-blue so the three slots read apart)
export function drawSecondaryIcon(ctx, key, s, color) {
  ctx.save(); ctx.scale(s, s); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (key) {
    case 'katanas': // Whirlwind: two arcs turning round
      for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(0, 0, 11, i * Math.PI + 0.3, i * Math.PI + 2.6); ctx.stroke(); const a = i * Math.PI + 2.6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11); ctx.lineTo(Math.cos(a) * 11 + Math.cos(a + 1.2) * 5, Math.sin(a) * 11 + Math.sin(a + 1.2) * 5); ctx.stroke(); }
      break;
    case 'crossbow': // a backward leap arrow under a bolt
      ctx.beginPath(); ctx.moveTo(-12, -6); ctx.lineTo(10, -6); ctx.stroke(); ctx.beginPath(); ctx.moveTo(10, -9); ctx.lineTo(15, -6); ctx.lineTo(10, -3); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 10, 10, Math.PI * 1.05, Math.PI * 1.95, true); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-10, 9); ctx.lineTo(-13, 4); ctx.lineTo(-6, 5); ctx.fill();
      break;
    case 'heavy': // a wide cleave arc with a slow mark under it
      ctx.lineWidth = 3.2; ctx.beginPath(); ctx.arc(0, 4, 14, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.lineWidth = 1.8; for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 3, 8 + Math.sin(a) * 3); ctx.lineTo(Math.cos(a) * 8, 8 + Math.sin(a) * 8); ctx.stroke(); }
      break;
    case 'knives': // the fan
      for (let i = -2; i <= 2; i++) { ctx.save(); ctx.rotate(-Math.PI / 2 + i * 0.32); ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(14, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(14, -2.5); ctx.lineTo(19, 0); ctx.lineTo(14, 2.5); ctx.fill(); ctx.restore(); }
      break;
    case 'staff': // a narrow wedge of light reaching far
      ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.moveTo(-14, 12); ctx.arc(-14, 12, 32, -0.95, -0.55); ctx.closePath(); ctx.fill(); ctx.globalAlpha /= 0.5;
      ctx.beginPath(); ctx.arc(-14, 12, 32, -0.95, -0.55); ctx.stroke();
      break;
    case 'bo': // a planted stick with the jump arcing over it
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, -6); ctx.stroke();
      ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(0, -2, 11, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(10, -5); ctx.lineTo(13, 1); ctx.lineTo(7, 0); ctx.fill();
      break;
    case 'shield': // a disc on a circular path
      ctx.beginPath(); ctx.arc(0, 0, 13, 0.5, TAU - 0.3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(13, -4); ctx.lineTo(9, -9); ctx.lineTo(16, -9); ctx.fill();
      ctx.beginPath(); ctx.arc(12, 6, 4.5, 0, TAU); ctx.fill();
      break;
    case 'orb': // the orb falling onto rings on the ground
      ctx.beginPath(); ctx.arc(0, -8, 5.5, 0, TAU); ctx.fill();
      ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0, 3); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 9, 13, 4, 0, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.ellipse(0, 9, 7, 2, 0, 0, TAU); ctx.stroke();
      break;
    case 'gloves': // a slab of rock leaning up, with an upward strike line
      ctx.beginPath(); ctx.moveTo(-6, 13); ctx.lineTo(-2, -4); ctx.lineTo(6, -12); ctx.lineTo(10, -2); ctx.lineTo(9, 13); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-14, 10); ctx.lineTo(-14, -10); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-17, -6); ctx.lineTo(-14, -12); ctx.lineTo(-11, -6); ctx.fill();
      break;
  }
  ctx.restore();
}
function drawBasicIcon(ctx, key, u) {
  const B = weaponIconBox(key), sc = (32 * u) / Math.max(B.w, B.h, 1);
  ctx.scale(sc, sc); ctx.translate(-B.x, -B.y);
  weaponIcon(ctx, key);
}
// a weapon's icon as drawn on its select card (unscaled, around the origin)
export function weaponIcon(ctx, key) {
  const k = WICON[key];
  if (key === 'katanas') { drawWeapon(ctx, 'katana', -12, 8, -0.6, WPAL); drawWeapon(ctx, 'katana', -12, -8, 0.6, WPAL); }
  else if (key === 'knives') drawWeapon(ctx, 'kunai_volley', 4, 0, -0.35, WPAL);
  else if (key === 'staff') drawWeapon(ctx, 'holystaff', -8, 0, -0.9, WPAL);
  else if (key === 'bo') drawWeapon(ctx, 'bo', -4, 4, -0.7, WPAL);
  else if (key === 'shield') drawWeapon(ctx, 'shield_icon', 0, 0, 0, WPAL);
  else if (key === 'orb') drawWeapon(ctx, 'orb_icon', 0, 0, 0, WPAL);
  else if (key === 'gloves') { ctx.save(); ctx.scale(1.6, 1.6); drawWeapon(ctx, 'gauntlet', -6, 4, -0.5, WPAL); drawWeapon(ctx, 'gauntlet', 6, -4, -2.6, WPAL); ctx.restore(); }
  else if (k === 'nodachi') drawWeapon(ctx, k, 0, 0, -0.55, WPAL);
  else drawWeapon(ctx, k, -5, 0, 0, WPAL, 0.7);
}
// its outline, measured once from the pixels: the middle and the size, so every icon can be centred and fitted
const ICON_BOX = {};
export function weaponIconBox(key) {
  if (ICON_BOX[key]) return ICON_BOX[key];
  let box = { x: 0, y: 0, w: 40, h: 40 };
  try {
    const N = 400, S = 4, c = document.createElement('canvas'); c.width = N; c.height = N;
    const x = c.getContext('2d'); x.translate(N / 2, N / 2); x.scale(S, S); weaponIcon(x, key);
    const d = x.getImageData(0, 0, N, N).data; let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) if (d[(yy * N + xx) * 4 + 3] > 30) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    if (x1 >= 0) box = { x: ((x0 + x1) / 2 - N / 2) / S, y: ((y0 + y1) / 2 - N / 2) / S, w: (x1 - x0) / S, h: (y1 - y0) / S };
  } catch (e) { /* no canvas: draw as is */ }
  return (ICON_BOX[key] = box);
}

// cooldown sweep + seconds remaining
function drawCooldown(ctx, x, y, s, remaining, frac, u, whole = false) {
  if (remaining <= 0.01) return;
  const c = clamp(frac, 0, 1), mx = x + s / 2, my = y + s / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
  ctx.fillStyle = 'rgba(4,2,4,0.62)';
  ctx.beginPath(); ctx.moveTo(mx, my); ctx.arc(mx, my, s * 0.75, -Math.PI / 2, -Math.PI / 2 + c * TAU); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (remaining >= 0.2) outlinedText(ctx, whole ? Math.ceil(remaining).toString() : remaining.toFixed(1), mx, my + 1, (whole ? 16 : 14) * u, '#fff4e0', 'rgba(0,0,0,0.85)', 800, FONT_SERIF, 3);
}

// ---------------------------------------------------------------- HUD
// Tense moments: ink-dark edges with a deep crimson glow that throbs with the music's beat, thin
// cinematic bars at the top and bottom, and embers drifting up. Everything scales with g.tenseVis.
export function drawTenseOverlay(ctx, g) {
  const v = g.view, a = ease.inOutSine(g.tenseVis), W = v.W, H = v.H;
  const b = music.beat();
  // pulse on every beat (every 2nd beat for fast songs), sharp attack and slow release
  let pulse = 0;
  if (b) { const ph = b.bpm > 130 ? (((b.n % 2) + 2) % 2 + b.phase) / 2 : b.phase; pulse = Math.pow(1 - ph, 3); }
  ctx.save();
  void a; void pulse; // (the dark pulsing edges were removed by request; only the embers remain)
  // embers
  ctx.globalCompositeOperation = 'lighter';
  for (const e of g.tenseEmbers) {
    const k = e.life / e.max, al = Math.sin(Math.PI * k) * 0.8;
    ctx.fillStyle = `rgba(255,${Math.round(60 + 70 * (1 - k))},30,${(al * 0.9).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.s * (1 - k * 0.5), 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// Black film bars at the top and bottom: thin while the music is tense, growing as health drops
// (at their largest the same as the cutscenes'). A faint red line edges them during tense fights.
export function drawCinemaBars(ctx, g) {
  const v = g.view, W = v.W, H = v.H;
  const t = ease.inOutSine(g.tenseVis || 0), l = ease.inOutSine(g.lowVis || 0);
  if (l > 0.01) { // low health: a dark, blood-tinted closing-in of the edges that throbs like a heartbeat
    const beat = Math.pow(Math.max(0, Math.sin((g.realTime || 0) * (2.2 + 1.6 * l) * Math.PI)), 6);
    const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.36 - 0.12 * l), W / 2, H / 2, Math.hypot(W, H) / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.6, `rgba(40,0,6,${(0.32 * l + 0.08 * l * beat).toFixed(3)})`);
    gr.addColorStop(1, `rgba(8,0,2,${(0.8 * l + 0.1 * l * beat).toFixed(3)})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  }
  const bh = H * Math.max(0.032 * t, 0.12 * l); // low health closes the bars in much further
  if (bh < 0.5) return;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
  if (t > 0.01) {
    const b = music.beat(); let pulse = 0;
    if (b) { const ph = b.bpm > 130 ? (((b.n % 2) + 2) % 2 + b.phase) / 2 : b.phase; pulse = Math.pow(1 - ph, 3); }
    const lw = Math.max(1, v.k);
    ctx.fillStyle = `rgba(160,24,36,${(0.35 * t * (0.5 + 0.5 * pulse)).toFixed(3)})`; ctx.fillRect(0, bh, W, lw); ctx.fillRect(0, H - bh - lw, W, lw);
  }
}

export function drawHUD(ctx, g) {
  const v = g.view, u = uiScale(v);
  if (!g.players.length) return;
  const coop = g.players.length > 1;
  g.players.forEach((p, i) => drawPlayerPanel(ctx, g, p, i, coop, u));

  // level / biome title
  if (!g.spawner || !g.world) return; // joiner waiting for the host's first level
  // the joiner doesn't run a spawner, so it only counts the enemies it can see
  const alive = g.enemies.filter((e) => !e.dead).length + (g.role === 'client' ? 0 : g.spawner.remaining());
  if (!g.training) { // training draws its own panel up here (damage numbers instead of a level title)
  text(ctx, `Level ${g.level}`, v.W / 2, 26 * u, 22 * u, '#f6eedc', 800, FONT_SERIF);
  text(ctx, `${g.world.biome.jp} · ${g.world.biome.name}`, v.W / 2, 50 * u, 13 * u, 'rgba(246,238,220,0.85)', 700, FONT_SANS);
  if (!g.cleared && !g.bossRef) text(ctx, `敵 ${alive} remaining`, v.W / 2, 70 * u, 12 * u, 'rgba(255,200,190,0.9)', 700, FONT_SANS);
  }

  const b = g.bossRef;
  if (b && !g.cleared && b.state !== 'intro') {
    const w = Math.min(640 * u, v.W * 0.5), x = v.W / 2 - w / 2, y = 84 * u;
    g.bossTrail = lerp(g.bossTrail ?? b.hp, Math.max(0, b.hp), 0.03);
    outlinedText(ctx, `${b.cfg.jp}  ${b.cfg.name}`, v.W / 2, y, 18 * u, '#ffdcc8');
    brushBar(ctx, x, y + 14 * u, w, 16 * u, Math.max(0, b.hp) / b.hpMax, '#b81e2e', 'rgba(20,8,12,0.8)', g.bossTrail / b.hpMax);
    const n = b.type === 'oni_lord' || b.type === 'gensai' ? 3 : 2;
    for (let i = 1; i < n; i++) { const mx = x + (w * i) / n; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(mx, y + 14 * u, 2, 16 * u); }
    if (b.guarded) { // ward from his guards: golden frame and a label
      ctx.strokeStyle = `rgba(255,215,110,${0.6 + 0.3 * Math.sin(g.realTime * 5)})`; ctx.lineWidth = 2.5 * u; ctx.strokeRect(x - 3 * u, y + 11 * u, w + 6 * u, 22 * u);
      text(ctx, '⛨ Guarded — defeat his guards', v.W / 2, y + 44 * u, 12 * u, '#ffd76a', 800);
    }
  }

  drawPadIcon(ctx, v.W / 2 + (coop ? 0 : v.W / 2 - 46 * u), coop ? v.H - 20 * u : 30 * u, u, input.pad.connected, input.mode === 'pad', input.padCount);
  if (g.world.gate.active && g.state === 'play') drawGatePointer(ctx, g, u, g.realTime);
}

// pause: true while the pause screen shows it (stats and imbuements get their names, no attack slots)
function drawPlayerPanel(ctx, g, p, idx, coop, u, pause = false) {
  const v = g.view, t = g.realTime;
  const right = coop && idx === 1;
  const W = v.W;
  // mirror helper for player 2 (top-right): X(x, w) is the left edge of something w wide at x from the edge
  const X = (x, w = 0) => (right ? W - x - w : x);
  const px = 20 * u, py = 18 * u, PS = 112 * u;
  const col = coop ? PLAYER_COLORS[idx] : '#c9a54a';
  // ---- the portrait: a square, the ninja's head and shoulders in their own colours and gear
  const qx = X(px, PS), qy = py;
  ctx.save();
  ctx.fillStyle = 'rgba(12,9,14,0.85)'; ctx.fillRect(qx, qy, PS, PS);
  ctx.save(); ctx.beginPath(); ctx.rect(qx, qy, PS, PS); ctx.clip();
  ctx.drawImage(hudPortrait(p, idx, right), qx, qy, PS, PS);
  // the equipment set along the bottom: its name, then its bonus
  const E = EQUIPMENT[p.equip] || EQUIPMENT.default;
  const bandH = 18 * u, by = qy + PS - bandH;
  const gr = ctx.createLinearGradient(0, by - 14 * u, 0, qy + PS); gr.addColorStop(0, 'rgba(8,5,8,0)'); gr.addColorStop(0.35, 'rgba(8,5,8,0.82)'); gr.addColorStop(1, 'rgba(8,5,8,0.92)');
  ctx.fillStyle = gr; ctx.fillRect(qx, by - 14 * u, PS, bandH + 14 * u);
  fitText(ctx, E.title, qx + PS / 2, by + 8 * u, 12 * u, PS - 10 * u, '#f4d690', 800, FONT_SERIF);
  if (p.dead) { ctx.fillStyle = 'rgba(40,6,10,0.65)'; ctx.fillRect(qx, qy, PS, PS); outlinedText(ctx, '死', qx + PS / 2, qy + PS * 0.4, 40 * u, '#e05050', 'rgba(0,0,0,0.6)', 800, FONT_SERIF, 3 * u); }
  ctx.restore();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(qx, qy, PS, PS);
  ctx.strokeStyle = col; ctx.lineWidth = 1.4 * u; ctx.strokeRect(qx + 3 * u, qy + 3 * u, PS - 6 * u, PS - 6 * u);
  if (coop) { ctx.fillStyle = col; ctx.fillRect(qx + (right ? 3 * u : PS - 27 * u), qy + 3 * u, 24 * u, 14 * u); text(ctx, `P${idx + 1}`, qx + (right ? 15 * u : PS - 15 * u), qy + 10.5 * u, 10 * u, '#fff', 800); }
  ctx.restore();
  // ---- base stats, one under the other below the portrait
  {
    const rowH = 19 * u, iconS = 15 * u, sy = qy + PS + 8 * u, sw = (pause ? 190 : 74) * u, sx = X(px, sw);
    ctx.fillStyle = 'rgba(12,9,14,0.55)'; ctx.fillRect(sx, sy - 3 * u, sw, STAT_ORDER.length * rowH + 4 * u);
    STAT_ORDER.forEach((k, i) => {
      const y = sy + i * rowH + rowH / 2 - 1 * u;
      drawStatIcon(ctx, k, sx + 5 * u + iconS / 2, y, iconS);
      if (pause) text(ctx, UPGRADES[k].name, sx + 10 * u + iconS, y + 0.5 * u, 11.5 * u, 'rgba(248,240,222,0.85)', 700, FONT_SANS, 'left');
      text(ctx, statText(p, k), sx + sw - 6 * u, y + 0.5 * u, 11.5 * u, '#f4ecdc', 700, FONT_SANS, 'right');
    });
    // the weapon's imbuements, in their own section under the stats (a 2x / half tag in its corner when a
    // sacrifice changed how strong they are)
    const w = p.weapons[0], els = Object.keys(ELEMENTS).filter((k) => w.elements[k] > 0);
    if (els.length) {
      const iy = sy + STAT_ORDER.length * rowH + 8 * u, ih = els.length * rowH + 9 * u, pad = 5 * u; // (pad: room under the corner tag)
      ctx.fillStyle = 'rgba(12,9,14,0.55)'; ctx.fillRect(sx, iy - 3 * u, sw, ih);
      ctx.fillStyle = 'rgba(232,196,112,0.5)'; ctx.fillRect(sx, iy - 3 * u, sw, 1);
      els.forEach((k, i) => {
        const y = iy + pad + i * rowH + rowH / 2 - 1 * u;
        elemBadge(ctx, k, sx + 5 * u + iconS / 2, y, iconS);
        if (pause) text(ctx, ELEMENTS[k].name, sx + 10 * u + iconS, y + 0.5 * u, 11.5 * u, 'rgba(248,240,222,0.85)', 700, FONT_SANS, 'left');
        text(ctx, elemText(w, k), sx + sw - 6 * u, y + 0.5 * u, 11.5 * u, ELEMENTS[k].color, 800, FONT_SANS, 'right');
      });
      const M = p.elemMul || 1;
      if (Math.abs(M - 1) > 0.01) {
        const str = M >= 1 ? `${+M.toFixed(2)}×` : M === 0.5 ? '½×' : `${+M.toFixed(2)}×`;
        ctx.font = `800 ${10 * u}px ${FONT_SANS}`; const tw = ctx.measureText(str).width + 8 * u, th = 14 * u, tx = sx + sw - tw + 3 * u, ty = iy - 3 * u - th / 2 - 1 * u;
        ctx.fillStyle = M > 1 ? '#c99a32' : '#7a3a3a'; ctx.fillRect(tx, ty, tw, th);
        ctx.strokeStyle = 'rgba(15,10,14,0.9)'; ctx.lineWidth = 1.2; ctx.strokeRect(tx, ty, tw, th);
        text(ctx, str, tx + tw / 2, ty + th / 2 + 0.5, 10 * u, '#fff8e8', 800);
      }
    }
  }
  // ---- health and ki: two ink strokes beside the portrait
  const bx0 = px + PS + 12 * u, hw = 270 * u, hh = 18 * u, kw = 220 * u, kh = 11 * u, hy = py + 6 * u, ky = hy + hh + 8 * u;
  p.hpTrail = lerp(p.hpTrail ?? p.hp, p.hp, 0.04);
  const lowHp = p.hp < p.maxHp * 0.3 && !p.dead;
  inkStroke(ctx, X(bx0, hw), hy, hw, hh, p.hp / p.maxHp, lowHp ? `rgb(${200 + 55 * Math.sin(t * 8)},40,40)` : '#c8302e', p.hpTrail / p.maxHp, right);
  textEdge(ctx, p.dead ? (p.returnLevel ? `Fallen — returns at level ${p.returnLevel}` : 'Fallen') : `${Math.ceil(p.hp)} / ${p.maxHp}`, right ? W - bx0 - 10 * u : bx0 + 10 * u, hy + hh / 2 + 1, 12 * u, '#fff', right ? 'right' : 'left');
  inkStroke(ctx, X(bx0, kw), ky, kw, kh, p.energy / p.maxEnergy, '#3fb6c8', null, right);
  textEdge(ctx, `${Math.floor(p.energy)} / ${p.maxEnergy}`, right ? W - bx0 - 10 * u : bx0 + 10 * u, ky + kh / 2 + 1, 9.5 * u, '#eaffff', right ? 'right' : 'left');
  let rowY = ky + kh + 12 * u;
  // solo lives: small hearts under the ki stroke
  if (!coop && p.lives > 0) {
    for (let i = 0; i < p.lives; i++) lifeHeart(ctx, X(bx0 + 9 * u + i * 18 * u), rowY, 6.5 * u);
    rowY += 18 * u;
  }
  if (pause) { // the equipment set and its bonus
    const E = EQUIPMENT[p.equip] || EQUIPMENT.default, al = right ? 'right' : 'left', tx = right ? W - bx0 : bx0;
    text(ctx, E.name, tx, rowY + 1 * u, 13 * u, coop ? col : '#e8c470', 800, FONT_SERIF, al);
    (E.lines || []).forEach((ln, k) => text(ctx, ln, tx, rowY + 18 * u + k * 15 * u, 11.5 * u, p.equip === 'default' || !p.equip ? '#e8dcc0' : '#9fe0a0', 700, FONT_SANS, al));
  }
  // Battle Rush: bonus damage for the first seconds of the level (beside the health stroke)
  if (p.rushT > 0 && !p.dead) {
    const str = `+${Math.round((p.rushMul - 1) * 100)}% DMG`;
    ctx.font = `800 ${Math.round(12 * u)}px ${FONT_SANS}`;
    const cw = ctx.measureText(str).width + 30 * u, ch = 22 * u, cx = X(bx0 + hw + 12 * u, cw), cy = hy - 2 * u;
    ctx.fillStyle = `rgba(120,40,8,${0.8 + 0.15 * Math.sin(t * 6)})`; ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = '#ff8a3c'; ctx.lineWidth = 1.5 * u; ctx.strokeRect(cx, cy, cw, ch);
    ctx.save(); ctx.translate(cx + 12 * u, cy + ch / 2); drawIcon(ctx, 'rush', 0.26 * u, '#ffb070', t); ctx.restore();
    text(ctx, str, cx + 24 * u, cy + ch / 2 + 1, 12 * u, '#ffe0c0', 800, FONT_SANS, 'left');
  }
  if (pause) return;
  if (g.online && g.localPlayer && p !== g.localPlayer()) { if (p.dead && coop) drawFallen(ctx, g, p, idx, u); return; } // online: only your own attacks and talents
  drawSlots(ctx, g, p, idx, coop, u); // (attacks, dash and talents, laid out like the controller)
  if (p.dead && coop) drawFallen(ctx, g, p, idx, u);
}

// co-op: a fallen player's corner (bottom-left for P1, bottom-right for P2) says when they come back
function drawFallen(ctx, g, p, idx, u) {
  const v = g.view, t = g.realTime;
  const w = 330 * u, h = 78 * u, right = idx === 1;
  const x = right ? v.W - 24 * u - w : 24 * u, y = v.H - 120 * u - h;
  const left = Math.max(0, (p.returnLevel || g.level) - g.level);
  ctx.save();
  ctx.fillStyle = 'rgba(40,6,12,0.88)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PLAYER_COLORS[idx]; ctx.lineWidth = 2.5 * u; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = PLAYER_COLORS[idx]; ctx.fillRect(right ? x + w - 6 * u : x, y, 6 * u, h);
  const kx = right ? x + w - 40 * u : x + 40 * u;
  outlinedText(ctx, '死', kx, y + h / 2 + 2 * u, 40 * u, '#e05a5a', 'rgba(0,0,0,0.6)', 800, FONT_SERIF, 3);
  const tx = right ? x + 18 * u : x + 78 * u;
  text(ctx, `Player ${idx + 1} has fallen`, tx, y + 22 * u, 15 * u, '#ffd8c8', 800, FONT_SERIF, 'left');
  const pulse = 0.75 + 0.25 * Math.sin(t * 3);
  ctx.globalAlpha = pulse;
  text(ctx, p.returnLevel ? `Returns at level ${p.returnLevel}` : 'Returns soon', tx, y + 46 * u, 20 * u, '#ffe7a0', 800, FONT_SANS, 'left');
  ctx.globalAlpha = 1;
  text(ctx, left > 0 ? `${left} more level${left > 1 ? 's' : ''} to clear` : 'Back at the next level', tx, y + 66 * u, 12 * u, 'rgba(255,220,210,0.8)', 700, FONT_SANS, 'left');
  ctx.restore();
}


// the controller's face buttons as coloured discs (X blue, Y yellow, B red, A green)
export const FACE = { X: '#3a7ae0', Y: '#e0b030', B: '#d04040', A: '#5aa832' };
export function drawFaceButton(ctx, name, cx, cy, r, dim = false) {
  ctx.save(); ctx.globalAlpha *= dim ? 0.6 : 1;
  ctx.fillStyle = FACE[name] || '#3a3440'; ctx.strokeStyle = 'rgba(20,14,20,0.9)'; ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.font = `800 ${Math.round(r * 1.15)}px ${FONT_SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(name, cx, cy + r * 0.06);
  ctx.restore();
}
// which button does what (one weapon): basic, secondary, special
export function attackKeys(pad) { return pad ? ['X', 'Y', 'B'] : ['LMB', 'RMB', 'Q']; }

// The bottom HUD is laid out like the controller: the attacks as its face buttons (Y on top, X left, B right) with the
// dash as A at the bottom. The talents sit on the same row as the attacks, LB / LT to the left and RB / RT to the
// right (LT and RT outermost), and a talent slot only appears once a talent is on that button.
// Every slot shares one look: black lacquer with a gold-leaf inner border and gold corner fittings (bright when
// ready), an ink-wash sweep while it recovers, and its button as a vermilion hanko seal (keyboard) or the
// controller's own button.
function slotFrame(ctx, x, y, s, u, ready, off = false) {
  ctx.fillStyle = off ? 'rgba(26,22,26,0.82)' : 'rgba(14,10,14,0.8)'; ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = off ? 'rgba(150,146,154,0.4)' : ready ? 'rgba(232,196,112,0.95)' : 'rgba(232,196,112,0.28)';
  ctx.lineWidth = Math.max(1, 1.3 * u); ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
}
// a button label at (x, y): the controller's button, or a vermilion hanko with the key
function slotKey(ctx, label, x, y, u, pad, dim = false) {
  if (pad) {
    if (label.length === 1) drawFaceButton(ctx, label, x, y, 9 * u, dim);
    else { ctx.save(); ctx.globalAlpha *= dim ? 0.6 : 1; drawPadButton(ctx, label, x, y, 15 * u, '#1e1a24', '#e8c470'); ctx.restore(); }
    return;
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.06); ctx.globalAlpha *= dim ? 0.6 : 1;
  ctx.font = `800 ${9.5 * u}px ${FONT_SANS}`;
  const w = Math.max(15 * u, ctx.measureText(label).width + 8 * u), h = 15 * u;
  ctx.fillStyle = dim ? '#6a5a58' : '#b52a22'; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 2.5 * u); ctx.fill();
  ctx.strokeStyle = 'rgba(255,236,220,0.55)'; ctx.lineWidth = 0.8 * u; ctx.beginPath(); ctx.roundRect(-w / 2 + 1.8 * u, -h / 2 + 1.8 * u, w - 3.6 * u, h - 3.6 * u, 1.5 * u); ctx.stroke();
  ctx.restore();
  text(ctx, label, x, y + 0.5 * u, 9.5 * u, '#fff2e4', 800);
}

function drawSlots(ctx, g, p, idx, coop, u) {
  const v = g.view;
  const pad = p.ctl.mode === 'pad';
  const slotS = 52 * u, DX = 57 * u, DY = 45 * u;
  const cx = coop && !g.online ? (idx === 0 ? v.W * 0.27 : v.W * 0.73) : v.W / 2, cy = v.H - 84 * u; // (online: just yours, in the middle)
  ctx.globalAlpha = p.dead ? 0.4 : 1;
  const w = p.weapons[0];
  const labels = attackKeys(pad);
  // basic = X (left), secondary = Y (top), special = B (right)
  const spots = [[cx - DX, cy], [cx, cy - DY], [cx + DX, cy]];
  [['basic', w.def.basic, w.cd, w.cdMax], ['secondary', w.def.secondary, w.ccd || 0, w.ccdMax], ['special', w.def.special, w.scd, w.scdMax]].forEach(([kind, def, own, ownMax], s) => {
    if (!def) return;
    const x = spots[s][0] - slotS / 2, y = spots[s][1] - slotS / 2;
    // you can attack again when both this attack's cooldown and the weapon's attack lock are done
    const lk = w.lockT || 0;
    const remaining = Math.max(own, lk);
    const frac = own >= lk ? own / (ownMax || 1) : lk / (w.lockMax || 1);
    const cost = p.kiCost(def, kind === 'basic' ? null : w);
    const noEnergy = cost > 0 && p.energy < cost;
    slotFrame(ctx, x, y, slotS, u, remaining <= 0.01, noEnergy);
    ctx.save(); ctx.translate(x + slotS / 2, y + slotS / 2);
    ctx.globalAlpha *= noEnergy ? 0.45 : 1;
    if (kind === 'special') drawSpecialIcon(ctx, w.key, slotS / 44, noEnergy ? '#8a8690' : '#f2e6cc');
    else if (kind === 'secondary') drawSecondaryIcon(ctx, w.key, slotS / 44, noEnergy ? '#8a8690' : '#cfe4f2');
    else drawBasicIcon(ctx, w.key, u);
    ctx.restore();
    if (noEnergy) {
      // not enough ki: ki fills up from the bottom toward the cost
      const k = clamp(p.energy / (cost || 1), 0, 1), i = 4 * u;
      ctx.fillStyle = 'rgba(79,200,220,0.28)'; ctx.fillRect(x + i, y + slotS - i - (slotS - 2 * i) * k, slotS - 2 * i, (slotS - 2 * i) * k);
    } else drawCooldown(ctx, x, y, slotS, remaining, frac, u);
    if (w.arts && w.arts[kind]) { // this attack has a technique: a gold diamond in the corner
      const dx = x + slotS - 2 * u, dy = y + 2 * u, r = 5 * u;
      ctx.fillStyle = '#ffd070'; ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(dx, dy - r); ctx.lineTo(dx + r, dy); ctx.lineTo(dx, dy + r); ctx.lineTo(dx - r, dy); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    denyFlash(ctx, p, kind, x, y, slotS, slotS, u);
    slotKey(ctx, labels[s], x + 3 * u, y + 3 * u, u, pad, noEnergy);
    if (cost > 0) { // energy cost: a small dark plate in the corner, red when you can't pay it yet
      const bw = 22 * u, bh = 13 * u, bx = x + slotS - bw - 2 * u, by = y + slotS - bh - 2 * u;
      ctx.fillStyle = noEnergy ? 'rgba(120,20,24,0.95)' : 'rgba(14,40,46,0.95)'; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 2 * u); ctx.fill();
      ctx.strokeStyle = noEnergy ? '#e05a50' : '#4fc8dc'; ctx.lineWidth = 1; ctx.stroke();
      text(ctx, `${cost}`, bx + bw / 2, by + bh / 2 + 0.5 * u, 9.5 * u, noEnergy ? '#ffd0c8' : '#d8f6ff', 800);
    }
  });
  // dash: a horizontal bar under the attacks (A / Space): 疾 on the left, it fills left to right as it recharges,
  // one pip per charge on the right
  {
    const d = p.dash, ready = (p.dashCharges ?? 1) > 0, bw = 2 * DX - slotS * 0.15, bh = 20 * u, bx = cx - bw / 2, by = cy + DY - bh / 2 - 6 * u;
    ctx.fillStyle = 'rgba(14,10,14,0.8)'; ctx.fillRect(bx, by, bw, bh);
    const k = ready ? 1 : 1 - clamp(d.cd / (d.cdMax || 1), 0, 1);
    ctx.fillStyle = ready ? 'rgba(232,196,112,0.22)' : 'rgba(232,196,112,0.12)'; ctx.fillRect(bx, by, bw * k, bh);
    ctx.strokeStyle = ready ? 'rgba(232,196,112,0.95)' : 'rgba(232,196,112,0.28)'; ctx.lineWidth = Math.max(1, 1.3 * u); ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    text(ctx, !ready && d.cd >= 0.2 ? d.cd.toFixed(1) : 'Dash', cx, by + bh / 2 + 1, 12.5 * u, ready ? '#f2e6cc' : '#fff4e0', 800, FONT_SERIF);
    if (p.dashMax > 1) for (let q = 0; q < p.dashMax; q++) { const on = q < (p.dashCharges ?? 1); ctx.fillStyle = on ? '#e8c470' : 'rgba(90,80,90,0.9)'; ctx.fillRect(bx + bw - 10 * u - q * 8 * u, by + bh / 2 - 3 * u, 5 * u, 6 * u); }
    denyFlash(ctx, p, 'dash', bx, by, bw, bh, u);
    slotKey(ctx, pad ? 'A' : 'Space', cx, by - 2 * u, u, pad);
  }
  // the weapon's name above the diamond (its imbuements are in the left column)
  {
    const top = cy - DY - slotS / 2;
    text(ctx, w.def.name, cx, top - 9 * u, 11 * u, 'rgba(246,238,220,0.85)', 700);
  }
  // talents, on the attacks' row: LB then LT going out to the left, RB then RT going out to the right; only filled ones
  if (!(p.dead && coop)) {
    const ts = 46 * u, gap = 12 * u, inner = DX + slotS / 2 + 18 * u + ts / 2;
    const xs = [cx - inner, cx - inner - ts - gap, cx + inner, cx + inner + ts + gap];
    const keys = pad ? ['LB', 'LT', 'RB', 'RT'] : ['1', '2', '3', '4'];
    for (let i = 0; i < 4; i++) {
      const t = p.talents && p.talents[i];
      if (!t) continue;
      const x = xs[i] - ts / 2, y = cy - ts / 2, ready = t.cd <= 0;
      slotFrame(ctx, x, y, ts, u, ready);
      ctx.save(); ctx.translate(x + ts / 2, y + ts / 2); drawIcon(ctx, `talent_${t.key}`, ts / 85, ready ? '#ffe9b0' : 'rgba(255,233,176,0.4)', g.realTime); ctx.restore();
      if (!ready) drawCooldown(ctx, x, y, ts, t.cd, clamp(t.cd / (t.cdMax || 1), 0, 1), u, true);
      const ri = t.rarity || 0, col = ['#c8bca8', '#4a8ae8', '#a85ae0', '#f0b030'][ri]; // one gem per rarity step
      for (let k = 0; k <= ri; k++) { const gx = x + ts - 7 * u - k * 7 * u, gy = y + ts - 7 * u; ctx.fillStyle = col; ctx.strokeStyle = '#120c10'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(gx, gy - 3.5 * u); ctx.lineTo(gx + 3 * u, gy); ctx.lineTo(gx, gy + 3.5 * u); ctx.lineTo(gx - 3 * u, gy); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      denyFlash(ctx, p, 't' + i, x, y, ts, ts, u);
      slotKey(ctx, keys[i], x + 3 * u, y + 3 * u, u, pad, !ready);
    }
  }
  ctx.globalAlpha = 1;
}

function drawPadIcon(ctx, x, y, u, connected, active, count) {
  ctx.save(); ctx.translate(x, y); ctx.scale(u, u);
  ctx.globalAlpha = connected ? (active ? 1 : 0.6) : 0.25;
  ctx.fillStyle = '#1c1824'; ctx.strokeStyle = connected ? '#7ad07a' : '#888'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-16, -8); ctx.lineTo(16, -8); ctx.quadraticCurveTo(26, -8, 24, 8); ctx.quadraticCurveTo(22, 16, 14, 10); ctx.lineTo(-14, 10); ctx.quadraticCurveTo(-22, 16, -24, 8); ctx.quadraticCurveTo(-26, -8, -16, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(-14, -2, 8, 2.4); ctx.fillRect(-11.2, -5, 2.4, 8);
  for (const [bx, by] of [[11, -4], [15, 0], [11, 4], [7, 0]]) { ctx.beginPath(); ctx.arc(bx, by, 1.6, 0, TAU); ctx.fill(); }
  if (count > 1) { ctx.font = '800 10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`×${count}`, 27, 4); }
  ctx.restore();
}

function drawGatePointer(ctx, g, u, t) {
  const v = g.view;
  const [sx, sy] = v.toScreen(g.world.gate.x, g.world.gate.y, 1.2);
  const m = 60 * u;
  const inside = sx > m && sx < v.W - m && sy > m && sy < v.H - m;
  if (inside) {
    outlinedText(ctx, '⛩ Enter the gate', sx, sy - 70 * u - Math.sin(t * 3) * 5 * u, 15 * u, '#ffe7a0', 'rgba(20,10,10,0.85)', 800, FONT_SANS, 4);
    return;
  }
  const cx = v.W / 2, cy = v.H / 2;
  const a = Math.atan2(sy - cy, sx - cx);
  const ex = clamp(sx, m, v.W - m), ey = clamp(sy, m, v.H - m);
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
  ctx.fillStyle = `rgba(255,220,140,${0.75 + 0.25 * Math.sin(t * 6)})`;
  ctx.beginPath(); ctx.moveTo(22 * u, 0); ctx.lineTo(-8 * u, -13 * u); ctx.lineTo(-2 * u, 0); ctx.lineTo(-8 * u, 13 * u); ctx.closePath(); ctx.fill();
  ctx.restore();
  text(ctx, 'Gate', ex - Math.cos(a) * 26 * u, ey - Math.sin(a) * 26 * u, 12 * u, '#ffe7a0', 800);
}

// ---------------------------------------------------------------- boss intro
const splashCache = {};
function inkSplash(type) {
  if (splashCache[type]) return splashCache[type];
  const r = seededRng(type.length * 977 + 13);
  const blobs = [];
  for (let i = 0; i < 26; i++) { const a = r() * TAU, d = r.range(0, 1) ** 1.5; blobs.push([Math.cos(a) * d * 1.3, Math.sin(a) * d * 0.6, r.range(0.15, 0.45)]); }
  for (let i = 0; i < 14; i++) { const a = r() * TAU, d = r.range(1.1, 1.6); blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.7, r.range(0.03, 0.08)]); }
  return (splashCache[type] = blobs);
}

export function drawBossIntro(ctx, g) {
  const I = g.intro; if (!I) return;
  const v = g.view, u = uiScale(v), t = I.t, D = INTRO_DUR;
  // letterbox
  const bk = t < 0.5 ? ease.outCubic(t / 0.5) : t > D - 0.5 ? ease.outCubic(Math.max(0, (D - t) / 0.5)) : 1;
  const bh = v.H * 0.12 * bk;
  ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, v.W, bh); ctx.fillRect(0, v.H - bh, v.W, bh);
  // darken edges
  ctx.fillStyle = `rgba(8,4,12,${0.25 * bk})`; ctx.fillRect(0, 0, v.W, v.H);
  // title card
  const t0 = 2.1;
  if (t > t0 && t < D - 0.2) {
    const k = clamp((t - t0) / 0.3, 0, 1);
    const out = t > D - 0.7 ? clamp((D - 0.2 - t) / 0.5, 0, 1) : 1;
    const cx = v.W / 2, cy = v.H * 0.7;
    const sc = (1.35 - 0.35 * ease.outCubic(k)) * u;
    ctx.save(); ctx.globalAlpha = k * out; ctx.translate(cx, cy); ctx.scale(sc, sc);
    // red ink splash
    ctx.fillStyle = I.cfg.type === 'tengu' ? '#8a1a1a' : I.cfg.type === 'oni_lord' ? '#a8200e' : I.cfg.type === 'gensai' ? '#5a0a18' : '#9a1414';
    ctx.beginPath();
    for (const [x, y, r] of inkSplash(I.cfg.type)) { ctx.moveTo(x * 260 + r * 150, y * 120); ctx.ellipse(x * 260, y * 120, r * 150, r * 95, 0, 0, TAU); }
    ctx.fill();
    // huge kanji on the left, name and title on the right
    outlinedText(ctx, I.cfg.jp, -180, 0, 110, '#f8f0de', '#0a0608', 800, FONT_SERIF, 10);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `800 38px ${FONT_SERIF}`;
    ctx.lineWidth = 6; ctx.strokeStyle = '#0a0608'; ctx.strokeText(I.cfg.name, -50, -22); ctx.fillStyle = '#f8f0de'; ctx.fillText(I.cfg.name, -50, -22);
    ctx.font = `700 20px ${FONT_SANS}`; ctx.lineWidth = 4; ctx.strokeText(I.cfg.title, -48, 18); ctx.fillStyle = '#ffd7a8'; ctx.fillText(I.cfg.title, -48, 18);
    ctx.font = `800 13px ${FONT_SANS}`; ctx.fillStyle = 'rgba(255,230,200,0.85)'; ctx.fillText(I.cfg.type === 'gensai' ? '— FINAL BOSS —' : '— BOSS —', -48, 46);
    ctx.restore();
  }
  if (t > 1.2 && t < D - 0.6 && g.role !== 'client') text(ctx, input.mode === 'pad' ? 'Ⓐ skip' : 'Enter to skip', v.W - 30 * u, v.H - bh / 2, 12 * u, 'rgba(255,255,255,0.55)', 700, FONT_SANS, 'right');
}

// ---------------------------------------------------------------- banners
export function drawBanners(ctx, g) {
  const v = g.view, u = uiScale(v);
  for (const b of g.banners) {
    const k = b.t / b.dur;
    const a = k < 0.15 ? k / 0.15 : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    const y = v.H * (b.y ?? 0.3);
    ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
    const w = Math.min(v.W * 0.8, 760 * u) * ease.outCubic(clamp(k / 0.2, 0, 1));
    ctx.fillStyle = b.color || 'rgba(14,10,18,0.78)';
    ctx.beginPath(); ctx.moveTo(v.W / 2 - w / 2, y - 34 * u); ctx.quadraticCurveTo(v.W / 2, y - 42 * u, v.W / 2 + w / 2, y - 30 * u);
    ctx.lineTo(v.W / 2 + w / 2 - 20 * u, y + 34 * u); ctx.quadraticCurveTo(v.W / 2, y + 40 * u, v.W / 2 - w / 2 + 14 * u, y + 30 * u); ctx.closePath(); ctx.fill();
    if (b.kanji) outlinedText(ctx, b.kanji, v.W / 2 - Math.min(w / 2, 300 * u) + 40 * u, y, 46 * u, b.kanjiColor || '#c8302e', 'rgba(0,0,0,0)', 800, FONT_SERIF, 0);
    outlinedText(ctx, b.title, v.W / 2, y - (b.sub ? 8 * u : 0), (b.size || 34) * u, '#f6eedc', 'rgba(10,6,12,0.8)', 800, FONT_SERIF, 5);
    if (b.sub) text(ctx, b.sub, v.W / 2, y + 22 * u, 15 * u, 'rgba(246,238,220,0.85)', 700);
    ctx.restore();
  }
}

// title, mode select and weapon select live in menu.js

// ---------------------------------------------------------------- pause / end screens
const END_AUTO_RETURN = 12;

export class Overlay {
  constructor(g) { this.g = g; this.sel = 0; this.t = 0; this.map = new RouteScreen(g); }
  // the pause menu's choices (Show map only when there is a route to show)
  pauseItems() { const g = this.g; return ['Resume', ...(g.route && !g.training ? ['Show map'] : []), 'Quit to main menu']; }
  // Show map: the area's route, to look at and hover (nothing can be chosen)
  openMap() {
    const g = this.g, R = g.route;
    if (!R) return;
    const cur = clamp(g.level, R.first, R.last); // (this level's column: the path you took marked, the paths after it greyed)
    this.map.open(R, cur, { readonly: true, sel: Math.max(0, (R.path && R.path[cur - R.first]) || 0) });
    this.map.peek = true;
  }

  // Pause: Resume / Quit at the top, this run's cards in a row below them (←/→ or the wheel scroll it),
  // the core stats in a panel at the top left and the chosen weapons (with imbuements and techniques) at the top right
  updatePause(dt) {
    this.t += dt;
    if (this.map.active) { // looking at the map: back / pause / confirm close it
      this.map.update(dt);
      if (this.map.t > 0.3 && (input.pressed('back') || input.pressed('pause') || input.pressed('confirm'))) { input.eat('back'); input.eat('pause'); input.eat('confirm'); this.map.active = false; sfx.flip(); }
      return;
    }
    const items = this.pauseItems(); this.sel = clamp(this.sel, 0, items.length - 1);
    if (input.pressed('up')) { this.sel = (this.sel + items.length - 1) % items.length; sfx.move(); }
    if (input.pressed('down')) { this.sel = (this.sel + 1) % items.length; sfx.move(); }
    if (this.g.players.length > 1) { // co-op: L1 / R1 switch between the players' cards
      const to = input.pressed('L1') ? 0 : input.pressed('R1') ? 1 : -1, m = input.mouse, v = this.g.view;
      let clickTab = -1;
      if (m.clicked && this.tabRects) this.tabRects.forEach((r, i) => { const mx = m.x * v.dpr, my = m.y * v.dpr; if (mx > r[0] && mx < r[0] + r[2] && my > r[1] && my < r[1] + r[3]) clickTab = i; });
      const pick = clickTab >= 0 ? clickTab : to;
      if (pick >= 0 && pick !== (this.cardTab || 0)) { this.cardTab = pick; this.cardSel = 0; this.cardScroll = 0; sfx.move(); }
      if (clickTab >= 0) m.clicked = false;
    }
    const n = this.runCards().length;
    if (input.pressed('left')) { this.cardSel = Math.max(0, (this.cardSel || 0) - 1); sfx.move(); }
    if (input.pressed('right')) { this.cardSel = Math.min(Math.max(0, n - 1), (this.cardSel || 0) + 1); sfx.move(); }
    if (input.mouse.wheel) { this.cardSel = clamp((this.cardSel || 0) + Math.sign(input.mouse.wheel), 0, Math.max(0, n - 1)); input.mouse.wheel = 0; }
    if (input.pressed('pause') || input.pressed('back')) { this.g.setPaused(false); input.eat('pause'); return; }
    if (input.pressed('confirm')) {
      input.eat('confirm'); input.eat('dash');
      const it = items[this.sel];
      if (it === 'Resume') this.g.setPaused(false); else if (it === 'Show map') this.openMap(); else this.g.toTitle();
    }
  }
  // every card this run's players picked (co-op: both, labelled), oldest first
  runCards() {
    const g = this.g, list = [], tab = g.players.length > 1 ? (this.cardTab || 0) : -1;
    for (const p of g.players) {
      if (tab >= 0 && p.index !== tab) continue; // (co-op: only the chosen player's tab)
      const picked = (p.picked || []).filter((c) => !c.traded); // (cards traded in are gone)
      for (const k of p.sac || []) if (!picked.some((c) => c.type === 'sacrifice' && c.key === k)) picked.push({ type: 'sacrifice', key: k, rarity: 0 }); // (the online joiner's sacrifices)
      for (const c of picked) list.push({ card: c, player: p, label: g.players.length > 1 ? `P${p.index + 1}` : '' });
    }
    return list;
  }

  drawPause(ctx) {
    const g = this.g, v = g.view, u = uiScale(v), t = this.t;
    ctx.fillStyle = 'rgba(8,6,14,0.74)'; ctx.fillRect(0, 0, v.W, v.H);
    outlinedText(ctx, '一時停止  Paused', v.W / 2, v.H * 0.08, 36 * u, '#f8f0de');
    this.pauseItems().forEach((s2, i) => {
      const y = v.H * 0.185 + i * 40 * u;
      if (i === this.sel) { ctx.fillStyle = 'rgba(200,48,46,0.85)'; ctx.fillRect(v.W / 2 - 140 * u, y - 19 * u, 280 * u, 38 * u); }
      text(ctx, s2, v.W / 2, y, 19 * u, '#f8f0de', 800);
    });
    // ---- this run's cards
    const list = this.runCards(), n = list.length, sel = clamp(this.cardSel || 0, 0, Math.max(0, n - 1));
    this.cardScroll = lerp(this.cardScroll ?? sel, sel, 0.18);
    const ch = Math.min(v.H * 0.42, 300 * u), cw = ch * (230 / 340), gap = 14 * u, cy = v.H * 0.585;
    if (g.players.length < 2) text(ctx, '札  Cards this run', v.W / 2, cy - ch / 2 - 26 * u, 15 * u, '#e8c470', 800, FONT_SERIF); // (co-op: the player tabs stand there)
    this.tabRects = null;
    if (g.players.length > 1) { // tabs: [L1] Player 1 | Player 2 [R1]
      const pad = input.mode === 'pad', tw = 130 * u, th = 24 * u, ty = cy - ch / 2 - 40 * u, cur = this.cardTab || 0;
      this.tabRects = [[v.W / 2 - tw - 4 * u, ty, tw, th], [v.W / 2 + 4 * u, ty, tw, th]];
      this.tabRects.forEach(([x, y, w, h], i) => {
        const on = i === cur, col = PLAYER_COLORS[i];
        ctx.fillStyle = on ? col : 'rgba(20,14,22,0.85)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 5 * u); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5 * u; ctx.stroke();
        text(ctx, `Player ${i + 1}`, x + w / 2, y + h / 2 + 0.5, 12.5 * u, on ? '#fff' : col, 800);
      });
      const key = (lbl, x) => (pad ? drawPadButton(ctx, lbl, x, ty + th / 2, 18 * u, '#1e1a24', '#e8c470') : slotKey(ctx, lbl, x, ty + th / 2, u, false));
      key(pad ? 'LB' : 'Q', v.W / 2 - tw - 24 * u); key(pad ? 'RB' : 'J', v.W / 2 + tw + 24 * u);
    }
    if (!n) text(ctx, 'No cards chosen yet', v.W / 2, cy, 18 * u, 'rgba(248,240,222,0.7)', 800, FONT_SERIF);
    // co-op: one player's cards at a time (the tabs above), on a band in their colour, every card framed in it
    const coopC = g.players.length > 1, slot = (i) => i + (coopC && list[i].player.index === 1 ? 0.6 : 0);
    const span = n ? slot(n - 1) : 0, fits = (span + 1) * (cw + gap) <= v.W * 0.9; // all fit: the whole row centred; else the chosen card in the middle
    const xOf = (i) => v.W / 2 + (slot(i) - (fits ? span / 2 : slot(Math.round(this.cardScroll)) + (this.cardScroll - Math.round(this.cardScroll)))) * (cw + gap);
    if (coopC) for (const pi of [0, 1]) {
      const idx = list.map((c, i) => (c.player.index === pi ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      const col = PLAYER_COLORS[pi], x0 = xOf(idx[0]) - cw / 2 - 8 * u, x1 = xOf(idx[idx.length - 1]) + cw / 2 + 8 * u;
      ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x0, cy - ch / 2 - 14 * u, x1 - x0, ch + 28 * u, 10 * u); ctx.fill();
      ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = 2 * u; ctx.stroke(); ctx.restore();
    }
    for (let i = 0; i < n; i++) {
      const x = xOf(i);
      if (x < -cw || x > v.W + cw) continue;
      const on = i === sel, { card, player } = list[i];
      ctx.save(); ctx.translate(x, cy - (on ? 8 * u : 0)); const sc = on ? 1.04 : 0.92; ctx.scale(sc, sc);
      ctx.globalAlpha = on ? 1 : 0.78;
      drawCard(ctx, card, cw, ch, t + i * 0.7, { hover: on, tiltX: 0, tiltY: 0 }, player);
      if (coopC) { ctx.strokeStyle = PLAYER_COLORS[player.index]; ctx.lineWidth = 3 * u; ctx.strokeRect(-cw / 2 - 3 * u, -ch / 2 - 3 * u, cw + 6 * u, ch + 6 * u); }
      ctx.restore();
    }
    if (n > 1) text(ctx, `${sel + 1} / ${n}   ·   ← → to browse`, v.W / 2, cy + ch * 0.5 + 28 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
    // ---- the top-left HUD stays as it is (co-op: both corners), its stats and imbuements named
    g.players.forEach((p, i) => drawPlayerPanel(ctx, g, p, i, g.players.length > 1, u, true));
    // ---- online: the game code, always in view, so a partner who dropped out can join again with it
    if (g.online && net.key) {
      const pw = 250 * u, ph = 54 * u, px = v.W / 2 - pw / 2, py = v.H - ph - 16 * u;
      ctx.fillStyle = 'rgba(16,10,14,0.9)'; ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = 'rgba(232,196,112,0.7)'; ctx.lineWidth = 1.2; ctx.strokeRect(px, py, pw, ph);
      text(ctx, 'Game code', px + pw / 2, py + 14 * u, 11 * u, 'rgba(248,240,222,0.7)', 700);
      text(ctx, net.key.split('').join(' '), px + pw / 2, py + 34 * u, 22 * u, '#ffd88a', 800, FONT_SANS);
      if (!net.connected) text(ctx, net.role === 'host' ? 'Your partner can join again with this code' : 'Disconnected', px + pw / 2, py - 10 * u, 11 * u, '#ff9a8a', 700);
    }
    if (this.map.active) this.map.draw(ctx); // Show map: over everything
  }

  updateEnd(dt) {
    this.t += dt;
    // online: both go back to the weapon select together (still connected); otherwise to the main menu
    const leave = () => (this.g.online ? this.g.toLobby() : this.g.toTitle());
    if (this.t > 1.2 && (input.pressed('confirm') || input.pressed('pause') || input.mouse.clicked)) { input.eat('confirm'); input.eat('pause'); leave(); return; }
    if (this.t > END_AUTO_RETURN) leave();
  }

  drawEnd(ctx, win) {
    const g = this.g, v = g.view, u = uiScale(v), t = this.t;
    const a = clamp(t / 0.8, 0, 1);
    ctx.fillStyle = win ? `rgba(30,20,8,${0.72 * a})` : `rgba(20,4,8,${0.8 * a})`; ctx.fillRect(0, 0, v.W, v.H);
    ctx.save(); ctx.globalAlpha = a;
    // ink brush slash behind the title
    ctx.fillStyle = win ? 'rgba(200,150,40,0.35)' : 'rgba(140,10,20,0.45)';
    ctx.beginPath(); ctx.moveTo(v.W * 0.2, v.H * 0.3); ctx.quadraticCurveTo(v.W * 0.5, v.H * 0.18, v.W * 0.82, v.H * 0.24); ctx.lineTo(v.W * 0.8, v.H * 0.36); ctx.quadraticCurveTo(v.W * 0.5, v.H * 0.32, v.W * 0.18, v.H * 0.38); ctx.closePath(); ctx.fill();
    outlinedText(ctx, win ? '勝利' : '敗北', v.W / 2, v.H * 0.28, 110 * u, win ? '#ffd45e' : '#e04848', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 8 * u);
    outlinedText(ctx, win ? 'Victory — Gensai has fallen, the Kagerō are free' : 'Defeat — your path ends here', v.W / 2, v.H * 0.43, 28 * u, '#f8f0de');
    const rs = g.runStats;
    const m = Math.floor(rs.time / 60), s = Math.floor(rs.time % 60);
    const lines = [`Level reached: ${g.level}`, `Enemies slain: ${rs.kills}`, `Damage dealt: ${Math.round(rs.damage)}`, `Time: ${m}:${String(s).padStart(2, '0')}`, `Cards taken: ${rs.upgrades}`];
    lines.forEach((l, i) => text(ctx, l, v.W / 2, v.H * 0.53 + i * 26 * u, 17 * u, 'rgba(248,240,222,0.9)', 700));
    if (t > 1.2) {
      const [bx, by, bw, bh] = [v.W / 2 - 170 * u, v.H * 0.84 - 26 * u, 340 * u, 52 * u];
      ctx.fillStyle = `rgba(200,48,46,${0.8 + 0.2 * Math.sin(g.realTime * 4)})`; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#f4d690'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
      const where = g.online ? 'weapon select' : 'main menu';
      text(ctx, input.mode === 'pad' ? `Ⓐ  Return to ${where}` : `Enter — Return to ${where}`, v.W / 2, by + bh / 2, 18 * u, '#fff8e8', 800);
      text(ctx, `Returning ${g.online ? 'together ' : ''}automatically in ${Math.max(0, Math.ceil(END_AUTO_RETURN - t))}s`, v.W / 2, by + bh + 22 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- debug overlay
export function drawDebug(ctx, g) {
  const v = g.view, u = uiScale(v), p = g.player;
  const lines = [
    `FPS ${g.fps.toFixed(0)}  (frame ${g.frameMs.toFixed(1)} ms)`,
    `enemies ${g.enemies.length}  projectiles ${g.projectiles.length}  particles ${g.particles.list.length}`,
    `state ${g.state}  level ${g.level}  biome ${g.world ? g.world.biome.key : '-'}  players ${g.players.length}${g.god ? '  GOD' : ''}`,
  ];
  if (p) {
    const s = p.stats;
    lines.push(`crit ${(s.critChance * 100).toFixed(0)}%  critDmg +${(s.critDamage * 100).toFixed(0)}%  dmg x${s.baseDamage.toFixed(2)}${p.adminMul > 1 ? ` (admin x${p.adminMul})` : ''}  cdMul x${(s.cooldownMul || 1).toFixed(2)}  dashCd ${p.dashCooldown.toFixed(2)}s`);
    lines.push(`energyRegen ${s.energyRegen.toFixed(2)}/s  healthRegen ${s.healthRegen.toFixed(2)}/s  hp ${p.hp.toFixed(1)}  energy ${p.energy.toFixed(1)}`);
    lines.push(`aim ${p.aimMode || '-'}  pos ${p.x.toFixed(1)},${p.y.toFixed(1)}  actionLock ${p.actionT.toFixed(2)}`);
  }
  lines.push(`input mode ${input.mode}  controllers ${input.padCount}  co-op input ${input.coop} ${input.pad.mapping ? '(' + input.pad.mapping + ')' : ''}`);
  if (input.pad.connected) {
    lines.push(`id: ${input.pad.id.slice(0, 60)}`);
    lines.push(`buttons: ${input.pad.buttons.map((b, i) => (b ? `${i}:${b}` : null)).filter(Boolean).join(' ') || '-'}`);
    lines.push(`axes: ${input.pad.axes.join('  ')}`);
    const names = ['L1', 'L2', 'R1', 'R2', 'dash', 'pause'];
    lines.push(`P1 actions: ${names.filter((n) => input.players[0].down(n)).join(' ') || '-'}   P2 actions: ${names.filter((n) => input.players[1].down(n)).join(' ') || '-'}`);
  }
  const h = lines.length * 17 * u + 14 * u;
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(10 * u, v.H - h - 120 * u, 620 * u, h);
  lines.forEach((l, i) => text(ctx, l, 18 * u, v.H - h - 120 * u + 14 * u + i * 17 * u, 12 * u, '#bfffbf', 600, 'monospace', 'left'));
}

// one life on the HUD: a small red heart, ink-edged
function lifeHeart(ctx, x, y, r) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.moveTo(0, r * 1.0);
  ctx.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.9, -r * 1.25, 0, -r * 0.45);
  ctx.bezierCurveTo(r * 0.9, -r * 1.25, r * 1.5, -r * 0.1, 0, r * 1.0);
  ctx.closePath();
  ctx.fillStyle = '#c8202c'; ctx.fill(); ctx.lineWidth = Math.max(1.2, r * 0.28); ctx.strokeStyle = 'rgba(25,8,12,0.9)'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,200,200,0.6)'; ctx.beginPath(); ctx.ellipse(-r * 0.45, -r * 0.35, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// text that shrinks to fit a width
function fitText(ctx, str, x, y, size, maxW, color, weight, font) {
  let fs = size; ctx.font = `${weight} ${fs}px ${font}`;
  while (ctx.measureText(str).width > maxW && fs > size * 0.6) { fs -= 0.5; ctx.font = `${weight} ${fs}px ${font}`; }
  text(ctx, str, x, y, fs, color, weight, font);
}
// small text with a dark edge, so it reads on any stroke
function textEdge(ctx, str, x, y, size, color, align) {
  ctx.font = `800 ${Math.round(size)}px ${FONT_SANS}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,6,10,0.85)'; ctx.strokeText(str, x, y);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
// a tapered ink stroke (thick where it starts, a dry-brush tip): the health and ki bars
function inkStroke(ctx, x, y, w, h, k, fill, trail, flip) {
  const path = (len) => {
    ctx.beginPath();
    ctx.moveTo(0, h * 0.08);
    ctx.bezierCurveTo(len * 0.4, -h * 0.06, len * 0.8, h * 0.06, len, h * 0.2);
    ctx.quadraticCurveTo(len + h * 0.35, h * 0.5, len - h * 0.15, h * 0.78);
    ctx.bezierCurveTo(len * 0.8, h * 0.86, len * 0.4, h * 1.02, 0, h * 0.94);
    ctx.quadraticCurveTo(-h * 0.25, h * 0.5, 0, h * 0.08);
    ctx.closePath();
  };
  ctx.save(); ctx.translate(flip ? x + w : x, y); if (flip) ctx.scale(-1, 1);
  path(w); ctx.fillStyle = 'rgba(14,8,12,0.72)'; ctx.fill();
  if (trail !== null && trail > k) { path(Math.max(h * 0.4, w * trail)); ctx.fillStyle = 'rgba(255,240,220,0.7)'; ctx.fill(); }
  if (k > 0.005) { path(Math.max(h * 0.4, w * k)); ctx.fillStyle = fill; ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fillRect(0, h * 0.18, w * k - h * 0.2, h * 0.16); }
  path(w); ctx.strokeStyle = 'rgba(10,6,10,0.9)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}
// the HUD portrait: the player's own ninja (their colours and equipment gear), head and shoulders, drawn once
const PORTRAITS = {};
function hudPortrait(p, idx, flip) {
  const key = idx + '|' + (p.equip || 'default') + '|' + (flip ? 1 : 0) + '|' + JSON.stringify(p.pal || {});
  if (PORTRAITS[key]) return PORTRAITS[key];
  const N = 224, c = document.createElement('canvas'); c.width = c.height = N;
  const q = c.getContext('2d');
  const bg = q.createLinearGradient(0, 0, 0, N);
  bg.addColorStop(0, idx === 0 ? '#2c3658' : '#3c2a4c'); bg.addColorStop(1, '#100c16');
  q.fillStyle = bg; q.fillRect(0, 0, N, N);
  q.fillStyle = 'rgba(232,196,112,0.12)'; q.beginPath(); q.arc(N * 0.5, N * 0.33, N * 0.3, 0, Math.PI * 2); q.fill(); // a pale moon behind the head
  const s = N / 32, foot = N * 0.33 + 35 * s; // (the head big, in the upper third: the equipment band covers the chest)
  if (flip) { q.translate(N, 0); q.scale(-1, 1); }
  drawHumanoid(q, { x: N * 0.5, y: foot, z: 0, facing: 0.3, time: 0.6, walk: 0, move: 0, pal: p.pal, head: 'hood', scarf: true, sashTail: false,
    gear: p.equip && p.equip !== 'default' ? p.equip : null, weapon: null, weapon2: null, backWeapon: null, pose: null, flash: 0, rot: 0, sqx: 1, sqy: 1, s, alpha: 1 });
  return (PORTRAITS[key] = c);
}
// an ability you pressed that isn't ready (cooldown, ki, no dash charge): its slot flashes red for a moment
function denyFlash(ctx, p, key, x, y, w, h, u) {
  const at = p.denyAt && p.denyAt[key];
  if (at === undefined) return;
  const k = (performance.now() / 1000 - at) / 0.45;
  if (k < 0 || k >= 1) return;
  const a = (1 - k) * (0.55 + 0.45 * Math.cos(k * Math.PI * 4));
  ctx.save();
  ctx.fillStyle = `rgba(220,30,30,${(0.38 * a).toFixed(3)})`; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = `rgba(255,60,50,${a.toFixed(3)})`; ctx.lineWidth = 2.5 * u; ctx.strokeRect(x - 1 * u, y - 1 * u, w + 2 * u, h + 2 * u);
  ctx.restore();
}

// an imbuement's value as the HUD shows it
function elemText(w, k) { const v = w.elements[k]; return k === 'syphon' ? +(v * 100).toFixed(1) + '%' : (k === 'ice' || k === 'arcane' || k === 'burn') ? Math.round(v * 100) + '%' : `${v}`; }

// an imbuement as a round badge (the stat icons' shape): dark disc, a ring and the mark in its colour
function elemBadge(ctx, k, x, y, size) {
  const r = size / 2, col = ELEMENTS[k].color;
  ctx.fillStyle = 'rgba(16,12,20,0.92)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, size * 0.08); ctx.beginPath(); ctx.arc(x, y, r - ctx.lineWidth / 2, 0, TAU); ctx.stroke();
  drawElementMark(ctx, k, x, y + (k === 'lightning' || k === 'burn' ? 0 : 0.3), size / 19, col);
}

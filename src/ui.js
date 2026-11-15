// HUD, title screen, weapon select (solo/co-op), pause, end screens, banners, boss intro and the F3 debug overlay.
import { TAU, clamp, lerp, ease, seededRng } from './util.js';
import { WEAPONS, WEAPON_ORDER, UPGRADES, PLAYER_BASE, ELEMENTS, PLAYER_COLORS } from './config.js';
import { drawWeapon, INK } from './rig.js';
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
const STAT_ORDER = ['baseDamage', 'critChance', 'critDamage', 'moveSpeed', 'cooldown', 'energyRegen', 'kiCost', 'healthRegen'];
// move speed is shown with the weapons' own speed included
const statText = (p, k) => (k === 'moveSpeed' ? `${Math.round(p.stats.moveSpeed * (p.weaponMove || 1) * 100)}%` : fmtStat(k, p.stats[k]));

const FONT_SERIF = '"Shippori Mincho", serif';
const FONT_SANS = '"Zen Kaku Gothic New", sans-serif';
const WPAL = { metal: '#e6edf5', wood: '#8a5a32', accent: '#c0392b' };
const WICON = { katanas: 'katana', crossbow: 'crossbow', heavy: 'nodachi', knives: 'kunai', staff: 'holystaff', bo: 'bo', shield: 'shield_icon' };
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
    case 'katanas':
      for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(0, 0, 11, i * Math.PI + 0.3, i * Math.PI + 2.6); ctx.stroke(); const a = i * Math.PI + 2.6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11); ctx.lineTo(Math.cos(a) * 11 + Math.cos(a + 1.2) * 5, Math.sin(a) * 11 + Math.sin(a + 1.2) * 5); ctx.stroke(); }
      break;
    case 'crossbow':
      for (const a of [-0.35, 0, 0.35]) { ctx.save(); ctx.rotate(a - 0.8); ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(7, -3); ctx.lineTo(7, 3); ctx.fill(); ctx.restore(); }
      break;
    case 'heavy':
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(0, 4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(0, 6); ctx.lineTo(5, -1); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 10, 13, 3.5, 0, 0, TAU); ctx.stroke();
      break;
    case 'knives':
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
    case 'staff': // healing cross inside a circle
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.stroke();
      ctx.fillRect(-2.5, -8, 5, 16); ctx.fillRect(-8, -2.5, 16, 5);
      break;
  }
  ctx.restore();
}

function drawBasicIcon(ctx, key, u) {
  const k = WICON[key];
  if (k === 'shield_icon') { ctx.scale(1.15 * u, 1.15 * u); drawWeapon(ctx, k, 0, 0, 0, WPAL); return; }
  const pole = k === 'staff' || k === 'holystaff' || k === 'bo';
  const sc = k === 'kunai' ? 1.8 * u : k === 'nodachi' ? 0.85 * u : k === 'crossbow' ? 1.25 * u : pole ? 0.8 * u : 1.15 * u;
  ctx.scale(sc, sc);
  drawWeapon(ctx, k, k === 'crossbow' ? -5 : k === 'kunai' ? -4 : pole ? -14 : -13, k === 'crossbow' ? 0 : pole ? 12 : 9, k === 'crossbow' ? 0 : -0.75, WPAL, 0.6);
}

// cooldown sweep + seconds remaining
function drawCooldown(ctx, x, y, s, remaining, frac, u) {
  if (remaining <= 0.01) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.moveTo(x + s / 2, y + s / 2); ctx.arc(x + s / 2, y + s / 2, s * 0.75, -Math.PI / 2, -Math.PI / 2 + clamp(frac, 0, 1) * TAU); ctx.closePath(); ctx.fill();
  ctx.restore();
  // bright edge tracking the sweep
  ctx.strokeStyle = 'rgba(255,230,160,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.42, -Math.PI / 2, -Math.PI / 2 + clamp(frac, 0, 1) * TAU); ctx.stroke();
  if (remaining >= 0.2) outlinedText(ctx, remaining.toFixed(1), x + s / 2, y + s / 2 + 1, 15 * u, '#ffffff', 'rgba(0,0,0,0.9)', 800, FONT_SANS, 3);
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

function drawPlayerPanel(ctx, g, p, idx, coop, u) {
  const v = g.view, t = g.realTime;
  const right = coop && idx === 1;
  const W = v.W;
  // mirror helper for player 2 (top-right)
  const X = (x, w = 0) => (right ? W - x - w : x);
  const px = 24 * u, py = 22 * u;
  // portrait
  ctx.save(); ctx.translate(X(px + 30 * u), py + 30 * u);
  ctx.fillStyle = 'rgba(15,12,22,0.75)'; ctx.beginPath(); ctx.arc(0, 0, 32 * u, 0, TAU); ctx.fill();
  ctx.strokeStyle = coop ? PLAYER_COLORS[idx] : '#c9a54a'; ctx.lineWidth = 2.5 * u; ctx.stroke();
  // the player's pixel portrait (the same one the dialogue box uses), clipped to the circle
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 30 * u, 0, TAU); ctx.clip();
  ctx.imageSmoothingEnabled = false;
  if (right) ctx.scale(-1, 1); // player 2 faces inward too
  ctx.drawImage(portrait(idx === 0 ? 'kage' : 'kaze'), -34 * u, -32 * u, 68 * u, 68 * u);
  ctx.imageSmoothingEnabled = true;
  if (p.dead) { ctx.fillStyle = 'rgba(40,6,10,0.65)'; ctx.fillRect(-32 * u, -32 * u, 64 * u, 64 * u); }
  ctx.restore();
  ctx.beginPath(); ctx.arc(0, 0, 32 * u, 0, TAU); ctx.stroke(); // ring back on top
  if (p.dead) outlinedText(ctx, '死', 0, 2 * u, 30 * u, '#e05050', 'rgba(0,0,0,0.6)', 800, FONT_SERIF, 3 * u);
  if (coop) text(ctx, `P${idx + 1}`, 0, 40 * u, 11 * u, PLAYER_COLORS[idx], 800);
  ctx.restore();
  // bars
  const bw = 300 * u, bh = 20 * u, bx = X(px + 72 * u, bw);
  p.hpTrail = lerp(p.hpTrail ?? p.hp, p.hp, 0.04);
  const lowHp = p.hp < p.maxHp * 0.3 && !p.dead;
  brushBar(ctx, bx, py + 4 * u, bw, bh, p.hp / p.maxHp, lowHp ? `rgb(${200 + 55 * Math.sin(t * 8)},40,40)` : '#c8302e', 'rgba(20,10,14,0.75)', p.hpTrail / p.maxHp);
  text(ctx, p.dead ? (p.returnLevel ? `FALLEN — returns at level ${p.returnLevel}` : 'FALLEN') : `${Math.ceil(p.hp)} / ${p.maxHp}`, bx + 12 * u, py + 4 * u + bh / 2 + 1, 13 * u, '#fff', 800, FONT_SANS, 'left');
  const ew = bw * 0.85, ex = right ? bx + bw - ew : bx;
  brushBar(ctx, ex, py + 30 * u, ew, bh * 0.75, p.energy / p.maxEnergy, '#3fb6c8', 'rgba(10,16,24,0.75)');
  text(ctx, `${Math.floor(p.energy)} / ${p.maxEnergy}`, ex + 12 * u, py + 30 * u + bh * 0.375 + 1, 11 * u, '#eaffff', 800, FONT_SANS, 'left');
  // Battle Rush: bonus damage for the first seconds of the level
  if (p.rushT > 0 && !p.dead) {
    const str = `+${Math.round((p.rushMul - 1) * 100)}% DMG`;
    ctx.font = `800 ${Math.round(12 * u)}px ${FONT_SANS}`;
    const cw = ctx.measureText(str).width + 30 * u, ch = 22 * u, cx = right ? bx - 10 * u - cw : bx + bw + 10 * u, cy = py + 3 * u;
    ctx.fillStyle = `rgba(120,40,8,${0.8 + 0.15 * Math.sin(t * 6)})`; ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = '#ff8a3c'; ctx.lineWidth = 1.5 * u; ctx.strokeRect(cx, cy, cw, ch);
    ctx.save(); ctx.translate(cx + 12 * u, cy + ch / 2); drawIcon(ctx, 'rush', 0.26 * u, '#ffb070', t); ctx.restore();
    text(ctx, str, cx + 24 * u, cy + ch / 2 + 1, 12 * u, '#ffe0c0', 800, FONT_SANS, 'left');
  }
  // stat chips
  const S = p.stats;
  const chips = STAT_ORDER.map((k) => [k, statText(p, k)]);
  const iconS = 15 * u;
  const widths = chips.map(([, val]) => {
    ctx.font = `700 ${Math.round(11 * u)}px ${FONT_SANS}`;
    return ctx.measureText(val).width + iconS + 10 * u;
  });
  const total = widths.reduce((a, b) => a + b + 4 * u, 0);
  let cx = right ? W - (px + 72 * u) - total : bx;
  chips.forEach(([k, val], i) => {
    const w = widths[i];
    ctx.fillStyle = 'rgba(15,12,22,0.6)'; ctx.fillRect(cx, py + 52 * u, w, 18 * u);
    drawStatIcon(ctx, k, cx + 1.5 * u + iconS / 2, py + 61 * u, iconS);
    text(ctx, val, cx + w - 4 * u, py + 61 * u, 11 * u, '#f4ecdc', 700, FONT_SANS, 'right');
    cx += w + 4 * u;
  });
  // sacrifices taken: crimson seals under the stat chips
  if (p.sac && p.sac.length) {
    ctx.font = `700 ${Math.round(11 * u)}px ${FONT_SERIF}`;
    const items = p.sac.filter((k) => SACRIFICES[k]).map((k) => { const S = SACRIFICES[k]; return [S.title, ctx.measureText(`犠 ${S.title}`).width + 14 * u]; });
    const tot = items.reduce((a, it) => a + it[1] + 4 * u, 0);
    let sx = right ? W - (px + 72 * u) - tot : bx;
    for (const [title, w] of items) {
      ctx.fillStyle = 'rgba(90,10,18,0.78)'; ctx.fillRect(sx, py + 74 * u, w, 18 * u);
      ctx.strokeStyle = 'rgba(220,120,90,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(sx, py + 74 * u, w, 18 * u);
      text(ctx, `犠 ${title}`, sx + w / 2, py + 83 * u, 11 * u, '#ffd8c8', 700, FONT_SERIF);
      sx += w + 4 * u;
    }
  }
  drawSlots(ctx, g, p, idx, coop, u);
  if (p.dead && coop) drawFallen(ctx, g, p, idx, u);
  else drawTalents(ctx, g, p, idx, coop, u);
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

// talents: bottom-left for player 1, bottom-right for player 2 (X / Y / B, or 1 / 2 / 3)
function drawTalents(ctx, g, p, idx, coop, u) {
  if (!p.talents || !p.talents.length) return;
  const v = g.view, s = 58 * u, gap = 10 * u;
  const pad = p.ctl.mode === 'pad';
  const keys = pad ? ['X', 'Y', 'B'] : ['1', '2', '3'];
  const keyCol = pad ? ['#3a7ae0', '#e0b030', '#d04040'] : ['#e8c470', '#e8c470', '#e8c470'];
  const right = coop && idx === 1;
  const y = v.H - 84 * u - s - 34 * u;
  p.talents.forEach((t, i) => {
    const x = right ? v.W - 24 * u - (i + 1) * s - i * gap : 24 * u + i * (s + gap);
    const ready = t.cd <= 0;
    ctx.fillStyle = 'rgba(18,14,24,0.85)'; ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = ready ? '#ffd45e' : 'rgba(232,196,112,0.4)'; ctx.lineWidth = ready ? 3 : 2; ctx.strokeRect(x, y, s, s);
    ctx.save(); ctx.translate(x + s / 2, y + s / 2); drawIcon(ctx, `talent_${t.key}`, s / 85, ready ? '#ffe9b0' : 'rgba(255,233,176,0.4)', g.realTime); ctx.restore();
    if (!ready) {
      const k = clamp(t.cd / (t.cdMax || 1), 0, 1);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.moveTo(x + s / 2, y + s / 2); ctx.arc(x + s / 2, y + s / 2, s * 0.75, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.closePath(); ctx.fill();
      ctx.restore();
      outlinedText(ctx, Math.ceil(t.cd).toString(), x + s / 2, y + s / 2 + 1, 18 * u, '#fff', 'rgba(0,0,0,0.9)', 800, FONT_SANS, 3);
    }
    ctx.fillStyle = keyCol[i]; ctx.beginPath(); ctx.arc(x + 4 * u, y + 4 * u, 10 * u, 0, TAU); ctx.fill();
    text(ctx, keys[i], x + 4 * u, y + 4.5 * u, 11 * u, '#fff', 800);
    { const ri = t.rarity || 0, col = ['#c8bca8', '#4a8ae8', '#a85ae0', '#f0b030'][ri]; // one gem per rarity step
      for (let k = 0; k <= ri; k++) { const gx = x + s - 6 * u - k * 7 * u, gy = y + s - 8 * u; ctx.fillStyle = col; ctx.strokeStyle = '#120c10'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(gx, gy - 3.5 * u); ctx.lineTo(gx + 3 * u, gy); ctx.lineTo(gx, gy + 3.5 * u); ctx.lineTo(gx - 3 * u, gy); ctx.closePath(); ctx.fill(); ctx.stroke(); } }
  });
  text(ctx, '才 Talents', right ? v.W - 24 * u : 24 * u, y - 10 * u, 11 * u, 'rgba(232,196,112,0.85)', 800, FONT_SERIF, right ? 'right' : 'left');
}

function drawSlots(ctx, g, p, idx, coop, u) {
  const v = g.view;
  const pad = p.ctl.mode === 'pad';
  const slotS = 54 * u, gap = 8 * u, groupGap = 38 * u;
  const totalW = slotS * 4 + gap * 2 + groupGap + 70 * u;
  const center = coop ? (idx === 0 ? v.W * 0.27 : v.W * 0.73) : v.W / 2;
  let sx = center - totalW / 2;
  const sy = v.H - slotS - 30 * u;
  ctx.globalAlpha = p.dead ? 0.4 : 1;
  for (let i = 0; i < 2; i++) {
    const w = p.weapons[i];
    const labels = i === 0 ? (pad ? ['LB', 'LT'] : ['Q', 'E']) : (pad ? ['RB', 'RT'] : ['LMB', 'RMB']);
    const groupX = sx;
    for (let s = 0; s < 2; s++) {
      const isSpecial = s === 1;
      const def = isSpecial ? w.def.special : w.def.basic;
      const own = isSpecial ? w.scd : w.cd, ownMax = isSpecial ? w.scdMax : w.cdMax;
      // you can attack again when both this weapon's cooldown and its own attack lock are done
      const lk = w.lockT || 0;
      const remaining = Math.max(own, lk);
      const frac = own >= lk ? own / (ownMax || 1) : lk / (w.lockMax || 1);
      const cost = p.kiCost(def);
      const noEnergy = cost > 0 && p.energy < cost;
      const x = sx, y = sy;
      ctx.fillStyle = noEnergy ? 'rgba(30,20,25,0.85)' : 'rgba(18,14,24,0.8)';
      ctx.fillRect(x, y, slotS, slotS);
      ctx.strokeStyle = noEnergy ? 'rgba(150,146,154,0.6)' : remaining <= 0.01 ? '#e8c470' : 'rgba(232,196,112,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, slotS, slotS);
      ctx.save(); ctx.translate(x + slotS / 2, y + slotS / 2);
      ctx.globalAlpha *= noEnergy ? 0.45 : 1;
      if (isSpecial) drawSpecialIcon(ctx, w.key, slotS / 44, noEnergy ? '#8a8690' : '#f2e6cc'); else drawBasicIcon(ctx, w.key, u);
      ctx.restore();
      if (noEnergy) {
        // not enough ki: grayed out, with a ki bar filling up from the bottom toward the cost
        ctx.fillStyle = 'rgba(70,68,74,0.55)'; ctx.fillRect(x, y, slotS, slotS);
        const k = clamp(p.energy / (cost || 1), 0, 1);
        ctx.fillStyle = 'rgba(79,200,220,0.35)'; ctx.fillRect(x + 2, y + slotS - 2 - (slotS - 4) * k, slotS - 4, (slotS - 4) * k);
      } else drawCooldown(ctx, x, y, slotS, remaining, frac, u);
      if (w.arts && w.arts[isSpecial ? 'special' : 'basic']) { // this attack has a weapon art: a gold diamond in the corner
        const dx = x + slotS - 2 * u, dy = y + 2 * u, r = 5 * u;
        ctx.fillStyle = '#ffd070'; ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(dx, dy - r); ctx.lineTo(dx + r, dy); ctx.lineTo(dx, dy + r); ctx.lineTo(dx - r, dy); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      if (pad) { ctx.save(); ctx.globalAlpha *= noEnergy ? 0.6 : 1; drawPadButton(ctx, labels[s], x + 11 * u, y - 2 * u, 17 * u, '#1e1a24', noEnergy ? '#9a96a0' : '#e8c470'); ctx.restore(); }
      else {
        ctx.fillStyle = noEnergy ? 'rgba(150,146,154,0.9)' : 'rgba(232,196,112,0.95)'; ctx.fillRect(x - 3 * u, y - 9 * u, 30 * u, 15 * u);
        text(ctx, labels[s], x - 3 * u + 15 * u, y - 1.5 * u, 10 * u, '#1a1420', 800);
      }
      if (cost > 0) { // ki cost badge
        ctx.fillStyle = noEnergy ? '#5a5660' : '#2a8a9a'; ctx.fillRect(x + slotS - 24 * u, y + slotS - 14 * u, 24 * u, 14 * u);
        text(ctx, `${cost}`, x + slotS - 12 * u, y + slotS - 7 * u, 10 * u, '#fff', 800);
      }
      sx += slotS + gap;
    }
    // weapon name + elements
    const mid = groupX + slotS + gap / 2;
    text(ctx, w.def.name + (w.arts && w.arts.unique ? ' ◆' : ''), mid, sy + slotS + 11 * u, 11 * u, w.arts && w.arts.unique ? '#ffd890' : 'rgba(246,238,220,0.85)', 700);
    const els = Object.keys(ELEMENTS).filter((k) => w.elements[k] > 0);
    if (els.length) {
      const strs = els.map((k) => `${ELEMENTS[k].jp} ${k === 'syphon' ? +(w.elements[k] * 100).toFixed(1) + '%' : (k === 'ice' || k === 'wind') ? Math.round(w.elements[k] * 100) + '%' : w.elements[k]}`);
      let ox = mid - (strs.length - 1) * 26 * u;
      els.forEach((k, j) => { ctx.fillStyle = 'rgba(15,12,22,0.75)'; ctx.fillRect(ox - 24 * u, sy - 30 * u, 48 * u, 16 * u); text(ctx, strs[j], ox, sy - 22 * u, 11 * u, ELEMENTS[k].color, 800); ox += 52 * u; });
    }
    sx += groupGap - gap;
  }
  // dash
  const dx = sx + 22 * u, dy = sy + slotS / 2;
  const d = p.dash;
  ctx.fillStyle = 'rgba(18,14,24,0.8)'; ctx.beginPath(); ctx.arc(dx, dy, 24 * u, 0, TAU); ctx.fill();
  ctx.strokeStyle = d.cd <= 0 ? '#e8c470' : 'rgba(232,196,112,0.4)'; ctx.lineWidth = 2; ctx.stroke();
  if (d.cd > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.moveTo(dx, dy); ctx.arc(dx, dy, 24 * u, -Math.PI / 2, -Math.PI / 2 + (d.cd / (d.cdMax || 1)) * TAU); ctx.closePath(); ctx.fill();
  }
  text(ctx, '疾', dx, dy + 1, 18 * u, d.cd > 0 ? 'rgba(242,230,204,0.4)' : '#f2e6cc', 800, FONT_SERIF);
  if (d.cd >= 0.2) outlinedText(ctx, d.cd.toFixed(1), dx, dy + 1, 15 * u, '#fff', 'rgba(0,0,0,0.9)', 800, FONT_SANS, 3);
  text(ctx, pad ? 'A' : 'Space', dx, dy + 34 * u, 10 * u, 'rgba(232,196,112,0.95)', 800);
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
  constructor(g) { this.g = g; this.sel = 0; this.t = 0; }

  // Pause: Resume / Quit at the top, this run's cards in a row below them (←/→ or the wheel scroll it),
  // the core stats in a panel at the top left and the chosen weapons (with imbuements and techniques) at the top right
  updatePause(dt) {
    this.t += dt;
    if (input.pressed('up') || input.pressed('down')) { this.sel = 1 - (this.sel % 2); sfx.move(); }
    const n = this.runCards().length;
    if (input.pressed('left')) { this.cardSel = Math.max(0, (this.cardSel || 0) - 1); sfx.move(); }
    if (input.pressed('right')) { this.cardSel = Math.min(Math.max(0, n - 1), (this.cardSel || 0) + 1); sfx.move(); }
    if (input.mouse.wheel) { this.cardSel = clamp((this.cardSel || 0) + Math.sign(input.mouse.wheel), 0, Math.max(0, n - 1)); input.mouse.wheel = 0; }
    if (input.pressed('pause') || input.pressed('back')) { this.g.paused = false; input.eat('pause'); return; }
    if (input.pressed('confirm')) {
      input.eat('confirm'); input.eat('dash');
      if (this.sel % 2 === 0) this.g.paused = false; else this.g.toTitle();
    }
  }
  // every card this run's players picked (co-op: both, labelled), oldest first
  runCards() {
    const g = this.g, list = [];
    for (const p of g.players) {
      const picked = (p.picked || []).slice();
      for (const k of p.sac || []) if (!picked.some((c) => c.type === 'sacrifice' && c.key === k)) picked.push({ type: 'sacrifice', key: k, rarity: 0 }); // (the online joiner's sacrifices)
      for (const c of picked) list.push({ card: c, player: p, label: g.players.length > 1 ? `P${p.index + 1}` : '' });
    }
    return list;
  }

  drawPause(ctx) {
    const g = this.g, v = g.view, u = uiScale(v), t = this.t;
    ctx.fillStyle = 'rgba(8,6,14,0.74)'; ctx.fillRect(0, 0, v.W, v.H);
    outlinedText(ctx, '一時停止  Paused', v.W / 2, v.H * 0.08, 36 * u, '#f8f0de');
    ['Resume', 'Quit to main menu'].forEach((s2, i) => {
      const y = v.H * 0.17 + i * 42 * u;
      if (i === this.sel % 2) { ctx.fillStyle = 'rgba(200,48,46,0.85)'; ctx.fillRect(v.W / 2 - 140 * u, y - 19 * u, 280 * u, 38 * u); }
      text(ctx, s2, v.W / 2, y, 19 * u, '#f8f0de', 800);
    });
    // ---- this run's cards
    const list = this.runCards(), n = list.length, sel = clamp(this.cardSel || 0, 0, Math.max(0, n - 1));
    this.cardScroll = lerp(this.cardScroll ?? sel, sel, 0.18);
    const ch = Math.min(v.H * 0.42, 300 * u), cw = ch * (230 / 340), gap = 14 * u, cy = v.H * 0.62;
    text(ctx, '札  Cards this run', v.W / 2, cy - ch / 2 - 26 * u, 15 * u, '#e8c470', 800, FONT_SERIF);
    if (!n) text(ctx, 'No cards chosen yet', v.W / 2, cy, 18 * u, 'rgba(248,240,222,0.7)', 800, FONT_SERIF);
    for (let i = 0; i < n; i++) {
      const x = v.W / 2 + (i - this.cardScroll) * (cw + gap);
      if (x < -cw || x > v.W + cw) continue;
      const on = i === sel, { card, player, label } = list[i];
      ctx.save(); ctx.translate(x, cy - (on ? 8 * u : 0)); const sc = on ? 1.04 : 0.92; ctx.scale(sc, sc);
      ctx.globalAlpha = on ? 1 : 0.78;
      drawCard(ctx, card, cw, ch, t + i * 0.7, { hover: on, tiltX: 0, tiltY: 0 }, player);
      ctx.restore();
      if (label) text(ctx, label, x, cy + ch * 0.5 + 12 * u, 11 * u, PLAYER_COLORS[player.index], 800);
    }
    if (n > 1) text(ctx, `${sel + 1} / ${n}   ·   ← → to browse`, v.W / 2, cy + ch * 0.5 + 28 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
    // ---- core stats, top left (one panel per player)
    g.players.forEach((p, i) => {
      const pw = 236 * u, rowH = 19 * u, ph = 30 * u + STAT_ORDER.length * rowH, px = 16 * u, py = 16 * u + i * (ph + 10 * u);
      ctx.fillStyle = 'rgba(16,10,14,0.88)'; ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = 'rgba(232,196,112,0.55)'; ctx.lineWidth = 1.2; ctx.strokeRect(px, py, pw, ph);
      text(ctx, g.players.length > 1 ? `Player ${i + 1} · Core stats` : 'Core stats', px + 12 * u, py + 15 * u, 13 * u, g.players.length > 1 ? PLAYER_COLORS[i] : '#e8c470', 800, FONT_SERIF, 'left');
      STAT_ORDER.forEach((k, j) => {
        const y = py + 34 * u + j * rowH;
        drawStatIcon(ctx, k, px + 20 * u, y, 15 * u);
        text(ctx, UPGRADES[k].name, px + 34 * u, y, 12.5 * u, 'rgba(248,240,222,0.85)', 700, FONT_SANS, 'left');
        text(ctx, statText(p, k), px + pw - 12 * u, y, 12.5 * u, STAT_STYLE[k].color, 800, FONT_SANS, 'right');
      });
    });
    // ---- weapons, top right
    g.players.forEach((p, i) => {
      const pw = 290 * u, rowH = 46 * u, ph = 28 * u + p.weapons.length * rowH, px = v.W - pw - 16 * u, py = 16 * u + i * (ph + 10 * u);
      ctx.fillStyle = 'rgba(16,10,14,0.88)'; ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = 'rgba(232,196,112,0.55)'; ctx.lineWidth = 1.2; ctx.strokeRect(px, py, pw, ph);
      text(ctx, g.players.length > 1 ? `Player ${i + 1} · Weapons` : 'Weapons', px + 12 * u, py + 15 * u, 13 * u, g.players.length > 1 ? PLAYER_COLORS[i] : '#e8c470', 800, FONT_SERIF, 'left');
      p.weapons.forEach((w, j) => {
        const y = py + 28 * u + j * rowH, ic = 34 * u;
        ctx.fillStyle = 'rgba(40,30,36,0.9)'; ctx.fillRect(px + 10 * u, y + 4 * u, ic, ic);
        ctx.save(); ctx.translate(px + 10 * u + ic / 2, y + 4 * u + ic / 2); ctx.beginPath(); ctx.rect(-ic / 2, -ic / 2, ic, ic); ctx.clip(); drawBasicIcon(ctx, w.key, u * 0.75); ctx.restore();
        const els = Object.keys(ELEMENTS).filter((k) => w.elements[k] > 0).map((k) => ELEMENTS[k].name).join(', ');
        const arts = Object.values(w.arts || {}).map((k) => ARTS[w.key][k].name).join(', ');
        text(ctx, `${w.def.name}  (${j === 0 ? 'L' : 'R'})`, px + 52 * u, y + 13 * u, 13.5 * u, '#f8f0de', 800, FONT_SERIF, 'left');
        text(ctx, [els, arts].filter(Boolean).join(' · ') || 'no imbuement or technique yet', px + 52 * u, y + 30 * u, 10.5 * u, els || arts ? '#e8c470' : 'rgba(248,240,222,0.5)', 700, FONT_SANS, 'left');
      });
    });
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

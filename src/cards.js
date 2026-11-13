// Upgrade cards: rolling, formatting and the trading-card style selection screen.
import { TAU, clamp, lerp, ease, rand, hsl } from './util.js';
import { RARITIES, UPGRADES, ELEMENTS, HEAL_CARD, ITEM_CARDS, PLAYER_COLORS, TALENTS, TALENT_CHANCE, MAX_TALENTS, TALENT_POWER, TALENT_UPGRADE_POWER, TALENT_UPGRADE_CD, TALENT_MIN_CD } from './config.js';
import { talentCd, grantTalent, upgradeTalent } from './talents.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { INK, drawWeapon } from './rig.js';
import { isStat, drawStatGlyph, drawStatIcon, STAT_STYLE } from './staticons.js';
import { rarityWeights, drawSacrificeCard } from './sacrifice.js';

// ---------------------------------------------------------------- rolling
function rollRarity(player) {
  const W = rarityWeights(player, RARITIES.map((r) => r.weight)); // sacrifices can shift the odds
  const total = W.reduce((s, w) => s + w, 0);
  let v = Math.random() * total;
  for (let i = 0; i < W.length; i++) { v -= W[i]; if (v < 0) return i; }
  return W.findIndex((w) => w > 0);
}

// the element a weapon already has (each weapon can carry only one), or null
export function weaponElement(w) { return Object.keys(ELEMENTS).find((k) => w.elements[k] > 0) || null; }

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Talent card options: new talents (while a slot is free) and upgrades for owned ones.
function talentOptions(player) {
  const out = [];
  if (player.sac && player.sac.includes('bareBlade')) return out; // sworn off talents
  for (const t of player.talents) out.push({ type: 'talent', talent: t.key, kind: Math.random() < 0.5 ? 'power' : 'cd', key: `talent_${t.key}` });
  if (player.talents.length < MAX_TALENTS && !player.singlePath) for (const k of Object.keys(TALENTS)) if (!player.talents.find((t) => t.key === k)) out.push({ type: 'talent', talent: k, kind: 'new', key: `talent_${k}` });
  return shuffle(out);
}

// A card is { type:'stat', stat } | { type:'element', element, slot } | { type:'talent', talent, kind },
// plus { rarity, value }.
export function rollUpgrades(player) {
  const stats = player.stats;
  const pool = [];
  for (const k of Object.keys(UPGRADES)) {
    const u = UPGRADES[k];
    if (u.cap && stats[k] >= u.cap - 1e-9) continue;
    if (u.min && stats[k] <= u.min + 1e-9) continue;
    if (k === 'critChance' && (player.noCrit || player.alwaysCrit)) continue; // crit chance means nothing
    if (k === 'critDamage' && player.noCrit) continue;
    pool.push({ type: 'stat', stat: k, key: k });
  }
  // elements: a weapon without one can get any element; a weapon that has one can only upgrade it
  const elementCards = [];
  player.weapons.forEach((w, slot) => {
    const own = weaponElement(w);
    for (const el of own ? [own] : Object.keys(ELEMENTS)) {
      const E = ELEMENTS[el];
      if (E.cap && w.elements[el] >= E.cap - 1e-9) continue;
      elementCards.push({ type: 'element', element: el, slot, key: `${el}${slot}` });
    }
  });
  pool.push(...shuffle(elementCards).slice(0, 3));
  // items: heal only when hurt, ki only when not full, Battle Rush always
  if (player.hp < player.maxHp - 1) pool.push({ type: 'heal', key: 'heal' });
  if (player.energy < player.maxEnergy - 1) pool.push({ type: 'energy', key: 'energy' });
  pool.push({ type: 'rush', key: 'rush' });
  shuffle(pool);
  const chosen = pool.slice(0, 3);
  // each slot has a small chance to be a talent card instead
  const talents = talentOptions(player);
  for (let i = 0; i < chosen.length && talents.length; i++) if (Math.random() < TALENT_CHANCE) chosen[i] = talents.pop();
  return chosen.map((c) => {
    const rarity = rollRarity(player);
    let value = 0;
    if (c.type === 'stat') value = UPGRADES[c.stat].values[rarity];
    else if (c.type === 'element') value = ELEMENTS[c.element].values[rarity];
    else if (ITEM_CARDS[c.type]) value = ITEM_CARDS[c.type].values[rarity];
    else value = c.kind === 'new' ? TALENT_POWER[rarity] : c.kind === 'power' ? TALENT_UPGRADE_POWER[rarity] : TALENT_UPGRADE_CD[rarity];
    return { ...c, rarity, value };
  });
}

function nextValue(player, card) {
  if (card.type === 'heal') return [player.hp, Math.min(player.maxHp, player.hp + card.value)];
  if (card.type === 'energy') return [player.energy, Math.min(player.maxEnergy, player.energy + card.value)];
  if (card.type === 'rush') return [player.nextRush || 0, Math.max(player.nextRush || 0, card.value)];
  if (card.type === 'talent') {
    const t = player.talents.find((x) => x.key === card.talent);
    if (card.kind === 'cd') { const cd = t ? talentCd(t) : TALENTS[card.talent].cd; return [cd, Math.max(TALENT_MIN_CD, cd * (1 - card.value))]; }
    const pw = t ? t.power : 1;
    return [t ? pw : 0, card.kind === 'new' ? 1 + card.value : pw + card.value];
  }
  if (card.type === 'element') {
    const cur = player.weapons[card.slot].elements[card.element];
    const E = ELEMENTS[card.element];
    const add = E.diminish ? card.value * Math.max(0, 1 - cur / E.cap) : card.value;
    return [cur, E.cap ? Math.min(E.cap, cur + add) : cur + add];
  }
  const u = UPGRADES[card.stat];
  const cur = player.stats[card.stat];
  let next = u.mult ? cur * (1 - card.value) : cur + card.value;
  if (u.cap) next = Math.min(u.cap, next);
  if (u.min) next = Math.max(u.min, next);
  return [cur, next];
}

export function applyUpgrade(player, card) {
  if (card.type === 'talent') {
    if (card.kind === 'new') grantTalent(player, card.talent, card.rarity);
    else upgradeTalent(player, card.talent, card.kind, card.rarity);
    return;
  }
  if (card.type === 'heal') {
    const got = player.heal(card.value);
    if (player.g && player.g.fx) { player.g.fx.text(player.x, player.y, `+${Math.round(got)}`, '#7dff9a', 18); player.g.particles.burst('glow', player.x, player.y, 0.8, 20, 2.5, 1, 2.4, '#9dffb0'); }
    return;
  }
  if (card.type === 'energy') {
    const before = player.energy; player.energy = Math.min(player.maxEnergy, player.energy + card.value);
    if (player.g && player.g.fx) { player.g.fx.text(player.x, player.y, `+${Math.round(player.energy - before)} ki`, '#9ee8ff', 18); player.g.particles.burst('glow', player.x, player.y, 0.8, 20, 2.5, 1, 2.4, '#9ee8ff'); }
    return;
  }
  if (card.type === 'rush') { player.nextRush = Math.max(player.nextRush || 0, card.value); return; }
  const [, next] = nextValue(player, card);
  if (card.type === 'element') player.weapons[card.slot].elements[card.element] = next;
  else player.stats[card.stat] = next;
}

export function fmtValue(fmt, v, bonus = false) {
  const sign = bonus ? '+' : '';
  switch (fmt) {
    case 'pct': return `${sign}${Math.round(v * 100)}%`;
    case 'pctPlus': return `+${Math.round(v * 100)}%`;
    case 'perSec1': return `${sign}${v.toFixed(1)}/s`;
    case 'perSec2': return `${sign}${v.toFixed(2)}/s`;
    case 'secs': return bonus ? `−${Math.round(v * 100)}%` : `${v.toFixed(1)}s`;
    case 'chains': return `${sign}${v}`;
    case 'dps': return `${sign}${v}/s`;
    case 'slow': return `${sign}${Math.round(v * 100)}%`;
  }
  return String(v);
}
export function fmtStat(stat, v, bonus = false) { return fmtValue(UPGRADES[stat].fmt, v, bonus); }

export function cardReadout(player, card) {
  if (card.type === 'talent') {
    const [cur, next] = nextValue(player, card);
    if (card.kind === 'cd') return { cur: `${cur.toFixed(1)}s`, bonus: `−${Math.round(card.value * 100)}%`, next: `${next.toFixed(1)}s` };
    if (card.kind === 'new') return { cur: 'none', bonus: 'NEW', next: `${TALENTS[card.talent].cd}s cd` };
    return { cur: `${Math.round(cur * 100)}%`, bonus: `+${Math.round(card.value * 100)}%`, next: `${Math.round(next * 100)}%` };
  }
  if (card.type === 'heal' || card.type === 'energy') {
    const [cur, next] = nextValue(player, card);
    return { cur: `${Math.ceil(cur)}`, bonus: `+${card.value}`, next: `${Math.ceil(next)}` };
  }
  if (card.type === 'rush') return { cur: 'none', bonus: `+${Math.round(card.value * 100)}%`, next: `+${Math.round(card.value * 100)}%` };
  const fmt = card.type === 'element' ? ELEMENTS[card.element].fmt : UPGRADES[card.stat].fmt;
  const [cur, next] = nextValue(player, card);
  return { cur: fmtValue(fmt, cur), bonus: fmtValue(fmt, card.value, true), next: fmtValue(fmt, next) };
}

export function cardInfo(player, card) {
  if (card.type === 'talent') {
    const T = TALENTS[card.talent];
    const sub = card.kind === 'new' ? `${T.desc} · ${T.cd}s cooldown` : card.kind === 'power' ? 'raises talent power' : 'shortens talent cooldown';
    return { name: T.name, jp: card.kind === 'new' ? `${T.jp} · new talent` : `${T.jp} · upgrade`, sub, icon: `talent_${card.talent}` };
  }
  if (ITEM_CARDS[card.type]) { const I = ITEM_CARDS[card.type]; return { name: I.name, jp: `${I.jp} · item`, sub: null, icon: card.type }; }
  if (card.type === 'element') {
    const E = ELEMENTS[card.element];
    const unit = { lightning: 'chained enemies', poison: 'poison damage / second', ice: 'slow', syphon: 'of damage healed', wind: 'faster cooldowns' }[card.element];
    return { name: E.name, jp: `${E.jp} · weapon element`, sub: unit, icon: card.element };
  }
  const u = UPGRADES[card.stat];
  return { name: u.name, jp: u.jp, sub: null, icon: card.stat };
}

// ---------------------------------------------------------------- textures
let paperPattern = null;
function getPaper(ctx) {
  if (paperPattern) return paperPattern;
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#efe5cf'; g.fillRect(0, 0, 160, 160);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '120,95,60' : '255,255,245'},${Math.random() * 0.08})`; g.fillRect(Math.random() * 160, Math.random() * 160, 1.5, 1.5); }
  g.lineWidth = 0.6;
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(140,110,70,${Math.random() * 0.18})`;
    const x = Math.random() * 160, y = Math.random() * 160, a = Math.random() * TAU, l = 6 + Math.random() * 18;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  paperPattern = ctx.createPattern(c, 'repeat');
  return paperPattern;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ---------------------------------------------------------------- icons
// Stat glyphs live in staticons.js (shared with the HUD); elements and talents are drawn here.
export function drawIcon(ctx, stat, s, color, t) {
  if (isStat(stat)) { drawStatGlyph(ctx, stat, s, color); return; }
  ctx.save(); ctx.scale(s, s);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (stat) {
    case 'talent_arrowRain': {
      ctx.lineWidth = 3;
      for (let i = -2; i <= 2; i++) { const x = i * 11, y = -20 + Math.abs(i) * 5 + ((t * 30 + i * 9) % 14); ctx.beginPath(); ctx.moveTo(x - 3, y - 14); ctx.lineTo(x, y + 8); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 3, y + 4); ctx.lineTo(x, y + 12); ctx.lineTo(x + 3, y + 4); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(0, 24, 24, 5, 0, 0, TAU); ctx.stroke();
      break;
    }
    case 'talent_meteor': {
      ctx.beginPath(); ctx.arc(8, 8, 13, 0, TAU); ctx.fill();
      ctx.globalAlpha *= 0.6; ctx.beginPath(); ctx.moveTo(-1, -1); ctx.lineTo(-28, -26); ctx.lineTo(-20, -30); ctx.lineTo(4, -6); ctx.closePath(); ctx.fill();
      break;
    }
    case 'talent_meditate': { // seated figure with halo
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -10, 16, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -12, 6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-20, 22); ctx.quadraticCurveTo(0, -4, 20, 22); ctx.closePath(); ctx.fill();
      break;
    }
    case 'energy': ctx.restore(); drawStatGlyph(ctx, 'energyRegen', s, color); return;
    case 'rush': ctx.restore(); drawStatGlyph(ctx, 'baseDamage', s, color); return;
    case 'wind': { // three swirling gusts
      ctx.lineWidth = 5;
      for (const [y, l] of [[-14, 40], [0, 50], [14, 34]]) { ctx.beginPath(); ctx.moveTo(-26, y); ctx.lineTo(-26 + l - 10, y); ctx.arc(-26 + l - 10, y - 7, 7, Math.PI / 2, -Math.PI * 0.9, true); ctx.stroke(); }
      break;
    }
    case 'heal':
    case 'talent_vitalize': { // heart with a cross
      ctx.beginPath(); ctx.moveTo(0, 24); ctx.bezierCurveTo(-34, 0, -18, -26, 0, -10); ctx.bezierCurveTo(18, -26, 34, 0, 0, 24); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(-3, -8, 6, 20); ctx.fillRect(-10, -1, 20, 6);
      break;
    }
    case 'talent_shadows': { // three hooded silhouettes
      const a0 = ctx.globalAlpha;
      for (const [x, s2, a] of [[-16, 0.8, 0.5], [16, 0.8, 0.5], [0, 1, 1]]) {
        ctx.globalAlpha = a0 * a; ctx.beginPath(); ctx.arc(x, -12 * s2, 8 * s2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 11 * s2, 22); ctx.quadraticCurveTo(x, -6 * s2, x + 11 * s2, 22); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'talent_rage': { // flame
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.bezierCurveTo(18, -10, 22, 6, 12, 20); ctx.quadraticCurveTo(0, 28, -12, 20); ctx.bezierCurveTo(-22, 6, -12, -6, -6, -12); ctx.quadraticCurveTo(-2, -2, 0, -30); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(8, 10, 0, 20); ctx.quadraticCurveTo(-8, 10, 0, 0); ctx.fill();
      break;
    }
    case 'lightning': {
      ctx.beginPath(); ctx.moveTo(6, -32); ctx.lineTo(-12, 2); ctx.lineTo(0, 2); ctx.lineTo(-8, 32); ctx.lineTo(16, -6); ctx.lineTo(3, -6); ctx.lineTo(14, -32); ctx.closePath(); ctx.fill();
      break;
    }
    case 'poison': { // droplet with skull mark
      ctx.beginPath(); ctx.moveTo(0, -32); ctx.bezierCurveTo(18, -6, 24, 8, 0, 28); ctx.bezierCurveTo(-24, 8, -18, -6, 0, -32); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(-6, 6, 4, 0, TAU); ctx.arc(6, 6, 4, 0, TAU); ctx.fill();
      ctx.fillRect(-1.5, 12, 3, 6);
      break;
    }
    case 'syphon': { // blood drop drawn into a spiral
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.bezierCurveTo(16, -8, 20, 6, 0, 24); ctx.bezierCurveTo(-20, 6, -16, -8, 0, -30); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 3;
      ctx.beginPath(); for (let i = 0; i <= 24; i++) { const u = i / 24, a = u * 9 + t * 2, r = 2 + u * 10; i ? ctx.lineTo(Math.cos(a) * r, 2 + Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, 2 + Math.sin(a) * r); } ctx.stroke();
      break;
    }
    case 'ice': { // snowflake
      ctx.lineWidth = 4;
      for (let i = 0; i < 6; i++) {
        ctx.save(); ctx.rotate((i * TAU) / 6);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -30); ctx.moveTo(0, -18); ctx.lineTo(-8, -25); ctx.moveTo(0, -18); ctx.lineTo(8, -25); ctx.stroke();
        ctx.restore();
      }
      break;
    }
  }
  ctx.restore();
}

function drawMon(ctx, r, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = r * 0.08;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  for (let i = 0; i < 3; i++) { // mitsudomoe
    ctx.save(); ctx.rotate((i * TAU) / 3);
    ctx.beginPath(); ctx.arc(0, -r * 0.42, r * 0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.42); ctx.quadraticCurveTo(r * 0.45, r * 0.25, -r * 0.2, r * 0.7); ctx.quadraticCurveTo(r * 0.15, r * 0.1, -r * 0.3, -r * 0.42); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- traditional patterns
const patterns = {};
function pattern(ctx, key, size, draw) {
  if (!patterns[key]) { const c = document.createElement('canvas'); c.width = size[0]; c.height = size[1]; draw(c.getContext('2d'), size[0], size[1]); patterns[key] = ctx.createPattern(c, 'repeat'); }
  return patterns[key];
}
// seigaiha (blue ocean waves) for rare mounts
const seigaiha = (ctx) => pattern(ctx, 'seigaiha', [24, 12], (g, w, h) => {
  g.fillStyle = '#1d3766'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(170,200,240,0.28)'; g.lineWidth = 1;
  for (const [cx, cy] of [[0, h], [w, h], [w / 2, h / 2], [0, 0], [w, 0]]) for (const r of [11, 7.5, 4]) { g.beginPath(); g.arc(cx, cy, r, Math.PI, TAU); g.stroke(); }
});
// asanoha (hemp leaf star) in gold thread on murasaki silk, for epic mounts
const asanoha = (ctx) => pattern(ctx, 'asanoha', [28, 48], (g, w, h) => {
  g.fillStyle = '#3e1650'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(232,190,100,0.32)'; g.lineWidth = 0.8;
  const pts = [[0, 0], [w, 0], [w / 2, h / 2], [0, h], [w, h]];
  for (const [cx, cy] of pts) for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + Math.PI / 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16); g.stroke(); }
});
// kinpaku: hammered gold leaf squares with visible seams
const goldLeaf = (ctx) => pattern(ctx, 'goldleaf', [96, 96], (g, w) => {
  const n = 4, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = Math.random();
    g.fillStyle = `rgb(${Math.round(214 + v * 30)},${Math.round(168 + v * 34)},${Math.round(70 + v * 30)})`;
    g.fillRect(i * s, j * s, s, s);
  }
  for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,245,200' : '150,100,30'},${Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * w, 1.5, 1.5); }
  g.strokeStyle = 'rgba(140,95,30,0.35)'; g.lineWidth = 0.7;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s + 0.5, 0); g.lineTo(i * s + 0.5, w); g.moveTo(0, i * s + 0.5); g.lineTo(w, i * s + 0.5); g.stroke(); }
});
// plain hinoki wood grain for common mounts
const hinoki = (ctx) => pattern(ctx, 'hinoki', [120, 60], (g, w, h) => {
  g.fillStyle = '#a88a60'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '90,62,34' : '210,186,140'},${0.12 + Math.random() * 0.18})`; g.lineWidth = 0.6 + Math.random();
    const y = Math.random() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + rand(-4, 4), w * 0.7, y + rand(-4, 4), w, y); g.stroke();
  }
});

// suyari-gasumi: the long flat golden clouds of folding-screen paintings
function kasumi(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + h / 2, y); ctx.lineTo(x + w - h / 2, y);
  ctx.arc(x + w - h / 2, y + h / 2, h / 2, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x + h / 2, y + h);
  ctx.arc(x + h / 2, y + h / 2, h / 2, Math.PI / 2, Math.PI * 1.5);
  ctx.fill();
}

// square vermilion hanko seal with a kanji
function hanko(ctx, x, y, s, str, color = '#b52a22', ink = '#fbefe0', rot = -0.06) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color; rrect(ctx, -s / 2, -s / 2, s, s, s * 0.12); ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = s * 0.06; rrect(ctx, -s * 0.38, -s * 0.38, s * 0.76, s * 0.76, s * 0.06); ctx.stroke();
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(s * (str.length > 1 ? 0.34 : 0.5))}px "Shippori Mincho", serif`;
  if (str.length > 1) { ctx.fillText(str[0], 0, -s * 0.15); ctx.fillText(str[1], 0, s * 0.19); } else ctx.fillText(str, 0, s * 0.03);
  ctx.restore();
}

// controller button / key cap
export const TALENT_BUTTONS = { pad: ['X', 'Y', 'B'], kbm: ['1', '2', '3'] };
const PAD_COL = { X: '#2f6fd8', Y: '#d8a620', B: '#c83434' };
function keyCap(ctx, x, y, r, label, pad) {
  ctx.save();
  if (pad) {
    ctx.fillStyle = PAD_COL[label] || '#444'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#fff';
  } else {
    const w = Math.max(r * 2, label.length * r * 0.9 + r);
    ctx.fillStyle = '#efe3c6'; rrect(ctx, x - w / 2, y - r, w, r * 2, r * 0.35); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = INK;
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(r * (label.length > 2 ? 0.8 : 1.15))}px "Zen Kaku Gothic New", sans-serif`;
  ctx.fillText(label, x, y + 0.5);
  ctx.restore();
  return pad ? r * 2 : Math.max(r * 2, label.length * r * 0.9 + r);
}

// a weapon drawn large, as the art of an element card
const WART = {
  katanas: [['katana', -0.75, -14], ['katana', -2.39, -14]],
  heavy: [['nodachi', -0.7, -16]],
  crossbow: [['crossbow', -0.5, -8]],
  knives: [['kunai', -1.0, 0], ['kunai', -0.55, 0], ['kunai', -1.45, 0]],
  staff: [['staff', -0.75, -9]],
  bo: [['bo', -0.6, -5]],
};
const WSCALE = { katanas: 2.0, heavy: 1.7, crossbow: 2.1, knives: 3.6, staff: 1.8, bo: 1.55 };
function drawWeaponArt(ctx, key, size, glow) {
  const pal = { metal: '#e6edf5', wood: '#7a4a2a', accent: '#c0392b' };
  ctx.save(); ctx.scale(size * WSCALE[key], size * WSCALE[key]);
  for (const [k, a, off] of WART[key] || []) {
    ctx.save(); ctx.rotate(a);
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 16; }
    drawWeapon(ctx, k, off, 0, 0, pal, k === 'crossbow' ? 0.8 : 0);
    ctx.restore();
  }
  ctx.restore();
}

// centred text, shrunk until it fits maxW
function fitText(ctx, str, x, y, maxW, size, weight, family) {
  let fs = size; ctx.font = `${weight} ${fs}px ${family}`;
  while (ctx.measureText(str).width > maxW && fs > 7) { fs -= 0.5; ctx.font = `${weight} ${fs}px ${family}`; }
  ctx.textAlign = 'center'; ctx.fillText(str, x, y);
}

// ---------------------------------------------------------------- card drawing
// local coords: origin at card center, size w x h
// Cards are laid out at a base size of 230 px wide and scaled as a whole, so text and spacing
// stay in proportion at any resolution (including 4K).
const BASE_W = 230;
export function drawCard(ctx, card, w, h, t, st, player) {
  const S = w / BASE_W;
  ctx.save(); ctx.scale(S, S);
  if (card.type === 'sacrifice') drawSacrificeCard(ctx, card, BASE_W, h / S, t, st);
  else drawCardBase(ctx, card, BASE_W, h / S, t, st, player);
  ctx.restore();
}

// per rarity: mount (frame), accent ink, readout colour, seal
const STYLE = [
  { fw: 8, mount: hinoki, trim: INK, accent: '#5a4a38', bonus: '#3a3028', seal: '#8a3a2a' },
  { fw: 9, mount: seigaiha, trim: '#c8d4e4', accent: '#1f4f9a', bonus: '#1d5ec0', seal: '#b52a22' },
  { fw: 10, mount: asanoha, trim: '#e0b860', accent: '#6a2a98', bonus: '#7a2ab8', seal: '#b52a22' },
  { fw: 12, mount: goldLeaf, trim: '#5a3a0a', accent: '#8a5a08', bonus: '#a8620a', seal: '#b52a22' },
];

// plain-language effect line and a one-line description for every card type
const STAT_LABEL = { baseDamage: 'Damage', critChance: 'Crit Chance', critDamage: 'Crit Damage', moveSpeed: 'Move Speed', energyRegen: 'Ki Regen', healthRegen: 'Health Regen', dashCooldown: 'Dash Cooldown' };
const STAT_DESC = { baseDamage: 'All your hits deal more damage', critChance: 'More hits become critical hits', critDamage: 'Critical hits deal more damage', moveSpeed: 'Run faster', energyRegen: 'Ki refills faster', healthRegen: 'Health refills over time', dashCooldown: 'Dash again sooner' };
const ELEM_DESC = { lightning: 'Hits jump to nearby enemies', poison: 'Hits poison enemies for 3 s', ice: 'Hits slow enemies for 2 s', syphon: 'Heal from the damage you deal', wind: 'Attacks of this weapon recover faster' };
export function cardEffect(player, card) {
  if (card.type === 'heal') return { text: `+${card.value} Health now`, desc: 'Heals you right away' };
  if (card.type === 'energy') return { text: `+${card.value} Ki now`, desc: 'Refills your energy right away' };
  if (card.type === 'rush') return { text: `+${Math.round(card.value * 100)}% Damage`, desc: `For the first ${ITEM_CARDS.rush.dur} s of the next level` };
  if (card.type === 'talent') {
    const T = TALENTS[card.talent];
    const text = card.kind === 'new' ? 'New active skill' : card.kind === 'power' ? `+${Math.round(card.value * 100)}% skill power` : `−${Math.round(card.value * 100)}% cooldown`;
    return { text, desc: T.desc };
  }
  if (card.type === 'element') {
    const [cur, next] = nextValue(player, card), d = next - cur;
    const text = { wind: `−${Math.round(d * 100)}% cooldowns`, lightning: `+${d} chain jump${d === 1 ? '' : 's'}`, poison: `+${d} poison dmg / s`, ice: `+${Math.round(d * 100)}% slow`, syphon: `+${(d * 100).toFixed(1).replace(/\.0$/, '')}% lifesteal` }[card.element];
    return { text, desc: ELEM_DESC[card.element] };
  }
  return { text: `${fmtValue(UPGRADES[card.stat].fmt, card.value, true)} ${STAT_LABEL[card.stat]}`, desc: STAT_DESC[card.stat] };
}
// small round icon (stat / element / talent / heal) in the card's colours
function effectIcon(ctx, card, x, y, size, t) {
  if (card.type === 'stat') { drawStatIcon(ctx, card.stat, x, y, size); return; }
  const col = card.type === 'element' ? ELEMENTS[card.element].color : ITEM_CARDS[card.type] ? ITEM_CARDS[card.type].color : '#ffd56a';
  const icon = card.type === 'element' ? card.element : ITEM_CARDS[card.type] ? card.type : `talent_${card.talent}`;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(16,12,20,0.92)'; ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, size * 0.08); ctx.beginPath(); ctx.arc(0, 0, size / 2 - ctx.lineWidth / 2, 0, TAU); ctx.stroke();
  drawIcon(ctx, icon, (size * 0.31) / 30, col, t);
  ctx.restore();
}
// top-right chip: what kind of card this is
const CATEGORY = { stat: ['STAT', '#3a3028'], element: ['ELEMENT', '#24365a'], talent: ['TALENT', '#5a3a10'], heal: ['ITEM', '#6a1a2a'], energy: ['ITEM', '#1a4a5a'], rush: ['ITEM', '#6a3410'] };
function categoryChip(ctx, card, right, y, t) {
  const [label, bg] = CATEGORY[card.type] || CATEGORY.stat;
  ctx.save();
  ctx.font = '800 9px "Zen Kaku Gothic New", sans-serif';
  const w = ctx.measureText(label).width + 26, h = 16, x = right - w;
  ctx.fillStyle = bg; rrect(ctx, x, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,210,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  effectIcon(ctx, card, x + 8.5, y, 13, t);
  ctx.fillStyle = '#f8ecd4'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 17, y + 0.5);
  ctx.restore();
  return x;
}

function drawCardBase(ctx, card, w, h, t, st, player) {
  const R = RARITIES[card.rarity], ri = card.rarity, u = cardInfo(player, card), ST = STYLE[ri];
  const x0 = -w / 2, y0 = -h / 2;
  const sel = st.hover;
  const pad = player.ctl && player.ctl.mode === 'pad';

  // ---- behind the card: a quiet shadow for common, a soft halo for the rest; legendary breathes warm light
  if (ri === 3) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const br = 0.75 + 0.25 * Math.sin(t * 1.6);
    const rg = ctx.createRadialGradient(0, 0, h * 0.2, 0, 0, h * 0.85);
    rg.addColorStop(0, `rgba(255,200,110,${0.32 * br})`); rg.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = rg; ctx.fillRect(-h, -h, h * 2, h * 2);
    ctx.restore();
  }
  ctx.save();
  if (ri === 0) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 6; }
  else { ctx.shadowColor = R.glow; ctx.shadowBlur = [0, 14, 22, 34][ri] * (sel ? 1.3 : 1) * (ri === 2 ? 0.85 + 0.15 * Math.sin(t * 2) : 1); }
  rrect(ctx, x0, y0, w, h, 4); ctx.fillStyle = '#111'; ctx.fill();
  ctx.restore();

  // ---- mount (outer frame)
  rrect(ctx, x0, y0, w, h, 4);
  ctx.fillStyle = ST.mount(ctx); ctx.fill();
  if (ri === 3) { // slow sheen travelling across the gold leaf
    ctx.save(); rrect(ctx, x0, y0, w, h, 4); ctx.clip();
    const k = ((t * 0.22) % 1.6) - 0.3;
    const sg = ctx.createLinearGradient(x0 + k * w * 1.6 - 60, y0, x0 + k * w * 1.6 + 60, y0 + h);
    sg.addColorStop(0, 'rgba(255,250,220,0)'); sg.addColorStop(0.5, 'rgba(255,250,220,0.45)'); sg.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = sg; ctx.fillRect(x0, y0, w, h);
    ctx.restore();
  }
  ctx.strokeStyle = INK; ctx.lineWidth = 2; rrect(ctx, x0, y0, w, h, 4); ctx.stroke();
  const fw = ST.fw;
  const ix = x0 + fw, iy = y0 + fw, iw = w - fw * 2, ih = h - fw * 2;
  // thin metal / thread line just inside the mount
  if (ri >= 1) { ctx.strokeStyle = ri === 1 ? 'rgba(220,230,245,0.8)' : ri === 2 ? '#d8b060' : '#fff2c0'; ctx.lineWidth = 1; rrect(ctx, x0 + 3.5, y0 + 3.5, w - 7, h - 7, 3); ctx.stroke(); }

  // ---- washi body
  rrect(ctx, ix, iy, iw, ih, 2);
  ctx.fillStyle = getPaper(ctx); ctx.fill();
  if (ri === 3) { // scattered gold flakes (kirigane) in the paper
    ctx.save(); ctx.clip();
    for (let i = 0; i < 40; i++) {
      const px = ix + ((i * 61.7) % iw), py = iy + ((i * 37.3 + i * i * 3.1) % ih);
      ctx.fillStyle = `rgba(212,160,50,${0.35 + 0.3 * ((i * 7) % 5) / 5})`;
      ctx.save(); ctx.translate(px, py); ctx.rotate(i); ctx.fillRect(-1.6, -1.6, 3.2, 3.2); ctx.restore();
    }
    ctx.restore();
  }
  ctx.strokeStyle = ST.trim; ctx.lineWidth = ri === 0 ? 1.6 : 1.4; rrect(ctx, ix, iy, iw, ih, 2); ctx.stroke();

  // ---- header: rarity gems + name on the left, a category chip (icon + word) on the right
  const talent = card.type === 'talent';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= ri; i++) { // one gem per rarity step
    const gx = ix + 13 + i * 11, gy = iy + 14;
    ctx.fillStyle = ri === 0 ? '#9a8c78' : ri === 3 ? '#e8a020' : R.color; ctx.strokeStyle = INK; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(gx, gy - 5.5); ctx.lineTo(gx + 4.5, gy); ctx.lineTo(gx, gy + 5.5); ctx.lineTo(gx - 4.5, gy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx + 2, gy - 1); ctx.lineTo(gx, gy); ctx.closePath(); ctx.fill();
  }
  const chipL = categoryChip(ctx, card, ix + iw - 7, iy + 14, t);
  const rx = ix + 13 + (ri + 1) * 11 - 2, rname = R.name.toUpperCase();
  let rfs = 11; ctx.font = `800 ${rfs}px "Shippori Mincho", serif`;
  while (rx + ctx.measureText(rname).width > chipL - 5 && rfs > 7) { rfs -= 0.5; ctx.font = `800 ${rfs}px "Shippori Mincho", serif`; }
  ctx.textAlign = 'left'; ctx.fillStyle = ST.accent;
  ctx.fillText(rname, rx, iy + 14.5);

  // ---- art panel
  const ax = ix + 9, ay = iy + 30, aw = iw - 18, ah = ih * 0.42;
  const acx = ax + aw / 2, acy = ay + ah / 2;
  ctx.save();
  rrect(ctx, ax, ay, aw, ah, 2); ctx.clip();
  if (ri === 3) {
    ctx.fillStyle = goldLeaf(ctx); ctx.fillRect(ax, ay, aw, ah);
    ctx.fillStyle = 'rgba(176,40,26,0.9)'; ctx.beginPath(); ctx.arc(ax + aw - 30, ay + 28, ah * 0.13, 0, TAU); ctx.fill(); // red sun
    const drift = Math.sin(t * 0.4) * 8;
    kasumi(ctx, ax - 20 + drift, ay + ah * 0.62, aw * 0.75, 14, 'rgba(255,240,190,0.75)');
    kasumi(ctx, ax + aw * 0.4 - drift, ay + ah * 0.78, aw * 0.8, 12, 'rgba(255,240,190,0.6)');
    kasumi(ctx, ax + aw * 0.1 - drift * 0.5, ay + ah * 0.12, aw * 0.5, 9, 'rgba(255,240,190,0.55)');
  } else {
    const ag = ctx.createLinearGradient(0, ay, 0, ay + ah);
    if (ri === 0) { ag.addColorStop(0, '#ece4d2'); ag.addColorStop(1, '#d4c8b0'); }
    else if (ri === 1) { ag.addColorStop(0, '#e2ebf4'); ag.addColorStop(1, '#9ab4d4'); }
    else { ag.addColorStop(0, '#ead8f0'); ag.addColorStop(0.6, '#b48ac8'); ag.addColorStop(1, '#6a3a88'); }
    ctx.fillStyle = ag; ctx.fillRect(ax, ay, aw, ah);
    // sumi-e mountains
    ctx.fillStyle = ri === 0 ? 'rgba(50,42,34,0.18)' : ri === 1 ? 'rgba(20,40,80,0.2)' : 'rgba(40,10,60,0.25)';
    ctx.beginPath(); ctx.moveTo(ax, ay + ah);
    for (let i = 0; i <= 12; i++) { const px = ax + (aw * i) / 12; ctx.lineTo(px, ay + ah * (0.66 + Math.sin(i * 1.7 + card.key.length) * 0.1 - (i === 4 ? 0.16 : 0))); }
    ctx.lineTo(ax + aw, ay + ah); ctx.closePath(); ctx.fill();
    if (ri === 0) { ctx.fillStyle = 'rgba(176,48,36,0.55)'; ctx.beginPath(); ctx.arc(acx + aw * 0.25, ay + ah * 0.28, ah * 0.13, 0, TAU); ctx.fill(); }
    if (ri === 1) { // waves along the bottom
      ctx.strokeStyle = 'rgba(30,70,140,0.35)'; ctx.lineWidth = 1.2;
      for (let x = ax - 10; x < ax + aw + 10; x += 16) for (const r of [8, 5]) { ctx.beginPath(); ctx.arc(x + ((t * 4) % 16), ay + ah + 2, r, Math.PI, TAU); ctx.stroke(); }
    }
    if (ri === 2) { // gold mist bands and a few drifting motes
      kasumi(ctx, ax - 10 + Math.sin(t * 0.5) * 6, ay + ah * 0.18, aw * 0.6, 9, 'rgba(240,200,110,0.55)');
      kasumi(ctx, ax + aw * 0.45 - Math.sin(t * 0.5) * 6, ay + ah * 0.72, aw * 0.7, 10, 'rgba(240,200,110,0.5)');
      for (let i = 0; i < 8; i++) {
        const life = (t * 0.18 + i / 8) % 1;
        ctx.fillStyle = `rgba(255,230,150,${Math.sin(life * Math.PI) * 0.8})`;
        ctx.beginPath(); ctx.arc(ax + ((i * 47.3) % aw), ay + ah - life * ah, 1.4, 0, TAU); ctx.fill();
      }
    }
  }
  // the subject
  const badgeR = ah * 0.3;
  if (card.type === 'element') {
    const E = ELEMENTS[card.element], w0 = player.weapons[card.slot];
    ctx.save(); ctx.translate(acx - 8, acy + (w0.key === 'knives' ? 14 : 0)); drawWeaponArt(ctx, w0.key, ah / 110, E.color); ctx.restore();
    // element seal in the lower-right corner of the art
    const bx = ax + aw - 26, by = ay + ah - 26;
    ctx.fillStyle = 'rgba(16,12,20,0.92)'; ctx.beginPath(); ctx.arc(bx, by, 20, 0, TAU); ctx.fill();
    ctx.strokeStyle = E.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, 19, 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(bx, by); drawIcon(ctx, card.element, 0.42, E.color, t); ctx.restore();
  } else {
    const col = talent ? '#ffd56a' : ITEM_CARDS[card.type] ? ITEM_CARDS[card.type].color : STAT_STYLE[card.stat].color;
    if (ri === 3) { ctx.strokeStyle = '#7a4a0a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(acx, acy, badgeR + 6, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = 'rgba(16,12,20,0.94)'; ctx.beginPath(); ctx.arc(acx, acy, badgeR, 0, TAU); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(acx, acy, badgeR - 1.5, 0, TAU); ctx.stroke();
    ctx.save(); ctx.translate(acx, acy); drawIcon(ctx, u.icon, (badgeR * 0.62) / 30, col, t); ctx.restore();
  }
  // talent: which button it will live on
  if (talent) {
    const slot = card.kind === 'new' ? player.talents.length : player.talents.findIndex((x) => x.key === card.talent);
    const lab = TALENT_BUTTONS[pad ? 'pad' : 'kbm'][clamp(slot, 0, 2)];
    keyCap(ctx, ax + 20, ay + 20, 13, lab, pad);
  }
  ctx.restore();
  ctx.strokeStyle = ri === 3 ? '#6a4208' : INK; ctx.lineWidth = 1.6; rrect(ctx, ax, ay, aw, ah, 2); ctx.stroke();

  // ---- name, brushed in ink with a vermilion stroke under it
  const ny = ay + ah + 21;
  ctx.textAlign = 'center';
  let fs = 21; ctx.font = `800 ${fs}px "Shippori Mincho", serif`;
  while (ctx.measureText(u.name).width > iw - 20 && fs > 13) { fs--; ctx.font = `800 ${fs}px "Shippori Mincho", serif`; }
  if (ri === 3) { ctx.lineWidth = 3; ctx.strokeStyle = '#5a3a0a'; ctx.strokeText(u.name, 0, ny); ctx.fillStyle = '#ffd86a'; }
  else ctx.fillStyle = INK;
  ctx.fillText(u.name, 0, ny);
  const nw = Math.min(iw - 30, ctx.measureText(u.name).width + 20);
  ctx.fillStyle = ri === 3 ? 'rgba(200,130,20,0.8)' : 'rgba(180,42,34,0.75)';
  ctx.beginPath(); ctx.moveTo(-nw / 2, ny + 13); ctx.quadraticCurveTo(0, ny + 10, nw / 2, ny + 12); ctx.lineTo(nw / 2 - 6, ny + 15); ctx.quadraticCurveTo(0, ny + 14.5, -nw / 2 + 4, ny + 15.5); ctx.closePath(); ctx.fill();

  // ---- the effect, in plain words and big: "+5% Damage"
  const fx = cardEffect(player, card);
  const ey = ny + 36;
  let efs = 17; ctx.font = `800 ${efs}px "Zen Kaku Gothic New", sans-serif`;
  while (ctx.measureText(fx.text).width > iw - 44 && efs > 11) { efs -= 0.5; ctx.font = `800 ${efs}px "Zen Kaku Gothic New", sans-serif`; }
  const etw = ctx.measureText(fx.text).width, eix = -etw / 2 - 11;
  effectIcon(ctx, card, eix, ey, 18, t);
  ctx.textAlign = 'left'; ctx.fillStyle = ST.bonus; ctx.fillText(fx.text, eix + 13, ey + 0.5); ctx.textAlign = 'center';
  // one short line on what it does
  ctx.fillStyle = 'rgba(40,30,25,0.68)';
  fitText(ctx, fx.desc, 0, ey + 20, iw - 18, 11, '700', '"Zen Kaku Gothic New", sans-serif');

  // ---- plaque: which button (talent) or which weapon (element) it goes on
  const py = ey + 43, ph = 22;
  if (talent || card.type === 'element') {
    ctx.fillStyle = 'rgba(26,23,32,0.92)'; rrect(ctx, ix + 8, py - ph / 2, iw - 16, ph, 4); ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '800 11px "Zen Kaku Gothic New", sans-serif';
    if (talent) {
      const slot = card.kind === 'new' ? player.talents.length : player.talents.findIndex((x) => x.key === card.talent);
      const lab = TALENT_BUTTONS[pad ? 'pad' : 'kbm'][clamp(slot, 0, 2)];
      const txt = card.kind === 'new' ? 'ACTIVE SKILL on' : 'UPGRADES SKILL on';
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = '#ffd56a'; ctx.fillText(txt, -tw / 2 - 12, py + 0.5);
      keyCap(ctx, tw / 2 + 2, py, 8.5, lab, pad);
    } else {
      const w0 = player.weapons[card.slot];
      const keys = card.slot === 0 ? (pad ? 'LB/LT' : 'Q/E') : (pad ? 'RB/RT' : 'LMB/RMB');
      const name = w0.def.name;
      const nmw = ctx.measureText(name).width;
      ctx.font = '800 9px "Zen Kaku Gothic New", sans-serif';
      ctx.font = '800 11px "Zen Kaku Gothic New", sans-serif';
      const pre = 'ON ', pw = ctx.measureText(pre).width;
      ctx.font = '800 9px "Zen Kaku Gothic New", sans-serif';
      const kw = ctx.measureText(keys).width + 10;
      let x = -(pw + nmw + 8 + kw) / 2;
      ctx.font = '800 11px "Zen Kaku Gothic New", sans-serif';
      ctx.fillStyle = ELEMENTS[card.element].color; ctx.fillText(pre, x, py + 0.5); x += pw;
      ctx.fillStyle = '#f4ead6'; ctx.fillText(name, x, py + 0.5); x += nmw + 8;
      ctx.fillStyle = ELEMENTS[card.element].color; rrect(ctx, x, py - 7, kw, 14, 3); ctx.fill();
      ctx.font = '800 9px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText(keys, x + kw / 2, py + 0.5);
    }
    ctx.textAlign = 'center';
  }

  // ---- readout pill: now ➜ after
  const ro = cardReadout(player, card);
  const ry = iy + ih - 20, rw = iw - 26, rh = 24;
  ctx.fillStyle = 'rgba(60,44,30,0.1)'; rrect(ctx, -rw / 2, ry - rh / 2, rw, rh, rh / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(60,44,30,0.28)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  if ((talent && card.kind === 'new') || card.type === 'rush') { // nothing to compare: show its cooldown / when it works
    ctx.font = '800 13px "Zen Kaku Gothic New", sans-serif';
    const str = card.type === 'rush' ? `⏱  next level, ${ITEM_CARDS.rush.dur} s` : `⟳  ${TALENTS[card.talent].cd}s cooldown`, sw = ctx.measureText(str).width;
    ctx.fillStyle = '#4a3c30'; ctx.fillText(str, -sw / 2, ry + 0.5);
  } else {
    // [now]  ➜  [after]: the old value muted, the new one bold in the rarity colour
    ctx.font = '700 12px "Zen Kaku Gothic New", sans-serif'; const cw = ctx.measureText(ro.cur).width;
    ctx.font = '800 15px "Zen Kaku Gothic New", sans-serif'; const nw2 = ctx.measureText(ro.next).width;
    const arrow = 22, tot = cw + arrow + nw2;
    let x = -tot / 2;
    ctx.font = '700 12px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = 'rgba(60,46,36,0.75)'; ctx.fillText(ro.cur, x, ry + 0.5); x += cw;
    ctx.fillStyle = ST.bonus; ctx.beginPath(); ctx.moveTo(x + 6, ry - 3.5); ctx.lineTo(x + 13, ry - 3.5); ctx.lineTo(x + 13, ry - 6.5); ctx.lineTo(x + 18, ry); ctx.lineTo(x + 13, ry + 6.5); ctx.lineTo(x + 13, ry + 3.5); ctx.lineTo(x + 6, ry + 3.5); ctx.closePath(); ctx.fill();
    x += arrow;
    ctx.font = '800 15px "Zen Kaku Gothic New", sans-serif'; ctx.fillText(ro.next, x, ry + 0.5);
  }
  ctx.textAlign = 'center';
  // seal stamped in the corner of the paper
  hanko(ctx, ax + 17, ay + ah - 17, ri === 3 ? 22 : 19, talent ? '才' : card.type === 'element' ? '付' : card.type === 'heal' ? '癒' : card.type === 'energy' ? '気' : card.type === 'rush' ? '勢' : '力', ST.seal, '#fbefe0', 0.12);

  // ---- rarity ornaments
  if (ri >= 1) { // metal corner fittings (silver / gold / heavy gold)
    ctx.fillStyle = ri === 1 ? '#dfe6ee' : ri === 2 ? '#e8c060' : '#fff0b8'; ctx.strokeStyle = INK; ctx.lineWidth = 1;
    const L = ri === 3 ? 26 : 18;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.save(); ctx.translate(sx * (w / 2), sy * (h / 2)); ctx.scale(-sx, -sy);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.lineTo(L - 4, 5); ctx.lineTo(5, 5); ctx.lineTo(5, L - 4); ctx.lineTo(0, L); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (ri === 3) { ctx.fillStyle = '#b52a22'; ctx.beginPath(); ctx.arc(9, 9, 2.2, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff0b8'; }
      ctx.restore();
    }
  }
  if (ri === 3) { // crest at the top of the mount, and gold leaf drifting down around the card
    ctx.save(); ctx.translate(0, y0 + fw / 2);
    ctx.fillStyle = '#16110c'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
    drawMon(ctx, 8.5, '#ffd86a');
    ctx.restore();
    for (let i = 0; i < 10; i++) {
      const life = (t * 0.12 + i / 10) % 1;
      const px = Math.sin(i * 12.9898) * w * 0.62 + Math.sin(t * 1.3 + i) * 8, py = -h * 0.6 + life * h * 1.2;
      ctx.save(); ctx.translate(px, py); ctx.rotate(t * (1 + (i % 3)) + i); ctx.scale(1, Math.cos(t * 2 + i));
      ctx.fillStyle = `rgba(255,214,110,${Math.sin(life * Math.PI) * 0.85})`; ctx.fillRect(-2.5, -2.5, 5, 5);
      ctx.restore();
    }
  }
  // selection outline
  if (sel) {
    ctx.save(); ctx.lineWidth = 2.5; ctx.strokeStyle = ri === 0 ? '#f4ead6' : R.color;
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 4);
    rrect(ctx, x0 - 6, y0 - 6, w + 12, h + 12, 6); ctx.stroke(); ctx.restore();
  }
}

function drawCardBack(ctx, w, h) {
  rrect(ctx, -w / 2, -h / 2, w, h, 4);
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, '#7a1a16'); g.addColorStop(1, '#3a0a0c');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#d8b050'; ctx.lineWidth = 1.5; rrect(ctx, -w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 3); ctx.stroke();
  rrect(ctx, -w / 2 + 12, -h / 2 + 12, w - 24, h - 24, 2); ctx.stroke();
  drawMon(ctx, w * 0.24, '#d8b050');
}

// ---------------------------------------------------------------- screen
const SAC_T0 = 0.9, SAC_STEP = 0.6; // sacrifice cards: first one burns in after the heartbeat, then one by one
// the jagged, flickering hole a sacrifice card burns in through (radius Rm)
function ctxPathCopy(ctx, Rm, seed, t) {
  const p = new Path2D();
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * TAU, r = Rm * (1 + 0.13 * Math.sin(a * 7 + seed) + 0.07 * Math.sin(a * 13 + t * 4 + seed));
    k ? p.lineTo(Math.cos(a) * r, Math.sin(a) * r) : p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  p.closePath();
  return p;
}

export class CardScreen {
  constructor(game) { this.g = game; this.active = false; }

  // player: who is choosing (their controls and stats are used)
  // opts.mode: 'blessing' (upgrades) or 'sacrifice' (the monk's offer)
  open(cards, onPick, player, opts = {}) {
    this.mode = opts.mode || 'blessing';
    this.cards = cards.map((c, i) => ({ ...c, seed: rand(0, 5), i }));
    this.n = this.cards.length;
    this.onPick = onPick;
    this.player = player;
    this.ctl = player.ctl;
    this.mouseOK = player.ctl === input.players[0];
    this.active = true; this.t = 0; this.sel = Math.floor((this.n - 1) / 2); this.picked = -1; this.pickT = 0;
    this.revealed = this.cards.map(() => false);
    this.tilt = this.cards.map(() => ({ x: 0, y: 0 }));
    this.lift = this.cards.map(() => 0);
    this.flashA = 0; this.redA = 0;
    this.lastMouse = input.mouse.lastMove;
    this.embers = []; this.beatT = 0.15;
    this.layout();
  }

  // sacrifice screen timing: each card burns in from a blot of blood, one after another
  sacStart(i) { return SAC_T0 + i * SAC_STEP; }
  get dealDone() { return this.mode === 'sacrifice' ? this.t > this.sacStart(this.n - 1) + 0.75 : this.t > 1.25; }
  burst(i, n, spread = 1) {
    const [cx, cy] = this.cardPos(i);
    for (let k = 0; k < n; k++) {
      const a = rand(0, TAU), r = rand(0, this.cw * 0.45 * spread);
      this.embers.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 1.4, vx: rand(-40, 40) * this.k, vy: rand(-140, -40) * this.k, life: rand(0.6, 1.4), max: 1.4, s: rand(1.5, 3.5) * this.k });
    }
  }

  layout() {
    const v = this.g.view;
    const k = clamp(Math.min(v.W / 1000, v.H / 700), 0.55, 4.5);
    this.cw = 230 * k; this.ch = 340 * k; this.k = k;
    this.gap = 40 * k;
    this.cy = v.H * 0.49;
  }

  cardPos(i) {
    const v = this.g.view;
    return [v.W / 2 + (i - (this.n - 1) / 2) * (this.cw + this.gap), this.cy];
  }

  update(dt) {
    if (!this.active) return;
    this.layout();
    this.t += dt;
    this.flashA = Math.max(0, this.flashA - dt * 2.5);
    this.redA = Math.max(0, this.redA - dt * 1.8);
    const dealDone = this.dealDone, sac = this.mode === 'sacrifice';
    for (const e of this.embers) { e.life -= dt; e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.98; }
    this.embers = this.embers.filter((e) => e.life > 0);
    if (sac) {
      // a slow heartbeat under the whole choice; each card arrives with a heavy thud
      this.beatT -= dt;
      if (this.beatT <= 0) { this.beatT = 1.25; sfx.heartbeat(); this.beat = 0; }
      this.beat = (this.beat ?? 1) + dt;
      for (let i = 0; i < this.n; i++) {
        if (!this.revealed[i] && this.t >= this.sacStart(i)) { this.revealed[i] = true; sfx.slam(); this.g.shake(5); this.redA = 0.5; this.burst(i, 30); }
      }
      if (Math.random() < dt * 6 && this.n) { // a few embers rise from below the cards
        const i = Math.floor(Math.random() * this.n);
        if (this.revealed[i]) { const [cx, cy] = this.cardPos(i); this.embers.push({ x: cx + rand(-0.5, 0.5) * this.cw, y: cy + this.ch * 0.52, vx: rand(-15, 15) * this.k, vy: rand(-70, -30) * this.k, life: rand(0.5, 1), max: 1, s: rand(1.2, 2.4) * this.k }); }
      }
    }
    // reveal flip events
    for (let i = 0; i < this.n && !sac; i++) {
      const fk = (this.t - 0.25 - i * 0.18 - 0.35) / 0.3;
      if (fk >= 0.5 && !this.revealed[i]) {
        this.revealed[i] = true; sfx.flip();
        const ri = this.mode === 'sacrifice' ? 0 : this.cards[i].rarity;
        if (ri >= 1) sfx.chime(ri);
        if (ri === 3) { this.flashA = 1; this.g.shake(7); }
      }
    }
    if (this.picked >= 0) {
      this.pickT += dt;
      if (sac && !this.burned) { this.burned = true; for (let i = 0; i < this.n; i++) if (i !== this.picked) this.burst(i, 50); this.redA = 0.8; sfx.bossRoar(); this.g.shake(8); }
      if (this.pickT > (sac ? 1.0 : 0.75)) { this.active = false; this.burned = false; this.onPick(this.cards[this.picked]); }
      return;
    }
    if (!dealDone) return;
    // mouse hover
    const m = input.mouse, c = this.ctl;
    const mx = m.x * this.g.view.dpr, my = m.y * this.g.view.dpr;
    let hover = -1;
    for (let i = 0; i < this.n && this.mouseOK; i++) {
      const [cx, cy] = this.cardPos(i);
      if (Math.abs(mx - cx) < this.cw / 2 && Math.abs(my - cy) < this.ch / 2) {
        hover = i;
        this.tilt[i].x = lerp(this.tilt[i].x, (mx - cx) / (this.cw / 2), 0.2);
        this.tilt[i].y = lerp(this.tilt[i].y, (my - cy) / (this.ch / 2), 0.2);
      }
    }
    if (m.lastMove !== this.lastMouse && hover >= 0 && c.mode === 'kbm') { if (hover !== this.sel) sfx.move(); this.sel = hover; }
    this.lastMouse = m.lastMove;
    if (c.pressed('left')) { this.sel = (this.sel + this.n - 1) % this.n; sfx.move(); }
    if (c.pressed('right')) { this.sel = (this.sel + 1) % this.n; sfx.move(); }
    for (let i = 0; i < this.n; i++) {
      this.lift[i] = lerp(this.lift[i], i === this.sel ? 1 : 0, 1 - Math.exp(-12 * dt));
      if (i !== hover || c.mode === 'pad') {
        const tx = i === this.sel ? Math.sin(this.t * 1.4) * 0.5 : 0, ty = i === this.sel ? Math.cos(this.t * 1.1) * 0.3 : 0;
        this.tilt[i].x = lerp(this.tilt[i].x, tx, 0.08); this.tilt[i].y = lerp(this.tilt[i].y, ty, 0.08);
      }
    }
    const clicked = this.mouseOK && input.mouse.clicked && hover >= 0;
    if (clicked) this.sel = hover;
    if (c.pressed('confirm') || clicked) {
      this.picked = this.sel; this.pickT = 0;
      if (this.mode === 'sacrifice') sfx.gong(); else { sfx.select(); if (this.cards[this.sel].rarity >= 2) sfx.chime(this.cards[this.sel].rarity); }
      input.eat('confirm'); input.eat('dash');
    }
  }

  draw(ctx) {
    if (!this.active) return;
    const player = this.player, coop = this.g.players.length > 1;
    const v = this.g.view, t = this.t;
    const sac = this.mode === 'sacrifice';
    const outT = sac ? 0.7 : 0.45;
    const fadeIn = clamp(t / (sac ? 0.6 : 0.3), 0, 1) * (this.picked >= 0 ? clamp(1 - (this.pickT - outT) / 0.3, 0, 1) : 1);
    if (sac) this.drawSacBackdrop(ctx, v, t, fadeIn);
    else { ctx.fillStyle = `rgba(8,6,14,${0.72 * fadeIn})`; ctx.fillRect(0, 0, v.W, v.H); }
    // title
    ctx.globalAlpha = fadeIn;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(40 * this.k)}px "Shippori Mincho", serif`;
    ctx.fillStyle = coop ? PLAYER_COLORS[player.index] : '#f4ead6';
    const what = sac ? 'Choose a Sacrifice' : 'Choose a Blessing';
    if (sac) ctx.fillStyle = coop ? PLAYER_COLORS[player.index] : '#ff6a5a';
    { // the sacrifice title trembles slightly
      const jx = sac ? Math.sin(t * 37) * 1.2 * this.k * (this.beat < 0.25 ? 2 : 0.5) : 0;
      ctx.fillText(coop ? `Player ${player.index + 1} — ${what}` : what, v.W / 2 + jx, this.cy - this.ch / 2 - 92 * this.k);
    }
    ctx.font = `700 ${Math.round(17 * this.k)}px "Zen Kaku Gothic New", sans-serif`;
    ctx.fillStyle = 'rgba(244,234,214,0.7)';
    const how = this.ctl.mode === 'pad' ? '◀ ▶ to browse, Ⓐ to choose' : 'click a card, or ← → and Enter';
    ctx.fillText(sac ? `The wandering monk offers a bargain. You must accept one.  ·  ${how}` : `Level ${this.g.level} cleared  ·  ${how}`, v.W / 2, this.cy - this.ch / 2 - 52 * this.k);
    ctx.globalAlpha = 1;

    for (let i = 0; i < this.n && sac; i++) this.drawSacCard(ctx, i, t, player);
    for (let i = 0; i < this.n && !sac; i++) {
      const card = this.cards[i];
      const [cx, cy0] = this.cardPos(i);
      const dk = clamp((t - 0.25 - i * 0.18) / 0.35, 0, 1);
      if (dk <= 0) continue;
      const fk = clamp((t - 0.25 - i * 0.18 - 0.35) / 0.3, 0, 1);
      let cy = lerp(v.H + this.ch, cy0, ease.outBack(dk));
      let sc = 1 + this.lift[i] * 0.06, alpha = 1;
      cy -= this.lift[i] * 18 * this.k;
      if (this.picked >= 0) {
        const pk = clamp(this.pickT / 0.45, 0, 1);
        if (i === this.picked) { sc *= 1 + ease.outCubic(pk) * 0.12; }
        else { alpha = 1 - pk; cy += pk * 60; }
        if (this.pickT > 0.45) alpha *= clamp(1 - (this.pickT - 0.45) / 0.3, 0, 1);
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      const tl = this.tilt[i];
      const flip = Math.cos(fk * Math.PI);
      ctx.transform(1, tl.x * 0.05, -tl.y * 0.04, 1, 0, 0);
      ctx.scale(sc * Math.max(0.02, Math.abs(flip)) * (1 - Math.abs(tl.x) * 0.04), sc);
      if (fk < 0.5) drawCardBack(ctx, this.cw, this.ch);
      else drawCard(ctx, card, this.cw, this.ch, t, { hover: this.picked < 0 && i === this.sel && t > 1.25, tiltX: tl.x, tiltY: tl.y }, player);
      ctx.restore();
    }
    // embers drifting up from the sacrifice cards
    for (const e of this.embers) {
      const a = Math.sin((e.life / e.max) * Math.PI);
      ctx.fillStyle = `rgba(255,${Math.round(110 + 80 * a)},60,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.s, 0, TAU); ctx.fill();
    }
    // bouncing arrow under the selected card
    if (this.picked < 0 && this.dealDone) {
      const [ax, ay0] = this.cardPos(this.sel);
      const ay = ay0 + this.ch / 2 + 22 * this.k + Math.abs(Math.sin(t * 5)) * 10 * this.k;
      const s = 20 * this.k, col = this.g.players.length > 1 ? PLAYER_COLORS[this.player.index] : sac ? '#ff4a4a' : '#ffd45e';
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 18 * this.k;
      ctx.fillStyle = col; ctx.strokeStyle = 'rgba(20,10,10,0.9)'; ctx.lineWidth = 3 * this.k;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - s, ay + s * 1.1); ctx.lineTo(ax - s * 0.38, ay + s * 1.1); ctx.lineTo(ax - s * 0.38, ay + s * 1.9); ctx.lineTo(ax + s * 0.38, ay + s * 1.9); ctx.lineTo(ax + s * 0.38, ay + s * 1.1); ctx.lineTo(ax + s, ay + s * 1.1); ctx.closePath();
      ctx.stroke(); ctx.fill();
      ctx.restore();
    }
    if (this.flashA > 0) { ctx.fillStyle = `rgba(255,240,200,${this.flashA * 0.55})`; ctx.fillRect(0, 0, v.W, v.H); }
    if (this.redA > 0) { ctx.fillStyle = `rgba(160,0,10,${this.redA * 0.35})`; ctx.fillRect(0, 0, v.W, v.H); }
  }

  // blood-dark backdrop: crimson vignette that swells with the heartbeat, and blood running down from the top
  drawSacBackdrop(ctx, v, t, a) {
    const pulse = Math.exp(-(this.beat ?? 1) * 5);
    ctx.fillStyle = `rgba(10,2,4,${0.8 * a})`; ctx.fillRect(0, 0, v.W, v.H);
    const R = Math.hypot(v.W, v.H) / 2;
    const vg = ctx.createRadialGradient(v.W / 2, v.H / 2, R * (0.25 + 0.04 * pulse), v.W / 2, v.H / 2, R);
    vg.addColorStop(0, 'rgba(120,0,10,0)'); vg.addColorStop(1, `rgba(140,0,14,${(0.55 + 0.25 * pulse) * a})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, v.W, v.H);
    ctx.save(); ctx.globalAlpha = a;
    for (let i = 0; i < 22; i++) {
      const x = ((i * 97.13) % 1) * v.W + ((i * 0.618) % 1) * v.W * 0.05, x2 = (x * 7.3) % v.W;
      const len = Math.min(1, Math.max(0, t * 0.5 - ((i * 0.37) % 0.6))) * v.H * (0.06 + ((i * 0.53) % 1) * 0.16);
      const w = (2 + ((i * 1.7) % 4)) * this.k;
      ctx.fillStyle = 'rgba(120,6,16,0.85)'; ctx.fillRect(x2 - w / 2, 0, w, len);
      ctx.beginPath(); ctx.arc(x2, len, w * 0.9, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // a sacrifice card: burns in from a jagged blot, and the unchosen ones burn away again
  drawSacCard(ctx, i, t, player) {
    const card = this.cards[i];
    const [cx, cy0] = this.cardPos(i);
    let rk = clamp((t - this.sacStart(i)) / 0.7, 0, 1);
    if (rk <= 0) return;
    let sc = (0.9 + 0.1 * ease.outCubic(rk)) * (1 + this.lift[i] * 0.06);
    let cy = cy0 - this.lift[i] * 18 * this.k;
    if (this.picked >= 0) {
      const pk = clamp(this.pickT / 0.6, 0, 1);
      if (i === this.picked) sc *= 1 + ease.outCubic(pk) * 0.1 + Math.sin(this.pickT * 60) * 0.004 * (1 - pk);
      else rk = Math.min(rk, 1 - ease.inQuad(pk));
      if (this.pickT > 0.7) { ctx.globalAlpha = clamp(1 - (this.pickT - 0.7) / 0.3, 0, 1); }
    }
    if (rk <= 0) { ctx.globalAlpha = 1; return; }
    ctx.save();
    ctx.translate(cx, cy);
    const tl = this.tilt[i];
    ctx.transform(1, tl.x * 0.05, -tl.y * 0.04, 1, 0, 0);
    ctx.scale(sc, sc);
    const full = rk >= 1;
    if (!full) { // jagged burning hole that grows to reveal the card
      const Rm = Math.hypot(this.cw, this.ch) * 0.56 * ease.outCubic(rk), seed = card.seed * 10;
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const a = (k / 48) * TAU, r = Rm * (1 + 0.13 * Math.sin(a * 7 + seed) + 0.07 * Math.sin(a * 13 + t * 4 + seed));
        k ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      const hole = new Path2D(); hole.addPath(ctxPathCopy(ctx, Rm, seed, t));
      ctx.save(); ctx.beginPath(); ctx.rect(-this.cw / 2, -this.ch / 2, this.cw, this.ch); ctx.clip();
      ctx.clip(hole);
      drawCard(ctx, card, this.cw, this.ch, t, { hover: false, tiltX: tl.x, tiltY: tl.y }, player);
      // glowing, burning edge of the hole (only over the card)
      ctx.restore(); ctx.save(); ctx.beginPath(); ctx.rect(-this.cw / 2, -this.ch / 2, this.cw, this.ch); ctx.clip();
      ctx.shadowColor = 'rgba(255,120,40,0.95)'; ctx.shadowBlur = 16 * this.k; ctx.strokeStyle = 'rgba(255,160,70,0.95)'; ctx.lineWidth = 3.5 * this.k; ctx.stroke(hole);
      ctx.restore(); ctx.restore(); ctx.globalAlpha = 1;
      return;
    }
    drawCard(ctx, card, this.cw, this.ch, t, { hover: this.picked < 0 && i === this.sel && this.dealDone, tiltX: tl.x, tiltY: tl.y }, player);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// Upgrade cards: rolling, formatting and the trading-card style selection screen.
import { TAU, clamp, lerp, ease, rand, hsl } from './util.js';
import { REWARD_TIERS } from './config.js';
import { PLAYER_BASE, ROUTE, RARITIES, UPGRADES, ELEMENTS, HEAL_CARD, ITEM_CARDS, PLAYER_COLORS, TALENTS, TALENT_CHANCE, MAX_TALENTS, TALENT_POWER, TALENT_UPGRADE_POWER, TALENT_UPGRADE_CD, TALENT_MIN_CD } from './config.js';
import { talentCd, grantTalent, upgradeTalent, talentInfo } from './talents.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { INK, drawWeapon } from './rig.js';
import { isStat, drawStatGlyph, drawStatIcon, STAT_STYLE } from './staticons.js';
import { rarityWeights, drawSacrificeCard } from './sacrifice.js';
import { ARTS, ART_SLOTS, artOptions } from './arts.js';
import { richWidth, drawRich, drawPadButton, padButtonWidth } from './padicons.js';

// ---------------------------------------------------------------- rolling
// tier = a route node's reward tier (0 low, 1 medium, 2 high): it multiplies the odds of the better rarities
function rollRarity(player, tier = 0) {
  const mul = (REWARD_TIERS[tier] || REWARD_TIERS[0]).mul;
  const W = rarityWeights(player, RARITIES.map((r, i) => r.weight * mul[i])); // sacrifices can shift the odds
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
  for (const t of player.talents) if ((t.rarity || 0) < 3) out.push({ type: 'talent', talent: t.key, kind: 'up', key: `talent_${t.key}` });
  if (!player.singlePath) for (const k of Object.keys(TALENTS)) if (!player.talents.find((t) => t.key === k)) out.push({ type: 'talent', talent: k, kind: 'new', key: `talent_${k}` });
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
    const rarity = talentRarity(player, c, rollRarity(player));
    let value = 0;
    if (c.type === 'stat') value = UPGRADES[c.stat].values[rarity];
    else if (c.type === 'element') value = ELEMENTS[c.element].values[rarity];
    else if (ITEM_CARDS[c.type]) value = ITEM_CARDS[c.type].values[rarity];
    return { ...c, rarity, value };
  });
}

// a talent upgrade is always at least one rarity above the talent you have
function talentRarity(player, c, rolled) {
  if (c.type !== 'talent' || c.kind !== 'up') return rolled;
  const t = player.talents.find((x) => x.key === c.talent);
  return Math.min(3, Math.max(rolled, (t ? t.rarity || 0 : 0) + 1));
}
function withRarity(player, c, tier = 0, force = null) {
  if (c.type === 'art') return { ...c, rarity: 2, value: 0 }; // arts have no rarity roll
  const rarity = force !== null ? force : talentRarity(player, c, rollRarity(player, tier));
  let value = 0;
  if (c.type === 'stat') value = UPGRADES[c.stat].values[rarity];
  else if (c.type === 'element') value = ELEMENTS[c.element].values[rarity];
  else if (ITEM_CARDS[c.type]) value = ITEM_CARDS[c.type].values[rarity];
  return { ...c, rarity, value };
}
function statPool(player) {
  const stats = player.stats, pool = [];
  for (const k of Object.keys(UPGRADES)) {
    const u = UPGRADES[k];
    if (u.cap && stats[k] >= u.cap - 1e-9) continue;
    if (u.min && stats[k] <= u.min + 1e-9) continue;
    if (k === 'critChance' && (player.noCrit || player.alwaysCrit)) continue;
    if (k === 'critDamage' && player.noCrit) continue;
    pool.push({ type: 'stat', stat: k, key: k });
  }
  return shuffle(pool);
}
// one imbuement offer per weapon: its own element if it has one (to strengthen), else a random new one
function elementOffers(player) {
  const out = [], used = new Set();
  player.weapons.forEach((w, slot) => {
    const own = weaponElement(w);
    const opts = shuffle((own ? [own] : Object.keys(ELEMENTS)).filter((el) => !(ELEMENTS[el].cap && w.elements[el] >= ELEMENTS[el].cap - 1e-9)));
    const el = opts.find((e) => !used.has(e)) || opts[0];
    if (el) { used.add(el); out.push({ type: 'element', element: el, slot, key: `${el}${slot}` }); }
  });
  return out;
}

// one weapon art offer per weapon, for a slot it hasn't filled yet
function artOffers(player) {
  const out = [];
  player.weapons.forEach((w, slot) => {
    const opts = artOptions(w);
    if (opts.length) { const k = opts[Math.floor(Math.random() * opts.length)]; out.push({ type: 'art', slot, art: k, artSlot: ARTS[w.key][k].slot, key: `art_${slot}_${k}` }); }
  });
  return out;
}
// this run's cards, for the pause menu: a copy with its effect and readout frozen as they read at pick time
export function recordPick(player, card) {
  if (!player || card.frozen) return;
  const c = { ...card };
  try { c.frozen = cardReadout(player, card); c.frozenFx = cardEffect(player, card); } catch (e) { /* drawn live instead */ }
  if (card.type === 'element' || card.type === 'art') c.weaponKey = player.weapons[card.slot] && player.weapons[card.slot].key;
  (player.picked || (player.picked = [])).push(c);
}
export function grantArt(player, slot, key) {
  const w = player.weapons[slot], A = ARTS[w.key][key];
  w.arts = { ...(w.arts || {}), [A.slot]: key };
  if (A.hp) player.hp += A.hp;
  if (player.g && player.g.fx) { player.g.fx.text(player.x, player.y, A.name, '#ffd070', 16, true); player.g.particles.burst('ember', player.x, player.y, 0.8, 20, 3, 0.8, 2, '#ffd070'); }
}

// Cards for the reward of a route node: 'stat' (3 stat upgrades), 'element' (2 imbuements),
// 'talent' (2 talents), 'item' (heal, ki and Battle Rush). Missing options are filled with stat cards.
export function rollReward(player, type, tier = 0) {
  const n = ROUTE.options[type] || 3;
  let list = [];
  if (type === 'element') list = elementOffers(player);
  else if (type === 'talent') list = talentOptions(player).slice(0, n);
  else if (type === 'item') list = [{ type: 'heal', key: 'heal' }, { type: 'energy', key: 'energy' }, { type: 'rush', key: 'rush' }];
  else if (type === 'art') list = artOffers(player);
  if (!list.length && type !== 'stat') return rollReward(player, 'stat', tier).slice(0, n);
  for (const s of statPool(player)) { if (list.length >= n) break; if (!list.find((c) => c.key === s.key)) list.push(s); }
  const cards = list.slice(0, n).map((c) => withRarity(player, c, tier));
  // medium rewards guarantee a rare (or better) card, high rewards an epic (or better) one: if none rolled,
  // one random card is lifted to that rarity (when the player's sacrifices still allow that rarity at all)
  const min = (REWARD_TIERS[tier] || REWARD_TIERS[0]).min;
  const allowed = rarityWeights(player, RARITIES.map((r) => r.weight));
  if (min > 0 && allowed[min] > 0) {
    const lift = cards.filter((c) => c.type !== 'art');
    if (lift.length && !lift.some((c) => c.rarity >= min)) {
      const i = cards.indexOf(lift[Math.floor(Math.random() * lift.length)]);
      cards[i] = withRarity(player, list[i], tier, Math.max(min, cards[i].rarity));
    }
  }
  return cards;
}

function nextValue(player, card) {
  if (card.type === 'heal') return [player.hp, Math.min(player.maxHp, player.hp + card.value)];
  if (card.type === 'energy') return [player.energy, Math.min(player.maxEnergy, player.energy + card.value)];
  if (card.type === 'rush') return [player.nextRush || 0, Math.max(player.nextRush || 0, card.value)];
  if (card.type === 'talent') {
    const t = player.talents.find((x) => x.key === card.talent);
    return [t ? t.rarity || 0 : -1, card.rarity];
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
  recordPick(player, card);
  if (card.type === 'art') { grantArt(player, card.slot, card.art); return; }
  if (card.type === 'talent') {
    if (card.kind === 'new') grantTalent(player, card.talent, card.rarity, card.replace || null);
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
    if (player.g && player.g.fx) { player.g.fx.text(player.x, player.y, `+${Math.round(player.energy - before)} energy`, '#9ee8ff', 18); player.g.particles.burst('glow', player.x, player.y, 0.8, 20, 2.5, 1, 2.4, '#9ee8ff'); }
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
    case 'mulPct': return bonus ? `−${Math.round(v * 100)}%` : `${Math.round(v * 100)}%`;
    case 'chains': return `${sign}${v}`;
    case 'dps': return `${sign}${v}/s`;
    case 'slow': return `${sign}${Math.round(v * 100)}%`;
    case 'pct1': return `${sign}${(Math.round(v * 1000) / 10).toFixed(1).replace(/\.0$/, '')}%`; // one decimal (syphon)
  }
  return String(v);
}
export function fmtStat(stat, v, bonus = false) { return fmtValue(UPGRADES[stat].fmt, v, bonus); }

// a talent's description; the partner note only in co-op
const talentDesc = (T, player, card) => {
  const d = T.desc.replace('{dur}', T.dur); // {dur} = the talent's duration, so the text never drifts from the number
  return d + (T.coopDesc && player && player.g && player.g.players && player.g.players.length > 1 ? T.coopDesc : '');
};

// the button of a weapon's basic / special attack
const artButton = (slot, kind, pad) => (pad ? [['LB', 'LT'], ['RB', 'RT']] : [['Q', 'E'], ['LMB', 'RMB']])[slot ? 1 : 0][kind === 'special' ? 1 : 0];

export function cardReadout(player, card) {
  if (card.frozen) return card.frozen; // a card from this run's list: as it read when it was picked
  if (card.type === 'art') return { cur: '', bonus: '', next: '' };
  if (card.type === 'talent') {
    const [cur] = nextValue(player, card), I = talentInfo(card.talent, card.rarity);
    if (card.kind === 'up' && cur >= 0) { const C = talentInfo(card.talent, cur); return { cur: C.short, bonus: 'UP', next: I.short }; }
    return { cur: 'none', bonus: 'NEW', next: I.short };
  }
  if (card.type === 'heal' || card.type === 'energy') {
    const [cur, next] = nextValue(player, card);
    return { cur: `${Math.ceil(cur)}`, bonus: `+${card.value}`, next: `${Math.ceil(next)}` };
  }
  if (card.type === 'rush') return { cur: 'none', bonus: `+${Math.round(card.value * 100)}%`, next: `+${Math.round(card.value * 100)}%` };
  const fmt = card.type === 'element' ? ELEMENTS[card.element].fmt : UPGRADES[card.stat].fmt;
  const [cur, next] = nextValue(player, card);
  // diminishing elements (syphon) add less than the card's face value: show what is really added
  const add = card.type === 'element' && ELEMENTS[card.element].diminish ? next - cur : card.value;
  return { cur: fmtValue(fmt, cur), bonus: fmtValue(fmt, add, true), next: fmtValue(fmt, next) };
}

export function cardInfo(player, card) {
  if (card.type === 'art') { const A = ARTS[player.weapons[card.slot].key][card.art]; return { name: A.name, jp: `${A.jp} · ${ART_SLOTS[A.slot].name.toLowerCase()}`, sub: null, icon: 'art' }; }
  if (card.type === 'talent') {
    const T = TALENTS[card.talent];
    const I = talentInfo(card.talent, card.rarity);
    const sub = card.kind === 'up' ? `upgrade to ${RARITIES[card.rarity].name} · ${I.num}` : `${talentDesc(T, player, card)} · ${I.num} · ${I.cd}s cooldown`;
    return { name: T.name, jp: card.kind === 'up' ? `${T.jp} · upgrade` : `${T.jp} · talent`, sub, icon: `talent_${card.talent}` };
  }
  if (ITEM_CARDS[card.type]) { const I = ITEM_CARDS[card.type]; return { name: I.name, jp: `${I.jp} · item`, sub: null, icon: card.type }; }
  if (card.type === 'element') {
    const E = ELEMENTS[card.element];
    const unit = { lightning: 'chained enemies', poison: 'poison damage / second', ice: 'slow', syphon: 'of damage healed', wind: 'faster cooldowns' }[card.element];
    return { name: E.name, jp: `${E.jp} · imbuement`, sub: unit, icon: card.element };
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
    case 'talent_arrowRain': { // a still volley of real arrows (steel head, shaft, feather fletching, nock) dropping onto a target ring
      // one arrow: tip at (x, y), pointing along angle a, length L
      const arrow = (x, y, a, L) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(a); // +x points from the tail to the tip
        ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(-6, 0); ctx.stroke(); // the shaft
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, -3.4); ctx.lineTo(-6.5, 0); ctx.lineTo(-8, 3.4); ctx.closePath(); ctx.fill(); // the head
        for (const sd of [-1, 1]) { // two feathers, swept back, with a notched trailing edge
          ctx.beginPath(); ctx.moveTo(-L + 13, 0);
          ctx.quadraticCurveTo(-L + 8, sd * 1.5, -L + 2, sd * 5.2);
          ctx.lineTo(-L + 4, sd * 3.6); ctx.lineTo(-L + 1, sd * 3.8); ctx.lineTo(-L + 1.5, sd * 1.2); ctx.lineTo(-L + 1, 0);
          ctx.closePath(); ctx.fill();
        }
        ctx.save(); ctx.globalAlpha *= 0.45; ctx.lineWidth = 0.8; // the feathers' barbs
        for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-L + 10 - k * 3, sd * 0.6); ctx.lineTo(-L + 7 - k * 3, sd * (2.2 + k * 0.6)); ctx.stroke(); }
        ctx.restore();
        ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-L - 2.4, -1.6); ctx.lineTo(-L, 0); ctx.lineTo(-L - 2.4, 1.6); ctx.stroke(); // the nock
        ctx.restore();
      };
      const fall = Math.PI / 2 - 0.32; // dropping steeply, a little to the right
      for (const [x, y, L] of [[-18, 12, 30], [-7, 18, 34], [4, 10, 30], [15, 16, 32], [25, 6, 27]]) arrow(x, y, fall, L);
      ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 24, 24, 5, 0, 0, TAU); ctx.stroke(); // the ground they hit
      break;
    }
    case 'talent_meteor': { // a rock falling with a tapering flame tail and speed lines
      const a = Math.atan2(1, 1); // falling down-right
      ctx.save(); ctx.translate(9, 9); ctx.rotate(a);
      ctx.globalAlpha *= 0.35; ctx.beginPath(); ctx.moveTo(0, -12); ctx.quadraticCurveTo(-26, -8, -44, 0); ctx.quadraticCurveTo(-26, 8, 0, 12); ctx.closePath(); ctx.fill();
      ctx.globalAlpha /= 0.35; ctx.globalAlpha *= 0.7; ctx.beginPath(); ctx.moveTo(0, -7); ctx.quadraticCurveTo(-18, -4, -32, 0); ctx.quadraticCurveTo(-18, 4, 0, 7); ctx.closePath(); ctx.fill();
      ctx.globalAlpha /= 0.7;
      ctx.lineWidth = 2; for (const [y, l] of [[-15, 14], [15, 11]]) { ctx.beginPath(); ctx.moveTo(-14, y); ctx.lineTo(-14 - l, y); ctx.stroke(); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(9, 9, 12, 0, TAU); ctx.fill(); // the rock
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; for (const [cx, cy, r] of [[5, 6, 3], [13, 12, 2.2], [11, 4, 1.5]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); }
      break;
    }
    case 'talent_meditate': { // a figure seated in lotus, a halo behind the head, two motes of energy
      ctx.globalAlpha *= 0.55; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, -14, 11, 0, TAU); ctx.stroke(); ctx.globalAlpha /= 0.55;
      ctx.beginPath(); ctx.arc(0, -13, 5.5, 0, TAU); ctx.fill(); // head
      ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(3, -7); ctx.quadraticCurveTo(11, -6, 12, 2); ctx.quadraticCurveTo(13, 10, 3, 9); ctx.lineTo(-3, 9); ctx.quadraticCurveTo(-13, 10, -12, 2); ctx.quadraticCurveTo(-11, -6, -3, -7); ctx.closePath(); ctx.fill(); // shoulders, arms resting, hands in the lap
      ctx.beginPath(); ctx.ellipse(0, 14, 21, 5.5, 0, 0, TAU); ctx.fill(); // crossed legs
      for (const sx of [-1, 1]) { const x = sx * 19, y = -16 + Math.sin(t * 2 + sx) * 2; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 2.5, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 2.5, y); ctx.closePath(); ctx.fill(); }
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
  knives: [['kunai_volley', -0.35, 2]],
  staff: [['holystaff', -0.75, -9]],
  bo: [['bo', -0.6, -5]],
  shield: [['shield_icon', 0, 0]],
};
const WSCALE = { katanas: 2.0, heavy: 1.7, crossbow: 2.1, knives: 2.6, staff: 1.8, bo: 1.85, shield: 2.4 };
// the middle of a weapon's drawing (measured once from its pixels), so it can be centred in a picture
const ART_MID = {};
function artMid(key) {
  if (ART_MID[key]) return ART_MID[key];
  let mid = { x: 0, y: 0 };
  try {
    const N = 512, c = document.createElement('canvas'); c.width = N; c.height = N;
    const x = c.getContext('2d'); x.translate(N / 2, N / 2); drawWeaponArt(x, key, 1, null);
    const d = x.getImageData(0, 0, N, N).data; let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) if (d[(yy * N + xx) * 4 + 3] > 40) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    if (x1 >= 0) mid = { x: (x0 + x1) / 2 - N / 2, y: (y0 + y1) / 2 - N / 2 };
  } catch (e) { /* no canvas: leave it as drawn */ }
  return (ART_MID[key] = mid);
}
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
  else drawCardBase(ctx, card, BASE_W, h / S, t, st, player); // every other reward: the trading card, themed per type (THEMES)
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
const STAT_DESC = { baseDamage: 'Attacks do more damage', critChance: 'More hits become critical hits', critDamage: 'Critical hits deal more damage', moveSpeed: 'Makes you run faster', energyRegen: 'Energy refills faster', healthRegen: 'Health refills over time', cooldown: 'Reduces time between attacks', kiCost: 'Attacks cost less energy' };
const ELEM_DESC = { lightning: 'Attacks chain to enemies', poison: 'Damages enemies over time', ice: 'Slows down enemies', syphon: 'Heal from the damage you deal', wind: 'Attacks recover faster' };
export function cardEffect(player, card) {
  if (card.frozenFx) return card.frozenFx;
  if (card.type === 'art') { const A = ARTS[player.weapons[card.slot].key][card.art]; return { text: A.text, desc: A.desc }; }
  if (card.type === 'heal') return { text: `+${card.value} health`, desc: 'Heals you right away' };
  if (card.type === 'energy') return { text: `+${card.value} energy`, desc: 'Refills your energy right away' };
  if (card.type === 'rush') return { text: `+${Math.round(card.value * 100)}% damage`, desc: 'During all of the next level' };
  if (card.type === 'talent') {
    const T = TALENTS[card.talent];
    const I = talentInfo(card.talent, card.rarity);
    if (card.kind === 'forget') return { text: 'Replace this talent', desc: 'You forget it for the new one' };
    if (card.kind === 'up') { const t = player.talents.find((x) => x.key === card.talent); return { text: I.num, desc: `Upgrade from ${RARITIES[t ? t.rarity || 0 : 0].name} · ${I.cd}s cd` }; }
    return { text: I.num, desc: talentDesc(T, player, card) };
  }
  if (card.type === 'element') {
    const [cur, next] = nextValue(player, card), d = next - cur;
    const text = { wind: `−${Math.round(d * 100)}% cooldowns`, lightning: `+${d} enemy chained`, poison: `+${d} poison damage`, ice: `+${Math.round(d * 100)}% slow`, syphon: `+${(d * 100).toFixed(1).replace(/\.0$/, '')}% lifesteal` }[card.element];
    return { text, desc: ELEM_DESC[card.element] };
  }
  const U = UPGRADES[card.stat];
  if (U.fmt === 'perSec1' || U.fmt === 'perSec2') return { text: `+${Math.round((card.value / PLAYER_BASE.stats[card.stat]) * 100)}%`, desc: STAT_DESC[card.stat] }; // regen: as a share of the base rate
  return { text: fmtValue(U.fmt, card.value, true), desc: STAT_DESC[card.stat] }; // the stat's name is already the card title
}
// small round icon (stat / element / talent / heal) in the card's colours
function effectIcon(ctx, card, x, y, size, t) {
  if (card.type === 'art') { // the slot's kanji in a gold ring
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(16,12,20,0.92)'; ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffd070'; ctx.lineWidth = Math.max(1, size * 0.08); ctx.beginPath(); ctx.arc(0, 0, size / 2 - ctx.lineWidth / 2, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffd070'; ctx.font = `800 ${Math.round(size * 0.58)}px "Shippori Mincho", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ART_SLOTS[card.artSlot || 'basic'].jp, 0, size * 0.04);
    ctx.restore(); return;
  }
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
const CATEGORY = { art: ['TECHNIQUE', '#5a1a2a'], stat: ['TRAINING', '#3a3028'], element: ['IMBUEMENT', '#24365a'], talent: ['TALENT', '#5a3a10'], heal: ['CONSUMABLE', '#6a1a2a'], energy: ['CONSUMABLE', '#1a4a5a'], rush: ['CONSUMABLE', '#6a3410'] };
function categoryChip(ctx, card, right, y, t) {
  const [label, bg] = CATEGORY[card.type] || CATEGORY.stat;
  ctx.save();
  ctx.font = '800 8.5px "Zen Kaku Gothic New", sans-serif';
  const w = ctx.measureText(label).width + 24, h = 16, x = right - w;
  ctx.fillStyle = bg; rrect(ctx, x, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,210,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  effectIcon(ctx, card, x + 8.5, y, 13, t);
  ctx.fillStyle = '#f8ecd4'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 17, y + 0.5);
  ctx.restore();
  return x;
}

function drawCardBase(ctx, card, w, h, t, st, player) {
  const R = RARITIES[card.rarity], ri = card.rarity, u = cardInfo(player, card), ST = STYLE[ri];
  const tk = themeOf(card), TH = tk ? THEMES[tk] : null, dark = TH && TH.dark;
  const elemCol = card.type === 'element' ? ELEMENTS[card.element].color : null;
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

  // ---- body: plain washi for stats; each other type has its own paper
  rrect(ctx, ix, iy, iw, ih, 2);
  if (TH) {
    const pg = ctx.createLinearGradient(0, iy, 0, iy + ih); pg.addColorStop(0, TH.paper[0]); pg.addColorStop(1, TH.paper[1]);
    ctx.fillStyle = pg; ctx.fill();
    ctx.save(); ctx.globalAlpha = TH.tex; rrect(ctx, ix, iy, iw, ih, 2); ctx.fillStyle = getPaper(ctx); ctx.fill(); ctx.restore();
    if (ri >= 1) { // a wash of the rarity's colour over the themed paper (blue / purple / gold), strongest at the edges
      const rc = ['', '95,178,255', '199,125,255', '255,206,80'][ri], rg = ctx.createRadialGradient(0, 0, Math.min(iw, ih) * 0.2, 0, 0, Math.max(iw, ih) * 0.7);
      rg.addColorStop(0, `rgba(${rc},${[0, 0.06, 0.08, 0.1][ri]})`); rg.addColorStop(1, `rgba(${rc},${[0, 0.3, 0.34, 0.4][ri]})`);
      ctx.save(); rrect(ctx, ix, iy, iw, ih, 2); ctx.clip(); ctx.fillStyle = rg; ctx.fillRect(ix, iy, iw, ih); ctx.restore();
    }
    if (elemCol) { const eg = ctx.createRadialGradient(0, iy + ih * 0.3, 10, 0, iy + ih * 0.3, ih * 0.75); eg.addColorStop(0, `rgba(${rgbOf(elemCol)},0.22)`); eg.addColorStop(1, `rgba(${rgbOf(elemCol)},0)`); ctx.save(); rrect(ctx, ix, iy, iw, ih, 2); ctx.clip(); ctx.fillStyle = eg; ctx.fillRect(ix, iy, iw, ih); ctx.restore(); }
  } else { ctx.fillStyle = getPaper(ctx); ctx.fill(); }
  if (tk === 'item') teaHouseBody(ctx, ix, iy, iw, ih);
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

  // ---- header: rarity gems + name on the left, a category chip (icon + word) on the right (on the type's band)
  const talent = card.type === 'talent';
  const band = TH && (tk === 'talent' ? ['#3e2c16', '#173a66', '#4a1e6a', '#7a5410'][ri] : TH.band || (elemCol && `rgba(${rgbOf(elemCol)},0.32)`));
  if (band && tk === 'item') teaHouseNoren(ctx, ix, iy, iw, t);
  else if (band) { ctx.save(); rrect(ctx, ix, iy, iw, ih, 2); ctx.clip(); ctx.fillStyle = band; ctx.fillRect(ix, iy, iw, 27); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(ix, iy + 27, iw, 1.5); ctx.restore(); }
  ctx.textBaseline = 'middle';
  if (card.type !== 'art') for (let i = 0; i <= ri; i++) { // one gem per rarity step (techniques have no rarity)
    const gx = ix + 13 + i * 11, gy = iy + 14;
    ctx.fillStyle = ri === 0 ? '#9a8c78' : ri === 3 ? '#e8a020' : R.color; ctx.strokeStyle = INK; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(gx, gy - 5.5); ctx.lineTo(gx + 4.5, gy); ctx.lineTo(gx, gy + 5.5); ctx.lineTo(gx - 4.5, gy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(gx, gy - 4); ctx.lineTo(gx + 2, gy - 1); ctx.lineTo(gx, gy); ctx.closePath(); ctx.fill();
  }
  const chipL = categoryChip(ctx, card, ix + iw - 7, iy + 14, t);
  const artHead = card.type === 'art', rx = artHead ? ix + 10 : ix + 13 + (ri + 1) * 11 - 2;
  const rname = artHead ? { basic: 'BASIC', special: 'SPECIAL', unique: 'PASSIVE' }[ARTS[player.weapons[card.slot].key][card.art].slot] : R.name.toUpperCase();
  ctx.font = '800 8.5px "Shippori Mincho", serif'; // the same size on every card
  ctx.textAlign = 'left'; ctx.fillStyle = TH ? (!artHead && ri >= 1 ? ['', '#8fcaff', '#dca8ff', '#ffd86a'][ri] : TH.bandText || elemCol) : ST.accent;
  ctx.fillText(rname, rx, iy + 14.5);

  // ---- art panel
  const ax = ix + 9, ay = iy + 30, aw = iw - 18, ah = ih * 0.42;
  const acx = ax + aw / 2, acy = ay + ah / 2;
  ctx.save();
  rrect(ctx, ax, ay, aw, ah, 2); ctx.clip();
  const scene = tk === 'imbue' ? sceneImbue : tk === 'item' ? sceneItem : tk === 'talent' ? sceneTalent : tk === 'art' ? sceneArt : null;
  if (scene) scene(ctx, ax, ay, aw, ah, card, player, t);
  else if (ri === 3) {
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
  // the subject (stat cards: the round badge; the other types draw theirs in their scene)
  const badgeR = ah * 0.3;
  if (scene) { /* drawn by the scene */ } else if (card.type === 'art') { // the weapon, glowing gold, with the art slot's seal
    const w0 = player.weapons[card.slot], A = ARTS[w0.key][card.art];
    ctx.save(); ctx.translate(acx - 8, acy + (w0.key === 'knives' ? 14 : 0)); drawWeaponArt(ctx, w0.key, ah / 110, '#ffd070'); ctx.restore();
    const bx = ax + aw - 26, by = ay + ah - 26;
    ctx.fillStyle = 'rgba(16,12,20,0.92)'; ctx.beginPath(); ctx.arc(bx, by, 20, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffd070'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, 19, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffd070'; ctx.font = '800 20px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ART_SLOTS[A.slot].jp, bx, by + 1);
  } else if (card.type === 'element') {
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
  ctx.strokeStyle = ri === 3 ? '#6a4208' : dark ? '#000' : INK; ctx.lineWidth = 1.6; rrect(ctx, ax, ay, aw, ah, 2); ctx.stroke();

  // ---- name, brushed in ink with a vermilion stroke under it
  const ny = ay + ah + 21;
  ctx.textAlign = 'center';
  let fs = 21; ctx.font = `800 ${fs}px "Shippori Mincho", serif`;
  while (ctx.measureText(u.name).width > iw - 20 && fs > 13) { fs--; ctx.font = `800 ${fs}px "Shippori Mincho", serif`; }
  if (ri === 3) { ctx.lineWidth = 3; ctx.strokeStyle = '#5a3a0a'; ctx.strokeText(u.name, 0, ny); ctx.fillStyle = '#ffd86a'; }
  else ctx.fillStyle = TH ? TH.ink : INK;
  ctx.fillText(u.name, 0, ny);
  const nw = Math.min(iw - 30, ctx.measureText(u.name).width + 20);
  ctx.fillStyle = ri === 3 ? 'rgba(200,130,20,0.8)' : TH && TH.underline ? TH.underline : elemCol ? elemCol : tk === 'item' ? ITEM_CARDS[card.type].color : 'rgba(180,42,34,0.75)';
  ctx.beginPath(); ctx.moveTo(-nw / 2, ny + 13); ctx.quadraticCurveTo(0, ny + 10, nw / 2, ny + 12); ctx.lineTo(nw / 2 - 6, ny + 15); ctx.quadraticCurveTo(0, ny + 14.5, -nw / 2 + 4, ny + 15.5); ctx.closePath(); ctx.fill();

  // ---- the effect, in plain words and big: "+5% Damage"
  // (a new talent shows its button plaque here instead; a technique just explains itself)
  const fx = cardEffect(player, card);
  const ey = ny + 36, newTalent = talent && card.kind === 'new', isArt = card.type === 'art';
  const bonusCol = TH && TH.bonus ? TH.bonus : elemCol || ST.bonus;
  if (!newTalent && !isArt) {
    let efs = 17; ctx.font = `800 ${efs}px "Zen Kaku Gothic New", sans-serif`;
    while (ctx.measureText(fx.text).width > iw - 44 && efs > 11) { efs -= 0.5; ctx.font = `800 ${efs}px "Zen Kaku Gothic New", sans-serif`; }
    const etw = ctx.measureText(fx.text).width, eix = -etw / 2 - 11;
    effectIcon(ctx, card, eix, ey, 18, t);
    ctx.textAlign = 'left'; ctx.fillStyle = bonusCol; ctx.fillText(fx.text, eix + 13, ey + 0.5); ctx.textAlign = 'center';
  }
  // the description: one line, or wrapped (techniques get up to three lines, starting where the effect would be)
  ctx.fillStyle = TH ? TH.desc : 'rgba(40,30,25,0.68)';
  const dy = isArt ? ey - 6 : newTalent ? ey + 26 : ey + 20, maxL = isArt ? 3 : 2, dfs = isArt ? 11.5 : 11, lh = isArt ? 15 : 13;
  ctx.font = `700 ${dfs}px "Zen Kaku Gothic New", sans-serif`;
  const lines = []; let line = '';
  for (const wd of fx.desc.split(' ')) { const tryL = line ? line + ' ' + wd : wd; if (line && ctx.measureText(tryL).width > iw - 18 && lines.length < maxL - 1) { lines.push(line); line = wd; } else line = tryL; }
  lines.push(line);
  const y1 = isArt ? dy : lines.length > 1 ? dy - 3 : dy;
  lines.forEach((l, i) => fitText(ctx, l, 0, y1 + i * lh, iw - 18, dfs, '700', '"Zen Kaku Gothic New", sans-serif'));

  // ---- talent plaque: which button it goes on (a new talent: where the effect line would be)
  if (talent) {
    const py = newTalent ? ey : ey + 47, ph = 22;
    ctx.fillStyle = 'rgba(26,23,32,0.92)'; rrect(ctx, ix + 8, py - ph / 2, iw - 16, ph, 4); ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '800 11px "Zen Kaku Gothic New", sans-serif';
    const slot = newTalent ? (card.replace ? player.talents.findIndex((x) => x.key === card.replace) : player.talents.length) : player.talents.findIndex((x) => x.key === card.talent);
    const lab = TALENT_BUTTONS[pad ? 'pad' : 'kbm'][clamp(slot, 0, 2)];
    const full = newTalent && !card.replace && player.talents.length >= MAX_TALENTS;
    const txt = full ? 'NEW TALENT · replaces one' : newTalent ? 'NEW TALENT on' : card.kind === 'forget' ? 'REPLACE TALENT on' : 'UPGRADES TALENT on';
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = '#ffd56a'; ctx.fillText(txt, full ? -tw / 2 : -tw / 2 - 12, py + 0.5);
    if (!full) keyCap(ctx, tw / 2 + 2, py, 8.5, lab, pad);
    ctx.textAlign = 'center';
  }

  // ---- readout pill: now ➜ after (imbuement cards have no weapon plaque, so theirs is drawn larger)
  const big = card.type === 'element' ? 1.3 : 1;
  if (dark) drawReadout(ctx, player, card, iy + ih - 20 - (big - 1) * 16, iw - 26, bonusCol, big, '#f0e6d8', 'rgba(240,230,215,0.7)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.28)');
  else if (TH) drawReadout(ctx, player, card, iy + ih - 20 - (big - 1) * 16, iw - 26, bonusCol, big, TH.ink, 'rgba(60,46,36,0.75)', TH.readBg || 'rgba(60,44,30,0.1)', TH.readEdge || 'rgba(60,44,30,0.28)');
  else drawReadout(ctx, player, card, iy + ih - 20 - (big - 1) * 16, iw - 26, ST.bonus, big);
  // seal stamped in the corner of the paper
  hanko(ctx, ax + 17, ay + ah - 17, ri === 3 ? 22 : 19, talent ? '才' : card.type === 'art' ? ART_SLOTS[ARTS[player.weapons[card.slot].key][card.art].slot].jp : card.type === 'element' ? '付' : card.type === 'heal' ? '癒' : card.type === 'energy' ? '気' : card.type === 'rush' ? '勢' : '力', ST.seal, '#fbefe0', 0.12);

  // ---- talents are scrolls: wooden rollers across the top and bottom, a hanging cord, curled paper edges
  if (tk === 'talent') scrollRollers(ctx, w, h, ri, t);
  // ---- rarity ornaments
  if (ri >= 1 && tk !== 'talent') { // metal corner fittings (silver / gold / heavy gold)
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
  if (tk === 'imbue') imbueParticles(ctx, card, w, h, t);
  // selection outline
  if (sel) {
    ctx.save(); ctx.lineWidth = 2.5; ctx.strokeStyle = ri === 0 ? '#f4ead6' : R.color;
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 4);
    rrect(ctx, x0 - 6, y0 - 6, w + 12, h + 12, 6); ctx.stroke(); ctx.restore();
  }
}

// ---------------------------------------------------------------- talent scrolls
// a hanging scroll's parts drawn over the card: rollers (jiku) with end caps in the rarity's metal,
// shading where the paper curls round them, and a cord with a tassel on the top roller
function scrollRollers(ctx, w, h, ri, t) {
  const x0 = -w / 2, y0 = -h / 2, rh = 11, ext = 9;
  const cap = ['#3a2412', '#5fb2ff', '#c77dff', '#ffd45e'][ri], capEdge = ri === 0 ? '#1a0e06' : INK;
  const cord = ['#8a1a14', '#2a64b0', '#7a3ab0', '#c8902a'][ri];
  ctx.save();
  // the paper curling into the rollers
  for (const [y, dir] of [[y0 + rh / 2, 1], [y0 + h - rh / 2, -1]]) {
    const g = ctx.createLinearGradient(0, y, 0, y + dir * 14); g.addColorStop(0, 'rgba(40,24,8,0.35)'); g.addColorStop(1, 'rgba(40,24,8,0)');
    ctx.fillStyle = g; ctx.fillRect(x0 + 2, dir > 0 ? y : y - 14, w - 4, 14);
  }
  // the cord from the top roller, with a small knot
  const sway = Math.sin(t * 1.4) * 1.5;
  ctx.strokeStyle = cord; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-w * 0.28, y0 + 1); ctx.lineTo(sway, y0 - 15); ctx.lineTo(w * 0.28, y0 + 1); ctx.stroke();
  ctx.fillStyle = cord; ctx.beginPath(); ctx.arc(sway, y0 - 15, 2.6, 0, TAU); ctx.fill();
  for (const y of [y0 - rh / 2 + 3, y0 + h - rh / 2 + 3]) {
    // the wooden roller, a little wider than the paper
    const g = ctx.createLinearGradient(0, y, 0, y + rh);
    g.addColorStop(0, '#9a6a3a'); g.addColorStop(0.35, '#5a3418'); g.addColorStop(1, '#2a1608');
    ctx.fillStyle = g; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    rrect(ctx, x0 - ext + 6, y, w + ext * 2 - 12, rh, 3); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,190,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0 - ext + 9, y + 2.5); ctx.lineTo(x0 + w + ext - 9, y + 2.5); ctx.stroke();
    // end caps
    for (const sx of [x0 - ext, x0 + w + ext - 8]) {
      if (ri >= 1) { const gg = ctx.createRadialGradient(sx + 4, y + rh / 2, 0, sx + 4, y + rh / 2, 13); gg.addColorStop(0, cap); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = gg; ctx.fillRect(sx - 9, y - 9, 26, rh + 18); ctx.restore(); }
      ctx.fillStyle = cap; ctx.strokeStyle = capEdge; ctx.lineWidth = 1.2;
      rrect(ctx, sx, y - 1.5, 8, rh + 3, 2.5); ctx.fill(); ctx.stroke();
      if (ri >= 2) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(sx + 1.5, y, 2, rh); }
      if (ri === 3) { ctx.fillStyle = '#b52a22'; ctx.beginPath(); ctx.arc(sx + 4, y + rh / 2, 1.8, 0, TAU); ctx.fill(); }
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- tea house (consumable cards)
// the header: a green noren curtain hanging from a wooden rod, split in three
function teaHouseNoren(ctx, ix, iy, iw, t) {
  const h = 27;
  ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, h + 4); ctx.clip();
  const g = ctx.createLinearGradient(0, iy, 0, iy + h); g.addColorStop(0, '#4a7a3e'); g.addColorStop(1, '#335a2a');
  const third = iw / 3;
  for (let k = 0; k < 3; k++) { // three panels with a slight sway at the hem
    const x = ix + k * third + (k ? 1 : 0), w = third - (k < 2 ? 1 : 0) - (k ? 1 : 0), sw = Math.sin(t * 1.2 + k * 1.3) * 0.8;
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, iy); ctx.lineTo(x + w, iy); ctx.lineTo(x + w + sw, iy + h); ctx.quadraticCurveTo(x + w / 2 + sw, iy + h + 1.5, x + sw, iy + h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 2, iy + h - 3); ctx.lineTo(x + w - 2, iy + h - 3); ctx.stroke();
  }
  ctx.fillStyle = '#5a3a1e'; ctx.fillRect(ix, iy, iw, 2.5); // the rod
  ctx.restore();
}
// the body: a faint shoji lattice on the paper below the picture, and a tatami edge along the foot
function teaHouseBody(ctx, ix, iy, iw, ih) {
  ctx.save(); rrect(ctx, ix, iy, iw, ih, 2); ctx.clip();
  for (const x of [ix, ix + iw - 5]) { // the posts
    const pg = ctx.createLinearGradient(x, 0, x + 5, 0); pg.addColorStop(0, '#5a3a20'); pg.addColorStop(0.5, '#86603a'); pg.addColorStop(1, '#5a3a20');
    ctx.fillStyle = pg; ctx.fillRect(x, iy + 27, 5, ih - 33);
    ctx.fillStyle = 'rgba(30,18,8,0.35)'; for (let y = iy + 40; y < iy + ih - 10; y += 31) ctx.fillRect(x, y, 5, 1); // grain
  }
  ctx.strokeStyle = 'rgba(120,86,50,0.13)'; ctx.lineWidth = 1;
  const top = iy + ih * 0.5;
  for (let x = ix + iw / 6; x < ix + iw - 2; x += iw / 6) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, iy + ih - 8); ctx.stroke(); }
  for (let y = top; y < iy + ih - 8; y += 22) { ctx.beginPath(); ctx.moveTo(ix, y); ctx.lineTo(ix + iw, y); ctx.stroke(); }
  // tatami heri: a dark green cloth border with a small woven pattern
  const ty = iy + ih - 6;
  ctx.fillStyle = '#2e4a2a'; ctx.fillRect(ix, ty, iw, 6);
  ctx.fillStyle = 'rgba(232,220,180,0.55)';
  for (let x = ix + 3; x < ix + iw; x += 8) { ctx.beginPath(); ctx.moveTo(x, ty + 3); ctx.lineTo(x + 2, ty + 1.2); ctx.lineTo(x + 4, ty + 3); ctx.lineTo(x + 2, ty + 4.8); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

// ---------------------------------------------------------------- per-type themes
// Every reward card is the same trading card (rarity mount, art panel, name, effect, readout); each type
// has its own paper, header band, text colours and art scene. Stat cards use the plain washi look (no theme).
const themeOf = (card) => (card.type === 'element' ? 'imbue' : ITEM_CARDS[card.type] ? 'item' : card.type === 'talent' ? 'talent' : card.type === 'art' ? 'art' : null);
const THEMES = {
  // imbuement: deep night-blue paper glowing in the element's colour; magical
  imbue: { paper: ['#20244a', '#0c0e22'], tex: 0.1, dark: true, ink: '#eef0ff', desc: 'rgba(226,230,255,0.75)' },
  // supplies: warm tea-house paper, a green tea-cloth band
  item: { paper: ['#f1e4c6', '#dcc597'], tex: 0.6, band: '#3f6e34', bandText: '#f4ecd0', ink: '#2a1e14', desc: 'rgba(50,36,24,0.72)' },
  // talents: yellow and gold
  talent: { paper: ['#e4d2a6', '#c2a46a'], tex: 0.55, band: '#3e2c16', bandText: '#e8cf8e', ink: '#2c1e0e', desc: 'rgba(44,30,14,0.8)', bonus: '#6a3608', underline: 'rgba(110,64,20,0.85)', readBg: 'rgba(70,46,14,0.12)', readEdge: 'rgba(70,46,14,0.35)' },
  // weapon arts: traditional, dark crimson lacquer with gold
  art: { paper: ['#5a0e18', '#22050a'], tex: 0.1, dark: true, band: '#0e0406', bandText: '#e8c070', ink: '#f6e6c8', desc: 'rgba(246,230,200,0.78)', bonus: '#f0c870', underline: 'rgba(232,192,112,0.9)' },
};

// the [now] ➜ [after] readout (or a single line when there is nothing to compare); cy = its centre
function drawReadout(ctx, player, card, cy, width, bonusCol, big = 1, ink = '#4a3c30', muted = 'rgba(60,46,36,0.75)', bg = 'rgba(60,44,30,0.1)', edge = 'rgba(60,44,30,0.28)') {
  const ro = cardReadout(player, card), talent = card.type === 'talent';
  ctx.save(); ctx.translate(0, cy); ctx.scale(big, big);
  const ry = 0, rw = width / big, rh = 24;
  ctx.fillStyle = bg; rrect(ctx, -rw / 2, ry - rh / 2, rw, rh, rh / 2); ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  if ((talent && (card.kind === 'new' || card.kind === 'forget')) || card.type === 'rush' || card.type === 'art') { // nothing to compare: what it does and its cooldown / when it works
    ctx.font = '800 13px "Zen Kaku Gothic New", sans-serif';
    const AW = card.type === 'art' && player.weapons[card.slot], AA = AW && ARTS[AW.key][card.art];
    const padM = player.ctl && player.ctl.mode === 'pad', btn = AA && AA.slot !== 'unique' ? artButton(card.slot, AA.slot, padM) : '';
    const str = AA ? (btn ? (AA.slot === 'basic' ? AW.def.basic.name : AW.def.special.name) : '◆  Always active') : card.type === 'rush' ? '⏱  all of next level' : `${talentInfo(card.talent, card.rarity).num}  ·  ⟳ ${talentInfo(card.talent, card.rarity).cd}s`;
    for (let fs2 = 13; fs2 > 9 && ctx.measureText(str).width > rw - 16; fs2 -= 0.5) ctx.font = `800 ${fs2}px "Zen Kaku Gothic New", sans-serif`;
    const sw = ctx.measureText(str).width;
    if (btn) { // the button that uses it, then the attack's name
      const bh = 16, bw = padM ? padButtonWidth(btn, bh) : Math.max(16, btn.length * 7.2 + 8), gap = 7, tot = bw + gap + sw;
      const x0 = -tot / 2;
      if (padM) drawPadButton(ctx, btn, x0 + bw / 2, ry, bh);
      else keyCap(ctx, x0 + bw / 2, ry, 8, btn, false);
      ctx.font = '800 13px "Zen Kaku Gothic New", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = ink; ctx.fillText(str, x0 + bw + gap, ry + 0.5);
    } else { const rw2 = richWidth(ctx, str, 17); ctx.fillStyle = ink; drawRich(ctx, str, -rw2 / 2, ry + 0.5, 17); }
  } else {
    // [now]  ➜  [after]: the old value muted, the new one bold
    ctx.font = '700 12px "Zen Kaku Gothic New", sans-serif'; const cw = ctx.measureText(ro.cur).width;
    ctx.font = '800 15px "Zen Kaku Gothic New", sans-serif'; const nw2 = ctx.measureText(ro.next).width;
    const arrow = 22, tot = cw + arrow + nw2;
    let x = -tot / 2;
    ctx.font = '700 12px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = muted; ctx.fillText(ro.cur, x, ry + 0.5); x += cw;
    ctx.fillStyle = bonusCol; ctx.beginPath(); ctx.moveTo(x + 6, ry - 3.5); ctx.lineTo(x + 13, ry - 3.5); ctx.lineTo(x + 13, ry - 6.5); ctx.lineTo(x + 18, ry); ctx.lineTo(x + 13, ry + 6.5); ctx.lineTo(x + 13, ry + 3.5); ctx.lineTo(x + 6, ry + 3.5); ctx.closePath(); ctx.fill();
    x += arrow;
    ctx.font = '800 15px "Zen Kaku Gothic New", sans-serif'; ctx.fillText(ro.next, x, ry + 0.5);
  }
  ctx.restore();
  ctx.textAlign = 'center';
}

const rgbOf = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)].join(',');

// imbuement: the weapon floating in a turning magic circle of the element's colour, sparks in the air
function sceneImbue(ctx, ax, ay, aw, ah, card, player, t) {
  const E = ELEMENTS[card.element], w0 = player.weapons[card.slot], c = rgbOf(E.color), cx = ax + aw / 2, cy = ay + ah / 2 + 4;
  const bg = ctx.createRadialGradient(cx, cy, 4, cx, cy, aw * 0.75); bg.addColorStop(0, `rgba(${c},0.55)`); bg.addColorStop(0.45, '#151838'); bg.addColorStop(1, '#070816');
  ctx.fillStyle = bg; ctx.fillRect(ax, ay, aw, ah);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const R = ah * 0.4, pulse = 0.75 + 0.25 * Math.sin(t * 2.4);
  ctx.translate(cx, cy + 4); ctx.scale(1, 0.62); // the circle lies a little tilted, like on a floor
  ctx.strokeStyle = `rgba(${c},${0.8 * pulse})`; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, TAU); ctx.stroke();
  ctx.save(); ctx.rotate(t * 0.6); // runes turning around the ring
  ctx.fillStyle = `rgba(${c},${0.9 * pulse})`; ctx.font = '700 9px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const RUNES = '天地水火風雷氷毒吸力気魂';
  for (let i = 0; i < 12; i++) { ctx.save(); ctx.rotate((i / 12) * TAU); ctx.translate(0, -R * 0.91); ctx.fillText(RUNES[i], 0, 0); ctx.restore(); }
  ctx.restore();
  ctx.save(); ctx.rotate(-t * 0.9); ctx.strokeStyle = `rgba(${c},${0.55 * pulse})`; ctx.lineWidth = 1.2; // a turning star inside
  ctx.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i * 2 / 6) * TAU + Math.PI / 2, r = R * 0.72; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
  ctx.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i * 2 / 6) * TAU - Math.PI / 2, r = R * 0.72; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
  ctx.restore();
  ctx.restore();
  // a column of light and the floating weapon
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const col = ctx.createLinearGradient(0, ay, 0, cy + 6); col.addColorStop(0, `rgba(${c},0)`); col.addColorStop(1, `rgba(${c},0.35)`);
  ctx.fillStyle = col; ctx.fillRect(cx - R * 0.55, ay, R * 1.1, cy + 6 - ay); ctx.restore();
  { const k = ah / 118, m = artMid(w0.key); ctx.save(); ctx.translate(cx - m.x * k, cy - 6 - m.y * k); drawWeaponArt(ctx, w0.key, k, E.color); ctx.restore(); }
  // the element's seal in the corner
  const bx = ax + aw - 24, by = ay + 22;
  ctx.fillStyle = 'rgba(10,10,24,0.9)'; ctx.beginPath(); ctx.arc(bx, by, 17, 0, TAU); ctx.fill();
  ctx.strokeStyle = E.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, 16, 0, TAU); ctx.stroke();
  ctx.fillStyle = E.color; ctx.font = '800 17px "Shippori Mincho", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(E.jp, bx, by + 1);
}
// imbuement: the element's particles drifting over the whole card (drawn last, clipped to the card)
function imbueParticles(ctx, card, w, h, t) {
  const E = ELEMENTS[card.element], c = rgbOf(E.color), x0 = -w / 2, y0 = -h / 2, el = card.element;
  ctx.save(); rrect(ctx, x0, y0, w, h, 4); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const sp = 0.06 + ((i * 37) % 10) / 160, life = (t * sp + i / 14) % 1;
    const fall = el === 'ice'; // snow falls, everything else rises
    const x = x0 + ((i * 53.7) % w) + Math.sin(t * (0.8 + (i % 5) * 0.2) + i) * (el === 'wind' ? 22 : 9) + (el === 'wind' ? ((t * 40 + i * 30) % w) - w / 2 : 0);
    const y = el === 'wind' ? y0 + ((i * 97.3) % h) + Math.sin(t * 1.5 + i) * 6 : fall ? y0 + life * h : y0 + h - life * h;
    const a = Math.sin(life * Math.PI) * 0.38, sz = 1 + ((i * 7) % 4) * 0.5;
    ctx.save(); ctx.translate(((x - x0) % w + w) % w + x0, y);
    if (el === 'lightning') { ctx.strokeStyle = `rgba(${c},${a})`; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-2, -4 * sz); ctx.lineTo(1.5, -1); ctx.lineTo(-1.5, 1); ctx.lineTo(2, 4 * sz); ctx.stroke(); }
    else if (el === 'poison') { ctx.strokeStyle = `rgba(${c},${a})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 1.5 + sz, 0, TAU); ctx.stroke(); }
    else if (el === 'ice') { ctx.strokeStyle = `rgba(${c},${a})`; ctx.lineWidth = 1; ctx.rotate(t + i); ctx.beginPath(); for (let k = 0; k < 3; k++) { ctx.rotate(Math.PI / 3); ctx.moveTo(-2.5 * sz, 0); ctx.lineTo(2.5 * sz, 0); } ctx.stroke(); }
    else if (el === 'wind') { ctx.strokeStyle = `rgba(${c},${a * 0.9})`; ctx.lineWidth = 1.2; ctx.lineCap = 'round'; const L = 7 + sz * 3; ctx.beginPath(); ctx.moveTo(-L, 0); ctx.bezierCurveTo(-L / 3, -3, L / 3, 3, L, -1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-L * 0.6, 4); ctx.quadraticCurveTo(0, 2, L * 0.5, 5); ctx.stroke(); }
    else { ctx.fillStyle = `rgba(${c},${a})`; ctx.beginPath(); ctx.moveTo(0, -3 * sz); ctx.quadraticCurveTo(2 * sz, 0, 0, 1.5 * sz); ctx.quadraticCurveTo(-2 * sz, 0, 0, -3 * sz); ctx.fill(); }
    ctx.fillStyle = `rgba(${c},${a * 0.12})`; ctx.beginPath(); ctx.arc(0, 0, 4 + sz * 2, 0, TAU); ctx.fill(); // soft glow
    ctx.restore();
  }
  ctx.restore();
}

// supplies: a drink on a lacquer tray in a tea house (shoji behind, a wooden table), steaming
function sceneItem(ctx, ax, ay, aw, ah, card, player, t) {
  const cx = ax + aw / 2, ty = ay + ah * 0.66;
  // shoji screen: pale paper with a wooden lattice
  ctx.fillStyle = '#f4ead2'; ctx.fillRect(ax, ay, aw, ty - ay);
  ctx.strokeStyle = 'rgba(110,80,50,0.55)'; ctx.lineWidth = 1.5;
  for (let x = ax + 18; x < ax + aw; x += 26) { ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x, ty); ctx.stroke(); }
  for (let y = ay + 16; y < ty; y += 22) { ctx.beginPath(); ctx.moveTo(ax, y); ctx.lineTo(ax + aw, y); ctx.stroke(); }
  const glow = ctx.createRadialGradient(cx + 30, ay + 14, 0, cx + 30, ay + 14, aw * 0.7); glow.addColorStop(0, 'rgba(255,236,190,0.6)'); glow.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.fillStyle = glow; ctx.fillRect(ax, ay, aw, ty - ay);
  // the wooden table
  const tg = ctx.createLinearGradient(0, ty, 0, ay + ah); tg.addColorStop(0, '#8a5e36'); tg.addColorStop(1, '#5a3a20');
  ctx.fillStyle = tg; ctx.fillRect(ax, ty, aw, ay + ah - ty);
  ctx.strokeStyle = 'rgba(40,24,10,0.35)'; ctx.lineWidth = 1; for (let k = 0; k < 4; k++) { const y = ty + 6 + k * 9; ctx.beginPath(); ctx.moveTo(ax, y); ctx.bezierCurveTo(ax + aw * 0.3, y + 2, ax + aw * 0.7, y - 2, ax + aw, y); ctx.stroke(); }
  // the tray
  ctx.fillStyle = '#2a1414'; ctx.beginPath(); ctx.ellipse(cx, ty + 10, aw * 0.42, 13, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#7a1a1a'; ctx.beginPath(); ctx.ellipse(cx, ty + 7, aw * 0.4, 11, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 1; ctx.stroke();
  ctx.lineWidth = 1.4; ctx.strokeStyle = INK;
  const steam = (x, y, n = 3) => { // rising steam curls
    ctx.save(); ctx.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const life = (t * 0.45 + k / n) % 1, a = Math.sin(life * Math.PI) * 0.7;
      ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 2.2;
      ctx.beginPath(); const yy = y - life * 30; ctx.moveTo(x + (k - 1) * 5, yy); ctx.bezierCurveTo(x + (k - 1) * 5 + 6, yy - 6, x + (k - 1) * 5 - 6, yy - 12, x + (k - 1) * 5, yy - 18); ctx.stroke();
    }
    ctx.restore();
  };
  if (card.type === 'heal') { // herbal tea: an iron teapot and a cup of green tea
    const px = cx - 24, py = ty + 2;
    ctx.fillStyle = '#2e2a2c'; ctx.beginPath(); ctx.ellipse(px, py - 14, 20, 16, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.ellipse(px - 6, py - 20, 8, 5, -0.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2e2a2c'; ctx.beginPath(); ctx.moveTo(px + 16, py - 16); ctx.quadraticCurveTo(px + 30, py - 22, px + 32, py - 30); ctx.lineTo(px + 28, py - 30); ctx.quadraticCurveTo(px + 26, py - 22, px + 14, py - 10); ctx.closePath(); ctx.fill(); ctx.stroke(); // spout
    ctx.strokeStyle = '#2e2a2c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, py - 26, 15, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; // handle
    ctx.fillStyle = '#3a3436'; ctx.beginPath(); ctx.ellipse(px, py - 28, 8, 3, 0, 0, TAU); ctx.fill(); ctx.stroke();
    const qx = cx + 26, qy = ty + 4; // the cup
    ctx.fillStyle = '#e8dcc4'; ctx.beginPath(); ctx.moveTo(qx - 12, qy - 22); ctx.lineTo(qx + 12, qy - 22); ctx.lineTo(qx + 10, qy); ctx.lineTo(qx - 10, qy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7aa848'; ctx.beginPath(); ctx.ellipse(qx, qy - 22, 12, 3.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(200,48,46,0.7)'; ctx.fillRect(qx - 11, qy - 12, 22, 3); // a red band on the cup
    steam(qx, qy - 26);
  } else if (card.type === 'energy') { // ki tonic: a bowl of whisked matcha and its bamboo whisk
    const bx = cx - 10, by = ty + 4;
    ctx.fillStyle = '#3a4a3a'; ctx.beginPath(); ctx.moveTo(bx - 26, by - 20); ctx.quadraticCurveTo(bx - 24, by + 2, bx, by + 2); ctx.quadraticCurveTo(bx + 24, by + 2, bx + 26, by - 20); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(140,170,120,0.35)'; ctx.beginPath(); ctx.ellipse(bx - 10, by - 10, 6, 8, 0.3, 0, TAU); ctx.fill(); // glaze
    ctx.fillStyle = '#8ccf5a'; ctx.beginPath(); ctx.ellipse(bx, by - 20, 26, 6, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(230,255,200,0.55)'; for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.arc(bx - 14 + k * 4.5, by - 20 + Math.sin(k * 2) * 2, 1.4, 0, TAU); ctx.fill(); } // froth
    const wx = cx + 32, wy = ty + 4; // the chasen whisk
    ctx.fillStyle = '#e8d098'; ctx.fillRect(wx - 3, wy - 34, 6, 18); ctx.strokeRect(wx - 3, wy - 34, 6, 18);
    ctx.strokeStyle = '#d8bc78'; ctx.lineWidth = 1; for (let k = -5; k <= 5; k++) { ctx.beginPath(); ctx.moveTo(wx + k * 0.6, wy - 16); ctx.quadraticCurveTo(wx + k * 1.6, wy - 8, wx + k * 1.2, wy); ctx.stroke(); }
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(80,200,220,0.25)'; ctx.beginPath(); ctx.ellipse(bx, by - 22, 30, 10, 0, 0, TAU); ctx.fill(); ctx.restore(); // ki glow
    steam(bx, by - 24);
  } else { // battle rush: a sake flask and a small cup
    const fx = cx - 18, fy = ty + 4;
    ctx.fillStyle = '#f2ece0'; ctx.beginPath(); ctx.moveTo(fx - 5, fy - 46); ctx.lineTo(fx + 5, fy - 46); ctx.quadraticCurveTo(fx + 4, fy - 34, fx + 15, fy - 24); ctx.quadraticCurveTo(fx + 20, fy - 6, fx + 12, fy); ctx.lineTo(fx - 12, fy); ctx.quadraticCurveTo(fx - 20, fy - 6, fx - 15, fy - 24); ctx.quadraticCurveTo(fx - 4, fy - 34, fx - 5, fy - 46); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2a4a8a'; ctx.beginPath(); ctx.moveTo(fx - 16, fy - 18); ctx.lineTo(fx + 16, fy - 18); ctx.lineTo(fx + 16, fy - 12); ctx.lineTo(fx - 16, fy - 12); ctx.closePath(); ctx.fill(); // indigo band
    ctx.fillStyle = '#c8302a'; ctx.beginPath(); ctx.arc(fx, fy - 29, 3.5, 0, TAU); ctx.fill(); // a red mark
    const ox = cx + 24, oy = ty + 4; // the cup, full
    ctx.fillStyle = '#f2ece0'; ctx.beginPath(); ctx.moveTo(ox - 11, oy - 12); ctx.lineTo(ox + 11, oy - 12); ctx.lineTo(ox + 7, oy); ctx.lineTo(ox - 7, oy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff4d8'; ctx.beginPath(); ctx.ellipse(ox, oy - 12, 11, 3, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,140,60,0.25)'; ctx.beginPath(); ctx.arc(ox, oy - 12, 14 + Math.sin(t * 4) * 2, 0, TAU); ctx.fill(); ctx.restore(); // fiery glow
    steam(ox, oy - 14, 2);
  }
}

// talents: an old gold folding screen (byōbu): tarnished gold leaf, sepia clouds, a pine branch and the talent's mon
function sceneTalent(ctx, ax, ay, aw, ah, card, player, t) {
  const cx = ax + aw / 2, cy = ay + ah * 0.46;
  ctx.fillStyle = goldLeaf(ctx); ctx.fillRect(ax, ay, aw, ah);
  ctx.fillStyle = 'rgba(70,46,14,0.42)'; ctx.fillRect(ax, ay, aw, ah); // age the gold to an old, warm brown
  const vg = ctx.createRadialGradient(cx, cy, aw * 0.15, cx, cy, aw * 0.75); vg.addColorStop(0, 'rgba(255,230,160,0.18)'); vg.addColorStop(1, 'rgba(40,24,6,0.45)');
  ctx.fillStyle = vg; ctx.fillRect(ax, ay, aw, ah);
  ctx.strokeStyle = 'rgba(40,24,8,0.35)'; ctx.lineWidth = 1; // the screen's folds
  for (let k = 1; k < 4; k++) { const x = ax + (aw * k) / 4; ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x, ay + ah); ctx.stroke(); }
  kasumi(ctx, ax - 18 + Math.sin(t * 0.3) * 5, ay + ah * 0.16, aw * 0.6, 11, 'rgba(236,212,150,0.55)'); // sepia clouds
  kasumi(ctx, ax + aw * 0.45 - Math.sin(t * 0.3) * 5, ay + ah * 0.74, aw * 0.65, 12, 'rgba(236,212,150,0.5)');
  // a pine branch reaching in from the left
  ctx.strokeStyle = '#2e2014'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ax - 4, ay + ah * 0.62); ctx.quadraticCurveTo(ax + aw * 0.18, ay + ah * 0.5, ax + aw * 0.3, ay + ah * 0.56); ctx.stroke();
  ctx.fillStyle = '#3a4a2a';
  for (const [fx, fy, r] of [[0.08, 0.52, 9], [0.2, 0.47, 10], [0.29, 0.53, 8]]) { ctx.beginPath(); ctx.ellipse(ax + aw * fx, ay + ah * fy, r * 1.4, r * 0.6, -0.2, 0, TAU); ctx.fill(); }
  // the mon: a lacquer-black disc with a tarnished gold ring and the talent's symbol
  const R = ah * 0.28;
  ctx.save(); ctx.shadowColor = 'rgba(30,16,4,0.6)'; ctx.shadowBlur = 8; ctx.fillStyle = '#1e140a'; ctx.beginPath(); ctx.arc(cx + 8, cy, R, 0, TAU); ctx.fill(); ctx.restore();
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx + 8, cy, R - 1.5, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(201,162,74,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx + 8, cy, R - 6, 0, TAU); ctx.stroke();
  ctx.save(); ctx.translate(cx + 8, cy); drawIcon(ctx, `talent_${card.talent}`, (R * 0.6) / 30, '#e2c272', t); ctx.restore();
}

// weapon arts: a dojo wall in crimson and black, the weapon on a rack, a hanging calligraphy of the art's name
function sceneArt(ctx, ax, ay, aw, ah, card, player, t) {
  const w0 = player.weapons[card.slot], A = ARTS[w0.key][card.art];
  const wall = ctx.createLinearGradient(0, ay, 0, ay + ah); wall.addColorStop(0, '#3e0a12'); wall.addColorStop(1, '#16040a');
  ctx.fillStyle = wall; ctx.fillRect(ax, ay, aw, ah);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; for (let x = ax + 14; x < ax + aw; x += 22) { ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x, ay + ah); ctx.stroke(); } // wall boards
  const lamp = ctx.createRadialGradient(ax + aw * 0.35, ay + ah * 0.5, 0, ax + aw * 0.35, ay + ah * 0.5, aw * 0.6); lamp.addColorStop(0, 'rgba(255,170,90,0.28)'); lamp.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = lamp; ctx.fillRect(ax, ay, aw, ah);
  // tatami floor
  ctx.fillStyle = '#5a5228'; ctx.fillRect(ax, ay + ah - 14, aw, 14); ctx.fillStyle = '#1a1208'; ctx.fillRect(ax, ay + ah - 14, aw, 2);
  // the hanging scroll on the right, with the art's name in ink
  const sw = 24, sx = ax + aw - sw - 10, sy = ay + 20, sh = ah - 44;
  ctx.fillStyle = '#c9a24a'; ctx.fillRect(sx - 2, sy - 3, sw + 4, sh + 6);
  ctx.fillStyle = '#f0e4c8'; ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = '#1a1414'; ctx.font = `800 ${A.jp.length > 2 ? 15 : 17}px "Shippori Mincho", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [...A.jp].forEach((ch, i) => ctx.fillText(ch, sx + sw / 2, sy + 14 + i * (A.jp.length > 2 ? 17 : 20)));
  ctx.fillStyle = '#b52a22'; ctx.fillRect(sx + sw / 2 - 4, sy + sh - 12, 8, 8);
  ctx.fillStyle = '#2a1a12'; ctx.fillRect(sx - 4, sy + sh + 2, sw + 8, 4);
  // the weapon resting on a wooden rack
  const rx = ax + aw * 0.44, rack = ay + ah * 0.58; // the middle of the picture, leaving the scroll room
  ctx.fillStyle = '#2a1608'; for (const dx of [-30, 30]) { ctx.fillRect(rx + dx - 3, rack - 6, 6, ah - 14 - (rack - ay) + 6); ctx.fillRect(rx + dx - 7, rack - 8, 14, 5); }
  { const k = ah / 128, m = artMid(w0.key); ctx.save(); ctx.translate(rx - m.x * k, ay + ah * 0.47 - m.y * k); drawWeaponArt(ctx, w0.key, k, null); ctx.restore(); }
  // the sacred rope across the top (the slot's kanji is stamped as the card's hanko)
  ctx.strokeStyle = '#c8a868'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ax - 2, ay + 6); ctx.quadraticCurveTo(ax + aw / 2, ay + 18, ax + aw + 2, ay + 6); ctx.stroke();
  for (const f of [0.3, 0.7]) { const px = ax + aw * f, py = ay + 6 + Math.sin(f * Math.PI) * 12; ctx.strokeStyle = '#f4efe4'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 4, py + 4); ctx.lineTo(px - 2, py + 8); ctx.lineTo(px + 4, py + 12); ctx.stroke(); }
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
    this.mode = opts.mode || 'blessing'; this.incoming = opts.incoming || null;
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
      if (this.pickT > (sac ? 1.0 : 0.75)) {
        this.active = false; this.burned = false;
        const card = this.cards[this.picked], pl = this.player;
        if (card.type === 'talent' && card.kind === 'new' && !card.replace && pl.talents.length >= MAX_TALENTS) { // all slots taken: choose the one to give up
          const cb = this.onPick;
          const owned = pl.talents.map((t) => ({ type: 'talent', talent: t.key, kind: 'forget', key: `forget_${t.key}`, rarity: t.rarity || 0, value: 0 }));
          this.open(owned, (f) => cb({ ...card, replace: f.talent }), pl, { mode: 'forget', incoming: card });
          return;
        }
        this.onPick(card);
      }
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
    const has = (f) => this.cards && this.cards.some(f);
    const what = this.mode === 'forget' ? 'Choose a talent to replace' : sac ? 'Choose a Sacrifice' : has((c) => c.type === 'art') ? 'Choose a Technique' : has((c) => c.type === 'talent') ? 'Choose a Talent' : has((c) => c.type === 'element') ? 'Choose an Imbuement' : this.cards && this.cards.every((c) => ITEM_CARDS[c.type]) ? 'Choose a Consumable' : 'Choose a Training';
    if (sac) ctx.fillStyle = coop ? PLAYER_COLORS[player.index] : '#ff6a5a';
    { // the sacrifice title trembles slightly
      const jx = sac ? Math.sin(t * 37) * 1.2 * this.k * (this.beat < 0.25 ? 2 : 0.5) : 0;
      ctx.fillText(coop ? `Player ${player.index + 1} — ${what}` : what, v.W / 2 + jx, this.cy - this.ch / 2 - 92 * this.k);
    }
    ctx.font = `700 ${Math.round(17 * this.k)}px "Zen Kaku Gothic New", sans-serif`;
    ctx.fillStyle = 'rgba(244,234,214,0.7)';
    const how = this.ctl.mode === 'pad' ? '◀ ▶ to browse, Ⓐ to choose' : 'click a card, or ← → and Enter';
    ctx.fillText(sac ? `The wandering monk offers a bargain. You must accept one.  ·  ${how}` : `${this.mode === 'forget' ? `Make room for ${TALENTS[this.incoming.talent].name}` : this.g.restStop ? 'A quiet rest at the tea house' : `Level ${this.g.level} cleared`}  ·  ${how}`, v.W / 2, this.cy - this.ch / 2 - 52 * this.k);
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

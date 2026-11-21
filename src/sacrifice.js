// The wandering monk (after levels 5 / 15 / 25) and his Sacrifices: a real cost for a real gain.
import { TAU, clamp, lerp, rand, ease, isoX, isoY, worldDirToScreenAngle } from './util.js';
import { drawHumanoid, drawShadow } from './rig.js';
import { sfx } from './audio.js';
import { drawStatIcon } from './staticons.js';
import { drawRichText } from './cards.js';

export const MONK_LEVELS = [5, 15, 25];

// Each sacrifice has a cost (pay) and a gain (get), kept apart so the Satanist's Set can skip the cost of
// its first one. Weapon sacrifices name their weapon and are only offered to it.
// pay(p) / get(p) run on the authoritative game (host / local). Pacts only take effect if both players choose them.
const weaponIs = (k) => (p) => !!(p.weapons[0] && p.weapons[0].key === k);
export const SACRIFICES = {
  bareBlade: {
    title: 'Oath of the Bare Blade', jp: '素刃', cost: 'Lose all your talents', gain: '+8% {damage} per talent card', gs: ['baseDamage'],
    needs: (p) => p.talents.length >= 1, // (only offered with at least one talent to give up)
    cards: (p) => Math.max(p.talents.length, (p.picked || []).filter((c) => c.type === 'talent' && !c.traded).length), // talent cards picked (new ones and upgrades)
    gainFor(p) { return `+${8 * this.cards(p)}% {damage} (8% per talent card)`; },
    pay(p) { p.talents = []; }, get(p) { p.stats.baseDamage += 0.08 * this.cards(p); },
  },
  smallCuts: {
    title: 'Thousand Small Cuts', jp: '千傷', cost: '−20% {damage}', gain: '−40% {atkcd}', cs: ['baseDamage'], gs: ['cooldownMul'],
    pay(p) { p.stats.baseDamage *= 0.8; }, get(p) { p.stats.cooldownMul *= 0.6; },
  },
  // 20 max health for +20% crit chance (no use when crits are off or always on); past 100% it becomes crit damage
  glassEdge: {
    title: 'Glass Edge', jp: '玻刃', cost: '−20 max {health}', gain: '+20% {crit}', gs: ['critChance'],
    excl: ['covenant', 'executioner'], needs: (p) => !p.noCrit && !p.alwaysCrit,
    gainFor(p) { const c = p.stats.critChance + 0.2; return c <= 1 + 1e-9 ? this.gain : c - 1 >= 0.2 - 1e-9 ? '+20% {critdmg} (crit chance is full)' : `+${Math.round((0.2 - (c - 1)) * 100)}% {crit} +${Math.round((c - 1) * 100)}% {critdmg}`; },
    pay(p) { p.maxHpAdd = (p.maxHpAdd || 0) - 20; p.hp = Math.min(p.hp, p.maxHp); },
    get(p) { const c = p.stats.critChance + 0.2; p.stats.critChance = Math.min(1, c); p.stats.critDamage += Math.max(0, c - 1); },
  },
  // every imbuement is burnt off the weapon; each imbuement card picked becomes +6% attack damage
  quench: {
    title: 'Quenched Steel', jp: '淬', cost: 'Lose all your imbuements', gain: '+6% {damage} per imbuement card', gs: ['baseDamage'],
    cards: (p) => (p.picked || []).filter((c) => c.type === 'element' && !c.traded).length || 1,
    gainFor(p) { return `+${6 * this.cards(p)}% {damage} (6% per imbuement card)`; },
    needs: (p) => p.weapons.some((w) => Object.values(w.elements).some((v) => v > 0)),
    get(p) { p.stats.baseDamage += 0.06 * this.cards(p); },
    pay(p) { for (const w of p.weapons) for (const k in w.elements) w.elements[k] = 0; for (const c of p.picked || []) if (c.type === 'element') c.traded = true; },
  },
  // give up one card, then choose two new ones of its kind, each one rarity lower (game.js runs the choices)
  splinter: {
    title: 'Splintered Gift', jp: '分', cost: 'Give up one card of your choice', gain: 'Gain 2 of its kind, 1 rarity lower', split: true,
    needs: (p) => (p.picked || []).some((c) => !c.traded && (c.type === 'stat' || c.type === 'element')) || p.talents.length > 0,
    pay(p) { p.swapKeep = false; }, get(p) { p.swapKeep = true; }, // (free: the card you choose is kept, see Game.splinter)
  },
  // slower on your feet, but a second dash ready
  shadowStep: {
    title: 'Shadow Step', jp: '影歩', cost: '−20% {move}', gain: '+1 dash charge', cs: ['moveSpeed'], gs: ['dashCd'],
    pay(p) { p.stats.moveSpeed *= 0.8; }, get(p) { p.stats.extraDash = (p.stats.extraDash || 0) + 1; p.dashCharges = (p.dashCharges ?? 1) + 1; },
  },
  covenant: {
    title: 'Imbued Covenant', jp: '元素', cost: 'No more critical hits', gain: 'Imbuements 2× as strong', cs: ['critChance'],
    excl: ['executioner'], pay(p) { p.noCrit = true; }, get(p) { p.elemMul = (p.elemMul || 1) * 2; },
  },
  executioner: {
    title: 'Patient Executioner', jp: '処刑', cost: '+50% {atkcd}', gain: 'Every hit is a critical hit', cs: ['cooldownMul'], gs: ['critChance'],
    excl: ['covenant'], pay(p) { p.stats.cooldownMul *= 1.5; }, get(p) { p.alwaysCrit = true; },
  },
  bloodOffering: {
    title: 'Blood Offering', jp: '血供', cost: 'Lose 35 {health} now', gain: '+10% legendary chance',
    pay(p) { p.hp = Math.max(1, p.hp - 35); }, get(p) { p.bloodOffering = true; },
  },
  boundSouls: {
    title: 'Bound Souls', jp: '縁', coop: true, pact: true, cost: 'Both take +15% damage', gain: 'Share all damage taken',
    pay(p) { p.takenMul = (p.takenMul || 1) * 1.15; }, get(p) { p.bound = true; },
  },
  // Quick Swap: give up one card you hold, then choose a new card of the same kind (game.js runs the two choices)
  quickSwap: {
    title: 'Quick Swap', jp: '換', cost: 'Give up one of your cards', gain: 'Choose a new one of its kind', swap: true,
    needs: (p) => (p.picked || []).some((c) => !c.traded && (c.type === 'stat' || c.type === 'element')) || p.talents.length > 0 || p.weapons.some((w) => w.arts && Object.keys(w.arts).length),
    pay(p) { p.swapKeep = false; }, get(p) { p.swapKeep = true; },
  },
  lifebinder: {
    title: 'Lifebinder', jp: '献身', coop: true, cost: 'Syphon stops healing you', gain: 'Syphon heals your partner ×1.5',
    needs: (p) => p.weapons.some((w) => w.elements.syphon > 0),
    pay(p) { p.lifebinderSelf = false; }, get(p) { p.lifebinder = true; p.lifebinderSelf = true; },
  },

  // ---------------------------------------------------------------- weapon sacrifices (2026-11-21, the user's designs)
  tipOath: {
    title: 'Oath of the Blade Tip', jp: '切先', weapon: 'katanas', cost: '+20% {atkcd}', gain: '+50% {damage} at blade-tip', cs: ['cooldownMul'], gs: ['baseDamage'],
    needs: weaponIs('katanas'), pay(p) { p.stats.cooldownMul *= 1.2; }, get(p) { p.tipMul = (p.tipMul || 1) * 1.5; },
  },
  stormDiscipline: {
    title: 'Storm Discipline', jp: '嵐律', weapon: 'katanas', cost: 'Attacks cost +25% {energy}', gain: '+40% {damage} when hitting 4+ enemies', cs: ['kiCost'], gs: ['baseDamage'],
    needs: weaponIs('katanas'), pay(p) { p.stats.kiCost *= 1.25; }, get(p) { p.stormDisc = 1.4; },
  },
  lightLoad: {
    title: 'Lightened Load', jp: '軽装', weapon: 'knives', cost: 'Max. {s:5} 4 blades stuck in enemies', gain: '+1 dash charge', gs: ['dashCd'],
    needs: weaponIs('knives'), pay(p) { p.maxStick = 4; }, get(p) { p.stats.extraDash = (p.stats.extraDash || 0) + 1; p.dashCharges = (p.dashCharges ?? 1) + 1; },
  },
  endlessStorm: {
    title: 'Endless Storm', jp: '無尽嵐', weapon: 'knives', cost: '{B} costs +10% {energy}', gain: 'Every enemy its blades hit gives back 3 energy', cs: ['kiCost'], gs: ['energyRegen'],
    needs: weaponIs('knives'), pay(p) { p.stormCostMul = 1.1; }, get(p) { p.stormRefund = 3; },
  },
  fragileFlow: {
    title: 'Fragile Flow', jp: '脆流', weapon: 'bo', cost: 'Taking damage resets your combo', gain: 'Your combo goes up to 7',
    needs: weaponIs('bo'), pay(p) { p.fragileFlow = true; }, get(p) { p.boMax = 7; },
  },
  heavyPole: {
    title: 'Heavy Pole', jp: '重棍', weapon: 'bo', cost: '+20% {atkcd} on {X} below max combo', gain: '−20% {atkcd} and shockwave at max combo',
    needs: weaponIs('bo'), pay(p) { p.heavyPoleSlow = 1.2; }, get(p) { p.heavyPoleMax = true; },
  },
  lonelySoul: {
    title: 'Lonely Soul', jp: '孤魂', weapon: 'orb', cost: 'At most 1 spirit', gain: 'Every spirit rises as a heavy enemy',
    needs: weaponIs('orb'), pay(p) { p.spiritMax = 1; }, get(p) { p.lonelySoul = true; },
  },
  soulTax: {
    title: 'Soul Tax', jp: '魂税', weapon: 'orb', cost: 'Spirits drain 1 {energy} per s', gain: 'Spirits get +20% {health} and {damage}', cs: ['energyRegen'],
    needs: weaponIs('orb'), pay(p) { p.soulTax = 1; }, get(p) { p.spiritBuff = 1.2; },
  },
  bareKnuckles: {
    title: 'Bare Knuckles', jp: '素拳', weapon: 'gloves', cost: 'Imbuements are half as strong', gain: '3rd basic deals +100% {damage}', gs: ['baseDamage'],
    needs: weaponIs('gloves'), pay(p) { p.elemMul = (p.elemMul || 1) * 0.5; }, get(p) { p.thirdPunch = true; },
  },
  stoneLaunch: {
    title: 'Stone Launch', jp: '岩跳', weapon: 'gloves', cost: 'Take 4 damage per dash', gain: '+40% dash distance', gs: ['dashCd'],
    needs: weaponIs('gloves'), pay(p) { p.dashHurt = 4; }, get(p) { p.dashDistMul = 1.4; },
  },
};
for (const S of Object.values(SACRIFICES)) S.apply = function (p) { this.get(p); this.pay(p); }; // (the gain first: Quenched Steel counts the cards it burns)

// Satanist's Set: the first sacrifice of the run costs nothing
export const sacFree = (p) => !!p && p.equip === 'satanist' && !p.satanUsed;

// rarity weights for upgrade cards [common, rare, epic, legendary], changed by sacrifices
export function rarityWeights(p, base) {
  const w = base.slice();
  if (p && p.bloodOffering) { w[3] += 10; w[0] -= 10; }
  return w;
}

// two different, valid sacrifices for this player
// pact: true = this hand must hold Bound Souls, false = it must not (the pact is decided for both players
// together, see rollSacrificeHands); null = no say (solo)
function sacPool(p, coop) {
  const taken = new Set(p.sac);
  return Object.keys(SACRIFICES).filter((k) => {
    const S = SACRIFICES[k];
    if (taken.has(k)) return false;
    if (S.coop && !coop) return false;
    if (S.excl && S.excl.some((x) => taken.has(x))) return false;
    if (S.needs && !S.needs(p)) return false;
    return true;
  });
}
export function rollSacrifices(p, coop, pact = null) {
  const pool = sacPool(p, coop).filter((k) => !SACRIFICES[k].pact || pact !== false);
  const out = [];
  if (pact) { const i = pool.findIndex((k) => SACRIFICES[k].pact); if (i >= 0) out.push(pool.splice(i, 1)[0]); }
  while (out.length < 2 && pool.length) {
    const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (out.some((o) => (SACRIFICES[o].excl || []).includes(k))) continue;
    out.push(k);
  }
  if (pact && out.length === 2 && Math.random() < 0.5) out.reverse(); // the pact card isn't always on the left
  // (free: the Satanist's first; gain: what it really gives this player, when that depends on them)
  return out.map((k) => ({ type: 'sacrifice', key: k, rarity: 0, free: sacFree(p) || undefined, gainText: SACRIFICES[k].gainFor ? SACRIFICES[k].gainFor(p) : undefined }));
}

// Co-op: both players' offers at once. Bound Souls (a pact that needs both of you) is offered to both players
// or to neither, about as often as any single sacrifice turns up in a hand.
export function rollSacrificeHands(players) {
  const coop = players.length > 1;
  if (!coop) return [rollSacrifices(players[0], false)];
  const canPact = players.every((p) => sacPool(p, true).some((k) => SACRIFICES[k].pact));
  const n = sacPool(players[0], true).length;
  const pact = canPact && Math.random() < Math.min(1, 2 / Math.max(1, n));
  return players.map((p) => rollSacrifices(p, true, pact));
}

// record the choice; returns true if it is a pact that waits for the partner
export function takeSacrifice(p, key) {
  const S = SACRIFICES[key];
  if (!S) return false;
  const free = sacFree(p); if (free) p.satanUsed = true;
  p.sac.push(key);
  (p.picked || (p.picked = [])).push({ type: 'sacrifice', key, rarity: 0, free: free || undefined }); // for the pause menu's list of this run's cards
  if (S.pact) { p.pactFree = free; return true; }
  applySacrifice(p, key, free);
  return false;
}
// the sacrifice's effect: its gain, and its cost unless it is free (Satanist's Set)
export function applySacrifice(p, key, free = false) {
  const S = SACRIFICES[key];
  S.get(p); if (!free) S.pay(p);
}

// ---------------------------------------------------------------- the monk
export const MONK_LOOK = [
  { // spring: komuso with basket hat and shakuhachi
    pal: { skin: '#e2b48c', cloth: '#3a3a48', cloth2: '#26262e', sash: '#c8a050', metal: '#ddd', wood: '#c8a868' },
    head: 'komuso', robe: true, weapon: 'flute', grip: 'down',
  },
  { // autumn: old mountain hermit with a gourd staff
    pal: { skin: '#e8c8a0', cloth: '#b8a888', cloth2: '#6a5a40', sash: '#8a3a2a', wood: '#7a5a30' },
    head: 'hermit', robe: true, weapon: 'gourdstaff', grip: 'pole', fat: 0.9,
  },
  { // snow: ghostly pale monk with a paper lantern
    pal: { skin: '#dce8f4', cloth: '#e8eef8', cloth2: '#9aaac0', sash: '#5a6a8a', wood: '#3a3440' },
    head: 'ghostmonk', robe: true, weapon: 'lantern', grip: 'down', alphaMul: 0.82,
  },
];

export class Monk {
  // door: { x, y, ox, oy, house } from World.doors()
  constructor(g, door) {
    this.g = g; this.bi = g.world.bi; this.r = 0.35;
    this.x = door ? door.x : g.world.N / 2; this.y = door ? door.y : g.world.N / 2;
    this.out = door ? [door.ox, door.oy] : [this.x, this.y];
    this.state = 'emerge'; this.t = 0; this.walk = 0; this.moveAmt = 0; this.alpha = 0;
    this.faceX = 1; this.faceY = 1; this.bow = 0;
    if (door) door.house.doorT = 2.2;
  }
  get done() { return this.state === 'gone'; }
  leave() { if (this.state === 'leave' || this.state === 'gone') return; this.state = 'leave'; this.t = 0; this.bow = 0; }
  update(dt) {
    const g = this.g;
    this.t += dt;
    if (this.state === 'emerge') { // step out of the doorway
      const k = clamp(this.t / 1.1, 0, 1);
      this.x = lerp(this.x, this.out[0], 1 - Math.exp(-5 * dt)); this.y = lerp(this.y, this.out[1], 1 - Math.exp(-5 * dt));
      this.alpha = k; this.moveAmt = 0.6; this.walk += dt * 6;
      this.face(this.out[0] - this.x, this.out[1] - this.y);
      if (Math.random() < dt * 10) g.particles.emit('smoke', this.x + rand(-0.4, 0.4), this.y + rand(-0.4, 0.4), 0.2, 0, 0, 0.3, 1.2, 6, 'rgba(230,230,240,1)');
      if (k >= 1) { this.state = 'approach'; this.t = 0; }
    } else if (this.state === 'approach') { // walk toward the nearest player and stop at a respectful distance
      const p = this.nearest();
      const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;
      this.face(dx, dy);
      if (d > 2.3 && this.t < (this.maxWalk || 5)) {
        this.x += (dx / d) * 2.8 * dt; this.y += (dy / d) * 2.8 * dt; g.world.collide(this);
        this.moveAmt = lerp(this.moveAmt, 0.7, 0.2); this.walk += dt * 7;
      } else { this.state = 'wait'; this.t = 0; if (this.onArrive) { this.onArrive(); this.onArrive = null; } }
    } else if (this.state === 'wait') {
      this.moveAmt = lerp(this.moveAmt, 0, 0.2);
      const p = this.nearest(); this.face(p.x - this.x, p.y - this.y);
    } else if (this.state === 'leave') { // bow, then vanish in smoke
      this.bow = clamp(this.t / 0.5, 0, 1) * (this.t < 1.2 ? 1 : 0);
      if (this.t > 1.0 && !this.puffed) {
        this.puffed = true; sfx.dash();
        g.particles.burst('smoke', this.x, this.y, 0.6, 18, 2, 1.2, 9, 'rgba(235,235,245,1)');
        g.particles.burst('glow', this.x, this.y, 0.8, 14, 2, 1, 2.2, '#fff4d0');
      }
      this.alpha = this.t < 1.0 ? 1 : clamp(1 - (this.t - 1.0) / 0.3, 0, 1);
      if (this.t > 1.5) this.state = 'gone';
    }
    if (this.state !== 'leave' && Math.random() < dt * 3) g.particles.emit('glow', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.2, 1.4), 0, 0, 0.3, 1, 1.8, this.bi === 2 ? '#bfe4ff' : '#fff0c0');
  }
  nearest() {
    let best = this.g.players[0], bd = 1e9;
    for (const p of this.g.players) { if (p.dead) continue; const d = (p.x - this.x) ** 2 + (p.y - this.y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  face(dx, dy) { const l = Math.hypot(dx, dy); if (l > 0.01) { this.faceX = dx / l; this.faceY = dy / l; } }
  drawShadow(ctx) { if (this.alpha > 0.05) drawShadow(ctx, isoX(this.x, this.y), isoY(this.x, this.y), 13, 0.25 * this.alpha); }
  draw(ctx, t) {
    if (this.state === 'gone' || this.alpha <= 0.01) return;
    const L = MONK_LOOK[this.bi] || MONK_LOOK[0];
    const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y);
    // soft halo so he reads as someone special
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * this.alpha;
    const hg = ctx.createRadialGradient(sx, sy - 30, 0, sx, sy - 30, 46);
    hg.addColorStop(0, this.bi === 2 ? 'rgba(170,210,255,0.6)' : 'rgba(255,230,160,0.6)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(sx, sy - 30, 46, 0, TAU); ctx.fill(); ctx.restore();
    drawHumanoid(ctx, {
      ...L, x: sx, y: sy, z: 0, facing: worldDirToScreenAngle(this.faceX, this.faceY), time: t, walk: this.walk, move: this.moveAmt,
      alpha: this.alpha * (L.alphaMul || 1), s: 1.05, lean: this.bow * 0.45 + 0.06, flash: 0,
    });
  }
}

// ---------------------------------------------------------------- sacrifice card art
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function wrapText(ctx, str, maxW) {
  const words = str.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const test = cur ? `${cur} ${w}` : w; if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur);
  return lines;
}

// one bold symbol per sacrifice, drawn in a ±30 box (shown inside the blood moon)
function drawSacGlyph(ctx, key, col) {
  ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (key) {
    case 'stormDiscipline': // a whirl of three blades around a calm centre
      for (let k = 0; k < 3; k++) { ctx.save(); ctx.rotate((k * TAU) / 3); ctx.beginPath(); ctx.moveTo(4, -6); ctx.quadraticCurveTo(26, -20, 28, 4); ctx.quadraticCurveTo(18, -6, 4, 2); ctx.closePath(); ctx.fill(); ctx.restore(); }
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill(); break;
    case 'lightLoad': // a feather over four short blades
      for (let k = 0; k < 4; k++) ctx.fillRect(-16 + k * 9, 10, 4, 18);
      ctx.beginPath(); ctx.moveTo(-22, 4); ctx.quadraticCurveTo(-2, -32, 24, -26); ctx.quadraticCurveTo(6, -10, -22, 4); ctx.fill(); break;
    case 'endlessStorm': // a ring of blades with an arrow running round it
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(14, -2.5); ctx.lineTo(28, 0); ctx.lineTo(14, 2.5); ctx.closePath(); ctx.fill(); ctx.restore(); }
      ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(0, 0, 9, 0.3, TAU - 0.5); ctx.stroke(); break;
    case 'fragileFlow': // seven beads on a string, the last one cracked
      for (let k = 0; k < 7; k++) { const a = Math.PI * (0.15 + (k / 6) * 0.7), x = Math.cos(a) * -24, y = Math.sin(a) * 20 - 6; ctx.beginPath(); ctx.arc(x, y, k === 6 ? 5.5 : 4.5, 0, TAU); ctx.fill(); }
      ctx.lineWidth = 2; ctx.strokeStyle = '#7a0a14'; ctx.beginPath(); ctx.moveTo(17, -4); ctx.lineTo(22, 2); ctx.lineTo(19, 6); ctx.stroke(); break;
    case 'heavyPole': // a thick staff over a shockwave ring
      ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(0, 16, 26, 8, 0, 0, TAU); ctx.stroke();
      ctx.save(); ctx.rotate(0.5); ctx.fillRect(-4, -32, 8, 46); ctx.restore(); break;
    case 'lonelySoul': // one large wisp
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.bezierCurveTo(22, -10, 20, 22, 0, 24); ctx.bezierCurveTo(-20, 22, -22, -4, -6, -14); ctx.bezierCurveTo(-2, -18, 2, -24, 0, -30); ctx.fill(); break;
    case 'soulTax': // two wisps with a coin between them
      for (const x of [-15, 15]) { ctx.beginPath(); ctx.moveTo(x, -22); ctx.bezierCurveTo(x + 12, -8, x + 10, 14, x, 16); ctx.bezierCurveTo(x - 10, 14, x - 12, -8, x, -22); ctx.fill(); }
      ctx.lineWidth = 3; ctx.strokeStyle = '#7a0a14'; ctx.beginPath(); ctx.arc(0, 4, 7, 0, TAU); ctx.stroke(); ctx.strokeRect(-2.5, 1.5, 5, 5); break;
    case 'bareKnuckles': // a fist with three strike marks, the third one big
      ctx.beginPath(); ctx.roundRect(-16, -8, 26, 22, 6); ctx.fill(); ctx.fillRect(-16, 10, 18, 12);
      ctx.lineWidth = 3; for (const [y, l] of [[-18, 6], [-8, 6], [4, 14]]) { ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(14 + l, y); ctx.stroke(); } break;
    case 'stoneLaunch': // a rock bursting up under an arc
      ctx.beginPath(); ctx.moveTo(-14, 26); ctx.lineTo(-8, 8); ctx.lineTo(4, 4); ctx.lineTo(14, 12); ctx.lineTo(16, 26); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 3.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(-24, 0); ctx.quadraticCurveTo(0, -40, 26, -6); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(26, -6); ctx.lineTo(18, -10); ctx.lineTo(24, -16); ctx.closePath(); ctx.fill(); break;
    case 'tipOath': // a long katana slanting down, its tip flashing with a star of light
      ctx.save(); ctx.rotate(0.7);
      ctx.beginPath(); ctx.moveTo(-3, -34); ctx.quadraticCurveTo(4, -6, 3, 22); ctx.lineTo(-2, 22); ctx.quadraticCurveTo(-1, -6, -3, -34); ctx.closePath(); ctx.fill();
      ctx.fillRect(-8, 22, 16, 4); ctx.fillRect(-2.5, 26, 5, 10);
      ctx.restore();
      { const tx = Math.sin(0.7) * 34, ty = -Math.cos(0.7) * 34; ctx.beginPath(); for (let i = 0; i < 8; i++) { const an = (i / 8) * TAU, r = i % 2 ? 2.5 : 11; ctx.lineTo(tx + Math.cos(an) * r, ty + Math.sin(an) * r); } ctx.closePath(); ctx.fill(); }
      break;
    case 'bareBlade': // a lone upright blade
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(5, -22); ctx.lineTo(5, 10); ctx.lineTo(-5, 10); ctx.lineTo(-5, -22); ctx.closePath(); ctx.fill();
      ctx.fillRect(-13, 11, 26, 5); ctx.fillRect(-3.5, 16, 7, 13); break;
    case 'glassEdge': // a cracked blade with a falling drop of blood
      ctx.beginPath(); ctx.moveTo(-4, -30); ctx.lineTo(6, -22); ctx.lineTo(6, 14); ctx.lineTo(-6, 14); ctx.lineTo(-6, -22); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#7a0a14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(1, -4); ctx.lineTo(-3, 2); ctx.lineTo(6, 6); ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(-13, 15, 26, 5);
      ctx.beginPath(); ctx.moveTo(18, 6); ctx.bezierCurveTo(26, 16, 24, 24, 18, 26); ctx.bezierCurveTo(12, 24, 10, 16, 18, 6); ctx.fill(); break;
    case 'quench': // a blade plunged into water, steam rising
      ctx.fillRect(-3, -28, 6, 34);
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-26, 12); ctx.quadraticCurveTo(-13, 6, 0, 12); ctx.quadraticCurveTo(13, 18, 26, 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-26, 22); ctx.quadraticCurveTo(-13, 16, 0, 22); ctx.quadraticCurveTo(13, 28, 26, 22); ctx.stroke();
      ctx.lineWidth = 3; for (const x of [-14, 14]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x - 6, -10, x, -18); ctx.quadraticCurveTo(x + 6, -24, x, -30); ctx.stroke(); }
      break;
    case 'splinter': // one card breaking into two smaller ones
      ctx.lineWidth = 3; rrect(ctx, -10, -28, 20, 26, 3); ctx.stroke();
      ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-4, -28); ctx.lineTo(2, -18); ctx.lineTo(-3, -10); ctx.lineTo(3, -2); ctx.stroke();
      ctx.save(); ctx.translate(-14, 16); ctx.rotate(-0.3); rrect(ctx, -8, -10, 16, 20, 3); ctx.fill(); ctx.restore();
      ctx.save(); ctx.translate(14, 16); ctx.rotate(0.3); rrect(ctx, -8, -10, 16, 20, 3); ctx.fill(); ctx.restore(); break;
    case 'shadowStep': // two footprints with a shadow streak between them
      for (const [x, y, a] of [[-14, 14, -0.3], [12, -12, -0.3]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, 6, 10, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, -14, 4.5, 4.5, 0, 0, TAU); ctx.fill(); ctx.restore(); }
      ctx.lineWidth = 3; for (const o of [-6, 0, 6]) { ctx.beginPath(); ctx.moveTo(-22 + o, 2 + o); ctx.lineTo(4 + o, -20 + o); ctx.stroke(); }
      break;
    case 'smallCuts': // many small slashes
      ctx.lineWidth = 4.5;
      for (const [x, y] of [[-14, -14], [8, -18], [-18, 8], [4, 2], [16, 16], [-6, 22]]) { ctx.beginPath(); ctx.moveTo(x - 7, y + 6); ctx.lineTo(x + 7, y - 6); ctx.stroke(); }
      break;
    case 'covenant': // four element orbs
      for (const [x, y, c] of [[0, -17, '#ffe46a'], [17, 0, '#9ee4ff'], [0, 17, '#8fe05a'], [-17, 0, '#ff6b8a']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill(); break;
    case 'executioner': // an executioner's axe
      ctx.save(); ctx.rotate(-0.5);
      ctx.fillRect(-3, -26, 6, 56); // haft
      ctx.beginPath(); ctx.moveTo(2, -24); ctx.quadraticCurveTo(30, -26, 28, -6); ctx.quadraticCurveTo(26, 4, 30, 12); ctx.quadraticCurveTo(14, 4, 2, 2); ctx.closePath(); ctx.fill(); // blade
      ctx.restore(); break;
    case 'bloodOffering': // a drop of blood
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.bezierCurveTo(18, -6, 22, 8, 0, 26); ctx.bezierCurveTo(-22, 8, -18, -6, 0, -30); ctx.fill(); break;
    case 'boundSouls': // two linked rings
      ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(-9, 0, 15, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(9, 0, 15, 0, TAU); ctx.stroke(); break;
    case 'quickSwap': // two arrows chasing each other around a card
      ctx.save(); ctx.rotate(-0.15); ctx.lineWidth = 2.5; rrect(ctx, -9, -13, 18, 26, 3); ctx.stroke(); ctx.restore();
      ctx.lineWidth = 4.5;
      for (const s of [1, -1]) {
        ctx.save(); ctx.scale(s, s);
        ctx.beginPath(); ctx.arc(0, 0, 24, -2.6, -0.5); ctx.stroke();
        const ax = Math.cos(-0.5) * 24, ay = Math.sin(-0.5) * 24;
        ctx.beginPath(); ctx.moveTo(ax + 7, ay + 3); ctx.lineTo(ax - 1, ay - 8); ctx.lineTo(ax - 6, ay + 6); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      break;
    case 'lifebinder': // a heart passed on
      ctx.beginPath(); ctx.moveTo(-4, 20); ctx.bezierCurveTo(-30, 2, -18, -22, -4, -8); ctx.bezierCurveTo(10, -22, 22, 2, -4, 20); ctx.fill();
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(12, 6); ctx.lineTo(28, 6); ctx.moveTo(22, 0); ctx.lineTo(28, 6); ctx.lineTo(22, 12); ctx.stroke(); break;
  }
  ctx.restore();
}

// round badge for a cost / gain row: the stat icon when there is one, otherwise a ▼ / ▲ disc
function rowBadge(ctx, x, y, size, stat, down) {
  if (stat) { drawStatIcon(ctx, stat, x, y, size); return; }
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(16,8,10,0.95)'; ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, TAU); ctx.fill();
  ctx.strokeStyle = down ? '#ff5a5a' : '#ffcf5a'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = down ? '#ff6a6a' : '#ffcf5a'; const k = size * 0.22;
  ctx.beginPath(); if (down) { ctx.moveTo(-k, -k * 0.6); ctx.lineTo(k, -k * 0.6); ctx.lineTo(0, k); } else { ctx.moveTo(-k, k * 0.6); ctx.lineTo(k, k * 0.6); ctx.lineTo(0, -k); } ctx.closePath(); ctx.fill();
  ctx.restore();
}

// drawn in base coordinates: 230 wide, h tall, centred on the origin
export function drawSacrificeCard(ctx, card, w, h, t, st, player = null) {
  const S = SACRIFICES[card.key];
  const x0 = -w / 2, y0 = -h / 2, sel = st.hover;
  // crimson aura (stronger, with a heartbeat, on the selected card)
  const beat = sel ? Math.pow(Math.max(0, Math.sin(t * 5.2)), 6) : 0;
  ctx.save();
  ctx.shadowColor = 'rgba(210,20,30,0.95)'; ctx.shadowBlur = (22 + 8 * Math.sin(t * 2.4) + beat * 26) * (sel ? 1.35 : 1);
  rrect(ctx, x0, y0, w, h, 4); ctx.fillStyle = '#0c0608'; ctx.fill();
  ctx.restore();

  // ---- mount: black lacquer with a crimson sheen, a gold inner line, gold corner fittings
  rrect(ctx, x0, y0, w, h, 4);
  const fg = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
  fg.addColorStop(0, '#1a0806'); fg.addColorStop(0.5, '#3a0c0e'); fg.addColorStop(1, '#180806');
  ctx.fillStyle = fg; ctx.fill();
  ctx.save(); rrect(ctx, x0, y0, w, h, 4); ctx.clip(); // the lacquer worn thin at the edges
  ctx.strokeStyle = 'rgba(130,80,45,0.28)'; ctx.lineWidth = 1;
  for (let k = 0; k < 14; k++) { const yy = y0 + ((k * 67.3) % h), xx = k % 2 ? x0 + 2 + (k % 5) : x0 + w - 2 - (k % 5); ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + 10 + (k % 4) * 5); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.6; // fine crackle in the old lacquer
  for (let k = 0; k < 22; k++) {
    const side = k % 4, u0 = ((k * 37.7) % 1000) / 1000;
    let cx = side === 0 ? x0 + 4 : side === 1 ? x0 + w - 4 : x0 + u0 * w, cy = side < 2 ? y0 + u0 * h : side === 2 ? y0 + 4 : y0 + h - 4;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    for (let q = 0; q < 3; q++) { cx += Math.sin(k * 3.1 + q * 1.7) * 3; cy += Math.cos(k * 2.3 + q * 2.1) * 3; ctx.lineTo(cx, cy); }
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; rrect(ctx, x0, y0, w, h, 4); ctx.stroke();
  const fw = 9, ix = x0 + fw, iy = y0 + fw, iw = w - fw * 2, ih = h - fw * 2;
  // the paper: dark, aged, with faint fibres
  rrect(ctx, ix, iy, iw, ih, 3);
  const bg = ctx.createLinearGradient(0, iy, 0, iy + ih);
  bg.addColorStop(0, '#2a1214'); bg.addColorStop(1, '#140809');
  ctx.fillStyle = bg; ctx.fill();
  ctx.save(); rrect(ctx, ix, iy, iw, ih, 3); ctx.clip();
  ctx.strokeStyle = 'rgba(255,200,160,0.045)'; ctx.lineWidth = 1;
  for (let k = 0; k < 26; k++) { const yy = iy + ((k * 53.1) % ih), xx = ix + ((k * 31.7) % iw); ctx.beginPath(); ctx.moveTo(xx, yy); ctx.quadraticCurveTo(xx + 10, yy + 2, xx + 22, yy - 1); ctx.stroke(); }
  for (let k = 0; k < 5; k++) { // faint old stains
    const sx = ix + ((k * 71.9 + card.key.length * 13) % iw), sy = iy + ((k * 97.3 + card.key.length * 29) % ih), r = 10 + (k % 3) * 8;
    const sg = ctx.createRadialGradient(sx, sy, r * 0.3, sx, sy, r); sg.addColorStop(0, 'rgba(120,64,30,0.08)'); sg.addColorStop(0.85, 'rgba(120,64,30,0.16)'); sg.addColorStop(1, 'rgba(110,60,30,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
  }
  const edge = ctx.createRadialGradient(0, 0, Math.min(iw, ih) * 0.4, 0, 0, Math.max(iw, ih) * 0.62); // edges darkened with age
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(8,2,0,0.45)');
  ctx.fillStyle = edge; ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = 'rgba(120,70,30,0.08)'; ctx.fillRect(ix, iy, iw, ih); // a warm, tea-stained tint over everything
  ctx.fillStyle = 'rgba(130,70,30,0.22)'; for (let k = 0; k < 18; k++) { ctx.beginPath(); ctx.arc(ix + ((k * 43.7 + card.key.length * 7) % iw), iy + ((k * 61.3 + card.key.length * 11) % ih), 0.6 + (k % 3) * 0.5, 0, TAU); ctx.fill(); } // foxing specks
  ctx.restore();
  ctx.strokeStyle = '#9a7434'; ctx.lineWidth = 1.2; rrect(ctx, ix, iy, iw, ih, 2); ctx.stroke();
  ctx.fillStyle = '#a8844a'; ctx.strokeStyle = '#1a0606'; ctx.lineWidth = 1;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.save(); ctx.translate(sx * (w / 2), sy * (h / 2)); ctx.scale(-sx, -sy);
    const L = 20; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.lineTo(L - 4, 5); ctx.lineTo(5, 5); ctx.lineTo(5, L - 4); ctx.lineTo(0, L); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2a1a0c'; ctx.beginPath(); ctx.arc(8.5, 8.5, 2, 0, TAU); ctx.fill(); ctx.fillStyle = '#a8844a';
    ctx.restore();
  }

  // ---- header band, like the other themed cards: the kind on the left, three blood drops on the right
  const hb = 20;
  ctx.fillStyle = '#0a0304'; ctx.fillRect(ix, iy, iw, hb);
  ctx.strokeStyle = 'rgba(184,134,42,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ix, iy + hb); ctx.lineTo(ix + iw, iy + hb); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  { // the chip: a blood drop and the word, the same size as the other cards' chips
    ctx.font = '800 8.5px "Zen Kaku Gothic New", sans-serif';
    const cw = ctx.measureText('SACRIFICE').width + 24, ch = 15, cx = ix + iw - 5 - cw, cy = iy + hb / 2;
    ctx.fillStyle = '#5a0c12'; rrect(ctx, cx, cy - ch / 2, cw, ch, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,210,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    const dx = cx + 9, dy = cy - 4.5;
    ctx.fillStyle = '#ff5a5a'; ctx.beginPath(); ctx.moveTo(dx, dy); ctx.bezierCurveTo(dx + 3.5, dy + 4.5, dx + 3.5, dy + 8.5, dx, dy + 9); ctx.bezierCurveTo(dx - 3.5, dy + 8.5, dx - 3.5, dy + 4.5, dx, dy); ctx.fill();
    ctx.fillStyle = '#f8ecd4'; ctx.fillText('SACRIFICE', cx + 17, cy + 0.5);
  }
  for (let k = 0; k < 3; k++) {
    const dx = ix + 11 + k * 10, dy = iy + 5;
    ctx.fillStyle = '#c8202a'; ctx.beginPath(); ctx.moveTo(dx, dy); ctx.bezierCurveTo(dx + 3.5, dy + 4.5, dx + 3.5, dy + 9, dx, dy + 9.5); ctx.bezierCurveTo(dx - 3.5, dy + 9, dx - 3.5, dy + 4.5, dx, dy); ctx.fill();
  }

  // ---- art: a night sky, a blood moon carrying the sacrifice's symbol, mist, red spider lilies, a stone lantern
  const ax = ix + 8, ay = iy + hb + 7, aw = iw - 16, ah = ih * 0.37;
  ctx.save(); rrect(ctx, ax, ay, aw, ah, 2); ctx.clip();
  const ag = ctx.createLinearGradient(0, ay, 0, ay + ah); ag.addColorStop(0, '#050307'); ag.addColorStop(0.7, '#2a070e'); ag.addColorStop(1, '#4a0c14');
  ctx.fillStyle = ag; ctx.fillRect(ax, ay, aw, ah);
  for (let k = 0; k < 14; k++) { // stars
    const sx = ax + ((k * 47.3) % aw), sy = ay + ((k * 23.9) % (ah * 0.5)), tw = 0.35 + 0.35 * Math.sin(t * 2 + k);
    ctx.fillStyle = `rgba(255,230,220,${tw})`; ctx.fillRect(sx, sy, 1.2, 1.2);
  }
  const mr = ah * 0.34, my = ay + ah * 0.5;
  const halo = ctx.createRadialGradient(0, my, mr * 0.8, 0, my, mr * 1.9); halo.addColorStop(0, 'rgba(220,40,40,0.35)'); halo.addColorStop(1, 'rgba(220,40,40,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, my, mr * 1.9, 0, TAU); ctx.fill();
  const mg = ctx.createRadialGradient(-mr * 0.3, my - mr * 0.3, mr * 0.1, 0, my, mr);
  mg.addColorStop(0, '#ea4a4e'); mg.addColorStop(1, '#8a121c');
  ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(0, my, mr, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(60,0,8,0.25)'; for (const [cx, cy, r] of [[-0.4, -0.2, 0.18], [0.35, 0.3, 0.13], [0.1, -0.45, 0.1]]) { ctx.beginPath(); ctx.arc(cx * mr, my + cy * mr, r * mr, 0, TAU); ctx.fill(); }
  // drifting mist across the moon
  for (let k = 0; k < 2; k++) {
    const mx = ax - 30 + ((t * (6 + k * 3) + k * 70) % (aw + 60)), myy = my + mr * (0.35 + k * 0.4);
    ctx.fillStyle = 'rgba(40,8,14,0.55)'; rrect(ctx, mx, myy, 70, 6, 3); ctx.fill();
  }
  ctx.save(); ctx.translate(0, my); ctx.scale(mr / 38, mr / 38);
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6;
  drawSacGlyph(ctx, card.key, '#f8ead2');
  ctx.restore();
  // ground and a stone lantern
  const gy = ay + ah - 9;
  ctx.fillStyle = '#0a0406'; ctx.beginPath(); ctx.moveTo(ax, ay + ah); ctx.lineTo(ax, gy);
  for (let k = 0; k <= 14; k++) ctx.lineTo(ax + (aw * k) / 14, gy + 1 - (k % 2 ? 4 : 0) - Math.sin(k * 2.1) * 1.5);
  ctx.lineTo(ax + aw, ay + ah); ctx.closePath(); ctx.fill();
  const lx = ax + aw - 22, ly = gy + 2;
  ctx.fillRect(lx - 3, ly - 20, 6, 20); ctx.fillRect(lx - 8, ly - 27, 16, 7); ctx.beginPath(); ctx.moveTo(lx - 11, ly - 27); ctx.lineTo(lx, ly - 34); ctx.lineTo(lx + 11, ly - 27); ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,150,70,${0.6 + 0.3 * Math.sin(t * 7)})`; ctx.fillRect(lx - 4.5, ly - 25.5, 9, 3.5);
  for (let k = 0; k < 8; k++) { // red petals drifting down
    const life = (t * 0.18 + k / 8) % 1, px = ax + ((k * 41.3) % aw) + Math.sin(t * 1.4 + k) * 6, py = ay + life * ah;
    ctx.save(); ctx.translate(px, py); ctx.rotate(t * 2 + k); ctx.fillStyle = `rgba(230,40,48,${Math.sin(life * Math.PI) * 0.8})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 2.2, 1, 0, 0, TAU); ctx.fill(); ctx.restore();
  }
  // shimenawa rope with paper streamers
  ctx.strokeStyle = '#c8a868'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(ax - 2, ay + 5); ctx.quadraticCurveTo(0, ay + 14, ax + aw + 2, ay + 5); ctx.stroke();
  ctx.strokeStyle = 'rgba(90,60,20,0.6)'; ctx.lineWidth = 1; for (let k = 0; k < 18; k++) { const x = ax + (aw * k) / 18, y = ay + 5 + Math.sin((k / 18) * Math.PI) * 9; ctx.beginPath(); ctx.moveTo(x - 2, y - 2); ctx.lineTo(x + 2, y + 2); ctx.stroke(); }
  for (const sx of [-0.3, 0.3]) {
    const px = sx * aw, py = ay + 5 + Math.cos(sx * Math.PI) * 9;
    ctx.strokeStyle = '#f4efe4'; ctx.lineWidth = 2.4; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 4, py + 4); ctx.lineTo(px - 2, py + 8); ctx.lineTo(px + 4, py + 12); ctx.lineTo(px - 2, py + 16); ctx.stroke();
  }
  ctx.restore();
  // vermilion seal with the sacrifice's kanji, like the hanko on the other cards
  ctx.save(); ctx.translate(ax + 16, ay + ah - 18); ctx.rotate(-0.08);
  ctx.fillStyle = '#b52a22'; rrect(ctx, -12, -12, 24, 24, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(251,239,224,0.6)'; ctx.lineWidth = 0.8; rrect(ctx, -9.5, -9.5, 19, 19, 2); ctx.stroke();
  ctx.fillStyle = '#fbefe0'; ctx.font = `800 ${S.jp.length > 1 ? 9 : 14}px "Shippori Mincho", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (S.jp.length > 1) { ctx.fillText(S.jp[0], 0, -4.5); ctx.fillText(S.jp[1], 0, 5.5); } else ctx.fillText(S.jp, 0, 1);
  ctx.restore();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.6; rrect(ctx, ax, ay, aw, ah, 2); ctx.stroke();

  // ---- name, brushed, with a blood-red stroke under it (as on the other cards)
  const ny = ay + ah + 20;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let tsz = 19; ctx.font = `800 ${tsz}px "Shippori Mincho", serif`;
  while (ctx.measureText(S.title).width > iw - 20 && tsz > 12) { tsz--; ctx.font = `800 ${tsz}px "Shippori Mincho", serif`; }
  ctx.fillStyle = '#f6e2bc'; ctx.fillText(S.title, 0, ny);
  const nw = Math.min(iw - 30, ctx.measureText(S.title).width + 20);
  ctx.fillStyle = 'rgba(200,24,34,0.9)';
  ctx.beginPath(); ctx.moveTo(-nw / 2, ny + 13); ctx.quadraticCurveTo(0, ny + 10, nw / 2, ny + 12); ctx.lineTo(nw / 2 - 6, ny + 15); ctx.quadraticCurveTo(0, ny + 14.5, -nw / 2 + 4, ny + 15.5); ctx.closePath(); ctx.fill();

  // ---- what you give up and what you gain: two rows that fill the space down to the footer,
  // in the cards' own font, with muted old colours (dried blood red / old gold) and room around the text
  const fy = iy + ih - 12;
  const ry = ny + 25, gap = 7, rh = Math.max(40, (fy - 21 - ry - gap) / 2);
  // struck: the Satanist's free sacrifice: the cost is still shown, greyed out and crossed through
  const row = (y, label, body, down, struck = false) => {
    const rx = ix + 8, rw = iw - 16, pad = 9;
    const col = struck ? '#8a807c' : down ? '#b8483e' : '#b89048', ink = struck ? '#9a908c' : down ? '#e8cfc4' : '#e8d9b2';
    const tg = ctx.createLinearGradient(0, y, 0, y + rh);
    tg.addColorStop(0, down ? 'rgba(74,16,14,0.62)' : 'rgba(70,52,20,0.56)'); tg.addColorStop(1, down ? 'rgba(46,10,8,0.62)' : 'rgba(44,32,12,0.56)');
    ctx.fillStyle = tg; rrect(ctx, rx, y, rw, rh, 1.5); ctx.fill();
    ctx.strokeStyle = 'rgba(8,2,0,0.75)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = down ? 'rgba(184,72,62,0.3)' : 'rgba(184,144,72,0.3)'; ctx.lineWidth = 0.7; rrect(ctx, rx + 2.5, y + 2.5, rw - 5, rh - 5, 1); ctx.stroke();
    ctx.fillStyle = down ? '#7e2a22' : '#86683a'; ctx.fillRect(rx, y, 3, rh);
    // the ▼ / ▲ badge, in the same muted colours
    const br = Math.min(13, rh / 2 - 5), bx = rx + pad + br, by = y + rh / 2;
    ctx.fillStyle = 'rgba(14,6,4,0.92)'; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = col; const kk = br * 0.45;
    ctx.beginPath(); if (down) { ctx.moveTo(-kk + bx, by - kk * 0.6); ctx.lineTo(kk + bx, by - kk * 0.6); ctx.lineTo(bx, by + kk); } else { ctx.moveTo(-kk + bx, by + kk * 0.6); ctx.lineTo(kk + bx, by + kk * 0.6); ctx.lineTo(bx, by - kk); } ctx.closePath(); ctx.fill();
    // label (bold) and the text, wrapped onto two lines when needed
    const tx = bx + br + 9, tw = rx + rw - pad - tx;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `900 10.5px "Zen Kaku Gothic New", sans-serif`; ctx.fillStyle = col;
    const ly = y + pad + 5;
    ctx.fillText(label, tx, ly);
    if (struck) { // what pays for it: a small tag after the label
      const lw = ctx.measureText(label).width; ctx.font = '900 9px "Zen Kaku Gothic New", sans-serif';
      const tag = 'FREE', tgw = ctx.measureText(tag).width + 10, tgx = rx + rw - pad - tgw; // (Satanist's Set: at the row's right end)
      ctx.fillStyle = '#7a1018'; rrect(ctx, tgx, ly - 6.5, tgw, 13, 2); ctx.fill();
      ctx.fillStyle = '#ffd8d0'; ctx.fillText(tag, tgx + 5, ly + 0.5);
    }
    const area0 = ly + 8, area1 = y + rh - pad + 1; // the text sits between the label and the bottom padding
    // (icons and buttons in the text: {energy}, {health}, {damage}, {Y}... see cards.js drawRichText)
    if (struck) ctx.globalAlpha *= 0.55;
    drawRichText(ctx, player, body, tx, (area0 + area1) / 2 + 1, tw, 2, 13, 12.5, ink, { align: 'left', vcenter: true, maxH: area1 - area0 + 4 });
    if (struck) { // crossed through
      ctx.globalAlpha /= 0.55;
      const cy = (area0 + area1) / 2 + 1; ctx.strokeStyle = '#d8ccc6'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(tx - 2, cy + 1); ctx.lineTo(tx + tw, cy - 1); ctx.stroke();
    }
    ctx.textAlign = 'center';
  };
  row(ry, 'YOU SACRIFICE', S.cost, true, !!card.free);
  row(ry + rh + gap, 'YOU GAIN', card.gainText || S.gain, false);
  // footer: a thin rule with a diamond, then the note
  ctx.strokeStyle = 'rgba(184,134,42,0.45)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ix + 20, fy - 11); ctx.lineTo(-5, fy - 11); ctx.moveTo(5, fy - 11); ctx.lineTo(ix + iw - 20, fy - 11); ctx.stroke();
  ctx.fillStyle = '#c8202a'; ctx.beginPath(); ctx.moveTo(0, fy - 14); ctx.lineTo(3, fy - 11); ctx.lineTo(0, fy - 8); ctx.lineTo(-3, fy - 11); ctx.closePath(); ctx.fill();
  ctx.font = '700 9.5px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = 'rgba(232,206,170,0.6)';
  ctx.fillText(S.pact ? 'Only binds if both players choose it' : 'Permanent for this run', 0, fy);
  // selection outline, pulsing with the heartbeat
  if (sel) {
    ctx.save(); ctx.lineWidth = 3 + beat * 2; ctx.strokeStyle = '#ff4a4a'; ctx.globalAlpha = 0.55 + 0.45 * beat;
    rrect(ctx, x0 - 6, y0 - 6, w + 12, h + 12, 6); ctx.stroke(); ctx.restore();
  }
}

// The player ninja: movement, dash, weapons, stats and elements. One instance per player (co-op).
// Dash moves: which acrobatic move a dash becomes depends on where you dash compared to where you aim
// (forward, sideways or away). air = jump height (tiles), spin = body turns (+ forward, - backward),
// twist = turns around the upright axis, faceAim = keeps facing the aim instead of the dash direction.
// enemy projectiles a katana can cut (not magic, not lobbed, not burning)
// enemy states that are an attack already under way (for the perfect dodge)
const DODGE_MOVING = new Set(['lunge', 'charge', 'xdash', 'gdash', 'swoop', 'dash', 'dive']);
const CUT_WINDOW = 0.25; // seconds a katana cut keeps cutting projectiles that fly into it
const CUTTABLE = new Set(['arrow', 'icearrow', 'dart', 'bolt', 'kunai', 'bullet', 'feather']);
export const DASH_MOVES = {
  jump:     { air: 0.75, spin: 0,  long: true },
  flip:     { air: 1.05, spin: 1,  long: true, tuck: true },
  backflip: { air: 0.95, spin: -1, long: true, tuck: true, faceAim: true },
  aerial:   { air: 0.7,  spin: 1,  long: true, faceAim: true },
  vault:    { air: 0.85, spin: 0,  long: true, twist: 1, tuck: true },
  roll:     { air: 0,    spin: 1,  squash: 0.85 },
  slide:    { air: 0,    spin: 0,  slide: true, faceAim: true },
  shadow:   { air: 0,    spin: 0 },
  launch:   { air: 1.7,  spin: 0,  long: true }, // (Stone Launch: thrown up by a rock)
};
const DASH_CHOICES = { // [move, weight]
  forward: [['flip', 3], ['roll', 2.5], ['vault', 2], ['jump', 1.5], ['shadow', 2]],
  side:    [['aerial', 3.5], ['slide', 2.5], ['roll', 2], ['shadow', 1.5]],
  back:    [['backflip', 4.5], ['roll', 1.5], ['shadow', 2]],
};
import { TAU, clamp, lerp, rand, pick, ease, isoX, isoY, screenDirToWorld, worldDirToScreenAngle, angDiff } from './util.js';
import { LOW_HP, AFTERIMAGE_T, HIGH_ENERGY, HIGH_HP, IDLE_ENERGY_T, PERFECT_DODGE, PLAYER_BASE, WEAPONS, TALENTS, ELEMENTS, weaponMove, ENEMY_DAMAGE_MUL, WEAPON_SWITCH, DAMAGE_SPREAD, PROJ_HIT_PAD, RELIFE } from './config.js';
import { talentCd, talentTarget, activateTalent } from './talents.js';
import { drawHumanoid, drawShadow, drawWeapon } from './rig.js';
import { input } from './input.js';
// the Shishi shield: seconds after a bash or the Bulwark during which shots that hit you deal half damage
const SHIELD_WARD = 1.5;
import { sfx } from './audio.js';
import { net } from './net.js';
import { ARTS } from './arts.js';
import { callSpirits, GHOST, tether } from './spirits.js';
import { pinnedBehind } from './enemies.js';
import { updateFinisher, finisherLook } from './finishers.js';

const PALS = [
  { skin: '#f1c9a5', cloth: '#2c3a5e', cloth2: '#1d2742', sash: '#c0392b', hood: '#232c46', scarf: '#d63a3a', metal: '#e6edf5', wood: '#7a4e2a', accent: '#c0392b' },
  { skin: '#f1c9a5', cloth: '#e6e2d6', cloth2: '#3a4a5e', sash: '#2a7ac0', hood: '#d8d2c2', scarf: '#3a9ae0', metal: '#e6edf5', wood: '#7a4e2a', accent: '#2a7ac0' },
];
// bo staff moves: when the hit lands (fraction of the animation), reach and arc multipliers
// (narrowed 2026-11-19 so a careless swing misses and drops the combo: was jab 40, sweep 140, rise 90, overhead 70, twirl 360)
const BO_MOVES = {
  boJab: { at: 0.34, rng: 1.2, arc: 32, knock: 1.4 },
  boSweep: { at: 0.22, rng: 0.95, arc: 90, knock: 0.8 },
  boRise: { at: 0.25, rng: 1.0, arc: 60, knock: 1.0 },
  boOverhead: { at: 0.45, rng: 1.0, arc: 50, knock: 1.2 },
  boTwirl: { at: 0.3, rng: 0.75, arc: 180, knock: 0.6 },
};
const BO_COMBO = ['boJab', 'boSweep', 'boRise', 'boTwirl', 'boOverhead']; // the 5th hit in a row is the finisher
const BO_FLURRY = ['boJab', 'boJab', 'boSweep', 'boRise', 'boTwirl', 'boOverhead', 'boJab', 'boSweep', 'boTwirl', 'boRise', 'boJab'];
const SHADOW_PAL = {
  skin: '#4a2f6a', cloth: '#3a2560', cloth2: '#2a1a48', sash: '#5a3a8a', hood: '#2a1a48', scarf: '#6a3aa0', metal: '#6a4a9a', wood: '#3a2560', accent: '#5a3a8a',
};
// weapon = in near hand, weapon2 = in far hand, back = how it's carried when not in use
export const RIG_WEAPON = {
  katanas: { weapon: 'katana', weapon2: 'katana', grip: 'dual', back: 'saya' },
  crossbow: { weapon: 'crossbow', weapon2: null, grip: 'forward', back: 'crossbow_back' },
  heavy: { weapon: 'nodachi', weapon2: null, grip: 'shoulder', back: 'saya_long' },
  knives: { weapon: 'kunai', weapon2: 'kunai', grip: 'down', back: null },
  staff: { weapon: 'holystaff', weapon2: null, grip: 'pole', back: 'holystaff' },
  bo: { weapon: 'bo', weapon2: null, grip: 'pole', back: 'bo' },
  shield: { weapon: 'shield', weapon2: null, grip: 'shield', back: 'shield_back' },
  orb: { weapon: 'spiritorb', weapon2: null, grip: 'orb', back: 'orb_hip' },
  gloves: { weapon: 'gauntlet', weapon2: 'gauntlet', grip: 'down', back: null },
};

// angle for drawing ground-plane slashes (pre-squash space used by Effects.slash)
export const slashAngle = (wx, wy) => Math.atan2(((wx + wy) * 16) / 0.55, (wx - wy) * 32);

export class Player {
  constructor(game, weaponKeys, index = 0) {
    this.g = game;
    this.index = index;
    this.ctl = input.players[index];
    this.pal = PALS[index];
    this.x = 17.5; this.y = 17.5; this.z = 0;
    this.vx = 0; this.vy = 0; this.kvx = 0; this.kvy = 0;
    this.r = PLAYER_BASE.radius;
    this.hp = PLAYER_BASE.maxHp; this.energy = PLAYER_BASE.maxEnergy;
    this.stats = { ...PLAYER_BASE.stats };
    this.aimX = -0.7071; this.aimY = -0.7071;
    this.moveX = 0; this.moveY = 0;
    // one weapon per run (the array is kept so cards, sync and arts work as before); ccd = the secondary's cooldown
    this.weapons = weaponKeys.slice(0, 1).map((k) => ({ key: k, def: WEAPONS[k], cd: 0, cdMax: 1, ccd: 0, ccdMax: 1, scd: 0, scdMax: 1, side: 1, elements: { lightning: 0, poison: 0, ice: 0, syphon: 0, arcane: 0, burn: 0 } }));
    this.vault = null;     // bo: Pole Vault
    this.hop = null;       // crossbow: Backstep Shot
    this.disc = null;      // shield: Lion Disc
    this.orbDrop = null;   // orb: Soul Drop
    this.storm = null;     // knives: Blade Storm
    this.lfStacks = 0; this.lfT = 0;   // Light Feet: kunai hits stack move speed
    this.healPop = 0; this.enPop = 0; this.popT = 0; // gathered heals / energy, shown as one number every so often
    this.cbMarks = new Map();           // crossbow: enemy -> its marks (1 or 2); every enemy keeps its own
    // carrying the weapons: heavier ones slow you a little, fast ones speed you up (average of both)
    this.weaponMove = this.weapons.reduce((a, w) => a + weaponMove(w.def), 0) / this.weapons.length;
    this.chill = 0; this.chillT = 0; // slowed by frost enemies
    this.activeSlot = 0;
    this.actionT = 0; this.actionMax = 1; // one attack at a time
    this.dash = { t: 0, dur: 0, cd: 0, cdMax: 1, type: null, sx: 0, sy: 0 };
    this.iframes = 0; this.flash = 0; this.hurtT = 0;
    this.anim = null;
    this.walk = 0; this.moveAmt = 0;
    this.timers = [];
    this.afterimages = [];
    this.spin = null;
    this.leap = null;
    this.slowT = 0;
    this.dead = false; this.deadT = 0;
    this.downed = false; this.downT = 0; this.reviveP = 0; // co-op: downed players can be revived
    this.rippleT = 0;
    this.talents = [];     // { key, level, rarity, cdMul, cd, cdMax }
    this.rageT = 0;
    this.rushT = 0; this.rushMul = 1; this.nextRush = 0; // Battle Rush item: bonus damage at the start of a level
    this.flurry = null;    // bo special
    this.charge = null;    // crossbow draw { slot, t }
    this.stunT = 0;        // shield bash stun
    this.bash = null;      // shishi shield bash dash { t, dur, sx, sy, dx, dy, w }
    this.guard = null;     // shishi shield Bulwark { t, dur, store, w, def }
    this.reflectT = 0;     // projectiles are still turned back for a moment after the bash
    this.switchT = 0; this.lastSlot = -1; // weapon switch gap
    // monk sacrifices (keys) and their effects
    this.sac = []; this.maxHpMul = 1; this.elemMul = 1; this.dmgMul = 1; this.adminMul = 1;
    this.noCrit = false; this.alwaysCrit = false; this.bound = false; this.lifebinder = false;
  }

  // standing and able to fight (not dead, not downed)
  get active() { return !this.dead && !this.downed; }
  get maxHp() { const V = this.anyArt('vigor'); return Math.max(10, Math.round(PLAYER_BASE.maxHp * (this.maxHpMul || 1)) + (V ? V.hp : 0) + (this.maxHpAdd || 0)); } // (maxHpAdd: Glass Edge)
  // dash charges: 1, or more with Shadow Step (stats.extraDash, so it travels with the stats online)
  get dashMax() { return 1 + (this.stats.extraDash || 0); }

  // ---------------- weapon arts ----------------
  // the art's numbers if weapon w carries it, else null
  art(w, key) { const a = w && w.arts; return a && (a.basic === key || a.secondary === key || a.special === key || a.unique === key) ? ARTS[w.key][key] : null; }
  anyArt(key) { for (const w of this.weapons) { const A = this.art(w, key); if (A) return A; } return null; }
  get dodgeChance() { let d = 0; for (const w of this.weapons) for (const k of Object.values(w.arts || {})) d += (ARTS[w.key][k] && ARTS[w.key][k].dodge) || 0; return Math.min(0.2, d); } // capped at 20%
  // Berserker: more damage the lower your health (+0% full, up to +max at `at` health)
  artDmgMul(w) { const B = this.art(w, 'berserker'); return B ? 1 + B.max * clamp((1 - this.hp / this.maxHp) / (1 - B.at), 0, 1) : 1; }
  chargeTimeOf(w) { const A = this.art(w, 'quickCharge') || this.art(w, 'deepCharge'); return w.def.secondary.chargeTime * (A ? A.chargeMul : 1) * this.cdMulFor(w); } // (Cooldown cards, Wind and sacrifices speed up the draw / charge too)
  // Flowing Step (katanas): a kill with a basic slash gives energy back
  onKill(e, src) {
    const w = src.weapon, FS = w && src.basic && this.art(w, 'flowingStep');
    if (FS) this.gainEnergy(FS.ki);
  }
  // energy from anything but the normal refill (Arcane, Energy Flow, Endless Tempo, pickups, tea): a blue number
  // on the player. Small gains are gathered and shown together (now = show right away).
  // energy spent on an attack or a dash; Energetic Healing turns it into health (fractions carry over)
  spendEnergy(n) {
    if (!(n > 0)) return;
    this.energy -= n;
    const r = this.stats.energyHeal;
    if (r > 0 && !this.netClient) {
      this.ehAcc = (this.ehAcc || 0) + n * r;
      const whole = Math.floor(this.ehAcc);
      if (whole > 0) { this.ehAcc -= whole; const got = this.heal(whole); if (got > 0) this.healPop = (this.healPop || 0) + got; }
    }
  }
  gainEnergy(n, now = false) {
    if (!(n > 0) || this.dead) return 0;
    const before = this.energy;
    this.energy = Math.min(this.maxEnergy, this.energy + n);
    this.enPop += this.energy - before;
    if (now) this.flushPops(true);
    return this.energy - before;
  }
  // gathered heals (syphon) and energy: one green / blue number every ~0.35 s instead of a stream of tiny ones
  flushPops(force = false) {
    if (!this.g || !this.g.fx) return;
    if (this.healPop >= 1 || (force && this.healPop >= 0.5)) { const n = Math.round(this.healPop); this.healPop -= n; this.g.fx.text(this.x - 0.25, this.y + 0.25, `+${n}`, '#7dff9a', 13); }
    if (this.enPop >= 1 || (force && this.enPop >= 0.5)) { const n = Math.round(this.enPop); this.enPop -= n; this.g.fx.text(this.x + 0.25, this.y - 0.25, `+${n}`, '#5ab4ff', 13); }
  }
  // Light Feet: how much faster the kunai bearer runs right now
  lightFeetMul() { const LF = this.anyArt('lightFeet'); return LF ? 1 + Math.min(LF.max, this.lfStacks * LF.per) : 1; }
  onWeaponHit(e, src) {
    const LF = src.weapon && this.art(src.weapon, 'lightFeet');
    if (LF) { this.lfStacks = Math.min(LF.max / LF.per, this.lfStacks + 1); this.lfT = 0; }
  }
  // crossbow basic: the 1st bolt on an enemy marks it, the 2nd adds a second mark, the 3rd breaks both for
  // markMul x damage. Every enemy keeps its own marks, so you can mark several and come back to them.
  boltMark(e, w) {
    const M = this.cbMarks || (this.cbMarks = new Map());
    for (const [q] of M) if (q.dead) M.delete(q);
    const n = (M.get(e) || 0) + 1;
    if (n < 3) { M.set(e, n); return 1; }
    M.delete(e);
    const g = this.g;
    g.fx.ring(e.x, e.y, 1.3, 'rgba(255,120,60,0.95)', 0.35, 5); g.fx.ring(e.x, e.y, 0.8, 'rgba(255,230,180,0.95)', 0.25, 3);
    g.particles.burst('shard', e.x, e.y, 0.5, 12, 6, 0.5, 2.2, '#ff8a4a', { grav: 12 });
    g.particles.burst('spark', e.x, e.y, 0.7, 10, 7, 0.25, 1.6, '#ffe0a0');
    sfx.clang(); g.hitstop(0.05); g.shake(4);
    return w.def.basic.markMul || 2;
  }
  // kunai stuck in an enemy (basic and special): kept for a few seconds, at most maxStick per enemy
  stickKunai(e, w) {
    if (!e || e.dead || e.boss && e.type === 'gensai' && e.kneel) return;
    const def = w.def.basic, D = e.daggers || (e.daggers = []);
    if (D.length >= (this.maxStick ?? def.maxStick)) D.shift(); // (Lightened Load: fewer)
    D.push({ p: this, t: def.stick, a: Math.random() * TAU });
  }
  // dashing through an enemy with our kunai in it pulls them out: one kunai hit per kunai, and the dash
  // that pulled them recharges much sooner. Returns true if any came out.
  pullKunai() {
    const g = this.g, w = this.weapons.find((q) => q.key === 'knives');
    if (!w || this.netClient) return false;
    let got = false;
    for (const e of g.enemies) {
      if (e.dead || !e.daggers || !e.daggers.length || e.state === 'intro') continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) > this.r + e.r + 0.45) continue;
      const mine = e.daggers.filter((k) => k.p === this);
      if (!mine.length) continue;
      e.daggers = e.daggers.filter((k) => k.p !== this);
      const { dmg, crit } = this.rollDamage((w.def.basic.pullDmg ?? w.def.basic.dmg) * mine.length, w);
      g.damageEnemy(e, dmg, crit, this.dash.dx || 0, this.dash.dy || 0, 2, 0.2, { player: this, weapon: w, sound: 'knifeHit' });
      g.particles.burst('spark', e.x, e.y, 0.7, 6 + mine.length * 2, 6, 0.25, 1.4, '#ffe6a0');
      g.fx.ring(e.x, e.y, 1.1, 'rgba(210,232,255,0.9)', 0.28, 4);
      g.fx.kunaiPull(e.x, e.y, this, mine.length);
      got = true;
    }
    if (got) {
      const cut = w.def.basic.dashCut;
      this.dash.cd *= 1 - cut;
      if (this.remote) net.send('pdashcut', { k: cut }); // the joiner runs its own dash cooldown
      sfx.kunaiPull();
    }
    return got;
  }
  // Sacred Pool: a holy pool that hurts enemies standing in it (host only)
  addPool(x, y, r, P, base, w) { this.g.fx.pool(x, y, r, P.dur); if (!this.netClient) (this.pools || (this.pools = [])).push({ x, y, r, t: P.dur, tick: P.tick, every: P.tick, dmg: base * P.dmgMul, w }); }
  updateZones(dt) {
    const g = this.g;
    // Crushing Stone: enemies this player locked in rock take damage while they are held
    if (!this.netClient) for (const e of g.enemies) {
      if (e.dead || !(e.rockT > 0) || e.rockBy !== this || !e.rockCrush) continue;
      e.rockTick -= dt;
      if (e.rockTick <= 0) { e.rockTick += 1; const { dmg } = this.rollDamage(e.rockCrush, e.rockW); g.damageEnemy(e, dmg, false, 0, 0, 0, 0, { player: this, weapon: e.rockW, dot: true, crush: true }); }
    }
    if (this.pools) for (const P of this.pools) {
      P.t -= dt; P.tick -= dt;
      if (P.tick > 0) continue;
      P.tick += P.every;
      for (const e of g.enemies) {
        if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro' || Math.hypot(e.x - P.x, e.y - P.y) > P.r + e.r) continue;
        const { dmg } = this.rollDamage(P.dmg, P.w);
        g.damageEnemy(e, dmg, false, 0, 0, 0, 0, { player: this, weapon: P.w, dot: true, pool: true, vuln: true });
      }
    }
    if (this.pools) this.pools = this.pools.filter((P) => P.t > 0);
    // Life Spring: a zone that heals everyone inside it over time
    if (this.zones) for (const Z of this.zones) {
      Z.t -= dt; Z.tick -= dt;
      if (Z.tick > 0) continue;
      Z.tick += Z.every;
      for (const p of g.players) {
        if (p.dead || Math.hypot(p.x - Z.x, p.y - Z.y) > Z.r) continue;
        const got = p.heal(Z.per);
        if (got > 0.5) g.fx.text(p.x, p.y, `+${Math.round(got)}`, '#7dff9a', 13);
        const KF = p !== this && this.art(Z.w, 'kiFlow'); if (KF && got > 0) this.gainEnergy(KF.perHeal / (Z.dur / Z.every));
      }
    }
    if (this.zones) this.zones = this.zones.filter((Z) => Z.t > 0);
  }
  get maxEnergy() { return PLAYER_BASE.maxEnergy; }
  // every attack cooldown of weapon w is multiplied by this (Wind on that weapon, cooldown sacrifices)
  // Rage: basic attacks recover faster (1 + attack speed) while it lasts
  // Wisdom: cooldowns run out 1 / (1 - cut) times as fast (the same as cooldowns cut by that much), attacks cost less energy
  // Smoke Bomb: standing in a smoke cloud (any player's), enemies can't find you
  inSmoke() { const H = this.g.hazards; for (const h of H) if (h.kind === 'smoke' && h.t > 0 && Math.hypot(this.x - h.x, this.y - h.y) < h.r) return true; return false; }
  wisdomSpeed() { return this.wisdomT > 0 ? 1 / (1 - (this.wisdomCut || 0)) : 1; }
  rageSpeed() { if (!(this.rageT > 0)) return 1; const t = this.talents && this.talents.find((x) => x.key === 'rage'); return 1 / (1 - (t ? TALENTS.rage.atkCd[t.rarity || 0] : 0)); } // (cooldowns run down this much faster: Rage's lower attack cooldowns)
  cdMulFor(w) { return (this.stats.cooldownMul || 1) * (this.stats.cooldown || 1); } // (Attack Cooldown cards, sacrifices)
  // Wind on weapon w (0..cap). The heavy sword's swing is so slow that it gets 1.4x as much out of each Wind card.
  get dashCooldown() { return Math.max(PLAYER_BASE.dash.minCooldown, PLAYER_BASE.dash.cooldown * (this.stats.cooldown || 1) * (this.stats.dashCd || 1)); }

  after(delay, fn) { this.timers.push({ t: delay, fn }); }

  applyChill(amount, dur) {
    if (this.dead || !amount) return;
    this.chill = Math.max(this.chillT > 0 ? this.chill : 0, amount); this.chillT = Math.max(this.chillT, dur);
    if (this.remote) net.send('pchill', { a: amount, d: dur }); // the joiner moves its own ninja
  }

  // Earth Shaper's Gloves, basic: stomp (rooted for a moment), a dark rock rises in front, the punch sends it along the aim
  glovesBasic(w, def, ax, ay) {
    const g = this.g, TR = this.art(w, 'tremor'), SHT = this.art(w, 'shatter'), LS = this.art(w, 'landslide');
    const R = def.stompR * (TR ? TR.rMul : 1), sd = def.stompDmg + (TR ? TR.dmgAdd : 0);
    this.anim = { kind: 'gStomp', t: 0, dur: Math.max(0.2, (def.stompAt ?? 0.13) + def.punchAt) }; // (into a wide stance, held until the punch)
    this.anchorT = def.anchor;
    this.after(def.stompAt ?? 0.13, () => this.glovesStomp(w, def, R, sd, LS)); // (the foot comes down)
  }
  // the stomp lands: cracks, damage and push around the player, then the rock rises and the punch follows
  glovesStomp(w, def, R, sd, LS) {
    if (this.dead || !this.active) return;
    const g = this.g, ax = this.aimX, ay = this.aimY, SHT = this.art(w, 'shatter');
    sfx.heavyThud(0.6); sfx.slam(); g.shake(4);
    g.fx.quake(this.x, this.y, R, 0.8);
    g.particles.burst('dust', this.x, this.y, 0.05, 16, 4, 0.6, 6, g.world.bi === 2 ? '#e8eef6' : '#8a6a44', { under: true });
    g.decals.add(this.x, this.y, R * 0.4, 'rgba(60,40,24,1)', 6);
    if (!this.netClient) for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > R + e.r) continue;
      const ux = dx / (d || 1), uy = dy / (d || 1);
      let { dmg, crit } = this.rollDamage(sd, w);
      if (LS && pinnedBehind(g, e, ux, uy)) { dmg = Math.round(dmg * LS.mul); g.fx.text(e.x, e.y, 'Crushed!', '#e8b070', 12); }
      g.damageEnemy(e, dmg, crit, ux, uy, def.stompKnock, 0.1, { player: this, weapon: w, sound: 'heavyHit' });
      this.glovesHit(w);
    }
    const rx = this.x + ax * 0.9, ry = this.y + ay * 0.9;
    g.fx.rise(rx, ry, def.punchAt); // the rock breaks up out of the ground
    g.particles.burst('shard', rx, ry, 0.2, 10, 3, 0.6, 3, '#5a3a22', { grav: 14 });
    g.particles.burst('dust', rx, ry, 0.1, 6, 2, 0.5, 5, '#7a5a3a');
    this.after(def.punchAt, () => {
      if (this.dead || !this.active) return;
      const bx = this.aimX, by = this.aimY, a0 = Math.atan2(by, bx), n = SHT ? SHT.count : 1;
      const third = this.thirdPunch && (this.punchN = ((this.punchN || 0) + 1) % 3) === 0; // Bare Knuckles: every 3rd punch hits twice as hard
      if (third) { g.fx.text(this.x, this.y, '×2', '#ffcf6a', 13); g.fx.ring(this.x + bx * 0.9, this.y + by * 0.9, 0.7, 'rgba(255,200,120,0.9)', 0.2, 3); }
      const pv = this.basicVar(w, 3);
      this.anim = { kind: 'gPunch', t: 0, dur: 0.3, v: pv };
      this.afterimages.push({ x: this.x, y: this.y, z: 0, life: 0.16, max: 0.16, rot: 0, type: 'shadow', facing: this.facingAngle(), pose: { kind: 'gPunch', t: 0.3, v: pv } }); // (a snap you can see)
      sfx.heavyHit(); g.shake(3);
      for (let k = 0; k < n; k++) {
        const a = a0 + (n > 1 ? ((k / (n - 1)) - 0.5) * SHT.spread * Math.PI / 180 : 0), vx = Math.cos(a), vy = Math.sin(a);
        this.proj({ kind: n > 1 ? 'rockshard' : 'rock', rock: true, x: this.x + bx * 0.9, y: this.y + by * 0.9, z: 0.6, vx: vx * def.speed, vy: vy * def.speed, base: def.dmg * (SHT ? SHT.dmgMul : 1) * (third ? 2 : 1), splash: n > 1 ? 0 : def.splash, r: n > 1 ? 0.2 : 0.32, life: def.range / def.speed, knock: def.knock * (n > 1 ? 0.6 : 1), impact: LS ? LS.mul : 0 }, w);
      }
    });
  }
  // a gloves hit landed: Resonance takes time off the special
  glovesHit(w) { const RS = w && this.art(w, 'resonance'); if (RS) w.scd = Math.max(0, w.scd - RS.cut); }
  // Earth Shaper's Gloves, special: Earthen Prison
  glovesSpecial(w, def) {
    const g = this.g, GA = this.art(w, 'gather'), CR = this.art(w, 'crush');
    this.anim = { kind: 'gSlam', t: 0, dur: 0.6 };
    sfx.slam(); sfx.heavyThud(1); g.shake(8);
    g.fx.quake(this.x, this.y, def.radius, 1.3);
    g.particles.burst('dust', this.x, this.y, 0.05, 30, 7, 0.8, 7, '#7a5a3a', { under: true });
    this.quakeT = def.lockDur;
    if (this.netClient) return;
    const caught = g.enemies.filter((e) => !e.dead && e.state !== 'spawn' && e.state !== 'intro' && !e.hidden && Math.hypot(e.x - this.x, e.y - this.y) < def.radius + e.r);
    const lockAll = () => {
      for (const e of caught) {
        if (e.dead) continue;
        if (e.boss) { e.slow = Math.max(e.slow, def.bossSlow); e.slowT = Math.max(e.slowT, def.lockDur); continue; }
        e.rockT = def.lockDur; e.rockMax = def.lockDur; e.rockBy = this; e.rockW = w; e.rockCrush = CR ? CR.dps : 0; e.rockTick = 1;
        e.stun = Math.max(e.stun, def.lockDur); e.poiseT = def.lockDur + 0.5; e.tele = null;
        g.particles.burst('shard', e.x, e.y, 0.2, 8, 3, 0.5, 3, '#4a3020', { grav: 14 });
      }
      sfx.heavyHit(); g.shake(4);
    };
    if (GA) { // Earth's Embrace: the ground drags them in first
      for (const e of caught) if (!e.boss) { const dx = this.x - e.x, dy = this.y - e.y, d = Math.hypot(dx, dy) || 1, v = Math.max(0, d - 1.3) * 7 / Math.max(0.3, e.knockResist); e.kvx += (dx / d) * v; e.kvy += (dy / d) * v; }
      this.after(GA.pull, lockAll);
    } else lockAll();
  }

  // the share of a projectile's damage that gets through (the Shishi shield, just used: half)
  projMul() { const SW = this.weapons.find((x) => x.key === 'shield'); return SW && SW.activeT > 0 ? 0.5 : 1; }

  // shield bash: a very short daze (no moving, attacking or dashing)
  applyStun(dur, local = false) {
    if (!this.active || this.g.god) return;
    this.stunT = Math.max(this.stunT, dur); this.charge = null;
    if (this.remote && !local) net.send('pstun', { d: dur });
  }

  // ---------------- online co-op ----------------
  // host side: the joiner's ninja follows the state it reports
  applyRemoteState(m) {
    this.tx = m.x; this.ty = m.y; this.z = m.z; this.aimX = m.ax; this.aimY = m.ay;
    if (this.x === undefined || Math.hypot(m.x - this.x, m.y - this.y) > 3) { this.x = m.x; this.y = m.y; }
    this.moveAmt = m.mv; this.walk = m.wk; this.activeSlot = m.as;
    this.anim = m.an ? { kind: m.an[0], t: m.an[1], side: m.an[2], dur: m.an[3] || 0.3 } : this.anim;
    if (m.da) { this.dash.type = m.da[0]; this.dash.t = m.da[1]; this.dash.dur = m.da[2]; this.dash.dx = m.da[3]; this.dash.dy = m.da[4]; this.dash.ax = m.da[5]; this.dash.ay = m.da[6]; } else this.dash.t = 0;
    this.iframes = Math.max(this.iframes, m.ifr || 0);
    const sw = this.weapons.find((q) => q.key === 'shield');
    if (m.gd && !this.guard && sw) this.guard = { t: m.gd[0], dur: m.gd[1], store: 0, w: sw, def: sw.def.special, flash: 0, recent: [] };
  }
  updateRemote(dt) {
    if (this.dead) { this.deadT += dt; return; }
    if (this.downed) { this.updateDowned(dt); return; }
    this.tickCommon(dt);
    const st = this.stats;
    if (!this.g.cleared) { // no regeneration once the last enemy of the level is down
      if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + st.healthRegen * dt); // (never eats overheal)
      this.energy = Math.min(this.maxEnergy, this.energy + st.energyRegen * (st.idleEnergy && this.idleT >= IDLE_ENERGY_T ? 1 + st.idleEnergy : 1) * dt); // (Still Breath)
    }
    this.iframes = Math.max(0, this.iframes - dt); this.flash = Math.max(0, this.flash - dt); this.hurtT = Math.max(0, this.hurtT - dt);
    this.actionT = Math.max(0, this.actionT - dt);
    { const ws = this.wisdomSpeed(), fz = this.g.cleared ? 0 : 1, as = dt * this.rageSpeed() * ws, wd = dt * ws * fz; for (const w of this.weapons) { w.cd = Math.max(0, w.cd - as * fz); w.ccd = Math.max(0, (w.ccd || 0) - wd); w.scd = Math.max(0, w.scd - wd); w.comboT = Math.max(0, (w.comboT || 0) - dt); this.boDecay(w, dt); w.lockT = Math.max(0, (w.lockT || 0) - as); } }
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    this.updateSecondaries(dt);
    if (this.tx !== undefined) { const k = 1 - Math.exp(-14 * dt); this.x = lerp(this.x, this.tx, k); this.y = lerp(this.y, this.ty, k); }
    if (this.spin) this.updateSpin(dt);
    if (this.leap) this.updateLeap(dt);
    if (this.bash) this.updateBash(dt);
    if (this.guard) this.updateGuard(dt);
    if (this.waltz) this.updateWaltz(dt); // the joiner's Blade Waltz: its cuts (and its end) happen here on the host
    if (this.reflectT > 0) this.reflectT -= dt;
    { // the Shishi shield turns back shots only while charging (the bash dash, and a moment after); for a while after
      // a bash or the Bulwark, shots that do hit you deal half damage (projMul)
      const SW = this.weapons.find((x) => x.key === 'shield');
      if (SW && SW.activeT > 0) SW.activeT -= dt;
      if (SW && this.active && (this.bash || this.reflectT > 0)) this.reflectAround(SW);
    }
    this.ironT = Math.max(0, (this.ironT || 0) - dt);
    if (this.pools || this.zones || this.weapons.some((q) => q.key === 'gloves')) this.updateZones(dt); // (the gloves: Crushing Stone ticks there)
    if (this.dash.t > 0) this.pullKunai(); // the joiner dashing through its kunai
    if (this.anim) { this.anim.t += dt / this.anim.dur; if (this.anim.t >= 1) this.anim = null; }
    for (let i = this.afterimages.length - 1; i >= 0; i--) { const a = this.afterimages[i]; a.life -= dt; if (a.life <= 0) this.afterimages.splice(i, 1); }
  }
  // host side: perform an attack the joiner started
  // special: 0 = basic, 1 = special, 2 = secondary
  forceAttack(slot, special, ax, ay, ch, cb) {
    const w = this.weapons[slot];
    if (!w) return;
    this.aimX = ax; this.aimY = ay;
    this.actionT = 0; this.spin = null; w.lockT = 0;
    if (!special) this.waltz = null; // (the joiner attacks again: any waltz of theirs is over)
    if (special === 2) { w.ccd = 0; this.energy = Math.max(this.energy, this.kiCost(w.def.secondary)); this.trySecondary(slot, { ch }); }
    else if (special) { w.scd = 0; this.energy = Math.max(this.energy, this.kiCost(w.def.special, w)); this.trySpecial(slot); }
    else { w.cd = 0; this.energy = Math.max(this.energy, this.kiCost(w.def.basic)); this.tryBasic(slot, { ch, cb }); }
  }
  // joiner side: the host says we were hit
  remoteHurt(m) {
    const g = this.g;
    if (g.noteCombat) g.noteCombat();
    this.flash = 0.12; this.hurtT = 0.3; this.iframes = PLAYER_BASE.hitIframes; this.lastHurtAt = this.g.realTime;
    const dx = this.x - m.sx, dy = this.y - m.sy, l = Math.hypot(dx, dy) || 1;
    this.kvx += (dx / l) * m.k; this.kvy += (dy / l) * m.k;
    g.localShake(6); g.hitstop(0.05); g.localFlash('rgba(200,30,30,0.25)');
  }

  heal(n) {
    if (this.dead || n <= 0) return 0;
    const before = this.hp, O = this.anyArt('overflow');
    this.hp = Math.max(this.hp, Math.min(this.maxHp + (O ? O.over : 0), this.hp + n)); // Overflow: can heal past the maximum
    return this.hp - before;
  }

  // w: the weapon (for its arts); forceCrit: always a critical hit
  rollDamage(base, w = null, forceCrit = false, critAdd = 0) {
    // Afterimage: extra crit chance on every hit for AFTERIMAGE_T s after a dash
    const ac = this.stats.afterCrit && this.afterWin > 0 ? this.stats.afterCrit : 0;
    const crit = forceCrit || this.alwaysCrit || (!this.noCrit && Math.random() < this.stats.critChance + ac);
    const st = this.stats;
    const cond = (st.highHpDmg && this.hp >= this.maxHp * HIGH_HP - 1e-6 ? 1 + st.highHpDmg : 1) * (1 + (this.levelBonus || 0)) * (st.highEnergyDmg && this.energy > HIGH_ENERGY ? 1 + st.highEnergyDmg : 1); // Unscathed Might, Seasoned, Energetic Balance
    let dmg = base * cond * this.stats.baseDamage * (this.dmgMul || 1) * (this.adminMul || 1) * this.artDmgMul(w) * (this.rageT > 0 ? (this.rageMul || 2) : 1) * (this.rushT > 0 ? this.rushMul : 1);
    if (crit) dmg *= 1 + this.stats.critDamage + critAdd; // (critAdd: Crossed Blades on the katanas' basic slashes)
    // a little luck on every hit: ±12% around the base (at least ±1, so small hits vary too)
    const roll = Math.random() * 2 - 1;
    dmg += roll * Math.max(dmg * DAMAGE_SPREAD, 1);
    this.lastRoll = { r: roll, t: this.g.time }; // (where in the range it landed: the damage number is drawn a little bigger near the top)
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  }

  resetForLevel(x, y) {
    this.x = x; this.y = y; this.vx = this.vy = this.kvx = this.kvy = 0; this.z = 0;
    this.aimX = -0.7071; this.aimY = -0.7071;
    this.dash.t = 0; this.leap = null; this.spin = null; this.anim = null; this.timers = []; this.afterimages = [];
    this.actionT = 0;
    this.flurry = null; this.rageT = 0; this.wisdomT = 0; this.elemStormT = 0; this.windT = 0; this.charge = null; this.stunT = 0;
    this.bash = null; this.guard = null; this.reflectT = 0; this.switchT = 0; this.swap = null; this.finisher = null;
    this.vault = null; this.vaultBuf = null; this.hop = null; this.disc = null; this.orbDrop = null; this.storm = null; this.waltz = null;
    for (const w of this.weapons) { w.empower = 0; }
    // Battle Rush bought last level: the bonus runs for the first seconds of this one
    if (this.nextRush > 0 && !this.g.restStop) { this.rushMul = 1 + this.nextRush; this.rushT = 1e5; this.nextRush = 0; } else this.rushT = 0; // (Rice Wine: lasts the whole level)
    if (this.downed) { this.downed = false; this.hp = Math.max(this.hp, PLAYER_BASE.reviveHp); this.iframes = 1.5; }
    // co-op: a fallen player sits out until their return level (coopReturnAfter levels after they fell)
    if (this.dead && this.g.level >= (this.returnLevel || 0)) { this.dead = false; this.returnLevel = 0; this.hp = Math.max(this.hp, PLAYER_BASE.coopReviveHp); this.iframes = 1.5; }
  }

  updateAim() {
    const g = this.g, c = this.ctl;
    if (c.aimStick.active) {
      const [wx, wy] = screenDirToWorld(c.aimStick.x, c.aimStick.y);
      this.aimX = wx; this.aimY = wy; this.aimMode = 'stick'; this.autoTarget = null;
      return;
    }
    if (c === input.players[0] && c.mode === 'kbm') {
      const [mx, my] = g.mouseWorld();
      const dx = mx - this.x, dy = my - this.y, l = Math.hypot(dx, dy);
      if (l > 0.05) { this.aimX = dx / l; this.aimY = dy / l; }
      this.aimMode = 'mouse';
      return;
    }
    // controller without right stick: auto-aim nearest enemy, else move direction
    let best = null, bd = 9;
    for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < bd) { bd = d; best = e; }
    }
    // crossbow: stay on the enemy the bolts have marked (while it is in reach), so the marks can be finished
    let ME = null, MN = 0; // (the most-marked enemy)
    if (this.cbMarks && this.cbMarks.size) { for (const [q, n] of this.cbMarks) if (!q.dead && n > MN) { MN = n; ME = q; } }
    else if (this.netMarks) for (const m of this.netMarks) if (m.n > MN) { const q = g.enemies.find((o) => o.id === m.id); if (q) { MN = m.n; ME = q; } }
    if (ME && !ME.dead && !ME.hidden && ME.state !== 'spawn' && Math.hypot(ME.x - this.x, ME.y - this.y) < 11) { best = ME; bd = Math.hypot(ME.x - this.x, ME.y - this.y); }
    this.autoTarget = best;
    if (best) { const l = bd || 1; this.aimX = (best.x - this.x) / l; this.aimY = (best.y - this.y) / l; this.aimMode = 'auto'; }
    else if (this.moveX || this.moveY) { const l = Math.hypot(this.moveX, this.moveY); this.aimX = this.moveX / l; this.aimY = this.moveY / l; this.aimMode = 'move'; }
  }

  // shared timers (local and host-side remote players)
  tickCommon(dt) {
    this.rageT = Math.max(0, this.rageT - dt);
    this.wisdomT = Math.max(0, (this.wisdomT || 0) - dt);
    this.elemStormT = Math.max(0, (this.elemStormT || 0) - dt);
    this.windT = Math.max(0, (this.windT || 0) - dt);
    // Afterimage: a dash that just ended opens its 1 s window
    { const dashing = this.dash.t > 0; if (this.wasDash && !dashing) this.afterWin = AFTERIMAGE_T; this.wasDash = dashing; }
    this.afterWin = Math.max(0, (this.afterWin || 0) - dt);
    // katanas: the last cut is still sharp for a moment (arrows flying into it are cut)
    if (this.cutWin && this.cutWin.t > 0) { this.cutWin.t -= dt; if (!this.netClient) { const C = this.cutWin; this.cutProjectiles(C.range, C.arcDeg, C.aim, false); } }
    // seconds since the last attack (Still Breath): any attack lock, charge or channel resets it
    this.idleT = this.actionT > 0 || this.charge || this.spin || this.flurry || this.storm || this.waltz ? 0 : (this.idleT || 0) + dt;
    // Light Feet: the speed holds for a moment after the last hit, then drains away quickly
    if (this.lfStacks > 0) {
      this.lfT += dt;
      const LF = this.anyArt('lightFeet');
      if (!LF) this.lfStacks = 0;
      else if (this.lfT > LF.hold) this.lfStacks = Math.max(0, this.lfStacks - dt * (LF.max / LF.per) / LF.decay);
    }
    this.popT -= dt;
    if (this.popT <= 0) { this.popT = 0.35; if (!this.netClient) this.flushPops(); }
    if (!this.g.cleared) this.rushT = Math.max(0, this.rushT - dt);
    // talent cooldowns freeze once the level is cleared (no waiting around for them to refill)
    if (!this.g.cleared) for (const t of this.talents) t.cd = Math.max(0, t.cd - dt);
    if (this.flurry) this.updateFlurry(dt);
  }

  // solo, a life spent: lie on the ground (the broken heart shows), rise up into the air, land, fight on
  updateRelife(dt) {
    const g = this.g, R = this.relife, L = RELIFE;
    R.t += dt; this.flash = Math.max(0, (this.flash || 0) - dt); this.hurtT = 0;
    const t1 = L.lie, t2 = t1 + L.rise, t3 = t2 + L.hang, t4 = t3 + L.drop;
    if (R.t < t1) { this.z = 0; return; }
    if (!R.up) { R.up = true; sfx.chime(0.8); g.particles.burst('glow', this.x, this.y, 0.4, 16, 2.5, 0.8, 3, '#ffe0b0'); }
    if (R.t < t2) { const k = (R.t - t1) / L.rise; this.z = L.height * (1 - (1 - k) * (1 - k)); if (Math.random() < dt * 30) g.particles.emit('glow', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), this.z * 0.5, 0, 0, -1, 0.6, 2, '#ffe6b8'); return; }
    if (R.t < t3) { this.z = L.height; return; }
    if (R.t < t4) { const k = (R.t - t3) / L.drop; this.z = L.height * (1 - k * k); return; }
    // landed
    this.z = 0; this.downed = false; this.relife = null; this.hp = this.maxHp; this.iframes = L.iframes;
    g.shake(6);
    g.fx.ring(this.x, this.y, 1.8, 'rgba(255,230,180,0.95)', 0.45, 5);
    g.particles.burst('dust', this.x, this.y, 0.05, 14, 3, 0.6, 5, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
    for (const e of g.enemies) { // the landing pushes everyone close away
      if (e.dead) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d < 2.2 && d > 0.01 && !e.boss) { e.kvx = (e.kvx || 0) + (dx / d) * 7; e.kvy = (e.kvy || 0) + (dy / d) * 7; }
    }
    sfx.slam ? sfx.slam() : sfx.dash();
  }
  // co-op: lying down, waiting for the partner to revive us
  updateDowned(dt) {
    const g = this.g;
    if (this.relife) { this.updateRelife(dt); return; }
    if (this.netClient) return; // the host decides
    this.downT -= dt;
    const helper = g.players.find((o) => o !== this && o.active && Math.hypot(o.x - this.x, o.y - this.y) < PLAYER_BASE.reviveRange);
    this.reviveP = helper ? this.reviveP + dt : Math.max(0, this.reviveP - dt * 0.5);
    if (helper && Math.random() < dt * 10) g.particles.emit('glow', this.x + rand(-0.4, 0.4), this.y + rand(-0.4, 0.4), 0.3, 0, 0, 1, 0.6, 2, '#9dffb0');
    if (this.reviveP >= PLAYER_BASE.reviveTime) {
      this.downed = false; this.hp = PLAYER_BASE.reviveHp; this.iframes = 2; this.reviveP = 0;
      g.fx.ring(this.x, this.y, 1.6, 'rgba(140,255,170,0.9)', 0.6, 5);
      g.banner({ title: `Player ${this.index + 1} is back!`, dur: 1.6, y: 0.25, size: 26 });
      sfx.chime(2);
    } else if (this.downT <= 0) {
      this.downed = false; this.dead = true; this.deadT = 0;
      g.onPlayerDeath(this);
    }
  }

  update(dt) {
    const g = this.g, c = this.ctl;
    if (this.dead) { this.deadT += dt; return; }
    if (this.downed) { this.updateDowned(dt); this.vx = this.vy = 0; this.moveAmt = 0; return; }
    this.tickCommon(dt);
    const st = this.stats;
    if (!g.cleared) { // no regeneration once the last enemy of the level is down
      if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + st.healthRegen * dt); // (never eats overheal)
      this.energy = Math.min(this.maxEnergy, this.energy + st.energyRegen * (st.idleEnergy && this.idleT >= IDLE_ENERGY_T ? 1 + st.idleEnergy : 1) * dt); // (Still Breath)
    }
    this.iframes = Math.max(0, this.iframes - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.chillT = Math.max(0, this.chillT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.dash.cd = Math.max(0, this.dash.cd - dt * this.wisdomSpeed() * (this.windT > 0 ? 1 / (1 - TALENTS.windStep.cut) : 1)); // (Wind Step: -95%)
    if (this.dashCharges === undefined) this.dashCharges = this.dashMax;
    if (this.dashCharges < this.dashMax && this.dash.cd <= 0) { this.dashCharges++; if (this.dashCharges < this.dashMax) { this.dash.cd = this.dashCooldown; this.dash.cdMax = this.dash.cd; } } // (one charge back at a time)
    this.switchT = Math.max(0, this.switchT - dt);
    this.ironT = Math.max(0, (this.ironT || 0) - dt);
    if (this.pools || this.zones || this.weapons.some((q) => q.key === 'gloves')) this.updateZones(dt); // (the gloves: Crushing Stone ticks there)
    { const ws = this.wisdomSpeed(), fz = this.g.cleared ? 0 : 1, as = dt * this.rageSpeed() * ws, wd = dt * ws * fz; for (const w of this.weapons) { w.cd = Math.max(0, w.cd - as * fz); w.ccd = Math.max(0, (w.ccd || 0) - wd); w.scd = Math.max(0, w.scd - wd); w.comboT = Math.max(0, (w.comboT || 0) - dt); this.boDecay(w, dt); w.lockT = Math.max(0, (w.lockT || 0) - as); } }

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]; tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    if (this.finisher) { updateFinisher(this, dt); return; } // a finishing move plays out on its own
    this.updateSecondaries(dt);

    const frozen = g.inputLocked;
    if (this.anchorT > 0) this.anchorT -= dt; // (the gloves' stomp: rooted for a moment)
    if (this.quakeT > 0) this.quakeT -= dt;  // (Earthen Prison: the basic recovers faster)
    const mi = frozen || this.anchorT > 0 ? 0 : Math.hypot(c.move.x, c.move.y);
    if (mi > 0.01) { const [wx, wy] = screenDirToWorld(c.move.x, c.move.y); this.moveX = wx * mi; this.moveY = wy * mi; }
    else { this.moveX = 0; this.moveY = 0; }
    if (!frozen) this.updateAim();

    if (!frozen && this.stunT <= 0 && c.pressed('dash') && this.dash.t <= 0 && (this.dashCharges ?? 1) > 0 && !this.leap && !this.bash && !this.guard && !this.vault && !this.hop && this.energy >= PLAYER_BASE.dash.cost) this.startDash();

    if (this.dash.t > 0) {
      this.updateDash(dt);
      // Shadow Passage: the first enemy this dash passes through gives energy (once per dash)
      if (this.stats.dodgeEnergy && !this.dash.thru) for (const e of g.enemies) {
        if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro' || e.preview) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) < e.r + this.r) { this.dash.thru = true; this.gainEnergy(this.stats.dodgeEnergy, true); g.fx.ring(e.x, e.y, 0.6, 'rgba(180,150,255,0.85)', 0.25, 3); break; }
      }
    } else if (this.leap) {
      this.updateLeap(dt);
    } else if (this.bash) {
      this.updateBash(dt);
    } else if (this.vault) {
      this.updateVault(dt);
    } else if (this.hop) {
      this.updateHop(dt);
    } else if (this.waltz) {
      this.updateWaltz(dt);
    } else {
      const spd = PLAYER_BASE.speed * st.moveSpeed * (st.lowHpSpeed && this.hp < this.maxHp * LOW_HP ? 1 + st.lowHpSpeed : 1) * (this.weaponMove || 1) * (this.slowT > 0 ? 0.45 : 1) * (this.spin ? 0.8 : 1) * (this.flurry ? 0.4 : 1) * (this.storm ? 0.5 : 1) * (this.charge ? 0.7 : 1) * (this.guard ? this.guard.def.move : 1) * this.lightFeetMul() * (this.stunT > 0 ? 0 : 1) * (1 - (this.chillT > 0 ? this.chill : 0));
      const tx = this.moveX * spd, ty = this.moveY * spd;
      const k = 1 - Math.exp(-18 * dt);
      this.vx = lerp(this.vx, tx, k); this.vy = lerp(this.vy, ty, k);
      this.x += (this.vx + this.kvx) * dt; this.y += (this.vy + this.kvy) * dt;
      const kd = Math.exp(-8 * dt); this.kvx *= kd; this.kvy *= kd;
      g.world.collide(this);
    }
    const sp = Math.hypot(this.vx, this.vy);
    this.moveAmt = lerp(this.moveAmt, clamp(sp / PLAYER_BASE.speed, 0, 1), 1 - Math.exp(-12 * dt));
    this.walk += sp * dt * 2.6;

    this.rippleT -= dt;
    if (sp > 1 && this.rippleT <= 0 && this.dash.t <= 0) {
      this.rippleT = 0.22;
      if (g.world.inPaddy(this.x, this.y)) g.fx.ring(this.x, this.y, 0.6, 'rgba(255,255,255,0.7)', 0.6, 1.5);
      else if (g.world.bi === 2) g.particles.emit('dust', this.x, this.y, 0.05, rand(-0.3, 0.3), rand(-0.3, 0.3), 0.3, 0.5, 3, '#f4f8ff', { under: true });
    }

    if (!frozen && this.stunT <= 0) this.noteDenied(c);
    // talents (LB / LT / RB / RT or 1 / 2 / 3 / 4)
    if (!frozen && this.stunT <= 0) ['t1', 't2', 't3', 't4'].forEach((a, i) => { if (c.pressed(a)) this.useTalent(i); });

    // the monk staff's quiet glow: golden motes drift up around its bearer
    // the spirit orb: pale souls drift up off it
    if (this.weapons[this.activeSlot].key === 'orb' && !this.orbDrop && this.active && Math.random() < dt * 4) g.particles.emit('glow', this.x + this.aimX * 0.3 + rand(-0.15, 0.15), this.y + this.aimY * 0.3 + rand(-0.15, 0.15), rand(1.0, 1.3), 0, 0, 0.6, 0.9, 1.8, Math.random() < 0.5 ? GHOST : '#e6f6ff', { drag: 0.6 });
    if (this.weapons[this.activeSlot].key === 'staff' && this.active && Math.random() < dt * 3) g.particles.emit('ember', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.9, 1.4), 0, 0, 0.5, 1.2, 1.3, Math.random() < 0.5 ? '#ffe7a0' : '#d8f0ff', { drag: 0.6 });
    // crossbow and heavy sword basics: hold to charge, release to attack
    if (this.charge) {
      const ch = this.charge;
      ch.t += dt;
      const k = this.chargeFrac(), heavy = this.weapons[ch.slot].key === 'heavy';
      if (k < 0.999) heavy ? sfx.heavyCharge(k) : sfx.stringDraw(k);
      else if (!ch.full) { // fully charged: a click / a ring, and a little flash
        ch.full = true;
        if (heavy) { sfx.heavyReady(); g.fx.ring(this.x, this.y, 1.1, 'rgba(255,214,140,0.9)', 0.35, 3); } else sfx.stringLock();
      }
      if (heavy && Math.random() < dt * (6 + 24 * k)) { // dust and embers drawn in toward the blade
        const a = rand(0, TAU), r = rand(0.9, 1.6);
        g.particles.emit(k > 0.6 ? 'ember' : 'dust', this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 0.1, -Math.cos(a) * r * 2.4, -Math.sin(a) * r * 2.4, 0.8, 0.4, k > 0.6 ? 1.6 : 2.6, k > 0.6 ? '#ffc070' : (g.world.bi === 2 ? '#eef3fb' : '#c8b088'), { drag: 0.5 });
      }
      if (frozen || this.stunT > 0) this.charge = null;
      else if (!c.down('sec')) this.releaseCharge(); // (the heavy cleave: hold the secondary)
    }
    // attacks: each weapon has its own lock, so both weapons can attack at the same time.
    // Whole-body moves (whirlwind spin, thousand strikes, ground-slam leap, dash) still block both.
    if (this.guard) this.updateGuard(dt);
    if (this.reflectT > 0) this.reflectT -= dt;
    { // the Shishi shield turns back shots only while charging (the bash dash, and a moment after); for a while after
      // a bash or the Bulwark, shots that do hit you deal half damage (projMul)
      const SW = this.weapons.find((x) => x.key === 'shield');
      if (SW && SW.activeT > 0) SW.activeT -= dt;
      if (SW && this.active && (this.bash || this.reflectT > 0)) this.reflectAround(SW);
    }
    // one weapon: X (left mouse) basic, Y (right mouse) secondary, B (Q / E) special
    const busy = () => this.dash.t > 0 || this.leap || this.spin || this.flurry || this.bash || this.guard || this.vault || this.hop || this.charge || this.storm || this.waltz;
    // the bo strikes in the air during the Pole Vault; the special pressed in the air waits for the landing
    if (this.vault && !frozen && this.stunT <= 0 && this.vault.w.lockT <= 0 && c.down('atk')) this.tryBasic(0);
    else if (this.vault && !frozen && c.pressed('spc')) this.vaultBuf = 'spc';
    if (!frozen && this.stunT <= 0 && !busy()) {
      const w = this.weapons[0];
      if (this.vaultBuf) { // landed from the Pole Vault: the attack pressed in the air goes off straight away
        const b = this.vaultBuf; this.vaultBuf = null; w.lockT = 0;
        if (b === 'spc') this.trySpecial(0); else this.tryBasic(0);
      }
      if (w.lockT <= 0 && c.down('spc')) this.trySpecial(0);
      if (w.lockT <= 0 && !busy() && c.down('sec')) {
        // the heavy cleave: hold to charge, release to swing
        if (w.key === 'heavy') { if (w.ccd <= 0 && this.energy >= this.kiCost(w.def.secondary)) this.charge = { slot: 0, t: 0 }; }
        else this.trySecondary(0);
      }
      if (w.lockT <= 0 && !busy() && c.down('atk')) this.tryBasic(0);
    }

    if (this.swap) { this.swap.t += dt; if (this.swap.t >= this.swap.dur) { this.activeSlot = this.swap.to; this.swap = null; } }
    if (this.spin) this.updateSpin(dt);
    if (this.anim) { this.anim.t += dt / this.anim.dur; if (this.anim.t >= 1) this.anim = null; }
    for (let i = this.afterimages.length - 1; i >= 0; i--) { const a = this.afterimages[i]; a.life -= dt; if (a.life <= 0) this.afterimages.splice(i, 1); }
  }

  // a press on something that isn't ready (its cooldown, not enough ki, no dash left): the HUD blinks it red
  noteDenied(c) {
    const w = this.weapons[0], now = performance.now() / 1000, deny = (k) => { (this.denyAt || (this.denyAt = {}))[k] = now; };
    const check = (btn, kind, def, cd) => {
      if (!def || !c.pressed(btn)) return;
      const cost = this.kiCost(def, kind === 'basic' ? null : w);
      if (cd > 0.12 || (cost > 0 && this.energy < cost)) deny(kind);
    };
    check('atk', 'basic', w.def.basic, w.cd || 0);
    check('sec', 'secondary', w.def.secondary, w.ccd || 0);
    check('spc', 'special', w.def.special, w.scd || 0);
    if (c.pressed('dash') && this.dash.t <= 0 && ((this.dashCharges ?? 1) <= 0 || this.energy < PLAYER_BASE.dash.cost)) deny('dash');
    ['t1', 't2', 't3', 't4'].forEach((a, i) => { const T = this.talents[i]; if (T && T.cd > 0 && c.pressed(a)) deny('t' + i); });
  }
  lock(t, w = this.weapons[this.activeSlot]) {
    const v = t * this.cdMulFor(w); this.actionT = v; this.actionMax = v; w.lockT = v; w.lockMax = v;
    this.lastSlot = this.weapons.indexOf(w); this.switchT = v + WEAPON_SWITCH; // switching weapons has to wait this long
    const g = this.g;
    if (g.noteCombat && g.enemies.some((e) => !e.dead && !e.preview && Math.hypot(e.x - this.x, e.y - this.y) < 7)) g.noteCombat();
  }
  // ki an attack costs after Ki Focus upgrades (specials; the basic attacks of knives / crossbow / heavy sword)
  // (kunai cost 1 each: the fan costs one per kunai it throws)
  kiCost(def, w = null) {
    let c = def.cost || 0;
    if (w && w.key === 'knives' && def === w.def.special) { const FS = this.art(w, 'fanStorm'); if (FS) c = FS.count; if (this.stormCostMul) c *= this.stormCostMul; } // (Endless Storm: +10%)
    if (this.wisdomT > 0) c *= 1 - (this.wisdomCut || 0); // Wisdom
    return Math.max(def.cost ? 1 : 0, Math.round(c * (this.stats.kiCost ?? 1)));
  }

  chargeFrac() {
    if (!this.charge) return 0;
    const w = this.weapons[this.charge.slot], k = clamp(this.charge.t / this.chargeTimeOf(w), 0, 1);
    return w.key === 'heavy' ? k : ease.outQuad(k); // the heavy sword's damage grows evenly with the charge
  }
  releaseCharge() {
    const ch = this.chargeFrac(), slot = this.charge.slot;
    this.charge = null;
    this.trySecondary(slot, { ch });
  }
  // low-opacity strip on the ground showing how far the drawn bolt will fly
  // Controller aim guide (on the ground, light grey): aiming with the right stick shows where the weapon in hand
  // will hit (a cone for blades and the bo, a lane for bolts, knives and the bash, the burst of the staff);
  // auto-aim instead rings the enemy it is locked on to.
  drawAimGuide(ctx) {
    if (!this.active || this.dead || this.downed || this.ctl.mode !== 'pad') return;
    const S = 45.25;
    if (this.aimMode === 'auto') {
      const e = this.autoTarget;
      if (!e || e.dead) return;
      const R = (e.r + 0.28) * S, pulse = 1 + 0.06 * Math.sin(this.g.time * 6);
      ctx.save(); ctx.translate(isoX(e.x, e.y), isoY(e.x, e.y));
      ctx.strokeStyle = 'rgba(236,236,236,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, R * pulse * 0.72, R * pulse * 0.36, 0, 0, TAU); ctx.stroke();
      ctx.restore();
      return;
    }
    if (this.aimMode !== 'stick' || this.charge || this.dash.t > 0) return;
    const w = this.weapons[0], def = w.def.basic;
    ctx.save();
    ctx.translate(isoX(this.x, this.y), isoY(this.x, this.y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4); ctx.rotate(Math.atan2(this.aimY, this.aimX));
    ctx.fillStyle = 'rgba(236,236,236,0.14)'; ctx.strokeStyle = 'rgba(236,236,236,0.45)'; ctx.lineWidth = 2;
    const cone = (r, arc) => { const h = (arc / 2) * Math.PI / 180; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r * S, -h, h); ctx.closePath(); ctx.fill(); ctx.stroke(); };
    const lane = (len, wid, from = 0.4) => { ctx.fillRect(from * S, -wid * S / 2, (len - from) * S, wid * S); ctx.strokeRect(from * S, -wid * S / 2, (len - from) * S, wid * S); };
    if (w.key === 'katanas' || w.key === 'heavy' || w.key === 'bo') cone(def.range, def.arc);
    else if (w.key === 'gloves') lane(def.range, 0.4);
    else if (w.key === 'shield') { lane(def.dash, 0.7, 0.3); ctx.translate(def.dash * S, 0); cone(def.range, def.arc); }
    else if (w.key === 'knives') lane(def.range, 0.3);
    else if (w.key === 'crossbow') lane(def.maxRange, 0.32);
    else if (w.key === 'staff') { lane(def.range, 0.3); ctx.beginPath(); ctx.arc(def.range * S, 0, def.radius * S, 0, TAU); ctx.fill(); ctx.stroke(); }
    else if (w.key === 'orb') lane(def.seek, 0.45);
    ctx.restore();
  }

  // crossbow marks: one or two crimson rings with arrow notches turning around every marked enemy, on the ground
  // (distinct from the pale auto-aim ring). The joiner gets the marks from the host's snapshots (netMarks).
  drawBoltMarks(ctx, t) {
    if (!this.active) return;
    const list = this.netClient || this.puppet ? (this.netMarks || []).map((m) => ({ e: this.g.enemies.find((q) => q.id === m.id), n: m.n })) : [...(this.cbMarks || [])].map(([e, n]) => ({ e, n }));
    for (const M of list) this.drawBoltMark(ctx, M.e, M.n, t);
  }
  drawBoltMark(ctx, e, n, t) {
    const M = { n };
    if (!e || e.dead || e.hidden) return;
    const S = 45.25;
    ctx.save(); ctx.translate(isoX(e.x, e.y), isoY(e.x, e.y)); ctx.scale(1, 0.5);
    for (let i = 0; i < Math.min(2, M.n); i++) {
      const R = (e.r + 0.24 + i * 0.13) * S, a0 = t * (i ? -1.6 : 2.2);
      ctx.strokeStyle = i ? 'rgba(255,150,60,0.6)' : 'rgba(220,50,40,0.6)'; ctx.lineWidth = 1.8;
      for (let q = 0; q < 3; q++) { const a = a0 + (q * TAU) / 3; ctx.beginPath(); ctx.arc(0, 0, R, a + 0.18, a + TAU / 3 - 0.18); ctx.stroke(); }
      ctx.fillStyle = ctx.strokeStyle; // arrowhead notches pointing in
      for (let q = 0; q < 3; q++) { const a = a0 + (q * TAU) / 3; ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(R - 4, 0); ctx.lineTo(R + 3, -3); ctx.lineTo(R + 3, 3); ctx.closePath(); ctx.fill(); ctx.restore(); }
    }
    ctx.restore();
  }

  drawChargeIndicator(ctx) {
    if (!this.charge || !this.active) return;
    const w = this.weapons[this.charge.slot], def = w.def.secondary, k = this.chargeFrac();
    if (w.key === 'heavy') {
      const S = 45.25, R = (def.range + k * def.chargeRange) * S, half = (def.arc / 2) * Math.PI / 180;
      ctx.save();
      ctx.translate(isoX(this.x, this.y), isoY(this.x, this.y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4); ctx.rotate(Math.atan2(this.aimY, this.aimX));
      ctx.fillStyle = `rgba(236,236,236,${0.07 + 0.1 * k})`; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -half, half); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = k >= 0.999 ? `rgba(255,220,130,${0.55 + 0.25 * Math.sin(this.g.time * 18)})` : 'rgba(236,236,236,0.32)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, R, -half, half); ctx.stroke();
      ctx.restore();
      return;
    }
    const len = lerp(def.minRange, def.maxRange, k);
    ctx.save();
    ctx.translate(isoX(this.x, this.y), isoY(this.x, this.y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4);
    ctx.rotate(Math.atan2(this.aimY, this.aimX));
    const S = 45.25, W = 0.32 * S;
    ctx.fillStyle = 'rgba(236,236,236,0.1)'; ctx.fillRect(0.4 * S, -W / 2, (def.maxRange - 0.4) * S, W);
    ctx.fillStyle = `rgba(236,236,236,${0.16 + 0.08 * k})`; ctx.fillRect(0.4 * S, -W / 2, (len - 0.4) * S, W);
    ctx.fillStyle = k >= 0.999 ? 'rgba(255,220,120,0.6)' : 'rgba(240,240,240,0.4)';
    ctx.fillRect(len * S - 3, -W, 6, W * 2);
    ctx.restore();
  }

  // ---------------- talents ----------------
  useTalent(i, tx, ty) {
    const t = this.talents[i];
    if (!t || t.cd > 0 || !this.active) return false;
    const T = TALENTS[t.key];
    if (tx === undefined && T.targeted) [tx, ty] = talentTarget(this.g, this);
    if (tx === undefined) { tx = this.x; ty = this.y; }
    t.cd = talentCd(t) * (this.stats.cooldown || 1); t.cdMax = t.cd;
    if (this.netClient) { net.send('tal', { i, tx, ty }); return true; } // the host performs it
    activateTalent(this.g, this, t, tx, ty);
    return true;
  }
  // host: the joiner used a talent
  forceTalent(i, tx, ty) { const t = this.talents[i]; if (t) { t.cd = 0; this.useTalent(i, tx, ty); } }

  // ---------------- bo: thousand strikes (time slows for everyone else) ----------------
  // A choreographed chain of strikes: each one turns toward the nearest enemy in front and
  // steps in, leaving shadow afterimages. The last move is a heavy finisher.
  updateFlurry(dt) {
    const F = this.flurry, def = F.def, g = this.g;
    F.t += dt;
    const every = def.dur / def.strikes;
    while (F.done < def.strikes && F.t >= F.done * every) {
      const kind = BO_FLURRY[F.done % BO_FLURRY.length];
      F.done++;
      const last = F.done === def.strikes;
      const tgt = this.flurryTarget(3.4);
      if (tgt) {
        const dx = tgt.x - this.x, dy = tgt.y - this.y, d = Math.hypot(dx, dy) || 1;
        this.aimX = dx / d; this.aimY = dy / d;
        const step = Math.min(0.4, Math.max(0, d - tgt.r - 1.1));
        if (step > 0.02 && !this.remote) {
          this.afterimages.push({ x: this.x, y: this.y, z: 0, life: 0.22, max: 0.22, rot: 0, type: 'shadow', facing: this.facingAngle(), pose: this.anim ? { kind: this.anim.kind, t: this.anim.t } : null });
          this.x += this.aimX * step; this.y += this.aimY * step; g.world.collide(this);
        }
      }
      const bw = F.w; bw.comboT = Math.max(bw.comboT || 0, bw.def.basic.comboHold); // the combo holds through the flurry
      const PF = this.art(bw, 'peakForm'), pfMul = PF && (bw.combo || 0) >= 5 ? PF.dmgMul : 1; // Peak Form: max combo doubles the flurry too
      this.boStrike(last ? 'boOverhead' : kind, def.dmg * pfMul, def.range, last ? 6 : 0.8, bw, every * (last ? 2.2 : 1.05), last ? 0.45 : 0.05, def.arc, Math.min(4.5, (F.done - 1) * 0.4), false, (hit) => { if (hit) this.boResult(bw, true); else bw.comboT = Math.max(bw.comboT, bw.def.basic.comboHold); });
      if (last) this.after(every * 2.2 * 0.45, () => { g.hitstop(0.07); g.shake(5); g.fx.ring(this.x + this.aimX * 1.4, this.y + this.aimY * 1.4, 1.6, 'rgba(255,230,170,0.9)', 0.35, 5); });
    }
    if (F.t >= def.dur + every * 1.5) this.flurry = null;
  }
  flurryTarget(range) {
    let best = null, bd = range;
    const aim = Math.atan2(this.aimY, this.aimX);
    for (const e of this.g.enemies) {
      if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro') continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > bd + e.r || Math.abs(angDiff(aim, Math.atan2(dy, dx))) > 1.4) continue;
      bd = d; best = e;
    }
    return best;
  }

  // one bo move: pose + its own hit shape and effect, landing partway through the animation
  // step: pitch of the wooden tok (rises through a combo); finisher: hitstop and a hard knock when it lands
  // onResult(hit): told whether the strike connected (the joiner can't know: it counts as a hit there)
  boStrike(kind, base, range, knock, w, dur, stun = 0.1, arcOverride = null, step = 0, finisher = false, onResult = null) {
    const M = BO_MOVES[kind], g = this.g;
    this.anim = { kind, t: 0, dur };
    this.after(dur * M.at, () => {
      const ax = this.aimX, ay = this.aimY, R = range * M.rng, sa = slashAngle(ax, ay);
      sfx.tok(step);
      if (kind === 'boJab') g.fx.thrust(this.x + ax * 0.3, this.y + ay * 0.3, ax, ay, R, 'rgba(250,232,180,0.95)', 8, 0.13);
      else if (kind === 'boSweep') g.fx.slash(this.x, this.y, sa, R * 0.85, 2.6, 'rgba(240,215,160,0.85)', 9, 0.15, 0.18, 1);
      else if (kind === 'boRise') g.fx.slash(this.x, this.y, sa, R * 0.75, 1.5, 'rgba(240,215,160,0.85)', 8, 0.14, 0.9, -1);
      else if (kind === 'boTwirl') g.fx.slash(this.x, this.y, sa, R * 0.8, TAU * 0.85, 'rgba(240,215,160,0.55)', 6, 0.2, 0.6, 1);
      else { // overhead: short chop with a ground impact
        const ix = this.x + ax * R * 0.75, iy = this.y + ay * R * 0.75;
        g.fx.slash(this.x, this.y, sa, R * 0.7, 0.9, 'rgba(255,238,195,0.95)', 12, 0.15, 0.5, 1);
        g.fx.ring(ix, iy, 0.7, 'rgba(255,240,205,0.85)', 0.25, 3);
        g.particles.burst('dust', ix, iy, 0.05, 5, 1.5, 0.4, 3, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
      }
      // the basic strikes hit one enemy (the one best in line with the aim); the Thousand Strikes flurry hits all in reach
      const hit = this.meleeHit(base, R, arcOverride && kind !== 'boJab' ? Math.max(M.arc, arcOverride) : M.arc, knock * M.knock, stun, w, arcOverride ? null : { single: true });
      if (hit) {
        g.particles.burst('spark', this.x + ax * R * 0.7, this.y + ay * R * 0.7, 0.6, finisher ? 10 : 5, finisher ? 6 : 4, 0.2, 1.4, '#fff2c0');
        if (finisher) { g.hitstop(0.05); g.shake(3.5); g.fx.ring(this.x + ax * R * 0.7, this.y + ay * R * 0.7, 0.9, 'rgba(255,236,190,0.9)', 0.25, 4); }
      }
      onResult?.(this.netClient ? this.enemyInArc(R, arcOverride && kind !== 'boJab' ? Math.max(M.arc, arcOverride) : M.arc) : hit);
    });
  }

  // ---------------- dash ----------------
  startDash() {
    const D = PLAYER_BASE.dash;
    let dx = this.moveX, dy = this.moveY;
    if (Math.hypot(dx, dy) < 0.1) { dx = this.aimX; dy = this.aimY; }
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    // a tactical move: flips and vaults when closing in, aerials and slides when strafing (still facing the
    // aim), a backflip when breaking away; never the same move twice in a row
    const dot = dx * this.aimX + dy * this.aimY, dir = dot > 0.35 ? 'forward' : dot < -0.35 ? 'back' : 'side';
    const choose = () => { const L = DASH_CHOICES[dir], tot = L.reduce((a, [, w]) => a + w, 0); let r = Math.random() * tot; for (const [m, w] of L) { r -= w; if (r <= 0) return m; } return L[0][0]; };
    let type = choose();
    if (type === this.lastDash) type = choose();
    if (this.dashDistMul > 1) type = 'launch'; // Stone Launch: always the rock's throw
    this.lastDash = type;
    this.spendEnergy(D.cost);
    const d = this.dash;
    d.type = type; d.dur = DASH_MOVES[type].long ? D.jumpDuration * (DASH_MOVES[type].spin ? 1.15 : 1) : D.duration * (type === 'slide' ? 1.25 : 1); d.t = d.dur;
    d.ax = this.aimX; d.ay = this.aimY;
    d.dx = dx; d.dy = dy; d.sx = this.x; d.sy = this.y; d.thru = false;
    if (this.dashDistMul > 1 || this.dashHurt) { // Stone Launch: a rock bursts up under you and throws you further, and it hurts
      const g = this.g;
      g.fx.rise(this.x, this.y, 0.1); g.fx.quake(this.x, this.y, 0.9, 0.35); // the rock breaks out of the ground right under your feet
      g.particles.burst('shard', this.x, this.y, 0.3, 14, 5, 0.6, 3.2, '#6a4a2c', { grav: 16, bounce: true });
      g.particles.burst('dust', this.x, this.y, 0.05, 10, 3, 0.5, 5, g.world.bi === 2 ? '#e8eef6' : '#8a6a44', { under: true });
      sfx.heavyThud(0.5); sfx.slam(); g.shake(3);
      d.rockLand = true;
      if (this.dashHurt && !this.netClient && !g.god) { this.hp = Math.max(1, this.hp - this.dashHurt); g.fx.text(this.x, this.y, `-${this.dashHurt}`, '#ff8a7a', 12); }
    }
    this.dashCharges = Math.max(0, (this.dashCharges ?? 1) - 1);
    if (d.cd <= 0) { d.cd = this.dashCooldown + d.dur; d.cdMax = d.cd; } // (already recharging another charge: that timer keeps running)
    d.trail = 0;
    this.iframes = Math.max(this.iframes, d.dur + 0.06);
    this.anim = null; this.spin = null; this.actionT = 0; this.charge = null; this.storm = null;
    sfx.dash();
    const g = this.g;
    if (type === 'shadow') {
      g.particles.burst('ink', this.x, this.y, 0.6, 14, 3, 0.5, 4, '#2a1a40');
      g.particles.burst('smoke', this.x, this.y, 0.3, 6, 1.5, 0.6, 7, 'rgba(60,40,90,1)');
    } else {
      g.particles.burst('dust', this.x, this.y, 0.05, 6, 1.5, 0.5, 4, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
    }
    if (this.dodgeThreat()) { // Perfect dodge: dashed out of a hit about to land: a very short slow motion
      g.slow(PERFECT_DODGE.dur, PERFECT_DODGE.scale);
      g.fx.text(this.x, this.y, 'Perfect!', '#e8f4ff', 15);
      g.fx.ring(this.x, this.y, 1.3, 'rgba(220,240,255,0.95)', 0.35, 4);
      sfx.chime(1.6);
      if (this.stats.perfectEnergy) this.gainEnergy(this.stats.perfectEnergy, true); // Perfect Focus
    }
  }
  // Is an enemy attack about to land (within PERFECT_DODGE.window s) where the player stands? Its telegraph shape
  // (the same rule as the hit: the player's centre inside it), or a ground blast / seal about to go off.
  dodgeThreat() {
    const g = this.g, W = PERFECT_DODGE.window, px = this.x, py = this.y;
    for (const e of g.enemies) {
      const T = e.tele;
      if (e.dead || !T || e.state !== 'windup' || e.t > W) continue;
      if (T.kind === 'arc' || T.kind === 'cone') {
        const dx = px - e.x, dy = py - e.y, d = Math.hypot(dx, dy);
        if (d <= T.range && (T.arc >= TAU || d < 0.2 || Math.abs(angDiff(T.angle, Math.atan2(dy, dx))) <= T.arc / 2)) return true;
      } else if (T.kind === 'line' || T.kind === 'fan') {
        for (const a of T.kind === 'fan' ? T.angles : [T.angle]) {
          const ux = Math.cos(a), uy = Math.sin(a), dx = px - e.x, dy = py - e.y, along = dx * ux + dy * uy;
          if (along >= 0 && along <= T.len && Math.abs(dx * uy - dy * ux) <= (T.width || 0.22) / 2 + 0.15) return true;
        }
      } else if (T.kind === 'circle') {
        if (Math.hypot(px - T.x, py - T.y) <= Math.max(T.r, T.outer || 0)) return true;
      }
    }
    // enemies already moving in for the hit (a lunge, a charge, a dive, a dash) with you in their lane
    for (const e of g.enemies) {
      const L = e.lane;
      if (e.dead || !L || !DODGE_MOVING.has(e.state)) continue;
      const dx = px - L.ox, dy = py - L.oy, along = dx * L.fx + dy * L.fy;
      if (along >= 0 && along <= L.len + 0.3 && Math.abs(dx * L.fy - dy * L.fx) <= L.width / 2 + 0.15) return true;
    }
    // a leap in the air (the komainu): it lands on its circle when the leap is done
    for (const e of g.enemies) {
      const T = e.tele;
      if (e.dead || e.state !== 'leap' || !T || T.kind !== 'circle' || !e.data || !e.data.dur) continue;
      if ((1 - (T.k || 0)) * e.data.dur <= W && Math.hypot(px - T.x, py - T.y) <= T.r) return true;
    }
    // shots in flight that will pass through you very soon (the same reach as their real hit)
    const WP = W + 0.08;
    for (const q of g.projectiles) {
      if (q.dead || q.owner !== 'enemy' || q.lob) continue;
      const rx = px - q.x, ry = py - q.y, v2 = q.vx * q.vx + q.vy * q.vy;
      if (v2 < 1e-6) continue;
      const tc = clamp((rx * q.vx + ry * q.vy) / v2, 0, WP); // when it comes closest, within the window
      const cx = q.x + q.vx * tc - px, cy = q.y + q.vy * tc - py;
      if (Math.hypot(cx, cy) <= (q.hitR ?? q.r + PROJ_HIT_PAD) + 0.12 && (tc > 0 || Math.hypot(rx, ry) <= (q.hitR ?? q.r + PROJ_HIT_PAD) + 0.12)) return true;
    }
    for (const h of g.hazards) {
      if ((h.kind === 'blast' || h.kind === 'marker' || h.kind === 'seal') && h.t > 0 && h.t <= W && Math.hypot(px - h.x, py - h.y) <= h.r) return true;
      if (h.kind === 'ring' && !(h.hitSet && h.hitSet.has(this)) && !(h.warn > 0) && !(h.gap != null && Math.abs(angDiff(Math.atan2(py - h.y, px - h.x), h.gap)) < h.gapW / 2)) { // a shockwave ring that reaches you within the window
        const d = Math.hypot(px - h.x, py - h.y), gap = d - h.rad, tt = h.speed ? gap / h.speed : Infinity;
        if (Math.abs(gap) <= (h.width || 0.45) + 0.1 || (tt >= 0 && tt <= W)) return true;
      }
      if (h.kind === 'slash' && h.t > 0 && h.t <= W + 0.1) { // Gensai's iai cut about to land along its lane
        const lx = h.x1 - h.x0, ly = h.y1 - h.y0, L = Math.hypot(lx, ly) || 1, ux = lx / L, uy = ly / L, dx = px - h.x0, dy = py - h.y0, along = dx * ux + dy * uy;
        if (along >= -0.3 && along <= L + 0.3 && Math.abs(dx * uy - dy * ux) <= (h.w || 0.75) + 0.15) return true;
      }
    }
    return false;
  }

  updateDash(dt) {
    const d = this.dash, D = PLAYER_BASE.dash, g = this.g;
    d.t -= dt;
    const k = 1 - Math.max(0, d.t) / d.dur;
    const e = d.type === 'shadow' ? ease.outQuad(k) : ease.outCubic(k);
    const px = this.x, py = this.y;
    this.x = d.sx + d.dx * D.distance * (this.dashDistMul || 1) * e; this.y = d.sy + d.dy * D.distance * (this.dashDistMul || 1) * e;
    const hitWall = g.world.collide(this);
    if (hitWall) { d.sx += this.x - (d.sx + d.dx * D.distance * (this.dashDistMul || 1) * e); d.sy += this.y - (d.sy + d.dy * D.distance * (this.dashDistMul || 1) * e); }
    this.vx = ((this.x - px) / dt) * 0.2; this.vy = ((this.y - py) / dt) * 0.2;
    this.pullKunai(); // through an enemy with our kunai in it: pull them out
    const M = DASH_MOVES[d.type] || DASH_MOVES.jump;
    this.z = M.air ? Math.sin(k * Math.PI) * M.air : 0;
    d.trail -= dt;
    if (d.trail <= 0) {
      d.trail = 0.025;
      const A = this.dashLook(d, k);
      this.afterimages.push({ x: this.x, y: this.y, z: this.z, life: d.type === 'shadow' ? 0.35 : 0.2, max: d.type === 'shadow' ? 0.35 : 0.2, rot: A.rot, type: d.type, facing: A.facing, pose: A.pose });
      if (M.slide) g.particles.burst('dust', this.x, this.y, 0.05, 2, 1.2, 0.35, 3, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
    }
    if (d.t <= 0) {
      this.z = 0;
      if (d.rockLand) { d.rockLand = false; g.particles.burst('dust', this.x, this.y, 0.05, 12, 3.5, 0.55, 6, g.world.bi === 2 ? '#e8eef6' : '#8a6a44', { under: true }); g.particles.burst('shard', this.x, this.y, 0.1, 6, 3, 0.4, 2.5, '#6a4a2c', { grav: 14 }); sfx.heavyThud(0.25); g.shake(2); } // (Stone Launch: a heavy landing)
      if (d.type === 'shadow') {
        g.particles.burst('ink', this.x, this.y, 0.6, 12, 3, 0.5, 4, '#2a1a40');
        g.particles.burst('smoke', this.x, this.y, 0.3, 5, 1.2, 0.5, 6, 'rgba(60,40,90,1)');
      } else if (M.air) { // a light landing
        g.particles.burst('dust', this.x, this.y, 0.05, 10, 2.5, 0.5, 5, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
        g.fx.ring(this.x, this.y, 0.9, 'rgba(255,255,255,0.6)', 0.3, 2);
      }
    }
  }

  // how a dash move looks at progress k: body rotation, facing, pose, squash
  dashLook(d, k) {
    const M = DASH_MOVES[d.type] || DASH_MOVES.jump;
    const moveFace = worldDirToScreenAngle(d.dx, d.dy), aimFace = worldDirToScreenAngle(d.ax ?? d.dx, d.ay ?? d.dy);
    let facing = M.faceAim ? aimFace : moveFace, rot = 0, sqy = 1, pose = null;
    const e = ease.inOutSine(k);
    if (M.spin) rot = M.spin * e * TAU;
    if (M.twist) facing = moveFace + e * TAU * M.twist; // a twisting vault: the body turns all the way round
    if (M.squash) sqy = M.squash;
    if (M.tuck) pose = { kind: 'jump', t: k };
    else if (d.type === 'jump') pose = { kind: 'jump', t: k };
    else if (d.type === 'aerial') pose = { kind: 'jump', t: 0.25 + k * 0.5 };
    if (M.slide) { rot = -0.45 * Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * (1 - Math.max(0, k - 0.75) * 4); sqy = 0.8; pose = { kind: 'jump', t: 0.4 }; } // low, leaning back
    return { facing, rot, sqy, pose };
  }

  // ---------------- attacks ----------------
  facingAngle() { return worldDirToScreenAngle(this.aimX, this.aimY); }
  // on the joiner, attacks are only visual; the host performs the real hit
  proj(o, w) { if (this.netClient) return; o.owner = 'player'; o.from = this; o.weapon = w; this.g.spawnProjectile(o); }

  // bo combo: after a while without a hit it falls one level at a time
  boDecay(w, dt) {
    if (w.key !== 'bo' || !(w.combo > 0) || w.comboT > 0) return;
    w.decayT = (w.decayT || 0) + dt;
    if (w.decayT >= w.def.basic.comboDecay) { w.decayT = 0; w.combo--; w.chain = w.combo; }
  }
  // bo combo: a hit raises the combo and cuts the running cooldown to the faster one; a miss loses it
  boResult(w, hit) {
    const def = w.def.basic;
    if (!hit) { w.combo = 0; w.chain = 0; w.comboT = 0; return; }
    const before = w.combo || 0;
    w.combo = Math.min(this.boMax || 5, before + 1); w.chain = (w.chain || 0) + 1; w.comboT = def.comboHold; w.decayT = 0;
    w.cd = Math.max(0, w.cd - (this.boCd(w, before) - this.boCd(w, w.combo)) * this.cdMulFor(w));
  }
  // Heavy Pole: at max combo every swing sends a ring of force out around you (half the swing's damage)
  poleShock(w, def) {
    if (this.dead || !this.active) return;
    const g = this.g, R = 2.6;
    g.fx.ring(this.x, this.y, R, 'rgba(255,226,170,0.9)', 0.3, 5); g.fx.quake(this.x, this.y, R * 0.8, 0.5); sfx.heavyThud(0.4); g.shake(2);
    if (this.netClient) return;
    for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > R + e.r) continue;
      const { dmg, crit } = this.rollDamage(def.dmg * 0.5, w);
      g.damageEnemy(e, dmg, crit, dx / (d || 1), dy / (d || 1), 3, 0.1, { player: this, weapon: w, sound: 'heavyHit' });
    }
  }
  // the bo's swing cooldown at combo level lv: past 5 (Fragile Flow) each level is 8% quicker still;
  // Heavy Pole: slower below max combo, faster at it
  boCd(w, lv) {
    const C = w.def.basic.comboCd, max = this.boMax || 5;
    let cd = C[Math.min(lv, C.length - 1)] * (lv > 5 ? Math.pow(0.92, lv - 5) : 1);
    if (this.heavyPoleSlow && lv < max) cd *= this.heavyPoleSlow;
    if (this.heavyPoleMax && lv >= max) cd *= 0.8;
    return cd;
  }

  // opt.ch = crossbow charge (0..1), opt.cb = bo combo step (sent by the joiner)
  tryBasic(i, opt = {}) {
    const w = this.weapons[i];
    if (w.cd > 0 || this.disc || this.orbDrop || this.waltz) return;
    const def = w.def.basic;
    const cost = this.kiCost(def);
    if (this.energy < cost) return;
    this.spendEnergy(cost);
    if (this.netClient) {
      const cb = w.key === 'bo' ? (w.chain || 0) % 5 : undefined;
      net.send('atk', { slot: i, special: 0, ax: this.aimX, ay: this.aimY, ch: opt.ch, cb });
    }
    w.cd = def.interval * this.cdMulFor(w) * (w.key === 'gloves' && this.quakeT > 0 ? w.def.special.quakeMul : 1); w.cdMax = w.cd;
    const emp = this.takeEmpower(w); // (the bo's Pole Vault: +50% on the next attack)
    this.lock(def.lock, w);
    this.activeSlot = i;
    const g = this.g, ax = this.aimX, ay = this.aimY;
    switch (w.key) {
      case 'gloves': this.glovesBasic(w, def, ax, ay); break;
      case 'katanas': { // light and quick; every 3rd cut of a rhythm is a bigger, brighter one
        w.side = -w.side;
        w.kc = g.time - (w.kLast ?? -9) > 0.9 ? 0 : ((w.kc ?? -1) + 1) % 3; w.kLast = g.time;
        const big = w.kc === 2, sa = slashAngle(ax, ay);
        this.anim = { kind: 'slash', side: w.side, t: 0, dur: Math.max(0.13, this.actionT * 0.85), v: big ? 2 : w.kc % 2 };
        sfx.katana(w.kc);
        const CB = this.art(w, 'crossedBlades');
        if (big) {
          g.fx.slash(this.x, this.y, sa, def.range * 1.0, 2.75, 'rgba(255,255,255,0.95)', 15, 0.2, 0.55, w.side);
          g.fx.slash(this.x, this.y, sa, def.range * 0.78, 2.4, 'rgba(150,205,255,0.6)', 6, 0.24, 0.62, w.side);
          g.particles.burst('spark', this.x + ax * def.range * 0.8, this.y + ay * def.range * 0.8, 0.6, 5, 5, 0.16, 1.1, '#e8f4ff');
        } else g.fx.slash(this.x, this.y, sa, def.range * 0.85, 2.2, 'rgba(235,245,255,0.88)', 8, 0.11, 0.55, w.side);
        // the tip of the blade cuts deepest: enemies at the edge of the reach take edgeMul x damage
        this.after(0.03, () => this.meleeHit(def.dmg, def.range * (big ? 1.08 : 1), def.arc + (big ? 15 : 0), big ? 2.6 : 1.5, 0.12, w, { sound: 'cut', basic: true, edge: def.edge, edgeMul: def.edgeMul * (CB ? CB.tipMul : 1) })); // (Crossed Blades: the tip cuts 25% deeper)
        break;
      }
      case 'heavy': { // Low Sweep: a quick, flat, short swing at knee height
        const quick = 1;
        w.side = -(w.side || 1);
        this.anim = { kind: 'heavySweep', t: 0, dur: 0.36 * quick, side: w.side, v: this.basicVar(w, 3) };
        this.after(0.1 * quick, () => {
          if (!this.active) return;
          sfx.heavyWhoosh(0.15);
          g.fx.slash(this.x, this.y, slashAngle(this.aimX, this.aimY), def.range * 0.92, 2.3, 'rgba(255,238,214,0.92)', 13, 0.17, 0.12, w.side);
          g.particles.burst('dust', this.x + this.aimX * def.range * 0.6, this.y + this.aimY * def.range * 0.6, 0.05, 5, 2, 0.35, 3, g.world.bi === 2 ? '#eef3fb' : '#c8b088', { under: true });
          if (this.meleeHit(def.dmg, def.range, def.arc, def.knock, 0.15, w, { sound: 'heavyHit' })) g.hitstop(0.025);
        });
        break;
      }
      case 'crossbow': {
        this.anim = { kind: 'shoot', t: 0, dur: 0.3, v: this.basicVar(w, 3) };
        const SH = this.art(w, 'steadyHands'), SS = this.art(w, 'snapShot'), HM = this.art(w, 'huntersMark');
        sfx.twang(1);
        // no draw: every bolt flies the full range (Snap Shot: shorter and harder); Twin Bolts: two side by side
        const range = def.maxRange * (SS ? SS.rangeMul : 1), dmg = def.dmg * (SS ? SS.dmgMul : 1), n = SH ? SH.count : 1;
        for (let k = 0; k < n; k++) {
          const o = n > 1 ? (k - (n - 1) / 2) * SH.gap : 0, ox = -ay * o, oy = ax * o;
          this.proj({ kind: 'bolt', x: this.x + ax * 0.4 + ox, y: this.y + ay * 0.4 + oy, z: 0.55, vx: ax * def.speed, vy: ay * def.speed, base: dmg, pierce: def.pierce, r: 0.2, life: range / def.speed, knock: 2.5, sound: 'thunk', shudder: 0.3, mark: HM ? HM.dur : 0, markMul: HM ? HM.mul : 1, cbMark: true }, w);
        }
        this.kvx -= ax * 1.5; this.kvy -= ay * 1.5;
        break;
      }
      case 'knives': {
        w.side = -w.side;
        this.anim = { kind: 'throw', side: w.side, t: 0, dur: 0.2, v: this.basicVar(w, 3) };
        sfx.knifeThrow();
        const a = Math.atan2(ay, ax) + rand(-0.05, 0.05);
        g.particles.burst('spark', this.x + Math.cos(a) * 0.45, this.y + Math.sin(a) * 0.45, 0.65, 2, 3, 0.12, 0.8, '#fff0b8');
        const RC = this.art(w, 'ricochet'), TS = this.art(w, 'thirdCrit');
        const third = false; // (Third Strike counts hits now: see the projectile hit)
        this.proj({ kind: 'kunai', x: this.x + Math.cos(a) * 0.3, y: this.y + Math.sin(a) * 0.3, z: 0.6, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, base: def.dmg, pierce: def.pierce, r: 0.18, life: def.range / def.speed, knock: 1, sound: 'knifeHit', sparks: true, bounce: RC ? RC.bounces : 0, bounceRange: RC ? RC.range : 0, forceCrit: third, golden: third, third3: !!TS, stick: true }, w);
        break;
      }
      case 'bo': { // combo of up to 5: jab, sweep, rising strike, twirl, overhead finisher
        const step = opt.cb ?? (w.chain || 0) % 5, lv = Math.min(this.boMax || 5, w.combo || 0);
        // the cooldown follows the combo level: slower than before at 0, much faster at 5
        const cd = this.boCd(w, lv);
        w.cd = cd * this.cdMulFor(w); w.cdMax = w.cd;
        this.lock(Math.min(def.lock, cd * 0.85), w);
        w.comboT = Math.max(w.comboT || 0, 0.5); // no decay while this swing is still in the air
        if (this.netClient) this.lastCombo = step;
        const fin = step === 4; // the 5th hit: a hard knock and a short hitstop
        const PF = this.art(w, 'peakForm'), LR = this.art(w, 'longReach');
        if (emp > 1) g.fx.text(this.x, this.y, 'Empowered!', '#ffd070', 12);
        this.boStrike(BO_COMBO[step], def.dmg * emp * (PF && lv >= 5 ? PF.dmgMul : 1), def.range * (LR ? 1 + Math.min(LR.max, LR.per * lv) : 1), fin ? def.knock * 3.5 : def.knock, w, Math.max(0.16, this.actionT * 1.1), fin ? 0.3 : 0.1, null, lv, fin, (hit) => this.boResult(w, hit));
        if (this.heavyPoleMax && lv >= (this.boMax || 5)) this.after(0.14, () => this.poleShock(w, def)); // Heavy Pole: a shockwave at max combo
        break;
      }
      case 'shield': { // shield bash: a short dash along the aim that ends in a bash, turning projectiles back on the way
        const CH = this.art(w, 'charge'), dash = def.dash * (CH ? CH.dashMul : 1);
        let bx = ax, by = ay;
        if (this.aimMode === 'auto' || this.aimMode === 'move') { // not aiming: go for the nearest incoming projectile first
          let bq = null, bd = 6.5;
          for (const q of g.projectiles) { if (q.dead || q.owner === 'player' || q.lob || q.boomer) continue; const qd = Math.hypot(q.x - this.x, q.y - this.y); if (qd < bd) { bd = qd; bq = q; } }
          if (bq) { bx = (bq.x - this.x) / (bd || 1); by = (bq.y - this.y) / (bd || 1); this.aimX = bx; this.aimY = by; }
        }
        this.bash = { t: 0, dur: def.dashDur * (CH ? 1.3 : 1), sx: this.x, sy: this.y, dx: bx * dash, dy: by * dash, w };
        this.anim = { kind: 'shieldBash', t: 0, dur: def.dashDur + 0.2, v: this.basicVar(w, 3) };
        sfx.heavyWhoosh(0);
        break;
      }
      case 'staff': { // spirit bolt that bursts into a small area at the first enemy or at max range
        this.anim = { kind: 'staffCast', t: 0, dur: 0.4, v: this.basicVar(w, 3) };
        sfx.shakujo();
        g.particles.burst('ember', this.x + ax * 0.5, this.y + ay * 0.5, 1.1, 5, 1.2, 0.5, 1.4, '#ffe7a0');
        const WB = this.art(w, 'wideBurst'), SP = this.art(w, 'sacredPool');
        // a small light leaves the staff, sways through the air and comes down on the ground (at the mouse, within reach)
        let len = def.range;
        if (this.aimMode === 'mouse') { const [mx, my] = g.mouseWorld(); len = clamp(Math.hypot(mx - this.x, my - this.y), def.minRange, def.range); }
        for (let k = 1; k <= 10; k++) if (g.world.blocked(this.x + ax * len * k / 10, this.y + ay * len * k / 10, 0.05, true)) { len = Math.max(0.6, len * (k - 1) / 10); break; }
        w.side = -(w.side || 1);
        this.proj({ kind: 'lightmote', mote: true, sx: this.x + ax * 0.5, sy: this.y + ay * 0.5, ux: ax, uy: ay, mlen: Math.max(0.3, len - 0.5), mdur: def.flight * (0.6 + 0.4 * len / def.range), mamp: def.sway, mside: w.side, mt: 0,
          x: this.x + ax * 0.5, y: this.y + ay * 0.5, z: 0.9, vx: 0, vy: 0, base: def.dmg, burst: def.radius * (WB ? WB.radiusMul : 1), r: 0.22, life: 9, seed: Math.random() * 9, pool: SP || null, vuln: def.vulnDur, vulnMul: def.vulnMul }, w);
        break;
      }
      case 'orb': { // a slow wisp leaves the orb and hunts the enemy ahead down
        this.anim = { kind: 'orbCast', t: 0, dur: 0.32, v: this.basicVar(w, 3) };
        sfx.wisp();
        g.particles.burst('glow', this.x + ax * 0.5, this.y + ay * 0.5, 1.0, 8, 1.6, 0.5, 2.2, GHOST);
        this.proj({ kind: 'wisp', x: this.x + ax * 0.5, y: this.y + ay * 0.5, z: 0.75, vx: ax * def.speed, vy: ay * def.speed, speed: def.speed, base: def.dmg, pierce: 0, r: 0.3, life: def.life, seek: def.seek, turn: def.turn, knock: 1, seed: Math.random() * 9 }, w);
        break;
      }
    }
  }


  // ---------------- the secondary attack (Y / right mouse) ----------------
  // which of n basic-attack animations to play: a different one from the last (so a run of attacks never looks the same)
  basicVar(w, n) { let v = Math.floor(Math.random() * (n - 1)); if (v >= (w.bv ?? -1)) v++; w.bv = v % n; return w.bv; }
  // the bo's Pole Vault bonus: x empower on the next attack (then gone)
  takeEmpower(w) { if (!(w.empower > 1)) return 1; const m = w.empower; w.empower = 0; return m; }
  trySecondary(i, opt = {}) {
    const w = this.weapons[i], def = w && w.def.secondary;
    if (!def || w.ccd > 0 || this.disc || this.orbDrop || this.waltz || (w.key === 'katanas' && this.spin)) return;
    const cost = this.kiCost(def, w);
    if (this.energy < cost) return;
    this.spendEnergy(cost);
    if (this.netClient) net.send('atk', { slot: i, special: 2, ax: this.aimX, ay: this.aimY, ch: opt.ch });
    w.ccd = (def.cd ?? def.interval) * this.cdMulFor(w); w.ccdMax = w.ccd;
    this.lock(def.lock, w);
    this.activeSlot = i;
    const g = this.g, ax = this.aimX, ay = this.aimY;
    switch (w.key) {
      case 'katanas': { // Whirlwind: spin, cutting everything around you
        const SD = this.art(w, 'stormDancer'), SG = this.art(w, 'singleGale');
        const dur = def.dur * (SD ? SD.durMul : 1);
        this.spin = { t: 0, dur, tick: SG ? dur * 0.35 : 0, ticks: 0, n: SG ? 1 : Math.round(def.ticks * (SD ? SD.durMul * SD.tickMul : 1)), dmg: SG ? def.dmg * def.ticks * SG.dmgMul : def.dmg, radius: def.radius * (SG ? SG.radiusMul : SD ? SD.radiusMul : 1), spinMul: SD ? 1.6 : 1, pull: SD, single: !!SG, def, w };
        this.anim = { kind: 'spin', t: 0, dur };
        sfx.slash();
        if (SD) { // the storm rises: a gust ring, a whirl of leaves and dust, a deep whoosh
          sfx.heavyWhoosh(0.8); g.shake(3);
          g.fx.ring(this.x, this.y, this.spin.radius + SD.pullRange, 'rgba(200,230,255,0.55)', 0.5, 3);
          g.fx.ring(this.x, this.y, this.spin.radius, 'rgba(235,245,255,0.9)', 0.3, 5);
          g.particles.burst('dust', this.x, this.y, 0.05, 18, 6, 0.6, 5, g.world.bi === 2 ? '#f4f8ff' : '#d8c8a8', { under: true });
        }
        break;
      }
      case 'crossbow': { // Backstep Shot: leap back, loose a bolt in the air
        const D = def.hop;
        this.hop = { t: 0, dur: def.dur, sx: this.x, sy: this.y, dx: -ax * D, dy: -ay * D, fired: false, w };
        this.iframes = Math.max(this.iframes, def.dur + 0.05);
        sfx.dash();
        g.particles.burst('dust', this.x, this.y, 0.05, 8, 2.5, 0.45, 4, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
        break;
      }
      case 'heavy': {
        const ch = clamp(opt.ch || 0, 0, 1), charged = ch > 0.15, quick = 1;
        // a tap winds up from the shoulder; a charged blade is already raised, so the blow falls at once
        this.anim = { kind: 'heavyCleave', t: charged ? 0.4 : 0, dur: (charged ? 0.42 : 0.62) * quick };
        this.slowT = 0.5 * quick;
        const delay = (charged ? 0.08 : 0.27) * quick, dustCol = g.world.bi === 2 ? '#eef3fb' : '#c8b088';
        if (!charged) g.particles.burst('dust', this.x, this.y, 0.05, 4, 1, 0.4, 3, dustCol, { under: true }); // feet set for the wind-up
        this.after(delay * 0.55, () => sfx.heavyWhoosh(ch));
        this.after(delay, () => {
          const R = def.range + ch * def.chargeRange, sa = slashAngle(this.aimX, this.aimY);
          sfx.heavyThud(ch);
          g.fx.slash(this.x, this.y, sa, R * 0.9, 2.9, ch > 0.5 ? 'rgba(255,224,160,0.95)' : 'rgba(255,240,220,0.95)', 18 + ch * 10, 0.24, 0.5, 1);
          // impact: a shockwave, dust, chips of stone and a crack in the ground where the blade lands
          const ix = this.x + this.aimX * R * 0.65, iy = this.y + this.aimY * R * 0.65;
          g.fx.ring(ix, iy, 0.9 + ch * 0.9, 'rgba(255,232,190,0.85)', 0.35, 5 + ch * 4);
          g.particles.burst('dust', ix, iy, 0.05, 8 + Math.round(ch * 10), 2.5 + ch * 2, 0.6, 5, dustCol, { under: true });
          g.particles.burst('shard', ix, iy, 0.1, 4 + Math.round(ch * 6), 4, 0.6, 2.5, '#6a5a4a', { grav: 18, bounce: true });
          g.decals.add(ix, iy, 0.45 + ch * 0.4, 'rgba(40,30,25,1)', 6);
          g.shake(4 + ch * 6);
          const DC = this.art(w, 'deepCharge');
          const hit = this.meleeHit(def.dmg * (1 + ch * def.chargeDmg) * (DC ? DC.dmgMul : 1), R, def.arc, def.knock + ch * def.chargeKnock, 0.35 + ch * 0.3, w, { sound: 'heavyHit', slowHit: def.slow, slowDur: def.slowDur });
          if (hit) g.hitstop(0.04 + ch * 0.05);
          if (ch >= 0.999) { g.fx.ring(ix, iy, 2.4, 'rgba(255,200,110,0.9)', 0.45, 7); g.particles.burst('ember', ix, iy, 0.3, 16, 5, 0.6, 2.2, '#ffc070'); g.shake(4); } // a full charge lands with a blast
        });
        break;
      }
      case 'knives': { // Kunai Fan (it was the special)
        this.anim = { kind: 'throw', side: 1, t: 0.25, dur: 0.25 };
        sfx.knifeThrow(); g.later(0.05, () => sfx.knifeThrow()); g.later(0.1, () => sfx.knifeThrow());
        const base = Math.atan2(ay, ax), FS = this.art(w, 'fanStorm'), FB = this.art(w, 'fanBounce');
        const count = FS ? FS.count : def.count, spread = FS ? FS.spread : def.spread;
        for (let k = 0; k < count; k++) {
          const a = base + ((k / (count - 1) - 0.5) * spread * Math.PI) / 180;
          this.proj({ kind: 'kunai', x: this.x + Math.cos(a) * 0.3, y: this.y + Math.sin(a) * 0.3, z: 0.6, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, base: def.dmg, pierce: def.pierce, r: 0.18, life: (def.range / def.speed) * (FS ? FS.lifeMul : 1), knock: 1.2, sound: 'knifeHit', sparks: true, bounce: FB ? FB.bounces : 0, bounceRange: FB ? FB.range : 0, stick: true }, w);
        }
        break;
      }
      case 'staff': { // Halo Sweep: a 45 degree arc of light that reaches far, in a narrow band
        w.side = -(w.side || 1);
        this.anim = { kind: 'haloSweep', t: 0, dur: 0.38, side: w.side };
        sfx.shakujo(); sfx.rin(1.2);
        this.after(0.12, () => {
          if (!this.active) return;
          g.fx.halo(this.x, this.y, Math.atan2(this.aimY, this.aimX), def.range, def.arc, w.side, 0.42, (def.range - def.edge) / def.range);
          if (this.meleeHit(def.dmg, def.range, def.arc, def.knock, 0.12, w, { sound: 'cut', minR: def.range - def.edge })) sfx.chime(1); // (only the edge of the sweep hits)
        });
        break;
      }
      case 'bo': { // Pole Vault: plant the stick and swing up over it; untouchable until you land
        let dx = this.moveX, dy = this.moveY; const l = Math.hypot(dx, dy);
        if (l > 0.1) { dx /= l; dy /= l; } else { dx = ax; dy = ay; }
        // the stick goes into the ground right at your feet (a little ahead), and you swing up and over it
        this.vault = { t: 0, dur: def.dur, sx: this.x, sy: this.y, dx: dx * def.hop, dy: dy * def.hop, px: this.x + dx * 0.35, py: this.y + dy * 0.35, def, w };
        this.vaultBuf = null; w.comboT = Math.max(w.comboT || 0, def.dur + 0.2); // (no combo decay while in the air)
        w.lockT = Math.min(w.lockT, 0.06); this.actionT = Math.min(this.actionT, 0.06); // free to strike almost at once, in the air
        this.anim = null;
        sfx.tok(0); sfx.dash();
        g.particles.burst('dust', this.x + ax * 0.4, this.y + ay * 0.4, 0.05, 6, 1.5, 0.4, 3, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
        break;
      }
      case 'shield': { // Lion Disc: the shield flies once around you and back into the hand
        this.disc = { t: 0, dur: def.dur, a0: Math.atan2(ay, ax), hit: new Set(), def, w, x: this.x, y: this.y };
        this.anim = { kind: 'discThrow', t: 0, dur: 0.3 };
        sfx.heavyWhoosh(0.3);
        break;
      }
      case 'orb': { // Soul Drop: the orb is thrown down in front of you, bursts, then floats back
        // dashed straight down onto the ground at your own feet (Soul Hurl: thrown far, at the enemy aimed at)
        const FD = this.art(w, 'farDrop');
        let tx = this.x + ax * 0.25, ty = this.y + ay * 0.25;
        if (FD) {
          const tg = this.flurryTarget(FD.range);
          if (tg) { tx = tg.x; ty = tg.y; } else { tx = this.x + ax * FD.range * 0.75; ty = this.y + ay * FD.range * 0.75; }
          for (let k = 0; k < 12 && g.world.blocked(tx, ty, 0.2); k++) { tx = lerp(tx, this.x, 0.15); ty = lerp(ty, this.y, 0.15); } // (not inside a wall)
        }
        this.orbDrop = { t: 0, phase: 0, sx: this.x + ax * 0.4, sy: this.y + ay * 0.4, tx, ty, x: this.x, y: this.y, z: 1.1, def, w, far: !!FD };
        this.anim = { kind: 'orbDrop', t: 0, dur: 0.32 };
        sfx.wisp();
        break;
      }
      case 'gloves': { // Rising Crag: an uppercut, and a great rock strikes up at the enemy ahead
        const tgt = this.flurryTarget(def.range), TC = this.art(w, 'twinCrag');
        let px, py, ux = ax, uy = ay;
        if (tgt) { const dx = tgt.x - this.x, dy = tgt.y - this.y, d = Math.hypot(dx, dy) || 1; ux = dx / d; uy = dy / d; px = tgt.x - ux * (tgt.r + 0.3); py = tgt.y - uy * (tgt.r + 0.3); this.aimX = ux; this.aimY = uy; }
        else { px = this.x + ax * def.range * 0.6; py = this.y + ay * def.range * 0.6; }
        this.anim = { kind: 'uppercut', t: 0, dur: 0.48 }; // (the rock bursts up as the fist comes through)
        sfx.heavyWhoosh(0.4);
        g.fx.quake(px, py, 0.9, 0.5);
        g.particles.burst('dust', px, py, 0.05, 8, 2, 0.4, 4, '#7a5a3a', { under: true });
        if (TC) { // Twin Crags: a second rock under the next nearest enemy (or beside the first)
          let o = null, bd = def.range + 1e-3;
          for (const e of g.enemies) { if (e === tgt || e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue; const d = Math.hypot(e.x - this.x, e.y - this.y); if (d < bd) { bd = d; o = e; } }
          let qx, qy, vx2 = ux, vy2 = uy;
          if (o) { const dx = o.x - this.x, dy = o.y - this.y, d = Math.hypot(dx, dy) || 1; vx2 = dx / d; vy2 = dy / d; qx = o.x - vx2 * (o.r + 0.3); qy = o.y - vy2 * (o.r + 0.3); }
          else { qx = px - uy * 1.6; qy = py + ux * 1.6; }
          g.fx.quake(qx, qy, 0.9, 0.5);
          this.after(def.at + 0.06, () => { if (!this.dead && this.active) this.cragStrike(w, def, qx, qy, vx2, vy2); });
        }
        this.after(def.at, () => {
          if (this.dead || !this.active) return;
          this.cragStrike(w, def, px, py, ux, uy);
        });
        break;
      }
    }
  }
  // one Rising Crag bursting up at (px, py), striking along (ux, uy)
  cragStrike(w, def, px, py, ux, uy) {
    const g = this.g, BC = this.art(w, 'breakCrag');
    g.fx.crag(px, py, ux, uy, 1.1);
    sfx.slam(); sfx.heavyHit(); g.shake(6); g.hitstop(0.05);
    g.particles.burst('shard', px + ux * 0.5, py + uy * 0.5, 0.6, 14, 6, 0.7, 3, '#4a3020', { grav: 18, bounce: true });
    g.decals.add(px, py, 0.6, 'rgba(50,34,20,1)', 7);
    if (this.netClient) return;
    const hx = px + ux * 0.6, hy = py + uy * 0.6;
    g.fx.ring(hx, hy, def.radius, 'rgba(255,190,120,0.85)', 0.35, 4); // (exactly the area it hits)
    for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      if (Math.hypot(e.x - hx, e.y - hy) > def.radius + e.r) continue;
      const { dmg, crit } = this.rollDamage(def.dmg, w);
      g.damageEnemy(e, dmg, crit, ux, uy, def.knock, 0.35, { player: this, weapon: w, sound: 'heavyHit' });
      if (BC && !e.dead) { e.vulnT = BC.vulnDur; e.vulnMul = BC.vulnMul; } // Breaking Crag: vulnerable for a while
      this.glovesHit(w);
    }
  }

  // the secondaries that keep going after the button: thrown katanas, the shield disc, the orb drop, the blade storm
  updateSecondaries(dt) {
    const g = this.g;
    if (this.disc) {
      const D = this.disc; D.t += dt;
      const k = Math.min(1, D.t / D.dur), R = D.def.radius * Math.min(1, Math.sin(k * Math.PI) * 1.8), a = D.a0 + k * TAU;
      D.x = this.x + Math.cos(a) * R; D.y = this.y + Math.sin(a) * R; D.spin = (D.spin || 0) + dt * 30;
      if (Math.random() < dt * 30) g.particles.emit('spark', D.x, D.y, 0.6, 0, 0, 0.3, 0.2, 1.3, '#ffd880');
      if (!this.netClient) for (const e of g.enemies) {
        if (e.dead || D.hit.has(e) || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
        if (Math.hypot(e.x - D.x, e.y - D.y) > e.r + 0.65) continue;
        D.hit.add(e);
        const ux = (e.x - this.x) / (Math.hypot(e.x - this.x, e.y - this.y) || 1), uy = (e.y - this.y) / (Math.hypot(e.x - this.x, e.y - this.y) || 1);
        const { dmg, crit } = this.rollDamage(D.def.dmg, D.w);
        g.damageEnemy(e, dmg, crit, ux, uy, D.def.knock, 0.15, { player: this, weapon: D.w, sound: 'heavyHit', shieldHits: 1 });
        g.particles.burst('spark', e.x, e.y, 0.6, 6, 4, 0.2, 1.4, '#ffe6a0');
      }
      if (k >= 1) { this.disc = null; sfx.thump(); g.fx.ring(this.x, this.y, 0.6, 'rgba(255,220,140,0.8)', 0.2, 2); }
    }
    if (this.orbDrop) {
      const O = this.orbDrop, def = O.def; O.t += dt;
      if (O.phase === 0) { // flying down to the spot
        const k = Math.min(1, O.t / (def.flight * (O.far ? 2.4 : 1)));
        O.x = lerp(O.sx, O.tx, k); O.y = lerp(O.sy, O.ty, k); O.z = 1.1 * (1 - k * k) + (O.far ? Math.sin(k * Math.PI) * 1.3 : 0); // (thrown down hard; Soul Hurl: in an arc)
        if (k >= 1) { O.phase = 1; O.t = 0; this.soulDrop(O); }
      } else { // broken: it gathers again in the hand out of drifting light
        O.x = this.x + this.aimX * 0.4; O.y = this.y + this.aimY * 0.4; O.z = 0.9;
        if (Math.random() < dt * 20) { const a = rand(0, TAU); g.particles.emit('glow', O.x + Math.cos(a) * 0.6, O.y + Math.sin(a) * 0.6, 1.1, -Math.cos(a) * 1.2, -Math.sin(a) * 1.2, 0, 0.45, 1.8, GHOST); }
        if (O.t >= def.reform) this.orbDrop = null;
      }
    }
    if (this.storm) { // Blade Storm: one kunai after another, turning all the way around
      const S = this.storm, def = S.def; S.t += dt;
      while (S.done < S.count && S.t >= S.done * S.every) {
        S.done++; S.side = -S.side;
        // aimed: each blade goes to an enemy in reach (the one hit least so far by this storm, then the nearest), a
        // little ahead of where it is running; with nobody in reach the blades keep fanning out all the way round
        const spd = def.speed * S.spd, reach = def.range * 0.95;
        let tgt = null, best = 1e9;
        for (const e of g.enemies) {
          if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro') continue;
          const d = Math.hypot(e.x - this.x, e.y - this.y);
          if (d > reach + e.r) continue;
          const score = ((S.aimed && S.aimed.get(e)) || 0) * 100 + d;
          if (score < best) { best = score; tgt = e; }
        }
        if (tgt) {
          (S.aimed || (S.aimed = new Map())).set(tgt, (S.aimed.get(tgt) || 0) + 1);
          const lead = Math.hypot(tgt.x - this.x, tgt.y - this.y) / spd;
          S.a = Math.atan2(tgt.y + (tgt.vy || 0) * lead - this.y, tgt.x + (tgt.vx || 0) * lead - this.x) + (Math.random() - 0.5) * 0.08;
        } else S.a += TAU * 2.2 / def.count;
        this.anim = { kind: 'stormThrow', side: S.side, t: 0, dur: Math.max(0.08, S.every * 1.6) };
        sfx.knifeThrow();
        const c = Math.cos(S.a), sn = Math.sin(S.a);
        this.proj({ kind: 'kunai', storm: S, x: this.x + c * 0.3, y: this.y + sn * 0.3, z: 0.6, vx: c * def.speed * S.spd, vy: sn * def.speed * S.spd, base: def.dmg, pierce: def.pierce, r: 0.18, life: def.range / def.speed, knock: S.knock, sound: 'knifeHit', sparks: true, stick: true }, S.w);
        g.particles.burst('spark', this.x + c * 0.45, this.y + sn * 0.45, 0.65, 2, 3, 0.12, 0.8, '#e8f0ff');
        this.afterimages.push({ x: this.x, y: this.y, z: 0, life: 0.18, max: 0.18, rot: 0, type: 'shadow', facing: worldDirToScreenAngle(c, sn), pose: { kind: 'stormThrow', t: 0.5, side: S.side } });
      }
      if (S.done >= S.count && S.t >= S.dur + 0.1) this.storm = null;
    }
    if (this.weapons[0] && this.weapons[0].empower > 0) { const w = this.weapons[0]; w.empT = (w.empT ?? w.def.secondary.hold) - dt; if (w.empT <= 0) { w.empower = 0; w.empT = undefined; } }
  }
  // the orb lands: a soul splash that hurts and tethers everything around it
  soulDrop(O) {
    const g = this.g, def = O.def, SF = this.art(O.w, 'spiritFont');
    if (SF && !this.netClient) for (const sp of g.spirits || []) { // Spirit Font: the spirits inside heal and grow stronger
      if (sp.dead || sp.owner !== this || Math.hypot(sp.x - O.tx, sp.y - O.ty) > def.radius + sp.r) continue;
      const got = sp.heal(sp.hpMax * SF.heal);
      sp.buffT = SF.dur; sp.buffDmg = SF.dmgMul; sp.buffSpd = SF.spdMul;
      if (got > 0) g.fx.text(sp.x, sp.y, `+${Math.round(got)}`, '#9fe8ff', 12);
      g.fx.ring(sp.x, sp.y, 0.8, 'rgba(170,230,255,0.9)', 0.35, 3);
    }
    sfx.wisp(); sfx.clang(); sfx.heavyThud(0.3); g.shake(4); g.hitstop(0.03);
    g.fx.soulSplash(O.tx, O.ty, def.radius, 0.8);
    g.fx.ring(O.tx, O.ty, def.radius, 'rgba(190,232,255,0.95)', 0.45, 5); // (its whole area, clearly: a bright edge)
    g.fx.ring(O.tx, O.ty, def.radius * 0.97, 'rgba(120,190,255,0.5)', 0.6, 12);
    g.fx.ghosts(O.tx, O.ty, def.radius * 0.7, 7); // the souls inside fly up out of the pieces
    g.particles.burst('shard', O.tx, O.ty, 0.2, 16, 5, 0.6, 2.4, '#bfe2ff', { grav: 16, bounce: true }); // the glass of the orb
    g.particles.burst('glow', O.tx, O.ty, 0.3, 14, 3, 0.7, 2.2, GHOST);
    if (this.netClient) return;
    for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      const dx = e.x - O.tx, dy = e.y - O.ty, d = Math.hypot(dx, dy);
      if (d > def.radius + e.r) continue;
      const { dmg, crit } = this.rollDamage(def.dmg, O.w);
      g.damageEnemy(e, dmg, crit, dx / (d || 1), dy / (d || 1), 1.5, 0.1, { player: this, weapon: O.w, orb: true });
      if (e.dead) continue;
      tether(g, e, this, O.w);
    }
  }
  // ---------------- Blade Waltz (katanas special)
  // the enemies it can reach: alive and in the open within `radius` of (ox, oy)
  waltzTargets(radius, ox = this.x, oy = this.y) {
    return this.g.enemies.filter((e) => !e.dead && !e.hidden && !e.preview && e.state !== 'spawn' && e.state !== 'intro' && Math.hypot(e.x - ox, e.y - oy) <= radius + e.r);
  }
  startWaltz(w, def) {
    const g = this.g, list = this.waltzTargets(def.radius);
    // Storm Discipline (sacrifice): +40% on every cut when the waltz has 4 or more enemies to cut
    const mul = this.stormDisc && list.length >= 4 ? this.stormDisc : 1;
    this.waltz = { t: 0, n: 0, next: 0.04, strikes: def.strikes, every: def.every, radius: def.radius, ox: this.x, oy: this.y, dmg: def.dmg * mul, hits: new Map(), last: null, w, sx: this.x, sy: this.y };
    g.timeWarp(def.strikes * def.every + 0.3, def.timeScale);
    this.iframes = Math.max(this.iframes, def.strikes * def.every + 0.3);
    sfx.heavyWhoosh(0.6); sfx.katana(1);
    g.fx.ring(this.x, this.y, def.radius, 'rgba(200,225,255,0.35)', 0.4, 2);
    g.particles.burst('ink', this.x, this.y, 0.6, 12, 3, 0.4, 4, '#1a1428');
  }
  updateWaltz(dt) {
    const W = this.waltz, g = this.g;
    W.t += dt; W.next -= dt;
    this.vx = this.vy = 0; this.kvx = this.kvy = 0;
    this.iframes = Math.max(this.iframes, 0.2);
    if (W.next > 0) return;
    const list = W.n < W.strikes ? this.waltzTargets(W.radius, W.ox, W.oy) : [];
    if (!list.length) { // done: you stand beside the last enemy you cut
      this.waltz = null; this.iframes = Math.max(this.iframes, 0.3);
      g.fx.ring(this.x, this.y, 1.1, 'rgba(220,235,255,0.9)', 0.3, 4); sfx.katana(2);
      return;
    }
    // the next cut: the enemy cut least so far (not the same one twice in a row when there is a choice), nearest first
    const hits = (e) => W.hits.get(e) || 0, far = (e) => Math.hypot(e.x - this.x, e.y - this.y);
    list.sort((a, b) => hits(a) - hits(b) || (a === W.last) - (b === W.last) || far(a) - far(b));
    const e = list.length > 1 && list[0] === W.last ? list[1] : list[0];
    // blink through it: you appear on its far side, facing back at it
    const px = this.x, py = this.y;
    let dx = e.x - px, dy = e.y - py; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    if (d < 0.05) { const a = Math.random() * TAU; dx = Math.cos(a); dy = Math.sin(a); }
    const off = e.r + 0.5;
    let nx = e.x + dx * off, ny = e.y + dy * off;
    if (g.world.blocked(nx, ny, this.r)) { nx = e.x - dx * off; ny = e.y - dy * off; }
    if (g.world.blocked(nx, ny, this.r)) { nx = px; ny = py; }
    this.afterimages.push({ x: px, y: py, z: 0, rot: 0, pose: this.anim ? { kind: this.anim.kind, t: 0.6, v: this.anim.v } : null, facing: worldDirToScreenAngle(dx, dy), life: 0.35, max: 0.35, type: 'shadow' });
    this.x = nx; this.y = ny; this.aimX = -dx; this.aimY = -dy;
    this.anim = { kind: 'slash', t: 0, dur: Math.max(0.08, W.every * 1.4), v: W.n % 3 };
    g.fx.thrust(px, py, dx, dy, Math.hypot(nx - px, ny - py), 'rgba(225,240,255,0.85)', 6, 0.22);
    g.fx.slash(e.x, e.y, Math.atan2(dy, dx) + (W.n % 2 ? 0.9 : -0.9), 0.9, 1.6, 'rgba(255,255,255,0.95)', 12, 0.18, 0.5, W.n % 2 ? 1 : -1);
    g.particles.burst('spark', e.x, e.y, 0.7, 6, 5, 0.18, 1.3, '#dff0ff');
    sfx.katana(W.n % 3); sfx.slash();
    if (!this.netClient) {
      const { dmg, crit } = this.rollDamage(W.dmg, W.w);
      g.damageEnemy(e, dmg, crit, dx, dy, 1.2, 0.25, { player: this, weapon: W.w, melee: true, sound: 'cut', waltz: true });
    }
    if (!this.netClient) this.cutProjectiles(1.4, 360);
    W.hits.set(e, hits(e) + 1); W.last = e; W.n++; W.next = W.every;
  }

  // the bo's vault: a high swing over the planted stick (attacks still go off in the air); the landing empowers the next attack
  updateVault(dt) {
    const V = this.vault, g = this.g;
    V.t += dt;
    const k = Math.min(1, V.t / V.dur);
    if (!this.remote) { this.x = V.sx + V.dx * ease.outCubic(k); this.y = V.sy + V.dy * ease.outCubic(k); g.world.collide(this); }
    this.z = Math.sin(Math.min(1, k * 1.15) * Math.PI) * V.def.height; // (low and quick, down a moment before the end)
    this.vx = this.vy = 0;
    const VS = this.art(V.w, 'vaultStrike'); // Vaulting Strike: every enemy passed over takes a heavy blow (once)
    if (VS && !this.remote && k < 1) {
      V.hit = V.hit || new Set();
      for (const e of g.enemies) {
        if (V.hit.has(e) || e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) > VS.radius + (e.r || 0.4)) continue;
        V.hit.add(e);
        const l = Math.hypot(V.dx, V.dy) || 1, { dmg, crit } = this.rollDamage(VS.dmg, V.w);
        g.damageEnemy(e, dmg, crit, V.dx / l, V.dy / l, 3, 0.25, { player: this, weapon: V.w, sound: 'heavyHit' });
        g.particles.burst('ember', e.x, e.y, 0.6, 8, 2.2, 0.4, 1.8, '#ffd070');
      }
    }
    V.trail = (V.trail || 0) - dt;
    if (V.trail <= 0) { V.trail = 0.035; const L = this.rigOpts(g.time); this.afterimages.push({ x: this.x, y: this.y, z: this.z, life: 0.22, max: 0.22, rot: L.rot, type: 'shadow', facing: L.facing, pose: L.pose }); }
    if (k >= 1) {
      this.z = 0; this.vault = null;
      const w = V.w; w.empower = V.def.empower; w.empT = V.def.hold;
      w.lockT = 0; this.actionT = 0; // (straight back into attacking)
      if (w.combo > 0) { w.comboT = Math.max(w.comboT || 0, w.def.basic.comboHold); w.decayT = 0; } // the combo survives the vault
      if (this.art(w, 'flowState')) { w.combo = this.boMax || 5; w.comboT = w.def.basic.comboHold; w.decayT = 0; g.fx.text(this.x, this.y, 'Flow!', '#ffd070', 13); } // Flow State: max combo on landing
      sfx.tok(4); g.shake(2);
      this.anim = { kind: 'vaultLand', t: 0, dur: 0.24 }; // (lands low, ready)
      g.fx.ring(this.x, this.y, 1.0, 'rgba(255,214,120,0.9)', 0.3, 4);
      g.particles.burst('dust', this.x, this.y, 0.05, 10, 2.5, 0.5, 5, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
      g.particles.burst('ember', this.x, this.y, 0.6, 8, 2, 0.5, 1.6, '#ffd070');
    }
  }
  // the crossbow's backstep: a low leap backwards, the bolt loosed at the top of it
  updateHop(dt) {
    const H = this.hop, g = this.g, w = H.w, def = w.def.basic;
    H.t += dt;
    const k = Math.min(1, H.t / H.dur);
    if (!this.remote) { this.x = H.sx + H.dx * ease.outQuad(k); this.y = H.sy + H.dy * ease.outQuad(k); g.world.collide(this); }
    this.z = Math.sin(k * Math.PI) * 0.55;
    this.vx = this.vy = 0;
    if (!H.fired && k >= 0.35) {
      H.fired = true;
      const ax = this.aimX, ay = this.aimY, HM = this.art(w, 'huntersMark');
      sfx.twang(1);
      this.proj({ kind: 'bolt', x: this.x + ax * 0.4, y: this.y + ay * 0.4, z: 0.55 + this.z, vx: ax * def.speed, vy: ay * def.speed, base: w.def.secondary.dmg ?? def.dmg, pierce: def.pierce, r: 0.2, life: def.maxRange / def.speed, knock: 2.5, sound: 'thunk', shudder: 0.3, mark: HM ? HM.dur : 0, markMul: HM ? HM.mul : 1, cbMark: true }, w);
      g.particles.burst('spark', this.x + ax * 0.5, this.y + ay * 0.5, 0.6 + this.z, 6, 4, 0.15, 1.2, '#fff0c0');
    }
    if (k >= 1) { this.z = 0; this.hop = null; g.particles.burst('dust', this.x, this.y, 0.05, 8, 2, 0.45, 4, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true }); }
  }
  // world-sorted pieces of the secondaries: the planted bo, the flying shield, the orb out of the hand
  addWorldItems(items, ctx, t) {
    if (this.vault && this.vault.t / this.vault.dur < this.vault.def.release) { const V = this.vault; items.push({ d: V.px + V.py + 0.019, draw: () => { // the planted stick, its top in the hands
      const bx = isoX(V.px, V.py), by = isoY(V.px, V.py), hx = isoX(this.x, this.y), hy = isoY(this.x, this.y, this.z) - 40;
      const L = 58, a = Math.atan2(hy - by, hx - bx), tx = bx + Math.cos(a) * L, ty = by + Math.sin(a) * L;
      ctx.save(); ctx.lineCap = 'round';
      ctx.strokeStyle = '#1a1420'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = '#8a5a32'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,230,190,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + 1, by); ctx.lineTo(tx + 1, ty); ctx.stroke();
      ctx.restore();
    } }); }
    if (this.disc) { const D = this.disc; items.push({ d: D.x + D.y + 0.03, draw: () => { ctx.save(); ctx.translate(isoX(D.x, D.y), isoY(D.x, D.y, 0.55)); ctx.scale(1, 0.62); ctx.rotate(D.spin); drawWeapon(ctx, 'shield_icon', 0, 0, 0, this.pal); ctx.restore(); } }); }
    if (this.orbDrop) { const O = this.orbDrop; items.push({ d: O.x + O.y + 0.03, draw: () => { ctx.save(); const k = O.phase === 0 ? 1 : Math.min(1, O.t / O.def.reform); ctx.globalAlpha *= O.phase === 0 ? 1 : 0.25 + 0.55 * k; const sx = isoX(O.x, O.y), sy = isoY(O.x, O.y, O.z); ctx.translate(sx, sy); ctx.scale(O.phase === 0 ? 1 : 0.3 + 0.4 * k, O.phase === 0 ? 1 : 0.3 + 0.4 * k); drawWeapon(ctx, 'orb_icon', 0, 0, 0, this.pal); ctx.restore(); } }); }
  }
  // staff special: heal yourself and every ally within the circle
  healCircle(def, w) {
    const g = this.g;
    this.anim = { kind: 'cast', t: 0, dur: 0.5 };
    if (this.netClient) return;
    const LS = this.art(w, 'lifeSpring'), SA = this.art(w, 'sanctuary'), KF = this.art(w, 'kiFlow');
    const radius = def.radius * (SA ? SA.radiusMul : 1) * (LS && LS.radiusMul ? LS.radiusMul : 1), amount = Math.round(def.heal * this.stats.baseDamage * (this.dmgMul || 1));
    sfx.shakujo(); sfx.rin(0.75); sfx.chime(1);
    g.fx.spirit(this.x, this.y, radius, { kanji: '癒', dur: LS ? LS.dur : 1.1, col: '190,255,200' });
    g.fx.ring(this.x, this.y, radius, 'rgba(200,255,210,0.9)', 0.6, 5);
    if (SA) for (const e of g.enemies) if (!e.dead && Math.hypot(e.x - this.x, e.y - this.y) < radius + e.r) { e.slow = Math.max(e.slow, SA.slow); e.slowT = Math.max(e.slowT, SA.slowDur); } // sanctuary
    // the blessing throws every enemy inside the circle back out of it
    for (const e of g.enemies) {
      if (e.dead || e.boss || e.hidden || e.state === 'spawn' || e.state === 'intro') continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > radius + e.r) continue;
      const k = def.push * (0.6 + 0.4 * (1 - d / (radius + e.r)));
      e.kvx += (dx / (d || 1)) * k; e.kvy += (dy / (d || 1)) * k;
      if (e.poiseT <= 0) { e.stun = Math.max(e.stun, 0.3); e.poiseT = 1.1; }
    }
    g.particles.burst('dust', this.x, this.y, 0.05, 14, 5, 0.5, 4, g.world.bi === 2 ? '#f4f8ff' : '#e8dcc0', { under: true });
    if (LS) { // life spring: the heal becomes a zone that heals over time
      (this.zones || (this.zones = [])).push({ x: this.x, y: this.y, r: radius, t: LS.dur, dur: LS.dur, tick: 0, every: LS.tick, per: (amount * LS.mul) / (LS.dur / LS.tick), w });
      g.particles.burst('glow', this.x, this.y, 0.6, 22, 3, 1, 2.6, '#c8ffd0');
      return;
    }
    g.particles.burst('glow', this.x, this.y, 0.6, 22, 3, 1, 2.6, '#c8ffd0');
    for (let i = 0; i < 16; i++) { const a = rand(0, TAU), r = rand(0, def.radius); g.particles.emit('ember', this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 0.1, 0, 0, rand(1.2, 2.4), rand(0.8, 1.5), 1.8, i % 3 ? '#e8ffd8' : '#fff2b0', { drag: 0.4 }); } // motes rising
    for (const p of g.players) {
      if (p.dead || Math.hypot(p.x - this.x, p.y - this.y) > radius) continue;
      const got = p.heal(amount);
      if (KF && p !== this && got > 0) this.gainEnergy(KF.perHeal, true); // energy flow
      g.fx.text(p.x, p.y, `+${Math.round(got)}`, '#7dff9a', 17);
      g.particles.burst('glow', p.x, p.y, 1, 10, 1.5, 0.8, 2, '#c8ffd0');
    }
  }

  trySpecial(i) {
    const w = this.weapons[i];
    const def = w.def.special;
    const cost = this.kiCost(def, w);
    if (w.scd > 0 || this.energy < cost || this.spin || this.waltz || this.disc || this.orbDrop) return;
    if (w.key === 'katanas' && !this.waltzTargets(def.radius).length) { // Blade Waltz needs someone to cut
      if (this.g.time - (this.noWaltzT ?? -9) > 1.2) { this.noWaltzT = this.g.time; this.g.fx.text(this.x, this.y, 'No enemy in reach', '#cfe2ff', 13); }
      return;
    }
    // the spirit orb can only call back an enemy that has fallen (nothing is spent until one has); Giant's Soul always can
    if (w.key === 'orb' && !this.art(w, 'soulForge') && !this.lonelySoul && !((this.netClient ? this.g.netFallen : (this.g.fallen || []).length) > 0)) { // (Giant's Soul needs no fallen soul)
      if (this.g.time - (this.noSoulT ?? -9) > 1.5) { this.noSoulT = this.g.time; this.g.fx.text(this.x, this.y, 'No fallen soul yet', '#bcd8f0', 13); }
      return;
    }
    w.scd = def.cd * this.cdMulFor(w); w.scdMax = w.scd;
    if (this.netClient) net.send('atk', { slot: i, special: 1, ax: this.aimX, ay: this.aimY });
    this.lock(def.lock, w);
    this.spendEnergy(cost);
    this.activeSlot = i;
    const g = this.g, ax = this.aimX, ay = this.aimY;
    switch (w.key) {
      case 'gloves': this.glovesSpecial(w, def); break;
      case 'katanas': { // Blade Waltz: blink from enemy to enemy in slow motion, cutting each
        this.startWaltz(w, def);
        break;
      }
      case 'crossbow': {
        // piercing shot: one heavy bolt down a long line, through every enemy in it
        this.anim = { kind: 'shoot', t: 0, dur: 0.4 };
        sfx.twang(1); sfx.heavyThud(0.2);
        const VO = this.art(w, 'volley'), HP = this.art(w, 'harpoon'), HM = this.art(w, 'huntersMark');
        const n = VO ? VO.count : 1, base0 = Math.atan2(ay, ax);
        for (let k = 0; k < n; k++) {
          const a = base0 + (n > 1 ? ((k - (n - 1) / 2) * VO.spread * Math.PI) / 180 : 0), vx = Math.cos(a), vy = Math.sin(a);
          this.proj({ kind: 'heavybolt', x: this.x + vx * 0.4, y: this.y + vy * 0.4, z: 0.55, vx: vx * def.speed, vy: vy * def.speed, base: def.dmg * (VO ? VO.dmgMul : 1), pierce: def.pierce, r: 0.3, life: def.range / def.speed, knock: def.knock, glow: true, sound: 'thunk', shudder: 0.45, sparks: true, entangle: HP ? HP.dur : 0, bossSlow: HP ? HP.bossSlow : 0, mark: HM ? HM.dur : 0, markMul: HM ? HM.mul : 1 }, w);
        }
        g.fx.thrust(this.x + ax * 0.5, this.y + ay * 0.5, ax, ay, 9, 'rgba(255,236,180,0.85)', 11, 0.26); // muzzle streak down the whole line
        g.fx.thrust(this.x + ax * 0.5, this.y + ay * 0.5, ax, ay, 5, 'rgba(255,255,255,0.95)', 5, 0.14);
        g.fx.ring(this.x + ax * 0.7, this.y + ay * 0.7, 1.1, 'rgba(255,230,170,0.9)', 0.3, 5); // the shockwave of the string
        g.particles.burst('spark', this.x + ax * 0.6, this.y + ay * 0.6, 0.6, 12, 7, 0.2, 1.4, '#fff0c0');
        g.particles.burst('smoke', this.x + ax * 0.5, this.y + ay * 0.5, 0.5, 8, 1.6, 0.7, 7, 'rgba(90,80,70,1)');
        g.particles.burst('dust', this.x, this.y, 0.05, 10, 3, 0.5, 4, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
        sfx.heavyThud(0.7); g.hitstop(0.05);
        this.kvx -= ax * 8; this.kvy -= ay * 8;
        g.shake(8);
        break;
      }
      case 'heavy': { // a longer, higher leap that lands harder and wider
        const D = def.leap;
        this.leap = { t: 0, dur: def.leapDur || 0.34, sx: this.x, sy: this.y, dx: ax * D, dy: ay * D, def, w };
        this.anim = { kind: 'slam', t: 0, dur: def.anim || 0.46 };
        this.iframes = Math.max(this.iframes, 0.4);
        const IB = this.art(w, 'ironBody'); if (IB) { this.ironT = IB.dur; g.fx.ring(this.x, this.y, 1.2, 'rgba(255,214,110,0.9)', 0.3, 4); }
        sfx.dash();
        break;
      }
      case 'knives': { // Blade Storm: time slows, and kunai fly out all around you one after another
        const LSt = this.art(w, 'longStorm'), SSt = this.art(w, 'swiftStorm'), dm = (LSt ? LSt.durMul : 1) * (SSt ? SSt.durMul : 1);
        // (Stilled Moment: twice the slow motion and twice the throwing; Gale of Blades: 50% longer, slow motion and throwing)
        this.storm = { t: 0, done: 0, dur: def.dur * dm, count: Math.round(def.count * dm), every: def.dur / def.count, a: Math.atan2(ay, ax), def, w, side: 1, spd: 1, knock: 1 };
        g.timeWarp(def.dur * dm + 0.2, def.timeScale);
        sfx.heavyWhoosh(0.6); g.shake(3);
        g.fx.ring(this.x, this.y, 1.0, 'rgba(225,235,255,0.85)', 0.3, 3);
        g.flashScreen('rgba(200,220,255,0.12)');
        break;
      }
      case 'staff': this.healCircle(def, w); break;
      case 'orb': // Call the Fallen: the orb is raised high and the last enemy slain rises as a spirit
        this.anim = { kind: 'raise', t: 0, dur: 0.75 };
        g.fx.ring(this.x, this.y, 1.2, 'rgba(160,215,255,0.8)', 0.4, 3);
        if (!this.netClient) callSpirits(g, this, w);
        break;
      case 'shield': // Bulwark: crouch behind the shield, store what it soaks up, then release it
        const LG = this.art(w, 'longGuard'), WR = this.art(w, 'wideRelease');
        this.guard = { t: 0, dur: def.dur * (LG ? LG.durMul : 1), store: 0, w, def, flash: 0, recent: [], radius: def.radius * (WR ? WR.radiusMul : 1) };
        this.anim = null; this.charge = null;
        sfx.absorb(); g.fx.ring(this.x, this.y, 0.9, 'rgba(255,214,140,0.8)', 0.25, 3);
        break;
      case 'bo':
        const LF = this.art(w, 'longFlurry'), HF = this.art(w, 'heavyFlurry');
        const empF = this.takeEmpower(w), fdef0 = LF ? { ...def, dur: def.dur * LF.mul, strikes: Math.round(def.strikes * LF.mul) } : HF ? { ...def, strikes: HF.strikes, dmg: def.dmg * HF.dmgMul } : def;
        const fdef = empF > 1 ? { ...fdef0, dmg: fdef0.dmg * empF } : fdef0; // (Pole Vault: the whole flurry is empowered)
        this.flurry = { t: 0, done: 0, side: 1, def: fdef, w };
        g.timeWarp(fdef.dur + 0.15, def.timeScale);
        sfx.dash();
        break;
    }
  }

  updateSpin(dt) {
    const s = this.spin, g = this.g;
    s.t += dt; s.tick -= dt;
    const n = s.n || s.def.ticks, R = s.radius || s.def.radius;
    if (s.tick <= 0 && s.ticks < n) {
      s.tick = s.dur / n; s.ticks++;
      if (s.single) { // single gale: one great cut all around
        sfx.katana(2); sfx.heavyWhoosh(0.5); g.shake(4);
        g.fx.slash(this.x, this.y, 0.4, R * 0.85, TAU * 0.98, 'rgba(255,255,255,0.95)', 22, 0.28, 0.5, 1);
        g.fx.ring(this.x, this.y, R, 'rgba(220,235,255,0.9)', 0.3, 6);
        if (this.meleeHit(s.dmg, R, 360, 5, 0.3, s.w, { sound: 'cut' })) g.hitstop(0.06);
      } else {
        sfx.slash();
        g.fx.slash(this.x, this.y, s.ticks * 2.1, R * 0.8, 3.6, 'rgba(220,235,255,0.85)', 12, 0.16, 0.5, 1);
        if (s.pull) { // storm dancer: a second, wider blade of wind and a gust ring on every other cut
          g.fx.slash(this.x, this.y, s.ticks * 2.1 + Math.PI, R * 1.05, 3.2, 'rgba(160,210,255,0.6)', 9, 0.2, 0.55, -1);
          if (s.ticks % 2 === 0) g.fx.ring(this.x, this.y, R * 1.1, 'rgba(190,225,255,0.5)', 0.3, 3);
          if (s.ticks === n) { g.fx.ring(this.x, this.y, R * 1.4, 'rgba(235,245,255,0.95)', 0.4, 7); g.shake(5); sfx.heavyWhoosh(1); g.particles.burst('leaf', this.x, this.y, 0.6, 24, 8, 1, 3, g.world.bi === 1 ? '#e0542c' : g.world.bi === 2 ? '#e8f2ff' : '#f7c3d2'); }
        }
        this.meleeHit(s.dmg || s.def.dmg, R, 360, 2, 0.08, s.w);
      }
    }
    if (s.pull) { // storm dancer: leaves and dust swirl inward from the edge of the storm
      for (let k = 0; k < 2; k++) if (Math.random() < dt * 40) {
        const a = Math.random() * TAU, rr = R * (0.55 + Math.random() * 0.45) + s.pull.pullRange * Math.random(), sp = 7 + Math.random() * 5;
        const px = this.x + Math.cos(a) * rr, py = this.y + Math.sin(a) * rr;
        g.particles.emit(k ? 'dust' : 'leaf', px, py, 0.2 + Math.random() * 0.8, -Math.cos(a) * sp * 0.6 - Math.sin(a) * sp, -Math.sin(a) * sp * 0.6 + Math.cos(a) * sp, 0.3, 0.45, k ? 4 : 2.6, k ? 'rgba(220,235,255,0.8)' : g.world.bi === 1 ? '#e0542c' : g.world.bi === 2 ? '#e8f2ff' : '#f7c3d2', { drag: 1.5 });
      }
    }
    if (s.pull && !this.netClient) for (const e of g.enemies) { // storm dancer: drag enemies hard into the blades
      if (e.dead || e.boss || e.hidden || e.state === 'spawn') continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > 0.7 && d < R + s.pull.pullRange) { const f = s.pull.pull * 2.5 * dt * (e.cfg.heavy ? 0.6 : 1); e.kvx -= (dx / d) * f; e.kvy -= (dy / d) * f; }
    }
    if (s.t >= s.dur) this.spin = null;
  }

  updateLeap(dt) {
    const L = this.leap, g = this.g;
    L.t += dt;
    const k = Math.min(1, L.t / L.dur);
    if (!this.remote) { // the joiner's own game moves its ninja
      this.x = L.sx + L.dx * ease.outQuad(k); this.y = L.sy + L.dy * ease.outQuad(k);
      g.world.collide(this);
    }
    this.z = Math.sin(k * Math.PI) * 1.0;
    if (k >= 1) {
      this.z = 0; this.leap = null;
      const def = L.def;
      sfx.slam();
      g.shake(10); g.hitstop(0.06);
      g.fx.ring(this.x, this.y, def.radius, 'rgba(255,240,210,0.9)', 0.45, 8);
      g.fx.ring(this.x, this.y, def.radius * 0.6, 'rgba(255,200,120,0.8)', 0.3, 5);
      g.particles.burst('dust', this.x, this.y, 0.1, 22, 5, 0.8, 7, g.world.bi === 2 ? '#eef3fb' : '#bfa47c');
      g.particles.burst('shard', this.x, this.y, 0.1, 14, 6, 0.7, 3, '#6a5a48', { grav: 18, bounce: true });
      g.decals.add(this.x, this.y, 0.9, 'rgba(40,30,25,1)', 8);
      this.meleeHit(def.dmg, def.radius, 360, def.knock, 0.5, L.w);
      const FL = this.art(L.w, 'faultLine');
      if (FL) this.faultLine(FL, def, L);
    }
  }
  // Fault Line: the landing splits the ground in a straight line ahead
  faultLine(FL, def, L) {
    const g = this.g, l = Math.hypot(L.dx, L.dy) || 1, ux = L.dx / l, uy = L.dy / l, x0 = this.x, y0 = this.y;
    for (let k = 1; k <= FL.len; k++) this.after(k * 0.04, () => {
      const px = x0 + ux * k, py = y0 + uy * k;
      g.fx.ring(px, py, 0.7, 'rgba(255,225,170,0.85)', 0.25, 4);
      g.particles.burst('shard', px, py, 0.1, 4, 4, 0.5, 2.5, '#6a5a48', { grav: 18, bounce: true });
      g.decals.add(px, py, 0.4, 'rgba(40,30,25,1)', 6);
    });
    sfx.heavyThud(0.6); g.shake(4);
    if (this.netClient) return;
    for (const e of g.enemies) {
      if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro') continue;
      const dx = e.x - x0, dy = e.y - y0, along = dx * ux + dy * uy, side = Math.abs(dx * uy - dy * ux);
      if (along < 0.5 || along > FL.len + e.r || side > FL.width + e.r) continue;
      const { dmg, crit } = this.rollDamage(def.dmg * FL.dmgMul, L.w);
      g.damageEnemy(e, dmg, crit, ux, uy, 6, 0.3, { player: this, weapon: L.w });
    }
  }

  // ---------------- shishi shield ----------------
  // an enemy within reach inside the arc (the bash dash stops as soon as one is)
  enemyInArc(range, arcDeg) {
    const half = ((arcDeg / 2) * Math.PI) / 180, aim = Math.atan2(this.aimY, this.aimX);
    return this.g.enemies.some((e) => {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) return false;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      return d <= range + e.r && (d < 0.3 || Math.abs(angDiff(aim, Math.atan2(dy, dx))) <= half);
    });
  }
  updateBash(dt) {
    const B = this.bash, g = this.g, def = B.w.def.basic;
    B.t += dt;
    const k = Math.min(1, B.t / B.dur);
    if (!this.remote) { // the joiner's own game moves its ninja
      this.x = B.sx + B.dx * ease.outQuad(k); this.y = B.sy + B.dy * ease.outQuad(k);
      g.world.collide(this);
    }
    this.reflectAround(B.w);
    if (k >= 1 || this.enemyInArc(def.range, def.arc)) this.endBash();
  }
  endBash() {
    const B = this.bash, g = this.g, def = B.w.def.basic, ax = this.aimX, ay = this.aimY;
    this.bash = null; this.reflectT = 0.08; this.reflectW = B.w; B.w.activeT = SHIELD_WARD;
    sfx.thump(); g.shake(3); g.hitstop(0.05);
    g.fx.slash(this.x, this.y, slashAngle(ax, ay), def.range * 0.8, 1.9, 'rgba(255,226,150,0.9)', 12, 0.16, 0.6, 1);
    g.particles.burst('dust', this.x + ax * 0.6, this.y + ay * 0.6, 0.05, 6, 2, 0.4, 3, g.world.bi === 2 ? '#eef3fb' : '#c8b088', { under: true });
    // counts as 2 melee hits against enemy shields
    if (this.meleeHit(def.dmg, def.range, def.arc, def.knock, def.stun, B.w, { sound: 'heavyHit', shieldHits: 2 })) g.particles.burst('spark', this.x + ax * def.range * 0.7, this.y + ay * def.range * 0.7, 0.6, 6, 4, 0.2, 1.4, '#ffe6a0');
  }
  // turn enemy projectiles close to the shield back along the line they came in on (host only: it owns projectiles)
  reflectAround(w) {
    if (this.netClient || !w) return;
    const g = this.g, def = w.def.basic, R = this.r + 0.95;
    for (const q of g.projectiles) {
      if (q.dead || q.owner === 'player' || q.lob || q.T || q.boomer) continue; // lobbed arcs and boomerangs can't be turned
      if (Math.hypot(q.x - this.x, q.y - this.y) > R) continue;
      // turned back much faster, always at an enemy: the one that fired it, else the nearest other one
      const ok = (e) => e && !e.dead && !e.hidden && e.state !== 'spawn' && e.state !== 'intro';
      const others = g.enemies.filter((e) => ok(e) && e !== q.src && Math.hypot(e.x - this.x, e.y - this.y) < 16).sort((a, b) => Math.hypot(a.x - q.x, a.y - q.y) - Math.hypot(b.x - q.x, b.y - q.y));
      const targets = ok(q.src) ? [q.src, ...others] : others;
      const sp = Math.max(20, (Math.hypot(q.vx, q.vy) || 8) * def.reflectSpeed);
      const aimAt = (c, e, fallbackA) => {
        const a = e ? Math.atan2(e.y - c.y, e.x - c.x) : fallbackA;
        c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp; c.chase = e || null; c.speed = sp;
        c.life = e ? Math.hypot(e.x - c.x, e.y - c.y) / sp + 0.5 : 1.0;
      };
      q.owner = 'player'; q.from = this; q.weapon = w;
      const MP = this.art(w, 'mirror');
      q.base = (q.dmg || 5) * def.reflectMul; // rollDamage adds baseDamage and crits
      q.hit = null; q.pierce = 0; q.homing = 0; q.glow = true; q.reflected = true; q.onHit = null; q.knock = 3;
      const back = Math.atan2(-q.vy, -q.vx);
      aimAt(q, targets[0], back);
      q.x += q.vx * 0.02; q.y += q.vy * 0.02;
      if (MP) { // mirror polish: it splits into 4, each at full damage, each after an enemy of its own where there are enough
        for (let k = 1; k < MP.split; k++) {
          const c = { ...q, hit: null, seed: Math.random() * 10 };
          aimAt(c, targets.length ? targets[k % targets.length] : null, back + (k - (MP.split - 1) / 2) * MP.spread);
          if (targets.length && k >= targets.length) { const a = Math.atan2(c.vy, c.vx) + (k % 2 ? 1 : -1) * 0.5; c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp; } // doubling up: curve in from the side
          g.projectiles.push(c);
        }
        g.fx.ring(q.x, q.y, 0.6, 'rgba(200,240,255,0.95)', 0.22, 3);
      }
      sfx.ting();
      g.particles.burst('spark', q.x, q.y, q.z || 0.6, 10, 6, 0.2, 1.5, '#ffd860');
      g.fx.ring(q.x, q.y, 0.35, 'rgba(255,220,120,0.95)', 0.18, 3);
    }
  }
  updateGuard(dt) {
    const G = this.guard;
    G.t += dt; G.flash = Math.max(0, G.flash - dt);
    if (G.t >= G.dur) this.releaseGuard();
  }
  // a hit while crouched behind the Bulwark: store all of it, take only (1 - reduce) of it; no i-frames or knockback
  guardAbsorb(dmg, sx, sy) {
    const G = this.guard, g = this.g, key = `${Math.round(sx * 4)},${Math.round(sy * 4)}`;
    G.recent = G.recent.filter((r) => G.t - r.t < 0.15);
    if (G.recent.some((r) => r.k === key)) return true; // the same blow landing on consecutive frames counts once
    G.recent.push({ k: key, t: G.t });
    G.store = Math.min(G.def.maxStore, G.store + dmg);
    const taken = dmg * (1 - G.def.reduce);
    this.hp -= taken; G.flash = 0.15;
    sfx.absorb();
    g.fx.text(this.x, this.y, `−${Math.max(1, Math.round(taken))}`, '#a8a8b4', 13);
    const dx = sx - this.x, dy = sy - this.y, l = Math.hypot(dx, dy) || 1;
    g.particles.burst('spark', this.x + (dx / l) * 0.4, this.y + (dy / l) * 0.4, 0.6, 5, 3, 0.18, 1.2, '#ffe6a0');
    if (g.noteCombat) g.noteCombat();
    if (this.hp <= 0) { this.guard = null; this.fall(); }
    return true;
  }
  // the Bulwark ends: a shockwave that hits every enemy around for releaseMul x the store
  releaseGuard() {
    const G = this.guard, g = this.g, def = G.def;
    { const SW = this.weapons.find((x) => x.key === 'shield'); if (SW) SW.activeT = SHIELD_WARD; }
    this.guard = null;
    this.iframes = Math.max(this.iframes, 0.3);
    const stored = G.store >= (def.minStore || 0.5), radius = G.radius || def.radius; // too little absorbed: just a push
    g.fx.ring(this.x, this.y, radius, stored ? 'rgba(255,214,110,0.95)' : 'rgba(255,240,210,0.6)', 0.45, stored ? 9 : 4);
    if (stored) { // the lion roars: rings rolling outward, a golden seal, stone and embers thrown up
      const big = Math.min(1, G.store / 120);
      g.fx.ring(this.x, this.y, radius * 0.7, 'rgba(210,40,40,0.9)', 0.38, 6);
      g.fx.ring(this.x, this.y, radius * 1.15, 'rgba(255,240,200,0.7)', 0.6, 4);
      g.fx.ring(this.x, this.y, radius * 0.4, 'rgba(255,250,230,1)', 0.2, 8);
      g.fx.roar(this.x, this.y, radius, 0.75); // (the lion's own roar, not the staff's seal)
      g.particles.burst('ink', this.x, this.y, 0.4, 30, 6, 0.8, 5, '#1e1428');
      g.particles.burst('ember', this.x, this.y, 0.5, 26 + Math.round(big * 20), 7, 0.7, 2.6, '#ffcf6a');
      g.particles.burst('shard', this.x, this.y, 0.2, 14, 7, 0.8, 3, '#6a5a48', { grav: 18, bounce: true });
      g.particles.burst('dust', this.x, this.y, 0.05, 24, 7, 0.7, 6, g.world.bi === 2 ? '#eef3fb' : '#c8b088', { under: true });
      g.decals.add(this.x, this.y, radius * 0.45, 'rgba(40,30,25,1)', 10);
      g.flashScreen('rgba(255,200,110,0.25)');
      sfx.release(); sfx.slam(); g.hitstop(0.12); g.shake(12 + big * 4);
    } else sfx.thump();
    if (this.netClient) return; // the host deals the damage
    for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > radius + e.r) continue;
      if (!stored) { if (!e.boss) { e.kvx += (dx / (d || 1)) * 3; e.kvy += (dy / (d || 1)) * 3; } continue; } // nothing absorbed: a harmless push
      const { dmg, crit } = this.rollDamage(G.store * def.releaseMul, G.w);
      g.damageEnemy(e, dmg, crit, dx / (d || 1), dy / (d || 1), 14, 0.6, { player: this, weapon: G.w });
    }
  }

  // katanas: a cut that reaches an enemy's arrow (or any other physical projectile) cuts it out of the air;
  // the two halves drop to the ground (magic, lobbed and burning things are not cut)
  // (each cut stays sharp for CUT_WINDOW s: arrows that fly into the arc a moment later are cut too)
  cutProjectiles(range, arcDeg, aim = Math.atan2(this.aimY, this.aimX), fresh = true) {
    const g = this.g, half = ((arcDeg / 2) * Math.PI) / 180;
    if (fresh) this.cutWin = { t: CUT_WINDOW, range, arcDeg, aim };
    for (const q of g.projectiles) {
      if (q.dead || q.owner === 'player' || q.reflected || q.lob || !CUTTABLE.has(q.kind)) continue;
      const dx = q.x - this.x, dy = q.y - this.y, d = Math.hypot(dx, dy);
      if (d > range + 0.3 || (arcDeg < 360 && d > 0.3 && Math.abs(angDiff(aim, Math.atan2(dy, dx))) > half)) continue;
      q.dead = true;
      if (q.kind !== 'bullet') (g.cutBits || (g.cutBits = [])).push({ x: q.x, y: q.y, a: Math.atan2(q.vy, q.vx), kind: q.kind, t: g.time, s: Math.random() < 0.5 ? 1 : -1 });
      g.particles.burst('spark', q.x, q.y, 0.7, 6, 4, 0.18, 1.2, '#fff4d0'); sfx.clang();
      g.fx.text(q.x, q.y, 'Cut!', '#e8f0ff', 11);
    }
  }
  meleeHit(base, range, arcDeg, knock, stun, w, extra = null) {
    if (this.netClient) return false;
    const g = this.g, half = ((arcDeg / 2) * Math.PI) / 180;
    const aim = Math.atan2(this.aimY, this.aimX);
    if (w && w.key === 'katanas') this.cutProjectiles(range, arcDeg);
    let any = false, only = null, crowdMul = 1;
    if (this.stormDisc && w && w.key === 'katanas') { // Storm Discipline: count who this cut reaches first
      let n = 0;
      for (const e of g.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
        const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
        if (d > range + e.r || (arcDeg < 360 && d > 0.3 && Math.abs(angDiff(aim, Math.atan2(dy, dx))) > half)) continue;
        n++;
      }
      if (n >= 4) crowdMul = this.stormDisc;
    }
    if (extra && extra.single) { // single target: the enemy in reach nearest the aim line (closer counts a little more)
      let bs = 1e9;
      for (const e of g.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
        const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy), off = d > 0.3 ? Math.abs(angDiff(aim, Math.atan2(dy, dx))) : 0;
        if (d > range + e.r || (arcDeg < 360 && off > half)) continue;
        const sc = off * 1.5 + d * 0.4;
        if (sc < bs) { bs = sc; only = e; }
      }
    }
    for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      if (extra && extra.single && e !== only) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > range + e.r) continue;
      if (extra && extra.minR && d + e.r < extra.minR) continue; // (an attack that only hits at the edge of its reach)
      if (arcDeg < 360 && d > 0.3 && Math.abs(angDiff(aim, Math.atan2(dy, dx))) > half) continue;
      const tip = extra && extra.edge && d >= range * extra.edge; // katanas: hit with the tip of the blade
      const { dmg, crit } = this.rollDamage((tip ? base * extra.edgeMul * (this.tipMul || 1) : base) * crowdMul, w, !!(extra && extra.forceCrit), (extra && extra.critAdd) || 0);
      if (tip) { g.particles.burst('spark', e.x, e.y, 0.7, 5, 5, 0.18, 1.3, '#bfe4ff'); g.fx.ring(e.x, e.y, 0.45, 'rgba(190,228,255,0.9)', 0.16, 2); }
      g.damageEnemy(e, dmg, crit, dx / (d || 1), dy / (d || 1), knock, stun, { player: this, weapon: w, melee: true, ...extra, tip });
      if (extra && extra.slowHit && !e.dead) { e.slow = Math.max(e.slow || 0, extra.slowHit); e.slowT = Math.max(e.slowT || 0, extra.slowDur || 2); }
      any = true;
    }
    if (!(w && w.key === 'katanas')) for (const p of g.projectiles) { // melee can cut enemy projectiles (katanas: only physical ones, see cutProjectiles)
      if (p.owner !== 'enemy' || p.dead || p.kind === 'bomb') continue;
      const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy);
      if (d > range) continue;
      if (arcDeg < 360 && Math.abs(angDiff(aim, Math.atan2(dy, dx))) > half) continue;
      p.dead = true;
      g.particles.burst('spark', p.x, p.y, p.z, 6, 5, 0.25, 1.5, '#fff6c0');
    }
    return any;
  }

  hurt(dmg, sx, sy, knock = 4) {
    const g = this.g;
    if ((this.iframes > 0 && !this.guard) || this.vault || !this.active || g.god || g.inputLocked) return false;
    if (this.fragileFlow) for (const w of this.weapons) if (w.key === 'bo' && w.combo > 0) { w.combo = 0; w.chain = 0; w.comboT = 0; } // Fragile Flow: a hit breaks the combo
    if (this.inSmoke()) { // Smoke Bomb: they can't see you, the blow goes wide
      if (!this.missTxt || g.time - this.missTxt > 0.4) { this.missTxt = g.time; g.fx.text(this.x, this.y, 'Miss', '#d8d8e0', 12); }
      return false;
    }
    if (this.ironT > 0) { // Iron Body: nothing gets through
      if (!this.ironTxt || g.time - this.ironTxt > 0.4) { this.ironTxt = g.time; g.fx.text(this.x, this.y, 'Iron', '#ffd070', 12); sfx.clang(); }
      return false;
    }
    if (this.dodgeChance > 0 && Math.random() < this.dodgeChance) { // Evasion / Deflection
      this.iframes = 0.25; g.fx.text(this.x, this.y, 'Dodge', '#d8e8ff', 13); sfx.dash();
      this.afterimages.push({ x: this.x, y: this.y, z: 0, life: 0.25, max: 0.25, rot: 0, type: 'shadow', facing: this.facingAngle(), pose: null });
      return false;
    }
    if (g.noteCombat) g.noteCombat();
    dmg *= ENEMY_DAMAGE_MUL * (this.takenMul || 1) * ((g.diffMod && g.diffMod.dmg) || 1); // (Bound Souls: +25% damage taken; the run's difficulty)
    { const cw = this.charge && this.weapons[this.charge.slot], S = cw && this.art(cw, 'steadfast'); if (S) dmg *= S.mul; } // Steadfast
    // Bound Souls pact: half of the damage goes to the partner
    if (this.bound) {
      const o = g.players.find((q) => q !== this && q.bound && q.active);
      if (o) { dmg /= 2; o.sharedHurt(dmg); }
    }
    if (this.guard) return this.guardAbsorb(dmg, sx, sy);
    this.lfStacks = 0; // (Light Feet: lost when you are hit)
    this.hp -= dmg;
    this.iframes = PLAYER_BASE.hitIframes; this.flash = 0.12; this.hurtT = 0.3; this.lastHurtAt = this.g.realTime;
    const dx = this.x - sx, dy = this.y - sy, l = Math.hypot(dx, dy) || 1;
    this.kvx += (dx / l) * knock; this.kvy += (dy / l) * knock;
    sfx.hurt();
    if (this.remote) net.send('phurt', { dmg, sx, sy, k: knock }); // the joiner shows its own hit feedback
    else { g.localShake(6); g.hitstop(0.05); g.localFlash('rgba(200,30,30,0.25)'); }
    g.particles.burst('blood', this.x, this.y, 0.6, 10, 4, 0.5, 2.5, '#8a1020', { grav: 10 });
    g.fx.text(this.x, this.y, `-${Math.round(dmg)}`, '#ff6b6b', 15);
    if (this.hp <= 0) this.fall();
    return true;
  }
  // damage passed on through the Bound Souls pact (no knockback or invulnerability window)
  sharedHurt(dmg) {
    const g = this.g;
    if (!this.active || g.god) return;
    this.hp -= dmg; this.flash = 0.08;
    g.fx.text(this.x, this.y, `-${Math.round(dmg)}`, '#ff9ab0', 13);
    g.particles.burst('glow', this.x, this.y, 0.8, 5, 1.5, 0.5, 2, '#ff8aa8');
    if (this.hp <= 0) this.fall();
  }
  fall() {
    const g = this.g;
    {
      this.hp = 0; this.spin = null; this.leap = null; this.flurry = null; this.charge = null; this.bash = null; this.guard = null; this.dash.t = 0; this.z = 0; this.vault = null; this.hop = null; this.storm = null;
      g.particles.burst('ink', this.x, this.y, 0.6, 20, 4, 0.8, 5, '#1e1428');
      // co-op: go down and wait for the partner, as long as someone is still standing
      const partnerUp = g.players.some((o) => o !== this && o.active);
      if (!partnerUp && (this.lives || 0) > 1) { // a life to spare: lie there a moment, then rise again
        this.lives--; this.downed = true; this.relife = { t: 0 }; this.vx = this.vy = 0;
        sfx.hurt && sfx.hurt();
      } else if (partnerUp) {
        this.downed = true; this.downT = PLAYER_BASE.downTime; this.reviveP = 0;
        g.banner({ title: `Player ${this.index + 1} is down!`, sub: `Stand next to them to revive (${Math.round(PLAYER_BASE.downTime)}s)`, dur: 2.4, y: 0.25, size: 26, color: 'rgba(60,4,10,0.8)' });
      } else { if (this.lives > 0) this.lives--; this.dead = true; this.deadT = 0; g.onPlayerDeath(this); }
    }
    return true;
  }

  // ---------------- rendering ----------------
  rigOpts(t) {
    // during a weapon swap the incoming weapon is already in hand, twirled up from the back
    const S = null, w = this.weapons[0], rw = RIG_WEAPON[w.key];
    let wpn = rw.weapon, wpn2 = rw.weapon2;
    if (this.disc || this.orbDrop || (this.vault && this.vault.t / this.vault.dur < this.vault.def.release)) wpn = null; // (the bo is planted in the ground until it is pulled out)
    let facing = this.facingAngle();
    const heavyCh = this.charge && this.weapons[this.charge.slot].key === 'heavy';
    let pose = S && !this.anim ? { kind: 'spin', t: S.t / S.dur } : this.anim ? { kind: this.anim.kind, t: this.anim.t, side: this.anim.side, v: this.anim.v } : heavyCh ? { kind: 'heavyCharge', t: this.chargeFrac(), raise: Math.min(1, this.charge.t / 0.16) } : this.charge ? { kind: 'shoot', t: 1 - this.chargeFrac() * 0.6 } : null;
    if (this.spin) facing = t * 40 * (this.spin.spinMul || 1);
    if (this.storm) facing = worldDirToScreenAngle(Math.cos(this.storm.a), Math.sin(this.storm.a));
    if (this.hurtT > 0 && !pose) pose = { kind: 'hurt', t: 1 - this.hurtT / 0.3 };
    let rot = 0, sqy = 1;
    const d = this.dash;
    if (d.t > 0) {
      const A = this.dashLook(d, 1 - d.t / d.dur);
      facing = A.facing; rot = A.rot; sqy = A.sqy; if (A.pose) pose = A.pose;
    }
    if (this.leap) pose = { kind: 'slam', t: this.anim ? this.anim.t : 0.5 };
    if (this.vault) { const V = this.vault, k = Math.min(1, V.t / V.dur); pose = { kind: 'vault', t: k }; facing = worldDirToScreenAngle(V.dx, V.dy) + ease.inOutSine(Math.min(1, k / 0.8)) * TAU; rot = 0.25 * Math.sin(k * Math.PI) * (Math.cos(facing) >= 0 ? 1 : -1); } // whipping round the stick
    if (this.hop) pose = { kind: 'backstep', t: this.hop.t / this.hop.dur };
    if (this.guard) pose = { kind: 'shieldGuard', t: this.guard.t / this.guard.dur };
    if (this.finisher) { const L = finisherLook(this); pose = L.pose; facing = L.facing; rot = L.rot; sqy = 1; }
    if (this.dead || this.downed) { rot = -Math.min(1, (this.dead ? this.deadT : 1) / 0.3) * 1.4; pose = { kind: 'hurt', t: 0 }; }
    if (this.relife) { // falls over, then straightens up as it rises
      const R = this.relife, L = RELIFE;
      rot = R.t < L.lie ? -Math.min(1, R.t / 0.3) * 1.4 : -1.4 * Math.max(0, 1 - (R.t - L.lie) / (L.rise * 0.8));
      pose = R.t < L.lie + L.rise * 0.5 ? { kind: 'hurt', t: 0 } : null;
    }
    return {
      x: isoX(this.x, this.y), y: isoY(this.x, this.y), z: this.z * 32, facing, time: t,
      walk: this.walk, move: this.dead ? 0 : this.moveAmt, pal: this.pal, head: 'hood', scarf: true, sashTail: true, gear: this.equip && this.equip !== 'default' ? this.equip : null,
      weapon: wpn, weapon2: wpn2, grip: rw.grip, backWeapon: null,
      pose, flash: this.flash, rot, sqx: 1, sqy, s: 1.05,
      shieldGlow: this.guard ? 0.2 + 0.8 * Math.min(1, this.guard.store / this.guard.def.maxStore) + (this.guard.flash > 0 ? 0.5 : 0) : 0,
    };
  }

  draw(ctx, t) {
    for (const a of this.afterimages) {
      const o = this.rigOpts(t);
      o.x = isoX(a.x, a.y); o.y = isoY(a.x, a.y); o.z = a.z * 32; o.rot = a.rot; o.pal = SHADOW_PAL; o.pose = a.pose || null; o.facing = a.facing;
      o.alpha = (a.life / a.max) * (a.type === 'shadow' ? 0.32 : 0.16); o.flash = 0; o.scarf = false; o.gear = null;
      drawHumanoid(ctx, o);
    }
    const d = this.dash;
    let alpha = 1;
    if (this.dead) alpha = Math.max(0.35, 1 - this.deadT * 0.5);
    if (this.downed && !this.relife) alpha = 0.8;
    if (this.active && this.inSmoke()) alpha *= 0.55;
    if (d.t > 0 && d.type === 'shadow') { const k = 1 - d.t / d.dur; alpha = k < 0.15 || k > 0.85 ? 1 : 0.15; }
    if (this.finisher) alpha *= finisherLook(this).alpha;
    if (!this.dead && this.iframes > 0 && d.t <= 0 && !this.leap && this.hurtT <= 0 && this.flash <= 0) alpha *= 0.65 + 0.35 * Math.sin(t * 40);
    const o = this.rigOpts(t);
    o.alpha = alpha;
    const sx0 = isoX(this.x, this.y), sy0 = isoY(this.x, this.y, this.z);
    if (this.charge && this.weapons[this.charge.slot].key === 'heavy' && this.active) { // heavy charge: a warm glow building around the body
      const k = this.chargeFrac(), full = k >= 0.999;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.12 + 0.25 * k + (full ? 0.12 * Math.sin(t * 18) : 0);
      const gg = ctx.createRadialGradient(sx0, sy0 - 26, 0, sx0, sy0 - 26, 30 + 14 * k);
      gg.addColorStop(0, '#ffcf7a'); gg.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(sx0, sy0 - 26, 30 + 14 * k, 0, TAU); ctx.fill(); ctx.restore();
    }
    drawHumanoid(ctx, o);
    if (this.guard && this.active) { // Bulwark: a big round meter over the head: the store (arc + number) and the time left
      const G = this.guard, k = Math.min(1, G.store / G.def.maxStore), cx = sx0, cy = sy0 - (this.g.players.length > 1 ? 92 : 70);
      const hot = G.store >= (G.def.minStore || 0), pulse = G.flash > 0 ? 1.18 : 1, R = 17 * pulse;
      ctx.save();
      // the time left: a thin ring around the outside
      ctx.strokeStyle = 'rgba(255,240,200,0.75)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, R + 6, -Math.PI / 2, -Math.PI / 2 + (1 - G.t / G.dur) * TAU); ctx.stroke();
      // a dark disc with the store as a thick arc, gold that turns red-hot as it fills
      ctx.fillStyle = 'rgba(16,10,14,0.88)'; ctx.beginPath(); ctx.arc(cx, cy, R + 2, 0, TAU); ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, TAU); ctx.stroke();
      ctx.strokeStyle = !hot ? '#c8c0b0' : k > 0.6 ? '#ff6a3a' : '#ffd060';
      if (hot) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10; }
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, -Math.PI / 2, -Math.PI / 2 + Math.max(0.03, k) * TAU); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.font = `800 ${G.store >= 100 ? 13 : 15}px "Zen Kaku Gothic New", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(String(Math.round(G.store)), cx, cy + 0.5);
      ctx.fillStyle = hot ? '#fff3c8' : '#d8d0c0'; ctx.fillText(String(Math.round(G.store)), cx, cy + 0.5);
      ctx.restore(); ctx.textBaseline = 'alphabetic';
    }
    const bo = this.weapons.find((q) => q.key === 'bo');
    if (bo && bo.combo > 0 && this.active) { // bo combo pips over the head (5)
      const a = bo.comboT > 0 ? 1 : 0.6, py = sy0 - (this.g.players.length > 1 ? 80 : 56);
      for (let i = 0; i < 5; i++) {
        const px = sx0 + (i - 2) * 7, on = i < bo.combo; // (a little smaller since 2026-11-20: 3 x 2.6, 7 apart)
        ctx.globalAlpha = a * (on ? 1 : 0.45);
        ctx.fillStyle = on ? (i === 4 ? '#ffd060' : '#f4e6c0') : 'rgba(30,24,30,0.8)';
        ctx.beginPath(); ctx.moveTo(px, py - 3); ctx.lineTo(px + 2.6, py); ctx.lineTo(px, py + 3); ctx.lineTo(px - 2.6, py); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(20,14,20,0.8)'; ctx.lineWidth = 0.9; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (this.relife) drawBrokenHeart(ctx, isoX(this.x, this.y), isoY(this.x, this.y, this.z) - 46, this.relife.t);
    if (this.downed && !this.relife) { // countdown ring + revive progress
      const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y) - 42;
      const k = Math.max(0, this.downT) / PLAYER_BASE.downTime, rp = Math.min(1, this.reviveP / PLAYER_BASE.reviveTime);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,10,20,0.7)'; ctx.beginPath(); ctx.arc(sx, sy, 13, 0, TAU); ctx.stroke();
      ctx.strokeStyle = k < 0.3 ? '#ff5050' : '#ffd060'; ctx.beginPath(); ctx.arc(sx, sy, 13, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke();
      if (rp > 0) { ctx.strokeStyle = '#7dff9a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, 8, -Math.PI / 2, -Math.PI / 2 + rp * TAU); ctx.stroke(); }
      ctx.font = '800 9px "Zen Kaku Gothic New", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText(Math.ceil(Math.max(0, this.downT)).toString(), sx, sy + 3);
      ctx.fillStyle = 'rgba(255,240,200,0.9)'; ctx.fillText('REVIVE', sx, sy - 18);
    }
    if (this.ironT > 0 && this.active) { // iron body: a gold shimmer
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22 + 0.1 * Math.sin(t * 20);
      ctx.strokeStyle = '#ffd070'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(sx0, sy0 - 22, 15, 27, 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    if (this.elemStormT > 0 && this.active) { // elemental storm: the four imbuement colours circling
      const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y, this.z);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ['#ffe46a', '#7be36a', '#9ee4ff', '#ff8a3c'].forEach((c, i) => { const a = t * 4 + (i * TAU) / 4; ctx.fillStyle = c; ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.arc(sx + Math.cos(a) * 18, sy - 20 + Math.sin(a) * 9, 3, 0, TAU); ctx.fill(); });
      ctx.restore();
    }
    if (this.windT > 0 && this.active && Math.random() < 0.5) this.g.particles.emit('dust', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), 0.1, rand(-0.5, 0.5), rand(-0.5, 0.5), 0.3, 0.4, 2.5, '#e8f4ee', { under: true });
    if (this.wisdomT > 0 && this.active) { // wisdom: a calm pale-blue glow and a slow ring
      const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y, this.z);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.18 + 0.06 * Math.sin(t * 4);
      ctx.fillStyle = '#8fd0ff'; ctx.beginPath(); ctx.ellipse(sx, sy - 22, 14, 25, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.strokeStyle = '#d8f0ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(sx, sy, 22 + 4 * Math.sin(t * 3), 11 + 2 * Math.sin(t * 3), 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (this.rageT > 0 && this.active) { // rage: red aura
      const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y, this.z);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + 0.1 * Math.sin(t * 12);
      ctx.fillStyle = '#ff4020'; ctx.beginPath(); ctx.ellipse(sx, sy - 22, 15, 26, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    if (this.chillT > 0 && !this.dead) { // frosted: icy aura
      const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y, this.z);
      ctx.save(); ctx.globalAlpha = 0.3 + 0.1 * Math.sin(t * 8);
      ctx.fillStyle = '#9ee4ff'; ctx.beginPath(); ctx.ellipse(sx, sy - 22, 12, 22, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (this.stunT > 0 && this.active) { // dazed: little stars circling the head
      const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y, this.z) - 50;
      for (let i = 0; i < 3; i++) {
        const a = t * 9 + (i * TAU) / 3;
        ctx.fillStyle = i % 2 ? '#ffe680' : '#fff6d0';
        ctx.beginPath(); ctx.arc(sx + Math.cos(a) * 9, sy + Math.sin(a) * 3.5, 2.4, 0, TAU); ctx.fill();
      }
    }
    // co-op marker above head
    if (this.g.players.length > 1 && !this.dead) {
      const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y, this.z) - 62;
      ctx.fillStyle = this.index === 0 ? '#e05252' : '#52a8e0';
      ctx.beginPath(); ctx.moveTo(sx - 6, sy - 8); ctx.lineTo(sx + 6, sy - 8); ctx.lineTo(sx, sy); ctx.closePath(); ctx.fill();
      ctx.font = '800 10px "Zen Kaku Gothic New", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`P${this.index + 1}`, sx, sy - 12);
    }
  }

  drawShadow(ctx) {
    drawShadow(ctx, isoX(this.x, this.y), isoY(this.x, this.y), 13 * (1 - this.z * 0.35), 0.3);
  }
}

// a heart over the fallen player, cracked in two: a life spent
function drawBrokenHeart(ctx, x, y, t) {
  const pop = Math.min(1, t / 0.18), split = clamp((t - 0.25) / 0.25, 0, 1), fade = 1 - clamp((t - 1.3) / 0.4, 0, 1);
  if (fade <= 0) return;
  const s = 9 * (0.6 + 0.4 * pop) * (1 + 0.15 * Math.sin(Math.min(1, t / 0.25) * Math.PI));
  const heart = (side) => { // one half of the heart; side -1 left, 1 right
    ctx.beginPath(); ctx.moveTo(0, -s * 0.45);
    ctx.bezierCurveTo(side * s * 0.25, -s * 1.05, side * s * 1.15, -s * 0.9, side * s * 1.0, -s * 0.2);
    ctx.bezierCurveTo(side * s * 0.9, s * 0.3, side * s * 0.4, s * 0.6, 0, s * 1.0);
    ctx.lineTo(side * s * 0.18, s * 0.45); ctx.lineTo(-side * s * 0.12, s * 0.05); ctx.lineTo(side * s * 0.14, -s * 0.2); ctx.closePath();
  };
  ctx.save(); ctx.translate(x, y - 6 * (1 - pop) - 4 * split); ctx.globalAlpha *= fade * pop;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 3.5 * split, 2 * split); ctx.rotate(side * 0.28 * split);
    heart(side);
    ctx.fillStyle = '#c8202c'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(30,8,12,0.9)'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,190,190,0.55)'; ctx.beginPath(); ctx.ellipse(side * s * 0.55, -s * 0.45, s * 0.18, s * 0.12, side * -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

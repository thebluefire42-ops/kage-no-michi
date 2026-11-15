// The player ninja: movement, dash, weapons, stats and elements. One instance per player (co-op).
// Dash moves: which acrobatic move a dash becomes depends on where you dash compared to where you aim
// (forward, sideways or away). air = jump height (tiles), spin = body turns (+ forward, - backward),
// twist = turns around the upright axis, faceAim = keeps facing the aim instead of the dash direction.
export const DASH_MOVES = {
  jump:     { air: 0.75, spin: 0,  long: true },
  flip:     { air: 1.05, spin: 1,  long: true, tuck: true },
  backflip: { air: 0.95, spin: -1, long: true, tuck: true, faceAim: true },
  aerial:   { air: 0.7,  spin: 1,  long: true, faceAim: true },
  vault:    { air: 0.85, spin: 0,  long: true, twist: 1, tuck: true },
  roll:     { air: 0,    spin: 1,  squash: 0.85 },
  slide:    { air: 0,    spin: 0,  slide: true, faceAim: true },
  shadow:   { air: 0,    spin: 0 },
};
const DASH_CHOICES = { // [move, weight]
  forward: [['flip', 3], ['roll', 2.5], ['vault', 2], ['jump', 1.5], ['shadow', 2]],
  side:    [['aerial', 3.5], ['slide', 2.5], ['roll', 2], ['shadow', 1.5]],
  back:    [['backflip', 4.5], ['roll', 1.5], ['shadow', 2]],
};
import { TAU, clamp, lerp, rand, pick, ease, isoX, isoY, screenDirToWorld, worldDirToScreenAngle, angDiff } from './util.js';
import { PLAYER_BASE, WEAPONS, TALENTS, ELEMENTS, weaponMove, ENEMY_DAMAGE_MUL, WEAPON_SWITCH, DAMAGE_SPREAD } from './config.js';
import { talentCd, talentTarget, activateTalent } from './talents.js';
import { drawHumanoid, drawShadow } from './rig.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { net } from './net.js';
import { ARTS } from './arts.js';
import { updateFinisher, finisherLook } from './finishers.js';

const PALS = [
  { skin: '#f1c9a5', cloth: '#2c3a5e', cloth2: '#1d2742', sash: '#c0392b', hood: '#232c46', scarf: '#d63a3a', metal: '#e6edf5', wood: '#7a4e2a', accent: '#c0392b' },
  { skin: '#f1c9a5', cloth: '#e6e2d6', cloth2: '#3a4a5e', sash: '#2a7ac0', hood: '#d8d2c2', scarf: '#3a9ae0', metal: '#e6edf5', wood: '#7a4e2a', accent: '#2a7ac0' },
];
// bo staff moves: when the hit lands (fraction of the animation), reach and arc multipliers
const BO_MOVES = {
  boJab: { at: 0.34, rng: 1.2, arc: 40, knock: 1.4 },
  boSweep: { at: 0.22, rng: 0.95, arc: 140, knock: 0.8 },
  boRise: { at: 0.25, rng: 1.0, arc: 90, knock: 1.0 },
  boOverhead: { at: 0.45, rng: 1.0, arc: 70, knock: 1.2 },
  boTwirl: { at: 0.3, rng: 0.75, arc: 360, knock: 0.6 },
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
    this.weapons = weaponKeys.map((k) => ({ key: k, def: WEAPONS[k], cd: 0, cdMax: 1, scd: 0, scdMax: 1, side: 1, elements: { lightning: 0, poison: 0, ice: 0, syphon: 0, wind: 0 } }));
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
  get maxHp() { const V = this.anyArt('vigor'); return Math.round(PLAYER_BASE.maxHp * (this.maxHpMul || 1)) + (V ? V.hp : 0); }

  // ---------------- weapon arts ----------------
  // the art's numbers if weapon w carries it, else null
  art(w, key) { const a = w && w.arts; return a && (a.basic === key || a.special === key || a.unique === key) ? ARTS[w.key][key] : null; }
  anyArt(key) { for (const w of this.weapons) { const A = this.art(w, key); if (A) return A; } return null; }
  get dodgeChance() { let d = 0; for (const w of this.weapons) for (const k of Object.values(w.arts || {})) d += (ARTS[w.key][k] && ARTS[w.key][k].dodge) || 0; return Math.min(0.2, d); } // capped at 20%
  // Berserker: more damage the lower your health (+0% full, up to +max at `at` health)
  artDmgMul(w) { const B = this.art(w, 'berserker'); return B ? 1 + B.max * clamp((1 - this.hp / this.maxHp) / (1 - B.at), 0, 1) : 1; }
  chargeTimeOf(w) { const A = this.art(w, 'quickCharge') || this.art(w, 'deepCharge'); return w.def.basic.chargeTime * (A ? A.chargeMul : 1); }
  // Endless Tempo: a kill with that weapon refunds ki and cuts its cooldowns
  onKill(e, src) {
    const w = src.weapon, A = w && this.art(w, 'endlessTempo');
    if (!A) return;
    this.energy = Math.min(this.maxEnergy, this.energy + A.ki); w.cd *= 1 - A.cdCut; w.scd *= 1 - A.cdCut;
    this.g.fx.text(this.x, this.y, `+${A.ki} energy`, '#9ee8ff', 12);
  }
  // Sacred Pool: a holy pool that hurts enemies standing in it (host only)
  addPool(x, y, r, P, base, w) { this.g.fx.pool(x, y, r, P.dur); if (!this.netClient) (this.pools || (this.pools = [])).push({ x, y, r, t: P.dur, tick: P.tick, every: P.tick, dmg: base * P.dmgMul, w }); }
  updateZones(dt) {
    const g = this.g;
    if (this.pools) for (const P of this.pools) {
      P.t -= dt; P.tick -= dt;
      if (P.tick > 0) continue;
      P.tick += P.every;
      for (const e of g.enemies) {
        if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro' || Math.hypot(e.x - P.x, e.y - P.y) > P.r + e.r) continue;
        const { dmg } = this.rollDamage(P.dmg, P.w);
        g.damageEnemy(e, dmg, false, 0, 0, 0, 0, { player: this, weapon: P.w, dot: true });
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
        const KF = p !== this && this.art(Z.w, 'kiFlow'); if (KF && got > 0) this.energy = Math.min(this.maxEnergy, this.energy + KF.perHeal / (Z.dur / Z.every));
      }
    }
    if (this.zones) this.zones = this.zones.filter((Z) => Z.t > 0);
  }
  get maxEnergy() { return PLAYER_BASE.maxEnergy; }
  // every attack cooldown of weapon w is multiplied by this (Wind on that weapon, cooldown sacrifices)
  cdMulFor(w) {
    const wind = Math.min(ELEMENTS.wind.cap, (w && w.elements.wind ? w.elements.wind : 0) * (this.elemMul || 1));
    return (this.stats.cooldownMul || 1) * (this.stats.cooldown || 1) * (1 - wind);
  }
  get dashCooldown() { return Math.max(PLAYER_BASE.dash.minCooldown, PLAYER_BASE.dash.cooldown * (this.stats.cooldown || 1)); }

  after(delay, fn) { this.timers.push({ t: delay, fn }); }

  applyChill(amount, dur) {
    if (this.dead || !amount) return;
    this.chill = Math.max(this.chillT > 0 ? this.chill : 0, amount); this.chillT = Math.max(this.chillT, dur);
    if (this.remote) net.send('pchill', { a: amount, d: dur }); // the joiner moves its own ninja
  }

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
      this.energy = Math.min(this.maxEnergy, this.energy + st.energyRegen * dt);
    }
    this.iframes = Math.max(0, this.iframes - dt); this.flash = Math.max(0, this.flash - dt); this.hurtT = Math.max(0, this.hurtT - dt);
    this.actionT = Math.max(0, this.actionT - dt);
    for (const w of this.weapons) { w.cd = Math.max(0, w.cd - dt); w.scd = Math.max(0, w.scd - dt); w.comboT = Math.max(0, (w.comboT || 0) - dt); this.boDecay(w, dt); w.lockT = Math.max(0, (w.lockT || 0) - dt); }
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    if (this.tx !== undefined) { const k = 1 - Math.exp(-14 * dt); this.x = lerp(this.x, this.tx, k); this.y = lerp(this.y, this.ty, k); }
    if (this.spin) this.updateSpin(dt);
    if (this.leap) this.updateLeap(dt);
    if (this.bash) this.updateBash(dt);
    if (this.guard) this.updateGuard(dt);
    if (this.reflectT > 0) { this.reflectT -= dt; this.reflectAround(this.reflectW); }
    this.ironT = Math.max(0, (this.ironT || 0) - dt);
    if (this.pools || this.zones) this.updateZones(dt);
    if (this.anim) { this.anim.t += dt / this.anim.dur; if (this.anim.t >= 1) this.anim = null; }
  }
  // host side: perform an attack the joiner started
  forceAttack(slot, special, ax, ay, ch, cb) {
    const w = this.weapons[slot];
    if (!w) return;
    this.aimX = ax; this.aimY = ay;
    this.actionT = 0; this.spin = null; w.lockT = 0;
    if (special) { w.scd = 0; this.energy = Math.max(this.energy, this.kiCost(w.def.special)); this.trySpecial(slot); }
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
  rollDamage(base, w = null, forceCrit = false) {
    const crit = forceCrit || this.alwaysCrit || (!this.noCrit && Math.random() < this.stats.critChance);
    let dmg = base * this.stats.baseDamage * (this.dmgMul || 1) * (this.adminMul || 1) * this.artDmgMul(w) * (this.rageT > 0 ? (this.rageMul || 2) : 1) * (this.rushT > 0 ? this.rushMul : 1);
    const SE = this.art(w, 'sharpEdge');
    if (crit) dmg *= 1 + this.stats.critDamage + (SE ? SE.critDmg : 0);
    // a little luck on every hit: ±12% around the base (at least ±1, so small hits vary too)
    dmg += (Math.random() * 2 - 1) * Math.max(dmg * DAMAGE_SPREAD, 1);
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  }

  resetForLevel(x, y) {
    this.x = x; this.y = y; this.vx = this.vy = this.kvx = this.kvy = 0; this.z = 0;
    this.aimX = -0.7071; this.aimY = -0.7071;
    this.dash.t = 0; this.leap = null; this.spin = null; this.anim = null; this.timers = []; this.afterimages = [];
    this.actionT = 0;
    this.flurry = null; this.rageT = 0; this.charge = null; this.stunT = 0;
    this.bash = null; this.guard = null; this.reflectT = 0; this.switchT = 0; this.swap = null; this.finisher = null;
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
    this.autoTarget = best;
    if (best) { const l = bd || 1; this.aimX = (best.x - this.x) / l; this.aimY = (best.y - this.y) / l; this.aimMode = 'auto'; }
    else if (this.moveX || this.moveY) { const l = Math.hypot(this.moveX, this.moveY); this.aimX = this.moveX / l; this.aimY = this.moveY / l; this.aimMode = 'move'; }
  }

  // shared timers (local and host-side remote players)
  tickCommon(dt) {
    this.rageT = Math.max(0, this.rageT - dt);
    if (!this.g.cleared) this.rushT = Math.max(0, this.rushT - dt);
    // talent cooldowns freeze once the level is cleared (no waiting around for them to refill)
    if (!this.g.cleared) for (const t of this.talents) t.cd = Math.max(0, t.cd - dt);
    if (this.flurry) this.updateFlurry(dt);
  }

  // co-op: lying down, waiting for the partner to revive us
  updateDowned(dt) {
    const g = this.g;
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
      this.energy = Math.min(this.maxEnergy, this.energy + st.energyRegen * dt);
    }
    this.iframes = Math.max(0, this.iframes - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.chillT = Math.max(0, this.chillT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.dash.cd = Math.max(0, this.dash.cd - dt);
    this.switchT = Math.max(0, this.switchT - dt);
    this.ironT = Math.max(0, (this.ironT || 0) - dt);
    if (this.pools || this.zones) this.updateZones(dt);
    for (const w of this.weapons) { w.cd = Math.max(0, w.cd - dt); w.scd = Math.max(0, w.scd - dt); w.comboT = Math.max(0, (w.comboT || 0) - dt); this.boDecay(w, dt); w.lockT = Math.max(0, (w.lockT || 0) - dt); }

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]; tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    if (this.finisher) { updateFinisher(this, dt); return; } // a finishing move plays out on its own

    const frozen = g.inputLocked;
    const mi = frozen ? 0 : Math.hypot(c.move.x, c.move.y);
    if (mi > 0.01) { const [wx, wy] = screenDirToWorld(c.move.x, c.move.y); this.moveX = wx * mi; this.moveY = wy * mi; }
    else { this.moveX = 0; this.moveY = 0; }
    if (!frozen) this.updateAim();

    if (!frozen && this.stunT <= 0 && c.pressed('dash') && this.dash.t <= 0 && this.dash.cd <= 0 && !this.leap && !this.bash && !this.guard && this.energy >= PLAYER_BASE.dash.cost) this.startDash();

    if (this.dash.t > 0) {
      this.updateDash(dt);
    } else if (this.leap) {
      this.updateLeap(dt);
    } else if (this.bash) {
      this.updateBash(dt);
    } else {
      const spd = PLAYER_BASE.speed * st.moveSpeed * (this.weaponMove || 1) * (this.slowT > 0 ? 0.45 : 1) * (this.spin ? 0.8 : 1) * (this.flurry ? 0.4 : 1) * (this.charge ? 0.7 : 1) * (this.guard ? this.guard.def.move : 1) * (this.anyArt('lightFeet') ? this.anyArt('lightFeet').move : 1) * (this.stunT > 0 ? 0 : 1) * (1 - (this.chillT > 0 ? this.chill : 0));
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

    // talents (X / Y / B or 1 / 2 / 3)
    if (!frozen && this.stunT <= 0) ['t1', 't2', 't3'].forEach((a, i) => { if (c.pressed(a)) this.useTalent(i); });

    // the monk staff's quiet glow: golden motes drift up around its bearer
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
      else if (!c.down(ch.slot === 0 ? 'L1' : 'R1')) this.releaseCharge();
    }
    // attacks: each weapon has its own lock, so both weapons can attack at the same time.
    // Whole-body moves (whirlwind spin, thousand strikes, ground-slam leap, dash) still block both.
    if (this.guard) this.updateGuard(dt);
    if (this.reflectT > 0) { this.reflectT -= dt; this.reflectAround(this.reflectW); }
    if (!frozen && this.stunT <= 0 && this.dash.t <= 0 && !this.leap && !this.spin && !this.flurry && !this.bash && !this.guard) {
      for (let i = 0; i < 2; i++) {
        const w = this.weapons[i];
        if (w.lockT > 0 || this.charge) continue;
        // no quick swaps: the other weapon waits until the last attack's lock plus a short switch gap have passed
        if (i !== this.lastSlot && this.switchT > 0) {
          if (!this.swap && (c.down(i === 0 ? 'L1' : 'R1') || c.down(i === 0 ? 'L2' : 'R2'))) { this.swap = { to: i, t: 0, dur: Math.max(0.12, this.switchT) }; sfx.heavyWhoosh(0); }
          continue;
        }
        if (c.down(i === 0 ? 'L2' : 'R2')) this.trySpecial(i);
        if (w.lockT > 0 || this.spin || this.flurry || this.leap) continue;
        if (!c.down(i === 0 ? 'L1' : 'R1')) continue;
        // crossbow and heavy sword: hold to charge, release to attack
        if (w.key === 'crossbow' || w.key === 'heavy') { if (w.cd <= 0 && this.energy >= this.kiCost(w.def.basic)) { this.charge = { slot: i, t: 0 }; this.activeSlot = i; this.lastSlot = i; this.switchT = WEAPON_SWITCH; } }
        else this.tryBasic(i);
      }
    }

    if (this.swap) { this.swap.t += dt; if (this.swap.t >= this.swap.dur) { this.activeSlot = this.swap.to; this.swap = null; } }
    if (this.spin) this.updateSpin(dt);
    if (this.anim) { this.anim.t += dt / this.anim.dur; if (this.anim.t >= 1) this.anim = null; }
    for (let i = this.afterimages.length - 1; i >= 0; i--) { const a = this.afterimages[i]; a.life -= dt; if (a.life <= 0) this.afterimages.splice(i, 1); }
  }

  lock(t, w = this.weapons[this.activeSlot]) {
    const v = t * this.cdMulFor(w); this.actionT = v; this.actionMax = v; w.lockT = v; w.lockMax = v;
    this.lastSlot = this.weapons.indexOf(w); this.switchT = v + WEAPON_SWITCH; // switching weapons has to wait this long
    const g = this.g;
    if (g.noteCombat && g.enemies.some((e) => !e.dead && !e.preview && Math.hypot(e.x - this.x, e.y - this.y) < 7)) g.noteCombat();
  }
  // ki an attack costs after Ki Focus upgrades (specials; the basic attacks of knives / crossbow / heavy sword)
  kiCost(def) { return Math.round((def.cost || 0) * (this.stats.kiCost ?? 1)); }

  chargeFrac() {
    if (!this.charge) return 0;
    return ease.outQuad(clamp(this.charge.t / this.chargeTimeOf(this.weapons[this.charge.slot]), 0, 1));
  }
  releaseCharge() {
    const ch = this.chargeFrac(), slot = this.charge.slot;
    this.charge = null;
    this.tryBasic(slot, { ch });
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
    const w = this.weapons[this.lastSlot >= 0 ? this.lastSlot : this.activeSlot] || this.weapons[0], def = w.def.basic;
    ctx.save();
    ctx.translate(isoX(this.x, this.y), isoY(this.x, this.y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4); ctx.rotate(Math.atan2(this.aimY, this.aimX));
    ctx.fillStyle = 'rgba(236,236,236,0.14)'; ctx.strokeStyle = 'rgba(236,236,236,0.45)'; ctx.lineWidth = 2;
    const cone = (r, arc) => { const h = (arc / 2) * Math.PI / 180; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r * S, -h, h); ctx.closePath(); ctx.fill(); ctx.stroke(); };
    const lane = (len, wid, from = 0.4) => { ctx.fillRect(from * S, -wid * S / 2, (len - from) * S, wid * S); ctx.strokeRect(from * S, -wid * S / 2, (len - from) * S, wid * S); };
    if (w.key === 'katanas' || w.key === 'heavy' || w.key === 'bo') cone(def.range, def.arc);
    else if (w.key === 'shield') { lane(def.dash, 0.7, 0.3); ctx.translate(def.dash * S, 0); cone(def.range, def.arc); }
    else if (w.key === 'knives') lane(def.speed * 0.9, 0.3);
    else if (w.key === 'crossbow') lane(def.maxRange, 0.32);
    else if (w.key === 'staff') { lane(def.range, 0.3); ctx.beginPath(); ctx.arc(def.range * S, 0, def.radius * S, 0, TAU); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }

  drawChargeIndicator(ctx) {
    if (!this.charge || !this.active) return;
    const w = this.weapons[this.charge.slot], def = w.def.basic, k = this.chargeFrac();
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
      const hit = this.meleeHit(base, R, arcOverride && kind !== 'boJab' ? Math.max(M.arc, arcOverride) : M.arc, knock * M.knock, stun, w);
      if (hit) {
        g.particles.burst('spark', this.x + ax * R * 0.7, this.y + ay * R * 0.7, 0.6, finisher ? 10 : 5, finisher ? 6 : 4, 0.2, 1.4, '#fff2c0');
        if (finisher) { g.hitstop(0.05); g.shake(3.5); g.fx.ring(this.x + ax * R * 0.7, this.y + ay * R * 0.7, 0.9, 'rgba(255,236,190,0.9)', 0.25, 4); }
      }
      onResult?.(hit || this.netClient);
    });
  }

  // ---------------- dash ----------------
  startDash() {
    const D = PLAYER_BASE.dash;
    let dx = this.moveX, dy = this.moveY;
    if (Math.hypot(dx, dy) < 0.1) { dx = this.aimX; dy = this.aimY; }
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    for (const w of this.weapons) {
      if (this.art(w, 'quickReload')) { w.cd = 0; w.scd = 0; this.g.fx.ring(this.x, this.y, 0.7, 'rgba(255,230,160,0.8)', 0.2, 2); } // dashing reloads the crossbow
      if (this.art(w, 'flowState')) { w.combo = 5; w.comboT = w.def.basic.comboHold; w.decayT = 0; } // straight to max combo
    }
    // a tactical move: flips and vaults when closing in, aerials and slides when strafing (still facing the
    // aim), a backflip when breaking away; never the same move twice in a row
    const dot = dx * this.aimX + dy * this.aimY, dir = dot > 0.35 ? 'forward' : dot < -0.35 ? 'back' : 'side';
    const choose = () => { const L = DASH_CHOICES[dir], tot = L.reduce((a, [, w]) => a + w, 0); let r = Math.random() * tot; for (const [m, w] of L) { r -= w; if (r <= 0) return m; } return L[0][0]; };
    let type = choose();
    if (type === this.lastDash) type = choose();
    this.lastDash = type;
    this.energy -= D.cost;
    const d = this.dash;
    d.type = type; d.dur = DASH_MOVES[type].long ? D.jumpDuration * (DASH_MOVES[type].spin ? 1.15 : 1) : D.duration * (type === 'slide' ? 1.25 : 1); d.t = d.dur;
    d.ax = this.aimX; d.ay = this.aimY;
    d.dx = dx; d.dy = dy; d.sx = this.x; d.sy = this.y;
    d.cd = this.dashCooldown + d.dur; d.cdMax = d.cd;
    d.trail = 0;
    this.iframes = Math.max(this.iframes, d.dur + 0.06);
    this.anim = null; this.spin = null; this.actionT = 0; this.charge = null;
    sfx.dash();
    const g = this.g;
    if (type === 'shadow') {
      g.particles.burst('ink', this.x, this.y, 0.6, 14, 3, 0.5, 4, '#2a1a40');
      g.particles.burst('smoke', this.x, this.y, 0.3, 6, 1.5, 0.6, 7, 'rgba(60,40,90,1)');
    } else {
      g.particles.burst('dust', this.x, this.y, 0.05, 6, 1.5, 0.5, 4, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
    }
  }

  updateDash(dt) {
    const d = this.dash, D = PLAYER_BASE.dash, g = this.g;
    d.t -= dt;
    const k = 1 - Math.max(0, d.t) / d.dur;
    const e = d.type === 'shadow' ? ease.outQuad(k) : ease.outCubic(k);
    const px = this.x, py = this.y;
    this.x = d.sx + d.dx * D.distance * e; this.y = d.sy + d.dy * D.distance * e;
    const hitWall = g.world.collide(this);
    if (hitWall) { d.sx += this.x - (d.sx + d.dx * D.distance * e); d.sy += this.y - (d.sy + d.dy * D.distance * e); }
    this.vx = ((this.x - px) / dt) * 0.2; this.vy = ((this.y - py) / dt) * 0.2;
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
    const def = w.def.basic, C = def.comboCd;
    if (!hit) { w.combo = 0; w.chain = 0; w.comboT = 0; return; }
    const before = w.combo || 0;
    w.combo = Math.min(5, before + 1); w.chain = (w.chain || 0) + 1; w.comboT = def.comboHold; w.decayT = 0;
    w.cd = Math.max(0, w.cd - (C[before] - C[w.combo]) * this.cdMulFor(w));
  }

  // opt.ch = crossbow charge (0..1), opt.cb = bo combo step (sent by the joiner)
  tryBasic(i, opt = {}) {
    const w = this.weapons[i];
    if (w.cd > 0) return;
    const def = w.def.basic;
    const cost = this.kiCost(def);
    if (this.energy < cost) return;
    this.energy -= cost;
    if (this.netClient) {
      const cb = w.key === 'bo' ? (w.chain || 0) % 5 : undefined;
      net.send('atk', { slot: i, special: 0, ax: this.aimX, ay: this.aimY, ch: opt.ch, cb });
    }
    w.cd = def.interval * this.cdMulFor(w); w.cdMax = w.cd;
    this.lock(def.lock, w);
    this.activeSlot = i;
    const g = this.g, ax = this.aimX, ay = this.aimY;
    switch (w.key) {
      case 'katanas': { // light and quick; every 3rd cut of a rhythm is a bigger, brighter one
        w.side = -w.side;
        w.kc = g.time - (w.kLast ?? -9) > 0.9 ? 0 : ((w.kc ?? -1) + 1) % 3; w.kLast = g.time;
        const big = w.kc === 2, sa = slashAngle(ax, ay);
        this.anim = { kind: 'slash', side: w.side, t: 0, dur: Math.max(0.13, this.actionT * 0.85) };
        sfx.katana(w.kc);
        const FS = this.art(w, 'flowingStep'), CB = this.art(w, 'crossedBlades');
        const lunge = big ? (FS ? FS.lunge : 0.22) : 0.12;
        if (big && FS) this.afterimages.push({ x: this.x, y: this.y, z: 0, life: 0.22, max: 0.22, rot: 0, type: 'shadow', facing: this.facingAngle(), pose: { kind: 'slash', t: 0.3, side: w.side } });
        this.x += ax * lunge; this.y += ay * lunge; g.world.collide(this);
        if (big) {
          g.fx.slash(this.x, this.y, sa, def.range * 1.0, 2.75, 'rgba(255,255,255,0.95)', 15, 0.2, 0.55, w.side);
          g.fx.slash(this.x, this.y, sa, def.range * 0.78, 2.4, 'rgba(150,205,255,0.6)', 6, 0.24, 0.62, w.side);
          g.particles.burst('spark', this.x + ax * def.range * 0.8, this.y + ay * def.range * 0.8, 0.6, 5, 5, 0.16, 1.1, '#e8f4ff');
        } else g.fx.slash(this.x, this.y, sa, def.range * 0.85, 2.2, 'rgba(235,245,255,0.88)', 8, 0.11, 0.55, w.side);
        this.after(0.03, () => this.meleeHit(def.dmg, def.range * (big ? 1.08 : 1), def.arc + (big ? 15 : 0), big ? 2.6 : 1.5, 0.12, w, { sound: 'cut', forceCrit: big && !!FS }));
        if (big && CB) this.after(0.07, () => { // crossed blades: an X of cuts all around
          g.fx.slash(this.x, this.y, 0.8, CB.radius * 0.85, TAU * 0.5, 'rgba(230,240,255,0.85)', 10, 0.2, 0.55, 1);
          g.fx.slash(this.x, this.y, 0.8 + Math.PI, CB.radius * 0.85, TAU * 0.5, 'rgba(160,210,255,0.7)', 10, 0.2, 0.55, -1);
          g.fx.ring(this.x, this.y, CB.radius, 'rgba(220,235,255,0.7)', 0.25, 3);
          this.meleeHit(def.dmg * CB.dmgMul, CB.radius, 360, 2.5, 0.12, w, { sound: 'cut' });
        });
        break;
      }
      case 'heavy': {
        const ch = clamp(opt.ch || 0, 0, 1), charged = ch > 0.15;
        // a tap winds up from the shoulder; a charged blade is already raised, so the blow falls at once
        this.anim = { kind: 'heavyCleave', t: charged ? 0.4 : 0, dur: charged ? 0.42 : 0.62 };
        this.slowT = 0.5;
        const delay = charged ? 0.08 : 0.27, dustCol = g.world.bi === 2 ? '#eef3fb' : '#c8b088';
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
          const hit = this.meleeHit(def.dmg * (1 + ch * def.chargeDmg) * (DC ? DC.dmgMul : 1), R, def.arc, def.knock + ch * def.chargeKnock, 0.35 + ch * 0.3, w, { sound: 'heavyHit' });
          if (hit) g.hitstop(0.04 + ch * 0.05);
        });
        break;
      }
      case 'crossbow': {
        this.anim = { kind: 'shoot', t: 0, dur: 0.3 };
        const ch = clamp(opt.ch || 0, 0, 1), SH = this.art(w, 'steadyHands'), SS = this.art(w, 'snapShot'), HM = this.art(w, 'huntersMark');
        const steady = SH && ch >= 0.999;
        sfx.twang(ch); if (steady) sfx.stringLock();
        // charged shots fly further: a tap reaches minRange, a full draw maxRange
        const range = lerp(def.minRange, def.maxRange, ch) * (SS ? SS.rangeMul : 1);
        const dmg = def.dmg * (SS ? SS.dmgMul : 1) * (steady ? SH.dmgMul : 1);
        this.proj({ kind: steady ? 'heavybolt' : 'bolt', x: this.x + ax * 0.4, y: this.y + ay * 0.4, z: 0.55, vx: ax * def.speed, vy: ay * def.speed, base: dmg, pierce: def.pierce, r: 0.2, life: range / def.speed, knock: 2.5, sound: 'thunk', shudder: 0.3, mark: HM ? HM.dur : 0, markMul: HM ? HM.mul : 1 }, w);
        this.kvx -= ax * 1.5; this.kvy -= ay * 1.5;
        break;
      }
      case 'knives': {
        w.side = -w.side;
        this.anim = { kind: 'throw', side: w.side, t: 0, dur: 0.2 };
        sfx.knifeThrow();
        const a = Math.atan2(ay, ax) + rand(-0.05, 0.05);
        g.particles.burst('spark', this.x + Math.cos(a) * 0.45, this.y + Math.sin(a) * 0.45, 0.65, 2, 3, 0.12, 0.8, '#fff0b8');
        const RC = this.art(w, 'ricochet'), TS = this.art(w, 'thirdCrit');
        w.kn = ((w.kn || 0) + 1) % 3; const third = TS && w.kn === 0;
        this.proj({ kind: 'kunai', x: this.x + Math.cos(a) * 0.3, y: this.y + Math.sin(a) * 0.3, z: 0.6, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, base: def.dmg, pierce: def.pierce, r: 0.18, life: 0.9, knock: 1, sound: 'knifeHit', sparks: true, bounce: RC ? RC.bounces : 0, bounceRange: RC ? RC.range : 0, forceCrit: third, golden: third }, w);
        break;
      }
      case 'bo': { // combo of up to 5: jab, sweep, rising strike, twirl, overhead finisher
        const step = opt.cb ?? (w.chain || 0) % 5, lv = Math.min(5, w.combo || 0);
        // the cooldown follows the combo level: slower than before at 0, much faster at 5
        const cd = def.comboCd[lv];
        w.cd = cd * this.cdMulFor(w); w.cdMax = w.cd;
        this.lock(Math.min(def.lock, cd * 0.85), w);
        w.comboT = Math.max(w.comboT || 0, 0.5); // no decay while this swing is still in the air
        if (this.netClient) this.lastCombo = step;
        const fin = step === 4; // the 5th hit: a hard knock and a short hitstop
        const PF = this.art(w, 'peakForm'), LR = this.art(w, 'longReach');
        this.boStrike(BO_COMBO[step], def.dmg * (PF && lv >= 5 ? PF.dmgMul : 1), def.range * (LR ? LR.rangeMul : 1), fin ? def.knock * 3.5 : def.knock, w, Math.max(0.16, this.actionT * 1.1), fin ? 0.3 : 0.1, null, lv, fin, (hit) => this.boResult(w, hit));
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
        this.anim = { kind: 'shieldBash', t: 0, dur: def.dashDur + 0.2 };
        sfx.heavyWhoosh(0);
        break;
      }
      case 'staff': { // spirit bolt that bursts into a small area at the first enemy or at max range
        this.anim = { kind: 'cast', t: 0, dur: 0.4 };
        sfx.shakujo();
        g.particles.burst('ember', this.x + ax * 0.5, this.y + ay * 0.5, 1.1, 5, 1.2, 0.5, 1.4, '#ffe7a0');
        const WB = this.art(w, 'wideBurst'), SP = this.art(w, 'sacredPool');
        this.proj({ kind: 'ofuda', x: this.x + ax * 0.5, y: this.y + ay * 0.5, z: 0.7, vx: ax * def.speed, vy: ay * def.speed, base: def.dmg, burst: def.radius * (WB ? WB.radiusMul : 1), r: 0.25, life: def.range / def.speed, seed: Math.random() * 9, pool: SP || null }, w);
        break;
      }
    }
  }

  // staff special: heal yourself and every ally within the circle
  healCircle(def, w) {
    const g = this.g;
    this.anim = { kind: 'cast', t: 0, dur: 0.5 };
    if (this.netClient) return;
    const LS = this.art(w, 'lifeSpring'), SA = this.art(w, 'sanctuary'), KF = this.art(w, 'kiFlow');
    const radius = def.radius * (SA ? SA.radiusMul : 1), amount = Math.round(def.heal * this.stats.baseDamage * (this.dmgMul || 1));
    sfx.shakujo(); sfx.rin(0.75); sfx.chime(1);
    g.fx.spirit(this.x, this.y, radius, { kanji: '癒', dur: LS ? LS.dur : 1.1, col: '190,255,200' });
    g.fx.ring(this.x, this.y, radius, 'rgba(200,255,210,0.9)', 0.6, 5);
    if (SA) for (const e of g.enemies) if (!e.dead && Math.hypot(e.x - this.x, e.y - this.y) < radius + e.r) { e.slow = Math.max(e.slow, SA.slow); e.slowT = Math.max(e.slowT, SA.slowDur); } // sanctuary
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
      if (KF && p !== this && got > 0) this.energy = Math.min(this.maxEnergy, this.energy + KF.perHeal); // ki flow
      g.fx.text(p.x, p.y, `+${Math.round(got)}`, '#7dff9a', 17);
      g.particles.burst('glow', p.x, p.y, 1, 10, 1.5, 0.8, 2, '#c8ffd0');
    }
  }

  trySpecial(i) {
    const w = this.weapons[i];
    const def = w.def.special;
    const cost = this.kiCost(def);
    if (w.scd > 0 || this.energy < cost || this.spin) return;
    w.scd = def.cd * this.cdMulFor(w); w.scdMax = w.scd;
    if (this.netClient) net.send('atk', { slot: i, special: 1, ax: this.aimX, ay: this.aimY });
    this.lock(def.lock, w);
    this.energy -= cost;
    this.activeSlot = i;
    const g = this.g, ax = this.aimX, ay = this.aimY;
    switch (w.key) {
      case 'katanas': {
        const SD = this.art(w, 'stormDancer'), SG = this.art(w, 'singleGale');
        const dur = def.dur * (SD ? SD.durMul : 1);
        this.spin = { t: 0, dur, tick: SG ? dur * 0.35 : 0, ticks: 0, n: SG ? 1 : Math.round(def.ticks * (SD ? SD.durMul * SD.tickMul : 1)), dmg: SG ? def.dmg * def.ticks * SG.dmgMul : def.dmg, radius: def.radius * (SG ? SG.radiusMul : 1), spinMul: SD ? 1.6 : 1, pull: SD, single: !!SG, def, w };
        this.anim = { kind: 'spin', t: 0, dur };
        sfx.slash();
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
        g.fx.thrust(this.x + ax * 0.5, this.y + ay * 0.5, ax, ay, 4, 'rgba(255,236,180,0.7)', 7, 0.18); // muzzle streak
        g.particles.burst('spark', this.x + ax * 0.6, this.y + ay * 0.6, 0.6, 6, 5, 0.15, 1.2, '#fff0c0');
        this.kvx -= ax * 6; this.kvy -= ay * 6;
        g.shake(4);
        break;
      }
      case 'heavy': {
        const D = def.leap;
        this.leap = { t: 0, dur: 0.34, sx: this.x, sy: this.y, dx: ax * D, dy: ay * D, def, w };
        this.anim = { kind: 'slam', t: 0, dur: 0.46 };
        this.iframes = Math.max(this.iframes, 0.4);
        const IB = this.art(w, 'ironBody'); if (IB) { this.ironT = IB.dur; g.fx.ring(this.x, this.y, 1.2, 'rgba(255,214,110,0.9)', 0.3, 4); }
        sfx.dash();
        break;
      }
      case 'knives': {
        this.anim = { kind: 'throw', side: 1, t: 0.25, dur: 0.25 };
        sfx.knifeThrow(); g.later(0.05, () => sfx.knifeThrow()); g.later(0.1, () => sfx.knifeThrow());
        const base = Math.atan2(ay, ax), FS = this.art(w, 'fanStorm'), FB = this.art(w, 'fanBounce');
        const count = FS ? FS.count : def.count, spread = FS ? FS.spread : def.spread;
        for (let k = 0; k < count; k++) {
          const a = base + ((k / (count - 1) - 0.5) * spread * Math.PI) / 180;
          this.proj({ kind: 'kunai', x: this.x + Math.cos(a) * 0.3, y: this.y + Math.sin(a) * 0.3, z: 0.6, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, base: def.dmg, pierce: def.pierce, r: 0.18, life: 0.85 * (FS ? FS.lifeMul : 1), knock: 1.2, sound: 'knifeHit', sparks: true, bounce: FB ? FB.bounces : 0, bounceRange: FB ? FB.range : 0 }, w);
        }
        break;
      }
      case 'staff': this.healCircle(def, w); break;
      case 'shield': // Bulwark: crouch behind the shield, store what it soaks up, then release it
        const LG = this.art(w, 'longGuard'), WR = this.art(w, 'wideRelease');
        this.guard = { t: 0, dur: def.dur * (LG ? LG.durMul : 1), store: 0, w, def, flash: 0, recent: [], radius: def.radius * (WR ? WR.radiusMul : 1) };
        this.anim = null; this.charge = null;
        sfx.absorb(); g.fx.ring(this.x, this.y, 0.9, 'rgba(255,214,140,0.8)', 0.25, 3);
        break;
      case 'bo':
        const LF = this.art(w, 'longFlurry'), HF = this.art(w, 'heavyFlurry');
        const fdef = LF ? { ...def, dur: def.dur * LF.mul, strikes: Math.round(def.strikes * LF.mul) } : HF ? { ...def, strikes: HF.strikes, dmg: def.dmg * HF.dmgMul } : def;
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
        this.meleeHit(s.dmg || s.def.dmg, R, 360, 2, 0.08, s.w);
      }
    }
    if (s.pull && !this.netClient) for (const e of g.enemies) { // storm dancer: drag enemies into the blades
      if (e.dead || e.boss || e.hidden || e.state === 'spawn') continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > 0.8 && d < R + s.pull.pullRange) { e.kvx -= (dx / d) * s.pull.pull * 2.5 * dt; e.kvy -= (dy / d) * s.pull.pull * 2.5 * dt; }
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
    this.bash = null; this.reflectT = 0.08; this.reflectW = B.w;
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
      q.vx = -q.vx; q.vy = -q.vy;
      q.owner = 'player'; q.from = this; q.weapon = w;
      const MP = this.art(w, 'mirror');
      q.base = (q.dmg || 5) * def.reflectMul * (MP ? MP.reflectMul : 1); // rollDamage adds baseDamage and crits
      q.hit = null; q.pierce = 0; q.homing = 0; q.life = 1.2; q.glow = true; q.reflected = true; q.onHit = null; q.knock = 3;
      q.x += q.vx * 0.03; q.y += q.vy * 0.03;
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
    this.guard = null;
    this.iframes = Math.max(this.iframes, 0.3);
    const stored = G.store >= (def.minStore || 0.5), radius = G.radius || def.radius; // too little absorbed: just a push
    g.fx.ring(this.x, this.y, radius, stored ? 'rgba(255,214,110,0.95)' : 'rgba(255,240,210,0.6)', 0.45, stored ? 9 : 4);
    if (stored) {
      g.fx.ring(this.x, this.y, radius * 0.7, 'rgba(210,40,40,0.9)', 0.38, 6);
      g.particles.burst('ink', this.x, this.y, 0.4, 24, 5, 0.7, 5, '#1e1428');
      g.particles.burst('ember', this.x, this.y, 0.5, 18, 5, 0.6, 2.4, '#ffcf6a');
      sfx.release(); g.hitstop(0.1); g.shake(10);
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

  meleeHit(base, range, arcDeg, knock, stun, w, extra = null) {
    if (this.netClient) return false;
    const g = this.g, half = ((arcDeg / 2) * Math.PI) / 180;
    const aim = Math.atan2(this.aimY, this.aimX);
    let any = false;
    for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > range + e.r) continue;
      if (arcDeg < 360 && d > 0.3 && Math.abs(angDiff(aim, Math.atan2(dy, dx))) > half) continue;
      const { dmg, crit } = this.rollDamage(base, w, !!(extra && extra.forceCrit));
      g.damageEnemy(e, dmg, crit, dx / (d || 1), dy / (d || 1), knock, stun, { player: this, weapon: w, melee: true, ...extra });
      any = true;
    }
    for (const p of g.projectiles) { // melee can cut enemy projectiles
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
    if ((this.iframes > 0 && !this.guard) || !this.active || g.god || g.inputLocked) return false;
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
    dmg *= ENEMY_DAMAGE_MUL * (this.takenMul || 1); // (Bound Souls: +25% damage taken)
    { const cw = this.charge && this.weapons[this.charge.slot], S = cw && this.art(cw, 'steadfast'); if (S) dmg *= S.mul; } // Steadfast
    // Bound Souls pact: half of the damage goes to the partner
    if (this.bound) {
      const o = g.players.find((q) => q !== this && q.bound && q.active);
      if (o) { dmg /= 2; o.sharedHurt(dmg); }
    }
    if (this.guard) return this.guardAbsorb(dmg, sx, sy);
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
      this.hp = 0; this.spin = null; this.leap = null; this.flurry = null; this.charge = null; this.bash = null; this.guard = null; this.dash.t = 0; this.z = 0;
      g.particles.burst('ink', this.x, this.y, 0.6, 20, 4, 0.8, 5, '#1e1428');
      // co-op: go down and wait for the partner, as long as someone is still standing
      const partnerUp = g.players.some((o) => o !== this && o.active);
      if (partnerUp) {
        this.downed = true; this.downT = PLAYER_BASE.downTime; this.reviveP = 0;
        g.banner({ title: `Player ${this.index + 1} is down!`, sub: `Stand next to them to revive (${PLAYER_BASE.downTime}s)`, dur: 2.4, y: 0.25, size: 26, color: 'rgba(60,4,10,0.8)' });
      } else { this.dead = true; this.deadT = 0; g.onPlayerDeath(this); }
    }
    return true;
  }

  // ---------------- rendering ----------------
  rigOpts(t) {
    // during a weapon swap the incoming weapon is already in hand, twirled up from the back
    const S = this.swap, slot = S ? S.to : this.activeSlot;
    const w = this.weapons[slot], other = this.weapons[1 - slot];
    const rw = RIG_WEAPON[w.key], ro = RIG_WEAPON[other.key];
    let facing = this.facingAngle();
    const heavyCh = this.charge && this.weapons[this.charge.slot].key === 'heavy';
    let pose = S && !this.anim ? { kind: 'spin', t: S.t / S.dur } : this.anim ? { kind: this.anim.kind, t: this.anim.t, side: this.anim.side } : heavyCh ? { kind: 'heavyCharge', t: this.chargeFrac(), raise: Math.min(1, this.charge.t / 0.16) } : this.charge ? { kind: 'shoot', t: 1 - this.chargeFrac() * 0.6 } : null;
    if (this.spin) facing = t * 40 * (this.spin.spinMul || 1);
    if (this.hurtT > 0 && !pose) pose = { kind: 'hurt', t: 1 - this.hurtT / 0.3 };
    let rot = 0, sqy = 1;
    const d = this.dash;
    if (d.t > 0) {
      const A = this.dashLook(d, 1 - d.t / d.dur);
      facing = A.facing; rot = A.rot; sqy = A.sqy; if (A.pose) pose = A.pose;
    }
    if (this.leap) pose = { kind: 'slam', t: this.anim ? this.anim.t : 0.5 };
    if (this.guard) pose = { kind: 'shieldGuard', t: this.guard.t / this.guard.dur };
    if (this.finisher) { const L = finisherLook(this); pose = L.pose; facing = L.facing; rot = L.rot; sqy = 1; }
    if (this.dead || this.downed) { rot = -Math.min(1, (this.dead ? this.deadT : 1) / 0.3) * 1.4; pose = { kind: 'hurt', t: 0 }; }
    return {
      x: isoX(this.x, this.y), y: isoY(this.x, this.y), z: this.z * 32, facing, time: t,
      walk: this.walk, move: this.dead ? 0 : this.moveAmt, pal: this.pal, head: 'hood', scarf: true, sashTail: true,
      weapon: rw.weapon, weapon2: rw.weapon2, grip: rw.grip, backWeapon: ro.back,
      pose, flash: this.flash, rot, sqx: 1, sqy, s: 1.05,
      shieldGlow: this.guard ? 0.2 + 0.8 * Math.min(1, this.guard.store / this.guard.def.maxStore) + (this.guard.flash > 0 ? 0.5 : 0) : 0,
    };
  }

  draw(ctx, t) {
    for (const a of this.afterimages) {
      const o = this.rigOpts(t);
      o.x = isoX(a.x, a.y); o.y = isoY(a.x, a.y); o.z = a.z * 32; o.rot = a.rot; o.pal = SHADOW_PAL; o.pose = a.pose || null; o.facing = a.facing;
      o.alpha = (a.life / a.max) * (a.type === 'shadow' ? 0.32 : 0.16); o.flash = 0; o.scarf = false;
      drawHumanoid(ctx, o);
    }
    const d = this.dash;
    let alpha = 1;
    if (this.dead) alpha = Math.max(0.35, 1 - this.deadT * 0.5);
    if (this.downed) alpha = 0.8;
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
    if (this.guard && this.active) { // Bulwark: how much is stored (arc) and the number
      const G = this.guard, k = Math.min(1, G.store / G.def.maxStore), cx = sx0, cy = sy0 - (this.g.players.length > 1 ? 84 : 60);
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,14,20,0.75)'; ctx.beginPath(); ctx.arc(cx, cy, 11, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffd060'; ctx.beginPath(); ctx.arc(cx, cy, 11, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, k) * TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,200,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 15, -Math.PI / 2, -Math.PI / 2 + (G.t / G.dur) * TAU); ctx.stroke();
      ctx.font = '800 10px "Zen Kaku Gothic New", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff6dc';
      ctx.fillText(String(Math.round(G.store)), cx, cy + 0.5); ctx.textBaseline = 'alphabetic';
    }
    const bo = this.weapons.find((q) => q.key === 'bo');
    if (bo && bo.combo > 0 && this.active) { // bo combo pips over the head (5)
      const a = bo.comboT > 0 ? 1 : 0.6, py = sy0 - (this.g.players.length > 1 ? 80 : 56);
      for (let i = 0; i < 5; i++) {
        const px = sx0 + (i - 2) * 9, on = i < bo.combo;
        ctx.globalAlpha = a * (on ? 1 : 0.45);
        ctx.fillStyle = on ? (i === 4 ? '#ffd060' : '#f4e6c0') : 'rgba(30,24,30,0.8)';
        ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px + 3.5, py); ctx.lineTo(px, py + 4); ctx.lineTo(px - 3.5, py); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(20,14,20,0.8)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (this.downed) { // countdown ring + revive progress
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

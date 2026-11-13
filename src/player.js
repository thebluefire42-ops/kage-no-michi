// The player ninja: movement, dash, weapons, stats and elements. One instance per player (co-op).
import { TAU, clamp, lerp, rand, pick, ease, isoX, isoY, screenDirToWorld, worldDirToScreenAngle, angDiff } from './util.js';
import { PLAYER_BASE, WEAPONS, TALENTS, ELEMENTS, weaponMove } from './config.js';
import { talentCd, talentTarget, activateTalent } from './talents.js';
import { drawHumanoid, drawShadow } from './rig.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { net } from './net.js';

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
const BO_COMBO = ['boJab', 'boSweep', 'boOverhead'];
const BO_FLURRY = ['boJab', 'boJab', 'boSweep', 'boRise', 'boTwirl', 'boOverhead', 'boJab', 'boSweep', 'boTwirl', 'boRise', 'boJab'];
const SHADOW_PAL = {
  skin: '#4a2f6a', cloth: '#3a2560', cloth2: '#2a1a48', sash: '#5a3a8a', hood: '#2a1a48', scarf: '#6a3aa0', metal: '#6a4a9a', wood: '#3a2560', accent: '#5a3a8a',
};
// weapon = in near hand, weapon2 = in far hand, back = how it's carried when not in use
const RIG_WEAPON = {
  katanas: { weapon: 'katana', weapon2: 'katana', grip: 'dual', back: 'saya' },
  crossbow: { weapon: 'crossbow', weapon2: null, grip: 'forward', back: 'crossbow_back' },
  heavy: { weapon: 'nodachi', weapon2: null, grip: 'shoulder', back: 'saya_long' },
  knives: { weapon: 'kunai', weapon2: 'kunai', grip: 'down', back: null },
  staff: { weapon: 'staff', weapon2: null, grip: 'pole', back: 'staff' },
  bo: { weapon: 'bo', weapon2: null, grip: 'pole', back: 'bo' },
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
    this.talents = [];     // { key, level, power, cdMul, cd, cdMax }
    this.rageT = 0;
    this.rushT = 0; this.rushMul = 1; this.nextRush = 0; // Battle Rush item: bonus damage at the start of a level
    this.flurry = null;    // bo special
    this.charge = null;    // crossbow draw { slot, t }
    this.stunT = 0;        // shield bash stun
    // monk sacrifices (keys) and their effects
    this.sac = []; this.maxHpMul = 1; this.elemMul = 1; this.dmgMul = 1;
    this.noCrit = false; this.alwaysCrit = false; this.bound = false; this.lifebinder = false;
  }

  // standing and able to fight (not dead, not downed)
  get active() { return !this.dead && !this.downed; }
  get maxHp() { return Math.round(PLAYER_BASE.maxHp * (this.maxHpMul || 1)); }
  get maxEnergy() { return PLAYER_BASE.maxEnergy; }
  // every attack cooldown of weapon w is multiplied by this (Wind on that weapon, cooldown sacrifices)
  cdMulFor(w) {
    const wind = Math.min(ELEMENTS.wind.cap, (w && w.elements.wind ? w.elements.wind : 0) * (this.elemMul || 1));
    return (this.stats.cooldownMul || 1) * (1 - wind);
  }
  get dashCooldown() { return Math.max(PLAYER_BASE.dash.minCooldown, this.stats.dashCooldown); }

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
    if (m.da) { this.dash.type = m.da[0]; this.dash.t = m.da[1]; this.dash.dur = m.da[2]; this.dash.dx = m.da[3]; this.dash.dy = m.da[4]; } else this.dash.t = 0;
    this.iframes = Math.max(this.iframes, m.ifr || 0);
  }
  updateRemote(dt) {
    if (this.dead) { this.deadT += dt; return; }
    if (this.downed) { this.updateDowned(dt); return; }
    this.tickCommon(dt);
    const st = this.stats;
    if (!this.g.cleared) { // no regeneration once the last enemy of the level is down
      this.hp = Math.min(this.maxHp, this.hp + st.healthRegen * dt);
      this.energy = Math.min(this.maxEnergy, this.energy + st.energyRegen * dt);
    }
    this.iframes = Math.max(0, this.iframes - dt); this.flash = Math.max(0, this.flash - dt); this.hurtT = Math.max(0, this.hurtT - dt);
    this.actionT = Math.max(0, this.actionT - dt);
    for (const w of this.weapons) { w.cd = Math.max(0, w.cd - dt); w.scd = Math.max(0, w.scd - dt); w.comboT = Math.max(0, (w.comboT || 0) - dt); }
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    if (this.tx !== undefined) { const k = 1 - Math.exp(-14 * dt); this.x = lerp(this.x, this.tx, k); this.y = lerp(this.y, this.ty, k); }
    if (this.spin) this.updateSpin(dt);
    if (this.leap) this.updateLeap(dt);
    if (this.anim) { this.anim.t += dt / this.anim.dur; if (this.anim.t >= 1) this.anim = null; }
  }
  // host side: perform an attack the joiner started
  forceAttack(slot, special, ax, ay, ch, cb) {
    const w = this.weapons[slot];
    if (!w) return;
    this.aimX = ax; this.aimY = ay;
    this.actionT = 0; this.spin = null;
    if (special) { w.scd = 0; this.energy = Math.max(this.energy, w.def.special.cost); this.trySpecial(slot); }
    else { w.cd = 0; this.tryBasic(slot, { ch, cb }); }
  }
  // joiner side: the host says we were hit
  remoteHurt(m) {
    const g = this.g;
    this.flash = 0.12; this.hurtT = 0.3; this.iframes = PLAYER_BASE.hitIframes;
    const dx = this.x - m.sx, dy = this.y - m.sy, l = Math.hypot(dx, dy) || 1;
    this.kvx += (dx / l) * m.k; this.kvy += (dy / l) * m.k;
    g.localShake(6); g.hitstop(0.05); g.localFlash('rgba(200,30,30,0.25)');
  }

  heal(n) {
    if (this.dead || n <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    return this.hp - before;
  }

  rollDamage(base) {
    const crit = this.alwaysCrit || (!this.noCrit && Math.random() < this.stats.critChance);
    let dmg = base * this.stats.baseDamage * (this.dmgMul || 1) * (this.rageT > 0 ? TALENTS.rage.mult : 1) * (this.rushT > 0 ? this.rushMul : 1);
    if (crit) dmg *= 1 + this.stats.critDamage;
    return { dmg: Math.max(1, Math.round(dmg)), crit };
  }

  resetForLevel(x, y) {
    this.x = x; this.y = y; this.vx = this.vy = this.kvx = this.kvy = 0; this.z = 0;
    this.aimX = -0.7071; this.aimY = -0.7071;
    this.dash.t = 0; this.leap = null; this.spin = null; this.anim = null; this.timers = []; this.afterimages = [];
    this.actionT = 0;
    this.flurry = null; this.rageT = 0; this.charge = null; this.stunT = 0;
    // Battle Rush bought last level: the bonus runs for the first seconds of this one
    if (this.nextRush > 0) { this.rushMul = 1 + this.nextRush; this.rushT = 30; this.nextRush = 0; } else this.rushT = 0;
    if (this.downed) { this.downed = false; this.hp = Math.max(this.hp, PLAYER_BASE.reviveHp); this.iframes = 1.5; }
    // co-op: a fallen player sits out until their return level (coopReturnAfter levels after they fell)
    if (this.dead && this.g.level >= (this.returnLevel || 0)) { this.dead = false; this.returnLevel = 0; this.hp = Math.max(this.hp, PLAYER_BASE.coopReviveHp); this.iframes = 1.5; }
  }

  updateAim() {
    const g = this.g, c = this.ctl;
    if (c.aimStick.active) {
      const [wx, wy] = screenDirToWorld(c.aimStick.x, c.aimStick.y);
      this.aimX = wx; this.aimY = wy; this.aimMode = 'stick';
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
      this.hp = Math.min(this.maxHp, this.hp + st.healthRegen * dt);
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
    for (const w of this.weapons) { w.cd = Math.max(0, w.cd - dt); w.scd = Math.max(0, w.scd - dt); w.comboT = Math.max(0, (w.comboT || 0) - dt); }

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]; tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }

    const frozen = g.inputLocked;
    const mi = frozen ? 0 : Math.hypot(c.move.x, c.move.y);
    if (mi > 0.01) { const [wx, wy] = screenDirToWorld(c.move.x, c.move.y); this.moveX = wx * mi; this.moveY = wy * mi; }
    else { this.moveX = 0; this.moveY = 0; }
    if (!frozen) this.updateAim();

    if (!frozen && this.stunT <= 0 && c.pressed('dash') && this.dash.t <= 0 && this.dash.cd <= 0 && !this.leap && this.energy >= PLAYER_BASE.dash.cost) this.startDash();

    if (this.dash.t > 0) {
      this.updateDash(dt);
    } else if (this.leap) {
      this.updateLeap(dt);
    } else {
      const spd = PLAYER_BASE.speed * st.moveSpeed * (this.weaponMove || 1) * (this.slowT > 0 ? 0.45 : 1) * (this.spin ? 0.8 : 1) * (this.flurry ? 0.4 : 1) * (this.charge ? 0.7 : 1) * (this.stunT > 0 ? 0 : 1) * (1 - (this.chillT > 0 ? this.chill : 0));
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

    // crossbow basic: hold to draw (range grows), release to shoot
    if (this.charge) {
      const ch = this.charge;
      ch.t += dt;
      if (frozen || this.stunT > 0) this.charge = null;
      else if (!c.down(ch.slot === 0 ? 'L1' : 'R1')) this.releaseCharge();
    }
    // attacks: only one at a time (actionT), specials take priority over basics
    if (!frozen && this.stunT <= 0 && this.dash.t <= 0 && !this.leap && this.actionT <= 0 && !this.spin && !this.flurry && !this.charge) {
      for (let i = 0; i < 2 && this.actionT <= 0; i++) {
        const s = i === 0 ? 'L2' : 'R2';
        if (c.down(s)) this.trySpecial(i);
      }
      for (let i = 0; i < 2 && this.actionT <= 0 && !this.charge; i++) {
        const b = i === 0 ? 'L1' : 'R1';
        if (!c.down(b)) continue;
        const w = this.weapons[i];
        if (w.key === 'crossbow') { if (w.cd <= 0) { this.charge = { slot: i, t: 0 }; this.activeSlot = i; } }
        else this.tryBasic(i);
      }
    }

    if (this.spin) this.updateSpin(dt);
    if (this.anim) { this.anim.t += dt / this.anim.dur; if (this.anim.t >= 1) this.anim = null; }
    for (let i = this.afterimages.length - 1; i >= 0; i--) { const a = this.afterimages[i]; a.life -= dt; if (a.life <= 0) this.afterimages.splice(i, 1); }
  }

  lock(t, w = this.weapons[this.activeSlot]) { const v = t * this.cdMulFor(w); this.actionT = v; this.actionMax = v; }

  chargeFrac() {
    if (!this.charge) return 0;
    const def = this.weapons[this.charge.slot].def.basic;
    return ease.outQuad(clamp(this.charge.t / def.chargeTime, 0, 1));
  }
  releaseCharge() {
    const ch = this.chargeFrac(), slot = this.charge.slot;
    this.charge = null;
    this.tryBasic(slot, { ch });
  }
  // low-opacity strip on the ground showing how far the drawn bolt will fly
  drawChargeIndicator(ctx) {
    if (!this.charge || !this.active) return;
    const def = this.weapons[this.charge.slot].def.basic, k = this.chargeFrac();
    const len = lerp(def.minRange, def.maxRange, k);
    ctx.save();
    ctx.translate(isoX(this.x, this.y), isoY(this.x, this.y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4);
    ctx.rotate(Math.atan2(this.aimY, this.aimX));
    const S = 45.25, W = 0.32 * S;
    ctx.fillStyle = 'rgba(255,235,190,0.1)'; ctx.fillRect(0.4 * S, -W / 2, (def.maxRange - 0.4) * S, W);
    ctx.fillStyle = `rgba(255,235,190,${0.16 + 0.08 * k})`; ctx.fillRect(0.4 * S, -W / 2, (len - 0.4) * S, W);
    ctx.fillStyle = k >= 0.999 ? 'rgba(255,220,120,0.6)' : 'rgba(255,240,210,0.35)';
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
    t.cd = talentCd(t); t.cdMax = t.cd;
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
      this.boStrike(last ? 'boOverhead' : kind, def.dmg, def.range, last ? 6 : 0.8, F.w, every * (last ? 2.2 : 1.05), last ? 0.45 : 0.05, def.arc);
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
  boStrike(kind, base, range, knock, w, dur, stun = 0.1, arcOverride = null) {
    const M = BO_MOVES[kind], g = this.g;
    this.anim = { kind, t: 0, dur };
    this.after(dur * M.at, () => {
      const ax = this.aimX, ay = this.aimY, R = range * M.rng, sa = slashAngle(ax, ay);
      sfx.slash();
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
      if (this.meleeHit(base, R, arcOverride && kind !== 'boJab' ? Math.max(M.arc, arcOverride) : M.arc, knock * M.knock, stun, w)) {
        g.particles.burst('spark', this.x + ax * R * 0.7, this.y + ay * R * 0.7, 0.6, 5, 4, 0.2, 1.4, '#fff2c0');
      }
    });
  }

  // ---------------- dash ----------------
  startDash() {
    const D = PLAYER_BASE.dash;
    let dx = this.moveX, dy = this.moveY;
    if (Math.hypot(dx, dy) < 0.1) { dx = this.aimX; dy = this.aimY; }
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const type = pick(['jump', 'roll', 'shadow']);
    this.energy -= D.cost;
    const d = this.dash;
    d.type = type; d.dur = type === 'jump' ? D.jumpDuration : D.duration; d.t = d.dur;
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
    this.z = d.type === 'jump' ? Math.sin(k * Math.PI) * 0.75 : 0;
    d.trail -= dt;
    if (d.trail <= 0) {
      d.trail = 0.025;
      this.afterimages.push({ x: this.x, y: this.y, z: this.z, life: d.type === 'shadow' ? 0.35 : 0.18, max: d.type === 'shadow' ? 0.35 : 0.18, rot: d.type === 'roll' ? k * TAU : 0, type: d.type, facing: worldDirToScreenAngle(d.dx, d.dy) });
    }
    if (d.t <= 0) {
      this.z = 0;
      if (d.type === 'shadow') {
        g.particles.burst('ink', this.x, this.y, 0.6, 12, 3, 0.5, 4, '#2a1a40');
        g.particles.burst('smoke', this.x, this.y, 0.3, 5, 1.2, 0.5, 6, 'rgba(60,40,90,1)');
      } else if (d.type === 'jump') {
        g.particles.burst('dust', this.x, this.y, 0.05, 10, 2.5, 0.5, 5, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
        g.fx.ring(this.x, this.y, 0.9, 'rgba(255,255,255,0.6)', 0.3, 2);
      }
    }
  }

  // ---------------- attacks ----------------
  facingAngle() { return worldDirToScreenAngle(this.aimX, this.aimY); }
  // on the joiner, attacks are only visual; the host performs the real hit
  proj(o, w) { if (this.netClient) return; o.owner = 'player'; o.from = this; o.weapon = w; this.g.spawnProjectile(o); }

  // opt.ch = crossbow charge (0..1), opt.cb = bo combo step (sent by the joiner)
  tryBasic(i, opt = {}) {
    const w = this.weapons[i];
    if (w.cd > 0) return;
    const def = w.def.basic;
    if (this.netClient) {
      const cb = w.key === 'bo' ? (w.comboT <= 0 ? 0 : (w.combo || 0) % 3) : undefined;
      net.send('atk', { slot: i, special: 0, ax: this.aimX, ay: this.aimY, ch: opt.ch, cb });
    }
    w.cd = def.interval * this.cdMulFor(w); w.cdMax = w.cd;
    this.lock(def.lock, w);
    this.activeSlot = i;
    const g = this.g, ax = this.aimX, ay = this.aimY;
    switch (w.key) {
      case 'katanas': {
        w.side = -w.side;
        this.anim = { kind: 'slash', side: w.side, t: 0, dur: Math.max(0.14, this.actionT * 0.9) };
        sfx.slash();
        this.x += ax * 0.12; this.y += ay * 0.12; g.world.collide(this);
        g.fx.slash(this.x, this.y, slashAngle(ax, ay), def.range * 0.85, 2.3, 'rgba(235,245,255,0.9)', 10, 0.14, 0.55, w.side);
        this.after(0.03, () => this.meleeHit(def.dmg, def.range, def.arc, 1.5, 0.12, w));
        break;
      }
      case 'heavy': {
        this.anim = { kind: 'cleave', t: 0, dur: 0.5 };
        this.slowT = 0.4;
        this.after(0.17, () => {
          sfx.heavy();
          g.fx.slash(this.x, this.y, slashAngle(this.aimX, this.aimY), def.range * 0.9, 2.9, 'rgba(255,240,220,0.95)', 18, 0.22, 0.5, 1);
          g.shake(3);
          this.meleeHit(def.dmg, def.range, def.arc, def.knock, 0.35, w);
        });
        break;
      }
      case 'crossbow': {
        this.anim = { kind: 'shoot', t: 0, dur: 0.3 };
        sfx.shoot();
        // charged shots fly further: a tap reaches minRange, a full draw maxRange
        const range = lerp(def.minRange, def.maxRange, clamp(opt.ch || 0, 0, 1));
        this.proj({ kind: 'bolt', x: this.x + ax * 0.4, y: this.y + ay * 0.4, z: 0.55, vx: ax * def.speed, vy: ay * def.speed, base: def.dmg, pierce: def.pierce, r: 0.2, life: range / def.speed, knock: 2.5 }, w);
        this.kvx -= ax * 1.5; this.kvy -= ay * 1.5;
        break;
      }
      case 'knives': {
        w.side = -w.side;
        this.anim = { kind: 'throw', side: w.side, t: 0, dur: 0.22 };
        sfx.throwKnife();
        const a = Math.atan2(ay, ax) + rand(-0.05, 0.05);
        this.proj({ kind: 'kunai', x: this.x + Math.cos(a) * 0.3, y: this.y + Math.sin(a) * 0.3, z: 0.6, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, base: def.dmg, pierce: def.pierce, r: 0.18, life: 0.9, knock: 1 }, w);
        break;
      }
      case 'bo': { // 3-hit combo: jab -> low sweep -> overhead chop
        if (w.comboT <= 0) w.combo = 0;
        const step = opt.cb ?? (w.combo || 0) % 3;
        w.combo = step + 1; w.comboT = w.cd + 0.7;
        if (this.netClient) this.lastCombo = step;
        this.boStrike(BO_COMBO[step], def.dmg, def.range, def.knock, w, Math.max(0.18, this.actionT * 1.1));
        break;
      }
      case 'staff': { // spirit bolt that bursts into a small area at the first enemy or at max range
        this.anim = { kind: 'shoot', t: 0, dur: 0.3 };
        sfx.enemyShoot();
        this.proj({ kind: 'spirit', x: this.x + ax * 0.5, y: this.y + ay * 0.5, z: 0.7, vx: ax * def.speed, vy: ay * def.speed, base: def.dmg, burst: def.radius, r: 0.25, life: def.range / def.speed, glow: true }, w);
        break;
      }
    }
  }

  // staff special: heal yourself and every ally within the circle
  healCircle(def) {
    const g = this.g;
    this.anim = { kind: 'cast', t: 0, dur: 0.5 };
    if (this.netClient) return;
    sfx.chime(1);
    g.fx.ring(this.x, this.y, def.radius, 'rgba(140,255,170,0.9)', 0.6, 6);
    g.fx.ring(this.x, this.y, def.radius * 0.5, 'rgba(220,255,200,0.8)', 0.45, 4);
    g.particles.burst('glow', this.x, this.y, 0.6, 26, 3, 1, 2.6, '#9dffb0');
    for (const p of g.players) {
      if (p.dead || Math.hypot(p.x - this.x, p.y - this.y) > def.radius) continue;
      const got = p.heal(Math.round(def.heal * this.stats.baseDamage * (this.dmgMul || 1)));
      g.fx.text(p.x, p.y, `+${Math.round(got)}`, '#7dff9a', 17);
      g.particles.burst('glow', p.x, p.y, 1, 10, 1.5, 0.8, 2, '#c8ffd0');
    }
  }

  trySpecial(i) {
    const w = this.weapons[i];
    const def = w.def.special;
    if (w.scd > 0 || this.energy < def.cost || this.spin) return;
    w.scd = def.cd * this.cdMulFor(w); w.scdMax = w.scd;
    if (this.netClient) net.send('atk', { slot: i, special: 1, ax: this.aimX, ay: this.aimY });
    this.lock(def.lock, w);
    this.energy -= def.cost;
    this.activeSlot = i;
    const g = this.g, ax = this.aimX, ay = this.aimY;
    switch (w.key) {
      case 'katanas': {
        this.spin = { t: 0, dur: def.dur, tick: 0, ticks: 0, def, w };
        this.anim = { kind: 'spin', t: 0, dur: def.dur };
        sfx.slash();
        break;
      }
      case 'crossbow': {
        this.anim = { kind: 'shoot', t: 0, dur: 0.35 };
        sfx.shoot(); sfx.heavy();
        const base = Math.atan2(ay, ax);
        for (let k = 0; k < def.count; k++) {
          const a = base + ((k - (def.count - 1) / 2) * def.spread * Math.PI) / 180;
          this.proj({ kind: 'bolt', x: this.x + Math.cos(a) * 0.4, y: this.y + Math.sin(a) * 0.4, z: 0.55, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, base: def.dmg, pierce: def.pierce, r: 0.22, life: 1.2, knock: 3, glow: true }, w);
        }
        this.kvx -= ax * 4; this.kvy -= ay * 4;
        g.shake(2);
        break;
      }
      case 'heavy': {
        const D = def.leap;
        this.leap = { t: 0, dur: 0.34, sx: this.x, sy: this.y, dx: ax * D, dy: ay * D, def, w };
        this.anim = { kind: 'slam', t: 0, dur: 0.46 };
        this.iframes = Math.max(this.iframes, 0.4);
        sfx.dash();
        break;
      }
      case 'knives': {
        this.anim = { kind: 'throw', side: 1, t: 0.25, dur: 0.25 };
        sfx.throwKnife(); g.later(0.04, () => sfx.throwKnife());
        const base = Math.atan2(ay, ax);
        for (let k = 0; k < def.count; k++) {
          const a = base + ((k / (def.count - 1) - 0.5) * def.spread * Math.PI) / 180;
          this.proj({ kind: 'kunai', x: this.x + Math.cos(a) * 0.3, y: this.y + Math.sin(a) * 0.3, z: 0.6, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, base: def.dmg, pierce: def.pierce, r: 0.18, life: 0.85, knock: 1.2 }, w);
        }
        break;
      }
      case 'staff': this.healCircle(def); break;
      case 'bo':
        this.flurry = { t: 0, done: 0, side: 1, def, w };
        g.timeWarp(def.dur + 0.15, def.timeScale);
        sfx.dash();
        break;
    }
  }

  updateSpin(dt) {
    const s = this.spin, g = this.g;
    s.t += dt; s.tick -= dt;
    if (s.tick <= 0 && s.ticks < s.def.ticks) {
      s.tick = s.def.dur / s.def.ticks; s.ticks++;
      sfx.slash();
      g.fx.slash(this.x, this.y, s.ticks * 2.1, s.def.radius * 0.8, 3.6, 'rgba(220,235,255,0.85)', 12, 0.16, 0.5, 1);
      this.meleeHit(s.def.dmg, s.def.radius, 360, 2, 0.08, s.w);
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
    }
  }

  meleeHit(base, range, arcDeg, knock, stun, w) {
    if (this.netClient) return false;
    const g = this.g, half = ((arcDeg / 2) * Math.PI) / 180;
    const aim = Math.atan2(this.aimY, this.aimX);
    let any = false;
    for (const e of g.enemies) {
      if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
      const dx = e.x - this.x, dy = e.y - this.y, d = Math.hypot(dx, dy);
      if (d > range + e.r) continue;
      if (arcDeg < 360 && d > 0.3 && Math.abs(angDiff(aim, Math.atan2(dy, dx))) > half) continue;
      const { dmg, crit } = this.rollDamage(base);
      g.damageEnemy(e, dmg, crit, dx / (d || 1), dy / (d || 1), knock, stun, { player: this, weapon: w, melee: true });
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
    if (this.iframes > 0 || !this.active || g.god || g.inputLocked) return false;
    // Bound Souls pact: half of the damage goes to the partner
    if (this.bound) {
      const o = g.players.find((q) => q !== this && q.bound && q.active);
      if (o) { dmg /= 2; o.sharedHurt(dmg); }
    }
    this.hp -= dmg;
    this.iframes = PLAYER_BASE.hitIframes; this.flash = 0.12; this.hurtT = 0.3;
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
      this.hp = 0; this.spin = null; this.leap = null; this.flurry = null; this.charge = null; this.dash.t = 0; this.z = 0;
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
    const w = this.weapons[this.activeSlot], other = this.weapons[1 - this.activeSlot];
    const rw = RIG_WEAPON[w.key], ro = RIG_WEAPON[other.key];
    let facing = this.facingAngle();
    let pose = this.anim ? { kind: this.anim.kind, t: this.anim.t, side: this.anim.side } : this.charge ? { kind: 'shoot', t: 1 - this.chargeFrac() * 0.6 } : null;
    if (this.spin) facing = t * 40;
    if (this.hurtT > 0 && !pose) pose = { kind: 'hurt', t: 1 - this.hurtT / 0.3 };
    let rot = 0, sqy = 1;
    const d = this.dash;
    if (d.t > 0) {
      const k = 1 - d.t / d.dur;
      facing = worldDirToScreenAngle(d.dx, d.dy);
      if (d.type === 'roll') { rot = k * TAU; sqy = 0.85; }
      if (d.type === 'jump') pose = { kind: 'jump', t: k };
    }
    if (this.leap) pose = { kind: 'slam', t: this.anim ? this.anim.t : 0.5 };
    if (this.dead || this.downed) { rot = -Math.min(1, (this.dead ? this.deadT : 1) / 0.3) * 1.4; pose = { kind: 'hurt', t: 0 }; }
    return {
      x: isoX(this.x, this.y), y: isoY(this.x, this.y), z: this.z * 32, facing, time: t,
      walk: this.walk, move: this.dead ? 0 : this.moveAmt, pal: this.pal, head: 'hood', scarf: true, sashTail: true,
      weapon: rw.weapon, weapon2: rw.weapon2, grip: rw.grip, backWeapon: ro.back,
      pose, flash: this.flash, rot, sqx: 1, sqy, s: 1.05,
    };
  }

  draw(ctx, t) {
    for (const a of this.afterimages) {
      const o = this.rigOpts(t);
      o.x = isoX(a.x, a.y); o.y = isoY(a.x, a.y); o.z = a.z * 32; o.rot = a.rot; o.pal = SHADOW_PAL; o.pose = a.pose || null; o.facing = a.facing;
      o.alpha = (a.life / a.max) * (a.type === 'shadow' ? 0.55 : 0.3); o.flash = 0; o.scarf = false;
      drawHumanoid(ctx, o);
    }
    const d = this.dash;
    let alpha = 1;
    if (this.dead) alpha = Math.max(0.35, 1 - this.deadT * 0.5);
    if (this.downed) alpha = 0.8;
    if (d.t > 0 && d.type === 'shadow') { const k = 1 - d.t / d.dur; alpha = k < 0.15 || k > 0.85 ? 1 : 0.15; }
    if (!this.dead && this.iframes > 0 && d.t <= 0 && !this.leap && this.hurtT <= 0 && this.flash <= 0) alpha *= 0.65 + 0.35 * Math.sin(t * 40);
    const o = this.rigOpts(t);
    o.alpha = alpha;
    drawHumanoid(ctx, o);
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

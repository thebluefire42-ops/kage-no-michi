// Enemies, bosses, enemy/player projectiles and area hazards.
import { TAU, clamp, lerp, rand, pick, ease, isoX, isoY, worldDirToScreenAngle, angDiff, dist } from './util.js';
import { KIND_HP, AREA3_HP, BANNER, CORRUPTION, AREA1_HEAVY_DMG, SOLO_ENEMY_HP, ENEMIES, BOSSES, levelScale, levelDamageScale, COOP_ENEMY_HP, COOP_ENEMY_DMG, SHIELD, ENEMY_SPEED_MUL, HEAVY_HP_MUL, HEAVY_SPEED, DIFFICULTY, AREA_WINDUP, MAGIC, AREA1_HP, PROJ_HIT_PAD } from './config.js';
import { drawHumanoid, drawShadow, drawProjectile, drawShieldItem, INK } from './rig.js';
import { sfx } from './audio.js';
import { BEHAVIORS, LOOKS } from './behaviors.js';
import { EXTRA } from './extras.js';
import { steerWisp, wispHit } from './spirits.js';
import { drawBossSignature } from './bosslooks.js';

// enemy magic (orbs, souls) turns toward you for this many seconds after it is cast, then flies straight
const HOMING_FOR = 0.55;
// ---------------------------------------------------------------- Enemy
let NEXT_ID = 1;
export class Enemy {
  constructor(g, type, x, y, level) {
    this.g = g; this.type = type; this.id = NEXT_ID++;
    const boss = Object.values(BOSSES).find((b) => b.type === type);
    this.boss = !!boss;
    const cfg = boss ? { ...boss, dmg: 1, speed: 2.8, range: 2.5, windup: 0.5, recover: 0.5, cooldown: 1 } : ENEMIES[type];
    this.cfg = cfg; this.name = cfg.name;
    const sc = boss ? 1 : levelScale(level);
    this.hpMax = Math.round(cfg.hp * (boss ? 1 : sc) * (!boss && cfg.heavy ? HEAVY_HP_MUL : 1) * (!boss && !cfg.heavy && level <= 10 ? AREA1_HP : 1)); this.hp = this.hpMax;
    this.dmgMul = boss ? 1 : levelDamageScale(level);
    if (!boss) { this.hpMax = Math.round(this.hpMax * SOLO_ENEMY_HP * (level > 20 && level <= 30 ? AREA3_HP : 1) * ((g.world && KIND_HP[g.world.kind]) || 1)); this.hp = this.hpMax; } // (training halls and libraries: KIND_HP) // +10% (the solo numbers); area 3 softer
    if (!boss && g.players && g.players.length > 1) { // co-op (always this rule): x1.35 health, x1.1 damage on top of solo
      this.hpMax = Math.round(this.hpMax * COOP_ENEMY_HP); this.hp = this.hpMax;
      this.dmgMul *= COOP_ENEMY_DMG;
    }
    if (!boss && g.levelInfo) this.dmgMul *= (DIFFICULTY[g.levelInfo.d] || DIFFICULTY[1]).dmg; // the route node's difficulty
    if (!boss && cfg.heavy && level <= 10) this.dmgMul *= AREA1_HEAVY_DMG; // area 1 heavies hit harder
    if (!boss && g.levelInfo && g.levelInfo.corrupt === 'bloodmoon') this.dmgMul *= CORRUPTION.bloodmoon.dmgMul; // Blood Moon
    if (g.diffMod && g.diffMod.hp !== 1) { this.hpMax = Math.round(this.hpMax * g.diffMod.hp); this.hp = this.hpMax; } // the run's difficulty (bosses too)
    this.windupMul = boss ? 1 : AREA_WINDUP[level > 30 ? 3 : Math.floor((level - 1) / 10)] || 1; // slower, easier to read charges early on
    this.speed = cfg.speed * (boss ? 1 : ENEMY_SPEED_MUL * (1 + Math.min(0.25, level * 0.008)));
    if (!boss && cfg.heavy) { this.speed *= HEAVY_SPEED; this.windupMul /= HEAVY_SPEED; }
    this.magic = !boss && cfg.behavior === 'caster';
    if (this.magic) { this.speed *= MAGIC.speed; this.windupMul *= MAGIC.windup; }
    this.r = cfg.r;
    this.x = x; this.y = y; this.z = 0;
    this.vx = 0; this.vy = 0; this.kvx = 0; this.kvy = 0;
    this.state = 'spawn'; this.t = boss ? 1.4 : 0.8; this.spawnDur = this.t;
    this.emerge = null;          // {x0,y0,x1,y1}: walks out of a house door while spawning
    this.slow = 0; this.slowT = 0; // ice
    this.poison = null;          // {dps, t, tick, src}
    this._target = null;
    this.atkCd = rand(0.4, 1.2);
    this.flash = 0; this.stun = 0;
    this.dead = false; this.deathT = 0;
    this.walk = rand(0, 10); this.moveAmt = 0; this.seed = rand(0, 100);
    this.faceX = 1; this.faceY = 0;
    this.tele = null; this.pose = null;
    this.hidden = false; this.alpha = 1;
    this.phase = 1;
    this.data = {};
    this.knockResist = boss ? 0.1 : cfg.heavy ? 0.3 : cfg.behavior === 'shieldTank' ? 0.5 : 1;
    // front shield: blocks most frontal damage until broken (see Game.damageEnemy)
    this.shield = cfg.shield ? { kind: cfg.shield, up: true, melee: 0, log: [] } : null;
    this.hitT = 0;
    this.beh = BEHAVIORS[cfg.behavior || type];
    this.beh.init?.(this, g);
  }

  get dmg() { return this.cfg.dmg * this.dmgMul * (this.bannerT > 0 ? BANNER.dmgMul : 1); } // (Banner Bearer's circle)
  // how close the shield is to breaking (0..1): blocked melee hits, or recent blocked damage
  shieldProgress() {
    const S = this.shield;
    if (!S || !S.up) return 0;
    if (S.netProg !== undefined && this.g.role === 'client') return S.netProg;
    const now = this.g.time;
    const burst = S.log.reduce((a, l) => a + (now - l.t < SHIELD.burstWindow ? l.d : 0), 0);
    return clamp(Math.max(S.melee / SHIELD.meleeHits, burst / (this.hpMax * SHIELD.burstFrac)), 0, 1);
  }
  // nearest living player (co-op aware)
  get target() {
    const hid = (p) => p.inSmoke && p.inSmoke();
    if (this._target && this._target.active && !hid(this._target)) return this._target;
    let best = null, bd = 1e9;
    for (const p of this.g.players) { if (!p.active || hid(p)) continue; const d = (p.x - this.x) ** 2 + (p.y - this.y) ** 2; if (d < bd) { bd = d; best = p; } }
    // the spirit orb's spirits draw enemies too (a little less than a player standing as close; never a boss's)
    if (!this.boss && this.g.spirits) for (const s of this.g.spirits) { if (!s.active) continue; const d = ((s.x - this.x) ** 2 + (s.y - this.y) ** 2) * 1.6; if (d < bd) { bd = d; best = s; } }
    if (!best) { // every player hidden in smoke: it lost you, and prowls around a spot in the cloud
      const S = this.g.hazards.find((h) => h.kind === 'smoke' && h.t > 0);
      if (S) {
        if (!this.decoy || this.decoy.s !== S || Math.random() < 0.01) {
          const a = Math.random() * TAU, r = Math.random() * S.r * 0.8;
          this.decoy = { x: S.x + Math.cos(a) * r, y: S.y + Math.sin(a) * r, z: 0, vx: 0, vy: 0, r: 0.3, index: S.from ? S.from.index : 0, active: true, decoy: true, s: S, hurt: () => false };
        }
        return this.decoy;
      }
    }
    this._target = best || this.g.players[0];
    return this._target;
  }
  toPlayer() { const p = this.target; const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 0.001; return [dx / d, dy / d, d]; }
  face(dx, dy) { const l = Math.hypot(dx, dy) || 1; this.faceX = dx / l; this.faceY = dy / l; }
  walkAround(ux, uy, w) {
    const base = Math.atan2(uy, ux), feel = 0.7 + this.r, side0 = this.aroundSide || (Math.random() < 0.5 ? 1 : -1);
    const open = (sg) => { let n = 0; for (const k of [1, 1.6, 2.2]) { const a = base + 1.35 * sg; if (!w.blocked(this.x + Math.cos(a) * feel * k, this.y + Math.sin(a) * feel * k, this.r * 0.8)) n++; } return n; };
    // the side with more room; tried again after a failure, the other side
    let sg = (this.stuckN || 0) > 2 ? -side0 : side0;
    if (open(-sg) > open(sg)) sg = -sg;
    this.aroundSide = sg;
    const big = this.r > 0.36;
    return { t: (big ? 1.3 : 0.9) + 0.2 * Math.min(4, this.stuckN || 0), a: base + 1.35 * sg, back: base, sg };
  }
  steer(dx, dy, mul = 1, dt) {
    const l = Math.hypot(dx, dy) || 1, s = this.speed * mul * (this.bannerT > 0 ? BANNER.speedMul : 1);
    let ux = dx / l, uy = dy / l;
    const w = this.g.world, nav = this.g.nav, tgt = this.target;
    // pathing: when heading for the player but a building is in the way, follow the flow field around it
    if (!this.flying && mul > 0 && nav && tgt) {
      const px = tgt.x - this.x, py = tgt.y - this.y, pd = Math.hypot(px, py) || 1;
      this.flowT = Math.max(0, (this.flowT || 0) - dt);
      if ((ux * px + uy * py) / pd > 0.5) {
        this.losT = (this.losT || 0) - dt;
        if (this.losT <= 0) { this.losT = 0.25; this.los = nav.clearLine(this.x, this.y, tgt.x, tgt.y, this.r * 0.9); }
        // no clear line, or recently stuck on a corner: follow the flow field around the obstacle
        if (!this.los || this.flowT > 0) { const f = nav.flowDir(this, tgt); if (f) { ux = f[0]; uy = f[1]; } }
      }
    }
    // no progress: chasing for 2 s without getting any closer (jittering against a wall or corner) counts as stuck too
    let noProgress = false;
    if (!this.flying && mul > 0 && tgt && !this.detour) {
      const td = Math.hypot(tgt.x - this.x, tgt.y - this.y), chasing = (dx * (tgt.x - this.x) + dy * (tgt.y - this.y)) / (l * (td || 1)) > 0.5;
      if (chasing && td > 2.5) {
        this.progT = (this.progT || 0) + dt;
        if (this.progD === undefined) this.progD = td;
        if (this.progT >= 2) { noProgress = td > this.progD - 0.5; this.progT = 0; this.progD = td; }
      } else { this.progT = 0; this.progD = undefined; }
    }
    // stuck detection: if we barely moved for a while, take a short detour
    this.stuckT = (this.stuckT || 0) + dt;
    if (noProgress) this.stuckT = Math.max(this.stuckT, 0.81);
    if (this.stuckT > 0.8) {
      const moved = Math.hypot(this.x - (this.lastX ?? this.x), this.y - (this.lastY ?? this.y));
      // stuck: it covered less than a third of the ground it should have (slow heavies included), or almost none
      if (mul > 0 && (noProgress || moved < Math.max(0.25, s * 0.8 * 0.33))) {
        this.stuckN = (this.stuckN || 0) + 1;
        // first: trust the (size-aware) flow field for a while; big bodies snag on corners even with a clear line
        if (!this.flying && nav && tgt && this.stuckN === 1) this.flowT = 1.8;
        else this.detour = this.walkAround(ux, uy, w);
        // still wedged after several tries: step out to the nearest open tile
        if (this.stuckN >= 6 && !this.flying && nav) { const c = nav.openCellNear(this); if (c) { this.x = c[0]; this.y = c[1]; this.vx = this.vy = 0; } this.stuckN = 0; }
      } else this.stuckN = 0;
      this.stuckT = 0; this.lastX = this.x; this.lastY = this.y;
    }
    if (this.detour) {
      const D = this.detour; D.t -= dt;
      const a = D.back !== undefined && D.t < 0.4 ? D.back + 1.35 * D.sg * (D.t / 0.4) : D.a; // the last moment: turn back toward the goal
      ux = Math.cos(a); uy = Math.sin(a);
      if (D.t <= 0) this.detour = null;
    }
    // obstacle avoidance: if the way ahead is blocked, slide around it (keeping a preferred side)
    const feel = 0.6 + this.r;
    if (!this.flying && mul > 0 && w.blocked(this.x + ux * feel, this.y + uy * feel, this.r * 0.8)) {
      if (!this.avoidSide || Math.random() < dt * 0.3) this.avoidSide = Math.random() < 0.5 ? 1 : -1;
      const base = Math.atan2(uy, ux);
      for (const a of [0.5, 1, 1.5, 2.1, 2.6]) {
        let found = false;
        for (const sgn of [this.avoidSide, -this.avoidSide]) {
          const ang = base + a * sgn, tx = Math.cos(ang), ty = Math.sin(ang);
          if (!w.blocked(this.x + tx * feel, this.y + ty * feel, this.r * 0.8)) { ux = tx; uy = ty; this.avoidSide = sgn; found = true; break; }
        }
        if (found) break;
      }
    }
    const k = 1 - Math.exp(-10 * dt);
    this.vx = lerp(this.vx, ux * s, k); this.vy = lerp(this.vy, uy * s, k);
  }
  halt(dt, rate = 12) { const k = Math.exp(-rate * dt); this.vx *= k; this.vy *= k; }
  windup(dur, tele, poseKind = 'windup', next = 'strike') {
    dur *= this.windupMul || 1;
    this.state = 'windup'; this.t = dur; this.tDur = dur; this.tele = tele; this.pose = { kind: poseKind, t: 0 }; this.next = next;
  }
  // a dashing attack: hurts a player only inside the red lane it telegraphed, and only once the attacker has
  // actually reached them (within reach of its body); without a lane it falls back to a circle around it
  hurtInLane(reach, dmg, knock = 5) {
    const L = this.lane;
    if (!L) return this.hurtPlayerIfIn(reach, TAU, dmg, knock);
    let any = false;
    for (const p of this.g.targets) {
      if (!p.active) continue;
      const dx = p.x - L.ox, dy = p.y - L.oy, along = dx * L.fx + dy * L.fy, side = Math.abs(dx * L.fy - dy * L.fx);
      if (along < 0 || along > L.len || side > L.width / 2) continue; // outside the red lane (by the player's centre)
      if (Math.hypot(p.x - this.x, p.y - this.y) > reach + p.r) continue; // not reached yet
      if (p.hurt(dmg, this.x, this.y, knock)) { any = true; if (this.cfg.onHit) p.applyChill(this.cfg.onHit.chill, this.cfg.onHit.dur); }
    }
    return any;
  }
  // a melee hit in an arc: when the attack telegraphed an arc or cone a moment ago, exactly that shape (its reach, width
  // and direction) is used, so the hit lands 1-on-1 where the red area was; the player's centre has to be inside it
  hurtPlayerIfIn(range, arcRad, dmg, knock = 5) {
    let any = false;
    const LT = this.lastTele, fresh = LT && (LT.kind === 'arc' || LT.kind === 'cone') && this.g.time - (this.lastTeleT ?? -9) < 1.2;
    const R = fresh ? LT.range : range, A = fresh ? LT.arc : arcRad, dir = fresh ? LT.angle : Math.atan2(this.faceY, this.faceX);
    for (const p of this.g.targets) {
      if (!p.active) continue;
      const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy);
      if (d > R) continue;
      if (A < TAU && d > 0.2 && Math.abs(angDiff(dir, Math.atan2(dy, dx))) > A / 2) continue;
      if (p.hurt(dmg, this.x, this.y, knock)) { any = true; if (this.cfg.onHit) p.applyChill(this.cfg.onHit.chill, this.cfg.onHit.dur); }
    }
    return any;
  }

  update(dt) {
    const g = this.g;
    if (this.dead) { this.deathT += dt; return; }
    if (this.state === 'intro') return; // the game drives the boss entrance
    if (Math.random() < dt * 2) this._target = null; // re-pick nearest player now and then
    // poison ticks in real time
    if (this.poison) {
      const P = this.poison;
      P.t -= dt; P.tick -= dt;
      if (!P.net && P.tick <= 0) { // every half second: the poison's share (fractions carry over)
        P.tick += 0.5; P.acc += Math.min(P.pool - P.acc, P.rate * 0.5);
        const n = Math.floor(P.acc);
        if (n >= 1) { P.acc -= n; P.pool -= n; g.damageEnemy(this, n, false, 0, 0, 0, 0, { dot: true, player: P.player }); }
      }
      if (Math.random() < dt * 6) g.particles.emit('glow', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.4, 1.2), 0, 0, 0.6, 0.6, 2, '#8fe05a');
      if ((!P.net && P.pool < 1) || this.dead) this.poison = null;
      if (this.dead) return;
    }
    // ice slows everything this enemy does
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slow = 0;
      dt *= 1 - this.slow;
      if (Math.random() < dt * 5) g.particles.emit('dot', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.3, 1.2), 0, 0, -0.3, 0.6, 1.6, '#cff4ff');
    }
    this.flash = Math.max(0, this.flash - dt); this.shudder = Math.max(0, (this.shudder || 0) - dt);
    this.markT = Math.max(0, (this.markT || 0) - dt); this.rootT = Math.max(0, (this.rootT || 0) - dt);
    this.rockT = Math.max(0, (this.rockT || 0) - dt); // (locked in the gloves' rock)
    this.vulnT = Math.max(0, (this.vulnT || 0) - dt); this.shockT = Math.max(0, (this.shockT || 0) - dt);
    if (this.daggers) { for (const k of this.daggers) k.t -= dt; this.daggers = this.daggers.filter((k) => k.t > 0 && !k.p.dead); }
    this.hitT = Math.max(0, this.hitT - dt);
    this.poiseT = Math.max(0, (this.poiseT || 0) - dt);
    this.atkCd -= dt * (this.bannerT > 0 ? BANNER.atkMul : 1);
    this.bannerT = Math.max(0, (this.bannerT || 0) - dt); // (kept up by a Banner Bearer while inside its circle)
    if (this.data.xCd > 0) this.data.xCd -= dt; // extra moves (extras.js)
    const X = this.boss ? null : EXTRA[this.type];
    if (this.pose && this.state !== 'windup') { this.pose.t += dt / (this.pose.dur || 0.3); if (this.pose.t >= 1) this.pose = null; }
    const beh = this.beh;
    if (this.state === 'spawn') {
      this.t -= dt;
      const k = clamp(1 - this.t / this.spawnDur, 0, 1);
      if (this.emerge) {
        const E = this.emerge;
        this.x = lerp(E.x0, E.x1, ease.outQuad(k)); this.y = lerp(E.y0, E.y1, ease.outQuad(k));
        this.face(E.x1 - E.x0, E.y1 - E.y0);
        this.moveAmt = 0.8; this.walk += dt * 9;
        this.alpha = clamp(k / 0.35, 0, 1);
      } else this.alpha = k;
      if (this.t <= 0) { this.state = 'chase'; this.alpha = 1; this.emerge = null; beh.onSpawn?.(this, g); }
      return;
    } else if (this.stun > 0 && !this.boss) {
      this.stun -= dt; this.halt(dt, 8);
      if (this.state === 'windup' || this.state === 'lunge' || this.state === 'charge') { this.state = 'chase'; this.tele = null; this.pose = null; }
    } else if (this.state === 'windup') {
      this.t -= dt; this.halt(dt);
      if (this.pose) this.pose.t = 1 - this.t / this.tDur;
      // ranged shooters stop tracking `lockBefore` seconds before firing, so the shot can be read and dodged
      const locked = (this.tele && this.tele.lockFrac != null) ? this.t <= this.tDur * (1 - this.tele.lockFrac) : beh.lockBefore && this.t <= beh.lockBefore;
      if (locked && this.tele) this.tele.locked = true;
      if (beh.trackDuringWindup && !locked) { const [dx, dy] = this.toPlayer(); this.face(dx, dy); if (this.tele && this.tele.track) this.tele.angle = Math.atan2(dy, dx); }
      if (this.t <= 0) {
        this.lastTele = this.tele; this.lastTeleT = g.time; this.tele = null; // (the shape the coming hit uses, see hurtPlayerIfIn)
        // a line telegraph becomes the lane the coming dash may hurt in (see hurtInLane)
        const LT = this.lastTele; this.lane = LT && LT.kind === 'line' ? { ox: this.x, oy: this.y, fx: Math.cos(LT.angle), fy: Math.sin(LT.angle), len: LT.len, width: LT.width } : null;
        this.state = 'recover'; this.t = this.cfg.recover;
        this.pose = { kind: 'strike', t: 0.38, dur: 0.35 };
        if (X && this.next && this.next.startsWith('x:')) X.strike(this, g, this.next.slice(2));
        else { beh.strike(this, g, this.next); if (X && X.after) X.after(this, g, this.next); }
      }
    } else if (this.state === 'recover') {
      this.t -= dt; this.halt(dt, 6);
      if (this.t <= 0) { this.state = 'chase'; this.atkCd = this.cfg.cooldown * rand(0.8, 1.2) * (this.magic ? MAGIC.cooldown : 1); }
    } else if (this.state === 'chase') {
      let started = false;
      if (X && X.think) { const [dx, dy, d] = this.toPlayer(); started = X.think(this, dt, g, dx, dy, d); if (started) this.face(dx, dy); }
      if (!started) beh.think(this, dt, g);
    } else if (!(X && X.custom && X.custom(this, dt, g))) {
      beh.custom?.(this, dt, g);
    }
    // heavies rush through a charge faster (same distance, so it still matches its telegraphed lane)
    if (this.state === 'charge' && !this.chargeSped && this.cfg.heavy && !this.boss) { this.chargeSped = true; this.vx *= HEAVY_SPEED; this.vy *= HEAVY_SPEED; this.t /= HEAVY_SPEED; }
    else if (this.state !== 'charge') this.chargeSped = false;
    // integrate
    const held = this.rockT > 0 ? 0 : 1; // (nothing moves it while it is locked in rock)
    this.x += (this.vx * held + this.kvx * this.knockResist * held) * dt;
    this.y += (this.vy * held + this.kvy * this.knockResist * held) * dt;
    const kd = Math.exp(-7 * dt); this.kvx *= kd; this.kvy *= kd;
    if (!this.flying) g.world.collide(this);
    else { const N = g.world.N; this.x = clamp(this.x, 0.8, N - 0.8); this.y = clamp(this.y, 0.8, N - 0.8); }
    const sp = Math.hypot(this.vx, this.vy);
    this.moveAmt = lerp(this.moveAmt, clamp(sp / Math.max(1.5, this.speed), 0, 1), 1 - Math.exp(-10 * dt));
    this.walk += sp * dt * 2.6;
  }

  // ---------------- drawing ----------------
  drawShadow(ctx) {
    if (this.hidden) return;
    const a = this.dead ? Math.max(0, 1 - this.deathT / 0.8) : this.alpha;
    drawShadow(ctx, isoX(this.x, this.y), isoY(this.x, this.y), this.r * 36 * (1 - Math.min(0.6, this.z * 0.15)), 0.28 * a);
  }

  // under everything: a Banner Bearer's wide circle (light orange, not the red of attacks), and a warm ring under
  // the feet of every enemy standing in it (worked out from positions, so the online joiner sees it too)
  drawAura(ctx, t) {
    if (this.cfg.behavior !== 'banner' || this.dead || this.hidden || this.portrait) return;
    const R = BANNER.radius * 45.25, cx = isoX(this.x, this.y), cy = isoY(this.x, this.y), a = this.state === 'spawn' ? 0.4 : 1;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.translate(cx, cy); ctx.scale(1, 0.5);
    const gr = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    gr.addColorStop(0, 'rgba(255,176,96,0.05)'); gr.addColorStop(0.85, 'rgba(255,160,80,0.13)'); gr.addColorStop(1, 'rgba(255,150,70,0.2)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,110,0.75)'; ctx.lineWidth = 3; ctx.setLineDash([18, 10]); ctx.lineDashOffset = -t * 14;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    for (const o of this.g.enemies) {
      if (o === this || o.dead || o.hidden || o.cfg.behavior === 'banner') continue;
      if (Math.hypot(o.x - this.x, o.y - this.y) > BANNER.radius) continue;
      const ox = isoX(o.x, o.y), oy = isoY(o.x, o.y), rr = 16 * Math.max(1, o.r * 2.6);
      ctx.save(); ctx.globalAlpha *= 0.55 + 0.2 * Math.sin(t * 6 + o.seed);
      ctx.strokeStyle = '#ffb060'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(ox, oy, rr, rr * 0.5, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  drawTelegraph(ctx, t) {
    const T = this.tele;
    if (!T) return;
    const k = this.state === 'windup' ? 1 - this.t / this.tDur : (T.k ?? 0.5);
    drawTele(ctx, T, this.x, this.y, k, t);
  }

  draw(ctx, t) {
    if (this.hidden) return;
    const iv = this.state === 'intro' ? this.introVis : null;
    if (iv && iv.hidden) return;
    const sx = isoX(this.x, this.y) + (this.shudder > 0 && !this.dead ? Math.sin(t * 95 + (this.seed || 0)) * Math.min(1, this.shudder * 4) * 3 : 0), sy = isoY(this.x, this.y);
    let alpha = this.alpha, rot = 0, sqy = 1, sqx = 1;
    if (iv) { alpha = iv.alpha ?? 1; sqy = iv.sqy ?? 1; sqx = iv.sqx ?? 1; }
    if (this.dead && this.kneel) {
      // the defeated regent kneels until his last words
    } else if (this.dead) {
      const k = this.deathT;
      rot = -Math.min(1, k / 0.25) * 1.35 * (this.faceX - this.faceY >= 0 ? 1 : -1) * (this.boss ? 0.6 : 1);
      alpha = clamp(1 - (k - 0.3) / 0.6, 0, 1);
    } else if (this.state === 'spawn' && this.emerge) {
      // stepping out of a doorway: nothing extra, alpha fades in
    } else if (this.state === 'spawn') {
      const k = clamp(1 - this.t / this.spawnDur, 0, 1);
      sqy = 0.3 + 0.7 * ease.outBack(k); sqx = 1.3 - 0.3 * k;
      // ink pool
      ctx.fillStyle = `rgba(30,15,45,${0.5 * (1 - k * 0.5)})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, 26 * this.r * 3, 12 * this.r * 3, 0, 0, TAU); ctx.fill();
    }
    const facing = worldDirToScreenAngle(this.faceX, this.faceY);
    if (this.type === 'gensai' && !this.dead) drawGensaiAura(ctx, this, sx, sy, t);
    const o = LOOKS[this.type](this, t);
    const sig = this.boss && !this.dead && !(iv && iv.hidden); // each boss's own signature (bosslooks.js)
    if (o.shimmer && !this.dead) alpha *= 0.75 + 0.25 * Math.sin(t * 6 + this.seed);
    const drawFn = o.draw || drawHumanoid;
    const h = o.h || 56;
    Object.assign(o, { x: sx, y: sy, z: this.z * 32, facing, time: t + this.seed, walk: this.walk, move: this.dead ? 0 : this.moveAmt, flash: this.flash, alpha: alpha * (o.alphaMul || 1), rot, sqx, sqy, seed: this.seed, e: this });
    if (!o.pose) o.pose = this.pose;
    if (iv && iv.pose) o.pose = iv.pose;
    if (iv && iv.flap) o.flapSpeed = iv.flap;
    if (this.stun > 0 && !this.boss && !o.pose) o.pose = { kind: 'hurt', t: 0.3 };
    // shield: held on the facing side; behind the body when walking away from the camera
    const sh = this.shield && this.shield.up && !this.dead ? this.shield : null;
    const shDir = Math.cos(facing) >= 0 ? 1 : -1, shBack = Math.sin(facing) < -0.55, shS = (o.s || 1) * (o.shieldS || 1);
    const drawSh = () => { ctx.save(); ctx.globalAlpha *= o.alpha; drawShieldItem(ctx, sh.kind, sx + shDir * (shBack ? 5 : 11) * shS, sy - h * 0.42 - this.z * 32, shS, t, this.flash > 0); ctx.restore(); };
    if (sh && shBack) drawSh();
    if (sig) drawBossSignature(ctx, this, sx, sy - this.z * 32 * 0, h, t, facing, 'back', o.alpha);
    drawFn(ctx, o);
    if (sig) drawBossSignature(ctx, this, sx, sy, h, t, facing, 'front', o.alpha);
    if (sh && !shBack) drawSh();
    // status tints
    if (!this.dead && (this.slowT > 0 || this.poison)) {
      ctx.save(); ctx.globalAlpha = 0.28;
      ctx.fillStyle = this.slowT > 0 ? '#9ee4ff' : '#8fe05a';
      ctx.beginPath(); ctx.ellipse(sx, sy - h * 0.5 - this.z * 32, 12 * Math.max(1, this.r * 2.5), h * 0.55, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (!this.dead) drawStatusFx(ctx, this, sx, sy - this.z * 32, h, t);
    if (!this.dead && this.rockT > 0) drawRockPrison(ctx, this, sx, sy - this.z * 32, h, t);
    // harpoon: a rope coiled around the feet
    if (this.rootT > 0 && !this.dead) {
      ctx.save(); ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2.2; ctx.globalAlpha = Math.min(1, this.rootT * 3);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(sx, sy - 4 - i * 4, 10 * Math.max(1, this.r * 2.5), 4, 0, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
    // hunter's mark: a red reticle over the head
    if (this.markT > 0 && !this.dead) {
      const my = sy - h - 18 - this.z * 32, mr = 6 + Math.sin(t * 8) * 0.8;
      ctx.save(); ctx.strokeStyle = 'rgba(230,50,40,0.95)'; ctx.lineWidth = 1.8; ctx.globalAlpha = Math.min(1, this.markT * 2);
      ctx.beginPath(); ctx.arc(sx, my, mr, 0, TAU); ctx.stroke();
      ctx.beginPath(); for (const [a, b] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) { ctx.moveTo(sx + a * (mr - 3), my + b * (mr - 3)); ctx.lineTo(sx + a * (mr + 3), my + b * (mr + 3)); } ctx.stroke();
      ctx.restore();
    }
    // phase 3 oni lord aura
    if (this.type === 'oni_lord' && this.phase >= 3 && !this.dead) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g2 = ctx.createRadialGradient(sx, sy - 50, 0, sx, sy - 50, 90);
      g2.addColorStop(0, 'rgba(255,60,20,0.25)'); g2.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(sx, sy - 50, 90, 0, TAU); ctx.fill(); ctx.restore();
    }
    // small health bar for regular enemies once damaged
    const barW = 26 * Math.max(1, this.r * 2.5), barY = sy - h - 8 - this.z * 32;
    if (!this.boss && !this.dead && this.hp < this.hpMax && this.state !== 'spawn') {
      ctx.fillStyle = 'rgba(20,10,20,0.7)'; ctx.fillRect(sx - barW / 2 - 1, barY - 1, barW + 2, 5);
      ctx.fillStyle = '#e04848'; ctx.fillRect(sx - barW / 2, barY, barW * (this.hp / this.hpMax), 3);
    }
    // shield break bar: fills up as the shield takes blocked hits; at full it shatters
    if (sh && this.state !== 'spawn' && alpha > 0.3 && !this.portrait) drawShieldBar(ctx, sx, barY - 8, barW, this.shieldProgress(), t);
  }
}

// imbuement and status effects on an enemy, drawn from its state so they show on both machines online:
// poison bubbles, frost crystals, lightning crackle, the staff's golden 'vulnerable' seal and stuck kunai
function drawStatusFx(ctx, e, sx, sy, h, t) {
  const rw = 12 * Math.max(1, e.r * 2.5), s = e.seed || 0;
  ctx.save();
  if (e.poison) { // green bubbles rising off the body, popping at the top
    for (let i = 0; i < 6; i++) {
      const life = (t * 0.7 + i / 6 + s) % 1, x = sx + Math.sin(i * 2.4 + s) * rw * 0.9 + Math.sin(t * 3 + i) * 2, y = sy - h * 0.15 - life * h * 0.95;
      const r = 1.6 + (i % 3) * 0.9 + life * 1.2;
      ctx.globalAlpha = Math.sin(life * Math.PI) * 0.85;
      ctx.fillStyle = 'rgba(120,220,70,0.35)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#a8f070'; ctx.lineWidth = 1.1; ctx.stroke();
    }
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#6ac83a'; // a drip under the feet
    ctx.beginPath(); ctx.ellipse(sx, sy + 1, rw * 0.8, 3.5, 0, 0, TAU); ctx.fill();
  }
  if (e.slowT > 0) { // frost: crystals turning slowly around the feet, a pale rime on the ground
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#dff6ff'; ctx.beginPath(); ctx.ellipse(sx, sy + 1, rw * 1.1, 5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#e8faff'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      const a = t * 0.8 + (i / 5) * TAU + s, x = sx + Math.cos(a) * rw * 1.15, y = sy - h * 0.35 + Math.sin(a) * rw * 0.45 + Math.sin(t * 2 + i) * 2, r = 3 + (i % 2) * 1.5;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(a * 2);
      ctx.beginPath(); for (let k = 0; k < 3; k++) { const b = (k * Math.PI) / 3 + t; ctx.moveTo(x - Math.cos(b) * r, y - Math.sin(b) * r); ctx.lineTo(x + Math.cos(b) * r, y + Math.sin(b) * r); } ctx.stroke();
    }
  }
  if (e.shockT > 0) { // lightning: short jagged arcs flickering over the body
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, e.shockT * 3);
    ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const seed = Math.floor(t * 18) + i * 7;
      const rnd = (k) => { const x = Math.sin((seed + k) * 12.9898 + s) * 43758.5453; return x - Math.floor(x); };
      let x = sx + (rnd(1) - 0.5) * rw * 2, y = sy - h * (0.2 + rnd(2) * 0.7);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rnd(3 + k) - 0.5) * 12; y += (rnd(9 + k) - 0.5) * 12; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  if (e.vulnT > 0) { // vulnerable (holy staff): a slowly turning golden seal at the feet
    ctx.globalAlpha = Math.min(1, e.vulnT * 2) * 0.8;
    ctx.translate(sx, sy); ctx.scale(1, 0.5); ctx.rotate(t * 0.9);
    const R = rw * 1.35;
    ctx.strokeStyle = '#ffd86a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); for (let i = 0; i <= 4; i++) { const a = (i * 2 / 5) * TAU * 2; ctx.lineTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); } ctx.stroke();
  } // (the last block: the restore below undoes its transform)
  ctx.restore();
  const n = e.daggers ? e.daggers.length : e.netDg || 0;
  if (n > 0) { // kunai stuck in the body, handles out
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a = (e.daggers && e.daggers[i] ? e.daggers[i].a : i * 2.1) + s, x = sx + Math.cos(a) * rw * 0.55, y = sy - h * (0.35 + 0.35 * ((i * 0.37 + s) % 1));
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.cos(a) > 0 ? -0.6 : 0.6 + Math.PI);
      // the same kunai as in flight (rig.js drawProjectile 'kunai'), its tip sunk into the body
      ctx.fillStyle = '#9aa3ad'; ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(6, -2.5); ctx.lineTo(12, 0); ctx.lineTo(6, 2.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
}

function drawShieldBar(ctx, sx, y, w, k, t) {
  const x = sx - w / 2 + 5;
  ctx.save();
  // little heater shield badge on the left
  ctx.translate(sx - w / 2 - 3, y + 1.5);
  ctx.fillStyle = 'rgba(16,14,22,0.85)'; ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, -5); ctx.lineTo(5, 0); ctx.quadraticCurveTo(4, 4.5, 0, 6.5); ctx.quadraticCurveTo(-4, 4.5, -5, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = k > 0.66 ? '#ffb040' : '#c8d2e0'; ctx.beginPath(); ctx.moveTo(-3.5, -3.6); ctx.lineTo(3.5, -3.6); ctx.lineTo(3.5, 0); ctx.quadraticCurveTo(3, 3.4, 0, 4.8); ctx.quadraticCurveTo(-3, 3.4, -3.5, 0); ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.save();
  ctx.fillStyle = 'rgba(16,14,22,0.8)'; ctx.fillRect(x - 1, y - 1, w - 4, 5);
  ctx.fillStyle = '#5a6272'; ctx.fillRect(x, y, w - 6, 3);
  if (k > 0) {
    const hot = k > 0.66 ? 0.6 + 0.4 * Math.sin(t * 18) : 1;
    ctx.fillStyle = k > 0.66 ? `rgba(255,${Math.round(150 + 60 * hot)},60,1)` : '#ffd36a';
    ctx.fillRect(x, y, (w - 6) * k, 3);
  }
  // notches for the three blocked melee hits
  ctx.fillStyle = 'rgba(16,14,22,0.9)';
  for (let i = 1; i < SHIELD.meleeHits; i++) ctx.fillRect(x + ((w - 6) * i) / SHIELD.meleeHits - 0.5, y, 1, 3);
  ctx.restore();
}

// Gensai: a crimson ground ring that tightens while he charges, and a golden ward while guarded
function drawGensaiAura(ctx, e, sx, sy, t) {
  const charging = e.state === 'windup' && (e.next === 'iai' || e.next === 'crescent' || e.next === 'mirage');
  ctx.save();
  if (charging) {
    const k = clamp(1 - e.t / (e.tDur || 1), 0, 1);
    ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.5);
    ctx.globalCompositeOperation = 'lighter';
    const R = lerp(90, 34, ease.outCubic(k));
    ctx.strokeStyle = `rgba(255,40,70,${0.35 + 0.5 * k})`; ctx.lineWidth = 3 + k * 4;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    g.addColorStop(0, `rgba(255,30,60,${0.25 * k})`); g.addColorStop(1, 'rgba(255,30,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    const ag = ctx.createRadialGradient(sx, sy - 45, 0, sx, sy - 45, 70);
    ag.addColorStop(0, `rgba(255,40,60,${0.28 * k})`); ag.addColorStop(1, 'rgba(255,40,60,0)');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(sx, sy - 45, 70, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  if (e.guarded) { // hexagonal golden ward
    ctx.translate(sx, sy - 44);
    ctx.strokeStyle = `rgba(255,215,110,${0.55 + 0.25 * Math.sin(t * 5)})`; ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(255,215,110,0.08)';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + t * 0.6; ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 58); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- telegraphs
// Telegraphs are kept faint so a crowd of them doesn't cover the screen: a light wash, a fill that grows
// with the windup, and an outline that only sharpens in the last moment before the hit.
const TELE_A = 0.55; // overall telegraph opacity
export const MIRAGE_W = 1.2; // Gensai's mirage dash lanes (his own dash and his clones')
export function drawTele(ctx, T, x, y, k, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 20);
  const edge = `rgba(255,90,70,${(0.22 + 0.5 * k * k * k).toFixed(3)})`;
  ctx.save();
  ctx.globalAlpha *= TELE_A;
  if (T.kind === 'arc' || T.kind === 'cone') {
    ctx.translate(isoX(x, y), isoY(x, y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4);
    // in this frame world axes map to screen axes scaled by 45.25
    const R = T.range * 45.25;
    const a0 = T.angle - T.arc / 2, a1 = T.angle + T.arc / 2;
    ctx.fillStyle = `rgba(220,40,40,${0.07 + 0.03 * pulse})`;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,60,40,0.22)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R * k, a0, a1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.stroke();
    if (T.locked) { // aim is fixed: the cone's edges light up
      ctx.strokeStyle = 'rgba(255,235,200,0.8)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath(); ctx.stroke();
    }
  } else if (T.kind === 'line') {
    ctx.translate(isoX(x, y), isoY(x, y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4);
    ctx.rotate(T.angle);
    const L = T.len * 45.25, W = T.width * 45.25;
    ctx.fillStyle = `rgba(220,40,40,${0.07 + 0.03 * pulse})`; ctx.fillRect(0, -W / 2, L, W);
    ctx.fillStyle = 'rgba(255,60,40,0.22)'; ctx.fillRect(0, -W / 2, L * k, W);
    ctx.strokeStyle = edge; ctx.lineWidth = 1.6; ctx.strokeRect(0, -W / 2, L, W);
    if (T.locked) { // aim is fixed: a solid lane with a notch at the end (softer for shots, which lock early)
      ctx.fillStyle = T.track ? 'rgba(255,235,200,0.42)' : 'rgba(255,235,200,0.75)'; ctx.fillRect(0, -1.5, L, 3);
      ctx.fillRect(L - 3, -W * 0.6, 3, W * 1.2);
    }
  } else if (T.kind === 'fan') {
    // one warning lane per projectile that is about to fly
    ctx.translate(isoX(x, y), isoY(x, y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4);
    const L = T.len * 45.25, W = (T.width || 0.22) * 45.25;
    for (const a of T.angles) {
      ctx.save(); ctx.rotate(a);
      ctx.fillStyle = `rgba(220,40,40,${0.08 + 0.04 * pulse})`; ctx.fillRect(0, -W / 2, L, W);
      ctx.fillStyle = 'rgba(255,70,50,0.3)'; ctx.fillRect(0, -W / 2, L * k, W);
      ctx.restore();
    }
  } else if (T.kind === 'circle') {
    const cx = isoX(T.x, T.y), cy = isoY(T.x, T.y);
    ctx.translate(cx, cy); ctx.scale(1, 0.5);
    const R = T.r * 45.25;
    if (T.outer) { // the shockwave that follows: a fainter ring out to its full reach, dashed edge
      const RO = T.outer * 45.25;
      ctx.fillStyle = `rgba(220,40,40,${0.04 + 0.02 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, RO, 0, TAU); ctx.arc(0, 0, R, 0, TAU, true); ctx.fill();
      ctx.strokeStyle = 'rgba(255,90,70,0.6)'; ctx.lineWidth = 1.6; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(0, 0, RO, 0, TAU); ctx.stroke(); ctx.setLineDash([]); // (always readable)
    }
    ctx.fillStyle = `rgba(220,40,40,${0.06 + 0.03 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,60,40,0.2)'; ctx.beginPath(); ctx.arc(0, 0, R * k, 0, TAU); ctx.fill();
    if (T.spokes) { // projectiles that fly out from the centre: one lane each, as long and wide as they hurt
      const S = T.spokes, SL = S.len * 45.25, SW = S.width * 45.25;
      ctx.save(); ctx.rotate(Math.PI / 4);
      for (let i = 0; i < S.n; i++) {
        ctx.save(); ctx.rotate((i / S.n) * TAU);
        ctx.fillStyle = `rgba(220,40,40,${0.05 + 0.03 * pulse})`; ctx.fillRect(0, -SW / 2, SL, SW);
        ctx.strokeStyle = 'rgba(255,90,70,0.45)'; ctx.lineWidth = 1.2; ctx.strokeRect(0, -SW / 2, SL, SW);
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.strokeStyle = edge; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  } else if (T.kind === 'donut') { // a ring around the enemy: only the band between r - w/2 and r + w/2 is hit (inside and outside are safe)
    const cx = isoX(T.x, T.y), cy = isoY(T.x, T.y), R0 = (T.r - T.w / 2) * 45.25, R1 = (T.r + T.w / 2) * 45.25, Rm = T.r * 45.25, hw = (R1 - R0) / 2;
    ctx.translate(cx, cy); ctx.scale(1, 0.5);
    ctx.fillStyle = `rgba(220,40,40,${0.07 + 0.03 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, R1, 0, TAU); ctx.arc(0, 0, R0, 0, TAU, true); ctx.fill();
    ctx.fillStyle = 'rgba(255,60,40,0.24)'; ctx.beginPath(); ctx.arc(0, 0, Rm + hw * k, 0, TAU); ctx.arc(0, 0, Rm - hw * k, 0, TAU, true); ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, R1, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, R0, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

// behaviors and looks live in behaviors.js

const slashA = (wx, wy) => Math.atan2(((wx + wy) * 16) / 0.55, (wx - wy) * 32);

export function slamAt(g, x, y, r, dmg, src) {
  sfx.slam(); g.shake(9);
  g.fx.ring(x, y, r, 'rgba(255,220,180,0.9)', 0.45, 7);
  g.particles.burst('dust', x, y, 0.1, 18, 4, 0.8, 7, g.world.bi === 2 ? '#eef3fb' : '#bfa47c');
  g.particles.burst('shard', x, y, 0.1, 10, 5, 0.7, 3, '#5a4a40', { grav: 18, bounce: true });
  g.decals.add(x, y, r * 0.5, 'rgba(40,30,25,1)', 8);
  // only inside the telegraphed circle: the player's centre must be within r (a body just touching the edge is safe)
  for (const p of g.targets) if (!p.dead && Math.hypot(p.x - x, p.y - y) < r) p.hurt(dmg, x, y, 7);
}

// ---------------------------------------------------------------- projectiles & hazards
// staff basic attack: small area burst damaging every enemy inside it
// the gloves' rock hits: full damage to the first enemy, half to the others within q.splash; Landslide: x1.5 for
// whoever is driven into a wall, an object or another enemy
function rockImpact(g, q, hit) {
  const l = Math.hypot(q.vx, q.vy) || 1, ux = q.vx / l, uy = q.vy / l;
  g.particles.burst('shard', q.x, q.y, 0.5, q.splash ? 16 : 7, 5, 0.6, 3.2, '#5a3a22', { grav: 16, bounce: true });
  g.particles.burst('dust', q.x, q.y, 0.2, 8, 3, 0.6, 6, '#8a6a44');
  if (q.splash) g.fx.quake(q.x, q.y, q.splash, 0.6);
  sfx.heavyHit(); g.shake(q.splash ? 4 : 2);
  for (const e of g.enemies) {
    if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
    const main = e === hit, d = Math.hypot(e.x - q.x, e.y - q.y);
    if (!main && (!q.splash || d > q.splash + e.r)) continue;
    const dx = main ? ux : (e.x - q.x) / (d || 1), dy = main ? uy : (e.y - q.y) / (d || 1);
    let { dmg, crit } = q.from.rollDamage(main ? q.base : q.base * 0.5, q.weapon);
    if (q.impact && pinnedBehind(g, e, dx, dy)) { dmg = Math.round(dmg * q.impact); g.fx.text(e.x, e.y, 'Crushed!', '#e8b070', 12); }
    g.damageEnemy(e, dmg, crit, dx, dy, main ? q.knock : q.knock * 0.5, main ? 0.25 : 0.1, { player: q.from, weapon: q.weapon, sound: 'heavyHit' });
    if (q.from.glovesHit) q.from.glovesHit(q.weapon);
  }
}
// is there a wall, an object or another enemy right behind e (in the direction ux, uy it is pushed)?
export function pinnedBehind(g, e, ux, uy) {
  const bx = e.x + ux * (e.r + 0.55), by = e.y + uy * (e.r + 0.55);
  if (g.world.blocked(bx, by, 0.15)) return true;
  for (const o of g.enemies) if (o !== e && !o.dead && Math.hypot(o.x - bx, o.y - by) < o.r + 0.35) return true;
  return false;
}
// locked in rock: a ring of spiky dark-brown stone around the body, rising out of the ground, crumbling at the end
function drawRockPrison(ctx, e, sx, sy, h, t) {
  const up = Math.min(1, (e.rockMax - e.rockT) / 0.25 + 0.05), fade = Math.min(1, e.rockT / 0.35), rx = Math.max(15, e.r * 44), ry = rx * 0.48;
  ctx.save(); ctx.globalAlpha *= fade;
  const spikes = 8;
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < spikes; k++) {
    const a = (k / spikes) * TAU + 0.3, front = Math.sin(a) > 0;
    if ((pass === 0) === front) continue; // (the far side first, then the near side over the body)
    const bx = sx + Math.cos(a) * rx, by = sy + Math.sin(a) * ry, H = h * (0.38 + 0.18 * ((k * 37) % 5) / 5) * up, w = rx * 0.34;
    ctx.beginPath(); ctx.moveTo(bx - w, by); ctx.lineTo(bx - w * 0.2 + Math.cos(a) * 3, by - H); ctx.lineTo(bx + w * 0.5, by - H * 0.55); ctx.lineTo(bx + w, by); ctx.closePath();
    ctx.fillStyle = front ? '#4a3020' : '#3a2416'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - w * 0.2 + Math.cos(a) * 3, by - H); ctx.lineTo(bx + w * 0.5, by - H * 0.55); ctx.lineTo(bx + w * 0.1, by - H * 0.2); ctx.closePath();
    ctx.fillStyle = 'rgba(140,100,64,0.6)'; ctx.fill();
  }
  ctx.restore();
}
function spiritBurst(g, q) {
  sfx.rin(0.95 + Math.random() * 0.1);
  g.fx.spirit(q.x, q.y, q.burst, { kanji: '浄', dur: 0.85 });
  g.particles.burst('glow', q.x, q.y, 0.5, 18, 3.2, 0.7, 2.4, '#fff2c0');
  g.particles.burst('glow', q.x, q.y, 0.2, 10, 1.2, 1.1, 2, '#ffffff'); // slow wisps that linger
  let hits = 0;
  for (let i = 0; i < 8; i++) g.particles.emit('ember', q.x + (Math.random() - 0.5) * q.burst, q.y + (Math.random() - 0.5) * q.burst, 0.1, 0, 0, 1.2 + Math.random(), 0.9 + Math.random() * 0.6, 1.6, '#ffe7a0', { drag: 0.5 }); // motes rising out of the seal
  for (const e of g.enemies) {
    if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
    const dx = e.x - q.x, dy = e.y - q.y, d = Math.hypot(dx, dy);
    if (d > q.burst + e.r) continue;
    const { dmg, crit } = q.from.rollDamage(q.base, q.weapon);
    g.damageEnemy(e, dmg, crit, dx / (d || 1), dy / (d || 1), 1, 0.05, { player: q.from, weapon: q.weapon, vuln: true });
    if (q.vuln && !e.dead) { e.vulnT = q.vuln; e.vulnMul = q.vulnMul || 1.2; } // blessed: +20% damage from everything else for a while
    hits++;
  }
  if (hits) { g.shake(2); g.hitstop(0.03); } // a weighty burst
  const KF = q.from.art && q.from.art(q.weapon, 'kiFlow'); // Ki Flow: each enemy hit gives ki
  if (KF && hits) q.from.gainEnergy(KF.perHit * hits);
  if (q.pool && q.from.addPool) q.from.addPool(q.x, q.y, q.burst, q.pool, q.base, q.weapon); // Sacred Pool
}

// a ricocheting kunai turns toward the nearest enemy it hasn't hit yet (within q.bounceRange)
function bounceProjectile(g, q, from) {
  let best = null, bd = q.bounceRange || 4;
  for (const o of g.enemies) {
    if (o === from || o.dead || o.hidden || o.state === 'spawn' || o.state === 'intro' || (q.hit && q.hit.has(o))) continue;
    const d = Math.hypot(o.x - from.x, o.y - from.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return false;
  const sp = Math.hypot(q.vx, q.vy) || 10, dx = best.x - from.x, dy = best.y - from.y, l = Math.hypot(dx, dy) || 1;
  q.x = from.x; q.y = from.y; q.vx = (dx / l) * sp; q.vy = (dy / l) * sp; q.life = l / sp + 0.2; q.bounce--;
  g.particles.burst('spark', from.x, from.y, 0.6, 4, 4, 0.15, 1, '#ffe6a0');
  return true;
}

function nearestPlayer(g, x, y) {
  let best = null, bd = 1e9;
  for (const p of g.players) { if (!p.active) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
  return best || g.players[0];
}

export function updateProjectiles(g, dt) {
  const P = g.projectiles;
  for (let i = P.length - 1; i >= 0; i--) {
    const q = P[i];
    if (q.dead) { P.splice(i, 1); continue; }
    q.life -= dt;
    if (q.lob) {
      q.t += dt; const k = Math.min(1, q.t / q.T);
      q.x = lerp(q.sx, q.tx, k); q.y = lerp(q.sy, q.ty, k); q.z = 0.9 + Math.sin(k * Math.PI) * 3 - k * 0.9;
      q.screenAng = 0;
      if (k >= 1) {
        q.dead = true; sfx.explode(); g.shake(5);
        if (q.kind === 'jug') { // tanuki sake jug: splash + clay shards
          g.fx.ring(q.x, q.y, q.r, 'rgba(240,220,170,0.9)', 0.4, 6);
          g.particles.burst('shard', q.x, q.y, 0.3, 14, 5, 0.7, 3, '#b8743a', { grav: 18, bounce: true });
          g.particles.burst('dot', q.x, q.y, 0.3, 16, 4, 0.6, 2, '#f4ead0', { grav: 10 });
        } else {
          g.fx.ring(q.x, q.y, q.r, 'rgba(255,170,60,0.9)', 0.4, 6);
          g.particles.burst('ember', q.x, q.y, 0.3, 20, 5, 0.6, 3, '#ffb040');
          g.particles.burst('smoke', q.x, q.y, 0.4, 10, 2, 1, 9, 'rgba(60,50,50,1)');
        }
        if (q.kind === 'firejar') g.hazards.push({ kind: 'fire', x: q.x, y: q.y, r: 1.2, life: 3.5, tick: 0, dmg: 5 });
        g.decals.add(q.x, q.y, 0.7, 'rgba(30,25,25,1)', 8);
        for (const p of g.targets) if (!p.dead && Math.hypot(p.x - q.x, p.y - q.y) < q.r) p.hurt(q.dmg, q.x, q.y, 6); // (inside the landing marker)
        for (const e of g.enemies) if (!e.dead && e.state !== 'spawn' && e.state !== 'intro' && Math.hypot(e.x - q.x, e.y - q.y) < q.r) g.damageEnemy(e, Math.round(q.dmg * 0.5), false, 0, 0, 2, 0.2, null);
      }
      continue;
    }
    q.age = (q.age || 0) + dt;
    if (q.homing && q.age < (q.homingFor ?? HOMING_FOR)) { // seeks for a short while only, then flies straight
      const p = nearestPlayer(g, q.x, q.y);
      const a = Math.atan2(q.vy, q.vx), want = Math.atan2(p.y - q.y, p.x - q.x);
      const na = a + clamp(angDiff(a, want), -q.homing * dt, q.homing * dt);
      q.vx = Math.cos(na) * q.speed; q.vy = Math.sin(na) * q.speed;
      if (Math.random() < 0.5) g.particles.emit('glow', q.x, q.y, q.z, 0, 0, 0.2, 0.4, 2.2, q.kind === 'soul' ? '#d09cff' : '#a0e0ff');
    }
    if (q.boomer) {
      const B = q.boomer; B.t += dt;
      const sp = Math.hypot(q.vx, q.vy) || 1;
      if (B.t < B.out) { const k = Math.max(0.15, 1 - B.t / B.out); q.vx = (q.vx / sp) * 11 * k; q.vy = (q.vy / sp) * 11 * k; }
      else {
        const o = B.owner, dx = o.x - q.x, dy = o.y - q.y, d = Math.hypot(dx, dy) || 1, s2 = Math.min(13, 3 + (B.t - B.out) * 14);
        q.vx = (dx / d) * s2; q.vy = (dy / d) * s2;
        if (d < 0.6 || o.dead) { q.dead = true; continue; }
      }
      q.spin = (q.spin || 0) + dt * 18;
      if (Math.random() < 0.5) g.particles.emit('glow', q.x, q.y, q.z, 0, 0, 0, 0.3, 2, '#ff8a9a');
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.screenAng = q.spin;
      if (q.life <= 0) { q.dead = true; continue; }
      for (const p of g.targets) {
        if (p.dead || p.z >= 0.5 || (q.hit && q.hit.has(p))) continue;
        if (Math.hypot(p.x - q.x, p.y - q.y) < (q.hitR ?? q.r + PROJ_HIT_PAD) && p.hurt(q.dmg * (p.projMul ? p.projMul() : 1), q.x - q.vx * 0.05, q.y - q.vy * 0.05, 4)) (q.hit || (q.hit = new Set())).add(p);
      }
      continue;
    }
    if (q.mote) { // the holy staff's light: sways sideways as it flies, arcs up and comes down on the ground nearby
      q.mt += dt;
      const k = Math.min(1, q.mt / q.mdur), along = q.mlen * ease.outQuad(k), side = Math.sin(k * Math.PI * 1.6) * q.mamp * (1 - 0.7 * k) * q.mside;
      const nx = q.sx + q.ux * along - q.uy * side, ny = q.sy + q.uy * along + q.ux * side;
      q.vx = (nx - q.x) / Math.max(dt, 1e-4); q.vy = (ny - q.y) / Math.max(dt, 1e-4); q.x = nx; q.y = ny;
      q.z = 0.9 * (1 - k) + Math.sin(k * Math.PI) * 0.75;
      if (Math.random() < 0.7) g.particles.emit('glow', q.x, q.y, q.z, 0, 0, 0.2, 0.35, 1.6, Math.random() < 0.5 ? '#fff6d8' : '#ffe08a');
      if (k >= 1) { q.dead = true; spiritBurst(g, q); continue; }
      for (const e of g.enemies) { // it can also strike an enemy on the way down
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden || q.z > 0.9) continue;
        if (Math.hypot(e.x - q.x, e.y - q.y) < e.r + q.r) { q.dead = true; spiritBurst(g, q); break; }
      }
      continue;
    }
    if (q.seek) steerWisp(g, q, dt); // the spirit orb's wisp hunts its enemy
    if (q.chase) { // a shot turned back by the shield: it flies on at the enemy it was sent at
      const e = q.chase;
      if (e.dead || e.hidden) q.chase = null;
      else {
        const a = Math.atan2(q.vy, q.vx), want = Math.atan2(e.y - q.y, e.x - q.x), na = a + clamp(angDiff(a, want), -14 * dt, 14 * dt);
        q.vx = Math.cos(na) * q.speed; q.vy = Math.sin(na) * q.speed; q.life = Math.max(q.life, 0.1);
      }
      if (Math.random() < 0.6) g.particles.emit('spark', q.x, q.y, q.z || 0.6, 0, 0, 0, 0.18, 1.4, '#ffe090');
    }
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.screenAng = q.kind === 'crescent' ? (q.spin = (q.spin || 0) + dt * 18) : worldDirToScreenAngle(q.vx, q.vy);
    if (q.glow && Math.random() < 0.8) g.particles.emit('glow', q.x, q.y, q.z, 0, 0, 0, 0.25, 2, q.kind === 'spirit' ? '#c8f0ff' : '#ffe6a0');
    if (q.kind === 'ofuda' && Math.random() < 0.5) g.particles.emit('ember', q.x, q.y, q.z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.6, 0.5, 1.4, Math.random() < 0.5 ? '#ffe7a0' : '#ffffff');
    const blocked = g.world.blocked(q.x, q.y, 0.02, true); // (shots fly over water)
    if (q.life <= 0 || blocked) {
      q.dead = true;
      if (q.burst) spiritBurst(g, q);
      else if (q.rock) g.particles.burst('shard', q.x, q.y, 0.4, 8, 3, 0.5, 3, '#5a3a22', { grav: 16, bounce: true });
      else if (blocked) g.particles.burst('spark', q.x, q.y, q.z, 5, 4, 0.25, 1.4, '#fff2c0');
      continue;
    }
    if (q.owner === 'player' && q.rock) { // the gloves' rock: shatters on the first enemy it touches (splash to those around)
      for (const e of g.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
        if (Math.hypot(e.x - q.x, e.y - q.y) < e.r + q.r + (e.flying ? 0.3 : 0)) { q.dead = true; rockImpact(g, q, e); break; }
      }
      continue;
    }
    if (q.owner === 'player' && q.burst) { // staff spirit bolt: bursts on the first enemy it touches
      for (const e of g.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
        if (Math.hypot(e.x - q.x, e.y - q.y) < e.r + q.r + (e.flying ? 0.3 : 0)) { q.dead = true; spiritBurst(g, q); break; }
      }
      continue;
    }
    if (q.owner === 'ally') { // a spirit ally's ghostly bolt: its own damage
      for (const e of g.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
        if (Math.hypot(e.x - q.x, e.y - q.y) < e.r + q.r + (e.flying ? 0.3 : 0)) {
          const l = Math.hypot(q.vx, q.vy) || 1;
          if (q.from && q.from.deal) q.from.deal(e, q.dmg, q.vx / l, q.vy / l);
          q.dead = true; break;
        }
      }
      continue;
    }
    if (q.owner === 'player') {
      for (const e of g.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden || (q.hit && q.hit.has(e))) continue;
        if (Math.hypot(e.x - q.x, e.y - q.y) < e.r + q.r + (e.flying ? 0.3 : 0)) {
          const mul = q.cbMark && q.from.boltMark ? q.from.boltMark(e, q.weapon) : 1; // crossbow: the 3rd bolt in a row breaks the marks
          const third = q.third3 && q.from && (q.from.kHits = ((q.from.kHits || 0) + 1) % 3) === 0; // Third Strike: every third kunai hit crits
          const { dmg, crit } = q.from.rollDamage(q.base * mul, q.weapon, !!q.forceCrit || third);
          const l = Math.hypot(q.vx, q.vy) || 1;
          g.damageEnemy(e, dmg, crit, q.vx / l, q.vy / l, q.knock || 1.5, 0.1, { player: q.from, weapon: q.weapon, sound: q.sound, shudder: q.shudder, mark: q.mark, markMul: q.markMul, entangle: q.entangle, bossSlow: q.bossSlow, storm: q.storm, orb: q.seek ? true : undefined });
          if (q.seek) wispHit(g, q, e); // spirit orb: tether it
          if (q.sparks) g.particles.burst('spark', e.x, e.y, 0.6, 4, 6, 0.16, 1, '#ffd890');
          (q.hit || (q.hit = new Set())).add(e);
          if (q.bounce > 0 && bounceProjectile(g, q, e)) break; // ricochet: on to the next enemy
          if (q.pierce > 0) q.pierce--; else { q.dead = true; if (q.stick && q.from.stickKunai) q.from.stickKunai(e, q.weapon); break; }
        }
      }
    } else {
      for (const p of g.targets) {
        if (p.dead || p.z >= 0.5) continue;
        if (Math.hypot(p.x - q.x, p.y - q.y) < (q.hitR ?? q.r + PROJ_HIT_PAD) && p.hurt(q.dmg, q.x - q.vx * 0.05, q.y - q.vy * 0.05, 3)) { // (by the player's centre: exactly the drawn lane)
          if (q.onHit) p.applyChill(q.onHit.chill, q.onHit.dur);
          q.dead = true; break;
        }
      }
    }
  }
}

// enemies a player's area attack can hit
function enemiesIn(g, x, y, r) {
  return g.enemies.filter((e) => !e.dead && !e.hidden && e.state !== 'spawn' && e.state !== 'intro' && Math.hypot(e.x - x, e.y - y) < r + e.r);
}

// pdt = un-warped time, used by the players' own talent effects
export function updateHazards(g, dt, pdt = dt) {
  const H = g.hazards;
  for (let i = H.length - 1; i >= 0; i--) {
    const h = H[i];
    if (h.kind === 'marker') { h.t -= dt; if (h.t <= 0) H.splice(i, 1); continue; }
    if (h.kind === 'smoke') { h.t -= dt; if (h.t <= -0.6) H.splice(i, 1); continue; } // (then a short fade)
    if (h.kind === 'blast') { // delayed ground burst (extras.js)
      h.t -= dt;
      if (h.t <= 0) {
        H.splice(i, 1);
        if (h.puppet) continue;
        sfx.zap(); g.fx.ring(h.x, h.y, h.r, `rgba(${h.color},0.95)`, 0.35, 6);
        g.particles.burst('glow', h.x, h.y, 0.4, 14, 3, 0.5, 2.4, `rgb(${h.color})`);
        for (const p of g.targets) if (p.active && Math.hypot(p.x - h.x, p.y - h.y) < h.r) p.hurt(h.dmg, h.x, h.y, 5);
      }
      continue;
    }
    if (h.kind === 'slash') { // Gensai's iai cut: lands along the whole lane when the timer ends
      h.t -= dt;
      if (h.t <= 0 && !h.done) {
        h.done = true; h.fadeT = 0.3;
        sfx.iaiCut(); g.shake(7); g.hitstop(0.05);
        if (!h.puppet) for (const p of g.targets) {
          if (p.dead || p.z >= 0.5) continue;
          const vx = h.x1 - h.x0, vy = h.y1 - h.y0, L2 = vx * vx + vy * vy || 1;
          const k = clamp(((p.x - h.x0) * vx + (p.y - h.y0) * vy) / L2, 0, 1);
          const d = Math.hypot(p.x - (h.x0 + vx * k), p.y - (h.y0 + vy * k));
          if (d < h.w) p.hurt(h.dmg, h.x0 + vx * k, h.y0 + vy * k, 9); // (the drawn lane is 2 w wide)
        }
      }
      if (h.done) { h.fadeT -= dt; if (h.fadeT <= 0) H.splice(i, 1); }
      continue;
    }
    if (h.kind === 'seal') { // shadow seal: fills, then bursts
      h.t -= dt;
      if (h.t <= 0) {
        H.splice(i, 1);
        sfx.explode(); g.shake(4);
        g.fx.ring(h.x, h.y, h.r, 'rgba(200,40,80,0.95)', 0.4, 7);
        g.particles.burst('ink', h.x, h.y, 0.3, 14, 4, 0.6, 5, 'rgba(60,10,30,0.9)');
        g.particles.burst('glow', h.x, h.y, 0.5, 10, 3, 0.5, 2.4, '#ff6a8a');
        if (!h.puppet) for (const p of g.targets) if (!p.dead && p.z < 0.5 && Math.hypot(p.x - h.x, p.y - h.y) < h.r) p.hurt(h.dmg, h.x, h.y, 6);
      }
      continue;
    }
    if (h.kind === 'mirage') { // shadow clone dash
      h.t -= dt; h.x += h.vx * dt; h.y += h.vy * dt;
      if (Math.random() < 0.9) g.particles.emit('ink', h.x, h.y, 0.8, 0, 0, 0, 0.35, 6, 'rgba(120,10,30,0.55)');
      h.hitSet = h.hitSet || new Set();
      if (!h.puppet) for (const p of g.targets) {
        if (p.dead || h.hitSet.has(p) || p.z >= 0.5) continue;
        if (Math.hypot(p.x - h.x, p.y - h.y) < MIRAGE_W / 2 && p.hurt(h.dmg, h.x, h.y, 8)) h.hitSet.add(p); // (inside the drawn lane)
      }
      if (h.t <= 0 || g.world.blocked(h.x, h.y, 0.3)) { g.particles.burst('ink', h.x, h.y, 0.6, 10, 2, 0.5, 5, 'rgba(60,10,30,0.8)'); H.splice(i, 1); }
      continue;
    }
    if (h.kind === 'arrows') { // talent: arrow rain
      h.t -= pdt; h.tick -= pdt;
      if (h.tick <= 0) {
        h.tick += h.every || 0.25;
        for (const e of enemiesIn(g, h.x, h.y, h.r)) { const { dmg, crit } = h.from.rollDamage(h.dmg); g.damageEnemy(e, dmg, crit, 0, 0, 0.5, 0.05, { player: h.from }); }
        for (let k = 0; k < 4; k++) { const a = rand(0, TAU), r = Math.sqrt(Math.random()) * h.r; g.particles.emit('dust', h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, 0.05, 0, 0, 0.3, 0.4, 3, '#c8b088', { under: true }); }
        sfx.throwKnife();
      }
      if (h.t <= 0) H.splice(i, 1);
      continue;
    }
    if (h.kind === 'meteor') { // talent: meteorite
      h.t -= pdt;
      if (Math.random() < 0.7) g.particles.emit('ember', h.x + rand(-0.4, 0.4), h.y + rand(-0.4, 0.4), (h.t / h.delay) * 8, rand(-0.5, 0.5), rand(-0.5, 0.5), 1, 0.5, 3, '#ffb040');
      if (h.t <= 0) {
        H.splice(i, 1);
        sfx.explode(); sfx.slam(); g.shake(14); g.hitstop(0.08);
        g.fx.ring(h.x, h.y, h.r, 'rgba(255,170,60,0.95)', 0.6, 10);
        g.particles.burst('ember', h.x, h.y, 0.3, 50, 7, 1, 3, '#ff8a30');
        g.particles.burst('smoke', h.x, h.y, 0.5, 16, 3, 1.4, 11, 'rgba(50,35,30,1)');
        g.particles.burst('shard', h.x, h.y, 0.2, 18, 7, 0.9, 4, '#5a4a40', { grav: 18, bounce: true });
        g.decals.add(h.x, h.y, h.r * 0.8, 'rgba(25,15,10,1)', 15);
        for (const e of enemiesIn(g, h.x, h.y, h.r)) {
          const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
          const { dmg, crit } = h.from.rollDamage(h.dmg);
          g.damageEnemy(e, dmg, crit, dx / d, dy / d, 8, 0.6, { player: h.from });
        }
      }
      continue;
    }
    if (h.kind === 'ring') {
      if (h.warn > 0) { h.warn -= dt; continue; } // (shown first, harmless, before it moves)
      h.rad += h.speed * dt;
      if (h.fire && Math.random() < 0.9) {
        const a = rand(0, TAU);
        if (!h.gap || Math.abs(angDiff(a, h.gap)) > h.gapW / 2) g.particles.emit('ember', h.x + Math.cos(a) * h.rad, h.y + Math.sin(a) * h.rad, 0.2, 0, 0, rand(1, 2), 0.5, 2.4, Math.random() < 0.5 ? '#ff7a20' : '#ffc040');
      }
      h.hitSet = h.hitSet || new Set();
      for (const p of g.targets) {
        if (p.dead || h.hitSet.has(p)) continue;
        const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy);
        const inGap = h.gap !== null && h.gap !== undefined && Math.abs(angDiff(Math.atan2(dy, dx), h.gap)) < h.gapW / 2;
        if (Math.abs(d - h.rad) < h.width && !inGap && p.z < 0.4) { if (p.hurt(h.dmg, h.x, h.y, 6)) h.hitSet.add(p); } // (the band is drawn 2 width wide)
      }
      if (h.speed > 0 ? h.rad > h.max : h.rad < (h.min ?? 0.3)) H.splice(i, 1);
      continue;
    }
    if (h.kind === 'trap') { // a hunter's bear trap: snaps shut on the first player (or spirit) that steps in
      h.life -= dt; if (h.arm > 0) h.arm -= dt;
      if (h.snapT != null) { h.snapT += dt; if (h.snapT > 0.9) H.splice(i, 1); continue; }
      if (h.arm <= 0) for (const p of g.targets) {
        if (!p.active || (p.z || 0) > 0.3 || Math.hypot(p.x - h.x, p.y - h.y) > 0.4 + p.r * 0.6) continue;
        h.snapT = 0; sfx.clang(); sfx.hit(); g.shake(4);
        p.hurt(h.dmg, h.x, h.y, 0);
        if (p.applyStun) p.applyStun(h.stun);
        g.particles.burst('spark', h.x, h.y, 0.3, 8, 4, 0.2, 1.4, '#ffe0a0');
        break;
      }
      if (h.life <= 0 && h.snapT == null) H.splice(i, 1);
      continue;
    }
    if (h.kind === 'fire') {
      h.life -= dt; h.tick -= dt;
      if (Math.random() < 0.6) g.particles.emit('ember', h.x + rand(-h.r, h.r) * 0.7, h.y + rand(-h.r, h.r) * 0.7, 0.1, 0, 0, rand(1, 2.5), 0.6, 2, Math.random() < 0.5 ? '#ff6a20' : '#ffb040');
      if (h.tick <= 0) {
        for (const p of g.targets) if (!p.dead && Math.hypot(p.x - h.x, p.y - h.y) < h.r) { h.tick = 0.5; p.hurt(h.dmg || 6, h.x, h.y, 1); }
      }
      if (h.life <= 0) H.splice(i, 1);
    }
  }
}

// friendly (gold) target circle; arrows falling, or a meteor dropping in
function drawTalentArea(ctx, h, t) {
  const sx = isoX(h.x, h.y), sy = isoY(h.x, h.y);
  ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.5);
  const R = h.r * 45.25;
  ctx.fillStyle = h.kind === 'meteor' ? 'rgba(255,140,40,0.18)' : 'rgba(255,220,120,0.14)';
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
  ctx.strokeStyle = h.kind === 'meteor' ? 'rgba(255,150,60,0.9)' : 'rgba(255,225,140,0.85)'; ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 7]); ctx.lineDashOffset = -t * 30; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  if (h.kind === 'meteor') { const k = 1 - Math.max(0, h.t) / h.delay; ctx.fillStyle = 'rgba(255,120,40,0.3)'; ctx.beginPath(); ctx.arc(0, 0, R * k, 0, TAU); ctx.fill(); }
  ctx.restore();
  if (h.kind === 'arrows') {
    // streaks falling at pseudo-random spots inside the circle
    ctx.strokeStyle = 'rgba(70,50,30,0.9)'; ctx.lineWidth = 1.6;
    for (let k = 0; k < 14; k++) {
      const ph = (t * 2.4 + k * 0.37) % 1, a = k * 2.399 + Math.floor(t * 2.4 + k * 0.37) * 1.7, r = (((k * 0.618) % 1) ** 0.5) * h.r;
      const x = h.x + Math.cos(a) * r, y = h.y + Math.sin(a) * r;
      const px = isoX(x, y), py = isoY(x, y), top = (1 - ph) * 160;
      ctx.beginPath(); ctx.moveTo(px - 3, py - top - 22); ctx.lineTo(px, py - top); ctx.stroke();
    }
  } else {
    const k = Math.max(0, h.t) / h.delay, z = k * 260;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sx + k * 60, sy - z, 0, sx + k * 60, sy - z, 34);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.4, 'rgba(255,150,50,0.9)'); g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx + k * 60, sy - z, 34, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#3a2a28'; ctx.beginPath(); ctx.arc(sx + k * 60, sy - z, 12, 0, TAU); ctx.fill();
  }
}

export function drawHazards(ctx, g, t) {
  for (const h of g.hazards) {
    if (h.kind === 'arrows' || h.kind === 'meteor') { drawTalentArea(ctx, h, t); continue; }
    if (h.kind === 'smoke') { drawSmoke(ctx, h, t); continue; }
    if (h.kind === 'marker' || h.kind === 'blast') drawTele(ctx, { kind: 'circle', x: h.x, y: h.y, r: h.r }, h.x, h.y, 1 - h.t / h.dur, t);
    else if (h.kind === 'slash') drawSlashLine(ctx, h, t);
    else if (h.kind === 'seal') drawSeal(ctx, h, t);
    else if (h.kind === 'mirage') {
      const o = LOOKS.gensai({ state: 'gdash', t: 0, tDur: 1 }, t);
      Object.assign(o, { x: isoX(h.x, h.y), y: isoY(h.x, h.y), z: 0, facing: worldDirToScreenAngle(h.fx, h.fy), time: t, walk: 0, move: 0, flash: 0, alpha: 0.55, pal: MIRAGE_PAL });
      drawHumanoid(ctx, o);
    }
    else if (h.kind === 'ring') {
      const sx = isoX(h.x, h.y), sy = isoY(h.x, h.y);
      ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.5);
      const R = h.rad * 45.25, W = h.width * 45.25 * 2;
      if (h.warn > 0) { ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 24); } // (about to close in)
      ctx.strokeStyle = h.fire ? 'rgba(255,110,30,0.75)' : 'rgba(255,220,180,0.7)'; ctx.lineWidth = W;
      ctx.beginPath();
      if (h.gap !== null && h.gap !== undefined) {
        // rotate world angle into the squashed iso frame
        ctx.rotate(Math.PI / 4);
        ctx.arc(0, 0, R, h.gap + h.gapW / 2, h.gap - h.gapW / 2 + TAU);
      } else ctx.arc(0, 0, R, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = h.fire ? 'rgba(255,230,140,0.9)' : 'rgba(255,255,255,0.8)'; ctx.lineWidth = W * 0.3; ctx.stroke();
      ctx.restore();
    } else if (h.kind === 'trap') { // iron jaws with teeth on a short chain; shut tight once sprung
      const sx = isoX(h.x, h.y), sy = isoY(h.x, h.y), shut = h.snapT != null;
      ctx.save(); ctx.translate(sx, sy); ctx.globalAlpha = h.arm > 0 ? 0.55 : 1;
      ctx.strokeStyle = '#2a2420'; ctx.lineWidth = 1.4; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(10, 3); ctx.lineTo(18, 6); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#3a3634'; ctx.beginPath(); ctx.arc(18, 6, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(30,26,24,0.35)'; ctx.beginPath(); ctx.ellipse(0, 1, 15, 7, 0, 0, TAU); ctx.fill();
      const jaw = (side) => {
        const open = shut ? 0.15 : 1;
        ctx.save(); ctx.scale(1, side * open);
        ctx.strokeStyle = INK; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.ellipse(0, 0, 12, 6, 0, Math.PI, TAU); ctx.stroke();
        ctx.strokeStyle = '#8a8680'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#c8c4bc'; for (let k = 1; k < 7; k++) { const a = Math.PI + (k / 7) * Math.PI, x = Math.cos(a) * 12, y = Math.sin(a) * 6; ctx.beginPath(); ctx.moveTo(x - 1.4, y); ctx.lineTo(x * 0.82, y * 0.55); ctx.lineTo(x + 1.4, y); ctx.closePath(); ctx.fill(); }
        ctx.restore();
      };
      jaw(1); jaw(-1);
      ctx.fillStyle = '#5a5450'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (h.kind === 'fire') {
      const sx = isoX(h.x, h.y), sy = isoY(h.x, h.y);
      const a = Math.min(1, h.life);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, h.r * 45);
      gr.addColorStop(0, `rgba(255,140,40,${0.55 * a})`); gr.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.5); ctx.translate(-sx, -sy);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, h.r * 45, 0, TAU); ctx.fill(); ctx.restore();
    }
  }
}

const MIRAGE_PAL = { skin: '#5a0a1e', cloth: '#3a0612', cloth2: '#8a1022', sash: '#ff6a8a', accent: '#ff6a8a', metal: '#ffb0c0', mantle: '#5a0a1e', wood: '#2a0610' };

// the iai lane: a red warning strip that flashes white when the cut lands
function drawSlashLine(ctx, h, t) {
  const ax = isoX(h.x0, h.y0), ay = isoY(h.x0, h.y0), bx = isoX(h.x1, h.y1), by = isoY(h.x1, h.y1);
  ctx.save(); ctx.lineCap = 'round';
  if (!h.done) { // the lane it cuts: 2 w wide, flat on the ground
    const vx = h.x1 - h.x0, vy = h.y1 - h.y0, l = Math.hypot(vx, vy) || 1, nx = (-vy / l) * h.w, ny = (vx / l) * h.w;
    const P = [[h.x0 + nx, h.y0 + ny], [h.x1 + nx, h.y1 + ny], [h.x1 - nx, h.y1 - ny], [h.x0 - nx, h.y0 - ny]].map(([x, y]) => [isoX(x, y), isoY(x, y)]);
    ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = 'rgba(255,50,60,0.3)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,90,100,0.8)'; ctx.lineWidth = 1.6; ctx.stroke();
  } else {
    const a = clamp(h.fadeT / 0.3, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,120,140,${0.6 * a})`; ctx.lineWidth = 18 * a + 2;
    ctx.beginPath(); ctx.moveTo(ax, ay - 20); ctx.lineTo(bx, by - 20); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 4 * a + 1;
    ctx.beginPath(); ctx.moveTo(ax, ay - 20); ctx.lineTo(bx, by - 20); ctx.stroke();
  }
  ctx.restore();
}

// shadow seal: a kanji circle on the ground filling up before it bursts
function drawSeal(ctx, h, t) {
  const k = clamp(1 - h.t / h.dur, 0, 1);
  const sx = isoX(h.x, h.y), sy = isoY(h.x, h.y);
  ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.5);
  const R = h.r * 45.25;
  ctx.fillStyle = `rgba(120,10,40,${0.18 + 0.1 * Math.sin(t * 16)})`; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(220,30,70,0.38)'; ctx.beginPath(); ctx.arc(0, 0, R * k, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,80,110,0.9)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, TAU); ctx.stroke();
  ctx.rotate(t * 0.8);
  for (let i = 0; i < 8; i++) { ctx.rotate(TAU / 8); ctx.beginPath(); ctx.moveTo(R * 0.78, 0); ctx.lineTo(R, 0); ctx.stroke(); }
  ctx.rotate(-t * 0.8);
  ctx.fillStyle = `rgba(255,120,140,${0.6 + 0.4 * k})`; ctx.font = `800 ${Math.round(R * 0.9)}px "Shippori Mincho", serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('封', 0, 2);
  ctx.restore();
}

export function drawProjectiles(ctx, list, t) {
  for (const q of list) {
    const sx = isoX(q.x, q.y), sy = isoY(q.x, q.y, q.z);
    drawProjectile(ctx, q, sx, sy, t);
  }
}

export function drawProjectileShadows(ctx, list) {
  ctx.fillStyle = 'rgba(25,18,35,0.22)';
  for (const q of list) {
    ctx.beginPath(); ctx.ellipse(isoX(q.x, q.y), isoY(q.x, q.y), 5, 2.2, 0, 0, TAU); ctx.fill();
  }
}

// Smoke Bomb: a slowly churning cloud of grey puffs (fades out over its last moment)
function drawSmoke(ctx, h, t) {
  const fade = h.t > 0 ? Math.min(1, (h.dur - h.t) / 0.25 + 0.2, h.t / 0.5 + 0.35) : Math.max(0, 1 + h.t / 0.6) * 0.35;
  const S = 45.25, R = h.r * S, cx = isoX(h.x, h.y), cy = isoY(h.x, h.y);
  ctx.save(); ctx.globalAlpha *= Math.min(1, fade);
  for (let i = 0; i < 16; i++) {
    const a = i * 2.399 + t * (i % 2 ? 0.25 : -0.2), rr = R * (0.15 + 0.75 * ((i * 0.618) % 1));
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.5 - 10 - 6 * Math.sin(t * 0.8 + i);
    const pr = R * (0.32 + 0.12 * Math.sin(t * 0.9 + i * 1.7));
    ctx.fillStyle = i % 3 ? 'rgba(150,150,160,0.32)' : 'rgba(200,200,210,0.28)';
    ctx.beginPath(); ctx.ellipse(px, py, pr, pr * 0.7, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

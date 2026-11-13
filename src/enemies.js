// Enemies, bosses, enemy/player projectiles and area hazards.
import { TAU, clamp, lerp, rand, pick, ease, isoX, isoY, worldDirToScreenAngle, angDiff, dist } from './util.js';
import { ENEMIES, BOSSES, levelScale, levelDamageScale, COOP_ENEMY_HP, COOP_ENEMY_DMG, SHIELD } from './config.js';
import { drawHumanoid, drawShadow, drawProjectile, drawShieldItem, INK } from './rig.js';
import { sfx } from './audio.js';
import { BEHAVIORS, LOOKS } from './behaviors.js';
import { EXTRA } from './extras.js';

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
    this.hpMax = Math.round(cfg.hp * (boss ? 1 : sc)); this.hp = this.hpMax;
    this.dmgMul = boss ? 1 : levelDamageScale(level);
    if (!boss && g.players && g.players.length > 1) { // co-op: tougher enemies
      this.hpMax = Math.round(this.hpMax * COOP_ENEMY_HP); this.hp = this.hpMax;
      this.dmgMul *= COOP_ENEMY_DMG;
    }
    this.speed = cfg.speed * (boss ? 1 : 1 + Math.min(0.25, level * 0.008));
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

  get dmg() { return this.cfg.dmg * this.dmgMul; }
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
    if (this._target && this._target.active) return this._target;
    let best = null, bd = 1e9;
    for (const p of this.g.players) { if (!p.active) continue; const d = (p.x - this.x) ** 2 + (p.y - this.y) ** 2; if (d < bd) { bd = d; best = p; } }
    this._target = best || this.g.players[0];
    return this._target;
  }
  toPlayer() { const p = this.target; const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 0.001; return [dx / d, dy / d, d]; }
  face(dx, dy) { const l = Math.hypot(dx, dy) || 1; this.faceX = dx / l; this.faceY = dy / l; }
  steer(dx, dy, mul = 1, dt) {
    const l = Math.hypot(dx, dy) || 1, s = this.speed * mul;
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
    // stuck detection: if we barely moved for a while, take a short detour
    this.stuckT = (this.stuckT || 0) + dt;
    if (this.stuckT > 0.8) {
      const moved = Math.hypot(this.x - (this.lastX ?? this.x), this.y - (this.lastY ?? this.y));
      if (mul > 0 && moved < 0.25) {
        this.stuckN = (this.stuckN || 0) + 1;
        // big bodies snag on corners even with a clear line of sight: trust the (size-aware) flow field for a while
        if (!this.flying && nav && tgt && this.stuckN <= 3) this.flowT = 1.8;
        else this.detour = { t: 0.7, a: Math.atan2(uy, ux) + (Math.random() < 0.5 ? 1.6 : -1.6) };
        // still wedged after several tries: step out to the nearest open tile
        if (this.stuckN >= 5 && !this.flying && nav) { const c = nav.openCellNear(this); if (c) { this.x = c[0]; this.y = c[1]; this.vx = this.vy = 0; } this.stuckN = 0; }
      } else this.stuckN = 0;
      this.stuckT = 0; this.lastX = this.x; this.lastY = this.y;
    }
    if (this.detour) { this.detour.t -= dt; ux = Math.cos(this.detour.a); uy = Math.sin(this.detour.a); if (this.detour.t <= 0) this.detour = null; }
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
    this.state = 'windup'; this.t = dur; this.tDur = dur; this.tele = tele; this.pose = { kind: poseKind, t: 0 }; this.next = next;
  }
  hurtPlayerIfIn(range, arcRad, dmg, knock = 5) {
    let any = false;
    for (const p of this.g.players) {
      if (!p.active) continue;
      const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy);
      if (d > range + p.r) continue;
      if (arcRad < TAU && d > 0.2 && Math.abs(angDiff(Math.atan2(this.faceY, this.faceX), Math.atan2(dy, dx))) > arcRad / 2) continue;
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
      if (P.tick <= 0) { P.tick += 0.5; g.damageEnemy(this, Math.max(1, Math.round(P.dps * 0.5)), false, 0, 0, 0, 0, { dot: true, player: P.player }); }
      if (Math.random() < dt * 6) g.particles.emit('glow', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.4, 1.2), 0, 0, 0.6, 0.6, 2, '#8fe05a');
      if (P.t <= 0 || this.dead) this.poison = null;
      if (this.dead) return;
    }
    // ice slows everything this enemy does
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slow = 0;
      dt *= 1 - this.slow;
      if (Math.random() < dt * 5) g.particles.emit('dot', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.3, 1.2), 0, 0, -0.3, 0.6, 1.6, '#cff4ff');
    }
    this.flash = Math.max(0, this.flash - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.poiseT = Math.max(0, (this.poiseT || 0) - dt);
    this.atkCd -= dt;
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
      const locked = beh.lockBefore && this.t <= beh.lockBefore;
      if (locked && this.tele) this.tele.locked = true;
      if (beh.trackDuringWindup && !locked) { const [dx, dy] = this.toPlayer(); this.face(dx, dy); if (this.tele && this.tele.track) this.tele.angle = Math.atan2(dy, dx); }
      if (this.t <= 0) {
        this.lastTele = this.tele; this.tele = null;
        this.state = 'recover'; this.t = this.cfg.recover;
        this.pose = { kind: 'strike', t: 0.38, dur: 0.35 };
        if (X && this.next && this.next.startsWith('x:')) X.strike(this, g, this.next.slice(2));
        else { beh.strike(this, g, this.next); if (X && X.after) X.after(this, g, this.next); }
      }
    } else if (this.state === 'recover') {
      this.t -= dt; this.halt(dt, 6);
      if (this.t <= 0) { this.state = 'chase'; this.atkCd = this.cfg.cooldown * rand(0.8, 1.2); }
    } else if (this.state === 'chase') {
      let started = false;
      if (X && X.think) { const [dx, dy, d] = this.toPlayer(); started = X.think(this, dt, g, dx, dy, d); if (started) this.face(dx, dy); }
      if (!started) beh.think(this, dt, g);
    } else if (!(X && X.custom && X.custom(this, dt, g))) {
      beh.custom?.(this, dt, g);
    }
    // integrate
    this.x += (this.vx + this.kvx * this.knockResist) * dt;
    this.y += (this.vy + this.kvy * this.knockResist) * dt;
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
    const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y);
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
    drawFn(ctx, o);
    if (sh && !shBack) drawSh();
    // status tints
    if (!this.dead && (this.slowT > 0 || this.poison)) {
      ctx.save(); ctx.globalAlpha = 0.28;
      ctx.fillStyle = this.slowT > 0 ? '#9ee4ff' : '#8fe05a';
      ctx.beginPath(); ctx.ellipse(sx, sy - h * 0.5 - this.z * 32, 12 * Math.max(1, this.r * 2.5), h * 0.55, 0, 0, TAU); ctx.fill();
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
    if (sh && this.state !== 'spawn' && alpha > 0.3) drawShieldBar(ctx, sx, barY - 8, barW, this.shieldProgress(), t);
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
  } else if (T.kind === 'line') {
    ctx.translate(isoX(x, y), isoY(x, y)); ctx.scale(1, 0.5); ctx.rotate(Math.PI / 4);
    ctx.rotate(T.angle);
    const L = T.len * 45.25, W = T.width * 45.25;
    ctx.fillStyle = `rgba(220,40,40,${0.07 + 0.03 * pulse})`; ctx.fillRect(0, -W / 2, L, W);
    ctx.fillStyle = 'rgba(255,60,40,0.22)'; ctx.fillRect(0, -W / 2, L * k, W);
    ctx.strokeStyle = edge; ctx.lineWidth = 1.6; ctx.strokeRect(0, -W / 2, L, W);
    if (T.locked) { // aim is fixed: bright solid lane with a notch at the end
      ctx.fillStyle = 'rgba(255,235,200,0.75)'; ctx.fillRect(0, -1.5, L, 3);
      ctx.fillRect(L - 3, -W * 1.8, 3, W * 3.6);
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
    ctx.fillStyle = `rgba(220,40,40,${0.06 + 0.03 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,60,40,0.2)'; ctx.beginPath(); ctx.arc(0, 0, R * k, 0, TAU); ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
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
  for (const p of g.players) if (!p.dead && Math.hypot(p.x - x, p.y - y) < r + p.r) p.hurt(dmg, x, y, 7);
}

// ---------------------------------------------------------------- projectiles & hazards
// staff basic attack: small area burst damaging every enemy inside it
function spiritBurst(g, q) {
  sfx.zap();
  g.fx.ring(q.x, q.y, q.burst, 'rgba(190,240,255,0.9)', 0.35, 5);
  g.particles.burst('glow', q.x, q.y, 0.5, 14, 3, 0.5, 2.4, '#c8f0ff');
  for (const e of g.enemies) {
    if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
    const dx = e.x - q.x, dy = e.y - q.y, d = Math.hypot(dx, dy);
    if (d > q.burst + e.r) continue;
    const { dmg, crit } = q.from.rollDamage(q.base);
    g.damageEnemy(e, dmg, crit, dx / (d || 1), dy / (d || 1), 1, 0.05, { player: q.from, weapon: q.weapon });
  }
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
        for (const p of g.players) if (!p.dead && Math.hypot(p.x - q.x, p.y - q.y) < q.r + p.r) p.hurt(q.dmg, q.x, q.y, 6);
        for (const e of g.enemies) if (!e.dead && e.state !== 'spawn' && e.state !== 'intro' && Math.hypot(e.x - q.x, e.y - q.y) < q.r) g.damageEnemy(e, Math.round(q.dmg * 0.5), false, 0, 0, 2, 0.2, null);
      }
      continue;
    }
    if (q.homing) {
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
      for (const p of g.players) {
        if (p.dead || p.z >= 0.5 || (q.hit && q.hit.has(p))) continue;
        if (Math.hypot(p.x - q.x, p.y - q.y) < p.r + q.r && p.hurt(q.dmg, q.x - q.vx * 0.05, q.y - q.vy * 0.05, 4)) (q.hit || (q.hit = new Set())).add(p);
      }
      continue;
    }
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.screenAng = q.kind === 'crescent' ? (q.spin = (q.spin || 0) + dt * 18) : worldDirToScreenAngle(q.vx, q.vy);
    if (q.glow && Math.random() < 0.8) g.particles.emit('glow', q.x, q.y, q.z, 0, 0, 0, 0.25, 2, q.kind === 'spirit' ? '#c8f0ff' : '#ffe6a0');
    const blocked = g.world.blocked(q.x, q.y, 0.02);
    if (q.life <= 0 || blocked) {
      q.dead = true;
      if (q.burst) spiritBurst(g, q);
      else if (blocked) g.particles.burst('spark', q.x, q.y, q.z, 5, 4, 0.25, 1.4, '#fff2c0');
      continue;
    }
    if (q.owner === 'player' && q.burst) { // staff spirit bolt: bursts on the first enemy it touches
      for (const e of g.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden) continue;
        if (Math.hypot(e.x - q.x, e.y - q.y) < e.r + q.r + (e.flying ? 0.3 : 0)) { q.dead = true; spiritBurst(g, q); break; }
      }
      continue;
    }
    if (q.owner === 'player') {
      for (const e of g.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'intro' || e.hidden || (q.hit && q.hit.has(e))) continue;
        if (Math.hypot(e.x - q.x, e.y - q.y) < e.r + q.r + (e.flying ? 0.3 : 0)) {
          const { dmg, crit } = q.from.rollDamage(q.base);
          const l = Math.hypot(q.vx, q.vy) || 1;
          g.damageEnemy(e, dmg, crit, q.vx / l, q.vy / l, q.knock || 1.5, 0.1, { player: q.from, weapon: q.weapon });
          (q.hit || (q.hit = new Set())).add(e);
          if (q.pierce > 0) q.pierce--; else { q.dead = true; break; }
        }
      }
    } else {
      for (const p of g.players) {
        if (p.dead || p.z >= 0.5) continue;
        if (Math.hypot(p.x - q.x, p.y - q.y) < p.r + q.r && p.hurt(q.dmg, q.x - q.vx * 0.05, q.y - q.vy * 0.05, 3)) {
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
    if (h.kind === 'blast') { // delayed ground burst (extras.js)
      h.t -= dt;
      if (h.t <= 0) {
        H.splice(i, 1);
        if (h.puppet) continue;
        sfx.zap(); g.fx.ring(h.x, h.y, h.r, `rgba(${h.color},0.95)`, 0.35, 6);
        g.particles.burst('glow', h.x, h.y, 0.4, 14, 3, 0.5, 2.4, `rgb(${h.color})`);
        for (const p of g.players) if (p.active && Math.hypot(p.x - h.x, p.y - h.y) < h.r + p.r * 0.5) p.hurt(h.dmg, h.x, h.y, 5);
      }
      continue;
    }
    if (h.kind === 'slash') { // Gensai's iai cut: lands along the whole lane when the timer ends
      h.t -= dt;
      if (h.t <= 0 && !h.done) {
        h.done = true; h.fadeT = 0.3;
        sfx.iaiCut(); g.shake(7); g.hitstop(0.05);
        if (!h.puppet) for (const p of g.players) {
          if (p.dead || p.z >= 0.5) continue;
          const vx = h.x1 - h.x0, vy = h.y1 - h.y0, L2 = vx * vx + vy * vy || 1;
          const k = clamp(((p.x - h.x0) * vx + (p.y - h.y0) * vy) / L2, 0, 1);
          const d = Math.hypot(p.x - (h.x0 + vx * k), p.y - (h.y0 + vy * k));
          if (d < h.w + p.r * 0.5) p.hurt(h.dmg, h.x0 + vx * k, h.y0 + vy * k, 9);
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
        if (!h.puppet) for (const p of g.players) if (!p.dead && p.z < 0.5 && Math.hypot(p.x - h.x, p.y - h.y) < h.r + p.r * 0.5) p.hurt(h.dmg, h.x, h.y, 6);
      }
      continue;
    }
    if (h.kind === 'mirage') { // shadow clone dash
      h.t -= dt; h.x += h.vx * dt; h.y += h.vy * dt;
      if (Math.random() < 0.9) g.particles.emit('ink', h.x, h.y, 0.8, 0, 0, 0, 0.35, 6, 'rgba(120,10,30,0.55)');
      h.hitSet = h.hitSet || new Set();
      if (!h.puppet) for (const p of g.players) {
        if (p.dead || h.hitSet.has(p) || p.z >= 0.5) continue;
        if (Math.hypot(p.x - h.x, p.y - h.y) < 1.1 + p.r * 0.5 && p.hurt(h.dmg, h.x, h.y, 8)) h.hitSet.add(p);
      }
      if (h.t <= 0 || g.world.blocked(h.x, h.y, 0.3)) { g.particles.burst('ink', h.x, h.y, 0.6, 10, 2, 0.5, 5, 'rgba(60,10,30,0.8)'); H.splice(i, 1); }
      continue;
    }
    if (h.kind === 'arrows') { // talent: arrow rain
      h.t -= pdt; h.tick -= pdt;
      if (h.tick <= 0) {
        h.tick += 0.2;
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
        g.fx.ring(h.x, h.y, h.r * 1.5, 'rgba(255,170,60,0.95)', 0.6, 10);
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
      h.rad += h.speed * dt;
      if (h.fire && Math.random() < 0.9) {
        const a = rand(0, TAU);
        if (!h.gap || Math.abs(angDiff(a, h.gap)) > h.gapW / 2) g.particles.emit('ember', h.x + Math.cos(a) * h.rad, h.y + Math.sin(a) * h.rad, 0.2, 0, 0, rand(1, 2), 0.5, 2.4, Math.random() < 0.5 ? '#ff7a20' : '#ffc040');
      }
      h.hitSet = h.hitSet || new Set();
      for (const p of g.players) {
        if (p.dead || h.hitSet.has(p)) continue;
        const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy);
        const inGap = h.gap !== null && h.gap !== undefined && Math.abs(angDiff(Math.atan2(dy, dx), h.gap)) < h.gapW / 2;
        if (Math.abs(d - h.rad) < h.width + p.r * 0.5 && !inGap && p.z < 0.4) { if (p.hurt(h.dmg, h.x, h.y, 6)) h.hitSet.add(p); }
      }
      if (h.rad > h.max) H.splice(i, 1);
      continue;
    }
    if (h.kind === 'fire') {
      h.life -= dt; h.tick -= dt;
      if (Math.random() < 0.6) g.particles.emit('ember', h.x + rand(-h.r, h.r) * 0.7, h.y + rand(-h.r, h.r) * 0.7, 0.1, 0, 0, rand(1, 2.5), 0.6, 2, Math.random() < 0.5 ? '#ff6a20' : '#ffb040');
      if (h.tick <= 0) {
        for (const p of g.players) if (!p.dead && Math.hypot(p.x - h.x, p.y - h.y) < h.r + p.r * 0.5) { h.tick = 0.5; p.hurt(h.dmg || 6, h.x, h.y, 1); }
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
  if (!h.done) {
    ctx.strokeStyle = 'rgba(255,60,70,0.55)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(ax, ay - 20); ctx.lineTo(bx, by - 20); ctx.stroke();
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

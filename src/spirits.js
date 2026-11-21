// The Restless Spirit Orb.
//  - Its wisps hunt an enemy down and tether it: damage over time (no extra damage taken since 2026-11-20).
//    When a tethered enemy dies, the tether jumps to the nearest enemy.
//  - Its special calls back the last enemy slain as a spirit ally that fights beside you (kept between levels until it falls).
//  - Wandering Souls (passive technique): orbs that circle the player and tether what they touch.
// The host runs all of it; the joiner draws the spirits, tethers and orbs from the snapshots (see online.js).
import { TAU, clamp, lerp, rand, isoX, isoY, worldDirToScreenAngle, angDiff } from './util.js';
import { WEAPONS, ENEMIES, BIOME_POOLS, levelScale, levelDamageScale, HEAVY_HP_MUL, ENEMY_SPEED_MUL } from './config.js';
import { drawHumanoid, drawShadow } from './rig.js';
import { LOOKS } from './behaviors.js';
import { sfx } from './audio.js';
import { ARTS } from './arts.js';

const OB = WEAPONS.orb.basic, OS = WEAPONS.orb.special;
export const GHOST = '#9fd8ff';
const S = 45.25; // pixels per tile on the ground plane
const live = (e) => e && !e.dead && !e.hidden && e.state !== 'spawn' && e.state !== 'intro';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const RANGED = new Set(['ranged', 'caster', 'lob']);

// ---------------------------------------------------------------- tethers
// tether enemy e for player p (weapon w): refreshes the time, keeps the tick running
export function tether(g, e, p, w) {
  if (!live(e) || !p) return;
  const fresh = !e.tether;
  e.tether = { t: OB.tetherDur, dur: OB.tetherDur, tick: fresh ? OB.tick : e.tether.tick, p, w };
  if (fresh) { g.particles.burst('glow', e.x, e.y, 0.8, 8, 2, 0.6, 2.4, GHOST); sfx.haunt(); }
}

// distance from (px, py) to the segment (ax, ay)-(bx, by)
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1, k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); return Math.hypot(px - ax - dx * k, py - ay - dy * k); }
// one tick of the tether: the orb's damage, scaled like any of the player's hits (but never a crit)
function tickDamage(p, w) {
  const d = OB.tickDmg * p.stats.baseDamage * (p.dmgMul || 1) * (p.adminMul || 1) * (p.artDmgMul ? p.artDmgMul(w) : 1) * (p.rageT > 0 ? (p.rageMul || 2) : 1) * (p.rushT > 0 ? p.rushMul : 1);
  return Math.floor(d) + (Math.random() < d - Math.floor(d) ? 1 : 0); // (fair rounding: 2.3 averages 2.3)
}

// called from Game.killEnemy: the tether leaves the body and jumps to the nearest enemy (an untethered one first)
export function tetherOnDeath(g, e) {
  const T = e.tether;
  if (!T) return;
  e.tether = null;
  if (g.role === 'client') return;
  let best = null, bd = 1e9;
  for (const o of g.enemies) {
    if (o === e || !live(o)) continue;
    const d = dist(o, e);
    if (d > OB.spread) continue;
    const sc = d + (o.tether ? 4 : 0);
    if (sc < bd) { bd = sc; best = o; }
  }
  if (!best) return;
  tether(g, best, T.p, T.w);
  (g.soulTrails || (g.soulTrails = [])).push({ x0: e.x, y0: e.y, x1: best.x, y1: best.y, e: best, t: 0, dur: 0.45 });
}

// ---------------------------------------------------------------- the orb's wisp (a player projectile, see enemies.js)
// a slow wisp that turns toward the enemy it hunts (the one nearest ahead of it, re-picked when that one falls)
export function steerWisp(g, q, dt) {
  if (!live(q.prey)) {
    q.prey = null;
    let bd = 1e9;
    const h = Math.atan2(q.vy, q.vx);
    for (const e of g.enemies) {
      if (!live(e)) continue;
      const dx = e.x - q.x, dy = e.y - q.y, d = Math.hypot(dx, dy);
      if (d > q.seek) continue;
      const off = Math.abs(angDiff(h, Math.atan2(dy, dx)));
      if (off > 1.4) continue; // only what lies ahead of it
      const sc = d * (1 + off * 0.8);
      if (sc < bd) { bd = sc; q.prey = e; }
    }
  }
  const sp = q.speed;
  if (q.prey) {
    const a = Math.atan2(q.vy, q.vx), want = Math.atan2(q.prey.y - q.y, q.prey.x - q.x);
    const na = a + clamp(angDiff(a, want), -q.turn * dt, q.turn * dt);
    q.vx = Math.cos(na) * sp; q.vy = Math.sin(na) * sp;
  }
  q.wob = (q.wob || 0) + dt;
  if (Math.random() < dt * 30) g.particles.emit('glow', q.x + rand(-0.1, 0.1), q.y + rand(-0.1, 0.1), q.z, -q.vx * 0.1, -q.vy * 0.1, 0.15, 0.5, 2.2, Math.random() < 0.5 ? GHOST : '#e6f6ff', { drag: 1.2 });
}

// the wisp found its enemy: tether it (Wailing Burst: everything around it as well)
export function wispHit(g, q, e) {
  const p = q.from, w = q.weapon, WB = p.art && p.art(w, 'wailingBurst');
  tether(g, e, p, w);
  g.particles.burst('glow', e.x, e.y, 0.8, 12, 2.6, 0.6, 2.6, GHOST);
  if (!WB) return;
  g.fx.ring(e.x, e.y, WB.radius, 'rgba(160,215,255,0.85)', 0.4, 4);
  g.fx.ring(e.x, e.y, WB.radius * 0.6, 'rgba(230,245,255,0.7)', 0.3, 2);
  g.particles.burst('glow', e.x, e.y, 0.5, 18, 4, 0.7, 2.4, '#cfeaff');
  const near = g.enemies.filter((o) => o !== e && live(o) && dist(o, e) <= WB.radius + o.r).sort((a, b) => dist(a, e) - dist(b, e)).slice(0, WB.extra || 2);
  for (const o of near) {
    g.fx.bolt(e.x, e.y, 0.7, o.x, o.y, 0.7);
    if (g.role !== 'client') { const { dmg, crit } = p.rollDamage(q.base || OB.dmg, w); g.damageEnemy(o, dmg, crit, 0, 0, 1, 0.05, { player: p, weapon: w, orb: true }); }
    if (live(o)) tether(g, o, p, w);
  }
}

// ---------------------------------------------------------------- the fallen
// remembered at every kill (not bosses or training dummies): what Call the Fallen can raise
export function rememberFallen(g, e) {
  if (e.boss || !ENEMIES[e.type] || e.type === 'dummy' || g.role === 'client') return;
  const c = e.cfg;
  (g.fallen || (g.fallen = [])).unshift({ type: e.type, hp: e.hpMax, dmg: e.dmg, r: e.r, speed: e.speed, range: c.range || 1.2, cooldown: c.cooldown || 1.2, ranged: RANGED.has(c.behavior) || !!c.proj });
  g.fallen.length = Math.min(g.fallen.length, 2);
}

// Giant's Soul: a heavy enemy of the area (as strong as one at this level), not the last one slain
function heavyInfo(g) {
  const pool = (BIOME_POOLS[g.world.bi] || BIOME_POOLS[0]).filter((t) => ENEMIES[t].heavy), type = pool[Math.floor(Math.random() * pool.length)] || 'sumo', c = ENEMIES[type];
  return { type, hp: c.hp * levelScale(g.level) * HEAVY_HP_MUL, dmg: c.dmg * levelDamageScale(g.level), r: c.r, speed: c.speed * ENEMY_SPEED_MUL, range: c.range || 1.2, cooldown: c.cooldown || 1.2, ranged: RANGED.has(c.behavior) || !!c.proj };
}

// Call the Fallen: one spirit (Twin Souls: the last two slain) rises in front of the player
// (Giant's Soul: always a heavy enemy of the area, even when nothing has fallen yet)
export function callSpirits(g, p, w) {
  const F = g.fallen || [], GS = p.art(w, 'soulForge') || p.lonelySoul; // (Lonely Soul: always a heavy of the area)
  if (!F.length && !GS) return false;
  const TS = p.art(w, 'twinSouls'), n = TS ? TS.count : 1;
  for (let i = 0; i < n; i++) {
    const info = GS ? heavyInfo(g) : F[Math.min(i, F.length - 1)];
    const side = n > 1 ? (i ? 1 : -1) : 0, a = Math.atan2(p.aimY, p.aimX) + side * 0.7;
    let x = p.x + Math.cos(a) * 1.5, y = p.y + Math.sin(a) * 1.5;
    if (g.world.blocked(x, y, info.r)) { x = p.x; y = p.y; }
    const s = new SpiritAlly(g, p, info, x, y);
    if (p.spiritBuff) { s.hpMax = Math.round(s.hpMax * p.spiritBuff); s.hp = s.hpMax; s.buffMul = p.spiritBuff; } // (Soul Tax)
    g.spirits.push(s);
    const mine = g.spirits.filter((o) => o.owner === p && !o.dead);
    if (mine.length > (p.spiritMax || OS.max)) mine[0].die(true); // the oldest makes room (Lonely Soul: one at most)
    // a pillar of pale light where it rises
    g.fx.ring(x, y, 1.4, 'rgba(170,220,255,0.9)', 0.6, 5);
    g.fx.ring(x, y, 0.7, 'rgba(240,250,255,0.9)', 0.4, 3);
    g.particles.burst('glow', x, y, 0.2, 26, 2.2, 1.2, 2.8, GHOST);
    for (let k = 0; k < 14; k++) g.particles.emit('glow', x + rand(-0.4, 0.4), y + rand(-0.4, 0.4), rand(0, 0.4), 0, 0, rand(2, 3.5), rand(0.7, 1.2), 2.4, k % 2 ? '#e8f6ff' : GHOST, { drag: 0.3 });
  }
  g.particles.burst('glow', p.x, p.y, 1.6, 14, 2, 0.7, 2.2, '#cfeaff'); // from the raised orb
  sfx.summon();
  return true;
}

// ---------------------------------------------------------------- spirit allies
let SID = 1;
const GHOST_TINT = 'rgba(150,205,255,0.66)';

export class SpiritAlly {
  constructor(g, owner, info, x, y) {
    this.g = g; this.owner = owner; this.id = SID++; this.type = info.type; this.info = info;
    this.cfg = ENEMIES[info.type] || {}; this.name = this.cfg.name;
    this.hpMax = Math.round(info.hp); this.hp = this.hpMax; this.forged = false;
    this.r = info.r || 0.32; this.speed = clamp(info.speed * 1.15, 3.2, 6.5);
    this.ranged = !!info.ranged; this.reach = this.ranged ? 6 : Math.max(1.15, info.range);
    this.cool = clamp(info.cooldown, 0.8, 2.6);
    this.x = x; this.y = y; this.z = 0; this.vx = 0; this.vy = 0; this.kvx = 0; this.kvy = 0;
    this.faceX = owner.aimX || 1; this.faceY = owner.aimY || 0;
    this.atkT = 0.6; this.anim = 0; this.side = 1; this.flash = 0; this.reT = 0; this.target = null;
    this.walk = 0; this.moveAmt = 0; this.seed = rand(0, 100); this.slot = rand(0, TAU);
    this.dead = false; this.deathT = 0; this.rise = 0.7; this.alpha = 0;
    // fields the enemy looks read
    this.data = {}; this.state = 'chase'; this.pose = null; this.t = 0; this.tDur = 1; this.phase = 1; this.boss = false; this.slowT = 0; this.stun = 0;
    this.aimX = this.faceX; this.aimY = this.faceY;
  }
  get active() { return !this.dead && this.rise <= 0.3; }
  get dmg() { return this.info.dmg * (this.buffMul || 1) * (this.buffT > 0 ? this.buffDmg || 1 : 1); } // (Spirit Font: empowered)

  // enemies hurt spirits the way they hurt players (see Game.targets)
  hurt(dmg, sx, sy, knock = 4) {
    if (!this.active || this.g.role === 'client') return false;
    const n = Math.max(1, Math.round(dmg * OS.hurtMul));
    this.hp -= n; this.flash = 0.14;
    const dx = this.x - sx, dy = this.y - sy, l = Math.hypot(dx, dy) || 1;
    this.kvx += (dx / l) * knock * 0.6; this.kvy += (dy / l) * knock * 0.6;
    this.g.fx.text(this.x, this.y, `${n}`, '#bcd8f0', 12);
    if (this.hp <= 0) this.die();
    return true;
  }
  applyChill() {} applyStun() {}
  heal(n) { const b = this.hp; this.hp = Math.min(this.hpMax, this.hp + n); return this.hp - b; }

  die(quiet = false) {
    if (this.dead) return;
    this.dead = true; this.deathT = 0;
    const g = this.g;
    g.particles.burst('glow', this.x, this.y, 0.8, quiet ? 10 : 22, 2.5, 0.9, 2.6, GHOST);
    for (let k = 0; k < 8; k++) g.particles.emit('glow', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.3, 1), 0, 0, rand(1.5, 2.8), rand(0.6, 1), 2, '#e8f6ff', { drag: 0.4 });
    sfx.fade();
  }

  // a new level: rise again beside the one you follow
  place(i, n) {
    const p = this.owner, a = (i / Math.max(1, n)) * TAU + 0.4;
    this.x = p.x + Math.cos(a) * 1.3; this.y = p.y + Math.sin(a) * 1.3;
    if (this.g.world.blocked(this.x, this.y, this.r)) { this.x = p.x; this.y = p.y; }
    this.vx = this.vy = this.kvx = this.kvy = 0; this.target = null; this.rise = 0.7; this.alpha = 0; this.atkT = 0.8;
  }

  lead() { const p = this.owner; return p.active ? p : this.g.players.find((q) => q.active) || p; }
  // the enemy its player is fighting (the last one they hit), else the nearest one around them
  pick(L) {
    const F = this.owner.focusE;
    if (live(F) && dist(F, L) < OS.leash) return F;
    let best = null, bd = 1e9;
    for (const e of this.g.enemies) {
      if (!live(e) || dist(e, L) > OS.leash - 1) continue;
      const d = dist(e, this);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt) {
    const g = this.g;
    if (this.dead) { this.deathT += dt; return; }
    if (this.net) { // joiner: follow the host's snapshots
      const k = 1 - Math.exp(-14 * dt);
      const mv = Math.hypot(this.tx - this.x, this.ty - this.y);
      this.x = lerp(this.x, this.tx, k); this.y = lerp(this.y, this.ty, k);
      this.moveAmt = lerp(this.moveAmt, mv > 0.03 ? 1 : 0, 1 - Math.exp(-8 * dt)); this.walk += this.moveAmt * dt * 9;
      this.anim = Math.max(0, this.anim - dt); this.flash = Math.max(0, this.flash - dt);
      return;
    }
    if (this.rise > 0) { this.rise -= dt; this.alpha = clamp(1 - this.rise / 0.7, 0, 1); }
    const bs = this.buffT > 0 ? this.buffSpd || 1 : 1; // Spirit Font: faster for a while
    if (this.buffT > 0) { this.buffT -= dt; if (Math.random() < dt * 14) g.particles.emit('glow', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.3, 1.1), 0, 0, rand(1.2, 2), 0.6, 2, '#d8f4ff', { drag: 0.4 }); }
    this.atkT -= dt * bs; this.anim = Math.max(0, this.anim - dt); this.flash = Math.max(0, this.flash - dt); this.reT -= dt;
    const L = this.lead();
    if (this.reT <= 0 || !live(this.target)) { this.reT = 0.4; this.target = this.pick(L); }
    const T = this.target;
    let gx, gy, sp = this.speed * bs;
    if (T && this.rise <= 0.3) {
      const dx = T.x - this.x, dy = T.y - this.y, d = Math.hypot(dx, dy) || 1;
      this.faceX = dx / d; this.faceY = dy / d; this.aimX = this.faceX; this.aimY = this.faceY;
      const want = this.ranged ? this.reach * 0.75 : this.reach * 0.7 + T.r;
      if (d > want) { gx = T.x - this.faceX * want; gy = T.y - this.faceY * want; }
      else { // in reach: drift slowly around it
        const a = Math.atan2(-dy, -dx) + Math.sin(g.time * 0.8 + this.slot) * 0.5;
        gx = T.x + Math.cos(a) * want; gy = T.y + Math.sin(a) * want; sp *= 0.4;
      }
      if (d <= this.reach + T.r + 0.1 && this.atkT <= 0 && this.anim <= 0) this.attack(T);
    } else { // nothing to fight: float close behind the one you follow
      const a = this.slot + g.time * 0.25;
      gx = L.x + Math.cos(a) * 1.7; gy = L.y + Math.sin(a) * 1.7;
      if (dist(this, L) > 1) { const dx = L.x - this.x, dy = L.y - this.y, d = Math.hypot(dx, dy); this.faceX = dx / d; this.faceY = dy / d; }
    }
    if (dist(this, L) > OS.leash + 4) { this.x = L.x + rand(-1, 1); this.y = L.y + rand(-1, 1); this.rise = 0.5; } // fell far behind: rise again by them
    let mx = gx - this.x, my = gy - this.y;
    const md = Math.hypot(mx, my), arrive = clamp(md / 0.7, 0, 1);
    if (md > 0.001) { mx = (mx / md) * arrive; my = (my / md) * arrive; }
    // keep apart from each other, the players and the enemies' bodies
    for (const o of g.spirits) {
      if (o === this || o.dead) continue;
      const ox = this.x - o.x, oy = this.y - o.y, od = Math.hypot(ox, oy), min = this.r + o.r + 0.2;
      if (od < min && od > 1e-3) { const k = ((min - od) / min) * 2; mx += (ox / od) * k; my += (oy / od) * k; }
    }
    for (const p of g.players) {
      if (!p.active) continue;
      const ox = this.x - p.x, oy = this.y - p.y, od = Math.hypot(ox, oy), min = this.r + p.r + 0.1;
      if (od < min && od > 1e-3) { const k = ((min - od) / min) * 1.6; mx += (ox / od) * k; my += (oy / od) * k; }
    }
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const k = 1 - Math.exp(-10 * dt);
    this.vx = lerp(this.vx, mx * sp, k); this.vy = lerp(this.vy, my * sp, k);
    this.x += (this.vx + this.kvx) * dt; this.y += (this.vy + this.kvy) * dt;
    const kd = Math.exp(-7 * dt); this.kvx *= kd; this.kvy *= kd;
    for (const e of g.enemies) { // bodies don't overlap
      if (!live(e)) continue;
      const ox = this.x - e.x, oy = this.y - e.y, od = Math.hypot(ox, oy), min = this.r + e.r;
      if (od < min && od > 1e-3) { const push = min - od; this.x += (ox / od) * push * 0.7; this.y += (oy / od) * push * 0.7; if (!e.boss) { e.x -= (ox / od) * push * 0.3; e.y -= (oy / od) * push * 0.3; } }
    }
    g.world.collide(this);
    const v = Math.hypot(this.vx, this.vy);
    this.moveAmt = lerp(this.moveAmt, clamp(v / Math.max(1.5, this.speed), 0, 1), 1 - Math.exp(-10 * dt));
    this.walk += v * dt * 2.6;
    if (Math.random() < dt * 2.5) g.particles.emit('glow', this.x + rand(-0.25, 0.25), this.y + rand(-0.25, 0.25), rand(0.2, 1), 0, 0, rand(0.6, 1.2), 0.8, 1.8, GHOST, { drag: 0.5 });
  }

  attack(T) {
    const g = this.g;
    this.atkT = this.cool * rand(0.9, 1.1); this.anim = 0.4; this.side = -this.side;
    if (this.ranged) { // a ghostly bolt
      const sp = 12, dx = T.x - this.x, dy = T.y - this.y, d = Math.hypot(dx, dy) || 1;
      g.spawnProjectile({ kind: 'spirit', owner: 'ally', from: this, x: this.x + (dx / d) * 0.4, y: this.y + (dy / d) * 0.4, z: 0.8, vx: (dx / d) * sp, vy: (dy / d) * sp, dmg: this.dmg, r: 0.25, life: (this.reach + 2) / sp, glow: true });
      sfx.wisp();
      return;
    }
    g.later(0.14, () => { // a ghostly cut: the target and anyone beside it in front
      if (this.dead) return;
      const fa = Math.atan2(this.faceY, this.faceX);
      g.fx.slash(this.x, this.y, Math.atan2(((this.faceX + this.faceY) * 16) / 0.55, (this.faceX - this.faceY) * 32), this.reach * 0.9 + 0.3, 2.2, 'rgba(170,220,255,0.85)', 9, 0.16, 0.55, this.side);
      sfx.slash();
      for (const e of g.enemies) {
        if (!live(e)) continue;
        const ex = e.x - this.x, ey = e.y - this.y, ed = Math.hypot(ex, ey);
        if (ed > this.reach + e.r + 0.35) continue;
        if (e !== T && Math.abs(angDiff(fa, Math.atan2(ey, ex))) > 0.9) continue;
        this.deal(e, this.dmg, ex / (ed || 1), ey / (ed || 1));
      }
    });
  }

  // a spirit's blow: its own damage (not the player's stats), and Soul Bond heals the player for a share of it
  deal(e, base, dx, dy) {
    const g = this.g, n = Math.max(1, Math.round(base * rand(0.9, 1.1)));
    g.damageEnemy(e, n, false, dx, dy, 2, 0.1, { player: this.owner, spirit: true, ally: true });
    g.particles.burst('glow', e.x, e.y, 0.6, 4, 2, 0.4, 2, GHOST);
    const SB = this.owner.anyArt && this.owner.anyArt('soulBond');
    if (SB && this.owner.active) {
      const P = this.owner;
      P.bondAcc = (P.bondAcc || 0) + n * SB.heal;
      if (P.bondAcc >= 1) { const h = Math.floor(P.bondAcc); P.bondAcc -= h; const got = P.heal(h); if (got > 0) P.healPop = (P.healPop || 0) + got; }
    }
  }

  drawShadow(ctx) {
    if (this.dead) return;
    drawShadow(ctx, isoX(this.x, this.y), isoY(this.x, this.y), this.r * 30, 0.12 * this.alpha);
  }

  // the enemy's own look, drawn into a small canvas, washed pale blue, the legs fading out, floating a little
  draw(ctx, t) {
    let a = this.alpha * (this.dead ? Math.max(0, 1 - this.deathT / 0.7) : 1);
    if (a <= 0.01) return;
    const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y);
    const bob = 5 + Math.sin(t * 2.6 + this.seed) * 2.5 + (this.dead ? this.deathT * 30 : 0) + (this.rise > 0 ? this.rise * 20 : 0);
    const m = ctx.getTransform(), sc = clamp(Math.hypot(m.a, m.b), 0.5, 3);
    const W = 190, H = 210, ax = W / 2, ay = H * 0.8;
    if (!this.cv) this.cv = document.createElement('canvas');
    const cv = this.cv, cw = Math.ceil(W * sc), ch = Math.ceil(H * sc);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cw, ch); c.setTransform(sc, 0, 0, sc, 0, 0);
    this.state = this.anim > 0 ? 'recover' : 'chase';
    let o = null;
    try { o = LOOKS[this.type] ? LOOKS[this.type](this, t) : null; } catch (err) { o = null; }
    if (!o) o = { pal: { skin: '#ccc', cloth: '#999', cloth2: '#777', sash: '#aaa' }, head: 'hood' };
    const drawFn = o.draw || drawHumanoid;
    Object.assign(o, { x: ax, y: ay, z: 0, facing: worldDirToScreenAngle(this.faceX, this.faceY), time: t + this.seed, walk: this.walk, move: this.moveAmt, flash: 0, alpha: 1, rot: 0, sqx: 1, sqy: 1, seed: this.seed, e: this });
    if (this.anim > 0) o.pose = this.ranged ? { kind: 'shoot', t: 1 - this.anim / 0.4 } : { kind: 'strike', t: 0.38 + 0.62 * (1 - this.anim / 0.4) };
    else if (!o.pose) o.pose = null;
    try { drawFn(c, o); } catch (err) { /* a look that needs enemy state we don't have: just the glow */ }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-atop'; c.fillStyle = this.flash > 0 ? 'rgba(255,255,255,0.85)' : GHOST_TINT; c.fillRect(0, 0, cw, ch);
    c.globalCompositeOperation = 'destination-out'; // the legs fade into mist
    const fade = c.createLinearGradient(0, (ay - 26) * sc, 0, (ay + 4) * sc);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.9)');
    c.fillStyle = fade; c.fillRect(0, (ay - 26) * sc, cw, ch);
    c.globalCompositeOperation = 'source-over';
    ctx.save();
    // a soft halo behind the body
    const hy = sy - bob - 26, gl = ctx.createRadialGradient(sx, hy, 0, sx, hy, 40);
    gl.addColorStop(0, `rgba(150,210,255,${0.28 * a})`); gl.addColorStop(1, 'rgba(150,210,255,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, hy, 40, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a * 0.72; ctx.drawImage(cv, sx - ax, sy - ay - bob, W, H);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.22; ctx.drawImage(cv, sx - ax, sy - ay - bob, W, H);
    ctx.restore();
    // health: a thin pale bar once hurt
    if (!this.dead && this.hp < this.hpMax) {
      const bw = 26 * Math.max(1, this.r * 2.5), by = sy - bob - (o.h || 56) * (o.s || 1) - 10;
      ctx.fillStyle = 'rgba(10,20,40,0.6)'; ctx.fillRect(sx - bw / 2 - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = '#9fd8ff'; ctx.fillRect(sx - bw / 2, by, bw * clamp(this.hp / this.hpMax, 0, 1), 3);
    }
  }
}

// ---------------------------------------------------------------- per frame
export function updateSpirits(g, dt) {
  for (const s of g.spirits) s.update(dt);
  g.spirits = g.spirits.filter((s) => !s.dead || s.deathT < 0.8);
  if (g.soulTrails) { for (const tr of g.soulTrails) tr.t += dt; g.soulTrails = g.soulTrails.filter((tr) => tr.t < tr.dur); }
  if (g.soulRises) { for (const r of g.soulRises) { r.t += dt; r.z += r.vz * dt; r.vz *= Math.exp(-0.35 * dt); r.x += (r.vx || 0) * dt; r.y += (r.vy || 0) * dt; } g.soulRises = g.soulRises.filter((r) => r.t < r.dur); } // the orb's finisher
  if (g.role === 'client') return;
  // Soul Tax: every spirit drains its owner's energy
  for (const p of g.players) if (p.soulTax) { const n = g.spirits.filter((s) => s.owner === p && !s.dead).length; if (n) p.energy = Math.max(0, p.energy - n * p.soulTax * dt); }
  // tethers tick on the host
  for (const e of g.enemies) {
    const T = e.tether;
    if (!T) continue;
    if (e.dead) { e.tether = null; continue; }
    T.t -= dt; T.tick -= dt;
    if (T.tick <= 0) {
      T.tick += OB.tick;
      const src = { dot: true, tether: true, orb: true, player: T.p, weapon: T.w };
      { const n = tickDamage(T.p, T.w); if (n > 0) g.damageEnemy(e, n, false, 0, 0, 0, 0, src); }
      // the line from the player to this enemy burns whatever stands on it (untethered enemies only; not tethered by it)
      if (T.p && T.p.active) for (const o of g.enemies) {
        if (o === e || o.tether || !live(o) || segDist(o.x, o.y, T.p.x, T.p.y, e.x, e.y) > o.r + 0.2) continue;
        const n = tickDamage(T.p, T.w); if (n > 0) g.damageEnemy(o, n, false, 0, 0, 0, 0, src);
      }
    }
    if (e.tether === T && T.t <= 0) e.tether = null;
  }
  // Wandering Souls: orbs drifting around their player, tethering what they touch
  for (const p of g.players) {
    const w = p.weapons.find((x) => x.key === 'orb'), WS = w && p.art(w, 'wanderingSouls');
    if (!WS || !p.active) { p.wardA = null; continue; }
    p.wardA = ((p.wardA ?? 0) + WS.spin * dt) % TAU;
    const hits = p.wardHits || (p.wardHits = new Map());
    for (let k = 0; k < WS.count; k++) {
      const a = p.wardA + (k * TAU) / WS.count, ox = p.x + Math.cos(a) * WS.radius, oy = p.y + Math.sin(a) * WS.radius;
      for (const e of g.enemies) {
        if (!live(e) || Math.hypot(e.x - ox, e.y - oy) > e.r + 0.35) continue;
        if (g.time - (hits.get(e) ?? -9) < WS.every) continue;
        hits.set(e, g.time);
        const { dmg, crit } = p.rollDamage(OB.dmg * WS.dmgMul, w);
        g.damageEnemy(e, dmg, crit, Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2), 1, 0.05, { player: p, weapon: w, orb: true });
        tether(g, e, p, w);
      }
    }
    if (hits.size > 40) for (const [e] of hits) if (e.dead) hits.delete(e);
  }
}

// keep the spirits through a level change: they rise again around their player
export function placeSpirits(g) {
  g.spirits = g.spirits.filter((s) => !s.dead);
  for (const p of g.players) {
    const mine = g.spirits.filter((s) => s.owner === p);
    mine.forEach((s, i) => s.place(i, mine.length));
  }
  g.soulTrails = [];
}

// a wavy ribbon of spirit light
function ribbon(ctx, x0, y0, x1, y1, t, seed, amp, alpha, width) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, N = Math.max(6, Math.round(L / 14));
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const k = i / N, w = Math.sin(k * Math.PI) * amp * Math.sin(k * 9 - t * 6 + seed);
    const x = x0 + dx * k + nx * w, y = y0 + dy * k + ny * w;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.strokeStyle = `rgba(150,210,255,${alpha})`; ctx.lineWidth = width; ctx.stroke();
  ctx.strokeStyle = `rgba(235,248,255,${alpha * 0.9})`; ctx.lineWidth = width * 0.35; ctx.stroke();
}

// drawn over the scene: tether ribbons from the orb to each tethered enemy, ghost wisps circling their bodies,
// tethers jumping from a fallen enemy, and the Wandering Souls orbs
export function drawSpiritFx(ctx, g, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const e of g.enemies) {
    const T = e.tether;
    if (!T || e.dead || e.hidden) continue;
    const ex = isoX(e.x, e.y), h = (e.boss ? 60 : 28) * Math.max(1, e.r * 2.2), ey = isoY(e.x, e.y) - h - (e.z || 0) * 32;
    const fade = clamp(T.t / 0.6, 0, 1), p = T.p;
    // the tether itself, from the player's orb (only when they are near)
    if (p && !p.dead && Math.hypot(p.x - e.x, p.y - e.y) < 10) ribbon(ctx, isoX(p.x, p.y) + 8, isoY(p.x, p.y) - 40, ex, ey, t, e.id, 6, 0.22 * fade, 2.4);
    // spirits circling the middle of its body
    const R = 16 * Math.max(1, e.r * 2.4);
    const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, R * 1.4);
    glow.addColorStop(0, `rgba(140,200,255,${0.22 * fade})`); glow.addColorStop(1, 'rgba(140,200,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ex, ey, R * 1.4, 0, TAU); ctx.fill();
    for (let k = 0; k < 3; k++) {
      const a = t * 2.4 + (k * TAU) / 3 + e.id, wx = ex + Math.cos(a) * R, wy = ey + Math.sin(a) * R * 0.45 + Math.sin(t * 5 + k) * 3;
      const tx = wx + Math.sin(a) * 9, ty = wy - Math.cos(a) * 4; // its tail trails behind
      ctx.strokeStyle = `rgba(160,215,255,${0.45 * fade})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.quadraticCurveTo((wx + tx) / 2, (wy + ty) / 2 - 3, tx, ty); ctx.stroke();
      ctx.fillStyle = `rgba(225,245,255,${0.8 * fade})`; ctx.beginPath(); ctx.arc(wx, wy, 2.6, 0, TAU); ctx.fill();
    }
  }
  for (const tr of g.soulTrails || []) { // a tether leaping on to the next enemy
    const k = tr.t / tr.dur, x0 = isoX(tr.x0, tr.y0), y0 = isoY(tr.x0, tr.y0) - 30, x1 = isoX(tr.e.x, tr.e.y), y1 = isoY(tr.e.x, tr.e.y) - 30;
    const hx = lerp(x0, x1, Math.min(1, k * 1.5)), hy = lerp(y0, y1, Math.min(1, k * 1.5)) - Math.sin(Math.min(1, k * 1.5) * Math.PI) * 30;
    ribbon(ctx, x0, y0, hx, hy, t, tr.x0, 5, 0.5 * (1 - k), 3);
    ctx.fillStyle = `rgba(230,248,255,${1 - k})`; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, TAU); ctx.fill();
  }
  for (const r of g.soulRises || []) { // the orb's finisher: little ghosts streaming up into the sky
    const k = r.t / r.dur, a = Math.min(1, k * 6) * (1 - k), s = r.s;
    const x = isoX(r.x, r.y) + Math.sin(r.t * 9 + r.seed) * 5, y = isoY(r.x, r.y) - r.z * 32;
    const gl = ctx.createRadialGradient(x, y, 0, x, y, 16 * s);
    gl.addColorStop(0, `rgba(150,210,255,${0.45 * a})`); gl.addColorStop(1, 'rgba(150,210,255,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, 16 * s, 0, TAU); ctx.fill();
    const wv = Math.sin(r.t * 16 + r.seed) * 4 * s; // the tail streams down behind it, waving
    ctx.fillStyle = `rgba(200,232,255,${0.75 * a})`;
    ctx.beginPath(); ctx.moveTo(x - 6 * s, y); ctx.quadraticCurveTo(x - 5 * s + wv, y + 14 * s, x + wv * 1.5, y + 26 * s); ctx.quadraticCurveTo(x + 5 * s + wv, y + 14 * s, x + 6 * s, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(240,250,255,${0.95 * a})`; ctx.beginPath(); ctx.arc(x, y - 1 * s, 6.5 * s, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(30,50,90,${0.8 * a})`; ctx.beginPath(); ctx.ellipse(x - 2.2 * s, y - 1.5 * s, 1 * s, 1.6 * s, 0, 0, TAU); ctx.ellipse(x + 2.2 * s, y - 1.5 * s, 1 * s, 1.6 * s, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
  }
  for (const p of g.players) { // Wandering Souls
    if (p.wardA == null || p.dead) continue;
    const WS = ARTS.orb.wanderingSouls;
    for (let k = 0; k < WS.count; k++) {
      const a = p.wardA + (k * TAU) / WS.count, ox = p.x + Math.cos(a) * WS.radius, oy = p.y + Math.sin(a) * WS.radius;
      const sx = isoX(ox, oy), sy = isoY(ox, oy) - 30 + Math.sin(t * 3 + k * 2) * 4;
      drawSoulOrb(ctx, sx, sy, 7, t + k);
    }
  }
  ctx.restore();
}

// a small glowing soul (the Wandering Souls orbs; also the orb in the hand, see rig.js 'spiritorb')
export function drawSoulOrb(ctx, x, y, r, t) {
  const gl = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  gl.addColorStop(0, 'rgba(170,220,255,0.55)'); gl.addColorStop(1, 'rgba(120,190,255,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(120,190,255,0.7)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(240,250,255,0.95)'; ctx.beginPath(); ctx.arc(x - r * 0.25 + Math.sin(t * 4) * r * 0.2, y - r * 0.2, r * 0.42, 0, TAU); ctx.fill();
}

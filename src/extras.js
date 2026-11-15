// Extra attack moves for the later areas, on top of each enemy's shared behaviour (behaviors.js).
// Each entry: think(e, dt, g, dx, dy, d) -> true when it started a move (windup with next = 'x:<move>'),
// strike(e, g, move), optional custom(e, dt, g) -> true when it handled a custom state, and
// optional after(e, g, next) right after the base attack lands (used for follow-up combos).
// Every move has its own cooldown (e.data.xCd) so the base attacks still make up most of the fight.
import { TAU, rand } from './util.js';
import { sfx } from './audio.js';

const slashA = (wx, wy) => Math.atan2(((wx + wy) * 16) / 0.55, (wx - wy) * 32);
const ready = (e) => e.atkCd <= 0 && (e.data.xCd ?? (e.data.xCd = rand(2, 4.5))) <= 0;
const used = (e, min = 5, max = 8) => { e.data.xCd = rand(min, max); };
const ang = (dx, dy) => Math.atan2(dy, dx);
function ringHazard(g, x, y, max, dmg, speed = 8) { g.hazards.push({ kind: 'ring', x, y, rad: 0.5, speed, max, width: 0.45, dmg, hit: false, gap: null }); }
function shoot(g, e, kind, a, speed, dmg, extra = {}) {
  g.spawnProjectile({ owner: 'enemy', kind, x: e.x, y: e.y, z: 0.7, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, r: 0.2, life: 1.6, onHit: e.cfg.onHit, ...extra });
}
// a delayed blast on the ground (telegraphed circle, then damage inside it)
export function blastAt(g, x, y, r, dmg, delay, color = '170,120,255') { g.hazards.push({ kind: 'blast', x, y, r, t: delay, dur: delay, dmg, color }); }

// shared dash: travels along the facing, hurts the first player it touches once
function startDash(e, speed, dur) { e.state = 'xdash'; e.t = dur; e.data.hit = false; e.vx = e.faceX * speed; e.vy = e.faceY * speed; sfx.dash(); }
function dashCustom(e, dt, g, color) {
  if (e.state !== 'xdash') return false;
  e.t -= dt;
  if (!e.data.hit && e.hurtInLane(0.95, e.dmg, 7)) e.data.hit = true;
  if (Math.random() < 0.7) g.particles.emit('glow', e.x, e.y, 0.6, 0, 0, 0.2, 0.4, 2.6, color);
  if (e.t <= 0 || g.world.blocked(e.x + e.faceX * 0.6, e.y + e.faceY * 0.6, 0.2)) { e.state = 'recover'; e.t = e.cfg.recover; e.vx *= 0.2; e.vy *= 0.2; }
  return true;
}
// follow-up: right after the base attack, sometimes a quick second one
function chainThink(e, dt, g, dx, dy, d, tele) {
  if (!e.data.chain) return false;
  e.data.chain = false;
  if (d > e.cfg.range + 1.2) return false;
  e.windup(0.26, tele(dx, dy, d), 'windup', 'strike');
  return true;
}

export const EXTRA = {
  // ================================================================ area 2: mountain pass
  kappa: { // spits a water bolt from mid range
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d < 2.5 || d > 5.5) return false;
      e.data.xa = ang(dx, dy); used(e);
      e.windup(0.5, { kind: 'line', len: 6, width: 0.25, angle: e.data.xa }, 'throw', 'x:spit'); return true;
    },
    strike: (e, g) => { shoot(g, e, 'orb', e.data.xa, 9, e.dmg * 0.9); sfx.enemyShoot(); },
  },
  kitsune: { // three foxfire flames in a fan
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d < 2.5 || d > 6) return false;
      e.data.xa = ang(dx, dy); used(e, 5, 7);
      const a = e.data.xa; e.windup(0.6, { kind: 'fan', len: 6, width: 0.3, angles: [a - 0.35, a, a + 0.35] }, 'cast', 'x:foxfire'); return true;
    },
    strike: (e, g) => { for (const o of [-0.35, 0, 0.35]) shoot(g, e, 'fireball', e.data.xa + o, 7.5, e.dmg * 0.8, { life: 1.4 }); sfx.zap(); },
  },
  karasu: { // folds its wings and dives straight at you
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d < 3 || d > 7) return false;
      e.data.xa = ang(dx, dy); e.data.xd = d + 1; used(e, 6, 9);
      e.windup(0.65, { kind: 'line', len: d + 1, width: 0.7, angle: e.data.xa }, 'windup', 'x:dive'); return true;
    },
    strike: (e) => { e.faceX = Math.cos(e.data.xa); e.faceY = Math.sin(e.data.xa); startDash(e, 13, e.data.xd / 13); },
    custom: (e, dt, g) => dashCustom(e, dt, g, '#3a3050'),
  },
  tanuki: { // three jugs at once: on you and on both sides
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d < 3 || d > 8) return false;
      used(e, 7, 10); e.windup(0.85, null, 'throw', 'x:triple'); return true;
    },
    strike: (e, g) => {
      const p = e.target, l = Math.hypot(p.x - e.x, p.y - e.y) || 1, px = -(p.y - e.y) / l, py = (p.x - e.x) / l;
      for (const s of [-1.8, 0, 1.8]) {
        const tx = Math.max(1, Math.min(g.world.N - 1, p.x + px * s)), ty = Math.max(1, Math.min(g.world.N - 1, p.y + py * s));
        g.spawnProjectile({ owner: 'enemy', kind: 'jug', lob: true, x: e.x, y: e.y, z: 0.9, sx: e.x, sy: e.y, tx, ty, T: 1.1, t: 0, dmg: e.dmg, r: 1.3, life: 2 });
        g.hazards.push({ kind: 'marker', x: tx, y: ty, r: 1.3, t: 1.1, dur: 1.1 });
      }
      sfx.throwKnife();
    },
  },
  yamabushi: { // blows the conch: a shockwave ring when you get close
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d > 2.8) return false;
      used(e, 6, 9); e.windup(0.75, { kind: 'circle', x: e.x, y: e.y, r: 3.2 }, 'cast', 'x:conch'); return true;
    },
    strike: (e, g) => { ringHazard(g, e.x, e.y, 3.4, e.dmg * 1.1, 7); sfx.horn(); g.shake(3); },
  },
  kamaitachi: { // sometimes lunges a second time right away
    think: (e, dt, g, dx, dy, d) => chainThink(e, dt, g, dx, dy, d, (x, y, dd) => ({ kind: 'line', len: e.cfg.range + 0.7, width: 0.6, angle: ang(x, y) })),
    after: (e) => { if (Math.random() < 0.5) e.data.chain = true; },
  },

  // ================================================================ area 3: castle town
  skeleton: { // throws a bone from range
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d < 3 || d > 7) return false;
      e.data.xa = ang(dx, dy); used(e, 6, 9);
      e.windup(0.6, { kind: 'line', len: 7, width: 0.18, angle: e.data.xa }, 'throw', 'x:bone'); return true;
    },
    strike: (e, g) => { shoot(g, e, 'kunai', e.data.xa, 11, e.dmg * 0.8); sfx.throwKnife(); },
  },
  frostarcher: { // a volley of three ice arrows
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d < 3 || d > 8) return false;
      e.data.xa = ang(dx, dy); used(e, 6, 8);
      const a = e.data.xa; e.windup(0.85, { kind: 'fan', len: 8, width: 0.14, angles: [a - 0.22, a, a + 0.22] }, 'draw', 'x:volley'); return true;
    },
    strike: (e, g) => { for (const o of [-0.22, 0, 0.22]) shoot(g, e, 'icearrow', e.data.xa + o, 11, e.dmg); sfx.enemyShoot(); },
  },
  yukionna: { // freezing breath: a cone of cold that slows
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d > 3) return false;
      e.data.xa = ang(dx, dy); used(e, 6, 9);
      e.windup(0.6, { kind: 'cone', range: 3.3, arc: 1.15, angle: e.data.xa }, 'cast', 'x:breath'); return true;
    },
    strike: (e, g) => {
      e.faceX = Math.cos(e.data.xa); e.faceY = Math.sin(e.data.xa);
      for (let k = 0; k < 18; k++) { const a = e.data.xa + rand(-0.5, 0.5), r = rand(0.4, 3.2); g.particles.emit('glow', e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, 0.5, Math.cos(a) * 2, Math.sin(a) * 2, 0.4, 0.6, 2.4, '#e8f6ff'); }
      e.hurtPlayerIfIn(3.3, 1.15, e.dmg * 1.1, 3); // her onHit chill slows whoever it catches
      sfx.zap();
    },
  },
  wisp: { // soul seals under and around you that burst
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d > 9) return false;
      used(e, 7, 10); e.windup(0.7, null, 'cast', 'x:souls'); return true;
    },
    strike: (e, g) => {
      const p = e.target;
      blastAt(g, p.x, p.y, 1.15, e.dmg, 1.1, '190,140,255');
      for (let k = 0; k < 2; k++) { const a = rand(0, TAU); blastAt(g, p.x + Math.cos(a) * 2, p.y + Math.sin(a) * 2, 1.15, e.dmg, 1.35 + k * 0.25, '190,140,255'); }
      sfx.seal();
    },
  },

  // ================================================================ area 4: the fortress
  kgsoldier: { // two-hit combo
    think: (e, dt, g, dx, dy, d) => chainThink(e, dt, g, dx, dy, d, (x, y) => ({ kind: 'arc', range: e.cfg.range + 0.2, arc: 1.9, angle: ang(x, y) })),
    after: (e) => { if (Math.random() < 0.55) e.data.chain = true; },
  },
  kgspear: { // a wide sweep when you stand too close for a thrust
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d > 1.8) return false;
      e.data.xa = ang(dx, dy); used(e, 4, 6);
      e.windup(0.45, { kind: 'cone', range: 2.4, arc: 2.8, angle: e.data.xa }, 'windup', 'x:sweep'); return true;
    },
    strike: (e, g) => {
      sfx.heavy(); e.faceX = Math.cos(e.data.xa); e.faceY = Math.sin(e.data.xa);
      g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), 1.7, 2.8, 'rgba(255,220,200,0.75)', 10, 0.16);
      e.hurtPlayerIfIn(2.4, 2.8, e.dmg, 8);
    },
  },
  kgsentry: { // a fully drawn heavy bolt: slower to aim, hits much harder
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d < 3 || d > 9) return false;
      used(e, 6, 9);
      e.windup(1.15, { kind: 'line', len: 10, width: 0.32, angle: ang(dx, dy), track: true }, 'draw', 'x:heavybolt'); return true;
    },
    strike: (e, g) => { shoot(g, e, 'bolt', ang(e.faceX, e.faceY), 19, e.dmg * 1.6, { r: 0.24, life: 1 }); sfx.shoot(); g.shake(2); },
  },
  kgshinobi: { // a fan of three kunai
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d < 2 || d > 5.5) return false;
      e.data.xa = ang(dx, dy); used(e, 4, 7);
      const a = e.data.xa; e.windup(0.45, { kind: 'fan', len: 6, width: 0.14, angles: [a - 0.28, a, a + 0.28] }, 'throw', 'x:kunai'); return true;
    },
    strike: (e, g) => { for (const o of [-0.28, 0, 0.28]) shoot(g, e, 'kunai', e.data.xa + o, 14, e.dmg * 0.75); sfx.throwKnife(); },
  },
  kgmonk: { // war chant: heals hurt allies nearby
    think: (e, dt, g) => {
      if (!ready(e)) return false;
      const hurt = g.enemies.some((o) => o !== e && !o.dead && !o.boss && o.hp < o.hpMax * 0.8 && Math.hypot(o.x - e.x, o.y - e.y) < 5);
      if (!hurt) return false;
      used(e, 8, 11); e.windup(0.9, null, 'cast', 'x:chant'); return true;
    },
    strike: (e, g) => {
      g.fx.ring(e.x, e.y, 5, 'rgba(255,215,110,0.85)', 0.7, 5); sfx.chime(1);
      for (const o of g.enemies) {
        if (o.dead || o.boss || Math.hypot(o.x - e.x, o.y - e.y) > 5) continue;
        const n = Math.round(o.hpMax * 0.18); o.hp = Math.min(o.hpMax, o.hp + n);
        g.fx.text(o.x, o.y, `+${n}`, '#ffd76a', 12);
        g.particles.burst('glow', o.x, o.y, 0.8, 8, 1.5, 0.7, 2.2, '#ffe39a');
      }
    },
  },
  kgwall: { // slams the shield down: a shockwave ring
    think: (e, dt, g, dx, dy, d) => {
      if (!ready(e) || d > 2.6) return false;
      used(e, 7, 10); e.windup(0.8, { kind: 'circle', x: e.x, y: e.y, r: 3.0 }, 'windup', 'x:quake'); return true;
    },
    strike: (e, g) => { ringHazard(g, e.x, e.y, 3.2, e.dmg, 6.5); sfx.slam(); g.shake(5); g.particles.burst('dust', e.x, e.y, 0.05, 14, 3, 0.6, 5, '#c8b8a8', { under: true }); },
  },
};

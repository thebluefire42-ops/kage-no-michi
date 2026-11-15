// Enemy AI (shared behaviour types + heavy abilities + bosses) and per-enemy looks.
import { TAU, clamp, lerp, rand, pick, angDiff } from './util.js';
import { BOSS_DMG, PLAYER_STUN, GENSAI_GUARD, SUMO, PLAYER_BASE } from './config.js';
import { sfx } from './audio.js';
import { Enemy, slamAt } from './enemies.js';
import { drawKappa } from './rig.js';
// Kurogane's band: who he calls in (plain soldiers throughout, heavies only once he rages)
const KURO_ADDS = ['bandit', 'bandit', 'spear', 'archer', 'tate'];
const KURO_HEAVY = ['sumo', 'samurai'];
import { drawWeasel, drawTanuki, drawBoar, drawKomainu, drawWisp, drawGasha, drawDummy } from './creatures.js';

const slashA = (wx, wy) => Math.atan2(((wx + wy) * 16) / 0.55, (wx - wy) * 32);
const ringHazard = (g, x, y, max, dmg, speed = 8) => g.hazards.push({ kind: 'ring', x, y, rad: 0.5, speed, max, width: 0.45, dmg, hit: false, gap: null });
const levelInBiome = (g) => ((g.level - 1) % 10) + 1;

// ================================================================ shared behaviour types
function meleeThink(e, dt, g, arc = 1.9) {
  const [dx, dy, d] = e.toPlayer();
  e.face(dx, dy);
  if (d < e.cfg.range * 0.85 && e.atkCd <= 0) {
    e.windup(e.cfg.windup, { kind: 'arc', range: e.cfg.range + 0.2, arc, angle: Math.atan2(dy, dx) });
    return;
  }
  let mx = dx, my = dy;
  if (d < 3) { const s = Math.sin(e.seed) > 0 ? 1 : -1; mx += -dy * 0.6 * s; my += dx * 0.6 * s; }
  e.steer(mx, my, d < e.cfg.range * 0.7 ? 0 : 1, dt);
}

const SMOKE = { assassin: 'rgba(50,30,70,1)', kitsune: 'rgba(255,170,70,1)', yukionna: 'rgba(235,245,255,1)' };
const PROJ_SPEED = { arrow: 12, dart: 13, icearrow: 11 };

export const BEHAVIORS = {
  // the training dummy: stands still, can't be knocked away, and heals to full after a few quiet seconds
  dummy: {
    init: (e) => { e.knockResist = 0; e.data.lastHit = -99; },
    think: (e, dt, g) => {
      e.vx = 0; e.vy = 0; e.faceX = 1; e.faceY = 1;
      if (e.hp < e.hpMax && g.time - e.data.lastHit > e.cfg.resetAfter) { e.hp = e.hpMax; g.fx.text(e.x, e.y, 'Reset', '#cfe8ff', 13); }
    },
    strike: () => {},
  },
  melee: {
    think: (e, dt, g) => meleeThink(e, dt, g),
    strike: (e, g) => {
      sfx.slash();
      g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), e.cfg.range * 0.7, 1.9, e.type === 'skeleton' ? 'rgba(170,230,255,0.7)' : 'rgba(255,200,200,0.7)', 8, 0.14);
      e.hurtPlayerIfIn(e.cfg.range, 2.0, e.dmg);
    },
  },
  lunge: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (d < e.cfg.range && e.atkCd <= 0) { e.windup(e.cfg.windup, { kind: 'line', len: e.cfg.range + 0.7, width: 0.8, angle: Math.atan2(dy, dx) }); return; }
      e.steer(dx, dy, d < 1.6 ? -0.5 : 1, dt);
    },
    strike: (e) => { const s = e.cfg.lungeSpeed || 15; e.state = 'lunge'; e.t = 0.18; e.data.hit = false; e.vx = e.faceX * s; e.vy = e.faceY * s; sfx.dash(); },
    custom: (e, dt, g) => {
      if (e.state !== 'lunge') return;
      e.t -= dt;
      if (!e.data.hit && e.hurtInLane(1.1, e.dmg, 7)) e.data.hit = true;
      if (Math.random() < 0.6) {
        if (e.type === 'kamaitachi') g.particles.emit('leaf', e.x, e.y, 0.5, rand(-1, 1), rand(-1, 1), 0.5, 0.5, 2.5, '#f4f8ff', { drag: 2 });
        else if (e.type === 'ghostspear') g.particles.emit('glow', e.x, e.y, 0.6, 0, 0, 0.2, 0.4, 3, '#9ec8ff');
        else g.particles.emit('dust', e.x, e.y, 0.05, 0, 0, 0.2, 0.4, 3, '#c8b088', { under: true });
      }
      if (e.t <= 0) { e.state = 'recover'; e.t = e.cfg.recover; }
    },
  },
  ranged: {
    trackDuringWindup: true,
    lockBefore: 0.4, // the aim freezes this long before the shot, so the player can read and dodge it
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (!e.data.strafe || Math.random() < dt * 0.6) e.data.strafe = Math.random() < 0.5 ? 1 : -1;
      if (d < e.cfg.range && d > 2.5 && e.atkCd <= 0) { e.windup(e.cfg.windup, { kind: 'line', len: Math.min(d + 1, 8), width: 0.12, angle: Math.atan2(dy, dx), track: true }); return; }
      let mx = 0, my = 0;
      if (d < 4.5) { mx = -dx; my = -dy; } else if (d > 7) { mx = dx; my = dy; }
      mx += -dy * e.data.strafe * 0.8; my += dx * e.data.strafe * 0.8;
      e.steer(mx, my, 0.9, dt);
    },
    strike: (e, g) => {
      // fly along the locked aim (no leading): exactly where the telegraph pointed
      const kind = e.cfg.proj || 'arrow', sp = PROJ_SPEED[kind] || 12;
      g.spawnProjectile({ owner: 'enemy', kind, x: e.x, y: e.y, z: 0.7, vx: e.faceX * sp, vy: e.faceY * sp, dmg: e.dmg, r: 0.18, life: 1.4, onHit: e.cfg.onHit });
      sfx.enemyShoot();
    },
  },
  blink: {
    init: (e) => { e.data.vanish = rand(2.5, 4.5); },
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      e.data.vanish -= dt;
      if (e.data.vanish <= 0 && d > 2) {
        e.state = 'vanish'; e.t = 0.45; e.hidden = true; e.vx = e.vy = 0;
        g.particles.burst(e.type === 'kitsune' ? 'glow' : 'smoke', e.x, e.y, 0.4, 8, 1.5, 0.5, e.type === 'kitsune' ? 3 : 7, SMOKE[e.type] || SMOKE.assassin);
        sfx.spawn(); return;
      }
      if (d < e.cfg.range * 0.9 && e.atkCd <= 0) { e.windup(e.cfg.windup, { kind: 'arc', range: e.cfg.range + 0.15, arc: 1.7, angle: Math.atan2(dy, dx) }); return; }
      const zig = Math.sin(g.time * 7 + e.seed) * 1.3;
      e.steer(dx - dy * zig, dy + dx * zig, 1, dt);
    },
    custom: (e, dt, g) => {
      if (e.state !== 'vanish') return;
      e.t -= dt;
      if (e.t <= 0) {
        const p = e.target;
        const a = Math.atan2(-p.aimY, -p.aimX) + rand(-1, 1);
        let nx = p.x + Math.cos(a) * 1.6, ny = p.y + Math.sin(a) * 1.6;
        if (g.world.blocked(nx, ny, 0.3)) { nx = e.x; ny = e.y; }
        e.x = nx; e.y = ny; e.hidden = false; e.state = 'chase'; e.data.vanish = rand(3, 5); e.atkCd = 0.45; // reaction window
        g.particles.burst(e.type === 'kitsune' ? 'glow' : 'smoke', e.x, e.y, 0.4, 8, 1.5, 0.5, e.type === 'kitsune' ? 3 : 7, SMOKE[e.type] || SMOKE.assassin);
      }
    },
    strike: (e, g) => {
      sfx.slash();
      const col = e.type === 'yukionna' ? 'rgba(200,240,255,0.8)' : e.type === 'kitsune' ? 'rgba(255,190,90,0.8)' : 'rgba(210,160,255,0.75)';
      g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), 0.8, 1.7, col, 7, 0.12);
      e.hurtPlayerIfIn(e.cfg.range, 1.8, e.dmg, 3);
    },
  },
  lob: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (d < e.cfg.range && d > 2 && e.atkCd <= 0) { e.windup(e.cfg.windup, null); return; }
      let mx = 0, my = 0;
      if (d < 5) { mx = -dx; my = -dy; } else if (d > 8) { mx = dx; my = dy; } else { mx = -dy * 0.5; my = dx * 0.5; }
      e.steer(mx, my, 0.8, dt);
    },
    strike: (e, g) => {
      const p = e.target;
      const tx = clamp(p.x + p.vx * 0.5, 1, g.world.N - 1), ty = clamp(p.y + p.vy * 0.5, 1, g.world.N - 1);
      g.spawnProjectile({ owner: 'enemy', kind: e.cfg.proj || 'bomb', lob: true, x: e.x, y: e.y, z: 0.9, sx: e.x, sy: e.y, tx, ty, T: 1.0, t: 0, dmg: e.dmg, r: 1.45, life: 2 });
      g.hazards.push({ kind: 'marker', x: tx, y: ty, r: 1.45, t: 1.0, dur: 1.0 });
      sfx.throwKnife();
    },
  },
  hopper: {
    init: (e) => { e.data.hop = rand(0.2, 0.6); },
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (d < e.cfg.range && e.atkCd <= 0) { e.windup(e.cfg.windup, { kind: 'arc', range: e.cfg.range + 0.2, arc: 1.6, angle: Math.atan2(dy, dx) }); return; }
      e.halt(dt, 6);
      e.data.hop -= dt;
      if (e.data.hop <= 0) {
        const a = Math.atan2(dy, dx) + rand(-1.3, 1.3);
        e.state = 'hop'; e.t = 0.32;
        const s = d < 2 ? 3 : 6.5; e.vx = Math.cos(a) * s; e.vy = Math.sin(a) * s;
        e.face(e.vx, e.vy);
      }
    },
    custom: (e, dt, g) => {
      if (e.state !== 'hop') return;
      e.t -= dt;
      e.z = Math.sin((1 - e.t / 0.32) * Math.PI) * 0.6;
      if (e.t <= 0) { e.z = 0; e.state = 'chase'; e.data.hop = rand(0.25, 0.7); g.particles.burst('dust', e.x, e.y, 0.05, 4, 1.2, 0.4, 3, '#c8b088', { under: true }); }
    },
    strike: (e) => { sfx.slash(); e.hurtPlayerIfIn(e.cfg.range, 1.8, e.dmg, 4); },
  },
  caster: {
    init: (e) => { e.data.blink = rand(3, 5); },
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      e.data.blink -= dt;
      if (e.data.blink <= 0) {
        const p = e.target, col = e.cfg.proj === 'soul' ? '#d09cff' : '#a0e0ff';
        for (let k = 0; k < 20; k++) {
          const a = rand(0, TAU), r = rand(5, 8);
          const nx = p.x + Math.cos(a) * r, ny = p.y + Math.sin(a) * r;
          if (!g.world.blocked(nx, ny, 0.4)) {
            g.particles.burst('glow', e.x, e.y, 0.6, 10, 2, 0.6, 2, col);
            e.x = nx; e.y = ny; e.data.blink = rand(4, 6);
            g.particles.burst('glow', e.x, e.y, 0.6, 10, 2, 0.6, 2, col);
            sfx.spawn();
            break;
          }
        }
        return;
      }
      if (d < e.cfg.range && e.atkCd <= 0) { e.windup(e.cfg.windup, null, 'cast'); return; }
      e.steer(d < 5 ? -dx : dx * 0.3 - dy, d < 5 ? -dy : dy * 0.3 + dx, 0.7, dt);
    },
    strike: (e, g) => {
      const lv = levelInBiome(g), n = lv >= 7 ? 3 : lv >= 4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const a = Math.atan2(e.faceY, e.faceX) + (k - (n - 1) / 2) * 0.6;
        g.spawnProjectile({ owner: 'enemy', kind: e.cfg.proj || 'orb', x: e.x, y: e.y, z: 0.9, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, dmg: e.dmg, r: 0.3, life: 5, homing: 1.8, speed: 4.2, seed: rand(0, 10) });
      }
      sfx.enemyShoot();
    },
  },
  charger: { // Oni Brute
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (e.atkCd <= 0 && d < 2.2) { e.windup(0.7, { kind: 'circle', x: e.x + dx * 1.2, y: e.y + dy * 1.2, r: 1.9 }, 'windup', 'slam'); return; }
      if (e.atkCd <= 0 && d < 7 && d > 3) { e.windup(0.75, { kind: 'line', len: 6, width: 1.1, angle: Math.atan2(dy, dx) }, 'windup', 'charge'); return; }
      e.steer(dx, dy, 1, dt);
    },
    strike: (e, g, next) => {
      if (next === 'slam') slamAt(g, e.x + e.faceX * 1.2, e.y + e.faceY * 1.2, 1.9, e.dmg, e);
      else { e.state = 'charge'; e.t = 0.6; e.data.hit = false; e.vx = e.faceX * 9; e.vy = e.faceY * 9; sfx.bossRoar(); }
    },
    custom: (e, dt, g) => {
      if (e.state !== 'charge') return;
      e.t -= dt;
      if (!e.data.hit && e.hurtInLane(1.2, e.dmg * 0.8, 9)) e.data.hit = true;
      if (Math.random() < 0.7) g.particles.emit('dust', e.x, e.y, 0.05, rand(-0.5, 0.5), rand(-0.5, 0.5), 0.3, 0.5, 5, '#c8b8a8', { under: true });
      if (e.t <= 0) { e.state = 'recover'; e.t = e.cfg.recover; e.vx *= 0.2; e.vy *= 0.2; }
    },
  },

  // ================================================================ shielded enemies
  // Fast shield charger: rushes in behind its shield; a charge that connects dazes the player.
  shieldCharger: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      const ang = Math.atan2(dy, dx);
      if (e.atkCd <= 0 && d < e.cfg.range * 1.1) { e.windup(0.4, { kind: 'arc', range: e.cfg.range + 0.2, arc: 1.7, angle: ang }, 'windup', 'bash'); return; }
      if (e.atkCd <= 0 && e.shield && e.shield.up && d > 2.2 && d < 6.5) { e.windup(e.cfg.windup, { kind: 'line', len: 5.6, width: 1.0, angle: ang }, 'windup', 'charge'); return; }
      let mx = dx, my = dy;
      if (d < 3) { const s = Math.sin(e.seed) > 0 ? 1 : -1; mx += -dy * 0.5 * s; my += dx * 0.5 * s; }
      e.steer(mx, my, d < e.cfg.range * 0.8 ? 0 : 1, dt);
    },
    strike: (e, g, next) => {
      if (next === 'charge') { e.state = 'charge'; e.t = 0.42; e.data.hit = false; e.vx = e.faceX * 12.5; e.vy = e.faceY * 12.5; sfx.dash(); return; }
      sfx.heavy();
      g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), e.cfg.range * 0.7, 1.6, 'rgba(255,230,190,0.7)', 9, 0.14);
      e.hurtPlayerIfIn(e.cfg.range + 0.1, 1.7, e.dmg, 6);
    },
    custom: (e, dt, g) => {
      if (e.state !== 'charge') return;
      e.t -= dt;
      if (!e.data.hit) {
        for (const p of g.players) {
          if (!p.active || Math.hypot(p.x - e.x, p.y - e.y) > 0.95 + p.r) continue;
          if (p.hurt(e.dmg, e.x, e.y, 8)) { e.data.hit = true; p.applyStun(PLAYER_STUN); sfx.clang(); if (e.cfg.onHit) p.applyChill(e.cfg.onHit.chill, e.cfg.onHit.dur); }
        }
      }
      if (Math.random() < 0.7) g.particles.emit('dust', e.x, e.y, 0.05, rand(-0.4, 0.4), rand(-0.4, 0.4), 0.3, 0.4, 4, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
      if (e.t <= 0 || e.data.hit || g.world.blocked(e.x + e.faceX * 0.7, e.y + e.faceY * 0.7, 0.15)) { e.state = 'recover'; e.t = e.cfg.recover; e.vx *= 0.15; e.vy *= 0.15; }
    },
  },
  // Slow shield tank: advances behind a big shield and bashes players back.
  shieldTank: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (e.atkCd <= 0 && d < e.cfg.range * 0.95) { e.windup(e.cfg.windup, { kind: 'cone', range: e.cfg.range + 0.3, arc: 1.9, angle: Math.atan2(dy, dx) }, 'windup', 'bash'); return; }
      e.steer(dx, dy, d < e.cfg.range * 0.6 ? 0 : 1, dt);
    },
    strike: (e, g) => {
      sfx.heavy(); g.shake(2);
      e.vx = e.faceX * 4; e.vy = e.faceY * 4; // step into the bash
      g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), e.cfg.range * 0.75, 1.9, 'rgba(255,240,210,0.75)', 13, 0.18);
      g.particles.burst('dust', e.x + e.faceX, e.y + e.faceY, 0.05, 6, 2, 0.5, 4, g.world.bi === 2 ? '#f4f8ff' : '#c8b088', { under: true });
      e.hurtPlayerIfIn(e.cfg.range + 0.3, 1.9, e.dmg, 10);
    },
  },

  // ================================================================ heavy ability enemies
  // Sumo Brute: a belly charge down the red lane, then a stomp inside the telegraphed circle.
  // The charge only hits what is in front of him inside that lane (never beside or behind him),
  // and the lane is exactly as long as the charge travels.
  sumo: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      const S = SUMO, len = S.speed * S.dur + e.r + PLAYER_BASE.radius; // how far his belly reaches a player's body
      if (e.atkCd <= 0 && d < len) { e.windup(e.cfg.windup, { kind: 'line', len, width: S.width, angle: Math.atan2(dy, dx) }, 'windup', 'charge'); return; }
      e.steer(dx, dy, 1, dt);
    },
    strike: (e, g, next) => {
      const S = SUMO;
      if (next === 'charge') { e.state = 'charge'; e.t = S.dur; e.data.hit = false; e.data.dir = [e.faceX, e.faceY]; e.vx = e.faceX * S.speed; e.vy = e.faceY * S.speed; sfx.heavy(); }
      else if (next === 'stomp') {
        slamAt(g, e.x, e.y, S.stompR, e.dmg, e);
        e.t = 0.9;
      }
    },
    custom: (e, dt, g) => {
      if (e.state !== 'charge') return;
      const S = SUMO, [fx, fy] = e.data.dir || [e.faceX, e.faceY];
      e.t -= dt;
      if (!e.data.hit) for (const p of g.players) { // in front of his belly, inside the lane
        if (!p.active) continue;
        const dx = p.x - e.x, dy = p.y - e.y, along = dx * fx + dy * fy, side = Math.abs(dx * fy - dy * fx);
        const L = e.lane, inLane = !L || (() => { const ox = p.x - L.ox, oy = p.y - L.oy, al = ox * L.fx + oy * L.fy; return al > -0.3 && al < L.len + 0.2 && Math.abs(ox * L.fy - oy * L.fx) < L.width / 2 + p.r * 0.6; })();
        if (inLane && along > -e.r && along < e.r + p.r + 0.15 && side < S.width / 2 + p.r * 0.6 && p.hurt(e.dmg * S.chargeMul, e.x, e.y, 12)) { e.data.hit = true; if (e.cfg.onHit) p.applyChill(e.cfg.onHit.chill, e.cfg.onHit.dur); }
      }
      if (Math.random() < 0.7) g.particles.emit('dust', e.x, e.y, 0.05, rand(-0.5, 0.5), rand(-0.5, 0.5), 0.3, 0.5, 5, '#c8b088', { under: true });
      if (e.t <= 0) { e.vx *= 0.2; e.vy *= 0.2; e.windup(S.stompWindup, { kind: 'circle', x: e.x, y: e.y, r: S.stompR }, 'windup', 'stomp'); }
    },
  },
  // Armored Samurai: two-hit iaido combo, the second cut dashes forward
  samurai: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (e.atkCd <= 0 && d < 3.4) { e.windup(e.cfg.windup, { kind: 'cone', range: 3.0, arc: 2.4, angle: Math.atan2(dy, dx) }, 'windup', 'cut1'); return; }
      e.steer(dx, dy, 1, dt);
    },
    strike: (e, g, next) => {
      if (next === 'cut1') {
        sfx.heavy(); g.shake(3);
        g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), 2.2, 2.4, 'rgba(200,220,255,0.85)', 14, 0.2);
        e.hurtPlayerIfIn(3.0, 2.4, e.dmg * 0.7, 6);
        const [dx, dy] = e.toPlayer(); e.face(dx, dy);
        e.windup(0.42, { kind: 'line', len: 4.2, width: 1.2, angle: Math.atan2(dy, dx) }, 'windup', 'cut2');
      } else if (next === 'cut2') {
        e.state = 'iaido'; e.t = 0.2; e.data.hit = false; e.vx = e.faceX * 16; e.vy = e.faceY * 16; sfx.slash(); sfx.dash();
      }
    },
    custom: (e, dt, g) => {
      if (e.state !== 'iaido') return;
      e.t -= dt;
      if (!e.data.hit && e.hurtInLane(1.4, e.dmg, 9)) e.data.hit = true;
      if (Math.random() < 0.8) g.particles.emit('ink', e.x, e.y, 0.8, 0, 0, 0, 0.3, 5, 'rgba(30,40,70,0.6)');
      if (e.t <= 0) { e.vx *= 0.1; e.vy *= 0.1; g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), 1.6, 3.2, 'rgba(220,235,255,0.9)', 16, 0.22); e.state = 'recover'; e.t = 1.0; }
    },
  },
  // Boar Spirit: long-warned charge with huge knockback; stunned if it slams into a wall
  boar: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (e.atkCd <= 0 && d < 10) {
        e.windup(e.cfg.windup, { kind: 'line', len: 10, width: 1.3, angle: Math.atan2(dy, dx) }, 'windup', 'charge');
        sfx.bossRoar(); return;
      }
      e.steer(d < 4 ? -dx : dx, d < 4 ? -dy : dy, 0.8, dt);
    },
    strike: (e) => { e.state = 'charge'; e.t = 1.0; e.data.hit = false; e.vx = e.faceX * 11; e.vy = e.faceY * 11; sfx.dash(); },
    custom: (e, dt, g) => {
      if (e.state === 'charge') {
        e.t -= dt;
        if (!e.data.hit && e.hurtInLane(1.4, e.dmg, 13)) e.data.hit = true;
        if (Math.random() < 0.8) g.particles.emit('dust', e.x, e.y, 0.05, rand(-0.6, 0.6), rand(-0.6, 0.6), 0.4, 0.5, 6, '#b8a070', { under: true });
        if (g.world.blocked(e.x + e.faceX * 0.9, e.y + e.faceY * 0.9, 0.2)) {
          e.state = 'stunned'; e.t = 1.6; e.vx = e.vy = 0;
          sfx.slam(); g.shake(6);
          g.particles.burst('shard', e.x + e.faceX * 0.8, e.y + e.faceY * 0.8, 0.5, 10, 4, 0.6, 3, '#8a7a60', { grav: 18, bounce: true });
        } else if (e.t <= 0) { e.state = 'recover'; e.t = e.cfg.recover; e.vx *= 0.2; e.vy *= 0.2; }
      } else if (e.state === 'stunned') {
        e.t -= dt; e.halt(dt);
        if (e.t <= 0) { e.state = 'chase'; e.atkCd = e.cfg.cooldown; }
      }
    },
  },
  // Komainu: leaps onto your position, landing in a quake ring
  komainu: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (e.atkCd <= 0 && d < 8) { e.windup(e.cfg.windup, null, 'windup', 'leap'); return; }
      e.steer(dx, dy, 1, dt);
    },
    strike: (e, g) => {
      const p = e.target;
      const tx = clamp(p.x + p.vx * 0.3, 1, g.world.N - 1), ty = clamp(p.y + p.vy * 0.3, 1, g.world.N - 1);
      e.state = 'leap'; e.t = 0; e.data.dur = 0.85; e.data.sx = e.x; e.data.sy = e.y; e.data.tx = tx; e.data.ty = ty;
      e.tele = { kind: 'circle', x: tx, y: ty, r: 2.2, k: 0 }; e.flying = true; e.vx = e.vy = 0; sfx.dash();
    },
    custom: (e, dt, g) => {
      if (e.state !== 'leap') return;
      e.t += dt;
      const k = Math.min(1, e.t / e.data.dur);
      e.x = lerp(e.data.sx, e.data.tx, k); e.y = lerp(e.data.sy, e.data.ty, k); e.z = Math.sin(k * Math.PI) * 2.6;
      e.tele.k = k;
      if (k >= 1) {
        e.z = 0; e.tele = null; e.flying = false;
        slamAt(g, e.x, e.y, 2.2, e.dmg, e);
        ringHazard(g, e.x, e.y, 4.6, Math.round(e.dmg * 0.5), 7);
        e.state = 'recover'; e.t = e.cfg.recover;
      }
    },
  },
  // Gashadokuro: three alternating giant hand-slams on your position
  gasha: {
    init: (e) => { e.data.hand = 1; },
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (e.atkCd <= 0 && d < e.cfg.range) { e.data.slams = 3; gashaWind(e, e.cfg.windup); return; }
      e.steer(dx, dy, 1, dt);
    },
    strike: (e, g) => {
      slamAt(g, e.data.sx, e.data.sy, 1.9, e.dmg, e);
      g.particles.burst('shard', e.data.sx, e.data.sy, 0.2, 8, 4, 0.6, 3, '#e8e2cc', { grav: 18, bounce: true });
      e.data.slams--;
      if (e.data.slams > 0) gashaWind(e, 0.55); else e.t = 1.3;
    },
  },
  // Frost Oni: freezing breath cone (slows) and a close-range club slam
  frostoni: {
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (e.atkCd <= 0 && d < 2.2) { e.windup(0.6, { kind: 'circle', x: e.x + dx * 1.2, y: e.y + dy * 1.2, r: 1.9 }, 'windup', 'slam'); return; }
      if (e.atkCd <= 0 && d < e.cfg.range + 0.5) { e.windup(e.cfg.windup, { kind: 'cone', range: 5.5, arc: 1.1, angle: Math.atan2(dy, dx) }, 'cast', 'breath'); return; }
      e.steer(dx, dy, 1, dt);
    },
    strike: (e, g, next) => {
      if (next === 'slam') {
        const x = e.x + e.faceX * 1.2, y = e.y + e.faceY * 1.2;
        slamAt(g, x, y, 1.9, e.dmg, e);
        for (const p of g.players) if (!p.dead && Math.hypot(p.x - x, p.y - y) < 2.2) p.applyChill(0.4, 1.5);
      } else { e.state = 'breath'; e.t = 0.6; e.data.hitSet = new Set(); sfx.dash(); }
    },
    custom: (e, dt, g) => {
      if (e.state !== 'breath') return;
      e.t -= dt; e.halt(dt);
      const base = Math.atan2(e.faceY, e.faceX);
      for (let k = 0; k < 3; k++) { const a = base + rand(-0.5, 0.5), s = rand(5, 9); g.particles.emit('dot', e.x, e.y, 1.2, Math.cos(a) * s, Math.sin(a) * s, 0, 0.5, 2.4, Math.random() < 0.5 ? '#e8f8ff' : '#9ee4ff', { drag: 1 }); }
      for (const p of g.players) {
        if (p.dead || e.data.hitSet.has(p)) continue;
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
        if (d < 5.5 && Math.abs(angDiff(base, Math.atan2(dy, dx))) < 0.55 && p.hurt(e.dmg, e.x, e.y, 4)) { p.applyChill(e.cfg.onHit.chill, e.cfg.onHit.dur); e.data.hitSet.add(p); }
      }
      if (e.t <= 0) { e.state = 'recover'; e.t = e.cfg.recover; }
    },
  },

  // ================================================================ BOSS: Ronin Warlord
  ronin_boss: {
    init: (e) => { e.data.summonCd = 5; e.data.whirlCd = 7; e.speed = 2.9; },
    onSpawn: (e, g) => { sfx.bossRoar(); g.shake(8); },
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      if (e.phase === 1 && e.hp < e.hpMax * 0.5) { e.phase = 2; e.speed = 3.5; sfx.bossRoar(); g.shake(10); g.bossPhase(e, 'The Warlord rages!'); e.data.summonCd = Math.min(e.data.summonCd, 1.5); }
      e.data.summonCd -= dt; e.data.whirlCd -= dt;
      const p2 = e.phase === 2;
      // the great whirl: a long, slow wind-up and a huge circle of steel; get out or pay dearly
      if (e.atkCd <= 0 && e.data.whirlCd <= 0 && d < 5.5) {
        e.data.whirlCd = p2 ? 9 : 12;
        e.windup(p2 ? 1.15 : 1.4, { kind: 'circle', x: e.x, y: e.y, r: 5 }, 'iaiCrouch', 'whirl'); sfx.bossRoar(); return;
      }
      const adds = g.enemies.filter((x) => !x.dead && !x.boss).length;
      if (e.data.summonCd <= 0 && adds < (p2 ? 6 : 4)) { e.state = 'summon'; e.t = 0.9; e.data.summonCd = p2 ? 12 : 14; e.vx = e.vy = 0; return; }
      if (e.atkCd <= 0) {
        if (d < 2.8 && Math.random() < 0.35) { e.data.combo = p2 ? 2 : 1; startRoninDash(e); return; } // close in: sometimes he dashes through you
        if (d < 2.8) { e.windup(p2 ? 0.42 : 0.55, { kind: 'arc', range: 3.0, arc: 3.8, angle: Math.atan2(dy, dx) }, 'windup', 'sweep'); return; }
        if (d < 9) { e.data.combo = p2 ? 4 : 3; startRoninDash(e); return; }
      }
      e.steer(dx, dy, 1, dt);
    },
    strike: (e, g, next) => {
      if (next === 'sweep') {
        sfx.heavy(); g.shake(4);
        g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), 2.4, 3.8, 'rgba(255,220,200,0.85)', 16, 0.22);
        e.hurtPlayerIfIn(3.0, 3.8, BOSS_DMG.ronin_boss.sweep, 7);
        e.t = 0.55;
      } else if (next === 'whirl') {
        sfx.heavy(); sfx.slam(); g.shake(12); g.hitstop(0.06);
        for (let k = 0; k < 3; k++) g.fx.slash(e.x, e.y, k * 2.1, 4.6, 2.3, 'rgba(255,210,190,0.9)', 22, 0.3);
        g.fx.ring(e.x, e.y, 5, 'rgba(255,200,170,0.9)', 0.45, 7);
        for (const p of g.players) if (p.active && Math.hypot(p.x - e.x, p.y - e.y) < 5 + p.r * 0.5) p.hurt(BOSS_DMG.ronin_boss.whirl, e.x, e.y, 12);
        e.t = 0.9;
      } else if (next === 'dash') {
        e.state = 'dash'; e.t = 0.24; e.data.hit = false;
        e.vx = e.faceX * 19; e.vy = e.faceY * 19; sfx.dash();
      }
    },
    custom: (e, dt, g) => {
      if (e.state === 'dash') {
        e.t -= dt;
        if (!e.data.hit && e.hurtInLane(1.3, BOSS_DMG.ronin_boss.dash, 6)) e.data.hit = true;
        if (Math.random() < 0.8) g.particles.emit('ink', e.x, e.y, 0.8, 0, 0, 0, 0.35, 6, 'rgba(40,20,30,0.6)');
        if (e.t <= 0) {
          e.vx *= 0.1; e.vy *= 0.1;
          e.data.combo--;
          if (e.data.combo > 0) startRoninDash(e); else { e.state = 'recover'; e.t = 0.7; }
        }
      } else if (e.state === 'summon') {
        e.t -= dt;
        if (Math.random() < 0.5) g.particles.emit('smoke', e.x + rand(-1, 1), e.y + rand(-1, 1), 0.2, 0, 0, 0.6, 0.8, 8, 'rgba(60,40,50,1)');
        if (e.t <= 0) {
          // his ronin band: soldiers of the area throughout; once he rages, a brute or armoured samurai with them
          const heavyIn = g.enemies.filter((x) => !x.dead && !x.boss && x.cfg.heavy).length;
          const band = [pick(KURO_ADDS), pick(KURO_ADDS)];
          if (e.phase === 2 && heavyIn < 2) band.push(pick(KURO_HEAVY)); else if (e.phase === 2) band.push(pick(KURO_ADDS));
          band.forEach((type, k) => {
            const a = (k / band.length) * TAU + rand(-0.3, 0.3);
            let x = e.x + Math.cos(a) * 2, y = e.y + Math.sin(a) * 2;
            if (g.world.blocked(x, y, 0.4)) [x, y] = g.world.randomFreePoint(e.target.x, e.target.y, 3);
            g.addEnemy(new Enemy(g, type, x, y, g.level));
          });
          e.state = 'recover'; e.t = 0.4; sfx.bossRoar();
        }
      }
    },
  },

  // ================================================================ BOSS: Tengu
  // Spread shot: aim locks at the start of a long wind-up and red lanes show every feather's path,
  // with a safe gap lane in each fan. Each volley shows its lanes before it fires.
  tengu: {
    init: (e) => { e.flying = true; e.z = 0.7; e.speed = 4; e.data.orbit = 0; },
    onSpawn: (e, g) => { sfx.bossRoar(); g.shake(6); },
    think: (e, dt, g) => {
      const p = e.target;
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      e.z = lerp(e.z, 0.8 + Math.sin(g.time * 2.2) * 0.2, 1 - Math.exp(-4 * dt));
      if (e.phase === 1 && e.hp < e.hpMax * 0.5) { e.phase = 2; e.speed = 5; sfx.bossRoar(); g.shake(8); g.bossPhase(e, 'The Tengu summons the storm!'); }
      e.data.orbit += dt * (e.phase === 2 ? 0.9 : 0.6);
      const tx = p.x + Math.cos(e.data.orbit) * 4.5, ty = p.y + Math.sin(e.data.orbit) * 4.5;
      e.steer(tx - e.x, ty - e.y, Math.min(1, Math.hypot(tx - e.x, ty - e.y) / 2), dt);
      if (e.atkCd <= 0) {
        const r = Math.random();
        if (r < 0.42) {
          e.data.fan = tenguFan(e, Math.atan2(dy, dx), 0);
          e.windup(0.9, { kind: 'fan', angles: e.data.fan, len: 7.5, width: 0.26 }, 'cast', 'volley');
        } else if (r < 0.72 && d < 6) { e.windup(0.7, { kind: 'cone', range: 6.5, arc: 1.25, angle: Math.atan2(dy, dx), track: true }, 'cast', 'gust'); }
        else { e.state = 'rise'; e.t = 0.5; e.vx = e.vy = 0; sfx.dash(); }
      }
    },
    trackDuringWindup: true,
    strike: (e, g, next) => {
      if (next === 'volley') {
        fireFan(e, g, e.data.fan);
        const base = e.data.fanBase;
        e.data.fan = tenguFan(e, base, 0.5); // second volley: shifted by half a lane
        e.state = 'volley'; e.t = 0; e.tele = { kind: 'fan', angles: e.data.fan, len: 7.5, width: 0.26, k: 0 };
      } else if (next === 'gust') {
        sfx.dash(); sfx.heavy();
        for (let k = 0; k < 24; k++) {
          const a = Math.atan2(e.faceY, e.faceX) + rand(-0.6, 0.6), s = rand(6, 12);
          g.particles.emit('leaf', e.x, e.y, 0.8, Math.cos(a) * s, Math.sin(a) * s, rand(-0.5, 0.5), 0.8, 3, pick(['#e0542c', '#f09a34', '#ffffff']), { drag: 1.2 });
        }
        e.hurtPlayerIfIn(6.5, 1.3, BOSS_DMG.tengu.gust, 0);
        for (const p of g.players) {
          if (p.dead) continue;
          const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
          if (d < 6.5 && Math.abs(angDiff(Math.atan2(e.faceY, e.faceX), Math.atan2(dy, dx))) < 0.65) { p.kvx += e.faceX * 12; p.kvy += e.faceY * 12; }
        }
      }
    },
    custom: (e, dt, g) => {
      const p = e.target;
      if (e.state === 'volley') {
        e.t += dt; e.halt(dt);
        const show = 0.55;
        e.tele.k = Math.min(1, e.t / show);
        if (e.t >= show) { fireFan(e, g, e.data.fan); e.tele = null; e.state = 'recover'; e.t = 0.6; }
      } else if (e.state === 'rise') {
        e.t -= dt; e.z += dt * 9; e.halt(dt);
        e.alpha = clamp(e.t / 0.5, 0.15, 1);
        if (e.t <= 0) { e.state = 'mark'; e.t = e.phase === 2 ? 0.8 : 1.0; e.data.mx = p.x; e.data.my = p.y; e.hidden = true; e.tele = { kind: 'circle', x: p.x, y: p.y, r: 1.8, k: 0 }; }
      } else if (e.state === 'mark') {
        e.t -= dt;
        if (e.t > 0.35) { e.data.mx = lerp(e.data.mx, p.x, 1 - Math.exp(-6 * dt)); e.data.my = lerp(e.data.my, p.y, 1 - Math.exp(-6 * dt)); }
        e.tele.x = e.data.mx; e.tele.y = e.data.my; e.tele.k = 1 - Math.max(0, e.t) / 1.0;
        if (e.t <= 0) { e.state = 'dive'; e.t = 0.18; e.x = e.data.mx; e.y = e.data.my; e.hidden = false; e.z = 4; e.alpha = 1; }
      } else if (e.state === 'dive') {
        e.t -= dt; e.z = Math.max(0, (e.t / 0.18) * 4);
        if (e.t <= 0) {
          e.tele = null; e.z = 0;
          slamAt(g, e.x, e.y, 1.8, BOSS_DMG.tengu.dive, e);
          if (e.phase === 2) for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; g.spawnProjectile({ owner: 'enemy', kind: 'feather', x: e.x, y: e.y, z: 0.6, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, dmg: Math.round(BOSS_DMG.tengu.feather * 0.7), r: 0.18, life: 2 }); }
          e.state = 'recover'; e.t = 0.8;
        }
      }
    },
  },

  // ================================================================ BOSS: Oni Lord
  oni_lord: {
    init: (e) => { e.speed = 1.7; },
    onSpawn: (e, g) => { sfx.bossRoar(); g.shake(14); },
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      const hpk = e.hp / e.hpMax;
      if (e.phase === 1 && hpk < 0.66) { e.phase = 2; sfx.bossRoar(); g.shake(10); g.bossPhase(e, 'Shuten stokes the hellfire!'); }
      if (e.phase === 2 && hpk < 0.33) { e.phase = 3; e.speed = 2.4; sfx.bossRoar(); g.shake(14); g.bossPhase(e, 'Shuten is ENRAGED!'); }
      const wk = e.phase === 3 ? 0.75 : 1;
      if (e.phase === 3 && Math.random() < dt * 4) g.particles.emit('ember', e.x + rand(-1, 1), e.y + rand(-1, 1), rand(0.5, 3), rand(-0.5, 0.5), rand(-0.5, 0.5), rand(1, 2), 0.8, 2, '#ff6a20');
      if (e.atkCd <= 0) {
        const r = Math.random();
        if (d < 3.4 && r < 0.55) { e.windup(0.85 * wk, { kind: 'circle', x: e.x + dx * 2, y: e.y + dy * 2, r: 2.3 }, 'windup', 'slam'); return; }
        if (d < 3.4) { e.windup(0.6 * wk, { kind: 'circle', x: e.x, y: e.y, r: 4.5 }, 'windup', 'stomp'); return; }
        if (e.phase === 3 && r < 0.4) { e.windup(0.6, { kind: 'line', len: 8, width: 1.6, angle: Math.atan2(dy, dx) }, 'windup', 'charge'); return; }
        e.windup(0.9 * wk, null, 'windup', 'firewave'); return;
      }
      e.steer(dx, dy, 1, dt);
    },
    strike: (e, g, next) => {
      const D = BOSS_DMG.oni_lord;
      if (next === 'slam') {
        slamAt(g, e.x + e.faceX * 2, e.y + e.faceY * 2, 2.3, D.slam, e);
        if (e.phase >= 2) g.hazards.push({ kind: 'fire', x: e.x + e.faceX * 2, y: e.y + e.faceY * 2, r: 1.4, life: 4, tick: 0, dmg: D.fire });
        e.t = 1.0 / (e.phase === 3 ? 1.4 : 1);
      } else if (next === 'stomp') {
        sfx.slam(); g.shake(9);
        g.hazards.push({ kind: 'ring', x: e.x, y: e.y, rad: 0.5, speed: 9, max: 4.5, width: 0.5, dmg: D.stomp, hit: false, gap: null });
        e.t = 0.8;
      } else if (next === 'firewave') {
        const n = e.phase;
        sfx.bossRoar();
        for (let k = 0; k < n; k++) {
          g.later(k * 0.55, () => {
            if (e.dead) return;
            sfx.explode(); g.shake(5);
            g.hazards.push({ kind: 'ring', x: e.x, y: e.y, rad: 0.8, speed: 4.6, max: 14, width: 0.45, dmg: D.wave, hit: false, gap: rand(0, TAU), gapW: 0.7, fire: true });
          });
        }
        e.t = 0.6 + n * 0.55;
      } else if (next === 'charge') {
        e.state = 'charge'; e.t = 0.75; e.data.hit = false; e.vx = e.faceX * 11; e.vy = e.faceY * 11; e.data.trail = 0;
      }
    },
    custom: (e, dt, g) => {
      if (e.state !== 'charge') return;
      e.t -= dt; e.data.trail -= dt;
      if (!e.data.hit && e.hurtInLane(1.6, BOSS_DMG.oni_lord.charge, 10)) e.data.hit = true;
      if (e.data.trail <= 0) { e.data.trail = 0.12; g.hazards.push({ kind: 'fire', x: e.x, y: e.y, r: 0.8, life: 3, tick: 0, dmg: BOSS_DMG.oni_lord.fire }); }
      if (e.t <= 0) { e.state = 'recover'; e.t = 0.9; e.vx *= 0.1; e.vy *= 0.1; }
    },
  },

  // ================================================================ FINAL BOSS: Regent Gensai
  // Charged sword arts (iaijutsu flash, crescent blades), shadow seals, mirage dashes, and his guard.
  // While four or more guards stand he is "guarded" and takes far less damage.
  gensai: {
    trackDuringWindup: true,
    lockBefore: 0.4, // the iai lane stops following you shortly before he cuts
    init: (e) => { e.speed = 3.0; e.data.summonCd = 4; e.data.seq = 0; },
    onSpawn: (e, g) => { sfx.bossRoar(); g.shake(10); },
    think: (e, dt, g) => {
      const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
      const hpk = e.hp / e.hpMax;
      if (e.phase === 1 && hpk < 0.66) { e.phase = 2; e.speed = 3.4; sfx.iai(); g.shake(10); g.flashScreen('rgba(200,20,40,0.35)'); g.bossPhase(e, 'Gensai draws his true blade!'); e.data.summonCd = Math.min(e.data.summonCd, 1); }
      if (e.phase === 2 && hpk < 0.33) { e.phase = 3; e.speed = 3.8; sfx.bossRoar(); g.shake(14); g.flashScreen('rgba(200,20,40,0.45)'); g.bossPhase(e, 'The regent is desperate!'); e.data.summonCd = Math.min(e.data.summonCd, 1); }
      const guards = g.enemies.filter((o) => !o.dead && !o.boss).length;
      e.guarded = guards >= 4;
      e.data.summonCd -= dt;
      const wk = e.phase === 3 ? 0.78 : e.phase === 2 ? 0.9 : 1;
      if (e.data.summonCd <= 0 && guards < 8) { e.state = 'summon'; e.t = 1.1; e.vx = e.vy = 0; e.data.summonCd = [0, 13, 11, 9][e.phase]; sfx.horn(); g.banner({ title: 'Gensai calls his guard!', dur: 1.4, y: 0.22, size: 22, color: 'rgba(90,10,10,0.8)' }); return; }
      if (e.atkCd <= 0) {
        const a = Math.atan2(dy, dx);
        if (d < 2.3 && Math.random() < 0.6) { e.windup(0.42 * wk, { kind: 'arc', range: 2.7, arc: 2.7, angle: a }, 'windup', 'slash'); return; }
        // cycle through his arts so each fight shows all of them
        const arts = e.phase === 1 ? ['iai', 'crescent', 'seals', 'iai'] : ['iai', 'mirage', 'crescent', 'seals', 'iai', 'mirage'];
        const art = arts[e.data.seq++ % arts.length];
        if (art === 'iai') { const len = clamp(d + 2.2, 5, 9.5); e.windup(1.1 * wk, { kind: 'line', len, width: 0.85, angle: a, track: true }, 'iaiCrouch', 'iai'); sfx.iai(); return; }
        if (art === 'crescent') { e.windup(0.95 * wk, { kind: 'circle', x: e.x, y: e.y, r: 1.4 }, 'cast', 'crescent'); return; }
        if (art === 'seals') { e.windup(0.55, null, 'cast', 'seals'); return; }
        if (art === 'mirage') { const spread = 0.55; e.data.lanes = [a - spread, a, a + spread]; e.windup(0.85 * wk, { kind: 'fan', len: 8.5, width: 0.7, angles: e.data.lanes }, 'iaiCrouch', 'mirage'); return; }
      }
      // keep a duelling distance: close in when far, circle when near
      const s = Math.sin(g.time * 0.7 + e.seed) > 0 ? 1 : -1;
      if (d > 4) e.steer(dx, dy, 1, dt); else e.steer(-dy * s + dx * 0.2, dx * s + dy * 0.2, 0.7, dt);
    },
    strike: (e, g, next) => {
      const D = BOSS_DMG.gensai;
      if (next === 'slash') {
        sfx.slash(); sfx.heavy(); g.shake(3);
        g.fx.slash(e.x, e.y, slashA(e.faceX, e.faceY), 2.2, 2.7, 'rgba(255,200,200,0.9)', 16, 0.2);
        e.hurtPlayerIfIn(2.7, 2.7, D.slash, 7);
        e.t = 0.45;
      } else if (next === 'iai') {
        // blink to the end of the lane; the cut lands a moment later along the whole path
        const len = (e.lastTele && e.lastTele.len) || 7, x0 = e.x, y0 = e.y;
        let x1 = x0 + e.faceX * len, y1 = y0 + e.faceY * len;
        for (let k = 0; k < 20 && g.world.blocked(x1, y1, e.r); k++) { x1 -= e.faceX * 0.4; y1 -= e.faceY * 0.4; }
        e.x = x1; e.y = y1;
        g.hazards.push({ kind: 'slash', x0, y0, x1, y1, t: 0.16, dur: 0.16, dmg: D.iai, w: 0.75 });
        g.particles.burst('ink', x0, y0, 0.7, 14, 3, 0.6, 5, 'rgba(30,10,20,0.8)');
        for (let k = 0; k <= 10; k++) g.particles.emit('glow', lerp(x0, x1, k / 10), lerp(y0, y1, k / 10), 0.8, 0, 0, 0.5, 0.4, 2.4, '#ff8a9a');
        sfx.dash(); g.flashScreen('rgba(255,255,255,0.35)');
        if (e.phase === 3 && !e.data.chained) { // a second, faster flash straight after
          e.data.chained = true;
          const [dx, dy, d] = e.toPlayer(); e.face(dx, dy);
          e.windup(0.55, { kind: 'line', len: clamp(d + 2, 4, 9), width: 0.85, angle: Math.atan2(dy, dx), track: true }, 'iaiCrouch', 'iai');
          return;
        }
        e.data.chained = false;
        e.t = 0.8;
      } else if (next === 'crescent') {
        const n = e.phase === 1 ? 3 : e.phase === 2 ? 4 : 5;
        const base = Math.atan2(e.faceY, e.faceX);
        for (let k = 0; k < n; k++) {
          const a = base + (k - (n - 1) / 2) * (1.2 / Math.max(1, n - 1)) * 1.4;
          g.spawnProjectile({ owner: 'enemy', kind: 'crescent', x: e.x, y: e.y, z: 0.7, vx: Math.cos(a) * 11, vy: Math.sin(a) * 11, dmg: BOSS_DMG.gensai.crescent, r: 0.42, life: 3.2, boomer: { owner: e, t: 0, out: 0.75 } });
        }
        sfx.iaiCut(); g.shake(4);
        g.fx.ring(e.x, e.y, 1.6, 'rgba(255,120,140,0.9)', 0.35, 6);
        e.t = 0.7;
      } else if (next === 'seals') {
        const spots = [];
        for (const p of g.players) if (p.active) spots.push([p.x, p.y]);
        const extra = e.phase === 1 ? 3 : e.phase === 2 ? 5 : 7;
        for (let k = 0; k < extra; k++) { const p = e.target, a = rand(0, TAU), r = rand(1.5, 4.5); spots.push([p.x + Math.cos(a) * r, p.y + Math.sin(a) * r]); }
        spots.forEach(([x, y], i) => g.hazards.push({ kind: 'seal', x, y, r: 1.25, t: 1.0 + i * 0.16, dur: 1.0 + i * 0.16, dmg: D.seal }));
        sfx.seal();
        e.t = 0.5;
      } else if (next === 'mirage') {
        // two shadow clones dash down two lanes; the real regent takes the third
        const lanes = (e.data.lanes || [0]).slice();
        const real = Math.floor(rand(0, lanes.length));
        lanes.forEach((a, i) => {
          if (i === real) return;
          g.hazards.push({ kind: 'mirage', x: e.x, y: e.y, vx: Math.cos(a) * 17, vy: Math.sin(a) * 17, t: 0.42, dmg: D.mirage, fx: Math.cos(a), fy: Math.sin(a) });
        });
        const a = lanes[real];
        e.face(Math.cos(a), Math.sin(a));
        e.state = 'gdash'; e.t = 0.42; e.data.hit = false; e.vx = Math.cos(a) * 17; e.vy = Math.sin(a) * 17;
        sfx.iaiCut(); sfx.dash();
      }
    },
    custom: (e, dt, g) => {
      if (e.state === 'gdash') {
        e.t -= dt;
        if (!e.data.hit && e.hurtInLane(1.2, BOSS_DMG.gensai.mirage, 8)) e.data.hit = true;
        if (Math.random() < 0.9) g.particles.emit('ink', e.x, e.y, 0.8, 0, 0, 0, 0.35, 6, 'rgba(120,10,30,0.6)');
        if (e.t <= 0) { e.vx *= 0.1; e.vy *= 0.1; e.state = 'recover'; e.t = 0.6; }
      } else if (e.state === 'summon') {
        e.t -= dt;
        if (Math.random() < 0.6) g.particles.emit('glow', e.x + rand(-1, 1), e.y + rand(-1, 1), rand(0.2, 1.6), 0, 0, 1, 0.6, 2.2, '#ffcf6a');
        if (e.t <= 0) {
          const alive = g.enemies.filter((o) => !o.dead && !o.boss).length;
          const n = Math.min([0, 3, 4, 5][e.phase] + (g.players.length > 1 ? 1 : 0), 9 - alive);
          for (let k = 0; k < n; k++) g.later(k * 0.25, () => { if (!e.dead) g.spawnEnemy(pick(GENSAI_GUARD)); });
          e.state = 'recover'; e.t = 0.5;
        }
      }
    },
  },
};

function startRoninDash(e) {
  const [dx, dy] = e.toPlayer(); e.face(dx, dy);
  e.windup(e.phase === 2 ? 0.26 : 0.38, { kind: 'line', len: 4.6, width: 0.9, angle: Math.atan2(dy, dx) }, 'windup', 'dash');
}

function gashaWind(e, dur) {
  const p = e.target;
  e.data.hand = -e.data.hand;
  e.data.sx = p.x; e.data.sy = p.y;
  e.windup(dur, { kind: 'circle', x: p.x, y: p.y, r: 1.9 }, 'windup', 'slam');
}

// Tengu feather fan: n lanes across the spread minus two neighbouring lanes (the safe gap)
function tenguFan(e, base, shift) {
  e.data.fanBase = base;
  const n = e.phase === 2 ? 11 : 9, spread = 1.6;
  const step = spread / (n - 1);
  const gap = 1 + Math.floor(Math.random() * (n - 3));
  const out = [];
  for (let k = 0; k < n; k++) { if (k === gap || k === gap + 1) continue; out.push(base - spread / 2 + k * step + shift * step); }
  return out;
}
function fireFan(e, g, angles) {
  for (const a of angles) g.spawnProjectile({ owner: 'enemy', kind: 'feather', x: e.x, y: e.y, z: e.z + 0.6, vx: Math.cos(a) * 7.5, vy: Math.sin(a) * 7.5, dmg: BOSS_DMG.tengu.feather, r: 0.18, life: 2.2 });
  sfx.throwKnife();
}

// ================================================================ looks
// Each returns options for drawHumanoid (or a custom `draw`), plus `h` = height for the HP bar.
const P = {
  bandit: { skin: '#e2b48c', cloth: '#7a5a3a', cloth2: '#4e3a28', sash: '#2a2a2a', hair: '#1a1414', accent: '#b03030', metal: '#d8dee6', wood: '#5a3a20' },
  spear: { skin: '#e2b48c', cloth: '#3a4a6a', cloth2: '#26324a', sash: '#b8a070', hat: '#2a2a30', accent: '#c33', metal: '#e0e6ee', wood: '#5a3a20' },
  archer: { skin: '#e2b48c', cloth: '#4a6a3a', cloth2: '#2e4428', sash: '#a08850', hat: '#c8a860', accent: '#c33', metal: '#ddd', wood: '#6b4024' },
  assassin: { skin: '#d8b090', cloth: '#241a34', cloth2: '#160f22', sash: '#6a3aa0', hood: '#1a1424', eye: '#d080ff', metal: '#b8a8d8', accent: '#6a3aa0' },
  bomber: { skin: '#e2b48c', cloth: '#6a6a72', cloth2: '#45454e', sash: '#a83a2a', hair: '#1a1414', accent: '#d0a030', metal: '#ccc' },
  sumo: { skin: '#e8b890', cloth: '#e8b890', cloth2: '#e8b890', sash: '#3a2a50', hair: '#1a1414' },
  samurai: { skin: '#e2b48c', cloth: '#24304e', cloth2: '#3a5a8a', sash: '#c8a050', accent: '#c8a050', metal: '#e6edf5' },
  kappa: { skin: '#5f9a5a' },
  karasu: { skin: '#e8c8a0', cloth: '#2a2838', cloth2: '#1a1824', sash: '#c8302a', hood: '#1e1c26', metal: '#ddd', wood: '#3a2a1a' },
  kitsune: { skin: '#f4e8dc', cloth: '#f2ede4', cloth2: '#d8d0c4', sash: '#c8302a', hair: '#f4f0e8', tail: '#f0a040', metal: '#ffd8a0' },
  yamabushi: { skin: '#ecc8a0', cloth: '#e8e0c8', cloth2: '#6a7a5a', sash: '#c8302a', metal: '#ccc', accent: '#c33' },
  skeleton: { skin: '#e8e2cc', cloth: '#e8e2cc', cloth2: '#3a3440', sash: '#5a2a2a', eye: '#7ad8ff', metal: '#b8c0c8' },
  ghostspear: { skin: '#c8d8f0', cloth: '#6a86b8', cloth2: '#4a6290', sash: '#c8e0ff', hat: '#3a4a6a', accent: '#9ec8ff', metal: '#d8ecff', wood: '#4a5a7a' },
  frostarcher: { skin: '#d8e8f0', cloth: '#d8e8f0', cloth2: '#2a3a52', sash: '#6a8ab0', eye: '#9ee4ff', hat: '#4a6a8a', wood: '#5a6a80' },
  yukionna: { skin: '#eef4fa', cloth: '#f4f8ff', cloth2: '#cfe0f4', sash: '#8ab8e0', hair: '#0e0e18', eye: '#9ee4ff' },
  imp: { skin: '#d84a2a', hair: '#2a1a1a', cloth: '#d84a2a', cloth2: '#3a2a20', sash: '#3a2a20', eye: '#ffe04a' },
  oni: { skin: '#c8402e', hair: '#2a1a1a', cloth: '#c8402e', cloth2: '#3a2a20', sash: '#3a2a20', eye: '#ffe04a', club: '#3a3440' },
  frostoni: { skin: '#5a8ac8', hair: '#e8f4ff', cloth: '#5a8ac8', cloth2: '#2a3a50', sash: '#2a3a50', eye: '#bff4ff', club: '#a8d8f0' },
  ronin_boss: { skin: '#e2b48c', cloth: '#2a2630', cloth2: '#8a2a24', accent: '#c8a050', sash: '#c8a050', metal: '#e6edf5', wood: '#2a1a12' },
  tengu: { skin: '#c8302a', cloth: '#e8e0d0', cloth2: '#4a3a6a', sash: '#c83a2a', metal: '#ddd' },
  tate: { skin: '#e2b48c', cloth: '#6a3a2a', cloth2: '#3a2418', sash: '#d8c070', hat: '#2a2a30', accent: '#c33', metal: '#e0e6ee', wood: '#5a3a20' },
  ironguard: { skin: '#e2b48c', cloth: '#2e2e36', cloth2: '#5a5e6a', sash: '#a83a2a', accent: '#d8c070', metal: '#e6edf5' },
  shellguard: { skin: '#4f7a4a' },
  barkwarden: { skin: '#e8ecd8', cloth: '#5a4a30', cloth2: '#3a3020', sash: '#6aa04a', wood: '#5a3a20' },
  boneshield: { skin: '#e8e2cc', cloth: '#e8e2cc', cloth2: '#3a3440', sash: '#2a3a5a', eye: '#ff7a5a', metal: '#b8c0c8' },
  glacier: { skin: '#7aa8d8', hair: '#f4faff', cloth: '#7aa8d8', cloth2: '#2a3a50', sash: '#2a3a50', eye: '#e0faff', club: '#cfeeff' },
  oni_lord: { skin: '#6a3a8a', hair: '#f0e8e0', cloth: '#6a3a8a', cloth2: '#2a1a1a', sash: '#2a1a1a', eye: '#ff5030', club: '#2a2430' },
  // the Kagerō fortress: black lacquer and crimson
  kg: { skin: '#e2b48c', cloth: '#1e1a22', cloth2: '#6a1420', sash: '#c8a050', hat: '#141218', accent: '#b02030', metal: '#e6edf5', wood: '#3a2418', hood: '#16131a', eye: '#ff6a5a' },
  kgred: { skin: '#e2b48c', cloth: '#6a1420', cloth2: '#1e1a22', sash: '#c8a050', hat: '#141218', accent: '#d8b050', metal: '#e6edf5', wood: '#3a2418' },
  kgmonk: { skin: '#e6c4a0', cloth: '#3a1420', cloth2: '#1a1418', sash: '#d8a838', metal: '#ccc', accent: '#d8a838', wood: '#2a1a12' },
  // training hall: white and indigo keikogi, black hakama
  karateka: { skin: '#e2b48c', cloth: '#f2eee2', cloth2: '#d8d2c2', sash: '#1a1414', hair: '#1a1414', accent: '#c8302a', metal: '#ddd' },
  kenshi: { skin: '#e2b48c', cloth: '#2a3458', cloth2: '#16182a', sash: '#e8e0cc', hair: '#1a1414', accent: '#c8302a', metal: '#e6edf5', wood: '#3a2418' },
  bojutsu: { skin: '#e2b48c', cloth: '#e8e2d0', cloth2: '#26262e', sash: '#8a5a2a', hair: '#1a1414', accent: '#c8302a', metal: '#ddd', wood: '#8a6a40' },
  naginata: { skin: '#ecc8a8', cloth: '#f4f0e6', cloth2: '#7a1a24', sash: '#c8a050', hair: '#141016', accent: '#c8302a', metal: '#e6edf5', wood: '#3a2418' },
  shurikenka: { skin: '#d8b090', cloth: '#2c3036', cloth2: '#1a1c20', sash: '#c8302a', hood: '#22252a', eye: '#ffd070', metal: '#c8ccd4', accent: '#c8302a' },
  sensei: { skin: '#e6c09c', cloth: '#1e2440', cloth2: '#121426', sash: '#e8e0cc', hair: '#d8d4cc', accent: '#c8a050', metal: '#f0f4f8', wood: '#2a1a12' },
  // library: scholars in ink-dyed robes
  scholar: { skin: '#ecc8a0', cloth: '#5a6a5a', cloth2: '#2e3a30', sash: '#c8a050', metal: '#ccc', accent: '#c8a050', wood: '#5a3a20' },
  sage: { skin: '#e8d0b0', cloth: '#2a2236', cloth2: '#141018', sash: '#8a6ad0', metal: '#ccc', accent: '#b08aff', wood: '#2a1a12' },
  gensai: { skin: '#e6c09c', cloth: '#1c1418', cloth2: '#7a1420', sash: '#d8a838', accent: '#d8a838', metal: '#f0f4f8', mantle: '#8a1022', wood: '#2a1a12' },
};
const drawing = (e) => (e.state === 'windup' ? { kind: 'draw', t: 1 - e.t / e.tDur } : null);
const casting = (e) => (e.state === 'windup' ? { kind: 'cast', t: 1 - e.t / e.tDur } : null);
const oniBody = { head: 'oni', weapon: 'club', grip: 'shoulder', bareChest: true, bareArms: true, tigerCloth: true };

export const LOOKS = {
  bandit: () => ({ pal: P.bandit, head: 'bandana', weapon: 'katana', grip: 'down' }),
  tate: (e) => ({ pal: P.tate, head: 'jingasa', weapon: 'tanto', grip: 'down', s: 1.05, pose: e.state === 'charge' ? { kind: 'thrust', t: 0.5 } : null }),
  ironguard: () => ({ pal: P.ironguard, head: 'kabuto', armor: true, weapon: 'katana', grip: 'down', s: 1.3, fat: 1.2, h: 74, shieldS: 1.05 }),
  spear: (e) => ({ pal: P.spear, head: 'jingasa', weapon: 'spear', grip: 'pole', pose: e.state === 'lunge' ? { kind: 'thrust', t: 0.5 } : null }),
  archer: (e) => ({ pal: P.archer, head: 'kasa', weapon: 'bow', grip: 'down', pose: drawing(e) }),
  assassin: () => ({ pal: P.assassin, head: 'mask', weapon: 'tanto', weapon2: 'tanto', grip: 'down', shimmer: true }),
  bomber: () => ({ pal: P.bomber, head: 'bandana', weapon: 'bomb', grip: 'down', fat: 1.4, s: 1.05 }),
  sumo: (e) => ({ pal: P.sumo, head: 'sumo', bareChest: true, bareArms: true, fat: 2.0, s: 1.5, armW: 1.7, legW: 1.7, h: 84, pose: e.state === 'charge' ? { kind: 'thrust', t: 0.5 } : null }),
  samurai: (e) => ({ pal: P.samurai, head: 'kabuto', armor: true, weapon: 'nodachi', grip: 'shoulder', s: 1.45, fat: 1.2, h: 82, pose: e.state === 'iaido' ? { kind: 'thrust', t: 0.5 } : null }),

  kappa: (e) => ({ pal: P.kappa, draw: drawKappa, h: 44, crouch: 0, attack: e.pose ? 1 : 0 }),
  shellguard: (e) => ({ pal: P.shellguard, draw: drawKappa, h: 46, s: 1.1, crouch: e.state === 'charge' ? 0.5 : 0, attack: e.pose ? 1 : 0, shieldS: 0.85 }),
  barkwarden: (e) => ({ pal: P.barkwarden, head: 'kodama', robe: true, fat: 1.35, s: 1.3, h: 72, armW: 1.3, shieldS: 1.1, pose: e.state === 'recover' && e.pose ? e.pose : null }),
  kamaitachi: () => ({ draw: drawWeasel, h: 30 }),
  karasu: (e) => ({ pal: P.karasu, head: 'crow', weapon: 'bow', grip: 'down', wings: true, smallWings: true, flapSpeed: 9, pose: drawing(e) }),
  kitsune: () => ({ pal: P.kitsune, head: 'fox', robe: true, tails: 3, weapon: 'tanto', grip: 'down', shimmer: true }),
  tanuki: () => ({ draw: drawTanuki, h: 46 }),
  yamabushi: (e) => ({ pal: P.yamabushi, head: 'tokin', robe: true, weapon: 'staff', grip: 'pole', pose: casting(e) }),
  boar: () => ({ draw: drawBoar, h: 62 }),
  komainu: () => ({ draw: drawKomainu, h: 66 }),

  skeleton: () => ({ pal: P.skeleton, head: 'skull', bareChest: true, ribs: true, bareArms: true, weapon: 'katana', grip: 'down' }),
  boneshield: (e) => ({ pal: P.boneshield, head: 'skull', bareChest: true, ribs: true, bareArms: true, weapon: 'tanto', grip: 'down', s: 1.05, pose: e.state === 'charge' ? { kind: 'thrust', t: 0.5 } : null }),
  glacier: () => ({ pal: P.glacier, ...oniBody, weapon: null, s: 1.35, fat: 1.2, armW: 1.3, legW: 1.25, h: 76, shieldS: 1.0 }),
  ghostspear: (e) => ({ pal: P.ghostspear, head: 'jingasa', robe: true, weapon: 'spear', grip: 'pole', alphaMul: 0.78, pose: e.state === 'lunge' ? { kind: 'thrust', t: 0.5 } : null }),
  frostarcher: (e) => ({ pal: P.frostarcher, head: 'skull', bareChest: true, ribs: true, bareArms: true, weapon: 'bow', grip: 'down', pose: drawing(e) }),
  yukionna: (e) => ({ pal: P.yukionna, head: 'longhair', robe: true, shimmer: true, pose: e.state === 'windup' ? { kind: 'cast', t: 0.5 } : null }),
  imp: () => ({ pal: P.imp, ...oniBody, weapon: 'firejar', grip: 'down', s: 0.85, h: 48 }),
  wisp: () => ({ draw: drawWisp, h: 52 }),
  oni: () => ({ pal: P.oni, ...oniBody, s: 1.55, fat: 1.25, armW: 1.4, legW: 1.3, h: 82 }),
  gashadokuro: () => ({ draw: drawGasha, h: 112 }),
  frostoni: (e) => ({ pal: P.frostoni, ...oniBody, s: 1.7, fat: 1.3, armW: 1.45, legW: 1.35, h: 90, pose: e.state === 'breath' ? { kind: 'cast', t: 0.5 } : null }),

  ronin_boss: (e) => ({ pal: P.ronin_boss, head: 'kabuto', weapon: 'naginata', grip: 'pole', armor: true, s: 1.6, fat: 1.15, h: 88, pose: e.state === 'dash' ? { kind: 'thrust', t: 0.5 } : e.state === 'summon' ? { kind: 'cast', t: 0.5 } : null }),
  tengu: (e) => ({ pal: P.tengu, head: 'tengu', weapon: 'fan', grip: 'down', wings: true, flapSpeed: e.state === 'rise' ? 18 : 7, s: 1.5, h: 84, pose: e.state === 'volley' ? { kind: 'throw', side: 1, t: (e.t % 0.28) / 0.28 } : null }),
  oni_lord: (e) => ({ pal: P.oni_lord, ...oniBody, s: 2.4, fat: 1.3, armW: 1.5, legW: 1.4, h: 130, pose: e.state === 'charge' ? { kind: 'thrust', t: 0.5 } : null }),

  kgsoldier: () => ({ pal: P.kg, head: 'jingasa', armor: true, weapon: 'katana', grip: 'down', s: 1.05 }),
  kgspear: (e) => ({ pal: P.kgred, head: 'jingasa', armor: true, weapon: 'spear', grip: 'pole', s: 1.05, pose: e.state === 'lunge' ? { kind: 'thrust', t: 0.5 } : null }),
  kgsentry: (e) => ({ pal: P.kg, head: 'kasa', weapon: 'crossbow', grip: 'forward', pose: e.state === 'windup' ? { kind: 'windup', t: 1 - e.t / e.tDur } : null }),
  kgshinobi: () => ({ pal: P.kg, head: 'mask', weapon: 'tanto', weapon2: 'tanto', grip: 'down', shimmer: true }),
  kgshield: (e) => ({ pal: P.kgred, head: 'jingasa', armor: true, weapon: 'tanto', grip: 'down', s: 1.08, pose: e.state === 'charge' ? { kind: 'thrust', t: 0.5 } : null }),
  kgwall: () => ({ pal: P.kg, head: 'kabuto', armor: true, weapon: 'katana', grip: 'down', s: 1.35, fat: 1.25, h: 76, shieldS: 1.1 }),
  kgmonk: (e) => ({ pal: P.kgmonk, head: 'tokin', robe: true, weapon: 'staff', grip: 'pole', pose: casting(e) }),
  kgchampion: (e) => ({ pal: P.kgred, head: 'kabuto', armor: true, weapon: 'nodachi', grip: 'shoulder', s: 1.5, fat: 1.2, h: 84, pose: e.state === 'iaido' ? { kind: 'thrust', t: 0.5 } : null }),
  karateka: (e) => ({ pal: P.karateka, head: 'bandana', bareArms: true, weapon: null, s: 1.0, pose: e.state === 'windup' ? { kind: 'thrust', t: 0.3 } : null }),
  kenshi: () => ({ pal: P.kenshi, head: 'bandana', weapon: 'katana', grip: 'down', backWeapon: 'saya', s: 1.02 }),
  bojutsu: (e) => ({ pal: P.bojutsu, head: 'bandana', weapon: 'bo', grip: 'pole', pose: e.state === 'lunge' ? { kind: 'boJab', t: 0.6 } : null }),
  naginata: (e) => ({ pal: P.naginata, head: 'bandana', robe: true, weapon: 'naginata', grip: 'pole', pose: e.state === 'lunge' ? { kind: 'thrust', t: 0.5 } : null }),
  shurikenka: (e) => ({ pal: P.shurikenka, head: 'mask', weapon: 'kunai', grip: 'down', pose: e.state === 'windup' ? { kind: 'throw', side: 1, t: 1 - e.t / e.tDur } : null }),
  sensei: (e) => ({ pal: P.sensei, head: 'hermit', weapon: 'nodachi', grip: 'shoulder', s: 1.4, fat: 1.1, h: 80, pose: e.state === 'iaido' ? { kind: 'thrust', t: 0.5 } : null }),
  scholar: (e) => ({ pal: P.scholar, head: 'tokin', robe: true, weapon: 'spiritorb', grip: 'down', pose: casting(e) }),
  sage: (e) => ({ pal: P.sage, head: 'hermit', robe: true, weapon: 'staff', grip: 'pole', pose: casting(e) }),
  dummy: () => ({ draw: drawDummy, h: 72 }),
  gensai: (e) => ({
    pal: P.gensai, head: 'eboshi', armor: true, mantle: true, weapon: 'katana', grip: 'down', s: 1.55, fat: 1.05, h: 88,
    pose: e.kneel ? { kind: 'kneel', t: 1 }
      : e.state === 'windup' && (e.next === 'iai' || e.next === 'mirage') ? { kind: 'iaiCrouch', t: clamp(1 - e.t / (e.tDur || 1), 0, 1) }
      : e.state === 'gdash' ? { kind: 'thrust', t: 0.5 }
      : e.state === 'summon' ? { kind: 'cast', t: 0.5 } : null,
  }),
};

// Headless combat sim: runs the REAL game code (player, weapons, arts, elements, cards, enemies' damage rules)
// against targets that stand still (or drift in a small circle), with no drawing and no audio.
// A scripted "player" presses the buttons. It is not an AI: it plays to a STYLE (how much of the time it is
// attacking, how close it stands, how well it aims, whether it uses specials), and the suites sweep a grid of
// styles so the results show a range for every weapon instead of one bot's opinion.
//
// Loaded by tools/sim/sim.html (see tools/sim/run.mjs to drive it from the command line).
import { input } from '../../src/input.js';
import { Enemy } from '../../src/enemies.js';
import { WEAPON_INFO, WEAPONS, levelDamageScale } from '../../src/config.js';
import { applyUpgrade } from '../../src/cards.js';
import { HW, HH } from '../../src/util.js';

export const DT = 1 / 60;
const MELEE_REACH_USE = 0.8; // melee stands at this share of its reach

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// world direction -> the screen-space stick direction the game expects (inverse of util.screenDirToWorld)
const toStick = (wx, wy) => { const sx = ((wx - wy) * HW) / 2, sy = ((wx + wy) * HH) / 2, l = Math.hypot(sx, sy) || 1; return [sx / l, sy / l]; };

// targets: hold their spot (walking back after knockback, like an enemy closing in again), always face the
// player (so front shields are in the way), never attack. simMove > 0: circle their spot at that speed.
const SIMBEH = {
  think() {}, strike() {},
  custom(e, dt, g) {
    const p = g.players[0], dx = p.x - e.x, dy = p.y - e.y, l = Math.hypot(dx, dy) || 1;
    e.faceX = dx / l; e.faceY = dy / l;
    const [hx, hy] = e.simHome;
    let tx = hx, ty = hy;
    if (e.simMove > 0) { e.simA += (dt * e.simMove) / 1.4; tx = hx + Math.cos(e.simA) * 1.4; ty = hy + Math.sin(e.simA) * 1.4; }
    let vx = (tx - e.x) * 5, vy = (ty - e.y) * 5;
    const sp = Math.hypot(vx, vy), cap = Math.max(e.simMove || 0, e.speed * 0.7);
    if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
    e.vx = vx; e.vy = vy;
  },
};

// reach of a weapon's basic attack (tiles)
const reachOf = (k) => WEAPON_INFO[k].basic.reach;

// spec = {
//   weapons: [a, b], use: 'A' | 'B' | 'both' (which basic buttons it presses), specials: 'always' | 'never',
//   arts: [[slot, artKey]], cards: [card objects for applyUpgrade],
//   target: { type, level, count, layout: 'single'|'cluster'|'spread', immortal, move },
//   style: { uptime, cycle, aimErr (deg), range (tiles, null = by weapon), charge (0..1 draw before release), dashThrough },
//   dur (s), burst (s), seed
// }
export function runSim(g, spec, opts = {}) {
  const rnd = mulberry(spec.seed || 1);
  const realRandom = Math.random;
  Math.random = rnd;
  try { return simulate(g, spec, rnd, opts); } finally { Math.random = realRandom; }
}

function simulate(g, spec, rnd, opts) {
  const S = { uptime: 1, cycle: 2.5, aimErr: 0, range: null, charge: 1, dashThrough: true, ...(spec.style || {}) };
  const T = { type: 'dummy', level: 5, count: 1, layout: 'single', immortal: false, move: 0, respawn: 0.25, ...(spec.target || {}) };
  const dur = spec.dur || 40, burstT = spec.burst || 8;
  const spiritChip = (spec.spiritChip ?? 3) * levelDamageScale(T.level) * WEAPONS.orb.special.hurtMul;
  g.startTraining(spec.weapons, spec.arts || []);
  g.leaveTraining = () => {}; g.enterGate = () => {}; g.say = () => {};
  g.onLevelCleared = () => {}; // (a fallen target is replaced: no level-clear slow motion, card screen or frozen regen)
  // no hit-freeze or slow motion: they stop the whole game (enemies too), so in a real fight they cost nothing, but here
  // the frozen steps would count as fight time and punish crits and big hits (crit cards read as losing damage)
  g.hitstop = () => {}; g.slow = () => {}; g.hitstopT = 0; g.slowT = 0;
  g.banners.length = 0; g.dialogue = null; g.state = 'play'; g.world.gate.active = false;
  const p = g.players[0];
  // the targets never attack on their own. With spec.incoming = { dmg, every } each target close to the player
  // lands a hit every `every` s through the player's real hurt() (so the Shishi Shield's Bulwark can store it);
  // the player's health is topped up after every step so the fight never ends.
  const realHurt = p.hurt.bind(p);
  p.hurt = spec.incoming ? realHurt : () => 0;
  for (const c of spec.cards || []) applyUpgrade(p, c);
  if (spec.alwaysCrit) { p.alwaysCrit = true; p.stats.cooldownMul *= 1.5; } // (the Patient Executioner sacrifice)
  const ctl = input.players[0];
  ctl.mode = 'pad';

  // the targets and where they stand
  g.enemies.length = 0; g.pickups && (g.pickups.length = 0);
  const N = g.world.N, cx = N / 2, cy = N / 2 - 0.5;
  const spots = [];
  if (T.layout === 'single' || T.count <= 1) spots.push([cx, cy]);
  else for (let i = 0; i < T.count; i++) {
    const a = (i / T.count) * Math.PI * 2 + 0.3, r = T.layout === 'cluster' ? 0.9 : 2.6;
    spots.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const stats = { dmg: 0, burstDmg: 0, kills: 0, ttk: [], src: {}, hits: {}, bo: { lo: [0, 0], mid: [0, 0], hi: [0, 0] }, release: 0, taken: 0 };
  let guardEnd = -9, guardStep = false;
  const spawn = (slot) => {
    // a mixed group (target.types): every spot cycles through the list as its enemies fall
    const type = T.types ? T.types[(slot.i + (slot.n++ || 0)) % T.types.length] : T.type;
    const e = new Enemy(g, type, slot.x, slot.y, T.level);
    if (T.immortal || type === 'dummy') { e.hpMax = 1e7; e.hp = 1e7; }
    e.beh = SIMBEH; e.state = 'simhold'; e.alpha = 1; e.simTarget = true;
    e.simHome = [slot.x, slot.y]; e.simMove = T.move; e.simA = rnd() * 6.28; e.simBorn = g.time;
    g.addEnemy(e); slot.e = e; slot.dead = -1;
  };
  const slots = spots.map(([x, y], i) => ({ x, y, i, n: 0, e: null, dead: -1, atk: (spec.incoming ? spec.incoming.every : 1) * (0.3 + 0.7 * rnd()) }));
  slots.forEach(spawn);

  // how far the player wants to stand: melee at most of the shortest reach it uses, ranged at style.range
  const used = [spec.weapons[0]]; // (one weapon per run since 2026-11-19)
  // (a technique that shortens a weapon's reach, like Snap Shot, brings the player in closer)
  const reachNow = (k) => { const w = p.weapons.find((q) => q.key === k), SS = w && p.art && p.art(w, 'snapShot'); return reachOf(k) * (SS ? SS.rangeMul : 1); };
  const want = S.range ?? Math.min(6, Math.min(...used.map(reachNow)) * MELEE_REACH_USE);
  { const a = Math.atan2(1, 1); p.x = cx + Math.cos(a) * Math.max(1.5, want); p.y = cy + Math.sin(a) * Math.max(1.5, want); }

  // every bit of health the targets lose (overkill does not count), and where it came from
  const orig = g.damageEnemy;
  g.damageEnemy = function (e, dmg, crit, dx, dy, knock, stun, src) {
    const before = e.hp, wasDead = e.dead;
    orig.call(this, e, dmg, crit, dx, dy, knock, stun, src);
    if (!e.simTarget || wasDead) return;
    const eff = Math.max(0, before - Math.max(0, e.hp));
    if (!eff) return;
    stats.dmg += eff;
    if (simT <= burstT) stats.burstDmg += eff;
    const k = !src ? 'other' : src.dot ? (src.pool ? 'pool' : src.tether ? 'tether' : 'dot') : src.chain ? 'chain' : src.spirit ? 'spirit' : src.ally ? 'clone' : src.weapon ? src.weapon.key : 'other';
    stats.src[k] = (stats.src[k] || 0) + eff;
    if (src && !src.dot && !src.chain) stats.hits[k] = (stats.hits[k] || 0) + 1;
    // the bo's damage by its combo level when the blow lands (0-1 low, 2-4 mid, 5 full)
    if (src && !src.dot && src.weapon && src.weapon.key === 'bo') { const c = src.weapon.combo || 0, b = stats.bo[c <= 1 ? 'lo' : c >= 5 ? 'hi' : 'mid']; b[0] += eff; b[1]++; }
    // the Shishi Shield's Bulwark release (its hits while crouched or right after)
    if (k === 'shield' && (p.guard || guardStep || simT - guardEnd < 0.4)) stats.release += eff;
  };

  let simT = 0, aimOff = 0, aimNext = 0, lastPhase = -1, strafe = 1;
  const trail = []; // where the aimed-at target was over the last moments (style.aimLag: the player reacts this late)
  const steps = Math.round(dur / DT);
  for (let i = 0; i < steps; i++) {
    simT = i * DT;
    // dead targets: count the kill, bring a fresh one after a moment (the next enemy walking up)
    for (const s of slots) {
      if (s.e && s.e.dead && s.dead < 0) { s.dead = simT; stats.kills++; stats.ttk.push(g.time - s.e.simBorn); }
      if (s.dead >= 0 && simT - s.dead >= T.respawn) spawn(s);
    }
    // nearest living target
    let tgt = null, bd = 1e9;
    for (const s of slots) { const e = s.e; if (!e || e.dead) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; tgt = e; } }
    const down = {};
    let mx = 0, my = 0, aim = null;
    const cycleN = Math.floor(simT / S.cycle), ph = (simT % S.cycle) / S.cycle, attacking = ph < S.uptime;
    if (cycleN !== lastPhase) { lastPhase = cycleN; strafe = rnd() < 0.5 ? 1 : -1; }
    if (tgt) {
      const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      // aim error: drifts to a new random offset every 0.3 s
      if (simT >= aimNext) { aimNext = simT + 0.3; aimOff = ((rnd() + rnd() + rnd() - 1.5) / 1.5) * S.aimErr * (Math.PI / 180); }
      // aim lag: aim at where the target was aimLag s ago (a player reacting to a moving enemy)
      trail.push([simT, tgt.x, tgt.y]); while (trail.length && trail[0][0] < simT - (S.aimLag || 0) - 0.5) trail.shift();
      let ox = tgt.x, oy = tgt.y;
      if (S.aimLag) { const old = trail.find((q) => q[0] >= simT - S.aimLag) || trail[0]; ox = old[1]; oy = old[2]; }
      const aa = Math.atan2(oy - p.y, ox - p.x) + aimOff;
      aim = toStick(Math.cos(aa), Math.sin(aa));
      // movement: close to / back off to the wanted distance; while repositioning, circle around the target
      let wx = 0, wy = 0;
      const err = d - want;
      if (Math.abs(err) > 0.25) { const k = Math.max(-1, Math.min(1, err / 1.2)); wx += ux * k; wy += uy * k; }
      if (!attacking) { wx += -uy * strafe * 0.9; wy += ux * strafe * 0.9; }
      const wl = Math.hypot(wx, wy);
      if (wl > 0.05) { const [sx, sy] = toStick(wx / wl, wy / wl); const m = Math.min(1, wl); mx = sx * m; my = sy * m; }
      // repositioning starts with a dash: through the target if our kunai are in it (that pulls them out), else sideways
      if (!attacking && ph - S.uptime < DT / S.cycle * 1.5) {
        const kunai = S.dashThrough && tgt.daggers && tgt.daggers.some((k) => k.p === p);
        const [sx, sy] = kunai ? toStick(ux, uy) : toStick(-uy * strafe, ux * strafe);
        mx = sx; my = sy; down.dash = true;
      }
      if (attacking && d < Math.max(want, 2) + 2.2) {
        // one weapon: basic (atk) always; the secondary (sec) unless the spec says not to (the heavy cleave is held to
        // S.charge, then let go); the special (spc) when the spec says so
        const w = p.weapons[0];
        down.atk = true;
        // (katanas: throw one blade at a time, never the second, so the basic slashes keep going)
        if (spec.secondaries !== 'never') { if (w.key === 'heavy' && p.charge && p.chargeFrac() >= S.charge - 1e-6) { /* release */ } else down.sec = true; }
        if (spec.specials === 'always') down.spc = true;
      }
    }
    ctl.apply(down, mx, my, aim);
    if (spec.incoming) for (const s of slots) {
      const e = s.e; if (!e || e.dead || Math.hypot(e.x - p.x, e.y - p.y) > 2.4) continue;
      s.atk -= DT;
      if (s.atk <= 0) { s.atk = spec.incoming.every * (0.8 + 0.4 * rnd()); if (realHurt(spec.incoming.dmg, e.x, e.y, 2)) stats.taken++; }
    }
    const hadGuard = !!p.guard; guardStep = hadGuard; // (the release lands in the step the guard ends)
    // spec.forceCombo: the bo stays at this combo level (to measure it at no combo and at full combo)
    if (spec.forceCombo != null) for (const w of p.weapons) if (w.key === 'bo') { w.combo = spec.forceCombo; w.comboT = 1; w.decayT = 0; }
    g.updatePlay(DT);
    if (hadGuard && !p.guard) guardEnd = simT;
    if (spec.incoming) { p.hp = p.maxHp; p.dead = false; p.downed = false; }
    // the orb's spirits: the targets never fight back, so every spirit takes a constant low chip damage instead,
    // standing in for the enemy hits it would soak in a real level: spiritChip damage per second at area-1 strength,
    // scaled like enemy damage for the level and by the share a spirit really takes (orb special hurtMul).
    // Flat, not a share of its health: a spirit raised from a strong enemy lasts longer, as it would in a fight.
    if (g.spirits && g.spirits.length) for (const sp of g.spirits) {
      if (sp.dead || !sp.active) continue;
      sp.hp -= spiritChip * DT;
      if (sp.hp <= 0) sp.die();
    }
    if (opts.onStep) opts.onStep(i, simT);
  }
  g.damageEnemy = orig;
  const ttk = stats.ttk.length ? stats.ttk.reduce((a, b) => a + b, 0) / stats.ttk.length : null;
  const src = {};
  for (const k in stats.src) src[k] = Math.round(stats.src[k]);
  return {
    dps: stats.dmg / dur, burstDps: stats.burstDmg / burstT, kills: stats.kills, kpm: (stats.kills * 60) / dur,
    ttk, src, hpPerTarget: slots[0].e ? slots[0].e.hpMax : null, name: slots[0].e ? slots[0].e.name : null,
    hits: stats.hits, bo: stats.bo, release: Math.round(stats.release), taken: stats.taken,
  };
}

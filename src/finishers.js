// Finishing moves: when a kill ends a fight in style, the killer plays one of their weapon's three finishers
// in slow motion, with the camera leaning in. Bosses always get one; the last enemy of a group often does;
// any other kill only rarely, and never while another enemy is close (it must not break the flow of a fight).
// The enemy is already dead: a finisher is pure show, and the player can't be hurt while it plays.
//
// A finisher is a list of steps. Each step lasts d (game seconds, slowed to ~30%) and can set:
//   pose / poseT (a fixed pose progress; default: the pose plays over the step) / side
//   move: 'to' (in front of the target) | 'through' (dash past it) | 'over' (leap over it) | 'behind'
//         (vanish and reappear behind it) | 'back' (spring away) | 'orbit' (circle around it)
//   z: [from, to] height in tiles, arc: an extra hop, spin: body flips (+ forward / - backward), turn: pirouettes
//   hide: nearly invisible (a shadow step), trail: afterimages
//   fx: effects fired at fxAt (0..1 of the step), or every fxEvery seconds while the step runs
import { TAU, clamp, lerp, rand, ease, isoX, isoY, worldDirToScreenAngle } from './util.js';
import { sfx } from './audio.js';
import { slashAngle } from './player.js';

const S = (name, ...a) => { if (sfx[name]) sfx[name](...a); };
const GOLD = 'rgba(255,226,140,0.95)', WHITE = 'rgba(255,252,240,0.95)';

export const FINISHERS = {
  katanas: [
    { name: 'Issen', jp: '一閃', steps: [
      { d: 0.14, pose: 'iaiCrouch' },
      { d: 0.07, pose: 'slash', side: 1, move: 'through', trail: true, fx: ['cut', 'sparks'], fxAt: 0.5 },
      { d: 0.3, pose: 'iaiCrouch', poseT: 0.25, fx: ['blood', 'shock', 'kanji'], fxAt: 0.55 },
    ] },
    { name: 'Cross Cut', jp: '十字斬', steps: [
      { d: 0.08, pose: 'windup', move: 'to' },
      { d: 0.08, pose: 'slash', side: 1, fx: ['slashA'] },
      { d: 0.08, pose: 'slash', side: -1, fx: ['slashB'] },
      { d: 0.24, pose: 'spin', turn: 1, fx: ['cross', 'blood', 'kanji'], fxAt: 0.3 },
    ] },
    { name: 'Swallow Return', jp: '燕返し', steps: [
      { d: 0.1, pose: 'jump', move: 'to' },
      { d: 0.16, pose: 'jump', z: [0, 1.4], spin: -1 },
      { d: 0.1, pose: 'cleave', z: [1.4, 0], fx: ['slash', 'dust', 'ring'], fxAt: 0.75 },
      { d: 0.2, pose: 'cleave', poseT: 1, fx: ['blood', 'kanji'] },
    ] },
  ],
  crossbow: [
    { name: 'Point Blank', jp: '零距離', steps: [
      { d: 0.1, pose: 'shoot', move: 'to' },
      { d: 0.1, pose: 'shoot', poseT: 1, fx: ['boltShot', 'sparks', 'blood'], fxAt: 0.3 },
      { d: 0.2, pose: 'jump', move: 'back', arc: 0.6, spin: -1, fx: ['kanji'] },
    ] },
    { name: 'Bolt Rain', jp: '矢雨', steps: [
      { d: 0.14, pose: 'jump', move: 'back', z: [0, 1.1], spin: -1 },
      { d: 0.18, pose: 'shoot', z: [1.1, 1.1], fx: ['volley'], fxAt: 0.15 },
      { d: 0.18, pose: 'jump', z: [1.1, 0], fx: ['blood', 'ring', 'kanji'], fxAt: 0.1 },
    ] },
    { name: 'Pinning Shot', jp: '縫止', steps: [
      { d: 0.2, pose: 'kneel', poseT: 0 },
      { d: 0.1, pose: 'shoot', poseT: 1, fx: ['bigBolt', 'shock', 'dust'], fxAt: 0.2 },
      { d: 0.22, pose: 'shoot', poseT: 0.3, fx: ['blood', 'kanji'] },
    ] },
  ],
  heavy: [
    { name: 'Earth Splitter', jp: '地割', steps: [
      { d: 0.12, pose: 'heavyCharge', poseT: 1 },
      { d: 0.16, pose: 'jump', move: 'to', z: [0, 1.3] },
      { d: 0.1, pose: 'slam', z: [1.3, 0], fx: ['shock', 'crack', 'dust', 'blood'], fxAt: 0.85 },
      { d: 0.2, pose: 'slam', poseT: 1, fx: ['kanji'] },
    ] },
    { name: 'Whirling Cleave', jp: '旋断', steps: [
      { d: 0.08, pose: 'heavyCharge', poseT: 0.6, move: 'to' },
      { d: 0.24, pose: 'spin', turn: 2, fx: ['spinRing', 'sparks'], fxEvery: 0.08 },
      { d: 0.18, pose: 'heavyCleave', fx: ['slash', 'blood', 'kanji'], fxAt: 0.3 },
    ] },
    { name: 'Executioner', jp: '断罪', steps: [
      { d: 0.24, pose: 'heavyCharge', poseT: 1, move: 'to', fx: ['glowCharge'] },
      { d: 0.1, pose: 'heavyCleave', fx: ['bigCut', 'shock', 'blood', 'dust'], fxAt: 0.5 },
      { d: 0.22, pose: 'heavyCleave', poseT: 1, fx: ['kanji'] },
    ] },
  ],
  knives: [
    { name: 'Kunai Storm', jp: '苦無嵐', steps: [
      { d: 0.32, pose: 'throw', turn: 1, fx: ['knives'], fxEvery: 0.045 },
      { d: 0.16, fx: ['blood', 'sparks', 'kanji'] },
    ] },
    { name: 'Shadow Step', jp: '影踏', steps: [
      { d: 0.08, hide: true, fx: ['inkSelf'] },
      { d: 0.06, move: 'behind', hide: true },
      { d: 0.12, pose: 'thrust', fx: ['ink', 'stab', 'blood'], fxAt: 0.4 },
      { d: 0.2, pose: 'thrust', poseT: 1, fx: ['kanji'] },
    ] },
    { name: 'Blade Fan', jp: '扇刃', steps: [
      { d: 0.16, pose: 'jump', move: 'back', z: [0, 1.0], spin: -1 },
      { d: 0.1, pose: 'throw', z: [1.0, 0.9], fx: ['fanKnives'], fxAt: 0.2 },
      { d: 0.2, pose: 'jump', z: [0.9, 0], fx: ['blood', 'sparks', 'kanji'] },
    ] },
  ],
  // the spirit orb: the orb is raised and the restless souls burst up out of the fallen, streaming into the sky
  orb: [
    { name: 'Restless Ascent', jp: '昇魂', steps: [
      { d: 0.16, pose: 'raise', fx: ['soulGather'], fxAt: 0 },
      { d: 0.36, pose: 'raise', poseT: 1, fx: ['souls'], fxEvery: 0.065 },
      { d: 0.18, pose: 'raise', poseT: 1, fx: ['soulFlash'], fxAt: 0 },
    ] },
  ],
  staff: [
    { name: 'Sanctify', jp: '浄化', steps: [
      { d: 0.22, pose: 'cast', fx: ['pillar'], fxAt: 0.3 },
      { d: 0.24, pose: 'cast', poseT: 1, fx: ['ring', 'glowBurst', 'kanji'], fxAt: 0.2 },
    ] },
    { name: 'Spirit Lances', jp: '霊槍', steps: [
      { d: 0.14, pose: 'cast', z: [0, 0.7] },
      { d: 0.26, pose: 'cast', poseT: 1, z: [0.7, 0.7], fx: ['lances'], fxEvery: 0.05 },
      { d: 0.14, z: [0.7, 0], fx: ['blood', 'kanji'] },
    ] },
    { name: 'Temple Bell', jp: '梵鐘', steps: [
      { d: 0.1, pose: 'slam', move: 'to' },
      { d: 0.32, pose: 'slam', poseT: 1, fx: ['bellRing'], fxEvery: 0.1 },
      { d: 0.1, fx: ['blood', 'kanji'] },
    ] },
  ],
  bo: [
    { name: 'Hundred Strikes', jp: '百裂', steps: [
      { d: 0.06, pose: 'boJab', move: 'to', fx: ['tap'] },
      { d: 0.06, pose: 'boSweep', fx: ['tap'] },
      { d: 0.06, pose: 'boRise', fx: ['tap'] },
      { d: 0.06, pose: 'boJab', fx: ['tap'] },
      { d: 0.06, pose: 'boSweep', fx: ['tap'] },
      { d: 0.12, pose: 'boOverhead', fx: ['shock', 'blood', 'kanji'], fxAt: 0.5 },
    ] },
    { name: 'Pole Vault', jp: '跳棒', steps: [
      { d: 0.08, pose: 'boJab', move: 'to' },
      { d: 0.2, pose: 'jump', move: 'over', arc: 1.3, spin: 1, trail: true },
      { d: 0.14, pose: 'boOverhead', fx: ['shock', 'dust', 'blood', 'kanji'], fxAt: 0.5 },
    ] },
    { name: 'Dragon Twirl', jp: '龍旋', steps: [
      { d: 0.32, pose: 'boTwirl', move: 'orbit', trail: true, fx: ['tap'], fxEvery: 0.08 },
      { d: 0.16, pose: 'boRise', fx: ['launch', 'blood', 'kanji'], fxAt: 0.3 },
    ] },
  ],
  shield: [
    { name: "Lion's Charge", jp: '獅子突', steps: [
      { d: 0.12, pose: 'shieldGuard', poseT: 0.5 },
      { d: 0.1, pose: 'shieldBash', move: 'through', trail: true, fx: ['shock', 'sparks', 'blood'], fxAt: 0.5 },
      { d: 0.22, pose: 'shieldBash', poseT: 1, fx: ['lion', 'kanji'] },
    ] },
    { name: 'Shield Crash', jp: '盾落', steps: [
      { d: 0.18, pose: 'jump', move: 'to', z: [0, 1.3] },
      { d: 0.08, pose: 'slam', z: [1.3, 0], fx: ['shock', 'dust', 'blood', 'ring'], fxAt: 0.9 },
      { d: 0.2, pose: 'slam', poseT: 1, fx: ['kanji'] },
    ] },
    { name: 'Guardian Burst', jp: '守護爆', steps: [
      { d: 0.24, pose: 'shieldGuard', poseT: 0.5, fx: ['glowCharge'] },
      { d: 0.1, pose: 'shieldBash', fx: ['bigRing', 'shock', 'blood'], fxAt: 0.2 },
      { d: 0.18, fx: ['kanji'] },
    ] },
  ],
};


// tuning
// speed: every step plays at this share of its listed length; slow: game speed while it plays
export const FINISH = { speed: 0.65, slow: 0.45, chance: 0.06, groupChance: 0.6, clearChance: 0.7, nearby: 4.2, cooldown: 5 };

// ---------------------------------------------------------------- when
// called from Game.killEnemy for every kill
export function tryFinisher(g, e) {
  const p = e.killer;
  if (!p || p.dead || p.downed || p.finisher || p.remote || p.puppet || g.role === 'client' || !g.players.includes(p)) return;
  if (g.time - (e.lastHitT ?? -9) > 0.25) return; // only the blow that killed it (not a boss taking his guard with him)
  g.killLog = (g.killLog || []).filter((t) => g.time - t < 2.5); g.killLog.push(g.time);
  const boss = e.boss && e.type !== 'gensai';
  if (!boss) {
    if (p.dash.t > 0 || p.leap || p.flurry || p.bash || p.guard || p.spin) return;
    if (g.time < (g.finisherCd || 0)) return;
    if (g.enemies.some((o) => o !== e && !o.dead && o.state !== 'spawn' && !o.hidden && Math.hypot(o.x - p.x, o.y - p.y) < FINISH.nearby)) return; // someone is close: keep the fight flowing
    const alive = g.enemies.filter((o) => o !== e && !o.dead).length + (g.spawner ? g.spawner.remaining() : 0);
    const groupDone = g.killLog.length >= 3 && !g.enemies.some((o) => o !== e && !o.dead && Math.hypot(o.x - p.x, o.y - p.y) < 8);
    const chance = alive === 0 ? FINISH.clearChance : groupDone ? FINISH.groupChance : FINISH.chance;
    if (Math.random() > chance) return;
  }
  const w = e.killWeapon && p.weapons.includes(e.killWeapon) ? e.killWeapon : p.weapons[p.activeSlot];
  const list = FINISHERS[w.key] || FINISHERS.katanas;
  startFinisher(p, list[Math.floor(Math.random() * list.length)], e, w);
}

// ---------------------------------------------------------------- start / run
export function startFinisher(p, def, e, w) {
  def = { ...def, steps: def.steps.map((s) => ({ ...s, d: s.d * FINISH.speed, fxEvery: s.fxEvery ? s.fxEvery * FINISH.speed : 0 })) };
  const g = p.g, dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
  const total = def.steps.reduce((a, s) => a + s.d, 0);
  p.finisher = { def, w, i: -1, t: 0, st: 0, total, T: { x: e.x, y: e.y, r: e.r || 0.4 }, dir: [dx / d, dy / d], sx: p.x, sy: p.y, z0: 0, fired: false, every: 0, trailT: 0 };
  p.charge = null; p.anim = null; p.spin = null; p.flurry = null; p.bash = null; p.guard = null; p.dash.t = 0; p.leap = null;
  p.aimX = dx / d; p.aimY = dy / d;
  p.iframes = Math.max(p.iframes, total + 0.4);
  g.slow(total / FINISH.slow + 0.1, FINISH.slow);
  g.finisherCd = g.time + total + FINISH.cooldown;
  S('iai');
  nextStep(p);
}

function nextStep(p) {
  const F = p.finisher;
  F.i++; F.st = 0; F.fired = false; F.every = 0;
  const s = F.def.steps[F.i];
  if (!s) return;
  F.sx = p.x; F.sy = p.y; F.z0 = p.z || 0;
  const [dx, dy] = F.dir, T = F.T;
  F.gx = p.x; F.gy = p.y;
  if (s.move === 'to') { F.gx = T.x - dx * (T.r + 0.65); F.gy = T.y - dy * (T.r + 0.65); }
  else if (s.move === 'through') { F.gx = T.x + dx * 1.4; F.gy = T.y + dy * 1.4; }
  else if (s.move === 'over') { F.gx = T.x + dx * 1.1; F.gy = T.y + dy * 1.1; }
  else if (s.move === 'back') { F.gx = p.x - dx * 1.5; F.gy = p.y - dy * 1.5; }
  else if (s.move === 'behind') { p.x = T.x + dx * (T.r + 0.6); p.y = T.y + dy * (T.r + 0.6); p.g.world.collide(p); F.sx = F.gx = p.x; F.sy = F.gy = p.y; }
  else if (s.move === 'orbit') { F.oa = Math.atan2(p.y - T.y, p.x - T.x); F.or = Math.max(0.9, Math.hypot(p.x - T.x, p.y - T.y)); }
  if (s.pose === 'slash' || s.pose === 'cleave') S('katana');
  if (s.pose === 'heavyCleave' || s.pose === 'slam') S('heavyWhoosh', 0);
  if (s.move === 'through' || s.move === 'over' || s.move === 'back') S('dash');
}

export function updateFinisher(p, dt) {
  const F = p.finisher, g = p.g;
  for (let i = p.afterimages.length - 1; i >= 0; i--) { const a = p.afterimages[i]; a.life -= dt; if (a.life <= 0) p.afterimages.splice(i, 1); }
  const s = F.def.steps[F.i];
  if (!s) { p.finisher = null; p.z = 0; p.vx = p.vy = 0; return; }
  F.t += dt; F.st += dt;
  const u = clamp(F.st / s.d, 0, 1), e = ease.inOutSine(u);
  // where the body is
  if (s.move === 'orbit') { const a = F.oa + u * TAU; p.x = F.T.x + Math.cos(a) * F.or; p.y = F.T.y + Math.sin(a) * F.or; }
  else if (s.move && s.move !== 'behind') { p.x = lerp(F.sx, F.gx, e); p.y = lerp(F.sy, F.gy, e); }
  g.world.collide(p);
  const zr = s.z || [F.z0, 0];
  p.z = Math.max(0, lerp(zr[0], zr[1], u) + (s.arc ? Math.sin(u * Math.PI) * s.arc : 0));
  p.vx = p.vy = 0; p.moveAmt = s.move && s.move !== 'behind' ? 1 : 0;
  // afterimages while it moves fast
  F.trailT -= dt;
  if ((s.trail || s.move === 'through' || s.move === 'over') && F.trailT <= 0) {
    F.trailT = 0.012;
    const L = finisherLook(p);
    p.afterimages.push({ x: p.x, y: p.y, z: p.z, life: 0.14, max: 0.14, rot: L.rot, type: 'shadow', facing: L.facing, pose: L.pose });
  }
  // effects
  if (s.fx) {
    if (s.fxEvery) { F.every -= dt; if (F.every <= 0) { F.every += s.fxEvery; for (const n of s.fx) fx(p, n, s); } }
    else if (!F.fired && u >= (s.fxAt || 0)) { F.fired = true; for (const n of s.fx) fx(p, n, s); }
  }
  if (F.st >= s.d) nextStep(p);
  if (!F.def.steps[F.i]) { p.finisher = null; p.z = 0; }
}

// how the body looks right now (pose, facing, flips, visibility)
export function finisherLook(p) {
  const F = p.finisher, s = F && F.def.steps[F.i];
  if (!s) return { pose: null, facing: p.facingAngle(), rot: 0, alpha: 1 };
  const u = clamp(F.st / s.d, 0, 1);
  const tx = F.T.x - p.x, ty = F.T.y - p.y, d = Math.hypot(tx, ty);
  let facing = d > 0.15 ? worldDirToScreenAngle(tx / d, ty / d) : worldDirToScreenAngle(F.dir[0], F.dir[1]);
  if (s.move === 'back' || s.move === 'through' || s.move === 'over') facing = worldDirToScreenAngle(F.dir[0], F.dir[1]);
  if (s.turn) facing += u * TAU * s.turn;
  const rot = s.spin ? ease.inOutSine(u) * TAU * s.spin : 0;
  const pose = s.pose ? { kind: s.pose, t: s.poseT ?? u, side: s.side || 1 } : null;
  return { pose, facing, rot, alpha: s.hide ? 0.12 : 1 };
}

// ---------------------------------------------------------------- effects
function fx(p, name, s) {
  const g = p.g, F = p.finisher, T = F.T, [dx, dy] = F.dir, ang = slashAngle(dx, dy);
  switch (name) {
    case 'cut': g.fx.thrust(F.sx, F.sy, dx, dy, Math.hypot(T.x - F.sx, T.y - F.sy) + 1.4, WHITE, 9, 0.4); g.fx.slash(T.x, T.y, ang, 1.8, 0.5, WHITE, 12, 0.35); S('iaiCut'); break;
    case 'slash': g.fx.slash(T.x, T.y, ang, 1.7, 2.3, WHITE, 14, 0.3); S('cut'); break;
    case 'slashA': g.fx.slash(T.x, T.y, ang + 0.7, 1.6, 1.4, WHITE, 12, 0.3); S('katana'); break;
    case 'slashB': g.fx.slash(T.x, T.y, ang - 0.7, 1.6, 1.4, WHITE, 12, 0.3, 0.55, -1); S('katana'); break;
    case 'cross': for (const a of [0.785, -0.785]) { const c = Math.cos(a), sn = Math.sin(a), vx = dx * c - dy * sn, vy = dx * sn + dy * c; g.fx.thrust(T.x - vx * 1.2, T.y - vy * 1.2, vx, vy, 2.4, 'rgba(255,240,220,0.95)', 7, 0.4); } S('cut'); break;
    case 'bigCut': g.fx.slash(T.x, T.y, ang, 2.8, 1.2, WHITE, 22, 0.45); g.fx.thrust(T.x - dx * 1.5, T.y - dy * 1.5, dx, dy, 3, 'rgba(255,230,200,0.9)', 12, 0.4); S('heavyHit'); break;
    case 'spinRing': g.fx.slash(p.x, p.y, Math.random() * TAU, 2.3, TAU * 0.7, 'rgba(255,240,220,0.85)', 14, 0.25); S('heavyWhoosh', 0); break;
    case 'blood':
      g.particles.burst('blood', T.x, T.y, 0.6, 12, 4, 0.5, 2.4, '#9a1020', { grav: 10 });
      g.particles.burst('ink', T.x, T.y, 0.6, 6, 2.5, 0.5, 3.5, '#1e1428');
      g.decals.add(T.x, T.y, 0.7, 'rgba(60,10,25,1)');
      break;
    case 'sparks': g.particles.burst('spark', T.x, T.y, 0.7, 16, 6, 0.3, 1.8, '#ffe8a0'); break;
    case 'tap': g.particles.burst('spark', T.x + rand(-0.3, 0.3), T.y + rand(-0.3, 0.3), 0.7, 6, 4, 0.2, 1.4, '#fff2c0'); g.fx.slash(T.x, T.y, ang + rand(-1, 1), 1.1, 1.2, 'rgba(255,245,220,0.8)', 8, 0.16); S('tok'); break;
    case 'ring': g.fx.ring(T.x, T.y, 2.2, 'rgba(255,226,150,0.9)', 0.5, 6); break;
    case 'bigRing': g.fx.ring(p.x, p.y, 2.6, 'rgba(255,220,130,0.85)', 0.45, 6); g.particles.burst('glow', p.x, p.y, 0.8, 14, 3, 0.6, 2, '#ffe08a'); S('release'); break;
    case 'shock': g.shake(4); g.hitstop(0.03); g.fx.ring(T.x, T.y, 1.6, 'rgba(255,255,255,0.9)', 0.3, 5); S('heavyThud'); break;
    case 'dust': g.particles.burst('dust', T.x, T.y, 0.05, 18, 4, 0.7, 6, g.world.bi === 2 ? '#eef3fb' : '#c8b088', { under: true }); break;
    case 'crack': g.fx.thrust(p.x, p.y, dx, dy, 4.5, 'rgba(70,46,30,0.85)', 10, 0.9); for (let k = 1; k < 5; k++) g.particles.burst('dust', p.x + dx * k, p.y + dy * k, 0.05, 5, 2, 0.5, 4, '#a8906a', { under: true }); break;
    case 'glowCharge': g.particles.burst('glow', p.x, p.y, 1, 18, 1.6, 0.7, 2.4, '#ffd070'); S('heavyCharge', 0.8); break;
    case 'boltShot': g.fx.thrust(p.x, p.y, dx, dy, Math.hypot(T.x - p.x, T.y - p.y) + 3, 'rgba(255,236,170,0.95)', 6, 0.35); S('thunk'); break;
    case 'bigBolt': g.fx.thrust(p.x, p.y, dx, dy, Math.hypot(T.x - p.x, T.y - p.y) + 5, 'rgba(255,236,170,1)', 10, 0.5); g.fx.ring(T.x, T.y, 1.4, GOLD, 0.35, 5); S('twang'); S('thunk'); break;
    case 'volley': for (const off of [-0.18, 0, 0.18]) { const vx = T.x + rand(-0.3, 0.3) - p.x, vy = T.y + rand(-0.3, 0.3) - p.y, l = Math.hypot(vx, vy) || 1; g.fx.thrust(p.x, p.y, vx / l + off * -vy / l, vy / l + off * vx / l, l + 0.6, 'rgba(255,236,170,0.9)', 5, 0.35); } S('twang'); break;
    case 'knives': { const a = Math.atan2(dy, dx) + rand(-0.25, 0.25), l = Math.hypot(T.x - p.x, T.y - p.y) + 0.4; g.fx.thrust(p.x, p.y, Math.cos(a), Math.sin(a), l, 'rgba(220,230,240,0.9)', 3, 0.18); S('knifeThrow'); break; }
    case 'fanKnives': for (let k = -3; k <= 3; k++) { const a = Math.atan2(T.y - p.y, T.x - p.x) + k * 0.07, l = Math.hypot(T.x - p.x, T.y - p.y) + 0.6; g.fx.thrust(p.x, p.y, Math.cos(a), Math.sin(a), l, 'rgba(220,230,240,0.95)', 3, 0.3); } S('knifeThrow'); S('knifeHit'); break;
    case 'inkSelf': g.particles.burst('ink', p.x, p.y, 0.6, 18, 3, 0.6, 5, '#2a1a40'); g.particles.burst('smoke', p.x, p.y, 0.3, 8, 1.6, 0.6, 7, 'rgba(60,40,90,1)'); S('dash'); break;
    case 'ink': g.particles.burst('ink', p.x, p.y, 0.6, 14, 3, 0.6, 4, '#2a1a40'); break;
    case 'stab': g.fx.thrust(p.x, p.y, -dx, -dy, 1.6, WHITE, 6, 0.3); S('knifeHit'); break;
    case 'pillar': g.fx.spirit(T.x, T.y, 1.6, { kanji: '滅', col: '255,236,170', dur: 1.0 }); S('rin', 0.75); break;
    case 'glowBurst': g.particles.burst('glow', T.x, T.y, 0.9, 30, 4, 1, 2.6, '#fff0b0'); S('chime', 2); break;
    case 'lances': g.fx.bolt(p.x, p.y, 1.6, T.x + rand(-0.4, 0.4), T.y + rand(-0.4, 0.4), 0.5); g.particles.burst('glow', T.x, T.y, 0.6, 6, 2.5, 0.4, 2, '#fff0b0'); S('zap'); break;
    case 'bellRing': g.fx.ring(p.x, p.y, 1.1 + F.st * 6, 'rgba(255,226,150,0.7)', 0.35, 4); S('rin', 0.6 + F.st); break;
    case 'launch': g.fx.ring(T.x, T.y, 1.3, WHITE, 0.25, 4); g.particles.burst('spark', T.x, T.y, 1.2, 12, 5, 0.3, 1.8, '#fff2c0'); g.shake(3); S('heavyHit'); break;
    case 'lion': g.fx.ring(p.x, p.y, 1.8, GOLD, 0.35, 5); S('release'); break;
    // spirit orb: souls gather in the body, then several at a time shoot up into the air (drawn in spirits.js)
    case 'soulGather': g.particles.burst('glow', T.x, T.y, 0.7, 16, -1.5, 0.5, 2.4, '#9fd8ff'); g.fx.ring(T.x, T.y, 1.2, 'rgba(160,215,255,0.8)', 0.3, 3); S('haunt'); break;
    case 'souls':
      { const a = rand(0, TAU), sp = rand(1.2, 2.6); (g.soulRises || (g.soulRises = [])).push({ x: T.x + Math.cos(a) * rand(0.2, 0.7), y: T.y + Math.sin(a) * rand(0.2, 0.7), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, z: rand(0.3, 0.8), vz: rand(13, 18), t: 0, dur: rand(1.1, 1.5), seed: rand(0, 9), s: rand(0.85, 1.25) }); } // one at a time, fanning out, climbing high
      g.particles.burst('glow', T.x, T.y, 0.6, 3, 1.5, 0.4, 2, '#cfeaff');
      if (Math.random() < 0.4) S('wisp');
      break;
    case 'soulFlash': g.fx.ring(T.x, T.y, 2.2, 'rgba(170,220,255,0.9)', 0.45, 5); g.particles.burst('glow', T.x, T.y, 1.2, 24, 3.5, 0.8, 2.6, '#9fd8ff'); S('summon'); break;
    case 'kanji': break; // (no name text)
  }
}

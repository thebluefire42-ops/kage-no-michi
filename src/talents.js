// Talents: rare, high-impact active abilities (X / Y / B, or keys 1 / 2 / 3) and shadow clone allies.
import { TAU, clamp, rand, isoX, isoY, worldDirToScreenAngle, angDiff } from './util.js';
import { TALENTS, TALENT_POWER, TALENT_UPGRADE_POWER, TALENT_UPGRADE_CD, TALENT_MIN_CD, MAX_TALENTS } from './config.js';
import { drawHumanoid, drawShadow } from './rig.js';
import { sfx } from './audio.js';
import { input } from './input.js';

export const TALENT_KEYS = Object.keys(TALENTS);

export function talentCd(t) { return Math.max(TALENT_MIN_CD * (t.minMul || 1), TALENTS[t.key].cd[t.rarity || 0] * t.cdMul); }

// what a talent does at a rarity: num = the line on the card, short = the readout value, cd = its cooldown
export function talentInfo(key, r) {
  const T = TALENTS[key], cd = T.cd[r];
  switch (key) {
    case 'arrowRain': { const hits = Math.round(T.dur / T.tick); return { cd, num: `${T.dmg[r]} damage × ${hits} hits`, short: `${T.dmg[r]}×${hits}` }; }
    case 'meteor': return { cd, num: `${T.dmg[r]} damage`, short: `${T.dmg[r]}` };
    case 'meditate': return { cd, num: r === 3 ? 'Full energy' : `+${T.energy[r]} energy`, short: r === 3 ? 'full' : `+${T.energy[r]}` };
    case 'vitalize': return { cd, num: r === 3 ? 'Full health' : `+${T.heal[r]} health`, short: r === 3 ? 'full' : `+${T.heal[r]}` };
    case 'shadows': return { cd, num: `${T.count[r]} shadows`, short: `${T.count[r]}` };
    case 'rage': return { cd, num: `${T.mult[r]}× damage`, short: `${T.mult[r]}×` };
  }
  return { cd, num: '', short: '' };
}

// a new talent; replace = the key of an owned talent it takes the place of (when all slots are full)
export function grantTalent(p, key, rarity, replace = null) {
  if (p.talents.find((t) => t.key === key)) return;
  const t = { key, level: 1, rarity, cdMul: 1, cd: 0, cdMax: 1 };
  const at = replace ? p.talents.findIndex((x) => x.key === replace) : -1;
  if (at >= 0) { t.cdMul = p.talents[at].cdMul; t.minMul = p.talents[at].minMul; p.talents[at] = t; return; } // same button, same sacrifice bonuses
  if (p.talents.length < MAX_TALENTS) p.talents.push(t);
}

// an upgrade card raises an owned talent to the card's (higher) rarity
export function upgradeTalent(p, key, kind, rarity) {
  const t = p.talents.find((x) => x.key === key);
  if (!t) return;
  t.rarity = Math.max(t.rarity || 0, rarity);
  t.level++;
}

// Where a targeted talent lands: the mouse for keyboard players; for controllers the nearest
// enemy in the aim direction, otherwise a spot a few steps ahead.
export function talentTarget(g, p) {
  const N = g.world.N;
  let tx, ty;
  if (p.ctl === input.players[0] && p.ctl.mode === 'kbm') {
    [tx, ty] = g.mouseWorld();
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d > 10) { tx = p.x + (dx / d) * 10; ty = p.y + (dy / d) * 10; }
  } else {
    let best = null, bd = 10;
    const aim = Math.atan2(p.aimY, p.aimX);
    for (const e of g.enemies) {
      if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro') continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
      if (d < bd && Math.abs(angDiff(aim, Math.atan2(dy, dx))) < 0.7) { bd = d; best = e; }
    }
    if (best) { tx = best.x; ty = best.y; } else { tx = p.x + p.aimX * 5; ty = p.y + p.aimY * 5; }
  }
  return [clamp(tx, 1, N - 1), clamp(ty, 1, N - 1)];
}

// Performs the talent's effect (on the host / in local games).
export function activateTalent(g, p, t, tx, ty) {
  const T = TALENTS[t.key], r = t.rarity || 0;
  const partner = g.players.find((o) => o !== p && o.active);
  switch (t.key) {
    case 'arrowRain':
      g.hazards.push({ kind: 'arrows', x: tx, y: ty, r: T.radius, t: T.dur, dur: T.dur, tick: 0, dmg: T.dmg[r], from: p });
      sfx.throwKnife(); sfx.shoot();
      break;
    case 'meteor':
      g.hazards.push({ kind: 'meteor', x: tx, y: ty, r: T.radius, t: T.delay, delay: T.delay, dmg: T.dmg[r], from: p });
      sfx.bossRoar();
      break;
    case 'meditate': {
      { const before = p.energy; p.energy = Math.min(p.maxEnergy, p.energy + T.energy[r]); if (r < 3) g.fx.text(p.x, p.y, `+${Math.round(p.energy - before)} energy`, '#9ee8ff', 16); }
      g.fx.ring(p.x, p.y, 2.2, 'rgba(120,220,255,0.9)', 0.6, 6);
      g.particles.burst('glow', p.x, p.y, 0.8, 24, 2.5, 1, 2.4, '#9ee8ff');
      if (partner) { partner.energy = Math.min(partner.maxEnergy, partner.energy + T.partner[r]); g.fx.text(partner.x, partner.y, `+${T.partner[r]} energy`, '#9ee8ff', 15); }
      sfx.chime(1);
      break;
    }
    case 'vitalize': {
      const got = p.heal(T.heal[r]);
      g.fx.text(p.x, p.y, `+${Math.round(got)}`, '#7dff9a', 18);
      g.fx.ring(p.x, p.y, 2.2, 'rgba(140,255,170,0.9)', 0.6, 6);
      g.particles.burst('glow', p.x, p.y, 0.8, 24, 2.5, 1, 2.4, '#9dffb0');
      if (partner) { const n = partner.heal(T.partner[r]); g.fx.text(partner.x, partner.y, `+${Math.round(n)}`, '#7dff9a', 15); }
      sfx.chime(1);
      break;
    }
    case 'shadows':
      for (let i = 0; i < T.count[r]; i++) {
        const a = (i / T.count[r]) * TAU;
        const x = clamp(p.x + Math.cos(a) * 1.4, 1, g.world.N - 1), y = clamp(p.y + Math.sin(a) * 1.4, 1, g.world.N - 1);
        g.allies.push(new ShadowClone(g, p, x, y, T.dur, T.dmg, T.interval, i));
        g.particles.burst('ink', x, y, 0.6, 10, 2.5, 0.5, 4, '#2a1a40');
      }
      sfx.spawn();
      break;
    case 'rage':
      p.rageT = T.dur; p.rageMul = T.mult[r];
      g.fx.ring(p.x, p.y, 2.5, 'rgba(255,80,40,0.9)', 0.5, 7);
      g.particles.burst('ember', p.x, p.y, 0.8, 30, 4, 0.8, 2.6, '#ff5a2a');
      sfx.bossRoar();
      break;
  }
}

// ---------------------------------------------------------------- shadow clones
const SHADOW_PAL = { skin: '#3a2a52', cloth: '#2a1e40', cloth2: '#1c1430', sash: '#7a4ab8', hood: '#1c1430', scarf: '#7a4ab8', metal: '#b8a0ff', wood: '#2a1e40', accent: '#7a4ab8' };
let ALLY_ID = 1;

// Each clone has its own fighting style so they spread out instead of stacking on one spot:
// 0 duelist (close, slow circling), 1 flanker (takes the far side), 2 skirmisher (hit and run),
// 3 dancer (fast wide circles). They also keep apart from each other and from the players.
const CLONE_STYLES = [
  { stand: 0.95, orbit: 0.6, speed: 6.0, side: 0 },
  { stand: 1.05, orbit: -0.9, speed: 7.0, side: Math.PI },
  { stand: 1.0, orbit: 0.4, speed: 7.6, side: Math.PI / 2, hitRun: true },
  { stand: 1.25, orbit: 1.7, speed: 6.6, side: -Math.PI / 2 },
];

export class ShadowClone {
  constructor(g, owner, x, y, dur, dmg, interval, slot = 0) {
    this.g = g; this.owner = owner; this.id = ALLY_ID++;
    this.x = x; this.y = y; this.r = 0.3; this.t = dur; this.dmg = dmg; this.interval = interval;
    this.atkT = rand(0, interval); this.faceX = 1; this.faceY = 0; this.walk = 0; this.moveAmt = 0; this.anim = 0; this.side = 1;
    this.slot = slot; this.style = CLONE_STYLES[slot % CLONE_STYLES.length];
    this.orbit = rand(0, TAU); this.wob = rand(0, TAU); this.backT = 0; this.target = null;
  }
  pickTarget() {
    const g = this.g;
    let best = null, bs = 1e9;
    for (const e of g.enemies) {
      if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro') continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d > 9) continue;
      // spread out: an enemy other clones already fight counts as farther away
      let taken = 0;
      for (const o of g.allies) if (o !== this && o.target === e) taken++;
      const sc = d + taken * 1.6 + (e === this.target ? -0.8 : 0);
      if (sc < bs) { bs = sc; best = e; }
    }
    return best;
  }
  update(dt) {
    const g = this.g, S = this.style;
    this.t -= dt; this.atkT -= dt; this.anim = Math.max(0, this.anim - dt); this.backT = Math.max(0, this.backT - dt);
    this.wob += dt * (1.3 + this.slot * 0.4);
    if (!this.target || this.target.dead || Math.random() < dt * 1.5) this.target = this.pickTarget();
    const best = this.target;
    let gx, gy, speed = S.speed;
    if (best) {
      const dx = best.x - this.x, dy = best.y - this.y, d = Math.hypot(dx, dy) || 1;
      this.faceX = dx / d; this.faceY = dy / d;
      // a spot on a ring around the target, on this clone's own side, drifting around it
      this.orbit += S.orbit * dt;
      const base = Math.atan2(this.owner.y - best.y, this.owner.x - best.x) + S.side;
      const ang = base + Math.sin(this.orbit) * 0.9 + Math.sin(this.wob) * 0.25;
      const stand = (this.backT > 0 ? 2.3 : S.stand) + best.r * 0.6;
      gx = best.x + Math.cos(ang) * stand; gy = best.y + Math.sin(ang) * stand;
      if (d < 1.45 + best.r && this.atkT <= 0 && this.backT <= 0) {
        this.atkT = this.interval * rand(0.85, 1.15); this.anim = 0.2; this.side = -this.side;
        if (S.hitRun && Math.random() < 0.5) this.backT = 0.5;
        sfx.slash();
        g.fx.slash(this.x, this.y, Math.atan2(((this.faceX + this.faceY) * 16) / 0.55, (this.faceX - this.faceY) * 32), 1.2, 2, 'rgba(180,140,255,0.8)', 8, 0.14);
        for (const e of g.enemies) {
          if (e.dead || e.hidden || e.state === 'spawn' || e.state === 'intro') continue;
          const ex = e.x - this.x, ey = e.y - this.y, ed = Math.hypot(ex, ey);
          if (ed < 1.6 + e.r && Math.abs(angDiff(Math.atan2(this.faceY, this.faceX), Math.atan2(ey, ex))) < 1.1) {
            const { dmg, crit } = this.owner.rollDamage(this.dmg);
            g.damageEnemy(e, dmg, crit, ex / (ed || 1), ey / (ed || 1), 1.5, 0.1, { player: this.owner, ally: true });
          }
        }
      }
    } else {
      // no enemy near: loose formation around the owner, each clone on its own side
      const ang = (this.slot / 4) * TAU + g.time * 0.35 + Math.sin(this.wob) * 0.3;
      gx = this.owner.x + Math.cos(ang) * 1.7; gy = this.owner.y + Math.sin(ang) * 1.7;
      speed *= 0.85;
    }
    let mx = gx - this.x, my = gy - this.y;
    const md = Math.hypot(mx, my);
    const arrive = clamp(md / 0.6, 0, 1);
    if (md > 0.001) { mx = (mx / md) * arrive; my = (my / md) * arrive; }
    // keep apart from the other clones and from the players (no stacking)
    for (const o of g.allies) {
      if (o === this) continue;
      const ox = this.x - o.x, oy = this.y - o.y, od = Math.hypot(ox, oy);
      if (od < 0.8) { const k = (0.8 - od) / 0.8 * 2.2; if (od < 1e-3) { mx += Math.cos(this.slot) * k; my += Math.sin(this.slot) * k; } else { mx += (ox / od) * k; my += (oy / od) * k; } }
    }
    for (const p of g.players) {
      if (!p.active) continue;
      const ox = this.x - p.x, oy = this.y - p.y, od = Math.hypot(ox, oy);
      if (od < 0.65 && od > 1e-3) { const k = (0.65 - od) / 0.65 * 1.6; mx += (ox / od) * k; my += (oy / od) * k; }
    }
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    this.x += mx * speed * dt; this.y += my * speed * dt;
    g.world.collide(this);
    const mv = Math.min(1, ml);
    this.moveAmt = mv > 0.08 ? mv : 0; this.walk += this.moveAmt * dt * 14;
    if (this.t <= 0) g.particles.burst('ink', this.x, this.y, 0.6, 12, 3, 0.5, 4, '#2a1a40');
  }
  drawShadow(ctx) { drawShadow(ctx, isoX(this.x, this.y), isoY(this.x, this.y), 12, 0.2); }
  draw(ctx, t) {
    drawHumanoid(ctx, {
      x: isoX(this.x, this.y), y: isoY(this.x, this.y), z: 0, facing: worldDirToScreenAngle(this.faceX, this.faceY), time: t + this.id,
      walk: this.walk, move: this.moveAmt, pal: SHADOW_PAL, head: 'hood', weapon: 'katana', grip: 'down', scarf: true,
      pose: this.anim > 0 ? { kind: 'slash', side: this.side, t: 1 - this.anim / 0.2 } : null, alpha: Math.min(0.78, this.t * 2), s: 1,
    });
  }
}

export function updateAllies(g, dt) {
  for (const a of g.allies) a.update(dt);
  g.allies = g.allies.filter((a) => a.t > 0);
}

// The wandering monk (after levels 5 / 15 / 25) and his Sacrifices: a real cost for a real gain.
import { TAU, clamp, lerp, rand, ease, isoX, isoY, worldDirToScreenAngle } from './util.js';
import { drawHumanoid, drawShadow } from './rig.js';
import { sfx } from './audio.js';
import { drawStatIcon } from './staticons.js';

export const MONK_LEVELS = [5, 15, 25];

// apply(p) runs on the authoritative game (host / local). Pacts only take effect if both players choose them.
export const SACRIFICES = {
  bareBlade: {
    title: 'Oath of the Bare Blade', jp: '素刃', cost: 'Lose all talents, forever', gain: '+60% damage', gs: ['baseDamage'],
    apply(p) { p.stats.baseDamage += 0.6; p.talents = []; },
  },
  rooted: {
    title: 'Rooted Mountain', jp: '不動', cost: '−20% move speed', gain: '+40% max health & regen', cs: ['moveSpeed'], gs: ['healthRegen'],
    apply(p) { p.stats.moveSpeed *= 0.8; const k = p.hp / p.maxHp; p.maxHpMul *= 1.4; p.hp = k * p.maxHp; p.stats.healthRegen *= 1.4; },
  },
  smallCuts: {
    title: 'Thousand Small Cuts', jp: '千傷', cost: '−30% damage', gain: '−45% attack cooldowns', cs: ['baseDamage'],
    apply(p) { p.stats.baseDamage *= 0.7; p.stats.cooldownMul *= 0.55; },
  },
  covenant: {
    title: 'Elemental Covenant', jp: '元素', cost: 'No more critical hits', gain: 'Elements 2× as strong', cs: ['critChance'],
    excl: ['executioner'], apply(p) { p.noCrit = true; p.elemMul = 2; },
  },
  executioner: {
    title: 'Patient Executioner', jp: '処刑', cost: 'Attack cooldowns doubled', gain: 'Every hit is a critical hit', gs: ['critChance'],
    excl: ['covenant'], apply(p) { p.stats.cooldownMul *= 2; p.alwaysCrit = true; },
  },
  singlePath: {
    title: 'The Single Path', jp: '一道', cost: 'Keep only your first talent', gain: '−50% talent cooldown',
    excl: ['bareBlade'], needs: (p) => !p.sac.includes('bareBlade'),
    apply(p) { p.talents = p.talents.slice(0, 1); for (const t of p.talents) { t.cdMul *= 0.5; t.minMul = 0.5; } p.singlePath = true; },
  },
  bloodOffering: {
    title: 'Blood Offering', jp: '血供', cost: 'Lose 35 health now', gain: '+10% legendary chance',
    excl: ['middleWay', 'dicemaster'], apply(p) { p.hp = Math.max(1, p.hp - 35); p.bloodOffering = true; },
  },
  middleWay: {
    title: 'The Middle Way', jp: '中道', cost: 'No common or legendary cards', gain: 'Every card is rare or epic',
    excl: ['bloodOffering', 'dicemaster'], apply(p) { p.middleWay = true; },
  },
  dicemaster: {
    title: 'Dicemaster', jp: '博徒', cost: 'No rare or epic cards', gain: '1 in 4 cards is legendary',
    excl: ['middleWay', 'bloodOffering'], apply(p) { p.dicemaster = true; },
  },
  boundSouls: {
    title: 'Bound Souls', jp: '縁', coop: true, pact: true, cost: 'Both deal −20% damage', gain: 'Share all damage taken', cs: ['baseDamage'],
    apply(p) { p.bound = true; p.dmgMul = (p.dmgMul || 1) * 0.8; },
  },
  lifebinder: {
    title: 'Lifebinder', jp: '献身', coop: true, cost: 'Syphon stops healing you', gain: 'Syphon heals your partner ×1.2',
    needs: (p) => p.weapons.some((w) => w.elements.syphon > 0), apply(p) { p.lifebinder = true; },
  },
};

// rarity weights for upgrade cards [common, rare, epic, legendary], changed by sacrifices
export function rarityWeights(p, base) {
  const w = base.slice();
  if (p && p.bloodOffering) { w[3] += 10; w[0] -= 10; }
  if (p && p.middleWay) { w[0] = 0; w[3] = 0; }
  if (p && p.dicemaster) { w[0] = 75; w[1] = 0; w[2] = 0; w[3] = 25; }
  return w;
}

// two different, valid sacrifices for this player
export function rollSacrifices(p, coop) {
  const taken = new Set(p.sac);
  const pool = Object.keys(SACRIFICES).filter((k) => {
    const S = SACRIFICES[k];
    if (taken.has(k)) return false;
    if (S.coop && !coop) return false;
    if (S.excl && S.excl.some((x) => taken.has(x))) return false;
    if (S.needs && !S.needs(p)) return false;
    return true;
  });
  const out = [];
  while (out.length < 2 && pool.length) {
    const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (out.some((o) => (SACRIFICES[o].excl || []).includes(k))) continue;
    out.push(k);
  }
  return out.map((k) => ({ type: 'sacrifice', key: k, rarity: 0 }));
}

// record the choice; returns true if it is a pact that waits for the partner
export function takeSacrifice(p, key) {
  const S = SACRIFICES[key];
  if (!S) return false;
  p.sac.push(key);
  if (S.pact) return true;
  S.apply(p);
  return false;
}

// ---------------------------------------------------------------- the monk
export const MONK_LOOK = [
  { // spring: komuso with basket hat and shakuhachi
    pal: { skin: '#e2b48c', cloth: '#3a3a48', cloth2: '#26262e', sash: '#c8a050', metal: '#ddd', wood: '#c8a868' },
    head: 'komuso', robe: true, weapon: 'flute', grip: 'down',
  },
  { // autumn: old mountain hermit with a gourd staff
    pal: { skin: '#e8c8a0', cloth: '#b8a888', cloth2: '#6a5a40', sash: '#8a3a2a', wood: '#7a5a30' },
    head: 'hermit', robe: true, weapon: 'gourdstaff', grip: 'pole', fat: 0.9,
  },
  { // snow: ghostly pale monk with a paper lantern
    pal: { skin: '#dce8f4', cloth: '#e8eef8', cloth2: '#9aaac0', sash: '#5a6a8a', wood: '#3a3440' },
    head: 'ghostmonk', robe: true, weapon: 'lantern', grip: 'down', alphaMul: 0.82,
  },
];

export class Monk {
  // door: { x, y, ox, oy, house } from World.doors()
  constructor(g, door) {
    this.g = g; this.bi = g.world.bi; this.r = 0.35;
    this.x = door ? door.x : g.world.N / 2; this.y = door ? door.y : g.world.N / 2;
    this.out = door ? [door.ox, door.oy] : [this.x, this.y];
    this.state = 'emerge'; this.t = 0; this.walk = 0; this.moveAmt = 0; this.alpha = 0;
    this.faceX = 1; this.faceY = 1; this.bow = 0;
    if (door) door.house.doorT = 2.2;
  }
  get done() { return this.state === 'gone'; }
  leave() { if (this.state === 'leave' || this.state === 'gone') return; this.state = 'leave'; this.t = 0; this.bow = 0; }
  update(dt) {
    const g = this.g;
    this.t += dt;
    if (this.state === 'emerge') { // step out of the doorway
      const k = clamp(this.t / 1.1, 0, 1);
      this.x = lerp(this.x, this.out[0], 1 - Math.exp(-5 * dt)); this.y = lerp(this.y, this.out[1], 1 - Math.exp(-5 * dt));
      this.alpha = k; this.moveAmt = 0.6; this.walk += dt * 6;
      this.face(this.out[0] - this.x, this.out[1] - this.y);
      if (Math.random() < dt * 10) g.particles.emit('smoke', this.x + rand(-0.4, 0.4), this.y + rand(-0.4, 0.4), 0.2, 0, 0, 0.3, 1.2, 6, 'rgba(230,230,240,1)');
      if (k >= 1) { this.state = 'approach'; this.t = 0; }
    } else if (this.state === 'approach') { // walk toward the nearest player and stop at a respectful distance
      const p = this.nearest();
      const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;
      this.face(dx, dy);
      if (d > 2.3 && this.t < 5) {
        this.x += (dx / d) * 2.8 * dt; this.y += (dy / d) * 2.8 * dt; g.world.collide(this);
        this.moveAmt = lerp(this.moveAmt, 0.7, 0.2); this.walk += dt * 7;
      } else { this.state = 'wait'; this.t = 0; if (this.onArrive) { this.onArrive(); this.onArrive = null; } }
    } else if (this.state === 'wait') {
      this.moveAmt = lerp(this.moveAmt, 0, 0.2);
      const p = this.nearest(); this.face(p.x - this.x, p.y - this.y);
    } else if (this.state === 'leave') { // bow, then vanish in smoke
      this.bow = clamp(this.t / 0.5, 0, 1) * (this.t < 1.2 ? 1 : 0);
      if (this.t > 1.0 && !this.puffed) {
        this.puffed = true; sfx.dash();
        g.particles.burst('smoke', this.x, this.y, 0.6, 18, 2, 1.2, 9, 'rgba(235,235,245,1)');
        g.particles.burst('glow', this.x, this.y, 0.8, 14, 2, 1, 2.2, '#fff4d0');
      }
      this.alpha = this.t < 1.0 ? 1 : clamp(1 - (this.t - 1.0) / 0.3, 0, 1);
      if (this.t > 1.5) this.state = 'gone';
    }
    if (this.state !== 'leave' && Math.random() < dt * 3) g.particles.emit('glow', this.x + rand(-0.3, 0.3), this.y + rand(-0.3, 0.3), rand(0.2, 1.4), 0, 0, 0.3, 1, 1.8, this.bi === 2 ? '#bfe4ff' : '#fff0c0');
  }
  nearest() {
    let best = this.g.players[0], bd = 1e9;
    for (const p of this.g.players) { if (p.dead) continue; const d = (p.x - this.x) ** 2 + (p.y - this.y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  face(dx, dy) { const l = Math.hypot(dx, dy); if (l > 0.01) { this.faceX = dx / l; this.faceY = dy / l; } }
  drawShadow(ctx) { if (this.alpha > 0.05) drawShadow(ctx, isoX(this.x, this.y), isoY(this.x, this.y), 13, 0.25 * this.alpha); }
  draw(ctx, t) {
    if (this.state === 'gone' || this.alpha <= 0.01) return;
    const L = MONK_LOOK[this.bi] || MONK_LOOK[0];
    const sx = isoX(this.x, this.y), sy = isoY(this.x, this.y);
    // soft halo so he reads as someone special
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * this.alpha;
    const hg = ctx.createRadialGradient(sx, sy - 30, 0, sx, sy - 30, 46);
    hg.addColorStop(0, this.bi === 2 ? 'rgba(170,210,255,0.6)' : 'rgba(255,230,160,0.6)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(sx, sy - 30, 46, 0, TAU); ctx.fill(); ctx.restore();
    drawHumanoid(ctx, {
      ...L, x: sx, y: sy, z: 0, facing: worldDirToScreenAngle(this.faceX, this.faceY), time: t, walk: this.walk, move: this.moveAmt,
      alpha: this.alpha * (L.alphaMul || 1), s: 1.05, lean: this.bow * 0.45 + 0.06, flash: 0,
    });
  }
}

// ---------------------------------------------------------------- sacrifice card art
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function wrapText(ctx, str, maxW) {
  const words = str.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const test = cur ? `${cur} ${w}` : w; if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur);
  return lines;
}

// one bold symbol per sacrifice, drawn in a ±30 box (shown inside the blood moon)
function drawSacGlyph(ctx, key, col) {
  ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (key) {
    case 'bareBlade': // a lone upright blade
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(5, -22); ctx.lineTo(5, 10); ctx.lineTo(-5, 10); ctx.lineTo(-5, -22); ctx.closePath(); ctx.fill();
      ctx.fillRect(-13, 11, 26, 5); ctx.fillRect(-3.5, 16, 7, 13); break;
    case 'rooted': // a mountain
      ctx.beginPath(); ctx.moveTo(-30, 24); ctx.lineTo(-6, -20); ctx.lineTo(4, -4); ctx.lineTo(12, -14); ctx.lineTo(30, 24); ctx.closePath(); ctx.fill(); break;
    case 'smallCuts': // many small slashes
      ctx.lineWidth = 4.5;
      for (const [x, y] of [[-14, -14], [8, -18], [-18, 8], [4, 2], [16, 16], [-6, 22]]) { ctx.beginPath(); ctx.moveTo(x - 7, y + 6); ctx.lineTo(x + 7, y - 6); ctx.stroke(); }
      break;
    case 'covenant': // four element orbs
      for (const [x, y, c] of [[0, -17, '#ffe46a'], [17, 0, '#9ee4ff'], [0, 17, '#8fe05a'], [-17, 0, '#ff6b8a']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill(); break;
    case 'executioner': // an executioner's axe
      ctx.save(); ctx.rotate(-0.5);
      ctx.fillRect(-3, -26, 6, 56); // haft
      ctx.beginPath(); ctx.moveTo(2, -24); ctx.quadraticCurveTo(30, -26, 28, -6); ctx.quadraticCurveTo(26, 4, 30, 12); ctx.quadraticCurveTo(14, 4, 2, 2); ctx.closePath(); ctx.fill(); // blade
      ctx.restore(); break;
    case 'singlePath': // one road narrowing to a point
      ctx.beginPath(); ctx.moveTo(-20, 28); ctx.lineTo(-2, -20); ctx.lineTo(2, -20); ctx.lineTo(20, 28); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -25, 4.5, 0, TAU); ctx.fill(); break;
    case 'bloodOffering': // a drop of blood
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.bezierCurveTo(18, -6, 22, 8, 0, 26); ctx.bezierCurveTo(-22, 8, -18, -6, 0, -30); ctx.fill(); break;
    case 'middleWay': // a balance
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(0, 24); ctx.moveTo(-24, -14); ctx.lineTo(24, -14); ctx.moveTo(-14, 24); ctx.lineTo(14, 24); ctx.stroke();
      for (const x of [-20, 20]) { ctx.beginPath(); ctx.moveTo(x - 9, 2); ctx.lineTo(x + 9, 2); ctx.lineTo(x, -14); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(x, 2, 9, 0, Math.PI); ctx.fill(); }
      break;
    case 'dicemaster': { // two dice
      const die = (x, y, a, pips) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = col; rrect(ctx, -12, -12, 24, 24, 5); ctx.fill();
        ctx.fillStyle = '#7a0a14'; for (const [px, py] of pips) { ctx.beginPath(); ctx.arc(px * 6, py * 6, 2.6, 0, TAU); ctx.fill(); }
        ctx.restore();
      };
      die(-10, -6, -0.25, [[-1, -1], [0, 0], [1, 1]]); die(12, 10, 0.3, [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]); break;
    }
    case 'boundSouls': // two linked rings
      ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(-9, 0, 15, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(9, 0, 15, 0, TAU); ctx.stroke(); break;
    case 'lifebinder': // a heart passed on
      ctx.beginPath(); ctx.moveTo(-4, 20); ctx.bezierCurveTo(-30, 2, -18, -22, -4, -8); ctx.bezierCurveTo(10, -22, 22, 2, -4, 20); ctx.fill();
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(12, 6); ctx.lineTo(28, 6); ctx.moveTo(22, 0); ctx.lineTo(28, 6); ctx.lineTo(22, 12); ctx.stroke(); break;
  }
  ctx.restore();
}

// round badge for a cost / gain row: the stat icon when there is one, otherwise a ▼ / ▲ disc
function rowBadge(ctx, x, y, size, stat, down) {
  if (stat) { drawStatIcon(ctx, stat, x, y, size); return; }
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(16,8,10,0.95)'; ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, TAU); ctx.fill();
  ctx.strokeStyle = down ? '#ff5a5a' : '#ffcf5a'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = down ? '#ff6a6a' : '#ffcf5a'; const k = size * 0.22;
  ctx.beginPath(); if (down) { ctx.moveTo(-k, -k * 0.6); ctx.lineTo(k, -k * 0.6); ctx.lineTo(0, k); } else { ctx.moveTo(-k, k * 0.6); ctx.lineTo(k, k * 0.6); ctx.lineTo(0, -k); } ctx.closePath(); ctx.fill();
  ctx.restore();
}

// drawn in base coordinates: 230 wide, h tall, centred on the origin
export function drawSacrificeCard(ctx, card, w, h, t, st) {
  const S = SACRIFICES[card.key];
  const x0 = -w / 2, y0 = -h / 2, sel = st.hover;
  // crimson aura (stronger, with a heartbeat, on the selected card)
  const beat = sel ? Math.pow(Math.max(0, Math.sin(t * 5.2)), 6) : 0;
  ctx.save();
  ctx.shadowColor = 'rgba(210,20,30,0.95)'; ctx.shadowBlur = (24 + 8 * Math.sin(t * 2.4) + beat * 26) * (sel ? 1.35 : 1);
  rrect(ctx, x0, y0, w, h, 10); ctx.fillStyle = '#0c0608'; ctx.fill();
  ctx.restore();
  // frame: black lacquer with a crimson sheen and thin gold edges
  rrect(ctx, x0, y0, w, h, 10);
  const fg = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
  fg.addColorStop(0, '#16050a'); fg.addColorStop(0.5, '#5e0c14'); fg.addColorStop(1, '#16050a');
  ctx.fillStyle = fg; ctx.fill();
  ctx.strokeStyle = 'rgba(200,150,60,0.55)'; ctx.lineWidth = 1; rrect(ctx, x0 + 3, y0 + 3, w - 6, h - 6, 8); ctx.stroke();
  const fw = 9, ix = x0 + fw, iy = y0 + fw, iw = w - fw * 2, ih = h - fw * 2;
  rrect(ctx, ix, iy, iw, ih, 6);
  const bg = ctx.createLinearGradient(0, iy, 0, iy + ih);
  bg.addColorStop(0, '#26121a'); bg.addColorStop(1, '#120709');
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = '#b8862a'; ctx.lineWidth = 1.4; ctx.stroke();

  // header
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 11px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = '#e8b050';
  const head = S.pact ? 'CO-OP PACT' : 'SACRIFICE';
  ctx.fillText(head, 0, iy + 15);
  const hw = ctx.measureText(head).width / 2 + 12;
  for (const sx of [-1, 1]) { // blood drops either side
    ctx.fillStyle = '#d0303a'; ctx.beginPath(); const dx = sx * hw;
    ctx.moveTo(dx, iy + 9); ctx.bezierCurveTo(dx + 4, iy + 14, dx + 4, iy + 19, dx, iy + 20); ctx.bezierCurveTo(dx - 4, iy + 19, dx - 4, iy + 14, dx, iy + 9); ctx.fill();
  }

  // art: night sky, a blood moon carrying the sacrifice's symbol, a sacred rope across the top
  const ax = ix + 9, ay = iy + 28, aw = iw - 18, ah = ih * 0.38;
  ctx.save(); rrect(ctx, ax, ay, aw, ah, 4); ctx.clip();
  const ag = ctx.createLinearGradient(0, ay, 0, ay + ah); ag.addColorStop(0, '#07040a'); ag.addColorStop(1, '#3c0a12');
  ctx.fillStyle = ag; ctx.fillRect(ax, ay, aw, ah);
  const mr = ah * 0.36, my = ay + ah * 0.54;
  const mg = ctx.createRadialGradient(-mr * 0.3, my - mr * 0.3, mr * 0.1, 0, my, mr);
  mg.addColorStop(0, '#e2424a'); mg.addColorStop(1, '#8a121c');
  ctx.fillStyle = 'rgba(200,30,40,0.25)'; ctx.beginPath(); ctx.arc(0, my, mr * 1.35, 0, TAU); ctx.fill();
  ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(0, my, mr, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(60,0,8,0.25)'; for (const [cx, cy, r] of [[-0.4, -0.2, 0.18], [0.35, 0.3, 0.13], [0.1, -0.45, 0.1]]) { ctx.beginPath(); ctx.arc(cx * mr, my + cy * mr, r * mr, 0, TAU); ctx.fill(); }
  // ground silhouette: grass and a stone lantern
  ctx.fillStyle = '#0a0406'; ctx.beginPath(); ctx.moveTo(ax, ay + ah); ctx.lineTo(ax, ay + ah - 10);
  for (let i = 0; i <= 14; i++) ctx.lineTo(ax + (aw * i) / 14, ay + ah - 8 - (i % 2 ? 6 : 1) - Math.sin(i * 2.1) * 2);
  ctx.lineTo(ax + aw, ay + ah); ctx.closePath(); ctx.fill();
  const lx = ax + aw - 26, ly = ay + ah - 8;
  ctx.fillRect(lx - 3, ly - 22, 6, 22); ctx.fillRect(lx - 9, ly - 30, 18, 8); ctx.beginPath(); ctx.moveTo(lx - 12, ly - 30); ctx.lineTo(lx, ly - 38); ctx.lineTo(lx + 12, ly - 30); ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,150,70,${0.6 + 0.3 * Math.sin(t * 7)})`; ctx.fillRect(lx - 5, ly - 28, 10, 4);
  for (let i = 0; i < 12; i++) { // rising embers
    const life = (t * 0.35 + i / 12) % 1;
    ctx.fillStyle = `rgba(255,150,80,${Math.sin(life * Math.PI) * 0.8})`;
    ctx.beginPath(); ctx.arc(ax + ((i * 41.3) % aw) + Math.sin(t + i) * 3, ay + ah - life * ah, 1.3, 0, TAU); ctx.fill();
  }
  ctx.save(); ctx.translate(0, my); ctx.scale(mr / 38, mr / 38);
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6;
  drawSacGlyph(ctx, card.key, '#f8ead2');
  ctx.restore();
  // shimenawa rope with paper streamers
  ctx.strokeStyle = '#c8a868'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ax - 2, ay + 6); ctx.quadraticCurveTo(0, ay + 16, ax + aw + 2, ay + 6); ctx.stroke();
  ctx.strokeStyle = 'rgba(90,60,20,0.6)'; ctx.lineWidth = 1; for (let i = 0; i < 18; i++) { const x = ax + (aw * i) / 18, y = ay + 6 + Math.sin((i / 18) * Math.PI) * 10; ctx.beginPath(); ctx.moveTo(x - 2, y - 2); ctx.lineTo(x + 2, y + 2); ctx.stroke(); }
  for (const sx of [-0.3, 0.3]) {
    const px = sx * aw, py = ay + 6 + Math.cos(sx * Math.PI) * 10;
    // shide: a zig-zag paper streamer
    ctx.strokeStyle = '#f4efe4'; ctx.lineWidth = 2.6; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 4, py + 4); ctx.lineTo(px - 2, py + 8); ctx.lineTo(px + 4, py + 12); ctx.lineTo(px - 2, py + 16); ctx.stroke();
  }
  // the kanji as a small vermilion seal in the corner
  ctx.restore();
  ctx.save(); ctx.translate(ax + 18, ay + ah - 18); ctx.rotate(-0.08);
  ctx.fillStyle = '#b52a22'; rrect(ctx, -13, -13, 26, 26, 3); ctx.fill();
  ctx.fillStyle = '#fbefe0'; ctx.font = `800 ${S.jp.length > 1 ? 10 : 16}px "Shippori Mincho", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (S.jp.length > 1) { ctx.fillText(S.jp[0], 0, -5); ctx.fillText(S.jp[1], 0, 6); } else ctx.fillText(S.jp, 0, 1);
  ctx.restore();
  ctx.strokeStyle = '#b8862a'; ctx.lineWidth = 1.4; rrect(ctx, ax, ay, aw, ah, 4); ctx.stroke();

  // title banner
  const by = ay + ah + 9, bh = 28;
  ctx.fillStyle = '#4a0a10';
  ctx.beginPath(); ctx.moveTo(ix + 2, by); ctx.lineTo(ix + iw - 2, by); ctx.lineTo(ix + iw - 10, by + bh / 2); ctx.lineTo(ix + iw - 2, by + bh); ctx.lineTo(ix + 2, by + bh); ctx.lineTo(ix + 10, by + bh / 2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(200,140,60,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let tsz = 17; ctx.font = `800 ${tsz}px "Shippori Mincho", serif`;
  while (ctx.measureText(S.title).width > iw - 30 && tsz > 11) { tsz--; ctx.font = `800 ${tsz}px "Shippori Mincho", serif`; }
  ctx.fillStyle = '#ffe6b0'; ctx.fillText(S.title, 0, by + bh / 2 + 1);

  // cost and gain rows
  const row = (y, label, body, stat, down) => {
    const rh = 44, rx = ix + 7, rw = iw - 14;
    const g = ctx.createLinearGradient(rx, 0, rx + rw, 0);
    if (down) { g.addColorStop(0, 'rgba(150,20,30,0.55)'); g.addColorStop(1, 'rgba(70,8,14,0.4)'); } else { g.addColorStop(0, 'rgba(150,110,30,0.45)'); g.addColorStop(1, 'rgba(70,50,10,0.3)'); }
    ctx.fillStyle = g; rrect(ctx, rx, y, rw, rh, 6); ctx.fill();
    ctx.strokeStyle = down ? 'rgba(255,90,90,0.45)' : 'rgba(255,207,90,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    rowBadge(ctx, rx + 19, y + rh / 2, 24, stat, down);
    ctx.textAlign = 'left';
    ctx.font = '800 9.5px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = down ? '#ff7a7a' : '#ffcf5a';
    ctx.fillText(label, rx + 37, y + 12);
    let bs = 14; ctx.font = `800 ${bs}px "Zen Kaku Gothic New", sans-serif`;
    while (ctx.measureText(body).width > rw - 44 && bs > 9.5) { bs -= 0.5; ctx.font = `800 ${bs}px "Zen Kaku Gothic New", sans-serif`; }
    ctx.fillStyle = down ? '#ffd6d0' : '#fff2cc'; ctx.fillText(body, rx + 37, y + 29);
    ctx.textAlign = 'center';
  };
  const ry = by + bh + 10;
  row(ry, 'YOU GIVE UP', S.cost, S.cs && S.cs[0], true);
  row(ry + 52, 'YOU GAIN', S.gain, S.gs && S.gs[0], false);
  ctx.font = '700 10px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = 'rgba(255,220,180,0.62)';
  ctx.fillText(S.pact ? 'Only binds if both players choose it' : 'Permanent for this run', 0, iy + ih - 11);
  // selection outline, pulsing with the heartbeat
  if (sel) {
    ctx.save(); ctx.lineWidth = 3 + beat * 2; ctx.strokeStyle = '#ff4a4a'; ctx.globalAlpha = 0.55 + 0.45 * beat;
    rrect(ctx, x0 - 6, y0 - 6, w + 12, h + 12, 14); ctx.stroke(); ctx.restore();
  }
}

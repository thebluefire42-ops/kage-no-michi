// One icon per player stat, used everywhere a stat is shown (HUD chips, pause screen, upgrade cards,
// sacrifice cards) so a stat is always recognisable by the same shape and colour.
import { TAU } from './util.js';

export const STAT_STYLE = {
  baseDamage:   { color: '#ff6a55', short: 'DMG' },
  critChance:   { color: '#ffd23f', short: 'CRIT' },
  critDamage:   { color: '#ff9a3c', short: 'CRIT DMG' },
  moveSpeed:    { color: '#5fe0b0', short: 'MOVE' },
  cooldown:     { color: '#b9a0ff', short: 'COOLDOWN' },
  dashCd:       { color: '#7fd8ff', short: 'DASH' },
  energyRegen:  { color: '#4fc8dc', short: 'ENERGY' },
  kiCost:       { color: '#8fa8ff', short: 'ENERGY USE' },
  healthRegen:  { color: '#8ee06a', short: 'REGEN' },
  cooldownMul:  { color: '#d8f0ff', short: 'ATK CD' },   // attack cooldown (cards, sacrifices, Rage)
  highHpDmg:    { color: '#ff5f8a', short: 'UNSCATHED' },
  idleEnergy:   { color: '#9ee8e0', short: 'STILL' },
  levelDmg:     { color: '#e0b060', short: 'SEASONED' },
  perfectEnergy:{ color: '#e8f4ff', short: 'PERFECT' },
  dodgeEnergy:  { color: '#a98cff', short: 'PASSAGE' },
  openStrike:   { color: '#ff7a3a', short: 'OPENING' },
  lowHpSpeed:   { color: '#ffa94d', short: 'FOX' },
  energyHeal:   { color: '#6ee0c0', short: 'KI HEAL' },
  afterCrit:    { color: '#c8b8ff', short: 'AFTERIMAGE' },
  highEnergyDmg:{ color: '#3fb8e8', short: 'BALANCE' },
};
export const isStat = (k) => !!STAT_STYLE[k];

// Bold glyph in a ±30 unit box, drawn in `color` at scale s. Kept chunky so it still reads at ~12 px.
export function drawStatGlyph(ctx, stat, s, color) {
  ctx.save(); ctx.scale(s, s);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (stat) {
    case 'baseDamage': { // upright blade: tanto with guard and grip
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(7, -18); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.lineTo(-7, -18); ctx.closePath(); ctx.fill();
      ctx.fillRect(-14, 7, 28, 6);
      ctx.fillRect(-4.5, 14, 9, 12);
      ctx.beginPath(); ctx.arc(0, 28, 4.5, 0, TAU); ctx.fill();
      break;
    }
    case 'critChance': { // four-point shuriken
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU - Math.PI / 4;
        ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30);
        ctx.lineTo(Math.cos(a + TAU / 8) * 9, Math.sin(a + TAU / 8) * 9);
      }
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
      break;
    }
    case 'critDamage': { // jagged burst split by a slash
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, r = i % 2 ? 13 : 30; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'cooldownMul': { // attack cooldown: a small clock
      ctx.lineWidth = 6.5; ctx.beginPath(); ctx.arc(0, 2, 23, 0, TAU); ctx.stroke();
      ctx.fillRect(-5, -30, 10, 7); // the knob on top
      ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -12); ctx.moveTo(0, 2); ctx.lineTo(10, 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 2, 3.5, 0, TAU); ctx.fill();
      break;
    }
    case 'moveSpeed': { // two bold chevrons running forward
      for (const x of [-14, 8]) { ctx.beginPath(); ctx.moveTo(x - 10, -24); ctx.lineTo(x + 6, -24); ctx.lineTo(x + 22, 0); ctx.lineTo(x + 6, 24); ctx.lineTo(x - 10, 24); ctx.lineTo(x + 6, 0); ctx.closePath(); ctx.fill(); }
      break;
    }
    case 'dashCd': { // a dash: a figure-less streak, three speed lines and a forward arrowhead
      ctx.lineWidth = 6;
      for (const [y, x0] of [[-14, -26], [0, -30], [14, -22]]) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(4, y); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(6, -24); ctx.lineTo(30, 0); ctx.lineTo(6, 24); ctx.lineTo(13, 0); ctx.closePath(); ctx.fill();
      break;
    }
    case 'cooldown': { // an hourglass
      ctx.beginPath(); ctx.moveTo(-16, -28); ctx.lineTo(16, -28); ctx.lineTo(2, -1); ctx.lineTo(16, 28); ctx.lineTo(-16, 28); ctx.lineTo(-2, -1); ctx.closePath();
      ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, 26); ctx.lineTo(10, 26); ctx.lineTo(0, 12); ctx.closePath(); ctx.fill();
      break;
    }
    case 'energyRegen': { // ki: an inward spiral (uzumaki)
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const u = i / 60, a = u * TAU * 2.1, r = 3 + u * 24; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      break;
    }
    case 'kiCost': { // ki focus: a ki flame with a downward arrow beside it
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.bezierCurveTo(14, -14, 20, -2, 20, 10); ctx.bezierCurveTo(20, 24, 6, 30, 0, 30);
      ctx.bezierCurveTo(-6, 30, -20, 24, -20, 10); ctx.bezierCurveTo(-20, -2, -14, -14, 0, -30); ctx.closePath(); ctx.fill();
      break;
    }
    case 'highHpDmg': { // a full heart with a blade rising through it
      ctx.beginPath(); ctx.moveTo(-2, 30);
      ctx.bezierCurveTo(-12, 22, -32, 8, -30, -6); ctx.bezierCurveTo(-28, -22, -8, -24, -2, -10); ctx.lineTo(-2, 30); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2, 30); ctx.bezierCurveTo(12, 22, 32, 8, 30, -6); ctx.bezierCurveTo(28, -22, 8, -24, 2, -10); ctx.lineTo(2, 30); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(-3, -30, 6, 50); ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(4.5, -24); ctx.lineTo(3.5, 14); ctx.lineTo(-3.5, 14); ctx.lineTo(-4.5, -24); ctx.closePath(); ctx.fill();
      break;
    }
    case 'idleEnergy': { // stillness: a calm circle (enso) with a small ki spiral resting inside it
      ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 25, -1.2, TAU - 1.6); ctx.stroke();
      ctx.lineWidth = 5; ctx.beginPath();
      for (let i = 0; i <= 40; i++) { const u = i / 40, a = u * TAU * 1.6, r = 2 + u * 11; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      break;
    }
    case 'levelDmg': { // seasoned: three stacked chevron ranks rising
      for (const y of [16, 1, -14]) { ctx.beginPath(); ctx.moveTo(-24, y + 12); ctx.lineTo(0, y - 4); ctx.lineTo(24, y + 12); ctx.lineTo(24, y + 3); ctx.lineTo(0, y - 13); ctx.lineTo(-24, y + 3); ctx.closePath(); ctx.fill(); }
      break;
    }
    case 'perfectEnergy': { // a perfect dodge: an eye with a sharp spark in the pupil
      ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-30, 0); ctx.quadraticCurveTo(0, -26, 30, 0); ctx.quadraticCurveTo(0, 26, -30, 0); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, r = i % 2 ? 4 : 12; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill();
      break;
    }
    case 'dodgeEnergy': { // passing through: a dashed silhouette circle with a streak running straight through it
      ctx.lineWidth = 5; ctx.setLineDash([7, 6]); ctx.beginPath(); ctx.arc(2, 0, 15, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(18, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(16, -11); ctx.lineTo(31, 0); ctx.lineTo(16, 11); ctx.closePath(); ctx.fill();
      break;
    }
    case 'openStrike': { // the first cut: a blade striking a whole (unbroken) circle
      ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(-4, 6, 18, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(26, -30); ctx.lineTo(30, -24); ctx.lineTo(4, 2); ctx.lineTo(-2, -4); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(4, 4); ctx.stroke();
      break;
    }
    case 'lowHpSpeed': { // a fox's head with a single cracked heart drop below it: running when cornered
      ctx.beginPath(); ctx.moveTo(-26, -26); ctx.lineTo(-10, -12); ctx.lineTo(10, -12); ctx.lineTo(26, -26); ctx.lineTo(22, 0); ctx.lineTo(0, 22); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.ellipse(-9, -2, 4, 2.4, 0.5, 0, TAU); ctx.ellipse(9, -2, 4, 2.4, -0.5, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-30, 28); ctx.lineTo(-12, 28); ctx.moveTo(12, 28); ctx.lineTo(30, 28); ctx.stroke();
      break;
    }
    case 'energyHeal': { // ki turning into health: a spiral flowing into a cross
      ctx.lineWidth = 5; ctx.beginPath();
      for (let i = 0; i <= 40; i++) { const u = i / 40, a = u * TAU * 1.5, r = 2 + u * 13; const x = -12 + Math.cos(a) * r, y = Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.fillRect(12, -16, 9, 32); ctx.fillRect(0.5, -4.5, 32, 9);
      break;
    }
    case 'afterCrit': { // a ghost figure behind a shuriken: the strike after the dash
      ctx.globalAlpha *= 0.45; ctx.beginPath(); ctx.arc(-14, -14, 8, 0, TAU); ctx.fill(); ctx.fillRect(-21, -6, 14, 24); ctx.globalAlpha /= 0.45;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU - Math.PI / 4; ctx.lineTo(8 + Math.cos(a) * 22, 6 + Math.sin(a) * 22); ctx.lineTo(8 + Math.cos(a + TAU / 8) * 6, 6 + Math.sin(a + TAU / 8) * 6); }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'highEnergyDmg': { // a half-full ki gauge with a blade over it
      ctx.lineWidth = 5; ctx.strokeRect(-26, -10, 52, 20);
      ctx.fillRect(-22, -6, 22, 12);
      ctx.beginPath(); ctx.moveTo(4, -30); ctx.lineTo(9, -22); ctx.lineTo(8, 24); ctx.lineTo(0, 24); ctx.lineTo(-1, -22); ctx.closePath(); ctx.fill();
      break;
    }
    case 'healthRegen': { // a heart
      ctx.beginPath(); ctx.moveTo(0, 30);
      ctx.bezierCurveTo(-12, 20, -36, 4, -34, -12); ctx.bezierCurveTo(-32, -30, -8, -32, 0, -14);
      ctx.bezierCurveTo(8, -32, 32, -30, 34, -12); ctx.bezierCurveTo(36, 4, 12, 20, 0, 30); ctx.closePath(); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// Round lacquer badge: dark disc, coloured ring, glyph in the stat colour. size = diameter in px.
export function drawStatIcon(ctx, stat, x, y, size, alpha = 1) {
  const st = STAT_STYLE[stat];
  if (!st) return;
  const r = size / 2;
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha *= alpha;
  ctx.fillStyle = 'rgba(16,12,20,0.92)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = st.color; ctx.lineWidth = Math.max(1, size * 0.08); ctx.beginPath(); ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, TAU); ctx.stroke();
  drawStatGlyph(ctx, stat, (r * 0.62) / 30, st.color);
  ctx.restore();
}

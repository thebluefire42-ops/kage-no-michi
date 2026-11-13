// One icon per player stat, used everywhere a stat is shown (HUD chips, pause screen, upgrade cards,
// sacrifice cards) so a stat is always recognisable by the same shape and colour.
import { TAU } from './util.js';

export const STAT_STYLE = {
  baseDamage:   { color: '#ff6a55', short: 'DMG' },
  critChance:   { color: '#ffd23f', short: 'CRIT' },
  critDamage:   { color: '#ff9a3c', short: 'CRIT DMG' },
  moveSpeed:    { color: '#5fe0b0', short: 'MOVE' },
  dashCooldown: { color: '#b9a0ff', short: 'DASH' },
  energyRegen:  { color: '#4fc8dc', short: 'KI' },
  healthRegen:  { color: '#8ee06a', short: 'REGEN' },
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
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-30, 22); ctx.lineTo(30, -22); ctx.stroke();
      break;
    }
    case 'attackSpeed': { // three stacked slashes
      ctx.lineWidth = 7;
      for (let i = -1; i <= 1; i++) { const o = i * 15; ctx.beginPath(); ctx.moveTo(-24, 10 + o); ctx.quadraticCurveTo(-2, -2 + o, 24, -12 + o); ctx.stroke(); }
      break;
    }
    case 'moveSpeed': { // two bold chevrons running forward
      for (const x of [-14, 8]) { ctx.beginPath(); ctx.moveTo(x - 10, -24); ctx.lineTo(x + 6, -24); ctx.lineTo(x + 22, 0); ctx.lineTo(x + 6, 24); ctx.lineTo(x - 10, 24); ctx.lineTo(x + 6, 0); ctx.closePath(); ctx.fill(); }
      break;
    }
    case 'dashCooldown': { // hourglass with a dash streak
      ctx.beginPath(); ctx.moveTo(-14, -28); ctx.lineTo(18, -28); ctx.lineTo(4, -1); ctx.lineTo(18, 28); ctx.lineTo(-14, 28); ctx.lineTo(0, -1); ctx.closePath();
      ctx.lineWidth = 6; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, 26); ctx.lineTo(12, 26); ctx.lineTo(2, 12); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-30, -6); ctx.lineTo(-16, -6); ctx.moveTo(-30, 6); ctx.lineTo(-20, 6); ctx.stroke();
      break;
    }
    case 'energyRegen': { // ki: an inward spiral (uzumaki)
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const u = i / 60, a = u * TAU * 2.1, r = 3 + u * 24; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      break;
    }
    case 'healthRegen': { // lotus: round petals rising from a water line
      const petal = (a, len, wid) => { ctx.save(); ctx.translate(0, 14); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-wid, -len * 0.35, -wid * 0.6, -len, 0, -len); ctx.bezierCurveTo(wid * 0.6, -len, wid, -len * 0.35, 0, 0); ctx.fill(); ctx.restore(); };
      petal(-1.05, 26, 11); petal(1.05, 26, 11); petal(-0.5, 36, 14); petal(0.5, 36, 14); petal(0, 42, 15);
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-28, 24); ctx.quadraticCurveTo(0, 30, 28, 24); ctx.stroke();
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

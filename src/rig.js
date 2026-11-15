// Procedural character rig: ink-outlined, watercolor-filled figures drawn entirely in code.
// Local space: origin at the feet, facing right (+x), up is -y. Px at zoom 1.
import { TAU, clamp, lerp, ease } from './util.js';

export const INK = '#1a1720';
const FLASH = {
  skin: '#ffffff', cloth: '#ffffff', cloth2: '#f4f4f4', sash: '#ffffff', hood: '#ffffff', hat: '#ffffff',
  hair: '#ffffff', metal: '#ffffff', wood: '#ffffff', accent: '#ffffff', scarf: '#ffffff', eye: '#ffffff', ink: '#ffffff',
};

export function drawShadow(ctx, sx, sy, rx, alpha = 0.28) {
  ctx.fillStyle = `rgba(25,18,35,${alpha})`;
  ctx.beginPath(); ctx.ellipse(sx, sy, rx, rx * 0.42, 0, 0, TAU); ctx.fill();
}

function seg(ctx, x1, y1, x2, y2, w, color, outline = INK) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline; ctx.lineWidth = w + 2.6;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function blob(ctx, x, y, r, fill, stroke = INK, lw = 1.6) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

// Heavy crossbow, hand at the origin, pointing +x. extra = how far the string is drawn (0..1).
function drawArbalest(ctx, pal, metal, extra) {
  const wood = pal.wood || '#6a4224';
  // stock: thick, tapering to a butt behind the hand
  ctx.beginPath();
  ctx.moveTo(-10, -2.2); ctx.lineTo(22, -3.2); ctx.lineTo(23, 3.2); ctx.lineTo(-4, 3.4); ctx.lineTo(-11, 5); ctx.lineTo(-12, 1); ctx.closePath();
  ctx.fillStyle = wood; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(-9, 1.2, 31, 1.6); // groove shadow
  // trigger lever under the stock
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(1, 3); ctx.quadraticCurveTo(-2, 8, -7, 9); ctx.stroke();
  // iron bands
  ctx.fillStyle = '#4a4a54';
  for (const x of [-6, 6, 18]) { ctx.fillRect(x, -3.4, 2.2, 7); ctx.strokeStyle = INK; ctx.lineWidth = 0.7; ctx.strokeRect(x, -3.4, 2.2, 7); }
  // steel prod, thick and recurved
  const px = 18;
  const prod = () => { ctx.beginPath(); ctx.moveTo(px - 3, -14); ctx.quadraticCurveTo(px + 1, -15.5, px + 3, -8); ctx.quadraticCurveTo(px + 4.5, 0, px + 3, 8); ctx.quadraticCurveTo(px + 1, 15.5, px - 3, 14); };
  prod(); ctx.strokeStyle = INK; ctx.lineWidth = 5.2; ctx.stroke();
  prod(); ctx.strokeStyle = '#6e7682'; ctx.lineWidth = 3; ctx.stroke();
  prod(); ctx.strokeStyle = metal; ctx.globalAlpha *= 0.6; ctx.lineWidth = 0.9; ctx.stroke(); ctx.globalAlpha /= 0.6;
  // foot stirrup at the nose
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(px + 4, -3); ctx.quadraticCurveTo(px + 10, -4, px + 10, 0); ctx.quadraticCurveTo(px + 10, 4, px + 4, 3); ctx.stroke();
  // thick cord, drawn back toward the nut as it charges
  const sx = px - 3 - extra * 13;
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px - 3, -14); ctx.lineTo(sx, 0); ctx.lineTo(px - 3, 14); ctx.stroke();
  ctx.strokeStyle = '#d8ccb0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px - 3, -14); ctx.lineTo(sx, 0); ctx.lineTo(px - 3, 14); ctx.stroke();
  if (extra > 0.15) { // a heavy bolt in the groove
    ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(px + 6, 0); ctx.stroke();
    ctx.strokeStyle = '#bba070'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(px + 6, 0); ctx.stroke();
    ctx.fillStyle = metal; ctx.beginPath(); ctx.moveTo(px + 5, -2); ctx.lineTo(px + 10, 0); ctx.lineTo(px + 5, 2); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
  }
}

// ---------------- Weapons ----------------
// Drawn in a rotated frame: hand at origin, +x along the weapon.
// The Shishi shield (round lacquered war shield): a black lacquer disc, a broad gold border of foliate scrolls,
// a thin gold rope-twist ring, a red heater crest with a rampant gold lion under a plumed helm, gold acanthus
// flaring around it and four bronze scallop-shell bosses. Small sizes get a simple version: the disc, a gold
// ring, the red crest and four dots. glow (0..1): the rim lights up (Bulwark).
export function drawShishiShield(ctx, R, glow = 0) {
  const m = ctx.getTransform(), simple = R * Math.hypot(m.a, m.b) < 26;
  const GOLD = '#d9b24c', GOLD2 = '#f2d684', RED = '#b8281e', BRONZE = '#7a6243', DARK = '#3a2a14';
  ctx.fillStyle = '#17120f'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
  const crest = (s) => {
    const w = R * 0.42 * s, h = R * 0.5 * s;
    ctx.beginPath(); ctx.moveTo(-w / 2, -h * 0.5); ctx.lineTo(w / 2, -h * 0.5); ctx.lineTo(w / 2, h * 0.1);
    ctx.quadraticCurveTo(w / 2, h * 0.42, 0, h * 0.56); ctx.quadraticCurveTo(-w / 2, h * 0.42, -w / 2, h * 0.1); ctx.closePath();
  };
  const rim = () => {
    if (glow > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(255,205,110,${Math.min(1, glow)})`; ctx.lineWidth = R * 0.24; ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); ctx.stroke(); ctx.restore(); }
    ctx.strokeStyle = '#05040a'; ctx.lineWidth = Math.max(0.8, R * 0.05); ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  };
  if (simple) {
    ctx.strokeStyle = GOLD; ctx.lineWidth = R * 0.15; ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, TAU); ctx.stroke();
    crest(1.15); ctx.fillStyle = RED; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = R * 0.05; ctx.stroke();
    ctx.fillStyle = BRONZE; for (const [x, y] of [[-0.42, -0.24], [0.42, -0.24], [-0.36, 0.36], [0.36, 0.36]]) { ctx.beginPath(); ctx.arc(x * R, y * R, R * 0.085, 0, TAU); ctx.fill(); }
    rim(); return;
  }
  // a soft lacquer sheen
  const sh = ctx.createRadialGradient(-R * 0.35, -R * 0.4, 0, -R * 0.35, -R * 0.4, R * 1.1);
  sh.addColorStop(0, 'rgba(255,240,220,0.13)'); sh.addColorStop(1, 'rgba(255,240,220,0)');
  ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
  // broad gold border: foliate scrolls between two thin gold lines
  ctx.strokeStyle = GOLD; ctx.lineWidth = R * 0.022;
  for (const r of [0.95, 0.77]) { ctx.beginPath(); ctx.arc(0, 0, R * r, 0, TAU); ctx.stroke(); }
  const N = 14;
  for (let i = 0; i < N; i++) {
    ctx.save(); ctx.rotate((i / N) * TAU); ctx.translate(R * 0.86, 0); ctx.rotate(Math.PI / 2);
    ctx.strokeStyle = GOLD; ctx.lineWidth = R * 0.018;
    ctx.beginPath(); ctx.moveTo(-R * 0.13, R * 0.01); ctx.bezierCurveTo(-R * 0.06, -R * 0.07, R * 0.02, R * 0.06, R * 0.11, -R * 0.01); ctx.stroke();
    ctx.beginPath(); ctx.arc(-R * 0.13, -R * 0.015, R * 0.025, 0, TAU * 0.8); ctx.stroke();
    ctx.fillStyle = GOLD2; ctx.beginPath(); ctx.ellipse(-R * 0.01, -R * 0.035, R * 0.04, R * 0.016, -0.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(R * 0.06, R * 0.03, R * 0.035, R * 0.014, 0.6, 0, TAU); ctx.fill();
    if (i % 3 === 0) { ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(R * 0.03, -R * 0.005, R * 0.014, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  // thin rope-twist ring
  ctx.strokeStyle = GOLD; ctx.lineWidth = R * 0.01;
  for (const r of [0.73, 0.68]) { ctx.beginPath(); ctx.arc(0, 0, R * r, 0, TAU); ctx.stroke(); }
  ctx.beginPath();
  for (let i = 0; i < 60; i++) { const a = (i / 60) * TAU; ctx.moveTo(Math.cos(a) * R * 0.68, Math.sin(a) * R * 0.68); ctx.lineTo(Math.cos(a + 0.05) * R * 0.73, Math.sin(a + 0.05) * R * 0.73); }
  ctx.stroke();
  // gold acanthus leaves flaring around the crest (red tips)
  const leaf = (x, y, a, len) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.35, -len * 0.42, len * 0.62, -len * 0.18); ctx.lineTo(len * 0.7, -len * 0.3); ctx.quadraticCurveTo(len * 0.85, -len * 0.12, len, -len * 0.14);
    ctx.quadraticCurveTo(len * 0.6, len * 0.22, 0, 0); ctx.fill();
    ctx.strokeStyle = DARK; ctx.lineWidth = R * 0.008; ctx.beginPath(); ctx.moveTo(len * 0.05, 0); ctx.quadraticCurveTo(len * 0.5, -len * 0.08, len * 0.92, -len * 0.12); ctx.stroke();
    ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(len * 0.98, -len * 0.14, R * 0.018, 0, TAU); ctx.fill();
    ctx.restore();
  };
  for (const sd of [-1, 1]) {
    ctx.save(); ctx.scale(sd, 1);
    leaf(R * 0.1, -R * 0.3, -0.55, R * 0.36); leaf(R * 0.16, -R * 0.08, -0.1, R * 0.38); leaf(R * 0.16, R * 0.14, 0.45, R * 0.34); leaf(R * 0.08, R * 0.3, 1.05, R * 0.26);
    ctx.restore();
  }
  // a plumed helm above the crest
  ctx.strokeStyle = GOLD2; ctx.lineWidth = R * 0.02;
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(0, -R * 0.42); ctx.quadraticCurveTo(i * R * 0.04, -R * 0.52, i * R * 0.07, -R * 0.56); ctx.stroke(); }
  ctx.fillStyle = '#9a9aa0'; ctx.beginPath(); ctx.ellipse(0, -R * 0.37, R * 0.07, R * 0.065, 0, 0, TAU); ctx.fill();
  // the red heater crest with its rampant gold lion
  crest(1); ctx.fillStyle = RED; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = R * 0.02; ctx.stroke();
  ctx.save(); ctx.translate(0, -R * 0.02); const s = R * 0.17;
  ctx.fillStyle = GOLD; ctx.strokeStyle = DARK; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(s * 0.1, s * 0.12, s * 0.5, s * 0.26, -0.95, 0, TAU); ctx.fill(); ctx.stroke(); // rearing body
  ctx.lineWidth = s * 0.16; ctx.strokeStyle = GOLD;
  ctx.beginPath(); ctx.moveTo(-s * 0.12, -s * 0.22); ctx.lineTo(-s * 0.55, -s * 0.38); ctx.moveTo(-s * 0.1, -s * 0.05); ctx.lineTo(-s * 0.52, -s * 0.02); // raised forepaws
  ctx.moveTo(s * 0.32, s * 0.36); ctx.lineTo(s * 0.12, s * 0.82); ctx.moveTo(s * 0.4, s * 0.3); ctx.lineTo(s * 0.52, s * 0.78); ctx.stroke(); // hind legs
  ctx.lineWidth = s * 0.07; ctx.beginPath(); ctx.moveTo(s * 0.48, s * 0.1); ctx.quadraticCurveTo(s * 0.95, -s * 0.05, s * 0.66, -s * 0.48); ctx.stroke(); // tail
  ctx.beginPath(); ctx.arc(s * 0.64, -s * 0.52, s * 0.08, 0, TAU); ctx.fillStyle = GOLD; ctx.fill();
  ctx.beginPath(); ctx.arc(-s * 0.26, -s * 0.56, s * 0.22, 0, TAU); ctx.fillStyle = GOLD; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = s * 0.06; ctx.stroke(); // head and mane
  ctx.fillStyle = DARK; ctx.beginPath(); ctx.moveTo(-s * 0.46, -s * 0.56); ctx.lineTo(-s * 0.3, -s * 0.5); ctx.lineTo(-s * 0.46, -s * 0.46); ctx.fill(); // open mouth
  ctx.restore();
  // four bronze scallop-shell bosses
  for (const [x, y] of [[-0.42, -0.24], [0.42, -0.24], [-0.36, 0.36], [0.36, 0.36]]) {
    const r = R * 0.075;
    ctx.save(); ctx.translate(x * R, y * R);
    ctx.fillStyle = BRONZE; ctx.beginPath(); ctx.arc(0, r * 0.1, r, Math.PI, 0); ctx.lineTo(r * 0.3, r * 0.75); ctx.lineTo(-r * 0.3, r * 0.75); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3a2c1a'; ctx.lineWidth = r * 0.12; ctx.stroke();
    ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = Math.PI + (k + 0.5) / 5 * Math.PI; ctx.moveTo(0, r * 0.6); ctx.lineTo(Math.cos(a) * r * 0.9, r * 0.1 + Math.sin(a) * r * 0.9); } ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,180,0.35)'; ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.25, 0, TAU); ctx.fill();
    ctx.restore();
  }
  rim();
}

export function drawWeapon(ctx, kind, hx, hy, ang, pal, extra = 0) {
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(ang);
  ctx.lineJoin = 'round';
  const metal = pal.metal || '#dfe6ee';
  switch (kind) {
    // the Shishi shield: held edge-on (an ellipse), flatter on the back, round as an icon; extra = rim glow
    case 'shield': case 'shield_back': case 'shield_icon': {
      ctx.rotate(-ang);
      ctx.scale(kind === 'shield' ? 0.6 : kind === 'shield_back' ? 0.82 : 1, 1);
      drawShishiShield(ctx, kind === 'shield' ? 13 : kind === 'shield_back' ? 11.5 : 13, extra);
      break;
    }
    case 'katana': { // slim, slightly curved blade with a small dark tsuba and a wrapped grip
      ctx.fillStyle = INK; ctx.fillRect(-7.5, -1.25, 8.5, 2.5);
      ctx.fillStyle = 'rgba(230,220,200,0.55)'; for (let x = -6.5; x < 0; x += 2.2) ctx.fillRect(x, -0.8, 0.9, 1.6); // ito wrap
      ctx.fillStyle = '#2a2228'; ctx.beginPath(); ctx.ellipse(1.2, 0, 1.1, 2.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c9a54a'; ctx.fillRect(1.9, -0.9, 1.2, 1.8); // habaki
      ctx.beginPath(); ctx.moveTo(3, -0.85); ctx.quadraticCurveTo(16, -1.7, 29, -3.9); ctx.lineTo(26.5, -2.3); ctx.quadraticCurveTo(15, -0.1, 3, 0.75); ctx.closePath();
      ctx.fillStyle = metal; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.55;
      ctx.beginPath(); ctx.moveTo(4.5, -0.45); ctx.quadraticCurveTo(15, -1.2, 26.5, -3.1); ctx.stroke();
      break;
    }
    case 'saya': case 'saya_long': { // sheathed sword (carried, not held)
      const L = kind === 'saya' ? 23 : 36, W = kind === 'saya' ? 1.7 : 2.4, H = kind === 'saya' ? 7 : 10;
      ctx.fillStyle = '#1e1820'; ctx.fillRect(-H, -W, H, W * 2);
      ctx.fillStyle = 'rgba(230,220,200,0.6)';
      for (let i = -H + 1.5; i < -0.5; i += 2.4) ctx.fillRect(i, -W * 0.6, 1, W * 1.2);
      ctx.fillStyle = '#c9a54a'; ctx.beginPath(); ctx.ellipse(0.5, 0, 1.2, W + 1.6, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(1.5, -W); ctx.quadraticCurveTo(L * 0.5, -W - 1, L, -W * 0.6); ctx.lineTo(L, W * 0.6); ctx.quadraticCurveTo(L * 0.5, W + 0.6, 1.5, W); ctx.closePath();
      ctx.fillStyle = kind === 'saya' ? '#3a1a22' : '#22181c'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#c9a54a'; ctx.fillRect(L - 3, -W * 0.7, 3, W * 1.4);
      break;
    }
    case 'crossbow_back': { // strapped on the back, prod up behind the shoulder
      ctx.scale(0.8, 0.8);
      drawArbalest(ctx, pal, metal, 0);
      break;
    }
    case 'tanto': {
      ctx.fillStyle = INK; ctx.fillRect(-5, -1.4, 6, 2.8);
      ctx.beginPath(); ctx.moveTo(1, -1.2); ctx.lineTo(12, -1.4); ctx.lineTo(14, 0); ctx.lineTo(1, 1.2); ctx.closePath();
      ctx.fillStyle = metal; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      break;
    }
    case 'nodachi': { // zanbato: a long two-hand grip, a heavy iron guard and a broad, thick slab of a blade
      ctx.fillStyle = INK; ctx.fillRect(-13, -2.4, 14, 4.8);
      ctx.fillStyle = 'rgba(200,170,120,0.6)'; for (let x = -12; x < 0; x += 2.6) ctx.fillRect(x, -1.6, 1.1, 3.2);
      ctx.fillStyle = '#3a3238'; ctx.beginPath(); ctx.ellipse(1.8, 0, 2.6, 6.2, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#b8862e'; ctx.fillRect(3.6, -2.8, 2, 5.6);
      // blade: wide spine, squared heavy tip
      ctx.beginPath(); ctx.moveTo(5.5, -3.2); ctx.quadraticCurveTo(24, -4.6, 43, -6.4); ctx.lineTo(45, -2.5); ctx.lineTo(41, 3.4); ctx.quadraticCurveTo(23, 4.4, 5.5, 3.6); ctx.closePath();
      ctx.fillStyle = '#9aa2ac'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
      // bright cutting edge along the bottom, dark spine, fuller groove
      ctx.beginPath(); ctx.moveTo(6, 1.4); ctx.quadraticCurveTo(23, 2.2, 40.5, 1.6); ctx.lineTo(41, 3.4); ctx.quadraticCurveTo(23, 4.4, 5.5, 3.6); ctx.closePath();
      ctx.fillStyle = metal; ctx.fill();
      ctx.strokeStyle = 'rgba(30,30,40,0.55)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(8, -1.4); ctx.quadraticCurveTo(22, -2.3, 34, -3.6); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(8, 2.4); ctx.quadraticCurveTo(23, 3.2, 39, 2.6); ctx.stroke();
      break;
    }
    case 'crossbow': { // heavy arbalest: thick banded stock, steel prod, foot stirrup (drawn a bit compact)
      ctx.scale(0.82, 0.82);
      drawArbalest(ctx, pal, metal, extra);
      break;
    }
    case 'kunai_volley': { // three kunai flying side by side in an arrowhead, each with motion streaks behind it
      for (const [dx, dy] of [[-5, -7], [0, 0], [-5, 7]]) {
        ctx.save(); ctx.translate(dx, dy);
        ctx.lineCap = 'round';
        for (const [sy, len, a] of [[-1.2, 10, 0.45], [0, 15, 0.7], [1.2, 8, 0.35]]) { // speed lines
          ctx.strokeStyle = `rgba(235,240,250,${a})`; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(-8, sy); ctx.lineTo(-8 - len, sy); ctx.stroke();
        }
        drawWeapon(ctx, 'kunai', 0, 0, 0, pal);
        ctx.restore();
      }
      break;
    }
    case 'kunai': {
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(-4, 0, 1.8, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#5a3f2c'; ctx.fillRect(-2.5, -1, 4, 2);
      ctx.beginPath(); ctx.moveTo(1.5, 0); ctx.lineTo(5, -2.2); ctx.lineTo(11, 0); ctx.lineTo(5, 2.2); ctx.closePath();
      ctx.fillStyle = '#9aa3ad'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.stroke();
      break;
    }
    case 'spear': case 'naginata': {
      seg(ctx, -18, 0, 30, 0, 2.2, pal.wood || '#6b4a2b');
      if (kind === 'spear') {
        ctx.beginPath(); ctx.moveTo(29, -1.6); ctx.lineTo(42, 0); ctx.lineTo(29, 1.6); ctx.closePath();
      } else {
        ctx.beginPath(); ctx.moveTo(29, -1.6); ctx.quadraticCurveTo(40, -2, 47, -7); ctx.quadraticCurveTo(42, 1, 29, 1.8); ctx.closePath();
      }
      ctx.fillStyle = metal; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = pal.accent || '#a33'; ctx.fillRect(26, -2, 3, 4);
      break;
    }
    case 'bow': {
      const pull = extra * 9;
      ctx.strokeStyle = INK; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-1, -28); ctx.quadraticCurveTo(9 + pull * 0.2, -6, 0, 12); ctx.stroke();
      ctx.strokeStyle = '#6b4024'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(-1, -28); ctx.quadraticCurveTo(9 + pull * 0.2, -6, 0, 12); ctx.stroke();
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(-1, -28); ctx.lineTo(-pull, -4); ctx.lineTo(0, 12); ctx.stroke();
      if (extra > 0.2) { ctx.strokeStyle = '#d8c9a8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-pull, -4); ctx.lineTo(16, -4); ctx.stroke(); }
      break;
    }
    case 'club': {
      ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(30, -5); ctx.quadraticCurveTo(34, 0, 30, 5); ctx.lineTo(-6, 2); ctx.closePath();
      ctx.fillStyle = pal.club || '#3a3440'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = '#9a96a6';
      for (let i = 6; i < 30; i += 5) for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(i, s * (1.5 + i * 0.1), 1.1, 0, TAU); ctx.fill(); }
      break;
    }
    case 'fan': {
      seg(ctx, -2, 0, 8, 0, 2, '#4a3020');
      for (let i = -3; i <= 3; i++) {
        const a = i * 0.28;
        ctx.save(); ctx.translate(8, 0); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(10, 0, 10, 3, 0, 0, TAU);
        ctx.fillStyle = i % 2 ? '#2a2a32' : '#3d3a48'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'staff': { // shakujo: dark lacquered shaft, a gold ringed finial, a paper talisman and a faint spirit glow
      // spirit glow around the head
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(31, 0, 0, 31, 0, 11);
      gg.addColorStop(0, 'rgba(150,210,255,0.5)'); gg.addColorStop(1, 'rgba(150,210,255,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(31, 0, 11, 0, TAU); ctx.fill(); ctx.restore();
      // shaft
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(25, 0); ctx.stroke();
      ctx.strokeStyle = '#2a1812'; ctx.lineWidth = 1.7; ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(25, 0); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,190,150,0.25)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(-15, -0.5); ctx.lineTo(23, -0.5); ctx.stroke();
      ctx.fillStyle = '#c9a54a'; for (const x of [-16.5, 8, 23]) ctx.fillRect(x, -1.4, 1.6, 2.8); // gold collars
      // finial: a pointed gold loop (like a flame-shaped jewel) on a short neck, with jingling rings
      ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
      const loop = () => { ctx.beginPath(); ctx.moveTo(25, 0); ctx.bezierCurveTo(27, -7.5, 34, -7.5, 36, -2.5); ctx.lineTo(38.5, 0); ctx.lineTo(36, 2.5); ctx.bezierCurveTo(34, 7.5, 27, 7.5, 25, 0); };
      loop(); ctx.stroke(); loop(); ctx.strokeStyle = '#d8b050'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.strokeStyle = '#d8b050'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(37, 0); ctx.stroke(); // centre spine
      ctx.fillStyle = '#f0d070'; ctx.beginPath(); ctx.arc(31.5, 0, 1.3, 0, TAU); ctx.fill(); // jewel
      ctx.lineWidth = 0.9; ctx.strokeStyle = '#e8c870';
      for (const [rx, ry] of [[27.5, -5.2], [31, -6.2], [34.5, -5], [27.5, 5.2], [31, 6.2], [34.5, 5]]) { ctx.beginPath(); ctx.arc(rx, ry + Math.sign(ry) * 1.2, 1.5, 0, TAU); ctx.stroke(); }
      break;
    }
    case 'spiritorb': { // a scholar's floating blue spirit orb, held out in the hand
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const og = ctx.createRadialGradient(6, 0, 0, 6, 0, 13); og.addColorStop(0, 'rgba(170,220,255,0.75)'); og.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(6, 0, 13, 0, TAU); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#5aa8ff'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(6, 0, 5.5, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8f6ff'; ctx.beginPath(); ctx.arc(4.4, -1.8, 1.8, 0, TAU); ctx.fill();
      break;
    }
    case 'holystaff': { // the player's Holy Staff: an ivory-white shaft wound with gold, a radiant gold finial
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; // warm holy light around the head
      const hg = ctx.createRadialGradient(31, 0, 0, 31, 0, 14);
      hg.addColorStop(0, 'rgba(255,236,160,0.7)'); hg.addColorStop(0.5, 'rgba(255,220,120,0.25)'); hg.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(31, 0, 14, 0, TAU); ctx.fill(); ctx.restore();
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(25, 0); ctx.stroke();
      ctx.strokeStyle = '#f6f1e2'; ctx.lineWidth = 1.9; ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(25, 0); ctx.stroke(); // white shaft
      ctx.strokeStyle = '#d8a838'; ctx.lineWidth = 0.9; // a gold ribbon wound around it
      for (let x = -14; x < 22; x += 4) { ctx.beginPath(); ctx.moveTo(x, 1); ctx.lineTo(x + 2.2, -1); ctx.stroke(); }
      ctx.fillStyle = '#f0c850'; for (const x of [-17.5, 8, 23]) { ctx.fillRect(x, -1.7, 2, 3.4); } // gold collars
      ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
      const loop = () => { ctx.beginPath(); ctx.moveTo(25, 0); ctx.bezierCurveTo(27, -7.5, 34, -7.5, 36, -2.5); ctx.lineTo(38.5, 0); ctx.lineTo(36, 2.5); ctx.bezierCurveTo(34, 7.5, 27, 7.5, 25, 0); };
      loop(); ctx.stroke(); loop(); ctx.strokeStyle = '#f4cc58'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = '#fff4c8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(37, 0); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(31.5, 0, 1.6, 0, TAU); ctx.fill(); // a white jewel
      ctx.strokeStyle = 'rgba(255,240,180,0.85)'; ctx.lineWidth = 0.8; // small rays from the jewel
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; ctx.beginPath(); ctx.moveTo(31.5 + Math.cos(a) * 2.6, Math.sin(a) * 2.6); ctx.lineTo(31.5 + Math.cos(a) * 4, Math.sin(a) * 4); ctx.stroke(); }
      ctx.lineWidth = 0.9; ctx.strokeStyle = '#f4d070';
      for (const [rx, ry] of [[27.5, -5.2], [31, -6.2], [34.5, -5], [27.5, 5.2], [31, 6.2], [34.5, 5]]) { ctx.beginPath(); ctx.arc(rx, ry + Math.sign(ry) * 1.2, 1.5, 0, TAU); ctx.stroke(); }
      break;
    }
    case 'bo': { // long wooden fighting stick with bound ends; extra = slide along the stick
      // slim, dark hardwood: reads as quick and tactical rather than a heavy club
      if (extra) ctx.translate(extra * 12, 0);
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(32, 0); ctx.stroke();
      ctx.strokeStyle = '#6a3e22'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(32, 0); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,180,0.35)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(-20, -0.4); ctx.lineTo(30, -0.4); ctx.stroke();
      ctx.fillStyle = '#1a1210';
      for (const x of [-19, 29]) ctx.fillRect(x, -1.2, 1, 2.4);
      // the grip: cloth tape wound round the middle, where the hands go
      ctx.fillStyle = '#d8ccae'; ctx.fillRect(-1, -1.55, 12, 3.1);
      ctx.strokeStyle = INK; ctx.lineWidth = 0.5; ctx.strokeRect(-1, -1.55, 12, 3.1);
      ctx.strokeStyle = 'rgba(90,70,40,0.75)'; ctx.lineWidth = 0.45;
      for (let x = 0; x < 11; x += 1.7) { ctx.beginPath(); ctx.moveTo(x, 1.55); ctx.lineTo(x + 1.2, -1.55); ctx.stroke(); }
      break;
    }
    case 'flute': { // shakuhachi
      seg(ctx, -3, 0, 17, 0, 2.4, '#c8a868');
      ctx.fillStyle = '#5a4020'; for (const x of [4, 9, 14]) ctx.fillRect(x, -1.4, 0.9, 2.8);
      break;
    }
    case 'gourdstaff': { // gnarled staff with a hanging gourd
      seg(ctx, -16, 0, 26, 0, 1.9, '#6a4a28');
      ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(22, 5); ctx.stroke();
      blob(ctx, 22, 7, 2.2, '#d8a040'); blob(ctx, 22, 11, 3.2, '#d8a040');
      break;
    }
    case 'lantern': { // paper lantern on a short pole
      seg(ctx, -2, 0, 12, 0, 1.5, '#3a3440');
      ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(12, 3); ctx.stroke();
      ctx.save(); ctx.translate(12, 9); ctx.rotate(-ang);
      ctx.fillStyle = 'rgba(255,220,150,0.35)'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff0c8'; ctx.beginPath(); ctx.ellipse(0, 0, 4.2, 5.5, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = 'rgba(160,60,40,0.7)'; ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(4, -2); ctx.moveTo(-4, 2); ctx.lineTo(4, 2); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'firejar': {
      blob(ctx, 4, 0, 4.2, '#8a4a2a');
      ctx.fillStyle = Math.random() > 0.5 ? '#ffd35a' : '#ff6a2a'; ctx.beginPath(); ctx.moveTo(2, -3.5); ctx.quadraticCurveTo(4, -10, 6, -3.5); ctx.fill();
      break;
    }
    case 'bomb': {
      blob(ctx, 4, 0, 4.5, '#2a2730');
      ctx.strokeStyle = '#a07a40'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(6, -3.5); ctx.quadraticCurveTo(8, -7, 10, -6); ctx.stroke();
      ctx.fillStyle = Math.random() > 0.5 ? '#ffd35a' : '#ff7a2a'; ctx.beginPath(); ctx.arc(10, -6, 1.6, 0, TAU); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// ---------------- Heads ----------------
function drawHead(ctx, kind, hx, hy, pal, back, t, o) {
  const r = 6.3;
  switch (kind) {
    case 'hood': case 'mask': {
      // hood tails flutter behind
      const fl = Math.sin(t * 12) * 1.5;
      ctx.fillStyle = pal.hood;
      ctx.beginPath(); ctx.moveTo(hx - 5, hy - 1); ctx.quadraticCurveTo(hx - 12, hy - 2 + fl, hx - 16, hy + 1 + fl * 1.4); ctx.lineTo(hx - 14, hy + 3 + fl); ctx.quadraticCurveTo(hx - 10, hy + 1, hx - 4, hy + 2); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
      blob(ctx, hx, hy, r, pal.hood);
      if (!back) {
        ctx.fillStyle = pal.skin;
        ctx.beginPath(); ctx.ellipse(hx + 2.6, hy - 0.8, 4.2, 1.9, 0, 0, TAU); ctx.fill();
        if (kind === 'mask') {
          ctx.fillStyle = pal.eye || '#b48cff';
          ctx.beginPath(); ctx.arc(hx + 4.2, hy - 0.9, 1.2, 0, TAU); ctx.arc(hx + 1.3, hy - 0.9, 0.9, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = INK;
          ctx.fillRect(hx + 3.4, hy - 1.6, 1.6, 1.6); ctx.fillRect(hx + 0.9, hy - 1.5, 1.2, 1.4);
        }
      } else {
        // knot at back of hood
        ctx.fillStyle = pal.sash || pal.hood; ctx.beginPath(); ctx.arc(hx - 4, hy - 1, 2, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'bandana': {
      blob(ctx, hx, hy, r, pal.skin);
      ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.arc(hx - 1, hy - 1.5, r, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx - 2, hy - 7.5, 2.4, 2, 0.4, 0, TAU); ctx.fill(); // topknot
      ctx.fillStyle = pal.accent; ctx.fillRect(hx - r, hy - 3.2, r * 2, 2.2);
      const fl = Math.sin(t * 9) * 1.4;
      ctx.beginPath(); ctx.moveTo(hx - r, hy - 2.5); ctx.lineTo(hx - r - 7, hy - 1 + fl); ctx.lineTo(hx - r - 6, hy + 1 + fl); ctx.closePath(); ctx.fill();
      if (!back) { ctx.fillStyle = INK; ctx.fillRect(hx + 3.2, hy - 0.4, 1.5, 1.6); ctx.fillStyle = 'rgba(40,30,30,0.35)'; ctx.beginPath(); ctx.arc(hx + 3, hy + 3.2, 2.6, 0, Math.PI); ctx.fill(); }
      break;
    }
    case 'kasa': case 'jingasa': {
      blob(ctx, hx, hy, r, pal.skin);
      if (!back) { ctx.fillStyle = INK; ctx.fillRect(hx + 3.2, hy - 0.2, 1.5, 1.5); }
      const wide = kind === 'kasa' ? 13 : 11, tall = kind === 'kasa' ? 8 : 4.5;
      ctx.beginPath(); ctx.moveTo(hx - wide, hy - 2.5); ctx.quadraticCurveTo(hx, hy - 4.5, hx + wide + 1, hy - 2.5); ctx.lineTo(hx + 0.5, hy - 2.5 - tall); ctx.closePath();
      ctx.fillStyle = pal.hat; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
      if (kind === 'kasa') {
        ctx.strokeStyle = 'rgba(80,60,30,0.5)'; ctx.lineWidth = 0.7;
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(hx + 0.5, hy - 10.5); ctx.lineTo(hx + i * 5, hy - 3); ctx.stroke(); }
      } else { ctx.fillStyle = pal.accent || '#c33'; ctx.beginPath(); ctx.arc(hx + 2, hy - 5, 1.4, 0, TAU); ctx.fill(); }
      break;
    }
    case 'eboshi': {
      blob(ctx, hx, hy, r, pal.skin);
      ctx.beginPath(); ctx.moveTo(hx - 5, hy - 3); ctx.lineTo(hx - 3, hy - 15); ctx.quadraticCurveTo(hx + 2, hy - 17, hx + 4, hy - 12); ctx.lineTo(hx + 5, hy - 3); ctx.closePath();
      ctx.fillStyle = '#16141c'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      if (!back) { ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx + 2.4, hy - 0.4); ctx.lineTo(hx + 5, hy - 0.4); ctx.stroke(); ctx.fillStyle = '#e8e2d8'; ctx.beginPath(); ctx.moveTo(hx + 2, hy + 3); ctx.lineTo(hx + 4, hy + 8); ctx.lineTo(hx + 0, hy + 4); ctx.fill(); }
      break;
    }
    case 'kabuto': {
      blob(ctx, hx, hy + 0.5, r, '#7a2a24'); // menpo mask (red)
      if (!back) {
        ctx.fillStyle = '#f2d2a0'; ctx.fillRect(hx + 1, hy - 1.8, 5, 1.6);
        ctx.fillStyle = INK; ctx.fillRect(hx + 3.4, hy - 1.6, 1.4, 1.2);
        ctx.strokeStyle = '#f5f0e0'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(hx + 1, hy + 3); ctx.lineTo(hx + 6, hy + 3); ctx.stroke();
      }
      // neck guard (shikoro)
      ctx.fillStyle = '#26232e';
      ctx.beginPath(); ctx.moveTo(hx - 9, hy + 3); ctx.lineTo(hx - 7, hy - 3); ctx.lineTo(hx + 4, hy - 3); ctx.lineTo(hx + 6, hy + 1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8a2a20'; ctx.lineWidth = 0.8; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(hx - 8 + i * 0.6, hy - 1 + i * 1.4); ctx.lineTo(hx + 4.5, hy - 2 + i * 1.2); ctx.stroke(); }
      // dome
      ctx.beginPath(); ctx.arc(hx, hy - 3, 7, Math.PI, TAU); ctx.closePath();
      ctx.fillStyle = '#2e2b36'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
      // golden crescent maedate
      ctx.fillStyle = '#e8c04a'; ctx.strokeStyle = '#7a5a10'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(hx + 1, hy - 9); ctx.quadraticCurveTo(hx - 10, hy - 14, hx - 11, hy - 22); ctx.quadraticCurveTo(hx - 5, hy - 13, hx + 1, hy - 11);
      ctx.quadraticCurveTo(hx + 7, hy - 13, hx + 13, hy - 22); ctx.quadraticCurveTo(hx + 12, hy - 14, hx + 1, hy - 9); ctx.fill(); ctx.stroke();
      break;
    }
    case 'tengu': {
      // white mane
      ctx.fillStyle = '#f0ece4';
      for (let i = 0; i < 7; i++) { const a = Math.PI * 0.5 + i * 0.42; const fl = Math.sin(t * 6 + i) * 1.2; ctx.beginPath(); ctx.ellipse(hx - 2 + Math.cos(a) * 6, hy + Math.sin(a) * 5 + fl, 4, 2.4, a, 0, TAU); ctx.fill(); }
      blob(ctx, hx, hy, r + 0.5, '#c8302a');
      if (!back) {
        // long nose
        ctx.beginPath(); ctx.moveTo(hx + 3, hy - 1.5); ctx.quadraticCurveTo(hx + 12, hy - 2.5, hx + 15, hy - 0.5); ctx.quadraticCurveTo(hx + 11, hy + 1.6, hx + 3, hy + 1.6); ctx.closePath();
        ctx.fillStyle = '#d63a30'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.1; ctx.stroke();
        ctx.fillStyle = '#ffd94a'; ctx.beginPath(); ctx.arc(hx + 2, hy - 3, 1.3, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hx - 0.5, hy - 5.5); ctx.lineTo(hx + 4.5, hy - 4); ctx.stroke();
      }
      // tokin cap
      ctx.fillStyle = '#18161e'; ctx.beginPath(); ctx.moveTo(hx - 2, hy - 5.5); ctx.lineTo(hx + 2, hy - 11); ctx.lineTo(hx + 5, hy - 5); ctx.closePath(); ctx.fill();
      break;
    }
    case 'oni': {
      ctx.fillStyle = pal.hair;
      for (let i = 0; i < 6; i++) { const a = Math.PI * 0.7 + i * 0.32; const fl = Math.sin(t * 5 + i) * 1; ctx.beginPath(); ctx.ellipse(hx - 1 + Math.cos(a) * 6, hy - 1 + Math.sin(a) * 5 + fl, 4, 2.6, a, 0, TAU); ctx.fill(); }
      blob(ctx, hx, hy, r + 0.6, pal.skin);
      // horns
      ctx.fillStyle = '#efe6cf'; ctx.strokeStyle = INK; ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(hx + s * 2.5 - 1, hy - 5); ctx.quadraticCurveTo(hx + s * 6, hy - 10, hx + s * 4 + 1, hy - 15); ctx.quadraticCurveTo(hx + s * 3 + 2, hy - 9, hx + s * 0.5 + 1, hy - 5.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      if (!back) {
        ctx.fillStyle = pal.eye || '#ffe04a'; ctx.beginPath(); ctx.ellipse(hx + 3.2, hy - 1.5, 1.6, 1.1, -0.3, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(hx + 0.5, hy - 4); ctx.lineTo(hx + 5.5, hy - 2.6); ctx.stroke();
        ctx.fillStyle = '#2a0f10'; ctx.beginPath(); ctx.ellipse(hx + 3.5, hy + 3, 2.8, 1.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(hx + 2, hy + 2); ctx.lineTo(hx + 2.8, hy + 4.4); ctx.lineTo(hx + 3.5, hy + 2); ctx.moveTo(hx + 4.6, hy + 2); ctx.lineTo(hx + 5.2, hy + 4.2); ctx.lineTo(hx + 5.8, hy + 2.2); ctx.fill();
      }
      break;
    }
    case 'sumo': { // round face, oiled topknot
      blob(ctx, hx, hy, r + 0.8, pal.skin);
      ctx.fillStyle = '#1a1414'; ctx.beginPath(); ctx.arc(hx - 1, hy - 2, r + 0.4, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx - 1, hy - 9, 3.4, 2, 0, 0, TAU); ctx.fill();
      if (!back) { ctx.fillStyle = INK; ctx.fillRect(hx + 3, hy - 1, 1.6, 1.4); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx + 2, hy + 3.5); ctx.lineTo(hx + 5.5, hy + 3); ctx.stroke(); }
      break;
    }
    case 'crow': { // karasu-tengu: black feathered head, yellow beak
      blob(ctx, hx, hy, r, pal.hood || '#1e1c26');
      ctx.fillStyle = pal.hood || '#1e1c26';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(hx - 5 - i, hy - 3 + i * 2, 3.5, 1.3, -0.6, 0, TAU); ctx.fill(); }
      if (!back) {
        ctx.beginPath(); ctx.moveTo(hx + 4, hy - 2); ctx.lineTo(hx + 12, hy + 1.5); ctx.lineTo(hx + 4, hy + 2.5); ctx.closePath();
        ctx.fillStyle = '#e8b830'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#ffd040'; ctx.beginPath(); ctx.arc(hx + 2.5, hy - 2.5, 1.3, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#16141c'; ctx.beginPath(); ctx.moveTo(hx - 2, hy - 5.5); ctx.lineTo(hx + 1.5, hy - 10); ctx.lineTo(hx + 4, hy - 5); ctx.closePath(); ctx.fill();
      break;
    }
    case 'fox': { // kitsune mask: white face, red markings, tall ears
      ctx.fillStyle = pal.hair || '#f4f0e8';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + s * 2.5 - 1, hy - 4); ctx.lineTo(hx + s * 4 + 1, hy - 13); ctx.lineTo(hx + s * 5.5 + 2, hy - 3); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke(); }
      blob(ctx, hx, hy, r, pal.hair || '#f4f0e8');
      if (!back) {
        ctx.beginPath(); ctx.moveTo(hx + 3, hy - 1); ctx.quadraticCurveTo(hx + 10, hy + 1, hx + 11, hy + 2.5); ctx.lineTo(hx + 3, hy + 3.5); ctx.closePath();
        ctx.fillStyle = pal.hair || '#f4f0e8'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = '#d0302a'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(hx + 1, hy - 3); ctx.quadraticCurveTo(hx + 3.5, hy - 4.5, hx + 5.5, hy - 2.5); ctx.moveTo(hx - 1.5, hy - 2); ctx.lineTo(hx - 0.5, hy - 5.5); ctx.stroke();
        ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(hx + 4, hy - 1.2, 1.4, 0.6, -0.3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d0302a'; ctx.beginPath(); ctx.arc(hx + 11, hy + 2.2, 0.9, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'tokin': { // yamabushi: face, small black cap, pompom collar
      blob(ctx, hx, hy, r, pal.skin);
      if (!back) { ctx.fillStyle = INK; ctx.fillRect(hx + 3.2, hy - 0.6, 1.5, 1.4); ctx.fillStyle = '#d8d0c4'; ctx.beginPath(); ctx.moveTo(hx + 1, hy + 3); ctx.lineTo(hx + 4, hy + 7); ctx.lineTo(hx - 1, hy + 4.5); ctx.fill(); }
      ctx.fillStyle = '#16141c'; ctx.beginPath(); ctx.moveTo(hx - 2, hy - 5.5); ctx.lineTo(hx + 1.5, hy - 11); ctx.lineTo(hx + 4.5, hy - 5); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? '#e8e0d0' : '#c8302a'; ctx.beginPath(); ctx.arc(hx - 4 + i * 4, hy + 7.5, 1.8, 0, TAU); ctx.fill(); }
      break;
    }
    case 'kodama': { // tree spirit: pale round head with hollow eyes, leaf sprout
      blob(ctx, hx, hy, r + 0.8, pal.skin);
      if (!back) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(hx + 1, hy - 1.5, 1.4, 0, TAU); ctx.arc(hx + 4.5, hy - 1.2, 1.2, 0, TAU); ctx.ellipse(hx + 3, hy + 2.6, 1, 1.4, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#6aa04a'; ctx.beginPath(); ctx.ellipse(hx - 1, hy - 8.5, 3.6, 1.6, -0.5, 0, TAU); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
      break;
    }
    case 'komuso': { // woven basket hat covering the whole head
      ctx.fillStyle = '#c8a868'; ctx.beginPath(); ctx.ellipse(hx, hy - 1, r + 1.6, r + 3.2, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = 'rgba(90,60,30,0.7)'; ctx.lineWidth = 0.8;
      for (let k = -2; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(hx - r - 1, hy + k * 2.2 - 1); ctx.quadraticCurveTo(hx, hy + k * 2.2 + 0.8, hx + r + 1, hy + k * 2.2 - 1); ctx.stroke(); }
      if (!back) { ctx.fillStyle = 'rgba(20,10,10,0.55)'; ctx.fillRect(hx + 1, hy - 1.5, 5, 1.6); }
      break;
    }
    case 'hermit': { // old mountain hermit: bald, long white beard and brows
      blob(ctx, hx, hy, r, pal.skin);
      ctx.fillStyle = '#f2f0ea';
      if (!back) {
        ctx.beginPath(); ctx.moveTo(hx + 0.5, hy + 1); ctx.quadraticCurveTo(hx + 6, hy + 2, hx + 4, hy + 14 + Math.sin(t * 2) * 0.8); ctx.quadraticCurveTo(hx + 1, hy + 9, hx - 2, hy + 3); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.fillRect(hx + 1.5, hy - 2.6, 4, 1.2);
      }
      ctx.beginPath(); ctx.arc(hx - 3.5, hy, 2.4, 0, TAU); ctx.fill();
      break;
    }
    case 'ghostmonk': { // pale bald monk with closed eyes
      blob(ctx, hx, hy, r, pal.skin);
      if (!back) { ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(hx + 0.8, hy - 0.8); ctx.lineTo(hx + 2.6, hy - 0.4); ctx.moveTo(hx + 3.6, hy - 0.6); ctx.lineTo(hx + 5.2, hy - 0.8); ctx.stroke(); }
      ctx.fillStyle = 'rgba(160,200,255,0.8)'; ctx.beginPath(); ctx.arc(hx, hy - 7.5, 1.2, 0, TAU); ctx.fill();
      break;
    }
    case 'skull': {
      blob(ctx, hx, hy, r, pal.skin);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(hx + 1, hy + 3.5, 4.5, 2, 0, 0, TAU); ctx.fill();
      if (!back) {
        ctx.fillStyle = '#140a14'; ctx.beginPath(); ctx.ellipse(hx + 1.5, hy - 1, 1.8, 2, 0, 0, TAU); ctx.ellipse(hx + 5, hy - 1, 1.5, 1.8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = pal.eye || '#7ad8ff'; ctx.beginPath(); ctx.arc(hx + 1.5, hy - 1, 0.7, 0, TAU); ctx.arc(hx + 5, hy - 1, 0.6, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 0.8; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(hx + 1 + i * 1.5, hy + 3); ctx.lineTo(hx + 1 + i * 1.5, hy + 5); ctx.stroke(); }
      }
      if (pal.hat) { ctx.beginPath(); ctx.moveTo(hx - 10, hy - 3); ctx.quadraticCurveTo(hx, hy - 5, hx + 11, hy - 3); ctx.lineTo(hx + 0.5, hy - 8); ctx.closePath(); ctx.fillStyle = pal.hat; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke(); }
      break;
    }
    case 'longhair': { // yuki-onna: pale face, long flowing black hair
      const fl = Math.sin(t * 4) * 2;
      ctx.fillStyle = pal.hair || '#101018';
      ctx.beginPath(); ctx.moveTo(hx - 5, hy - 5); ctx.quadraticCurveTo(hx - 12, hy + 10, hx - 9 + fl, hy + 24); ctx.lineTo(hx - 2 + fl, hy + 20); ctx.quadraticCurveTo(hx - 3, hy + 8, hx + 2, hy - 2); ctx.closePath(); ctx.fill();
      blob(ctx, hx, hy, r, pal.skin);
      ctx.fillStyle = pal.hair || '#101018'; ctx.beginPath(); ctx.arc(hx - 0.5, hy - 1.5, r + 0.3, Math.PI * 0.9, Math.PI * 2.02); ctx.fill();
      if (!back) { ctx.fillStyle = pal.eye || '#9ee4ff'; ctx.fillRect(hx + 3, hy - 0.5, 1.8, 1); ctx.fillStyle = '#c8304a'; ctx.fillRect(hx + 3.5, hy + 3, 1.6, 0.9); }
      break;
    }
  }
}

// Hand-held shields (front view). Drawn centred at (x, y); s = size scale.
export function drawShieldItem(ctx, kind, x, y, s = 1, t = 0, flash = false) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
  const F = (c) => (flash ? '#ffffff' : c);
  switch (kind) {
    case 'pavise': { // tall wooden shield with a painted mon
      ctx.fillStyle = F('#9a6a3a'); ctx.beginPath(); ctx.moveTo(-6, -13); ctx.lineTo(6, -13); ctx.lineTo(6, 11); ctx.lineTo(0, 14); ctx.lineTo(-6, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(50,30,15,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-2, -13); ctx.lineTo(-2, 12); ctx.moveTo(2, -13); ctx.lineTo(2, 12); ctx.stroke();
      ctx.fillStyle = F('#c8302a'); ctx.beginPath(); ctx.arc(0, -2, 3.4, 0, TAU); ctx.fill();
      break;
    }
    case 'iron': { // big iron-banded door shield with rivets
      ctx.fillStyle = F('#4a4e58'); ctx.fillRect(-8, -15, 16, 29); ctx.strokeRect(-8, -15, 16, 29);
      ctx.fillStyle = F('#6a707c'); for (const yy of [-11, -1, 9]) ctx.fillRect(-8, yy, 16, 2.6);
      ctx.fillStyle = F('#d8c070'); for (const yy of [-10, 0, 10]) for (const xx of [-6, 0, 6]) { ctx.beginPath(); ctx.arc(xx, yy + 0.3, 0.9, 0, TAU); ctx.fill(); }
      break;
    }
    case 'shell': { // kappa shell held like a shield
      ctx.fillStyle = F('#5a6a3a'); ctx.beginPath(); ctx.ellipse(0, 0, 8, 11, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(30,40,15,0.8)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(-3, -4); ctx.lineTo(3, -4); ctx.lineTo(4.5, 1); ctx.lineTo(0, 5); ctx.lineTo(-4.5, 1); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, -4); ctx.lineTo(-5, -9); ctx.moveTo(3, -4); ctx.lineTo(5, -9); ctx.moveTo(0, 5); ctx.lineTo(0, 10.5); ctx.stroke();
      break;
    }
    case 'bark': { // rough bark slab with moss
      ctx.fillStyle = F('#6a4a2a'); ctx.beginPath(); ctx.moveTo(-7, -14); ctx.lineTo(5, -15); ctx.lineTo(8, -4); ctx.lineTo(7, 12); ctx.lineTo(-6, 13); ctx.lineTo(-8, 1); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(30,18,8,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3, -13); ctx.quadraticCurveTo(-5, 0, -2, 12); ctx.moveTo(3, -14); ctx.quadraticCurveTo(5, -1, 2, 12); ctx.stroke();
      ctx.fillStyle = F('#6aa04a'); ctx.beginPath(); ctx.ellipse(-3, -12, 4, 2, 0.2, 0, TAU); ctx.ellipse(4, 9, 3, 1.6, -0.3, 0, TAU); ctx.fill();
      break;
    }
    case 'bone': { // round shield of bone with a skull boss
      ctx.fillStyle = F('#d8d0b8'); ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(80,70,60,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = F('#f0ead8'); ctx.beginPath(); ctx.arc(0, -0.5, 3.6, 0, TAU); ctx.fill(); ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = INK; ctx.fillRect(-2, -1.5, 1.4, 1.4); ctx.fillRect(0.7, -1.5, 1.4, 1.4);
      break;
    }
    case 'ice': { // translucent ice slab
      ctx.globalAlpha *= 0.85;
      ctx.fillStyle = F('#bfe8ff'); ctx.beginPath(); ctx.moveTo(-6, -16); ctx.lineTo(6, -13); ctx.lineTo(9, 2); ctx.lineTo(5, 15); ctx.lineTo(-7, 12); ctx.lineTo(-9, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-4, -11); ctx.lineTo(1, 4); ctx.moveTo(3, -9); ctx.lineTo(5, -2); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(t * 3)})`; ctx.beginPath(); ctx.arc(-2, -6, 1.6, 0, TAU); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// fox tails behind kitsune
function drawTails(ctx, n, x, y, t, color) {
  for (let i = 0; i < n; i++) {
    const a = -2.4 + i * 0.35 + Math.sin(t * 3 + i) * 0.12;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(10, -6, 16, -1); ctx.quadraticCurveTo(10, 3, 0, 2); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(14, -0.8, 2.6, 1.6, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

// ---------------- Pose solving ----------------
// Angles are local: 0 = forward (+x), positive = rotating downward.
function solvePose(o, aimL) {
  const mv = o.move || 0, w = o.walk || 0;
  const swing = Math.sin(w) * 0.7 * mv;
  const P = {
    n1: 1.3 - swing, n2: 1.0 - swing, f1: 1.3 + swing, f2: 1.0 + swing,
    nW: null, fW: null, lean: (o.lean || 0) + mv * 0.12, twoHand: false, tuck: 0, pull: 0,
  };
  const grip = o.grip || 'down';
  // idle weapon hold angles
  if (o.weapon) {
    if (grip === 'forward') { P.n1 = aimL + 0.5; P.n2 = aimL; P.nW = aimL; P.f1 = aimL + 0.7; P.f2 = aimL + 0.1; P.twoHand = true; }
    else if (grip === 'pole') { P.n1 = 0.9; P.n2 = 0.1; P.nW = -0.5; P.f1 = 1.0; P.f2 = 0.3; }
    else if (grip === 'shoulder') { P.n1 = -0.4 + swing * 0.2; P.n2 = -2.2; P.nW = -2.5; }
    else if (grip === 'dual') { // ready stance: lead blade angled forward and up, rear blade reversed along the forearm
      P.n1 = 0.75 + swing * 0.25; P.n2 = -0.35 + swing * 0.15; P.nW = -0.55;
      P.f1 = 1.15 - swing * 0.25; P.f2 = 0.15 - swing * 0.1;
      P.lean += 0.06;
    }
    else if (grip === 'shield') { P.f1 = 0.55 + swing * 0.2; P.f2 = -0.15; P.fW = 0; P.n1 = 1.2 - swing * 0.3; P.n2 = 0.9 - swing * 0.3; }
    else { P.nW = P.n2 + 0.35; }
    if (o.weapon2) P.fW = grip === 'dual' ? P.f2 + Math.PI - 0.35 : P.f2 + 0.35;
  }
  const pose = o.pose;
  if (!pose) return P;
  const t = clamp(pose.t, 0, 1);
  switch (pose.kind) {
    case 'slash': {
      const a = lerp(aimL - 2.0, aimL + 1.35, ease.outCubic(t));
      if (pose.side > 0) { P.n1 = a; P.n2 = a - 0.25; P.nW = a - 0.15; }
      else { P.f1 = a; P.f2 = a - 0.25; P.fW = a - 0.15; }
      P.lean += 0.12 * Math.sin(t * Math.PI);
      break;
    }
    case 'cleave': case 'strike': {
      const k = t < 0.38 ? ease.outCubic(t / 0.38) : 1;
      const k2 = t < 0.38 ? 0 : ease.outCubic(Math.min(1, (t - 0.38) / 0.3));
      const a = t < 0.38 ? lerp(1.0, -2.4, k) : lerp(-2.4, aimL + 1.25, k2);
      P.n1 = a; P.n2 = a - 0.2; P.nW = a - 0.1; P.f1 = a + 0.25; P.f2 = a; P.twoHand = true;
      P.lean += t < 0.38 ? -0.12 * k : 0.2 * k2;
      break;
    }
    case 'windup': {
      const a = lerp(P.n1, -2.3, ease.outCubic(t));
      P.n1 = a; P.n2 = a - 0.2; P.nW = a - 0.1; P.lean -= 0.12 * t;
      if (grip === 'pole' || grip === 'forward') { P.n1 = aimL + 0.6; P.n2 = aimL + 0.2; P.nW = aimL; P.f1 = aimL + 0.9; P.f2 = aimL + 0.2; P.lean -= 0.1 * t; }
      P.pull = t;
      break;
    }
    case 'thrust': {
      P.n1 = aimL; P.n2 = aimL; P.nW = aimL; P.f1 = aimL + 0.2; P.f2 = aimL; P.lean += 0.25;
      break;
    }
    case 'throw': {
      const a = t < 0.3 ? lerp(1.2, -2.2, t / 0.3) : lerp(-2.2, aimL, ease.outCubic((t - 0.3) / 0.7));
      if (pose.side > 0) { P.n1 = a; P.n2 = a - 0.1; P.nW = a; } else { P.f1 = a; P.f2 = a - 0.1; P.fW = a; }
      P.lean += 0.1 * Math.sin(t * Math.PI);
      break;
    }
    case 'shoot': {
      P.n1 = aimL + 0.35; P.n2 = aimL; P.nW = aimL; P.f1 = aimL + 0.55; P.f2 = aimL + 0.05;
      P.lean -= 0.18 * (1 - t); P.pull = t;
      break;
    }
    case 'draw': { // bow draw
      P.n1 = aimL; P.n2 = aimL; P.nW = aimL; P.f1 = aimL + 0.3; P.f2 = aimL + Math.PI * 0.9; P.pull = t;
      break;
    }
    case 'spin': {
      P.n1 = -0.1; P.n2 = -0.05; P.nW = 0; P.f1 = Math.PI + 0.1; P.f2 = Math.PI + 0.05; P.fW = Math.PI; P.lean = 0.05;
      break;
    }
    case 'slam': {
      const a = t < 0.55 ? lerp(1.0, -2.7, ease.outCubic(t / 0.55)) : lerp(-2.7, aimL + 1.3, ease.outCubic((t - 0.55) / 0.45));
      P.n1 = a; P.n2 = a - 0.15; P.nW = a - 0.1; P.f1 = a + 0.2; P.f2 = a; P.twoHand = true; P.tuck = t < 0.55 ? Math.sin(t / 0.55 * Math.PI) : 0;
      break;
    }
    // heavy sword (player): a deep wind-up (crouch, lean back, blade far behind the head), then a falling cleave
    case 'heavyCleave': {
      const W = 0.4, sm = (x) => x * x * (3 - 2 * x);
      const k = t < W ? sm(t / W) : 1, k2 = t < W ? 0 : ease.outCubic(Math.min(1, (t - W) / 0.22));
      const a = t < W ? lerp(P.n1, -2.5, k) : lerp(-2.5, aimL + 1.4, k2);
      P.n1 = a; P.n2 = a - 0.2; P.nW = a - 0.1; P.f1 = a + 0.25; P.f2 = a; P.twoHand = true;
      P.lean += t < W ? -0.24 * k : lerp(-0.24, 0.34, k2);
      P.tuck = t < W ? 0.35 * k : 0.35 * (1 - k2) + 0.3 * Math.sin(k2 * Math.PI);
      break;
    }
    // heavy sword held back while charging (t = charge 0..1, raise = 0..1 lifting it into place); trembles when full
    case 'heavyCharge': {
      const r = ease.outCubic(clamp(pose.raise ?? 1, 0, 1));
      const shake = t >= 0.999 ? Math.sin((o.time || 0) * 70) * 0.05 : Math.sin((o.time || 0) * 40) * 0.015 * t;
      const a = lerp(P.n1, -2.15 - 0.2 * t, r) + shake; // blade raised up behind the head
      P.n1 = a; P.n2 = a - 0.2; P.nW = a - 0.1; P.f1 = a + 0.25; P.f2 = a; P.twoHand = true;
      P.lean -= (0.22 + 0.1 * t) * r; P.tuck = (0.3 + 0.3 * t) * r;
      break;
    }
    // shishi shield: bash (shield thrust forward, shoulder behind it) and Bulwark (crouched behind it)
    case 'shieldBash': {
      const k = t < 0.5 ? ease.outCubic(t / 0.5) : 1 - (t - 0.5) * 0.6;
      P.f1 = lerp(0.55, 0.05, k); P.f2 = lerp(-0.15, -0.05, k); P.n1 = lerp(1.2, 0.4, k); P.n2 = lerp(0.9, 0.1, k);
      P.lean += 0.32 * k; P.tuck = 0.15 * k;
      break;
    }
    case 'shieldGuard': {
      const brace = Math.min(1, t * 8);
      P.f1 = lerp(0.55, 0.35, brace); P.f2 = lerp(-0.15, -0.35, brace); P.n1 = 0.7; P.n2 = -0.1;
      P.lean += 0.14 * brace; P.tuck = 0.65 * brace;
      break;
    }
    case 'cast': {
      const a = -0.9 + Math.sin(t * 20) * 0.08;
      P.n1 = a; P.n2 = a - 0.4; P.f1 = a + 0.3; P.f2 = a - 0.2; P.lean -= 0.1;
      break;
    }
    // ---- bo staff: two-handed, the stick slides through the hands (pull = slide along the stick)
    case 'boJab': { // chamber back, then a straight snapping thrust
      const ch = t < 0.3 ? ease.outCubic(t / 0.3) : 1, th = t < 0.3 ? 0 : ease.outCubic(Math.min(1, (t - 0.3) / 0.25));
      const a = aimL;
      P.n1 = a + lerp(1.1, 0.12, th); P.n2 = a + lerp(0.2, 0, th); P.nW = a;
      P.f1 = a + lerp(1.4, 0.3, th); P.f2 = a + lerp(0.5, 0.02, th);
      P.pull = -0.55 * ch * (1 - th) + 0.65 * th; P.lean += -0.12 * ch * (1 - th) + 0.32 * th; P.twoHand = true;
      break;
    }
    case 'boSweep': { // low sweep through the legs
      const k = ease.outCubic(t), a = lerp(2.5, aimL + 0.55, k);
      P.n1 = a - 0.9; P.n2 = a - 0.25; P.nW = a; P.f1 = a - 0.6; P.f2 = a - 0.1;
      P.tuck = 0.55 * Math.sin(Math.min(1, t * 1.3) * Math.PI) + 0.15; P.lean += 0.18 * Math.sin(t * Math.PI); P.pull = 0.25; P.twoHand = true;
      break;
    }
    case 'boRise': { // rising strike from low to high
      const k = ease.outCubic(t), a = lerp(aimL + 1.3, -1.5, k);
      P.n1 = a + 0.8; P.n2 = a + 0.1; P.nW = a; P.f1 = a + 1.0; P.f2 = a + 0.3;
      P.lean += lerp(0.15, -0.1, k); P.tuck = 0.3 * (1 - k); P.pull = 0.15; P.twoHand = true;
      break;
    }
    case 'boOverhead': { // raise, then a hard downward chop
      const up = t < 0.35 ? ease.outCubic(t / 0.35) : 1, dn = t < 0.35 ? 0 : ease.outCubic(Math.min(1, (t - 0.35) / 0.3));
      const a = t < 0.35 ? lerp(0.6, -2.5, up) : lerp(-2.5, aimL + 0.85, dn);
      P.n1 = a + 0.5; P.n2 = a; P.nW = a; P.f1 = a + 0.75; P.f2 = a + 0.2;
      P.lean += t < 0.35 ? -0.12 * up : 0.28 * dn; P.tuck = 0.35 * dn; P.pull = 0.1; P.twoHand = true;
      break;
    }
    case 'boTwirl': { // stick spins around its middle in front of the body
      const a = aimL - t * TAU * 2.2;
      P.n1 = aimL + 0.7; P.n2 = aimL - 0.2; P.nW = a; P.f1 = aimL + 0.9; P.f2 = aimL;
      P.pull = -0.42; P.lean += 0.05;
      break;
    }
    case 'hurt': { P.lean -= 0.3 * (1 - t); P.n1 = 0.4; P.f1 = 0.6; break; }
    case 'jump': { P.tuck = Math.sin(t * Math.PI); P.n1 = -0.6; P.f1 = 0.2; break; }
    case 'kneel': { // on one knee, head bowed (t: 0 = upright kneel, 1 = slumped)
      P.tuck = 0.95; P.drop = 7.5; P.lean += 0.25 + t * 0.25; P.n1 = 1.25; P.n2 = 1.0; P.f1 = 1.35; P.f2 = 1.1;
      if (o.weapon) { P.nW = 1.35; }
      break;
    }
    case 'iaiCrouch': { // low stance, hand on the hilt, about to draw
      P.tuck = 0.45 * t; P.drop = 4 * t; P.lean += 0.35 * t; P.n1 = 1.9; P.n2 = 0.4; P.nW = 2.7; P.f1 = 1.2; P.f2 = 0.2;
      break;
    }
  }
  return P;
}

// ---------------- Wings (tengu) ----------------
function drawWings(ctx, t, sx, sy, flap) {
  for (const s of [1, -1]) {
    ctx.save();
    ctx.translate(sx - 3, sy);
    ctx.rotate(s * (0.35 + Math.sin(flap) * 0.45) - 0.3);
    ctx.scale(1, s);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.ellipse(-8 - i * 4, -10 - i * 2, 13 - i, 3.4, -0.9 + i * 0.12, 0, TAU);
      ctx.fillStyle = i % 2 ? '#1f1d27' : '#2d2a38'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------- Humanoid ----------------
export function drawHumanoid(ctx, o) {
  const t = o.time || 0;
  const pal = o.flash > 0 ? FLASH : o.pal;
  const fx = Math.cos(o.facing), fy = Math.sin(o.facing);
  const dir = fx >= 0 ? 1 : -1;
  const back = fy < -0.55;
  const aimL = Math.atan2(fy, Math.abs(fx));
  const P = solvePose(o, aimL);
  const mv = o.move || 0, w = o.walk || 0;
  const bob = mv > 0.1 ? -Math.abs(Math.sin(w)) * 2.4 * mv : Math.sin(t * 2.2 + (o.seed || 0)) * 0.7;
  const s = o.s || 1;

  ctx.save();
  ctx.translate(o.x, o.y - (o.z || 0));
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.scale(dir * s * (o.sqx || 1), s * (o.sqy || 1));
  if (o.rot) { ctx.translate(0, -15); ctx.rotate(o.rot); ctx.translate(0, 15); }
  if (P.drop) ctx.translate(0, P.drop);

  const fat = o.fat || 1;
  const hipY = -15 + bob * 0.4;
  const shY = -29 + bob;
  const lx = P.lean * 14;
  const shN = [2 + lx, shY + 1], shF = [-3 + lx, shY + 0.5];

  if (o.wings) {
    if (o.smallWings) { ctx.save(); ctx.translate(lx, shY + 6); ctx.scale(0.55, 0.55); drawWings(ctx, t, 0, 0, t * (o.flapSpeed || 6)); ctx.restore(); }
    else drawWings(ctx, t, lx, shY + 4, t * (o.flapSpeed || 6));
  }
  if (o.tails) drawTails(ctx, o.tails, -4, hipY - 2, t, o.flash > 0 ? '#ffffff' : (o.pal.tail || '#f4f0e8'));

  // scarf (behind everything)
  if (o.scarf) {
    const n = 7; const amp = 0.5 + mv;
    ctx.beginPath();
    let px = shF[0] + 1, py = shY + 2;
    ctx.moveTo(px, py - 1.6);
    const pts = [];
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      pts.push([px - i * (3.2 + mv * 1.6), py + i * (1.3 - mv * 0.9) + Math.sin(t * 13 - i * 0.9) * i * 0.55 * amp]);
    }
    for (const p of pts) ctx.lineTo(p[0], p[1] - 1.6 * (1 - 0.6));
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + 1.8 * (1 - i / n) + 0.4);
    ctx.lineTo(px, py + 1.8);
    ctx.closePath();
    ctx.fillStyle = pal.scarf; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
  }

  const armW = 3.6 * (o.armW || 1);
  const legW = 4.2 * (o.legW || 1);
  const drawArm = (sh, a1, a2, weaponKind, wAng, isNear) => {
    const L1 = 6.5, L2 = 6.5;
    const ex = sh[0] + Math.cos(a1) * L1, ey = sh[1] + Math.sin(a1) * L1;
    const hx = ex + Math.cos(a2) * L2, hy = ey + Math.sin(a2) * L2;
    const col = o.bareArms ? pal.skin : (isNear ? pal.cloth : pal.cloth2);
    seg(ctx, sh[0], sh[1], ex, ey, armW, col);
    seg(ctx, ex, ey, hx, hy, armW * 0.9, o.bareArms ? pal.skin : col);
    blob(ctx, hx, hy, 2.1 * (o.armW || 1), pal.skin, INK, 1);
    if (weaponKind && wAng !== null) drawWeapon(ctx, weaponKind, hx, hy, wAng, pal, P.pull);
    return [hx, hy];
  };

  // back-mounted (inactive) weapon
  // inactive weapon is stowed on the body, clearly away from the hands.
  // Seen from behind it's drawn over the torso (on the back); otherwise behind the body.
  const drawStowed = (onBack) => {
    const bw = o.backWeapon;
    const bx = onBack ? 3 + lx * 0.8 : 0;
    if (bw === 'saya_long') drawWeapon(ctx, bw, bx - 1 + lx * 0.7, shY + 1, onBack ? 1.9 : 2.3, pal);   // across the back, hilt over the shoulder
    else if (bw === 'saya') { drawWeapon(ctx, bw, -1, hipY - 1, 2.75, pal); drawWeapon(ctx, bw, 0.5, hipY + 1, 2.9, pal); } // at the hip
    else if (bw === 'shield_back' || bw === 'crossbow_back') {
      // flat against the back: seen from the side it is edge-on (a thin sliver behind the spine), so it never
      // pokes out in front of the body; from the front it hides behind the torso, from behind it shows whole
      const side = onBack ? 0 : Math.abs(fx);
      ctx.save();
      if (bw === 'shield_back') { ctx.translate(onBack ? bx + 1 : -6.5 * side + lx * 0.5, shY + 8); ctx.scale(1 - 0.72 * side, 0.82); drawWeapon(ctx, bw, 0, 0, 0, pal); }
      else { ctx.translate(onBack ? bx - 4 + lx * 0.7 : -6 * side + lx * 0.5, onBack ? shY + 12 : shY + 17); ctx.scale(1 - 0.7 * side, 1); drawWeapon(ctx, bw, 0, 0, onBack ? -1.45 : -1.62, pal); }
      ctx.restore();
    }
    else if (bw === 'holystaff') drawWeapon(ctx, bw, -2 + lx * 0.6, hipY + 8, -1.95, pal); // head up behind the shoulder, not by the feet
    else drawWeapon(ctx, bw, -6 + lx * 0.6, shY + 10, 2.3, pal);
  };
  if (o.backWeapon && !back) drawStowed(false);

  // long mantle hanging from the shoulders (regent)
  if (o.mantle && !back) {
    const fl = Math.sin(t * 2.4) * 1.6 + mv * 4;
    ctx.beginPath();
    ctx.moveTo(shF[0] - 1, shY);
    ctx.quadraticCurveTo(-10 - fl, hipY, -12 - fl * 1.6, 1.5);
    ctx.lineTo(-1 - fl * 0.6, 2);
    ctx.quadraticCurveTo(-2, hipY, shN[0], shY + 1);
    ctx.closePath();
    ctx.fillStyle = pal.mantle || pal.cloth2; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = pal.accent || '#d8a838'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-11 - fl * 1.5, 0); ctx.lineTo(-2 - fl * 0.6, 0.5); ctx.stroke();
  }

  // far arm (behind body)
  const farHand = drawArm(shF, P.f1, P.f2, o.weapon2 || (P.twoHand ? null : null), P.fW, false);
  const drawHeldShield = () => drawWeapon(ctx, 'shield', farHand[0] + 2.5, farHand[1] - 1, 0, pal, o.shieldGlow || 0);
  if (o.weapon === 'shield' && back) drawHeldShield();

  // legs
  const legSwing = Math.sin(w) * 0.75 * mv;
  const drawLeg = (hx, sw, col) => {
    const tuck = P.tuck;
    const a = Math.PI / 2 - sw - tuck * 0.9;
    const kx = hx + Math.cos(a) * 7.5, ky = hipY + Math.sin(a) * 7.5;
    const bend = Math.max(0, -Math.sin(w + (sw > 0 ? 0 : Math.PI))) * 0.9 * mv + tuck * 1.6;
    const a2 = a + bend;
    const fx2 = kx + Math.cos(a2) * 7.5, fy2 = ky + Math.sin(a2) * 7.5;
    seg(ctx, hx, hipY, kx, ky, legW, col);
    seg(ctx, kx, ky, fx2, fy2, legW * 0.85, col);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(fx2 + 1.5, fy2 + 0.5, 3, 1.6, 0, 0, TAU); ctx.fill();
  };
  if (!o.robe) {
    drawLeg(-1.5, -legSwing, pal.cloth2);
    drawLeg(1.5, legSwing, o.bareLegs ? pal.skin : pal.cloth2);
  }

  // torso
  const hw = 5 * fat, sw2 = 6.2 * fat;
  ctx.beginPath();
  if (o.robe) {
    const sway = Math.sin(w) * 1.5 * mv;
    ctx.moveTo(-7 * fat + sway, 0); ctx.lineTo(7 * fat + sway, 0);
    ctx.lineTo(sw2 + lx, shY + 1); ctx.quadraticCurveTo(lx, shY - 2, -sw2 + lx, shY + 1);
  } else {
    ctx.moveTo(-hw, hipY + 2); ctx.lineTo(hw, hipY + 2);
    ctx.lineTo(sw2 + lx, shY + 1); ctx.quadraticCurveTo(lx, shY - 2.5, -sw2 + lx, shY + 1);
  }
  ctx.closePath();
  ctx.fillStyle = o.bareChest ? pal.skin : pal.cloth; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.7; ctx.stroke();
  // shading
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(20,10,40,0.18)'; ctx.fillRect(-12 * fat, shY - 4, 7 * fat, 40);
  if (o.armor) {
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.1;
    for (let y = shY + 4; y < hipY + 2; y += 3) { ctx.beginPath(); ctx.moveTo(-10, y); ctx.lineTo(12, y - 1); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,220,140,0.6)'; for (let y = shY + 4; y < hipY; y += 6) for (let x = -4; x < 8; x += 4) ctx.fillRect(x + lx * 0.5, y - 0.5, 1, 1);
  }
  if (o.ribs) { // skeleton rib cage
    ctx.strokeStyle = 'rgba(30,20,30,0.75)'; ctx.lineWidth = 1.1;
    for (let y = shY + 4; y < hipY - 1; y += 2.8) { ctx.beginPath(); ctx.moveTo(-5 + lx * 0.8, y); ctx.quadraticCurveTo(lx, y - 1.5, 6 + lx * 0.8, y); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(lx * 0.7, shY + 2); ctx.lineTo(lx * 0.4, hipY); ctx.stroke();
  } else if (o.bareChest) {
    ctx.strokeStyle = 'rgba(60,10,10,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx * 0.7, shY + 4); ctx.lineTo(lx * 0.5, hipY - 1); ctx.moveTo(-4 + lx, shY + 6); ctx.quadraticCurveTo(lx, shY + 9, 5 + lx, shY + 6); ctx.stroke();
  }
  ctx.restore();
  // collar / sash
  if (!o.bareChest) {
    ctx.strokeStyle = pal.cloth2; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-3 + lx, shY); ctx.lineTo(1 + lx * 0.6, shY + 7); ctx.lineTo(4 + lx, shY); ctx.stroke();
  }
  if (o.robe) {
    ctx.fillStyle = pal.sash; ctx.fillRect(-6 * fat + lx * 0.4, hipY - 4, 12 * fat, 3);
  } else {
    ctx.fillStyle = pal.sash; ctx.fillRect(-hw - 0.5 + lx * 0.15, hipY - 1, hw * 2 + 1 + lx * 0.15, 3.2);
    if (o.tigerCloth) {
      ctx.fillStyle = '#e0a830'; ctx.beginPath(); ctx.moveTo(-hw - 1, hipY + 1); ctx.lineTo(hw + 1, hipY + 1); ctx.lineTo(hw - 1, hipY + 8); ctx.lineTo(-hw + 1, hipY + 8); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); for (let i = -3; i <= 3; i += 2) { ctx.moveTo(i * fat, hipY + 2); ctx.lineTo(i * fat + 1, hipY + 6); } ctx.stroke();
    }
    if (o.sashTail) {
      const fl = Math.sin(t * 11) * 1.6;
      ctx.beginPath(); ctx.moveTo(-hw, hipY); ctx.lineTo(-hw - 6, hipY + 4 + fl); ctx.lineTo(-hw - 4, hipY + 6 + fl); ctx.lineTo(-hw + 1, hipY + 2); ctx.closePath(); ctx.fill();
    }
  }
  if (o.robe) { // feet peeking
    ctx.fillStyle = INK; const sw3 = Math.sin(w) * 2 * mv;
    ctx.beginPath(); ctx.ellipse(2 + sw3, 0.5, 3, 1.5, 0, 0, TAU); ctx.ellipse(-2 - sw3, 0.5, 3, 1.5, 0, 0, TAU); ctx.fill();
  }
  // shoulder plates for armored
  if (o.armor) {
    ctx.fillStyle = pal.cloth2; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(shN[0] - 3, shN[1] - 1, 7, 7); ctx.fill(); ctx.stroke();
  }

  if (o.backWeapon && back) drawStowed(true);

  // head
  drawHead(ctx, o.head || 'hood', 1 + lx * 1.1, shY - 6.5, pal, back, t, o);

  if (o.weapon === 'shield' && !back) drawHeldShield();
  // near arm (in front of body)
  drawArm(shN, P.n1, P.n2, o.weapon === 'shield' ? null : o.weapon, P.nW, true);

  ctx.restore();
}

// ---------------- Kappa ----------------
export function drawKappa(ctx, o) {
  const pal = o.flash > 0 ? FLASH : o.pal;
  const dir = Math.cos(o.facing) >= 0 ? 1 : -1;
  const t = o.time;
  ctx.save();
  ctx.translate(o.x, o.y - (o.z || 0));
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.scale(dir * (o.s || 1) * (o.sqx || 1), (o.s || 1) * (o.sqy || 1));
  if (o.rot) { ctx.translate(0, -10); ctx.rotate(o.rot); ctx.translate(0, 10); }
  const crouch = o.crouch || 0;
  // legs
  seg(ctx, -3, -7, -6, 0, 3.4, pal.skin); seg(ctx, 3, -7, 5, 0, 3.4, pal.skin);
  ctx.fillStyle = pal.skin; ctx.beginPath(); ctx.ellipse(-6, 0.5, 3.4, 1.4, 0, 0, TAU); ctx.ellipse(6, 0.5, 3.4, 1.4, 0, 0, TAU); ctx.fill();
  // shell
  ctx.beginPath(); ctx.ellipse(-4, -15 + crouch, 9, 10, -0.2, 0, TAU);
  ctx.fillStyle = '#6b5a2e'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.strokeStyle = 'rgba(30,20,10,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-10, -18 + crouch); ctx.lineTo(-4, -20 + crouch); ctx.lineTo(1, -15 + crouch); ctx.moveTo(-4, -20 + crouch); ctx.lineTo(-5, -9 + crouch); ctx.stroke();
  // body
  ctx.beginPath(); ctx.ellipse(1, -14 + crouch, 7, 9, 0.1, 0, TAU);
  ctx.fillStyle = pal.skin; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = '#d8d48a'; ctx.beginPath(); ctx.ellipse(3, -12 + crouch, 4, 6, 0.1, 0, TAU); ctx.fill();
  // arms
  const ar = Math.sin(t * 8) * 0.3 + (o.attack || 0) * -1.2;
  seg(ctx, 3, -18 + crouch, 3 + Math.cos(0.6 + ar) * 8, -18 + crouch + Math.sin(0.6 + ar) * 8, 3, pal.skin);
  // head
  const hy = -27 + crouch;
  blob(ctx, 3, hy, 6.5, pal.skin);
  ctx.fillStyle = '#e8c840'; ctx.beginPath(); ctx.moveTo(7, hy); ctx.lineTo(13, hy + 1.5); ctx.lineTo(7, hy + 3.4); ctx.closePath(); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(6, hy - 2, 1.3, 0, TAU); ctx.fill();
  // hair fringe + water dish
  ctx.fillStyle = '#2b4a2a';
  for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.ellipse(3 + i * 1.4, hy - 5, 1.2, 2.8, i * 0.15, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(3, hy - 7, 5, 1.8, 0, 0, TAU); ctx.fillStyle = '#e8eef0'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(120,190,230,0.9)'; ctx.beginPath(); ctx.ellipse(3, hy - 7.2, 3.6, 1.1, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(1 + Math.sin(t * 3) * 1.5, hy - 7.6, 1.4, 0.6);
  ctx.restore();
}

// ---------------- Projectiles ----------------
export function drawProjectile(ctx, p, sx, sy, t) {
  const ang = p.screenAng;
  if (p.reflected) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,200,90,0.35)'; ctx.beginPath(); ctx.arc(sx, sy, 11 + Math.sin(t * 30) * 2, 0, TAU); ctx.fill(); ctx.restore(); }
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
  switch (p.kind) {
    case 'bolt':
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = '#e8eef5'; ctx.beginPath(); ctx.moveTo(6, -2.5); ctx.lineTo(12, 0); ctx.lineTo(6, 2.5); ctx.fill();
      ctx.fillStyle = '#c33'; ctx.fillRect(-15, -2.5, 4, 5);
      break;
    case 'heavybolt': // the crossbow's piercing shot: a thick bolt with a broad head and a long glowing wake
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,220,140,0.35)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,250,220,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-44, 0); ctx.lineTo(4, 0); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = '#4a3420'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = '#eef3f8'; ctx.beginPath(); ctx.moveTo(7, -4.2); ctx.lineTo(17, 0); ctx.lineTo(7, 4.2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#c33'; ctx.fillRect(-20, -3.5, 5, 7);
      break;
    case 'kunai':
      ctx.strokeStyle = 'rgba(255,248,225,0.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-4, 0); ctx.stroke(); // speed streak
      ctx.rotate(t * 30);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.stroke();
      ctx.fillStyle = p.golden ? '#ffd060' : '#9aa3ad'; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(0, -2.5); ctx.lineTo(8, 0); ctx.lineTo(0, 2.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      break;
    case 'arrow':
      ctx.strokeStyle = '#5a3a1e'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(11, 0); ctx.lineTo(6, 2); ctx.fill();
      ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-18, -3); ctx.lineTo(-11, 0); ctx.lineTo(-18, 3); ctx.fill();
      break;
    case 'feather': case 'dart':
      ctx.fillStyle = '#26232e'; ctx.beginPath(); ctx.ellipse(0, 0, p.kind === 'dart' ? 7 : 10, 2.6, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = p.kind === 'dart' ? '#e8b830' : '#9a7aff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.stroke();
      break;
    case 'icearrow':
      ctx.strokeStyle = 'rgba(160,230,255,0.5)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(4, 0); ctx.stroke();
      ctx.strokeStyle = '#9ad8f0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = '#e8f8ff'; ctx.beginPath(); ctx.moveTo(6, -2.5); ctx.lineTo(12, 0); ctx.lineTo(6, 2.5); ctx.fill();
      break;
    case 'jug': case 'firejar': {
      ctx.rotate(t * 8);
      blob(ctx, 0, 0, 4.6, p.kind === 'jug' ? '#d8c8a0' : '#8a4a2a');
      if (p.kind === 'firejar') { ctx.fillStyle = Math.random() > 0.5 ? '#ffd35a' : '#ff6a2a'; ctx.beginPath(); ctx.arc(0, -5, 2.4, 0, TAU); ctx.fill(); }
      else { ctx.fillStyle = '#2a2030'; ctx.fillRect(-1.5, -6, 3, 2); }
      break;
    }
    case 'ofuda': { // the monk's paper talisman, wrapped in a pale golden flame
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const pulse = 1 + Math.sin(t * 16 + (p.seed || 0)) * 0.12;
      const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, 15 * pulse);
      gl.addColorStop(0, 'rgba(255,240,190,0.6)'); gl.addColorStop(1, 'rgba(255,210,120,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 15 * pulse, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,225,150,0.35)'; ctx.beginPath(); ctx.moveTo(-6, -5); ctx.quadraticCurveTo(-20, 0, -6, 5); ctx.fill(); // flame tail
      ctx.restore();
      ctx.rotate(Math.PI / 2 + Math.sin(t * 22 + (p.seed || 0)) * 0.18); // the paper flutters as it flies
      ctx.fillStyle = '#f6eedb'; ctx.fillRect(-3.4, -7.5, 6.8, 15); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.strokeRect(-3.4, -7.5, 6.8, 15);
      ctx.fillStyle = '#b8261e'; ctx.fillRect(-2, -6, 4, 4);
      ctx.strokeStyle = '#1a1414'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0, 5.5); ctx.moveTo(-1.8, 1.2); ctx.lineTo(1.8, 1.2); ctx.moveTo(-1.4, 3.6); ctx.lineTo(1.4, 3.6); ctx.stroke();
      break;
    }
    case 'soul': case 'spirit': {
      ctx.rotate(-ang);
      const pulse = 1 + Math.sin(t * 14 + p.seed) * 0.15;
      const c = p.kind === 'soul' ? ['rgba(180,120,255,0.25)', 'rgba(210,160,255,0.75)'] : ['rgba(170,235,255,0.3)', 'rgba(210,248,255,0.85)'];
      ctx.fillStyle = c[0]; ctx.beginPath(); ctx.arc(0, 0, 12 * pulse, 0, TAU); ctx.fill();
      ctx.fillStyle = c[1]; ctx.beginPath(); ctx.arc(0, 0, 6 * pulse, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
      break;
    }
    case 'crescent': { // Gensai's spinning crescent blade (ang = spin)
      ctx.scale(1, 0.55);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,60,90,0.25)'; ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.arc(0, 0, 18, -2.2, 1.2); ctx.arc(5, -2, 13, 1.1, -2.1, true); ctx.closePath();
      ctx.fillStyle = '#ffe0e6'; ctx.fill(); ctx.strokeStyle = '#8a1022'; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'orb': {
      ctx.rotate(-ang);
      const pulse = 1 + Math.sin(t * 14 + p.seed) * 0.15;
      ctx.fillStyle = 'rgba(120,200,255,0.25)'; ctx.beginPath(); ctx.arc(0, 0, 13 * pulse, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(160,230,255,0.75)'; ctx.beginPath(); ctx.arc(0, 0, 7 * pulse, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
      break;
    }
    case 'bomb':
      ctx.rotate(t * 8);
      blob(ctx, 0, 0, 5, '#2a2730');
      ctx.fillStyle = Math.random() > 0.5 ? '#ffd35a' : '#ff6a2a'; ctx.beginPath(); ctx.arc(4, -4, 2, 0, TAU); ctx.fill();
      break;
    case 'fireball': {
      ctx.rotate(-ang);
      ctx.fillStyle = 'rgba(255,120,30,0.35)'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffb040'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff3c0'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

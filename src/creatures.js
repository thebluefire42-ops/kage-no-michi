// Non-human enemies drawn in code: kamaitachi, tanuki, boar spirit, komainu, wisp priest, gashadokuro.
// All take the same options object as drawHumanoid (x, y, z, facing, time, walk, move, flash, alpha, sqx, sqy, rot, pose, e).
import { TAU, clamp, lerp } from './util.js';
import { INK } from './rig.js';

const W = '#ffffff';
function begin(ctx, o, s = 1, pivot = 12) {
  const dir = Math.cos(o.facing) >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(o.x, o.y - (o.z || 0));
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.scale(dir * s * (o.sqx || 1), s * (o.sqy || 1));
  if (o.rot) { ctx.translate(0, -pivot); ctx.rotate(o.rot); ctx.translate(0, pivot); }
  return dir;
}
const F = (o, c) => (o.flash > 0 ? W : c);
function blob(ctx, x, y, rx, ry, fill, rot = 0, lw = 1.6) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke();
}
function leg(ctx, x1, y1, x2, y2, w, c) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = w + 2.4; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
const winding = (o) => o.pose && (o.pose.kind === 'windup' || o.pose.kind === 'draw' || o.pose.kind === 'cast');

// ---------------- Kamaitachi: sleek weasel with sickle forelimbs, wind wisps
export function drawWeasel(ctx, o) {
  const t = o.time, mv = o.move || 0, w = o.walk || 0;
  begin(ctx, o, 1.05, 8);
  const lunge = o.e && o.e.state === 'lunge';
  const crouch = winding(o) ? 3 : 0;
  // wind wisps
  ctx.strokeStyle = 'rgba(240,250,255,0.55)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) { const yy = -8 - i * 4; const off = ((t * 40 + i * 13) % 26); ctx.beginPath(); ctx.moveTo(-14 - off, yy); ctx.quadraticCurveTo(-8 - off, yy - 3, -2 - off, yy); ctx.stroke(); }
  // tail
  ctx.beginPath(); ctx.moveTo(-8, -9 + crouch); ctx.quadraticCurveTo(-20, -14 + Math.sin(t * 6) * 3, -24, -6); ctx.quadraticCurveTo(-18, -8, -8, -5 + crouch); ctx.closePath();
  ctx.fillStyle = F(o, '#a8743e'); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
  // legs
  const sw = Math.sin(w * 1.4) * 3 * mv;
  leg(ctx, -5, -5, -6 + sw, 0, 2.6, F(o, '#8a5a2e')); leg(ctx, 5, -5, 6 - sw, 0, 2.6, F(o, '#8a5a2e'));
  // body (long, low)
  blob(ctx, 0, -9 + crouch, lunge ? 13 : 11, 5.5, F(o, '#c48a4a'), lunge ? 0.05 : -0.1);
  ctx.fillStyle = F(o, '#f2e2c0'); ctx.beginPath(); ctx.ellipse(2, -7 + crouch, 7, 2.6, 0, 0, TAU); ctx.fill();
  // sickle arms
  const a = lunge ? -0.2 : winding(o) ? -1.4 : 0.5 + Math.sin(t * 5) * 0.15;
  for (const s of [1, 0]) {
    const sx = 6 - s * 3, sy = -10 + crouch;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(a + s * 0.3);
    leg(ctx, 0, 0, 7, 0, 2.2, F(o, '#8a5a2e'));
    ctx.beginPath(); ctx.moveTo(7, -1); ctx.quadraticCurveTo(15, -8, 20, -2); ctx.quadraticCurveTo(14, -4, 8, 1.5); ctx.closePath();
    ctx.fillStyle = F(o, '#dfe6ee'); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  // head
  blob(ctx, 11, -14 + crouch, 5.2, 4.4, F(o, '#c48a4a'));
  ctx.fillStyle = F(o, '#f2e2c0'); ctx.beginPath(); ctx.ellipse(14, -12.5 + crouch, 3.2, 2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = F(o, '#c48a4a'); ctx.beginPath(); ctx.moveTo(8, -17 + crouch); ctx.lineTo(9, -21 + crouch); ctx.lineTo(11, -18 + crouch); ctx.fill();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(13, -15 + crouch, 1.1, 0, TAU); ctx.arc(17, -13 + crouch, 0.8, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------------- Tanuki: round raccoon-dog, straw hat, sake jug on its back
export function drawTanuki(ctx, o) {
  const t = o.time, mv = o.move || 0, w = o.walk || 0;
  begin(ctx, o, 1.1, 12);
  const bob = -Math.abs(Math.sin(w)) * 2 * mv;
  const throwing = o.pose && (o.pose.kind === 'windup' || o.pose.kind === 'strike');
  // tail
  blob(ctx, -11, -8 + bob, 6, 4, F(o, '#7a5636'), -0.5);
  ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-14, -10 + bob); ctx.lineTo(-11, -5 + bob); ctx.moveTo(-10, -11 + bob); ctx.lineTo(-7, -7 + bob); ctx.stroke();
  // jug on back
  blob(ctx, -6, -18 + bob, 5, 6, F(o, '#d8c8a0'));
  ctx.fillStyle = F(o, '#2a2030'); ctx.fillRect(-8, -26 + bob, 4, 3);
  ctx.fillStyle = '#c0392b'; ctx.font = '700 5px serif'; ctx.textAlign = 'center'; ctx.fillText('酒', -6, -16 + bob);
  // legs
  const sw = Math.sin(w) * 2.5 * mv;
  leg(ctx, -3, -4, -4 + sw, 0, 3.4, F(o, '#3a2a1a')); leg(ctx, 4, -4, 5 - sw, 0, 3.4, F(o, '#3a2a1a'));
  // round belly body
  blob(ctx, 1, -12 + bob, 10, 10, F(o, '#8a6440'));
  ctx.fillStyle = F(o, '#e8d4b0'); ctx.beginPath(); ctx.ellipse(3, -10 + bob, 6, 7, 0, 0, TAU); ctx.fill();
  // arm holding a small jug when throwing
  const aa = throwing ? -2 + (o.pose.t || 0) * 2.5 : 0.8;
  ctx.save(); ctx.translate(7, -15 + bob); ctx.rotate(aa);
  leg(ctx, 0, 0, 7, 0, 2.8, F(o, '#3a2a1a'));
  if (throwing) blob(ctx, 9, 0, 3, 3.4, F(o, '#c8803a'), 0, 1);
  ctx.restore();
  // head with mask markings
  const hy = -25 + bob;
  blob(ctx, 4, hy, 7, 6, F(o, '#9a7048'));
  ctx.fillStyle = F(o, '#2a1e16'); ctx.beginPath(); ctx.ellipse(6.5, hy + 0.5, 4.5, 2.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = F(o, '#f4e6c8'); ctx.beginPath(); ctx.ellipse(9.5, hy + 2.5, 2.6, 1.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(11.5, hy + 2, 1, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(7, hy, 0.9, 0, TAU); ctx.fill();
  // straw hat
  ctx.beginPath(); ctx.moveTo(-6, hy - 4); ctx.quadraticCurveTo(4, hy - 6, 15, hy - 4); ctx.lineTo(4, hy - 12); ctx.closePath();
  ctx.fillStyle = F(o, '#d8b46a'); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
}

// ---------------- Boar spirit: huge tusked boar with glowing eyes and a spirit mane
export function drawBoar(ctx, o) {
  const t = o.time, mv = o.move || 0, w = o.walk || 0;
  begin(ctx, o, 1.55, 12);
  const charging = o.e && o.e.state === 'charge';
  const stunned = o.e && o.e.state === 'stunned';
  const paw = winding(o) ? Math.sin(t * 24) * 2 : 0;
  const run = charging ? 1 : mv;
  const sw = Math.sin(w * (charging ? 2 : 1)) * 3 * run;
  // legs (back pair first)
  leg(ctx, -9, -8, -10 - sw, 0, 3.6, F(o, '#3a2618')); leg(ctx, 7, -8, 8 + sw + paw, 0, 3.6, F(o, '#3a2618'));
  // body
  ctx.beginPath(); ctx.moveTo(-15, -10); ctx.quadraticCurveTo(-14, -26, 0, -27); ctx.quadraticCurveTo(14, -27, 16, -14); ctx.quadraticCurveTo(10, -5, -12, -5); ctx.closePath();
  ctx.fillStyle = F(o, '#5a3a24'); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.stroke();
  // bristle mane (spirit flame)
  for (let i = 0; i < 7; i++) {
    const x = -10 + i * 3.6, h = 6 + Math.sin(t * 9 + i) * 2;
    ctx.fillStyle = o.flash > 0 ? W : i % 2 ? 'rgba(255,140,60,0.9)' : 'rgba(255,200,90,0.85)';
    ctx.beginPath(); ctx.moveTo(x - 2, -25 + Math.abs(i - 3) * 0.6); ctx.lineTo(x, -25 - h); ctx.lineTo(x + 2, -25 + Math.abs(i - 3) * 0.6); ctx.fill();
  }
  leg(ctx, -6, -8, -7 + sw, 0, 3.6, F(o, '#4a3020')); leg(ctx, 10, -8, 11 - sw, 0, 3.6, F(o, '#4a3020'));
  // head + snout + tusks
  blob(ctx, 17, -15, 7, 6.5, F(o, '#6a4630'));
  blob(ctx, 23, -12, 3.6, 3, F(o, '#c89a80'), 0, 1.2);
  ctx.fillStyle = F(o, '#f4eedc'); ctx.strokeStyle = INK; ctx.lineWidth = 1;
  for (const s of [0, 1]) { ctx.beginPath(); ctx.moveTo(20 + s, -10); ctx.quadraticCurveTo(27 + s, -12, 26 + s, -19); ctx.quadraticCurveTo(24, -12, 19 + s, -8); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = stunned ? '#fff' : '#ff4a2a'; ctx.beginPath(); ctx.arc(18, -18, 1.4, 0, TAU); ctx.fill();
  if (stunned) { ctx.fillStyle = '#ffe680'; for (let i = 0; i < 3; i++) { const a = t * 5 + (i * TAU) / 3; ctx.beginPath(); ctx.arc(14 + Math.cos(a) * 7, -30 + Math.sin(a) * 2.5, 1.6, 0, TAU); ctx.fill(); } }
  ctx.restore();
}

// ---------------- Komainu: stone lion-dog guardian with curly mane
export function drawKomainu(ctx, o) {
  const t = o.time, mv = o.move || 0, w = o.walk || 0;
  begin(ctx, o, 1.5, 14);
  const stone = F(o, '#9a968c'), dark = F(o, '#6e6a62'), moss = 'rgba(90,130,70,0.55)';
  const crouch = winding(o) ? 3 : 0;
  const sw = Math.sin(w) * 2 * mv;
  leg(ctx, -8, -8 + crouch, -9 - sw, 0, 4.4, dark); leg(ctx, 7, -8 + crouch, 8 + sw, 0, 4.4, dark);
  // body
  blob(ctx, -1, -13 + crouch, 12, 8, stone);
  ctx.fillStyle = moss; ctx.beginPath(); ctx.ellipse(-5, -17 + crouch, 5, 2, 0.2, 0, TAU); ctx.fill();
  // curly tail
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(-14, -20 + crouch, 4, 0.5, 5.5); ctx.stroke();
  ctx.strokeStyle = stone; ctx.lineWidth = 2.4; ctx.stroke();
  leg(ctx, -5, -8 + crouch, -6 + sw, 0, 4.4, stone); leg(ctx, 10, -8 + crouch, 11 - sw, 0, 4.4, stone);
  // mane (spiral curls) + head
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; blob(ctx, 10 + Math.cos(a) * 7, -23 + crouch + Math.sin(a) * 6, 3.2, 3.2, dark, 0, 1); }
  blob(ctx, 11, -23 + crouch, 7, 6.5, stone);
  ctx.fillStyle = F(o, '#c03a2a'); ctx.beginPath(); ctx.ellipse(16, -19 + crouch, 3.4, 2, 0, 0, Math.PI); ctx.fill(); // open mouth
  ctx.fillStyle = '#fff'; ctx.fillRect(14, -19.5 + crouch, 1.2, 1.4); ctx.fillRect(17, -19.5 + crouch, 1.2, 1.4);
  ctx.fillStyle = o.e && o.e.state === 'leap' ? '#ffe04a' : '#e8a020'; ctx.beginPath(); ctx.arc(14, -25 + crouch, 1.5, 0, TAU); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(12, -28 + crouch); ctx.lineTo(16.5, -27 + crouch); ctx.stroke();
  // red bib
  ctx.fillStyle = F(o, '#c8302a'); ctx.beginPath(); ctx.moveTo(6, -17 + crouch); ctx.lineTo(15, -16 + crouch); ctx.lineTo(10, -10 + crouch); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------------- Wisp priest: floating ghost robe with soul-fire head
export function drawWisp(ctx, o) {
  const t = o.time;
  begin(ctx, o, 1.05, 14);
  const fl = Math.sin(t * 3) * 2;
  ctx.translate(0, -6 + fl);
  // trailing robe
  ctx.beginPath(); ctx.moveTo(-7, -26);
  ctx.quadraticCurveTo(-11, -10, -6 + Math.sin(t * 5) * 2, 2);
  ctx.quadraticCurveTo(-1, -2, 2 + Math.sin(t * 6) * 2, 3);
  ctx.quadraticCurveTo(6, -1, 8 + Math.sin(t * 4) * 2, 1);
  ctx.quadraticCurveTo(10, -12, 7, -26); ctx.closePath();
  ctx.fillStyle = F(o, 'rgba(220,226,255,0.85)'); ctx.fill(); ctx.strokeStyle = 'rgba(40,40,80,0.8)'; ctx.lineWidth = 1.4; ctx.stroke();
  // sleeves raised when casting
  const cast = winding(o) ? 1 : 0;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(s * 9, -20 - cast * 5, 4, 6, s * (0.6 + cast * 0.5), 0, TAU);
    ctx.fillStyle = F(o, 'rgba(200,206,245,0.85)'); ctx.fill(); ctx.stroke();
  }
  // soul-fire head
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [r, c] of [[11, 'rgba(160,100,255,0.35)'], [7, 'rgba(200,150,255,0.6)'], [4, 'rgba(255,240,255,0.9)']]) {
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-r, -30); ctx.quadraticCurveTo(-r, -30 - r * 1.6, Math.sin(t * 8) * 2, -32 - r * 2.2); ctx.quadraticCurveTo(r, -30 - r * 1.6, r, -30); ctx.arc(0, -30, r, 0, Math.PI); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#2a1050'; ctx.beginPath(); ctx.arc(-2, -31, 1.1, 0, TAU); ctx.arc(2.5, -31, 1.1, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------------- Gashadokuro: giant skeleton torso with huge reaching hands
export function drawGasha(ctx, o) {
  const t = o.time, e = o.e;
  begin(ctx, o, 2.3, 20);
  const bone = F(o, '#e8e2cc'), shade = F(o, '#b8b09a');
  const breathe = Math.sin(t * 1.6) * 1;
  const raise = winding(o) ? clamp(o.pose.t || 0, 0, 1) : 0;
  const hand = e && e.data ? e.data.hand || 1 : 1;
  // spine + ribs
  ctx.strokeStyle = INK; ctx.lineWidth = 4.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -22); ctx.stroke();
  ctx.strokeStyle = bone; ctx.lineWidth = 2.6; ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const y = -8 - i * 3.4 + breathe * 0.3, wv = 9 - Math.abs(i - 2) * 0.8;
    ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(wv, y - 2, wv - 1, y + 3); ctx.moveTo(0, y); ctx.quadraticCurveTo(-wv, y - 2, -wv + 1, y + 3); ctx.stroke();
    ctx.strokeStyle = bone; ctx.lineWidth = 1.4; ctx.stroke();
  }
  // arms (one raised for the slam)
  for (const s of [-1, 1]) {
    const up = (s === hand ? raise : 0);
    const sx = s * 7, sy = -22;
    const ex = s * (13 - up * 4), ey = -14 - up * 18, hx = s * (17 - up * 2), hy = -4 - up * 30;
    for (const [w, c] of [[4.6, INK], [2.8, bone]]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke(); }
    // big hand
    blob(ctx, hx, hy, 4.4, 3.2, bone, 0, 1.2);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    for (let f = -1; f <= 1; f++) { ctx.beginPath(); ctx.moveTo(hx + f * 2, hy + 2); ctx.lineTo(hx + f * 3, hy + 6); ctx.stroke(); }
  }
  // skull
  blob(ctx, 1, -31, 8.5, 7.5, bone);
  ctx.fillStyle = shade; ctx.beginPath(); ctx.ellipse(1, -26, 6, 2.8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#140a14';
  ctx.beginPath(); ctx.ellipse(-2, -32, 2.4, 2.8, 0, 0, TAU); ctx.ellipse(5, -32, 2.4, 2.8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(120,220,255,${0.6 + 0.4 * Math.sin(t * 6)})`; ctx.beginPath(); ctx.arc(-2, -32, 0.9, 0, TAU); ctx.arc(5, -32, 0.9, 0, TAU); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1; for (let i = -2; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(1 + i * 1.6, -25); ctx.lineTo(1 + i * 1.6, -23); ctx.stroke(); }
  ctx.restore();
}

// ---------------- Training dummy: a straw-wrapped post with a crossbar and a painted target (it never fights back)
export function drawDummy(ctx, o) {
  const e = o.e, hitK = e ? Math.min(1, (e.hitT || 0) * 4) : 0;
  ctx.save();
  ctx.translate(o.x, o.y - (o.z || 0));
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.rotate(Math.sin((o.time || 0) * 40) * 0.05 * hitK); // it rocks a little when struck
  // the post and its base
  blob(ctx, 0, 0, 14, 5, '#6a5038');
  ctx.fillStyle = INK; ctx.fillRect(-4.5, -66, 9, 66); ctx.fillStyle = F(o, '#8a6640'); ctx.fillRect(-3, -66, 6, 66);
  // crossbar arms wrapped in rope
  ctx.fillStyle = INK; ctx.fillRect(-24, -48, 48, 7); ctx.fillStyle = F(o, '#9a7448'); ctx.fillRect(-23, -47, 46, 5);
  ctx.strokeStyle = '#d8c08a'; ctx.lineWidth = 1.2; for (const x of [-20, -16, 16, 20]) { ctx.beginPath(); ctx.moveTo(x, -48); ctx.lineTo(x + 2, -41); ctx.stroke(); }
  // straw body bundle, tied in three places
  ctx.beginPath(); ctx.moveTo(-11, -56); ctx.quadraticCurveTo(-15, -36, -10, -14); ctx.lineTo(10, -14); ctx.quadraticCurveTo(15, -36, 11, -56); ctx.closePath();
  ctx.fillStyle = F(o, '#d8b46a'); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.strokeStyle = 'rgba(120,84,30,0.55)'; ctx.lineWidth = 1; for (let k = -8; k <= 8; k += 3.2) { ctx.beginPath(); ctx.moveTo(k, -54); ctx.lineTo(k * 1.15, -16); ctx.stroke(); }
  ctx.strokeStyle = '#7a3a1e'; ctx.lineWidth = 2.4; for (const y of [-50, -34, -19]) { ctx.beginPath(); ctx.moveTo(-12, y); ctx.lineTo(12, y); ctx.stroke(); }
  // painted target on the chest
  for (const [r, c] of [[7.5, '#f4ead0'], [5, '#b52a22'], [2.4, '#f4ead0']]) { ctx.fillStyle = F(o, c); ctx.beginPath(); ctx.arc(0, -40, r, 0, TAU); ctx.fill(); }
  // straw head with a hachimaki
  blob(ctx, 0, -63, 8.5, 8, F(o, '#d8b46a'));
  ctx.fillStyle = '#e8e2d2'; ctx.fillRect(-8.5, -66, 17, 3); ctx.fillStyle = '#b52a22'; ctx.beginPath(); ctx.arc(0, -64.5, 1.6, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------------- Kaze Tsubame: a wind-swallow yokai (area 2). Midnight-blue back, white belly, a red throat,
// long swept wings and a deep forked tail; it folds its wings back to dive (wind-up) and streaks through (dash).
export function drawSwallow(ctx, o) {
  const t = o.time, e = o.e || {}, dive = e.state === 'swoop', wind = e.state === 'windup';
  const dir = begin(ctx, o, 1.05, 10);
  const back = F(o, '#1e2a50'), belly = F(o, '#f2efe6'), throat = F(o, '#c8382e');
  const flap = dive || wind ? 0 : Math.sin(t * 16);
  ctx.translate(0, -26);
  if (dive) { ctx.globalAlpha *= 0.5; ctx.strokeStyle = 'rgba(220,235,255,0.8)'; ctx.lineWidth = 1.4; for (const y of [-4, 2, 7]) { ctx.beginPath(); ctx.moveTo(-34, y); ctx.lineTo(-14, y); ctx.stroke(); } ctx.globalAlpha /= 0.5; }
  // far wing, tail, body, near wing
  const wing = (side, lift) => {
    const tipX = wind || dive ? -22 : -4, tipY = wind || dive ? -6 * side : -22 * lift * side;
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.quadraticCurveTo(-4, tipY * 0.6 - 4 * side, tipX, tipY); ctx.quadraticCurveTo(-8, tipY * 0.3, -6, 2 * side); ctx.closePath();
    ctx.fillStyle = back; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
  };
  wing(-1, 0.6 + flap * 0.5);
  ctx.beginPath(); ctx.moveTo(-8, 1); ctx.lineTo(-22, -4); ctx.lineTo(-15, 2); ctx.lineTo(-22, 8); ctx.closePath(); // the forked tail
  ctx.fillStyle = back; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, 1, 11, 5.2, 0, 0, TAU); ctx.fillStyle = back; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(1, 3, 8, 2.6, 0, 0, Math.PI); ctx.fillStyle = belly; ctx.fill();
  ctx.beginPath(); ctx.arc(9, 0, 3.4, 0, TAU); ctx.fillStyle = throat; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke(); // head and red throat
  ctx.beginPath(); ctx.moveTo(12, -0.5); ctx.lineTo(16, 0.5); ctx.lineTo(12, 1.5); ctx.closePath(); ctx.fillStyle = '#2a2420'; ctx.fill(); // beak
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(10, -1, 0.9, 0, TAU); ctx.fill();
  wing(1, 0.6 - flap * 0.5);
  ctx.restore();
}

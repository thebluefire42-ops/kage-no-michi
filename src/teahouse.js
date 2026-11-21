// The tea house: a consumable path is a rest stop instead of a fight. The team sits down inside a small
// tea house (painted over the level), the hostess serves tea, and the consumable cards are offered here.
// After the pick the team leaves through the noren and the route map comes up.
import { TAU, clamp } from './util.js';
import { drawHumanoid, drawShadow } from './rig.js';
import { PALS, weaponRig } from './cutscene.js';

// the hostess: an older woman in an indigo kimono with a gold obi, hair pinned up
const HOSTESS = { pal: { skin: '#e8c8a8', cloth: '#2a3a5a', cloth2: '#1e2a44', sash: '#c8a050', hood: '#8a8480', hair: '#9a9490', metal: '#ddd', wood: '#7a4e2a', accent: '#c8a050' }, head: 'longhair', robe: true };

const SERIF = '"Shippori Mincho", serif';

export function drawTeaHouse(ctx, g, t) {
  const v = g.view, W = v.W, H = v.H, u = Math.min(W / 1280, H / 720);
  const floorY = H * 0.6;
  ctx.save();
  // ---- the back wall: glowing shoji panels in a dark wooden frame
  const wall = ctx.createLinearGradient(0, 0, 0, floorY); wall.addColorStop(0, '#e9d4a4'); wall.addColorStop(1, '#f6e6c0');
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, floorY);
  ctx.strokeStyle = 'rgba(90,60,30,0.55)'; ctx.lineWidth = 1.5 * u;
  for (let x = 0; x < W; x += 34 * u) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, floorY); ctx.stroke(); }
  for (let y = 0; y < floorY; y += 46 * u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // light from outside through the paper
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const sun = ctx.createRadialGradient(W * 0.78, floorY * 0.4, 0, W * 0.78, floorY * 0.4, W * 0.45); sun.addColorStop(0, 'rgba(255,220,150,0.35)'); sun.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, floorY); ctx.restore();
  // a branch's shadow on the shoji, moving a little
  ctx.save(); ctx.fillStyle = 'rgba(60,40,24,0.16)'; ctx.translate(W * 0.86, floorY * 0.12); ctx.rotate(Math.sin(t * 0.7) * 0.02);
  ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(60,40,24,0.16)'; ctx.lineWidth = 6 * u; ctx.beginPath(); ctx.moveTo(60 * u, -20 * u); ctx.quadraticCurveTo(-30 * u, 40 * u, -140 * u, 70 * u); ctx.stroke();
  for (let k = 0; k < 9; k++) { ctx.beginPath(); ctx.ellipse(-k * 16 * u + 20 * u, 22 * u + k * 6 * u + (k % 2 ? 10 : -6) * u, 12 * u, 6 * u, 0.4, 0, TAU); ctx.fill(); }
  ctx.restore();
  // ---- the tokonoma: an alcove with a hanging scroll and a vase of plum blossom
  const tx = W * 0.36, tw = W * 0.2, ty = H * 0.1;
  ctx.fillStyle = '#7a5532'; ctx.fillRect(tx, ty, tw, floorY - ty);
  const al = ctx.createLinearGradient(0, ty, 0, floorY); al.addColorStop(0, 'rgba(0,0,0,0.25)'); al.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.fillStyle = al; ctx.fillRect(tx, ty, tw, floorY - ty);
  ctx.fillStyle = '#4a2e18'; ctx.fillRect(tx - 6 * u, floorY - 14 * u, tw + 12 * u, 14 * u); // the raised floor of the alcove
  const sw = 46 * u, sx = tx + tw * 0.32 - sw / 2, sy = ty + 20 * u, sh = floorY - ty - 110 * u;
  ctx.fillStyle = '#5a6a5a'; ctx.fillRect(sx - 5 * u, sy - 6 * u, sw + 10 * u, sh + 12 * u); // scroll mounting
  ctx.fillStyle = '#f2e8d0'; ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = '#2a1e16'; ctx.font = `800 ${Math.round(28 * u)}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [...'一期一会'].forEach((ch, i) => ctx.fillText(ch, sx + sw / 2, sy + 30 * u + i * 34 * u));
  ctx.fillStyle = '#b52a22'; ctx.fillRect(sx + sw / 2 - 5 * u, sy + sh - 22 * u, 10 * u, 10 * u);
  ctx.fillStyle = '#3a2a1a'; ctx.fillRect(sx - 8 * u, sy + sh + 6 * u, sw + 16 * u, 5 * u);
  // vase and branch
  const vx = tx + tw * 0.75, vy = floorY - 14 * u;
  ctx.fillStyle = '#3a4a5a'; ctx.beginPath(); ctx.moveTo(vx - 10 * u, vy); ctx.quadraticCurveTo(vx - 16 * u, vy - 24 * u, vx - 5 * u, vy - 36 * u); ctx.lineTo(vx + 5 * u, vy - 36 * u); ctx.quadraticCurveTo(vx + 16 * u, vy - 24 * u, vx + 10 * u, vy); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3a2416'; ctx.lineWidth = 2.5 * u; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(vx, vy - 34 * u); ctx.quadraticCurveTo(vx - 10 * u, vy - 80 * u, vx - 40 * u, vy - 110 * u); ctx.moveTo(vx - 8 * u, vy - 70 * u); ctx.quadraticCurveTo(vx + 14 * u, vy - 90 * u, vx + 26 * u, vy - 118 * u); ctx.stroke();
  ctx.fillStyle = '#f0a8b8';
  for (const [bx, by] of [[-40, -110], [-26, -96], [-14, -84], [26, -118], [16, -100], [6, -88], [-32, -104]]) { ctx.beginPath(); ctx.arc(vx + bx * u, vy + by * u, 4 * u, 0, TAU); ctx.fill(); }
  // ---- posts and beams
  ctx.fillStyle = '#3e2614';
  for (const fx of [0.04, 0.34, 0.58, 0.96]) ctx.fillRect(W * fx - 9 * u, 0, 18 * u, floorY);
  ctx.fillRect(0, 0, W, 16 * u); ctx.fillRect(0, ty - 8 * u, W, 8 * u);
  ctx.fillStyle = 'rgba(255,220,170,0.12)'; for (const fx of [0.04, 0.34, 0.58, 0.96]) ctx.fillRect(W * fx - 9 * u, 0, 4 * u, floorY);
  // a noren in the doorway on the right: the way out
  const nx = W * 0.62, nw = W * 0.3, nh = floorY * 0.36;
  for (let k = 0; k < 3; k++) {
    const x = nx + k * (nw / 3), s = Math.sin(t * 1.1 + k) * 3 * u;
    ctx.fillStyle = '#3f6e34'; ctx.beginPath(); ctx.moveTo(x + 2 * u, ty); ctx.lineTo(x + nw / 3 - 2 * u, ty); ctx.lineTo(x + nw / 3 - 2 * u + s, ty + nh); ctx.lineTo(x + 2 * u + s, ty + nh); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#f4ecd8'; ctx.beginPath(); ctx.arc(nx + nw / 2, ty + nh * 0.5, 22 * u, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3f6e34'; ctx.font = `800 ${Math.round(26 * u)}px ${SERIF}`; ctx.fillText('茶', nx + nw / 2, ty + nh * 0.5 + 1);
  // ---- the floor: tatami in perspective with dark green borders
  const fl = ctx.createLinearGradient(0, floorY, 0, H); fl.addColorStop(0, '#b8a868'); fl.addColorStop(1, '#d6c68a');
  ctx.fillStyle = fl; ctx.fillRect(0, floorY, W, H - floorY);
  ctx.strokeStyle = 'rgba(120,100,50,0.25)'; ctx.lineWidth = 1;
  for (let y = floorY + 4; y < H; y += 5 * u + (y - floorY) * 0.02) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } // the weave
  ctx.strokeStyle = '#2e4a2a'; ctx.lineWidth = 6 * u;
  const vpX = W / 2, vpY = floorY - H * 0.9; // borders converge to a point far above
  for (const fx of [-0.6, -0.1, 0.4, 0.9, 1.4]) { const bx = W * fx; ctx.beginPath(); ctx.moveTo(vpX + (bx - vpX) * ((floorY - vpY) / (H - vpY)), floorY); ctx.lineTo(bx, H); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, floorY + (H - floorY) * 0.42); ctx.lineTo(W, floorY + (H - floorY) * 0.42); ctx.stroke();
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(0, floorY - 3 * u, W, 6 * u); // the sill
  // ---- the hanging paper lantern
  const lx = W * 0.2, ly = H * 0.2 + Math.sin(t * 1.3) * 2 * u;
  ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.moveTo(lx, 16 * u); ctx.lineTo(lx, ly - 34 * u); ctx.stroke();
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 140 * u); lg.addColorStop(0, 'rgba(255,190,110,0.35)'); lg.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 140 * u, 0, TAU); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#f8e2b0'; ctx.beginPath(); ctx.ellipse(lx, ly, 22 * u, 32 * u, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(120,70,30,0.6)'; ctx.lineWidth = 1 * u; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(lx, ly + k * 11 * u, 22 * u * Math.sqrt(1 - (k / 3) ** 2), 2 * u, 0, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(lx - 12 * u, ly - 36 * u, 24 * u, 6 * u); ctx.fillRect(lx - 12 * u, ly + 30 * u, 24 * u, 6 * u);
  ctx.fillStyle = '#b52a22'; ctx.font = `800 ${Math.round(18 * u)}px ${SERIF}`; ctx.fillText('茶', lx, ly + 1);
  // ---- the low table with the tea set, the hostess and the team
  const cx = W * 0.5, cy = H * 0.8;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(cx, cy + 34 * u, 150 * u, 20 * u, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2a0e0c'; ctx.beginPath(); ctx.moveTo(cx - 140 * u, cy); ctx.lineTo(cx + 140 * u, cy); ctx.lineTo(cx + 120 * u, cy + 26 * u); ctx.lineTo(cx - 120 * u, cy + 26 * u); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5a1a14'; ctx.beginPath(); ctx.ellipse(cx, cy, 140 * u, 26 * u, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,200,140,0.25)'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.ellipse(cx, cy, 132 * u, 22 * u, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  // iron teapot
  ctx.fillStyle = '#1a1a1e'; ctx.beginPath(); ctx.ellipse(cx - 40 * u, cy - 14 * u, 22 * u, 18 * u, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#1a1a1e'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(cx - 40 * u, cy - 30 * u, 14 * u, Math.PI, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 20 * u, cy - 16 * u); ctx.lineTo(cx - 8 * u, cy - 26 * u); ctx.stroke();
  // cups and a plate of sweets
  for (const dx of [10, 44]) { ctx.fillStyle = '#d8d0b8'; ctx.beginPath(); ctx.moveTo(cx + (dx - 9) * u, cy - 18 * u); ctx.lineTo(cx + (dx + 9) * u, cy - 18 * u); ctx.lineTo(cx + (dx + 7) * u, cy - 4 * u); ctx.lineTo(cx + (dx - 7) * u, cy - 4 * u); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#7a9a3a'; ctx.beginPath(); ctx.ellipse(cx + dx * u, cy - 18 * u, 9 * u, 2.5 * u, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#e8e2d2'; ctx.beginPath(); ctx.ellipse(cx + 90 * u, cy - 6 * u, 20 * u, 6 * u, 0, 0, TAU); ctx.fill();
  for (const [dx, c] of [[-8, '#f2b8c8'], [6, '#f6f0e0'], [-1, '#a8c878']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx + (90 + dx) * u, cy - 11 * u, 6 * u, 0, TAU); ctx.fill(); }
  // steam
  ctx.lineCap = 'round';
  for (const dx of [10, 44, -40]) for (let k = 0; k < 2; k++) {
    const life = (t * 0.4 + k * 0.5 + dx * 0.01) % 1, a = Math.sin(life * Math.PI) * 0.55, yy = cy - (dx < 0 ? 36 : 22) * u - life * 40 * u;
    ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.moveTo(cx + dx * u, yy); ctx.bezierCurveTo(cx + (dx + 8) * u, yy - 8 * u, cx + (dx - 8) * u, yy - 16 * u, cx + dx * u, yy - 24 * u); ctx.stroke();
  }
  // the hostess on the far side of the table, the team on the near left
  // the same figures as in the levels and the cutscenes (the rig), kneeling at the table: the hostess across it,
  // the team on the near left with their own colours and weapons
  const fig = (rig, x, y, facing, seed) => {
    drawShadow(ctx, x, y, 34 * u, 0.28);
    drawHumanoid(ctx, { ...rig, x, y, z: 0, facing, time: t + seed, walk: 0, move: 0, s: 2.4 * u, pose: { kind: 'kneel', t: 0.05 }, flash: 0, alpha: 1, seed });
  };
  fig(HOSTESS, cx + 210 * u, cy + 8 * u, Math.PI, 5);
  g.players.forEach((p, i) => fig({ pal: PALS[i] || PALS[0], head: 'hood', scarf: true, ...weaponRig(p) }, cx - (210 + i * 100) * u, cy + (12 + i * 10) * u, 0, i + 1));
  // vignette
  const vg = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(20,10,4,0)'); vg.addColorStop(1, 'rgba(20,10,4,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// fade the tea house in and out over the level (k = 0..1)
export function teaHouseAlpha(th) { return th ? clamp(th.leaving ? 1 - th.leaveT / 0.9 : th.t / 0.6, 0, 1) : 0; }

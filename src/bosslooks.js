// Each boss's signature, drawn around the shared figure: simple shapes, a few strong colours, one idea each.
//   Kurogane (Iron Ronin)  – a black war banner (sashimono) on his back with his gold crest, a gold crescent on the helmet
//   Tengu                  – a fan of crimson-tipped feathers spread behind him like a halo, a small black tokin cap
//   Shuten (Oni Lord)      – heat haze rising off his shoulders, his sake gourd at the hip, horn tips glowing like embers
//   Gensai (the Regent)    – a slowly turning crimson clan crest behind his head
// layer 'back' is drawn before the figure, 'front' after. (sx, sy) = the boss's feet on screen, h = its height in px.
import { TAU } from './util.js';
import { INK } from './rig.js';

export function drawBossSignature(ctx, e, sx, sy, h, t, facing, layer, alpha = 1) {
  const dir = Math.cos(facing) >= 0 ? 1 : -1;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const f = SIG[e.type];
  if (f) f(ctx, e, sx, sy, h, t, dir, layer);
  ctx.restore();
}

const SIG = {
  ronin_boss(ctx, e, sx, sy, h, t, dir, layer) {
    if (layer === 'back') { // the sashimono: a pole over his back, a black banner snapping in the wind
      const px = sx - dir * h * 0.09, top = sy - h * 1.32, base = sy - h * 0.58;
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(px, base); ctx.lineTo(px, top); ctx.stroke();
      ctx.strokeStyle = '#4a3226'; ctx.lineWidth = 2; ctx.stroke();
      const w = h * 0.3, hh = h * 0.4, x0 = px - dir * 1;
      ctx.beginPath(); ctx.moveTo(x0, top + 3);
      for (let k = 0; k <= 8; k++) { const f = k / 8; ctx.lineTo(x0 - dir * w * f, top + 3 + Math.sin(t * 5 + f * 3) * 2.5 * f); }
      for (let k = 8; k >= 0; k--) { const f = k / 8; ctx.lineTo(x0 - dir * w * f, top + 3 + hh + Math.sin(t * 5 + f * 3 + 0.6) * 3 * f); }
      ctx.closePath(); ctx.fillStyle = '#1c1a22'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
      // his crest: a gold ring around an iron bar (黒鉄, black iron)
      const cx = x0 - dir * w * 0.5, cy = top + 3 + hh * 0.5 + Math.sin(t * 5 + 1.5) * 1.5, r = w * 0.27;
      ctx.strokeStyle = '#d8a838'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#d8a838'; ctx.fillRect(cx - 1.6, cy - r * 0.7, 3.2, r * 1.4);
    } else { // a gold crescent (maedate) rising off the helmet's brow
      const hx = sx + dir * h * 0.02, hy = sy - h * 0.83; // (the helmet brow)
      ctx.fillStyle = '#e0b040'; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(hx - h * 0.13, hy - h * 0.12); ctx.quadraticCurveTo(hx, hy + h * 0.02, hx + h * 0.13, hy - h * 0.12);
      ctx.quadraticCurveTo(hx, hy - h * 0.035, hx - h * 0.13, hy - h * 0.12); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  },

  tengu(ctx, e, sx, sy, h, t, dir, layer) {
    const z = (e.z || 0) * 32, cy = sy - z - h * 0.62;
    if (layer === 'back') { // the feather halo: seven long feathers fanned behind the shoulders, breathing slowly
      const breathe = 1 + Math.sin(t * 1.6) * 0.04;
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k - 3) * 0.32, L = h * (k === 3 ? 0.62 : 0.54) * breathe;
        ctx.save(); ctx.translate(sx, cy); ctx.rotate(a + Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(L * 0.16, -L * 0.55, 0, -L); ctx.quadraticCurveTo(-L * 0.16, -L * 0.55, 0, 0);
        ctx.fillStyle = '#f2ece0'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.stroke();
        // crimson tip, black band
        ctx.beginPath(); ctx.moveTo(-L * 0.07, -L * 0.74); ctx.quadraticCurveTo(0, -L * 1.02, L * 0.07, -L * 0.74); ctx.closePath(); ctx.fillStyle = '#c42a24'; ctx.fill();
        ctx.fillStyle = '#26202a'; ctx.fillRect(-L * 0.09, -L * 0.66, L * 0.18, L * 0.05);
        ctx.restore();
      }
    } else { // a small black tokin cap on the brow, tied with a cord
      const hx = sx + dir * h * 0.04, hy = sy - z - h * 0.84; // (on top of the head)
      ctx.fillStyle = '#1c1a20'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(hx - 6, hy + 2); ctx.lineTo(hx - 4, hy - 6); ctx.lineTo(hx + 4, hy - 7); ctx.lineTo(hx + 6, hy + 1); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c42a24'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hx - 6, hy + 2); ctx.lineTo(hx + 6, hy + 1); ctx.stroke();
    }
  },

  oni_lord(ctx, e, sx, sy, h, t, dir, layer) {
    if (layer === 'back') { // heat haze: three slow tongues of flame rising off the shoulders
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const x = sx + (k - 1) * h * 0.18, base = sy - h * 0.72, H = h * (0.32 + 0.08 * Math.sin(t * 3 + k * 2));
        const sway = Math.sin(t * 2.3 + k) * h * 0.04;
        const gr = ctx.createLinearGradient(x, base, x, base - H);
        gr.addColorStop(0, 'rgba(255,120,40,0.3)'); gr.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(x - h * 0.07, base); ctx.quadraticCurveTo(x - h * 0.05 + sway, base - H * 0.6, x + sway * 1.5, base - H); ctx.quadraticCurveTo(x + h * 0.05 + sway, base - H * 0.6, x + h * 0.07, base); ctx.closePath(); ctx.fill();
      }
    } else {
      // his sake gourd, hanging at the hip on a red cord
      const gx = sx - dir * h * 0.2, gy = sy - h * 0.36 + Math.sin(t * 2 + 1) * 1.2;
      ctx.strokeStyle = '#b8282a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(gx + dir * 2, gy - h * 0.12); ctx.lineTo(gx, gy - h * 0.06); ctx.stroke();
      ctx.fillStyle = '#d8a860'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(gx, gy + h * 0.035, h * 0.06, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx, gy - h * 0.04, h * 0.04, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b8282a'; ctx.fillRect(gx - h * 0.04, gy - h * 0.012, h * 0.08, h * 0.018);
      // the horn tips glow like embers
      ctx.globalCompositeOperation = 'lighter';
      const glow = 0.55 + 0.3 * Math.sin(t * 4);
      for (const side of [-1, 1]) {
        const hx = sx + side * h * 0.085, hy = sy - h * 1.08;
        const gr = ctx.createRadialGradient(hx, hy, 0, hx, hy, h * 0.06);
        gr.addColorStop(0, `rgba(255,190,90,${glow})`); gr.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(hx, hy, h * 0.06, 0, TAU); ctx.fill();
      }
    }
  },

  gensai(ctx, e, sx, sy, h, t, dir, layer) {
    if (layer !== 'back') return;
    // the Kagerō crest behind his head: a ring of eight heat-haze flames, turning slowly
    const cx = sx - dir * h * 0.02, cy = sy - h * 0.86, R = h * 0.24, rot = t * 0.25;
    ctx.globalAlpha *= 0.85;
    ctx.strokeStyle = 'rgba(160,20,40,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(150,18,36,0.85)';
    for (let k = 0; k < 8; k++) {
      const a = rot + (k / 8) * TAU;
      ctx.save(); ctx.translate(cx + Math.cos(a) * R * 0.91, cy + Math.sin(a) * R * 0.91); ctx.rotate(a + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -R * 0.2); ctx.quadraticCurveTo(R * 0.09, 0, 0, R * 0.08); ctx.quadraticCurveTo(-R * 0.09, 0, 0, -R * 0.2); ctx.fill();
      ctx.restore();
    }
  },
};

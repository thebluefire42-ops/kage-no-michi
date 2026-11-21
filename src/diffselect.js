// Difficulty select: after the equipment, before the run. Three hanging panels (Easy / Normal / Hard); the
// host (or player 1) chooses for everyone. The numbers come from RUN_DIFFICULTY in config.js.
import { TAU, clamp, ease } from './util.js';
import { RUN_DIFFICULTY, RUN_DIFF_ORDER } from './config.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { uiScale, text, outlinedText } from './ui.js';
import { INK } from './rig.js';

const FONT_SERIF = '"Shippori Mincho", serif';

export class DiffSelect {
  constructor(menu) { this.m = menu; this.sel = 1; this.t = 0; this.hover = -1; }
  open() { this.t = 0; this.sel = Math.max(0, RUN_DIFF_ORDER.indexOf(this.m.g.lastDiff || 'normal')); }
  get key() { return RUN_DIFF_ORDER[this.sel]; }

  rects() {
    const v = this.m.g.view, u = uiScale(v), w = 250 * u, h = 330 * u, gap = 26 * u, y = v.H * 0.5 - h / 2 + 10 * u;
    return RUN_DIFF_ORDER.map((_, i) => [v.W / 2 + (i - 1) * (w + gap) - w / 2, y, w, h]);
  }

  // returns 'back', 'start' or null
  update(dt, clicked, mx, my) {
    this.t += dt;
    const n = RUN_DIFF_ORDER.length;
    if (input.pressed('left')) { this.sel = (this.sel + n - 1) % n; sfx.move(); }
    if (input.pressed('right')) { this.sel = (this.sel + 1) % n; sfx.move(); }
    this.hover = -1;
    this.rects().forEach(([x, y, w, h], i) => { if (mx > x && mx < x + w && my > y && my < y + h) this.hover = i; });
    if (this.hover >= 0 && this.hover !== this.sel && input.mouse.lastMove !== this.lastMouse) { this.sel = this.hover; this.lastMouse = input.mouse.lastMove; sfx.move(); }
    if (input.pressed('back')) { input.eat('back'); return 'back'; }
    if (this.t > 0.25 && (input.pressed('confirm') || input.pressed('pause') || (clicked && this.hover >= 0))) { this.m.g.lastDiff = this.key; return 'start'; }
    return null;
  }

  draw(ctx) {
    const g = this.m.g, v = g.view, u = uiScale(v), t = this.t, pad = input.players[0].mode === 'pad';
    const a = ease.outCubic(clamp(t / 0.35, 0, 1));
    ctx.save(); ctx.globalAlpha = a;
    outlinedText(ctx, 'Choose your difficulty', v.W / 2, v.H * 0.09, 34 * u, '#f8f0de');
    text(ctx, '難易', v.W / 2, v.H * 0.09 + 32 * u, 15 * u, '#e8c470', 800, FONT_SERIF);
    this.rects().forEach(([x, y, w, h], i) => {
      const k = RUN_DIFF_ORDER[i], D = RUN_DIFFICULTY[k], on = i === this.sel;
      const lift = on ? -8 * u : 0;
      ctx.save(); ctx.translate(0, lift);
      // a hanging panel: dark lacquer, a thin gold line, the cord at the top
      ctx.strokeStyle = 'rgba(232,196,112,0.6)'; ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x + w / 2, y - 22 * u); ctx.lineTo(x + w * 0.7, y); ctx.stroke();
      ctx.shadowColor = on ? 'rgba(255,200,100,0.5)' : 'rgba(0,0,0,0.5)'; ctx.shadowBlur = on ? 30 * u : 10 * u;
      const gr = ctx.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#2a1d18'); gr.addColorStop(1, '#130c0a');
      ctx.fillStyle = gr; ctx.fillRect(x, y, w, h); ctx.shadowBlur = 0;
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = on ? 'rgba(244,214,144,0.95)' : 'rgba(200,160,90,0.35)'; ctx.lineWidth = 1.2 * u; ctx.strokeRect(x + 7 * u, y + 7 * u, w - 14 * u, h - 14 * u);
      if (on) { ctx.strokeStyle = '#d0262a'; ctx.lineWidth = 4 * u; ctx.strokeRect(x - 6 * u, y - 6 * u, w + 12 * u, h + 12 * u); }
      // the seal: a big brushed kanji on a coloured disc
      const cx = x + w / 2, sy = y + 82 * u;
      ctx.fillStyle = D.color; ctx.globalAlpha *= on ? 0.95 : 0.7; ctx.beginPath(); ctx.arc(cx, sy, 46 * u, 0, TAU); ctx.fill(); ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(20,10,10,0.8)'; ctx.lineWidth = 2; ctx.stroke();
      outlinedText(ctx, D.jp, cx, sy + 2 * u, 46 * u, '#fff4e4', 'rgba(20,8,8,0.7)', 800, FONT_SERIF, 4 * u);
      text(ctx, D.name, cx, y + 158 * u, 24 * u, on ? '#fff4d8' : '#e8d8b8', 800, FONT_SERIF);
      ctx.fillStyle = 'rgba(232,196,112,0.5)'; ctx.fillRect(x + w * 0.2, y + 178 * u, w * 0.6, 1);
      D.lines.forEach((ln, j) => text(ctx, ln, cx, y + 204 * u + j * 24 * u, 14 * u, k === 'easy' ? '#9fe0a0' : k === 'hard' ? '#ff9a8a' : 'rgba(240,224,188,0.75)', 700));
      ctx.restore();
    });
    text(ctx, pad ? '◀ ▶ choose · Ⓐ / START begin · Ⓑ back' : '← → or mouse to choose · Enter / click to begin · Esc back', v.W / 2, v.H - 22 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
    ctx.restore();
  }
}

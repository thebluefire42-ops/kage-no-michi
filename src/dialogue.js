// Retro dialogue box: pixel portraits bottom-left (the players' side) and bottom-right (the other
// speaker), a typewriter text box between them, name plates and a blinking cursor.
import { TAU, clamp, lerp } from './util.js';
import { drawHumanoid } from './rig.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { CHARACTERS } from './story.js';

const PIX = 64;          // portrait resolution (scaled up with nearest-neighbour for the pixel look)
const CPS = 46;          // characters per second
const FONT = '"DotGothic16", "Zen Kaku Gothic New", monospace';
const cache = {};

// head-and-shoulders portrait of a character, rendered small and cached
export function portrait(key) {
  if (cache[key]) return cache[key];
  const C = CHARACTERS[key];
  const c = document.createElement('canvas'); c.width = c.height = PIX;
  const g = c.getContext('2d');
  const left = C.side === 'left';
  // backdrop
  const bg = g.createLinearGradient(0, 0, 0, PIX);
  bg.addColorStop(0, left ? '#2a3a6a' : '#5a1a26'); bg.addColorStop(1, left ? '#121a34' : '#22080e');
  g.fillStyle = bg; g.fillRect(0, 0, PIX, PIX);
  g.fillStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i < PIX; i += 4) g.fillRect(0, i, PIX, 1);
  const o = C.rig();
  const S = 1.6;
  Object.assign(o, { x: PIX / 2 + (left ? -2 : 2), y: PIX * 0.56 + 35.5 * S, z: 0, facing: left ? 0 : Math.PI, time: 0.6, walk: 0, move: 0, flash: 0, alpha: 1, s: S, seed: 0 });
  o.weapon = null; o.weapon2 = null; o.backWeapon = null; o.pose = null;
  o.wings = o.wings && !o.smallWings ? false : o.wings;
  (o.draw || drawHumanoid)(g, o);
  // hard pixel edge
  g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(1, 1, PIX - 2, PIX - 2);
  cache[key] = c;
  return c;
}

function wrap(ctx, str, maxW) {
  const words = str.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

export class Dialogue {
  // g: game. opts.remote: lines advance only when told to (online joiner)
  constructor(g, opts = {}) { this.g = g; this.remote = !!opts.remote; this.active = false; }

  open(id, lines, onDone, onLine) {
    this.id = id; this.lines = lines; this.onDone = onDone; this.onLine = onLine;
    this.active = true; this.t = 0; this.inT = 0; this.lastOther = null;
    this.go(0);
  }

  go(i) {
    this.i = i; this.shown = 0; this.lineT = 0;
    const L = this.lines[i];
    if (!L) return;
    if (CHARACTERS[L.who] && CHARACTERS[L.who].side === 'right') this.lastOther = L.who;
    else if (!this.lastOther) this.lastOther = this.lines.slice(i).map((l) => l.who).find((w) => CHARACTERS[w] && CHARACTERS[w].side === 'right') || null;
    if (L.who === 'kage' || L.who === 'kaze') this.lastLeft = L.who;
    else if (!this.lastLeft) this.lastLeft = this.lines.slice(i).map((l) => l.who).find((w) => w === 'kage' || w === 'kaze') || null;
    this.onLine?.(i, L);
  }

  get line() { return this.lines[this.i]; }
  get typing() { return this.line && this.shown < this.line.text.length; }

  advance() {
    if (!this.active) return;
    if (this.typing) { this.shown = this.line.text.length; return; }
    if (this.i + 1 >= this.lines.length) this.close();
    else { sfx.move(); this.go(this.i + 1); }
  }
  close() { if (!this.active) return; this.active = false; const f = this.onDone; this.onDone = null; f?.(); }
  skip() { this.close(); }

  update(dt) {
    if (!this.active) return;
    this.t += dt; this.inT = Math.min(1, this.inT + dt * 5); this.lineT += dt;
    const L = this.line;
    if (!L) { this.close(); return; }
    if (this.typing) {
      const before = Math.floor(this.shown);
      this.shown = Math.min(L.text.length, this.shown + dt * CPS);
      if (Math.floor(this.shown) !== before && Math.floor(this.shown) % 2 === 0 && L.text[Math.floor(this.shown)] !== ' ') sfx.blip((CHARACTERS[L.who] || {}).voice || 1);
    }
    if (this.lineT < 0.12) return; // ignore the press that opened the box
    const next = input.pressed('confirm') || input.pressed('dash') || input.mouse.clicked;
    const skip = input.pressed('pause') || input.pressed('back');
    if (next) { input.eat('confirm'); input.eat('dash'); if (this.remote) this.onRemoteNext?.(); else this.advance(); }
    if (skip && !this.remote) { input.eat('pause'); input.eat('back'); this.skip(); }
  }

  draw(ctx) {
    if (!this.active || !this.line) return;
    const v = this.g.view, W = v.W, H = v.H;
    const u = clamp(Math.min(W / 1280, H / 760), 0.5, 4);
    const L = this.line, C = CHARACTERS[L.who] || { name: L.who, side: 'left' };
    const ps = Math.round(150 * u), pad = Math.round(22 * u), gap = Math.round(12 * u);
    const by = H - pad - ps, slide = (1 - this.inT) * 40 * u;
    const bx = pad + ps + gap, bw = W - 2 * (pad + ps + gap), bh = ps;
    ctx.save();
    ctx.translate(0, slide); ctx.globalAlpha = this.inT;
    // portraits
    const frames = [['left', this.lastLeft, pad], ['right', this.lastOther, W - pad - ps]];
    for (const [side, who, x] of frames) {
      if (!who || !CHARACTERS[who]) continue;
      const speaking = who === L.who;
      const bob = speaking && this.typing ? Math.round(Math.abs(Math.sin(this.t * 14)) * 2 * u) : 0;
      const lift = speaking ? Math.round(-6 * u) : 0;
      this.box(ctx, x, by + lift, ps, ps, u, speaking);
      ctx.imageSmoothingEnabled = false;
      const inset = Math.round(6 * u);
      ctx.drawImage(portrait(who), x + inset, by + lift + inset - bob, ps - inset * 2, ps - inset * 2 + bob);
      ctx.imageSmoothingEnabled = true;
      if (!speaking) { ctx.fillStyle = 'rgba(6,8,20,0.55)'; ctx.fillRect(x + inset, by + inset, ps - inset * 2, ps - inset * 2); }
    }
    // text box
    this.box(ctx, bx, by, bw, bh, u, true);
    // name plate on the speaker's side
    ctx.font = `${Math.round(20 * u)}px ${FONT}`;
    const name = L.name || `${C.jp ? C.jp + ' ' : ''}${C.name}`; // a line can name its speaker (a temple monk's own name)
    const nw = ctx.measureText(name).width + 28 * u, nh = 34 * u;
    const nx = C.side === 'right' ? bx + bw - nw - 14 * u : bx + 14 * u;
    this.box(ctx, nx, by - nh + 6 * u, nw, nh, u, true, C.side === 'right' ? '#5a1424' : '#1a2a5a');
    ctx.fillStyle = '#ffe9a8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, nx + nw / 2, by - nh / 2 + 7 * u);
    // text
    ctx.font = `${Math.round(24 * u)}px ${FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const lines = wrap(ctx, L.text, bw - 56 * u);
    let left = Math.floor(this.shown);
    lines.forEach((ln, i) => {
      const part = ln.slice(0, Math.max(0, left));
      left -= ln.length + 1;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(part, bx + 28 * u + 2 * u, by + 26 * u + i * 34 * u + 2 * u);
      ctx.fillStyle = '#f6f2ff'; ctx.fillText(part, bx + 28 * u, by + 26 * u + i * 34 * u);
    });
    // blinking cursor / hints
    if (!this.typing && Math.sin(this.t * 8) > -0.2) {
      const cx = bx + bw - 30 * u, cy = by + bh - 26 * u + Math.abs(Math.sin(this.t * 4)) * 4 * u;
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.moveTo(cx - 9 * u, cy - 6 * u); ctx.lineTo(cx + 9 * u, cy - 6 * u); ctx.lineTo(cx, cy + 6 * u); ctx.closePath(); ctx.fill();
    }
    ctx.font = `${Math.round(13 * u)}px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(230,226,255,0.55)';
    const pad2 = input.mode === 'pad';
    const hint = this.remote ? (pad2 ? 'Ⓐ next' : 'Enter next') : (pad2 ? 'Ⓐ next   START skip' : 'Enter / click: next   Esc: skip');
    ctx.fillText(hint, bx + bw - 14 * u, by - 6 * u - (C.side === 'right' ? nh : 0));
    ctx.restore();
  }

  // classic double-bordered window
  box(ctx, x, y, w, h, u, lit, fill = '#0e1638') {
    const b = Math.max(2, Math.round(3 * u));
    ctx.fillStyle = '#000'; ctx.fillRect(x - b, y - b, w + b * 2, h + b * 2);
    ctx.fillStyle = lit ? '#f4f0ff' : '#8a88a0'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#000'; ctx.fillRect(x + b, y + b, w - b * 2, h - b * 2);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, fill); g.addColorStop(1, '#05081a');
    ctx.fillStyle = g; ctx.fillRect(x + b * 2, y + b * 2, w - b * 4, h - b * 4);
  }
}

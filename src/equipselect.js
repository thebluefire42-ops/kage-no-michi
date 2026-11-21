// Equipment select: after the weapon, before the run. A carousel like the weapon select: the set in focus stands
// big in the middle (its ninja idling, with your weapon), the others recede to both sides; under the ninja a text
// section says what the set gives. Each player moves their own cursor and confirms (locks in) a set; once everyone
// has, the run begins. Local co-op: player 2 uses their controller. Online: each machine moves its own player; the
// choices travel as 'equip' messages and the host starts the run (Menu.start) when both are locked in.
import { TAU, clamp, lerp } from './util.js';
import { PLAYER_COLORS } from './config.js';
import { drawHumanoid, drawShadow, INK } from './rig.js';
import { RIG_WEAPON } from './player.js';
import { PALS } from './cutscene.js';
import { EQUIPMENT, EQUIP_ORDER, equipPal } from './equipment.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { net } from './net.js';
import { uiScale, text, outlinedText, FONT_SERIF, FONT_SANS } from './ui.js';

const NE = EQUIP_ORDER.length;

export class EquipSelect {
  constructor(menu) { this.m = menu; this.t = 0; }

  open() {
    const M = this.m;
    this.t = 0;
    this.sel = [0, 0]; this.locked = [false, false];
    this.online = M.play === 'host' || M.play === 'client';
    this.mine = M.play === 'client' ? 1 : 0;
    this.focus = this.mine; this.pos = null; this.hover = -1;
  }

  get coop() { return !!this.m.joined[1]; }
  local(i) { return this.online ? i === this.mine : i === 0 || (i === 1 && this.coop); }
  allLocked() { return this.locked[0] && (!this.coop || this.locked[1]); }
  equips() { return (this.coop ? [0, 1] : [0]).map((i) => EQUIP_ORDER[this.sel[i]]); }

  onRemote(m) {
    const i = this.mine === 0 ? 1 : 0;
    this.sel[i] = clamp(m.i | 0, 0, NE - 1); this.locked[i] = !!m.ready;
  }
  send() { if (this.online) net.send('equip', { i: this.sel[this.mine], ready: this.locked[this.mine] }); }

  // the carousel: the card in focus big in the middle, the others smaller and fainter to the sides (wrapping round)
  carousel() {
    const v = this.m.g.view, u = uiScale(v);
    const w = 300 * u, h = 470 * u;
    const s0 = clamp(Math.min((v.H * 0.64) / h, (v.W * 0.36) / w), 0.6, 1.6);
    const cy0 = v.H * 0.56, pos = this.pos ?? this.sel[this.focus];
    return EQUIP_ORDER.map((k, i) => {
      let d = i - pos; d -= NE * Math.round(d / NE);
      const ad = Math.abs(d), sg = Math.sign(d), near = Math.min(ad, 1), far = Math.max(0, ad - 1);
      const s = s0 * (1 - 0.32 * near - 0.1 * far);
      const cx = v.W / 2 + sg * (w * s0 * 0.5 + w * s0 * 0.62 * near + w * s0 * 0.48 * far) * Math.min(1, ad * 1.6);
      const cy = cy0 - (8 * near + 6 * far) * u;
      const a = (ad < 0.5 ? lerp(1, 0.7, ad * 2) : Math.max(0, 0.7 - (ad - 0.5) * 0.2)) * clamp((2.5 - ad) / 0.5, 0, 1);
      const sw = w * s, sh = h * s;
      return { i, w, h, cx, cy, s, a, d, ad, rect: [cx - sw / 2, cy - sh / 2, sw, sh] };
    });
  }
  hitCard(mx, my) {
    let best = -1, bd = 1e9;
    for (const c of this.carousel()) { const [x, y, w, h] = c.rect; if (c.a > 0.05 && mx > x && mx < x + w && my > y && my < y + h && c.ad < bd) { bd = c.ad; best = c.i; } }
    return best;
  }

  step(i, dir) { if (this.locked[i]) return; this.sel[i] = (this.sel[i] + NE + dir) % NE; this.focus = i; sfx.move(); if (this.local(i)) this.send(); }
  lock(i, on) { this.locked[i] = on; if (on) sfx.select(); else sfx.flip(); if (this.local(i)) this.send(); }

  // returns 'back' (to the weapon select) or 'start'
  update(dt, clickNow, mx, my) {
    this.t += dt;
    const M = this.m, me = this.online ? this.mine : 0, c1 = input.players[0];
    { // glide toward the focused player's set (the short way round)
      const target = this.sel[this.focus], p = this.pos ?? target;
      let d = target - p; d -= NE * Math.round(d / NE);
      this.pos = Math.abs(d) < 0.001 ? target : (((p + d * (1 - Math.exp(-12 * dt))) % NE) + NE) % NE;
    }
    this.hover = this.hitCard(mx, my);
    if (c1.pressed('left')) this.step(me, -1);
    if (c1.pressed('right')) this.step(me, 1);
    if (input.mouse.wheel) { this.step(me, Math.sign(input.mouse.wheel)); input.mouse.wheel = 0; }
    if (c1.pressed('back')) {
      input.eat('back');
      if (this.locked[me]) this.lock(me, false);
      else if (M.play !== 'client') return 'back';
    }
    if (clickNow && this.hover >= 0) { // a side card comes to the middle; the middle one locks in
      if (this.hover !== this.sel[me]) { if (this.locked[me]) this.lock(me, false); this.sel[me] = this.hover; this.focus = me; sfx.move(); this.send(); }
      else this.lock(me, !this.locked[me]);
    } else if (c1.pressed('confirm') || (c1.mode === 'pad' && c1.pressed('pause'))) { input.eat('confirm'); input.eat('pause'); this.focus = me; this.lock(me, !this.locked[me]); }
    if (!this.online && this.coop) {
      const c2 = input.players[1];
      if (c2.pressed('left')) this.step(1, -1);
      if (c2.pressed('right')) this.step(1, 1);
      if (c2.pressed('confirm') || c2.pressed('pause')) { c2.eat('confirm'); this.focus = 1; this.lock(1, !this.locked[1]); }
      if (c2.pressed('back') && this.locked[1]) this.lock(1, false);
    }
    if (this.allLocked() && M.play !== 'client') { this.readyT = (this.readyT || 0) + dt; if (this.readyT > 0.45) { this.readyT = 0; return 'start'; } }
    else this.readyT = 0;
    return null;
  }

  draw(ctx) {
    const M = this.m, g = M.g, v = g.view, u = uiScale(v), rt = g.realTime;
    const pad = input.players[0].mode === 'pad', coop = this.coop;
    outlinedText(ctx, 'Choose your equipment', v.W / 2, v.H * 0.075, 36 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6);
    text(ctx, '装備', v.W / 2, v.H * 0.13, 18 * u, '#e8c470', 800, FONT_SERIF);
    for (const C of this.carousel().sort((a, b) => b.ad - a.ad)) this.drawCard(ctx, C, u, rt, coop);
    const waiting = coop && !this.allLocked() && (this.locked[0] || this.locked[1]) ? (this.online ? (this.locked[this.mine] ? 'Waiting for your friend…' : 'Your friend is ready') : `Waiting for Player ${this.locked[0] ? 2 : 1}…`) : '';
    if (waiting) text(ctx, waiting, v.W / 2, v.H - 46 * u, 15 * u, '#8fd0ff', 800);
    if (this.allLocked()) text(ctx, M.play === 'client' ? 'Waiting for the host to begin…' : 'Setting out…', v.W / 2, v.H - 46 * u, 15 * u, '#ffd86a', 800);
    text(ctx, pad ? '◀ ▶ choose · Ⓐ confirm · Ⓑ back' : '← → or mouse to choose · Enter / click to confirm · Esc back', v.W / 2, v.H - 20 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
  }

  // one card of the carousel, drawn at its base size and scaled: header, the ninja idling, the bonus section
  drawCard(ctx, C, u, rt, coop) {
    if (C.a <= 0.01) return;
    const key = EQUIP_ORDER[C.i], E = EQUIPMENT[key], w = C.w, h = C.h, x = -w / 2, y = -h / 2, mid = C.ad < 0.5;
    const on = [0, 1].filter((p) => (p === 0 || coop) && this.sel[p] === C.i);
    ctx.save(); ctx.translate(C.cx, C.cy); ctx.scale(C.s, C.s); ctx.globalAlpha *= C.a;
    // the card: dark lacquer, a thin gold line
    ctx.shadowColor = mid ? 'rgba(255,200,100,0.55)' : 'rgba(0,0,0,0.5)'; ctx.shadowBlur = (mid ? 36 : 12) * u;
    const gr = ctx.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#2a1d18'); gr.addColorStop(1, '#130c0a');
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h); ctx.shadowBlur = 0;
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = mid ? 'rgba(244,214,144,0.9)' : 'rgba(200,160,90,0.35)'; ctx.lineWidth = 1.2 * u; ctx.strokeRect(x + 7 * u, y + 7 * u, w - 14 * u, h - 14 * u);
    // header: the set's kanji
    text(ctx, E.jp, 0, y + 32 * u, 22 * u, mid ? '#f4d690' : 'rgba(232,196,112,0.7)', 800, FONT_SERIF);
    // the ninja, idling: a slow breath, a glance aside now and then, holding this player's weapon
    const who = on.length === 1 ? on[0] : this.online ? this.mine : 0;
    const wk = (this.m.picks[who] && this.m.picks[who][0]) || 'katanas', rw = RIG_WEAPON[wk] || RIG_WEAPON.katanas;
    const S = 4.6 * u, footY = y + h * 0.6, tt = rt + C.i * 0.7;
    const breath = Math.sin(tt * 2.1) * 0.02, glance = Math.sin(tt * 0.45) > 0.85 ? 0.9 : 0.35;
    ctx.save(); ctx.beginPath(); ctx.rect(x + 8 * u, y + 52 * u, w - 16 * u, h * 0.6 - 44 * u); ctx.clip();
    glowFloor(ctx, 0, footY, 70 * u, mid);
    drawShadow(ctx, 0, footY, 15 * S * 0.5, 0.35);
    const full = ctx.globalAlpha >= 0.99, L = full ? ctx : ninjaLayer(ctx);
    drawHumanoid(L, {
      x: 0, y: footY, z: 0, facing: glance, time: tt, walk: 0, move: 0,
      pal: equipPal(PALS[who] || PALS[0], key, who), head: 'hood', scarf: true, sashTail: true, gear: key === 'default' ? null : key,
      weapon: rw.weapon, weapon2: rw.weapon2, grip: rw.grip, backWeapon: null, pose: null, flash: 0, rot: 0, sqx: 1 - breath * 0.5, sqy: 1 + breath, s: S,
    });
    if (!full) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(L.canvas, 0, 0); ctx.restore(); }
    ctx.restore();
    // the text section: the name, then the bonus on a dark band
    const ty = y + h * 0.64;
    text(ctx, E.title, 0, ty + 14 * u, 22 * u, mid ? '#fff4d8' : '#e8d8b8', 800, FONT_SERIF);
    ctx.fillStyle = 'rgba(232,196,112,0.55)'; ctx.fillRect(-w * 0.3, ty + 32 * u, w * 0.6, 1);
    const bx = x + 18 * u, bw = w - 36 * u, by = ty + 44 * u, bh = h - (ty - y) - 62 * u;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(232,196,112,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    const lines = E.lines, lh = 19 * u, y0 = by + bh / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, k) => text(ctx, ln, 0, y0 + k * lh, 15 * u, '#9fe0a0', 700, FONT_SANS));
    // cursors and seals
    on.forEach((p, n) => {
      const col = coop ? PLAYER_COLORS[p] : '#e8c470', tx = (on.length > 1 ? (n ? 1 : -1) * 34 * u : 0), tyy = y - 16 * u;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(tx - 10 * u, tyy - 7 * u); ctx.lineTo(tx + 10 * u, tyy - 7 * u); ctx.lineTo(tx, tyy + 6 * u); ctx.closePath(); ctx.fill();
      if (coop) text(ctx, `P${p + 1}`, tx, tyy - 18 * u, 13 * u, col, 800);
      if (this.locked[p]) {
        const sx = x + w - 38 * u - n * 44 * u, sy = y + h * 0.6 - 26 * u, r = 19 * u;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.18 + n * 0.25);
        ctx.fillStyle = coop ? col : '#c8302a'; ctx.globalAlpha *= 0.92; ctx.beginPath(); ctx.roundRect(-r, -r, r * 2, r * 2, r * 0.3); ctx.fill();
        ctx.globalAlpha /= 0.92; text(ctx, '決', 0, 1, r * 1.25, '#fff4e8', 800, FONT_SERIF);
        ctx.restore();
      }
    });
    if (on.length && coop) { ctx.strokeStyle = on.length === 1 ? PLAYER_COLORS[on[0]] : '#e8c470'; ctx.lineWidth = 3 * u; ctx.strokeRect(x - 4 * u, y - 4 * u, w + 8 * u, h + 8 * u); }
    ctx.restore();
  }
}

// an offscreen layer the size of the screen, with the same transform as ctx, cleared for one ninja
let layer = null;
function ninjaLayer(ctx) {
  const c = ctx.canvas;
  if (!layer) layer = document.createElement('canvas').getContext('2d');
  if (layer.canvas.width !== c.width || layer.canvas.height !== c.height) { layer.canvas.width = c.width; layer.canvas.height = c.height; }
  layer.setTransform(1, 0, 0, 1, 0, 0); layer.clearRect(0, 0, c.width, c.height);
  layer.setTransform(ctx.getTransform()); layer.globalAlpha = 1;
  return layer;
}

// a soft pool of light on the floor under the ninja
function glowFloor(ctx, x, y, r, bright) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, bright ? 'rgba(255,214,150,0.22)' : 'rgba(255,214,150,0.1)'); g.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.4, 0, 0, TAU); ctx.fill();
}

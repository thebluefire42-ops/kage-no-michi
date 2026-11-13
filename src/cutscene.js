// Opening cutscene: Kage is banished in the fortress courtyard at night, dragged to the border road at
// dawn, and vows to return. Painted in code on a 2D stage; the retro dialogue box runs on top.
import { TAU, clamp, lerp, ease, rand } from './util.js';
import { drawHumanoid, drawShadow, INK } from './rig.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { Dialogue } from './dialogue.js';
import { storyLines, GENSAI_PAL, KAGERO_PAL } from './story.js';

const PALS = [
  { skin: '#f1c9a5', cloth: '#2c3a5e', cloth2: '#1d2742', sash: '#c0392b', hood: '#232c46', scarf: '#d63a3a', metal: '#e6edf5', wood: '#7a4e2a', accent: '#c0392b' },
  { skin: '#f1c9a5', cloth: '#e6e2d6', cloth2: '#3a4a5e', sash: '#2a7ac0', hood: '#d8d2c2', scarf: '#3a9ae0', metal: '#e6edf5', wood: '#7a4e2a', accent: '#2a7ac0' },
];
const TITLE_DUR = 3.2;

export class IntroCutscene {
  // opts.remote: the online joiner mirrors the host (lines advance on the host's word)
  constructor(g, onDone, opts = {}) {
    this.g = g; this.onDone = onDone; this.t = 0;
    this.coop = g.players.length > 1;
    this.scene = 'court'; this.fade = 1; this.fadeTo = 0; this.pendingScene = null;
    this.titleT = -1; this.done = false;
    this.rain = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.7, 1.3) }));
    this.buildCourt();
    this.dlg = new Dialogue(g, { remote: opts.remote });
    const lines = storyLines('intro', this.coop);
    this.dlg.open('intro', lines, () => this.endDialogue(), (i, L) => { if (L.act) this.act(L.act); this.onLine?.(i, L); });
    const baseSkip = this.dlg.skip.bind(this.dlg);
    this.dlg.skip = () => { this.skipped = true; baseSkip(); };
  }

  // ---------------------------------------------------------------- actors
  actor(o) { return { x: 0, y: 0, facing: 0, walk: 0, move: 0, s: 2.3, pose: null, tx: null, speed: 0.12, ...o }; }

  buildCourt() {
    const A = [];
    A.push(this.gensai = this.actor({ id: 'gensai', x: 0.73, y: -0.07, facing: Math.PI, rig: { pal: GENSAI_PAL, head: 'eboshi', armor: true, mantle: true, fat: 1.1 }, s: 2.5 }));
    A.push(this.actor({ id: 'g1', x: 0.63, y: 0, facing: Math.PI, rig: { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' } }));
    A.push(this.actor({ id: 'g2', x: 0.85, y: -0.07, facing: Math.PI, rig: { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' } }));
    A.push(this.guardL = this.actor({ id: 'g3', x: 0.12, y: 0.02, facing: 0, rig: { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' } }));
    A.push(this.guardR = this.actor({ id: 'g4', x: 0.2, y: 0.03, facing: 0, rig: { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' } }));
    A.push(this.kage = this.actor({ id: 'kage', x: 0.4, y: 0.04, facing: 0, rig: { pal: PALS[0], head: 'hood', scarf: true }, pose: { kind: 'kneel', t: 0 } }));
    if (this.coop) A.push(this.kaze = this.actor({ id: 'kaze', x: 0.31, y: 0.05, facing: 0, rig: { pal: PALS[1], head: 'hood', scarf: true }, pose: { kind: 'kneel', t: 0 } }));
    this.actors = A;
  }

  buildRoad() {
    const A = [];
    A.push(this.captain = this.actor({ id: 'captain', x: 0.62, y: 0.02, facing: Math.PI, rig: { pal: KAGERO_PAL, head: 'kabuto', armor: true, weapon: 'naginata', grip: 'pole' }, s: 2.45 }));
    A.push(this.actor({ id: 's1', x: 0.72, y: -0.01, facing: Math.PI, rig: { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' } }));
    A.push(this.actor({ id: 's2', x: 0.79, y: 0.03, facing: Math.PI, rig: { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' } }));
    A.push(this.kage = this.actor({ id: 'kage', x: 0.44, y: 0.05, facing: 0, rig: { pal: PALS[0], head: 'hood', scarf: true }, pose: { kind: 'kneel', t: 0.6 } }));
    if (this.coop) A.push(this.kaze = this.actor({ id: 'kaze', x: 0.35, y: 0.06, facing: 0, rig: { pal: PALS[1], head: 'hood', scarf: true }, pose: { kind: 'kneel', t: 0.6 } }));
    this.actors = A;
  }

  act(name) {
    const players = [this.kage, this.kaze].filter(Boolean);
    if (name === 'seize') { // guards close in around the kneeling exile(s)
      this.guardL.tx = (this.kaze || this.kage).x - 0.07; this.guardR.tx = this.kage.x + 0.08;
      sfx.clang();
    } else if (name === 'toRoad') { this.fadeTo = 1; this.pendingScene = 'road'; }
    else if (name === 'shove') {
      for (const p of players) { p.tx = p.x - 0.07; p.speed = 0.5; p.pose = { kind: 'kneel', t: 1 }; }
      sfx.hurt(); this.dust = 1;
    } else if (name === 'soldiersLeave' || name === 'rise') {
      for (const a of this.actors) if (!players.includes(a) && a.tx === null) { a.tx = 1.25; a.facing = 0; a.speed = 0.09; }
      if (name === 'rise') for (const p of players) { p.pose = null; p.facing = 0; }
    }
  }

  endDialogue() {
    if (this.skipped) { this.finish(); return; }
    this.titleT = 0; sfx.gong();
  }
  finish() { if (this.done) return; this.done = true; this.onDone?.(); }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.t += dt;
    if (this.titleT >= 0) {
      this.titleT += dt;
      if (this.titleT > 0.8 && (input.pressed('confirm') || input.pressed('pause') || input.mouse.clicked)) { input.eat('confirm'); input.eat('pause'); this.titleT = TITLE_DUR; }
      if (this.titleT >= TITLE_DUR) this.finish();
    } else if (this.fade < 0.95 || !this.pendingScene) this.dlg.update(dt);
    // scene fades
    if (this.pendingScene) {
      this.fade = Math.min(1, this.fade + dt * 1.6);
      if (this.fade >= 1) { this.scene = this.pendingScene; this.pendingScene = null; this.fadeTo = 0; this.buildRoad(); }
    } else this.fade = Math.max(this.fadeTo, this.fade - dt * 1.2);
    for (const a of this.actors) {
      if (a.tx === null) { a.move = lerp(a.move, 0, 0.2); continue; }
      const d = a.tx - a.x, st = Math.sign(d) * Math.min(Math.abs(d), a.speed * dt);
      a.x += st; a.move = Math.abs(st) > 1e-5 ? 1 : lerp(a.move, 0, 0.2); a.walk += Math.abs(st) * 60;
      if (Math.abs(d) < 1e-4) a.tx = null;
    }
    this.dust = Math.max(0, (this.dust || 0) - dt);
  }

  // ---------------------------------------------------------------- drawing
  draw(ctx) {
    const v = this.g.view, W = v.W, H = v.H, k = v.k;
    const gy = H * 0.64;
    if (this.scene === 'court') this.drawCourt(ctx, W, H, k, gy); else this.drawRoad(ctx, W, H, k, gy);
    // actors, back to front
    const list = this.actors.slice().sort((a, b) => a.y - b.y);
    for (const a of list) {
      const x = a.x * W, y = gy + a.y * H;
      drawShadow(ctx, x, y, 14 * k * a.s * 0.5, 0.3);
      drawHumanoid(ctx, { ...a.rig, x, y, z: 0, facing: a.facing, time: this.t + a.x * 7, walk: a.walk, move: a.move, s: a.s * k * 0.8, pose: a.pose, flash: 0, alpha: 1, seed: a.x * 10 });
    }
    if (this.dust > 0) {
      ctx.fillStyle = `rgba(150,120,90,${this.dust * 0.5})`;
      for (const p of [this.kage, this.kaze]) if (p) { ctx.beginPath(); ctx.ellipse(p.x * W, gy + p.y * H, 60 * k * (1.5 - this.dust * 0.5), 14 * k, 0, 0, TAU); ctx.fill(); }
    }
    if (this.scene === 'court') this.drawRain(ctx, W, H, k);
    else this.drawMist(ctx, W, H, k, gy);
    // letterbox bars
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H * 0.07);
    // fade
    if (this.fade > 0.001) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, W, H); }
    if (this.titleT < 0) this.dlg.draw(ctx);
    else this.drawTitle(ctx, W, H, k);
  }

  drawCourt(ctx, W, H, k, gy) {
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, '#05060f'); sky.addColorStop(1, '#241a34');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, gy);
    // moon behind clouds
    ctx.fillStyle = 'rgba(240,236,220,0.75)'; ctx.beginPath(); ctx.arc(W * 0.2, H * 0.17, 30 * k, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(30,26,44,0.85)'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(W * (0.1 + i * 0.12) + Math.sin(this.t * 0.1 + i) * 20 * k, H * (0.16 + (i % 2) * 0.03), 90 * k, 14 * k, 0, 0, TAU); ctx.fill(); }
    // the keep, towering behind the wall
    ctx.save(); ctx.translate(W * 0.62, gy - 120 * k); ctx.scale(k * 1.7, k * 1.7);
    ctx.fillStyle = '#0e0c18';
    const tiers = [[150, 30], [116, 26], [84, 24], [54, 22]];
    let yy = 0;
    for (const [w, h] of tiers) {
      ctx.fillRect(-w / 2 + 10, yy - h, w - 20, h);
      ctx.beginPath(); ctx.moveTo(-w / 2 - 8, yy - h + 8); ctx.quadraticCurveTo(0, yy - h - 12, w / 2 + 8, yy - h + 8); ctx.lineTo(w / 2 - 4, yy - h - 2); ctx.lineTo(-w / 2 + 4, yy - h - 2); ctx.closePath(); ctx.fill();
      for (let i = -w / 2 + 18; i < w / 2 - 16; i += 13) { ctx.fillStyle = `rgba(255,160,80,${0.35 + 0.25 * Math.sin(this.t * 2 + i)})`; ctx.fillRect(i, yy - h + 9, 4, 7); ctx.fillStyle = '#0e0c18'; }
      yy -= h + 2;
    }
    ctx.fillStyle = '#c8a040'; ctx.beginPath(); ctx.arc(0, yy + 6, 5, 0, TAU); ctx.fill(); // gold crest
    ctx.restore();
    // courtyard wall with tile cap
    const wy = gy - 92 * k;
    ctx.fillStyle = '#d8d0c0'; ctx.fillRect(0, wy, W, 70 * k);
    ctx.fillStyle = 'rgba(20,16,30,0.45)'; ctx.fillRect(0, wy, W, 70 * k);
    ctx.fillStyle = '#1a1820'; ctx.fillRect(0, wy - 12 * k, W, 14 * k);
    for (let x = 0; x < W; x += 18 * k) { ctx.fillStyle = '#26232e'; ctx.fillRect(x, wy - 14 * k, 10 * k, 4 * k); }
    ctx.fillStyle = '#4a3a2e'; ctx.fillRect(0, wy + 58 * k, W, 12 * k);
    // closed gate (center left)
    const gx = W * 0.5;
    ctx.fillStyle = '#5a1418'; ctx.fillRect(gx - 70 * k, wy - 4 * k, 140 * k, 74 * k);
    ctx.strokeStyle = INK; ctx.lineWidth = 3 * k; ctx.strokeRect(gx - 70 * k, wy - 4 * k, 140 * k, 74 * k);
    ctx.beginPath(); ctx.moveTo(gx, wy - 4 * k); ctx.lineTo(gx, wy + 70 * k); ctx.stroke();
    ctx.fillStyle = '#c8a040'; for (const sx of [-1, 1]) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { ctx.beginPath(); ctx.arc(gx + sx * (18 + c * 16) * k, wy + (14 + r * 18) * k, 2.4 * k, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#16141c'; ctx.beginPath(); ctx.moveTo(gx - 96 * k, wy - 4 * k); ctx.quadraticCurveTo(gx, wy - 36 * k, gx + 96 * k, wy - 4 * k); ctx.lineTo(gx + 80 * k, wy - 14 * k); ctx.lineTo(gx - 80 * k, wy - 14 * k); ctx.closePath(); ctx.fill();
    // stone courtyard
    const gg = ctx.createLinearGradient(0, gy - 22 * k, 0, H);
    gg.addColorStop(0, '#3a3644'); gg.addColorStop(1, '#16141c');
    ctx.fillStyle = gg; ctx.fillRect(0, gy - 22 * k, W, H);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5 * k;
    for (let r = 0; r < 8; r++) { const y = gy - 22 * k + r * r * 6 * k; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // wet reflections
    ctx.fillStyle = 'rgba(255,170,90,0.08)'; ctx.fillRect(W * 0.6, gy + 10 * k, W * 0.3, 40 * k);
    // stone steps up to the regent's dais (right)
    for (let s = 0; s < 3; s++) {
      const sy = gy - (s + 1) * 13 * k + 4 * k, x0 = W * (0.62 + s * 0.015);
      ctx.fillStyle = s % 2 ? '#4a4652' : '#55505e'; ctx.fillRect(x0, sy, W, 14 * k);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x0, sy + 11 * k, W, 3 * k);
    }
    // braziers with flickering fire
    for (const bx of [W * 0.58, W * 0.95]) this.brazier(ctx, bx, gy - 30 * k, k);
  }

  brazier(ctx, x, y, k) {
    const fl = 1 + Math.sin(this.t * 13 + x) * 0.1 + Math.sin(this.t * 31) * 0.06;
    const g = ctx.createRadialGradient(x, y - 30 * k, 0, x, y - 30 * k, 160 * k * fl);
    g.addColorStop(0, 'rgba(255,150,60,0.35)'); g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 30 * k, 160 * k * fl, 0, TAU); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#1a1820'; ctx.fillRect(x - 3 * k, y - 18 * k, 6 * k, 30 * k);
    ctx.beginPath(); ctx.moveTo(x - 16 * k, y - 24 * k); ctx.lineTo(x + 16 * k, y - 24 * k); ctx.lineTo(x + 10 * k, y - 14 * k); ctx.lineTo(x - 10 * k, y - 14 * k); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#ff6a20', '#ffb040', '#fff0a0'][i];
      const h = (28 - i * 8) * k * fl;
      ctx.beginPath(); ctx.moveTo(x - (12 - i * 4) * k, y - 24 * k); ctx.quadraticCurveTo(x + Math.sin(this.t * 9 + i) * 4 * k, y - 24 * k - h * 1.4, x + (12 - i * 4) * k, y - 24 * k); ctx.fill();
    }
  }

  drawRoad(ctx, W, H, k, gy) {
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, '#3a4a78'); sky.addColorStop(0.6, '#d89a7a'); sky.addColorStop(1, '#f4cfa0');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, gy);
    // rising sun
    const sg = ctx.createRadialGradient(W * 0.82, gy - 40 * k, 0, W * 0.82, gy - 40 * k, 260 * k);
    sg.addColorStop(0, 'rgba(255,240,200,0.9)'); sg.addColorStop(0.2, 'rgba(255,200,140,0.5)'); sg.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, gy);
    // mountain layers
    const layers = [['#6a6a8e', 140], ['#4e4c6a', 90], ['#3a3448', 50]];
    layers.forEach(([c, hgt], L) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, gy);
      for (let x = 0; x <= W + 20; x += 20 * k) { const u = x / (180 * k) + L * 7; ctx.lineTo(x, gy - 20 * k - (Math.sin(u) * 0.5 + Math.sin(u * 2.3) * 0.3 + 0.9) * hgt * k); }
      ctx.lineTo(W, gy); ctx.closePath(); ctx.fill();
    });
    // muddy field and road
    const gg = ctx.createLinearGradient(0, gy - 10 * k, 0, H);
    gg.addColorStop(0, '#6a6450'); gg.addColorStop(1, '#2e2a22');
    ctx.fillStyle = gg; ctx.fillRect(0, gy - 10 * k, W, H);
    ctx.fillStyle = '#7a6448';
    ctx.beginPath(); ctx.moveTo(W * 0.42, gy - 10 * k); ctx.lineTo(W * 0.58, gy - 10 * k); ctx.lineTo(W * 1.1, H); ctx.lineTo(-W * 0.1, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(40,30,20,0.35)'; ctx.lineWidth = 3 * k;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(W * 0.5 + s * 20 * k, gy - 10 * k); ctx.lineTo(W * 0.5 + s * W * 0.28, H); ctx.stroke(); }
    // dry grass
    ctx.strokeStyle = '#8a7a50'; ctx.lineWidth = 2 * k;
    for (let i = 0; i < 70; i++) { const x = (i * 97.3) % W, y = gy + ((i * 53.1) % (H - gy)); if (Math.abs(x - W * 0.5) < (y - gy) * 0.9 + 30 * k) continue; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 3 * k, y - 10 * k, x + 6 * k + Math.sin(this.t * 2 + i) * 3 * k, y - 18 * k); ctx.stroke(); }
    // border stone
    const bx = W * 0.14, by = gy + 10 * k;
    ctx.fillStyle = '#6a6a70'; ctx.fillRect(bx - 12 * k, by - 80 * k, 24 * k, 80 * k);
    ctx.strokeStyle = INK; ctx.lineWidth = 2 * k; ctx.strokeRect(bx - 12 * k, by - 80 * k, 24 * k, 80 * k);
    ctx.fillStyle = '#1a1820'; ctx.font = `800 ${Math.round(16 * k)}px "Shippori Mincho", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['国', '境'].forEach((c, i) => ctx.fillText(c, bx, by - 58 * k + i * 22 * k));
  }

  drawRain(ctx, W, H, k) {
    ctx.strokeStyle = 'rgba(180,190,230,0.35)'; ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    for (const r of this.rain) {
      const y = ((r.y + this.t * 1.4 * r.s) % 1) * H, x = ((r.x + this.t * 0.25 * r.s) % 1) * W;
      ctx.moveTo(x, y); ctx.lineTo(x - 6 * k, y + 22 * k * r.s);
    }
    ctx.stroke();
  }

  drawMist(ctx, W, H, k, gy) {
    for (let i = 0; i < 4; i++) {
      const x = ((this.t * (14 + i * 4) + i * 300) % (W + 600)) - 300, y = gy + (i - 1) * 30 * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 260 * k);
      g.addColorStop(0, 'rgba(255,240,230,0.22)'); g.addColorStop(1, 'rgba(255,240,230,0)');
      ctx.fillStyle = g; ctx.save(); ctx.translate(x, y); ctx.scale(2.4, 0.4); ctx.beginPath(); ctx.arc(0, 0, 260 * k, 0, TAU); ctx.restore(); ctx.fill();
    }
  }

  drawTitle(ctx, W, H, k) {
    const a = clamp(this.titleT / 0.8, 0, 1) * clamp((TITLE_DUR - this.titleT) / 0.5, 0, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.75 * clamp(this.titleT / 0.6, 0, 1)})`; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = a;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(180,30,30,0.85)';
    ctx.beginPath(); ctx.moveTo(W * 0.3, H * 0.47); ctx.quadraticCurveTo(W * 0.5, H * 0.4, W * 0.72, H * 0.44); ctx.lineTo(W * 0.7, H * 0.52); ctx.quadraticCurveTo(W * 0.5, H * 0.49, W * 0.28, H * 0.55); ctx.closePath(); ctx.fill();
    ctx.font = `800 ${Math.round(96 * k)}px "Shippori Mincho", serif`;
    ctx.fillStyle = '#f6eedc'; ctx.fillText('影の道', W / 2, H * 0.45);
    ctx.font = `${Math.round(26 * k)}px "DotGothic16", monospace`;
    ctx.fillStyle = '#ffe9a8'; ctx.fillText('The Shadow Path', W / 2, H * 0.6);
    ctx.restore();
  }
}

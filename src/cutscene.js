// Opening cutscene: Kage is banished in the fortress courtyard at night, dragged to the border road at
// dawn, and vows to return. Painted in code on a 2D stage; the retro dialogue box runs on top.
import { TAU, clamp, lerp, ease, rand } from './util.js';
import { drawHumanoid, drawShadow, INK } from './rig.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { Dialogue } from './dialogue.js';
import { storyLines, GENSAI_PAL, KAGERO_PAL } from './story.js';
import { RIG_WEAPON } from './player.js';
import { Motes, fog, lightShafts, vignette, glow, hangingLantern, nobori, stoneLantern, figure, crow, flyingBird, bat, cat, flitter, lightning, hsh } from './cutfx.js';

// a player's chosen weapons on their cutscene figure: the first in hand, the second stowed on the back
export function weaponRig(p) {
  if (!p || !p.weapons) return {};
  const a = RIG_WEAPON[p.weapons[0].key], b = p.weapons[1] && RIG_WEAPON[p.weapons[1].key];
  return { weapon: a.weapon, weapon2: a.weapon2, grip: a.grip, backWeapon: b ? b.back : null };
}

export const PALS = [
  { skin: '#f1c9a5', cloth: '#2c3a5e', cloth2: '#1d2742', sash: '#c0392b', hood: '#232c46', scarf: '#d63a3a', metal: '#e6edf5', wood: '#7a4e2a', accent: '#c0392b' },
  { skin: '#f1c9a5', cloth: '#e6e2d6', cloth2: '#3a4a5e', sash: '#2a7ac0', hood: '#d8d2c2', scarf: '#3a9ae0', metal: '#e6edf5', wood: '#7a4e2a', accent: '#2a7ac0' },
];
const TITLE_DUR = 3.2;

export class IntroCutscene {
  // opts.remote: the online joiner mirrors the host (lines advance on the host's word)
  constructor(g, onDone, opts = {}) {
    this.id = 'intro'; this.g = g; this.onDone = onDone; this.t = 0;
    this.coop = g.players.length > 1;
    this.scene = 'court'; this.fade = 1; this.fadeTo = 0; this.pendingScene = null;
    this.titleT = -1; this.done = false;
    this.rain = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.7, 1.3) }));
    this.splash = []; // rain hitting the courtyard stones
    this.fx = { embers: new Motes(36, 'ember', [0, 0, 1, 1], { sources: [[0.58, 0.55], [0.95, 0.55]] }), ash: new Motes(30, 'ash', [0, 0.08, 1, 0.7]) };
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
    A.push(this.gensai = this.actor({ id: 'gensai', x: 0.53, y: 0.035, facing: Math.PI, rig: { pal: GENSAI_PAL, head: 'eboshi', armor: true, mantle: true, fat: 1.1 }, s: 2.5 }));
    A.push(this.actor({ id: 'g1', x: 0.64, y: -0.02, facing: Math.PI, rig: { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' } }));
    A.push(this.actor({ id: 'g2', x: 0.72, y: -0.05, facing: Math.PI, rig: { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' } }));
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
    // atmosphere
    for (const m of Object.values(this.fx)) m.update(dt);
    if (this.scene === 'court') {
      for (let i = 0; i < 3; i++) if (Math.random() < dt * 24) this.splash.push({ x: Math.random(), y: rand(0.62, 1), t: 0 });
      for (const p of this.splash) p.t += dt;
      this.splash = this.splash.filter((p) => p.t < 0.35);
    }
    if (this.scene === 'road' && !this.fx.dust) this.fx = { dust: new Motes(70, 'dust', [0, 0.1, 1, 0.95]) };
  }

  // ---------------------------------------------------------------- drawing
  draw(ctx) {
    const v = this.g.view, W = v.W, H = v.H, k = v.k;
    const gy = H * 0.64;
    if (this.scene === 'court') { this.drawCourt(ctx, W, H, k, gy); this.drawCourtLife(ctx, W, H, k, gy); } else { this.drawRoad(ctx, W, H, k, gy); this.drawRoadLife(ctx, W, H, k, gy); }
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
    if (this.scene === 'court') {
      this.fx.embers.draw(ctx, W, H, k);
      fog(ctx, W, H, k, this.t, gy + 40 * k, 90 * k, '120,110,150', 0.16, 9, 3, 6); // cold mist over the wet stones
      this.drawRain(ctx, W, H, k);
      for (const p of this.splash) { const a = 1 - p.t / 0.35; ctx.strokeStyle = `rgba(190,200,240,${0.45 * a})`; ctx.lineWidth = 1 * k; ctx.beginPath(); ctx.ellipse(p.x * W, p.y * H, (2 + p.t * 30) * k, (0.8 + p.t * 9) * k, 0, 0, TAU); ctx.stroke(); }
      vignette(ctx, W, H, '4,2,12', 0.7);
      const L = lightning(this.t, 11, 4); // far-off lightning lights the whole courtyard for a blink
      if (L > 0) { ctx.fillStyle = `rgba(200,210,255,${0.28 * L})`; ctx.fillRect(0, 0, W, H); }
    } else {
      this.drawMist(ctx, W, H, k, gy);
      this.fx.dust && this.fx.dust.draw(ctx, W, H, k);
      for (let i = 0; i < 3; i++) flitter(ctx, W * (0.08 + i * 0.12), gy + (40 + i * 26) * k, 1.4 * k, this.t, i * 3.3, 'butterfly', ['#fff4c8', '#f8d8e8', '#ffe8a0'][i]);
      vignette(ctx, W, H, '40,20,10', 0.45);
    }
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
    for (let i = 0; i < 50; i++) { ctx.fillStyle = `rgba(230,230,255,${0.15 + 0.25 * Math.abs(Math.sin(this.t * (0.4 + hsh(i, 5)) + i))})`; ctx.fillRect(hsh(i, 6) * W, hsh(i, 7) * gy * 0.55, 1.4 * k, 1.4 * k); }
    glow(ctx, W * 0.2, H * 0.17, 120 * k, '200,200,255', 0.12);
    // moon behind clouds
    ctx.fillStyle = 'rgba(240,236,220,0.75)'; ctx.beginPath(); ctx.arc(W * 0.2, H * 0.17, 30 * k, 0, TAU); ctx.fill();
    fog(ctx, W, H, k, this.t, H * 0.24, 70 * k, '40,34,60', 0.5, 6, 9, 5); // low storm clouds rolling by
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

  // the courtyard at night: bats round the keep, patrols with lanterns on the wall walk, lanterns and
  // banners, silent courtiers watching from the shadows by the wall, crows on the gate roof, a cat
  // a background character in the game's own style: small, a little darker with distance
  extra(ctx, x, y, s, rig, o = {}) {
    drawShadow(ctx, x, y, 14 * s * 0.5, 0.25);
    const walking = typeof o.walk === 'number'; // o.walk: the stride phase, from how far the figure has walked
    drawHumanoid(ctx, { ...rig, x, y, z: 0, facing: o.facing ?? 0, time: this.t + (o.seed ?? 0), walk: walking ? o.walk : 0, move: walking ? 1 : 0, s, pose: o.pose || null, flash: 0, alpha: o.alpha ?? 1, seed: o.seed ?? 0 });
  }

  drawCourtLife(ctx, W, H, k, gy) {
    const t = this.t, wy = gy - 92 * k;
    for (let i = 0; i < 7; i++) { // bats circling the keep
      const a = t * (0.5 + hsh(i, 2) * 0.4) + i * 0.9, r = (70 + hsh(i, 3) * 90) * k;
      bat(ctx, W * 0.62 + Math.cos(a) * r * 1.6, gy - 270 * k + Math.sin(a) * r * 0.45, (1.1 + hsh(i, 4)) * k, t + i);
    }
    // the wall walk: guards patrolling with lanterns, an archer keeping watch
    const guard = { pal: KAGERO_PAL, head: 'jingasa', weapon: 'spear', grip: 'pole' };
    for (let i = 0; i < 3; i++) { // patrols on the wall walk, one carrying a lantern
      const span = 1.3, d = t * 0.018 + i * 0.43, u = (((i % 2 ? -d : d) % span) + span) % span - 0.15;
      this.extra(ctx, u * W, wy - 12 * k, 0.75 * k, i === 1 ? { pal: KAGERO_PAL, head: 'jingasa', weapon: 'lantern', grip: 'pole' } : guard, { walk: d * 170, facing: i % 2 ? Math.PI : 0, seed: i * 3 });
    }
    this.extra(ctx, W * 0.9, wy - 12 * k, 0.75 * k, { pal: KAGERO_PAL, head: 'kasa', weapon: 'bow', grip: 'down' }, { facing: Math.PI });
    // paper lanterns hung under the wall's tile cap
    for (let i = 0; i < 6; i++) { const x = W * (0.06 + i * 0.17); if (Math.abs(x - W * 0.5) < 110 * k) continue; hangingLantern(ctx, x, wy + 2 * k, k, t, i * 1.7, { col: '#a8261c', label: '影' }); }
    // crows on the gate roof
    for (const [dx, sc] of [[-60, 1.3], [-40, 1.1], [52, 1.25]]) crow(ctx, W * 0.5 + dx * k, wy - 22 * k, sc * k, t + dx);
    // courtiers and servants watching from the dark by the wall, one with a lantern
    const COURT = [ // retainers and servants watching by the wall
      { pal: { skin: '#e2b48c', cloth: '#3a2a3a', cloth2: '#241824', sash: '#a8823a', hat: '#141218' }, head: 'eboshi', robe: true },
      { pal: { skin: '#e8c4a0', cloth: '#4a3a2a', cloth2: '#2a2018', sash: '#7a2a22', hair: '#141016' }, head: 'bandana', robe: true },
      { pal: { skin: '#e2b48c', cloth: '#2a2a3e', cloth2: '#1a1a28', sash: '#c8a050', hat: '#141218' }, head: 'eboshi', robe: true },
      { pal: { skin: '#e8c4a0', cloth: '#5a4a3a', cloth2: '#3a2e22', sash: '#3a2a50', hair: '#141016' }, head: 'bandana', robe: true, weapon: 'lantern', grip: 'pole' },
      { pal: { skin: '#e2b48c', cloth: '#3a2a3a', cloth2: '#241824', sash: '#a8823a', hat: '#141218' }, head: 'eboshi', robe: true },
      { pal: { skin: '#e8c4a0', cloth: '#4a4a52', cloth2: '#2a2a30', sash: '#7a2a22', hair: '#141016' }, head: 'bandana', robe: true },
    ];
    COURT.forEach((rig, i) => this.extra(ctx, W * (0.24 + i * 0.045 + hsh(i, 8) * 0.01), gy - 26 * k, (0.95 + hsh(i, 9) * 0.12) * k, rig, { facing: 0, seed: i * 1.7 }));
    // banners in the courtyard, wet and heavy in the rain
    nobori(ctx, W * 0.03, gy - 4 * k, k, t * 0.6, 1, { col: '#5a0e16', h: 150 });
    nobori(ctx, W * 0.535, gy - 30 * k, k, t * 0.6, 2, { col: '#5a0e16', h: 130 });
    nobori(ctx, W * 0.985, gy - 30 * k, k, t * 0.6, 3, { col: '#1a1420', h: 140, mon: '#a8261c' });
    // a cat slinking along the foot of the wall, back and forth
    const cu = (t * 0.03) % 2, cx = cu < 1 ? cu : 2 - cu;
    cat(ctx, W * (0.05 + cx * 0.4), wy + 70 * k, 1.5 * k, t, true, cu < 1 ? 1 : -1, '#08060c');
    // rain puddles on the stones: reflections of the fires, rippling
    for (const [px, py, pw] of [[0.3, 0.74, 70], [0.7, 0.8, 110], [0.12, 0.9, 90], [0.52, 0.93, 60]]) {
      ctx.fillStyle = 'rgba(30,26,46,0.6)'; ctx.beginPath(); ctx.ellipse(px * W, py * H, pw * k, pw * 0.22 * k, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(255,150,80,${0.08 + 0.04 * Math.sin(t * 5 + px * 9)})`; ctx.beginPath(); ctx.ellipse(px * W + 10 * k, py * H, pw * 0.4 * k, pw * 0.07 * k, 0, 0, TAU); ctx.fill();
      for (let r = 0; r < 2; r++) { const q = (t * 0.9 + r * 0.5 + px) % 1; ctx.strokeStyle = `rgba(200,210,250,${0.25 * (1 - q)})`; ctx.lineWidth = 1 * k; ctx.beginPath(); ctx.ellipse(px * W + (r ? -20 : 15) * k, py * H, q * 26 * k, q * 6 * k, 0, 0, TAU); ctx.stroke(); }
    }
    // the braziers' smoke climbing into the rain
    for (const bx of [W * 0.58, W * 0.95]) for (let i = 0; i < 4; i++) {
      const q = (t * 0.18 + i / 4) % 1;
      ctx.fillStyle = `rgba(60,56,70,${0.25 * (1 - q)})`; ctx.beginPath(); ctx.arc(bx + Math.sin(q * 4 + i) * 14 * k, gy - 60 * k - q * 160 * k, (10 + q * 30) * k, 0, TAU); ctx.fill();
    }
  }

  // the border road at dawn: a far village waking (smoke, a pagoda), travellers and an ox cart small on the
  // road ahead, birds in the sky, a dead pine full of crows, a wayside shrine with stone lanterns and jizo
  drawRoadLife(ctx, W, H, k, gy) {
    const t = this.t;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, gy - 8 * k); ctx.clip(); // the low sun's rays fan out across the sky
    lightShafts(ctx, W, H, k, t, W * 0.82, gy - 40 * k, '255,220,170', 7, 0.07, 0.7, Math.PI + 0.12);
    ctx.restore();
    for (let f = 0; f < 2; f++) for (let i = 0; i < 6; i++) { // geese in a V
      const u = ((t * 0.025 + f * 0.5) % 1.3) - 0.15, row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      flyingBird(ctx, (u - row * 0.012) * W, H * (0.2 + f * 0.08) + side * row * 9 * k, 1.3 * k, t + i, 'rgba(40,30,40,0.6)');
    }
    // the village below the hills: roofs, a pagoda, chimney smoke
    const vx = W * 0.3, vy = gy - 30 * k;
    ctx.fillStyle = 'rgba(58,52,72,0.85)';
    for (let i = 0; i < 9; i++) { const x = vx + (i - 4) * 26 * k + hsh(i, 1) * 8 * k, w = (16 + hsh(i, 2) * 8) * k; ctx.fillRect(x - w / 2, vy - 8 * k, w, 9 * k); ctx.beginPath(); ctx.moveTo(x - w * 0.7, vy - 7 * k); ctx.lineTo(x, vy - 16 * k); ctx.lineTo(x + w * 0.7, vy - 7 * k); ctx.closePath(); ctx.fill(); }
    for (let tier = 0; tier < 4; tier++) { const w = (22 - tier * 4) * k, yy = vy - 18 * k - tier * 11 * k; ctx.fillRect(W * 0.38 - w * 0.35, yy, w * 0.7, 8 * k); ctx.beginPath(); ctx.moveTo(W * 0.38 - w, yy + 2 * k); ctx.quadraticCurveTo(W * 0.38, yy - 5 * k, W * 0.38 + w, yy + 2 * k); ctx.closePath(); ctx.fill(); }
    ctx.fillRect(W * 0.38 - 1 * k, vy - 70 * k, 2 * k, 14 * k);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) { // chimney smoke
      const q = (t * 0.12 + j / 5) % 1, x = vx + (i * 2 - 2) * 26 * k + Math.sin(q * 3 + i) * 8 * k + q * 20 * k;
      ctx.fillStyle = `rgba(210,200,210,${0.16 * (1 - q)})`; ctx.beginPath(); ctx.arc(x, vy - 16 * k - q * 50 * k, (2 + q * 6) * k, 0, TAU); ctx.fill();
    }
    // travellers far down the road, walking away; an ox cart
    const TRAV = [ // travellers on the road, walking away into the morning
      { pal: { skin: '#e2b48c', cloth: '#6a5a44', cloth2: '#4a3e2e', sash: '#3a2a20', hat: '#c8a868', wood: '#6a4a2a' }, head: 'kasa', weapon: 'staff', grip: 'pole' },
      { pal: { skin: '#e6c4a0', cloth: '#3a3a48', cloth2: '#26262e', sash: '#c8a050', metal: '#ddd', wood: '#c8a868' }, head: 'komuso', robe: true, weapon: 'flute', grip: 'down' },
      { pal: { skin: '#e2b48c', cloth: '#5a6a5a', cloth2: '#3a463a', sash: '#8a3a2a', hat: '#c8a868' }, head: 'kasa' },
    ];
    // the road narrows toward a vanishing point above the horizon; a figure's size follows its distance from it
    const hz = gy - 10 * k, vp = hz - (H - hz) * 0.08 / 0.52, actorY = gy + 0.045 * H, persp = (y) => (y - vp) / (actorY - vp);
    for (let i = 0; i < 3; i++) {
      // same scale rule as the exiles in front (2.3 * 0.8 at the actors' line), shrinking with distance
      const q = (t * 0.02 + i * 0.33) % 1, y = lerp(gy - 2 * k, hz + 1 * k, q), d = persp(y);
      const x = W * (0.522 + (i - 1) * 0.022), fadeA = clamp(q / 0.1, 0, 1) * clamp((1 - q) / 0.2, 0, 1);
      this.extra(ctx, x, y, 1.75 * k * d, TRAV[i], { walk: t * 3 + i * 2, facing: -Math.PI / 2, alpha: fadeA, seed: i });
    }
    { const q = (t * 0.012) % 1, y = lerp(gy - 3 * k, hz + 1 * k, q), d = persp(y) * 1.6, x = W * 0.565;
      ctx.fillStyle = `rgba(40,32,30,${0.6 + 0.3 * d})`; ctx.fillRect(x - 12 * k * d, y - 14 * k * d, 24 * k * d, 9 * k * d); // the cart
      ctx.beginPath(); ctx.arc(x - 6 * k * d, y - 4 * k * d, 4.5 * k * d, 0, TAU); ctx.arc(x + 6 * k * d, y - 4 * k * d, 4.5 * k * d, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - 22 * k * d, y - 8 * k * d, 9 * k * d, 5 * k * d, 0, 0, TAU); ctx.fill(); } // the ox
    // a dead pine by the border stone, crows on its branches
    const tx = W * 0.06, ty = gy + 14 * k;
    ctx.strokeStyle = '#2a2024'; ctx.lineCap = 'round';
    ctx.lineWidth = 9 * k; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx - 10 * k, ty - 90 * k, tx + 14 * k, ty - 180 * k); ctx.stroke();
    ctx.lineWidth = 4 * k; for (const [bx, by, ex, ey] of [[4, -120, 60, -150], [8, -150, -40, -175], [2, -90, -50, -105], [12, -170, 50, -200]]) { ctx.beginPath(); ctx.moveTo(tx + bx * k, ty + by * k); ctx.quadraticCurveTo(tx + (bx + ex) / 2 * k, ty + (by + ey) / 2 * k - 10 * k, tx + ex * k, ty + ey * k); ctx.stroke(); }
    for (const [cx, cy, sc] of [[52, -151, 1.4], [-34, -176, 1.3], [-42, -106, 1.25], [44, -197, 1.2]]) crow(ctx, tx + cx * k, ty + cy * k, sc * k, t + cx);
    // a wayside shrine with offerings, two stone lanterns and a row of little jizo
    const sx = W * 0.86, sy = gy + 30 * k;
    stoneLantern(ctx, sx - 50 * k, sy, k, t, true, '#5a5660'); stoneLantern(ctx, sx + 50 * k, sy, k, t, true, '#5a5660');
    ctx.fillStyle = '#5a3a2a'; ctx.fillRect(sx - 3 * k, sy - 40 * k, 6 * k, 40 * k);
    ctx.fillStyle = '#7a5038'; ctx.fillRect(sx - 18 * k, sy - 62 * k, 36 * k, 24 * k);
    ctx.fillStyle = '#3a2620'; ctx.beginPath(); ctx.moveTo(sx - 26 * k, sy - 60 * k); ctx.lineTo(sx, sy - 76 * k); ctx.lineTo(sx + 26 * k, sy - 60 * k); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4ead0'; ctx.fillRect(sx - 3 * k, sy - 56 * k, 6 * k, 10 * k);
    ctx.fillStyle = '#e8d8b0'; ctx.beginPath(); ctx.arc(sx - 8 * k, sy - 40 * k, 3 * k, 0, TAU); ctx.arc(sx + 8 * k, sy - 40 * k, 3 * k, 0, TAU); ctx.fill(); // rice balls
    for (let i = 0; i < 4; i++) { const jx = sx - 30 * k + i * 20 * k, jy = sy + 26 * k;
      ctx.fillStyle = '#8a8a86'; ctx.beginPath(); ctx.ellipse(jx, jy - 9 * k, 6 * k, 9 * k, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(jx, jy - 21 * k, 4.5 * k, 0, TAU); ctx.fill();
      ctx.fillStyle = '#b8302a'; ctx.beginPath(); ctx.moveTo(jx - 5.5 * k, jy - 16 * k); ctx.lineTo(jx + 5.5 * k, jy - 16 * k); ctx.lineTo(jx, jy - 8 * k); ctx.closePath(); ctx.fill(); }
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

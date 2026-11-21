// Area 4 cutscene (before level 31): the players leave Yukishiro by night, cross the ash fields to the Kagero
// fortress, find the gate barred, and go over the wall on a grappling rope (kaginawa). A short side-scrolling walk
// like the area 2 cutscene (cutscene2.js): lines come from SCRIPTS.area4 in story.js (`at` holds a line until the
// players have walked that far, `act` cues the scene). No one else is in it. The area 4 song starts here.
import { TAU, clamp, lerp, ease, rand } from './util.js';
import { drawHumanoid, drawShadow } from './rig.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { Dialogue } from './dialogue.js';
import { storyLines } from './story.js';
import { PALS, weaponRig } from './cutscene.js';
import { Motes, fog, vignette, glow, hangingLantern, nobori } from './cutfx.js';

const SPEED = 0.12;    // walking speed (screen widths per second)
const LEAD = 0.4;      // where the leader stands on screen while walking
const STOP_AT = 1.25;  // the players halt here, under the wall, and go over it
const WALL_X0 = 1.02;  // where the fortress wall begins (world x)
const GATE_X = 1.62;   // the great gate (barred), off to the right
const TOWERS = [1.15, 1.92];
// grappling: the hook flies up (THROW s), each player climbs (CLIMB s, the second one FOLLOW s later) and drops over (OVER s)
const THROW = 0.55, CLIMB = 1.5, OVER = 0.45, FOLLOW = 0.7;
const prog = (x) => clamp((x - 0.25) / 0.85, 0, 1); // 0 in the snowy town, 1 at the walls
const hexRgb = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`; };

export class Area4Cutscene {
  constructor(g, onDone, opts = {}) {
    this.id = 'area4'; this.song = 'biome_4';
    this.g = g; this.onDone = onDone; this.t = 0; this.remote = !!opts.remote;
    this.coop = g.players.length > 1;
    this.fade = 1; this.done = false; this.outT = -1; this.walking = true; this.halted = false;
    this.kage = this.actor({ id: 'kage', x: 0, y: 0.055, rig: { pal: PALS[0], head: 'hood', scarf: true, ...weaponRig(g.players[0]) } });
    this.actors = [this.kage];
    if (this.coop) this.actors.push(this.kaze = this.actor({ id: 'kaze', x: -0.075, y: 0.085, rig: { pal: PALS[1], head: 'hood', scarf: true, ...weaponRig(g.players[1]) } }));
    this.cam = this.kage.x - LEAD;
    this.flakes = Array.from({ length: 70 }, () => this.flake(true));
    this.grap = null; // { t, hookX } once the hook is thrown
    this.dlg = new Dialogue(g, { remote: opts.remote });
    this.dlg.open('area4', storyLines('area4', this.coop), () => this.endDialogue(), (i, L) => {
      this.gate = { at: L.at ?? null, until: this.t + (L.delay || 0), shown: false };
      if (L.act) this.act(L.act);
      this.onLine?.(i, L);
    });
    const baseSkip = this.dlg.skip.bind(this.dlg);
    this.dlg.skip = () => { this.skipped = true; baseSkip(); };
    this.fx = { embers: new Motes(40, 'ember', [0, 0.55, 1, 1.0]), ash: new Motes(50, 'ash', [0, 0, 1, 1]) };
  }

  actor(o) { return { x: 0, y: 0, z: 0, facing: 0, walk: 0, move: 0, s: 2.3, alpha: 1, ...o }; }
  flake(anywhere) { return { x: rand(0, 1.1), y: anywhere ? rand(0, 1) : -0.03, vx: rand(-0.02, 0.01), vy: rand(0.03, 0.07), s: rand(0.6, 1.4), ph: rand(0, 9) }; }

  act(name) {
    if (name === 'grapple' && !this.grap) { this.grap = { t: 0, hookX: this.kage.x + 0.02 }; this.walking = false; sfx.knifeThrow(); }
  }
  // how long until everyone is over the wall
  get climbEnd() { return THROW + CLIMB + OVER + (this.coop ? FOLLOW : 0); }

  endDialogue() {
    if (this.skipped) { this.finish(); return; }
    if (!this.grap) this.act('grapple');
    this.outT = 0;
  }
  finish() { if (this.done) return; this.done = true; this.onDone?.(); }

  gateReady() {
    const G = this.gate;
    if (!G) return true;
    if (G.at != null && this.kage.x < G.at) return false;
    return this.t >= G.until;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.t += dt;
    if (this.outT < 0) {
      this.fade = Math.max(0, this.fade - dt * 0.9);
      if (this.gateReady()) this.dlg.update(dt);
      else if (!this.remote && (input.pressed('pause') || input.pressed('back'))) { input.eat('pause'); input.eat('back'); this.dlg.skip(); }
    } else {
      this.outT += dt;
      const over = !this.grap || this.grap.t >= this.climbEnd;
      if (over) this.fade = Math.min(1, this.fade + dt * 1.4);
      if (over && this.fade >= 1) this.finish();
    }
    if (this.walking && !this.halted && this.kage.x >= STOP_AT) { this.walking = false; this.halted = true; }
    for (const a of this.actors) {
      if (this.walking) { a.x += SPEED * dt; a.walk += SPEED * dt * 60; a.move = 1; } else if (!a.climbing) a.move = lerp(a.move, 0, 0.2);
    }
    if (this.grap) this.updateGrapple(dt);
    this.cam = lerp(this.cam, Math.min(this.kage.x, STOP_AT) - LEAD, 1 - Math.exp(-4 * dt));
    const p = prog(this.cam + 0.5);
    for (const f of this.flakes) { f.x += (f.vx + Math.sin(this.t + f.ph) * 0.01) * dt; f.y += f.vy * dt * (1 - p * 0.5); if (f.y > 1.03 || f.x < -0.05) Object.assign(f, this.flake(false)); }
    for (const m of Object.values(this.fx)) m.update(dt);
  }

  // the hook flies up and bites into the coping; each player walks to the rope, climbs hand over hand and drops over
  updateGrapple(dt) {
    const G = this.grap; G.t += dt;
    if (!G.bit && G.t >= THROW) { G.bit = true; sfx.clang(); }
    this.actors.forEach((a, i) => {
      const t0 = THROW + (i ? FOLLOW : 0), u = (G.t - t0) / CLIMB; // this player's part of the climb
      if (u < 0) { // the second one steps up to the rope
        if (i) { a.x = lerp(a.x, G.hookX - 0.012, 1 - Math.exp(-6 * dt)); a.y = lerp(a.y, this.kage.y + 0.01, 1 - Math.exp(-6 * dt)); a.move = 0.8; a.walk += dt * 6; }
        return;
      }
      a.climbing = u < 1; a.x = lerp(a.x, G.hookX, 1 - Math.exp(-10 * dt));
      if (u < 1) { a.z = ease.inOutSine ? ease.inOutSine(u) : u; a.move = 0.6; a.walk += dt * 5; if (Math.random() < dt * 3) sfx.tok && sfx.tok(); }
      else { a.z = 1; const v = (G.t - t0 - CLIMB) / OVER; a.over = clamp(v, 0, 1); a.alpha = 1 - a.over; a.move = 0; }
    });
  }

  // ---------------------------------------------------------------- drawing
  draw(ctx) {
    const v = this.g.view, W = v.W, H = v.H, k = v.k;
    const gy = H * 0.64, p = prog(this.cam + 0.5);
    this.drawSky(ctx, W, H, k, gy, p);
    this.drawFar(ctx, W, H, k, gy, p);
    this.drawGround(ctx, W, H, k, gy, p);
    const top = this.drawWall(ctx, W, H, k, gy);
    // the rope and its hook
    const sx = (x) => (x - this.cam) * W;
    if (this.grap) {
      const G = this.grap, hx = sx(G.hookX), u = clamp(G.t / THROW, 0, 1), hand = gy + this.kage.y * H - 60 * k;
      const hy = lerp(hand, top - 4 * k, ease.outCubic(u)) - Math.sin(u * Math.PI) * 30 * k; // the hook's arc up to the coping
      ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.moveTo(hx, gy + this.kage.y * H - (u < 1 ? 50 * k : 0)); ctx.quadraticCurveTo(hx + 6 * k, (hy + gy) / 2, hx, hy); ctx.stroke();
      ctx.strokeStyle = '#8a8c94'; ctx.lineWidth = 2.4 * k; // the iron hook's claws
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - 7 * k); ctx.moveTo(hx, hy - 4 * k); ctx.quadraticCurveTo(hx - 7 * k, hy - 4 * k, hx - 6 * k, hy - 10 * k); ctx.moveTo(hx, hy - 4 * k); ctx.quadraticCurveTo(hx + 7 * k, hy - 4 * k, hx + 6 * k, hy - 10 * k); ctx.stroke();
    }
    // the players (climbing: lifted up the rope to the wall top, then over and out of sight)
    for (const a of [...this.actors].sort((q, r) => q.y - r.y)) {
      if (a.alpha <= 0.01) continue;
      const x = sx(a.x), ground = gy + a.y * H, y = lerp(ground, top + 8 * k, a.z || 0) - (a.over || 0) * 14 * k;
      ctx.save(); ctx.globalAlpha = a.alpha;
      if (!(a.z > 0.05)) drawShadow(ctx, x, ground, 14 * k * a.s * 0.5, 0.3);
      drawHumanoid(ctx, { ...a.rig, x, y, z: 0, facing: a.climbing ? -Math.PI / 2 : a.facing, time: this.t + a.x * 7, walk: a.walk, move: a.move, s: a.s * k * 0.8, pose: null, flash: 0, alpha: a.alpha, seed: a.id === 'kage' ? 1 : 2 });
      ctx.restore();
    }
    this.drawWeather(ctx, W, H, k, p);
    fog(ctx, W, H, k, this.t, gy - 10 * k, 70 * k, p > 0.5 ? '120,60,50' : '200,210,230', 0.12 + p * 0.1, 7, 3, 6);
    vignette(ctx, W, H, p > 0.5 ? '20,4,6' : '6,8,20', 0.45 + p * 0.15);
    // letterbox, fade, dialogue
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H * 0.07);
    if (this.fade > 0.001) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, W, H); }
    if (this.outT < 0 && this.gateReady()) this.dlg.draw(ctx);
  }

  // night sky: deep blue over the snowy town, smoky crimson toward the fortress; a pale moon
  drawSky(ctx, W, H, k, gy, p) {
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, mix('#0b1026', '#120610', p)); sky.addColorStop(1, mix('#2c3458', '#5a1a1c', p));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, gy);
    for (let i = 0; i < 40; i++) {
      const x = ((i * 97.13) % 1) * W, y = ((i * 57.7) % 1) * gy * 0.7, tw = 0.5 + 0.5 * Math.sin(this.t * 2 + i);
      ctx.fillStyle = `rgba(230,235,255,${(0.5 + 0.4 * tw) * (1 - p * 0.85)})`; ctx.fillRect(x, y, 1.6 * k, 1.6 * k);
    }
    const mx = W * 0.18, my = H * 0.17;
    glow(ctx, mx, my, 110 * k, p > 0.5 ? '255,140,110' : '210,225,255', 0.28);
    ctx.fillStyle = mix('#eef2ff', '#ffc8b0', p); ctx.beginPath(); ctx.arc(mx, my, 26 * k, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.beginPath(); ctx.arc(mx - 8 * k, my - 5 * k, 6 * k, 0, TAU); ctx.arc(mx + 7 * k, my + 8 * k, 4 * k, 0, TAU); ctx.fill();
    if (p > 0.2) glow(ctx, W * 0.75, gy, 420 * k, '255,70,30', 0.2 * p);
  }

  // far away: mountains, then the fortress keep on its hill (it grows as you near it), smoke from its forges
  drawFar(ctx, W, H, k, gy, p) {
    [[0.05, 80, '#1a2038', '#200a12'], [0.14, 50, '#232a48', '#2a0e14']].forEach(([par, hgt, c0, c1], L) => {
      ctx.fillStyle = mix(c0, c1, p);
      ctx.beginPath(); ctx.moveTo(0, gy);
      for (let x = 0; x <= W + 16 * k; x += 16 * k) { const u = (x / W + this.cam * par) * 5 + L * 7; ctx.lineTo(x, gy - 30 * k - (Math.sin(u) * 0.5 + Math.sin(u * 2.3) * 0.3 + 0.9) * hgt * k); }
      ctx.lineTo(W, gy); ctx.closePath(); ctx.fill();
    });
    const kx = (1.55 - this.cam) * W * 0.35 + W * 0.5, sc = (0.55 + p * 0.65) * k, base = gy - 40 * k;
    ctx.save(); ctx.globalAlpha = clamp(p * 1.6, 0, 1);
    ctx.fillStyle = '#100a10';
    ctx.beginPath(); ctx.moveTo(kx - 260 * sc, gy); ctx.quadraticCurveTo(kx, base - 30 * sc, kx + 260 * sc, gy); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const w = (150 - i * 24) * sc, y = base - 20 * sc - i * 42 * sc;
      ctx.fillStyle = '#16101a'; ctx.fillRect(kx - w / 2, y - 30 * sc, w, 30 * sc);
      ctx.fillStyle = '#0a070c'; ctx.beginPath(); ctx.moveTo(kx - w / 2 - 22 * sc, y - 26 * sc); ctx.quadraticCurveTo(kx, y - 46 * sc, kx + w / 2 + 22 * sc, y - 26 * sc); ctx.lineTo(kx + w / 2 + 28 * sc, y - 32 * sc); ctx.lineTo(kx, y - 52 * sc); ctx.lineTo(kx - w / 2 - 28 * sc, y - 32 * sc); ctx.closePath(); ctx.fill();
      for (let j = 0; j < 3 - (i > 2 ? 1 : 0); j++) { const wx = kx - w / 3 + j * w / 3, fl = 0.7 + 0.3 * Math.sin(this.t * 3 + i + j); ctx.fillStyle = `rgba(255,150,70,${0.75 * fl})`; ctx.fillRect(wx - 4 * sc, y - 20 * sc, 8 * sc, 10 * sc); }
    }
    for (let j = 0; j < 8; j++) { const q = (this.t * 0.05 + j / 8) % 1; ctx.fillStyle = `rgba(60,40,40,${0.35 * (1 - q)})`; ctx.beginPath(); ctx.arc(kx + 90 * sc + q * 120 * sc, base - 60 * sc - q * 220 * sc, (8 + q * 40) * sc, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // the road: the last snowy houses of Yukishiro, then burnt trees and a torn banner in the ash
  drawGround(ctx, W, H, k, gy, p) {
    const sx = (x) => (x - this.cam) * W;
    ctx.fillStyle = mix('#c8d2e4', '#2e2626', p); ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = mix('#9aa6bc', '#4a3a34', p); ctx.fillRect(0, gy + 0.03 * H, W, 0.07 * H);
    for (const [x, w, h] of [[-0.05, 0.14, 70], [0.14, 0.12, 56], [0.33, 0.16, 80]]) {
      const X = sx(x); if (X > W + 200 || X + w * W < -200) continue;
      const y = gy - 6 * k;
      ctx.fillStyle = '#141a2c'; ctx.fillRect(X, y - h * k, w * W, h * k);
      ctx.fillStyle = '#0c1020'; ctx.beginPath(); ctx.moveTo(X - 14 * k, y - h * k); ctx.lineTo(X + w * W / 2, y - (h + 34) * k); ctx.lineTo(X + w * W + 14 * k, y - h * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8eef8'; ctx.beginPath(); ctx.moveTo(X - 14 * k, y - h * k); ctx.lineTo(X + w * W / 2, y - (h + 34) * k); ctx.lineTo(X + w * W + 14 * k, y - h * k); ctx.lineTo(X + w * W + 6 * k, y - (h - 4) * k); ctx.lineTo(X + w * W / 2, y - (h + 26) * k); ctx.lineTo(X - 6 * k, y - (h - 4) * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,190,110,0.8)'; ctx.fillRect(X + w * W * 0.3, y - h * k * 0.6, 10 * k, 14 * k);
      hangingLantern(ctx, X + w * W - 8 * k, y - h * k + 4 * k, k * 0.9, this.t, x * 9, { col: '#c83a2a', len: 12 });
    }
    for (const x of [0.58, 0.72, 0.86]) {
      const X = sx(x), y = gy + 2 * k; if (X < -80 || X > W + 80) continue;
      ctx.strokeStyle = '#0c0808'; ctx.lineCap = 'round'; ctx.lineWidth = 6 * k;
      ctx.beginPath(); ctx.moveTo(X, y); ctx.lineTo(X + 4 * k, y - 90 * k); ctx.stroke();
      ctx.lineWidth = 3 * k;
      for (const [a, l, h] of [[-0.9, 36, 70], [0.7, 30, 55], [-0.5, 24, 82], [1.0, 20, 40]]) { ctx.beginPath(); ctx.moveTo(X + 3 * k, y - h * k); ctx.lineTo(X + 3 * k + Math.sin(a) * l * k, y - h * k - Math.cos(a) * l * k * 0.6); ctx.stroke(); }
    }
    const bx = sx(0.96); if (bx > -40 && bx < W + 40) nobori(ctx, bx, gy + 4 * k, k, this.t, 3, { col: '#5a0e18', h: 130, mon: '#c89838' });
  }

  // the fortress wall: a battered stone base, white plaster above with a tiled coping, towers, the barred gate with
  // braziers. Returns the y of the wall top (where the hook bites)
  drawWall(ctx, W, H, k, gy) {
    const sx = (x) => (x - this.cam) * W, x0 = sx(WALL_X0);
    const foot = gy + 2 * k, stoneTop = gy - 120 * k, top = gy - 190 * k;
    if (x0 > W) return top;
    ctx.fillStyle = '#2a2628'; ctx.beginPath(); ctx.moveTo(x0, foot); ctx.lineTo(W + 10, foot); ctx.lineTo(W + 10, stoneTop); ctx.lineTo(x0 + 40 * k, stoneTop); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(10,8,10,0.55)'; ctx.lineWidth = 1.2 * k;
    for (let r = 0; r < 6; r++) {
      const y = foot - (r + 1) * 20 * k, inset = (40 * k) * ((r + 1) / 6);
      ctx.beginPath(); ctx.moveTo(x0 + inset, y); ctx.lineTo(W, y); ctx.stroke();
      for (let c = 0; c < 40; c++) { const bxx = x0 + inset + ((c * 47 + r * 23) % 9 + c * 9) * 6 * k; if (bxx > W) break; ctx.beginPath(); ctx.moveTo(bxx, y); ctx.lineTo(bxx, y + 20 * k); ctx.stroke(); }
    }
    const RW = W + 20 - (x0 + 40 * k);
    ctx.fillStyle = '#c9c4bc'; ctx.fillRect(x0 + 40 * k, top, RW, stoneTop - top);
    ctx.fillStyle = 'rgba(40,30,30,0.35)'; ctx.fillRect(x0 + 40 * k, stoneTop - 14 * k, RW, 14 * k);
    for (let i = 0; i < 30; i++) { const lx = x0 + 70 * k + i * 70 * k; if (lx > W) break; ctx.fillStyle = '#2a2426'; ctx.fillRect(lx, top + 26 * k, 10 * k, 10 * k); }
    ctx.fillStyle = '#1a1618'; ctx.beginPath(); ctx.moveTo(x0 + 30 * k, top + 4 * k); ctx.lineTo(W + 10, top + 4 * k); ctx.lineTo(W + 10, top - 12 * k); ctx.lineTo(x0 + 44 * k, top - 12 * k); ctx.closePath(); ctx.fill();
    for (const tx of TOWERS) { // towers, a lamp in each window
      const X = sx(tx); if (X < -120 || X > W + 120) continue;
      const tw = 120 * k, ty = top - 80 * k;
      ctx.fillStyle = '#d2cdc4'; ctx.fillRect(X - tw / 2, ty, tw, 80 * k);
      ctx.fillStyle = '#1a1618'; ctx.beginPath(); ctx.moveTo(X - tw / 2 - 18 * k, ty + 6 * k); ctx.quadraticCurveTo(X, ty - 30 * k, X + tw / 2 + 18 * k, ty + 6 * k); ctx.lineTo(X + tw / 2 + 8 * k, ty - 6 * k); ctx.lineTo(X, ty - 34 * k); ctx.lineTo(X - tw / 2 - 8 * k, ty - 6 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(255,150,70,${0.7 + 0.2 * Math.sin(this.t * 5 + tx)})`; ctx.fillRect(X - 12 * k, ty + 28 * k, 24 * k, 14 * k);
    }
    const GX = sx(GATE_X);
    if (GX > -200 && GX < W + 200) { // the great gate, barred
      const gw = 150 * k, gh = 130 * k, gt = foot - gh;
      ctx.fillStyle = '#1e1a1c'; ctx.fillRect(GX - gw / 2 - 18 * k, gt - 30 * k, gw + 36 * k, gh + 30 * k);
      ctx.fillStyle = '#0e0a0c'; ctx.beginPath(); ctx.moveTo(GX - gw / 2 - 50 * k, gt - 26 * k); ctx.quadraticCurveTo(GX, gt - 70 * k, GX + gw / 2 + 50 * k, gt - 26 * k); ctx.lineTo(GX + gw / 2 + 30 * k, gt - 40 * k); ctx.lineTo(GX, gt - 78 * k); ctx.lineTo(GX - gw / 2 - 30 * k, gt - 40 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a2418'; ctx.fillRect(GX - gw / 2, gt, gw, gh);
      ctx.strokeStyle = '#120a08'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.moveTo(GX, gt); ctx.lineTo(GX, foot); ctx.stroke();
      ctx.fillStyle = '#2a2a30'; for (const y of [0.22, 0.5, 0.78]) ctx.fillRect(GX - gw / 2, gt + gh * y - 4 * k, gw, 8 * k);
      ctx.fillStyle = '#6a6870'; for (const y of [0.22, 0.5, 0.78]) for (let c = 0; c < 8; c++) { ctx.beginPath(); ctx.arc(GX - gw / 2 + 10 * k + c * (gw - 20 * k) / 7, gt + gh * y, 2.2 * k, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#4a3020'; ctx.fillRect(GX - gw / 2 - 6 * k, gt + gh * 0.45, gw + 12 * k, 12 * k);
      for (const s of [-1, 1]) {
        const bx = GX + s * (gw / 2 + 40 * k), by = foot - 2 * k, fl = 0.8 + 0.2 * Math.sin(this.t * 11 + s);
        glow(ctx, bx, by - 40 * k, 130 * k, '255,140,60', 0.4 * fl);
        ctx.fillStyle = '#141012'; ctx.fillRect(bx - 3 * k, by - 34 * k, 6 * k, 34 * k); ctx.beginPath(); ctx.moveTo(bx - 14 * k, by - 40 * k); ctx.lineTo(bx + 14 * k, by - 40 * k); ctx.lineTo(bx + 8 * k, by - 32 * k); ctx.lineTo(bx - 8 * k, by - 32 * k); ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgba(255,${Math.round(150 + 60 * fl)},70,0.9)`; ctx.beginPath(); ctx.moveTo(bx - 10 * k, by - 40 * k); ctx.quadraticCurveTo(bx - 6 * k, by - 58 * k * fl, bx, by - 66 * k * fl); ctx.quadraticCurveTo(bx + 6 * k, by - 56 * k * fl, bx + 10 * k, by - 40 * k); ctx.closePath(); ctx.fill();
      }
    }
    return top;
  }

  // snow over the town, turning to ash and embers near the fortress
  drawWeather(ctx, W, H, k, p) {
    for (const f of this.flakes) { ctx.fillStyle = p < 0.5 ? `rgba(240,244,255,${0.8 * (1 - p * 1.6)})` : `rgba(110,96,92,${0.6 * (p - 0.3)})`; ctx.beginPath(); ctx.arc(f.x * W, f.y * H, (1.2 + f.s) * k, 0, TAU); ctx.fill(); }
    if (p > 0.4) { ctx.save(); ctx.globalAlpha = clamp((p - 0.4) * 2, 0, 1); this.fx.embers.draw(ctx, W, H, k); this.fx.ash.draw(ctx, W, H, k); ctx.restore(); }
  }
}

// Area 2 cutscene (before level 11): the players walk out of the Haruno rice fields into Momiji Pass.
// A side-scrolling walk: spring green turns to autumn maples, wild animals scatter as they pass, and
// the tengu (area 2's boss) swoops down with his crows, screeches at them and flies off to his peak.
// The area 2 song starts here and plays on into level 11 (game.updateMusic).
// Lines come from SCRIPTS.area2 in story.js: `at` holds a line until the players have walked that far,
// `delay` holds it for a few seconds (while the tengu lands), `act` cues the scene.
import { TAU, clamp, lerp, ease, rand } from './util.js';
import { drawHumanoid, drawShadow, INK } from './rig.js';
import { LOOKS } from './behaviors.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { Dialogue } from './dialogue.js';
import { storyLines } from './story.js';
import { PALS, weaponRig } from './cutscene.js';
import { Motes, fog, lightShafts, vignette, glow, stoneLantern, figure, crow, heron, flitter, spiritFlame } from './cutfx.js';

const SPEED = 0.09;   // walking speed (screen widths per second)
const LEAD = 0.4;     // where the leader stands on screen while walking
const OUT_WALK = 2.2; // seconds of walking on after the last line before the fade
const STOP_AT = 2.3;  // the players halt here (at the vow) until the tengu has gone
const ROCK = { x: 2.68, y: -0.005 }; // the boulder the tengu lands on
const SPRING = { skyTop: '#a9cfe3', skyBot: '#efe7cf', mtn: ['#9db6c2', '#7d9aa8'], hill: '#78a858', grass: '#87b35e', grassDark: '#5f9440', path: '#c9a878', pathEdge: '#a98a5e', tuft: '#4f8035' };
const AUTUMN = { skyTop: '#e8a87a', skyBot: '#f5dcc0', mtn: ['#b0705e', '#8a5048'], hill: '#9a6a3a', grass: '#ad9550', grassDark: '#7f6a34', path: '#a49a8a', pathEdge: '#7f776a', tuft: '#9a8040' };
const LEAVES = ['#d8452a', '#e8742a', '#f0a830', '#c8302a', '#b83a20'];
const BLEND0 = 0.95, BLEND1 = 1.9; // world x where spring turns into autumn

const hexRgb = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`; };
const hsh = (i, s = 0) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const blendAt = (x) => { const u = clamp((x - BLEND0) / (BLEND1 - BLEND0), 0, 1); return u * u * (3 - 2 * u); };
const pal = (key, x) => mix(SPRING[key], AUTUMN[key], blendAt(x));

export class Area2Cutscene {
  constructor(g, onDone, opts = {}) {
    this.id = 'area2'; this.song = 'biome_2_chill';
    this.g = g; this.onDone = onDone; this.t = 0; this.remote = !!opts.remote;
    this.coop = g.players.length > 1;
    this.fade = 1; this.titleT = -1; this.done = false; this.outT = -1; this.walking = true;
    this.kage = this.actor({ id: 'kage', x: 0, y: 0.055, rig: { pal: PALS[0], head: 'hood', scarf: true, ...weaponRig(g.players[0]) } });
    this.actors = [this.kage];
    if (this.coop) this.actors.push(this.kaze = this.actor({ id: 'kaze', x: -0.075, y: 0.08, rig: { pal: PALS[1], head: 'hood', scarf: true, ...weaponRig(g.players[1]) } }));
    this.cam = this.kage.x - LEAD;
    this.animals = [
      ...[0.6, 0.625, 0.66, 0.69].map((x, i) => this.animal('sparrow', x, 0.03 + (i % 2) * 0.05, 0.9)),
      this.animal('rabbit', 0.95, 0.0, 1), this.animal('rabbit', 1.04, 0.125, 0.9),
      this.animal('deer', 1.95, -0.012, 1.15, { stag: true }), this.animal('deer', 2.05, -0.02, 1), this.animal('deer', 2.12, 0.0, 0.7, { fawn: true }),
      this.animal('fox', 2.6, 0.125, 1),
    ];
    this.sky = [ // cranes and small flocks crossing the sky (screen space)
      { kind: 'crane', x: -0.1, y: 0.2, vx: 0.045, t: 0, s: 1 }, { kind: 'crane', x: -0.17, y: 0.235, vx: 0.045, t: 0.6, s: 0.85 },
    ];
    this.flockT = 6; this.leaves = []; this.crows = []; this.tengu = null; this.gust = 0; this.rock = null; this.halted = false; // (no boulder: the tengu lands on the road)
    this.dlg = new Dialogue(g, { remote: opts.remote });
    this.dlg.open('area2', storyLines('area2', this.coop), () => this.endDialogue(), (i, L) => {
      this.gate = { at: L.at ?? null, until: this.t + (L.delay || 0), shown: false };
      if (L.act) this.act(L.act);
      this.onLine?.(i, L);
    });
    const baseSkip = this.dlg.skip.bind(this.dlg);
    this.dlg.skip = () => { this.skipped = true; baseSkip(); };
    for (let i = 0; i < 26; i++) this.spawnLeaf(true);
    // air: dust in the sunlight, fireflies and pale spirit lights once the pass grows dark and old
    this.fx = { dust: new Motes(60, 'dust', [0, 0.1, 1, 0.95]), flies: new Motes(24, 'firefly', [0, 0.45, 1, 0.92]), wisps: new Motes(7, 'wisp', [0.45, 0.25, 1, 0.62]) };
  }

  actor(o) { return { x: 0, y: 0, facing: 0, walk: 0, move: 0, s: 2.3, ...o }; }
  animal(kind, x, y, s, o = {}) { return { kind, x, y, s, state: 'idle', t: rand(0, 6), vx: 0, vy: 0, alt: 0, va: 0, hd: 1, seed: rand(0, 9), ...o }; }

  act(name) {
    if (name === 'tengu') {
      this.walking = false;
      this.tengu = { mode: 'in', mt: 0, wx0: ROCK.x + 0.55, wx: ROCK.x + 0.55, perchX: ROCK.x, alt: 0.5, landed: false };
      this.crows = Array.from({ length: 9 }, (_, i) => ({ ang: (i / 9) * TAU, r: rand(0.7, 1.15), sp: rand(1.4, 2.2) * (i % 2 ? 1 : -1), h: rand(-0.4, 0.4), fly: 0, x: 0, y: 0, vx: 0, vy: 0, in: -i * 0.12 }));
      sfx.dash(); sfx.caw(0.75, 0.1); this.gust = 1;
      for (let i = 0; i < 40; i++) this.spawnLeaf(false, true);
      for (const a of this.animals) if (a.state === 'idle' && a.x - this.cam < 1.2) this.flee(a);
    } else if (name === 'tenguLeave') {
      if (this.tengu) { this.tengu.mode = 'out'; this.tengu.mt = 0; }
      sfx.dash();
      for (const c of this.crows) { c.fly = 1; c.vx = rand(-0.1, 0.35); c.vy = rand(0.25, 0.5); }
    } else if (name === 'walkOn') { this.walking = true; this.halted = true; }
    else if (name === 'stop') this.walking = false;
  }

  endDialogue() {
    if (this.skipped) { this.finish(); return; }
    this.outT = 0; this.walking = true;
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
      this.fade = Math.max(0, this.fade - dt * 0.8);
      if (this.gateReady()) {
        const L = this.dlg.line;
        if (L && !this.gate.shown) { this.gate.shown = true; if (L.who === 'tengu') this.tenguVoice(L.text); }
        this.dlg.update(dt);
      } else if (!this.remote && (input.pressed('pause') || input.pressed('back'))) { input.eat('pause'); input.eat('back'); this.dlg.skip(); }
    } else {
      this.outT += dt;
      if (this.outT > OUT_WALK) this.fade = Math.min(1, this.fade + dt * 1.1);
      if (this.outT > OUT_WALK && this.fade >= 1) this.finish();
    }
    // the walkers (they halt at STOP_AT until the tengu has gone)
    if (this.walking && !this.halted && this.kage.x >= STOP_AT) { this.walking = false; this.halted = true; }
    for (const a of this.actors) {
      if (this.walking) { a.x += SPEED * dt; a.walk += SPEED * dt * 60; a.move = 1; } else a.move = lerp(a.move, 0, 0.2);
      a.facing = 0;
    }
    this.cam = lerp(this.cam, this.kage.x - LEAD, 1 - Math.exp(-4 * dt));
    for (const a of this.animals) this.updateAnimal(a, dt);
    this.animals = this.animals.filter((a) => a.state === 'idle' ? a.x - this.cam > -0.5 : a.x - this.cam < 1.3 && a.alt < 1.2); // drop the ones that ran off
    this.updateSky(dt);
    if (this.tengu) this.updateTengu(dt);
    // falling petals and leaves
    if (Math.random() < dt * 7) this.spawnLeaf(false);
    for (const p of this.leaves) {
      p.t += dt; p.x += (p.vx + Math.sin(p.t * 2 + p.ph) * 0.02 - this.gust * 0.25) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    this.leaves = this.leaves.filter((p) => p.y < 1.05 && p.x > -0.1);
    this.gust = Math.max(0, this.gust - dt * 0.7);
    for (const m of Object.values(this.fx)) m.update(dt);
    // songbirds in the fields
    if (blendAt(this.cam + 0.5) < 0.6 && Math.random() < dt * 0.35) sfx.bird();
  }

  spawnLeaf(anywhere, gust = false) {
    const leaf = Math.random() < blendAt(this.cam + 0.6);
    this.leaves.push({
      kind: leaf ? 'leaf' : 'petal', col: leaf ? LEAVES[Math.floor(Math.random() * LEAVES.length)] : Math.random() < 0.5 ? '#f7c3d2' : '#fde3ea',
      x: gust ? rand(0.9, 1.3) : rand(0, 1.15), y: anywhere ? rand(0, 0.9) : gust ? rand(0.1, 0.7) : -0.03,
      vx: gust ? -rand(0.2, 0.5) : -rand(0.01, 0.05), vy: rand(0.04, 0.09), rot: rand(0, TAU), vr: rand(-3, 3), t: 0, ph: rand(0, 9), s: rand(0.7, 1.3),
    });
  }

  flee(a) {
    if (a.state !== 'idle') return;
    a.state = 'flee'; a.t = 0;
    if (a.kind === 'sparrow') { a.vx = rand(0.12, 0.3); a.va = rand(0.35, 0.55); sfx.bird(); }
    else if (a.kind === 'rabbit') { a.vx = rand(0.2, 0.26); a.vy = a.y > 0.06 ? 0.02 : -0.02; }
    else if (a.kind === 'deer') { a.vx = rand(0.26, 0.34); a.vy = -0.025; }
    else if (a.kind === 'fox') { a.vx = 0.3; a.vy = -0.04; }
  }

  updateAnimal(a, dt) {
    a.t += dt;
    const d = a.x - this.kage.x;
    const reach = { sparrow: 0.14, rabbit: 0.2, deer: 0.32, fox: 0.34 }[a.kind];
    if (a.state === 'idle' && d < reach && d > -0.2) this.flee(a);
    if (a.state === 'flee') {
      const k = Math.min(1, a.t * 3); // a quick start
      a.x += a.vx * k * dt; a.y = clamp(a.y + a.vy * dt, -0.05, 0.16);
      if (a.kind === 'sparrow') a.alt += a.va * dt;
    }
    // deer graze: head down most of the time, up now and then (and always while running)
    const up = a.state === 'flee' || Math.sin(a.t * 0.55 + a.seed) > 0.45 || d < reach + 0.18;
    a.hd = lerp(a.hd, up ? 0 : 1, 1 - Math.exp(-5 * dt));
  }

  updateSky(dt) {
    for (const b of this.sky) { b.t += dt; b.x += b.vx * dt; if (b.vy) b.y += b.vy * dt; }
    this.sky = this.sky.filter((b) => b.x < 1.25 && b.x > -0.3 && b.y > -0.1);
    this.flockT -= dt;
    if (this.flockT <= 0) {
      this.flockT = rand(7, 12);
      const y = rand(0.12, 0.3), dir = Math.random() < 0.6 ? 1 : -1;
      for (let i = 0; i < 5; i++) this.sky.push({ kind: 'bird', x: dir > 0 ? -0.05 - i * 0.025 : 1.05 + i * 0.025, y: y + (i % 2) * 0.02 + rand(-0.01, 0.01), vx: dir * rand(0.09, 0.12), t: rand(0, 3), s: 1 });
    }
  }

  updateTengu(dt) {
    const T = this.tengu;
    T.mt += dt;
    if (T.mode === 'in') {
      const u = ease.outCubic(clamp(T.mt / 1.5, 0, 1));
      T.wx = lerp(T.wx0, T.perchX, u);
      T.alt = lerp(0.55, 0, u) + Math.sin(u * Math.PI) * 0.06;
      if (u >= 1 && !T.landed) { T.landed = true; T.mode = 'perch'; sfx.slam(); }
    } else if (T.mode === 'out') {
      const k = T.mt;
      T.alt = k * k * 0.32 + k * 0.08;
      T.wx = T.perchX + k * k * 0.12;
      if (T.mt > 0.15 && !T.cawOut) { T.cawOut = true; sfx.caw(0.7, 0); sfx.caw(0.66, 0.35); }
      if (T.mt > 2.4) { this.tengu = null; this.crows = []; return; }
    }
    // crows circle the tengu, then scatter
    for (const c of this.crows) {
      c.in += dt;
      if (c.fly) { c.x += c.vx * dt; c.y += c.vy * dt; continue; }
      c.ang += c.sp * dt;
    }
    if (T.mode !== 'out' && Math.random() < dt * 0.9) sfx.caw(rand(1.15, 1.45), 0);
  }

  // a few caws under each tengu line
  tenguVoice(text) {
    const n = Math.min(3, (text.match(/k[r]?a+/gi) || []).length || 1);
    for (let i = 0; i < n; i++) sfx.caw(0.82 - i * 0.05, i * 0.3);
  }

  // ---------------------------------------------------------------- drawing
  draw(ctx) {
    const v = this.g.view, W = v.W, H = v.H, k = v.k;
    const gy = H * 0.64;
    this.drawBackdrop(ctx, W, H, k, gy);
    this.drawGround(ctx, W, H, k, gy);
    // everything standing on the ground, back to front
    const sx = (x) => (x - this.cam) * W;
    const list = [];
    for (const a of this.actors) list.push({ y: a.y, f: () => {
      const x = sx(a.x), y = gy + a.y * H;
      drawShadow(ctx, x, y, 14 * k * a.s * 0.5, 0.3);
      drawHumanoid(ctx, { ...a.rig, x, y, z: 0, facing: a.facing, time: this.t + a.x * 7, walk: a.walk, move: a.move, s: a.s * k * 0.8, pose: null, flash: 0, alpha: 1, seed: a.id === 'kage' ? 1 : 2 });
    } });
    for (const a of this.animals) list.push({ y: a.y, f: () => this.drawAnimal(ctx, a, sx(a.x), gy + a.y * H, k) });
    if (this.rock) list.push({ y: this.rock.y, f: () => this.drawRock(ctx, sx(this.rock.x), gy + this.rock.y * H, k) });
    list.sort((a, b) => a.y - b.y);
    for (const e of list) e.f();
    if (this.tengu) this.drawTengu(ctx, W, H, k, gy);
    this.drawForeground(ctx, W, H, k);
    this.drawLeaves(ctx, W, H, k);
    { // the pass grows darker, foggier and stranger the deeper you go
      const b = blendAt(this.cam + 0.5);
      lightShafts(ctx, W, H, k, this.t, W * 0.25, -20 * k, b > 0.5 ? '255,200,140' : '255,250,220', 6, 0.025 + b * 0.05, 0.6, Math.PI / 2 - 0.35);
      this.fx.dust.draw(ctx, W, H, k);
      fog(ctx, W, H, k, this.t, gy - 20 * k, 80 * k, b > 0.5 ? '255,230,210' : '255,252,240', 0.1 + b * 0.18, 8, 7, 6);
      fog(ctx, W, H, k, this.t, H * 0.9, 60 * k, '255,240,230', 0.06 + b * 0.12, 12, 13, 5);
      if (b > 0.3) { ctx.save(); ctx.globalAlpha = clamp((b - 0.3) * 1.6, 0, 1); this.fx.flies.draw(ctx, W, H, k); ctx.restore(); }
      vignette(ctx, W, H, b > 0.5 ? '40,10,6' : '30,30,20', 0.3 + b * 0.25);
    }
    // letterbox, fade, dialogue
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H * 0.07);
    if (this.fade > 0.001) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, W, H); }
    if (this.outT < 0 && this.gateReady()) this.dlg.draw(ctx);
  }

  drawBackdrop(ctx, W, H, k, gy) {
    const b = blendAt(this.cam + 0.5);
    const sky = ctx.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, mix(SPRING.skyTop, AUTUMN.skyTop, b)); sky.addColorStop(1, mix(SPRING.skyBot, AUTUMN.skyBot, b));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, gy);
    // sun: high and white over the fields, low and golden over the pass
    const sunX = W * lerp(0.25, 0.7, b), sunY = lerp(H * 0.16, gy - 150 * k, b);
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 240 * k);
    sg.addColorStop(0, b > 0.5 ? 'rgba(255,230,180,0.85)' : 'rgba(255,252,236,0.85)'); sg.addColorStop(0.18, 'rgba(255,220,170,0.35)'); sg.addColorStop(1, 'rgba(255,220,170,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, gy);
    // the tengu's peak, rising ahead once the pass begins
    const pa = clamp((b - 0.2) / 0.5, 0, 1);
    if (pa > 0) {
      const px = (0.74 + (1.8 - this.cam) * 0.08) * W, top = gy - 330 * k; // straight ahead when the tengu comes
      ctx.save(); ctx.globalAlpha = pa;
      ctx.fillStyle = '#9a6a6a';
      ctx.beginPath(); ctx.moveTo(px - 260 * k, gy); ctx.lineTo(px - 40 * k, top + 30 * k); ctx.lineTo(px, top); ctx.lineTo(px + 50 * k, top + 40 * k); ctx.lineTo(px + 300 * k, gy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f4ece4';
      ctx.beginPath(); ctx.moveTo(px - 40 * k, top + 30 * k); ctx.lineTo(px, top); ctx.lineTo(px + 50 * k, top + 40 * k); ctx.lineTo(px + 22 * k, top + 34 * k); ctx.lineTo(px + 6 * k, top + 46 * k); ctx.lineTo(px - 14 * k, top + 36 * k); ctx.closePath(); ctx.fill();
      // a tiny shrine on the summit
      ctx.fillStyle = '#3a2228'; ctx.fillRect(px - 5 * k, top - 9 * k, 10 * k, 9 * k);
      ctx.beginPath(); ctx.moveTo(px - 9 * k, top - 8 * k); ctx.lineTo(px, top - 15 * k); ctx.lineTo(px + 9 * k, top - 8 * k); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for (const s of this.sky) this.drawSkyBird(ctx, s, W, H, k);
    // mountain ranges: low blue hills over the fields, steep red ridges over the pass
    [[0.06, 95, 0], [0.16, 62, 1]].forEach(([p, hgt, L]) => {
      ctx.fillStyle = mix(SPRING.mtn[L], AUTUMN.mtn[L], b);
      ctx.beginPath(); ctx.moveTo(0, gy);
      for (let x = 0; x <= W + 16 * k; x += 16 * k) {
        const u = (x / W + this.cam * p) * 5 + L * 7;
        ctx.lineTo(x, gy - 22 * k - (Math.sin(u) * 0.5 + Math.sin(u * 2.3) * 0.3 + 0.9) * hgt * k * (1 + b * 0.8));
      }
      ctx.lineTo(W, gy); ctx.closePath(); ctx.fill();
    });
    // rolling hills with a far line of trees
    const p = 0.4;
    ctx.fillStyle = this.groundGrad(ctx, W, 'hill', 0.4); // the far hills turn a little ahead of the road
    ctx.beginPath(); ctx.moveTo(0, gy);
    for (let x = 0; x <= W + 12 * k; x += 12 * k) { const u = (x / W + this.cam * p) * 7; ctx.lineTo(x, gy - 30 * k - (Math.sin(u) * 0.5 + Math.sin(u * 1.7 + 2) * 0.5 + 1) * 16 * k); }
    ctx.lineTo(W, gy); ctx.closePath(); ctx.fill();
    this.drawFarLife(ctx, W, H, k, gy, b);
    this.drawTreeRow(ctx, W, k, gy - 34 * k, p, 0.055, 0.55, 0.2);
    this.drawTreeRow(ctx, W, k, gy - 10 * k, 0.75, 0.12, 1, 0.55);
  }

  // far away: a farmhouse with chimney smoke on the hills over the fields, a monk walking a hill path,
  // an old torii and a waterfall in the pass, and pale spirit lights drifting around the tengu's peak
  drawFarLife(ctx, W, H, k, gy, b) {
    const t = this.t, far = (lx) => (lx - this.cam * 0.4) * W;
    const fx = far(0.55), fy = gy - 46 * k;
    if (fx > -80 * k && fx < W + 80 * k) {
      ctx.fillStyle = 'rgba(80,70,60,0.75)'; ctx.fillRect(fx - 18 * k, fy - 12 * k, 36 * k, 12 * k);
      ctx.fillStyle = 'rgba(120,96,60,0.8)'; ctx.beginPath(); ctx.moveTo(fx - 24 * k, fy - 11 * k); ctx.lineTo(fx, fy - 28 * k); ctx.lineTo(fx + 24 * k, fy - 11 * k); ctx.closePath(); ctx.fill();
      for (let j = 0; j < 6; j++) { const q = (t * 0.12 + j / 6) % 1; ctx.fillStyle = `rgba(240,236,230,${0.3 * (1 - q)})`; ctx.beginPath(); ctx.arc(fx + 8 * k + Math.sin(q * 3) * 6 * k + q * 14 * k, fy - 26 * k - q * 60 * k, (2 + q * 7) * k, 0, TAU); ctx.fill(); }
    }
    // a wandering monk on the far hill path, very slowly
    const mx = far(0.9 + ((t * 0.004) % 0.3)), my = gy - 52 * k;
    if (mx > -40 && mx < W + 40) figure(ctx, mx, my, 18 * k, 'monk', t, { walk: true, dir: 1, col: `rgba(50,36,40,${0.55 + b * 0.2})` });
    if (b > 0.15) {
      ctx.save(); ctx.globalAlpha = clamp((b - 0.15) * 2, 0, 1);
      // a thin waterfall down the red cliffs, with spray
      const wx = far(1.45), wy = gy - 150 * k;
      if (wx > -60 && wx < W + 60) {
        ctx.fillStyle = 'rgba(220,236,240,0.6)'; ctx.fillRect(wx - 4 * k, wy, 8 * k, 110 * k);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2 * k; for (let i = 0; i < 4; i++) { const yy = wy + ((t * 60 + i * 28) % 110) * k; ctx.beginPath(); ctx.moveTo(wx - 3 * k, yy); ctx.lineTo(wx - 3 * k, yy + 10 * k); ctx.stroke(); }
        fog(ctx, W, H, k, t, wy + 112 * k, 20 * k, '240,246,250', 0.35, 3, 41, 2);
      }
      // an old torii half in the trees
      const tx = far(1.22), ty = gy - 40 * k;
      if (tx > -60 && tx < W + 60) {
        ctx.fillStyle = 'rgba(150,40,34,0.85)'; ctx.fillRect(tx - 16 * k, ty - 34 * k, 4 * k, 34 * k); ctx.fillRect(tx + 12 * k, ty - 34 * k, 4 * k, 34 * k);
        ctx.fillRect(tx - 22 * k, ty - 38 * k, 44 * k, 4 * k); ctx.fillRect(tx - 18 * k, ty - 30 * k, 36 * k, 3 * k);
      }
      // spirit flames drifting low around the foot of the tengu's peak
      const px = (0.74 + (1.8 - this.cam) * 0.08) * W;
      void px;
      ctx.restore();
    }
  }

  // a row of trees on a parallax layer: cherry and green trees in the fields, maples and ginkgo in the pass
  drawTreeRow(ctx, W, k, baseY, p, spacing, scale, sparse) {
    const off = this.cam * p;
    const i0 = Math.floor((off - 0.2) / spacing), i1 = Math.ceil((off + 1.2) / spacing);
    for (let i = i0; i <= i1; i++) {
      const lx = i * spacing + hsh(i, p) * spacing * 0.8;
      const s = lx - off; // screen fraction
      const wx = this.cam + s * (1 + (1 - p) * 1.6); // trees ahead turn autumn a little before you reach them
      const tb = blendAt(wx);
      if (hsh(i, p + 1) > sparse + (1 - sparse) * tb) continue; // the fields are open; the pass is forest
      const kind = hsh(i, p + 2) < tb ? (hsh(i, p + 3) < 0.22 ? 'ginkgo' : 'maple') : hsh(i, p + 4) < 0.6 ? 'cherry' : 'green';
      this.drawTree(ctx, s * W, baseY + hsh(i, p + 5) * 6 * k, k * scale * (0.85 + hsh(i, p + 6) * 0.35), kind, i);
    }
  }

  drawTree(ctx, x, y, s, kind, seed) {
    const sway = Math.sin(this.t * 1.2 + seed) * 2 * s;
    ctx.fillStyle = '#4a3226'; ctx.fillRect(x - 3 * s, y - 34 * s, 6 * s, 34 * s);
    const cols = { cherry: ['#f2b8c8', '#f7cbd8', '#e8a2b8'], green: ['#4f8a3e', '#5f9a48', '#447a36'], maple: ['#c8302a', '#e0502a', '#a82a22'], ginkgo: ['#e8b830', '#f0cc48', '#d8a028'] }[kind];
    const blobs = [[0, -52, 22], [-16, -42, 16], [16, -42, 16], [-8, -62, 14], [10, -60, 13]];
    blobs.forEach(([bx, by, r], j) => { ctx.fillStyle = cols[j % 3]; ctx.beginPath(); ctx.arc(x + (bx + sway * (by / -60)) * s, y + by * s, r * s, 0, TAU); ctx.fill(); });
  }

  drawGround(ctx, W, H, k, gy) {
    const top = gy - 12 * k, pathT = gy + 0.015 * H, pathB = gy + 0.105 * H;
    ctx.fillStyle = this.groundGrad(ctx, W, 'grass'); ctx.fillRect(0, top, W, H - top);
    ctx.fillStyle = 'rgba(40,30,20,0.12)'; ctx.fillRect(0, top, W, 10 * k);
    const sx = (x) => (x - this.cam) * W;
    // rice paddies on both sides of the road in the fields
    for (let i = -3; i < 6; i++) {
      const wx = -0.32 + i * 0.2, a = clamp(1 - blendAt(wx + 0.2) * 3, 0, 1) * (wx < 0.9 ? 1 : 0);
      const x0 = sx(wx), x1 = sx(wx + 0.17);
      if (a <= 0 || x1 < 0 || x0 > W) continue;
      for (const [y0, y1] of [[top + 6 * k, pathT - 4 * k], [pathB + 10 * k, H - 6 * k]]) {
        ctx.fillStyle = `rgba(150,198,214,${0.75 * a})`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.fillStyle = `rgba(255,255,255,${0.25 * a})`; ctx.fillRect(x0 + 6 * k, y0 + (y1 - y0) * 0.3, (x1 - x0) * 0.5, 2 * k);
        ctx.strokeStyle = `rgba(74,128,52,${0.9 * a})`; ctx.lineWidth = 2 * k;
        ctx.beginPath();
        for (let ry = y0 + 6 * k; ry < y1 - 2 * k; ry += 9 * k) for (let rx = x0 + 5 * k; rx < x1 - 3 * k; rx += 10 * k) { ctx.moveTo(rx, ry); ctx.lineTo(rx - 2 * k, ry - 6 * k); ctx.moveTo(rx, ry); ctx.lineTo(rx + 2 * k, ry - 6 * k); }
        ctx.stroke();
        ctx.strokeStyle = `rgba(110,90,60,${0.6 * a})`; ctx.lineWidth = 3 * k; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    // a stream crossing the land, with a plank bridge where the road meets it
    const st = sx(0.8);
    if (st > -200 * k && st < W + 200 * k) {
      ctx.fillStyle = '#7fb4cc';
      ctx.beginPath(); ctx.moveTo(st - 10 * k, top); ctx.lineTo(st + 22 * k, top); ctx.lineTo(st + 70 * k, H); ctx.lineTo(st + 10 * k, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5 * k;
      for (let i = 0; i < 6; i++) { const yy = top + ((i * 37 + this.t * 30) % (H - top)); const xx = st + (yy - top) / (H - top) * 40 * k; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 10 * k, yy + 3 * k); ctx.stroke(); }
    }
    // the road
    ctx.fillStyle = this.groundGrad(ctx, W, 'path'); ctx.fillRect(0, pathT, W, pathB - pathT);
    ctx.fillStyle = this.groundGrad(ctx, W, 'pathEdge'); ctx.fillRect(0, pathT, W, 3 * k); ctx.fillRect(0, pathB - 3 * k, W, 3 * k);
    for (let i = Math.floor(this.cam / 0.06) - 1; i < (this.cam + 1.1) / 0.06; i++) { // pebbles and ruts
      const x = sx(i * 0.06 + hsh(i, 9) * 0.05), y = pathT + (0.2 + hsh(i, 10) * 0.6) * (pathB - pathT);
      ctx.fillStyle = 'rgba(70,56,40,0.28)'; ctx.beginPath(); ctx.ellipse(x, y, (2 + hsh(i, 11) * 3) * k, 1.6 * k, 0, 0, TAU); ctx.fill();
    }
    if (st > -200 * k && st < W + 200 * k) { // the bridge
      const bx0 = st - 16 * k + (pathT - top) / (H - top) * 48 * k, bw = 64 * k;
      ctx.fillStyle = '#8a6440'; ctx.fillRect(bx0, pathT - 2 * k, bw, pathB - pathT + 4 * k);
      ctx.strokeStyle = '#5a3e26'; ctx.lineWidth = 2 * k;
      for (let x = bx0 + 8 * k; x < bx0 + bw; x += 9 * k) { ctx.beginPath(); ctx.moveTo(x, pathT); ctx.lineTo(x + 3 * k, pathB); ctx.stroke(); }
      ctx.fillStyle = '#6a4a2e'; ctx.fillRect(bx0 - 4 * k, pathT - 16 * k, bw + 8 * k, 4 * k);
      for (const px of [bx0 - 2 * k, bx0 + bw - 2 * k]) ctx.fillRect(px, pathT - 18 * k, 5 * k, 18 * k);
    }
    this.drawFieldLife(ctx, W, H, k, gy, top, pathT, pathB, sx, st); // (after the road, so nothing near the camera is painted over)
    // fallen maple leaves on the ground of the pass
    for (let i = Math.floor(this.cam / 0.03) - 1; i < (this.cam + 1.1) / 0.03; i++) {
      const wx = i * 0.03 + hsh(i, 21) * 0.03;
      if (hsh(i, 22) > blendAt(wx) * 0.9) continue;
      const x = sx(wx), y = top + 8 * k + hsh(i, 23) * (H - top - 10 * k);
      ctx.fillStyle = LEAVES[i & 3]; ctx.globalAlpha = 0.75;
      ctx.beginPath(); ctx.ellipse(x, y, 3.2 * k, 1.8 * k, hsh(i, 24) * 3, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // the old border marker of Momiji Pass, with a little jizo in a red bib
    const mx = sx(1.25), my = gy + 0.005 * H;
    if (mx > -100 * k && mx < W + 100 * k) {
      ctx.fillStyle = '#7a7a78'; ctx.fillRect(mx - 13 * k, my - 92 * k, 26 * k, 92 * k);
      ctx.beginPath(); ctx.moveTo(mx - 13 * k, my - 92 * k); ctx.lineTo(mx, my - 102 * k); ctx.lineTo(mx + 13 * k, my - 92 * k); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 2 * k; ctx.strokeRect(mx - 13 * k, my - 92 * k, 26 * k, 92 * k);
      ctx.fillStyle = 'rgba(80,120,60,0.55)'; ctx.fillRect(mx - 13 * k, my - 18 * k, 26 * k, 18 * k); // moss
      ctx.fillStyle = '#1a1820'; ctx.font = `800 ${Math.round(15 * k)}px "Shippori Mincho", serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ['紅', '葉', '峠'].forEach((c, i) => ctx.fillText(c, mx, my - 74 * k + i * 19 * k));
      const jx = mx + 30 * k;
      ctx.fillStyle = '#8a8a86'; ctx.beginPath(); ctx.ellipse(jx, my - 12 * k, 8 * k, 12 * k, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(jx, my - 27 * k, 6 * k, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c8302a'; ctx.beginPath(); ctx.moveTo(jx - 7 * k, my - 21 * k); ctx.lineTo(jx + 7 * k, my - 21 * k); ctx.lineTo(jx, my - 11 * k); ctx.closePath(); ctx.fill();
    }
  }

  // people and creatures of the land: farmers bent over the rice, herons, a scarecrow, dragonflies over the
  // stream and butterflies in the fields; in the pass, stone lanterns line the road and crows wait on them
  drawFieldLife(ctx, W, H, k, gy, top, pathT, pathB, sx, st) {
    const t = this.t, on = (x) => x > -60 * k && x < W + 60 * k;
    for (const [wx, row, sd] of [[-0.18, 0, 1], [0.03, 1, 2], [0.22, 0, 3], [0.45, 1, 4], [0.62, 0, 5]]) { // farmers planting rice
      const x = sx(wx), y = row ? H - 30 * k : pathT - 12 * k;
      if (on(x)) figure(ctx, x, y, 46 * k, 'farmer', t, { seed: sd, dir: sd % 2 ? 1 : -1, col: '#4a5a6a', hat: '#d8b870' });
    }
    for (const [wx, row, sd] of [[-0.05, 0, 1], [0.36, 1, 2], [0.5, 0, 3]]) { const x = sx(wx), y = row ? H - 50 * k : pathT - 20 * k; if (on(x)) heron(ctx, x, y, 1.4 * k, t, sd); }
    { const x = sx(0.13), y = pathT - 8 * k; // a scarecrow with a crow on its arm
      if (on(x)) {
        ctx.strokeStyle = '#4a3624'; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 54 * k); ctx.moveTo(x - 20 * k, y - 40 * k); ctx.lineTo(x + 20 * k, y - 40 * k); ctx.stroke();
        ctx.fillStyle = '#6a5a8a'; ctx.beginPath(); ctx.moveTo(x - 14 * k, y - 42 * k); ctx.lineTo(x + 14 * k, y - 42 * k); ctx.lineTo(x + 10 * k, y - 22 * k); ctx.lineTo(x - 10 * k, y - 22 * k); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c8a868'; ctx.beginPath(); ctx.arc(x, y - 50 * k, 6 * k, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 14 * k, y - 52 * k); ctx.quadraticCurveTo(x, y - 66 * k, x + 14 * k, y - 52 * k); ctx.closePath(); ctx.fill();
        crow(ctx, x + 18 * k, y - 41 * k, 1.2 * k, t);
      }
    }
    if (st > -200 * k && st < W + 200 * k) for (let i = 0; i < 3; i++) flitter(ctx, st + 30 * k + i * 22 * k, top + (30 + i * 40) * k, 1.6 * k, t, i * 2.7, 'dragonfly');
    for (let i = 0; i < 5; i++) { const x = sx(0.05 + i * 0.17); if (on(x)) flitter(ctx, x, gy + (i % 2 ? 0.14 : -0.01) * H, 1.4 * k, t, i * 1.9, 'butterfly', ['#fff4c8', '#f8d8e8', '#ffffff'][i % 3]); }
    // the pass: stone lanterns at the road's edge, some with a crow
    for (let i = 0; i < 6; i++) {
      const wx = 1.38 + i * 0.22, x = sx(wx), far = i % 2 === 0, y = far ? pathT - 4 * k : pathB + 34 * k;
      if (!on(x)) continue;
      stoneLantern(ctx, x, y, k * (far ? 0.9 : 1.15), t, true, '#6a6460');
      if (i % 3 === 1) crow(ctx, x, y - 50 * k * (far ? 0.9 : 1.15), 1.2 * k, t + i);
    }
  }

  // horizontal gradient whose colour follows the season at each screen x (ahead: how far ahead it turns)
  groundGrad(ctx, W, key, ahead = 0) {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 4; i++) g.addColorStop(i / 4, pal(key, this.cam + (i / 4) * (1 + ahead) + ahead * 0.5));
    return g;
  }

  drawForeground(ctx, W, H, k) {
    const p = 1.3, off = this.cam * p, sp = 0.035;
    ctx.lineWidth = 2.4 * k;
    for (let i = Math.floor(off / sp) - 1; i < (off + 1.1) / sp; i++) {
      const s = i * sp + hsh(i, 31) * sp - off, x = s * W, y = H - hsh(i, 32) * 14 * k;
      ctx.strokeStyle = pal('tuft', this.cam + s);
      for (let j = 0; j < 4; j++) {
        const h = (22 + hsh(i, 33 + j) * 26) * k, lean = (j - 1.5) * 4 * k + Math.sin(this.t * 1.6 + i + j) * 3 * k - this.gust * 12 * k;
        ctx.beginPath(); ctx.moveTo(x + j * 3 * k, y); ctx.quadraticCurveTo(x + j * 3 * k + lean * 0.3, y - h * 0.6, x + j * 3 * k + lean, y - h); ctx.stroke();
      }
    }
  }

  drawLeaves(ctx, W, H, k) {
    for (const p of this.leaves) {
      ctx.save(); ctx.translate(p.x * W, p.y * H); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(p.t * 3 + p.ph)) * 0.8 + 0.2);
      ctx.fillStyle = p.col;
      if (p.kind === 'leaf') { // a little five-pointed maple leaf
        ctx.beginPath();
        for (let j = 0; j < 10; j++) { const r = (j % 2 ? 2.2 : 5.5) * k * p.s, a = (j / 10) * TAU - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
      } else { ctx.beginPath(); ctx.ellipse(0, 0, 3.4 * k * p.s, 2.2 * k * p.s, 0, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
  }

  drawRock(ctx, x, y, k) {
    drawShadow(ctx, x, y, 70 * k, 0.3);
    ctx.fillStyle = '#6e665e';
    ctx.beginPath(); ctx.moveTo(x - 66 * k, y); ctx.lineTo(x - 54 * k, y - 46 * k); ctx.lineTo(x - 20 * k, y - 66 * k); ctx.lineTo(x + 26 * k, y - 64 * k); ctx.lineTo(x + 58 * k, y - 40 * k); ctx.lineTo(x + 70 * k, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(x - 50 * k, y - 46 * k); ctx.lineTo(x - 20 * k, y - 64 * k); ctx.lineTo(x + 24 * k, y - 62 * k); ctx.lineTo(x - 10 * k, y - 52 * k); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 2 * k; ctx.stroke();
    ctx.fillStyle = 'rgba(90,110,50,0.6)'; ctx.fillRect(x - 60 * k, y - 10 * k, 120 * k, 10 * k);
  }

  drawTengu(ctx, W, H, k, gy) {
    const T = this.tengu, x = (T.wx - this.cam) * W, ground = gy + ROCK.y * H, perch = 0;
    const z = perch + T.alt * H;
    // crows wheeling around him
    for (const c of this.crows) {
      if (c.in < 0) continue;
      const cx = c.fly ? x + c.x * W : x + Math.cos(c.ang) * c.r * 110 * k, cy = c.fly ? ground - z - 70 * k - c.y * H : ground - z - 70 * k + Math.sin(c.ang) * c.r * 40 * k + c.h * 30 * k;
      if (!c.fly) { c.x = (cx - x) / W; c.y = -(cy - (ground - z - 70 * k)) / H; }
      this.drawCrow(ctx, cx, cy, k, this.t + c.ang * 3);
    }
    const o = LOOKS.tengu({ state: T.mode === 'out' ? 'rise' : 'chase', t: 0, tDur: 1, data: {}, pose: null }, this.t);
    const s = (o.s || 1) * 2.3 * k * 0.8;
    drawShadow(ctx, x, T.alt > 0.02 ? ground : ground - perch, 22 * k * (o.s || 1) * clamp(1 - T.alt * 1.5, 0.2, 1), 0.3);
    Object.assign(o, { x, y: ground, z, facing: Math.PI, time: this.t, walk: 0, move: 0, flash: 0, alpha: 1, s, seed: 3, pose: null });
    o.flapSpeed = T.mode === 'perch' ? 5 : 18;
    drawHumanoid(ctx, o);
  }

  drawCrow(ctx, x, y, k, t) {
    const f = Math.sin(t * 14) * 7 * k;
    ctx.fillStyle = '#16141c'; ctx.strokeStyle = '#16141c'; ctx.lineWidth = 2.6 * k;
    ctx.beginPath(); ctx.moveTo(x - 11 * k, y - f); ctx.quadraticCurveTo(x - 4 * k, y - 3 * k, x, y); ctx.quadraticCurveTo(x + 4 * k, y - 3 * k, x + 11 * k, y - f); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y + 1 * k, 4.5 * k, 2.6 * k, 0, 0, TAU); ctx.fill();
  }

  // ---------------------------------------------------------------- animals (side view, facing right)
  drawAnimal(ctx, a, x, y, k) {
    const u = k * a.s * { deer: 1.9, fox: 1.7, rabbit: 1.3, sparrow: 1.5 }[a.kind], run = a.state === 'flee';
    if (a.kind !== 'sparrow' || a.alt < 0.01) drawShadow(ctx, x, y, (a.kind === 'deer' ? 20 : a.kind === 'fox' ? 14 : 6) * u, 0.22);
    ctx.save(); ctx.translate(x, y);
    if (a.kind === 'deer') this.drawDeer(ctx, a, u, run);
    else if (a.kind === 'rabbit') this.drawRabbit(ctx, a, u, run);
    else if (a.kind === 'fox') this.drawFox(ctx, a, u, run);
    else this.drawSparrow(ctx, a, u, run);
    ctx.restore();
  }

  drawDeer(ctx, a, u, run) {
    const ph = a.t * 13, bounce = run ? Math.abs(Math.sin(ph)) * 7 * u : 0;
    const by = -27 * u - bounce, body = a.fawn ? '#b8784a' : '#a8683a';
    ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 2.6 * u; ctx.lineCap = 'round';
    [-12, -8, 9, 13].forEach((lx, i) => {
      const sw = run ? Math.sin(ph + (i < 2 ? 0 : Math.PI) + i * 0.4) * 0.7 : 0;
      ctx.beginPath(); ctx.moveTo(lx * u, by + 4 * u); ctx.lineTo(lx * u + Math.sin(sw) * 12 * u, -Math.cos(sw) * 1 * u - (run ? bounce * 0.4 : 0)); ctx.stroke();
    });
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, by, 18 * u, 8.5 * u, run ? -0.08 : 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e0bc8c'; ctx.beginPath(); ctx.ellipse(0, by + 4 * u, 13 * u, 3.6 * u, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f6efe2'; ctx.beginPath(); ctx.arc(-16 * u, by - 2 * u, 3.6 * u, 0, TAU); ctx.fill();
    if (a.fawn) { ctx.fillStyle = 'rgba(255,248,232,0.85)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc((-10 + i * 4) * u, by - (2 + (i % 2) * 2.5) * u, 1.1 * u, 0, TAU); ctx.fill(); } }
    // neck and head: down to graze, up to watch (and while running)
    const hd = a.hd, hx = lerp(22, 24, hd) * u, hy = lerp(by - 20 * u, -7 * u, hd);
    ctx.strokeStyle = body; ctx.lineWidth = 7 * u;
    ctx.beginPath(); ctx.moveTo(12 * u, by - 3 * u); ctx.lineTo(hx - 3 * u, hy + 2 * u); ctx.stroke();
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(hx, hy, 7 * u, 4.2 * u, lerp(0.15, 1.1, hd), 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a1a12'; ctx.beginPath(); ctx.arc(hx + Math.cos(lerp(0.15, 1.1, hd)) * 6 * u, hy + Math.sin(lerp(0.15, 1.1, hd)) * 6 * u, 1.6 * u, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a5030'; ctx.beginPath(); ctx.ellipse(hx - 4 * u, hy - 4 * u, 4 * u, 1.8 * u, -0.9, 0, TAU); ctx.fill();
    if (a.stag) { // antlers
      ctx.strokeStyle = '#ecdcbc'; ctx.lineWidth = 1.8 * u;
      ctx.beginPath(); ctx.moveTo(hx - 2 * u, hy - 3 * u); ctx.lineTo(hx - 6 * u, hy - 16 * u); ctx.lineTo(hx - 12 * u, hy - 22 * u);
      ctx.moveTo(hx - 5 * u, hy - 12 * u); ctx.lineTo(hx + 1 * u, hy - 19 * u); ctx.moveTo(hx - 7 * u, hy - 18 * u); ctx.lineTo(hx - 4 * u, hy - 25 * u); ctx.stroke();
    }
  }

  drawRabbit(ctx, a, u, run) {
    const hop = run ? Math.abs(Math.sin(a.t * 11)) * 9 * u : Math.max(0, Math.sin(a.t * 0.9 + a.seed) - 0.85) * 20 * u;
    const c = '#8a7a66';
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, -6 * u - hop, 7.5 * u, 5 * u, -0.15, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(6.5 * u, -10 * u - hop, 3.8 * u, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4.5 * u, -17 * u - hop, 1.6 * u, 5 * u, -0.35, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6.8 * u, -17.5 * u - hop, 1.6 * u, 5 * u, -0.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f6f0e6'; ctx.beginPath(); ctx.arc(-7.5 * u, -6 * u - hop, 2.4 * u, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1414'; ctx.beginPath(); ctx.arc(8 * u, -11 * u - hop, 0.9 * u, 0, TAU); ctx.fill();
  }

  drawFox(ctx, a, u, run) {
    const ph = a.t * 14, b = run ? Math.abs(Math.sin(ph)) * 4 * u : 0;
    ctx.strokeStyle = '#3a2418'; ctx.lineWidth = 2.2 * u; ctx.lineCap = 'round';
    [-9, -5, 7, 10].forEach((lx, i) => { const sw = run ? Math.sin(ph + (i < 2 ? 0 : Math.PI)) * 0.7 : 0; ctx.beginPath(); ctx.moveTo(lx * u, -11 * u - b); ctx.lineTo(lx * u + Math.sin(sw) * 8 * u, 0); ctx.stroke(); });
    // tail: big and swishing, white tip
    const sw = Math.sin(a.t * (run ? 9 : 2)) * 0.25;
    ctx.save(); ctx.translate(-12 * u, -14 * u - b); ctx.rotate(-0.5 + sw);
    ctx.fillStyle = '#d8742a'; ctx.beginPath(); ctx.ellipse(-9 * u, 0, 11 * u, 4.8 * u, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f6efe4'; ctx.beginPath(); ctx.ellipse(-18 * u, 0, 3.6 * u, 3.2 * u, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#d8742a'; ctx.beginPath(); ctx.ellipse(0, -14 * u - b, 13 * u, 5.5 * u, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f6efe4'; ctx.beginPath(); ctx.ellipse(9 * u, -12 * u - b, 4.5 * u, 3.2 * u, 0, 0, TAU); ctx.fill();
    // head with pointed ears and snout
    const hx = 14 * u, hy = -20 * u - b;
    ctx.fillStyle = '#d8742a';
    ctx.beginPath(); ctx.ellipse(hx, hy, 5.2 * u, 4.2 * u, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx + 3 * u, hy - 1 * u); ctx.lineTo(hx + 11 * u, hy + 1.5 * u); ctx.lineTo(hx + 3 * u, hy + 3 * u); ctx.fill();
    for (const ex of [-2.5, 1.5]) { ctx.beginPath(); ctx.moveTo(hx + ex * u - 2 * u, hy - 3 * u); ctx.lineTo(hx + ex * u, hy - 10 * u); ctx.lineTo(hx + ex * u + 2.2 * u, hy - 3 * u); ctx.fill(); }
    ctx.fillStyle = '#1a1414'; ctx.beginPath(); ctx.arc(hx + 11 * u, hy + 1.5 * u, 1 * u, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(hx + 2 * u, hy - 1 * u, 0.9 * u, 0, TAU); ctx.fill();
  }

  drawSparrow(ctx, a, u, run) {
    const lift = a.alt * this.g.view.H;
    ctx.translate(0, -lift);
    if (run) { // flying off: flapping wings
      const f = Math.sin(a.t * 30) * 4 * u;
      ctx.strokeStyle = '#5a4030'; ctx.lineWidth = 1.8 * u;
      ctx.beginPath(); ctx.moveTo(-6 * u, -4 * u - f); ctx.lineTo(0, -3 * u); ctx.lineTo(6 * u, -4 * u - f); ctx.stroke();
    }
    const peck = run ? 0 : Math.max(0, Math.sin(a.t * 3 + a.seed)) * 2 * u;
    ctx.fillStyle = '#8a6040'; ctx.beginPath(); ctx.ellipse(0, -3.5 * u, 4 * u, 3 * u, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6a4630'; ctx.beginPath(); ctx.arc(3.5 * u, -6 * u + peck, 2.3 * u, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2e6d0'; ctx.beginPath(); ctx.arc(4.2 * u, -5.2 * u + peck, 1 * u, 0, TAU); ctx.fill();
  }
}

// sky birds drawn in screen space (cranes, little flocks)
Area2Cutscene.prototype.drawSkyBird = function (ctx, b, W, H, k) {
  const x = b.x * W, y = b.y * H;
  if (b.kind === 'crane') {
    const f = Math.sin(b.t * 3.2) * 12 * k * b.s, s = k * b.s;
    ctx.strokeStyle = '#f6f4ee'; ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.moveTo(x - 4 * s, y); ctx.quadraticCurveTo(x - 10 * s, y - 4 * s - f * 0.5, x - 22 * s, y - f); ctx.moveTo(x - 4 * s, y); ctx.quadraticCurveTo(x - 10 * s, y + 4 * s + f * 0.5, x - 22 * s, y + f * 0.4); ctx.stroke();
    ctx.strokeStyle = '#1a1414'; ctx.lineWidth = 3.2 * s;
    ctx.beginPath(); ctx.moveTo(x - 18 * s, y - f * 0.82); ctx.lineTo(x - 23 * s, y - f); ctx.stroke();
    ctx.fillStyle = '#f6f4ee'; ctx.beginPath(); ctx.ellipse(x, y, 9 * s, 2.6 * s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f6f4ee'; ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.moveTo(x + 8 * s, y); ctx.lineTo(x + 18 * s, y - 1 * s); ctx.stroke();
    ctx.strokeStyle = '#2a2420'; ctx.beginPath(); ctx.moveTo(x - 8 * s, y + 1 * s); ctx.lineTo(x - 20 * s, y + 3 * s); ctx.stroke();
    ctx.fillStyle = '#c8302a'; ctx.beginPath(); ctx.arc(x + 18 * s, y - 1.5 * s, 1.4 * s, 0, TAU); ctx.fill();
  } else {
    const f = Math.sin(b.t * 16) * 4 * k, d = b.vx > 0 ? 1 : -1;
    ctx.strokeStyle = 'rgba(40,34,40,0.8)'; ctx.lineWidth = 1.6 * k;
    ctx.beginPath(); ctx.moveTo(x - 6 * k * d, y - f); ctx.lineTo(x, y); ctx.lineTo(x + 6 * k * d, y - f); ctx.stroke();
  }
};

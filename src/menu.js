// Title, game-mode select (single / local co-op / host online / join online), host & join screens,
// and the weapon select for every mode (online picks are synced over the network).
import { TAU, clamp, ease } from './util.js';
import { WEAPONS, WEAPON_ORDER, PLAYER_COLORS, BOSSES, WEAPON_INFO, weaponMove } from './config.js';
import { drawStatIcon } from './staticons.js';
import { BIOMES } from './world.js';
import { drawWeapon, INK } from './rig.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { net, parseKey, inviteLink } from './net.js';
import { uiScale, text, outlinedText, FONT_SERIF, FONT_SANS, WPAL, WICON } from './ui.js';

const NW = WEAPON_ORDER.length;
const MAX_LEVEL = 33;
const levelBiome = (n) => BIOMES[n > 30 ? 3 : Math.floor((n - 1) / 10)];
const MODES = [
  { key: 'solo', name: 'Single Player', jp: '一人', desc: 'Walk the path alone' },
  { key: 'local', name: 'Local Co-op', jp: '二人', desc: 'Two players on this screen (keyboard + controller, or two controllers)' },
  { key: 'host', name: 'Host Online', jp: '招待', desc: 'Get a game key and invite a friend over the internet' },
  { key: 'join', name: 'Join Online', jp: '参加', desc: "Enter a friend's game key (or open their invite link)" },
];

// reach icon in the same round badge style as the stat icons: a target ring with a double arrow
function drawRangeIcon(ctx, x, y, size) {
  const r = size / 2, col = '#e8c470';
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(16,12,20,0.92)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, size * 0.08); ctx.beginPath(); ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, TAU); ctx.stroke();
  const k = r * 0.55;
  ctx.lineWidth = Math.max(1, size * 0.09); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-k, 0); ctx.lineTo(k, 0); ctx.stroke();
  ctx.fillStyle = col;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * (k + r * 0.12), 0); ctx.lineTo(s * (k - r * 0.25), -r * 0.3); ctx.lineTo(s * (k - r * 0.25), r * 0.3); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

const box = () => document.getElementById('netBox');
const boxInput = () => document.getElementById('netInput');

export class Menu {
  constructor(g) { this.g = g; this.notice = ''; this.reset(); }

  reset() {
    this.mode = 'title'; this.t = 0; this.modeSel = 0;
    this.play = 'solo';
    this.sel = [0, 1]; this.picks = [[], []]; this.joined = [true, false]; this.msgT = 0;
    this.copiedT = 0;
    this.startLevel = this.startLevel || (this.g.params && this.g.params.level) || 1; // kept between runs
    this.hideBox();
  }

  // ---------------------------------------------------------------- text box (join key / invite link)
  showBox(value, readOnly, placeholder, yFrac) {
    const b = box(), i = boxInput();
    if (!b) return;
    b.hidden = false; b.style.top = `${Math.round(innerHeight * yFrac)}px`;
    i.readOnly = readOnly; i.placeholder = placeholder || ''; i.value = value;
    if (!readOnly) setTimeout(() => i.focus(), 30);
  }
  hideBox() { const b = box(); if (b) b.hidden = true; const i = boxInput(); if (i) i.blur(); }

  // ---------------------------------------------------------------- online setup
  startHost() {
    this.mode = 'host'; this.t = 0; this.play = 'host';
    net.off('connected'); net.off('picks'); net.off('status');
    net.on('status', () => { if (net.status === 'waiting' && net.key) this.showBox(inviteLink(net.key), true, '', 0.62); });
    net.on('connected', () => { sfx.select(); this.enterSelect('host'); });
    net.on('picks', (m) => { this.picks[1] = m.picks.filter((k) => WEAPONS[k]).slice(0, 2); });
    net.on('disconnect', () => { if (this.mode === 'select') { this.notice = 'Your friend left.'; this.joined[1] = false; this.picks[1] = []; this.mode = 'host'; } });
    net.host();
  }

  startJoin(prefill = '') {
    this.mode = 'join'; this.t = 0; this.play = 'client';
    this.showBox(prefill, false, 'Game key (e.g. K7MQ2X) or invite link', 0.5);
    net.off('connected'); net.off('picks'); net.off('start'); net.off('status');
    net.on('connected', () => { sfx.select(); this.hideBox(); this.enterSelect('client'); });
    net.on('picks', (m) => { this.picks[0] = m.picks.filter((k) => WEAPONS[k]).slice(0, 2); });
    net.on('start', (m) => { this.hideBox(); this.g.startRun(m.sets, 'client'); });
    net.on('disconnect', () => { this.notice = 'The host left the game.'; this.reset(); });
    if (prefill) this.tryJoin(prefill);
  }

  tryJoin(text) {
    const key = parseKey(text);
    if (key.length !== 6) { this.notice = 'A game key has 6 letters/numbers.'; sfx.flip(); return; }
    this.notice = '';
    net.join(key);
  }

  enterSelect(play) {
    this.hideBox();
    this.mode = 'select'; this.t = 0; this.play = play;
    this.picks = [[], []];
    this.joined = [true, play === 'host' || play === 'client'];
    this.sel = [0, 1];
    input.coop = play === 'local';
  }

  backToModes() {
    if (this.play === 'host' || this.play === 'client') net.close();
    this.hideBox();
    this.mode = 'modes'; this.t = 0; this.play = 'solo'; input.coop = false;
  }

  // ---------------------------------------------------------------- update
  cardRects() {
    const v = this.g.view, u = uiScale(v);
    const gap = 18 * u;
    // taller cards: the art, the core stats and both attacks with their numbers
    const w = Math.min(230 * u, (v.W * 0.94 - gap * (NW - 1)) / NW), h = Math.min(400 * u, w * 1.74, v.H * 0.58);
    const total = w * NW + gap * (NW - 1);
    return WEAPON_ORDER.map((k, i) => [v.W / 2 - total / 2 + i * (w + gap), v.H * 0.47 - h / 2, w, h]);
  }
  modeRects() {
    const v = this.g.view, u = uiScale(v);
    const w = 520 * u, h = 64 * u, gap = 14 * u;
    const y0 = v.H * 0.32;
    return MODES.map((m, i) => [v.W / 2 - w / 2, y0 + i * (h + gap), w, h]);
  }
  hit(rects, mx, my) { let r = -1; rects.forEach(([x, y, w, h], i) => { if (mx > x && mx < x + w && my > y && my < y + h) r = i; }); return r; }

  ready(i) { return this.picks[i].length === 2; }
  allReady() { return this.ready(0) && (!this.joined[1] || this.ready(1)); }

  start() {
    input.eat('confirm'); input.eat('dash'); input.eat('pause'); sfx.gate();
    const sets = this.joined[1] ? [this.picks[0].slice(), this.picks[1].slice()] : [this.picks[0].slice()];
    const lv = this.startLevel || 1;
    if (this.play === 'host') { net.send('start', { sets }); this.g.startRun(sets, 'host', lv); }
    else this.g.startRun(sets, this.play === 'local' ? 'local' : 'solo', lv);
  }

  update(dt) {
    this.t += dt; this.msgT = Math.max(0, this.msgT - dt); this.copiedT = Math.max(0, this.copiedT - dt);
    const g = this.g;
    const clickNow = input.mouse.clicked;
    const mx = input.mouse.x * g.view.dpr, my = input.mouse.y * g.view.dpr;

    if (this.mode === 'title') {
      if (this.t > 0.4 && (input.pressed('confirm') || clickNow)) { this.mode = 'modes'; this.t = 0; sfx.select(); input.eat('confirm'); }
      return;
    }

    if (this.mode === 'modes') {
      const rects = this.modeRects();
      const hov = this.hit(rects, mx, my);
      if (hov >= 0 && this.lastMouse !== input.mouse.lastMove) { if (hov !== this.modeSel) sfx.move(); this.modeSel = hov; }
      this.lastMouse = input.mouse.lastMove;
      if (input.pressed('up')) { this.modeSel = (this.modeSel + MODES.length - 1) % MODES.length; sfx.move(); }
      if (input.pressed('down')) { this.modeSel = (this.modeSel + 1) % MODES.length; sfx.move(); }
      if (input.pressed('back')) { this.mode = 'title'; this.t = 0; return; }
      if (this.t > 0.2 && (input.pressed('confirm') || (clickNow && hov >= 0))) {
        input.eat('confirm'); sfx.select(); this.notice = '';
        const m = MODES[this.modeSel].key;
        if (m === 'solo') this.enterSelect('solo');
        else if (m === 'local') {
          if (input.padCount < 1) { this.notice = 'Local co-op needs a controller for player 2 (plug one in and press a button).'; sfx.flip(); return; }
          this.enterSelect('local');
        } else if (m === 'host') this.startHost();
        else this.startJoin('');
      }
      return;
    }

    if (this.mode === 'host') {
      const [bx, by, bw, bh] = this.copyRect();
      const copyClicked = clickNow && mx > bx && mx < bx + bw && my > by && my < by + bh;
      if ((copyClicked || input.pressed('confirm')) && net.key) this.copyLink();
      if (input.pressed('back') || input.pressed('pause')) { input.eat('back'); this.backToModes(); }
      return;
    }

    if (this.mode === 'join') {
      const [bx, by, bw, bh] = this.copyRect();
      const btn = clickNow && mx > bx && mx < bx + bw && my > by && my < by + bh;
      if ((input.pressed('confirm') || btn) && net.status !== 'connecting') { input.eat('confirm'); this.tryJoin(boxInput() ? boxInput().value : ''); }
      if (input.pressed('back') && document.activeElement !== boxInput()) { this.backToModes(); }
      if (input.state.pause.pressed && document.activeElement === boxInput()) { this.backToModes(); } // Escape
      return;
    }

    // ---------------- weapon select
    const rects = this.cardRects();
    const hover = this.hit(rects, mx, my);
    const online = this.play === 'host' || this.play === 'client';
    const mine = this.play === 'client' ? 1 : 0; // which pick list this machine controls
    const c1 = input.players[0];

    // local co-op: player 2 joins with their controller
    if (this.play === 'local') {
      const c2 = input.players[1];
      if (!this.joined[1]) {
        if (c2.connected && c2.pressed('confirm')) { this.joined[1] = true; this.picks[1] = []; sfx.select(); c2.eat('confirm'); }
      } else {
        if (!c2.connected) this.joined[1] = false;
        if (c2.pressed('left')) { this.sel[1] = (this.sel[1] + NW - 1) % NW; sfx.move(); }
        if (c2.pressed('right')) { this.sel[1] = (this.sel[1] + 1) % NW; sfx.move(); }
        if (c2.pressed('back')) { if (this.picks[1].length) { this.picks[1].pop(); sfx.flip(); } else { this.joined[1] = false; sfx.flip(); } }
        if (c2.pressed('confirm')) { if (this.ready(1) && this.ready(0)) { this.start(); return; } this.togglePick(1, WEAPON_ORDER[this.sel[1]]); }
      }
    }

    // this machine's own player
    if (hover >= 0 && c1.mode === 'kbm' && this.lastMouse !== input.mouse.lastMove) { if (this.sel[mine] !== hover) sfx.move(); this.sel[mine] = hover; }
    this.lastMouse = input.mouse.lastMove;
    if (c1.pressed('left')) { this.sel[mine] = (this.sel[mine] + NW - 1) % NW; sfx.move(); }
    if (c1.pressed('right')) { this.sel[mine] = (this.sel[mine] + 1) % NW; sfx.move(); }
    if (c1.pressed('back')) {
      if (this.picks[mine].length) { this.picks[mine].pop(); sfx.flip(); this.syncPicks(); }
      else this.backToModes();
      return;
    }
    // starting level (host / solo / local): up & down, or the arrows
    if (this.play !== 'client') {
      const step = (d) => { this.startLevel = ((this.startLevel - 1 + d + MAX_LEVEL) % MAX_LEVEL) + 1; sfx.move(); };
      if (c1.pressed('up')) step(1);
      if (c1.pressed('down')) step(-1);
      if (clickNow) {
        const [l, r] = this.levelArrowRects();
        const inR = (q) => mx > q[0] && mx < q[0] + q[2] && my > q[1] && my < q[1] + q[3];
        if (inR(l)) { step(-1); return; }
        if (inR(r)) { step(1); return; }
      }
    }
    const startClicked = clickNow && this.startHover(mx, my);
    if (this.play !== 'client' && this.ready(0) && (c1.pressed('confirm') || c1.pressed('pause') || startClicked)) {
      if (this.allReady()) this.start(); else { this.msgT = 2; sfx.flip(); }
      return;
    }
    if (c1.pressed('confirm') || (clickNow && hover >= 0)) {
      if (clickNow && hover >= 0) this.sel[mine] = hover;
      this.togglePick(mine, WEAPON_ORDER[this.sel[mine]]);
      input.eat('confirm');
    }
    if (online && !net.connected && this.mode === 'select') { this.notice = 'Connection lost.'; this.backToModes(); }
  }

  togglePick(i, key) {
    const idx = this.picks[i].indexOf(key);
    if (idx >= 0) { this.picks[i].splice(idx, 1); sfx.flip(); }
    else if (this.picks[i].length < 2) { this.picks[i].push(key); sfx.select(); }
    this.syncPicks();
  }
  syncPicks() {
    if (this.play === 'host') net.send('picks', { picks: this.picks[0] });
    if (this.play === 'client') net.send('picks', { picks: this.picks[1] });
  }

  copyLink() {
    const link = inviteLink(net.key);
    const done = () => { this.copiedT = 2.5; sfx.select(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, () => { this.selectLinkText(); this.copiedT = -2.5; });
    } else { this.selectLinkText(); this.copiedT = -2.5; }
  }
  selectLinkText() { const i = boxInput(); if (i) { i.focus(); i.select(); } }

  copyRect() { const v = this.g.view, u = uiScale(v); return [v.W / 2 - 170 * u, v.H * 0.74, 340 * u, 54 * u]; }
  startRect() { const v = this.g.view, u = uiScale(v); return [v.W / 2 - 160 * u, v.H * 0.88 - 26 * u, 320 * u, 52 * u]; }
  levelRect() { const v = this.g.view, u = uiScale(v); return [v.W / 2 - 230 * u, v.H * 0.785 - 22 * u, 460 * u, 44 * u]; }
  levelArrowRects() { const [x, y, w, h] = this.levelRect(); return [[x, y, h * 1.2, h], [x + w - h * 1.2, y, h * 1.2, h]]; }
  drawLevelPicker(ctx, u, pad) {
    const [x, y, w, h] = this.levelRect(), n = this.startLevel || 1, B = levelBiome(n), boss = BOSSES[n];
    ctx.fillStyle = 'rgba(24,18,30,0.88)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = n > 1 ? '#e8c470' : 'rgba(232,196,112,0.45)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    for (const [ax, ay, aw, ah] of this.levelArrowRects()) { ctx.fillStyle = 'rgba(200,48,46,0.85)'; ctx.fillRect(ax + 4 * u, ay + 4 * u, aw - 8 * u, ah - 8 * u); }
    const [[lx, , lw], [rx, , rw]] = this.levelArrowRects();
    text(ctx, '◀', lx + lw / 2, y + h / 2, 16 * u, '#fff4d8', 800);
    text(ctx, '▶', rx + rw / 2, y + h / 2, 16 * u, '#fff4d8', 800);
    text(ctx, `Start at level ${n}`, x + w / 2, y + h * 0.36, 17 * u, '#fff8e8', 800, FONT_SERIF);
    text(ctx, `${B.jp} · ${B.name}${boss ? ` · boss: ${boss.name}` : ''}${n === 1 ? ' · with the story intro' : ''}`, x + w / 2, y + h * 0.75, 11 * u, 'rgba(248,240,222,0.75)', 700);
    text(ctx, pad ? '▲▼ change level' : '↑↓ / W S change level', x + w / 2, y + h + 12 * u, 11 * u, 'rgba(248,240,222,0.55)', 700);
  }
  startHover(mx, my) { const [x, y, w, h] = this.startRect(); return mx > x && mx < x + w && my > y && my < y + h; }

  // ---------------------------------------------------------------- draw
  button(ctx, rect, label, u, active = true, pulse = 0) {
    const [x, y, w, h] = rect;
    ctx.fillStyle = active ? `rgba(200,48,46,${0.85 + 0.15 * pulse})` : 'rgba(80,60,60,0.8)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#f4d690'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    text(ctx, label, x + w / 2, y + h / 2, 18 * u, '#fff8e8', 800);
  }

  draw(ctx) {
    const g = this.g, v = g.view, u = uiScale(v), t = this.t, rt = g.realTime;
    if (this.mode === 'title') return this.drawTitle(ctx, v, u, t, rt);
    ctx.fillStyle = 'rgba(10,8,16,0.62)'; ctx.fillRect(0, 0, v.W, v.H);
    const pad = input.players[0].mode === 'pad';

    if (this.mode === 'modes') {
      outlinedText(ctx, '影の道', v.W / 2, v.H * 0.12, 54 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6);
      text(ctx, 'Choose how to play', v.W / 2, v.H * 0.21, 18 * u, 'rgba(248,240,222,0.85)', 700);
      this.modeRects().forEach(([x, y, w, h], i) => {
        const m = MODES[i], sel = i === this.modeSel;
        ctx.fillStyle = sel ? 'rgba(200,48,46,0.9)' : 'rgba(24,18,30,0.85)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = sel ? '#f4d690' : 'rgba(232,196,112,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
        text(ctx, m.jp, x + 40 * u, y + h / 2, 24 * u, sel ? '#fff4d8' : '#e8c470', 800, FONT_SERIF);
        text(ctx, m.name, x + 80 * u, y + h * 0.38, 20 * u, '#fff8e8', 800, FONT_SERIF, 'left');
        text(ctx, m.desc, x + 80 * u, y + h * 0.72, 12 * u, 'rgba(248,240,222,0.8)', 700, FONT_SANS, 'left');
      });
      if (this.notice) outlinedText(ctx, this.notice, v.W / 2, v.H * 0.86, 16 * u, '#ffd0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
      text(ctx, pad ? '▲▼ choose · Ⓐ select · Ⓑ back' : '↑↓ or mouse to choose · Enter / click to select · Esc back', v.W / 2, v.H - 22 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
      return;
    }

    if (this.mode === 'host') {
      outlinedText(ctx, 'Host Online', v.W / 2, v.H * 0.13, 40 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6);
      const st = net.status;
      if (st === 'error') {
        outlinedText(ctx, net.error || 'Something went wrong.', v.W / 2, v.H * 0.4, 18 * u, '#ffb0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
      } else if (!net.key || st === 'starting') {
        text(ctx, 'Creating your game…', v.W / 2, v.H * 0.4, 20 * u, '#f8f0de', 800);
      } else {
        text(ctx, 'Your game key', v.W / 2, v.H * 0.28, 16 * u, 'rgba(248,240,222,0.8)', 700);
        // key tiles
        const k = net.key, tw = 64 * u, gap = 10 * u, x0 = v.W / 2 - (6 * tw + 5 * gap) / 2;
        for (let i = 0; i < 6; i++) {
          const x = x0 + i * (tw + gap), y = v.H * 0.33;
          ctx.fillStyle = 'rgba(30,22,38,0.92)'; ctx.fillRect(x, y, tw, tw * 1.15);
          ctx.strokeStyle = '#e8c470'; ctx.lineWidth = 2; ctx.strokeRect(x, y, tw, tw * 1.15);
          text(ctx, k[i], x + tw / 2, y + tw * 0.6, 40 * u, '#fff4d8', 800);
        }
        text(ctx, 'Invite link (send this to your friend):', v.W / 2, v.H * 0.585, 14 * u, 'rgba(248,240,222,0.8)', 700);
        const msg = this.copiedT > 0 ? '✓ Link copied!' : this.copiedT < 0 ? 'Press Ctrl+C to copy the selected link' : (pad ? 'Ⓐ  Copy invite link' : 'Copy invite link');
        this.button(ctx, this.copyRect(), msg, u, true, Math.sin(rt * 4) * 0.5);
        const dots = '.'.repeat(1 + Math.floor(rt * 2) % 3);
        text(ctx, `Waiting for your friend to join${dots}`, v.W / 2, v.H * 0.88, 16 * u, '#8fd0ff', 800);
      }
      if (this.notice) outlinedText(ctx, this.notice, v.W / 2, v.H * 0.22, 15 * u, '#ffd0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
      text(ctx, pad ? 'Ⓑ back' : 'Esc back', v.W / 2, v.H - 22 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
      return;
    }

    if (this.mode === 'join') {
      outlinedText(ctx, 'Join Online', v.W / 2, v.H * 0.16, 40 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6);
      text(ctx, "Type your friend's game key, or paste their invite link:", v.W / 2, v.H * 0.42, 15 * u, 'rgba(248,240,222,0.85)', 700);
      const st = net.status;
      const label = st === 'connecting' ? 'Connecting…' : 'Connect';
      this.button(ctx, this.copyRect(), label, u, st !== 'connecting');
      if (st === 'error') outlinedText(ctx, net.error, v.W / 2, v.H * 0.66, 15 * u, '#ffb0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
      if (this.notice) outlinedText(ctx, this.notice, v.W / 2, v.H * 0.66, 15 * u, '#ffd0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
      text(ctx, 'Enter connect · Esc back', v.W / 2, v.H - 22 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
      return;
    }

    this.drawSelect(ctx, v, u, rt, pad);
  }

  drawTitle(ctx, v, u, t, rt) {
    const g = this.g;
    const a = clamp(t / 0.8, 0, 1);
    ctx.fillStyle = `rgba(10,8,16,${0.35 * a})`; ctx.fillRect(0, 0, v.W, v.H);
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(200,40,40,0.85)'; ctx.lineWidth = 16 * u; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(v.W / 2, v.H * 0.38, 150 * u, -1.2, -1.2 + TAU * 0.9 * ease.outCubic(clamp(t / 1.2, 0, 1))); ctx.stroke();
    outlinedText(ctx, '影の道', v.W / 2, v.H * 0.36, 120 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 10 * u);
    outlinedText(ctx, 'KAGE NO MICHI', v.W / 2, v.H * 0.52, 34 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6 * u);
    text(ctx, 'Path of Shadows  ·  a ninja roguelike in 33 levels  ·  solo, local or online co-op', v.W / 2, v.H * 0.58, 16 * u, 'rgba(248,240,222,0.9)', 700);
    ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(rt * 3));
    outlinedText(ctx, input.pad.connected ? 'Press Ⓐ to begin' : 'Press Enter or click to begin', v.W / 2, v.H * 0.72, 22 * u, '#ffe7a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 5);
    ctx.globalAlpha = a;
    if (g.best > 0) text(ctx, `Best: reached level ${g.best}`, v.W / 2, v.H * 0.78, 14 * u, 'rgba(248,240,222,0.8)', 700);
    if (this.notice) outlinedText(ctx, this.notice, v.W / 2, v.H * 0.84, 16 * u, '#ffd0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
    text(ctx, input.padCount > 1 ? `${input.padCount} controllers connected` : input.pad.connected ? `Controller: ${input.pad.id.slice(0, 48)}` : 'Xbox 360 controllers supported — press a button on one to connect', v.W / 2, v.H - 28 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
    ctx.restore();
  }

  drawSelect(ctx, v, u, rt, pad1) {
    const coop = this.joined[1];
    const online = this.play === 'host' || this.play === 'client';
    const mine = this.play === 'client' ? 1 : 0;
    outlinedText(ctx, coop ? 'Choose your weapons' : 'Choose two weapons', v.W / 2, v.H * 0.09, 38 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6);
    text(ctx, `First pick → ${pad1 ? 'LB / LT' : 'Q / E'}     Second pick → ${pad1 ? 'RB / RT' : 'Left / Right mouse'}`, v.W / 2, v.H * 0.09 + 36 * u, 15 * u, 'rgba(248,240,222,0.85)', 700);
    if (online) text(ctx, this.play === 'host' ? `Online · key ${net.key} · your friend is Player 2` : 'Online · you are Player 2', v.W / 2, v.H * 0.2, 14 * u, '#8fd0ff', 800);
    const rects = this.cardRects();
    WEAPON_ORDER.forEach((key, i) => {
      const [x, y, w, h] = rects[i];
      const W = WEAPONS[key];
      // online: only show this machine's cursor; local: both
      const sel0 = (online ? mine === 0 : true) && i === this.sel[0];
      const sel1 = coop && (online ? mine === 1 : true) && i === this.sel[1];
      const lift = sel0 || sel1 ? -10 * u : 0;
      const ws = w / (230 * u);
      ctx.save(); ctx.translate(0, lift);
      ctx.shadowColor = sel0 || sel1 ? 'rgba(255,210,120,0.6)' : 'rgba(0,0,0,0.5)'; ctx.shadowBlur = sel0 || sel1 ? 30 : 12;
      ctx.fillStyle = '#eee3cc'; ctx.fillRect(x, y, w, h);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      if (sel0) { ctx.strokeStyle = coop ? PLAYER_COLORS[0] : '#e8c470'; ctx.lineWidth = 4; ctx.strokeRect(x - 4, y - 4, w + 8, h + 8); }
      if (sel1) { ctx.strokeStyle = PLAYER_COLORS[1]; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 9, y - 9, w + 18, h + 18); ctx.setLineDash([]); }
      const AH = h * 0.32; // art panel height
      const ag = ctx.createLinearGradient(0, y, 0, y + AH);
      ag.addColorStop(0, '#3a2a40'); ag.addColorStop(1, '#151020');
      ctx.fillStyle = ag; ctx.fillRect(x + 10 * u, y + 10 * u, w - 20 * u, AH);
      ctx.fillStyle = 'rgba(200,48,46,0.85)'; ctx.beginPath(); ctx.arc(x + w / 2, y + 10 * u + AH / 2, AH * 0.36, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(x + w / 2, y + 10 * u + AH / 2);
      const k = WICON[key];
      const sc = (k === 'kunai' ? 3.2 : k === 'nodachi' ? 1.85 : k === 'crossbow' ? 2.6 : k === 'staff' || k === 'bo' ? 1.5 : 2.2) * u * ws * (AH / (h * 0.4)) * 1.1;
      ctx.scale(sc, sc); ctx.rotate(Math.sin(rt * 1.5 + i) * 0.05);
      if (key === 'katanas') { drawWeapon(ctx, 'katana', -12, 8, -0.6, WPAL); drawWeapon(ctx, 'katana', -12, -8, 0.6, WPAL); }
      else if (key === 'knives') { for (let j = -1; j <= 1; j++) drawWeapon(ctx, 'kunai', -4, j * 6, j * 0.3, WPAL); }
      else if (key === 'staff') drawWeapon(ctx, 'staff', -8, 0, -0.9, WPAL);
      else if (key === 'bo') drawWeapon(ctx, 'bo', -4, 4, -0.7, WPAL);
      else if (k === 'nodachi') drawWeapon(ctx, k, -16 * Math.cos(-0.55), 1 - 16 * Math.sin(-0.55), -0.55, WPAL); // hand placed so the blade's middle sits on the centre
      else drawWeapon(ctx, k, -5, 0, 0, WPAL, 0.7);
      ctx.restore();
      text(ctx, W.jp, x + w - 14 * u, y + 26 * u, 16 * u, '#f4e6c8', 800, FONT_SERIF, 'right');
      const ty = y + 10 * u + AH + 22 * u;
      text(ctx, W.name, x + w / 2, ty, 20 * u * Math.min(1, ws * 1.05), INK, 800, FONT_SERIF);
      text(ctx, W.desc, x + w / 2, ty + 19 * u, 11 * u, '#4a3a30', 700);
      [['Speed', W.rating.speed], ['Damage', W.rating.damage], ['Range', W.rating.range]].forEach(([name, val], j) => {
        const by = ty + 40 * u + j * 16 * u;
        text(ctx, name, x + 14 * u, by, 11 * u, '#4a3a30', 700, FONT_SANS, 'left');
        const bw = (w - 84 * u) / 5;
        for (let s = 0; s < 5; s++) { ctx.fillStyle = s < val ? '#c8302e' : 'rgba(40,30,30,0.18)'; ctx.fillRect(x + 70 * u + s * bw, by - 5 * u, bw - 4 * u, 10 * u); }
      });
      // both attacks: name, a short description, and damage / cooldown / reach / ki as icons with numbers
      const I = WEAPON_INFO[key];
      [[W.basic, I.basic, false], [W.special, I.special, true]].forEach(([def, info, special], j) => {
        const ay = ty + 92 * u + j * 50 * u;
        ctx.fillStyle = special ? 'rgba(63,150,170,0.14)' : 'rgba(200,150,60,0.14)'; ctx.fillRect(x + 8 * u, ay - 9 * u, w - 16 * u, 47 * u);
        text(ctx, special ? 'SPECIAL' : 'BASIC', x + 13 * u, ay, 8.5 * u, special ? '#2a7a8a' : '#9a6a20', 800, FONT_SANS, 'left');
        text(ctx, def.name, x + (special ? 60 : 47) * u, ay, 12.5 * u, '#2a2030', 800, FONT_SERIF, 'left');
        text(ctx, info.desc, x + 13 * u, ay + 13 * u, 9.5 * u, '#5a4a40', 700, FONT_SANS, 'left');
        const dmg = info.heal ? `+${def.heal}` : info.hits ? `${def.dmg}×${info.hits}` : `${def.dmg}`;
        const cd = `${(special ? def.cd : def.interval).toFixed(2).replace(/0$/, '')}s`;
        const chips = [[info.heal ? 'healthRegen' : 'baseDamage', dmg], ['dashCooldown', cd], ['range', `${info.reach}`], ['energyRegen', `${special ? def.cost : 0}`]];
        // lay the four chips out by their measured width, shrinking the text if the card is narrow
        const avail = w - 22 * u, cy = ay + 29 * u;
        let fs = 11 * u, is = 14 * u, widths;
        for (;;) {
          ctx.font = `800 ${fs}px ${FONT_SANS}`;
          widths = chips.map(([, str]) => is + 3 * u + ctx.measureText(str).width);
          if (widths.reduce((a, b) => a + b, 0) + 9 * u <= avail || fs < 7.5 * u) break;
          fs -= 0.5 * u; is = Math.max(11 * u, is - 0.5 * u);
        }
        const gapC = (avail - widths.reduce((a, b) => a + b, 0)) / 3;
        let cx = x + 11 * u;
        chips.forEach(([icon, str], c) => {
          if (icon === 'range') drawRangeIcon(ctx, cx + is / 2, cy, is); else drawStatIcon(ctx, icon, cx + is / 2, cy, is);
          text(ctx, str, cx + is + 3 * u, cy + 1, fs, '#2a2030', 800, FONT_SANS, 'left');
          cx += widths[c] + gapC;
        });
      });
      const badges = [];
      [0, 1].forEach((pi) => { const at = this.picks[pi].indexOf(key); if (at >= 0 && (pi === 0 || coop)) badges.push([pi, at]); });
      badges.forEach(([pi, at], bi) => {
        const bw = Math.min(100 * u, w / badges.length - 6 * u), bx = x + w / 2 - (badges.length * (bw + 6 * u)) / 2 + bi * (bw + 6 * u);
        ctx.fillStyle = coop ? PLAYER_COLORS[pi] : '#c8302e'; ctx.fillRect(bx, y + h - 16 * u, bw, 28 * u);
        const lbl = at === 0 ? 'L' : 'R';
        text(ctx, coop ? `P${pi + 1} · ${lbl}` : (at === 0 ? (pad1 ? 'LB / LT' : 'Q / E') : (pad1 ? 'RB / RT' : 'L / R mouse')), bx + bw / 2, y + h - 2 * u, 12 * u, '#fff', 800);
      });
      ctx.restore();
    });
    // footer
    if (this.play !== 'client') this.drawLevelPicker(ctx, u, pad1);
    if (this.play === 'client') {
      const msg = this.ready(1) ? (this.ready(0) ? 'Waiting for the host to start…' : 'Waiting for the host to choose…') : (pad1 ? 'Ⓐ select · Ⓑ undo' : 'Enter / click to select · Backspace to undo');
      text(ctx, msg, v.W / 2, v.H * 0.88, 16 * u, this.ready(1) ? '#8fd0ff' : 'rgba(248,240,222,0.8)', 800);
    } else if (this.ready(0)) {
      const ok = this.allReady();
      this.button(ctx, this.startRect(), ok ? (pad1 ? 'Ⓐ  Begin the journey' : 'Enter — Begin the journey') : 'Waiting for Player 2…', u, ok, Math.sin(rt * 5));
    } else {
      text(ctx, pad1 ? 'Ⓐ select · Ⓑ undo' : 'Enter / click to select · Backspace to undo', v.W / 2, v.H * 0.88, 14 * u, 'rgba(248,240,222,0.8)', 700);
    }
    if (this.play === 'local') {
      if (!this.joined[1]) outlinedText(ctx, input.padCount > 1 ? 'Player 2: press Ⓐ on the second controller to join' : 'Player 2: press Ⓐ on the controller to join (player 1 uses keyboard + mouse)', v.W / 2, v.H * 0.2, 16 * u, '#8fd0ff', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
      else text(ctx, 'Player 2 joined — Ⓑ on their controller to leave', v.W / 2, v.H * 0.2, 14 * u, '#8fd0ff', 700);
    }
    if (this.msgT > 0) outlinedText(ctx, 'Player 2 still has to pick two weapons', v.W / 2, v.H * 0.82, 16 * u, '#ffd0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
    text(ctx, pad1 ? 'Left stick move · Right stick aim · A dash · Start pause' : 'WASD move · Mouse aim · Space dash · Esc pause', v.W / 2, v.H - 22 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
  }
}

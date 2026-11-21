// Title, game-mode select (single / local co-op / host online / join online), host & join screens,
// and the weapon select for every mode (online picks are synced over the network).
import { TAU, clamp, lerp, ease } from './util.js';
import { WEAPONS, WEAPON_ORDER, PLAYER_COLORS, BOSSES, WEAPON_INFO, weaponMove, LOCKED_WEAPONS } from './config.js';
import { drawStatIcon } from './staticons.js';
import { BIOMES } from './world.js';
import { drawWeapon, INK } from './rig.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { net, parseKey, inviteLink, KEY_LEN } from './net.js';
import { uiScale, text, outlinedText, FONT_SERIF, FONT_SANS, WPAL, WICON, weaponIcon, weaponIconBox, attackKeys, drawFaceButton } from './ui.js';
import { CardGallery } from './gallery.js';
import { Bestiary } from './bestiary.js';
import { ARTS, ART_SLOTS, artPlain } from './arts.js';
import { drawPadButton, padButtonWidth } from './padicons.js';
import { EquipSelect } from './equipselect.js';
import { DiffSelect } from './diffselect.js';

// a button for an ability header: a controller shoulder button, or a key cap; returns its width
function abilityButton(ctx, label, x, cy, h, pad, draw = true) {
  if (pad && label.length === 1) { if (draw) drawFaceButton(ctx, label, x + h / 2, cy, h / 2); return h; } // X / Y / B
  if (pad) { const w = padButtonWidth(label, h); if (draw) drawPadButton(ctx, label, x + w / 2, cy, h); return w; }
  ctx.font = `800 ${Math.round(h * 0.58)}px ${FONT_SANS}`;
  const w = Math.max(h, ctx.measureText(label).width + h * 0.6);
  if (draw) {
    ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.roundRect(x, cy - h / 2, w, h, h * 0.22); ctx.fill();
    ctx.strokeStyle = '#2a1e16'; ctx.lineWidth = Math.max(1, h * 0.08); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + h * 0.12, cy + h * 0.28, w - h * 0.24, h * 0.1);
    ctx.fillStyle = '#2a1e16'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + w / 2, cy + 0.5);
  }
  return w;
}

// an ability's four numbers on its weapon card: damage (or heal), cooldown, reach, ki cost.
// A stored-and-released attack (Shishi Shield's Bulwark) and a reflect both read "n× ↺" / "n ↺".
// The bo shows its cooldown from no combo to full combo (0.42s>0.22s), the heavy sword its cleave from a tap to a
// full charge (14>42).
const secs = (v) => `${v.toFixed(2).replace(/0$/, '')}s`;
function abilityStats(def, info, special) {
  let dmg = info.heal ? `+${def.heal}` : info.store ? `${def.releaseMul}× ↺` : info.hits ? `${def.dmg}×${info.hits}` : info.reflect ? `${def.dmg} ↺` : def.dmg == null ? '-' : `${def.dmg}`;
  if (!special && def.chargeDmg) dmg = `${def.dmg}>${Math.round(def.dmg * (1 + def.chargeDmg))}`;
  const cd = !special && def.comboCd ? `${secs(def.comboCd[0])}>${secs(def.comboCd[def.comboCd.length - 1])}` : secs(special ? def.cd : (def.interval ?? def.cd));
  return [[info.heal ? 'healthRegen' : 'baseDamage', dmg], ['cooldownMul', cd], ['range', `${info.reach}`], ['kiCost', `${def.cost || 0}`]];
}

const NW = WEAPON_ORDER.length;
const MAX_LEVEL = 33;
const levelBiome = (n) => BIOMES[n > 30 ? 3 : Math.floor((n - 1) / 10)];
// the main menu after the title screen
const MAIN = [
  { key: 'start', name: 'Start Game', jp: '開始', desc: 'Single player, local co-op or online' },
  { key: 'training', name: 'Training', jp: '稽古', desc: 'Try weapons and techniques on a training dummy' },
  { key: 'cards', name: 'All Cards', jp: '札', desc: 'Look through every card in the game' },
  { key: 'enemies', name: 'Enemies', jp: '鬼', desc: 'Every enemy you can meet, area by area' },
];
const MODES = [
  { key: 'solo', name: 'Single Player', jp: '一人', desc: 'Walk the path alone' },
  { key: 'local', name: 'Local Co-op', jp: '二人', desc: 'Two players on this screen (keyboard + controller, or two controllers)' },
  { key: 'host', name: 'Host Online', jp: '招待', desc: 'Get a game key and invite a friend over the internet' },
  { key: 'join', name: 'Join Online', jp: '参加', desc: "Enter a friend's game key (or open their invite link)" },
];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

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
  constructor(g) { this.g = g; this.notice = ''; this.gallery = new CardGallery(g); this.bestiary = new Bestiary(g); this.equip = new EquipSelect(this); this.diff = new DiffSelect(this); this.mainSel = 0; this.reset(); }

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
    net.off('status');
    net.on('status', () => { if (net.status === 'waiting' && net.key && this.g.state === 'title') this.showBox(inviteLink(net.key), true, '', 0.62); });
    this.listenHost();
    net.host();
  }
  // the host's weapon-select messages (also set up again when a finished run brings the pair back here)
  listenHost() {
    net.off('picks'); net.off('disconnect'); net.off('connected');
    net.on('connected', () => { sfx.select(); this.enterSelect('host'); });
    net.on('picks', (m) => { this.picks[1] = m.picks.filter((k) => WEAPONS[k]).slice(0, 1); });
    net.off('equip'); net.on('equip', (m) => { if (this.mode === 'equip') this.equip.onRemote(m); });
    net.off('cursor'); net.on('cursor', (m) => { this.remoteSel = clamp(m.i | 0, 0, NW - 1); });
    net.on('disconnect', () => { if (this.mode === 'select' || this.mode === 'equip') { this.notice = 'Your friend left.'; this.joined[1] = false; this.picks[1] = []; this.mode = 'host'; } });
  }
  listenClient() {
    net.off('picks'); net.off('start'); net.off('disconnect'); net.off('rejoin');
    net.on('picks', (m) => { this.picks[0] = m.picks.filter((k) => WEAPONS[k]).slice(0, 1); });
    net.off('equip'); net.on('equip', (m) => { if (this.mode === 'equip') this.equip.onRemote(m); });
    net.off('equipOpen'); net.on('equipOpen', () => { if (this.mode === 'select') this.enterEquip(); });
    net.off('equipBack'); net.on('equipBack', () => { if (this.mode === 'equip') { this.mode = 'select'; this.t = 0; } });
    net.off('cursor'); net.on('cursor', (m) => { this.remoteSel = clamp(m.i | 0, 0, NW - 1); });
    net.on('start', (m) => { this.hideBox(); this.g.startRun(m.sets, 'client', null, m.equips || [], m.diff || 'normal'); });
    net.on('rejoin', (m) => { this.hideBox(); this.g.rejoinRun(m); }); // the host is mid-run: straight back in
    net.on('disconnect', () => { this.notice = 'The host left the game.'; this.reset(); });
  }
  // after an online run: straight back to the weapon select with the same partner
  reenterOnline(play) {
    if (play === 'host') this.listenHost(); else this.listenClient();
    this.enterSelect(play);
  }

  startJoin(prefill = '') {
    this.mode = 'join'; this.t = 0; this.play = 'client';
    this.showBox(prefill, false, 'Game key (e.g. K7) or invite link', 0.5);
    net.off('connected'); net.off('status');
    net.on('connected', () => { sfx.select(); this.hideBox(); this.enterSelect('client'); });
    this.listenClient();
    if (prefill) this.tryJoin(prefill);
  }

  tryJoin(text) {
    const key = parseKey(text);
    if (key.length !== KEY_LEN) { this.notice = `A game code has ${KEY_LEN} letters/numbers.`; sfx.flip(); return; }
    this.notice = '';
    net.join(key);
  }

  enterSelect(play) {
    this.hideBox();
    this.mode = 'select'; this.t = 0; this.play = play;
    this.picks = [[], []];
    this.joined = [true, play === 'host' || play === 'client'];
    this.sel = [0, 1];
    this.focus = play === 'client' ? 1 : 0; this.carPos = null; // the carousel starts on this machine's cursor
    this.levelOpen = false;
    input.coop = play === 'local';
  }

  backToModes() {
    if (this.play === 'host' || this.play === 'client') net.close();
    this.hideBox();
    if (this.play === 'training') { this.mode = 'main'; this.t = 0; this.play = 'solo'; input.coop = false; return; }
    this.mode = 'modes'; this.t = 0; this.play = 'solo'; input.coop = false;
  }

  // ---------------------------------------------------------------- update
  // Weapon select is a carousel: the weapon in focus stands big in the middle, the others recede to
  // both sides (smaller, fainter, blurred) and wrap around. carPos glides toward the focused index.
  // Returns per weapon: the card's base size (w, h), where its centre is drawn (cx, cy), its scale s,
  // alpha a, offset d from the middle, and its on-screen rect for clicks.
  carousel() {
    const v = this.g.view, u = uiScale(v);
    const w = 280 * u, h = 516 * u;
    const s0 = clamp(Math.min((v.H * 0.74) / h, (v.W * 0.42) / w), 0.6, 1.6); // the middle card
    const cy0 = v.H * 0.525, pos = this.carPos ?? this.sel[this.focus || 0];
    return WEAPON_ORDER.map((k, i) => {
      let d = i - pos; d -= NW * Math.round(d / NW); // shortest way round
      const ad = Math.abs(d), sg = Math.sign(d), near = Math.min(ad, 1), far = Math.max(0, ad - 1);
      const s = s0 * (1 - 0.3 * near - 0.09 * far);
      const cx = v.W / 2 + sg * (w * s0 * 0.5 + w * s0 * 0.66 * near + w * s0 * 0.5 * far) * Math.min(1, ad * 1.6); // (spread wide)
      const cy = cy0 - (6 * near + 6 * far) * u;
      // only two cards each side: the third fades out as it slides away
      const a = (ad < 0.5 ? lerp(1, 0.78, ad * 2) : Math.max(0, 0.78 - (ad - 0.5) * 0.15)) * clamp((2.5 - ad) / 0.5, 0, 1);
      const sw = w * s, sh = h * s;
      return { i, w, h, cx, cy, s, a, d, ad, rect: [cx - sw / 2, cy - sh / 2, sw, sh] };
    });
  }
  cardRects() { return this.carousel().map((c) => c.rect); }
  // the card under the mouse: the one nearest the middle wins where they overlap
  carouselHit(mx, my) {
    let best = -1, bd = 1e9;
    for (const c of this.carousel()) { const [x, y, w, h] = c.rect; if (c.a > 0.05 && mx > x && mx < x + w && my > y && my < y + h && c.ad < bd) { bd = c.ad; best = c.i; } }
    return best;
  }
  // scroll player pi's cursor by one weapon (the carousel follows whoever moved last)
  stepSel(pi, dir) { this.sel[pi] = (this.sel[pi] + NW + dir) % NW; this.focus = pi; sfx.move(); this.syncCursor(pi); }
  // online: tell the partner which weapon our cursor is on
  syncCursor(pi) { if ((this.play === 'host' && pi === 0) || (this.play === 'client' && pi === 1)) net.send('cursor', { i: this.sel[pi] }); }
  modeRects() {
    const v = this.g.view, u = uiScale(v);
    const w = 520 * u, h = 64 * u, gap = 14 * u;
    const y0 = v.H * 0.32;
    return MODES.map((m, i) => [v.W / 2 - w / 2, y0 + i * (h + gap), w, h]);
  }
  mainRects() {
    const v = this.g.view, u = uiScale(v);
    const w = 520 * u, h = 70 * u, gap = 16 * u, y0 = v.H * 0.36;
    return MAIN.map((m, i) => [v.W / 2 - w / 2, y0 + i * (h + gap), w, h]);
  }
  hit(rects, mx, my) { let r = -1; rects.forEach(([x, y, w, h], i) => { if (mx > x && mx < x + w && my > y && my < y + h) r = i; }); return r; }

  ready(i) { return this.picks[i].length === 1; } // (one weapon per run)
  allReady() { return this.ready(0) && (!this.joined[1] || this.ready(1)); }

  // after the weapons: the equipment sets (training goes straight on to its techniques)
  enterEquip() {
    if (this.play === 'training') { this.start(); return; }
    input.eat('confirm'); input.eat('pause');
    this.mode = 'equip'; this.t = 0; this.equip.open(); sfx.select();
    if (this.play === 'host') net.send('equipOpen', {});
  }

  start(equips = [], diff = 'normal') {
    if (this.play === 'training') { this.enterArts(); return; } // training: pick techniques next
    input.eat('confirm'); input.eat('dash'); input.eat('pause'); sfx.gate();
    const sets = this.joined[1] ? [this.picks[0].slice(), this.picks[1].slice()] : [this.picks[0].slice()];
    const lv = this.startLevel || 1;
    if (this.play === 'host') { net.send('start', { sets, equips, diff }); this.g.startRun(sets, 'host', lv, equips, diff); }
    else this.g.startRun(sets, this.play === 'local' ? 'local' : 'solo', lv, equips, diff);
  }

  update(dt) {
    this.t += dt; this.msgT = Math.max(0, this.msgT - dt); this.copiedT = Math.max(0, this.copiedT - dt);
    const g = this.g;
    const clickNow = input.mouse.clicked;
    const mx = input.mouse.x * g.view.dpr, my = input.mouse.y * g.view.dpr;

    if (this.mode === 'title') {
      if (this.t > 0.4 && (input.pressed('confirm') || clickNow)) { this.mode = 'main'; this.t = 0; sfx.select(); input.eat('confirm'); }
      return;
    }

    if (this.mode === 'main') {
      const rects = this.mainRects(), hov = this.hit(rects, mx, my);
      if (hov >= 0 && this.lastMouse !== input.mouse.lastMove) { if (hov !== this.mainSel) sfx.move(); this.mainSel = hov; }
      this.lastMouse = input.mouse.lastMove;
      if (input.pressed('up')) { this.mainSel = (this.mainSel + MAIN.length - 1) % MAIN.length; sfx.move(); }
      if (input.pressed('down')) { this.mainSel = (this.mainSel + 1) % MAIN.length; sfx.move(); }
      if (input.pressed('back')) { this.mode = 'title'; this.t = 0; return; }
      if (this.t > 0.2 && (input.pressed('confirm') || (clickNow && hov >= 0))) {
        input.eat('confirm'); sfx.select(); this.notice = '';
        if (MAIN[this.mainSel].key === 'start') { this.mode = 'modes'; this.t = 0; }
        else if (MAIN[this.mainSel].key === 'training') this.enterSelect('training');
        else if (MAIN[this.mainSel].key === 'enemies') { this.mode = 'enemies'; this.t = 0; this.bestiary.open(); }
        else { this.mode = 'cards'; this.t = 0; this.gallery.open(); }
      }
      return;
    }

    if (this.mode === 'cards') {
      if (this.gallery.update(dt) === 'back') { this.mode = 'main'; this.t = 0; }
      return;
    }
    if (this.mode === 'enemies') {
      if (this.bestiary.update(dt) === 'back') { this.mode = 'main'; this.t = 0; }
      return;
    }

    if (this.mode === 'arts') { this.updateArts(clickNow, mx, my); return; }
    if (this.mode === 'equip') {
      const r = this.equip.update(dt, clickNow, mx, my);
      if (r === 'back') { this.mode = 'select'; this.t = 0; sfx.flip(); if (this.play === 'host') net.send('equipBack', {}); }
      else if (r === 'start') { // then the difficulty (the host / player 1 chooses; training skips it)
        if (this.play === 'training' || this.play === 'client') this.start(this.equip.equips());
        else { this.pendingEquips = this.equip.equips(); this.mode = 'difficulty'; this.t = 0; this.diff.open(); sfx.select(); }
      }
      if ((this.play === 'host' || this.play === 'client') && !net.connected) { this.notice = 'Connection lost.'; this.backToModes(); }
      return;
    }
    if (this.mode === 'difficulty') {
      const r = this.diff.update(dt, clickNow, mx, my);
      if (r === 'back') { this.mode = 'equip'; this.t = 0; this.equip.locked = [false, false]; sfx.flip(); }
      else if (r === 'start') this.start(this.pendingEquips || this.equip.equips(), this.diff.key);
      if (this.play === 'host' && !net.connected) { this.notice = 'Connection lost.'; this.backToModes(); }
      return;
    }

    if (this.mode === 'modes') {
      const rects = this.modeRects();
      const hov = this.hit(rects, mx, my);
      if (hov >= 0 && this.lastMouse !== input.mouse.lastMove) { if (hov !== this.modeSel) sfx.move(); this.modeSel = hov; }
      this.lastMouse = input.mouse.lastMove;
      if (input.pressed('up')) { this.modeSel = (this.modeSel + MODES.length - 1) % MODES.length; sfx.move(); }
      if (input.pressed('down')) { this.modeSel = (this.modeSel + 1) % MODES.length; sfx.move(); }
      if (input.pressed('back')) { this.mode = 'main'; this.t = 0; return; }
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
    if (this.levelOpen) { this.updateLevelPopup(dt, clickNow, mx, my); return; }
    { // glide the carousel toward the focused weapon (the short way round)
      const target = this.sel[this.focus || 0], pos = this.carPos ?? target;
      let d = target - pos; d -= NW * Math.round(d / NW);
      this.carPos = Math.abs(d) < 0.001 ? target : pos + d * (1 - Math.exp(-12 * dt));
      this.carPos = ((this.carPos % NW) + NW) % NW;
    }
    const hover = this.carouselHit(mx, my);
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
        if (c2.pressed('left')) this.stepSel(1, -1);
        if (c2.pressed('right')) this.stepSel(1, 1);
        if (c2.pressed('back')) { if (this.picks[1].length) { this.picks[1].pop(); sfx.flip(); } else { this.joined[1] = false; sfx.flip(); } }
        if (c2.pressed('pause') && this.ready(1) && this.ready(0)) { this.enterEquip(); return; } // START: on to the equipment
        if (c2.pressed('confirm')) this.togglePick(1, WEAPON_ORDER[this.sel[1]]);
      }
    }

    // this machine's own player
    if (online && net.connected && (this.sentSel !== this.sel[mine] || this.t - (this.sentT || 0) > 2)) { this.sentSel = this.sel[mine]; this.sentT = this.t; this.syncCursor(mine); } // (and now and then, for a partner who just arrived)
    this.lastMouse = input.mouse.lastMove;
    if (c1.pressed('left')) this.stepSel(mine, -1);
    if (c1.pressed('right')) this.stepSel(mine, 1);
    if (input.mouse.wheel) { this.stepSel(mine, Math.sign(input.mouse.wheel)); input.mouse.wheel = 0; }
    if (c1.pressed('back')) {
      if (this.picks[mine].length) { this.picks[mine].pop(); sfx.flip(); this.syncPicks(); }
      else this.backToModes();
      return;
    }
    // starting level (host / solo / local): SELECT (Tab / L, or the controller's Back button) or the
    // button in the corner opens a small popup; the weapon cards keep the screen to themselves
    if (this.play !== 'client' && this.play !== 'training') {
      const inR = (q) => mx > q[0] && mx < q[0] + q[2] && my > q[1] && my < q[1] + q[3];
      if (c1.pressed('select') || (clickNow && inR(this.levelButtonRect()))) { this.levelOpen = true; this.levelT = 0; sfx.flip(); return; }
    }
    const startClicked = false; // (the start button is gone: START / Enter begins the journey)
    const startPressed = c1.mode === 'pad' ? c1.pressed('pause') : c1.pressed('confirm'); // controller: START; keyboard: Enter
    if (this.play !== 'client' && this.ready(0) && (startPressed || startClicked)) {
      if (this.allReady()) this.enterEquip(); else { this.msgT = 2; sfx.flip(); }
      return;
    }
    // click a weapon at the side to bring it to the middle; click the middle one to pick it
    if (clickNow && hover >= 0 && hover !== this.sel[mine]) { this.sel[mine] = hover; this.focus = mine; sfx.move(); this.syncCursor(mine); return; }
    if (c1.pressed('confirm') || (clickNow && hover >= 0)) {
      this.focus = mine;
      this.togglePick(mine, WEAPON_ORDER[this.sel[mine]]);
      input.eat('confirm');
    }
    if (online && !net.connected && this.mode === 'select') { this.notice = 'Connection lost.'; this.backToModes(); }
  }

  // remove player i's pick: the weapon their cursor is on if it is picked, else the last one picked
  removePick(i) {
    const P = this.picks[i];
    if (!P.length) return;
    const at = P.indexOf(WEAPON_ORDER[this.sel[i]]);
    P.splice(at >= 0 ? at : P.length - 1, 1); sfx.flip(); this.syncPicks();
  }
  togglePick(i, key) {
    if (LOCKED_WEAPONS.has(key)) { sfx.flip(); this.lockedT = 1.6; return; } // (locked for now)
    const idx = this.picks[i].indexOf(key);
    if (idx >= 0) { this.picks[i].splice(idx, 1); sfx.flip(); }
    else { this.picks[i] = [key]; sfx.select(); } // picking another weapon swaps it in
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
  startRect() { const v = this.g.view, u = uiScale(v); return [v.W / 2 - 160 * u, v.H * 0.905 - 24 * u, 320 * u, 48 * u]; }
  // the start-level popup: the picker sits in the middle of a small panel
  levelRect() { const v = this.g.view, u = uiScale(v); return [v.W / 2 - 230 * u, v.H / 2 - 22 * u, 460 * u, 44 * u]; }
  levelPanelRect() { const v = this.g.view, u = uiScale(v); return [v.W / 2 - 270 * u, v.H / 2 - 95 * u, 540 * u, 190 * u]; }
  levelButtonRect() { const v = this.g.view, u = uiScale(v); return [24 * u, v.H - 74 * u, 250 * u, 46 * u]; }
  updateLevelPopup(dt, clickNow, mx, my) {
    const c1 = input.players[0];
    this.levelT = (this.levelT || 0) + dt;
    const inR = (q) => mx > q[0] && mx < q[0] + q[2] && my > q[1] && my < q[1] + q[3];
    const step = (d) => { this.startLevel = ((this.startLevel - 1 + d + MAX_LEVEL) % MAX_LEVEL) + 1; sfx.move(); };
    if (c1.pressed('up') || c1.pressed('right')) step(1);
    if (c1.pressed('down') || c1.pressed('left')) step(-1);
    if (input.mouse.wheel) { step(-Math.sign(input.mouse.wheel)); input.mouse.wheel = 0; }
    if (clickNow) {
      const [l, r] = this.levelArrowRects();
      if (inR(l)) { step(-1); return; }
      if (inR(r)) { step(1); return; }
      if (!inR(this.levelPanelRect())) { this.levelOpen = false; sfx.flip(); return; }
    }
    if (c1.pressed('select') || c1.pressed('back') || c1.pressed('confirm') || c1.pressed('pause')) {
      this.levelOpen = false; sfx.select(); input.eat('confirm'); input.eat('back');
    }
  }
  drawLevelButton(ctx, u, pad, rt) {
    const [x, y, w, h] = this.levelButtonRect(), n = this.startLevel || 1;
    ctx.fillStyle = 'rgba(24,18,30,0.85)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = n > 1 ? '#e8c470' : 'rgba(232,196,112,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    // the key: a small key cap
    const kl = pad ? 'SELECT' : 'TAB', kw = (pad ? 54 : 40) * u;
    ctx.fillStyle = '#e8dcc0'; ctx.fillRect(x + 10 * u, y + h / 2 - 11 * u, kw, 22 * u);
    text(ctx, kl, x + 10 * u + kw / 2, y + h / 2 + 0.5, 10 * u, '#1a1418', 800);
    text(ctx, `Start at level ${n}`, x + kw + 22 * u, y + h * 0.36, 14 * u, '#fff8e8', 800, FONT_SERIF, 'left');
    text(ctx, n === 1 ? 'from the beginning' : 'change starting level', x + kw + 22 * u, y + h * 0.72, 10 * u, 'rgba(248,240,222,0.65)', 700, FONT_SANS, 'left');
  }
  drawLevelPopup(ctx, v, u, pad) {
    const k = ease.outCubic(clamp((this.levelT || 0) / 0.18, 0, 1));
    ctx.save();
    ctx.fillStyle = `rgba(6,4,10,${0.6 * k})`; ctx.fillRect(0, 0, v.W, v.H);
    ctx.globalAlpha = k;
    const [x, y, w, h] = this.levelPanelRect();
    ctx.fillStyle = 'rgba(30,22,36,0.97)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#e8c470'; ctx.lineWidth = 2.5; ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(232,196,112,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + 6 * u, y + 6 * u, w - 12 * u, h - 12 * u);
    text(ctx, 'Starting level', v.W / 2, y + 30 * u, 22 * u, '#f8f0de', 800, FONT_SERIF);
    this.drawLevelPicker(ctx, u, pad);
    text(ctx, pad ? 'Ⓐ / SELECT / Ⓑ close' : 'Enter / Tab / Esc close · click outside to close', v.W / 2, y + h - 18 * u, 11 * u, 'rgba(248,240,222,0.6)', 700);
    ctx.restore();
  }
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
    text(ctx, pad ? '◀ ▶ change level' : '← → / mouse wheel change level', x + w / 2, y + h + 14 * u, 11 * u, 'rgba(248,240,222,0.55)', 700);
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
    if (this.mode === 'cards') return this.gallery.draw(ctx);
    if (this.mode === 'enemies') return this.bestiary.draw(ctx);
    ctx.fillStyle = 'rgba(10,8,16,0.62)'; ctx.fillRect(0, 0, v.W, v.H);
    const pad = input.players[0].mode === 'pad';

    if (this.mode === 'main') {
      outlinedText(ctx, '影の道', v.W / 2, v.H * 0.14, 64 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6);
      text(ctx, 'KAGE NO MICHI', v.W / 2, v.H * 0.24, 18 * u, 'rgba(248,240,222,0.85)', 800, FONT_SERIF);
      this.mainRects().forEach(([x, y, w, h], i) => {
        const m = MAIN[i], sel = i === this.mainSel;
        ctx.fillStyle = sel ? 'rgba(200,48,46,0.9)' : 'rgba(24,18,30,0.85)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = sel ? '#f4d690' : 'rgba(232,196,112,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
        text(ctx, m.jp, x + 44 * u, y + h / 2, 26 * u, sel ? '#fff4d8' : '#e8c470', 800, FONT_SERIF);
        text(ctx, m.name.toUpperCase(), x + 92 * u, y + h * 0.38, 22 * u, '#fff8e8', 800, FONT_SERIF, 'left');
        text(ctx, m.desc, x + 92 * u, y + h * 0.72, 12 * u, 'rgba(248,240,222,0.8)', 700, FONT_SANS, 'left');
      });
      text(ctx, pad ? '▲▼ choose · Ⓐ select · Ⓑ back' : '↑↓ or mouse to choose · Enter / click to select · Esc back', v.W / 2, v.H - 22 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
      return;
    }

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
        const k = net.key, n = k.length, tw = 64 * u, gap = 10 * u, x0 = v.W / 2 - (n * tw + (n - 1) * gap) / 2;
        for (let i = 0; i < n; i++) {
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

    if (this.mode === 'arts') { this.drawArts(ctx, v, u, rt, pad); return; }
    if (this.mode === 'equip') { this.equip.draw(ctx); return; }
    if (this.mode === 'difficulty') { this.diff.draw(ctx); return; }
    this.drawSelect(ctx, v, u, rt, pad);
  }

  // ---------------------------------------------------------------- training: technique picker
  // One row per weapon slot (basic / special / passive) of the two chosen weapons; each row offers
  // None or one of that slot's two techniques. The last row is the button that opens the training hall.
  enterArts() {
    this.mode = 'arts'; this.t = 0; sfx.select(); input.eat('confirm'); input.eat('pause');
    this.artRows = [];
    this.picks[0].forEach((wk, slot) => {
      for (const s of ['basic', 'secondary', 'special']) {
        const keys = Object.keys(ARTS[wk] || {}).filter((k) => ARTS[wk][k].slot === s);
        if (keys.length) this.artRows.push({ slot, wk, s, keys, choice: 0 }); // 0 = none, 1.. = keys[i-1]
      }
    });
    this.artRow = 0;
  }
  artLayout() {
    const v = this.g.view, u = uiScale(v), n = this.artRows.length;
    const rowH = Math.min(46 * u, (v.H * 0.62) / (n + 1)), w = Math.min(920 * u, v.W * 0.94), x = v.W / 2 - w / 2, y0 = v.H * 0.2;
    const labelW = 250 * u, chipW = (w - labelW - 3 * 8 * u) / 3;
    const rows = this.artRows.map((r, i) => {
      const y = y0 + i * rowH; // (one weapon: its rows in one block)
      return { y, h: rowH - 6 * u, chips: [0, 1, 2].map((c) => [x + labelW + 8 * u + c * (chipW + 8 * u), y, chipW, rowH - 6 * u]) };
    });
    const by = y0 + n * rowH + 26 * u;
    return { u, x, w, rowH, labelW, rows, button: [v.W / 2 - 170 * u, by, 340 * u, 50 * u] };
  }
  beginTraining() {
    input.eat('confirm'); input.eat('dash'); input.eat('pause'); sfx.gate();
    const arts = this.artRows.filter((r) => r.choice > 0).map((r) => [r.slot, r.keys[r.choice - 1]]);
    this.g.startTraining(this.picks[0].slice(), arts);
  }
  updateArts(clickNow, mx, my) {
    const c1 = input.players[0], L = this.artLayout(), n = this.artRows.length;
    const inR = (q) => mx > q[0] && mx < q[0] + q[2] && my > q[1] && my < q[1] + q[3];
    if (c1.pressed('back')) { this.mode = 'select'; this.t = 0; sfx.flip(); return; }
    if (c1.pressed('up')) { this.artRow = (this.artRow + n) % (n + 1); sfx.move(); }
    if (c1.pressed('down')) { this.artRow = (this.artRow + 1) % (n + 1); sfx.move(); }
    const R = this.artRows[this.artRow];
    if (R && (c1.pressed('left') || c1.pressed('right'))) { R.choice = (R.choice + (c1.pressed('left') ? 2 : 1)) % 3; sfx.move(); }
    if (input.mouse.lastMove !== this.lastMouse) {
      this.lastMouse = input.mouse.lastMove;
      L.rows.forEach((row, i) => { if (row.chips.some(inR)) this.artRow = i; });
      if (inR(L.button)) this.artRow = n;
    }
    if (clickNow) {
      for (let i = 0; i < n; i++) L.rows[i].chips.forEach((q, c) => { if (inR(q)) { this.artRows[i].choice = c; this.artRow = i; sfx.select(); } });
      if (inR(L.button)) { this.beginTraining(); return; }
    }
    const startNow = c1.mode === 'pad' ? c1.pressed('pause') : false;
    if (startNow || (this.t > 0.2 && c1.pressed('confirm'))) {
      if (this.artRow === n || startNow) { this.beginTraining(); return; }
      if (R) { R.choice = (R.choice + 1) % 3; sfx.select(); } // Enter on a row: cycle its choice
    }
  }
  drawArts(ctx, v, u, rt, pad) {
    const L = this.artLayout(), n = this.artRows.length;
    outlinedText(ctx, 'Choose your techniques', v.W / 2, v.H * 0.09, 36 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6);
    text(ctx, 'Pick any techniques to try (one per slot), or none', v.W / 2, v.H * 0.09 + 34 * u, 14 * u, 'rgba(248,240,222,0.8)', 700);
    ctx.fillStyle = 'rgba(16,10,14,0.78)'; ctx.fillRect(L.x - 14 * u, L.rows[0].y - 14 * u, L.w + 28 * u, L.rows[n - 1].y + L.rowH - L.rows[0].y + 22 * u);
    let hint = '';
    this.artRows.forEach((r, i) => {
      const row = L.rows[i], cur = i === this.artRow;
      if (i === 0 || r.slot !== this.artRows[i - 1].slot) text(ctx, WEAPONS[r.wk].name, L.x, row.y - 0.5 * u, 11 * u, '#f0c870', 800, FONT_SERIF, 'left', 'bottom');
      text(ctx, `${ART_SLOTS[r.s].jp}  ${{ basic: 'Basic', secondary: 'Secondary', special: 'Special', unique: 'Passive' }[r.s]}`, L.x + 12 * u, row.y + row.h / 2, 15 * u, cur ? '#fff4d8' : 'rgba(248,240,222,0.8)', 800, FONT_SERIF, 'left');
      row.chips.forEach(([x, y, w, h], c) => {
        const on = r.choice === c, A = c ? ARTS[r.wk][r.keys[c - 1]] : null;
        ctx.fillStyle = on ? (c ? 'rgba(122,26,36,0.95)' : 'rgba(60,52,60,0.95)') : 'rgba(40,30,36,0.7)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = on ? '#f0c870' : cur ? 'rgba(240,200,112,0.45)' : 'rgba(240,200,112,0.18)'; ctx.lineWidth = on ? 2.2 : 1; ctx.strokeRect(x, y, w, h);
        let fs = 14 * u; const label = A ? A.name : 'None'; ctx.font = `800 ${fs}px ${FONT_SERIF}`; while (ctx.measureText(label).width > w - 14 * u && fs > 9 * u) { fs -= 0.5 * u; ctx.font = `800 ${fs}px ${FONT_SERIF}`; }
        text(ctx, label, x + w / 2, y + h / 2 - (A ? 5 * u : 0), fs, on ? '#fff8e8' : 'rgba(248,240,222,0.7)', 800, FONT_SERIF);
        if (A) text(ctx, artPlain(A.text, null, pad), x + w / 2, y + h / 2 + 10 * u, 10 * u, on ? '#f0d8a0' : 'rgba(248,240,222,0.5)', 700);
        if (cur && on && A) hint = `${A.name}: ${artPlain(A.desc, null, pad)}`;
      });
      if (cur) { ctx.fillStyle = '#f0c870'; ctx.beginPath(); ctx.moveTo(L.x - 6 * u, row.y + row.h / 2 - 6 * u); ctx.lineTo(L.x + 2 * u, row.y + row.h / 2); ctx.lineTo(L.x - 6 * u, row.y + row.h / 2 + 6 * u); ctx.closePath(); ctx.fill(); }
    });
    if (hint) text(ctx, hint, v.W / 2, L.button[1] - 12 * u, 13 * u, '#f0d8a0', 700);
    this.button(ctx, L.button, pad ? 'START — Enter the training hall' : 'Enter the training hall', u, true, this.artRow === n ? Math.sin(rt * 5) : 0);
    text(ctx, pad ? '▲▼ row · ◀▶ choose · Ⓑ back to weapons' : '↑↓ row · ←→ or click to choose · Esc back to weapons', v.W / 2, L.button[1] + L.button[3] + 22 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
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
    ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(rt * 3));
    outlinedText(ctx, input.pad.connected ? 'Press Ⓐ to begin' : 'Press Enter or click to begin', v.W / 2, v.H * 0.72, 22 * u, '#ffe7a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 5);
    ctx.globalAlpha = a;
    if (g.best > 0) text(ctx, `Best: reached level ${g.best}`, v.W / 2, v.H * 0.78, 14 * u, 'rgba(248,240,222,0.8)', 700);
    if (this.notice) outlinedText(ctx, this.notice, v.W / 2, v.H * 0.84, 16 * u, '#ffd0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
    ctx.restore();
  }

  drawSelect(ctx, v, u, rt, pad1) {
    const coop = this.joined[1];
    const online = this.play === 'host' || this.play === 'client';
    const mine = this.play === 'client' ? 1 : 0;
    outlinedText(ctx, coop ? 'Choose your weapons' : 'Choose your weapon', v.W / 2, v.H * 0.09, 38 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 6);
    if (online) text(ctx, this.play === 'host' ? `Online · key ${net.key} · your friend is Player 2` : 'Online · you are Player 2', v.W / 2, v.H * 0.2, 14 * u, '#8fd0ff', 800);
    // the carousel: far cards first, the middle one last; each card is drawn at its base size and scaled
    const car = this.carousel().sort((a, b) => b.ad - a.ad);
    // background cards are drawn onto one layer that is blurred once (a filter on every draw call is far too slow)
    const drawCard = (ctx, C) => {
      if (C.a <= 0.01) return;
      const i = C.i, key = WEAPON_ORDER[i];
      const w = C.w, h = C.h, x = -w / 2, y = -h / 2;
      const W = WEAPONS[key];
      // online: only show this machine's cursor; local: both
      // online: our own cursor solid, the partner's (sent over the net) dashed
      const sel0 = (online ? mine === 0 : true) && i === this.sel[0];
      const sel1 = coop && (online ? mine === 1 : true) && i === this.sel[1];
      const other = online && coop && this.remoteSel !== undefined && i === this.remoteSel ? 1 - mine : -1;
      const on = C.ad < 0.5;
      const ws = 1;
      ctx.save(); ctx.translate(C.cx, C.cy); ctx.scale(C.s, C.s);
      if (!C.layer) ctx.globalAlpha *= C.a; // (background cards are drawn solid so nearer ones hide what is behind them)
      // (the soft focus comes from the blurred layer)
      ctx.shadowColor = on ? 'rgba(255,200,100,0.85)' : 'rgba(0,0,0,0.5)'; ctx.shadowBlur = on ? 46 : 12;
      ctx.fillStyle = '#eee3cc'; ctx.fillRect(x, y, w, h);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      if (sel0) { ctx.strokeStyle = coop ? PLAYER_COLORS[0] : '#e8c470'; ctx.lineWidth = 4; ctx.strokeRect(x - 4, y - 4, w + 8, h + 8); }
      if (sel1) { ctx.strokeStyle = PLAYER_COLORS[1]; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.strokeRect(x - 9, y - 9, w + 18, h + 18); ctx.setLineDash([]); }
      if (other >= 0) { // where the partner's cursor is, dashed, with their tag
        ctx.strokeStyle = PLAYER_COLORS[other]; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -rt * 20; ctx.strokeRect(x - 13, y - 13, w + 26, h + 26); ctx.setLineDash([]); ctx.lineDashOffset = 0;
        ctx.fillStyle = PLAYER_COLORS[other]; ctx.fillRect(x + w / 2 - 22, y - 26, 44, 16); text(ctx, `P${other + 1}`, x + w / 2, y - 18, 11, '#fff', 800);
      }
      const AH = 172 * u; // art panel height (fixed: the card grew for the third attack)
      const ag = ctx.createLinearGradient(0, y, 0, y + AH);
      ag.addColorStop(0, '#3a2a40'); ag.addColorStop(1, '#151020');
      ctx.fillStyle = ag; ctx.fillRect(x + 10 * u, y + 10 * u, w - 20 * u, AH);
      ctx.fillStyle = 'rgba(200,48,46,0.85)'; ctx.beginPath(); ctx.arc(x + w / 2, y + 10 * u + AH / 2, AH * 0.4, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(x + w / 2, y + 10 * u + AH / 2);
      { // centred on its own outline and sized to sit inside the circle (diagonal fits the diameter), held still
        const B = weaponIconBox(key), R = AH * 0.4;
        const sc = Math.min((R * 2.1) / Math.hypot(B.w, B.h), (R * 1.75) / Math.max(B.w, B.h));
        ctx.scale(sc, sc); ctx.translate(-B.x, -B.y);
        weaponIcon(ctx, key);
      }
      ctx.restore();
      text(ctx, W.jp, x + w - 14 * u, y + 26 * u, 16 * u, '#f4e6c8', 800, FONT_SERIF, 'right');
      // the card's sections (picture, name + description, ratings, three ability blocks) all get the same gap G
      const artBottom = y + 10 * u + AH, cardBottom = y + h - 14 * u;
      const titleH = 36 * u, ratRow = 18 * u, ratH = 2 * ratRow + 12 * u, blockH = 50 * u;
      const G = (cardBottom - artBottom - titleH - ratH - 3 * blockH) / 5;
      const ty = artBottom + G + 10 * u; // (the name's middle)
      const ratY = artBottom + G + titleH + G + 6 * u; // (the first rating row's middle)
      const blocksTop = ratY - 6 * u + ratH + G;
      text(ctx, W.name, x + w / 2, ty, 20 * u * Math.min(1, ws * 1.05), INK, 800, FONT_SERIF);
      { // description: one line if it fits, else two smaller lines
        ctx.font = `700 ${11 * u}px ${FONT_SANS}`;
        if (ctx.measureText(W.desc).width <= w - 24 * u) text(ctx, W.desc, x + w / 2, ty + 19 * u, 11 * u, '#4a3a30', 700);
        else {
          const words = W.desc.split(' '); let a = '', b = '';
          ctx.font = `700 ${10 * u}px ${FONT_SANS}`;
          for (const wd of words) { if (!b && ctx.measureText(a ? a + ' ' + wd : wd).width <= w - 24 * u) a = a ? a + ' ' + wd : wd; else b = b ? b + ' ' + wd : wd; }
          text(ctx, a, x + w / 2, ty + 14 * u, 10 * u, '#4a3a30', 700);
          text(ctx, b, x + w / 2, ty + 26 * u, 10 * u, '#4a3a30', 700);
        }
      }
      [['Speed', W.rating.speed], ['Damage', W.rating.damage], ['Range', W.rating.range]].forEach(([name, val], j) => {
        const by = ratY + j * ratRow;
        text(ctx, name, x + 14 * u, by, 11.5 * u, '#4a3a30', 700, FONT_SANS, 'left');
        const bw = (w - 84 * u) / 5;
        for (let s = 0; s < 5; s++) { ctx.fillStyle = s < val ? '#c8302e' : 'rgba(40,30,30,0.18)'; ctx.fillRect(x + 70 * u + s * bw, by - 6 * u, bw - 5 * u, 12 * u); }
      });
      // both attacks, in the card's own style: a thin ink rule, then per attack a tag + name, a one-line
      // description and a row of small stat icons with plain ink numbers (damage, cooldown, reach, ki)
      const I = WEAPON_INFO[key];
      const lx = x + 14 * u, rx = x + w - 14 * u;
      // which buttons: the slot this weapon is picked in, or the slot it would take next
      const keys = attackKeys(pad1); // X / Y / B, or left mouse / right mouse / Q
      // the stat rows of both abilities share fixed columns (damage, cooldown, reach, ki) and one text size,
      // so each icon sits straight above the same icon of the other ability
      const allStats = [abilityStats(W.basic, I.basic, false), abilityStats(W.secondary, I.secondary, false), abilityStats(W.special, I.special, true)];
      // each column is as wide as its widest entry (icon + number) on ANY weapon card, so the icons sit in
      // exactly the same places on every card; the leftover room is shared out as equal gaps
      const everyRow = WEAPON_ORDER.flatMap((k) => [abilityStats(WEAPONS[k].basic, WEAPON_INFO[k].basic, false), abilityStats(WEAPONS[k].secondary, WEAPON_INFO[k].secondary, false), abilityStats(WEAPONS[k].special, WEAPON_INFO[k].special, true)]);
      // a 2x2 grid of big icons (damage | cooldown over reach | ki), two equal columns; the text shrinks until
      // the widest entry of any card fits
      // one row of four: each column as wide as its widest entry on ANY card, the room left shared out as
      // equal gaps (at least 10 px); the text shrinks only if even that doesn't fit
      let fs = 11 * u, is = 14 * u, colW = [];
      for (;;) {
        ctx.font = `800 ${fs}px ${FONT_SANS}`;
        colW = [0, 1, 2, 3].map((c) => is + 4 * u + Math.max(...everyRow.map((row) => ctx.measureText(row[c][1]).width)));
        if ((rx - lx) - colW.reduce((a, b) => a + b, 0) >= 3 * 10 * u || fs < 8.5 * u) break;
        fs -= 0.5 * u; is = Math.max(12 * u, is - 0.3 * u);
      }
      const colGap = ((rx - lx) - colW.reduce((a, b) => a + b, 0)) / 3;
      const colX = []; { let ax = lx; for (let c = 0; c < 4; c++) { colX.push(ax); ax += colW[c] + colGap; } }
      [[W.basic, I.basic, false, 'BASIC', '#2a5fb8', 'rgba(47,111,216,0.15)'], [W.secondary, I.secondary, false, 'SECONDARY', '#a87a10', 'rgba(216,166,32,0.2)'], [W.special, I.special, true, 'SPECIAL', '#b8302a', 'rgba(184,48,42,0.14)']].forEach(([def, info, special, tag, col, tint], j) => {
        const top = blocksTop + j * (blockH + G);
        // header: a tinted strip with the button and the ability's name, its kind on the right
        const hh = 20 * u;
        ctx.fillStyle = tint; ctx.beginPath(); ctx.roundRect(lx - 5 * u, top, rx - lx + 10 * u, hh, 4 * u); ctx.fill();
        ctx.fillStyle = col; ctx.fillRect(lx - 5 * u, top, 3 * u, hh);
        const bw = abilityButton(ctx, keys[j], lx + 2 * u, top + hh / 2, 14 * u, pad1);
        ctx.font = `800 ${8.5 * u}px ${FONT_SANS}`; const tgw = ctx.measureText(tag).width;
        text(ctx, tag, rx + 1 * u, top + hh / 2 + 0.5, 8.5 * u, col, 800, FONT_SANS, 'right');
        { let ns = 13 * u; ctx.font = `800 ${ns}px ${FONT_SERIF}`; while (ctx.measureText(def.name).width > rx - lx - bw - tgw - 16 * u && ns > 9 * u) { ns -= 0.5 * u; ctx.font = `800 ${ns}px ${FONT_SERIF}`; }
          text(ctx, def.name, lx + bw + 8 * u, top + hh / 2 + 0.5, ns, INK, 800, FONT_SERIF, 'left'); }
        const by = top + hh / 2; // (the rows below are placed from here)
        { let ds = 10 * u; ctx.font = `700 ${ds}px ${FONT_SANS}`; // shrinks a long line to fit
          while (ctx.measureText(info.desc).width > rx - lx && ds > 7.5 * u) { ds -= 0.25 * u; ctx.font = `700 ${ds}px ${FONT_SANS}`; }
          text(ctx, info.desc, lx, by + 19 * u, ds, '#5a4a40', 700, FONT_SANS, 'left'); }
        allStats[j].forEach(([icon, str], c) => {
          const cx = colX[c], cy = by + 34 * u;
          if (icon === 'range') drawRangeIcon(ctx, cx + is / 2, cy, is); else drawStatIcon(ctx, icon, cx + is / 2, cy, is);
          text(ctx, str, cx + is + 4 * u, cy + 0.5, fs, '#2a2030', 800, FONT_SANS, 'left');
        });
      });
      const badges = [];
      [0, 1].forEach((pi) => { const at = this.picks[pi].indexOf(key); if (at >= 0 && (pi === 0 || coop)) badges.push([pi, at]); });
      badges.forEach(([pi], bi) => { // picked: a red line all round the card (co-op: in the player's colour)
        const col = coop ? PLAYER_COLORS[pi] : '#d0262a', o = 9 + bi * 8;
        ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 16;
        ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.strokeRect(x - o, y - o, w + o * 2, h + o * 2);
        ctx.restore();
        ctx.strokeStyle = 'rgba(20,6,8,0.8)'; ctx.lineWidth = 1.2; ctx.strokeRect(x - o - 3, y - o - 3, w + o * 2 + 6, h + o * 2 + 6);
        if (!coop) { // solo: a small red tag on the outline's bottom edge
          const tw = 92 * u, th = 18 * u, tx = x + w / 2 - tw / 2, ty = y + h + o - th / 2;
          ctx.fillStyle = col; ctx.fillRect(tx, ty, tw, th);
          ctx.strokeStyle = 'rgba(20,6,8,0.85)'; ctx.lineWidth = 1.2; ctx.strokeRect(tx, ty, tw, th);
          text(ctx, 'SELECTED', x + w / 2, ty + th / 2 + 0.5, 11 * u, '#fff4e8', 800);
        }
        if (coop) { const tx = x + w / 2 + (badges.length > 1 ? (bi ? 25 : -25) : 0); ctx.fillStyle = col; ctx.fillRect(tx - 22, y + h + o - 2, 44, 16); text(ctx, `P${pi + 1}`, tx, y + h + o + 6, 11, '#fff', 800); }
      });
      if (LOCKED_WEAPONS.has(key)) { // locked: dark grey over the whole card, a padlock in the middle
        ctx.fillStyle = 'rgba(42,42,46,0.82)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#5a5a60'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
        const L = 34 * u;
        ctx.strokeStyle = '#a8a8b0'; ctx.lineWidth = 7 * u; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, -L * 0.35, L * 0.55, Math.PI, 0); ctx.lineTo(L * 0.55, -L * 0.05); ctx.moveTo(-L * 0.55, -L * 0.35); ctx.lineTo(-L * 0.55, -L * 0.05); ctx.stroke(); ctx.lineCap = 'butt';
        ctx.fillStyle = '#9a9aa2'; ctx.fillRect(-L * 0.85, -L * 0.1, L * 1.7, L * 1.25);
        ctx.fillStyle = '#4a4a52'; ctx.beginPath(); ctx.arc(0, L * 0.38, L * 0.17, 0, TAU); ctx.fill(); ctx.fillRect(-L * 0.06, L * 0.4, L * 0.12, L * 0.3);
        text(ctx, 'Locked', 0, L * 1.65, 16 * u, '#c8c8d0', 800, FONT_SERIF);
      }
      if (!on) { ctx.fillStyle = `rgba(8,6,12,${C.layer ? Math.min(0.62, 0.16 + C.ad * 0.16) : Math.min(0.32, C.ad * 0.14)})`; ctx.fillRect(x - 10, y - 10, w + 20, h + 20); } // and darker further back
      ctx.restore();
    };
    const v2 = this.g.view;
    if (!this.bgLayer) { this.bgLayer = document.createElement('canvas'); }
    const lay = this.bgLayer; if (lay.width !== Math.ceil(v2.W) || lay.height !== Math.ceil(v2.H)) { lay.width = Math.ceil(v2.W); lay.height = Math.ceil(v2.H); }
    const lc = lay.getContext('2d'); lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, lay.width, lay.height); lc.setTransform(ctx.getTransform());
    let layered = false;
    for (const C of car) if (C.ad > 0.3 && C.a > 0.01) { drawCard(lc, { ...C, layer: true }); layered = true; }
    if (layered) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= 0.9; ctx.filter = 'blur(1.2px)'; ctx.drawImage(lay, 0, 0); ctx.restore(); }
    for (const C of car) if (C.ad <= 0.3 && C.a > 0.01) drawCard(ctx, C);
    // scroll arrows beside the middle card, and the weapons picked so far
    {
      const mid = car[car.length - 1], half = (mid.w * mid.s) / 2, ay = mid.cy, bob = Math.sin(rt * 4) * 3 * u;
      for (const sg of [-1, 1]) {
        const ax = v.W / 2 + sg * (half + 30 * u + bob);
        ctx.save(); ctx.translate(ax, ay); ctx.scale(sg, 1);
        ctx.fillStyle = 'rgba(10,6,12,0.75)'; ctx.beginPath(); ctx.arc(0, 0, 20 * u, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#e8c470'; ctx.lineWidth = 2 * u; ctx.stroke();
        ctx.fillStyle = '#f8e6b0'; ctx.beginPath(); ctx.moveTo(7 * u, 0); ctx.lineTo(-4 * u, -9 * u); ctx.lineTo(-4 * u, 9 * u); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      const names = (pi) => this.picks[pi].map((k) => WEAPONS[k].name).join('   ·   ');
      const line = coop ? [0, 1].map((pi) => `P${pi + 1}  ${names(pi) || '—'}`).join('        ') : names(mine) ? `Picked   ${names(mine)}` : '';
      void line; // (the picked weapon shows as a red line round its card)
    }
    // footer
    if (this.play !== 'client' && this.play !== 'training') this.drawLevelButton(ctx, u, pad1, rt);
    if (this.play === 'client') {
      const msg = this.ready(1) ? (this.ready(0) ? 'Waiting for the host to start…' : 'Waiting for the host to choose…') : (pad1 ? 'Ⓐ select · Ⓑ undo' : 'Enter / click to select · Backspace to undo');
      text(ctx, msg, v.W / 2, v.H * 0.88, 16 * u, this.ready(1) ? '#8fd0ff' : 'rgba(248,240,222,0.8)', 800);
    } else if (this.ready(0)) {
      const ok = this.allReady();
      if (!ok) text(ctx, 'Waiting for Player 2…', v.W / 2, v.H * 0.905, 16 * u, 'rgba(248,240,222,0.8)', 800); // (no start button: START / Enter begins, see the hints below)
    }
    if (this.play === 'local') {
      if (!this.joined[1]) outlinedText(ctx, input.padCount > 1 ? 'Player 2: press Ⓐ on the second controller to join' : 'Player 2: press Ⓐ on the controller to join (player 1 uses keyboard + mouse)', v.W / 2, v.H * 0.2, 16 * u, '#8fd0ff', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
      else text(ctx, 'Player 2 joined — Ⓑ on their controller to leave', v.W / 2, v.H * 0.2, 14 * u, '#8fd0ff', 700);
    }
    { // A select / deselect · START continue (keyboard: Enter / click)
      const items = pad1 ? [['A', '#5aa832', 'select / deselect'], ['START', '#3a3440', 'continue']] : [['Click', '#3a3440', 'select / deselect'], ['Enter', '#3a3440', 'continue']];
      const y = v.H - 26 * u, fs = 14 * u;
      const widths = items.map(([k, , lab]) => { ctx.font = `800 ${11 * u}px ${FONT_SANS}`; const kw = Math.max(22 * u, ctx.measureText(k).width + 14 * u); ctx.font = `700 ${fs}px ${FONT_SANS}`; return [kw, kw + 7 * u + ctx.measureText(lab).width]; });
      const gapI = 30 * u, total = widths.reduce((a, [, w]) => a + w, 0) + gapI * (items.length - 1);
      let x = v.W / 2 - total / 2;
      ctx.save();
      items.forEach(([k, col, lab], i) => {
        const [kw, w] = widths[i], round = k.length === 1;
        ctx.fillStyle = round ? col : 'rgba(30,24,34,0.92)'; ctx.strokeStyle = 'rgba(248,240,222,0.75)'; ctx.lineWidth = 1.5 * u;
        ctx.beginPath(); if (round) ctx.arc(x + kw / 2, y, 11 * u, 0, TAU); else roundRect(ctx, x, y - 11 * u, kw, 22 * u, 6 * u); ctx.fill(); ctx.stroke();
        text(ctx, k, x + kw / 2, y + 0.5 * u, 11 * u, '#fff8e8', 800);
        text(ctx, lab, x + kw + 7 * u, y, fs, 'rgba(248,240,222,0.85)', 700, FONT_SANS, 'left');
        x += w + gapI;
      });
      ctx.restore();
    }
    if (this.msgT > 0) outlinedText(ctx, 'Player 2 still has to pick a weapon', v.W / 2, v.H * 0.82, 16 * u, '#ffd0a0', 'rgba(10,6,12,0.85)', 800, FONT_SANS, 4);
    if (this.levelOpen && this.play !== 'client') this.drawLevelPopup(ctx, v, u, pad1);
  }
}

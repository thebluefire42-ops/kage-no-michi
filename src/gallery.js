// All Cards: a gallery of every reward card in the game, reached from the main menu.
// Tabs along the top pick the card type; L1 / R1 (Q / E on the keyboard) step through the rarities;
// left / right browse the cards. The cards are drawn by the game's own card painter (cards.js), each
// with a stand-in player so their now -> after readouts make sense.
import { clamp, lerp, TAU } from './util.js';
import { RARITIES, UPGRADES, ELEMENTS, ITEM_CARDS, TALENTS, TALENT_POWER, WEAPON_ORDER, WEAPONS } from './config.js';
import { ARTS } from './arts.js';
import { SACRIFICES } from './sacrifice.js';
import { drawCard } from './cards.js';
import { Player } from './player.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { uiScale, text, outlinedText, FONT_SERIF, FONT_SANS } from './ui.js';

const TYPES = [
  { key: 'stat', name: 'Training', jp: '力', rarity: true },
  { key: 'element', name: 'Imbuements', jp: '宿', rarity: true },
  { key: 'item', name: 'Consumables', jp: '薬', rarity: true },
  { key: 'talent', name: 'Talents', jp: '術', rarity: true },
  { key: 'art', name: 'Techniques', jp: '奥', rarity: false },
  { key: 'sacrifice', name: 'Sacrifices', jp: '犠', rarity: false },
];

export class CardGallery {
  constructor(g) { this.g = g; this.players = {}; }

  open() { this.custom = null; this.type = 0; this.rarity = 0; this.sel = 0; this.scroll = 0; this.t = 0; this.build(); }
  // show a fixed list of cards ([{ card, player, label }]) with a title, no tabs or rarity
  openList(list, title) { this.custom = { title }; this.list = list; this.sel = Math.max(0, list.length - 1); this.scroll = this.sel; this.t = 0; }

  // a stand-in player carrying weapon `key` in its first slot (for imbuement / weapon art readouts)
  player(key = 'katanas') {
    if (!this.players[key]) { const p = new Player(this.g, [key, key === 'katanas' ? 'knives' : 'katanas'], 0); p.hp = Math.round(p.maxHp * 0.6); p.energy = 40; this.players[key] = p; }
    return this.players[key];
  }

  // the cards of the current type at the current rarity: [{ card, player }]
  build() {
    const T = TYPES[this.type].key, r = this.rarity, list = [];
    if (T === 'stat') for (const k of Object.keys(UPGRADES)) if (UPGRADES[k].offer !== false) list.push({ card: { type: 'stat', stat: k, key: k, rarity: r, value: UPGRADES[k].values[r] }, player: this.player() });
    if (T === 'element') for (const e of Object.keys(ELEMENTS)) list.push({ card: { type: 'element', element: e, slot: 0, key: e, rarity: r, value: ELEMENTS[e].values[r] }, player: this.player() });
    if (T === 'item') for (const k of Object.keys(ITEM_CARDS)) list.push({ card: { type: k, key: k, rarity: r, value: ITEM_CARDS[k].values[r] }, player: this.player() });
    if (T === 'talent') for (const k of Object.keys(TALENTS)) list.push({ card: { type: 'talent', talent: k, kind: 'new', key: k, rarity: r, value: TALENT_POWER[r] }, player: this.player() });
    if (T === 'art') for (const w of WEAPON_ORDER) for (const k of Object.keys(ARTS[w] || {})) list.push({ card: { type: 'art', slot: 0, art: k, artSlot: ARTS[w][k].slot, key: `${w}_${k}`, rarity: 2, value: 0 }, player: this.player(w) });
    if (T === 'sacrifice') for (const k of Object.keys(SACRIFICES)) list.push({ card: { type: 'sacrifice', key: k, rarity: 0 }, player: this.player() });
    this.list = list;
    this.sel = clamp(this.sel, 0, Math.max(0, list.length - 1));
  }

  layout() {
    const v = this.g.view, u = uiScale(v);
    const k = clamp(Math.min(v.W / 1100, v.H / 760), 0.45, 4.5);
    return { u, k, cw: 230 * k, ch: 340 * k, gap: 26 * k, cy: v.H * 0.6 };
  }
  tabRects() {
    const v = this.g.view, u = uiScale(v), w = 150 * u, h = 40 * u, gap = 8 * u, n = TYPES.length;
    const x0 = v.W / 2 - (n * w + (n - 1) * gap) / 2;
    return TYPES.map((_, i) => [x0 + i * (w + gap), v.H * 0.13, w, h]);
  }
  rarityArrows() { const v = this.g.view, u = uiScale(v), y = v.H * 0.13 + 52 * u, h = 30 * u; return [[v.W / 2 - 170 * u, y, 46 * u, h], [v.W / 2 + 124 * u, y, 46 * u, h]]; }

  setType(i) { if (i === this.type) return; this.type = (i + TYPES.length) % TYPES.length; this.sel = 0; this.scroll = 0; sfx.move(); this.build(); }
  setRarity(d) {
    if (!TYPES[this.type].rarity) { sfx.flip(); return; }
    const r = clamp(this.rarity + d, 0, RARITIES.length - 1);
    if (r !== this.rarity) { this.rarity = r; sfx.move(); if (r >= 1) sfx.chime(r); this.build(); }
  }

  // returns 'back' when the player leaves the gallery
  update(dt) {
    this.t += dt;
    const g = this.g, m = input.mouse, mx = m.x * g.view.dpr, my = m.y * g.view.dpr, click = m.clicked;
    if (input.pressed('back')) { input.eat('back'); sfx.flip(); return 'back'; }
    if (!this.custom && input.pressed('up')) this.setType(this.type - 1);
    if (!this.custom && input.pressed('down')) this.setType(this.type + 1);
    if (input.pressed('left') && this.sel > 0) { this.sel--; sfx.move(); }
    if (input.pressed('right') && this.sel < this.list.length - 1) { this.sel++; sfx.move(); }
    // card type: L1 / R1 (Q / J), rarity: L2 / R2 (E / K); the mouse buttons also count as R1 / R2, so not on a click
    if (!this.custom && input.pressed('L1')) this.setType(this.type - 1);
    if (!this.custom && input.pressed('R1') && !click) this.setType(this.type + 1);
    if (!this.custom && input.pressed('L2')) this.setRarity(-1);
    if (!this.custom && input.pressed('R2') && !input.mouse.down[2]) this.setRarity(1);
    if (click && !this.custom) {
      const inR = (q) => mx > q[0] && mx < q[0] + q[2] && my > q[1] && my < q[1] + q[3];
      this.tabRects().forEach((q, i) => { if (inR(q)) this.setType(i); });
      const [a, b] = this.rarityArrows();
      if (inR(a)) this.setRarity(-1);
      if (inR(b)) this.setRarity(1);
      const L = this.layout(); // click a card to bring it to the middle
      for (let i = 0; i < this.list.length; i++) { const x = g.view.W / 2 + (i - this.scroll) * (L.cw + L.gap); if (Math.abs(mx - x) < L.cw / 2 && Math.abs(my - L.cy) < L.ch / 2 && i !== this.sel) { this.sel = i; sfx.move(); } }
    }
    this.scroll = lerp(this.scroll, this.sel, 1 - Math.exp(-12 * dt));
    return null;
  }

  draw(ctx) {
    const g = this.g, v = g.view, L = this.layout(), u = L.u, t = this.t, pad = input.players[0].mode === 'pad';
    ctx.fillStyle = 'rgba(8,6,14,0.82)'; ctx.fillRect(0, 0, v.W, v.H);
    outlinedText(ctx, this.custom ? this.custom.title : '札  All Cards', v.W / 2, v.H * 0.065, 34 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 5);
    if (this.custom) return this.drawRow(ctx, L, u, t, pad);
    // type tabs
    this.tabRects().forEach(([x, y, w, h], i) => {
      const on = i === this.type;
      ctx.fillStyle = on ? 'rgba(200,48,46,0.92)' : 'rgba(24,18,30,0.88)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = on ? '#f4d690' : 'rgba(232,196,112,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      text(ctx, TYPES[i].jp, x + 20 * u, y + h / 2, 17 * u, on ? '#fff4d8' : '#e8c470', 800, FONT_SERIF);
      text(ctx, TYPES[i].name, x + 36 * u, y + h / 2, 14 * u, '#fff8e8', 800, FONT_SANS, 'left');
    });
    // rarity selector
    const T = TYPES[this.type], [ra, rb] = this.rarityArrows(), ry = ra[1] + ra[3] / 2;
    if (T.rarity) {
      for (const [q, lab] of [[ra, pad ? '◀ LT' : '◀ E'], [rb, pad ? 'RT ▶' : 'K ▶']]) {
        ctx.fillStyle = 'rgba(200,48,46,0.85)'; ctx.fillRect(q[0], q[1], q[2], q[3]);
        text(ctx, lab, q[0] + q[2] / 2, ry, 12 * u, '#fff4d8', 800);
      }
      const R = RARITIES[this.rarity];
      for (let i = 0; i < RARITIES.length; i++) { // one gem per rarity, the current ones lit
        const gx = v.W / 2 - 60 * u + i * 14 * u, on = i <= this.rarity;
        ctx.fillStyle = on ? (this.rarity === 0 ? '#9a8c78' : this.rarity === 3 ? '#e8a020' : R.color) : 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.moveTo(gx, ry - 7 * u); ctx.lineTo(gx + 5.5 * u, ry); ctx.lineTo(gx, ry + 7 * u); ctx.lineTo(gx - 5.5 * u, ry); ctx.closePath(); ctx.fill();
      }
      text(ctx, `${R.jp}  ${R.name}`, v.W / 2 + 40 * u, ry, 17 * u, this.rarity === 0 ? '#e8e0d0' : R.color, 800, FONT_SERIF);
    } else text(ctx, T.key === 'art' ? 'Techniques have no rarity' : 'Sacrifices have no rarity', v.W / 2, ry, 14 * u, 'rgba(248,240,222,0.7)', 700);
    this.drawRow(ctx, L, u, t, pad);
  }

  // the row of cards, the selected one in the middle and lifted a little
  drawRow(ctx, L, u, t, pad) {
    const v = this.g.view, n = this.list.length;
    if (!n) { text(ctx, 'No cards chosen yet', v.W / 2, L.cy, 20 * u, 'rgba(248,240,222,0.75)', 800, FONT_SERIF); }
    for (let i = 0; i < n; i++) {
      const x = v.W / 2 + (i - this.scroll) * (L.cw + L.gap);
      if (x < -L.cw || x > v.W + L.cw) continue;
      const on = i === this.sel, sc = on ? 1.06 : 0.94;
      const { card, player } = this.list[i];
      ctx.save(); ctx.translate(x, L.cy - (on ? 10 * L.k : 0)); ctx.scale(sc, sc);
      ctx.globalAlpha = on ? 1 : 0.8;
      drawCard(ctx, card, L.cw, L.ch, t + i * 0.7, { hover: on, tiltX: 0, tiltY: 0 }, player);
      ctx.restore();
    }
    // the weapon an art belongs to, and where we are in the list
    const cur = this.list[this.sel];
    const under = cur && (cur.label || (cur.card.type === 'art' ? WEAPONS[cur.player.weapons[cur.card.slot || 0].key].name : ''));
    if (under) text(ctx, under, v.W / 2, L.cy + L.ch * 0.56 + 18 * u, 16 * u, '#e8c470', 800, FONT_SERIF);
    text(ctx, n ? `${this.sel + 1} / ${n}` : 'none', v.W / 2, L.cy + L.ch * 0.56 + 40 * u, 13 * u, 'rgba(248,240,222,0.7)', 700);
    text(ctx, this.custom ? (pad ? '◀▶ browse · Ⓑ back' : '←→ browse · Esc back') : pad ? 'LB / RB card type · ◀▶ browse · LT / RT rarity · Ⓑ back' : 'Q / J or click: card type · ←→ browse · E / K rarity · Esc back', v.W / 2, v.H - 20 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
  }
}

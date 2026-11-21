// Enemies: a bestiary of every enemy in the game, reached from the main menu.
// Tabs along the top pick the area (plus the training halls and libraries); left / right browse the enemies.
// Each enemy is a real Enemy drawn by its own look (so it always matches the game), standing still in a panel
// with its health and hit damage at the start of its area, what kind it is, and how it fights.
import { clamp, lerp, isoX, isoY } from './util.js';
import { ENEMIES, BOSSES, BIOME_POOLS, DOJO_POOL, LIBRARY_POOL } from './config.js';
import { Enemy } from './enemies.js';
import { LOOKS } from './behaviors.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { uiScale, text, outlinedText, FONT_SERIF, FONT_SANS } from './ui.js';

// how each enemy fights (player-facing, short)
const DESC = {
  bandit: 'A ronin turned robber. Rushes in and cuts: weak alone, dangerous in numbers.',
  spear: 'Thrusts from far off, and whirls his spear in a ring of steel. Step in close or stay well back.',
  archer: 'Keeps his distance and looses arrows. Close in fast.',
  assassin: 'Blinks next to you in a puff of smoke and stabs. Quick, but fragile.',
  bomber: 'Lobs bombs onto the spot you stand on. The marked circle is the blast.',
  sumo: 'Belly-charges down a red lane, then stomps inside a circle. Hard to knock back.',
  samurai: 'A two-cut iaido combo; the second cut dashes forward.',
  tate: 'Charges behind a wooden shield; a charge that connects dazes you. Hit him from the side.',
  ironguard: 'Advances slowly behind an iron shield and bashes you back. Flank him.',
  banner: 'Enemies in his orange circle hit 20% harder and move and attack faster. He stands where it covers the most of them: cut him down first.',
  kappa: 'Hops in for quick bites, and spits water bolts from mid range.',
  kamaitachi: 'A weasel of the wind: lunges from afar, sometimes twice in a row.',
  karasu: 'Throws darts from afar, and folds its wings to dive straight at you.',
  kitsune: 'Blinks next to you to strike, and throws three foxfire flames in a fan.',
  tanuki: 'Lobs sake jugs: one on you and one on each side.',
  yamabushi: 'Casts spirit orbs from far away. Get close and he blows his conch: a shockwave ring.',
  boar: 'A long-warned charge with huge knockback. Make it hit a wall and it stuns itself.',
  komainu: 'Leaps onto your position; the landing slams, then a shockwave rolls outward.',
  shellguard: 'Charges behind its shell; a hit dazes you. Get around the shell.',
  barkwarden: 'A slow tree spirit behind a bark shield that bashes you back.',
  tsubame: 'Circles you in the air, then folds its wings and dives through you along a red lane.',
  hunter: 'Backs off laying bear traps, and fires a long rifle shot along a thin aim line.',
  skeleton: 'Cuts up close and throws bones from range.',
  ghostspear: 'Thrusts from far off with a spectral spear.',
  frostarcher: 'Shoots ice arrows, sometimes a volley of three.',
  yukionna: 'Blinks next to you; her cold touch and freezing breath slow you.',
  imp: 'Lobs fireballs onto the spot you stand on.',
  wisp: 'Casts soul orbs, and seals the ground under and around you. The seals burst.',
  oni: 'Charges in and swings a heavy club.',
  gashadokuro: 'A giant skeleton: three alternating hand slams on your position.',
  frostoni: 'Freezing breath that slows, and a close-range club slam.',
  boneshield: 'Charges behind a bone shield; a hit dazes you.',
  glacier: 'Advances behind a shield of ice and bashes you back.',
  kgsoldier: 'A drilled soldier with a fast two-hit combo.',
  kgspear: 'Long thrusts, and a wide sweep when you stand too close.',
  kgsentry: 'Crossbow bolts, and a fully drawn heavy bolt that hits much harder.',
  kgshinobi: 'Blinks next to you, and throws fans of three kunai.',
  kgshield: 'Charges behind an iron shield; a hit dazes you.',
  kgwall: 'Slams its shield down for a shockwave ring.',
  kgmonk: 'Casts orbs, and chants to heal hurt allies nearby. Take him out first.',
  kgchampion: "The regent's elite: a two-cut iaido combo that dashes forward, and hits very hard.",
  karateka: 'Fast strikes. Slips some of your hits while not attacking.',
  kenshi: 'A sword duelist who slips some of your hits while not attacking.',
  bojutsu: 'Lunges with the staff from range, and slips some of your hits.',
  naginata: 'Long naginata lunges, and slips some of your hits.',
  shurikenka: 'Throws shuriken from range.',
  sensei: 'The master of the dojo: a two-cut iaido combo that dashes forward.',
  scholar: 'Reads spells from his book: one slow homing orb at a time, from mid range.',
  sage: 'Hurls ink magic from far away, at most two orbs at once.',
  ronin_boss: 'Sword sweeps, triple dashes and a great whirl. Calls in his band of bandits.',
  tengu: 'Feather fans with one safe gap, wind gusts and a diving strike. Calls his flock.',
  oni_lord: 'Club slams, stomps, rings of fire that close in, and charges.',
  gensai: 'Iaijutsu flashes, crescent blades, shadow seals and mirage dashes. Guarded while four guards stand.',
};

const bossAt = (lv) => BOSSES[lv] ? [BOSSES[lv].type] : [];
// level: the level the numbers are shown at (the first fight of the area)
const TABS = [
  { name: 'Rice Paddies', jp: '春', sub: 'Area 1', level: 2, list: [...BIOME_POOLS[0], ...bossAt(10)] },
  { name: 'Mountain Pass', jp: '秋', sub: 'Area 2', level: 11, list: [...BIOME_POOLS[1], ...bossAt(20)] },
  { name: 'Castle Town', jp: '冬', sub: 'Area 3', level: 21, list: [...BIOME_POOLS[2], ...bossAt(30)] },
  { name: 'Fortress', jp: '城', sub: 'Area 4', level: 31, list: [...BIOME_POOLS[3], ...bossAt(33)] },
  { name: 'Dojo & Library', jp: '道', sub: 'Special levels', level: 5, list: [...DOJO_POOL, ...LIBRARY_POOL] },
];

// wraps text into lines no wider than w
function wrap(ctx, str, w) {
  const out = []; let line = '';
  for (const word of str.split(' ')) { const tryL = line ? line + ' ' + word : word; if (ctx.measureText(tryL).width > w && line) { out.push(line); line = word; } else line = tryL; }
  if (line) out.push(line);
  return out;
}

export class Bestiary {
  constructor(g) { this.g = g; this.tab = 0; this.sel = 0; this.scroll = 0; this.t = 0; this.cache = {}; }

  open() { this.sel = 0; this.scroll = 0; this.t = 0; }

  // a still Enemy of this type for drawing, and its numbers at the tab's level (solo, normal difficulty)
  enemy(type, level) {
    const k = `${type}@${level}`;
    if (this.cache[k] !== undefined) return this.cache[k];
    const g = this.g, li = g.levelInfo, pl = g.players;
    let e = null;
    try {
      g.levelInfo = null; g.players = [];
      e = new Enemy(g, type, 0, 0, level);
      e.state = 'idle'; e.portrait = true; e.alpha = 1; // (portrait: no shield bar over its head) e.faceX = 0.75; e.faceY = 1; e.moveAmt = 0; e.hidden = false; e.tele = null; e.pose = null;
    } catch (err) { e = null; } finally { g.levelInfo = li; g.players = pl; }
    this.cache[k] = e;
    return e;
  }

  layout() {
    const v = this.g.view, u = uiScale(v);
    const k = clamp(Math.min(v.W / 1100, v.H / 760), 0.45, 4.5);
    return { u, k, cw: 250 * k, ch: 372 * k, gap: 24 * k, cy: v.H * 0.57 };
  }
  tabRects() {
    const v = this.g.view, u = uiScale(v), w = 168 * u, h = 44 * u, gap = 8 * u, n = TABS.length;
    const x0 = v.W / 2 - (n * w + (n - 1) * gap) / 2;
    return TABS.map((_, i) => [x0 + i * (w + gap), v.H * 0.13, w, h]);
  }
  setTab(i) { i = (i + TABS.length) % TABS.length; if (i === this.tab) return; this.tab = i; this.sel = 0; this.scroll = 0; sfx.move(); }

  // returns 'back' when the player leaves
  update(dt) {
    this.t += dt;
    const g = this.g, m = input.mouse, mx = m.x * g.view.dpr, my = m.y * g.view.dpr, click = m.clicked, n = TABS[this.tab].list.length;
    if (input.pressed('back')) { input.eat('back'); sfx.flip(); return 'back'; }
    if (input.pressed('up') || input.pressed('L1')) this.setTab(this.tab - 1);
    if (input.pressed('down') || (input.pressed('R1') && !click)) this.setTab(this.tab + 1);
    if (input.pressed('left') && this.sel > 0) { this.sel--; sfx.move(); }
    if (input.pressed('right') && this.sel < n - 1) { this.sel++; sfx.move(); }
    if (m.wheel) { const d = Math.sign(m.wheel); const s = clamp(this.sel + d, 0, n - 1); if (s !== this.sel) { this.sel = s; sfx.move(); } m.wheel = 0; }
    if (click) {
      const inR = (q) => mx > q[0] && mx < q[0] + q[2] && my > q[1] && my < q[1] + q[3];
      this.tabRects().forEach((q, i) => { if (inR(q)) this.setTab(i); });
      const L = this.layout(); // click a panel to bring it to the middle
      for (let i = 0; i < n; i++) { const x = g.view.W / 2 + (i - this.scroll) * (L.cw + L.gap); if (Math.abs(mx - x) < L.cw / 2 && Math.abs(my - L.cy) < L.ch / 2 && i !== this.sel) { this.sel = i; sfx.move(); } }
    }
    this.scroll = lerp(this.scroll, this.sel, 1 - Math.exp(-12 * dt));
    return null;
  }

  draw(ctx) {
    const g = this.g, v = g.view, L = this.layout(), u = L.u, t = this.t, pad = input.players[0].mode === 'pad', T = TABS[this.tab];
    ctx.fillStyle = 'rgba(8,6,14,0.84)'; ctx.fillRect(0, 0, v.W, v.H);
    outlinedText(ctx, '鬼  Enemies', v.W / 2, v.H * 0.065, 34 * u, '#f8f0de', 'rgba(10,6,12,0.9)', 800, FONT_SERIF, 5);
    this.tabRects().forEach(([x, y, w, h], i) => {
      const on = i === this.tab;
      ctx.fillStyle = on ? 'rgba(200,48,46,0.92)' : 'rgba(24,18,30,0.88)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = on ? '#f4d690' : 'rgba(232,196,112,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      text(ctx, TABS[i].jp, x + 20 * u, y + h / 2, 17 * u, on ? '#fff4d8' : '#e8c470', 800, FONT_SERIF);
      text(ctx, TABS[i].name, x + 38 * u, y + h / 2 - 7 * u, 13.5 * u, '#fff8e8', 800, FONT_SANS, 'left');
      text(ctx, TABS[i].sub, x + 38 * u, y + h / 2 + 9 * u, 10 * u, on ? '#ffe2c0' : 'rgba(248,240,222,0.6)', 700, FONT_SANS, 'left');
    });
    const n = T.list.length;
    for (let i = 0; i < n; i++) {
      const x = v.W / 2 + (i - this.scroll) * (L.cw + L.gap);
      if (x < -L.cw || x > v.W + L.cw) continue;
      const on = i === this.sel;
      ctx.save(); ctx.translate(x, L.cy - (on ? 10 * L.k : 0)); ctx.scale(on ? 1.05 : 0.93, on ? 1.05 : 0.93);
      ctx.globalAlpha = on ? 1 : 0.72;
      this.drawPanel(ctx, T.list[i], T.level, L.cw, L.ch, L.k, t + i * 0.37, on);
      ctx.restore();
    }
    text(ctx, `${this.sel + 1} / ${n}`, v.W / 2, L.cy + L.ch * 0.56 + 22 * u, 13 * u, 'rgba(248,240,222,0.7)', 700);
    text(ctx, pad ? 'LB / RB area · ◀▶ browse · Ⓑ back' : 'Q / J or click: area · ←→ browse · Esc back', v.W / 2, v.H - 20 * u, 12 * u, 'rgba(248,240,222,0.6)', 700);
  }

  // one enemy: the figure on a dark stage, then name, tags, numbers and how it fights
  drawPanel(ctx, type, level, w, h, k, t, on) {
    const boss = Object.values(BOSSES).find((b) => b.type === type), cfg = boss || ENEMIES[type];
    const x = -w / 2, y = -h / 2;
    ctx.shadowColor = on ? (boss ? 'rgba(255,90,60,0.8)' : 'rgba(255,200,100,0.7)') : 'rgba(0,0,0,0.5)'; ctx.shadowBlur = on ? 36 : 10;
    ctx.fillStyle = '#eee3cc'; ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = boss ? '#8a1a14' : '#2a1e16'; ctx.lineWidth = boss ? 3 : 2; ctx.strokeRect(x, y, w, h);
    // the stage
    const SH = h * 0.52, sx = x + 10 * k, sy = y + 10 * k, sw = w - 20 * k;
    const gr = ctx.createLinearGradient(0, sy, 0, sy + SH);
    gr.addColorStop(0, boss ? '#4a1a22' : '#3a2a40'); gr.addColorStop(1, '#151020');
    ctx.fillStyle = gr; ctx.fillRect(sx, sy, sw, SH);
    const e = this.enemy(type, level);
    if (e) {
      ctx.save(); ctx.beginPath(); ctx.rect(sx, sy, sw, SH); ctx.clip();
      // sized so the figure's height (its look's h, the height its health bar sits at) fills the stage
      let fh = 60; try { const o = LOOKS[type](e, t); fh = o.h || 56; } catch (err) { /* default */ }
      const sc = Math.min(k * 3.0, (SH * 0.62) / fh);
      ctx.translate(0, sy + SH * (type === 'tsubame' ? 1.3 : 0.88)); ctx.scale(sc, sc); ctx.translate(-isoX(e.x, e.y), -isoY(e.x, e.y)); // (the swallow flies: lowered into view)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(isoX(e.x, e.y), isoY(e.x, e.y), e.r * 40, e.r * 16, 0, 0, Math.PI * 2); ctx.fill();
      try { e.draw(ctx, t); } catch (err) { /* (a look that needs a running level: just no figure) */ }
      ctx.restore();
    }
    if (cfg.jp) text(ctx, cfg.jp, x + w - 16 * k, y + 28 * k, 16 * k, '#f4e6c8', 800, FONT_SERIF, 'right');
    // name and tags
    let ty = sy + SH + 24 * k;
    let ns = 19 * k; ctx.font = `800 ${ns}px ${FONT_SERIF}`; while (ctx.measureText(cfg.name).width > w - 24 * k && ns > 12 * k) { ns -= 0.5 * k; ctx.font = `800 ${ns}px ${FONT_SERIF}`; }
    text(ctx, cfg.name, 0, ty, ns, '#2a1e16', 800, FONT_SERIF);
    if (boss && boss.title) { ty += 18 * k; text(ctx, boss.title, 0, ty, 11 * k, '#7a2a20', 700, FONT_SANS); }
    const tags = [];
    if (boss) tags.push(['Boss', '#b8302a']);
    if (!boss && cfg.heavy) tags.push(['Heavy', '#7a4a1a']);
    if (!boss && cfg.shield) tags.push(['Shield', '#3a5a7a']);
    if (!boss && cfg.behavior === 'caster') tags.push(['Magic', '#6a3aa0']);
    if (!boss && cfg.dodge) tags.push(['Dodges', '#2a7a4a']);
    if (!boss && cfg.support) tags.push(['Support', '#c8641e']);
    if (!boss && (cfg.proj || cfg.behavior === 'ranged' || cfg.behavior === 'lob' || cfg.behavior === 'hunter')) tags.push(['Ranged', '#4a5a2a']);
    if (tags.length) {
      ty += 22 * k;
      ctx.font = `800 ${10 * k}px ${FONT_SANS}`;
      const tw = tags.map(([s]) => ctx.measureText(s).width + 14 * k), total = tw.reduce((a, b) => a + b, 0) + (tags.length - 1) * 6 * k;
      let tx = -total / 2;
      tags.forEach(([s, col], i) => { ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(tx, ty - 9 * k, tw[i], 18 * k, 4 * k); ctx.fill(); text(ctx, s, tx + tw[i] / 2, ty + 0.5, 10 * k, '#fff8e8', 800); tx += tw[i] + 6 * k; });
    }
    // numbers at the start of the area
    ty += 24 * k;
    const hp = e ? e.hpMax : cfg.hp, hit = e && !boss ? cfg.dmg * e.dmgMul : null;
    const lx = x + 18 * k, rx = x + w - 18 * k;
    text(ctx, 'Health', lx, ty, 11 * k, '#5a4a40', 700, FONT_SANS, 'left'); text(ctx, `${Math.round(hp)}`, lx + 48 * k, ty, 13 * k, '#2a1e16', 800, FONT_SANS, 'left');
    if (hit) { text(ctx, 'Hit', rx - 44 * k, ty, 11 * k, '#5a4a40', 700, FONT_SANS, 'right'); text(ctx, `${Math.round(hit)}`, rx, ty, 13 * k, '#b8302a', 800, FONT_SANS, 'right'); }
    // how it fights
    ty += 22 * k;
    ctx.font = `700 ${11 * k}px ${FONT_SANS}`;
    for (const line of wrap(ctx, DESC[type] || '', w - 32 * k).slice(0, 4)) { text(ctx, line, 0, ty, 11 * k, '#4a3a30', 700); ty += 15 * k; }
  }
}

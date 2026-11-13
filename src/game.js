// Game orchestration: states, level flow, spawning, combat glue, camera and rendering.
import { TAU, clamp, lerp, rand, pick, ease, isoX, isoY, screenToWorld, dist, angDiff } from './util.js';
import { ENEMIES, BOSSES, BIOME_POOLS, levelBudget, PLAYER_BASE, COOP_BOSS_HP, COOP_ENEMY_COUNT, ELEMENTS, ELEMENT_RULES, HEAVY_WEIGHT, heavyCap, SHIELD, DROPS } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemy, updateProjectiles, updateHazards, drawHazards, drawProjectiles, drawProjectileShadows } from './enemies.js';
import { Particles, Decals, Effects } from './particles.js';
import { CardScreen, rollUpgrades, applyUpgrade, drawIcon } from './cards.js';
import { Overlay, drawHUD, drawBanners, drawDebug, drawBossIntro } from './ui.js';
import { Menu } from './menu.js';
import { input } from './input.js';
import { sfx, music } from './audio.js';
import { net } from './net.js';
import { OnlineHost, OnlineClient, smoothPuppets } from './online.js';
import { updateAllies } from './talents.js';
import { Nav } from './nav.js';
import { Monk, MONK_LEVELS, rollSacrifices, takeSacrifice, SACRIFICES } from './sacrifice.js';
import { Dialogue } from './dialogue.js';
import { storyLines } from './story.js';
import { IntroCutscene } from './cutscene.js';

export const FINAL_LEVEL = 33;
// level -> biome: 1-10 spring, 11-20 autumn, 21-30 winter, 31+ the Kagerō fortress
export const biomeOf = (n) => (n > 30 ? 3 : Math.floor((n - 1) / 10));

const INTRO_DUR = 4.8;

class Spawner {
  constructor(g, level) {
    this.g = g; this.level = level; this.t = 0; this.waves = []; this.pending = []; this.waveIdx = 0; this.lastWaveT = 0; this.lastWaveCount = 0;
    if (BOSSES[level]) { this.boss = BOSSES[level]; this.bossDone = false; return; }
    const biome = biomeOf(level);
    const pool = BIOME_POOLS[biome].filter((t) => ENEMIES[t].minLevel <= level);
    let budget = levelBudget(level) * (g.players.length > 1 ? COOP_ENEMY_COUNT : 1);
    const list = [];
    const cap = heavyCap(level, g.players.length > 1);
    let heavies = 0;
    while (budget > 0.5) {
      const affordable = pool.filter((t) => ENEMIES[t].cost <= budget && (!ENEMIES[t].heavy || heavies < cap));
      if (!affordable.length) break;
      // newer types are a bit rarer, cheap fodder more common, big tanks rare
      const weights = affordable.map((t) => (t === 'bandit' ? 1.6 : 1) * (level - ENEMIES[t].minLevel < 3 ? 0.6 : 1) * (ENEMIES[t].heavy ? HEAVY_WEIGHT : 1));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      let type = affordable[0];
      for (let i = 0; i < affordable.length; i++) { r -= weights[i]; if (r <= 0) { type = affordable[i]; break; } }
      list.push(type); budget -= ENEMIES[type].cost;
      if (ENEMIES[type].heavy) heavies++;
    }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const nW = level < 3 ? 1 : level < 12 ? 2 : 3;
    for (let w = 0; w < nW; w++) this.waves.push(list.filter((_, i) => i % nW === w));
  }
  remaining() {
    if (this.boss) return this.bossDone ? 0 : 1;
    let n = this.pending.length;
    for (let w = this.waveIdx; w < this.waves.length; w++) n += this.waves[w].length;
    return n;
  }
  get done() { return this.boss ? this.bossDone : this.waveIdx >= this.waves.length && this.pending.length === 0; }
  update(dt) {
    const g = this.g; this.t += dt;
    if (this.boss) {
      if (!this.bossDone && this.t > 0.5) { this.bossDone = true; g.startBossIntro(this.boss); }
      return;
    }
    const alive = g.enemies.filter((e) => !e.dead).length;
    if (this.waveIdx < this.waves.length) {
      const first = this.waveIdx === 0;
      const trigger = first ? this.t > 0.8 : (alive <= Math.max(1, Math.floor(this.lastWaveCount * 0.35)) || this.t - this.lastWaveT > 14) && this.pending.length === 0;
      if (trigger) {
        const wave = this.waves[this.waveIdx++];
        wave.forEach((type, i) => this.pending.push({ type, t: i * 0.22 }));
        this.lastWaveT = this.t; this.lastWaveCount = wave.length;
        if (!first) sfx.spawn();
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]; p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); g.spawnEnemy(p.type); }
    }
  }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = new Particles(); this.decals = new Decals(); this.fx = new Effects();
    this.players = [];
    this.enemies = []; this.projectiles = []; this.hazards = []; this.timers = []; this.banners = [];
    this.allies = []; this.warpT = 0; this.warpScale = 1; this.pickups = [];
    this.cam = { x: 0, y: 0, zoom: 1 }; this.shakeAmt = 0; this.shakeX = 0; this.shakeY = 0;
    this.hitstopT = 0; this.slowT = 0; this.slowScale = 1;
    this.time = 0; this.realTime = 0;
    this.screenFlash = null; this.screenFlashA = 0;
    this.fade = 0; this.fadeDir = 0;
    this.fps = 60; this.frameMs = 16; this.debug = false;
    const q = new URLSearchParams(location.search);
    this.params = { level: clamp(parseInt(q.get('level') || '1', 10) || 1, 1, 33), god: q.get('god') === '1', weapons: q.get('weapons'), monk: q.get('monk') === '1' };
    this.god = this.params.god;
    try { this.best = parseInt(localStorage.getItem('kage.best') || '0', 10) || 0; } catch (e) { this.best = 0; }
    this.menu = new Menu(this); this.cards = new CardScreen(this); this.overlay = new Overlay(this);
    this.view = { W: 1, H: 1, dpr: 1, s: 1, baseS: 1, k: 1, camX: 0, camY: 0, dcx: 0, dcy: 0 };
    this.view.toScreen = (x, y, z = 0) => [this.view.W / 2 + (isoX(x, y) - this.view.camX) * this.view.s + this.shakeX, this.view.H / 2 + (isoY(x, y, z) - this.view.camY) * this.view.s + this.shakeY];
    this.view.toScreenY = (x, y, z = 0) => this.view.H / 2 + (isoY(x, y, z) - this.view.camY) * this.view.s;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.toTitle();
    // invite link: ?join=KEY goes straight to joining that game
    const joinKey = q.get('join');
    if (joinKey) { this.menu.mode = 'join'; this.menu.startJoin(joinKey); history.replaceState(null, '', location.pathname); }
    // test shortcut: ?weapons=katanas,knives  or co-op: ?weapons=katanas,knives;heavy,crossbow
    else if (this.params.weapons) {
      const sets = this.params.weapons.split(';').map((s) => s.split(','));
      if (sets.every((s) => s.length === 2)) this.startRun(sets);
    }
  }

  get player() { return this.players[0]; }
  get inputLocked() { return this.state === 'intro' || this.state === 'dialogue' || this.state === 'cutscene' || this.state === 'preview' || (this.role === 'client' && (this.paused || this.state === 'cards')); }
  // the ninja controlled on this machine (the joiner plays player 2)
  localPlayer() { return this.role === 'client' ? this.players[1] : this.players[0]; }
  alivePlayers() { return this.players.filter((p) => p.active); } // standing (not dead, not downed)

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = innerWidth, h = innerHeight;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    const zoom = clamp(Math.min(w / 1280, h / 760) * 1.3, 0.75, 2.4);
    Object.assign(this.view, { W: this.canvas.width, H: this.canvas.height, dpr, zoom, baseS: zoom * dpr, s: zoom * dpr * this.cam.zoom, k: zoom * dpr });
    if (this.world) this.world.buildGround(this.groundScale());
    if (this.cards.active) this.cards.layout();
  }

  groundScale() { return Math.min(1.5, this.view.baseS); }

  mouseWorld() {
    const v = this.view;
    const sx = (input.mouse.x * v.dpr - v.W / 2 - this.shakeX) / v.s + v.camX;
    const sy = (input.mouse.y * v.dpr - v.H / 2 - this.shakeY) / v.s + v.camY + 0.5 * 32; // aim at chest height
    return screenToWorld(sx, sy);
  }

  // ---------------------------------------------------------------- flow
  toTitle() {
    this.state = 'title'; this.paused = false; this.hostPaused = false;
    if (this.online) net.close();
    this.online = null; this.role = 'solo';
    this.menu.reset();
    this.players = []; this.level = 1; input.coop = false;
    this.enemies = []; this.projectiles = []; this.hazards = []; this.banners = []; this.timers = [];
    this.world = new World(1, Math.floor(Math.random() * 3), Math.floor(Math.random() * 1e9));
    this.world.buildGround(this.groundScale());
    this.titleT = 0; this.cam.zoom = 1;
    this.inRun = false; this.preview = null;
    this.bossRef = null; this.intro = null;
  }

  // weaponSets: [[w1, w2]] for solo, [[w1, w2], [w3, w4]] for co-op
  // role: 'solo' | 'local' (same screen) | 'host' / 'client' (online)
  startRun(weaponSets, role = null, startLevel = null) {
    if (typeof weaponSets[0] === 'string') weaponSets = [weaponSets];
    this.role = role || (weaponSets.length > 1 ? 'local' : 'solo');
    input.coop = this.role === 'local';
    this.players = weaponSets.map((ws, i) => new Player(this, ws, i));
    if (this.role === 'host') { this.players[1].remote = true; this.online = new OnlineHost(this); }
    if (this.role === 'client') {
      const me = this.players[1];
      me.netClient = true; me.ctl = input.players[0];
      this.players[0].puppet = true;
      this.online = new OnlineClient(this);
    }
    this.runStats = { kills: 0, time: 0, damage: 0, upgrades: 0 };
    this.state = 'play';
    this.monkVisited = new Set(); this.monkActive = false; // per run (a new run meets every monk again)
    const first = startLevel || this.params.level;
    this.runStart = first;
    if (this.role !== 'client' && first === 1) this.playIntro();
    else if (this.role !== 'client') this.loadLevel(first);
    else { this.state = 'transition'; this.fade = 1; } // wait for the host's first level
  }

  loadLevel(n, seed = Math.floor(Math.random() * 1e9)) {
    this.level = n;
    const bi = biomeOf(n);
    if (this.role === 'client') { this.state = 'play'; this.cards.active = false; this.cutscene = null; this.dialogue = null; }
    this.world = new World(n, bi, seed, { hall: !!(BOSSES[n] && BOSSES[n].hall) });
    this.inRun = true; this.preview = null;
    this.world.buildGround(this.groundScale());
    this.nav = new Nav(this);
    this.enemies = []; this.projectiles = []; this.hazards = []; this.timers = [];
    this.allies = []; this.warpT = 0; this.monk = null; this.sacPending = null; this.monkActive = false; this.pickups = [];
    this.particles.list.length = 0; this.decals.list.length = 0;
    this.fx = new Effects();
    this.players.forEach((p, i) => p.resetForLevel(this.world.spawn.x + i * 0.9, this.world.spawn.y - i * 0.9));
    this.spawner = new Spawner(this, n);
    this.cleared = false; this.bossRef = null; this.bossTrail = null; this.intro = null;
    const c = this.playersCenter();
    this.cam.x = c[0]; this.cam.y = c[1];
    const b = this.world.biome;
    if (!BOSSES[n]) {
      if (n % 10 === 1 || n === this.runStart) this.banner({ title: b.name, sub: `Level ${n}`, kanji: b.jp.slice(0, 2), dur: 2.8 });
      else this.banner({ title: `Level ${n}`, sub: b.name, dur: 2 });
      if (this.role !== 'client') this.later(0.6, () => { if (this.state === 'play' && this.level === n && !this.cleared) this.say(`level${n}`); });
    }
    this.fade = 1; this.fadeDir = -1;
    if (this.role === 'host') this.online.levelLoaded(n, seed);
    // first level of an area: its boss steps out of the gate and says a word before the fight starts
    if (this.role !== 'client' && !BOSSES[n] && (n === 1 || n === 11 || n === 21 || n === 31)) this.startPreview(bi);
    const legit = this.runStart === 1 && !this.god;
    if (legit && n > this.best) { this.best = n; try { localStorage.setItem('kage.best', String(n)); } catch (e) { /* storage unavailable */ } }
  }

  onLevelCleared() {
    this.cleared = true;
    sfx.gong();
    this.slow(1.0, 0.25);
    // clearing the level picks up anyone who is down
    for (const p of this.players) if (p.downed) { p.downed = false; p.hp = PLAYER_BASE.reviveHp; p.iframes = 2; this.fx.ring(p.x, p.y, 1.6, 'rgba(140,255,170,0.9)', 0.6, 5); }
    const heal = PLAYER_BASE.clearHeal;
    if (heal > 0) for (const p of this.alivePlayers()) { p.heal(heal); this.fx.text(p.x, p.y, `+${heal}`, '#7dff9a', 18); }
    const boss = BOSSES[this.level];
    if (boss && boss.type === 'gensai') { this.gensaiFalls(); return; }
    this.banner({ title: boss ? 'Boss Defeated' : 'Level Cleared', sub: boss ? boss.name : heal > 0 ? `+${heal} health restored` : 'Well fought', kanji: '斬', dur: 2.2, y: 0.32 });
    if (this.level >= FINAL_LEVEL) { this.later(2.2, () => this.victory()); return; }
    // a boss has a few last words before the blessings
    if (boss) { this.later(1.6, () => this.say(`${boss.type}_after`, () => this.offerBlessings(0.4))); return; }
    this.offerBlessings(1.5);
  }

  offerBlessings(delay) {
    if (this.role === 'host') {
      // online: both players pick at the same time on their own screens
      this.later(delay, () => {
        if (this.state !== 'play' || !this.alivePlayers().length) return;
        this.pendingPicks = new Set([0]);
        const rp = this.players[1];
        if (net.connected && !rp.disconnected) { this.pendingPicks.add(1); this.remoteCards = rollUpgrades(rp); this.online.sendCards(this.remoteCards); }
        const p = this.players[0];
        this.state = 'cards';
        this.cards.open(rollUpgrades(p), (card) => {
          applyUpgrade(p, card); this.runStats.upgrades++;
          this.state = 'play'; this.pendingPicks.delete(0);
          if (this.pendingPicks.size) this.banner({ title: 'Waiting for Player 2…', dur: 2, y: 0.25, size: 24 });
          this.checkPicksDone();
        }, p);
      });
      return;
    }
    // same screen: every player (downed ones too) picks a blessing, one after another
    const pickFor = (i) => {
      if (i >= this.players.length) { this.afterPicks(); return; }
      const p = this.players[i];
      this.state = 'cards';
      this.cards.open(rollUpgrades(p), (card) => { applyUpgrade(p, card); this.runStats.upgrades++; pickFor(i + 1); }, p);
    };
    this.later(delay, () => { if (this.state === 'play' && this.alivePlayers().length) pickFor(0); });
  }

  // ---------------------------------------------------------------- music
  // menu music on the title, weapon select and opening cutscene; the area's track during a run.
  // Blessing / sacrifice cards and dialogue muffle it (low-pass) without stopping it.
  updateMusic() {
    const menu = this.state === 'title' || this.state === 'cutscene' || !this.inRun || !this.world;
    music.set(menu ? 'main_menu' : `biome_${Math.min(3, this.world.bi) + 1}`);
    music.muffle(!menu && (this.state === 'cards' || this.state === 'dialogue'));
  }

  // ---------------------------------------------------------------- area boss preview
  startPreview(bi) {
    const cfg = [BOSSES[10], BOSSES[20], BOSSES[30], BOSSES[33]][bi];
    if (!cfg) return;
    const w = this.world, gt = w.gate;
    const e = new Enemy(this, cfg.type, gt.x, gt.y, this.level);
    e.state = 'intro'; e.introVis = { alpha: 0 }; e.preview = true;
    let dx = w.spawn.x - gt.x, dy = w.spawn.y - gt.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    e.face(dx, dy);
    this.enemies.push(e);
    this.preview = { t: 0, e, dx, dy, x0: gt.x, y0: gt.y, said: false, leave: -1 };
    this.state = 'preview';
  }

  updatePreview(dt) {
    const P = this.preview;
    if (!P) { this.state = 'play'; return; }
    const e = P.e, iv = e.introVis;
    P.t += dt;
    if (P.leave < 0) {
      // walk forward through the gate
      const k = clamp((P.t - 0.3) / 2.0, 0, 1), dist0 = e.type === 'oni_lord' ? 2.6 : 3.2;
      e.x = P.x0 + P.dx * dist0 * ease.outCubic(k); e.y = P.y0 + P.dy * dist0 * ease.outCubic(k);
      e.moveAmt = k > 0 && k < 0.95 ? 1 : 0; e.walk += dt * 7 * e.moveAmt;
      iv.alpha = clamp(P.t / 0.6, 0, 1);
      if (e.type === 'tengu') { e.z = 0.8 + Math.sin(P.t * 3) * 0.15; iv.flap = 12; }
      if (P.t > 2.4 && !P.said) { P.said = true; this.say(`preview_${e.type}`, () => { if (this.preview === P) P.leave = 0; }); return; }
      if (P.t > 0.8 && (input.pressed('confirm') || input.pressed('pause'))) { input.eat('confirm'); input.eat('pause'); P.leave = 0; }
    } else {
      // vanish in smoke and hand the level over to the players
      if (P.leave === 0) { sfx.dash(); this.particles.burst('smoke', e.x, e.y, 0.6, 22, 2.2, 1.2, 10, 'rgba(30,20,30,1)'); }
      P.leave += dt;
      iv.alpha = clamp(1 - P.leave / 0.35, 0, 1);
      if (P.leave > 0.6) {
        this.enemies = this.enemies.filter((o) => o !== e);
        this.preview = null; this.state = 'play';
      }
    }
    // camera: drift toward the boss, then back to the players as he leaves
    const bx = isoX(e.x, e.y), by = isoY(e.x, e.y, 1.2);
    const [px, py] = this.playersCenter();
    const k = P.leave >= 0 ? 0.2 : clamp(P.t / 1.2, 0, 1) * 0.75;
    this.moveCamera(lerp(px, bx, k), lerp(py, by, k), dt * 0.6);
    this.updateWorldAmbient(dt, false);
  }

  // ---------------------------------------------------------------- story
  // the opening cutscene, then level 1
  playIntro() {
    this.state = 'cutscene'; this.fade = 0; this.fadeDir = 0;
    this.cutscene = new IntroCutscene(this, () => {
      this.cutscene = null; this.state = 'play';
      if (this.role === 'host') net.send('dlgend', { id: 'intro' });
      this.loadLevel(1);
    });
    if (this.role === 'host') {
      net.send('cut', {});
      this.cutscene.onLine = (i) => net.send('dlg', { id: 'intro', i });
    }
  }

  // show a script (if one exists for this team), pausing play; then() runs afterwards
  say(id, then = () => {}) {
    const lines = storyLines(id, this.players.length > 1);
    if (!lines.length || this.role === 'client') { then(); return; }
    const back = this.state === 'dialogue' ? 'play' : this.state;
    this.state = 'dialogue';
    this.dialogue = new Dialogue(this);
    this.dialogue.open(id, lines, () => {
      this.dialogue = null; this.state = back;
      if (this.role === 'host') net.send('dlgend', { id });
      then();
    }, (i) => { if (this.role === 'host') net.send('dlg', { id, i }); });
  }

  // joiner: mirror the host's dialogue / cutscene
  onRemoteDialogue(m) {
    if (m.id === 'intro') {
      if (!this.cutscene) this.onRemoteCutscene();
      const d = this.cutscene.dlg;
      if (d.active && d.i !== m.i) d.go(m.i);
      return;
    }
    if (!this.dialogue || this.dialogue.id !== m.id) {
      const lines = storyLines(m.id, this.players.length > 1);
      if (!lines.length) return;
      this.dialogue = new Dialogue(this, { remote: true });
      this.dialogue.onRemoteNext = () => net.send('dlgnext', {});
      this.dialogue.open(m.id, lines, () => { this.dialogue = null; if (this.state === 'dialogue') this.state = 'play'; });
      if (this.state === 'play') this.state = 'dialogue';
    }
    if (this.dialogue.i !== m.i) this.dialogue.go(m.i);
  }
  onRemoteCutscene() {
    this.state = 'cutscene'; this.fade = 0;
    this.cutscene = new IntroCutscene(this, () => { this.cutscene = null; this.state = 'transition'; this.fade = 1; }, { remote: true });
    this.cutscene.dlg.onRemoteNext = () => net.send('dlgnext', {});
  }
  onRemoteDialogueEnd(m) {
    if (m.id === 'intro') { if (this.cutscene) this.cutscene.titleT = Math.max(this.cutscene.titleT, 0); return; }
    this.dialogue = null;
    if (this.state === 'dialogue') this.state = 'play';
  }
  // host: the joiner pressed confirm
  onRemoteNext() {
    if (this.cutscene && this.cutscene.titleT < 0) this.cutscene.dlg.advance();
    else if (this.dialogue) this.dialogue.advance();
  }

  openGate() {
    // the way on only opens once the monk of this level has been met and his offer answered
    if (this.monkActive) return;
    if (this.monkDue() && this.alivePlayers().length) { this.monkVisited.add(this.level); this.startMonk(); return; }
    this.state = 'play';
    this.world.gate.active = true;
    sfx.gate();
    this.banner({ title: 'The torii gate opens', sub: 'Walk through it to continue', dur: 2.2, y: 0.25, size: 26 });
  }

  // ---------------------------------------------------------------- wandering monk
  // after everyone picked a blessing: on levels 5/15/25 the monk visits first, otherwise the gate opens
  monkDue() {
    this.monkVisited = this.monkVisited || new Set();
    return (MONK_LEVELS.includes(this.level) || this.params.monk) && !this.monkVisited.has(this.level);
  }
  afterPicks() {
    if (!this.monkDue() || !this.alivePlayers().length) { this.openGate(); return; }
    this.monkVisited.add(this.level);
    this.startMonk();
  }

  startMonk() {
    const w = this.world, ps = this.alivePlayers();
    const px = ps.reduce((a, p) => a + p.x, 0) / ps.length, py = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    const doors = w.doors().filter((d) => !w.blocked(d.ox, d.oy, 0.4)).sort((a, b) => dist(a.ox, a.oy, px, py) - dist(b.ox, b.oy, px, py));
    const door = doors.find((d) => dist(d.ox, d.oy, px, py) > 2.5) || doors[0] || null;
    this.state = 'play';
    this.monk = new Monk(this, door);
    this.monkActive = true;
    sfx.chime(1);
    this.banner({ title: 'A wandering monk approaches…', sub: 'He offers power, for a price', kanji: '僧', dur: 2.6, y: 0.3, size: 28 });
    this.monk.onArrive = () => this.later(0.6, () => this.say(`monk${this.monk ? this.monk.bi : 0}`, () => this.offerSacrifices())); // speak once he reaches you
  }

  offerSacrifices() {
    const coop = this.players.length > 1;
    this.sacChoices = new Map();
    if (this.role === 'host') { // online: both choose at the same time on their own screens
      this.sacPending = new Set([0]);
      const rp = this.players[1];
      if (net.connected && !rp.disconnected) { this.sacPending.add(1); this.online.sendSac(rollSacrifices(rp, coop)); }
      const p = this.players[0];
      this.state = 'cards';
      this.cards.open(rollSacrifices(p, coop), (card) => {
        this.state = 'play'; this.sacChoices.set(0, card.key); this.sacPending.delete(0);
        if (this.sacPending.size) this.banner({ title: 'Waiting for Player 2…', dur: 2, y: 0.25, size: 24 });
        this.checkSacDone();
      }, p, { mode: 'sacrifice' });
      return;
    }
    const pickFor = (i) => {
      if (i >= this.players.length) { this.resolveSacrifices(); return; }
      const p = this.players[i];
      this.state = 'cards';
      this.cards.open(rollSacrifices(p, coop), (card) => { this.sacChoices.set(i, card.key); pickFor(i + 1); }, p, { mode: 'sacrifice' });
    };
    pickFor(0);
  }
  onRemoteSacPick(key) {
    if (!this.sacPending || !this.sacPending.has(1) || !SACRIFICES[key]) return;
    this.sacChoices.set(1, key); this.sacPending.delete(1); this.checkSacDone();
  }
  checkSacDone() { if (this.sacPending && this.sacPending.size === 0) { this.sacPending = null; this.resolveSacrifices(); } }

  resolveSacrifices() {
    this.state = 'play';
    const chose = (k) => this.players.filter((p) => this.sacChoices.get(p.index) === k);
    const pact = this.players.length > 1 && chose('boundSouls').length === this.players.length;
    for (const p of this.players) {
      const key = this.sacChoices.get(p.index);
      if (!key) continue;
      if (SACRIFICES[key].pact && !pact) continue; // a pact needs both players
      takeSacrifice(p, key);
      if (SACRIFICES[key].pact) SACRIFICES[key].apply(p);
      this.fx.text(p.x, p.y, SACRIFICES[key].title, '#ff9a8a', 15, true);
      this.particles.burst('glow', p.x, p.y, 0.8, 18, 2.5, 1, 2.4, '#ff6a6a');
    }
    if (pact) this.banner({ title: 'Your souls are bound', sub: 'Every wound is now shared', kanji: '縁', dur: 2.4, y: 0.3, size: 26 });
    else if (chose('boundSouls').length) this.banner({ title: 'The pact fades', sub: 'Bound Souls needs both of you', dur: 2.4, y: 0.3, size: 24, color: 'rgba(60,4,10,0.8)' });
    sfx.gong(); this.flashScreen('rgba(160,20,30,0.3)');
    if (this.monk) this.monk.leave();
    this.monkActive = false;
    this.later(1.6, () => this.openGate());
  }

  // joiner: the host sent our two sacrifice offers
  openClientSac(cards) {
    const me = this.localPlayer();
    this.state = 'cards';
    this.cards.open(cards, (card) => {
      net.send('sacpick', { key: card.key });
      this.state = 'play';
      this.banner({ title: 'Sacrifice chosen', sub: 'Waiting for the host…', dur: 2, y: 0.25, size: 24 });
    }, me, { mode: 'sacrifice' });
  }

  // host: the joiner chose card `index` from the cards we sent
  onRemotePick(index) {
    if (!this.pendingPicks || !this.pendingPicks.has(1) || !this.remoteCards) return;
    const card = this.remoteCards[index];
    if (card) { applyUpgrade(this.players[1], card); this.runStats.upgrades++; }
    this.pendingPicks.delete(1);
    this.checkPicksDone();
  }
  checkPicksDone() {
    if (this.pendingPicks && this.pendingPicks.size === 0) { this.pendingPicks = null; this.afterPicks(); }
  }

  // joiner: the host sent our card choices
  openClientCards(cards) {
    const me = this.localPlayer();
    this.state = 'cards';
    this.cards.open(cards, (card) => {
      net.send('pick', { index: card.i });
      this.state = 'play';
      this.banner({ title: 'Blessing chosen', sub: 'Waiting for the host…', dur: 2, y: 0.25, size: 24 });
    }, me);
  }

  enterGate() {
    if (this.state !== 'play') return;
    this.state = 'transition'; this.fadeDir = 1; this.fade = 0;
    sfx.gate();
  }

  onPlayerDeath(p) {
    if (this.alivePlayers().length === 0) {
      this.slow(1.6, 0.2);
      this.banner({ title: 'You have fallen', kanji: '死', dur: 2.2, y: 0.32, color: 'rgba(60,4,10,0.85)' });
      this.later(1.4, () => { this.state = 'dead'; this.overlay.t = 0; this.overlay.sel = 0; });
    } else {
      p.returnLevel = this.level + PLAYER_BASE.coopReturnAfter;
      this.banner({ title: `Player ${p.index + 1} has fallen`, sub: `They return at level ${p.returnLevel}`, dur: 2.6, y: 0.25, size: 26, color: 'rgba(60,4,10,0.8)' });
    }
  }

  victory() { this.state = 'victory'; this.overlay.t = 0; sfx.chime(3); }

  // Gensai at 0 HP: he drops to one knee (and stays) while his remaining guard fights on
  gensaiDown(e) {
    e.dead = true; e.kneel = true; e.deathT = 0; e.tele = null; e.vx = e.vy = 0; e.poison = null; e.guarded = false; e.flash = 0; e.slowT = 0;
    this.runStats.kills++;
    this.hitstop(0.2); this.shake(16); this.slow(1.4, 0.2);
    sfx.iaiCut(); sfx.bossRoar(); this.flashScreen('rgba(255,255,255,0.6)');
    this.fx.ring(e.x, e.y, 4, 'rgba(255,120,140,0.9)', 0.8, 9);
    this.particles.burst('ink', e.x, e.y, 0.8, 30, 4, 0.8, 6, '#1e1428');
    this.hazards = this.hazards.filter((h) => h.kind === 'fire');
    for (const q of this.projectiles) if (q.owner === 'enemy') q.dead = true;
    const left = this.enemies.some((o) => !o.dead);
    this.banner({ title: 'The regent falls to his knees', sub: left ? 'Defeat his last guards' : null, dur: 2.6, y: 0.24, size: 26, color: 'rgba(90,10,10,0.8)' });
  }

  // every guard is down: Gensai's last words, then he falls and the run is won
  gensaiFalls() {
    const e = this.enemies.find((o) => o.type === 'gensai');
    this.later(1.4, () => this.say('gensai_death', () => {
      if (e) {
        e.kneel = false; e.deathT = 0.2;
        this.particles.burst('smoke', e.x, e.y, 0.6, 26, 2.5, 1.6, 12, 'rgba(30,20,30,1)');
        this.particles.burst('glow', e.x, e.y, 0.8, 20, 3, 1.2, 2.6, '#ff8a9a');
      }
      sfx.gong(); this.shake(8);
      this.banner({ title: 'Gensai has fallen', sub: 'The Kagerō are free', kanji: '終', dur: 3.2, y: 0.32 });
      this.later(3.2, () => this.victory());
    }));
  }

  // ---------------------------------------------------------------- spawning
  // Enemies step out of house doorways; fall back to an ink portal if no door is usable.
  spawnEnemy(type) {
    const w = this.world, r = ENEMIES[type].r;
    const doors = w.doors().filter((d) => !w.blocked(d.ox, d.oy, r + 0.1) && this.players.every((p) => p.dead || dist(p.x, p.y, d.ox, d.oy) > 3.5));
    if (doors.length) {
      const d = pick(doors);
      d.house.doorT = 1.6;
      const jx = rand(-0.5, 0.5);
      const e = new Enemy(this, type, d.x, d.y, this.level);
      e.emerge = { x0: d.x + jx * 0.3, y0: d.y, x1: d.ox + jx, y1: d.oy + rand(0, 0.5) };
      e.t = e.spawnDur = 0.85;
      this.addEnemy(e);
      this.particles.burst('dust', d.ox, d.oy, 0.1, 4, 1.2, 0.5, 4, w.bi === 2 ? '#eef3fb' : '#c8b088', { under: true });
      sfx.spawn();
      return e;
    }
    const c = this.playersCenter(true);
    const [x, y] = w.randomFreePoint(c[0], c[1], 5.5, r + 0.2);
    const e = new Enemy(this, type, x, y, this.level);
    this.addEnemy(e);
    this.particles.burst('smoke', x, y, 0.3, 6, 1.5, 0.7, 7, 'rgba(50,35,60,1)');
    return e;
  }

  startBossIntro(cfg) {
    const N = this.world.N;
    const hall = this.world.hall;
    const e = new Enemy(this, cfg.type, hall ? hall.throne.x : N / 2 - 1.5, hall ? hall.throne.y : N / 2 - 1.5, this.level);
    if (this.players.length > 1) { e.hpMax = Math.round(e.hpMax * COOP_BOSS_HP); e.hp = e.hpMax; }
    e.state = 'intro'; e.introVis = { hidden: true };
    e.face(1, 1);
    this.addEnemy(e); this.bossRef = e;
    this.intro = { t: 0, boss: e, cfg, fired: {} };
    this.state = 'intro';
    for (const p of this.players) { p.vx = p.vy = 0; p.anim = null; }
  }

  updateIntro(dt) {
    const I = this.intro, e = I.boss, t = I.t, type = e.type;
    I.t += dt;
    const once = (key, at, fn) => { if (t >= at && !I.fired[key]) { I.fired[key] = true; fn(); } };
    const iv = e.introVis;
    once('rumble', 0.2, () => { sfx.bossRoar(); });
    if (type === 'ronin_boss') {
      once('flash', 1.0, () => {
        this.flashScreen('rgba(255,255,255,0.9)'); this.shake(10); sfx.explode(); sfx.gong();
        this.particles.burst('smoke', e.x, e.y, 0.4, 30, 3, 1.4, 12, 'rgba(40,30,40,1)');
        this.particles.burst('petal', e.x, e.y, 1.5, 60, 6, 3, 3, '#f7c3d2');
        this.fx.ring(e.x, e.y, 4, 'rgba(255,255,255,0.9)', 0.6, 8);
      });
      if (t >= 1.0) { iv.hidden = false; iv.alpha = 1; iv.sqy = t < 2.1 ? 0.78 : 1; iv.pose = t < 2.1 ? { kind: 'windup', t: 0.25 } : t < 2.8 ? { kind: 'cast', t: 0.5 } : null; }
    } else if (type === 'tengu') {
      if (t >= 0.7) {
        iv.hidden = false; iv.flap = 18;
        const k = clamp((t - 0.7) / 1.4, 0, 1);
        e.z = lerp(9, 0.8, ease.outCubic(k)); iv.alpha = clamp((t - 0.7) * 3, 0, 1);
        if (Math.random() < 0.6) this.particles.emit('feather', e.x + rand(-3, 3), e.y + rand(-3, 3), rand(3, 6), rand(-1, 1), rand(-1, 1), -1, 2.5, 3, Math.random() < 0.5 ? '#26232e' : '#3d3a48', { drag: 0.5 });
        if (Math.random() < 0.5) this.particles.emit('leaf', e.x + rand(-4, 4), e.y + rand(-4, 4), rand(0.2, 2), rand(-6, 6), rand(-6, 6), 1, 1, 3, pick(['#e0542c', '#f09a34']), { drag: 1 });
      }
      once('land', 2.1, () => { this.shake(9); sfx.slam(); this.fx.ring(e.x, e.y, 5, 'rgba(255,230,200,0.8)', 0.6, 6); });
    } else if (type === 'gensai') {
      // rises from the throne, walks down from the dais, and draws with a crimson flash
      const T = this.world.hall ? this.world.hall.throne : { x: e.x, y: e.y };
      iv.hidden = false; iv.alpha = clamp(t / 0.6, 0, 1);
      const k = clamp((t - 0.6) / 1.4, 0, 1);
      const step = 2.4 * ease.inOutSine(k);
      e.x = T.x + step; e.y = T.y + step;
      e.face(1, 1); e.moveAmt = k > 0 && k < 1 ? 0.8 : 0; e.walk += dt * 7 * (k > 0 && k < 1 ? 1 : 0);
      iv.pose = t < 0.6 ? { kind: 'kneel', t: 0 } : t > 2.2 && t < 3.0 ? { kind: 'iaiCrouch', t: clamp((t - 2.2) / 0.4, 0, 1) } : null;
      once('draw', 2.2, () => sfx.iai());
      once('flash', 3.0, () => {
        this.flashScreen('rgba(200,20,40,0.55)'); this.shake(12); sfx.iaiCut(); sfx.gong();
        this.fx.ring(e.x, e.y, 5, 'rgba(255,60,90,0.9)', 0.8, 9);
        this.particles.burst('glow', e.x, e.y, 1, 40, 5, 1, 2.6, '#ff6a8a');
      });
    } else if (type === 'oni_lord') {
      if (t < 1.0) this.shake(2 + t * 6);
      once('erupt', 1.0, () => {
        this.flashScreen('rgba(255,120,40,0.6)'); this.shake(16); sfx.explode(); sfx.slam();
        this.particles.burst('ember', e.x, e.y, 0.3, 80, 8, 1.6, 3, '#ff8a30');
        this.particles.burst('smoke', e.x, e.y, 0.5, 24, 3, 1.6, 12, 'rgba(40,20,20,1)');
        this.particles.burst('shard', e.x, e.y, 0.2, 20, 7, 1, 4, '#4a3a38', { grav: 18, bounce: true });
        this.decals.add(e.x, e.y, 2, 'rgba(30,10,10,1)', 30);
        this.fx.ring(e.x, e.y, 5.5, 'rgba(255,140,60,0.9)', 0.8, 10);
      });
      if (t >= 1.0) {
        iv.hidden = false;
        const k = clamp((t - 1.0) / 1.0, 0, 1);
        iv.sqy = ease.outBack(k); iv.alpha = clamp(k * 2, 0, 1);
        if (Math.random() < 0.8) this.particles.emit('ember', e.x + rand(-1.5, 1.5), e.y + rand(-1.5, 1.5), rand(0, 1), 0, 0, rand(2, 4), 1, 2.5, '#ff6a20');
      }
    }
    once('roar', 2.2, () => { sfx.bossRoar(); this.shake(12); });
    // skip
    if (t > 1.2 && t < INTRO_DUR - 0.6 && (input.pressed('confirm') || input.pressed('pause'))) { I.t = INTRO_DUR - 0.6; input.eat('confirm'); input.eat('pause'); }
    // camera: look at the boss, then back to the players
    const bx = isoX(e.x, e.y), by = isoY(e.x, e.y, 1.2);
    const [px, py] = this.playersCenter();
    const k = t < INTRO_DUR - 0.7 ? 1 : 1 - (t - (INTRO_DUR - 0.7)) / 0.7;
    this.moveCamera(lerp(px, bx, k), lerp(py, by, k), dt * 0.7);
    this.updateWorldAmbient(dt, false);
    if (I.t >= INTRO_DUR) {
      e.state = 'chase'; e.introVis = null; e.alpha = 1; e.atkCd = 0.8;
      if (type === 'tengu') e.z = 0.8;
      if (type === 'gensai') e.moveAmt = 0;
      this.intro = null; this.state = 'play';
      this.say(`boss_${type}`, () => this.banner({ title: 'Fight!', kanji: '戦', dur: 1.2, y: 0.3 }));
    }
  }

  // ---------------------------------------------------------------- helpers
  addEnemy(e) { this.enemies.push(e); }
  spawnProjectile(o) { o.dead = false; o.seed = o.seed ?? Math.random() * 10; o.screenAng = 0; this.projectiles.push(o); }
  // shake/flashScreen are mirrored to an online partner; local* versions are for this screen only
  shake(a) { this.localShake(a); }
  localShake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  hitstop(s) { this.hitstopT = Math.max(this.hitstopT, s); }
  slow(dur, scale) { this.slowT = dur; this.slowScale = scale; }
  // slows enemies, their projectiles and hazards, but not the players (bo special)
  timeWarp(dur, scale) { this.warpT = Math.max(this.warpT, dur); this.warpScale = scale; }
  flashScreen(color) { this.localFlash(color); }
  localFlash(color) { this.screenFlash = color; this.screenFlashA = 1; }
  later(t, fn) { this.timers.push({ t, fn }); }
  banner(b) { this.banners.push({ t: 0, dur: 2.2, ...b }); }
  bossPhase(e, msg) { this.banner({ title: msg, dur: 1.8, y: 0.22, size: 26, color: 'rgba(90,10,10,0.8)' }); e.flash = 0.25; }

  // src: { player, weapon } for player hits; { chain: true } for lightning; { dot: true } for poison ticks
  damageEnemy(e, dmg, crit, dx, dy, knock, stun, src = null) {
    if (e.dead || e.state === 'intro') return;
    const dot = src && src.dot, chain = src && src.chain;
    // front shield: weapon hits from the front are mostly blocked until the shield breaks
    let blocked = false;
    const S = e.shield;
    if (S && S.up && src && src.weapon && !dot && !chain && (dx || dy)) {
      const fa = Math.atan2(e.faceY, e.faceX), ha = Math.atan2(-dy, -dx);
      if (Math.abs(angDiff(fa, ha)) < SHIELD.arc / 2) {
        blocked = true;
        S.log = S.log.filter((l) => this.time - l.t < SHIELD.burstWindow);
        S.log.push({ t: this.time, d: dmg });
        if (src.melee) S.melee++;
        const burst = S.log.reduce((a, l) => a + l.d, 0);
        dmg = Math.max(1, Math.round(dmg * (1 - SHIELD.block)));
        knock *= 0.3; stun = 0;
        sfx.clang();
        this.particles.burst('spark', e.x + e.faceX * 0.4, e.y + e.faceY * 0.4, 0.7, 6, 5, 0.25, 1.6, '#fff6d0');
        if (S.melee >= SHIELD.meleeHits || burst >= e.hpMax * SHIELD.burstFrac) this.breakShield(e);
      }
    }
    // Gensai's guard ward: far less damage while four or more of his guards stand
    if (e.guarded && !dot) {
      dmg = Math.max(1, Math.round(dmg * 0.4));
      if (Math.random() < 0.15) this.fx.text(e.x, e.y, 'Guarded', '#ffd76a', 12);
    }
    e.hp -= dmg;
    this.runStats.damage += dmg;
    if (dot) {
      this.fx.text(e.x, e.y, `${dmg}`, '#9be86a', 11);
    } else {
      e.flash = 0.09;
      if (!e.boss) {
        e.kvx += dx * knock; e.kvy += dy * knock;
        // Light hits only flinch. Only heavy hits (stun >= 0.3) interrupt attacks,
        // and a staggered enemy can't be re-staggered for a moment, so nothing gets perma-locked.
        const s = stun * (e.type === 'oni' ? 0.4 : 1);
        if (s >= 0.3 && e.poiseT <= 0) { e.stun = Math.max(e.stun, s); e.poiseT = s + 0.8; }
      }
      this.fx.text(e.x, e.y, crit ? `${dmg}!` : `${dmg}`, blocked ? '#9aa4b4' : chain ? '#fff27a' : crit ? '#ffd34a' : '#ffffff', blocked ? 12 : crit ? 19 : chain ? 12 : 14, crit && !blocked);
      const z = e.boss ? 1.2 : 0.6;
      this.particles.burst('spark', e.x, e.y, z, crit ? 9 : 5, crit ? 8 : 5, 0.22, crit ? 2 : 1.4, chain ? '#fff6a0' : crit ? '#ffe680' : '#ffffff');
      if (!chain) this.particles.burst('blood', e.x, e.y, z, 4, 3, 0.45, 2.2, e.type === 'kappa' ? '#2a6a3a' : e.type === 'oni' || e.type === 'oni_lord' ? '#3a0a3a' : '#7a1020', { grav: 10 });
      if (crit) { sfx.crit(); this.hitstop(0.035); this.shake(2.5); } else if (!chain) sfx.hit();
      if (src && src.weapon && !chain) this.applyElements(e, dmg, src);
    }
    if (e.hp <= 0) this.killEnemy(e, dx, dy);
  }

  breakShield(e) {
    const S = e.shield;
    if (!S || !S.up) return;
    S.up = false;
    sfx.slam(); sfx.clang(); this.shake(4); this.hitstop(0.05);
    const col = { pavise: '#9a6a3a', iron: '#5a5e68', shell: '#5a6a3a', bark: '#6a4a2a', bone: '#e0d8c0', ice: '#cfeeff' }[S.kind] || '#888';
    this.particles.burst('shard', e.x + e.faceX * 0.4, e.y + e.faceY * 0.4, 0.7, 16, 5, 0.8, 3.5, col, { grav: 18, bounce: true });
    this.fx.text(e.x, e.y, 'Shield broken!', '#ffd34a', 15, true);
    e.stun = Math.max(e.stun, SHIELD.breakStun); e.poiseT = SHIELD.breakStun + 0.8;
  }

  applyElements(e, dmg, src) {
    const el = src.weapon.elements, R = ELEMENT_RULES;
    const M = (src.player && src.player.elemMul) || 1; // Elemental Covenant
    if (el.syphon > 0 && src.player) { // lifesteal: heal for a share of the damage dealt (fractions carry over)
      const P = src.player;
      // Lifebinder: the heal goes to the partner instead (x1.2)
      const to = P.lifebinder ? this.players.find((q) => q !== P && q.active) : P;
      P.syphonAcc = (P.syphonAcc || 0) + dmg * Math.min(ELEMENTS.syphon.cap, el.syphon * M) * (P.lifebinder ? 1.2 : 1);
      if (P.syphonAcc >= 1) {
        const n = Math.floor(P.syphonAcc); P.syphonAcc -= n;
        if (to && to.heal(n) > 0 && Math.random() < 0.5) this.particles.emit('glow', to.x, to.y, 0.8, 0, 0, 0.8, 0.5, 2.2, '#ff6b8a');
      }
    }
    if (el.poison > 0) {
      const dps = el.poison * M * src.player.stats.baseDamage;
      e.poison = { dps: Math.max(dps, e.poison ? e.poison.dps : 0), t: R.poisonDur, tick: e.poison ? e.poison.tick : R.poisonTick, player: src.player };
    }
    if (el.ice > 0) {
      e.slow = Math.min(ELEMENTS.ice.cap, Math.max(e.slow, el.ice * M)); e.slowT = R.slowDur;
      if (Math.random() < 0.5) this.particles.burst('shard', e.x, e.y, 0.8, 3, 2, 0.4, 2.5, '#cff4ff');
    }
    if (el.lightning > 0) {
      const hit = new Set([e]);
      let from = e;
      for (let n = 0; n < el.lightning * M; n++) {
        let best = null, bd = R.chainRange;
        for (const o of this.enemies) {
          if (o.dead || hit.has(o) || o.state === 'spawn' || o.state === 'intro' || o.hidden) continue;
          const d = dist(from.x, from.y, o.x, o.y);
          if (d < bd) { bd = d; best = o; }
        }
        if (!best) break;
        hit.add(best);
        this.fx.bolt(from.x, from.y, from.boss ? 1.2 : 0.6, best.x, best.y, best.boss ? 1.2 : 0.6);
        this.damageEnemy(best, Math.max(1, Math.round(dmg * R.chainDamage)), false, 0, 0, 0.5, 0, { chain: true, player: src.player });
        from = best;
      }
      if (hit.size > 1) sfx.zap();
    }
  }

  killEnemy(e, dx = 0, dy = 0) {
    if (e.dead) return;
    if (e.type === 'gensai') { this.gensaiDown(e); return; }
    e.dead = true; e.deathT = 0; e.tele = null; e.hidden = false; e.vx = dx * 2; e.vy = dy * 2; e.poison = null;
    this.runStats.kills++;
    const bi = this.world.bi;
    sfx.death();
    this.particles.burst('ink', e.x, e.y, 0.6, e.boss ? 40 : 14, e.boss ? 6 : 3.5, 0.7, e.boss ? 6 : 4, '#1e1428');
    if (bi === 0) this.particles.burst('petal', e.x, e.y, 0.8, 10, 3, 2, 2.6, '#f7c3d2');
    else if (bi === 1) this.particles.burst('leaf', e.x, e.y, 0.8, 10, 3, 2, 2.8, '#e0542c');
    else this.particles.burst('ember', e.x, e.y, 0.8, 14, 3, 1.2, 2.2, '#ff8a30');
    this.decals.add(e.x, e.y, e.boss ? 1 : 0.45, e.type === 'kappa' ? 'rgba(30,70,40,1)' : 'rgba(60,10,25,1)');
    this.hitstop(e.boss ? 0.2 : 0.025);
    this.dropLoot(e);
    if (e.boss) {
      this.shake(18); this.slow(1.6, 0.2); sfx.explode(); sfx.bossRoar();
      this.fx.ring(e.x, e.y, 5, 'rgba(255,240,200,0.9)', 0.9, 10);
      for (const o of this.enemies) if (!o.dead && o !== e) this.killEnemy(o);
      this.hazards.length = 0;
      for (const q of this.projectiles) if (q.owner === 'enemy') q.dead = true;
    }
  }

  // ---------------------------------------------------------------- pickups
  // Enemies sometimes drop a heal (+10) or ki (+25) orb; heavy enemies always drop one of the two, bosses always heal.
  dropLoot(e) {
    if (this.role === 'client') return;
    const D = e.boss ? DROPS.boss : e.cfg.heavy ? DROPS.heavy : DROPS.normal;
    const drop = (kind) => {
      const a = rand(0, TAU), s = rand(1.5, 2.5);
      this.pickups.push({ kind, amt: DROPS[kind], x: e.x, y: e.y, z: 0.6, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 4, t: 0, id: Math.random() });
    };
    if (D.either) { drop(Math.random() < 0.5 ? 'heal' : 'energy'); return; }
    if (Math.random() < D.heal) drop('heal');
    if (Math.random() < D.energy) drop('energy');
  }
  updatePickups(dt) {
    const N = this.world.N;
    for (const k of this.pickups) {
      k.t += dt;
      // pop out of the body, then settle and bob
      if (k.vz !== 0 || k.z > 0) { k.vz -= 14 * dt; k.z = Math.max(0, k.z + k.vz * dt); if (k.z === 0) k.vz = 0; }
      k.x = clamp(k.x + k.vx * dt, 1, N - 1); k.y = clamp(k.y + k.vy * dt, 1, N - 1);
      const f = Math.exp(-4 * dt); k.vx *= f; k.vy *= f;
      if (this.world.blocked(k.x, k.y, 0.2)) { k.vx *= -0.5; k.vy *= -0.5; }
      if (k.t < 0.4) continue;
      // nearby players pull it in; touching picks it up (only someone who needs it pulls it)
      let best = null, bd = 1.8;
      for (const p of this.players) {
        if (!p.active) continue;
        const need = k.kind === 'heal' ? p.hp < p.maxHp : p.energy < p.maxEnergy;
        const d = Math.hypot(p.x - k.x, p.y - k.y);
        if (need && d < bd) { bd = d; best = p; }
      }
      if (best) {
        const dx = best.x - k.x, dy = best.y - k.y, d = bd || 1, sp = 7 * (1 - d / 1.8) + 2;
        k.x += (dx / d) * sp * dt; k.y += (dy / d) * sp * dt;
        if (d < 0.45) {
          k.taken = true;
          if (k.kind === 'heal') { const got = best.heal(k.amt); this.fx.text(best.x, best.y, `+${Math.round(got)}`, '#7dff9a', 16); }
          else { const b = best.energy; best.energy = Math.min(best.maxEnergy, best.energy + k.amt); this.fx.text(best.x, best.y, `+${Math.round(best.energy - b)} ki`, '#9ee8ff', 16); }
          this.particles.burst('glow', best.x, best.y, 0.7, 12, 2, 0.6, 2.2, k.kind === 'heal' ? '#9dffb0' : '#9ee8ff');
          sfx.chime(0);
        }
      }
    }
    this.pickups = this.pickups.filter((k) => !k.taken);
  }
  drawPickup(ctx, k, t) {
    const sx = isoX(k.x, k.y), sy = isoY(k.x, k.y), bob = Math.sin(t * 3 + k.id * 10) * 3;
    const col = k.kind === 'heal' ? '#ff7a8a' : '#4fc8dc', glow = k.kind === 'heal' ? '255,120,140' : '80,200,230';
    const y = sy - 14 - k.z * 32 + bob;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, 7, 3.5, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sx, y, 0, sx, y, 18);
    g.addColorStop(0, `rgba(${glow},0.65)`); g.addColorStop(1, `rgba(${glow},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, y, 18, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(16,12,20,0.92)'; ctx.beginPath(); ctx.arc(sx, y, 8, 0, TAU); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.translate(sx, y); drawIcon(ctx, k.kind === 'heal' ? 'heal' : 'energy', 0.19, col, t);
    ctx.restore();
  }

  // ---------------------------------------------------------------- update
  frame(dtReal) {
    const t0 = performance.now();
    this.realTime += dtReal;
    input.poll();
    if (input.pressed('debug')) this.debug = !this.debug;

    switch (this.state) {
      case 'title':
        this.titleT += dtReal;
        this.menu.update(dtReal);
        this.updateTitleCamera(dtReal);
        this.world.update(dtReal, this.realTime, this.particles, this.view);
        this.particles.update(dtReal, (x, y, t) => this.world.wind(x, y, t), this.realTime);
        break;
      case 'intro':
        if (this.role === 'client') this.stepClient(dtReal); else this.updateIntro(dtReal);
        break;
      case 'cutscene':
        if (this.cutscene) this.cutscene.update(dtReal);
        break;
      case 'preview':
        this.updatePreview(dtReal);
        break;
      case 'dialogue':
        if (this.dialogue) this.dialogue.update(dtReal); else this.state = 'play';
        if (this.role === 'client') this.stepClient(dtReal); else this.updateWorldAmbient(dtReal * 0.5);
        break;
      case 'play': case 'transition': case 'cards': {
        const client = this.role === 'client';
        if (this.paused) {
          this.overlay.updatePause(dtReal);
          if (client) this.stepClient(dtReal); // online the world keeps going for the joiner
          break;
        }
        if (this.state === 'play' && input.pressed('pause')) { this.paused = true; this.overlay.sel = 0; this.overlay.t = 0; input.eat('pause'); break; }
        if (this.state === 'cards') { this.cards.update(dtReal); if (client) this.stepClient(dtReal); else this.updateWorldAmbient(dtReal * 0.3); break; }
        if (client) { if (this.state !== 'transition') this.stepClient(dtReal); } else this.updatePlay(dtReal);
        break;
      }
      case 'dead': case 'victory':
        this.overlay.updateEnd(dtReal);
        this.updateWorldAmbient(dtReal);
        break;
    }
    if (this.online && this.state !== 'title') this.online.update(dtReal);
    this.updateMusic();
    for (let i = this.banners.length - 1; i >= 0; i--) { const b = this.banners[i]; b.t += dtReal; if (b.t >= b.dur) this.banners.splice(i, 1); }
    if (this.fadeDir) {
      this.fade = clamp(this.fade + (this.fadeDir * dtReal) / 0.5, 0, 1);
      if (this.fadeDir > 0 && this.fade >= 1) { this.fadeDir = 0; if (this.state === 'transition' && this.role !== 'client') { this.state = 'play'; this.loadLevel(this.level + 1); } }
      else if (this.fadeDir < 0 && this.fade <= 0) this.fadeDir = 0;
    }
    this.screenFlashA = Math.max(0, this.screenFlashA - dtReal * 3);
    this.render();
    this.frameMs = lerp(this.frameMs, performance.now() - t0, 0.1);
    this.fps = lerp(this.fps, 1 / Math.max(0.001, dtReal), 0.05);
  }

  updateWorldAmbient(dt, shake = true) {
    this.time += dt;
    this.world.update(dt, this.time, this.particles, this.view);
    this.particles.update(dt, (x, y, t) => this.world.wind(x, y, t), this.time);
    this.fx.update(dt); this.decals.update(dt);
    for (const e of this.enemies) if (e.dead) e.deathT += dt;
    for (const p of this.players) if (p.dead) p.deadT += dt;
    this.updateShake(dt);
  }

  updatePlay(dtReal) {
    if (this.hitstopT > 0) { this.hitstopT -= dtReal; this.updateShake(dtReal); return; }
    let scale = 1;
    if (this.slowT > 0) { this.slowT -= dtReal; scale = this.slowScale; }
    let dt = dtReal * scale;
    const steps = dt > 1 / 50 ? 2 : 1;
    dt /= steps;
    for (let s = 0; s < steps; s++) { this.step(dt); if (this.state === 'intro') break; }
    this.updateShake(dtReal);
  }

  playersCenter(aliveOnly = false) {
    const ps = aliveOnly ? this.alivePlayers() : (this.alivePlayers().length ? this.alivePlayers() : this.players);
    if (!ps.length) return [isoX(11, 11), isoY(11, 11)];
    if (aliveOnly) { let x = 0, y = 0; for (const p of ps) { x += p.x; y += p.y; } return [x / ps.length, y / ps.length]; }
    let x = 0, y = 0;
    for (const p of ps) { x += isoX(p.x, p.y); y += isoY(p.x, p.y, 0.6); }
    return [x / ps.length, y / ps.length];
  }

  step(dt) {
    const w = this.world, P = this.players;
    this.time += dt;
    if (this.state === 'play') this.runStats.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }

    if (this.state === 'play') for (const p of P) { if (p.remote) p.updateRemote(dt); else p.update(dt); }
    else for (const p of P) if (p.dead) p.deadT += dt;
    // local co-op leash: keep partners within a screen of each other
    if (this.role === 'local' && P.length > 1 && !P[0].dead && !P[1].dead) {
      const dx = P[1].x - P[0].x, dy = P[1].y - P[0].y, d = Math.hypot(dx, dy), max = 12;
      if (d > max) { const k = (d - max) / 2 / d; P[0].x += dx * k; P[0].y += dy * k; P[1].x -= dx * k; P[1].y -= dy * k; }
    }
    this.spawner.update(dt);
    if (this.state === 'intro') return;
    // bo special: everything except the players runs slower
    let edt = dt;
    if (this.warpT > 0) { this.warpT -= dt; edt = dt * this.warpScale; }
    updateAllies(this, dt);
    this.updatePickups(dt);
    if (this.monk) { this.monk.update(dt); if (this.monk.done) this.monk = null; }
    this.nav.update(dt);
    for (const e of this.enemies) e.update(edt);
    const E = this.enemies;
    for (let i = 0; i < E.length; i++) {
      const a = E[i]; if (a.dead || a.hidden || a.state === 'spawn' || a.state === 'intro') continue;
      for (let j = i + 1; j < E.length; j++) {
        const b = E[j]; if (b.dead || b.hidden || b.state === 'spawn' || b.state === 'intro') continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (rr - d) * 0.5;
          const ma = a.boss ? 0.1 : 1, mb = b.boss ? 0.1 : 1;
          a.x -= (dx / d) * push * ma; a.y -= (dy / d) * push * ma; b.x += (dx / d) * push * mb; b.y += (dy / d) * push * mb;
        }
      }
      for (const p of P) {
        if (!p.active || p.z >= 0.3 || a.z >= 0.3) continue;
        const dx = a.x - p.x, dy = a.y - p.y, rr = a.r + p.r, d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); const push = rr - d; if (a.boss) { p.x -= (dx / d) * push; p.y -= (dy / d) * push; } else { a.x += (dx / d) * push; a.y += (dy / d) * push; } }
      }
    }
    for (let i = E.length - 1; i >= 0; i--) if (E[i].dead && E[i].deathT > 1.0 && !E[i].kneel) E.splice(i, 1);

    updateProjectiles(this, edt);
    updateHazards(this, edt, dt);
    w.update(dt, this.time, this.particles, this.view);
    this.particles.update(dt, (x, y, t) => w.wind(x, y, t), this.time);
    this.decals.update(dt); this.fx.update(dt);

    const anyAlive = P.some((p) => p.active);
    if (!this.cleared && this.spawner.done && !E.some((e) => !e.dead) && anyAlive) this.onLevelCleared();
    if (w.gate.active && this.state === 'play' && P.some((p) => p.active && dist(p.x, p.y, w.gate.x, w.gate.y) < 0.95)) this.enterGate();

    this.updateCamera(dt);
  }

  // joiner: move our own ninja, smooth the host's world, and run cosmetic effects
  stepClient(dt) {
    if (this.hitstopT > 0) { this.hitstopT -= dt; this.updateShake(dt); return; }
    this.time += dt;
    const me = this.localPlayer();
    if (me && this.state !== 'cards' && this.state !== 'dialogue') me.update(dt);
    smoothPuppets(this, dt);
    this.world.update(dt, this.time, this.particles, this.view);
    this.particles.update(dt, (x, y, t) => this.world.wind(x, y, t), this.time);
    this.decals.update(dt); this.fx.update(dt);
    if (this.state === 'intro' && this.bossRef) {
      const b = this.bossRef;
      this.moveCamera(isoX(b.x, b.y), isoY(b.x, b.y, 1.2), dt * 0.7);
    } else this.updateCamera(dt);
    this.updateShake(dt);
  }

  updateCamera(dt) {
    const P = this.players;
    // camera: follow the players (with aim lead in solo), zoom out a bit when co-op partners split up
    let [tx, ty] = this.playersCenter();
    if (P.length === 1) { const p = P[0]; tx += (p.aimX - p.aimY) * 32 * 1.1; ty += (p.aimX + p.aimY) * 16 * 1.1; }
    let zoom = 1;
    if (P.length > 1 && !P[0].dead && !P[1].dead) {
      const sepX = Math.abs(isoX(P[0].x, P[0].y) - isoX(P[1].x, P[1].y)) * this.view.baseS / (this.view.W * 0.75);
      const sepY = Math.abs(isoY(P[0].x, P[0].y) - isoY(P[1].x, P[1].y)) * this.view.baseS / (this.view.H * 0.7);
      zoom = clamp(1 / Math.max(1, sepX, sepY), 0.62, 1);
    }
    this.cam.zoom = lerp(this.cam.zoom, zoom, 1 - Math.exp(-3 * dt));
    this.view.s = this.view.baseS * this.cam.zoom;
    this.moveCamera(tx, ty, dt);
  }

  moveCamera(tx, ty, dt) {
    const ox = this.cam.x, oy = this.cam.y;
    const k = 1 - Math.exp(-7 * dt);
    this.cam.x = lerp(this.cam.x, tx, k); this.cam.y = lerp(this.cam.y, ty, k);
    this.view.dcx = (this.cam.x - ox) * this.view.s; this.view.dcy = (this.cam.y - oy) * this.view.s;
  }

  updateTitleCamera(dt) {
    const N = this.world.N, t = this.titleT * 0.06;
    const x = N / 2 + Math.cos(t) * 5, y = N / 2 + Math.sin(t * 1.3) * 5;
    this.view.s = this.view.baseS;
    this.moveCamera(isoX(x, y), isoY(x, y), dt * 0.4);
  }

  updateShake(dt) {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 40);
    const s = this.shakeAmt * this.view.dpr;
    this.shakeX = (Math.random() * 2 - 1) * s; this.shakeY = (Math.random() * 2 - 1) * s;
  }

  // ---------------------------------------------------------------- render
  render() {
    const ctx = this.ctx, v = this.view, w = this.world;
    const t = this.state === 'title' ? this.realTime : this.time;
    v.camX = this.cam.x; v.camY = this.cam.y;
    const hw = v.W / 2 / v.s + 120, hh = v.H / 2 / v.s + 160;
    v.x0 = v.camX - hw; v.x1 = v.camX + hw; v.y0 = v.camY - hh; v.y1 = v.camY + hh + 60;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (this.state === 'cutscene' && this.cutscene) { this.cutscene.draw(ctx); return; }
    w.drawBackground(ctx, v, t);

    ctx.setTransform(v.s, 0, 0, v.s, v.W / 2 - v.camX * v.s + this.shakeX, v.H / 2 - v.camY * v.s + this.shakeY);
    w.drawGround(ctx, t, this.players, v);
    this.decals.draw(ctx);
    this.particles.draw(ctx, true);
    this.fx.drawGround(ctx);
    drawHazards(ctx, this, t);
    for (const e of this.enemies) e.drawTelegraph(ctx, t);
    for (const e of this.enemies) e.drawShadow(ctx);
    for (const p of this.players) p.drawShadow(ctx);
    for (const p of this.players) if (!p.remote && !p.puppet) p.drawChargeIndicator(ctx); // only on the shooter's own screen
    drawProjectileShadows(ctx, this.projectiles);

    // depth-sorted drawables; props in front of a player fade out
    const items = [];
    const pls = this.players.filter((p) => !p.dead);
    for (const pr of w.props) {
      const [bx, by, bw, bh] = w.boundsOf(pr);
      if (bx > v.x1 || bx + bw < v.x0 || by > v.y1 || by + bh < v.y0) continue;
      const d = w.depthOf(pr);
      let alpha = 1;
      if (pr.kind === 'house' || pr.kind === 'tree' || pr.kind === 'bamboo' || pr.kind === 'torii' || pr.kind === 'banner') {
        for (const p of pls) {
          const psx = isoX(p.x, p.y), psy = isoY(p.x, p.y) - 20;
          if (d > p.x + p.y && psx > bx && psx < bx + bw && psy > by && psy < by + bh) alpha = 0.42;
        }
      }
      items.push({ d, draw: () => { ctx.globalAlpha = alpha; w.drawProp(ctx, pr, t); ctx.globalAlpha = 1; } });
    }
    for (const e of this.enemies) items.push({ d: e.x + e.y + 0.01, draw: () => e.draw(ctx, t) });
    for (const p of this.players) items.push({ d: p.x + p.y + 0.02, draw: () => p.draw(ctx, t) });
    for (const a of this.allies) { a.drawShadow(ctx); items.push({ d: a.x + a.y + 0.015, draw: () => a.draw(ctx, t) }); }
    if (this.monk) { const m = this.monk; m.drawShadow(ctx); items.push({ d: m.x + m.y + 0.015, draw: () => m.draw(ctx, t) }); }
    for (const q of this.projectiles) items.push({ d: q.x + q.y + 0.03, draw: () => drawProjectiles(ctx, [q], t) });
    for (const k of this.pickups) items.push({ d: k.x + k.y + 0.005, draw: () => this.drawPickup(ctx, k, t) });
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.draw();

    this.particles.draw(ctx, false);
    this.fx.drawSlashes(ctx);
    this.fx.drawBolts(ctx);
    this.fx.drawTexts(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const extra = [];
    if (w.biome.night) {
      for (const p of pls) extra.push({ x: p.x, y: p.y, z: 0.6, r: 2.6, i: 0.75, flicker: 0, color: '200,210,255' });
      for (const h of this.hazards) if (h.kind === 'fire') extra.push({ x: h.x, y: h.y, z: 0.2, r: h.r * 2.2, i: 0.8, flicker: 1, color: '255,120,40' });
      for (const q of this.projectiles) if (q.kind === 'orb') extra.push({ x: q.x, y: q.y, z: q.z, r: 1.4, i: 0.7, flicker: 0, color: '140,210,255' });
      if (w.gate.glow > 0.05) extra.push({ x: w.gate.x, y: w.gate.y, z: 1, r: 4 * w.gate.glow, i: 0.9, flicker: 0.2, color: '255,220,150' });
      for (const e of this.enemies) if (e.type === 'oni_lord' && !e.dead && !(e.introVis && e.introVis.hidden)) extra.push({ x: e.x, y: e.y, z: 1, r: 3, i: 0.6, flicker: 1, color: '255,90,40' });
      for (const e of this.enemies) if (e.type === 'gensai' && !e.dead && e.state === 'windup') extra.push({ x: e.x, y: e.y, z: 1, r: 3, i: 0.7, flicker: 0.5, color: '255,40,70' });
      for (const h of this.hazards) if (h.kind === 'seal') extra.push({ x: h.x, y: h.y, z: 0.1, r: 1.8, i: 0.6, flicker: 0.3, color: '255,60,100' });
    }
    w.drawLighting(ctx, v, t, extra);
    w.drawAtmosphere(ctx, v, t);
    w.drawFog(ctx, v, t);
    w.drawWeather(ctx, v, t);
    w.drawGrade(ctx, v);
    if (this.warpT > 0) { // slowed time: cool tint and soft dark edges
      const a = Math.min(1, this.warpT * 4) * 0.22;
      ctx.fillStyle = `rgba(60,90,160,${a})`; ctx.fillRect(0, 0, v.W, v.H);
      const g = ctx.createRadialGradient(v.W / 2, v.H / 2, Math.min(v.W, v.H) * 0.25, v.W / 2, v.H / 2, Math.max(v.W, v.H) * 0.65);
      g.addColorStop(0, 'rgba(10,10,30,0)'); g.addColorStop(1, `rgba(10,10,30,${a * 2})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, v.W, v.H);
    }
    if (this.screenFlashA > 0 && this.screenFlash) { ctx.globalAlpha = this.screenFlashA; ctx.fillStyle = this.screenFlash; ctx.fillRect(0, 0, v.W, v.H); ctx.globalAlpha = 1; }
    const low = pls.length ? Math.min(...pls.map((p) => p.hp)) : 100;
    if (low < 30 && this.state === 'play') {
      const a = (1 - low / 30) * (0.35 + 0.15 * Math.sin(this.realTime * 6));
      const g = ctx.createRadialGradient(v.W / 2, v.H / 2, Math.min(v.W, v.H) * 0.3, v.W / 2, v.H / 2, Math.max(v.W, v.H) * 0.7);
      g.addColorStop(0, 'rgba(150,0,0,0)'); g.addColorStop(1, `rgba(150,0,0,${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, v.W, v.H);
    }

    if (this.state === 'title') this.menu.draw(ctx);
    else {
      if (this.state === 'intro') drawBossIntro(ctx, this);
      else if (this.state !== 'dead' && this.state !== 'victory') drawHUD(ctx, this);
      drawBanners(ctx, this);
      if (this.state === 'cards') this.cards.draw(ctx);
      if (this.dialogue) this.dialogue.draw(ctx);
      if (this.paused) this.overlay.drawPause(ctx);
      if (this.state === 'dead') this.overlay.drawEnd(ctx, false);
      if (this.state === 'victory') this.overlay.drawEnd(ctx, true);
    }
    if (this.fade > 0) { ctx.fillStyle = `rgba(6,4,10,${this.fade})`; ctx.fillRect(0, 0, v.W, v.H); }
    if (this.debug) drawDebug(ctx, this);
  }
}

export { INTRO_DUR };

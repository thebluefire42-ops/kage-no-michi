// Game orchestration: states, level flow, spawning, combat glue, camera and rendering.
import { TAU, clamp, lerp, rand, pick, ease, isoX, isoY, screenToWorld, dist, angDiff } from './util.js';
import { LIBRARY_COUNT, ADMIN_DAMAGE, ENEMIES, BOSSES, BIOME_POOLS, EARLY_ARCHER, ARCHER_WEIGHT, WAVES, OPEN_STRIKE_HP, levelBudget, PLAYER_BASE, COOP_BOSS_HP, COOP_ENEMY_COUNT, ELEMENTS, ELEMENT_RULES, HEAVY_WEIGHT, heavyCap, shieldCapFor, SHIELD_WEIGHT, SPAWN_REPEAT, SPAWN_GUARANTEE, EARLY_TOUGH, SHIELD, DROPS, MUSIC_TENSE, SPAWN_PACING, chainDamageFor, DIFFICULTY, DOJO_POOL, LIBRARY_POOL, LIBRARY_WISE_WEIGHT, POISON_GROUP, RUN_DIFFICULTY } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemy, updateProjectiles, updateHazards, drawHazards, drawProjectiles, drawProjectileShadows } from './enemies.js';
import { Particles, Decals, Effects } from './particles.js';
import { CardScreen, rollReward, applyUpgrade, drawIcon, ownedCards, removeCard, rewardTypeOf, atRarity } from './cards.js';
import { RouteScreen, makeAreaMap, rewardOf, areaOf, AREAS, nodeOf, decorateNode, ensureKids, takePath, shiftWeights, smuggle, setRouteDifficulty } from './route.js';
import { ARTS, artOptions } from './arts.js';
import { applyEquipment } from './equipment.js';
import { tryFinisher } from './finishers.js';
import { uiScale, text as uiText } from './ui.js';
import { Overlay, drawHUD, drawBanners, drawDebug, drawBossIntro, drawTenseOverlay, drawCinemaBars } from './ui.js';
import { Menu } from './menu.js';
import { input } from './input.js';
import { sfx, music } from './audio.js';
import { net } from './net.js';
import { OnlineHost, OnlineClient, smoothPuppets } from './online.js';
import { updateAllies } from './talents.js';
import { updateSpirits, placeSpirits, drawSpiritFx, rememberFallen, tetherOnDeath } from './spirits.js';
import { Nav } from './nav.js';
import { Monk, rollSacrificeHands, takeSacrifice, applySacrifice, SACRIFICES } from './sacrifice.js';
import { Dialogue } from './dialogue.js';
import { storyLines } from './story.js';
import { recordPick } from './cards.js';
import { IntroCutscene } from './cutscene.js';
import { Area2Cutscene } from './cutscene2.js';
import { Area4Cutscene } from './cutscene4.js';
import { drawTeaHouse } from './teahouse.js';
import { SHADOW } from './rig.js';
import { rollCorruption, startCorruption, updateCorruption, drawCorruptionGround, drawCorruptionOver, drawCorruptionScreen, CORRUPT_INFO } from './corruption.js';
const AREA_SONGS = ['biome_1', 'biome_2', 'biome_3', 'biome_4'];
const CUTSCENES = { intro: IntroCutscene, area2: Area2Cutscene, area4: Area4Cutscene };

export const FINAL_LEVEL = 33;
// level -> biome: 1-10 spring, 11-20 autumn, 21-30 winter, 31+ the Kagerō fortress
export const biomeOf = (n) => (n > 30 ? 3 : Math.floor((n - 1) / 10));

const INTRO_DUR = 4.8;
const HITSTOP_GAP = 0.35; // (see Game.hitstop)
const HITSTOP_BUDGET = 0.05, HITSTOP_WINDOW = 1.0; // at most 0.05 s of ordinary hit-stop per second
// low health tension: eases off after this many seconds without a hit, down to this share of itself
const LOW_CALM_AFTER = 4, LOW_CALM_FADE = 3, LOW_CALM_MIN = 0.3;
// route reward -> the level's arena (other rewards use the area's ordinary map)
// network messages handled only during an online run (cleared when the pair goes back to the weapon select)
const RUN_MESSAGES = ['reroll', 'pdashcut', 'choose', 'chosen', 'picked', 'pause', 'in', 'atk', 'tal', 'pick', 'sacpick', 'dlgnext', 'snap', 'level', 'cards', 'sac', 'route', 'cut', 'dlg', 'dlgend', 'phurt', 'pchill', 'pstun', 'disconnect', 'lobby'];
const LEVEL_KIND = { stat: 'town', sacrifice: 'temple', art: 'dojo', talent: 'library', element: 'shrine', training: 'training' };
// the area 1 enemies that hide in bushes
const COVER_SNEAKY = ['assassin', 'bandit', 'archer', 'bomber'];
const KIND_BANNER = { shrine: { title: 'Imbuement Shrine', kanji: '宿' }, town: { kanji: '町' }, temple: { kanji: '寺' }, dojo: { title: 'Training Hall', kanji: '道場' }, library: { kanji: '書庫' } };

const AMBUSH_LEVEL = 31, AMBUSH_WAIT = 4.5, AMBUSH_ALARM = 3; // the fortress's first level: quiet for 4.5 s, the player remarks on it, 3 s later the alarm and the first wave
const WAVE_MAX = 18; // the most enemies one wave brings (before the extra wave splits them further)
const FIRST_WAVE = 9; // the fewest enemies the first wave brings (when the level has that many)
const MIN_FIGHT = 6;  // a new wave comes in once fewer than this are left
export class Spawner {
  constructor(g, level) {
    this.g = g; this.level = level; this.t = 0; this.waves = []; this.pending = []; this.waveIdx = 0; this.lastWaveT = 0; this.lastWaveCount = 0;
    if (BOSSES[level]) { this.boss = BOSSES[level]; this.bossDone = false; return; }
    const biome = biomeOf(level);
    // the route node's difficulty (fewer / more enemies and heavies) and the level's kind (its own enemies)
    const info = g.levelInfo || {}, D = DIFFICULTY[info.d ?? 1] || DIFFICULTY[1], kind = g.world && g.world.kind;
    let pool = BIOME_POOLS[biome].filter((t) => ENEMIES[t].minLevel <= level);
    if (kind === 'dojo') pool = DOJO_POOL.slice();
    else if (kind === 'library') pool = [...pool, ...LIBRARY_POOL];
    let budget = levelBudget(level) * (g.players.length > 1 ? COOP_ENEMY_COUNT : 1) * D.count * ((g.diffMod && g.diffMod.count) || 1) * (kind === 'library' ? LIBRARY_COUNT : 1);
    const list = [];
    // heavies and shield-bearers each have their own cap that grows through the area, every one already picked
    // makes the next of its kind less likely, and once the area is under way each level gets at least one of
    // each, so they come steadily instead of none for several levels and then a crowd
    const coop = g.players.length > 1, local = ((level - 1) % 10) + 1;
    const cap = Math.max(0, heavyCap(level, coop) + D.heavyCap);
    const shieldCap = Math.max(0, shieldCapFor(level, coop) + (D.shieldCap ?? D.heavyCap));
    const cat = (t) => ENEMIES[t].heavy ? 'heavy' : ENEMIES[t].shield ? 'shield' : ENEMIES[t].support ? 'support' : 'normal';
    const n = { heavy: 0, shield: 0, support: 0, normal: 0 }, capOf = { heavy: cap, shield: shieldCap, support: 1, normal: Infinity };
    const pickFrom = (types) => {
      const weights = types.map((t) => (t === 'bandit' || t === 'karateka' ? 1.6 : 1) * (t === 'archer' && level <= EARLY_ARCHER.until ? EARLY_ARCHER.mul : level - ENEMIES[t].minLevel < 3 ? 0.6 : 1) * (t === 'archer' || t === 'frostarcher' ? ARCHER_WEIGHT[biome] : 1) * (cat(t) !== 'normal' && local <= 4 ? EARLY_TOUGH : 1) * (ENEMIES[t].heavy ? HEAVY_WEIGHT * D.heavyW : 1) * (ENEMIES[t].shield ? SHIELD_WEIGHT * (D.shieldW ?? 1) : 1) * (cat(t) === 'normal' ? 1 : SPAWN_REPEAT ** n[cat(t)]) * (LIBRARY_POOL.includes(t) && kind === 'library' ? LIBRARY_WISE_WEIGHT : 1));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < types.length; i++) { r -= weights[i]; if (r <= 0) return types[i]; }
      return types[0];
    };
    const fill = () => {
      while (budget > 0.5) {
        const affordable = pool.filter((t) => ENEMIES[t].cost <= budget && n[cat(t)] < capOf[cat(t)]);
        if (!affordable.length) break;
        const type = pickFrom(affordable);
        list.push(type); budget -= ENEMIES[type].cost; n[cat(type)]++;
      }
    };
    const budget0 = budget; fill();
    // one more wave than the pacing gives (WAVES): top the budget up so every wave is ~perWave as big as it was
    const P = SPAWN_PACING[biome];
    const baseWaves = (len) => Math.max(1, Math.min(local <= 2 ? 2 : P.waves, Math.floor(len / 4) || 1), Math.ceil(len / WAVE_MAX));
    const nW0 = baseWaves(list.length);
    budget += budget0 * ((nW0 + WAVES.extra) / nW0 * WAVES.perWave - 1); fill();
    // the guarantee: swap a plain enemy for a shield-bearer / a heavy when the level rolled none
    for (const [c, from] of [['shield', SPAWN_GUARANTEE.shield], ['heavy', SPAWN_GUARANTEE.heavy]]) {
      const opts = pool.filter((t) => cat(t) === c);
      const swap = list.findIndex((t) => cat(t) === 'normal');
      if (kind !== 'dojo' && local >= from && n[c] === 0 && capOf[c] > 0 && opts.length && swap >= 0) { list[swap] = pickFrom(opts); n[c]++; }
    }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    // a few big waves, never a trickle: the tough ones (heavies, shield-bearers, then the costlier normals) are
    // dealt out first, one per wave in turn, so every wave has its share of them; the rest fill the waves up
    const nW = nW0 + WAVES.extra;
    this.stagger = P.stagger; this.waveTimeout = P.timeout;
    const rank = (t) => (cat(t) === 'heavy' ? 3 : cat(t) === 'shield' ? 2 : ENEMIES[t].cost >= 2 ? 1 : 0);
    const sorted = list.slice().sort((a, b) => rank(b) - rank(a));
    for (let w = 0; w < nW; w++) this.waves.push([]);
    sorted.forEach((t, i) => this.waves[i % nW].push(t));
    // the first wave is a proper fight: at least FIRST_WAVE enemies (taken from the later waves)
    for (let w = this.waves.length - 1; w > 0 && this.waves[0].length < FIRST_WAVE; w--) while (this.waves[w].length > 1 && this.waves[0].length < FIRST_WAVE) this.waves[0].push(this.waves[w].pop());
    this.waves = this.waves.filter((W) => W.length);
    for (const W of this.waves) for (let i = W.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [W[i], W[j]] = [W[j], W[i]]; }
  }
  remaining() {
    if (this.boss) return this.bossDone ? 0 : 1;
    let n = this.pending.length;
    for (let w = this.waveIdx; w < this.waves.length; w++) n += this.waves[w].length;
    return n;
  }
  get done() { return this.boss ? this.bossDone : this.waveIdx >= this.waves.length && this.pending.length === 0; }
  update(dt) {
    const g = this.g; if ((g.holdSpawns || g.ambushHold) && !this.boss) return; // (a Weapon Artist is choosing their technique / the level 31 ambush hasn't sprung yet)
    this.t += dt;
    if (this.boss) {
      if (!this.bossDone && this.t > 0.5) { this.bossDone = true; g.startBossIntro(this.boss); }
      return;
    }
    const alive = g.enemies.filter((e) => !e.dead).length;
    if (this.waveIdx < this.waves.length) {
      const first = this.waveIdx === 0;
      // the next wave comes once fewer than MIN_FIGHT are left standing (or after a while anyway), so you are
      // rarely fighting fewer than about five
      const trigger = first ? this.t > 0.8 : (alive < MIN_FIGHT || alive <= Math.floor(this.lastWaveCount * 0.25) || this.t - this.lastWaveT > (this.waveTimeout || 14)) && this.pending.length === 0;
      if (trigger) {
        const wave = this.waves[this.waveIdx++];
        wave.forEach((type, i) => this.pending.push({ type, t: i * (this.stagger || 0.22) }));
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
    this.tenseVis = 0; this.tenseEmbers = []; this.lowVis = 0;
    // the moment the tense version comes in (on the bar line): a dark red pulse and a small jolt
    music.onMood = (m) => {
      if (m !== 'tense' || !this.inRun || this.state !== 'play') return;
      this.localFlash('rgba(110,8,20,0.28)'); this.localShake(3);
    };
    this.players = [];
    this.enemies = []; this.projectiles = []; this.hazards = []; this.timers = []; this.banners = [];
    this.allies = []; this.warpT = 0; this.warpScale = 1; this.pickups = [];
    this.spirits = []; this.fallen = []; // spirit orb: allies kept between levels, the last enemies slain
    this.burns = []; // burn imbuement: fires on the ground
    this.cam = { x: 0, y: 0, zoom: 1 }; this.shakeAmt = 0; this.shakeX = 0; this.shakeY = 0;
    this.hitstopT = 0; this.slowT = 0; this.slowScale = 1;
    this.time = 0; this.realTime = 0;
    this.screenFlash = null; this.screenFlashA = 0;
    this.fade = 0; this.fadeDir = 0;
    this.fps = 60; this.frameMs = 16; this.debug = false;
    const q = new URLSearchParams(location.search);
    this.params = { level: clamp(parseInt(q.get('level') || '1', 10) || 1, 1, 33), god: q.get('god') === '1', weapons: q.get('weapons'), equip: q.get('equip'), monk: q.get('monk') === '1' };
    this.god = this.params.god;
    try { this.best = parseInt(localStorage.getItem('kage.best') || '0', 10) || 0; } catch (e) { this.best = 0; }
    this.menu = new Menu(this); this.cards = new CardScreen(this); this.overlay = new Overlay(this); this.routeScreen = new RouteScreen(this);
    this.view = { W: 1, H: 1, dpr: 1, s: 1, baseS: 1, k: 1, camX: 0, camY: 0, dcx: 0, dcy: 0 };
    this.view.toScreen = (x, y, z = 0) => [this.view.W / 2 + (isoX(x, y) - this.view.camX) * this.view.s + this.shakeX, this.view.H / 2 + (isoY(x, y, z) - this.view.camY) * this.view.s + this.shakeY];
    this.view.toScreenY = (x, y, z = 0) => this.view.H / 2 + (isoY(x, y, z) - this.view.camY) * this.view.s;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.toTitle();
    // invite link: ?join=KEY goes straight to joining that game
    const joinKey = q.get('join');
    if (joinKey) { this.menu.mode = 'join'; this.menu.startJoin(joinKey); history.replaceState(null, '', location.pathname); }
    // test shortcut: ?weapons=katanas  or co-op: ?weapons=katanas;heavy (one weapon each)
    else if (this.params.weapons) {
      const sets = this.params.weapons.split(';').map((s) => s.split(','));
      if (sets.every((s) => s.length >= 1 && s[0])) this.startRun(sets.map((s) => s.slice(0, 1)), null, null, (this.params.equip || '').split(';'));
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
    const zoom = clamp(Math.min(w / 1280, h / 760) * 1.42, 0.8, 2.6);
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
  // Pause. Online it is shared: either player pausing pauses the game for both, either resuming resumes both.
  // The host's pause reaches the joiner in every snapshot (pz); the joiner tells the host with a 'pause' message.
  setPaused(on, fromRemote = false) {
    if (on === this.paused) return;
    this.paused = on;
    if (on) { this.overlay.sel = 0; this.overlay.t = 0; }
    if (!fromRemote && this.role === 'client' && net.connected) net.send('pause', { on: on ? 1 : 0 });
  }

  // keepNet: an online pair going back to the weapon select together keeps its connection
  toTitle(keepNet = false) {
    this.corrupt = null; this.holyWater = 0; this.forceCorrupt = false; this.lastCorrupt = null; SHADOW.off = false;
    this.state = 'title'; this.paused = false; this.hostPaused = false;
    this.training = false; this.trainingStats = null;
    if (this.online && !keepNet) net.close();
    this.online = null; this.role = 'solo';
    this.menu.reset();
    this.players = []; this.level = 1; input.coop = false; this.spirits = []; this.fallen = [];
    this.enemies = []; this.projectiles = []; this.hazards = []; this.banners = []; this.timers = [];
    this.world = new World(1, Math.floor(Math.random() * 3), Math.floor(Math.random() * 1e9));
    this.world.buildGround(this.groundScale());
    this.titleT = 0; this.cam.zoom = 1; this.routeNext = 0; this.routeScreen.active = false;
    this.inRun = false; this.preview = null;
    this.bossRef = null; this.intro = null;
  }

  // online run over (fallen or won): both players return to the weapon select, still connected, to go again.
  // tell: let the partner know (whoever leaves the end screen first takes the other along)
  toLobby(tell = true) {
    if (this.state === 'title') return;
    const play = this.role;
    if (!this.online || !net.connected || (play !== 'host' && play !== 'client')) { this.toTitle(); return; }
    if (tell) net.send('lobby', {});
    for (const t of RUN_MESSAGES) net.off(t); // the run's handlers go; the menu sets up its own
    this.toTitle(true);
    this.menu.reenterOnline(play);
  }

  // online joiner coming back into a run (after a refresh or a dropped connection): the host still has our
  // ninja (weapons, cards, imbuements, talents, sacrifices); it sends the run and the current level, and its
  // snapshots fill in our stats from then on
  rejoinRun(m) {
    this.startRun(m.sets, 'client', null, m.equips || []);
    this.martialPending = false;
    this.runStart = m.runStart || 1;
    if (m.route) this.route = m.route;
    if (m.rs) this.runStats = m.rs;
    const me = this.localPlayer(); if (me) me.picked = m.picked || [];
    this.loadLevel(m.level, m.seed, m.info || null);
    this.banner({ title: 'Back in the run', sub: `Level ${m.level}`, dur: 2.4, y: 0.25, size: 26 });
  }

  // weaponSets: [[w1, w2]] for solo, [[w1, w2], [w3, w4]] for co-op
  // role: 'solo' | 'local' (same screen) | 'host' / 'client' (online)
  // equips: each player's equipment set key (equipment.js), default when missing
  startRun(weaponSets, role = null, startLevel = null, equips = [], diff = 'normal') {
    this.runDiff = RUN_DIFFICULTY[diff] ? diff : 'normal'; this.diffMod = RUN_DIFFICULTY[this.runDiff]; setRouteDifficulty(this.runDiff);
    this.holyWater = 0; // Holy Water: levels left without corruption
    this.forceCorrupt = false; this.lastCorrupt = null; // the map's corrupt button; the last corruption seen
    if (typeof weaponSets[0] === 'string') weaponSets = [weaponSets];
    this.role = role || (weaponSets.length > 1 ? 'local' : 'solo');
    input.coop = this.role === 'local';
    this.players = weaponSets.map((ws, i) => new Player(this, ws, i));
    this.players.forEach((p, i) => applyEquipment(p, equips[i]));
    this.martialPending = this.role !== 'client' && this.players.some((p) => p.equip === 'martial'); this.holdSpawns = false;
    if (this.role === 'host') { this.players[1].remote = true; this.online = new OnlineHost(this); }
    if (this.role === 'client') {
      const me = this.players[1];
      me.netClient = true; me.ctl = input.players[0];
      this.players[0].puppet = true;
      this.online = new OnlineClient(this);
    }
    this.runStats = { kills: 0, time: 0, damage: 0, upgrades: 0 };
    this.spirits = []; this.fallen = []; this.soulTrails = [];
    this.routeNext = 0; this.routeScreen.active = false;
    this.state = 'play';
    this.monkVisited = new Set(); this.monkActive = false; // per run (a new run meets every monk again)
    this.skipAreaIntro = 0;
    this.routeW = { sacrifice: 1, art: 1 }; this.smuggle = -1; // route odds that shift with your choices; Smuggler's Map
    const first = startLevel || this.params.level;
    this.runStart = first;
    if (first > 1) for (const p of this.players) p.adminMul = ADMIN_DAMAGE; // admin mode: starting at a chosen level
    this.route = makeAreaMap(areaOf(first), undefined, this.routeW);
    { const c = first - this.route.first; if (c > 0) { this.route.cols[c].nodes = [decorateNode({ r: 'stat', y: 0.5 }, areaOf(first))]; } this.route.path[c] = 0; }
    if (this.role !== 'client' && first === 1) this.playIntro();
    else if (this.role !== 'client' && first === 11) this.playArea2();
    else if (this.role !== 'client' && first === 31) this.playArea4();
    else if (this.role !== 'client') this.loadLevel(first);
    else { this.state = 'transition'; this.fade = 1; } // wait for the host's first level
  }

  // info: the route node of this level (sent by the host online; otherwise read from the route)
  // Training (main menu): one player with the chosen weapons and techniques in a small hall with a
  // straw dummy. Nothing attacks; the back door is open the whole time and walking through it leaves.
  // arts: [[weaponSlot, artKey], ...]
  startTraining(weapons, arts = []) {
    this.role = 'solo'; input.coop = false; this.online = null;
    this.players = [new Player(this, weapons, 0)];
    for (const [slot, key] of arts) {
      const w = this.players[0].weapons[slot], A = w && ARTS[w.key][key];
      if (A) w.arts = { ...(w.arts || {}), [A.slot]: key };
    }
    this.runStats = { kills: 0, time: 0, damage: 0, upgrades: 0 };
    this.spirits = []; this.fallen = []; this.soulTrails = [];
    this.routeNext = 0; this.routeScreen.active = false;
    this.state = 'play'; this.monkVisited = new Set(); this.monkActive = false;
    this.training = true; this.trainingStats = { log: [], total: 0 };
    this.runStart = 0; this.route = null; this.skipAreaIntro = 2; // (no story lines, no best-level record)
    this.loadLevel(2, undefined, { r: 'training', d: 1, q: 0 });
  }
  leaveTraining() {
    sfx.gate();
    this.toTitle();
    this.menu.mode = 'main'; this.menu.t = 0;
  }
  drawTrainingPanel(ctx) {
    const v = this.view, u = uiScale(v), S = this.trainingStats;
    if (!S) return;
    S.log = S.log.filter(([t]) => this.time - t < 5);
    const recent = S.log.reduce((a, [, d]) => a + d, 0);
    const span = S.log.length ? Math.max(1, this.time - S.log[0][0]) : 1;
    const w = 330 * u, h = 52 * u, x = v.W / 2 - w / 2, y = 16 * u;
    ctx.save();
    ctx.fillStyle = 'rgba(16,10,6,0.82)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#c8a46c'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
    uiText(ctx, '稽古  Training', v.W / 2, y + 14 * u, 13 * u, '#f0c870', 800, '"Shippori Mincho", serif');
    uiText(ctx, `Last 5 s: ${recent} damage   ·   DPS ${Math.round(recent / span)}   ·   Total ${S.total}`, v.W / 2, y + 34 * u, 12 * u, '#f8f0de', 700);
    ctx.restore();
    uiText(ctx, 'Walk out through the back door (出口) to leave', v.W / 2, y + h + 14 * u, 11 * u, 'rgba(248,240,222,0.7)', 700);
  }

  // info: the route node of this level (sent by the host online; otherwise read from the route)
  loadLevel(n, seed = Math.floor(Math.random() * 1e9), info = null) {
    this.burns = []; this.cutBits = []; this.ambushHold = false; // (no fires, cut arrows or held ambush carry over)
    this.level = n; this.levelSeed = seed; // (the seed lets a rejoining partner build the same level)
    const bi = biomeOf(n);
    if (this.role === 'client') { this.state = 'play'; this.cards.active = false; this.cutscene = null; this.dialogue = null; }
    const node = info || (BOSSES[n] ? null : nodeOf(this.route, n));
    this.levelInfo = node ? { r: node.r, d: node.d ?? 1, q: node.q ?? 0, name: node.name || null, monk: node.monk ?? null, monkName: node.monkName || null, corrupt: node.corrupt || null, purified: !!node.purified } : { r: 'stat', d: 1, q: 0 };
    { // testing: ?corrupt=mist|storm|bloodmoon corrupts every fight level
      const qc = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('corrupt') : null;
      if (qc && CORRUPT_INFO[qc] && !BOSSES[n] && this.levelInfo.r !== 'training' && this.levelInfo.r !== 'item') this.levelInfo.corrupt = qc;
    }
    // towns, temples, training halls and libraries each have their own arena
    const kind = BOSSES[n] ? null : LEVEL_KIND[this.levelInfo.r] || null;
    this.world = new World(n, bi, seed, { hall: !!(BOSSES[n] && BOSSES[n].hall), kind });
    this.scrollWaiting = false;
    this.inRun = true; this.preview = null;
    this.world.buildGround(this.groundScale());
    this.nav = new Nav(this);
    this.enemies = []; this.projectiles = []; this.hazards = []; this.timers = [];
    this.allies = []; this.warpT = 0; this.monk = null; this.sacPending = null; this.monkActive = false; this.pickups = [];
    this.particles.list.length = 0; this.decals.list.length = 0;
    this.fx = new Effects();
    // a consumable path: a rest at a tea house instead of a fight (no enemies; the consumables are offered inside)
    this.restStop = !BOSSES[n] && this.levelInfo.r === 'item';
    this.teaHouse = this.restStop ? { start: this.realTime } : null;
    this.players.forEach((p, i) => p.resetForLevel(this.world.spawn.x + i * 0.9, this.world.spawn.y - i * 0.9));
    placeSpirits(this); // the spirit orb's spirits follow you into the next level
    this.spawner = new Spawner(this, n);
    startCorruption(this);
    // Holy Water wears off one level at a time (not in training)
    if (this.role !== 'client' && this.levelInfo.r !== 'training' && this.holyWater > 0) this.holyWater--;
    if (this.restStop) this.spawner.waves = [];
    if (this.world.kind === 'training') { // only the dummy, and the way out is open from the start
      this.spawner.waves = [];
      const N = this.world.N, d = new Enemy(this, 'dummy', N / 2 - 0.5, N / 2 - 1, n);
      d.faceX = 1; d.faceY = 1; this.addEnemy(d);
      this.world.gate.active = true;
    }
    this.cleared = false; this.bossRef = null; this.bossTrail = null; this.intro = null;
    const c = this.playersCenter();
    this.cam.x = c[0]; this.cam.y = c[1];
    const b = this.world.biome;
    if (this.restStop) this.banner({ title: 'The Tea House', sub: 'Sit down and rest a while', kanji: '茶', dur: 2.4 });
    else if (!BOSSES[n]) {
      const KB = KIND_BANNER[this.world.kind], diff = DIFFICULTY[this.levelInfo.d].name;
      if (this.world.kind === 'training') this.banner({ title: 'Training', sub: 'Try your weapons and techniques on the dummy', kanji: '稽古', dur: 2.4 });
      else if (n % 10 === 1 || n === this.runStart) this.banner({ title: b.name, sub: `Level ${n} · ${KB ? (KB.title || this.levelInfo.name) + ' · ' : ''}${diff}`, kanji: b.jp.slice(0, 2), dur: 2.8 });
      else if (KB) this.banner({ title: KB.title || this.levelInfo.name || b.name, sub: `Level ${n} · ${diff}`, kanji: KB.kanji, dur: 2.4 });
      else this.banner({ title: `Level ${n}`, sub: `${b.name} · ${diff}`, dur: 2 });
      if (this.role !== 'client' && this.skipAreaIntro !== n && n !== AMBUSH_LEVEL) this.later(0.6, () => { if (this.state === 'play' && this.level === n && !this.cleared) this.say(`level${n}`); });
      if (this.role !== 'client' && n === AMBUSH_LEVEL) this.startAmbush(n);
    }
    if (this.levelInfo.corrupt) { // a corrupted level says so, right after its own banner
      const CI = CORRUPT_INFO[this.levelInfo.corrupt];
      this.later(2.4, () => { if (this.level === n) { this.banner({ title: `Corrupted · ${CI.name}`, sub: CI.sub, kanji: CI.jp, dur: 2.8, color: 'rgba(52,8,28,0.88)' }); sfx.bossRoar(); } });
    } else if (this.levelInfo.purified) this.later(2.4, () => { if (this.level === n) this.banner({ title: 'Purified', sub: 'The holy water keeps the corruption away', kanji: '聖', dur: 2.6 }); });
    this.fade = 1; this.fadeDir = -1;
    if (this.role === 'host') this.online.levelLoaded(n, seed, this.levelInfo);
    // first level of an area: its boss steps out of the gate and says a word before the fight starts
    if (this.role !== 'client' && !BOSSES[n] && (n === 1 || n === 11 || n === 21 || n === 31) && this.skipAreaIntro !== n) this.startPreview(bi);
    this.skipAreaIntro = 0;
    const legit = this.runStart === 1 && !this.god;
    if (legit && n > this.best) { this.best = n; try { localStorage.setItem('kage.best', String(n)); } catch (e) { /* storage unavailable */ } }
  }

  onLevelCleared() {
    this.cleared = true;
    for (const p of this.players) if (p.stats.levelDmg) p.levelBonus = (p.levelBonus || 0) + p.stats.levelDmg; // Seasoned: damage for every level completed
    if (this.restStop) { this.offerBlessings(2.2); return; } // a rest: no gong, no 'Level Cleared'
    sfx.gong();
    this.slow(1.8, 0.25);
    // clearing the level picks up anyone who is down
    for (const p of this.players) if (p.downed && !p.relife) { p.downed = false; p.hp = PLAYER_BASE.reviveHp; p.iframes = 2; this.fx.ring(p.x, p.y, 1.6, 'rgba(140,255,170,0.9)', 0.6, 5); }
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

  // atDesk: a library's talent scrolls are only offered once a player walks up to the desk
  offerBlessings(delay, atDesk = false) {
    const boss = !!BOSSES[this.level], info = this.levelInfo || { r: 'stat', q: 0 };
    const type = boss ? 'stat' : info.r;
    if (type === 'sacrifice' && !boss) {
      this.later(delay, () => { if (this.state === 'play' && this.alivePlayers().length && !this.monkActive) { this.monkVisited.add(this.level); this.startMonk(); } });
      return;
    }
    const altar = (type === 'talent' && this.world.library) || (type === 'element' && this.world.shrine);
    if (altar && !atDesk && this.role !== 'client') { // the reward waits at the library desk / the shrine
      this.later(delay, () => {
        if (this.state !== 'play' || !this.alivePlayers().length) return;
        this.scrollWaiting = true; altar.ready = true;
        sfx.chime(1);
        if (this.world.shrine) this.banner({ title: 'The shrine awakens', sub: 'Kneel before it to imbue your weapon', kanji: '宿', dur: 2.6, y: 0.3, size: 26 });
        else this.banner({ title: 'The library is quiet again', sub: 'Take a scroll from the desk inside', kanji: '巻', dur: 2.6, y: 0.3, size: 26 });
      });
      return;
    }
    const tier = boss ? 0 : info.q ?? 0;
    const rollUpgrades = (p) => rollReward(p, type, tier);
    if (this.role === 'host') {
      // online: both players pick at the same time on their own screens
      this.later(delay, () => {
        if (this.state !== 'play' || !this.alivePlayers().length) return;
        this.pendingPicks = new Set([0]);
        const rp = this.players[1];
        if (net.connected && !rp.disconnected) { this.pendingPicks.add(1); this.remoteReroll = () => rollUpgrades(rp); this.remoteCards = rollUpgrades(rp); this.online.sendCards(this.remoteCards); }
        const p = this.players[0];
        this.state = 'cards';
        this.cards.open(rollUpgrades(p), (card) => {
          applyUpgrade(p, card); this.runStats.upgrades++;
          this.afterCard(p, card, () => {
            this.state = 'play'; this.pendingPicks.delete(0);
            if (this.pendingPicks.size) this.banner({ title: 'Waiting for Player 2…', dur: 2, y: 0.25, size: 24 });
            this.checkPicksDone();
          });
        }, p, { reroll: () => rollUpgrades(p) });
      });
      return;
    }
    // same screen: every player (downed ones too) picks a blessing, one after another
    const pickFor = (i) => {
      if (i >= this.players.length) { this.afterPicks(); return; }
      const p = this.players[i];
      this.state = 'cards';
      this.cards.open(rollUpgrades(p), (card) => { applyUpgrade(p, card); this.runStats.upgrades++; this.afterCard(p, card, () => pickFor(i + 1)); }, p, { reroll: () => rollUpgrades(p) });
    };
    this.later(delay, () => { if (this.state === 'play' && this.alivePlayers().length) pickFor(0); });
  }

  // ---------------------------------------------------------------- music
  // Menu music on the title and weapon select. During a run each area plays one mixed song (biome_1..4),
  // started by the area's opening scene (intro cutscene, area 2 cutscene, the level 21 / 31 boss previews)
  // and carrying on through the whole area. Cards and dialogue muffle it (low-pass) without stopping it.
  updateMusic() {
    if (this.state === 'cutscene') { music.set((this.cutscene && this.cutscene.song) || 'biome_1'); music.muffle(false); return; }
    const menu = this.state === 'title' || !this.inRun || !this.world;
    this.musicTense(); // still drives the tense screen effect during fights
    // the area's song (biome_1..4)
    let song = menu ? 'main_menu' : AREA_SONGS[Math.min(3, this.world.bi)];
    music.set(song);
    // the filter: heavy for cards / dialogue / the map, the highs cut while paused, and closing in as health runs low
    let hz = null;
    if (!menu && (this.state === 'cards' || this.state === 'dialogue' || this.state === 'route')) hz = 480;
    else if (!menu && this.paused) hz = 900;
    else if (!menu && (this.lowVis || 0) > 0.3) hz = Math.round(lerp(5000, 1100, clamp((this.lowVis - 0.3) / 0.7, 0, 1)));
    music.muffle(hz !== null, hz ?? undefined);
  }

  // screen mood for tense music: fades in over ~1.5 s, out over ~3 s; embers rise from the bottom edge
  updateTenseVis(dt) {
    const on = this.tense && this.inRun && !this.paused && (this.state === 'play' || this.state === 'intro' || this.state === 'dialogue');
    this.tenseVis = clamp(this.tenseVis + (on ? dt / 1.5 : -dt / 3), 0, 1);
    // low health: the lower the weakest standing player's health, the more cinematic (from 65% down to 15%)
    const ps = this.inRun && (this.state === 'play' || this.state === 'intro' || this.state === 'dialogue' || this.state === 'cards') ? this.alivePlayers() : [];
    const frac = ps.length ? Math.min(...ps.map((p) => p.hp / p.maxHp)) : 1;
    // a breather: after LOW_CALM_AFTER s without being hit the tension eases off (to LOW_CALM_MIN of itself over
    // LOW_CALM_FADE s); the next hit brings it straight back
    const lastHit = ps.length ? Math.max(...ps.map((p) => p.lastHurtAt ?? -99)) : -99, quiet = this.realTime - lastHit;
    const calm = clamp((quiet - LOW_CALM_AFTER) / LOW_CALM_FADE, 0, 1);
    const want = clamp((0.75 - frac) / 0.55, 0, 1) * lerp(1, LOW_CALM_MIN, calm); // starts below 75% health, full at 20%
    this.lowVis += (want - this.lowVis) * (1 - Math.exp(-dt * (want > this.lowVis ? 2.5 : 1.2)));
    const v = this.view, E = this.tenseEmbers;
    if (this.tenseVis > 0.05 && Math.random() < dt * 16 * this.tenseVis) {
      E.push({ x: Math.random() * v.W, y: v.H + 6, vx: (Math.random() - 0.5) * 30 * v.k, vy: -(40 + Math.random() * 70) * v.k, life: 0, max: 1.6 + Math.random() * 1.6, s: (1 + Math.random() * 2.2) * v.k });
    }
    for (const e of E) { e.life += dt; e.x += e.vx * dt + Math.sin(e.life * 3 + e.max) * 12 * dt * v.k; e.y += e.vy * dt; }
    this.tenseEmbers = E.filter((e) => e.life < e.max);
  }

  // a player hit something, was hit, or attacked with enemies close by
  noteCombat() { this.combatT = this.realTime; }
  // Tense while you fight 3+ enemies (or a boss); chill at a level's start, once only a couple are left,
  // after a few seconds without fighting, once cleared, when everyone is down and between levels.
  musicTense() {
    const M = MUSIC_TENSE, now = this.realTime, dt = Math.min(0.1, Math.max(0, now - (this.tenseLast ?? now)));
    this.tenseLast = now;
    this.moodT = (this.moodT || 0) + dt;
    const ps = this.alivePlayers();
    const off = this.state === 'route' || this.state === 'transition' || this.state === 'dead' || this.state === 'victory' || !ps.length || this.players.every((p) => p.dead || p.downed);
    if (off) { if (this.tense) this.moodT = 0; this.tense = false; return false; }
    let boss = false, alive = 0;
    for (const e of this.enemies) {
      if (e.dead || e.preview) continue;
      if (e.boss) { if (!BOSSES[this.level]) continue; boss = true; } // the area-start boss preview is not a fight
      alive++;
    }
    const fighting = now - (this.combatT ?? -99) < M.combatWindow;
    const hot = !this.cleared && (boss || (fighting && alive >= M.combatEnemies));
    if (!this.tense) {
      if (hot && this.moodT >= M.minChill) { this.tense = true; this.moodT = 0; this.calmT = 0; this.fewT = 0; }
    } else {
      // back to chill: the level is cleared, only a couple of enemies are left, or nobody has fought for a while
      this.fewT = !boss && alive <= M.calmEnemies ? (this.fewT || 0) + dt : 0;
      this.calmT = !boss && !fighting ? (this.calmT || 0) + dt : 0;
      const calm = this.cleared ? this.moodT > 0 && (this.calmT > M.clearedHold || this.fewT > M.clearedHold) : this.fewT > M.calmHold || this.calmT > M.hold;
      if (calm && (this.cleared || this.moodT >= M.minTense || this.fewT > M.calmHold)) { this.tense = false; this.moodT = 0; }
    }
    return !!this.tense;
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

  // the walk into Momiji Pass, then level 11 (its song keeps playing into the level)
  // the road from Yukishiro to the fortress and in by the old water gate, then level 31 (its song plays on)
  playArea4() {
    this.state = 'cutscene'; this.fade = 0; this.fadeDir = 0;
    this.cutscene = new Area4Cutscene(this, () => {
      this.cutscene = null; this.state = 'play';
      if (this.role === 'host') net.send('dlgend', { id: 'area4' });
      this.skipAreaIntro = 31; // (they sneak in: no boss preview at the gate)
      this.loadLevel(31);
    });
    if (this.role === 'host') {
      net.send('cut', { id: 'area4' });
      this.cutscene.onLine = (i) => net.send('dlg', { id: 'area4', i });
    }
  }

  playArea2() {
    this.state = 'cutscene'; this.fade = 0; this.fadeDir = 0;
    this.cutscene = new Area2Cutscene(this, () => {
      this.cutscene = null; this.state = 'play';
      if (this.role === 'host') net.send('dlgend', { id: 'area2' });
      this.skipAreaIntro = 11;
      this.loadLevel(11);
    });
    if (this.role === 'host') {
      net.send('cut', { id: 'area2' });
      this.cutscene.onLine = (i) => net.send('dlg', { id: 'area2', i });
    }
  }

  // show a script (if one exists for this team), pausing play; then() runs afterwards
  say(id, then = () => {}, vars = null) {
    const lines = storyLines(id, this.players.length > 1, vars);
    if (!lines.length || this.role === 'client') { then(); return; }
    const back = this.state === 'dialogue' ? 'play' : this.state;
    this.state = 'dialogue';
    this.dialogue = new Dialogue(this);
    this.dialogue.open(id, lines, () => {
      this.dialogue = null; this.state = back;
      if (this.role === 'host') net.send('dlgend', { id });
      then();
    }, (i) => { if (this.role === 'host') net.send('dlg', { id, i, vars }); });
  }

  // joiner: mirror the host's dialogue / cutscene
  onRemoteDialogue(m) {
    if (CUTSCENES[m.id]) {
      if (!this.cutscene || this.cutscene.id !== m.id) this.onRemoteCutscene(m);
      const d = this.cutscene.dlg;
      if (d.active && d.i !== m.i) d.go(m.i);
      return;
    }
    if (!this.dialogue || this.dialogue.id !== m.id) {
      const lines = storyLines(m.id, this.players.length > 1, m.vars || null);
      if (!lines.length) return;
      this.dialogue = new Dialogue(this, { remote: true });
      this.dialogue.onRemoteNext = () => net.send('dlgnext', {});
      this.dialogue.open(m.id, lines, () => { this.dialogue = null; if (this.state === 'dialogue') this.state = 'play'; });
      if (this.state === 'play') this.state = 'dialogue';
    }
    if (this.dialogue.i !== m.i) this.dialogue.go(m.i);
  }
  onRemoteCutscene(m = {}) {
    this.state = 'cutscene'; this.fade = 0;
    this.cutscene = new (CUTSCENES[m.id] || IntroCutscene)(this, () => { this.cutscene = null; this.state = 'transition'; this.fade = 1; }, { remote: true });
    this.cutscene.dlg.onRemoteNext = () => net.send('dlgnext', {});
  }
  onRemoteDialogueEnd(m) {
    if (m.id === 'intro') { if (this.cutscene) this.cutscene.titleT = Math.max(this.cutscene.titleT, 0); return; }
    if (m.id === 'area2' || m.id === 'area4') { if (this.cutscene) this.cutscene.finish(); return; }
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
    if (this.world.kind === 'temple') this.banner({ title: 'The pact is sealed', sub: 'The torii beyond the temple is open', dur: 2.4, y: 0.25, size: 26 });
    else this.banner({ title: 'The torii gate opens', sub: 'Walk through it to continue', dur: 2.2, y: 0.25, size: 26 });
  }

  // ---------------------------------------------------------------- wandering monk
  // after everyone picked a blessing: on levels 5/15/25 the monk visits first, otherwise the gate opens
  monkDue() {
    this.monkVisited = this.monkVisited || new Set();
    return this.params.monk && !this.monkVisited.has(this.level); // ?monk=1: the monk visits after every level (testing)
  }
  afterPicks() {
    if (this.restStop) {
      this.state = 'play';
      this.banner({ title: 'You leave the tea house', sub: 'Rested, the road goes on', dur: 1.8, y: 0.3, size: 26 });
      this.later(1.5, () => this.enterGate());
      return;
    }
    if (!this.monkDue() || !this.alivePlayers().length) { this.openGate(); return; }
    this.monkVisited.add(this.level);
    this.startMonk();
  }

  startMonk() {
    const w = this.world, ps = this.alivePlayers();
    const px = ps.reduce((a, p) => a + p.x, 0) / ps.length, py = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    const doors = w.doors().filter((d) => !w.blocked(d.ox, d.oy, 0.4)).sort((a, b) => dist(a.ox, a.oy, px, py) - dist(b.ox, b.oy, px, py));
    // at a temple the monk steps out of the temple's own doors
    const temple = w.temple && this.levelInfo && this.levelInfo.r === 'sacrifice' ? this.levelInfo : null;
    const door = temple ? w.temple.door : doors.find((d) => dist(d.ox, d.oy, px, py) > 2.5) || doors[0] || null;
    this.state = 'play';
    this.monk = new Monk(this, door);
    if (temple && temple.monk !== null) this.monk.bi = temple.monk;
    if (temple) this.monk.maxWalk = 11; // from the temple doors all the way down to you
    this.monkActive = true;
    sfx.chime(1);
    if (temple) {
      this.banner({ title: `${temple.monkName || 'The monk'} steps out of the temple`, sub: temple.name || 'He offers power, for a price', kanji: '僧', dur: 2.6, y: 0.3, size: 28 });
      const bi = this.monk.bi, vars = { name: temple.monkName, temple: temple.name, names: { [`monk${bi}`]: temple.monkName } };
      this.monk.onArrive = () => this.later(0.6, () => this.say(`temple${bi}`, () => this.offerSacrifices(), vars));
      return;
    }
    this.banner({ title: 'A wandering monk approaches…', sub: 'He offers power, for a price', kanji: '僧', dur: 2.6, y: 0.3, size: 28 });
    this.monk.onArrive = () => this.later(0.6, () => this.say(`monk${this.monk ? this.monk.bi : 0}`, () => this.offerSacrifices())); // speak once he reaches you
  }

  offerSacrifices() {
    this.sacChoices = new Map();
    if (this.role === 'host') { // online: both choose at the same time on their own screens
      this.sacPending = new Set([0]);
      const rp = this.players[1], both = net.connected && !rp.disconnected;
      const hands = rollSacrificeHands(both ? this.players : [this.players[0]]); // Bound Souls: offered to both or neither
      if (both) { this.sacPending.add(1); this.online.sendSac(hands[1]); }
      const p = this.players[0];
      this.state = 'cards';
      this.cards.open(hands[0], (card) => {
        this.state = 'play'; this.sacChoices.set(0, card.key); this.sacPending.delete(0);
        if (this.sacPending.size) this.banner({ title: 'Waiting for Player 2…', dur: 2, y: 0.25, size: 24 });
        this.checkSacDone();
      }, p, { mode: 'sacrifice', reroll: () => rollSacrificeHands([p])[0] });
      return;
    }
    const hands = rollSacrificeHands(this.players); // co-op: Bound Souls is offered to both players or neither
    const pickFor = (i) => {
      if (i >= this.players.length) { this.resolveSacrifices(); return; }
      const p = this.players[i];
      this.state = 'cards';
      this.cards.open(hands[i], (card) => { this.sacChoices.set(i, card.key); pickFor(i + 1); }, p, { mode: 'sacrifice', reroll: () => rollSacrificeHands([p])[0] });
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
      if (SACRIFICES[key].pact) applySacrifice(p, key, !!p.pactFree);
      this.fx.text(p.x, p.y, SACRIFICES[key].title, '#ff9a8a', 15, true);
      this.particles.burst('glow', p.x, p.y, 0.8, 18, 2.5, 1, 2.4, '#ff6a6a');
    }
    if (pact) this.banner({ title: 'Your souls are bound', sub: 'Every wound is now shared', kanji: '縁', dur: 2.4, y: 0.3, size: 26 });
    else if (chose('boundSouls').length) this.banner({ title: 'The pact fades', sub: 'Bound Souls needs both of you', dur: 2.4, y: 0.3, size: 24, color: 'rgba(60,4,10,0.8)' });
    sfx.gong(); this.flashScreen('rgba(160,20,30,0.3)');
    const swappers = this.players.filter((p) => this.sacChoices.get(p.index) === 'quickSwap' || this.sacChoices.get(p.index) === 'splinter');
    const finish = () => { this.state = 'play'; if (this.monk) this.monk.leave(); this.monkActive = false; this.later(1.6, () => this.openGate()); };
    const next = (i) => (i >= swappers.length ? finish() : (this.sacChoices.get(swappers[i].index) === 'splinter' ? this.splinter(swappers[i], () => next(i + 1)) : this.quickSwap(swappers[i], () => next(i + 1))));
    if (swappers.length) this.later(1.0, () => next(0)); else finish();
  }

  // joiner: the host sent our two sacrifice offers
  openClientSac(cards) {
    const me = this.localPlayer();
    this.state = 'cards';
    this.cards.open(cards, (card) => {
      net.send('sacpick', { key: card.key });
      this.state = 'play';
      this.banner({ title: 'Sacrifice chosen', sub: 'Waiting for the host…', dur: 2, y: 0.25, size: 24 });
    }, me, { mode: 'sacrifice', reroll: () => { net.send('reroll', {}); return null; } }); // (the host rolls the new hand and sends it)
  }

  // host: the joiner chose card `index` from the cards we sent
  onRemotePick(index, replace = null) {
    if (!this.pendingPicks || !this.pendingPicks.has(1) || !this.remoteCards) return;
    const card = this.remoteCards[index] && { ...this.remoteCards[index], replace };
    const done = () => { if (!this.pendingPicks) return; this.pendingPicks.delete(1); this.checkPicksDone(); };
    if (card) { applyUpgrade(this.players[1], card); this.runStats.upgrades++; this.afterCard(this.players[1], card, done); } else done();
  }

  // ---------------------------------------------------------------- choosing among cards (trading in, swapping)
  // a choice for player p: on this screen, or (the joiner online) on theirs. cb(card) or cb(null) if they left.
  chooseCards(p, cards, mode, cb, incoming = null) {
    if (p.remote && this.role === 'host') {
      if (!net.connected || p.disconnected) { cb(null); return; }
      const id = (this.chooseId = (this.chooseId || 0) + 1);
      this.chooseWait = { id, cards, cb };
      net.send('choose', { id, cards, mode, incoming });
      return;
    }
    this.state = 'cards';
    this.cards.open(cards, (c) => cb(c), p, { mode, incoming });
  }
  onRemoteChosen(m) { const W = this.chooseWait; if (!W || W.id !== m.id) return; this.chooseWait = null; W.cb(W.cards[m.index] || null); }
  // joiner: the host asks us to choose (which card to trade in / give up, or a replacement)
  openClientChoose(m) {
    const me = this.localPlayer();
    this.state = 'cards';
    this.cards.open(m.cards, (c) => {
      net.send('chosen', { id: m.id, index: c.i });
      this.state = 'play';
      this.banner({ title: 'Card chosen', sub: 'Waiting for the host…', dur: 2, y: 0.25, size: 24 });
    }, me, { mode: m.mode, incoming: m.incoming || null });
  }
  // the joiner's list of picked cards changed on the host (a card traded in): send it over for their pause screen
  syncPicked(p) { if (p.remote && this.role === 'host' && net.connected) net.send('picked', { list: p.picked || [] }); }
  // after a card is applied: Bitter Brew asks which of your cards to trade in for its damage
  afterCard(p, card, done) {
    if (!card || card.type !== 'brew') { done(); return; }
    const own = ownedCards(p);
    // the brew's card in this run's list shows what really happened: attack damage before the trade -> after it
    const before = p.stats.baseDamage, rec = (p.picked || []).filter((c) => c.type === 'brew').pop();
    const gain = () => {
      p.stats.baseDamage += card.value;
      const pct = (v) => `${Math.round(v * 100)}%`;
      if (rec) { rec.frozen = { cur: pct(before), bonus: `+${pct(card.value)}`, next: pct(p.stats.baseDamage) }; rec.frozenFx = { text: `+${pct(card.value)} attack damage`, desc: `Attack damage ${pct(before)} → ${pct(p.stats.baseDamage)}` }; }
      this.fx.text(p.x, p.y, `Attack damage ${pct(p.stats.baseDamage)}`, '#ffcf6a', 15, true); this.particles.burst('ember', p.x, p.y, 0.8, 16, 2.5, 0.8, 2, '#ffcf6a');
    };
    if (!own.length) { gain(); done(); return; }
    this.chooseCards(p, own, 'trade', (c) => { if (c) removeCard(p, c); gain(); this.syncPicked(p); done(); }, card);
  }
  // Quick Swap (a sacrifice): give up one card, then choose a new one of the same kind
  quickSwap(p, done) {
    const own = ownedCards(p);
    if (!own.length) { done(); return; }
    this.chooseCards(p, own, 'swap', (c) => {
      if (!c) { done(); return; }
      if (!p.swapKeep) removeCard(p, c); // (Satanist's Set, first sacrifice: you keep it)
      p.swapKeep = false;
      const offers = rollReward(p, rewardTypeOf(c), 0);
      this.chooseCards(p, offers, 'swapNew', (n) => {
        if (n) { applyUpgrade(p, n); this.runStats.upgrades++; }
        this.syncPicked(p); this.state = 'play'; done();
      });
    });
  }
  // Splintered Gift (a sacrifice): give up one card (a core stat, imbuement or talent), then choose two new cards of
  // that kind, each one rarity below the card given up (common stays common)
  splinter(p, done) {
    const own = ownedCards(p).filter((c) => c.type !== 'art');
    if (!own.length) { done(); return; }
    this.chooseCards(p, own, 'swap', (c) => {
      if (!c) { done(); return; }
      const r = Math.max(0, (c.rarity || 0) - 1), type = rewardTypeOf(c);
      if (!p.swapKeep) removeCard(p, c); // (Satanist's Set, first sacrifice: you keep it)
      p.swapKeep = false;
      const round = (k) => {
        if (k >= 2) { this.syncPicked(p); this.state = 'play'; done(); return; }
        let offers = rollReward(p, type, 0);
        if (type === 'talent' && offers.some((o) => o.kind === 'new')) offers = offers.filter((o) => o.kind === 'new'); // (an upgrade can't be a rarity lower)
        offers = offers.map((o) => atRarity(p, o, r));
        this.chooseCards(p, offers, 'swapNew', (n) => { if (n) { applyUpgrade(p, n); this.runStats.upgrades++; } round(k + 1); });
      };
      round(0);
    });
  }
  // the first fortress level: no one at first; after a few quiet seconds the alarm is raised and the first wave comes
  startAmbush(n) {
    this.ambushHold = true;
    // say a script once play is going (a card choice or a pause first: wait for it), then run next
    const sayWhenFree = (id, next) => {
      const go = () => {
        if (this.level !== n || this.cleared) { this.ambushHold = false; return; }
        if (this.state !== 'play') { this.later(0.5, go); return; }
        this.say(id, next);
      };
      go();
    };
    this.later(AMBUSH_WAIT, () => sayWhenFree(`level${n}`, () => this.later(AMBUSH_ALARM, () => sayWhenFree(`level${n}b`, () => { this.ambushHold = false; sfx.horn && sfx.horn(); this.shake(4); }))));
  }

  // Martial Artist's Set: when the run begins, each martial artist chooses one technique for their weapon
  // (all of its techniques on offer); the first wave waits until every choice is made
  offerMartial() {
    const ps = this.players.filter((p) => p.equip === 'martial');
    this.holdSpawns = true;
    const next = (i) => {
      if (i >= ps.length) { this.holdSpawns = false; if (this.state === 'cards') this.state = 'play'; return; }
      const p = ps[i], w = p.weapons[0];
      const cards = rollReward(p, 'art', 0).filter((c) => c.type === 'art'); // two techniques, like a training hall
      if (!cards.length) { next(i + 1); return; }
      this.chooseCards(p, cards, 'martial', (c) => { if (c) { applyUpgrade(p, c); this.syncPicked(p); } this.state = 'play'; next(i + 1); });
    };
    next(0);
  }
  // host: the joiner spends a reroll token on the cards we sent: roll them a new hand
  onRemoteReroll() {
    const rp = this.players[1];
    if (this.sacPending && this.sacPending.has(1) && rp) { // the joiner rerolled their sacrifice hand
      if ((rp.rerolls ?? 0) <= 0) return;
      rp.rerolls--; this.online.sendSac(rollSacrificeHands([rp])[0]); return;
    }
    if (!this.pendingPicks || !this.pendingPicks.has(1) || !this.remoteReroll || !rp || (rp.rerolls ?? 0) <= 0) return;
    rp.rerolls--;
    this.remoteCards = this.remoteReroll(); this.online.sendCards(this.remoteCards);
  }
  checkPicksDone() {
    if (this.pendingPicks && this.pendingPicks.size === 0) { this.pendingPicks = null; this.afterPicks(); }
  }

  // joiner: the host sent our card choices
  openClientCards(cards) {
    const me = this.localPlayer();
    this.state = 'cards';
    this.cards.open(cards, (card) => {
      recordPick(me, card);
      net.send('pick', { index: card.i, replace: card.replace || null });
      this.state = 'play';
      this.banner({ title: 'Card chosen', sub: 'Waiting for the host…', dur: 2, y: 0.25, size: 24 });
    }, me, { reroll: () => { net.send('reroll', {}); return null; } }); // (the host rolls the new hand and sends it)
  }

  // ---------------------------------------------------------------- route map
  // after the gate: the map of this area (or of the next area after a boss); the chosen path decides
  // the reward of the next level
  openRoute() {
    const next = this.level + 1;
    this.routeW = this.routeW || { sacrifice: 1, art: 1 };
    if (!this.route || next > this.route.last || next < this.route.first) this.route = makeAreaMap(areaOf(next), undefined, this.routeW);
    const R = this.route, col = next - R.first;
    if (col > 0) { // the paths on offer: the follow-ups of the path we came by
      ensureKids(R, col - 1, this.routeW);
      if (R.path[col - 1] === undefined) R.path[col - 1] = 0;
      if (!R.cols[col].nodes.length) takePath(R, col - 1, R.path[col - 1]); // (normally already done when that path was chosen)
    }
    ensureKids(R, col, this.routeW); // and what comes after each of them
    // Smuggler's Map: the next unknown route, i.e. the follow-ups this map reveals (greyed out) for the first time,
    // are better. Kept for later when there are none (they lead to the boss, or were already seen).
    const fresh = R.cols[col].nodes.filter((nd) => nd.kids && !nd.kidsSeen);
    if (this.smuggle >= 0 && col + 1 < R.cols.length - 1 && fresh.length) { for (const nd of fresh) smuggle(nd.kids, R.area, this.smuggle); this.smuggle = -1; }
    for (const nd of R.cols[col].nodes) if (nd.kids) nd.kidsSeen = true;
    this.state = 'route'; this.fade = 1; this.fadeDir = -1;
    this.routeScreen.open(R, next, {
      onChoose: (i) => {
        const nd = R.cols[col].nodes[i];
        if (col < R.cols.length - 1 && nd) shiftWeights(this.routeW, nd.r);
        takePath(R, col, i);
        rollCorruption(this, nd, next); // it may turn out to be corrupted (the host decides; it travels in the level info)
        this.routeNext = next;
        const go = () => { this.state = 'transition'; this.fade = 0; this.fadeDir = 1; };
        // a corrupted node shows what it turned into on the map first (and to the joiner too)
        if (nd && nd.corrupt) { this.routeScreen.startReveal(nd.corrupt, i, go); if (this.role === 'host') net.send('creveal', { kind: nd.corrupt, i }); }
        else go();
      },
    });
    if (this.role === 'host') {
      const send = () => net.send('route', { r: R, next, sel: this.routeScreen.sel, ch: this.routeScreen.chosen });
      this.routeScreen.onSel = send;
      const choose = this.routeScreen.choose.bind(this.routeScreen);
      this.routeScreen.choose = (i) => { choose(i); send(); };
      send();
    }
  }
  // joiner: show the host's map and follow the host's cursor
  onRemoteRoute(m) {
    const S = this.routeScreen;
    if (this.state !== 'route' || !S.active || S.next !== m.next) {
      this.route = m.r;
      this.state = 'route'; this.fade = 0; this.fadeDir = 0; this.cards.active = false;
      S.open(m.r, m.next, { readonly: true, sel: m.sel, onChoose: () => {} });
    }
    S.sel = clamp(m.sel | 0, 0, S.options.length - 1);
    if (m.ch >= 0 && S.chosen < 0) { S.chosen = m.ch; S.goT = 0; }
  }

  enterGate() {
    if (this.state !== 'play') return;
    if (this.training) { this.leaveTraining(); return; }
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
  // Enemies step out of house doorways, or walk in from somewhere out of sight: behind a building or beyond the
  // edge of the screen. They never just appear on open ground in view.
  spawnEnemy(type) {
    const w = this.world, r = ENEMIES[type].r;
    { const c = this.coverSpawn(type, r); if (c) return c; } // out of a bush / a pile of leaves
    const doors = w.doors().filter((d) => !w.blocked(d.ox, d.oy, r + 0.1) && this.players.every((p) => p.dead || dist(p.x, p.y, d.ox, d.oy) > 3.5));
    const hidden = doors.length && Math.random() < 0.45 ? null : this.hiddenSpawn(r); // mix doors with walk-ins from out of sight
    if (hidden) {
      const [x0, y0, x1, y1] = hidden;
      const e = new Enemy(this, type, x0, y0, this.level);
      e.emerge = { x0, y0, x1, y1 }; e.t = e.spawnDur = Math.min(1.4, 0.3 + Math.hypot(x1 - x0, y1 - y0) / Math.max(2, e.speed));
      this.addEnemy(e);
      return e;
    }
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
    // nothing hidden and no door free: the far edge of the arena, away from everyone
    const c = this.playersCenter(true);
    let best = null, bd = -1;
    for (let k = 0; k < 40; k++) { const [x, y] = w.randomFreePoint(c[0], c[1], 6, r + 0.2); const d = Math.min(...this.players.filter((p) => !p.dead).map((p) => dist(p.x, p.y, x, y)), 99); if (d > bd) { bd = d; best = [x, y]; } }
    const e = new Enemy(this, type, best[0], best[1], this.level);
    e.emerge = { x0: best[0], y0: best[1], x1: best[0], y1: best[1] }; // (walks on at once: no ink pool)
    this.addEnemy(e);
    return e;
  }
  // area 1: bandits, ninjas, archers and bombers sometimes step out of a bush; area 2: anything can burst out of a
  // pile of fallen leaves. Never right next to a player (3 tiles).
  coverSpawn(type, r) {
    const w = this.world, kind = w.bi === 0 ? 'hidebush' : w.bi === 1 ? 'leafpile' : null;
    if (!kind || w.kind === 'dojo' || Math.random() > 0.4) return null;
    if (kind === 'hidebush' && !COVER_SNEAKY.includes(type)) return null;
    const spots = w.props.filter((p) => p.kind === kind && this.players.every((pl) => pl.dead || dist(pl.x, pl.y, p.x, p.y) > 3));
    if (!spots.length) return null;
    const c = pick(spots), a = rand(0, TAU);
    c.rustleT = this.time;
    const e = new Enemy(this, type, c.x, c.y, this.level);
    let x1 = c.x + Math.cos(a) * 0.9, y1 = c.y + Math.sin(a) * 0.9;
    if (w.blocked(x1, y1, r)) { x1 = c.x; y1 = c.y; }
    e.emerge = { x0: c.x, y0: c.y, x1, y1 }; e.t = e.spawnDur = 0.7;
    this.addEnemy(e);
    this.particles.burst('leaf', c.x, c.y, 0.4, kind === 'hidebush' ? 8 : 14, 3, 0.8, 3, kind === 'hidebush' ? '#4a7a38' : '#d2642a', { drag: 1.5 });
    sfx.spawn();
    return e;
  }
  // a spawn spot nobody can see: [x0, y0, x1, y1] = start out of sight, then the first steps toward the fight.
  // Out of sight = off the screen (with a margin) or behind a house (between it and the camera's far side).
  hiddenSpawn(r) {
    const w = this.world, v = this.view, N = w.N, live = this.players.filter((p) => !p.dead);
    if (!live.length) return null;
    const onScreen = (x, y, m) => { const [sx, sy] = v.toScreen(x, y, 0.6); return sx > -m && sx < v.W + m && sy > -m * 1.6 && sy < v.H + m; };
    const m = 70 * v.dpr, c = this.playersCenter(true);
    for (let k = 0; k < 60; k++) {
      // try the arena's rim first, then anywhere
      const rim = k < 40, a = Math.random() * TAU;
      let x = rim ? clamp(N / 2 + Math.cos(a) * N, 1.2, N - 1.2) : 1.2 + Math.random() * (N - 2.4), y = rim ? clamp(N / 2 + Math.sin(a) * N, 1.2, N - 1.2) : 1.2 + Math.random() * (N - 2.4);
      if (w.blocked(x, y, r + 0.15)) continue;
      if (live.some((p) => dist(p.x, p.y, x, y) < 7)) continue;
      if (onScreen(x, y, m)) continue;
      const dx = c[0] - x, dy = c[1] - y, l = Math.hypot(dx, dy) || 1, step = Math.min(2.5, l * 0.4);
      let x1 = x + (dx / l) * step, y1 = y + (dy / l) * step;
      if (w.blocked(x1, y1, r + 0.1)) { x1 = x; y1 = y; }
      return [x, y, x1, y1];
    }
    // behind a house: the side facing away from the camera (smaller x + y), out of the players' line of sight
    const houses = w.props.filter((p) => p.kind === 'house');
    for (let k = 0; k < 20 && houses.length; k++) {
      const H = houses[Math.floor(Math.random() * houses.length)], x = H.x0 + Math.random() * (H.x1 - H.x0), y = H.y0 - 0.6 - r;
      if (w.blocked(x, y, r + 0.1) || live.some((p) => dist(p.x, p.y, x, y) < 4)) continue;
      const side = Math.random() < 0.5 ? H.x0 - 0.7 - r : H.x1 + 0.7 + r;
      const x1 = w.blocked(side, y + 0.4, r + 0.1) ? x : side, y1 = w.blocked(side, y + 0.4, r + 0.1) ? y : y + 0.4;
      return [x, y, x1, y1];
    }
    return null;
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
  // hit-stop: big moments (boss kills, slams: 0.1 s and up) keep their full pause; ordinary hits pause half as long,
  // and while you chain hits (several enemies, quick strikes) only one in every HITSTOP_GAP seconds pauses at all
  // On top of that, ordinary hit-stops share a budget: at most HITSTOP_BUDGET s of freeze in any HITSTOP_WINDOW s,
  // so crits, kills and heavy hits piling up in a busy fight never make the game stutter.
  hitstop(s) {
    if (s >= 0.1) { this.hitstopT = Math.max(this.hitstopT, s); return; }
    const now = this.realTime;
    if (now - (this.lastHitstop ?? -9) < HITSTOP_GAP) return;
    this.hsLog = (this.hsLog || []).filter((h) => now - h[0] < HITSTOP_WINDOW);
    const used = this.hsLog.reduce((a, h) => a + h[1], 0), d = Math.min(s * 0.5, HITSTOP_BUDGET - used);
    if (d < 0.005) return;
    this.hsLog.push([now, d]);
    this.lastHitstop = now; this.hitstopT = Math.max(this.hitstopT, d);
  }
  slow(dur, scale) { this.slowT = dur; this.slowScale = scale; }
  // slows enemies, their projectiles and hazards, but not the players (bo special)
  timeWarp(dur, scale) { this.warpT = Math.max(this.warpT, dur); this.warpScale = scale; }
  flashScreen(color) { this.localFlash(color); }
  localFlash(color) { this.screenFlash = color; this.screenFlashA = 1; }
  later(t, fn) { this.timers.push({ t, fn }); }
  banner(b) { this.banners.push({ t: 0, dur: 2.2, ...b }); }
  bossPhase(e, msg) { this.banner({ title: msg, dur: 1.8, y: 0.22, size: 26, color: 'rgba(90,10,10,0.8)' }); e.flash = 0.25; }

  // what enemies can hurt: the players and the spirit orb's spirits
  get targets() { return this.spirits && this.spirits.length ? this.players.concat(this.spirits.filter((s) => !s.dead)) : this.players; }

  // src: { player, weapon } for player hits; { chain: true } for lightning; { dot: true } for poison ticks
  damageEnemy(e, dmg, crit, dx, dy, knock, stun, src = null) {
    this.combatT = this.realTime;
    if (e.dead || e.state === 'intro') return;
    const dot = src && src.dot, chain = src && src.chain;
    { // Opening Strike: blows on a healthy enemy (above 80% health; whole hits, not poison ticks or chains)
      const os = src && src.player && src.player.stats && src.player.stats.openStrike;
      if (os && !dot && !chain && e.hp > e.hpMax * OPEN_STRIKE_HP) dmg = Math.round(dmg * (1 + os));
    }
    if (src && src.player && this.hazards.length) { // Smoke Bomb: hits on enemies inside your smoke hurt more
      for (const h of this.hazards) if (h.kind === 'smoke' && h.t > 0 && h.from === src.player && Math.hypot(e.x - h.x, e.y - h.y) < h.r) { dmg = Math.round(dmg * (1 + h.bonus)); break; }
    }
    if (src && src.storm && src.player && src.player.stormRefund) { // Endless Storm: energy back for every enemy its blades hit
      const S = src.storm; S.paid = S.paid || new Set();
      if (!S.paid.has(e)) { S.paid.add(e); src.player.gainEnergy(src.player.stormRefund, true); }
    }
    // shadow clone hits are 'quiet': no hitstop or shake (four clones hitting all the time made the game stutter) and fewer particles
    const ally = !!(src && src.ally);
    // training-hall fighters read the blow and slip it (not while they are attacking or stunned)
    if (e.cfg.dodge && src && src.weapon && !dot && !chain && !e.stun && e.state !== 'windup' && !e.pose && e.state !== 'spawn' && this.time > (e.dodgeT || 0) && Math.random() < e.cfg.dodge) {
      e.dodgeT = this.time + 1.3;
      const l = Math.hypot(dx, dy) || 1, side = Math.random() < 0.5 ? 1 : -1;
      e.kvx += (-dy / l) * side * 7 + (dx / l) * 2; e.kvy += (dx / l) * side * 7 + (dy / l) * 2;
      this.fx.text(e.x, e.y, '見切 Evade', '#cfe8ff', 12);
      this.particles.burst('dust', e.x, e.y, 0.1, 5, 2, 0.4, 4, '#d8d0c0', { under: true });
      sfx.dash();
      return;
    }
    // front shield: weapon hits from the front are mostly blocked until the shield breaks
    let blocked = false;
    const S = e.shield;
    if (S && S.up && src && src.weapon && !dot && !chain && (dx || dy)) {
      const fa = Math.atan2(e.faceY, e.faceX), ha = Math.atan2(-dy, -dx);
      if (Math.abs(angDiff(fa, ha)) < SHIELD.arc / 2) {
        blocked = true;
        S.log = S.log.filter((l) => this.time - l.t < SHIELD.burstWindow);
        S.log.push({ t: this.time, d: dmg });
        if (src.melee) S.melee += src.shieldHits || 1; // a shield bash counts double
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
    // Hunter's Mark: a marked enemy takes more from every other source
    if (e.markT > 0 && !(src && src.mark)) dmg = Math.max(1, Math.round(dmg * (e.markMul || 1.2)));
    // the holy staff's blessing: a vulnerable enemy takes more from everything but the staff's own burst
    if (e.vulnT > 0 && !(src && src.vuln)) dmg = Math.max(1, Math.round(dmg * (e.vulnMul || 1.2)));
    // (the spirit orb's tether no longer makes enemies take more damage: removed 2026-11-20)
    // the enemy a player fights: their spirits go for it too
    if (src && src.player && !src.spirit && !dot && !chain) src.player.focusE = e;
    e.hp -= dmg;
    this.runStats.damage += dmg;
    if (src && !dot) {
      if (src.mark) { e.markT = src.mark; e.markMul = src.markMul || 1.2; }
      if (src.entangle) { // harpoon: pinned in place (bosses: slowed)
        if (!e.boss) { e.stun = Math.max(e.stun, src.entangle); e.poiseT = src.entangle + 0.8; e.rootT = src.entangle; }
        else { e.slow = Math.max(e.slow, src.bossSlow || 0.5); e.slowT = Math.max(e.slowT, src.entangle * 2); }
      }
      if (crit && src.player && src.weapon && src.player.art) { // Nerve Strike: crits stun (bosses: slowed)
        const N = src.player.art(src.weapon, 'nerveStrike');
        if (N && !e.boss) { e.stun = Math.max(e.stun, N.dur); e.poiseT = N.dur + 0.5; }
        else if (N) { e.slow = Math.max(e.slow, N.bossSlow); e.slowT = Math.max(e.slowT, 1); }
      }
    }
    if (src && src.player && src.weapon && !dot && !chain && src.player.onWeaponHit) src.player.onWeaponHit(e, src);
    if (chain) e.shockT = Math.max(e.shockT || 0, 0.7);
    if (dot) {
      this.fx.text(e.x, e.y, `${dmg}`, src && src.pool ? '#ffffff' : src && src.crush ? '#b07a44' : src && src.burn ? '#ffa040' : src && src.tether ? '#9fd8ff' : '#9be86a', 11); // poison is green; the holy pool's ticks are white; tethers pale blue
    } else {
      e.flash = 0.09;
      if (src && src.shudder) e.shudder = Math.max(e.shudder || 0, src.shudder); // crossbow bolts: the target shudders
      if (!e.boss) {
        e.kvx += dx * knock; e.kvy += dy * knock;
        // Light hits only flinch. Only heavy hits (stun >= 0.3) interrupt attacks,
        // and a staggered enemy can't be re-staggered for a moment, so nothing gets perma-locked.
        const s = stun * (e.type === 'oni' ? 0.4 : 1);
        if (s >= 0.3 && e.poiseT <= 0) { e.stun = Math.max(e.stun, s); e.poiseT = s + 0.8; }
      }
      // a normal hit's number: 11.5 at the bottom of the damage range up to 14 at the top (crits stay 19)
      const LR = src && src.player && src.player.lastRoll, roll = LR && LR.t === this.time ? LR.r : 0;
      this.fx.text(e.x, e.y, crit ? `${dmg}!` : `${dmg}`, blocked ? '#9aa4b4' : chain ? '#fff27a' : crit ? '#ffd34a' : '#ffffff', blocked ? 12 : crit ? 19 : chain ? 12 : 12.75 + 1.25 * roll, crit && !blocked);
      const z = e.boss ? 1.2 : 0.6;
      this.particles.burst('spark', e.x, e.y, z, ally ? 3 : crit ? 9 : 5, crit ? 8 : 5, 0.22, crit ? 2 : 1.4, chain ? '#fff6a0' : crit ? '#ffe680' : '#ffffff');
      if (!chain) this.particles.burst('blood', e.x, e.y, z, ally ? 2 : 4, 3, 0.45, 2.2, e.type === 'dummy' ? '#d8b46a' : e.type === 'kappa' ? '#2a6a3a' : e.type === 'oni' || e.type === 'oni_lord' ? '#3a0a3a' : '#7a1020', { grav: 10 });
      const snd = src && src.sound; // each weapon's own hit sound
      if (crit) { sfx.crit(); if (!ally) { this.hitstop(0.035); this.shake(2.5); } } else if (!chain) (snd && sfx[snd] ? sfx[snd]() : sfx.hit());
      if (src && src.weapon && !chain) this.applyElements(e, dmg, src);
    }
    if (src && src.player && !src.spirit) { e.killer = src.player; e.killWeapon = src.weapon || null; e.lastHitT = this.time; }
    if (e.type === 'dummy') { e.data.lastHit = this.time; if (this.trainingStats) { this.trainingStats.log.push([this.time, dmg]); this.trainingStats.total += dmg; } if (e.hp <= 0) { e.hp = e.hpMax; this.fx.text(e.x, e.y, 'Reset', '#cfe8ff', 13); } }
    if (e.hp <= 0 && !e.dead && src && src.player && src.player.onKill) src.player.onKill(e, src);
    if (e.hp <= 0) this.killEnemy(e, dx, dy, ally);
  }

  // ---------------------------------------------------------------- burn (imbuement): fires on the ground
  // each fire ticks every burnTick s, dealing its pool / ticks left to every enemy in it (the host deals it)
  updateBurns(dt) {
    if (!this.burns || !this.burns.length) return;
    for (const B of this.burns) {
      B.t -= dt; B.tick -= dt;
      if (B.tick <= 0 && B.left > 0 && this.role !== 'client') {
        B.tick += ELEMENT_RULES.burnTick;
        const n = Math.max(1, Math.round(B.pool / B.left)); B.pool = Math.max(0, B.pool - n); B.left--;
        for (const o of this.enemies) {
          if (o.dead || o.hidden || o.state === 'spawn' || o.state === 'intro' || dist(o.x, o.y, B.x, B.y) > B.r) continue; // (an enemy burns when its centre is in the fire)
          this.damageEnemy(o, n, false, 0, 0, 0, 0, { player: B.player, weapon: B.weapon, dot: true, burn: true });
        }
      }
      if (Math.random() < dt * 14) this.particles.emit('ember', B.x + (Math.random() - 0.5) * B.r * 1.6, B.y + (Math.random() - 0.5) * B.r * 1.6, 0.05, 0, 0, 0.9 + Math.random() * 0.6, 0.6 + Math.random() * 0.4, 1.8, Math.random() < 0.5 ? '#ffb040' : '#ff6a2a');
    }
    this.burns = this.burns.filter((B) => B.t > 0);
  }
  // cut arrows: two halves lying on the ground, fading after a few seconds
  drawCutBits(ctx) {
    if (!this.cutBits || !this.cutBits.length) return;
    this.cutBits = this.cutBits.filter((b) => this.time - b.t < 4);
    for (const b of this.cutBits) {
      const age = this.time - b.t, fall = Math.min(1, age / 0.25), a = Math.min(1, (4 - age) / 0.8);
      const sx = isoX(b.x, b.y), sy = isoY(b.x, b.y, 0.6 * (1 - fall)), sa = Math.atan2(Math.sin(b.a) * 0.5, Math.cos(b.a)); // (screen angle of its flight)
      ctx.save(); ctx.globalAlpha = a; ctx.translate(sx, sy); ctx.lineCap = 'round';
      for (const side of [-1, 1]) { // each half drifts apart and turns a little as it drops
        ctx.save(); ctx.translate(side * 5 * fall * Math.cos(sa), side * 5 * fall * Math.sin(sa) + 2 * fall); ctx.rotate(sa + side * b.s * 0.5 * fall);
        ctx.strokeStyle = b.kind === 'kunai' || b.kind === 'bolt' ? '#5a5f66' : '#5a3a1e'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(side > 0 ? 1 : -9, 0); ctx.lineTo(side > 0 ? 9 : -1, 0); ctx.stroke();
        if (side > 0) { ctx.fillStyle = b.kind === 'icearrow' ? '#cff4ff' : '#dddddd'; ctx.beginPath(); ctx.moveTo(9, -2); ctx.lineTo(13, 0); ctx.lineTo(9, 2); ctx.fill(); } // the head
        else { ctx.fillStyle = '#eeeeee'; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-12, -2.5); ctx.lineTo(-7, 0); ctx.lineTo(-12, 2.5); ctx.fill(); } // the fletching
        ctx.restore();
      }
      ctx.restore();
    }
  }
  // a burning patch: a glowing scorched ellipse with flames licking up round its edge
  drawBurns(ctx, t) {
    if (!this.burns || !this.burns.length) return;
    const TILE = 45.25;
    for (const B of this.burns) {
      const a = Math.min(1, B.t / 0.35, (ELEMENT_RULES.burnDur - B.t + 0.08) / 0.12), rx = B.r * TILE, ry = rx * 0.5 /* (drawn at its true radius: the hit area is exactly what you see) */, sx = isoX(B.x, B.y), sy = isoY(B.x, B.y);
      ctx.save(); ctx.globalAlpha = Math.max(0, a);
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
      gr.addColorStop(0, 'rgba(255,170,60,0.6)'); gr.addColorStop(0.7, 'rgba(230,80,20,0.42)'); gr.addColorStop(1, 'rgba(120,20,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,150,60,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 9; k++) { // flames round the edge, each flickering at its own pace
        const ang = (k / 9) * TAU + B.seed, fl = 0.6 + 0.4 * Math.sin(t * (9 + k) + B.seed * 3 + k);
        const fx = sx + Math.cos(ang) * rx * 0.82, fy = sy + Math.sin(ang) * ry * 0.82, h = (9 + (k % 3) * 3) * fl;
        ctx.fillStyle = k % 2 ? 'rgba(255,190,70,0.75)' : 'rgba(255,110,30,0.75)';
        ctx.beginPath(); ctx.moveTo(fx - 3.5, fy); ctx.quadraticCurveTo(fx - 2, fy - h * 0.6, fx + Math.sin(t * 7 + k) * 1.5, fy - h); ctx.quadraticCurveTo(fx + 2, fy - h * 0.6, fx + 3.5, fy); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
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
    const P0 = src.player, M = ((P0 && P0.elemMul) || 1) * (P0 && P0.elemStormT > 0 ? 1 + P0.elemStormBonus : 1); // Elemental Covenant, Elemental Storm
    if (el.syphon > 0 && src.player) { // lifesteal: heal for a share of the damage dealt (fractions carry over)
      const P = src.player;
      // Lifebinder: the heal goes to the partner instead (x1.5)
      const partner = P.lifebinder ? this.players.find((q) => q !== P && q.active) : null, keep = P.lifebinder && P.lifebinderSelf; // (Satanist: you keep your own heal too)
      const to = P.lifebinder && !keep ? partner : P;
      // (tiny hits add up: 5 damage at 1% is 0.05, kept until it makes a whole point)
      P.syphonAcc = (P.syphonAcc || 0) + dmg * Math.min(ELEMENTS.syphon.cap, el.syphon * M) * (P.lifebinder && !keep ? 1.5 : 1);
      if (P.syphonAcc >= 1) {
        const n = Math.floor(P.syphonAcc); P.syphonAcc -= n;
        if (keep && partner) partner.heal(Math.round(n * 1.5));
        const got = to ? to.heal(n) : 0;
        if (got > 0) { to.healPop = (to.healPop || 0) + got; if (Math.random() < 0.5) this.particles.emit('glow', to.x, to.y, 0.8, 0, 0, 0.8, 0.5, 2.2, '#ff6b8a'); }
      }
    }
    if (el.arcane > 0 && src.player) { // arcane: damage dealt flows back as energy (fractions carry over)
      const P = src.player;
      P.arcAcc = (P.arcAcc || 0) + dmg * Math.min(ELEMENTS.arcane.cap, el.arcane * M);
      if (P.arcAcc >= 1) { const n = Math.floor(P.arcAcc); P.arcAcc -= n; P.gainEnergy(n); }
      if (Math.random() < 0.6) this.particles.burst('glow', e.x, e.y, 0.8, 3, 2.5, 0.45, 2, '#6ab4ff');
    }
    if (el.poison > 0) { // a share of this hit goes into the enemy's poison, which drains over poisonDur s
      let near = 0; // (other poisoned enemies close by make it spread harder)
      for (const o of this.enemies) if (o !== e && !o.dead && o.poison && o.poison.t > 0 && dist(o.x, o.y, e.x, e.y) < POISON_GROUP.range && ++near >= POISON_GROUP.max) break;
      const share = Math.min(ELEMENTS.poison.cap, el.poison * M) * (POISON_GROUP.base + POISON_GROUP.per * near);
      if (Math.random() < 0.5) this.particles.burst('glow', e.x, e.y, 0.6, 4, 1.6, 0.6, 2, '#8fe05a');
      const P = e.poison && e.poison.pool != null && !e.poison.net ? e.poison : (e.poison = { pool: 0, acc: 0, tick: R.poisonTick });
      P.pool += dmg * share; P.rate = P.pool / R.poisonDur; P.t = R.poisonDur; P.player = src.player;
    }
    if (el.burn > 0) { // burn: the ground under the enemy catches fire (or the fire already under it grows)
      const share = Math.min(ELEMENTS.burn.cap, el.burn * M);
      let B = this.burns.find((b) => b.e === e && b.t > 0 && dist(b.x, b.y, e.x, e.y) < 0.7);
      if (!B && this.burns.length < 40) { B = { e, x: e.x, y: e.y, t: 0, tick: R.burnTick, pool: 0, r: R.burnRadius, player: src.player, weapon: src.weapon, seed: Math.random() * 10 }; this.burns.push(B); this.particles.burst('ember', e.x, e.y, 0.1, 8, 2.5, 0.6, 2.2, '#ffa040'); }
      if (B) { B.pool += dmg * share; B.t = R.burnDur; B.left = Math.round(R.burnDur / R.burnTick); }
    }
    if (el.ice > 0) {
      e.slow = Math.min(ELEMENTS.ice.cap, Math.max(e.slow, el.ice * M)); e.slowT = R.slowDur;
      if (Math.random() < 0.6) this.particles.burst('shard', e.x, e.y, 0.8, 4, 2.5, 0.45, 2.5, '#cff4ff');
      if (Math.random() < 0.4) this.particles.burst('dot', e.x, e.y, 0.5, 5, 1.5, 0.6, 1.8, '#ffffff');
    }
    if (el.lightning > 0) {
      const hit = new Set([e]);
      let from = e;
      e.shockT = Math.max(e.shockT || 0, 0.7);
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
        // (fair rounding: a 0.5 chain hits for 1 half of the time, so small fast hits don't chain for a full point every time)
        const cv = dmg * chainDamageFor(el.lightning, dmg), cd = Math.floor(cv) + (Math.random() < cv - Math.floor(cv) ? 1 : 0);
        if (cd > 0) this.damageEnemy(best, cd, false, 0, 0, 0.5, 0, { chain: true, player: src.player });
        from = best;
      }
      if (hit.size > 1) sfx.zap();
    }
  }

  killEnemy(e, dx = 0, dy = 0, quiet = false) {
    if (e.dead) return;
    if (e.type === 'gensai') { this.gensaiDown(e); return; }
    e.dead = true; e.deathT = 0; e.tele = null; e.hidden = false; e.vx = dx * 2; e.vy = dy * 2; e.poison = null;
    this.runStats.kills++;
    tetherOnDeath(this, e); // a spirit orb tether jumps on to the next enemy
    rememberFallen(this, e); // ... and the orb's special can call this one back
    const bi = this.world.bi;
    sfx.death();
    this.particles.burst('ink', e.x, e.y, 0.6, e.boss ? 40 : 14, e.boss ? 6 : 3.5, 0.7, e.boss ? 6 : 4, '#1e1428');
    if (bi === 0) this.particles.burst('petal', e.x, e.y, 0.8, 10, 3, 2, 2.6, '#f7c3d2');
    else if (bi === 1) this.particles.burst('leaf', e.x, e.y, 0.8, 10, 3, 2, 2.8, '#e0542c');
    else this.particles.burst('ember', e.x, e.y, 0.8, 14, 3, 1.2, 2.2, '#ff8a30');
    this.decals.add(e.x, e.y, e.boss ? 1 : 0.45, e.type === 'kappa' ? 'rgba(30,70,40,1)' : 'rgba(60,10,25,1)');
    if (e.boss || !quiet) this.hitstop(e.boss ? 0.2 : 0.025);
    this.dropLoot(e);
    if (e.boss) {
      this.shake(18); this.slow(1.6, 0.2); sfx.explode(); sfx.bossRoar();
      this.fx.ring(e.x, e.y, 5, 'rgba(255,240,200,0.9)', 0.9, 10);
      for (const o of this.enemies) if (!o.dead && o !== e) this.killEnemy(o);
      this.hazards.length = 0;
      for (const q of this.projectiles) if (q.owner === 'enemy') q.dead = true;
    }
    tryFinisher(this, e); // now and then (and always on a boss) the killer plays a finishing move
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
          else best.gainEnergy(k.amt, true); // a blue +N on the player
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
    if (input.pressed('debug') && (this.inRun || !input.pad.connected)) this.debug = !this.debug; // the pad's Back button is SELECT in the menus

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
        if ((this.state === 'play' || this.state === 'cards') && input.pressed('pause')) { this.setPaused(true); input.eat('pause'); break; } // (also while choosing a card)
        if (this.martialPending && this.state === 'play' && !this.training && this.spawner && this.fade <= 0.05) { this.martialPending = false; this.offerMartial(); }
        if (this.state === 'cards') { this.cards.update(dtReal); if (client) this.stepClient(dtReal); else this.updateWorldAmbient(dtReal * 0.3); break; }
        if (client) { if (this.state !== 'transition') this.stepClient(dtReal); } else this.updatePlay(dtReal);
        break;
      }
      case 'route':
        this.routeScreen.update(dtReal);
        break;
      case 'dead': case 'victory':
        this.overlay.updateEnd(dtReal);
        this.updateWorldAmbient(dtReal);
        break;
    }
    if (this.online && this.state !== 'title') this.online.update(dtReal);
    this.updateMusic();
    this.updateTenseVis(dtReal);
    for (let i = this.banners.length - 1; i >= 0; i--) { const b = this.banners[i]; b.t += dtReal; if (b.t >= b.dur) this.banners.splice(i, 1); }
    if (this.fadeDir) {
      this.fade = clamp(this.fade + (this.fadeDir * dtReal) / 0.5, 0, 1);
      if (this.fadeDir > 0 && this.fade >= 1) {
        this.fadeDir = 0;
        if (this.state === 'transition' && this.role !== 'client') {
          if (this.routeNext === this.level + 1) { this.routeNext = 0; this.state = 'play'; if (this.level + 1 === 11) this.playArea2(); else if (this.level + 1 === 31) this.playArea4(); else this.loadLevel(this.level + 1); }
          else this.openRoute();
        }
      }
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
    updateCorruption(this, dt, true);
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
    updateSpirits(this, dt);
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
        // overlapping bodies: the enemy gives way only a little (heavies and shield walls barely), the player is held back
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = rr - d, give = a.boss ? 0 : a.cfg.heavy || a.cfg.behavior === 'shieldTank' ? 0.1 : 0.3;
          a.x += (dx / d) * push * give; a.y += (dy / d) * push * give;
          p.x -= (dx / d) * push * (1 - give); p.y -= (dy / d) * push * (1 - give);
        }
      }
    }
    for (let i = E.length - 1; i >= 0; i--) if (E[i].dead && E[i].deathT > 1.0 && !E[i].kneel) E.splice(i, 1);

    updateProjectiles(this, edt);
    updateHazards(this, edt, dt);
    this.updateBurns(edt);
    w.update(dt, this.time, this.particles, this.view);
    this.particles.update(dt, (x, y, t) => w.wind(x, y, t), this.time);
    this.decals.update(dt); this.fx.update(dt);

    const anyAlive = P.some((p) => p.active);
    if (!this.cleared && this.spawner.done && !E.some((e) => !e.dead) && anyAlive && !P.some((p) => p.finisher)) this.onLevelCleared(); // (a finishing move plays out first)
    if (w.gate.active && this.state === 'play' && P.some((p) => p.active && dist(p.x, p.y, w.gate.x, w.gate.y) < 0.95)) this.enterGate();
    // library: the first player to reach the desk takes the scroll (the talent cards)
    if (this.scrollWaiting && this.state === 'play' && (w.library || w.shrine)) {
      const A = w.library || w.shrine, D = A.desk;
      if (P.some((p) => p.active && dist(p.x, p.y, D.x, D.y) < 1.5)) {
        this.scrollWaiting = false; A.taken = true; A.ready = false;
        sfx.take(); this.particles.burst('glow', D.x, D.y, 1.0, 16, 2, 0.9, 2.2, '#ffe6a0');
        this.offerBlessings(0.3, true);
      }
    }

    this.updateCamera(dt);
  }

  // joiner: move our own ninja, smooth the host's world, and run cosmetic effects
  stepClient(dt) {
    if (this.hitstopT > 0) { this.hitstopT -= dt; this.updateShake(dt); return; }
    this.time += dt;
    updateCorruption(this, dt, false);
    const me = this.localPlayer();
    if (me && this.state !== 'cards' && this.state !== 'dialogue') me.update(dt);
    smoothPuppets(this, dt);
    updateSpirits(this, dt); // (the joiner only moves the host's spirits along)
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
    if (P.length === 1) { // solo: the camera leads a little toward the aim, easing over ~0.5 s so turning around is smooth
      const p = P[0], lx = (p.aimX - p.aimY) * 32 * 1.1, ly = (p.aimX + p.aimY) * 16 * 1.1, k = 1 - Math.exp(-1.6 * dt);
      if (!this.camLead) this.camLead = { x: lx, y: ly };
      this.camLead.x = lerp(this.camLead.x, lx, k); this.camLead.y = lerp(this.camLead.y, ly, k);
      tx += this.camLead.x; ty += this.camLead.y;
    }
    // tense: the camera leans in a little; low health: up to 14% closer
    let zoom = (1 + 0.04 * ease.inOutSine(this.tenseVis || 0)) * (1 + 0.24 * ease.inOutSine(this.lowVis || 0));
    if (P.length > 1 && !P[0].dead && !P[1].dead) {
      // co-op: never closer than what keeps both players on screen (inside the cinematic bars too)
      const bars = 1 - 2 * 0.07 * (this.lowVis || 0);
      const sepX = Math.abs(isoX(P[0].x, P[0].y) - isoX(P[1].x, P[1].y)) * this.view.baseS / (this.view.W * 0.75);
      const sepY = Math.abs(isoY(P[0].x, P[0].y) - isoY(P[1].x, P[1].y)) * this.view.baseS / (this.view.H * 0.7 * bars);
      zoom = clamp(Math.min(zoom, 1 / Math.max(1e-3, sepX, sepY)), 0.62, zoom);
    }
    const fp = P.find((p) => p.finisher);
    if (fp) { const T = fp.finisher.T, mx = (fp.x + T.x) / 2, my = (fp.y + T.y) / 2; tx = isoX(mx, my); ty = isoY(mx, my) - 18; zoom *= 1.15; }
    this.cam.zoom = lerp(this.cam.zoom, zoom, 1 - Math.exp(-(fp ? 6 : 3) * dt));
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
    this.fx.drawQuakes(ctx); // (the gloves' ground cracks)
    drawHazards(ctx, this, t);
    this.drawBurns(ctx, t);
    this.drawCutBits(ctx);
    drawCorruptionGround(ctx, this, t);
    for (const e of this.enemies) e.drawAura(ctx, t); // (Banner Bearer circles, under the attack telegraphs)
    for (const e of this.enemies) e.drawTelegraph(ctx, t);
    for (const p of this.players) p.drawBoltMarks(ctx, t); // crossbow marks on the ground around the marked enemy
    for (const e of this.enemies) e.drawShadow(ctx);
    for (const p of this.players) p.drawShadow(ctx);
    for (const p of this.players) if (!p.remote && !p.puppet) { p.drawAimGuide(ctx); p.drawChargeIndicator(ctx); } // only on the shooter's own screen
    drawProjectileShadows(ctx, this.projectiles);

    // depth-sorted drawables; props in front of a player fade out
    const items = [];
    const pls = this.players.filter((p) => !p.dead);
    for (const pr of w.props) {
      const [bx, by, bw, bh] = w.boundsOf(pr);
      if (bx > v.x1 || bx + bw < v.x0 || by > v.y1 || by + bh < v.y0) continue;
      const d = w.depthOf(pr);
      let alpha = 1;
      if (pr.kind === 'house' || pr.kind === 'tree' || pr.kind === 'bamboo' || pr.kind === 'torii' || pr.kind === 'banner' || pr.kind === 'temple' || pr.kind === 'libroof') {
        for (const p of pls) {
          const psx = isoX(p.x, p.y), psy = isoY(p.x, p.y) - 20;
          if (d > p.x + p.y && psx > bx && psx < bx + bw && psy > by && psy < by + bh) alpha = 0.42;
          // the library roof lifts away while someone is inside (or right under its eaves)
          if (pr.kind === 'libroof' && p.x > pr.x0 - 0.8 && p.x < pr.x1 + 0.8 && p.y > pr.y0 - 0.8 && p.y < pr.y1 + 0.8) alpha = 0.14;
        }
      }
      items.push({ d, draw: () => { ctx.globalAlpha = alpha; w.drawProp(ctx, pr, t); ctx.globalAlpha = 1; } });
    }
    for (const e of this.enemies) items.push({ d: e.x + e.y + 0.01, draw: () => e.draw(ctx, t) });
    for (const p of this.players) { items.push({ d: p.x + p.y + 0.02, draw: () => p.draw(ctx, t) }); if (p.addWorldItems) p.addWorldItems(items, ctx, t); } // (thrown katanas, the shield disc, the orb)
    for (const a of this.allies) { a.drawShadow(ctx); items.push({ d: a.x + a.y + 0.015, draw: () => a.draw(ctx, t) }); }
    for (const s of this.spirits) { s.drawShadow(ctx); items.push({ d: s.x + s.y + 0.016, draw: () => s.draw(ctx, t) }); }
    if (this.monk) { const m = this.monk; m.drawShadow(ctx); items.push({ d: m.x + m.y + 0.015, draw: () => m.draw(ctx, t) }); }
    for (const q of this.projectiles) items.push({ d: q.x + q.y + 0.03, draw: () => drawProjectiles(ctx, [q], t) });
    for (const k of this.pickups) items.push({ d: k.x + k.y + 0.005, draw: () => this.drawPickup(ctx, k, t) });
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.draw();
    drawCorruptionOver(ctx, this, t); // the mist's clouds, over everyone

    this.particles.draw(ctx, false);
    drawSpiritFx(ctx, this, t);
    this.fx.drawSlashes(ctx);
    this.fx.drawPulls(ctx);
    this.fx.drawEarth(ctx); // (the gloves' rising rock, the shield's lion roar)
    this.fx.drawBolts(ctx);
    this.fx.drawTexts(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const extra = [];
    if (w.biome.night || w.forceNight) {
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
    drawCorruptionScreen(ctx, this, v, t);
    if (this.tenseVis > 0.01 || this.tenseEmbers.length) drawTenseOverlay(ctx, this);
    drawCinemaBars(ctx, this);
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
      const onMap = this.state === 'route' || (this.state === 'transition' && this.routeNext);
      if (this.teaHouse && !onMap && this.state !== 'intro') { ctx.save(); ctx.globalAlpha = Math.min(1, (this.realTime - this.teaHouse.start) / 0.6); drawTeaHouse(ctx, this, this.realTime); ctx.restore(); }
      if (this.state !== 'intro' && this.state !== 'dead' && this.state !== 'victory' && !onMap) drawHUD(ctx, this);
      if (this.training && this.state === 'play') this.drawTrainingPanel(ctx);
      if (!this.paused) drawBanners(ctx, this); // (no banners over the pause screen)
      if (this.state === 'cards') this.cards.draw(ctx);
      if (onMap) this.routeScreen.draw(ctx);
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

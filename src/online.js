// Online co-op sync. The host simulates everything and sends snapshots + effect events;
// the joiner moves its own ninja locally, sends input/attacks, and draws the host's world.
import { lerp, rand } from './util.js';
import { net } from './net.js';
import { sfx } from './audio.js';
import { Enemy } from './enemies.js';
import { BOSSES, ENEMIES } from './config.js';
import { rollUpgrades, applyUpgrade } from './cards.js';
import { ShadowClone } from './talents.js';
import { Monk } from './sacrifice.js';

const SNAP_INTERVAL = 0.05;   // 20 snapshots / s
const INPUT_INTERVAL = 1 / 30; // 30 input packets / s
const round = (v, d = 100) => Math.round(v * d) / d;

// ------------------------------------------------------------------ encoding helpers
function encPlayer(p) {
  const a = p.anim, d = p.dash;
  return {
    x: round(p.x), y: round(p.y), z: round(p.z), ax: round(p.aimX), ay: round(p.aimY),
    hp: round(p.hp, 10), en: round(p.energy, 10), dead: p.dead ? 1 : 0, fl: round(p.flash), ifr: round(p.iframes),
    mv: round(p.moveAmt), wk: round(p.walk), as: p.activeSlot, ht: round(p.hurtT), ch: round(p.chillT),
    an: a ? [a.kind, round(a.t), a.side || 0, round(a.dur)] : null,
    da: d.t > 0 ? [d.type, round(d.t), round(d.dur), round(d.dx), round(d.dy), round(d.ax ?? d.dx), round(d.ay ?? d.dy)] : null,
    sp: p.spin ? 1 : 0, lp: p.leap ? 1 : 0, gd: p.guard ? [round(p.guard.t), round(p.guard.dur), round(p.guard.store), round(p.guard.flash)] : 0,
    dn: p.downed ? [round(p.downT), round(p.reviveP)] : 0, rg: round(p.rageT), mh: p.maxHpMul || 1, sac: p.sac, rl: p.returnLevel || 0, ru: p.rushT > 0 ? [round(p.rushT), round(p.rushMul)] : 0,
  };
}
const applyDowned = (p, s) => { if (s.dn) { p.downed = true; p.downT = s.dn[0]; p.reviveP = s.dn[1]; } else p.downed = false; p.rageT = s.rg || 0; };
function applyPlayerVisual(p, s, snapAll) {
  p.tx = s.x; p.ty = s.y; p.z = s.z; p.aimX = s.ax; p.aimY = s.ay;
  if (snapAll) { p.x = s.x; p.y = s.y; }
  p.flash = s.fl; p.iframes = s.ifr; p.moveAmt = s.mv; p.walk = s.wk; p.activeSlot = s.as; p.hurtT = s.ht; p.chillT = s.ch;
  p.anim = s.an ? { kind: s.an[0], t: s.an[1], side: s.an[2], dur: s.an[3] || 0.3 } : null;
  if (s.da) { p.dash.type = s.da[0]; p.dash.t = s.da[1]; p.dash.dur = s.da[2]; p.dash.dx = s.da[3]; p.dash.dy = s.da[4]; } else p.dash.t = 0;
  p.spin = s.sp ? (p.spin || { t: 0 }) : null;
  p.leap = s.lp ? (p.leap || { t: 0 }) : null;
  const sw = p.weapons.find((q) => q.key === 'shield');
  p.guard = s.gd && sw ? { t: s.gd[0], dur: s.gd[1], store: s.gd[2], flash: s.gd[3], w: sw, def: sw.def.special, recent: [] } : null;
}

const encTele = (T) => (T ? JSON.stringify(T) : 0);

function encEnemy(e) {
  return [
    e.id, e.type, round(e.x), round(e.y), round(e.z), round(e.faceX), round(e.faceY), e.state, round(e.t), round(e.tDur || 1),
    e.pose ? e.pose.kind : 0, e.pose ? round(e.pose.t) : 0, Math.max(0, Math.round(e.hp)), e.hpMax, round(e.flash), round(e.alpha),
    e.hidden ? 1 : 0, e.dead ? 1 : 0, round(e.stun), round(e.moveAmt), round(e.slowT), e.poison ? 1 : 0, e.phase,
    encTele(e.tele), e.data && e.data.hand ? e.data.hand : 0, e.introVis ? JSON.stringify(e.introVis) : 0, e.emerge ? 1 : 0, e.shield ? (e.shield.up ? 1 : 2) : 0,
    e.kneel ? 1 : 0, e.guarded ? 1 : 0, e.next || 0, e.shield && e.shield.up ? round(e.shieldProgress()) : 0,
  ];
}

function encProj(q) {
  return q.lob
    ? [q.kind, 1, round(q.sx), round(q.sy), round(q.tx), round(q.ty), round(q.t), q.T, q.owner === 'enemy' ? 1 : 0]
    : [q.kind, 0, round(q.x), round(q.y), round(q.z), round(q.vx), round(q.vy), round(q.seed), q.owner === 'enemy' ? 1 : 0];
}

function encHazard(h) {
  if (h.kind === 'ring') return { k: 'ring', x: round(h.x), y: round(h.y), rad: round(h.rad), speed: h.speed, max: h.max, width: h.width, gap: h.gap ?? null, gapW: h.gapW || 0, fire: h.fire ? 1 : 0 };
  if (h.kind === 'fire') return { k: 'fire', x: round(h.x), y: round(h.y), r: h.r, life: round(h.life) };
  if (h.kind === 'arrows' || h.kind === 'meteor') return { k: h.kind, x: round(h.x), y: round(h.y), r: h.r, t: round(h.t), delay: h.delay || 0 };
  if (h.kind === 'seal') return { k: 'seal', x: round(h.x), y: round(h.y), r: h.r, t: round(h.t), dur: h.dur };
  if (h.kind === 'slash') return { k: 'slash', x0: round(h.x0), y0: round(h.y0), x1: round(h.x1), y1: round(h.y1), t: round(h.t), done: h.done ? 1 : 0, f: round(h.fadeT || 0), w: h.w };
  if (h.kind === 'mirage') return { k: 'mirage', x: round(h.x), y: round(h.y), vx: h.vx, vy: h.vy, t: round(h.t), fx: h.fx, fy: h.fy };
  return { k: 'marker', x: round(h.x), y: round(h.y), r: h.r, t: round(h.t), dur: h.dur };
}
function decHazard(o) {
  if (o.k === 'ring') return { kind: 'ring', x: o.x, y: o.y, rad: o.rad, speed: o.speed, max: o.max, width: o.width, gap: o.gap, gapW: o.gapW, fire: !!o.fire };
  if (o.k === 'fire') return { kind: 'fire', x: o.x, y: o.y, r: o.r, life: o.life, tick: 0 };
  if (o.k === 'arrows' || o.k === 'meteor') return { kind: o.k, x: o.x, y: o.y, r: o.r, t: o.t, delay: o.delay, puppet: true };
  if (o.k === 'seal') return { kind: 'seal', x: o.x, y: o.y, r: o.r, t: o.t, dur: o.dur, puppet: true };
  if (o.k === 'slash') return { kind: 'slash', x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1, t: o.t, done: !!o.done, fadeT: o.f, w: o.w, puppet: true };
  if (o.k === 'mirage') return { kind: 'mirage', x: o.x, y: o.y, vx: o.vx, vy: o.vy, t: o.t, fx: o.fx, fy: o.fy, puppet: true };
  return { kind: 'marker', x: o.x, y: o.y, r: o.r, t: o.t, dur: o.dur };
}

// ================================================================== HOST
export class OnlineHost {
  constructor(g) {
    this.g = g; this.snapT = 0; this.events = []; this.isHost = true;
    this.remote = () => g.players[1];
    this.hook();
    net.off('in'); net.off('atk'); net.off('tal'); net.off('pick'); net.off('sacpick'); net.off('disconnect');
    net.on('in', (m) => { const p = this.remote(); if (p && !p.dead) p.applyRemoteState(m); });
    net.on('atk', (m) => { const p = this.remote(); if (p && p.active) p.forceAttack(m.slot, m.special, m.ax, m.ay, m.ch, m.cb); });
    net.on('tal', (m) => { const p = this.remote(); if (p && p.active) p.forceTalent(m.i, m.tx, m.ty); });
    net.on('pick', (m) => g.onRemotePick(m.index, m.replace));
    net.on('sacpick', (m) => g.onRemoteSacPick(m.key));
    net.on('dlgnext', () => g.onRemoteNext());
    net.off('lobby'); net.on('lobby', () => g.toLobby(false)); // the joiner left the end screen: go back together
    net.off('pause'); net.on('pause', (m) => { if (!m.on || g.state === 'play') g.setPaused(!!m.on, true); }); // the joiner paused / resumed
    net.on('disconnect', () => {
      const p = this.remote();
      if (p) { p.dead = true; p.disconnected = true; }
      g.banner({ title: 'Player 2 disconnected', sub: 'You continue alone', dur: 3, y: 0.25, size: 26, color: 'rgba(60,4,10,0.8)' });
      if (g.pendingPicks) { g.pendingPicks.delete(1); g.checkPicksDone(); }
      if (g.sacPending) { g.sacPending.delete(1); g.checkSacDone(); }
    });
  }

  // forward effect calls to the joiner (so both see/hear the same hits)
  // Wrappers are installed once per object and forward to whichever host session is active.
  hook() {
    const g = this.g;
    const push = (tag, a) => { const h = g.online; if (h && h.isHost && net.connected) h.events.push([tag, a]); };
    const wrap = (obj, name, tag) => {
      if (!obj || obj['__hooked_' + name]) return;
      const f = obj[name].bind(obj);
      obj[name] = (...a) => { push(tag, a); return f(...a); };
      obj['__hooked_' + name] = true;
    };
    for (const n of ['slash', 'ring', 'text', 'bolt', 'thrust', 'spirit']) wrap(g.fx, n, 'fx.' + n);
    wrap(g.particles, 'burst', 'pb'); wrap(g.decals, 'add', 'dc');
    wrap(g, 'banner', 'bn'); wrap(g, 'shake', 'sh'); wrap(g, 'flashScreen', 'fs');
    if (!sfx.__hooked) {
      sfx.__hooked = true;
      for (const n of Object.keys(sfx)) { if (typeof sfx[n] !== 'function') continue; const f = sfx[n]; sfx[n] = (...a) => { push('sfx', [n, ...a]); return f(...a); }; }
    }
  }

  levelLoaded(n, seed, info) { this.hook(); net.send('level', { n, seed, info }); }
  sendState() { net.send('state', { st: this.g.state }); }
  sendCards(cards) { net.send('cards', { cards }); }
  sendSac(cards) { net.send('sac', { cards }); }

  update(dt) {
    if (!net.connected) { this.events.length = 0; return; }
    this.snapT -= dt;
    if (this.snapT > 0) return;
    this.snapT = SNAP_INTERVAL;
    const g = this.g;
    const remote = this.remote();
    const snap = {
      st: g.state, lv: g.level, cl: g.cleared ? 1 : 0, pz: g.paused ? 1 : 0,
      p0: encPlayer(g.players[0]),
      me: remote ? {
        hp: round(remote.hp, 10), en: round(remote.energy, 10), dead: remote.dead ? 1 : 0, stats: remote.stats, el: remote.weapons.map((w) => w.elements),
        tal: remote.talents.map((t) => [t.key, t.level, t.rarity || 0, t.cdMul, t.minMul || 1]),
        sac: remote.sac, mh: remote.maxHpMul, rl: remote.returnLevel || 0, ru: remote.rushT > 0 ? [round(remote.rushT), round(remote.rushMul)] : 0,
        ar: remote.weapons.map((w) => w.arts || {}),
        dn: remote.downed ? [round(remote.downT), round(remote.reviveP)] : 0, rg: round(remote.rageT), gs: remote.guard ? round(remote.guard.store) : -1,
      } : null,
      al: g.allies.map((a) => [a.id, round(a.x), round(a.y), round(a.faceX), round(a.faceY), round(a.anim), round(a.t), a.owner.index]),
      wp: round(g.warpT),
      pk: g.pickups.map((k) => [k.kind, round(k.x), round(k.y), round(k.z), round(k.id)]),
      mk: g.monk ? [round(g.monk.x), round(g.monk.y), round(g.monk.faceX), round(g.monk.faceY), round(g.monk.alpha), round(g.monk.moveAmt), round(g.monk.walk), round(g.monk.bow)] : 0,
      en: g.enemies.map(encEnemy),
      pr: g.projectiles.filter((q) => !q.dead).map(encProj),
      hz: g.hazards.map(encHazard),
      gate: [g.world.gate.active ? 1 : 0, round(g.world.gate.glow)],
      lib: (g.world.library || g.world.shrine) ? ((g.world.library || g.world.shrine).taken ? 2 : (g.world.library || g.world.shrine).ready ? 1 : 0) : 0,
      doors: g.world.props.filter((p) => p.kind === 'house' || p.kind === 'hdoor').map((h) => round(h.doorT || 0)),
      boss: g.bossRef ? g.bossRef.id : 0,
      intro: g.intro ? round(g.intro.t) : -1,
      rs: g.runStats,
    };
    net.send('snap', { s: snap, ev: this.events.splice(0) });
  }
}

// ================================================================== CLIENT
export class OnlineClient {
  constructor(g) {
    this.g = g; this.inT = 0; this.lastSnap = null;
    net.off('snap'); net.off('level'); net.off('cards'); net.off('sac'); net.off('route'); net.off('state'); net.off('phurt'); net.off('pchill'); net.off('pstun'); net.off('disconnect');
    net.on('snap', (m) => this.applySnap(m.s, m.ev));
    net.on('level', (m) => g.loadLevel(m.n, m.seed, m.info || null));
    net.on('cards', (m) => g.openClientCards(m.cards));
    net.on('sac', (m) => g.openClientSac(m.cards));
    net.on('route', (m) => g.onRemoteRoute(m));
    net.on('cut', (m) => g.onRemoteCutscene(m));
    net.on('dlg', (m) => g.onRemoteDialogue(m));
    net.on('dlgend', (m) => g.onRemoteDialogueEnd(m));
    net.on('phurt', (m) => g.localPlayer().remoteHurt(m));
    net.on('pchill', (m) => g.localPlayer().applyChill(m.a, m.d, true));
    net.on('pstun', (m) => g.localPlayer().applyStun(m.d, true));
    net.off('lobby'); net.on('lobby', () => g.toLobby(false)); // the host left the end screen: go back together
    net.on('disconnect', () => {
      const ended = g.state === 'dead' || g.state === 'victory'; // the run was over anyway
      g.toTitle();
      g.menu.notice = ended ? '' : 'The host left the game.';
    });
  }

  update(dt) {
    const p = this.g.localPlayer();
    if (!p || !net.connected) return;
    this.inT -= dt;
    if (this.inT > 0) return;
    this.inT = INPUT_INTERVAL;
    const a = p.anim, d = p.dash;
    net.send('in', {
      x: round(p.x), y: round(p.y), z: round(p.z), ax: round(p.aimX), ay: round(p.aimY), mv: round(p.moveAmt), wk: round(p.walk), as: p.activeSlot,
      an: a ? [a.kind, round(a.t), a.side || 0, round(a.dur)] : null,
      da: d.t > 0 ? [d.type, round(d.t), round(d.dur), round(d.dx), round(d.dy), round(d.ax ?? d.dx), round(d.ay ?? d.dy)] : null, ifr: round(p.iframes), ch: round(p.chillT),
      gd: p.guard ? [round(p.guard.t), round(p.guard.dur)] : 0,
    });
  }

  applySnap(s, events) {
    const g = this.g;
    if (s.lv !== g.level || !g.world) return; // wait for the matching 'level' message
    // state transitions driven by the host (cards are handled separately per player)
    if (s.st === 'intro' && g.state !== 'intro') g.state = 'intro';
    else if (s.st === 'play' && (g.state === 'intro' || g.state === 'transition')) g.state = 'play';
    else if ((s.st === 'dead' || s.st === 'victory') && g.state !== s.st) { g.state = s.st; g.overlay.t = 0; }
    // the host paused or resumed (for itself or because we did): follow it
    const pz = !!s.pz;
    if (pz !== g.hostPaused) { g.hostPaused = pz; g.setPaused(pz, true); }
    g.cleared = !!s.cl;
    if (s.rs) g.runStats = s.rs;
    // host's ninja
    applyPlayerVisual(g.players[0], s.p0, false);
    g.players[0].hp = s.p0.hp; g.players[0].energy = s.p0.en; g.players[0].dead = !!s.p0.dead; g.players[0].maxHpMul = s.p0.mh || 1; g.players[0].sac = s.p0.sac || []; g.players[0].returnLevel = s.p0.rl || 0;
    for (const [p, r] of [[g.players[0], s.p0.ru], [g.localPlayer(), s.me && s.me.ru]]) { if (!p) continue; p.rushT = r ? r[0] : 0; p.rushMul = r ? r[1] : 1; }
    g.pickups = (s.pk || []).map(([kind, x, y, z, id]) => ({ kind, x, y, z, id }));
    applyDowned(g.players[0], s.p0);
    g.warpT = s.wp || 0;
    // the host's shadow clones (drawn as puppets)
    const allies = new Map(g.allies.map((a) => [a.id, a]));
    g.allies = (s.al || []).map(([id, x, y, fx, fy, an, t, owner]) => {
      let a = allies.get(id);
      if (!a) { a = new ShadowClone(g, g.players[owner] || g.players[0], x, y, t, 0, 1); a.id = id; }
      a.tx = x; a.ty = y; a.faceX = fx; a.faceY = fy; a.anim = an; a.t = t; a.moveAmt = Math.hypot(x - a.x, y - a.y) > 0.02 ? 1 : 0;
      return a;
    });
    // my authoritative stats
    const me = g.localPlayer();
    if (s.me && me) {
      me.hp = s.me.hp; me.energy = Math.min(me.energy, s.me.en + 0.5); me.energy = s.me.en;
      if (s.me.dead && !me.dead) { me.dead = true; me.deadT = 0; }
      if (!s.me.dead && me.dead) me.dead = false;
      Object.assign(me.stats, s.me.stats);
      s.me.el.forEach((el, i) => Object.assign(me.weapons[i].elements, el));
      if (s.me.ar) s.me.ar.forEach((a, i) => { if (me.weapons[i]) me.weapons[i].arts = a; });
      // talents: the host owns them; keep our local cooldown timers
      me.talents = (s.me.tal || []).map(([key, level, rarity, cdMul, minMul], i) => {
        const old = me.talents[i] && me.talents[i].key === key ? me.talents[i] : null;
        return { key, level, rarity, cdMul, minMul, cd: old ? old.cd : 0, cdMax: old ? old.cdMax : 1 };
      });
      applyDowned(me, s.me);
      me.sac = s.me.sac || []; me.maxHpMul = s.me.mh || 1; me.returnLevel = s.me.rl || 0;
      if (me.guard && s.me.gs >= 0) me.guard.store = s.me.gs; // the host's store is the real one
    }
    { const A = g.world.library || g.world.shrine; if (A && s.lib !== undefined) { A.ready = s.lib === 1; A.taken = s.lib === 2; } }
    // the wandering monk (drawn only)
    if (s.mk) {
      if (!g.monk) { g.monk = new Monk(g, null); if (g.world.kind === 'temple' && g.levelInfo && g.levelInfo.monk != null) g.monk.bi = g.levelInfo.monk; }
      const m = g.monk, a = s.mk;
      m.x = a[0]; m.y = a[1]; m.faceX = a[2]; m.faceY = a[3]; m.alpha = a[4]; m.moveAmt = a[5]; m.walk = a[6]; m.bow = a[7]; m.state = 'puppet';
    } else g.monk = null;
    // enemies (puppets)
    const byId = new Map(g.enemies.map((e) => [e.id, e]));
    const seen = new Set();
    for (const a of s.en) {
      const [id, type] = a;
      seen.add(id);
      let e = byId.get(id);
      if (!e) {
        e = new Enemy(g, type, a[2], a[3], g.level);
        e.id = id; g.enemies.push(e);
      }
      e.tx = a[2]; e.ty = a[3]; e.z = a[4]; e.faceX = a[5]; e.faceY = a[6];
      e.state = a[7]; e.t = a[8]; e.tDur = a[9];
      e.pose = a[10] ? { kind: a[10], t: a[11] } : null;
      e.hp = a[12]; e.hpMax = a[13]; e.flash = a[14]; e.alpha = a[15]; e.hidden = !!a[16];
      if (a[17] && !e.dead) { e.dead = true; e.deathT = 0; }
      e.stun = a[18]; e.moveAmt = a[19]; e.slowT = a[20]; e.poison = a[21] ? { dps: 0 } : null; e.phase = a[22];
      e.tele = a[23] ? JSON.parse(a[23]) : null;
      e.data.hand = a[24];
      e.introVis = a[25] ? JSON.parse(a[25]) : null;
      e.emerge = a[26] ? (e.emerge || {}) : null;
      if (e.shield) e.shield.up = a[27] === 1;
      e.kneel = !!a[28]; e.guarded = !!a[29]; e.next = a[30] || null;
      if (e.shield) e.shield.netProg = a[31] || 0;
      if (e.state === 'spawn' && e.alpha < 0.05) { e.x = e.tx; e.y = e.ty; }
    }
    g.enemies = g.enemies.filter((e) => seen.has(e.id) || (e.dead && e.deathT < 1));
    g.bossRef = s.boss ? g.enemies.find((e) => e.id === s.boss) || null : null;
    // projectiles & hazards (extrapolated locally between snapshots)
    g.projectiles = s.pr.map((a) => (a[1]
      ? { kind: a[0], lob: true, sx: a[2], sy: a[3], tx: a[4], ty: a[5], t: a[6], T: a[7], x: a[2], y: a[3], z: 0.9, owner: a[8] ? 'enemy' : 'player', screenAng: 0, seed: 1 }
      : { kind: a[0], x: a[2], y: a[3], z: a[4], vx: a[5], vy: a[6], seed: a[7], owner: a[8] ? 'enemy' : 'player', screenAng: Math.atan2((a[5] + a[6]) * 16, (a[5] - a[6]) * 32) }));
    g.hazards = s.hz.map(decHazard);
    g.world.gate.active = !!s.gate[0]; g.world.gate.glow = s.gate[1];
    const houses = g.world.props.filter((p) => p.kind === 'house' || p.kind === 'hdoor');
    s.doors.forEach((d, i) => { if (houses[i]) houses[i].doorT = d; });
    if (s.intro >= 0) {
      const cfg = BOSSES[g.level];
      g.intro = g.intro || { t: 0, cfg, boss: g.bossRef, fired: {} };
      g.intro.t = s.intro; g.intro.boss = g.bossRef; g.intro.cfg = cfg;
    } else g.intro = null;
    // replay effects
    for (const [tag, a] of events || []) this.replay(tag, a);
  }

  replay(tag, a) {
    const g = this.g;
    try {
      switch (tag) {
        case 'fx.slash': g.fx.slash(...a); break;
        case 'fx.ring': g.fx.ring(...a); break;
        case 'fx.spirit': g.fx.spirit(...a); break;
        case 'fx.text': g.fx.text(...a); break;
        case 'fx.bolt': g.fx.bolt(...a); break;
        case 'fx.thrust': g.fx.thrust(...a); break;
        case 'pb': g.particles.burst(...a); break;
        case 'dc': g.decals.add(...a); break;
        case 'bn': g.banner(a[0]); break;
        case 'sh': g.shake(a[0]); break;
        case 'fs': g.flashScreen(a[0]); break;
        case 'sfx': { const [n, ...rest] = a; if (sfx[n]) sfx[n](...rest); break; }
      }
    } catch (e) { /* ignore malformed event */ }
  }
}

// helpers used by the game for smoothing puppets on the client
export function smoothPuppets(g, dt) {
  const k = 1 - Math.exp(-14 * dt);
  for (const e of g.enemies) {
    if (e.tx === undefined) continue;
    const far = Math.hypot(e.tx - e.x, e.ty - e.y) > 3;
    if (far) { e.x = e.tx; e.y = e.ty; } else { e.x = lerp(e.x, e.tx, k); e.y = lerp(e.y, e.ty, k); }
    if (e.dead) e.deathT += dt;
    e.walk += e.moveAmt * dt * 8;
  }
  for (const p of g.players) {
    if (p.tx === undefined || p === g.localPlayer()) continue;
    if (Math.hypot(p.tx - p.x, p.ty - p.y) > 3) { p.x = p.tx; p.y = p.ty; } else { p.x = lerp(p.x, p.tx, k); p.y = lerp(p.y, p.ty, k); }
    if (p.anim) { p.anim.t += dt / (p.anim.dur || 0.3); if (p.anim.t >= 1) p.anim = null; }
    if (p.dash.t > 0) p.dash.t -= dt;
  }
  for (const q of g.projectiles) {
    if (q.lob) { q.t = Math.min(q.T, q.t + dt); const kk = q.t / q.T; q.x = lerp(q.sx, q.tx, kk); q.y = lerp(q.sy, q.ty, kk); q.z = 0.9 + Math.sin(kk * Math.PI) * 3 - kk * 0.9; }
    else { q.x += q.vx * dt; q.y += q.vy * dt; }
  }
  for (const a of g.allies) {
    if (a.tx === undefined) continue;
    a.x = lerp(a.x, a.tx, k); a.y = lerp(a.y, a.ty, k); a.walk += a.moveAmt * dt * 14; a.anim = Math.max(0, a.anim - dt);
  }
  for (const h of g.hazards) {
    if (h.kind === 'arrows' || h.kind === 'meteor') h.t = Math.max(0, h.t - dt);
    else if (h.kind === 'ring') h.rad = Math.min(h.max, h.rad + h.speed * dt);
    else if (h.kind === 'marker') h.t = Math.max(0, h.t - dt);
    else if (h.kind === 'fire') { h.life -= dt; if (Math.random() < 0.6) g.particles.emit('ember', h.x + rand(-h.r, h.r) * 0.7, h.y + rand(-h.r, h.r) * 0.7, 0.1, 0, 0, rand(1, 2.5), 0.6, 2, Math.random() < 0.5 ? '#ff6a20' : '#ffb040'); }
  }
}

export { rollUpgrades, applyUpgrade, ENEMIES };

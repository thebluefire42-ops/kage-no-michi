// Unified input: up to two Xbox 360 controllers (Gamepad API, standard mapping) + keyboard/mouse.
// Standard mapping: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Back=8 Start=9, D-pad 12-15.
// Axes: 0/1 left stick, 2/3 right stick.
//
// `input` itself is the merged view of every device (used by menus).
// `input.players[0]` / `input.players[1]` are per-player views used in co-op:
//   solo  -> player 1 = keyboard/mouse + every controller
//   co-op -> player 1 = keyboard/mouse + first controller, player 2 = second controller

const DEAD_MOVE = 0.2;
const DEAD_AIM = 0.3;
const TRIGGER_ON = 0.3;
const ACTIONS = ['L1', 'L2', 'R1', 'R2', 'dash', 'pause', 'confirm', 'back', 'up', 'down', 'left', 'right', 'debug', 'select', 't1', 't2', 't3'];

const KEYMAP = {
  L1: ['KeyQ'],
  L2: ['KeyE'],
  R1: ['KeyJ'],
  R2: ['KeyK'],
  dash: ['Space', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'Space', 'NumpadEnter'],
  back: ['Escape', 'Backspace'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  debug: ['F3'],
  select: ['Tab', 'KeyL'], // menus: the controller's Back / View button
  t1: ['Digit1', 'Numpad1'], // talents (controller X / Y / B)
  t2: ['Digit2', 'Numpad2'],
  t3: ['Digit3', 'Numpad3'],
};

function radial(x, y, dead) {
  const m = Math.hypot(x, y);
  if (m < dead) return [0, 0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead));
  return [(x / m) * k, (y / m) * k, k];
}

function readPad(gp) {
  const b = (i) => { const btn = gp.buttons[i]; return !!btn && (btn.pressed || btn.value > 0.5); };
  const trig = (i, axisFallback) => {
    const btn = gp.buttons[i];
    if (btn) return btn.value > TRIGGER_ON || btn.pressed;
    const a = gp.axes[axisFallback]; // some drivers expose triggers as axes (-1..1)
    return a !== undefined && (a + 1) / 2 > TRIGGER_ON;
  };
  const down = {
    L1: b(4), R1: b(5), L2: trig(6, 4), R2: trig(7, 5),
    dash: b(0), confirm: b(0), back: b(1), pause: b(9),
    up: b(12), down: b(13), left: b(14), right: b(15), debug: b(8), select: b(8),
    t1: b(2), t2: b(3), t3: b(1), // X, Y, B
  };
  const [lx, ly, lm] = radial(gp.axes[0] || 0, gp.axes[1] || 0, DEAD_MOVE);
  const [rx, ry, rm] = radial(gp.axes[2] || 0, gp.axes[3] || 0, DEAD_AIM);
  if (ly < -0.55) down.up = true;
  if (ly > 0.55) down.down = true;
  if (lx < -0.55) down.left = true;
  if (lx > 0.55) down.right = true;
  let any = lm > 0 || rm > 0;
  for (const a in down) if (down[a]) any = true;
  return { down, lx, ly, lm, rx, ry, rm, any, gp };
}

export class Controls {
  constructor(index) {
    this.index = index;
    this.move = { x: 0, y: 0 };
    this.aimStick = { x: 0, y: 0, active: false };
    this.mode = index === 0 ? 'kbm' : 'pad';
    this.connected = index === 0;
    this.state = {};
    for (const a of ACTIONS) this.state[a] = { down: false, pressed: false, released: false };
  }
  // sources: array of { down, lx, ly, lm, rx, ry, rm } plus optional keyboard part
  apply(down, mx, my, aim) {
    this.move.x = mx; this.move.y = my;
    if (aim) { this.aimStick.x = aim[0]; this.aimStick.y = aim[1]; this.aimStick.active = true; } else this.aimStick.active = false;
    for (const a of ACTIONS) {
      const s = this.state[a], d = !!down[a];
      s.pressed = d && !s.down; s.released = !d && s.down; s.down = d;
    }
  }
  pressed(a) { return this.state[a].pressed; }
  down(a) { return this.state[a].down; }
  eat(a) { this.state[a].pressed = false; }
}

// Controls for the online partner on the host: fed from network input packets.
export class RemoteControls extends Controls {
  constructor() { super(1); this.mode = 'pad'; this.connected = true; this.aimWorld = null; }
  feed(msg) {
    const down = {};
    for (const a of msg.b || []) down[a] = true;
    this.apply(down, msg.mx || 0, msg.my || 0, null);
    this.aimWorld = [msg.ax, msg.ay];
  }
}

function combine(kbDown, kbMove, pads) {
  const down = { ...kbDown };
  let [mx, my] = kbMove, aim = null, padUsed = false;
  for (const p of pads) {
    for (const a in p.down) if (p.down[a]) down[a] = true;
    if (p.lm > 0) { mx = p.lx; my = p.ly; }
    if (p.rm > 0) aim = [p.rx, p.ry];
    if (p.any) padUsed = true;
  }
  return { down, mx, my, aim, padUsed };
}

export const input = {
  move: { x: 0, y: 0 },
  aimStick: { x: 0, y: 0, active: false },
  mouse: { x: 0, y: 0, down: [false, false, false], lastMove: 0, clicked: false, wheel: 0 }, // wheel: notches since last read (menus clear it)
  mode: 'kbm',
  pad: { connected: false, id: '', buttons: [], axes: [], mapping: '' },
  padCount: 0,
  padIds: [],
  coop: false,
  players: [new Controls(0), new Controls(1)],
  state: {},
  _keys: new Set(),
  _latch: new Set(),
  _mouseLatch: [false, false, false],
  _kbmActive: false,

  init(canvas) {
    for (const a of ACTIONS) this.state[a] = { down: false, pressed: false, released: false };
    addEventListener('keydown', (e) => {
      // typing in a text box (join key) only passes Enter / Escape to the game
      if (e.target && e.target.tagName === 'INPUT' && !['Enter', 'NumpadEnter', 'Escape'].includes(e.code)) return;
      if (e.code === 'F3' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
      this._keys.add(e.code);
      this._latch.add(e.code); // remember taps shorter than one frame
      this._kbmActive = true;
    });
    addEventListener('keyup', (e) => this._keys.delete(e.code));
    addEventListener('blur', () => { this._keys.clear(); this.mouse.down = [false, false, false]; });
    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.lastMove = performance.now();
      this._kbmActive = true;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.down[e.button] = true; this._mouseLatch[e.button] = true; this._kbmActive = true;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    addEventListener('mouseup', (e) => { this.mouse.down[e.button] = false; });
    canvas.addEventListener('wheel', (e) => { if (e.deltaY) this.mouse.wheel += Math.sign(e.deltaY); this._kbmActive = true; }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  getPads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const out = [];
    for (const p of list) if (p && p.connected) out.push(p);
    return out;
  },

  poll() {
    const k = this._keys, latch = this._latch;
    const kbDown = {};
    for (const a of ACTIONS) kbDown[a] = KEYMAP[a].some((c) => k.has(c) || latch.has(c));
    if (this.mouse.down[0] || this._mouseLatch[0]) kbDown.R1 = true;
    if (this.mouse.down[2] || this._mouseLatch[2]) kbDown.R2 = true;
    this.mouse.clicked = this._mouseLatch[0];
    latch.clear(); this._mouseLatch = [false, false, false];
    let kx = (kbDown.right ? 1 : 0) - (kbDown.left ? 1 : 0);
    let ky = (kbDown.down ? 1 : 0) - (kbDown.up ? 1 : 0);
    if (kx || ky) { const l = Math.hypot(kx, ky); kx /= l; ky /= l; }

    const pads = this.getPads().map(readPad);
    this.padCount = pads.length;
    this.padIds = pads.map((p) => p.gp.id);
    this.pad.connected = pads.length > 0;
    if (pads.length) {
      const gp = pads[0].gp;
      this.pad.id = gp.id; this.pad.mapping = gp.mapping;
      this.pad.buttons = gp.buttons.map((x) => +x.value.toFixed(2));
      this.pad.axes = gp.axes.map((x) => +x.toFixed(2));
    }
    const kbm = this._kbmActive; this._kbmActive = false;

    // merged view (menus)
    const all = combine(kbDown, [kx, ky], pads);
    if (all.padUsed) this.mode = 'pad'; else if (kbm) this.mode = 'kbm';
    this.move.x = all.mx; this.move.y = all.my;
    if (all.aim) { this.aimStick.x = all.aim[0]; this.aimStick.y = all.aim[1]; this.aimStick.active = true; } else this.aimStick.active = false;
    for (const a of ACTIONS) {
      const s = this.state[a], d = !!all.down[a];
      s.pressed = d && !s.down; s.released = !d && s.down; s.down = d;
    }

    // per-player views. Local co-op with one controller: P1 = keyboard/mouse, P2 = that controller.
    const kbPad = this.coop && pads.length === 1;
    const p1Pads = !this.coop ? pads : kbPad ? [] : pads.slice(0, 1);
    const c1 = combine(kbDown, [kx, ky], p1Pads);
    const P1 = this.players[0];
    if (c1.padUsed) P1.mode = 'pad'; else if (kbm) P1.mode = 'kbm';
    P1.apply(c1.down, c1.mx, c1.my, c1.aim);
    const P2 = this.players[1];
    const p2Pad = kbPad ? pads[0] : pads[1];
    P2.connected = !!p2Pad && this.coop;
    if (P2.connected) { const c2 = combine({}, [0, 0], [p2Pad]); P2.apply(c2.down, c2.mx, c2.my, c2.aim); }
    else P2.apply({}, 0, 0, null);
  },

  pressed(a) { return this.state[a].pressed; },
  down(a) { return this.state[a].down; },
  eat(a) { this.state[a].pressed = false; for (const p of this.players) p.eat(a); },
};

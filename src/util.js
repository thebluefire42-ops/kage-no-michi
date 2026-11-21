// Math, randomness, easing and isometric projection helpers.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const angDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
export const approach = (v, target, amt) => (v < target ? Math.min(v + amt, target) : Math.max(v - amt, target));

export const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)), // (a snap: almost all of the way at once)
  inQuad: (t) => t * t,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
};

// Seeded RNG (mulberry32)
export function seededRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- Isometric projection: 2:1 diamonds, world units = tiles ----
export const HW = 32; // half tile width in px
export const HH = 16; // half tile height in px
export const ZU = 32; // px per world unit of height
export const isoX = (x, y) => (x - y) * HW;
export const isoY = (x, y, z = 0) => (x + y) * HH - z * ZU;
export function screenToWorld(sx, sy) {
  return [(sx / HW + sy / HH) / 2, (sy / HH - sx / HW) / 2];
}
// screen-space direction -> normalized world direction
export function screenDirToWorld(dx, dy) {
  const wx = dx / HW + dy / HH, wy = dy / HH - dx / HW;
  const l = Math.hypot(wx, wy) || 1;
  return [wx / l, wy / l];
}
// world direction -> screen angle (radians)
export function worldDirToScreenAngle(wx, wy) {
  return Math.atan2((wx + wy) * HH, (wx - wy) * HW);
}

export function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})`; }

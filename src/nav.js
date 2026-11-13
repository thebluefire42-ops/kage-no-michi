// Navigation: per-player flow fields on a 1x1 tile grid so enemies walk around houses, ponds and trees
// instead of pushing into them. Separate grids per body size (normal, big, huge), so a big enemy is
// never routed through a gap it can't fit through.
const CLEAR = [0.32, 0.62, 0.9];
export const sizeClass = (r) => (r <= 0.36 ? 0 : r <= 0.62 ? 1 : 2);

export class Nav {
  constructor(g) {
    this.g = g;
    const w = g.world, N = w.N;
    this.N = N;
    // blocked grids for small and large bodies
    this.blocked = CLEAR.map((clear) => {
      const b = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[y * N + x] = w.blocked(x + 0.5, y + 0.5, clear) ? 1 : 0;
      return b;
    });
    this.fields = new Map(); // key `${playerIndex}:${size}` -> Int16Array distances
    this.t = 0;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.3;
    for (const p of this.g.players) {
      if (!p.active) continue;
      for (let s = 0; s < CLEAR.length; s++) this.fields.set(`${p.index}:${s}`, this.bfs(p.x, p.y, this.blocked[s]));
    }
  }

  bfs(px, py, blocked) {
    const N = this.N, dist = new Int16Array(N * N).fill(-1);
    const sx = Math.max(0, Math.min(N - 1, Math.floor(px))), sy = Math.max(0, Math.min(N - 1, Math.floor(py)));
    const q = new Int32Array(N * N);
    let h = 0, t = 0;
    dist[sy * N + sx] = 0; q[t++] = sy * N + sx;
    // the player stands where a big body can't (close to a wall): start from the open cells around them
    if (blocked[sy * N + sx]) {
      for (let r = 1; r <= 3 && t === 1; r++) {
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
          const nx = sx + ox, ny = sy + oy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N || blocked[ny * N + nx] || dist[ny * N + nx] >= 0) continue;
          dist[ny * N + nx] = r; q[t++] = ny * N + nx;
        }
      }
    }
    while (h < t) {
      const c = q[h++], cx = c % N, cy = (c / N) | 0, d = dist[c] + 1;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const n = ny * N + nx;
        if (dist[n] >= 0 || blocked[n]) continue;
        // no corner cutting past blocked cells
        if (ox && oy && (blocked[cy * N + nx] || blocked[ny * N + cx])) continue;
        dist[n] = d; q[t++] = n;
      }
    }
    return dist;
  }

  // Direction that leads around obstacles toward `target`, or null if there is no field.
  flowDir(e, target) {
    const size = sizeClass(e.r);
    const field = this.fields.get(`${target.index}:${size}`);
    const blocked = this.blocked[size];
    if (!field) return null;
    const N = this.N, cx = Math.floor(e.x), cy = Math.floor(e.y);
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null;
    let best = -1, bd = field[cy * N + cx] >= 0 ? field[cy * N + cx] : 1e9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = cx + ox, ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const d = field[ny * N + nx];
      if (ox && oy && (blocked[cy * N + nx] || blocked[ny * N + cx])) continue; // don't cut corners
      if (d >= 0 && d < bd) { bd = d; best = ny * N + nx; }
    }
    if (best < 0) return null;
    const tx = (best % N) + 0.5, ty = ((best / N) | 0) + 0.5;
    const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }

  // centre of the nearest tile this body fits in (for un-wedging a stuck enemy), or null
  openCellNear(e) {
    const N = this.N, blocked = this.blocked[sizeClass(e.r)], cx = Math.floor(e.x), cy = Math.floor(e.y);
    let best = null, bd = 1e9;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = cx + ox, ny = cy + oy;
      if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1 || blocked[ny * N + nx]) continue;
      const d = (nx + 0.5 - e.x) ** 2 + (ny + 0.5 - e.y) ** 2;
      if (d > 0.04 && d < bd) { bd = d; best = [nx + 0.5, ny + 0.5]; }
    }
    return best;
  }

  // straight walkable line between two points (sampled)
  clearLine(ax, ay, bx, by, r) {
    const w = this.g.world, d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.5);
    for (let i = 1; i < n; i++) { const k = i / n; if (w.blocked(ax + (bx - ax) * k, ay + (by - ay) * k, r)) return false; }
    return true;
  }
}

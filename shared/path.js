// A* on the tile grid (8 directions, no corner cutting, octile heuristic).
import { tileBlocked } from './collide.js';

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

/** Returns [{x, y}] tile centres from start to goal (excluding start), or null. */
export function findPath(map, sx, sy, gx, gy, maxNodes = 1500) {
  sx = Math.floor(sx); sy = Math.floor(sy); gx = Math.floor(gx); gy = Math.floor(gy);
  if (tileBlocked(map, gx, gy)) return null;
  const key = (x, y) => y * map.w + x;
  const g = new Map([[key(sx, sy), 0]]), from = new Map(), closed = new Set();
  const open = [[0, sx, sy]]; // small frontier: a sorted insert is plenty here
  const h = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return dx + dy - 0.586 * Math.min(dx, dy); };
  let expanded = 0;
  while (open.length && expanded++ < maxNodes) {
    const [, x, y] = open.pop();
    const k = key(x, y);
    if (closed.has(k)) continue;
    closed.add(k);
    if (x === gx && y === gy) {
      const path = [];
      for (let c = k; c !== key(sx, sy); c = from.get(c)) path.push({ x: (c % map.w) + 0.5, y: Math.floor(c / map.w) + 0.5 });
      return path.reverse();
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (tileBlocked(map, nx, ny)) continue;
      if (dx && dy && (tileBlocked(map, x + dx, y) || tileBlocked(map, x, y + dy))) continue;
      const nk = key(nx, ny), ng = g.get(k) + cost;
      if (ng >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, ng); from.set(nk, k);
      const f = ng + h(nx, ny);
      let i = open.length;
      while (i > 0 && open[i - 1][0] < f) i--; // keep descending by f; pop() takes the best
      open.splice(i, 0, [f, nx, ny]);
    }
  }
  return null;
}

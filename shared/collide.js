// Tile collision used by the server simulation and by client-side movement prediction.
import { isWalkable } from './content.js';

export function tileBlocked(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return !isWalkable(map.tiles[ty * map.w + tx]);
}

export function blocked(map, x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  return tileBlocked(map, x0, y0) || tileBlocked(map, x1, y0) || tileBlocked(map, x0, y1) || tileBlocked(map, x1, y1);
}

/** Move on each axis separately so entities slide along walls. Mutates e.x / e.y. */
export function moveWithCollision(map, e, dx, dy, r = 0.3) {
  if (dx && !blocked(map, e.x + dx, e.y, r)) e.x += dx;
  if (dy && !blocked(map, e.x, e.y + dy, r)) e.y += dy;
}

export function lineOfSight(map, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(d / 0.4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocked(map, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.28)) return false;
  }
  return true;
}

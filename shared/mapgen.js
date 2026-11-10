// World generation. Everything is written into a plain tile grid first and validated
// (flood fill from the spawn) before anyone plays on it.
import { makeRng, fbm, hash2 } from './rng.js';
import { T, WORLD, ZONES, DUNGEONS, DUNGEON_SIZE, isWalkable } from './content.js';

export function floodFill(map, sx, sy) {
  const seen = new Uint8Array(map.w * map.h), stack = [Math.floor(sy) * map.w + Math.floor(sx)];
  while (stack.length) {
    const k = stack.pop();
    if (seen[k] || !isWalkable(map.tiles[k])) continue;
    seen[k] = 1;
    const x = k % map.w, y = (k - x) / map.w;
    if (x > 0) stack.push(k - 1);
    if (x < map.w - 1) stack.push(k + 1);
    if (y > 0) stack.push(k - map.w);
    if (y < map.h - 1) stack.push(k + map.w);
  }
  return seen;
}

export function zoneAt(x, y) {
  const raw = Math.hypot(x - WORLD.cx, y - WORLD.cy);
  // Warp ring borders with noise so zones are not perfect circles (but keep town round).
  const d = raw < 12 ? raw : Math.max(12, raw + (fbm(x * 0.06, y * 0.06, WORLD.seed + 7, 2) - 0.5) * 12);
  let inner = 0;
  for (const z of ZONES) {
    if (d < z.r) return { zone: z, frac: Math.min(1, Math.max(0, (d - inner) / (Math.min(z.r, 95) - inner))), dist: raw };
    inner = z.r;
  }
  return { zone: ZONES[ZONES.length - 1], frac: 1, dist: raw };
}

export function genOverworld() {
  const { w, h, seed, cx, cy } = WORLD;
  const tiles = new Uint8Array(w * h), map = { w, h, tiles };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { zone, dist } = zoneAt(x, y);
      let t = zone.ground;
      if (!zone.safe) {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) t = zone.tree;
        else if (dist > 14 && fbm(x * 0.045, y * 0.045, seed + 2, 2) < 0.3) t = T.WATER;
        else if (fbm(x * 0.13, y * 0.13, seed + 1, 3) > zone.density) t = zone.tree;
        else if (hash2(x, y, seed + 3) > 0.988) t = T.ROCK;
      }
      tiles[y * w + x] = t;
    }
  }
  const stamp = (x, y, r, t) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const px = Math.round(x) + i, py = Math.round(y) + j;
      if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1 || i * i + j * j > r * r + 1) continue;
      if (tiles[py * w + px] !== T.TOWN) tiles[py * w + px] = t;
    }
  };
  // Roads from town to every dungeon guarantee each entrance is reachable.
  for (const d of Object.values(DUNGEONS)) {
    const len = Math.hypot(d.x - cx, d.y - cy);
    for (let i = 0; i <= len * 2; i++) {
      const t = i / (len * 2), wob = (fbm(i * 0.05, d.x, seed + 5, 2) - 0.5) * 6 * Math.sin(Math.PI * t);
      stamp(cx + (d.x - cx) * t - ((d.y - cy) / len) * wob, cy + (d.y - cy) * t + ((d.x - cx) / len) * wob, 1, T.PATH);
    }
    stamp(d.x, d.y, 3, T.PATH);
  }
  // Seal off pockets the player could never reach so nothing spawns inside them.
  const reach = floodFill(map, cx, cy);
  for (let k = 0; k < tiles.length; k++) {
    if (isWalkable(tiles[k]) && !reach[k]) tiles[k] = zoneAt(k % w, Math.floor(k / w)).zone.tree || T.ROCK;
  }
  // Enemy camps: one candidate per grid cell, level rising with distance from town.
  // Dungeon entrances are kept clear so there is a quiet spot to gather before going in.
  const rng = makeRng(seed + 11), spawns = [], CELL = 7;
  for (let gy = 0; gy < h; gy += CELL) for (let gx = 0; gx < w; gx += CELL) {
    if (!rng.chance(0.8)) continue;
    for (let tries = 0; tries < 6; tries++) {
      const x = gx + rng.int(0, CELL - 1), y = gy + rng.int(0, CELL - 1);
      if (x >= w || y >= h || !reach[y * w + x]) continue;
      const { zone, frac, dist } = zoneAt(x, y);
      if (zone.safe || dist < 13) continue;
      if (Object.values(DUNGEONS).some((d) => Math.hypot(d.x - x, d.y - y) < 10)) continue;
      const level = Math.min(zone.lv[1], Math.max(zone.lv[0], Math.round(zone.lv[0] + frac * (zone.lv[1] - zone.lv[0]) + rng.range(-0.6, 0.6))));
      spawns.push({ x: x + 0.5, y: y + 0.5, mob: rng.weighted(zone.mobs), level, zone: zone.id });
      break;
    }
  }
  return { ...map, spawns, start: { x: cx + 0.5, y: cy + 2.5 } };
}

// ---- Dungeons: rooms and corridors, MST connectivity plus a couple of loops ----------------
function tryDungeon(def, seed) {
  const { w, h } = DUNGEON_SIZE, rng = makeRng(seed);
  const tiles = new Uint8Array(w * h).fill(def.wall), map = { w, h, tiles };
  const rooms = [];
  const carve = (x0, y0, x1, y1) => {
    for (let y = Math.max(1, y0); y <= Math.min(h - 2, y1); y++)
      for (let x = Math.max(1, x0); x <= Math.min(w - 2, x1); x++) tiles[y * w + x] = def.floor;
  };
  for (let i = 0; i < 160 && rooms.length < 11; i++) { // capped attempts: accept fewer rooms
    const rw = rng.int(6, 11), rh = rng.int(5, 9), x = rng.int(2, w - rw - 3), y = rng.int(2, h - rh - 3);
    if (rooms.some((r) => x < r.x + r.w + 2 && x + rw + 2 > r.x && y < r.y + r.h + 2 && y + rh + 2 > r.y)) continue;
    rooms.push({ x, y, w: rw, h: rh, cx: x + (rw >> 1), cy: y + (rh >> 1) });
  }
  if (rooms.length < 6) return null;
  for (const r of rooms) carve(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1);
  const corridor = (a, b) => {
    const hx0 = Math.min(a.cx, b.cx), hx1 = Math.max(a.cx, b.cx), vy0 = Math.min(a.cy, b.cy), vy1 = Math.max(a.cy, b.cy);
    if (rng.chance(0.5)) { carve(hx0, a.cy, hx1, a.cy + 1); carve(b.cx, vy0, b.cx + 1, vy1 + 1); }
    else { carve(a.cx, vy0, a.cx + 1, vy1 + 1); carve(hx0, b.cy, hx1, b.cy + 1); }
  };
  // Prim's MST over room centres keeps the layout connected without chaining rooms in order.
  const inTree = [0], out = rooms.map((_, i) => i).slice(1);
  while (out.length) {
    let best = null;
    for (const a of inTree) for (const b of out) {
      const d = Math.hypot(rooms[a].cx - rooms[b].cx, rooms[a].cy - rooms[b].cy);
      if (!best || d < best.d) best = { a, b, d };
    }
    corridor(rooms[best.a], rooms[best.b]);
    inTree.push(best.b); out.splice(out.indexOf(best.b), 1);
  }
  for (let i = 0; i < 2; i++) corridor(rng.pick(rooms), rng.pick(rooms));

  // Walking distance from the entrance decides the boss room and how hard each room is.
  const start = rooms[0], dist = new Int32Array(w * h).fill(-1), queue = [start.cy * w + start.cx];
  dist[queue[0]] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    for (const n of [k - 1, k + 1, k - w, k + w]) {
      if (dist[n] === -1 && isWalkable(tiles[n])) { dist[n] = dist[k] + 1; queue.push(n); }
    }
  }
  if (rooms.some((r) => dist[r.cy * w + r.cx] < 0)) return null;
  const far = (r) => dist[r.cy * w + r.cx];
  const bossRoom = rooms.reduce((a, b) => (far(b) > far(a) ? b : a));
  if (bossRoom === start) return null;
  carve(bossRoom.cx - 5, bossRoom.cy - 4, bossRoom.cx + 5, bossRoom.cy + 4); // room to fight in
  const maxFar = far(bossRoom), spawns = [];
  for (const r of rooms) {
    if (r === start) continue;
    if (r === bossRoom) {
      spawns.push({ x: r.cx + 0.5, y: r.cy + 0.5, mob: def.boss, level: def.bossLv, boss: true });
      continue;
    }
    const deep = far(r) > maxFar * 0.55, n = rng.int(2, 3) + (deep ? 1 : 0), level = def.lv + (deep ? 1 : 0); // sawtooth: harder rooms deeper in
    for (let i = 0; i < n; i++) {
      spawns.push({ x: rng.int(r.x + 1, r.x + r.w - 2) + 0.5, y: rng.int(r.y + 1, r.y + r.h - 2) + 0.5, mob: rng.weighted(def.mobs), level });
    }
  }
  const reach = floodFill(map, start.cx, start.cy);
  for (let k = 0; k < tiles.length; k++) if (isWalkable(tiles[k]) && !reach[k]) return null;
  return { ...map, seed, rooms, spawns, start: { x: start.cx + 0.5, y: start.cy + 0.5 }, boss: { x: bossRoom.cx + 0.5, y: bossRoom.cy + 0.5 } };
}

/** Same (dungeon, seed) always gives the same layout. Invalid layouts are rejected and re-rolled. */
export function genDungeon(dungeonId, seed) {
  const def = DUNGEONS[dungeonId];
  for (let i = 0; i < 40; i++) {
    const d = tryDungeon(def, (seed + i * 7919) >>> 0);
    if (d) return d;
  }
  throw new Error(`could not generate dungeon ${dungeonId} from seed ${seed}`);
}

// Low-poly world built from the server's tile map: a faceted ground mesh coloured per tile,
// instanced trees and rocks, dungeon walls, a few town props, and dungeon portals.
// One map tile = one world unit; tile (x, y) covers X in [x, x+1] and Z in [y, y+1].
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T, isWalkable, DUNGEONS } from '/shared/content.js';
import { hash2, fbm } from '/shared/rng.js';

const GROUND = {
  [T.GRASS]: 0x5a9a3c, [T.WOOD]: 0x3f7434, [T.ASH]: 0x77695f, [T.SNOW]: 0xdfe8ef, [T.PATH]: 0xb89c6a,
  [T.TOWN]: 0x9c968a, [T.WATER]: 0x3a7cc0, [T.CRYPT_F]: 0x625c7a, [T.MINE_F]: 0x7d5e48, [T.ICE_F]: 0xa9cde2,
  [T.CRYPT_W]: 0x2c2838, [T.MINE_W]: 0x33241c, [T.ICE_W]: 0x3f617f,
};
const OBJECT_GROUND = { [T.TREE]: T.WOOD, [T.ROCK]: T.GRASS, [T.DEADTREE]: T.ASH, [T.PINE]: T.SNOW };
const WALLS = new Set([T.CRYPT_W, T.MINE_W, T.ICE_W]);
const CHUNK = 16; // tiles per side; each chunk is its own mesh so off-screen ones are culled
const mat = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, ...o });

function groundOf(map, x, y) {
  const at = (i, j) => (i < 0 || j < 0 || i >= map.w || j >= map.h ? -1 : map.tiles[j * map.w + i]);
  const id = at(x, y);
  if (!(id in OBJECT_GROUND)) return id;
  for (let r = 1; r <= 3; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    const n = at(x + dx, y + dy);
    if (n >= 0 && n <= 5 && n !== T.WATER) return n;
  }
  return OBJECT_GROUND[id];
}

/** Faceted ground: shared corner heights (water sinks, open ground jitters a little). */
function buildGround(map) {
  const { w, h } = map, tile = (x, y) => map.tiles[y * w + x];
  const H = new Float32Array((w + 1) * (h + 1));
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    let water = 0, n = 0, wall = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      n++;
      if (tile(tx, ty) === T.WATER) water++;
      if (WALLS.has(tile(tx, ty))) wall++;
    }
    H[y * (w + 1) + x] = water === n && n ? -0.32 : water ? -0.12 : wall ? 0 : (hash2(x, y, 3) - 0.5) * 0.12;
  }
  const out = [], c = new THREE.Color(), c2 = new THREE.Color(), material = mat({ vertexColors: true });
  for (let cy = 0; cy < h; cy += CHUNK) for (let cx = 0; cx < w; cx += CHUNK) {
  const x1 = Math.min(w, cx + CHUNK), y1 = Math.min(h, cy + CHUNK), n = (x1 - cx) * (y1 - cy);
  const pos = new Float32Array(n * 18), col = new Float32Array(n * 18);
  let i = 0;
  for (let y = cy; y < y1; y++) for (let x = cx; x < x1; x++) {
    const id = groundOf(map, x, y);
    // Broad patches from noise plus a little per-tile grain, so the ground is not a checkerboard.
    const v = 0.86 + fbm(x * 0.09, y * 0.09, 21, 2) * 0.26 + (hash2(x, y, 7) - 0.5) * 0.04;
    c.setHex(GROUND[id] ?? 0x555555).multiplyScalar(v);
    c2.copy(c).multiplyScalar(0.985 + hash2(x, y, 9) * 0.03);
    const hh = (cx, cy) => H[cy * (w + 1) + cx];
    const quad = [[x, y], [x, y + 1], [x + 1, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    quad.forEach(([qx, qy], k) => {
      pos[i] = qx; pos[i + 1] = hh(qx, qy); pos[i + 2] = qy;
      const cc = k < 3 ? c : c2;
      col[i] = cc.r; col[i + 1] = cc.g; col[i + 2] = cc.b;
      i += 3;
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  out.push(mesh);
  }
  const hasWater = map.tiles.includes(T.WATER);
  if (hasWater) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x4a9ad8, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(w / 2, -0.07, h / 2);
    out.push(water);
  }
  return out;
}

// ---- prop geometry (built once, merged per material, drawn instanced) ---------------------------
const geo = {
  trunk: () => new THREE.CylinderGeometry(0.07, 0.11, 0.7, 5).translate(0, 0.35, 0),
  canopy: () => mergeGeometries([
    new THREE.IcosahedronGeometry(0.46, 0).translate(0, 0.98, 0),
    new THREE.IcosahedronGeometry(0.32, 0).translate(0.22, 0.78, 0.12),
    new THREE.IcosahedronGeometry(0.3, 0).translate(-0.2, 0.8, -0.1),
  ]),
  pine: () => mergeGeometries([0, 1, 2].map((k) => new THREE.ConeGeometry(0.5 - k * 0.12, 0.6, 6).translate(0, 0.55 + k * 0.38, 0))),
  pineSnow: () => mergeGeometries([0, 1, 2].map((k) => new THREE.ConeGeometry(0.3 - k * 0.07, 0.24, 6).translate(0, 0.78 + k * 0.38, 0))),
  dead: () => mergeGeometries([
    new THREE.CylinderGeometry(0.05, 0.1, 1.1, 5).translate(0, 0.55, 0),
    new THREE.CylinderGeometry(0.025, 0.04, 0.5, 4).rotateZ(0.9).translate(0.2, 0.75, 0),
    new THREE.CylinderGeometry(0.025, 0.04, 0.45, 4).rotateZ(-0.8).rotateY(1.4).translate(-0.05, 0.6, -0.18),
    new THREE.CylinderGeometry(0.02, 0.035, 0.35, 4).rotateZ(-0.7).translate(-0.14, 0.98, 0),
  ]),
  rock: () => { const g = new THREE.DodecahedronGeometry(0.42, 0); g.scale(1, 0.62, 0.85); g.translate(0, 0.16, 0); return g; },
  wall: () => new THREE.BoxGeometry(1, 0.95, 1).translate(0, 0.475, 0), // low, so the camera sees over them
};

function instanced(geometry, material, transforms, colorFn) {
  const chunks = new Map();
  for (const t of transforms) {
    const k = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
    (chunks.get(k) || chunks.set(k, []).get(k)).push(t);
  }
  const g = new THREE.Group();
  for (const list of chunks.values()) g.add(instancedChunk(geometry, material, list, colorFn));
  return g;
}

function instancedChunk(geometry, material, transforms, colorFn) {
  const m = new THREE.InstancedMesh(geometry, material, transforms.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  transforms.forEach((t, i) => {
    o.position.set(t.x, t.y || 0, t.z); o.rotation.set(0, t.r || 0, 0); o.scale.set(t.s, t.sy || t.s, t.s);
    o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    if (colorFn) m.setColorAt(i, colorFn(t, c));
  });
  m.castShadow = true; m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

function buildObjects(map) {
  const { w, h } = map, groups = { tree: [], pine: [], dead: [], rock: [], wall: [] };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = map.tiles[y * w + x], r = hash2(x, y, 11), r2 = hash2(x, y, 12);
    const t = { x: x + 0.5 + (r - 0.5) * 0.25, z: y + 0.5 + (r2 - 0.5) * 0.25, r: r * Math.PI * 2, s: 0.95 + r2 * 0.45, id, hx: x, hy: y };
    if (id === T.TREE) groups.tree.push(t);
    else if (id === T.PINE) groups.pine.push(t);
    else if (id === T.DEADTREE) groups.dead.push(t);
    else if (id === T.ROCK) groups.rock.push({ ...t, s: 0.8 + r2 * 0.5 });
    else if (WALLS.has(id)) {
      // Only walls that touch a floor are visible; the rest are darkness.
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && isWalkable(map.tiles[ny * w + nx])) { edge = true; break; }
      }
      if (edge) groups.wall.push({ x: x + 0.5, z: y + 0.5, s: 1, sy: 0.9 + r * 0.25, id });
    }
  }
  const out = [];
  const vary = (base, spread) => (t, c) => c.setHex(base).multiplyScalar(1 - spread / 2 + hash2(t.hx, t.hy, 5) * spread);
  if (groups.tree.length) {
    out.push(instanced(geo.trunk(), mat({ color: 0xffffff }), groups.tree, () => new THREE.Color(0x6b4a2b)));
    out.push(instanced(geo.canopy(), mat({ color: 0xffffff }), groups.tree, (t, c) => c.setHex([0x3f8a34, 0x4f9a3a, 0x356f2c, 0x5a9a2e][Math.floor(hash2(t.hx, t.hy, 4) * 4)])));
  }
  if (groups.pine.length) {
    out.push(instanced(geo.trunk(), mat({ color: 0xffffff }), groups.pine.map((t) => ({ ...t, s: t.s * 0.7 })), () => new THREE.Color(0x5a3d24)));
    out.push(instanced(geo.pine(), mat({ color: 0xffffff }), groups.pine, vary(0x2e6a52, 0.25)));
    out.push(instanced(geo.pineSnow(), mat({ color: 0xf2f8fb }), groups.pine));
  }
  if (groups.dead.length) out.push(instanced(geo.dead(), mat({ color: 0xffffff }), groups.dead, vary(0x4a3b33, 0.3)));
  if (groups.rock.length) out.push(instanced(geo.rock(), mat({ color: 0xffffff }), groups.rock, vary(0x8a8890, 0.3)));
  if (groups.wall.length) out.push(instanced(geo.wall(), mat({ color: 0xffffff }), groups.wall, (t, c) => c.setHex(GROUND[t.id]).multiplyScalar(2.3 + hash2(t.x | 0, t.z | 0, 6) * 0.5)));
  return out;
}

// ---- town dressing and portals --------------------------------------------------------------------
function buildTown(cx, cy) {
  const g = new THREE.Group();
  // Well in the middle of the square.
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.5, 8, 1, true), mat({ color: 0x8a8580, side: THREE.DoubleSide }));
  ring.position.set(cx, 0.25, cy - 5.5);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.7, 8), mat({ color: 0x3a7cc0 }));
  water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.3, cy - 5.5);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.6, 4), mat({ color: 0x8a3a2c }));
  roof.position.set(cx, 1.75, cy - 5.5); roof.rotation.y = Math.PI / 4;
  for (const dx of [-0.7, 0.7]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), mat({ color: 0x6b4a2b })); post.position.set(cx + dx, 0.75, cy - 5.5); g.add(post); }
  g.add(ring, water, roof);
  // Market stall beside the merchant and a banner by the captain.
  const stall = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.7), mat({ color: 0x8a5a2c })); table.position.y = 0.7;
  const awning = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 1), mat({ color: 0x2f7a5a })); awning.position.y = 1.7; awning.rotation.x = 0.25;
  stall.add(table, awning);
  for (const [dx, dz] of [[-0.85, -0.3], [0.85, -0.3], [-0.85, 0.3], [0.85, 0.3]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, dz < 0 ? 1.75 : 1.55, 0.07), mat({ color: 0x5a3d24 })); leg.position.set(dx, (dz < 0 ? 1.75 : 1.55) / 2, dz); stall.add(leg); }
  for (let k = 0; k < 4; k++) { const crate = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.28), mat({ color: [0xc0463c, 0xe0b040, 0x6cc24a, 0x9a6a3a][k] })); crate.position.set(-0.6 + k * 0.4, 0.86, 0); stall.add(crate); }
  stall.position.set(cx + 4, 0, cy - 3.3);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 5), mat({ color: 0x5a3d24 })); pole.position.set(cx - 4.7, 1.3, cy - 3.2);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.55), mat({ color: 0x2f4f9a, side: THREE.DoubleSide })); flag.position.set(cx - 4.28, 2.25, cy - 3.2);
  g.add(stall, pole, flag);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.flag = flag;
  return g;
}

export function makePortal(exit) {
  const color = exit ? 0x58e08a : 0xb46bff, g = new THREE.Group();
  const stone = mat({ color: 0x7a7682 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.5, 0.32), stone); p.position.set(s * 0.7, 0.75, 0); g.add(p); }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.17, 5, 9, Math.PI), stone); arch.position.y = 1.5; g.add(arch);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  disc.scale.y = 1.55; disc.position.y = 1.02; g.add(disc);
  // No PointLight here: lights entering and leaving view would force shader recompiles.
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; g.add(glow);
  for (let i = 0; i < 3; i++) { const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color })); rune.position.set((i - 1) * 0.7, 2.25 - Math.abs(i - 1) * 0.35, 0.18); g.add(rune); }
  g.traverse((o) => { if (o.isMesh && o.material === stone) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.disc = disc;
  return g;
}

/** Everything static for one map. Returns { group, update(t) }. */
export function buildMap(map) {
  const group = new THREE.Group();
  for (const m of buildGround(map)) group.add(m);
  for (const m of buildObjects(map)) group.add(m);
  let town = null;
  if (map.kind === 'world') { town = buildTown(90, 70); group.add(town); }
  return {
    group,
    update(t) { if (town) town.userData.flag.rotation.y = Math.sin(t * 2) * 0.25; },
    dispose() { group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } }); },
  };
}
export const DUNGEON_THEME = Object.fromEntries(Object.entries(DUNGEONS).map(([id, d]) => [id, { fog: d.floor === T.ICE_F ? 0x101c28 : d.floor === T.MINE_F ? 0x1c100a : 0x100e18, light: d.floor === T.ICE_F ? 0xbfe6ff : d.floor === T.MINE_F ? 0xffa060 : 0xc9b0ff }]));

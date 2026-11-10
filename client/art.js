// All art is drawn procedurally onto canvas textures at boot: one consistent, flat-shaded
// style, no external image files.
import { T, TILE_COUNT } from '/shared/content.js';
import { hash2 } from '/shared/rng.js';

export const TS = 32;          // tile size in world pixels
export const VARIANTS = 4;     // tileset columns per tile id

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
export function shade(color, f) { // f < 1 darkens, f > 1 lightens
  const c = typeof color === 'string' ? parseInt(color.slice(1), 16) : color;
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * f + (f > 1 ? (f - 1) * 60 : 0))));
  return hex((ch(16) << 16) | (ch(8) << 8) | ch(0));
}

const GROUND = {
  [T.GRASS]: '#4f8f3a', [T.WOOD]: '#3b6b30', [T.ASH]: '#6e645d', [T.SNOW]: '#dce7ee', [T.PATH]: '#b39a6b',
  [T.TOWN]: '#9b978d', [T.WATER]: '#3a78b8', [T.CRYPT_F]: '#4d495c', [T.CRYPT_W]: '#262330',
  [T.MINE_F]: '#6d523f', [T.MINE_W]: '#2f221b', [T.ICE_F]: '#a5cbe0', [T.ICE_W]: '#3b5c77',
};
export const MINIMAP = { ...GROUND, [T.TREE]: '#2c5524', [T.ROCK]: '#777777', [T.DEADTREE]: '#4a403a', [T.PINE]: '#5d8a78' };
export const OBJECT_TILES = new Set([T.TREE, T.ROCK, T.DEADTREE, T.PINE]);
export const OBJECT_GROUND = { [T.TREE]: T.WOOD, [T.ROCK]: T.GRASS, [T.DEADTREE]: T.ASH, [T.PINE]: T.SNOW };
const WALLS = new Set([T.CRYPT_W, T.MINE_W, T.ICE_W]);
export const isWall = (id) => WALLS.has(id);

function drawTile(g, id, v) {
  const rnd = (i) => hash2(id * 31 + v, i, 99);
  const base = GROUND[id];
  if (base) {
    g.fillStyle = base; g.fillRect(0, 0, TS, TS);
    if (WALLS.has(id)) {
      if (v === 3) { // wall face (a floor tile lies below): lighter brick front
        g.fillStyle = shade(base, 1.7); g.fillRect(0, 10, TS, 22);
        g.fillStyle = shade(base, 1.25);
        for (let r = 0; r < 3; r++) for (let c = -1; c < 3; c++) g.fillRect(c * 16 + (r % 2) * 8 + 1, 11 + r * 7, 14, 6);
        g.fillStyle = shade(base, 0.6); g.fillRect(0, 29, TS, 3);
      } else {
        g.fillStyle = shade(base, 1.25);
        for (let i = 0; i < 3; i++) g.fillRect(rnd(i) * 26, rnd(i + 9) * 26, 5, 3);
      }
      return;
    }
    const n = id === T.WATER ? 3 : id === T.TOWN ? 0 : 7;
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(base, rnd(i + 20) > 0.5 ? 1.12 : 0.88);
      const w = id === T.WATER ? 9 : 2 + rnd(i + 40) * 3;
      g.fillRect(rnd(i) * (TS - w), rnd(i + 10) * (TS - 3), w, id === T.WATER ? 2 : w);
    }
    if (id === T.TOWN) { // cobbles
      g.strokeStyle = shade(base, 0.82); g.lineWidth = 1;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) g.strokeRect(c * 16 + 0.5 + (r ? 0 : 0), r * 16 + 0.5, 15, 15);
    }
    if ([T.CRYPT_F, T.MINE_F, T.ICE_F].includes(id)) { g.strokeStyle = shade(base, 0.85); g.strokeRect(0.5, 0.5, TS - 1, TS - 1); }
    return;
  }
  // Object tiles are transparent and sit on a second layer above the ground.
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.ellipse(16, 27, 12, 4, 0, 0, 7); g.fill();
  if (id === T.TREE) {
    g.fillStyle = '#5a3d24'; g.fillRect(14, 18, 5, 10);
    for (const [x, y, r, c] of [[16, 13, 12, '#2c5a24'], [11 + v, 10, 7, '#39722e'], [20, 9 + v, 6, '#458a37']]) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  } else if (id === T.PINE) {
    g.fillStyle = '#4a3320'; g.fillRect(14, 22, 4, 6);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = '#285a48'; g.beginPath(); g.moveTo(16, 1 + i * 6); g.lineTo(5 - i + 2, 12 + i * 6); g.lineTo(27 + i - 2, 12 + i * 6); g.fill();
      g.fillStyle = '#eef5f8'; g.beginPath(); g.moveTo(16, 1 + i * 6); g.lineTo(12, 6 + i * 6); g.lineTo(20, 6 + i * 6); g.fill();
    }
  } else if (id === T.DEADTREE) {
    g.strokeStyle = '#3c2f29'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(16, 28); g.lineTo(16, 10); g.moveTo(16, 18); g.lineTo(8, 9 + v); g.moveTo(16, 14); g.lineTo(24, 6 + v); g.moveTo(16, 10); g.lineTo(13, 3); g.stroke();
  } else { // rock
    g.fillStyle = '#7d7d82'; g.beginPath(); g.moveTo(5, 26); g.lineTo(8, 13 + v); g.lineTo(17, 8); g.lineTo(26, 15); g.lineTo(27, 26); g.fill();
    g.fillStyle = '#a3a3a8'; g.beginPath(); g.moveTo(8, 13 + v); g.lineTo(17, 8); g.lineTo(18, 16); g.lineTo(10, 19); g.fill();
  }
}

/** Tileset with a 1px extruded border around every tile so zoomed rendering never bleeds. */
export function makeTileset(scene) {
  const cell = TS + 2, tex = scene.textures.createCanvas('tiles', VARIANTS * cell, TILE_COUNT * cell);
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = TS;
  const tg = tmp.getContext('2d'), g = tex.getContext();
  for (let id = 0; id < TILE_COUNT; id++) for (let v = 0; v < VARIANTS; v++) {
    tg.clearRect(0, 0, TS, TS);
    tg.save(); drawTile(tg, id, v); tg.restore();
    const x = v * cell, y = id * cell;
    if (!OBJECT_TILES.has(id)) g.drawImage(tmp, x, y, cell, cell);
    g.drawImage(tmp, x + 1, y + 1);
  }
  tex.refresh();
}

// ---- characters --------------------------------------------------------------------------
const S = 64;
function canvasTex(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h), g = tex.getContext();
  draw(g);
  tex.refresh();
  return key;
}
const shadow = (g, w = 18) => { g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(32, 56, w, 5, 0, 0, 7); g.fill(); };
const blob = (g, x, y, rx, ry, fill, line = 3) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fillStyle = fill; g.fill(); if (line) { g.lineWidth = line; g.strokeStyle = shade(fill, 0.45); g.stroke(); } };
const eyes = (g, x, y, gap, color = '#fff') => { for (const s of [-1, 1]) { g.fillStyle = color; g.fillRect(x + s * gap - 2, y - 3, 5, 6); g.fillStyle = '#111'; g.fillRect(x + s * gap, y - 1, 3, 4); } };

function humanoid(g, body, head, hat) {
  shadow(g, 14);
  g.fillStyle = shade(body, 0.55); g.fillRect(24, 44, 7, 12); g.fillRect(33, 44, 7, 12);   // legs
  g.beginPath(); g.roundRect(19, 24, 26, 26, 8); g.fillStyle = body; g.fill(); g.lineWidth = 3; g.strokeStyle = shade(body, 0.45); g.stroke();
  g.fillStyle = shade(body, 1.3); g.fillRect(23, 36, 18, 3);                                 // belt
  blob(g, 32, 17, 11, 11, head);
  eyes(g, 33, 18, 5);
  hat?.(g);
}

const SHAPES = {
  slime(g, c) {
    shadow(g, 20);
    g.beginPath(); g.moveTo(10, 54); g.bezierCurveTo(8, 18, 56, 18, 54, 54); g.closePath();
    g.fillStyle = c; g.fill(); g.lineWidth = 3; g.strokeStyle = shade(c, 0.45); g.stroke();
    g.fillStyle = shade(c, 1.5); g.beginPath(); g.ellipse(23, 33, 6, 4, -0.5, 0, 7); g.fill();
    eyes(g, 34, 42, 7);
  },
  beast(g, c) {
    shadow(g, 20);
    g.fillStyle = shade(c, 0.6); for (const x of [16, 24, 36, 44]) g.fillRect(x, 44, 5, 12);
    blob(g, 30, 40, 19, 11, c);
    g.strokeStyle = shade(c, 0.45); g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(12, 36); g.lineTo(5, 28); g.stroke();
    g.fillStyle = c; g.beginPath(); g.moveTo(40, 24); g.lineTo(43, 14); g.lineTo(48, 24); g.moveTo(49, 24); g.lineTo(54, 15); g.lineTo(57, 26); g.fill();
    blob(g, 48, 32, 10, 9, shade(c, 1.12));
    g.fillStyle = '#111'; g.fillRect(50, 29, 3, 4); g.fillRect(56, 34, 3, 3);
  },
  humanoid(g, c) { humanoid(g, c, shade(c, 1.35)); },
  bug(g, c) {
    shadow(g, 20);
    g.strokeStyle = shade(c, 0.5); g.lineWidth = 3; g.lineCap = 'round';
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(32 + s * 8, 34 + i * 4); g.lineTo(32 + s * 22, 26 + i * 9); g.lineTo(32 + s * 26, 34 + i * 8); g.stroke(); }
    blob(g, 32, 42, 14, 12, c);
    blob(g, 32, 27, 9, 8, shade(c, 1.2));
    eyes(g, 32, 27, 4, '#ff5a5a');
  },
  wisp(g, c) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 26);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, hex(c)); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    blob(g, 32, 32, 9, 10, shade(c, 1.3), 2);
    g.fillStyle = '#111'; g.fillRect(27, 30, 3, 5); g.fillRect(34, 30, 3, 5);
  },
  golem(g, c) {
    shadow(g, 22);
    g.fillStyle = shade(c, 0.6); g.fillRect(20, 46, 9, 11); g.fillRect(35, 46, 9, 11);
    g.beginPath(); g.roundRect(12, 20, 40, 30, 6); g.fillStyle = c; g.fill(); g.lineWidth = 3; g.strokeStyle = shade(c, 0.45); g.stroke();
    g.fillStyle = shade(c, 1.3); g.fillRect(16, 24, 10, 6); g.fillRect(38, 24, 10, 6);
    g.beginPath(); g.roundRect(23, 8, 18, 15, 4); g.fillStyle = shade(c, 1.15); g.fill(); g.stroke();
    eyes(g, 32, 16, 4, '#ffd24a');
  },
};

const HATS = {
  warrior(g) { g.fillStyle = '#a9b0b8'; g.beginPath(); g.arc(32, 15, 12, Math.PI, 0); g.fill(); g.fillRect(20, 13, 24, 4); g.fillStyle = '#d14b3d'; g.fillRect(30, 0, 4, 8); },
  ranger(g) { g.fillStyle = '#2f6b36'; g.beginPath(); g.moveTo(19, 16); g.quadraticCurveTo(32, -8, 45, 16); g.lineTo(41, 12); g.lineTo(23, 12); g.fill(); },
  mage(g) { g.fillStyle = '#3b5fb5'; g.beginPath(); g.moveTo(16, 12); g.lineTo(48, 12); g.lineTo(34, -2); g.lineTo(30, 4); g.fill(); g.fillStyle = '#ffd24a'; g.fillRect(22, 9, 20, 3); },
};
const WEAPONS = {
  warrior(g) { g.fillStyle = '#d9dee4'; g.fillRect(8, 6, 20, 4); g.fillStyle = '#7a5a2c'; g.fillRect(2, 6, 6, 4); g.fillStyle = '#c9a23a'; g.fillRect(7, 3, 3, 10); },
  ranger(g) { g.strokeStyle = '#8a5a2c'; g.lineWidth = 3; g.beginPath(); g.arc(8, 8, 9, -1.2, 1.2); g.stroke(); g.strokeStyle = '#eee'; g.lineWidth = 1; g.beginPath(); g.moveTo(11, 0); g.lineTo(11, 16); g.stroke(); },
  mage(g) { g.fillStyle = '#7a5a2c'; g.fillRect(2, 7, 22, 3); g.fillStyle = '#7fd0ff'; g.beginPath(); g.arc(25, 8, 5, 0, 7); g.fill(); },
};

export const mobTexture = (scene, shape, color) => canvasTex(scene, `mob_${shape}_${color}`, S, S, (g) => SHAPES[shape](g, hex(color)));
export const npcTexture = (scene, color) => canvasTex(scene, `npc_${color}`, S, S, (g) => humanoid(g, hex(color), '#e8c39a'));
export const playerTexture = (scene, cls, color) => canvasTex(scene, `player_${cls}`, S, S, (g) => humanoid(g, hex(color), '#e8c39a', HATS[cls]));
export const weaponTexture = (scene, cls) => canvasTex(scene, `weapon_${cls}`, 32, 16, WEAPONS[cls]);
export const portalTexture = (scene, exit) => canvasTex(scene, `portal_${exit ? 1 : 0}`, S, S, (g) => {
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30), c = exit ? '#58e08a' : '#b46bff';
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.3, c); grad.addColorStop(0.8, shade(c, 0.4)); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.beginPath(); g.ellipse(32, 32, 24, 30, 0, 0, 7); g.fill();
});
export const dotTexture = (scene) => canvasTex(scene, 'dot', 8, 8, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(4, 4, 4, 0, 7); g.fill(); });

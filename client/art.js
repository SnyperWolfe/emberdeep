// All art is drawn procedurally onto canvas textures at boot, so the game ships no image files.
//
// Visual system (keep new sprites inside it):
// - View: top-down three-quarter, characters face right (flipped in-engine for left).
// - Light: from the top-left. Every shape gets three tones (highlight rim top-left, base,
//   shadow rim bottom-right) and a dark outline tinted from its own colour, never pure black.
// - Proportions: chunky, big heads (roughly 1:2), readable silhouettes at ~48px on screen.
// - Resolution: drawn in a 64x64 design space, rasterised at 2x (128px) and shown at 0.44x.
// - Animation: 4 frames per sheet: idle, idle-breath, step left, step right.
import { T, TILE_COUNT } from '/shared/content.js';
import { hash2 } from '/shared/rng.js';

export const TS = 32;          // world units per tile (gameplay)
export const TEX_TS = 64;      // tileset pixels per tile (drawn at 2x, layer scaled by 0.5)
export const VARIANTS = 4;     // tileset columns per tile id
export const SPRITE_SCALE = 0.44;
const RES = 2, S = 64, FRAME = S * RES;
export const FRAMES = [{ bob: 0, step: 0, f: 0 }, { bob: 1, step: 0, f: 1 }, { bob: -1, step: 1, f: 2 }, { bob: -1, step: -1, f: 3 }];

// ---- colour helpers --------------------------------------------------------------------------
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
const rgb = (c) => { const n = typeof c === 'string' ? parseInt(c.slice(1), 16) : c; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex((Math.round(x[0] + (y[0] - x[0]) * t) << 16) | (Math.round(x[1] + (y[1] - x[1]) * t) << 8) | Math.round(x[2] + (y[2] - x[2]) * t)); };
/** f < 1 darkens (shifting slightly toward violet so shadows are not muddy); f > 1 lightens. */
export function shade(c, f) {
  if (f >= 1) return mix(c, '#ffffff', Math.min(1, f - 1));
  const [r, g, b] = rgb(c);
  return mix(hex((Math.round(r * f) << 16) | (Math.round(g * f) << 8) | Math.round(b * f)), '#2a1f4a', (1 - f) * 0.25);
}
const rgba = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; };

// ---- shape primitives (paths are functions so they can be re-traced for shading) ---------------
const ell = (x, y, rx, ry, rot = 0) => (g) => { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2); };
const rr = (x, y, w, h, r) => (g) => { g.beginPath(); g.roundRect(x, y, Math.max(0.1, w), Math.max(0.1, h), r); };
const poly = (...pts) => (g) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); };

/** A cel-shaded, outlined shape: highlight rim top-left, base, shadow rim bottom-right. */
function part(g, path, color, { line = 1.5, hi = 1.4, sh = 2.4, out } = {}) {
  const c = typeof color === 'number' ? hex(color) : color;
  g.save();
  path(g); g.clip();
  g.fillStyle = shade(c, 1.3); g.fillRect(-20, -20, 110, 110);
  g.save(); g.translate(hi, hi); path(g); g.fillStyle = c; g.fill(); g.restore();
  g.save(); g.translate(-sh, -sh); path(g); g.rect(-300, -300, 700, 700); g.fillStyle = shade(c, 0.7); g.fill('evenodd'); g.restore();
  g.restore();
  if (line) { path(g); g.lineWidth = line; g.lineJoin = 'round'; g.strokeStyle = out || shade(c, 0.32); g.stroke(); }
}
/** A limb, tail or stick: an outlined thick stroke. */
function limb(g, pts, w, color, cap = 'round') {
  const c = typeof color === 'number' ? hex(color) : color;
  g.lineCap = cap; g.lineJoin = 'round';
  const trace = (o) => { g.beginPath(); g.moveTo(pts[0] + o, pts[1] + o); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] + o, pts[i + 1] + o); };
  trace(0); g.lineWidth = w + 2.6; g.strokeStyle = shade(c, 0.32); g.stroke();
  g.strokeStyle = c; g.lineWidth = w; g.stroke();
  if (w >= 1.5) { trace(-w * 0.22); g.lineWidth = w * 0.35; g.strokeStyle = shade(c, 1.28); g.stroke(); }
}
function glow(g, x, y, r, color, a = 0.7) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, rgba(color, a)); grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
}
const groundShadow = (g, w = 13, y = 55) => { g.fillStyle = 'rgba(10,8,20,0.32)'; g.beginPath(); g.ellipse(32, y, w, w * 0.3, 0, 0, Math.PI * 2); g.fill(); };
function eye(g, x, y, { r = 2.2, iris = '#1b1626', white = '#ffffff', glowC } = {}) {
  if (glowC) glow(g, x, y, r * 3.2, glowC, 0.8);
  g.fillStyle = white; g.beginPath(); g.ellipse(x, y, r, r * 1.2, 0, 0, Math.PI * 2); g.fill();
  if (iris) { g.fillStyle = iris; g.beginPath(); g.ellipse(x + r * 0.35, y + 0.2, r * 0.6, r * 0.8, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(x - r * 0.2, y - r * 0.7, 0.9, 0.9);
}
const sparkle = (g, x, y, s, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.3, y); g.lineTo(x, y + s); g.lineTo(x - s * 0.3, y); g.closePath(); g.fill(); g.beginPath(); g.moveTo(x - s, y); g.lineTo(x, y + s * 0.3); g.lineTo(x + s, y); g.lineTo(x, y - s * 0.3); g.closePath(); g.fill(); };

// ---- held items (enemies; players hold a separate rotating weapon sprite) ---------------------
const HELD = {
  sword(g, x, y, c = '#cfd6de') { limb(g, [x, y + 2, x + 2, y - 15], 2.6, c, 'butt'); limb(g, [x - 3, y, x + 4, y + 0.5], 1.6, '#c9a23a'); limb(g, [x - 0.5, y + 1, x - 1, y + 5], 1.8, '#5a3d24'); },
  bigsword(g, x, y, c = '#bfe8ff') { g.save(); glow(g, x + 3, y - 14, 12, c, 0.45); g.restore(); part(g, poly(x - 2, y, x + 2, y, x + 5, y - 24, x + 3, y - 28, x - 1, y - 24), c, { line: 1.2 }); limb(g, [x - 5, y + 0.5, x + 5, y + 0.5], 2, '#6fa8d6'); limb(g, [x, y + 1, x, y + 6], 2, '#3b4a66'); },
  dagger(g, x, y) { limb(g, [x, y, x + 6, y - 6], 1.8, '#d9dee4', 'butt'); limb(g, [x - 1, y + 1, x - 3, y + 3], 2, '#4a3020'); },
  bow(g, x, y, c = '#8a5a2c') { g.lineCap = 'round'; for (const [w, col] of [[4, shade(c, 0.35)], [2.2, c]]) { g.beginPath(); g.arc(x - 2, y - 2, 10, -1.25, 1.25); g.lineWidth = w; g.strokeStyle = col; g.stroke(); } g.beginPath(); g.moveTo(x + 1, y - 11.5); g.lineTo(x + 1, y + 7.5); g.lineWidth = 0.7; g.strokeStyle = '#efe6cf'; g.stroke(); },
  staff(g, x, y, orb = '#b98cff') { limb(g, [x, y + 12, x + 1, y - 16], 2.2, '#6b4a2b'); glow(g, x + 1, y - 18, 9, orb, 0.75); part(g, ell(x + 1, y - 18, 3.4, 3.4), orb, { line: 1.1 }); },
  icestaff(g, x, y) { limb(g, [x, y + 12, x + 1, y - 14], 2, '#9ec8e6'); glow(g, x + 1, y - 17, 9, '#bff0ff', 0.8); part(g, poly(x + 1, y - 24, x + 4, y - 17, x + 1, y - 12, x - 2, y - 17), '#dff6ff', { line: 1 }); },
  axe(g, x, y) { limb(g, [x, y + 6, x + 1, y - 14], 2, '#5a3d24'); part(g, poly(x + 1, y - 14, x + 9, y - 17, x + 10, y - 8, x + 1, y - 10), '#aeb6bf', { line: 1.2 }); },
  shield(g, x, y, c = '#8a2f2a') { part(g, poly(x - 6, y - 7, x + 6, y - 7, x + 6, y + 2, x, y + 8, x - 6, y + 2), c, { line: 1.3 }); part(g, ell(x, y - 1, 2, 2), '#d4b24a', { line: 0.8 }); },
};

// ---- archetypes -------------------------------------------------------------------------------
function biped(g, o, p) {
  const b = p.bob, st = p.step, skin = o.skin || '#e8bf96';
  groundShadow(g, o.wide ? 15 : 12);
  if (o.cape) part(g, poly(23, 26 + b, 39, 26 + b, 43 - st, 51, 32, 53, 19 + st, 51), o.cape);
  o.back?.(g, b, p);
  limb(g, [24, 32 + b, 22 - st * 1.5, 40 + b], 3.4, o.sleeve || o.body);   // far arm
  part(g, ell(22 - st * 1.5, 41 + b, 2.6, 2.6), o.gloves || skin, { line: 1.1 });
  if (o.robe) {
    part(g, poly(21, 36 + b, 43, 36 + b, 46 + st * 0.6, 53, 18 - st * 0.6, 53), o.robe);
    if (o.trim) { g.fillStyle = o.trim; g.fillRect(19 - st * 0.6, 50.6, 26.5 + st * 1.2, 1.6); }
  } else {
    for (const s of [-1, 1]) {
      const lift = Math.max(0, st * s), x = 32 + s * 4.6 + st * s * 1.6;
      part(g, rr(x - 3.2, 40 + b * 0.5, 6.4, 12 - lift * 2, 2.5), s < 0 ? shade(o.legs, 0.85) : o.legs, { line: 1.2 });
      part(g, rr(x - 3.6 + 0.8, 49.5 - lift * 2, 7.8, 4.6, 2), o.boots || shade(o.legs, 0.6), { line: 1.2 });
    }
  }
  part(g, rr(20.5, 25 + b, 23, 17.5, 7), o.body);
  o.torso?.(g, b, p);
  o.head ? o.head(g, b, p) : part(g, ell(32.5, 16 + b, 10.5, 10), skin);
  if (!o.noFace) { eye(g, 36, 16.5 + b, { r: 1.9, iris: o.iris }); eye(g, 40.5, 16.8 + b, { r: 1.6, iris: o.iris }); }
  o.hat?.(g, b, p);
  limb(g, [40, 31 + b, 42 + st * 1.2, 38 + b], 3.4, o.sleeve || o.body);    // near arm
  part(g, ell(42.5 + st * 1.2, 39.5 + b, 2.7, 2.7), o.gloves || skin, { line: 1.1 });
  o.held?.(g, 43 + st * 1.2, 39 + b, p);
}

function quad(g, o, p) {
  const b = p.bob * 0.6, st = p.step;
  groundShadow(g, 19);
  if (o.tail !== false) limb(g, [15, 36 + b, 9, 31 + b, 6 - st, 27 + b], o.tailW || 3, o.fur || o.body);
  for (const [x, s] of [[19, 1], [39, -1]]) part(g, rr(x - 2.4 + st * s * 2, 40 + b, 4.8, 14 - b, 2), shade(o.body, 0.72), { line: 1.1 });
  part(g, ell(29, 37 + b, 16.5, 10), o.body);
  if (o.belly) part(g, ell(30, 43 + b, 11, 3.4), o.belly, { line: 0 });
  if (o.stripes) { g.strokeStyle = shade(o.body, 0.6); g.lineWidth = 1.4; for (const x of [22, 27, 32]) { g.beginPath(); g.moveTo(x, 28.5 + b); g.lineTo(x - 2, 34 + b); g.stroke(); } }
  o.mane?.(g, b);
  for (const [x, s] of [[23, -1], [43, 1]]) part(g, rr(x - 2.6 + st * s * 2, 41 + b, 5.2, 13.5 - b, 2), o.body, { line: 1.2 });
  for (const [x, s] of [[23, -1], [43, 1]]) part(g, rr(x - 3 + st * s * 2, 51.5, 6, 3, 1.5), o.paws || shade(o.body, 0.5), { line: 0.9 });
  part(g, poly(41, 27 + b, 44, 19 + b, 48, 26 + b), o.ear || o.body, { line: 1.2 });
  part(g, ell(47, 30 + b, 9, 8), o.head || o.body);
  part(g, ell(54.5, 33 + b, 5.2, 4), o.snout || shade(o.body, 1.2));
  g.fillStyle = '#1b1626'; g.beginPath(); g.ellipse(58.6, 31.6 + b, 1.6, 1.3, 0, 0, Math.PI * 2); g.fill();
  part(g, poly(48, 25 + b, 51, 16 + b, 54, 25 + b), o.ear || o.body, { line: 1.2 });
  eye(g, 50.5, 28.5 + b, { r: 1.7, iris: o.iris || '#1b1626', white: o.eyeWhite || '#fff', glowC: o.eyeGlow });
  o.extra?.(g, b);
}

function blob(g, o, p) {
  const sq = p.bob * 1.6 + (p.step ? 1.5 : 0), w = 21 + sq, h = 19 - sq;
  groundShadow(g, 20);
  const body = (gg) => { gg.beginPath(); gg.moveTo(32 - w, 54); gg.bezierCurveTo(32 - w, 54 - h * 1.6, 32 + w, 54 - h * 1.6, 32 + w, 54); gg.quadraticCurveTo(32, 57, 32 - w, 54); gg.closePath(); };
  if (o.glow) glow(g, 32, 44, 30, o.glow, 0.45);
  part(g, body, o.body);
  g.save(); body(g); g.clip();
  for (const [x, y, r] of o.bubbles || []) { g.fillStyle = rgba(shade(o.body, 1.5), 0.55); g.beginPath(); g.arc(x, y + sq, r, 0, Math.PI * 2); g.fill(); }
  o.inner?.(g, sq);
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(22, 40 + sq * 0.8, 4.5, 2.6, -0.6, 0, Math.PI * 2); g.fill();
  o.face ? o.face(g, sq) : (eye(g, 36, 43 + sq * 0.6, { r: 2.6 }), eye(g, 44, 43.5 + sq * 0.6, { r: 2.3 }));
  o.extra?.(g, sq);
}

function floater(g, o, p) {
  const fy = [0, -2, -1, -3][p.f];
  g.fillStyle = 'rgba(10,8,20,0.22)'; g.beginPath(); g.ellipse(32, 56, 9 + fy * 0.5, 2.6, 0, 0, Math.PI * 2); g.fill();
  g.save(); g.translate(0, fy);
  glow(g, 32, 32, 26, o.glow || o.body, 0.55);
  o.draw(g, p);
  g.restore();
}

function golem(g, o, p) {
  const b = p.bob * 0.6, st = p.step;
  groundShadow(g, 19);
  for (const s of [-1, 1]) part(g, rr(32 + s * 7 - 4.5 + st * s * 1.5, 42 + b * 0.4, 9, 13 - Math.max(0, st * s) * 2, 2), shade(o.body, s < 0 ? 0.75 : 0.9));
  part(g, ell(15, 33 + b, 6.5, 7.5), shade(o.body, 0.8));                       // far fist
  part(g, poly(14, 24 + b, 26, 18 + b, 44, 19 + b, 52, 27 + b, 49, 44 + b, 16, 45 + b), o.body);
  if (o.core) { g.strokeStyle = o.core; g.lineWidth = 1.5; g.shadowColor = o.core; g.shadowBlur = 6; g.beginPath(); g.moveTo(24, 26 + b); g.lineTo(29, 33 + b); g.lineTo(26, 40 + b); g.moveTo(37, 24 + b); g.lineTo(35, 31 + b); g.lineTo(41, 36 + b); g.stroke(); g.shadowBlur = 0; }
  o.decor?.(g, b);
  part(g, rr(28, 8 + b, 17, 14, 4), o.head || shade(o.body, 1.1));
  eye(g, 38, 14.5 + b, { r: 1.7, iris: null, white: o.eyes || '#ffd24a', glowC: o.eyes || '#ffd24a' });
  eye(g, 42.5, 14.8 + b, { r: 1.5, iris: null, white: o.eyes || '#ffd24a', glowC: o.eyes || '#ffd24a' });
  part(g, ell(14, 24 + b, 7, 6), shade(o.body, 1.08));                          // shoulders
  part(g, ell(49, 25 + b, 7.5, 6.5), shade(o.body, 1.08));
  part(g, ell(50 + st, 39 + b, 7, 7.5), o.body);                                 // near fist
  o.top?.(g, b);
}

function bug(g, o, p) {
  const b = p.bob * 0.5, st = p.step;
  groundShadow(g, 20);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const k = (i % 2 ? 1 : -1) * st * 1.6, x = 22 + i * 7;
    const pts = s < 0 ? [x, 40 + b, x - 6 + k, 33 + b, x - 9 + k, 49] : [x, 42 + b, x + 3 - k, 46 + b, x + 1 - k, 53];
    limb(g, pts, 1.7, s < 0 ? shade(o.legs || o.body, 0.75) : (o.legs || o.body));
  }
  part(g, ell(20, 38 + b, 12, 10), o.body);                                       // abdomen
  o.pattern?.(g, b);
  part(g, ell(36, 40 + b, 8, 7), shade(o.body, 1.1));                           // thorax
  part(g, ell(46, 39 + b, 7, 6), o.head || shade(o.body, 1.2));
  limb(g, [51, 42 + b, 55, 45 + b], 1.5, o.fang || '#e8e0c8');
  limb(g, [51, 37 + b, 56, 39 + b], 1.5, o.fang || '#e8e0c8');
  for (const [x, y, r] of [[47, 36.5, 1.5], [50, 36, 1.3], [48.5, 39.5, 1.1]]) eye(g, x, y + b, { r, iris: null, white: o.eyes || '#ff5a5a', glowC: o.eyeGlow });
}

// ---- head pieces -------------------------------------------------------------------------------
const HEADS = {
  skull: (c = '#e9e4d0') => (g, b) => {
    part(g, ell(32.5, 15.5 + b, 10, 9.5), c);
    part(g, rr(31, 21 + b, 10, 5, 2), shade(c, 0.9), { line: 1.1 });
    g.fillStyle = '#1b1626'; for (const x of [34.5, 39.5]) { g.beginPath(); g.ellipse(x, 16 + b, 2.3, 2.7, 0, 0, Math.PI * 2); g.fill(); }
    g.fillRect(37, 19.5 + b, 1.4, 2); for (let i = 0; i < 3; i++) g.fillRect(33 + i * 2.6, 23 + b, 0.9, 2.4);
  },
  hood: (c, face = '#2a2236') => (g, b) => {
    part(g, poly(20, 24 + b, 23, 8 + b, 33, 3 + b, 43, 9 + b, 45, 24 + b), c);
    part(g, ell(36.5, 17 + b, 7, 7.5), face, { line: 1, hi: 0, sh: 1.6 });
  },
};
const HATS = {
  helm: (steel = '#aeb7c2', plume = '#d14b3d') => (g, b) => {
    limb(g, [32, 7 + b, 28, 1 + b, 22, 3 + b], 3.2, plume);
    part(g, poly(21.5, 17 + b, 22.5, 8 + b, 32, 4.5 + b, 42, 8 + b, 43.5, 17 + b, 39, 14 + b, 27, 14 + b), steel);
    g.fillStyle = shade(steel, 0.45); g.fillRect(34, 14.6 + b, 9, 1.2);
  },
  wizard: (c = '#3b5fb5', band = '#ffd24a') => (g, b) => {
    part(g, poly(17, 11 + b, 48, 11 + b, 44, 8 + b, 36, 7 + b, 31, -1.5 + b, 25, 2 + b, 22, 8 + b), c);
    g.fillStyle = band; g.fillRect(21.5, 8.3 + b, 22, 2.2);
    sparkle(g, 29.5, 3.5 + b, 2.2, band);
  },
  hood: (c) => (g, b) => {
    part(g, poly(20, 20 + b, 21, 10 + b, 31, 3 + b, 41, 6 + b, 46, 13 + b, 44, 14 + b, 37, 9 + b, 28, 10 + b, 24, 22 + b), c);
    limb(g, [25, 21 + b, 24, 27 + b], 2, shade(c, 0.85));
  },
  crown: (c = '#ffd24a', gem = '#b46bff') => (g, b) => {
    part(g, poly(23, 9 + b, 23, 3 + b, 26.5, 6 + b, 30, 0 + b, 33.5, 5.5 + b, 37, 0 + b, 40.5, 6 + b, 43, 2.5 + b, 43, 9 + b), c, { line: 1.2 });
    part(g, ell(33, 6.6 + b, 1.6, 1.6), gem, { line: 0.6 });
  },
  icecrown: () => (g, b) => {
    for (const [x, h] of [[24, 6], [29, 9.5], [34, 11.5], [39, 9], [43, 5.5]]) part(g, poly(x - 2.4, 9 + b, x, 9 - h + b, x + 2.4, 9 + b), '#cfefff', { line: 1 });
  },
  wide: (c = '#8a6a3a') => (g, b) => { part(g, ell(32.5, 9.5 + b, 16, 3.6), c); part(g, rr(25, 1 + b, 15, 9, 4), shade(c, 1.1)); g.fillStyle = '#c0463c'; g.fillRect(25.5, 6.5 + b, 14, 1.8); },
  horns: (c = '#3b2a2a') => (g, b) => { for (const [x, d] of [[25, -1], [39, 1]]) part(g, poly(x - 2.5, 9 + b, x + d * 2, -1 + b, x + 2.5 + d * 3, 1 + b, x + 2.5, 9 + b), c, { line: 1 }); },
};

// ---- enemies, NPCs and player classes ------------------------------------------------------------
const flameBody = (g, c, x = 32, y = 30, s = 1) => {
  part(g, (gg) => { gg.beginPath(); gg.moveTo(x, y - 16 * s); gg.bezierCurveTo(x + 13 * s, y - 4 * s, x + 11 * s, y + 13 * s, x, y + 13 * s); gg.bezierCurveTo(x - 11 * s, y + 13 * s, x - 13 * s, y - 4 * s, x, y - 16 * s); gg.closePath(); }, c, { line: 1.3 });
  g.fillStyle = rgba('#ffffff', 0.7); g.beginPath(); g.ellipse(x, y + 5 * s, 4.5 * s, 5.5 * s, 0, 0, Math.PI * 2); g.fill();
};
const wings = (c) => (g) => { for (const [s, k] of [[-1, 0.8], [1, 1]]) part(g, poly(32, 28, 32 + s * 9, 16, 32 + s * 21, 15, 32 + s * 17, 23, 32 + s * 20, 29, 32 + s * 12, 30), shade(c, k), { line: 1.2 }); };

const ART = {
  slime: { kind: blob, body: '#6cc24a', bubbles: [[26, 48, 2.2], [40, 50, 1.6], [33, 45, 1.2]] },
  boar: { kind: quad, body: '#8a5d3b', fur: '#5a3a22', snout: '#c9906a', belly: '#a77b55', mane: (g, b) => { for (let i = 0; i < 5; i++) part(g, poly(20 + i * 5, 29 + b, 22.5 + i * 5, 22 + b - (i % 2) * 2, 25 + i * 5, 29 + b), '#4a2f1d', { line: 1 }); }, extra: (g, b) => { part(g, poly(55, 36 + b, 60, 32 + b, 57, 37.5 + b), '#f4ecd2', { line: 1 }); } },
  bandit: { kind: biped, body: '#6b3a3a', legs: '#3a3346', boots: '#2b2222', sleeve: '#5a3030', iris: '#1b1626', head: HEADS.hood('#4a2c2c', '#e8bf96'), hat: (g, b) => { g.fillStyle = '#2b1f2a'; g.fillRect(33, 19 + b, 11, 4); }, torso: (g, b) => { g.fillStyle = '#2b2222'; g.fillRect(21.5, 35 + b, 21.5, 2.4); part(g, rr(29, 34.5 + b, 4, 3.4, 1), '#c9a23a', { line: 0.7 }); }, held: HELD.dagger },
  wolf: { kind: quad, body: '#7d8590', fur: '#5d6570', belly: '#aab2bb', snout: '#9aa2ad', eyeGlow: '#ffe28a', iris: '#ffe28a', eyeWhite: '#ffe28a', mane: (g, b) => part(g, ell(39, 32 + b, 7, 7), '#9aa2ad', { line: 1 }) },
  spider: { kind: bug, body: '#5b3e78', legs: '#3d2952', head: '#6b4a86', pattern: (g, b) => { g.fillStyle = '#c9a0ff'; for (const [x, y] of [[17, 34], [22, 38], [17, 42]]) { g.beginPath(); g.ellipse(x, y + b, 1.8, 1.4, 0, 0, Math.PI * 2); g.fill(); } }, eyes: '#ff5a5a' },
  thornling: { kind: golem, body: '#4f7a3a', head: '#5d8a44', eyes: '#d6ff6a', decor: (g, b) => { for (const [x, y, r] of [[20, 28, -0.6], [44, 30, 0.6], [30, 38, 0]]) part(g, poly(x, y + b, x + 2 + r * 3, y - 6 + b, x + 4, y + b), '#c9b27a', { line: 0.9 }); }, top: (g, b) => { part(g, ell(30, 7 + b, 5, 2.6, -0.5), '#7fc45a', { line: 1 }); part(g, ell(40, 6 + b, 5, 2.6, 0.5), '#6aac4a', { line: 1 }); } },
  imp: { kind: floater, glow: '#ff8a3c', draw: (g) => { wings('#9a3a2a')(g); flameBody(g, '#ff7a3c'); HATS.horns('#4a2020')(g, 8); eye(g, 30, 27, { r: 2, iris: '#1b1626', white: '#fff3b0' }); eye(g, 36, 27, { r: 2, iris: '#1b1626', white: '#fff3b0' }); limb(g, [28, 42, 24, 48, 27, 51], 1.5, '#c0402a'); } },
  hound: { kind: quad, body: '#5a4646', fur: '#3a2c2c', belly: '#7a6060', snout: '#6a5454', eyeGlow: '#ff6a2a', eyeWhite: '#ffb060', iris: '#ff3a1a', stripes: true, extra: (g, b) => { g.strokeStyle = '#ff7a2a'; g.lineWidth = 1.2; g.shadowColor = '#ff7a2a'; g.shadowBlur = 5; g.beginPath(); g.moveTo(20, 33 + b); g.lineTo(26, 37 + b); g.lineTo(31, 34 + b); g.stroke(); g.shadowBlur = 0; } },
  golem: { kind: golem, body: '#7a3a2c', head: '#8a4a36', core: '#ffa040', eyes: '#ffcf5a' },
  wisp: { kind: floater, glow: '#9fe0ff', draw: (g) => { flameBody(g, '#9fe0ff', 32, 30, 1); eye(g, 29, 29, { r: 2, iris: '#1b3a5a' }); eye(g, 36, 29, { r: 2, iris: '#1b3a5a' }); sparkle(g, 20, 16, 2.5, '#ffffff'); sparkle(g, 45, 22, 1.8, '#e0f8ff'); } },
  stalker: { kind: quad, body: '#cfe0ea', fur: '#a9c2d2', belly: '#eef6fa', snout: '#e2eef4', iris: '#3a7ab8', mane: (g, b) => { for (let i = 0; i < 4; i++) part(g, poly(24 + i * 5, 29 + b, 26 + i * 5, 21 + b, 28.5 + i * 5, 29 + b), '#9fd0ee', { line: 1 }); } },
  brute: { kind: golem, body: '#7fb2d6', head: '#9cc6e2', eyes: '#e8fbff', top: (g, b) => { for (const [x, h] of [[12, 10], [17, 7], [48, 9], [53, 6]]) part(g, poly(x - 3, 22 + b, x, 22 - h + b, x + 3, 22 + b), '#dff6ff', { line: 1 }); } },
  skeleton: { kind: biped, body: '#d8d4c0', legs: '#cfcab4', boots: '#a9a48e', sleeve: '#d8d4c0', skin: '#e9e4d0', head: HEADS.skull(), noFace: true, torso: (g, b) => { g.strokeStyle = '#8a8670'; g.lineWidth = 1.2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(24, 29 + i * 4 + b); g.quadraticCurveTo(32, 31 + i * 4 + b, 40, 29 + i * 4 + b); g.stroke(); } }, back: (g, b) => HELD.shield(g, 21, 34 + b, '#5a4a3a'), held: (g, x, y) => HELD.sword(g, x, y, '#b9bcc0') },
  ghoul: { kind: quad, body: '#7a8f6a', fur: '#5a6e4c', belly: '#98a888', snout: '#8a9e78', eyeWhite: '#e6ff9a', iris: '#2a3a1a', eyeGlow: '#c6ff6a', tail: false, mane: (g, b) => { g.strokeStyle = '#4a5a3a'; g.lineWidth = 1; for (const x of [22, 26, 30, 34]) { g.beginPath(); g.moveTo(x, 30 + b); g.lineTo(x + 1, 36 + b); g.stroke(); } } },
  bonearcher: { kind: biped, body: '#bfb89a', legs: '#b0aa8e', boots: '#8a8470', sleeve: '#bfb89a', skin: '#e6e0c8', head: HEADS.skull('#e6e0c8'), noFace: true, hat: HATS.hood('#5a4a3a'), back: (g, b) => { part(g, rr(17, 24 + b, 6, 15, 2), '#6b4a2b', { line: 1 }); for (const x of [18, 20.5]) limb(g, [x, 24 + b, x, 20 + b], 0.8, '#efe6cf'); }, held: (g, x, y) => HELD.bow(g, x + 2, y - 4, '#a99f80') },
  regent: { kind: biped, body: '#5a3f8a', robe: '#4a2f7a', trim: '#ffd24a', sleeve: '#5a3f8a', skin: '#efe8d0', cape: '#2e1d52', head: HEADS.skull('#efe8d0'), noFace: true, hat: HATS.crown(), torso: (g, b) => { part(g, poly(26, 25 + b, 38, 25 + b, 32, 33 + b), '#ffd24a', { line: 1 }); }, held: (g, x, y) => HELD.staff(g, x, y, '#b98cff'), wide: true },
  crawler: { kind: bug, body: '#8a4a24', legs: '#5a2f18', head: '#9a5a2c', eyes: '#ffcf5a', eyeGlow: '#ffa040', pattern: (g, b) => { g.strokeStyle = '#ff7a2a'; g.lineWidth = 1.3; for (const x of [15, 20, 25]) { g.beginPath(); g.moveTo(x, 30 + b); g.lineTo(x + 1, 46 + b); g.stroke(); } } },
  magmaimp: { kind: floater, glow: '#ff5a1f', draw: (g) => { wings('#5a1a10')(g); flameBody(g, '#ff5a1f', 32, 30, 1.05); HATS.horns('#2a1010')(g, 7); eye(g, 30, 27, { r: 2, iris: '#1b1626', white: '#ffe060' }); eye(g, 36, 27, { r: 2, iris: '#1b1626', white: '#ffe060' }); g.fillStyle = '#ffe060'; for (const [x, y] of [[22, 12], [44, 18], [40, 8]]) g.fillRect(x, y, 1.6, 1.6); } },
  slag: { kind: golem, body: '#4a3430', head: '#5a3f38', core: '#ff6a1a', eyes: '#ff9a3a', top: (g, b) => { glow(g, 32, 30 + b, 14, '#ff5a1a', 0.35); } },
  magmaw: { kind: blob, body: '#d9461a', glow: '#ff6a1a', bubbles: [[22, 50, 2.6], [44, 49, 2], [30, 46, 1.4]], inner: (g, sq) => { g.strokeStyle = '#ffd24a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(14, 48 + sq); g.lineTo(20, 44 + sq); g.lineTo(24, 47 + sq); g.moveTo(46, 40 + sq); g.lineTo(50, 46 + sq); g.stroke(); }, face: (g, sq) => { eye(g, 30, 36 + sq * 0.6, { r: 2.6, iris: '#1b1626', white: '#ffe060', glowC: '#ffd24a' }); eye(g, 42, 36.5 + sq * 0.6, { r: 2.4, iris: '#1b1626', white: '#ffe060', glowC: '#ffd24a' }); part(g, ell(36, 46 + sq * 0.5, 9, 4.5), '#3a0a06', { line: 1.2 }); g.fillStyle = '#fff3d0'; for (let i = 0; i < 5; i++) { const x = 29.5 + i * 3.3; g.beginPath(); g.moveTo(x, 42.5 + sq * 0.5); g.lineTo(x + 1.3, 46 + sq * 0.5); g.lineTo(x + 2.6, 42.5 + sq * 0.5); g.fill(); } }, extra: (g, sq) => { for (const [x, h] of [[22, 6], [29, 9], [36, 10], [43, 8], [49, 5]]) part(g, poly(x - 3, 27 + sq + Math.abs(x - 36) * 0.3, x, 27 - h + sq + Math.abs(x - 36) * 0.3, x + 3, 27 + sq + Math.abs(x - 36) * 0.3), '#3a2a26', { line: 1 }); } },
  revenant: { kind: biped, body: '#6f9fc4', legs: '#4f7a9a', boots: '#3a5a78', sleeve: '#6f9fc4', skin: '#bfe6ff', iris: '#1b3a5a', head: (g, b) => { part(g, ell(32.5, 16 + b, 10.5, 10), '#a9d6f2'); glow(g, 38, 16 + b, 7, '#bff0ff', 0.6); }, hat: HATS.helm('#8fb8d6', '#dff6ff'), held: (g, x, y) => HELD.sword(g, x, y, '#dff6ff') },
  rimecaster: { kind: floater, glow: '#c9f0ff', draw: (g, p) => { part(g, poly(20, 50, 22, 26, 32, 18, 42, 26, 44, 50, 38, 46, 32, 51, 26, 46), '#6aa6d0'); HEADS.hood('#4f86b0', '#1b2a40')(g, 0); eye(g, 35, 17, { r: 1.5, iris: null, white: '#bff0ff', glowC: '#bff0ff' }); eye(g, 39.5, 17, { r: 1.3, iris: null, white: '#bff0ff', glowC: '#bff0ff' }); HELD.icestaff(g, 46, 36); } },
  frostknight: { kind: golem, body: '#5f8fbf', head: '#7fa8d0', eyes: '#dff6ff', decor: (g, b) => { part(g, rr(26, 24 + b, 14, 14, 3), '#8fb8de', { line: 1 }); g.fillStyle = '#dff6ff'; g.fillRect(32, 26 + b, 2, 10); g.fillRect(28, 30 + b, 10, 2); }, top: (g, b) => HATS.icecrown()(g, b + 2) },
  vael: { kind: biped, body: '#4f8fc4', legs: '#3b6a94', boots: '#2b4a6a', sleeve: '#5f9fd4', skin: '#d6f2ff', iris: '#1b5a8a', cape: '#1f3f6a', wide: true, hat: HATS.icecrown(), torso: (g, b) => { part(g, poly(23, 26 + b, 41, 26 + b, 39, 37 + b, 25, 37 + b), '#9fd4f4', { line: 1 }); sparkle(g, 32, 31 + b, 3, '#ffffff'); }, held: (g, x, y) => HELD.bigsword(g, x, y) },
};

const NPC_ART = {
  quests: { kind: biped, body: '#b8902c', legs: '#3a3a52', boots: '#2b2222', sleeve: '#3f5fb5', cape: '#2f4f9a', hat: HATS.helm('#d9b24c', '#3f6fd0'), torso: (g, b) => { part(g, poly(25, 26 + b, 39, 26 + b, 38, 41 + b, 32, 43 + b, 26, 41 + b), '#2f4f9a', { line: 1 }); sparkle(g, 32, 33 + b, 2.6, '#ffd24a'); }, held: (g, x, y) => HELD.sword(g, x, y) },
  shop: { kind: biped, body: '#4f8a6a', legs: '#5a4636', boots: '#3a2a1e', sleeve: '#4f8a6a', hat: HATS.wide(), back: (g, b) => { part(g, rr(13, 22 + b, 13, 19, 3), '#8a5a2c'); g.fillStyle = '#5a3a1e'; g.fillRect(13, 29 + b, 13, 1.6); part(g, ell(19.5, 21 + b, 6, 3), '#b8b0a0', { line: 1 }); }, torso: (g, b) => { part(g, rr(25, 30 + b, 15, 13, 3), '#e8dcc0', { line: 1 }); part(g, ell(32.5, 36 + b, 2.2, 2.2), '#ffd24a', { line: 0.7 }); }, head: (g, b) => { part(g, ell(32.5, 16 + b, 10.5, 10), '#e8bf96'); limb(g, [35, 21 + b, 39, 22 + b, 43, 21 + b], 1.6, '#6b4a2b'); } },
};

const CLASS_ART = {
  warrior: { kind: biped, body: '#9aa4b0', legs: '#5a4a3e', boots: '#3a2e26', sleeve: '#8a94a0', gloves: '#6a6460', hat: HATS.helm(), torso: (g, b) => { part(g, poly(26, 25 + b, 38, 25 + b, 37.5, 42 + b, 32, 45 + b, 26.5, 42 + b), '#c0463c', { line: 1.1 }); g.fillStyle = '#ffd24a'; g.fillRect(26.5, 33 + b, 11, 1.4); }, back: (g, b) => HELD.shield(g, 20, 33 + b) },
  ranger: { kind: biped, body: '#7a5236', legs: '#4a3a2a', boots: '#3a2a1e', sleeve: '#3f7a3c', gloves: '#5a3a24', cape: '#2f5a2c', hat: HATS.hood('#3f7a3c'), iris: '#2a5a2a', torso: (g, b) => { limb(g, [24, 26 + b, 40, 41 + b], 1.4, '#4a2f1d'); g.fillStyle = '#2b1f17'; g.fillRect(21.5, 37 + b, 21.5, 2.2); }, back: (g, b) => { part(g, rr(16, 22 + b, 6, 16, 2), '#6b4a2b', { line: 1 }); for (const x of [17, 19.5]) { limb(g, [x, 22 + b, x - 1, 16 + b], 0.8, '#d9cfb0'); g.fillStyle = '#d14b3d'; g.fillRect(x - 2, 15 + b, 2, 2.4); } } },
  mage: { kind: biped, body: '#3f5fb8', robe: '#3456a8', trim: '#ffd24a', sleeve: '#4a6cc8', hat: HATS.wizard(), iris: '#3a2a6a', torso: (g, b) => { g.fillStyle = '#ffd24a'; g.fillRect(31.2, 26 + b, 2, 16); part(g, ell(32.2, 36 + b, 2.6, 2.6), '#7fd0ff', { line: 0.8 }); } },
};

// ---- texture builders --------------------------------------------------------------------------
function sheet(scene, key, def) {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, FRAME * FRAMES.length, FRAME), g = tex.getContext();
  FRAMES.forEach((p, i) => {
    g.save(); g.translate(i * FRAME, 0); g.scale(RES, RES);
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    def.kind(g, def, p);
    g.restore();
    tex.add(i, 0, i * FRAME, 0, FRAME, FRAME);
  });
  tex.refresh();
  return key;
}
function single(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w * RES, h * RES), g = tex.getContext();
  g.scale(RES, RES); draw(g); tex.refresh();
  return key;
}

const fallback = (shape, color) => ({ kind: { slime: blob, beast: quad, humanoid: biped, bug, wisp: floater, golem }[shape] || blob, body: hex(color), legs: shade(hex(color), 0.7), draw: (g) => flameBody(g, hex(color)) });
export const mobTexture = (scene, id, shape, color) => sheet(scene, `mob_${id}`, ART[id] || fallback(shape, color));
export const npcTexture = (scene, role) => sheet(scene, `npc_${role}`, NPC_ART[role] || NPC_ART.quests);
export const playerTexture = (scene, cls) => sheet(scene, `player_${cls}`, CLASS_ART[cls]);

const WEAPONS = {
  warrior(g) { part(g, poly(9, 6.6, 27, 6.6, 31, 8, 27, 9.4, 9, 9.4), '#dfe5ec', { line: 1 }); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(11, 7.2, 14, 0.8); part(g, rr(6.5, 3, 2.8, 10, 1), '#c9a23a', { line: 0.8 }); limb(g, [1.5, 8, 6.5, 8], 2.2, '#6b4a2b', 'butt'); part(g, ell(1.5, 8, 1.6, 1.6), '#c9a23a', { line: 0.6 }); },
  ranger(g) { HELD.bow(g, 9, 8); limb(g, [3, 8, 22, 8], 0.9, '#d9cfb0'); part(g, poly(22, 6.4, 26, 8, 22, 9.6), '#aeb6bf', { line: 0.6 }); },
  mage(g) { limb(g, [1, 8, 21, 8], 2, '#6b4a2b'); glow(g, 25, 8, 7, '#7fd0ff', 0.9); part(g, ell(25, 8, 3.6, 3.6), '#9fe0ff', { line: 1 }); sparkle(g, 25, 8, 2, '#ffffff'); },
};
export const weaponTexture = (scene, cls) => single(scene, `weapon_${cls}`, 32, 16, WEAPONS[cls]);

export const portalTexture = (scene, exit) => single(scene, `portal_${exit ? 1 : 0}`, S, S, (g) => {
  const c = exit ? '#58e08a' : '#b46bff';
  groundShadow(g, 22, 57);
  glow(g, 32, 32, 30, c, 0.55);
  const arch = (gg) => { gg.beginPath(); gg.moveTo(9, 58); gg.lineTo(9, 26); gg.arc(32, 26, 23, Math.PI, 0); gg.lineTo(55, 58); gg.lineTo(46, 58); gg.lineTo(46, 27); gg.arc(32, 27, 14, 0, Math.PI, true); gg.lineTo(18, 58); gg.closePath(); };
  g.save(); g.beginPath(); g.moveTo(18, 58); g.lineTo(18, 27); g.arc(32, 27, 14, Math.PI, 0); g.lineTo(46, 58); g.closePath(); g.clip();
  const grad = g.createRadialGradient(32, 36, 2, 32, 36, 24); grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, c); grad.addColorStop(1, shade(c, 0.3));
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  g.strokeStyle = rgba('#ffffff', 0.5); g.lineWidth = 1.2; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(32, 38, 4 + i * 5, i, i + 3.6); g.stroke(); }
  g.restore();
  part(g, arch, '#77737f');
  g.strokeStyle = shade('#77737f', 0.5); g.lineWidth = 1; for (const a of [-2.6, -2, -1.4, -0.9, -0.4]) { g.beginPath(); g.moveTo(32 + Math.cos(a) * 14, 27 + Math.sin(a) * 14); g.lineTo(32 + Math.cos(a) * 23, 26 + Math.sin(a) * 23); g.stroke(); }
  for (const y of [36, 46]) { g.beginPath(); g.moveTo(9, y); g.lineTo(18, y); g.moveTo(46, y); g.lineTo(55, y); g.stroke(); }
  g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 4; for (const [x, y] of [[13.5, 31], [50.5, 31], [32, 7.5]]) sparkle(g, x, y, 2.2, c); g.shadowBlur = 0;
});
export const dotTexture = (scene) => single(scene, 'dot', 8, 8, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(4, 4, 4, 0, 7); g.fill(); });

// ---- tiles ---------------------------------------------------------------------------------------
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

function drawTile(g, id, v) { // 32x32 design space
  const rnd = (i) => hash2(id * 31 + v, i, 99);
  const base = GROUND[id];
  if (base) {
    g.fillStyle = base; g.fillRect(0, 0, 32, 32);
    if (WALLS.has(id)) {
      if (v === 3) { // wall face with a floor tile below it: brick front with a lit top edge
        g.fillStyle = shade(base, 1.55); g.fillRect(0, 10, 32, 22);
        for (let r = 0; r < 3; r++) for (let c = -1; c < 3; c++) {
          const x = c * 16 + (r % 2) * 8 + 1, y = 11 + r * 7;
          g.fillStyle = shade(base, 1.25 + rnd(r * 4 + c + 9) * 0.15); g.fillRect(x, y, 14, 6);
          g.fillStyle = shade(base, 1.6); g.fillRect(x, y, 14, 1);
        }
        g.fillStyle = shade(base, 1.9); g.fillRect(0, 9, 32, 1.5);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 29, 32, 3);
      } else {
        g.fillStyle = shade(base, 1.2);
        for (let i = 0; i < 4; i++) g.fillRect(rnd(i) * 26, rnd(i + 9) * 26, 4 + rnd(i + 3) * 3, 2);
      }
      return;
    }
    if (id === T.WATER) {
      g.fillStyle = shade(base, 0.85); g.fillRect(0, 0, 32, 32);
      g.strokeStyle = shade(base, 1.35); g.lineWidth = 1;
      for (let i = 0; i < 3; i++) { const x = rnd(i) * 20, y = 5 + rnd(i + 10) * 22; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 4, y - 2, x + 8, y); g.quadraticCurveTo(x + 12, y + 2, x + 15, y); g.stroke(); }
      return;
    }
    if (id === T.TOWN) {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
        const x = c * 11 + (r % 2) * 5.5 - 3, y = r * 8;
        g.fillStyle = shade(base, 0.92 + rnd(r * 3 + c) * 0.16); g.beginPath(); g.roundRect(x + 0.6, y + 0.6, 10, 6.8, 2); g.fill();
        g.fillStyle = shade(base, 1.18); g.fillRect(x + 1.5, y + 1, 7, 1);
      }
      return;
    }
    const dungeon = [T.CRYPT_F, T.MINE_F, T.ICE_F].includes(id);
    if (dungeon) {
      g.strokeStyle = shade(base, 0.82); g.lineWidth = 1; g.strokeRect(0.5, 0.5, 31, 31);
      g.fillStyle = shade(base, 1.1); g.fillRect(1, 1, 30, 1);
    }
    for (let i = 0; i < 8; i++) {
      const x = rnd(i) * 30, y = rnd(i + 10) * 30, light = rnd(i + 20) > 0.5;
      if ((id === T.GRASS || id === T.WOOD) && i < 6) { // grass tufts
        g.strokeStyle = shade(base, light ? 1.25 : 0.78); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x - 1, y); g.moveTo(x + 1.5, y + 3); g.lineTo(x + 2, y - 0.5); g.moveTo(x + 3, y + 3); g.lineTo(x + 4.5, y + 0.5); g.stroke();
      } else {
        g.fillStyle = shade(base, light ? 1.12 : 0.86);
        const w = 1.5 + rnd(i + 40) * 2.5; g.fillRect(x, y, w, w * 0.8);
      }
    }
    if (id === T.GRASS && v === 2) for (const [x, y, c] of [[8, 9, '#f4e36a'], [22, 20, '#f2f2f2']]) { g.fillStyle = c; g.fillRect(x, y, 2, 2); }
    return;
  }
  // Object tiles: transparent, on a layer above the ground, may overhang upward a little.
  g.fillStyle = 'rgba(10,8,20,0.3)'; g.beginPath(); g.ellipse(16, 28, 12, 3.6, 0, 0, Math.PI * 2); g.fill();
  if (id === T.TREE) {
    part(g, rr(13.5, 17, 5, 12, 1.5), '#6b4a2b', { line: 1 });
    for (const [x, y, r, c] of [[16, 15, 11, '#2f6a2a'], [10 + v * 0.5, 11, 7.5, '#3a7d32'], [21, 9 + v * 0.5, 7, '#469138'], [15, 6, 6, '#52a040']]) part(g, ell(x, y, r, r * 0.92), c, { line: 1.1 });
    g.fillStyle = 'rgba(255,255,230,0.35)'; for (const [x, y] of [[12, 7], [17, 4], [20, 8]]) g.fillRect(x, y, 2, 1.4);
    if (v === 1) for (const [x, y] of [[9, 14], [22, 15]]) part(g, ell(x, y, 1.4, 1.4), '#d14b3d', { line: 0.6 });
  } else if (id === T.PINE) {
    part(g, rr(14, 22, 4, 7, 1), '#5a3d24', { line: 0.9 });
    for (let i = 0; i < 3; i++) {
      const y = 2 + i * 6, w = 7 + i * 3.5;
      part(g, poly(16, y, 16 + w, y + 10, 16 - w, y + 10), '#2e6a52', { line: 1 });
      part(g, poly(16, y, 16 + w * 0.5, y + 5, 16 + w * 0.15, y + 4, 16 - w * 0.2, y + 5.5, 16 - w * 0.5, y + 5), '#f2f8fb', { line: 0, hi: 0, sh: 0.8 });
    }
  } else if (id === T.DEADTREE) {
    limb(g, [16, 29, 16, 9], 3, '#4a3b33');
    limb(g, [16, 18, 9, 11 + v, 6, 12 + v], 1.6, '#4a3b33');
    limb(g, [16, 14, 23, 7 + v, 26, 8 + v], 1.6, '#4a3b33');
    limb(g, [16, 10, 13, 3], 1.2, '#4a3b33');
    if (v === 2) { g.fillStyle = '#ff7a2a'; g.fillRect(17, 22, 1.5, 1.5); }
  } else { // rock
    part(g, poly(4, 27, 6, 16 + v, 13, 9, 22, 10, 28, 17, 28, 27), '#85848c', { line: 1.1 });
    part(g, poly(13, 9, 22, 10, 20, 16, 12, 17), '#a8a7af', { line: 0.8 });
    g.strokeStyle = '#5a5960'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(18, 18); g.lineTo(21, 23); g.lineTo(19, 26); g.stroke();
    if (v === 3) part(g, ell(7, 25, 3, 1.6), '#5a9a44', { line: 0.6 });
  }
}

/** Tileset at 2x with a 1px extruded border around every tile so zoomed rendering never bleeds. */
export function makeTileset(scene) {
  const cell = TEX_TS + 2, tex = scene.textures.createCanvas('tiles', VARIANTS * cell, TILE_COUNT * cell);
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = TEX_TS;
  const tg = tmp.getContext('2d'), g = tex.getContext();
  for (let id = 0; id < TILE_COUNT; id++) for (let v = 0; v < VARIANTS; v++) {
    tg.clearRect(0, 0, TEX_TS, TEX_TS);
    tg.save(); tg.scale(TEX_TS / 32, TEX_TS / 32); drawTile(tg, id, v); tg.restore();
    const x = v * cell, y = id * cell;
    if (!OBJECT_TILES.has(id)) g.drawImage(tmp, x, y, cell, cell);
    g.drawImage(tmp, x + 1, y + 1);
  }
  tex.refresh();
}

// Exposed for the sprite preview page.
export const CATALOG = { enemies: Object.keys(ART), npcs: Object.keys(NPC_ART), classes: Object.keys(CLASS_ART) };

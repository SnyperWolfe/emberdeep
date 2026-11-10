// The world view: tilemap, interpolated entities, predicted local movement, combat feedback.
import Phaser from '/vendor/phaser.js';
import { CLASSES } from '/shared/content.js';
import { moveWithCollision } from '/shared/collide.js';
import { hash2 } from '/shared/rng.js';
import { state, bus, send } from './net.js';
import { sfx } from './sfx.js';
import * as art from './art.js';

const TS = art.TS, INTERP_MS = 110;
const VIEW_W = 34 * TS, VIEW_H = 19 * TS; // the most world a client may see (server interest area)
const lerp = (a, b, t) => a + (b - a) * t;
const FONT = { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 3, resolution: 2 };

// Own key tracking: never steals keystrokes from the chat box, and clears on blur so keys
// cannot get stuck down.
const keys = new Set();
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
window.addEventListener('keydown', (e) => { if (!typing()) { keys.add(e.code); bus.emit('key', e); } });
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

export default class WorldScene extends Phaser.Scene {
  constructor() { super('world'); }

  init() {
    this.ents = new Map();
    this.layers = [];
    this.me = null;
    this.pos = { x: 0, y: 0 };
    this.lastDir = '0,0';
    this.trauma = 0;
    this.shakeT = 0;
    this.nextAttack = 0;
    this.aim = 0;
    this.cam = { x: 0, y: 0 };
  }

  create() {
    art.makeTileset(this);
    art.dotTexture(this);
    this.input.mouse?.disableContextMenu();
    this.scale.on('resize', () => this.fitCamera());
    this.fitCamera();
    bus.on('map', () => this.buildMap());
    bus.on('s', (m) => this.onSnapshot(m));
    bus.on('respawn', (m) => { this.pos.x = m.x; this.pos.y = m.y; });
    bus.on('key', (e) => this.onKey(e));
    if (state.map) this.buildMap();
    if (new URLSearchParams(location.search).has("debug")) window.__scene = this;
  }

  fitCamera() {
    const { width, height } = this.scale;
    this.cameras.main.setZoom(Math.max(width / VIEW_W, height / VIEW_H));
  }

  // ---- map -------------------------------------------------------------------------------
  buildMap() {
    const m = state.map;
    for (const l of this.layers) l.destroy();
    for (const e of this.ents.values()) e.c.destroy();
    this.ents.clear();
    const ground = [], objects = [];
    const at = (x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? -1 : m.tiles[y * m.w + x]);
    for (let y = 0; y < m.h; y++) {
      const g = [], o = [];
      for (let x = 0; x < m.w; x++) {
        const id = at(x, y);
        let v = Math.floor(hash2(x, y, 5) * art.VARIANTS), gid = id;
        if (art.OBJECT_TILES.has(id)) {
          // Objects sit on whatever ground surrounds them.
          gid = art.OBJECT_GROUND[id];
          search: for (let r = 1; r <= 4; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
            const n = at(x + dx, y + dy);
            if (n >= 0 && n <= 3) { gid = n; break search; }
          }
          o.push(id * art.VARIANTS + v);
        } else o.push(-1);
        if (art.isWall(id)) { const below = at(x, y + 1); v = below >= 0 && !art.isWall(below) ? 3 : v % 3; }
        g.push(gid * art.VARIANTS + v);
      }
      ground.push(g); objects.push(o);
    }
    this.layers = [ground, objects].map((data, i) => {
      const map = this.make.tilemap({ data, tileWidth: TS, tileHeight: TS });
      const layer = map.createLayer(0, map.addTilesetImage('tiles', 'tiles', TS, TS, 1, 2), 0, 0);
      layer.setDepth(i);
      return layer;
    });
    this.pos.x = m.x; this.pos.y = m.y;
    this.cam.x = m.x * TS; this.cam.y = m.y * TS;
    if (!this.me || !this.me.c.active) this.me = this.makeEntity({ id: state.you.id, k: 'p', n: state.you.name, c: state.you.cls, l: state.you.level, hp: 1, mh: 1, x: m.x, y: m.y }, true);
    else this.ents.set(this.me.v.id, this.me);
    this.cameras.main.fadeIn(350, 0, 0, 0);
  }

  // ---- entities --------------------------------------------------------------------------
  makeEntity(v, self = false) {
    const c = this.add.container(v.x * TS, v.y * TS), e = { v, c, self, fromX: v.x, fromY: v.y, x: v.x, y: v.y, t0: 0, hp: -1 };
    if (v.k === 'j') {
      c.add(this.add.image(0, 0, 'dot').setTint(v.c || 0xffffff).setScale(1.6, 0.9).setRotation(v.a));
      c.add(this.add.image(0, 0, 'dot').setScale(0.7, 0.45).setRotation(v.a));
    } else if (v.k === 'o') {
      e.img = this.add.image(0, -8, art.portalTexture(this, v.ex));
      this.tweens.add({ targets: e.img, scaleX: 0.85, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      c.add([e.img, this.add.text(0, -52, v.lv ? `${v.n}\nLevel ${v.lv}+` : v.n, { ...FONT, align: 'center', color: v.ex ? '#9dffb8' : '#e0c4ff' }).setOrigin(0.5)]);
    } else {
      const z = v.z || 1;
      const key = v.k === 'p' ? art.playerTexture(this, v.c, CLASSES[v.c].color) : v.k === 'n' ? art.npcTexture(this, v.c) : art.mobTexture(this, v.s, v.c);
      e.img = this.add.image(0, 0, key).setOrigin(0.5, 0.85).setScale(0.75 * z);
      c.add(e.img);
      if (v.k === 'p') { e.weapon = this.add.image(0, -10, art.weaponTexture(this, v.c)).setOrigin(-0.35, 0.5); c.add(e.weapon); }
      const top = -46 * z - 4;
      const color = v.k === 'n' ? '#ffe9a0' : v.k === 'p' ? (self ? '#ffffff' : '#9fd0ff') : v.b ? '#ff9a2e' : v.el ? '#ffd27a' : '#f0f0f0';
      e.label = this.add.text(0, top - 9, v.k === 'm' ? `${v.n} · Lv ${v.l}` : v.n, { ...FONT, color, fontSize: v.b ? '14px' : '12px' }).setOrigin(0.5);
      c.add(e.label);
      if (v.k === 'n') c.add(this.add.text(0, top - 26, v.r === 'quests' ? '!' : '$', { ...FONT, fontSize: '18px', color: '#ffd24a' }).setOrigin(0.5));
      if (v.k !== 'n') { e.bar = this.add.graphics(); e.barY = top; e.barW = v.b ? 60 : 30; c.add(e.bar); }
    }
    this.ents.set(v.id, e);
    return e;
  }

  drawBar(e, hp, mh) {
    if (!e.bar || (e.hp === hp && e.mh === mh)) return;
    e.hp = hp; e.mh = mh;
    const w = e.barW, f = Math.max(0, Math.min(1, hp / mh));
    e.bar.clear();
    e.bar.fillStyle(0x000000, 0.7).fillRect(-w / 2 - 1, e.barY - 1, w + 2, 6);
    e.bar.fillStyle(e.v.k === 'p' ? 0x4fd06a : 0xd9453a, 1).fillRect(-w / 2, e.barY, w * f, 4);
  }

  onSnapshot(s) {
    if (!this.me) return;
    const now = performance.now(), seen = new Set([this.me.v.id]);
    for (const v of s.e) {
      seen.add(v.id);
      let e = this.ents.get(v.id);
      if (!e) e = this.makeEntity(v);
      e.fromX = e.x; e.fromY = e.y; e.t0 = now;
      if (v.k === 'p' && e.v.l !== v.l) e.label.setText(v.n);
      e.v = v;
      if (v.hp !== undefined) this.drawBar(e, v.hp, v.mh);
      if (v.k === 'p') { e.img.setAlpha(v.d ? 0.35 : 1); e.weapon.setVisible(!v.d).setRotation(v.f); }
      if (v.k === 'm') e.img.setAlpha(v.cast ? 0.75 : 1);
    }
    for (const [id, e] of this.ents) if (!seen.has(id)) { e.c.destroy(); this.ents.delete(id); }
    // Reconcile prediction with the authoritative position: nudge small errors, snap big ones.
    const ex = s.x - this.pos.x, ey = s.y - this.pos.y, err = Math.hypot(ex, ey);
    if (err > 2.5 || s.d) { this.pos.x = s.x; this.pos.y = s.y; } else if (err > 0.02) { this.pos.x += ex * 0.15; this.pos.y += ey * 0.15; }
    this.drawBar(this.me, s.hp, state.you.stats.maxHp);
    this.me.img.setAlpha(s.d ? 0.35 : 1);
    this.me.weapon.setVisible(!s.d);
    for (const ev of s.ev) this.onEvent(ev);
  }

  // ---- input -----------------------------------------------------------------------------
  onKey(e) {
    if (e.repeat || !this.me) return;
    if (e.code === 'Digit1' || e.code === 'Digit2') this.cast(e.code === 'Digit1' ? 0 : 1);
    else if (e.code === 'KeyQ') send({ t: 'potion', k: 'hp' });
    else if (e.code === 'KeyR') send({ t: 'potion', k: 'mp' });
    else if (e.code === 'KeyE') send({ t: 'interact' });
  }

  cast(i) {
    const ab = CLASSES[state.you.cls].skills[i], cd = state.cds['s' + i];
    if (cd && cd.until > performance.now()) return;
    send({ t: 'skill', i, a: this.aim });
    if (state.you.level >= ab.lvl) (ab.type === 'proj' ? sfx.shoot : ab.type === 'heal' ? sfx.heal : sfx.nova)();
  }

  update(time, delta) {
    if (!this.me || !state.map || !state.snap) return;
    const dt = Math.min(delta, 100) / 1000, now = performance.now(), dead = state.snap.d;
    // Movement intent: sent only when it changes; simulated locally with the server's rules.
    let dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let dy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    if (dead) dx = dy = 0;
    if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
    const dir = `${dx},${dy}`;
    if (dir !== this.lastDir) { this.lastDir = dir; send({ t: 'move', dx, dy }); }
    const speed = state.you.stats.speed;
    if (dx || dy) moveWithCollision(state.map, this.pos, dx * speed * dt, dy * speed * dt);

    const ptr = this.input.activePointer, wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    this.aim = Math.atan2(wp.y - this.pos.y * TS + 10, wp.x - this.pos.x * TS);
    const atk = CLASSES[state.you.cls].attack;
    if (!dead && (ptr.isDown || keys.has('Space')) && now >= this.nextAttack) {
      this.nextAttack = now + atk.cd * 1000 + 20;
      send({ t: 'attack', a: this.aim });
      (atk.type === 'melee' ? sfx.swing : sfx.shoot)();
    }

    for (const e of this.ents.values()) {
      if (e.self) { e.x = this.pos.x; e.y = this.pos.y; e.weapon.setRotation(this.aim); e.img.setFlipX(Math.abs(this.aim) > Math.PI / 2); }
      else if (e.v.k === 'j') { const t = (now - e.t0) / 1000; e.x = e.v.x + e.v.vx * t; e.y = e.v.y + e.v.vy * t; }
      else {
        const a = Math.min(1, (now - e.t0) / INTERP_MS);
        const nx = lerp(e.fromX, e.v.x, a);
        if (e.img && e.v.k !== 'o' && Math.abs(nx - e.x) > 0.002) e.img.setFlipX(nx < e.x);
        e.x = nx; e.y = lerp(e.fromY, e.v.y, a);
      }
      e.c.setPosition(e.x * TS, e.y * TS);
      e.c.setDepth(e.v.k === 'j' ? 90000 : 10 + e.y);
    }

    // Camera: smooth follow, clamped to the map, plus decaying "trauma" shake (visual only).
    const cam = this.cameras.main, k = 1 - Math.exp(-dt * 10);
    this.cam.x = lerp(this.cam.x, this.pos.x * TS, k); this.cam.y = lerp(this.cam.y, this.pos.y * TS, k);
    const hw = cam.width / cam.zoom / 2, hh = cam.height / cam.zoom / 2, mw = state.map.w * TS, mh = state.map.h * TS;
    let cx = mw < hw * 2 ? mw / 2 : Math.max(hw, Math.min(mw - hw, this.cam.x));
    let cy = mh < hh * 2 ? mh / 2 : Math.max(hh, Math.min(mh - hh, this.cam.y));
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
      this.shakeT += dt * 32;
      const sh = this.trauma * this.trauma;
      cx += 14 * sh * Math.sin(this.shakeT * 1.7); cy += 10 * sh * Math.sin(this.shakeT * 2.3);
    }
    cam.centerOn(cx, cy);
  }

  // ---- feedback, layered by importance (small / medium / large) ----------------------------
  floatText(x, y, text, color, size = 14) {
    const t = this.add.text(x * TS + (Math.random() - 0.5) * 16, y * TS - 34, text, { ...FONT, color, fontSize: `${size}px` }).setOrigin(0.5).setDepth(95000).setScale(0.5);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: t.y - 34, alpha: 0, duration: 800, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
  }

  ring(x, y, r, color, duration = 350, fillAlpha = 0.25) {
    const g = this.add.graphics({ x: x * TS, y: y * TS }).setDepth(5);
    g.fillStyle(color, fillAlpha).fillCircle(0, 0, r * TS).lineStyle(3, color, 0.9).strokeCircle(0, 0, r * TS);
    g.setScale(0.2);
    this.tweens.add({ targets: g, scale: 1, alpha: 0, duration, ease: 'Cubic.easeOut', onComplete: () => g.destroy() });
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 30;
      const p = this.add.image(x * TS, y * TS - 12, 'dot').setTint(color).setDepth(94000).setScale(0.5 + Math.random() * 0.6);
      this.tweens.add({ targets: p, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, alpha: 0, scale: 0.1, duration: 350 + Math.random() * 250, ease: 'Cubic.easeOut', onComplete: () => p.destroy() });
    }
  }

  pop(e, sx = 1.25, sy = 0.8) {
    if (!e?.img || e.popping) return;
    const bx = e.img.scaleX, by = e.img.scaleY;
    e.popping = true;
    e.img.setScale(bx * sx, by * sy);
    this.tweens.add({ targets: e.img, scaleX: bx, scaleY: by, duration: 180, ease: 'Back.easeOut', onComplete: () => { e.popping = false; } });
  }

  onEvent(ev) {
    const mine = ev.id === this.me.v.id, e = this.ents.get(ev.id);
    switch (ev.t) {
      case 'dmg':
        if (ev.pl) {
          this.floatText(ev.x, ev.y, `-${ev.v}`, mine ? '#ff6b5e' : '#ffb0a8');
          if (mine) { this.trauma = Math.min(1, this.trauma + 0.3); sfx.hurt(); bus.emit('hurt'); }
        } else {
          this.floatText(ev.x, ev.y, ev.crit ? `${ev.v}!` : `${ev.v}`, ev.crit ? '#ffd24a' : '#ffffff', ev.crit ? 19 : 14);
          this.burst(ev.x, ev.y, 0xffffff, ev.crit ? 6 : 3);
          (ev.crit ? sfx.crit : sfx.hit)();
          if (ev.crit) this.trauma = Math.min(1, this.trauma + 0.12);
        }
        this.pop(e);
        break;
      case 'swing': {
        const g = this.add.graphics({ x: ev.x * TS, y: ev.y * TS - 10 }).setDepth(93000);
        g.fillStyle(0xffffff, 0.35).slice(0, 0, ev.r * TS, ev.a - ev.arc / 2, ev.a + ev.arc / 2).fillPath();
        this.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
        break;
      }
      case 'matk': this.pop(e, 1.2, 1.2); break;
      case 'nova': this.ring(ev.x, ev.y, ev.r, ev.c); sfx.nova(); break;
      case 'tele': { // boss slam warning: a circle that fills until the hit lands
        sfx.warn();
        const g = this.add.graphics({ x: ev.x * TS, y: ev.y * TS }).setDepth(4);
        g.lineStyle(3, 0xff3b2e, 1).strokeCircle(0, 0, ev.r * TS);
        const fill = this.add.graphics({ x: ev.x * TS, y: ev.y * TS }).setDepth(4).setScale(0.05);
        fill.fillStyle(0xff3b2e, 0.35).fillCircle(0, 0, ev.r * TS);
        this.tweens.add({ targets: fill, scale: 1, duration: ev.d * 1000, onComplete: () => { g.destroy(); fill.destroy(); } });
        break;
      }
      case 'slam': this.ring(ev.x, ev.y, ev.r, 0xff6a2e, 450, 0.5); this.trauma = Math.min(1, this.trauma + 0.7); sfx.slam(); break;
      case 'die':
        if (ev.pl) { if (mine) sfx.death(); break; }
        this.burst(ev.x, ev.y, ev.c, ev.boss ? 40 : 12);
        sfx.kill();
        if (ev.boss) { this.trauma = 1; this.ring(ev.x, ev.y, 5, 0xffd24a, 900, 0.4); }
        break;
      case 'heal': this.floatText(ev.x, ev.y, `+${ev.v}`, '#6dff8f'); if (mine) sfx.heal(); break;
      case 'levelup':
        this.ring(ev.x, ev.y, 3, 0xffd24a, 800, 0.35);
        this.burst(ev.x, ev.y, 0xffd24a, 24);
        this.floatText(ev.x, ev.y - 0.6, `LEVEL ${ev.l}`, '#ffd24a', 22);
        if (mine) sfx.level();
        break;
      case 'shout': this.floatText(ev.x, ev.y - 1.2, ev.text, '#ff9a2e', 16); break;
      default:
    }
  }
}

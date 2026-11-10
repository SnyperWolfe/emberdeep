// The 3D world view: terrain, animated characters, predicted local movement, camera, effects,
// and a 2D overlay for names, health bars and damage numbers.
import * as THREE from 'three';
import { CLASSES } from '/shared/content.js';
import { moveWithCollision } from '/shared/collide.js';
import { state, bus, send } from './net.js';
import { sfx } from './sfx.js';
import { makeActor, CLASS_MODELS, NPC_MODELS, MOB_MODELS } from './models.js';
import { buildMap, makePortal, DUNGEON_THEME } from './terrain.js';
import { Effects } from './fx.js';

const INTERP_MS = 110;
const lerp = (a, b, t) => a + (b - a) * t;
const angleLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

// Own key tracking: never steals keystrokes from the chat box, and clears on blur so keys
// cannot get stuck down.
const keys = new Set();
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
window.addEventListener('keydown', (e) => { if (!typing()) { keys.add(e.code); bus.emit('key', e); } });
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

export class World {
  constructor(parent) {
    this.parent = parent;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    parent.append(this.renderer.domElement);
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'overlay';
    parent.append(this.overlay);
    this.ctx = this.overlay.getContext('2d');

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    this.hemi = new THREE.HemisphereLight(0xd8e8ff, 0x5a4a3a, 1.2);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0005;
    this.torch = new THREE.PointLight(0xffd0a0, 0, 14, 1.3); // the light a player carries in dungeons
    this.scene.add(this.hemi, this.sun, this.sun.target, this.torch);
    this.fx = new Effects(this.scene);

    this.ents = new Map();
    this.corpses = [];
    this.floaters = [];
    this.pos = { x: 0, y: 0 };
    this.lastDir = '0,0';
    this.trauma = 0;
    this.nextAttack = 0;
    this.aim = 0;
    this.lastAttackAt = 0;
    this.facing = 0;
    this.zoom = 1;
    this.camPos = new THREE.Vector3();
    this.pointer = { x: 0, y: 0, down: false };
    this.ray = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.clock = new THREE.Clock();
    this.time = 0;

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; });
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) this.pointer.down = true; this.pointer.x = e.clientX; this.pointer.y = e.clientY; document.activeElement?.blur(); });
    window.addEventListener('pointerup', () => { this.pointer.down = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { this.zoom = Math.min(1.25, Math.max(0.7, this.zoom * (e.deltaY > 0 ? 1.08 : 0.93))); e.preventDefault(); }, { passive: false });
    window.addEventListener('resize', () => this.resize());
    this.resize();

    bus.on('map', () => this.loadMap());
    bus.on('s', (m) => this.onSnapshot(m));
    bus.on('respawn', (m) => { this.pos.x = m.x; this.pos.y = m.y; this.me?.actor.revive(); });
    bus.on('key', (e) => this.onKey(e));
    if (state.map) this.loadMap();
    if (new URLSearchParams(location.search).has('debug')) window.__world = this; // test hook
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.parent.clientWidth || window.innerWidth, h = this.parent.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = Math.min(2, window.devicePixelRatio);
    this.overlay.width = w * dpr; this.overlay.height = h * dpr;
    this.overlay.style.width = `${w}px`; this.overlay.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view = { w, h };
  }

  // ---- map -------------------------------------------------------------------------------
  loadMap() {
    const m = state.map;
    if (this.terrain) { this.scene.remove(this.terrain.group); this.terrain.dispose(); }
    for (const e of this.ents.values()) this.removeEnt(e);
    for (const c of this.corpses) this.removeEnt(c);
    this.ents.clear(); this.corpses.length = 0; this.floaters.length = 0;
    this.fx.clear();
    this.terrain = buildMap(m);
    this.scene.add(this.terrain.group);
    const dungeon = m.kind === 'dungeon', theme = dungeon ? DUNGEON_THEME[m.dungeon] : null;
    const bg = dungeon ? theme.fog : 0xa9d0ea;
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = dungeon ? new THREE.Fog(bg, 9, 24) : new THREE.Fog(bg, 24, 46);
    this.hemi.intensity = dungeon ? 1.1 : 1.2;
    this.sun.intensity = dungeon ? 0.9 : 2.4;
    this.torch.intensity = dungeon ? 40 : 0;
    if (dungeon) this.torch.color.setHex(theme.light);
    this.pos.x = m.x; this.pos.y = m.y;
    this.me = this.makeEnt({ id: state.you.id, k: 'p', n: state.you.name, c: state.you.cls, l: state.you.level, hp: 1, mh: 1, x: m.x, y: m.y }, true);
    this.camPos.set(m.x, 0, m.y);
    this.parent.classList.remove('fade'); void this.parent.offsetWidth; this.parent.classList.add('fade');
  }

  // ---- entities --------------------------------------------------------------------------
  makeEnt(v, self = false) {
    const e = { v, self, fromX: v.x, fromY: v.y, x: v.x, y: v.y, t0: 0, movingUntil: 0, face: Math.PI / 2, hp: v.hp, mh: v.mh };
    if (v.k === 'p' || v.k === 'n' || v.k === 'm') {
      const def = v.k === 'p' ? CLASS_MODELS[v.c] : v.k === 'n' ? NPC_MODELS[v.r] : MOB_MODELS[v.t];
      e.actor = makeActor(def || MOB_MODELS.slime);
      e.obj = e.actor.root;
      e.height = e.actor.height;
      if (v.b) { // boss: a pulsing ring of light under it
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
        e.obj.add(ring); e.ring = ring;
      }
      if (v.k === 'p' && v.d) e.actor.die();
    } else if (v.k === 'o') {
      e.obj = makePortal(v.ex);
      e.height = 2.4;
    } else { // projectile
      const color = v.c || 0xffffff;
      e.obj = new THREE.Group();
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      const trail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      trail.rotation.z = Math.PI / 2; trail.position.x = -0.42;
      const dir = new THREE.Group(); dir.add(core, glow, trail); dir.rotation.y = -v.a;
      e.obj.add(dir);
      e.obj.position.y = 0.9;
    }
    e.obj.position.x = v.x; e.obj.position.z = v.y;
    this.scene.add(e.obj);
    this.ents.set(v.id, e);
    return e;
  }

  removeEnt(e) {
    this.scene.remove(e.obj);
    e.actor?.dispose();
    e.obj.traverse((o) => { if (o.isMesh && !e.actor) { o.geometry.dispose(); o.material.dispose?.(); } });
  }

  onSnapshot(s) {
    if (!this.me) return;
    const now = performance.now(), seen = new Set([this.me.v.id]);
    for (const v of s.e) {
      seen.add(v.id);
      let e = this.ents.get(v.id);
      if (!e) e = this.makeEnt(v);
      e.fromX = e.x; e.fromY = e.y; e.t0 = now;
      e.v = v;
      e.hp = v.hp; e.mh = v.mh;
      if (v.k === 'p' && e.actor) { if (v.d) e.actor.die(); else e.actor.revive(); }
    }
    for (const ev of s.ev) this.onEvent(ev); // before removals, so deaths can animate
    for (const [id, e] of this.ents) {
      if (seen.has(id)) continue;
      this.ents.delete(id);
      if (e.dying) { e.deadAt = now; this.corpses.push(e); } else this.removeEnt(e);
    }
    // Reconcile prediction with the authoritative position: nudge small errors, snap big ones.
    const ex = s.x - this.pos.x, ey = s.y - this.pos.y, err = Math.hypot(ex, ey);
    if (err > 2.5 || s.d) { this.pos.x = s.x; this.pos.y = s.y; } else if (err > 0.02) { this.pos.x += ex * 0.15; this.pos.y += ey * 0.15; }
    this.me.hp = s.hp; this.me.mh = state.you.stats.maxHp;
    if (s.d) this.me.actor.die(); else this.me.actor.revive();
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
    if (state.you.level < ab.lvl || state.snap?.d) return;
    (ab.type === 'proj' ? sfx.shoot : ab.type === 'heal' ? sfx.heal : sfx.nova)();
    this.lastAttackAt = performance.now();
    this.me.actor.play('skill');
  }

  aimPoint() {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((this.pointer.x - r.left) / r.width) * 2 - 1, -((this.pointer.y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
  }

  // ---- frame -----------------------------------------------------------------------------
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1), now = performance.now();
    this.time += dt;
    if (this.me && state.map && state.snap) this.step(dt, now);
    this.fx.update(dt);
    this.terrain?.update(this.time);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(dt, now);
  }

  step(dt, now) {
    const dead = state.snap.d;
    // Movement intent: sent only when it changes; simulated locally with the server's rules.
    let dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let dy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    if (dead) dx = dy = 0;
    if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
    const dir = `${dx},${dy}`;
    if (dir !== this.lastDir) { this.lastDir = dir; send({ t: 'move', dx, dy }); }
    const speed = state.you.stats.speed;
    if (dx || dy) moveWithCollision(state.map, this.pos, dx * speed * dt, dy * speed * dt);

    const p = this.aimPoint();
    if (p) this.aim = Math.atan2(p.z - this.pos.y, p.x - this.pos.x);
    const atk = CLASSES[state.you.cls].attack;
    if (!dead && (this.pointer.down || keys.has('Space')) && now >= this.nextAttack) {
      this.nextAttack = now + atk.cd * 1000 + 20;
      send({ t: 'attack', a: this.aim });
      (atk.type === 'melee' ? sfx.swing : sfx.shoot)();
      this.lastAttackAt = now;
      this.me.actor.play('attack', atk.type === 'melee' ? 1.6 : 1.3);
    }

    for (const e of this.ents.values()) {
      let moving = false;
      if (e.self) {
        e.x = this.pos.x; e.y = this.pos.y;
        moving = !!(dx || dy);
        const want = now - this.lastAttackAt < 650 ? this.aim : moving ? Math.atan2(dy, dx) : e.face;
        e.face = angleLerp(e.face, want, Math.min(1, dt * 14));
      } else if (e.v.k === 'j') {
        const t = (now - e.t0) / 1000; e.x = e.v.x + e.v.vx * t; e.y = e.v.y + e.v.vy * t;
      } else {
        const a = Math.min(1, (now - e.t0) / INTERP_MS);
        const nx = lerp(e.fromX, e.v.x, a), ny = lerp(e.fromY, e.v.y, a);
        const vx = nx - e.x, vy = ny - e.y;
        if (Math.hypot(vx, vy) > 0.35 * dt) { e.movingUntil = now + 160; if (!e.lockFaceUntil || now > e.lockFaceUntil) e.faceTarget = Math.atan2(vy, vx); }
        e.x = nx; e.y = ny;
        moving = now < e.movingUntil;
        if (e.v.k === 'n') e.faceTarget = Math.hypot(this.pos.x - e.x, this.pos.y - e.y) < 5 ? Math.atan2(this.pos.y - e.y, this.pos.x - e.x) : Math.PI / 2;
        if (e.faceTarget !== undefined) e.face = angleLerp(e.face, e.faceTarget, Math.min(1, dt * 10));
      }
      e.obj.position.x = e.x; e.obj.position.z = e.y;
      if (e.actor) {
        e.actor.face(e.face);
        e.actor.setMoving(moving);
        e.actor.update(dt, now);
        if (e.squash) { e.squash = Math.max(0, e.squash - dt * 6); const s = 1 + e.squash * 0.18; e.actor.pivot.scale.set(s, 1 - e.squash * 0.12, s); }
        if (e.ring) e.ring.material.opacity = 0.35 + Math.sin(this.time * 4) * 0.15 + (e.v.cast ? 0.4 : 0);
      } else if (e.v.k === 'o') {
        e.obj.userData.disc.rotation.z = this.time * 0.8;
        e.obj.userData.disc.material.opacity = 0.6 + Math.sin(this.time * 3) * 0.15;
      }
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) { // death animation, then sink away
      const c = this.corpses[i], t = (now - c.deadAt) / 1000;
      c.actor?.update(dt, now);
      if (t > 1.1) c.obj.position.y = -(t - 1.1) * 0.9;
      if (t > 2.4) { this.removeEnt(c); this.corpses.splice(i, 1); }
    }

    // Camera: smooth follow from the south-east-ish high angle, plus decaying "trauma" shake.
    const k = 1 - Math.exp(-dt * 8);
    this.camPos.x = lerp(this.camPos.x, this.pos.x, k); this.camPos.z = lerp(this.camPos.z, this.pos.y, k);
    const dist = this.zoom;
    let cx = this.camPos.x, cz = this.camPos.z;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
      const sh = this.trauma * this.trauma, t = this.time * 32;
      cx += 0.45 * sh * Math.sin(t * 1.7); cz += 0.3 * sh * Math.sin(t * 2.3);
    }
    this.camera.position.set(cx, 12.5 * dist, cz + 9 * dist);
    this.camera.lookAt(cx, 0.6, cz + 0.4);
    this.sun.position.set(this.camPos.x - 7, 16, this.camPos.z + 5);
    this.sun.target.position.set(this.camPos.x, 0, this.camPos.z);
    this.torch.position.set(this.pos.x, 2.6, this.pos.y + 0.6);
  }

  // ---- overlay: names, bars, floating numbers ---------------------------------------------
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return v.z > 1 ? null : { x: (v.x + 1) / 2 * this.view.w, y: (1 - v.y) / 2 * this.view.h };
  }

  drawOverlay(dt, now) {
    const g = this.ctx, { w, h } = this.view;
    g.clearRect(0, 0, w, h);
    if (!this.me) return;
    g.textAlign = 'center'; g.lineJoin = 'round';
    const list = [...this.ents.values()].filter((e) => e.v.k !== 'j').sort((a, b) => a.y - b.y);
    for (const e of list) {
      const p = this.project(e.x, (e.height || 1.5) + 0.25, e.y);
      if (!p || p.x < -80 || p.x > w + 80 || p.y < -40 || p.y > h + 40) continue;
      const v = e.v;
      let name = v.n, color = '#f0f0f0', size = 12;
      if (v.k === 'm') { name = `${v.n} · ${v.l}`; color = v.b ? '#ff9a2e' : v.el ? '#ffd27a' : '#f0f0f0'; size = v.b ? 14 : 12; }
      else if (v.k === 'p') color = e.self ? '#ffffff' : '#9fd0ff';
      else if (v.k === 'n') color = '#ffe9a0';
      else if (v.k === 'o') { name = v.lv ? `${v.n} (level ${v.lv}+)` : v.n; color = v.ex ? '#9dffb8' : '#e0c4ff'; }
      g.font = `600 ${size}px system-ui, sans-serif`;
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.85)';
      const ty = p.y - (v.k === 'm' || v.k === 'p' ? 9 : 0);
      g.strokeText(name, p.x, ty); g.fillStyle = color; g.fillText(name, p.x, ty);
      if (v.k === 'n') { g.font = '700 18px system-ui'; g.strokeText(v.r === 'quests' ? '!' : '$', p.x, ty - 16); g.fillStyle = '#ffd24a'; g.fillText(v.r === 'quests' ? '!' : '$', p.x, ty - 16); }
      if ((v.k === 'm' || v.k === 'p') && e.mh) {
        const bw = v.b ? 64 : 36, f = Math.max(0, Math.min(1, e.hp / e.mh));
        g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(p.x - bw / 2 - 1, p.y - 4, bw + 2, 6);
        g.fillStyle = v.k === 'p' ? '#4fd06a' : '#d9453a'; g.fillRect(p.x - bw / 2, p.y - 3, bw * f, 4);
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i], t = (now - f.t0) / 900;
      if (t >= 1) { this.floaters.splice(i, 1); continue; }
      const p = this.project(f.x, f.y + t * 1.1, f.z);
      if (!p) continue;
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : 1.1 - Math.min(0.1, (t - 0.15));
      g.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      g.font = `800 ${Math.round(f.size * pop)}px system-ui, sans-serif`;
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.9)';
      g.strokeText(f.text, p.x + f.dx, p.y); g.fillStyle = f.color; g.fillText(f.text, p.x + f.dx, p.y);
      g.globalAlpha = 1;
    }
  }

  float(x, y, text, color, size = 15, lift = 1.6) {
    this.floaters.push({ x, y: lift, z: y, text, color, size, t0: performance.now(), dx: (Math.random() - 0.5) * 18 });
  }

  // ---- events: layered feedback (small / medium / large) ---------------------------------
  onEvent(ev) {
    const mine = ev.id === this.me.v.id, e = this.ents.get(ev.id), now = performance.now();
    const h = e?.height || 1.4;
    switch (ev.t) {
      case 'dmg':
        if (ev.pl) {
          this.float(ev.x, ev.y, `-${ev.v}`, mine ? '#ff6b5e' : '#ffb0a8', 15, h);
          if (mine) { this.trauma = Math.min(1, this.trauma + 0.3); sfx.hurt(); bus.emit('hurt'); }
        } else {
          this.float(ev.x, ev.y, ev.crit ? `${ev.v}!` : `${ev.v}`, ev.crit ? '#ffd24a' : '#ffffff', ev.crit ? 21 : 15, h);
          this.fx.burst(ev.x, h * 0.55, ev.y, 0xffffff, ev.crit ? 8 : 4, 2.2);
          (ev.crit ? sfx.crit : sfx.hit)();
          if (ev.crit) this.trauma = Math.min(1, this.trauma + 0.12);
        }
        if (e?.actor) { e.actor.flash(now); e.squash = 1; if (!e.v.b && !e.self) e.actor.play('hit', 1.4); }
        break;
      case 'swing':
        this.fx.swing(ev.x, ev.y, ev.a, ev.r, ev.arc);
        if (e && !mine && e.actor) { e.face = ev.a; e.faceTarget = ev.a; e.lockFaceUntil = now + 400; e.actor.play('attack', 1.6); }
        break;
      case 'matk':
        if (e?.actor) { e.faceTarget = ev.a; e.face = angleLerp(e.face, ev.a, 0.7); e.lockFaceUntil = now + 450; e.actor.play('attack', 1.3); }
        break;
      case 'nova': this.fx.ring(ev.x, ev.y, ev.r, ev.c, 0.45); sfx.nova(); break;
      case 'tele': sfx.warn(); this.fx.telegraph(ev.x, ev.y, ev.r, ev.d); if (e?.actor) e.actor.play('attack', 0.7); break;
      case 'slam': this.fx.ring(ev.x, ev.y, ev.r, 0xff6a2e, 0.5, 0.55); this.fx.burst(ev.x, 0.2, ev.y, 0x8a6a4a, 24, 5); this.trauma = Math.min(1, this.trauma + 0.7); sfx.slam(); break;
      case 'die':
        if (ev.pl) { if (mine) sfx.death(); e?.actor?.die(); break; }
        if (e) { e.dying = true; e.actor?.die(); }
        this.fx.burst(ev.x, 0.6, ev.y, ev.c, ev.boss ? 50 : 14, ev.boss ? 6 : 3);
        sfx.kill();
        if (ev.boss) { this.trauma = 1; this.fx.ring(ev.x, ev.y, 6, 0xffd24a, 1, 0.4); }
        break;
      case 'heal': this.float(ev.x, ev.y, `+${ev.v}`, '#6dff8f', 15, h); this.fx.rise(ev.x, ev.y, 0x6dff8f, 12, 1.8, 0.9); if (mine) sfx.heal(); break;
      case 'levelup':
        this.fx.pillar(ev.x, ev.y, 0xffd24a);
        this.float(ev.x, ev.y, `LEVEL ${ev.l}`, '#ffd24a', 24, h + 0.6);
        if (mine) sfx.level();
        break;
      case 'shout': this.float(ev.x, ev.y, ev.text, '#ff9a2e', 17, h + 0.9); break;
      default:
    }
  }
}

// Character models: which Quaternius model each class, NPC and enemy uses, how it is tinted and
// sized, and an animated instance wrapper (idle / move / attack / hit / death).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// h: height on screen in tiles. tint/amt: colour pulled toward `tint` by `amt` (eyes untouched).
// glow: emissive colour. hide: mesh names to hide. weapon: prop for the right hand.
// anim: clip overrides per state. ranged/caster entries only change which attack clip plays.
export const CLASS_MODELS = {
  warrior: { m: 'monarch', h: 1.5, weapon: 'sword', anim: { idle: 'Idle_Sword', attack: 'Sword_Slash', skill: 'Sword_Slash' } },
  ranger: { m: 'adventurer', h: 1.5, tint: 0x3f7a3c, amt: 0.25, weapon: 'bow', anim: { attack: 'Gun_Shoot', skill: 'Gun_Shoot' } },
  mage: { m: 'hooded_adventurer', h: 1.5, tint: 0x4058c8, amt: 0.5, hide: ['Sword'], weapon: 'staff', anim: { attack: 'Gun_Shoot', skill: 'Punch_Right' } },
};
export const NPC_MODELS = {
  quests: { m: 'hooded_adventurer', h: 1.55, tint: 0xd9b24c, amt: 0.15, anim: { idle: 'Idle_Sword' } },
  shop: { m: 'adventurer', h: 1.5, tint: 0x9a7240, amt: 0.35, anim: { idle: 'Idle_Neutral' } },
};
export const MOB_MODELS = {
  slime: { m: 'slime_green', h: 0.8 },
  boar: { m: 'stag', h: 1.45 },
  bandit: { m: 'hooded_adventurer', h: 1.5, tint: 0x7a2a2a, amt: 0.45, anim: { idle: 'Idle_Sword', attack: 'Sword_Slash' } },
  wolf: { m: 'wolf', h: 0.95 },
  spider: { m: 'mushroom_imp', h: 0.95 },
  thornling: { m: 'demon_blue', h: 1.45, tint: 0x4f7a3a, amt: 0.55 },
  imp: { m: 'imp', h: 1.05 },
  hound: { m: 'husky', h: 0.95, tint: 0x3a2c2c, amt: 0.6, glow: 0x401004 },
  golem: { m: 'demon', h: 1.55 },
  wisp: { m: 'ghost', h: 1.05, tint: 0x9fe0ff, amt: 0.6, glow: 0x1c3a52 },
  stalker: { m: 'wolf', h: 1.05, tint: 0xe6f2f8, amt: 0.7 },
  brute: { m: 'yeti', h: 1.65 },
  skeleton: { m: 'skeleton_crew', h: 1.4 },
  ghoul: { m: 'zombie', h: 1.4 },
  bonearcher: { m: 'skeleton', h: 1.5, tint: 0xc9c0a0, amt: 0.2 },
  regent: { m: 'ghost_skull', h: 2.7, tint: 0x6a3fb0, amt: 0.3, glow: 0x22103a },
  crawler: { m: 'crab', h: 0.9, tint: 0xb0602a, amt: 0.5 },
  magmaimp: { m: 'dragon_whelp', h: 1.2, glow: 0x3a1000 },
  slag: { m: 'orc_brute', h: 1.7, tint: 0x4a3a34, amt: 0.55, glow: 0x3a0e00 },
  magmaw: { m: 'dragon', h: 3.2, glow: 0x401200 },
  revenant: { m: 'skeleton_crew', h: 1.45, tint: 0x9fd0ee, amt: 0.55, glow: 0x0c2030 },
  rimecaster: { m: 'blob_wizard', h: 1.2, tint: 0x8fc7e8, amt: 0.5 },
  frostknight: { m: 'demon_blue', h: 1.7, tint: 0x7fb2e0, amt: 0.3 },
  vael: { m: 'wyvern', h: 3.4, tint: 0xbfe8ff, amt: 0.55, glow: 0x0c2a40 },
};
export const ALL_MODELS = [...new Set([...Object.values(CLASS_MODELS), ...Object.values(NPC_MODELS), ...Object.values(MOB_MODELS)].map((d) => d.m)), 'sword'];

// Clip names differ between Quaternius packs; each state tries these in order.
const CLIPS = {
  idle: ['Idle', 'Flying_Idle', 'Skeleton_Idle', 'Idle_Neutral', 'Idle_2'],
  move: ['Run', 'Fast_Flying', 'Gallop', 'Skeleton_Running', 'Walk', 'Flying_Idle'],
  attack: ['Sword_Slash', 'Punch', 'Bite_Front', 'Attack', 'Headbutt', 'Skeleton_Attack', 'Weapon', 'Dagger_Attack', 'Punch_Right'],
  hit: ['HitRecieve', 'HitReact', 'RecieveHit', 'Idle_HitReact_Left'],
  death: ['Death', 'Skeleton_Death'],
};
const SKIP_TINT = /eye|pupil|tongue|teeth|mouth/i;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map(), ready = new Map();
/** Fetch and decode models once. Actors can only be made from models that finished loading. */
export function loadModels(names = ALL_MODELS, onProgress) {
  let done = 0;
  return Promise.all(names.map((n) => {
    if (!cache.has(n)) cache.set(n, loader.loadAsync(`/assets/models/${n}.glb`).then((g) => { ready.set(n, g); return g; }));
    return cache.get(n).then((g) => { onProgress?.(++done, names.length); return g; });
  }));
}
export const makeActor = (def) => new Actor(def, ready.get(def.m), def.weapon ? makeWeapon(def.weapon) : null);

function clipMap(gltf) {
  const byName = new Map();
  for (const c of gltf.animations) {
    const short = c.name.split('|').pop();
    if (!byName.has(short)) byName.set(short, c);
  }
  return byName;
}

// ---- weapon props ------------------------------------------------------------------------------
// Which right-hand bone holds each prop, and its Euler rotation there (props point up +Y).
// The sword copies the grip of the sword that ships attached to Quaternius's medieval rig.
export const WEAPON_GRIP = {
  sword: { bone: /^middle1\.?_?r$/i, rot: [0, 0, -Math.PI / 2] },
  bow: { bone: /^wrist\.?_?r$/i, rot: [0, 0, 0] },
  staff: { bone: /^wrist\.?_?r$/i, rot: [Math.PI, 0, 0] },
};
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...extra });
function makeWeapon(kind) {
  const g = new THREE.Group();
  if (kind === 'sword') {
    const sword = ready.get('sword').scene.clone(true);
    const box = new THREE.Box3().setFromObject(sword), s = 0.95 / box.getSize(new THREE.Vector3()).y;
    sword.scale.setScalar(s);
    sword.position.y = -box.min.y * s - 0.12;
    g.add(sword);
  } else if (kind === 'bow') {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 4, 10, Math.PI * 0.9), std(0x7a4a24));
    arc.rotation.z = Math.PI / 2 + Math.PI * 0.05;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.82, 3), std(0xeee6cf));
    string.position.x = -0.07;
    g.add(arc, string);
    g.rotation.y = Math.PI / 2;
  } else if (kind === 'staff') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.3, 5), std(0x6b4a2b));
    pole.position.y = 0.35;
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), std(0x9fe0ff, { emissive: 0x3aa0ff, emissiveIntensity: 1.2 }));
    orb.position.y = 1.04;
    g.add(pole, orb);
  }
  return g;
}

/** An animated, tinted, correctly sized character. Its `root` faces +X when rotation is 0. */
export class Actor {
  constructor(def, gltf, weapon) {
    this.def = def;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();          // rotated to face; scaled for hit squash
    this.root.add(this.pivot);
    const model = SkeletonUtils.clone(gltf.scene);
    this.materials = [];
    const tint = def.tint !== undefined ? new THREE.Color(def.tint) : null;
    if (def.hide) model.traverse((o) => { if (def.hide.includes(o.name)) o.visible = false; });
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds do not follow the animation
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        const c = m.clone();
        if (tint && !SKIP_TINT.test(m.name)) c.color.lerp(tint, def.amt ?? 0.5);
        if (def.glow && c.emissive) c.emissive.setHex(def.glow);
        c.userData.baseEmissive = c.emissive ? c.emissive.getHex() : 0;
        this.materials.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });
    // Normalise size: feet on the ground, centred, `h` tiles tall.
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
    const s = def.h / size.y;
    model.scale.setScalar(s);
    model.position.set(-(box.min.x + size.x / 2) * s, -box.min.y * s, -(box.min.z + size.z / 2) * s);
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI / 2; // Quaternius models face +Z; make rotation 0 face +X
    holder.add(model);
    this.pivot.add(holder);
    this.height = def.h;
    if (weapon) {
      const grip = WEAPON_GRIP[def.weapon];
      let hand = null;
      model.traverse((o) => { if (!hand && grip.bone.test(o.name)) hand = o; });
      if (hand) {
        model.updateMatrixWorld(true);
        weapon.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const wrap = new THREE.Group(), ws = hand.getWorldScale(new THREE.Vector3());
        wrap.add(weapon);
        wrap.scale.setScalar(0.85 / ws.x); // props are built in tile units
        wrap.rotation.set(...grip.rot);
        hand.add(wrap);
        this.weapon = wrap;
      }
    }
    this.mixer = new THREE.AnimationMixer(model);
    const clips = clipMap(gltf);
    this.actions = {};
    for (const state of Object.keys(CLIPS)) {
      const wanted = [def.anim?.[state], ...CLIPS[state]].filter(Boolean);
      const clip = wanted.map((n) => clips.get(n)).find(Boolean);
      if (clip) this.actions[state] = this.mixer.clipAction(clip);
    }
    if (def.anim?.skill && clips.get(def.anim.skill)) this.actions.skill = this.mixer.clipAction(clips.get(def.anim.skill));
    for (const k of ['attack', 'hit', 'death', 'skill']) {
      const a = this.actions[k];
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    this.base = null;
    this.oneShot = null;
    this.dead = false;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.oneShot) return;
      this.oneShot = null;
      if (!this.dead && this.base) { e.action.fadeOut(0.15); this.base.reset().fadeIn(0.15).play(); }
    });
    this.setMoving(false);
    this.mixer.update(Math.random() * 2); // desynchronise idle loops
    this.flashUntil = 0;
  }

  setMoving(moving) {
    if (this.dead) return;
    const next = (moving && this.actions.move) || this.actions.idle || this.actions.move;
    if (!next || next === this.base) return;
    const prev = this.base;
    this.base = next;
    if (this.oneShot) return; // resumes when the one-shot finishes
    next.reset().play();
    if (prev) prev.crossFadeTo(next, 0.18, false);
  }

  play(state, speed = 1) {
    if (this.dead) return;
    const a = this.actions[state] || (state === 'skill' && this.actions.attack);
    if (!a) return;
    if (state === 'hit' && this.oneShot && this.oneShot !== this.actions.hit) return; // never cancel an attack
    const from = this.oneShot || this.base;
    a.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play();
    if (from && from !== a) from.crossFadeTo(a, 0.08, false);
    this.oneShot = a;
  }

  die() {
    if (this.dead) return;
    const a = this.actions.death;
    this.dead = true;
    if (a) { a.reset().play(); (this.oneShot || this.base)?.crossFadeTo(a, 0.1, false); }
    this.oneShot = null;
  }

  revive() {
    if (!this.dead) return;
    this.dead = false;
    this.actions.death?.stop();
    const base = this.base; this.base = null;
    if (base) { base.reset().play(); this.base = base; } else this.setMoving(false);
  }

  flash(now) {
    this.flashUntil = now + 90;
    for (const m of this.materials) if (m.emissive) m.emissive.setHex(0xffffff);
  }

  update(dt, now) {
    this.mixer.update(dt);
    if (this.flashUntil && now >= this.flashUntil) {
      this.flashUntil = 0;
      for (const m of this.materials) if (m.emissive) m.emissive.setHex(m.userData.baseEmissive);
    }
  }

  /** Face a direction given as an angle in map space (0 = +x / east, pi/2 = +y / south). */
  face(angle) { this.pivot.rotation.y = -angle; }

  dispose() { this.mixer.stopAllAction(); for (const m of this.materials) m.dispose(); }
}

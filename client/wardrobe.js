// Look editor: a live 3D preview plus arrow pickers for each outfit part, colours and skin.
// Used on the character-creation screen and in the wardrobe at Odo's stall.
import * as THREE from 'three';
import { LOOK, LOOK_KEYS, DEFAULT_LOOK } from '/shared/content.js';
import { makeActor, heroDef, loadModels } from './models.js';

const MALE_ONLY = new Set(['head', 'torso', 'legs', 'feet', 'pack']);
const LABEL = { body: 'Body', head: 'Head', torso: 'Torso', legs: 'Legs', feet: 'Boots', pack: 'Backpack', colors: 'Colours', skin: 'Skin' };

export class LookEditor {
  /** getCls() returns the class to preview (its weapon and stance); onChange(look) after each edit. */
  constructor(el, { look, getCls, onChange }) {
    this.el = el;
    this.look = [...look];
    this.getCls = getCls;
    this.onChange = onChange;
    el.classList.add('look-editor');
    this.view = document.createElement('div');
    this.view.className = 'look-preview';
    this.view.textContent = 'Loading models…';
    this.rows = document.createElement('div');
    this.rows.className = 'look-rows';
    el.replaceChildren(this.view, this.rows);
    this.buildRows();
    loadModels().then(() => this.startPreview()).catch(() => { this.view.textContent = 'Preview unavailable'; });
  }

  buildRows() {
    this.labels = {};
    this.rowEls = {};
    for (const [i, key] of LOOK_KEYS.entries()) {
      const value = document.createElement('span');
      const step = (d) => { this.look[i] = (this.look[i] + d + LOOK[key].length) % LOOK[key].length; this.changed(); };
      const btn = (t, d, label) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-label', `${label} ${LABEL[key]}`); b.onclick = () => step(d); return b; };
      const row = document.createElement('div');
      row.className = 'look-row';
      const name = document.createElement('b');
      name.textContent = LABEL[key];
      row.append(name, btn('◀', -1, 'Previous'), value, btn('▶', 1, 'Next'));
      this.rows.append(row);
      this.labels[key] = value;
      this.rowEls[key] = row;
    }
    const tools = document.createElement('div');
    tools.className = 'look-row look-tools';
    const random = document.createElement('button');
    random.type = 'button'; random.textContent = 'Randomise';
    random.onclick = () => { this.look = LOOK_KEYS.map((k) => Math.floor(Math.random() * LOOK[k].length)); this.changed(); };
    const reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Class default';
    reset.onclick = () => { this.look = [...DEFAULT_LOOK[this.getCls()]]; this.changed(); };
    tools.append(random, reset);
    this.rows.append(tools);
    this.refreshRows();
  }

  refreshRows() {
    const female = this.look[0] === 1;
    for (const [i, key] of LOOK_KEYS.entries()) {
      this.labels[key].textContent = LOOK[key][this.look[i]];
      this.rowEls[key].hidden = female && MALE_ONLY.has(key);
    }
  }

  changed(silent) {
    this.refreshRows();
    this.rebuild();
    if (!silent) this.onChange?.([...this.look]);
  }

  setLook(look) { this.look = [...look]; this.changed(true); }

  startPreview() {
    const w = 220, h = 270;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(w, h);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x4a3a2a, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-2, 4, 3);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24), new THREE.MeshStandardMaterial({ color: 0x3a3327, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 20);
    this.camera.position.set(0, 1.35, 3.6);
    this.camera.lookAt(0, 0.8, 0);
    this.view.replaceChildren(this.renderer.domElement);
    this.clock = new THREE.Clock();
    this.angle = 0.5;
    this.rebuild();
    this.renderer.setAnimationLoop(() => {
      if (!this.el.isConnected || this.el.closest('[hidden]')) return;
      const dt = Math.min(0.1, this.clock.getDelta());
      this.angle += dt * 0.6;
      if (this.actor) { this.actor.face(this.angle); this.actor.update(dt, performance.now()); }
      this.renderer.render(this.scene, this.camera);
    });
  }

  rebuild() {
    if (!this.scene) return;
    if (this.actor) { this.scene.remove(this.actor.root); this.actor.dispose(); }
    this.actor = makeActor(heroDef(this.getCls(), this.look));
    this.scene.add(this.actor.root);
  }
}

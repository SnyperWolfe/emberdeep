// Short-lived 3D effects. Each effect is an object with update(dt) -> still alive?
import * as THREE from 'three';

const add = (color, opacity = 0.8) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
const SHARD = new THREE.TetrahedronGeometry(0.07, 0);

export class Effects {
  constructor(scene) { this.scene = scene; this.list = []; }

  push(obj, life, tick) {
    this.scene.add(obj);
    this.list.push({ obj, life, t: 0, tick });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.life);
      e.tick(k, dt);
      if (k >= 1) {
        this.scene.remove(e.obj);
        e.obj.traverse((o) => { if (o.isMesh) { if (o.geometry !== SHARD) o.geometry.dispose(); o.material.dispose(); } });
        this.list.splice(i, 1);
      }
    }
  }

  clear() { for (const e of this.list) this.scene.remove(e.obj); this.list.length = 0; }

  /** Ground ring that grows from 0 to r and fades. */
  ring(x, z, r, color, life = 0.4, fill = 0.35) {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 28), add(color, fill));
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32), add(color, 0.9));
    g.add(disc, edge);
    g.rotation.x = -Math.PI / 2; g.position.set(x, 0.06, z);
    this.push(g, life, (k) => { const s = r * (0.2 + 0.8 * (1 - (1 - k) ** 3)); g.scale.setScalar(s); disc.material.opacity = fill * (1 - k); edge.material.opacity = 0.9 * (1 - k); });
  }

  /** Melee swing: a flat arc in front of the attacker. */
  swing(x, z, angle, r, arc) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.35, r, 18, 1, angle - arc / 2, arc), add(0xffffff, 0.45));
    m.rotation.x = Math.PI / 2; m.position.set(x, 0.55, z);
    this.push(m, 0.18, (k) => { m.material.opacity = 0.45 * (1 - k); m.position.y = 0.55 + k * 0.1; });
  }

  /** Telegraphed area: an outline plus a fill that grows until the hit lands. */
  telegraph(x, z, r, duration) {
    const g = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 40), add(0xff3b2e, 0.95));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), add(0xff3b2e, 0.3));
    g.add(edge, fill); g.rotation.x = -Math.PI / 2; g.position.set(x, 0.05, z);
    this.push(g, duration, (k) => { fill.scale.setScalar(Math.max(0.01, k)); edge.material.opacity = 0.6 + 0.35 * Math.sin(k * 30); });
  }

  /** Shards that fly out and fall. */
  burst(x, y, z, color, n = 10, speed = 3) {
    const g = new THREE.Group(), parts = [];
    const m = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(SHARD, m);
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      p.position.set(x, y, z);
      p.userData.v = new THREE.Vector3(Math.cos(a) * s, 1.5 + Math.random() * speed, Math.sin(a) * s);
      p.scale.setScalar(0.7 + Math.random());
      g.add(p); parts.push(p);
    }
    this.push(g, 0.7, (k, dt) => {
      for (const p of parts) { p.userData.v.y -= 9 * dt; p.position.addScaledVector(p.userData.v, dt); if (p.position.y < 0.03) { p.position.y = 0.03; p.userData.v.multiplyScalar(0.5); } p.rotation.x += dt * 8; }
      m.opacity = 1 - k * k;
    });
  }

  /** Motes drifting upward (heals, level-ups). */
  rise(x, z, color, n = 14, height = 2.2, life = 1) {
    const g = new THREE.Group(), parts = [], m = add(color, 1);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), m);
      const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.45;
      p.position.set(x + Math.cos(a) * r, Math.random() * 0.4, z + Math.sin(a) * r);
      p.userData.s = height * (0.6 + Math.random() * 0.6);
      g.add(p); parts.push(p);
    }
    this.push(g, life, (k, dt) => { for (const p of parts) p.position.y += p.userData.s * dt; m.opacity = 1 - k; });
  }

  /** A column of light, used for level-ups. */
  pillar(x, z, color) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 4, 16, 1, true), add(color, 0.5));
    m.position.set(x, 2, z);
    this.push(m, 0.9, (k) => { m.material.opacity = 0.5 * (1 - k); m.scale.set(1 - k * 0.6, 1, 1 - k * 0.6); });
    this.ring(x, z, 2.6, color, 0.8, 0.3);
    this.rise(x, z, color, 26, 3, 1.1);
  }
}

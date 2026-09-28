import * as THREE from 'three';

// Steam from the hot tea: soft, irregular wisps that rise from the surface, drift and curl, widen and fade.
// Kept faint and warm-tinted, like steam catching lamplight in a dark room.

function wispTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 9; i++) {                      // a few overlapping soft blobs make an irregular puff
    const x = 64 + (Math.random() - 0.5) * 34, y = 64 + (Math.random() - 0.5) * 50, r = 22 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Steam {
  constructor(root, scene) {
    const tea = root.getObjectByName('Tea') || root.getObjectByName('Teacup');
    if (!tea) return;
    const b = new THREE.Box3().setFromObject(tea);
    this.origin = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.001, (b.min.z + b.max.z) / 2);
    this.radius = (b.max.x - b.min.x) * 0.3;
    const textures = [wispTexture(), wispTexture(), wispTexture()];
    this.wisps = [];
    for (let i = 0; i < 22; i++) {
      const m = new THREE.SpriteMaterial({ map: textures[i % 3], color: 0xfff4e6, transparent: true, opacity: 0,
        depthWrite: false });
      const s = new THREE.Sprite(m);
      s.renderOrder = 5;
      scene.add(s);
      this.wisps.push({ s, age: i / 22, life: 0, seed: 0, spin: 0, dx: 0, dz: 0 });
    }
    this.wisps.forEach((w) => this.respawn(w, w.age));
  }

  get ready() { return !!this.wisps; }

  respawn(w, age = 0) {
    w.age = age;
    w.life = 4.5 + Math.random() * 2.5;              // seconds to rise and vanish
    w.seed = Math.random() * 100;
    w.spin = (Math.random() - 0.5) * 0.5;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * this.radius;
    w.dx = Math.cos(a) * r; w.dz = Math.sin(a) * r;
    w.s.material.rotation = Math.random() * Math.PI * 2;
  }

  update(dt, now) {
    if (!this.wisps) return;
    const t = now / 1000;
    for (const w of this.wisps) {
      w.age += dt / w.life;
      if (w.age >= 1) this.respawn(w);
      const k = w.age;
      const rise = 0.085 * k + 0.02 * k * k;         // accelerates a little as it warms the air above
      const curl = 0.012 * k;                        // drifts and curls more the higher it gets
      w.s.position.set(
        this.origin.x + w.dx * (1 - k * 0.3) + curl * Math.sin(t * 0.7 + w.seed) + 0.006 * k * Math.sin(t * 1.9 + w.seed * 2),
        this.origin.y + rise,
        this.origin.z + w.dz * (1 - k * 0.3) + curl * Math.cos(t * 0.6 + w.seed));
      const size = 0.012 + 0.05 * k;
      w.s.scale.set(size * 0.8, size, 1);
      w.s.material.rotation += w.spin * dt;
      // fade in just above the surface, linger, dissolve as it spreads
      w.s.material.opacity = 0.16 * THREE.MathUtils.smoothstep(k, 0, 0.12) * Math.pow(1 - k, 1.6);
    }
  }
}

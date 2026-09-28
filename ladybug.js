import * as THREE from 'three';

// The ladybug's flights. It steps out of Hannah's painting in a shimmer of gold dust, visits the painting's flowers
// in the tray, settles on the mooncake,
// circles the tea and comes home to the gift box; afterwards it now and then wanders off and returns.
// Flight is a chain of phases (emerge / fly along a curve / rest); orientation follows the path with gentle banking.

const UP = new THREE.Vector3(0, 1, 0);
const FEET = 0.0024;                 // the model's origin sits this far above its feet

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t) => t * t * (3 - 2 * t);

function dustTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(0.35, 'rgba(255,205,120,0.55)'); r.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Ladybug {
  constructor(root, scene, camera) {
    this.obj = root.getObjectByName('Ladybug');
    if (!this.obj) return;
    this.scene = scene;
    this.camera = camera;
    this.root = root;
    this.home = { parent: this.obj.parent, pos: this.obj.position.clone(), quat: this.obj.quaternion.clone() };
    this.homeWorld = this.obj.getWorldPosition(new THREE.Vector3());
    this.homeQuatWorld = this.obj.getWorldQuaternion(new THREE.Quaternion());
    this.phases = [];
    this.t = 0;
    this.wingOpen = 0;
    this.nextWander = Infinity;
    this.ray = new THREE.Raycaster();
    this.tmpM = new THREE.Matrix4();
    this.buildWings();
    this.buildDust();
  }

  get ready() { return !!this.obj; }
  get flying() { return this.phases.length > 0; }

  // ------------------------------------------------------------------ parts
  buildWings() {
    // translucent hind wings, only visible in flight. Bug frame: +X forward, +Y up, +Z its left.
    const mat = new THREE.MeshBasicMaterial({ color: 0xeee2c8, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
    this.wings = [1, -1].map((side) => {
      const geo = new THREE.CircleGeometry(1, 24);
      geo.scale(0.0028, 0.0075, 1);                         // long axis sideways
      geo.translate(0, side * 0.0068, 0);                   // root at the pivot, tip outward
      geo.rotateX(Math.PI / 2);                             // XY plane -> XZ plane (horizontal)
      const pivot = new THREE.Group();
      pivot.position.set(0.0008, 0.0042, 0);
      pivot.add(new THREE.Mesh(geo, mat));
      pivot.userData.side = side;
      this.obj.add(pivot);
      return pivot;
    });
    this.setWings(0, 0);
  }

  setWings(open, now) {
    for (const p of this.wings) {
      const s = p.userData.side;
      p.visible = open > 0.02;
      p.scale.setScalar(Math.max(open, 0.001));
      const beat = open * (0.25 + 0.55 * Math.sin(now * 0.08));   // fast shimmering beat
      p.rotation.set(-s * beat, s * 0.45, 0);               // tip up/down about the body axis; swept back
    }
  }

  buildDust() {
    this.N = 220;
    const g = new THREE.BufferGeometry();
    this.dPos = new Float32Array(this.N * 3);
    this.dCol = new Float32Array(this.N * 3);
    this.dVel = new Float32Array(this.N * 3);
    this.dLife = new Float32Array(this.N);
    g.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.dCol, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.005, map: dustTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 10;
    this.scene.add(this.dust);
    this.dNext = 0;
  }

  emit(p, n, spread, speed) {
    for (let k = 0; k < n; k++) {
      const i = this.dNext; this.dNext = (this.dNext + 1) % this.N;
      this.dPos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      this.dPos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread;
      this.dPos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      this.dVel[i * 3] = (Math.random() - 0.5) * speed;
      this.dVel[i * 3 + 1] = (Math.random() - 0.3) * speed;
      this.dVel[i * 3 + 2] = (Math.random() - 0.5) * speed;
      this.dLife[i] = 1;
    }
  }

  updateDust(dt) {
    for (let i = 0; i < this.N; i++) {
      if (this.dLife[i] <= 0) { this.dCol[i * 3] = this.dCol[i * 3 + 1] = this.dCol[i * 3 + 2] = 0; continue; }
      this.dLife[i] -= dt / 1.6;
      for (let a = 0; a < 3; a++) this.dPos[i * 3 + a] += this.dVel[i * 3 + a] * dt;
      this.dVel[i * 3 + 1] -= 0.004 * dt;                    // settles slowly, like gilding dust
      const l = Math.max(this.dLife[i], 0), f = l * l;
      this.dCol[i * 3] = 1.0 * f; this.dCol[i * 3 + 1] = 0.78 * f; this.dCol[i * 3 + 2] = 0.42 * f;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.geometry.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------------ where things are
  surface(name, fx, fz, dir = 'down') {
    // a point on an object's surface: fx/fz place it inside the object's bounds; raycast onto the mesh
    const o = this.root.getObjectByName(name);
    if (!o) return null;
    const b = new THREE.Box3().setFromObject(o);
    const x = THREE.MathUtils.lerp(b.min.x, b.max.x, fx);
    let from, d;
    if (dir === 'down') {
      const z = THREE.MathUtils.lerp(b.min.z, b.max.z, fz);
      from = new THREE.Vector3(x, b.max.y + 0.2, z); d = new THREE.Vector3(0, -1, 0);
    } else {                                                  // 'front': fz is height, cast towards -z
      const y = THREE.MathUtils.lerp(b.min.y, b.max.y, fz);
      from = new THREE.Vector3(x, y, b.max.z + 0.3); d = new THREE.Vector3(0, 0, -1);
    }
    this.ray.set(from, d);
    const hit = this.ray.intersectObject(o, true)[0];
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : UP.clone();
    return { p: hit.point, n };
  }

  landing(name, fx, fz) {
    // try the requested spot, then a small spiral around it (flowers have gaps between them)
    for (let k = 0; k < 14; k++) {
      const a = k * 2.4, r = k * 0.025;
      const s = this.surface(name, fx + Math.cos(a) * r, fz + Math.sin(a) * r);
      if (s && s.n.y > 0.35) return s.p.clone().addScaledVector(UP, FEET);   // somewhere it can stand
    }
    return null;
  }

  // ------------------------------------------------------------------ choreography
  curve(points) { return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5); }

  flight(from, to, lift = 0.07) {
    // take off almost vertically, arc over, settle down onto the target
    const mid = from.clone().lerp(to, 0.5); mid.y = Math.max(from.y, to.y) + lift;
    return this.curve([from, from.clone().addScaledVector(UP, 0.018), mid, to.clone().addScaledVector(UP, 0.02), to]);
  }

  aroundTea(from) {
    const cup = this.root.getObjectByName('Teacup');
    const b = new THREE.Box3().setFromObject(cup);
    const c = b.getCenter(new THREE.Vector3()); const r = (b.max.x - b.min.x) * 0.62; const y = b.max.y + 0.03;
    const a0 = Math.atan2(from.z - c.z, from.x - c.x);
    const pts = [];
    for (let k = 0; k <= 16; k++) {                            // one and a quarter slow, bobbing turns
      const a = a0 + (k / 16) * Math.PI * 2.5;
      pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, y + 0.006 * Math.sin(k * 1.3), c.z + Math.sin(a) * r));
    }
    return pts;
  }

  camPoint() {
    // a spot just in front of the viewer, a little right of and below centre
    const cam = this.camera;
    const f = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(f, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    return cam.position.clone().addScaledVector(f, 0.13).addScaledVector(right, 0.028).addScaledVector(up, -0.018);
  }

  plan(stops) {
    // Each leg is built when it starts, from wherever the ladybug actually is (the viewer may have moved the camera).
    // stops: {emerge:{p,n}} | {to, lift} | {via: from => points} | {camera: true} | {rest, turn} | {home: true}
    this.phases = [];
    for (const s of stops) {
      if (s.emerge) {
        this.phases.push({ type: 'emerge', dur: 1.8, p: s.emerge.p.clone().addScaledVector(s.emerge.n, 0.004), n: s.emerge.n });
      } else if (s.to) {
        this.phases.push({ type: 'fly', speed: 0.13, min: 2.2, build: (from) => this.flight(from, s.to, s.lift) });
      } else if (s.via) {
        this.phases.push({ type: 'fly', speed: 0.1, min: 2.5, build: (from) => this.curve([from, ...s.via(from)]) });
      } else if (s.camera) {
        this.phases.push({ type: 'fly', speed: 0.16, min: 2.6, build: (from) => {
          const c = this.camPoint(); const mid = from.clone().lerp(c, 0.5); mid.y += 0.04;
          return this.curve([from, from.clone().addScaledVector(UP, 0.02), mid, c]);
        } });
        this.phases.push({ type: 'hover', dur: 2.8 });
      } else if (s.rest) {
        this.phases.push({ type: 'rest', dur: s.rest, turn: s.turn || 0 });
      } else if (s.home) {
        this.phases.push({ type: 'fly', speed: 0.12, min: 2.4, home: true, build: (from) => this.flight(from, this.homeWorld, 0.06) });
      }
    }
    this.phase = 0; this.t = 0;
    this.scene.attach(this.obj);                               // fly in world space
  }

  intro() {
    if (!this.ready || this.flying) return;
    const art = this.surface('Poster_Art', 0.6, 0.56, 'front');     // the painted ladybug
    const bloom = this.landing('TrayFlowers', 0.45, 0.4);           // the painting's flowers, real in the tray
    const cake = this.landing('Mooncake', 0.62, 0.42);
    const tea = this.root.getObjectByName('Teacup');
    if (!art || !cake || !tea) return;
    this.plan([
      { emerge: art },
      ...(bloom ? [{ to: bloom, lift: 0.05 }, { rest: 2.2, turn: -0.7 }] : []),
      { to: cake, lift: 0.08 }, { rest: 2.4, turn: 0.9 },
      { camera: true },                                          // a brief visit to the viewer
      { via: (from) => this.aroundTea(from) }, { home: true },
    ]);
  }

  wander() {
    if (!this.ready || this.flying) return;
    const options = [
      () => { const p = this.landing('Mooncake', 0.4 + Math.random() * 0.2, 0.4 + Math.random() * 0.2); return p && [{ to: p }, { rest: 2.5, turn: 0.6 }, { home: true }]; },
      () => { const p = this.landing('TrayFlowers', 0.35 + Math.random() * 0.3, 0.35 + Math.random() * 0.3); return p && [{ to: p, lift: 0.08 }, { rest: 3, turn: -0.5 }, { home: true }]; },
      () => { const p = this.landing('Lantern_Frame', 0.5, 0.5); return p && [{ to: p, lift: 0.05 }, { rest: 3.5, turn: 0.8 }, { home: true }]; },
      () => [{ via: (from) => this.aroundTea(from) }, { home: true }],
    ];
    for (let k = 0; k < 4; k++) {
      const plan = options[Math.floor(Math.random() * options.length)]();
      if (plan) { this.plan(plan); return; }
    }
  }

  scheduleWander(now) { this.nextWander = now + 45000 + Math.random() * 40000; }

  // ------------------------------------------------------------------ per frame
  orient(forward, up, dt, rate = 6) {
    const x = forward.clone().normalize();
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    if (z.lengthSq() < 1e-6) return;
    const y = new THREE.Vector3().crossVectors(z, x);
    const target = new THREE.Quaternion().setFromRotationMatrix(this.tmpM.makeBasis(x, y, z));
    this.obj.quaternion.slerp(target, 1 - Math.exp(-dt * rate));
  }

  update(dt, now) {
    if (!this.ready) return;
    this.updateDust(dt);
    if (!this.flying) {
      if (now > this.nextWander && !document.hidden) { this.wander(); this.scheduleWander(now); }
      this.setWings(this.wingOpen = Math.max(0, this.wingOpen - dt * 3), now);
      return;
    }
    const ph = this.phases[this.phase];
    if (ph.build && !ph.curve) {
      ph.curve = ph.build(this.obj.getWorldPosition(new THREE.Vector3()));
      ph.dur = Math.max(ph.min, ph.curve.getLength() / ph.speed);
    }
    if (ph.type === 'hover' && !ph.at) ph.at = this.obj.position.clone();
    this.t += dt;
    const u = Math.min(this.t / ph.dur, 1);
    let wingTarget = 0;

    if (ph.type === 'emerge') {
      // steps out of the painting: grows from the canvas in a shimmer, then turns to face the room
      const k = smooth(u);
      this.obj.position.copy(ph.p);
      this.obj.scale.setScalar(Math.max(k, 0.001));
      this.orient(ph.n, UP, dt, 3);
      if (Math.random() < 0.9) this.emit(ph.p, 2, 0.02 * (1 - k * 0.5), 0.012);
      wingTarget = u > 0.35 ? 1 : 0;
    } else if (ph.type === 'fly') {
      const e = easeInOut(u);
      const p = ph.curve.getPointAt(e);
      const tan = ph.curve.getTangentAt(Math.min(e + 0.002, 1));
      const ahead = ph.curve.getTangentAt(Math.min(e + 0.05, 1));
      // bank into the turn, a hint of hovering bob
      const turn = new THREE.Vector3().crossVectors(tan, ahead).y;
      const bank = new THREE.Vector3().crossVectors(tan, UP).normalize().multiplyScalar(-turn * 6);
      const up = UP.clone().add(bank).normalize();
      p.y += 0.0015 * Math.sin(now * 0.006) * Math.sin(Math.PI * u);
      this.obj.position.copy(p);
      this.obj.scale.setScalar(1);
      const flat = tan.clone(); if (u > 0.9 || u < 0.08) flat.y *= 0.3;   // level out for take-off and landing
      this.orient(flat, up, dt, ph.home && u > 0.85 ? 3 : 7);
      if (ph.home && u > 0.8) this.obj.quaternion.slerp(this.homeQuatWorld, smooth((u - 0.8) / 0.2) * 0.25);
      if (Math.random() < 0.8) this.emit(p, 1, 0.003, 0.004);
      wingTarget = u < 0.97 ? 1 : 0;
    } else if (ph.type === 'hover') {
      // hangs in the air just before the viewer, turned towards them, wings shimmering
      const p = ph.at.clone();
      p.y += 0.0025 * Math.sin(now * 0.004); p.x += 0.0015 * Math.sin(now * 0.0023);
      this.obj.position.copy(p);
      const toCam = this.camera.position.clone().sub(p); toCam.y *= 0.4;
      this.orient(toCam, UP, dt, 3);
      if (Math.random() < 0.5) this.emit(p, 1, 0.004, 0.003);
      wingTarget = 1;
    } else if (ph.type === 'rest') {
      // settled: fold wings, turn slowly on the spot
      if (ph.turn) this.obj.rotateOnWorldAxis(UP, ph.turn * dt / ph.dur);
      const q = this.obj.quaternion.clone();
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q); fwd.y = 0;
      if (fwd.lengthSq() > 1e-6) this.orient(fwd, UP, dt, 4);
    }
    this.wingOpen += (wingTarget - this.wingOpen) * (1 - Math.exp(-dt * 10));
    this.setWings(this.wingOpen, now);

    if (u >= 1) {
      this.phase += 1; this.t = 0;
      if (this.phase >= this.phases.length) {
        // home: back onto the lid exactly as it was
        this.home.parent.attach(this.obj);
        this.obj.position.copy(this.home.pos);
        this.obj.quaternion.copy(this.home.quat);
        this.obj.scale.setScalar(1);
        this.phases = [];
      }
    }
  }
}

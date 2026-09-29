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
  r.addColorStop(0, 'rgba(255,250,225,1)'); r.addColorStop(0.18, 'rgba(255,225,150,0.95)');
  r.addColorStop(0.45, 'rgba(255,195,100,0.35)'); r.addColorStop(1, 'rgba(255,180,80,0)');
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
    // Real flight anatomy: the red wing cases (elytra) hinge open into a "V" and the veined, translucent hind wings
    // unfold beneath them and beat ~72 times a second. Bug frame: +X forward, +Y up, +Z its left.
    this.mesh = this.obj.isMesh ? this.obj : this.obj.getObjectByProperty('isMesh', true);
    this.elytra = this.splitElytra();
    this.hind = this.buildHindWings();
    this.setWings(0, 0);
  }

  splitElytra() {
    // Cut the two wing cases out of the body mesh (they were modelled as one piece) so they can open.
    const mesh = this.mesh;
    if (!mesh) return [];
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const pos = src.attributes.position;
    src.computeBoundingBox();
    const bb = src.boundingBox;
    const L = Math.max(-bb.min.x, 0.004);                     // half length of the shell (tail end is at -L)
    const yTop = bb.max.y;
    const xCut = L * 0.6;                                     // pronotum starts here
    const names = Object.keys(src.attributes);
    const parts = { body: [], left: [], right: [] };
    const c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      c.set(0, 0, 0);
      let minY = Infinity;
      for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, t + k); c.add(v); minY = Math.min(minY, v.y); }
      c.multiplyScalar(1 / 3);
      const shell = c.x < xCut && c.y > 0.0004 && minY > 0.0001 && Math.abs(c.z) < L * 1.0;
      (shell ? (c.z >= 0 ? parts.left : parts.right) : parts.body).push(t);
    }
    if (parts.left.length < 50 || parts.right.length < 50) return [];
    const build = (tris) => {
      const g = new THREE.BufferGeometry();
      for (const n of names) {
        const a = src.attributes[n], out = new Float32Array(tris.length * 3 * a.itemSize);
        let o = 0;
        for (const t of tris) for (let k = 0; k < 3; k++) for (let i = 0; i < a.itemSize; i++) out[o++] = a.getComponent(t + k, i);
        g.setAttribute(n, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
      }
      return g;
    };
    mesh.geometry = build(parts.body);
    const mat = mesh.material.clone(); mat.side = THREE.DoubleSide;
    return [['left', 1], ['right', -1]].map(([k, side]) => {
      const hinge = new THREE.Vector3(xCut * 0.95, yTop * 0.62, side * 0.0005);
      const g = build(parts[k]); g.translate(-hinge.x, -hinge.y, -hinge.z);
      const pivot = new THREE.Group(); pivot.position.copy(hinge); pivot.userData.side = side;
      const m = new THREE.Mesh(g, mat); m.name = 'Ladybug';          // taps on the wing cases count as the ladybug
      pivot.add(m); mesh.add(pivot);
      return pivot;
    });
  }

  hindWingTexture() {
    // amber, translucent membrane; strong leading-edge vein, fine radial veins, darker fold lines near the tip
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    const shape = new Path2D();
    shape.moveTo(4, 48);
    shape.bezierCurveTo(40, 6, 180, 2, 250, 30);
    shape.bezierCurveTo(258, 44, 240, 74, 200, 82);
    shape.bezierCurveTo(130, 94, 50, 84, 4, 48);
    const fill = g.createLinearGradient(0, 0, 256, 0);
    fill.addColorStop(0, 'rgba(150,95,45,0.75)'); fill.addColorStop(0.35, 'rgba(215,170,115,0.42)');
    fill.addColorStop(0.8, 'rgba(230,200,160,0.3)'); fill.addColorStop(1, 'rgba(160,110,70,0.45)');
    g.fillStyle = fill; g.fill(shape);
    g.save(); g.clip(shape);
    const sheen = g.createLinearGradient(0, 10, 0, 90);                 // faint iridescence across the membrane
    sheen.addColorStop(0, 'rgba(140,200,255,0.10)'); sheen.addColorStop(0.5, 'rgba(255,170,220,0.08)'); sheen.addColorStop(1, 'rgba(160,255,190,0.08)');
    g.fillStyle = sheen; g.fillRect(0, 0, 256, 96);
    g.strokeStyle = 'rgba(70,40,20,0.9)'; g.lineCap = 'round';
    g.lineWidth = 4; g.beginPath(); g.moveTo(4, 46); g.bezierCurveTo(60, 14, 170, 8, 248, 30); g.stroke();   // costa
    g.lineWidth = 1.4;
    for (const [y1, x2, y2] of [[50, 230, 44], [54, 205, 66], [58, 170, 80], [52, 120, 84]]) {
      g.beginPath(); g.moveTo(10, y1); g.quadraticCurveTo(x2 * 0.5, y1 + 2, x2, y2); g.stroke();
    }
    g.strokeStyle = 'rgba(90,55,30,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(170, 20); g.lineTo(215, 70); g.moveTo(190, 18); g.lineTo(228, 60); g.stroke();       // folds
    g.restore();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  buildHindWings() {
    // Each wing is a fan of three ghosted copies across its stroke: at 72 beats a second that is what a camera sees.
    const tex = this.hindWingTexture();
    const len = 0.0105, wid = 0.004;
    return [1, -1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(0.0022, 0.0034, side * 0.0012);
      pivot.userData.side = side;
      pivot.userData.blades = [0, 1, 2].map((i) => {
        const geo = new THREE.PlaneGeometry(len, wid);
        geo.translate(len / 2, 0, 0);                                     // root at the pivot
        geo.rotateX(-Math.PI / 2);                                        // lie flat (in the bug's XZ plane)
        geo.rotateY(side > 0 ? -(Math.PI / 2 + 0.35) : Math.PI / 2 + 0.35); // point out sideways, swept back
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: i === 1 ? 0.55 : 0.28, side: THREE.DoubleSide, depthWrite: false }));
        m.name = 'LadybugWing';
        pivot.add(m);
        return m;
      });
      this.mesh.add(pivot);
      return pivot;
    });
  }

  setWings(open, now) {
    // open: 0 = folded (resting), 1 = in flight
    const beat = Math.sin(now * 0.45);                                   // fast, deliberately aliased shimmer
    for (const p of this.elytra) {
      const s = p.userData.side;
      // wing cases lift ~40 deg and spread ~28 deg into a V, flapping gently with the hind wings
      p.rotation.set(s * open * (0.49 + 0.06 * beat), 0, -open * (0.7 + 0.05 * beat), 'ZXY');
    }
    for (const p of this.hind) {
      const s = p.userData.side;
      p.visible = open > 0.05;
      p.scale.setScalar(Math.max(open, 0.001));
      p.userData.blades.forEach((m, i) => {
        // three positions across the stroke (up, mid, down) + a quick flutter
        const a = (i - 1) * 0.55 + 0.12 * beat;
        m.rotation.set(s * a, 0, 0);
        m.material.opacity = (i === 1 ? 0.66 : 0.34) * open;
      });
    }
  }

  buildDust() {
    this.N = 420;
    const g = new THREE.BufferGeometry();
    this.dPos = new Float32Array(this.N * 3);
    this.dCol = new Float32Array(this.N * 3);
    this.dVel = new Float32Array(this.N * 3);
    this.dLife = new Float32Array(this.N);
    this.dSeed = new Float32Array(this.N).map(() => Math.random() * 100);
    g.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.dCol, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.0085, map: dustTexture(), vertexColors: true, transparent: true, depthWrite: false,
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
      this.dLife[i] -= dt / 2.4;
      for (let a = 0; a < 3; a++) this.dPos[i * 3 + a] += this.dVel[i * 3 + a] * dt;
      this.dVel[i * 3 + 1] -= 0.004 * dt;                    // settles slowly, like gilding dust
      const l = Math.max(this.dLife[i], 0);
      const tw = 0.55 + 0.45 * Math.sin(this.dSeed[i] + (1 - l) * 38);            // twinkle
      const f = 2.6 * Math.pow(l, 1.4) * tw;                                        // HDR-bright: blooms
      this.dCol[i * 3] = 1.0 * f; this.dCol[i * 3 + 1] = 0.8 * f; this.dCol[i * 3 + 2] = 0.45 * f;
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
        this.phases.push({ type: 'hover', dur: 4.2 });
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

  wander(visitViewer = false) {
    // visitViewer (a tap): first fly up to the viewer for a close-up, then set off on a random path
    if (!this.ready || this.flying) return;
    const options = [
      () => { const p = this.landing('Mooncake', 0.4 + Math.random() * 0.2, 0.4 + Math.random() * 0.2); return p && [{ to: p }, { rest: 2.5, turn: 0.6 }, { home: true }]; },
      () => { const p = this.landing('TrayFlowers', 0.35 + Math.random() * 0.3, 0.35 + Math.random() * 0.3); return p && [{ to: p, lift: 0.08 }, { rest: 3, turn: -0.5 }, { home: true }]; },
      () => { const p = this.landing('Lantern_Frame', 0.5, 0.5); return p && [{ to: p, lift: 0.05 }, { rest: 3.5, turn: 0.8 }, { home: true }]; },
      () => [{ via: (from) => this.aroundTea(from) }, { home: true }],
    ];
    for (let k = 0; k < 4; k++) {
      const plan = options[Math.floor(Math.random() * options.length)]();
      if (plan) { this.plan(visitViewer ? [{ camera: true }, ...plan] : plan); return; }
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
      this.peek = 0;
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
    if (ph.type !== 'hover') this.peek = 0;
    this.t += dt;
    const u = Math.min(this.t / ph.dur, 1);
    let wingTarget = 0;

    if (ph.type === 'emerge') {
      // steps out of the painting: grows from the canvas in a shimmer, then turns to face the room
      const k = smooth(u);
      this.obj.position.copy(ph.p);
      this.obj.scale.setScalar(Math.max(k, 0.001));
      this.orient(ph.n, UP, dt, 3);
      this.emit(ph.p, 4, 0.024 * (1 - k * 0.5), 0.014);
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
      this.emit(p, 2, 0.004, 0.005);
      wingTarget = u < 0.97 ? 1 : 0;
    } else if (ph.type === 'hover') {
      // hangs in the air before the viewer, then creeps right up to the lens face first, peers in, and backs off
      const cam = this.camera.position;
      const dir = ph.at.clone().sub(cam); const d0 = dir.length(); dir.normalize();
      const peek = Math.pow(Math.sin(Math.PI * THREE.MathUtils.smoothstep(u, 0.08, 0.92)), 2);
      // up close the face moves to the centre of the frame, ~2.5 cm from the lens (the head is ~1 cm ahead of the
      // body's origin), so it fills the view
      const centre = this.camera.getWorldDirection(new THREE.Vector3());
      const aim = dir.clone().lerp(centre, peek).normalize();
      const p = cam.clone().addScaledVector(aim, d0 - (d0 - 0.036) * peek);
      this.peek = peek;
      this.faceDistance = p.distanceTo(cam) - 0.011;
      p.y += 0.0022 * Math.sin(now * 0.004) * (1 - peek * 0.7); p.x += 0.0014 * Math.sin(now * 0.0023) * (1 - peek * 0.7);
      this.obj.position.copy(p);
      const toCam = cam.clone().sub(p); toCam.y *= 0.4 + 0.6 * peek;          // looks straight into the lens up close
      this.orient(toCam, UP, dt, 3 + 3 * peek);
      this.emit(p, 1, 0.005, 0.003);
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

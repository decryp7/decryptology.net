import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Lighting is baked in Cycles (scene.glb stores it as emissive maps with a black base colour);
// three.js adds only what changes with the viewpoint: reflections from env.hdr, captured in the same room.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;   // same curve as Blender's "Khronos PBR Neutral"
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080d);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 20);

// Views are framed for 4:3. On narrower screens keep the same horizontal field: widen the FOV a
// little, then pull the camera back for the rest so nothing is cropped and nothing gets distorted.
const BASE_FOV = 50, BASE_ASPECT = 4 / 3, MAX_FOV = 60, MAX_DISTANCE = 1.4;   // 50° = Blender hero cam (29mm lens, 4:3)
const halfTan = (deg) => Math.tan(THREE.MathUtils.degToRad(deg / 2));
let fitScale = 1;   // camera distance multiplier for the current aspect
function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const wantTan = halfTan(BASE_FOV) * Math.max(1, BASE_ASPECT / aspect);   // vertical half-tan that keeps the width
  camera.aspect = aspect;
  camera.fov = Math.min(MAX_FOV, THREE.MathUtils.radToDeg(2 * Math.atan(wantTan)));
  camera.updateProjectionMatrix();
  const prev = fitScale;
  fitScale = wantTan / halfTan(camera.fov);
  return fitScale / prev;
}
fitCamera();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.12;
controls.maxDistance = MAX_DISTANCE * fitScale;
controls.maxPolarAngle = THREE.MathUtils.degToRad(84);

// Blender (x, y, z) -> three (x, z, -y)
const b2t = (x, y, z) => new THREE.Vector3(x, z, -y);
const VIEWS = {
  hero: { pos: b2t(0.05, -0.34, 1.22), target: b2t(0.07, 0.1, 0.81) },
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const manager = new THREE.LoadingManager();
const bar = document.querySelector('#bar > i');
manager.onProgress = (_url, loaded, total) => { bar.style.width = `${(loaded / total) * 100}%`; };
manager.onLoad = () => document.getElementById('loading').classList.add('done');

new RGBELoader(manager).load('env.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
});

const clickable = [];
new GLTFLoader(manager).load('scene.glb', (gltf) => {
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.emissiveMap) {
      // Baked texel = full diffuse lighting; keep only the specular layer live.
      m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      m.emissiveMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
      m.envMapIntensity = 1.0;
    }
    if (/^(Mooncake|Poster_Art|GiftBox)/.test(o.name)) clickable.push(o);
  });
  scene.add(root);

  // Fly-to views framed from each object's bounds.
  const frame = (name, dir, dist) => {
    const obj = root.getObjectByName(name);
    if (!obj) return null;
    const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
    return { target: c, pos: c.clone().add(dir.normalize().multiplyScalar(dist)) };
  };
  VIEWS.cake = frame('Mooncake', new THREE.Vector3(0.15, 0.55, 1), 0.24);
  VIEWS.poster = frame('Poster_Art', new THREE.Vector3(0.05, 0.12, 1), 0.5);
  VIEWS.box = frame('GiftBox', new THREE.Vector3(0.1, 1.6, 1), 0.36);
  flyTo('hero', 0);
});

// ---------------------------------------------------------------- camera moves
let tween = null;
function flyTo(name, ms = 1100) {
  const view = VIEWS[name];
  if (!view) return;
  const v = { target: view.target, pos: view.pos.clone().sub(view.target).multiplyScalar(fitScale).add(view.target) };
  if (ms === 0) {
    camera.position.copy(v.pos);
    controls.target.copy(v.target);
    controls.update();
    return;
  }
  tween = { t0: performance.now(), ms, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), v };
}

function stepTween(now) {
  if (!tween) return;
  const k = Math.min((now - tween.t0) / tween.ms, 1);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  camera.position.lerpVectors(tween.fromPos, tween.v.pos, e);
  controls.target.lerpVectors(tween.fromTarget, tween.v.target, e);
  if (k === 1) tween = null;
}

document.querySelectorAll('#hud button').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.view)));

const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;   // was a drag
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObjects(clickable, false)[0];
  if (!hit) return;
  const n = hit.object.name;
  flyTo(n.startsWith('Mooncake') ? 'cake' : n.startsWith('Poster') ? 'poster' : 'box');
});

window.addEventListener('resize', () => {
  const k = fitCamera();
  controls.maxDistance = MAX_DISTANCE * fitScale;
  if (tween) tween.v.pos.sub(tween.v.target).multiplyScalar(k).add(tween.v.target);
  camera.position.sub(controls.target).multiplyScalar(k).add(controls.target);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop((now) => {
  stepTween(now);
  controls.update();
  composer.render();
});

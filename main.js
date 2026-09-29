import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { Ladybug } from './ladybug.js?v=202609290903';
import { Steam } from './steam.js?v=202609290825';

// Lighting is baked in Cycles (scene.glb stores it as emissive maps with a black base colour);
// three.js adds only what changes with the viewpoint: reflections from env.hdr, captured in the same room.

// If the 3D view can't run (no WebGL, a failed download, a lost GPU context), keep the still photo.
let renderer;
function showStill(reason) {
  console.warn('3D scene unavailable, showing the still photo:', reason);
  const why = String(reason && reason.message || reason);
  document.body.dataset.stillReason = why;
  const retry = document.getElementById('retry3d');
  if (retry) retry.title = 'Showing a photo: ' + why;
  if (new URLSearchParams(location.search).has('debug') && retry) retry.textContent = 'Try 3D view — ' + why;
  document.body.classList.add('still');
  document.getElementById('loading').classList.add('done');
  if (renderer) renderer.domElement.style.display = 'none';   // three.js sets an inline display: block
}

// Phones and tablets get lighter textures (1024 px) and a lower pixel ratio: iOS kills a tab that uses too much
// graphics memory ("A problem repeatedly occurred"), and the full set needs ~430 MB.
const MOBILE = matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod|Android/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Crash guard: a flag set while the 3D view runs, cleared when the page is left normally. If the tab crashed,
// the flag survives the automatic reload, so show the still photo instead of crashing again.
// The flag only counts while the page is on screen: iOS silently discards background tabs (not a crash), so it is
// cleared whenever the page is hidden, and a flag older than two minutes is ignored.
const CRASH_FLAG = 'scene3d-running';
let crashedBefore = false;
try {
  const t = Number(sessionStorage.getItem(CRASH_FLAG));
  crashedBefore = t > 0 && Date.now() - t < 120000;
  const mark = () => sessionStorage.setItem(CRASH_FLAG, String(Date.now()));
  const clear = () => sessionStorage.removeItem(CRASH_FLAG);
  mark();
  addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => (document.hidden ? clear() : mark()));
} catch { /* storage unavailable: no guard */ }
document.getElementById('retry3d')?.addEventListener('click', () => {
  try { sessionStorage.removeItem(CRASH_FLAG); } catch {}
  location.reload();
});
if (crashedBefore) {
  showStill('the 3D view crashed this tab last time');
  throw new Error('3D view skipped after a crash');
}

try {
  renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, powerPreference: 'high-performance' });
} catch (e) {
  showStill(e);
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;   // same curve as Blender's "Khronos PBR Neutral"
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
// iOS may take the GPU context away (e.g. while Safari is in the background) and hand it back; only give up if
// it isn't restored within a few seconds of the page being visible again.
let contextTimer = null;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();                                           // ask for it back
  const check = () => { contextTimer = setTimeout(() => showStill('WebGL context lost and not restored'), 4000); };
  if (document.hidden) document.addEventListener('visibilitychange', function once() {
    if (!document.hidden) { document.removeEventListener('visibilitychange', once); check(); } });
  else check();
});
renderer.domElement.addEventListener('webglcontextrestored', () => { clearTimeout(contextTimer); contextTimer = null; });
// Software WebGL (no GPU: SwiftShader, llvmpipe...) takes seconds per frame for this scene and freezes the page,
// e.g. in PageSpeed's test machines. Keep the still photo there. (?3d forces the 3D view, for testing.)
const FORCE_3D = new URLSearchParams(location.search).has('3d');
{
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  if (!FORCE_3D && /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(gpu)) {
    showStill(`software rendering (${gpu})`);
    renderer.dispose();
    throw new Error('3D view skipped: no GPU');
  }
}
// The canvas stays invisible (the still photo shows through) until the scene has loaded, then fades in.
renderer.domElement.style.opacity = '0';
renderer.domElement.style.transition = 'opacity .8s ease';

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
// The page scrolls (career below the scene): the wheel scrolls the page, pinch / ctrl-wheel zooms the scene,
// and on touch screens vertical swipes scroll while sideways swipes turn the scene.
controls.enableZoom = false;
renderer.domElement.style.touchAction = 'pan-y';
renderer.domElement.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;                       // trackpad pinch arrives as ctrl + wheel
  e.preventDefault();
  const offset = camera.position.clone().sub(controls.target);
  const d = THREE.MathUtils.clamp(offset.length() * Math.exp(e.deltaY * 0.01), controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).addScaledVector(offset.normalize(), d);
}, { passive: false });
let pinch = null;                                               // two-finger pinch on touch screens
renderer.domElement.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
}, { passive: true });
renderer.domElement.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2 || !pinch) return;
  const now = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const offset = camera.position.clone().sub(controls.target);
  const d = THREE.MathUtils.clamp(offset.length() * (pinch / now), controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).addScaledVector(offset.normalize(), d);
  pinch = now;
}, { passive: true });
renderer.domElement.addEventListener('touchend', () => { pinch = null; }, { passive: true });
// Pause the scene while the career section covers it.
let sceneVisible = true;
new IntersectionObserver(([e]) => { sceneVisible = e.isIntersecting; }, { threshold: 0.02 }).observe(document.getElementById('hero'));
controls.minDistance = 0.12;
controls.maxDistance = MAX_DISTANCE * fitScale;
controls.maxPolarAngle = THREE.MathUtils.degToRad(84);

// Blender (x, y, z) -> three (x, z, -y)
const b2t = (x, y, z) => new THREE.Vector3(x, z, -y);
const VIEWS = {
  hero: { pos: b2t(0.0, -0.71, 1.11), target: b2t(0.03, 0.06, 0.95) },   // = HERO_CAM in build_scene.py
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 0.92);
composer.addPass(bloom);
// Macro depth of field, only while the ladybug peers into the lens.
const macro = new BokehPass(scene, camera, { focus: 0.03, aperture: 0.0, maxblur: 0.014 });
macro.enabled = false;
composer.addPass(macro);
composer.addPass(new OutputPass());
// Photographic finish: a gentle lens vignette and fine, moving film grain (after tone mapping, in display space).
const lens = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float aspect; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      c.rgb *= mix(1.0, 0.72, smoothstep(0.35, 0.95, length(d)));           // vignette
      float g = hash(vUv * 1000.0 + fract(time) * 100.0) - 0.5;
      c.rgb += g * 0.025 * (1.0 - c.rgb);                                   // grain, strongest in shadows
      gl_FragColor = c;
    }`,
});
composer.addPass(lens);

const manager = new THREE.LoadingManager();
const bar = document.querySelector('#bar > i');
manager.onProgress = (_url, loaded, total) => { bar.style.width = `${(loaded / total) * 100}%`; };
manager.onLoad = () => {
  document.getElementById('loading').classList.add('done');
  if (!document.body.classList.contains('still')) renderer.domElement.style.opacity = '1';
};

new RGBELoader(manager).load('env.hdr?v=202609290729', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
}, undefined, (e) => console.warn('No reflections (env.hdr failed):', e));

const clickable = [];
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
new GLTFLoader(manager).setDRACOLoader(draco).load((MOBILE ? 'scene-mobile.glb' : 'scene.glb') + '?v=202609290729', (gltf) => {
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
  VIEWS.poster = frame('Poster_Art', new THREE.Vector3(0.05, 0.12, 1), 0.95);
  VIEWS.box = frame('GiftBox', new THREE.Vector3(0.1, 1.6, 1), 0.36);
  flyTo('hero', 0);

  steam = new Steam(root, scene);

  // The ladybug: steps out of the painting a moment after the scene appears, then wanders now and then.
  ladybug = new Ladybug(root, scene, camera);
  if (FORCE_3D) { window.__ladybug = ladybug; window.__cam = camera; window.__controls = controls; }   // for testing
  if (ladybug.ready) {
    ladybug.obj.traverse((o) => { if (o.isMesh && o.name.startsWith('Ladybug')) clickable.push(o); });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTimeout(() => { if (!document.body.classList.contains('still')) ladybug.intro(); }, 2500);
      ladybug.scheduleWander(performance.now() + 20000);
    }
  }
}, undefined, (e) => showStill(e));

let ladybug = null;
let steam = null;

// ---------------------------------------------------------------- camera moves
let tween = null;
function flyTo(name, ms = 1100) {
  const view = VIEWS[name];
  if (!view) return;
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
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

document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.view)));

// Free orbiting leaves the preset views; the hint fades once someone has started exploring.
const hint = document.getElementById('hint');
controls.addEventListener('start', () => {
  document.querySelectorAll('#views button.active').forEach((b) => b.classList.remove('active'));
  hint.classList.add('gone');
});
setTimeout(() => hint.classList.add('gone'), 12000);

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
  if (ladybug && ladybug.ready && n.startsWith('Ladybug')) { ladybug.flying || ladybug.wander(true); return; }
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

// Watchdog: once the scene is in, time the first frames; if the device can't keep up (typical frame > 0.4 s),
// stop the 3D view before it freezes the page and keep the still photo.
let frameTimes = null, lastFrame = 0;
let warmup = 0;
manager.onLoad = ((onLoad) => () => { onLoad(); frameTimes = []; warmup = 45; })(manager.onLoad);

renderer.setAnimationLoop((now) => {
  if (frameTimes && !FORCE_3D && sceneVisible && !document.hidden) {
    if (warmup > 0) warmup--;                                   // first frames compile shaders / upload textures
    else if (lastFrame) frameTimes.push(now - lastFrame);
    if (frameTimes.length >= 30) {
      const typical = [...frameTimes].sort((a, b) => a - b)[15];
      frameTimes = null;
      if (typical > 400) {
        renderer.setAnimationLoop(null);
        showStill(`too slow to render (${Math.round(typical)} ms per frame)`);
        return;
      }
    }
  }
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
  lastFrame = now;
  if (!sceneVisible) return;                                    // scrolled away: skip rendering entirely
  if (ladybug) {
    ladybug.update(dt, now);
    const pk = ladybug.peek || 0;
    macro.enabled = pk > 0.02;
    if (macro.enabled) {
      macro.uniforms.focus.value = Math.max(ladybug.faceDistance || 0.03, 0.012);
      macro.uniforms.aperture.value = 0.012 * pk;
    }
  }
  if (steam) steam.update(dt, now);
  lens.uniforms.time.value = now / 1000;
  lens.uniforms.aspect.value = window.innerWidth / window.innerHeight;
  stepTween(now);
  controls.update();
  composer.render();
});

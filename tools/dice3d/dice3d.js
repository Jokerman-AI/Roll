// Real 3D dice, drawn with three.js (MIT). Built into vendor/dice3d.js by tools/build-dice3d.mjs.
//
// One transparent canvas floats over the page and draws every die that is on screen: bevelled bodies with real
// lighting and reflections, pips pressed into the faces and a soft shadow. The page keeps its own (invisible) dice for taps, keyboard and screen readers; this only draws.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// BoxGeometry face order is +x, -x, +y, -y, +z, -z. Opposite faces add up to seven, and 1 faces the viewer.
const FACE_AT = [3, 4, 2, 5, 1, 6];
const NORMAL = { 1: [0, 0, 1], 6: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0], 2: [0, 1, 0], 5: [0, -1, 0] };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => 1 - (1 - t) ** 3;
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- colours ---------- */
const hex = (c, fallback = '#e5484d') => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : fallback);
function mix(a, b, t) {
  const pa = parseInt(hex(a).slice(1), 16);
  const pb = parseInt(hex(b).slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}
/* ---------- the look of the die ---------- */
const BEVEL = 0.15;
const MATERIAL = { roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.25 };

/* ---------- textures drawn on the spot ---------- */
const mk = (n) => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
const pipXY = (i, n) => [(0.25 + (i % 3) * 0.25) * n, (0.25 + Math.floor(i / 3) * 0.25) * n];

/** The layers of one face: colour, and a bump map so the pips look pressed in. */
function drawFace(look, face) {
  const n = 256;
  const map = mk(n); const bump = mk(n);
  const c = map.getContext('2d'); const b = bump.getContext('2d');
  c.fillStyle = look.body; c.fillRect(0, 0, n, n);
  b.fillStyle = '#9a9a9a'; b.fillRect(0, 0, n, n);
  const radius = n * 0.085;
  for (const i of PIPS[face]) {
    const [x, y] = pipXY(i, n);
    b.save(); b.shadowColor = '#000'; b.shadowBlur = n * 0.03; b.fillStyle = '#000'; b.beginPath(); b.arc(x, y, radius, 0, Math.PI * 2); b.fill(); b.restore();
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(x, y, radius * 1.08, 0, Math.PI * 2); c.fill();
    c.fillStyle = look.pip; c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
  }
  return { map, bump };
}

/* ---------- shared pieces ---------- */
let R3; // the renderer, scene and everything shared
const texCache = new Map();
const tex = (canvas, srgb = true) => {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};
function faceTextures(look, face) {
  const key = `${look.key}|${face}`;
  if (!texCache.has(key)) {
    const f = drawFace(look, face);
    texCache.set(key, { map: tex(f.map, true), bump: tex(f.bump, false) });
    if (texCache.size > 240) { const first = texCache.keys().next().value; const old = texCache.get(first); Object.values(old).forEach((t) => t.dispose()); texCache.delete(first); }
  }
  return texCache.get(key);
}

const geoCache = new Map();
function geometry() {
  if (!geoCache.has('die')) geoCache.set('die', new RoundedBoxGeometry(1, 1, 1, 5, BEVEL));
  return geoCache.get('die');
}

let shadowTex;
function blobShadow() {
  if (shadowTex) return shadowTex;
  const c = mk(64); const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 6, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.65)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); shadowTex = tex(c, true); return shadowTex;
}

/* ---------- the stage ---------- */
function init() {
  if (R3) return R3;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:5;display:none';
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'default', premultipliedAlpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.78;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-300, 420, 500);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xaec8ff, 0.7);
  fill.position.set(400, -120, 300);
  scene.add(fill);
  const camera = new THREE.PerspectiveCamera(28, 1, 10, 4000);
  document.body.appendChild(canvas);
  R3 = { canvas, renderer, scene, camera, dice: new Map(), items: [], size: [0, 0], dpr: 1, raf: 0, last: 0, calm: false };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  return R3;
}

function makeDie(key) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry(), []);
  group.add(mesh);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobShadow(), transparent: true, depthWrite: false, opacity: 0.55 }));
  R3.scene.add(group, shadow);
  return { key, group, mesh, shadow, face: 1, q: new THREE.Quaternion(), yaw: rand(-0.25, 0.25), anim: null, token: -1, size: 50, pos: new THREE.Vector3(), lookKey: '' };
}

function faceQuat(face, yaw) {
  const n = new THREE.Vector3(...NORMAL[face]);
  const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, 1));
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.36, yaw, 'XYZ'));
  return tilt.multiply(q);
}

/** Give a die its materials (rebuilt only when its colours change). */
function dress(d, look) {
  if (d.lookKey === look.key) return;
  d.lookKey = look.key;
  d.mesh.material = FACE_AT.map((face) => {
    const t = faceTextures(look, face);
    const m = new THREE.MeshPhysicalMaterial({ envMapIntensity: 0.5, map: t.map, bumpMap: t.bump, bumpScale: 4.5, ...MATERIAL });
    m.userData.t = false; m.userData.o = 1;
    return m;
  });
}

function lookFor(body, pip) {
  const b = hex(body);
  const p = hex(pip, '#ffffff');
  return { body: b, pip: p, key: `${b}|${p}` };
}

/* ---------- animation ---------- */
function startRoll(d, spec) {
  const axis = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-0.6, 0.6)).normalize();
  d.anim = { t0: performance.now() + (spec.delay || 0), dur: Math.max(300, spec.dur || 800), dx: spec.dx || 0, axis, turns: rand(5, 8) * (Math.random() < 0.5 ? -1 : 1), bounced: false };
}

function poseDie(d, now, dt) {
  const base = faceQuat(d.face, d.yaw);
  const target = d.target; // where the page says this die is (px, canvas-local, y up)
  let ox = 0; let oy = 0; let sc = 1; let vis = true;
  d.q.copy(base);
  if (d.spin) d.q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (now / 1000) * 0.9));
  if (d.anim) {
    const a = d.anim;
    const t = (now - a.t0) / a.dur;
    if (t < 0) { vis = false; } else if (t >= 1) { d.anim = null; } else {
      const e = ease(t);
      const spin = new THREE.Quaternion().setFromAxisAngle(a.axis, (1 - e) * a.turns * Math.PI);
      d.q.premultiply(spin);
      // fly in, land, bounce, settle (the same beat as the page's own tumble)
      const hop = t < 0.55 ? 1 - ease(t / 0.55) : t < 0.72 ? Math.sin(((t - 0.55) / 0.17) * Math.PI) * 0.22 : t < 0.88 ? Math.sin(((t - 0.72) / 0.16) * Math.PI) * 0.06 : 0;
      oy = hop * 150;
      ox = a.dx * (t < 0.55 ? 1 - ease(t / 0.55) : 0);
      sc = t < 0.55 ? 0.55 + 0.57 * ease(t / 0.55) : 1.12 - 0.12 * ease((t - 0.55) / 0.45);
    }
  }
  d.group.visible = vis;
  d.visible = vis;
  d.group.quaternion.copy(d.q);
  d.pos.set(target.x + ox, target.y + oy, 0);
  d.group.position.copy(d.pos);
  d.group.scale.setScalar(d.size * sc);
  const lift = clamp(oy / 150, 0, 1);
  d.shadow.visible = vis; d.shadow.position.set(target.x + d.size * 0.06 + ox * 0.3, target.y - d.size * 0.12, -d.size * 0.6);
  d.shadow.scale.set(d.size * (1.35 + lift * 0.5), d.size * (1.25 + lift * 0.4), 1);
  d.shadow.material.opacity = 0.5 * (1 - lift * 0.6);
}

function frame(now) {
  R3.raf = 0;
  if (!R3.items.length) return;
  const dt = Math.min(0.05, (now - (R3.last || now)) / 1000);
  R3.last = now;
  layout();
  let busy = false;
  for (const d of R3.dice.values()) { poseDie(d, now, dt); if (d.anim) busy = true; }
  R3.renderer.render(R3.scene, R3.camera);
  const live = [...R3.dice.values()].some((x) => x.spin) && !R3.calm && !document.hidden;
  if (busy || live) R3.raf = requestAnimationFrame(frame); else R3.last = 0;
}
const kick = () => { if (R3 && !R3.raf && R3.items.length) R3.raf = requestAnimationFrame(frame); };

/** Place the canvas over the dice, and put every die where its page element is. */
function layout() {
  const items = R3.items;
  const rects = items.map((it) => it.el.getBoundingClientRect());
  let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
  rects.forEach((q) => { l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
  const padX = 50; const padTop = 180; const padBottom = 50;
  l = Math.max(0, l - padX); t = Math.max(0, t - padTop); r = Math.min(innerWidth, r + padX); b = Math.min(innerHeight, b + padBottom);
  const W = Math.max(2, Math.round(r - l)); const H = Math.max(2, Math.round(b - t));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (R3.size[0] !== W || R3.size[1] !== H || R3.dpr !== dpr) {
    R3.size = [W, H]; R3.dpr = dpr;
    R3.renderer.setPixelRatio(dpr); R3.renderer.setSize(W, H, false);
    R3.canvas.style.width = `${W}px`; R3.canvas.style.height = `${H}px`;
    R3.camera.aspect = W / H;
    const fov = R3.camera.fov * Math.PI / 180;
    R3.camera.position.set(0, 0, (H / 2) / Math.tan(fov / 2));
    R3.camera.updateProjectionMatrix();
  }
  R3.canvas.style.left = `${l}px`; R3.canvas.style.top = `${t}px`;
  const cx = l + W / 2; const cy = t + H / 2;
  items.forEach((it, i) => {
    const q = rects[i];
    const d = it.die;
    d.size = q.width * 0.97;
    d.target = { x: q.left + q.width / 2 - cx, y: -(q.top + q.height / 2 - cy) };
  });
}

/* ---------- what the page calls ---------- */
window.RollDice3D = {
  /** Can this device draw WebGL? */
  available() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
  },
  /**
   * Draw these dice. dice: [{ el, key, face, color, pip, rolling, token, delay, dur, dx }]
   * Returns false if 3D could not start (the page then keeps its CSS dice).
   */
  show({ dice, calm, z = 5 }) {
    try {
      init();
      R3.calm = !!calm;
      R3.canvas.style.zIndex = String(z);
      const keep = new Set();
      R3.items = dice.map((spec) => {
        keep.add(spec.key);
        let d = R3.dice.get(spec.key);
        if (!d) { d = makeDie(spec.key); R3.dice.set(spec.key, d); }
        dress(d, lookFor(spec.color, spec.pip));
        d.spin = !!spec.spin;
        if (d.dim !== !!spec.dim) { d.dim = !!spec.dim; d.mesh.material.forEach((m) => { m.transparent = m.userData.t || d.dim; m.opacity = d.dim ? 0.55 : m.userData.o; m.needsUpdate = true; }); }
        if (spec.face !== d.face) d.face = spec.face;
        if (spec.rolling && spec.token !== d.token) startRoll(d, spec);
        if (!spec.rolling) d.anim = null;
        d.token = spec.rolling ? spec.token : -1;
        return { el: spec.el, die: d };
      });
      for (const [k, d] of R3.dice) if (!keep.has(k)) { R3.scene.remove(d.group, d.shadow); R3.dice.delete(k); }
      R3.canvas.style.display = R3.items.length ? 'block' : 'none';
      if (!R3.items.length) return true;
      R3.last = 0;
      layout();
      for (const d of R3.dice.values()) poseDie(d, performance.now(), 0);
      kick();
      return true;
    } catch (err) {
      console.warn('3D dice unavailable', err);
      return false;
    }
  },
  /** Draw again (for example after the page scrolled or resized). */
  refresh() { if (R3 && R3.items.length) { if (!R3.raf) { R3.raf = requestAnimationFrame(frame); } } },
  hide() { if (R3) { R3.items = []; R3.canvas.style.display = 'none'; } },
  /** For tests: which number is facing the viewer on each die, and where it is. */
  debug() {
    if (!R3) return [];
    return [...R3.dice.values()].map((d) => {
      let best = 0; let who = 0;
      for (const f of [1, 2, 3, 4, 5, 6]) {
        const v = new THREE.Vector3(...NORMAL[f]).applyQuaternion(d.q);
        if (v.z > best) { best = v.z; who = f; }
      }
      return { key: d.key, face: d.face, facing: who, size: Math.round(d.size), animating: !!d.anim };
    });
  },
};

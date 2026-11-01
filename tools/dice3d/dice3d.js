// Real 3D dice, drawn with three.js (MIT). Built into vendor/dice3d.js by tools/build-dice3d.mjs.
//
// One transparent canvas floats over the page and draws every die that is on screen: bevelled bodies with real
// lighting and reflections, pips pressed into the faces, and a different material, glow and particle effect for each
// look. The page keeps its own (invisible) dice for taps, keyboard and screen readers; this only draws.
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
const lum = (c) => { const p = parseInt(hex(c).slice(1), 16); return (0.299 * (p >> 16) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255)) / 255; };

/* ---------- how each look is made ---------- */

/** Material settings, bevel and extras for every look. */
function recipe(skin) {
  const R = {
    classic: { r: 0.15, m: { roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.25 } },
    sharp: { r: 0.035, m: { roughness: 0.42, clearcoat: 0.4 }, shape: 'square' },
    bubble: { r: 0.34, m: { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }, pipScale: 1.2 },
    glass: { r: 0.15, m: { roughness: 0.05, clearcoat: 1, metalness: 0, transparent: true, opacity: 0.6 }, glass: true },
    gem: { r: 0.05, m: { roughness: 0.04, metalness: 0.15, clearcoat: 1, iridescence: 0.5, flatShading: true }, facets: true },
    pixel: { r: 0.02, m: { roughness: 0.95 }, shape: 'square', nearest: true },
    fire: { r: 0.15, m: { roughness: 0.45, clearcoat: 0.3 }, flame: true, glow: '#ff7a1a', particles: 'ember', anim: true },
    ice: { r: 0.17, m: { roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.72 }, frost: true, glow: '#8fdcff', particles: 'sparkle', anim: true, glass: true },
    prism: { r: 0.15, m: { roughness: 0.18, metalness: 0.25, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [180, 900] }, rainbow: true, glow: '#ff7ad9', particles: 'rainbow', anim: true },
    neonglow: { r: 0.15, m: { roughness: 0.5 }, neon: true, glowOwn: true, anim: true },
    gold: { r: 0.15, m: { roughness: 0.16, metalness: 1, clearcoat: 0.4 }, gold: true, glow: '#ffd34d', particles: 'glint', anim: true },
    obsidian: { r: 0.12, m: { roughness: 0.06, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 }, dark: true, glowOwn: true, anim: true },
    galaxy: { r: 0.15, m: { roughness: 0.4 }, stars: true, glow: '#8f6bff', particles: 'stars', anim: true },
    lightning: { r: 0.14, m: { roughness: 0.25, clearcoat: 1 }, bolt: true, glow: '#7bbcff', anim: true },
  };
  return R[skin] || R.classic;
}

/* ---------- textures drawn on the spot ---------- */
const mk = (n) => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
const SHAPES = {
  square: [[0, 0], [1, 0], [1, 1], [0, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  star: [[0.5, 0], [0.62, 0.36], [1, 0.38], [0.7, 0.6], [0.8, 1], [0.5, 0.76], [0.2, 1], [0.3, 0.6], [0, 0.38], [0.38, 0.36]],
  heart: [[0.5, 1], [0.08, 0.55], [0, 0.3], [0.1, 0.08], [0.3, 0], [0.5, 0.18], [0.7, 0], [0.9, 0.08], [1, 0.3], [0.92, 0.55]],
  hex: [[0.25, 0.05], [0.75, 0.05], [1, 0.5], [0.75, 0.95], [0.25, 0.95], [0, 0.5]],
};
function pipPath(ctx, x, y, r, shape) {
  ctx.beginPath();
  if (!SHAPES[shape]) { ctx.arc(x, y, r, 0, Math.PI * 2); return; }
  SHAPES[shape].forEach(([px, py], i) => { const X = x + (px - 0.5) * 2 * r; const Y = y + (py - 0.5) * 2 * r; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
  ctx.closePath();
}
const pipXY = (i, n) => [(0.25 + (i % 3) * 0.25) * n, (0.25 + Math.floor(i / 3) * 0.25) * n];

/** A flowing, vertically repeating pattern (flames, nebula, bolts) so scrolling it never shows a seam. */
function flowTexture(kind) {
  const n = 128;
  const c = mk(n);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  const T = Math.PI * 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n;
    const v = y / n;
    let a;
    if (kind === 'flame') {
      const w = Math.sin(T * (v * 2 + 0.35 * Math.sin(T * (u * 3 + v)))) * 0.5 + 0.5;
      const w2 = Math.sin(T * (v * 3 - u * 2 + 0.2 * Math.sin(T * u * 5))) * 0.5 + 0.5;
      a = clamp(w * w2 * 1.6, 0, 1);
    } else { // nebula
      a = Math.sin(T * (u * 2 + 0.4 * Math.sin(T * v * 2))) * Math.sin(T * (v * 2 + 0.3 * Math.sin(T * u * 3))) * 0.5 + 0.5;
      a = a * a;
    }
    const k = (y * n + x) * 4;
    const g = Math.round(a * 255); img.data[k] = g; img.data[k + 1] = g; img.data[k + 2] = g; img.data[k + 3] = 255; // glow strength lives in the colour, since a glow map ignores transparency
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** All the layers of one face: colour, bump (the pips are pressed in), glow and shininess. */
function drawFace(look, face) {
  const n = 256;
  const R = look.rec;
  const body = look.body;
  const pip = R.pipOverride || (R.gold ? mix(body, '#2a1700', 0.7) : look.pip);
  const map = mk(n); const bump = mk(n); const emis = mk(n);
  const c = map.getContext('2d'); const b = bump.getContext('2d'); const e = emis.getContext('2d');
  // body colour
  let base = body;
  if (R.gold) base = mix('#d9a032', body, 0.22);
  if (R.dark) base = mix('#07070c', body, 0.12);
  if (R.glass) base = mix(body, '#ffffff', 0.12);
  if (R.frost) base = mix('#9fd8f5', body, 0.2);
  if (R.stars) base = mix('#0c0624', body, 0.16);
  if (R.flame) base = mix('#2a0a04', body, 0.3);
  if (R.bolt) base = mix('#0a1230', body, 0.12);
  if (R.neon) base = mix('#05050a', body, 0.1);
  c.fillStyle = base; c.fillRect(0, 0, n, n);
  if (R.gold) {
    const g = c.createLinearGradient(0, 0, n, n);
    g.addColorStop(0, '#fff2b0'); g.addColorStop(0.35, '#d99a1e'); g.addColorStop(0.65, '#ffe08a'); g.addColorStop(1, '#b7791a');
    c.globalAlpha = 0.7; c.fillStyle = g; c.fillRect(0, 0, n, n); c.globalAlpha = 1;
  }
  if (R.frost) {
    for (let k = 0; k < 90; k++) { c.strokeStyle = `rgba(255,255,255,${rand(0.05, 0.3)})`; c.lineWidth = rand(0.5, 2); c.beginPath(); const x = rand(0, n); const y = rand(0, n); const a = rand(0, 6.28); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * rand(10, 50), y + Math.sin(a) * rand(10, 50)); c.stroke(); }
  }
  if (R.facets) {
    c.globalAlpha = 0.28; c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, 0); c.lineTo(n * 0.6, 0); c.lineTo(0, n * 0.6); c.fill();
    c.fillStyle = '#000'; c.beginPath(); c.moveTo(n, n); c.lineTo(n * 0.35, n); c.lineTo(n, n * 0.35); c.fill(); c.globalAlpha = 1;
  }
  if (R.stars) {
    for (let k = 0; k < 70; k++) { c.fillStyle = `rgba(255,255,255,${rand(0.4, 1)})`; c.beginPath(); c.arc(rand(0, n), rand(0, n), rand(0.6, 1.8), 0, 6.28); c.fill(); }
  }
  if (R.rainbow) {
    const g = c.createLinearGradient(0, 0, n, n);
    ['#ff5f6d', '#ffc371', '#fff176', '#7bffb2', '#6fc7ff', '#c79bff', '#ff7ad9'].forEach((col, i) => g.addColorStop(i / 6, col));
    c.globalAlpha = 0.35; c.fillStyle = g; c.fillRect(0, 0, n, n); c.globalAlpha = 1;
  }
  // bump: grey is flat, darker is deeper
  b.fillStyle = '#9a9a9a'; b.fillRect(0, 0, n, n);
  if (R.frost) { for (let k = 0; k < 600; k++) { b.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},.08)`; b.fillRect(rand(0, n), rand(0, n), rand(1, 4), rand(1, 4)); } }
  // glow layer (black = no glow)
  e.fillStyle = '#000'; e.fillRect(0, 0, n, n);
  const radius = n * 0.085 * (R.pipScale || 1);
  const shape = R.shape || 'round';
  for (const i of PIPS[face]) {
    const [x, y] = pipXY(i, n);
    // dent in the bump map
    b.save(); b.shadowColor = '#000'; b.shadowBlur = n * 0.03; b.fillStyle = '#000'; pipPath(b, x, y, radius, shape); b.fill(); b.restore();
    // coloured pip with a darker rim
    c.save(); pipPath(c, x, y, radius * 1.08, shape); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill(); c.restore();
    c.save(); pipPath(c, x, y, radius, shape); c.fillStyle = pip; c.fill(); c.restore();
    if (R.neon || R.dark || R.stars || R.bolt || R.fire) {
      e.save(); e.shadowColor = R.neon || R.dark ? body : '#bcd9ff'; e.shadowBlur = n * 0.05; e.fillStyle = '#fff'; pipPath(e, x, y, radius * 0.8, shape); e.fill(); e.restore();
    }
  }
  if (R.neon) { // lit tube round the edge of the face
    e.strokeStyle = body; e.lineWidth = n * 0.035; e.shadowColor = body; e.shadowBlur = n * 0.06; e.strokeRect(n * 0.06, n * 0.06, n * 0.88, n * 0.88);
    c.strokeStyle = '#fff'; c.lineWidth = n * 0.02; c.strokeRect(n * 0.06, n * 0.06, n * 0.88, n * 0.88);
  }
  if (R.dark) { e.strokeStyle = body; e.lineWidth = n * 0.02; e.shadowColor = body; e.shadowBlur = n * 0.05; e.strokeRect(n * 0.05, n * 0.05, n * 0.9, n * 0.9); }
  return { map, bump, emis };
}

/* ---------- shared pieces ---------- */
/** Light added on top of the page: colour is added, but the canvas's own transparency is left alone. */
const GLOW_BLEND = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
let R3; // the renderer, scene and everything shared
const texCache = new Map();
const tex = (canvas, srgb = true, nearest = false) => {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; }
  return t;
};
const flows = {};
const flowTex = (kind) => {
  if (!flows[kind]) { const t = tex(flowTexture(kind), true); t.wrapS = t.wrapT = THREE.RepeatWrapping; flows[kind] = t; }
  return flows[kind];
};

function faceTextures(look, face) {
  const key = `${look.key}|${face}`;
  if (!texCache.has(key)) {
    const f = drawFace(look, face);
    texCache.set(key, { map: tex(f.map, true, look.rec.nearest), bump: tex(f.bump, false, look.rec.nearest), emis: tex(f.emis, true) });
    if (texCache.size > 240) { const first = texCache.keys().next().value; const old = texCache.get(first); Object.values(old).forEach((t) => t.dispose()); texCache.delete(first); }
  }
  return texCache.get(key);
}

const geoCache = new Map();
function geometry(r, seg) {
  const key = `${r}|${seg}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(1, 1, 1, seg, r));
  return geoCache.get(key);
}

let softDot; let shadowTex;
function dotTexture() {
  if (softDot) return softDot;
  const c = mk(64); const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); softDot = tex(c, true); return softDot;
}
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
  const glowLight = new THREE.PointLight(0xffffff, 0, 700, 1.4);
  glowLight.position.set(0, 0, 260);
  scene.add(glowLight);
  const camera = new THREE.PerspectiveCamera(28, 1, 10, 4000);
  document.body.appendChild(canvas);
  R3 = { canvas, renderer, scene, camera, glowLight, dice: new Map(), items: [], size: [0, 0], dpr: 1, running: false, raf: 0, last: 0, particles: null, flowDirty: 0, look: null, calm: false, anim: false, token: 0 };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  return R3;
}

function makeDie(key) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry(0.15, 5), []);
  group.add(mesh);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobShadow(), transparent: true, depthWrite: false, opacity: 0.55 }));
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: dotTexture(), transparent: true, depthWrite: false, ...GLOW_BLEND, opacity: 0 }));
  R3.scene.add(group, shadow, halo);
  return { key, group, mesh, shadow, halo, face: 1, q: new THREE.Quaternion(), yaw: rand(-0.25, 0.25), anim: null, token: -1, size: 50, pos: new THREE.Vector3(), lookKey: '', flash: 0, nextFlash: rand(0.5, 3), seed: Math.random() * 10 };
}

const FACE_Q = {};
function faceQuat(face, yaw) {
  const n = new THREE.Vector3(...NORMAL[face]);
  const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, 1));
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.36, yaw, 'XYZ'));
  return tilt.multiply(q);
}

/** Give a die its materials for the current look (and rebuild them only when the look changes). */
function dress(d, look) {
  if (d.lookKey === look.key) return;
  d.lookKey = look.key;
  const R = look.rec;
  d.mesh.geometry = geometry(R.r, R.facets ? 1 : 5);
  const mats = FACE_AT.map((face) => {
    const t = faceTextures(look, face);
    const m = new THREE.MeshPhysicalMaterial({ envMapIntensity: R.gold || R.m.metalness > 0.5 ? 1.1 : 0.5, map: t.map, bumpMap: t.bump, bumpScale: R.nearest ? 0.8 : 4.5, emissiveMap: t.emis, emissive: new THREE.Color(R.neon || R.dark ? look.body : R.stars ? '#7a4cff' : R.bolt ? '#6fa8ff' : '#000000'), emissiveIntensity: R.stars ? 0.8 : R.neon || R.dark || R.bolt ? 1.3 : 0, ...R.m });
    if (R.glass) { m.side = THREE.DoubleSide; m.forceSinglePass = true; }
    if (R.flame) { m.emissive = new THREE.Color('#ff6a00'); m.emissiveIntensity = 2.4; m.emissiveMap = flowTex('flame'); }
    if (R.stars) { m.emissiveMap = tex(drawNebula(), true); }
    m.userData.base = m.emissiveIntensity; m.userData.t = !!m.transparent; m.userData.o = m.opacity;
    return m;
  });
  d.mesh.material = mats;
  d.shadow.material.opacity = R.glass ? 0.3 : 0.55;
}
function drawNebula() { return flowTexture('nebula'); }

function setLook(look) { R3.look = look; R3.anim = !!look.rec.anim; }

function lookFor(skin, body, pip) {
  const rec = recipe(skin);
  const b = hex(body);
  const key = `${skin}|${b}|${pip}`;
  return { skin, rec, body: b, pip: hex(pip, '#ffffff'), key };
}

/* ---------- particles ---------- */
function particleSystem() {
  const N = 220;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3); const col = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 4, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, ...GLOW_BLEND, sizeAttenuation: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  R3.scene.add(pts);
  const items = Array.from({ length: N }, () => ({ life: 0, max: 1, die: 0, x: 0, y: 0, vx: 0, vy: 0, c: [1, 1, 1] }));
  return { N, geo, pos, col, mat, pts, items };
}
const PCOL = { ember: [[1, 0.78, 0.3], [1, 0.45, 0.1]], sparkle: [[1, 1, 1], [0.7, 0.92, 1]], glint: [[1, 0.9, 0.5], [1, 1, 0.9]], stars: [[1, 1, 1], [0.8, 0.65, 1]], rainbow: [[1, 0.5, 0.85], [0.5, 0.9, 1], [1, 0.95, 0.5], [0.6, 1, 0.7]] };

function updateParticles(dt, t) {
  const L = R3.look;
  const kind = L && L.rec.particles;
  if (!R3.particles) R3.particles = particleSystem();
  const P = R3.particles;
  const list = [...R3.dice.values()].filter((d) => d.visible);
  P.pts.visible = !!kind && list.length > 0 && !R3.calm;
  if (!P.pts.visible) return;
  const want = Math.min(P.N, list.length * (kind === 'ember' ? 12 : 6));
  for (let i = 0; i < P.N; i++) {
    const p = P.items[i];
    if (i >= want || !list.length) { P.col[i * 3] = P.col[i * 3 + 1] = P.col[i * 3 + 2] = 0; continue; }
    p.life -= dt;
    if (p.life <= 0) {
      const d = list[i % list.length];
      const s = d.size;
      p.max = p.life = kind === 'ember' ? rand(0.7, 1.5) : rand(0.6, 1.4);
      p.die = d;
      p.x = rand(-0.5, 0.5) * s;
      p.y = kind === 'ember' ? rand(-0.5, 0.1) * s : rand(-0.5, 0.5) * s;
      p.vx = kind === 'ember' ? rand(-8, 8) : rand(-4, 4);
      p.vy = kind === 'ember' ? rand(35, 70) : rand(-3, 6);
      const set = PCOL[kind]; p.c = set[Math.floor(Math.random() * set.length)];
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    const d = p.die;
    const k = p.life / p.max;
    const a = kind === 'ember' || kind === 'glint' ? Math.sin(k * Math.PI) : 0.5 + 0.5 * Math.sin(t * 5 + i);
    P.pos[i * 3] = d.pos.x + p.x; P.pos[i * 3 + 1] = d.pos.y + p.y; P.pos[i * 3 + 2] = d.size * 0.7;
    P.col[i * 3] = p.c[0] * a; P.col[i * 3 + 1] = p.c[1] * a; P.col[i * 3 + 2] = p.c[2] * a;
  }
  P.geo.attributes.position.needsUpdate = true; P.geo.attributes.color.needsUpdate = true;
  P.mat.size = 3.6 * R3.dpr;
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
  d.shadow.material.opacity = (d.glass ? 0.3 : 0.5) * (1 - lift * 0.6);
}

function animateLook(dt, t) {
  const L = R3.look;
  if (!L) return;
  const R = L.rec;
  for (const d of R3.dice.values()) {
    if (!d.visible) continue;
    const mats = d.mesh.material;
    if (!Array.isArray(mats)) continue;
    // glow behind the die
    let haloColor = R.glowSeat ? L.body : R.glow;
    if (R.glowOwn) haloColor = L.body;
    d.halo.visible = !!haloColor && !R3.calm;
    if (d.halo.visible) {
      d.halo.material.color.set(haloColor);
      const pulse = R.fire || R.neon || R.dark ? 0.55 + 0.25 * Math.sin(t * 4 + d.seed) : 0.42;
      let flash = 0;
      if (R.bolt) { d.nextFlash -= dt; if (d.nextFlash <= 0) { d.flash = 1; d.nextFlash = rand(1.6, 4.2); } d.flash = Math.max(0, d.flash - dt * 4); flash = d.flash > 0.5 && Math.floor(d.flash * 10) % 2 === 0 ? 1 : d.flash * 0.6; }
      d.halo.material.opacity = (R.bolt ? 0.12 : pulse * 0.6) + flash * 0.7;
      d.halo.position.set(d.pos.x, d.pos.y, -d.size * 0.5);
      d.halo.scale.setScalar(d.size * (2.4 + flash * 0.8));
      mats.forEach((m) => { if (R.bolt) m.emissiveIntensity = m.userData.base + flash * 2.4; });
    }
    if (R.neon || R.dark) mats.forEach((m) => { m.emissiveIntensity = m.userData.base * (0.85 + 0.25 * Math.sin(t * 3 + d.seed)); });
  }
  if (R.flame) { const f = flowTex('flame'); f.offset.y = (f.offset.y + dt * 0.55) % 1; }
  if (R.stars) for (const d of R3.dice.values()) { const m = d.mesh.material[0]; if (m?.emissiveMap) { m.emissiveMap.offset.x = (m.emissiveMap.offset.x + dt * 0.03) % 1; m.emissiveMap.offset.y = (m.emissiveMap.offset.y + dt * 0.02) % 1; } }
  R3.glowLight.intensity = R.flame ? 5000 * (0.8 + 0.2 * Math.sin(t * 7)) : 0;
  R3.glowLight.color.set(R.flame ? '#ff7a1a' : '#ffffff');
}

function frame(now) {
  R3.raf = 0;
  if (!R3.items.length) return;
  const dt = Math.min(0.05, (now - (R3.last || now)) / 1000);
  R3.last = now;
  layout();
  let busy = false;
  for (const d of R3.dice.values()) { poseDie(d, now, dt); if (d.anim) busy = true; }
  animateLook(dt, now / 1000);
  updateParticles(dt, now / 1000);
  R3.renderer.render(R3.scene, R3.camera);
  const live = (R3.anim || [...R3.dice.values()].some((x) => x.spin)) && !R3.calm && !document.hidden;
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
   * skin: the dice look. Returns false if 3D could not start (the page then keeps its CSS dice).
   */
  show({ dice, skin, calm, z = 5 }) {
    try {
      init();
      R3.calm = !!calm;
      R3.canvas.style.zIndex = String(z);
      const first = dice[0];
      const look = lookFor(skin, first?.color, first?.pip);
      setLook(look);
      const keep = new Set();
      R3.items = dice.map((spec) => {
        keep.add(spec.key);
        let d = R3.dice.get(spec.key);
        if (!d) { d = makeDie(spec.key); R3.dice.set(spec.key, d); }
        const own = lookFor(skin, spec.color, spec.pip);
        dress(d, own);
        d.glass = !!own.rec.glass;
        d.spin = !!spec.spin;
        if (d.dim !== !!spec.dim) { d.dim = !!spec.dim; d.mesh.material.forEach((m) => { m.transparent = m.userData.t || d.dim; m.opacity = d.dim ? 0.55 : m.userData.o; m.needsUpdate = true; }); }
        if (spec.face !== d.face) d.face = spec.face;
        if (spec.rolling && spec.token !== d.token) startRoll(d, spec);
        if (!spec.rolling) d.anim = null;
        d.token = spec.rolling ? spec.token : -1;
        return { el: spec.el, die: d };
      });
      for (const [k, d] of R3.dice) if (!keep.has(k)) { R3.scene.remove(d.group, d.shadow, d.halo); R3.dice.delete(k); }
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

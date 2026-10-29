// Player look: dice colours and the little drawing used as a player icon.

export const PALETTE = [
  { name: 'Red', hex: '#e5484d', pip: '#ffffff' },
  { name: 'Blue', hex: '#3b82f6', pip: '#ffffff' },
  { name: 'Green', hex: '#2fb36d', pip: '#ffffff' },
  { name: 'Yellow', hex: '#f2c230', pip: '#2b2417' },
  { name: 'Purple', hex: '#a855f7', pip: '#ffffff' },
  { name: 'Teal', hex: '#14b8a6', pip: '#ffffff' },
  { name: 'Pink', hex: '#ec4899', pip: '#ffffff' },
  { name: 'Black', hex: '#2a2f3a', pip: '#ffffff' },
];

/** `wanted` if no one else has it, otherwise the first colour nobody has. */
export function freeColor(taken, wanted) {
  const used = new Set(taken);
  if (Number.isInteger(wanted) && wanted >= 0 && wanted < PALETTE.length && !used.has(wanted)) return wanted;
  const free = PALETTE.findIndex((_, i) => !used.has(i));
  return free < 0 ? 0 : free;
}

const AVATAR_PREFIX = 'data:image/png;base64,';
export const AVATAR_MAX = 20000; // characters; icons from other players are untrusted input

/** Only our own small PNG icons are ever shown; anything else from the network is dropped. */
export function safeAvatar(value) {
  return typeof value === 'string' && value.length <= AVATAR_MAX && value.startsWith(AVATAR_PREFIX) && /^[A-Za-z0-9+/=]+$/.test(value.slice(AVATAR_PREFIX.length))
    ? value
    : '';
}

/* ---- drawing surface (kept off-screen so the editor can be re-rendered without losing the picture) ---- */

export const INK = ['#ffffff', ...PALETTE.map((c) => c.hex)];
export const BRUSHES = [4, 8, 14];
export const AVATAR_SIZE = 128;
const SIZE = AVATAR_SIZE;

export function makeSketch() {
  const buf = document.createElement('canvas');
  buf.width = SIZE;
  buf.height = SIZE;
  return { buf, dirty: false, ink: INK[0], width: BRUSHES[1], erase: false };
}

export function paintCanvas(canvas, sketch) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(sketch.buf, 0, 0);
}

export function pointOn(canvas, event) {
  const r = canvas.getBoundingClientRect();
  return { x: ((event.clientX - r.left) / r.width) * SIZE, y: ((event.clientY - r.top) / r.height) * SIZE };
}

export function strokeSegment(sketch, from, to) {
  const ctx = sketch.buf.getContext('2d');
  ctx.globalCompositeOperation = sketch.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = sketch.ink;
  ctx.lineWidth = sketch.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (from.x === to.x && from.y === to.y) {
    // a tap: some browsers draw nothing for a zero-length line, so paint the dot directly
    ctx.fillStyle = sketch.ink;
    ctx.arc(to.x, to.y, sketch.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  sketch.dirty = true;
}

export function clearSketch(sketch) {
  sketch.buf.getContext('2d').clearRect(0, 0, SIZE, SIZE);
  sketch.dirty = false;
}

export function loadAvatar(sketch, dataUrl, done) {
  if (!safeAvatar(dataUrl)) return;
  const img = new Image();
  img.onload = () => {
    sketch.buf.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE);
    sketch.dirty = true;
    done();
  };
  img.src = dataUrl;
}

/** The drawing as a small PNG data URL, or '' when nothing was drawn. */
export function exportAvatar(sketch) {
  if (!sketch.dirty) return '';
  let url = sketch.buf.toDataURL('image/png');
  if (url.length > AVATAR_MAX) {
    const small = document.createElement('canvas');
    small.width = small.height = 80;
    small.getContext('2d').drawImage(sketch.buf, 0, 0, 80, 80);
    url = small.toDataURL('image/png');
  }
  return safeAvatar(url);
}

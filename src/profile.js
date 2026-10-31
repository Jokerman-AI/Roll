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

// Emoji people can send to each other during an online game.
export const REACTIONS = ['👏', '😂', '😱', '🔥', '🎲', '😈', '👍', '💀'];

// Names for computer players, all short enough for a scoreboard chip.
const CPU_NAMES = [
  'Dicey', 'Snake Eyes', 'Lucky', 'Boxcars', 'Rollo', 'Pips', 'Tumbler', 'Cubert', 'Ace', 'Jinx',
  'Gizmo', 'Pixel', 'Turbo', 'Widget', 'Sparky', 'Nova', 'Clank', 'Bolt', 'Dottie', 'Hazard',
  'Wildcard', 'Roulette', 'Domino', 'Shaker', 'Gambit', 'Fortune', 'Chance', 'Roller', 'Sixer', 'Lucky 7',
  'Rolo', 'Bones', 'Pebble', 'Tango', 'Zigzag', 'Maverick', 'Dash', 'Echo', 'Fizz', 'Comet',
];

/** A random computer-player name that nobody at the table already has. */
export function cpuName(taken = []) {
  const used = new Set(taken.map((n) => String(n).trim().toLowerCase()));
  const free = CPU_NAMES.filter((n) => !used.has(n.toLowerCase()));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  for (let i = 2; ; i++) {
    const n = `Robo ${i}`;
    if (!used.has(n.toLowerCase())) return n;
  }
}

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

// Icons are drawn on opaque paper, so the dice colour only ever appears as the ring around them.
export const PAPER = '#fffdf4';
export const INK = [PALETTE[7].hex, ...PALETTE.slice(0, 7).map((c) => c.hex)];
export const BRUSHES = [8, 14, 22]; // the middle one is the default, thick enough to read on a small scoreboard icon
export const STAMPS = ['😀', '😎', '🤠', '🥳', '🐱', '🐶', '🦊', '🐸', '🐼', '🦄', '👑', '🔥'];
export const AVATAR_SIZE = 128;
const SIZE = AVATAR_SIZE;

function fillPaper(buf) {
  const ctx = buf.getContext('2d');
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

export function makeSketch() {
  const buf = document.createElement('canvas');
  buf.width = SIZE;
  buf.height = SIZE;
  fillPaper(buf);
  return { buf, dirty: false, ink: INK[0], width: BRUSHES[1], erase: false, stamp: null };
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
  const ink = sketch.erase ? PAPER : sketch.ink; // erasing paints the paper back
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = ink;
  ctx.lineWidth = sketch.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (from.x === to.x && from.y === to.y) {
    // a tap: some browsers draw nothing for a zero-length line, so paint the dot directly
    ctx.fillStyle = ink;
    ctx.arc(to.x, to.y, sketch.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  sketch.dirty = true;
}

/** Press an emoji stamp onto the drawing, sized to the current brush. */
export function stampAt(sketch, at) {
  const ctx = sketch.buf.getContext('2d');
  const size = sketch.width * 4;
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sketch.stamp, at.x, at.y + size * 0.05);
  sketch.dirty = true;
}

export function clearSketch(sketch) {
  fillPaper(sketch.buf);
  sketch.dirty = false;
}

/** Load a saved icon for editing. Older icons were transparent; those are laid on `legacyBg`. */
export function loadAvatar(sketch, dataUrl, done, legacyBg = PAPER) {
  if (!safeAvatar(dataUrl)) return;
  const img = new Image();
  img.onload = () => {
    const ctx = sketch.buf.getContext('2d');
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    probe.getContext('2d').drawImage(img, 0, 0, 1, 1);
    if (probe.getContext('2d').getImageData(0, 0, 1, 1).data[3] < 250) {
      ctx.fillStyle = legacyBg;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
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

// Sound effects and vibration. Every sound is made on the spot with the Web Audio API, so there are no
// files to load, and nothing happens until the person has touched the screen (browsers insist on that).

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export const soundPrefs = {
  sound: read('rfi-sound') !== '0',
  haptics: read('rfi-haptics') !== '0',
};
export const setSound = (on) => { soundPrefs.sound = !!on; write('rfi-sound', on ? '1' : '0'); };
export const setHaptics = (on) => { soundPrefs.haptics = !!on; write('rfi-haptics', on ? '1' : '0'); };
export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let ctx = null;
let master = null;

/** Make the audio engine on first use (and wake it if the browser put it to sleep). Call from a tap. */
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') ctx.resume(); // 'suspended', or 'interrupted' on iPhones after a call or a lock
  } catch { /* no audio on this device */ }
}

if (typeof document !== 'undefined') {
  const wake = () => unlock();
  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('keydown', wake, { passive: true });
}

const ready = () => soundPrefs.sound && ctx && ctx.state === 'running';

/** A single note: a frequency (or a slide between two), a shape, a length and a loudness. */
function tone({ from, to = from, type = 'sine', at = 0, len = 0.15, vol = 0.3, attack = 0.005 }) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + len);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

/** A short burst of filtered noise, which is what a die clacking sounds like. */
function click({ at = 0, freq = 2000, len = 0.05, vol = 0.35 }) {
  const t = ctx.currentTime + at;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * len));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
}

/** Notes of a bell-like chime, in Hz. */
const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, A5: 880, E6: 1318.5 };
const bell = (freq, at, len = 0.45, vol = 0.22) => {
  tone({ from: freq, at, len, vol });
  tone({ from: freq * 2, at, len: len * 0.6, vol: vol * 0.35 });
};

function buzz(pattern) {
  if (soundPrefs.haptics && canVibrate()) { try { navigator.vibrate(pattern); } catch { /* not allowed right now */ } }
}

export const sfx = {
  /** Dice tumbling onto the table. */
  roll(count = 6) {
    buzz([14, 40, 14, 40, 10]);
    if (!ready()) return;
    for (let i = 0; i < Math.min(10, count + 3); i++) click({ at: i * 0.07 + Math.random() * 0.04, freq: 1200 + Math.random() * 1800, vol: 0.28 + Math.random() * 0.1 });
    click({ at: 0.75, freq: 900, len: 0.08, vol: 0.3 });
  },
  /** A die dropping onto a card. */
  place() {
    buzz(10);
    if (!ready()) return;
    click({ freq: 1500, len: 0.04, vol: 0.4 });
    tone({ from: 420, to: 300, type: 'triangle', len: 0.09, vol: 0.18 });
  },
  /** A card claimed. */
  claim() {
    buzz([30, 50, 40]);
    if (!ready()) return;
    bell(NOTE.C5, 0);
    bell(NOTE.E5, 0.09);
    bell(NOTE.G5, 0.18, 0.6);
  },
  win() {
    buzz([60, 70, 60, 70, 140]);
    if (!ready()) return;
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.G5, NOTE.C6].forEach((f, i) => bell(f, i * 0.13, 0.7, 0.2));
    bell(NOTE.E6, 0.85, 1, 0.18);
  },
  /** It is your turn. */
  turn() {
    buzz([20, 60, 20]);
    if (!ready()) return;
    bell(NOTE.A5, 0, 0.3, 0.18);
    bell(NOTE.E6, 0.12, 0.4, 0.16);
  },
  /** A power card. */
  power() {
    buzz([20, 30, 40]);
    if (!ready()) return;
    tone({ from: 300, to: 1400, type: 'sawtooth', len: 0.28, vol: 0.12 });
    bell(NOTE.G5, 0.2, 0.3, 0.15);
  },
  /** Somebody sent an emoji. */
  react() {
    if (!ready()) return;
    tone({ from: 700, to: 1000, len: 0.1, vol: 0.18 });
  },
  /** Something that cannot be done. */
  error() {
    buzz(45);
    if (!ready()) return;
    tone({ from: 160, to: 120, type: 'square', len: 0.14, vol: 0.12 });
  },
  /** A tap on a button that deserves a little feedback. */
  tap() { buzz(6); },
};

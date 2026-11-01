import { isUnlocked } from './stats.js';

// Looks: the colour of the table, the back of the deck and the style of the dice. The choice is saved on
// the device and applied by setting attributes on the page, which the stylesheet reacts to.

export const TABLES = [
  { id: 'felt', name: 'Green', meta: '#0f3d2e' },
  { id: 'midnight', name: 'Midnight', meta: '#0b1f3a' },
  { id: 'wine', name: 'Wine', meta: '#3a0f1d' },
  { id: 'violet', name: 'Violet', meta: '#26134a' },
  { id: 'charcoal', name: 'Charcoal', meta: '#1b1e25' },
  { id: 'neon', name: 'Neon', meta: '#0a0420' },
  { id: 'sunset', name: 'Sunset', meta: '#3a0f2a' },
  { id: 'forest', name: 'Forest', meta: '#0d2b1a' },
  { id: 'ocean', name: 'Ocean', meta: '#062a3f' },
  { id: 'aurora', name: 'Aurora', meta: '#061a2b', fx: true },
  { id: 'starfield', name: 'Starfield', meta: '#070b1f', fx: true },
  { id: 'lava', name: 'Lava', meta: '#2a0a05', fx: true },
];
export const BACKS = [
  { id: 'blue', name: 'Blue stripes' },
  { id: 'red', name: 'Red diamonds' },
  { id: 'gold', name: 'Gold' },
  { id: 'mint', name: 'Mint dots' },
  { id: 'night', name: 'Night' },
  { id: 'galaxy', name: 'Galaxy' },
  { id: 'sunburst', name: 'Sunburst' },
  { id: 'retro', name: 'Retro grid' },
  { id: 'holo', name: 'Holo foil', fx: true },
  { id: 'circuit', name: 'Circuit', fx: true },
  { id: 'ember', name: 'Ember', fx: true },
];
export const DICE = [
  { id: 'classic', name: 'Classic' },
  { id: 'sharp', name: 'Sharp' },
  { id: 'bubble', name: 'Bubble' },
  { id: 'glass', name: 'Glass' },
  { id: 'gem', name: 'Gem' },
  { id: 'pixel', name: 'Pixel' },
  { id: 'fire', name: 'Fire', fx: true },
  { id: 'ice', name: 'Ice', fx: true },
  { id: 'prism', name: 'Prism', fx: true },
  { id: 'neonglow', name: 'Neon glow', fx: true },
];
/** What happens on screen when somebody wins. */
export const FX = [
  { id: 'confetti', name: 'Confetti' },
  { id: 'stars', name: 'Stars' },
  { id: 'fireworks', name: 'Fireworks', fx: true },
  { id: 'goldrain', name: 'Gold rain', fx: true },
];

const KEY = 'rfi-theme';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (t) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* storage unavailable */ } };
const pick = (list, id) => (list.some((x) => x.id === id) ? id : list[0].id);

const LISTS = { table: TABLES, back: BACKS, dice: DICE, fx: FX };
/** The saved choice, or the first (free) look if it is unknown or not yet earned. */
const choose = (part, id) => {
  const picked = pick(LISTS[part], id);
  return isUnlocked(part, picked) ? picked : LISTS[part][0].id;
};

export const theme = (() => {
  const saved = read();
  return { table: choose('table', saved.table), back: choose('back', saved.back), dice: choose('dice', saved.dice), fx: choose('fx', saved.fx) };
})();

/** Put the current look on the page. */
/** Switch off the moving parts of the looks (battery, or just a quieter table). Saved on the device. */
export const calm = { on: (() => { try { return localStorage.getItem('rfi-calm') === '1'; } catch { return false; } })() };
export function setCalm(on) {
  calm.on = !!on;
  try { localStorage.setItem('rfi-calm', on ? '1' : '0'); } catch { /* storage unavailable */ }
  applyTheme();
}

/** Look at the saved choices again, once paid-for looks have been checked. */
export function restoreTheme() {
  const saved = read();
  for (const part of Object.keys(LISTS)) theme[part] = choose(part, saved[part]);
  applyTheme();
}

export function applyTheme() {
  if (typeof document === 'undefined') return; // not in a page (for example, under test)
  const root = document.documentElement;
  root.setAttribute('data-tb', theme.table);
  root.setAttribute('data-ds', theme.dice);
  if (calm.on) root.setAttribute('data-calm', '1'); else root.removeAttribute('data-calm');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', TABLES.find((t) => t.id === theme.table).meta);
}

/** part: 'table' | 'back' | 'dice' | 'fx'. Returns false if that look has not been earned yet. */
export function setTheme(part, id) {
  const list = LISTS[part];
  if (!list || !list.some((x) => x.id === id) || !isUnlocked(part, id)) return false;
  theme[part] = id;
  write(theme);
  applyTheme();
  return true;
}

applyTheme();

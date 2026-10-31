// Looks: the colour of the table, the back of the deck and the style of the dice. The choice is saved on
// the device and applied by setting attributes on the page, which the stylesheet reacts to.

export const TABLES = [
  { id: 'felt', name: 'Green', meta: '#0f3d2e' },
  { id: 'midnight', name: 'Midnight', meta: '#0b1f3a' },
  { id: 'wine', name: 'Wine', meta: '#3a0f1d' },
  { id: 'violet', name: 'Violet', meta: '#26134a' },
  { id: 'charcoal', name: 'Charcoal', meta: '#1b1e25' },
];
export const BACKS = [
  { id: 'blue', name: 'Blue stripes' },
  { id: 'red', name: 'Red diamonds' },
  { id: 'gold', name: 'Gold' },
  { id: 'mint', name: 'Mint dots' },
  { id: 'night', name: 'Night' },
];
export const DICE = [
  { id: 'classic', name: 'Classic' },
  { id: 'sharp', name: 'Sharp' },
  { id: 'bubble', name: 'Bubble' },
];

const KEY = 'rfi-theme';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (t) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* storage unavailable */ } };
const pick = (list, id) => (list.some((x) => x.id === id) ? id : list[0].id);

export const theme = (() => {
  const saved = read();
  return { table: pick(TABLES, saved.table), back: pick(BACKS, saved.back), dice: pick(DICE, saved.dice) };
})();

/** Put the current look on the page. */
export function applyTheme() {
  const root = document.documentElement;
  root.setAttribute('data-tb', theme.table);
  root.setAttribute('data-ds', theme.dice);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', TABLES.find((t) => t.id === theme.table).meta);
}

/** part: 'table' | 'back' | 'dice' */
export function setTheme(part, id) {
  const list = { table: TABLES, back: BACKS, dice: DICE }[part];
  if (!list) return;
  theme[part] = pick(list, id);
  write(theme);
  applyTheme();
}

applyTheme();

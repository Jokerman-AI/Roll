import { isPremium, isLicensed, freeLooks } from './premium.js';

// What you have done so far, kept on this device, and the looks it unlocks. Nothing here leaves the phone.

const KEY = 'rfi-stats';
const blank = () => ({ games: 0, wins: 0, claims: 0, streak: 0, bestStreak: 0, extremeWins: 0, online: 0, best: 0, coins: 0, owned: [] });

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    const out = blank();
    for (const k of Object.keys(out)) if (k !== 'owned' && Number.isFinite(saved?.[k]) && saved[k] >= 0) out[k] = Math.floor(saved[k]);
    if (Array.isArray(saved?.owned)) out.owned = saved.owned.filter((x) => typeof x === 'string' && /^(table|back|dice|fx):[a-z]{2,12}$/.test(x)).slice(0, 50);
    return out;
  } catch { return blank(); }
};
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };

export const stats = load();

/** What each look needs before it can be used. Looks not listed are free. */
export const UNLOCKS = {
  table: { midnight: { games: 3 }, wine: { wins: 1 }, violet: { wins: 5 }, charcoal: { claims: 25 } },
  back: { red: { games: 5 }, gold: { wins: 3 }, mint: { online: 1 }, night: { extremeWins: 1 } },
};

/** Looks that are bought with coins instead of earned. Coins come from playing: no real money is involved. */
export const SHOP = {
  table: { neon: 200, sunset: 250, forest: 180, ocean: 220 },
  back: { galaxy: 150, sunburst: 200, retro: 150 },
  fx: { stars: 250 },
};
export const isShopItem = (part, id) => !!SHOP[part]?.[id];
export const priceOf = (part, id) => SHOP[part]?.[id] ?? 0;

/** Coins for a finished game: a little for playing, more for winning and for each card claimed. */
export const coinsFor = (result) => Math.min(60, 10 + (result.won ? 20 : 0) + 2 * Math.max(0, result.claims | 0));

const NEED = {
  games: (n) => `Play ${n} ${n === 1 ? 'game' : 'games'}`,
  wins: (n) => `Win ${n} ${n === 1 ? 'game' : 'games'}`,
  claims: (n) => `Claim ${n} cards`,
  online: (n) => `Play ${n} online ${n === 1 ? 'game' : 'games'}`,
  extremeWins: () => 'Win a Rollick Extreme game',
};

/** Does this look's requirement hold for these numbers? Pass `s` to test numbers other than your own. */
export function isUnlocked(part, id, s = stats) {
  if (freeLooks()) return true; // everything is free for now
  if (isPremium(part, id)) return isLicensed(part, id); // paid for with real money: see premium.js
  if (isShopItem(part, id)) return (s.owned || []).includes(`${part}:${id}`);
  const need = UNLOCKS[part]?.[id];
  return !need || Object.entries(need).every(([k, n]) => (s[k] || 0) >= n);
}

/** "Play 3 games", or '' when the look is free. */
export function requirementText(part, id) {
  if (isPremium(part, id)) return 'A premium look, in the Shop';
  if (isShopItem(part, id)) return `In the Shop for ${priceOf(part, id)} coins`;
  const need = UNLOCKS[part]?.[id];
  return need ? Object.entries(need).map(([k, n]) => NEED[k](n)).join(' and ') : '';
}

/** Every look that is locked at `before` and open at `after`: [{ part, id }]. */
export function newlyUnlocked(before, after) {
  const out = [];
  for (const part of Object.keys(UNLOCKS)) {
    for (const id of Object.keys(UNLOCKS[part])) if (!isUnlocked(part, id, before) && isUnlocked(part, id, after)) out.push({ part, id });
  }
  return out;
}

/** The numbers after one finished game. result: { won, claims, score, mode, online }. */
export function afterGame(s, result) {
  const next = { ...s, owned: [...(s.owned || [])] };
  next.coins = (next.coins || 0) + coinsFor(result);
  next.games++;
  next.claims += Math.max(0, result.claims | 0);
  next.best = Math.max(next.best, result.score | 0);
  if (result.online) next.online++;
  if (result.won) {
    next.wins++;
    next.streak++;
    next.bestStreak = Math.max(next.bestStreak, next.streak);
    if (result.mode === 'extreme') next.extremeWins++;
  } else {
    next.streak = 0;
  }
  return next;
}

/** Count a finished game and keep it. Returns the looks it just unlocked and the coins it earned. */
export function recordGame(result) {
  const before = { ...stats };
  Object.assign(stats, afterGame(stats, result));
  save(stats);
  return { unlocked: newlyUnlocked(before, stats), coins: coinsFor(result) };
}

/** Spend coins on a Shop look. Returns { ok: true } or { ok: false, why }. Pass `s` to test with other numbers. */
export function buy(part, id, s = stats) {
  if (!isShopItem(part, id)) return { ok: false, why: 'Not for sale' };
  if (isUnlocked(part, id, s)) return { ok: false, why: 'You already have it' };
  const price = priceOf(part, id);
  if ((s.coins || 0) < price) return { ok: false, why: `You need ${price - (s.coins || 0)} more coins` };
  s.coins -= price;
  s.owned = [...(s.owned || []), `${part}:${id}`];
  if (s === stats) save(stats);
  return { ok: true };
}

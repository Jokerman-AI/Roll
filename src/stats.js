// What you have done so far, kept on this device, and the looks it unlocks. Nothing here leaves the phone.

const KEY = 'rfi-stats';
const blank = () => ({ games: 0, wins: 0, claims: 0, streak: 0, bestStreak: 0, extremeWins: 0, online: 0, best: 0 });

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    const out = blank();
    for (const k of Object.keys(out)) if (Number.isFinite(saved?.[k]) && saved[k] >= 0) out[k] = Math.floor(saved[k]);
    return out;
  } catch { return blank(); }
};
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };

export const stats = load();

/** What each look needs before it can be used. Looks not listed are free. */
export const UNLOCKS = {
  table: { midnight: { games: 3 }, wine: { wins: 1 }, violet: { wins: 5 }, charcoal: { claims: 25 } },
  back: { red: { games: 5 }, gold: { wins: 3 }, mint: { online: 1 }, night: { extremeWins: 1 } },
  dice: { sharp: { claims: 10 }, bubble: { wins: 2 } },
};

const NEED = {
  games: (n) => `Play ${n} ${n === 1 ? 'game' : 'games'}`,
  wins: (n) => `Win ${n} ${n === 1 ? 'game' : 'games'}`,
  claims: (n) => `Claim ${n} cards`,
  online: (n) => `Play ${n} online ${n === 1 ? 'game' : 'games'}`,
  extremeWins: () => 'Win a Rollick Extreme game',
};

/** Does this look's requirement hold for these numbers? Pass `s` to test numbers other than your own. */
export function isUnlocked(part, id, s = stats) {
  const need = UNLOCKS[part]?.[id];
  return !need || Object.entries(need).every(([k, n]) => (s[k] || 0) >= n);
}

/** "Play 3 games", or '' when the look is free. */
export function requirementText(part, id) {
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
  const next = { ...s };
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

/** Count a finished game and keep it. Returns the looks it just unlocked. */
export function recordGame(result) {
  const before = { ...stats };
  Object.assign(stats, afterGame(stats, result));
  save(stats);
  return newlyUnlocked(before, stats);
}

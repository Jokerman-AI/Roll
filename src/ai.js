import * as E from './engine.js';

// The computer player. It only uses what every player can see: the cards, everyone's dice and scores.
// To judge a choice it plays out the next couple of turns many times (a quick Monte Carlo look-ahead)
// with a simple "place every die where it helps most" policy, and picks the option that scores best.
// The simulations use a generator seeded from the position, so the same position always gets the same
// answer, which also keeps the hint button consistent.

const LOOKAHEAD = 3; // turns to play out, including the current one
const SIMS = 64; // playouts per option

/** Chance we still get a card first, given how close the nearest rival is. */
function race(missing, rival) {
  if (rival < missing) return 0.35;
  if (rival === missing) return 0.7;
  return 1;
}

/** What I know about each card, reduced to counts so playouts are cheap. */
function snapshot(s, me) {
  const cards = s.cards.map((card) => {
    const need = new Array(7).fill(0);
    const have = new Array(7).fill(0);
    for (const f of card.need) need[f]++;
    for (const f of card.placed[me]) have[f]++;
    let rival = Infinity;
    s.players.forEach((_, p) => { if (p !== me) rival = Math.min(rival, E.missing(card, p).length); });
    return { points: card.points, need, have, total: card.need.length, placed: card.placed[me].length, rival, alive: true };
  });
  const topRival = Math.max(0, ...s.players.filter((_, p) => p !== me).map((p) => p.score));
  return { cards, onCards: cards.reduce((n, c) => n + c.placed, 0), score: s.players[me].score, topRival };
}

const copyModel = (m) => ({ ...m, cards: m.cards.map((c) => ({ ...c, have: c.have.slice() })) });

/** What finishing a card is worth. `certain` means it happens this turn, with dice already rolled. */
function completionValue(c, certain, score, topRival) {
  let v = c.points * (certain ? 1 : race(1, c.rival));
  if (score + c.points >= E.TARGET_SCORE) v += certain ? 1000 : 25 * race(1, c.rival); // winning
  if (c.rival <= 1) {
    v += 0.3 * c.points; // taking a card a rival is about to finish
    if (topRival + c.points >= E.TARGET_SCORE) v += certain ? 10 : 3; // ...especially if it would win them the game
  }
  return v;
}

/** Place one die on a card (the card must need it). Returns the value gained if that finished the card. */
function put(m, c, face, certain) {
  c.have[face]++;
  c.placed++;
  m.onCards++;
  if (c.placed < c.total) return 0;
  const gained = completionValue(c, certain, m.score, m.topRival);
  m.score += c.points;
  m.onCards -= c.total; // the dice on a finished card come home
  c.alive = false;
  return gained;
}

/** Play `turns` turns with a simple policy and return what they were worth. `firstDice` are this turn's dice if already rolled. */
function rollout(model, rng, firstDice, turns, minFree = 0, nearDone = 0) {
  const m = copyModel(model);
  let gain = 0;
  for (let t = 0; t < turns; t++) {
    const certain = t === 0 && firstDice !== null;
    const dice = certain ? firstDice : Array.from({ length: Math.max(0, E.DICE_PER_PLAYER - m.onCards) }, () => 1 + Math.floor(rng() * 6));
    for (const f of dice) {
      let best = null;
      let bestV = -1;
      for (const c of m.cards) {
        if (!c.alive || c.have[f] >= c.need[f]) continue;
        const missing = c.total - c.placed;
        const freeAfter = E.DICE_PER_PLAYER - m.onCards - 1;
        if (missing > 1 && (freeAfter < 1 || (missing - 1 > nearDone && freeAfter < minFree))) continue; // keep dice free, as the floor says
        const v = (missing === 1 ? 1000 : 0) + (c.points * (certain ? 1 : race(missing, c.rival)) * (c.placed + 1)) / c.total;
        if (v > bestV) { bestV = v; best = c; }
      }
      if (best) {
        gain += put(m, best, f, certain);
        if (certain && m.score >= E.TARGET_SCORE) return gain; // the game is won: nothing after this matters
      }
    }
  }
  // Unfinished cards count for part of their points, more the closer they are, less if a rival is ahead.
  for (const c of m.cards) {
    if (c.alive && c.placed > 0) gain += c.points * race(c.total - c.placed, c.rival) * (c.placed / c.total) ** 2 * 0.5;
  }
  return gain;
}

const average = (fn, seed) => {
  let sum = 0;
  for (let i = 0; i < SIMS; i++) sum += fn(mulberry(seed + i * 7919));
  return sum / SIMS;
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number that depends only on the position, so the same position is always judged the same way. */
function seedOf(s) {
  let h = 2166136261;
  const text = JSON.stringify([s.current, s.rolled, s.players.map((p) => p.score), s.cards.map((c) => [c.id, c.placed])]);
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Every legal placement, best first, with the value of ending the turn for comparison. */
function rankMoves(s) {
  const me = s.current;
  const model = snapshot(s, me);
  const seed = seedOf(s);
  const baseline = average((rng) => rollout(model, rng, [], LOOKAHEAD), seed);
  const free = E.handSize(s, me);
  const moves = E.legalMoves(s).map((mv) => {
    const m = copyModel(model);
    // never spend the last free die on a card it does not finish: that leaves nothing to roll next turn
    const c = model.cards[mv.card];
    const allowed = free > 1 || c.placed + 1 === c.total;
    const face = s.rolled[mv.rolled];
    const finishes = m.cards[mv.card].placed + 1 === m.cards[mv.card].total;
    const gainedNow = put(m, m.cards[mv.card], face, true);
    if (m.score >= E.TARGET_SCORE) return { ...mv, allowed, value: gainedNow + 1e-3 }; // a winning card ends the game, and beats any other way of winning
    const rest = s.rolled.filter((_, i) => i !== mv.rolled);
    // On a tie, finish the card first.
    return { ...mv, allowed, value: gainedNow + average((rng) => rollout(m, rng, rest, LOOKAHEAD), seed) + (finishes ? 1e-6 : 0) };
  });
  moves.sort((a, b) => b.value - a.value);
  return { moves, baseline };
}

/** The simple strategy: finish cards when possible, otherwise favour big cards that are nearly done. */
function greedyAction(s, rng, minFree = 0, nearDone = 0) {
  const me = s.current;
  if (s.phase === 'start') {
    const hand = E.handSize(s, me);
    if (hand === 0) return { type: 'takeback' };
    const closest = Math.min(...s.cards.map((c) => (c.placed[me].length ? E.missing(c, me).length : Infinity)));
    return hand <= 2 && closest > 1 && rng() < 0.6 ? { type: 'takeback' } : { type: 'roll' };
  }
  let best = null;
  let bestScore = -Infinity;
  const free = E.handSize(s, me); // dice not on cards, rolled ones included
  for (const m of E.legalMoves(s)) {
    const card = s.cards[m.card];
    const left = E.missing(card, me).length - 1;
    // Spending a die leaves one fewer to roll next turn: don't go below `minFree` unless this finishes the card.
    if (left > 0 && (free - 1 < 1 || (left > nearDone && free - 1 < minFree))) continue; // never spend the last free die on a card that stays unfinished
    const score = card.points / (left + 1) + (left === 0 ? 100 : 0) + rng() * 0.1;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best ? { type: 'place', rolled: best.rolled, card: best.card } : { type: 'end' };
}

/**
 * Strengths. `smartTakeBack`: decide Take Back by looking ahead. `smartPlace`: how often a placement decision
 * (where to put a die, or whether to place it at all or keep it to roll again) uses the look-ahead.
 * `minFree`: when not using the look-ahead, don't spend a die that would leave fewer than this many free to roll
 * next turn unless the die finishes the card, or leaves it one die from done (`nearDone`). A die that would
 * leave nothing to roll is never spent on a card it does not finish.
 */
export const LEVELS = {
  easy: { smartTakeBack: false, smartPlace: 0, minFree: 1, nearDone: 0 },
  normal: { smartTakeBack: false, smartPlace: 0, minFree: 2, nearDone: 1 }, // sensible rules of thumb, no look-ahead
  hard: { smartTakeBack: true, smartPlace: 1, minFree: 0, nearDone: 0 },
};
export const DEFAULT_LEVEL = 'normal';

/**
 * Rollick Extreme: should the computer play a power card now? Returns an action or null.
 * Easy players only think of the simple cards, and only some of the time; Hard players always do.
 */
function powerAction(s, level, rng) {
  const me = s.current;
  const held = new Set(s.players[me].powers || []);
  if (!held.size || s.phase !== 'placing') return null;
  const chance = level === 'hard' ? 1 : level === 'easy' ? 0.4 : 0.8;
  const allowed = (kind) => held.has(kind) && (level !== 'easy' || kind === 'reroll' || kind === 'bonus') && rng() < chance;
  const hand = s.rolled;
  const completes = (card, face) => {
    const left = E.missing(card, me);
    return left.length === 1 && left[0] === face;
  };

  // Turn a spare die into the number that finishes a card.
  if (allowed('set')) {
    let best = null;
    s.cards.forEach((card, c) => {
      const left = E.missing(card, me);
      if (left.length !== 1 || hand.includes(left[0])) return; // already finishable, or not one die away
      hand.forEach((f, r) => {
        const spare = !s.cards.some((other) => E.missing(other, me).includes(f)); // this die has nowhere to go
        if (spare && (!best || card.points > best.points)) best = { type: 'power', kind: 'set', rolled: r, face: left[0], points: card.points };
      });
    });
    if (best) { delete best.points; return best; }
  }
  // A bonus is worth playing just before a card is finished.
  if (allowed('bonus') && !s.bonus && E.legalMoves(s).some((m) => completes(s.cards[m.card], s.rolled[m.rolled]))) return { type: 'power', kind: 'bonus' };
  // Knock a die off a card a rival is about to finish.
  if (allowed('knock')) {
    let best = null;
    s.cards.forEach((card, c) => s.players.forEach((_, p) => {
      if (p === me || !card.placed[p].length || E.missing(card, p).length > 1) return;
      if (card.points >= 5 && (!best || card.points > best.points)) best = { type: 'power', kind: 'knock', card: c, player: p, points: card.points };
    }));
    if (best) { delete best.points; return best; }
  }
  // Re-roll a die that has nowhere to go.
  if (allowed('reroll')) {
    const useless = hand.findIndex((f) => !s.cards.some((card) => E.missing(card, me).includes(f)));
    if (useless >= 0) return { type: 'power', kind: 'reroll', rolled: useless };
  }
  // Make a rival who is close to winning miss a turn (or get rid of a spare card).
  if (allowed('skip') && !s.skipNext) {
    const close = s.players.some((p, i) => i !== me && p.score >= E.TARGET_SCORE - 12);
    if (close || held.size >= E.MAX_POWERS) return { type: 'power', kind: 'skip' };
  }
  return null;
}

/** Decide the CPU's next single action for the current state. */
export function aiNextAction(s, { level = DEFAULT_LEVEL, rng = Math.random } = {}) {
  const { smartTakeBack, smartPlace, minFree, nearDone } = LEVELS[level] || LEVELS[DEFAULT_LEVEL];
  if (s.phase === 'start') return smartTakeBack ? smartStart(s, minFree, nearDone) : greedyAction(s, rng, minFree, nearDone);
  if (s.mode === 'extreme') {
    const power = powerAction(s, level, rng);
    if (power) return power;
  }
  return smartPlace >= 1 || rng() < smartPlace ? smartPlacing(s) : greedyAction(s, rng, minFree, nearDone);
}

function smartStart(s, minFree = 0, nearDone = 0) {
  const me = s.current;
  {
    const hand = E.handSize(s, me);
    if (hand === 0) return { type: 'takeback' };
    if (hand === E.DICE_PER_PLAYER) return { type: 'roll' };
    // Keep what is on the cards, or take it all back and roll all six: whichever plays out better.
    const keep = snapshot(s, me);
    const reset = copyModel(keep);
    reset.onCards = 0;
    for (const c of reset.cards) { c.have.fill(0); c.placed = 0; }
    const seed = seedOf(s);
    const keepValue = average((rng) => rollout(keep, rng, null, LOOKAHEAD, minFree, nearDone), seed);
    const resetValue = average((rng) => rollout(reset, rng, null, LOOKAHEAD, minFree, nearDone), seed);
    return resetValue > keepValue + 0.5 ? { type: 'takeback' } : { type: 'roll' };
  }
}

function smartPlacing(s) {
  if (!E.legalMoves(s).length) return { type: 'end' };
  const { moves, baseline } = rankMoves(s);
  const best = moves.find((mv) => mv.allowed);
  // Only place a die if doing so beats ending the turn and keeping it to roll again.
  return best && best.value > baseline + 0.05 ? { type: 'place', rolled: best.rolled, card: best.card } : { type: 'end' };
}

/** The best legal placement even when ending the turn would be better (or null if nothing fits). */
export function bestPlacement(s) {
  const { moves } = rankMoves(s);
  return moves.length ? { rolled: moves[0].rolled, card: moves[0].card } : null;
}

/** For tools and tests: every legal placement with its value, and the value of ending the turn instead. */
export const explain = rankMoves;

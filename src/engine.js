// Pure game rules for Rollick. No DOM access; every transition returns a new state.

export const DICE_PER_PLAYER = 6;
export const TARGET_SCORE = 40;
export const MAX_PLAYERS = 8; // one set plays 2-4; two sets play up to 8

// One 30-card set: [shape, points]. A shape lists how many dice of each distinct face a card
// needs, so [2, 1] is "a pair plus one other number". Three cards per tier.
// Points track difficulty: the expected turns to finish each shape (simulated, rolling every free
// die each turn and placing every match) are shown alongside, so harder cards are worth more.
const SET_SHAPES = [
  [[1], 2], //          1.5 turns
  [[1, 1], 3], //       2.0
  [[2], 4], //          2.5
  [[2, 1], 5], //       3.1
  [[1, 1, 1, 1], 6], // 3.3
  [[2, 2], 7], //       4.2
  [[3, 1], 9], //       4.7
  [[2, 2, 1], 11], //   5.6
  [[3, 2], 13], //      6.4
  [[5], 15], //         8.5
];
const CARDS_PER_SHAPE = 3;

const shapeOf = (faces) => {
  const counts = new Map();
  for (const f of faces) counts.set(f, (counts.get(f) || 0) + 1);
  return [...counts.values()].sort((a, b) => b - a).join(',');
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function multisets(size, min = 1) {
  if (size === 0) return [[]];
  const out = [];
  for (let f = min; f <= 6; f++) {
    for (const rest of multisets(size - 1, f)) out.push([f, ...rest]);
  }
  return out;
}

export function buildDeck(rng, sets = 1) {
  const deck = [];
  for (let s = 0; s < sets; s++) {
    for (const [shape, points] of SET_SHAPES) {
      const size = shape.reduce((a, b) => a + b, 0);
      const key = [...shape].sort((a, b) => b - a).join(',');
      const pool = multisets(size).filter((m) => shapeOf(m) === key);
      for (const need of shuffle(pool, rng).slice(0, CARDS_PER_SHAPE)) deck.push({ points, need });
    }
  }
  return shuffle(deck, rng);
}

export const cardsInPlay = (playerCount) => (playerCount >= 5 ? 4 : 3);

/** The faces `player` still needs on `card`. */
export function missing(card, player) {
  const left = [...card.need];
  for (const f of card.placed[player]) {
    const i = left.indexOf(f);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

export function handSize(state, player) {
  const onCards = state.cards.reduce((n, c) => n + c.placed[player].length, 0);
  return DICE_PER_PLAYER - onCards;
}

/** Everyone rolls two dice; highest total goes first, ties roll again. */
function rollOff(count, rng) {
  let contenders = Array.from({ length: count }, (_, i) => i);
  let rolls = [];
  while (contenders.length > 1) {
    rolls = contenders.map((i) => ({ i, total: 2 + Math.floor(rng() * 6) + Math.floor(rng() * 6) }));
    const top = Math.max(...rolls.map((r) => r.total));
    contenders = rolls.filter((r) => r.total === top).map((r) => r.i);
  }
  return { first: contenders[0], total: rolls.length ? rolls.find((r) => r.i === contenders[0]).total : 0 };
}

export function newGame(configs, rng = Math.random) {
  if (configs.length < 2 || configs.length > MAX_PLAYERS) throw new Error('2-8 players');
  const players = configs.map((c) => ({ name: c.name, cpu: !!c.cpu, score: 0, pile: [] })); // pile: points of cards claimed
  const { first, total } = rollOff(players.length, rng);
  const state = {
    players,
    deck: buildDeck(rng, players.length > 4 ? 2 : 1),
    cards: [],
    current: first,
    firstRoll: total,
    phase: 'start', // start -> placing -> (next player's) start ... -> over
    rolled: [],
    winner: null,
    lastClaim: null,
    nextId: 1,
  };
  for (let i = 0; i < cardsInPlay(players.length); i++) draw(state);
  return state;
}

function draw(state) {
  const base = state.deck.shift();
  if (!base) return false;
  state.cards.push({
    id: state.nextId++,
    points: base.points,
    need: base.need,
    placed: state.players.map(() => []),
  });
  return true;
}

function assertPhase(state, phase) {
  if (state.phase !== phase) throw new Error(`Expected phase ${phase}, got ${state.phase}`);
}

/** Take Back: before rolling, return ALL of your dice from the trays to your hand. */
export function takeBack(state) {
  assertPhase(state, 'start');
  const s = structuredClone(state);
  s.lastClaim = null;
  for (const c of s.cards) c.placed[s.current] = [];
  return s;
}

export function roll(state, rng = Math.random) {
  assertPhase(state, 'start');
  const n = handSize(state, state.current);
  if (n <= 0) throw new Error('No dice in hand; take them back first');
  const s = structuredClone(state);
  s.lastClaim = null;
  s.rolled = Array.from({ length: n }, () => 1 + Math.floor(rng() * 6));
  s.phase = 'placing';
  return s;
}

export function canPlace(state, rolledIdx, cardIdx) {
  if (state.phase !== 'placing') return false;
  const face = state.rolled[rolledIdx];
  const card = state.cards[cardIdx];
  return face !== undefined && !!card && missing(card, state.current).includes(face);
}

export function legalMoves(state) {
  const moves = [];
  if (state.phase !== 'placing') return moves;
  state.rolled.forEach((_, r) => {
    state.cards.forEach((_, c) => {
      if (canPlace(state, r, c)) moves.push({ rolled: r, card: c });
    });
  });
  return moves;
}

export function place(state, rolledIdx, cardIdx) {
  if (!canPlace(state, rolledIdx, cardIdx)) throw new Error('Illegal placement');
  const s = structuredClone(state);
  s.lastClaim = null;
  const p = s.current;
  const card = s.cards[cardIdx];
  card.placed[p].push(s.rolled[rolledIdx]);
  s.rolled.splice(rolledIdx, 1);

  if (missing(card, p).length === 0) {
    s.players[p].score += card.points;
    s.players[p].pile = [...(s.players[p].pile || []), card.points];
    s.lastClaim = { player: p, points: card.points, need: card.need };
    // Every player's dice on the claimed card go back to their hands.
    s.cards.splice(cardIdx, 1);
    draw(s);
    if (s.players[p].score >= TARGET_SCORE) {
      s.phase = 'over';
      s.winner = p;
    } else if (s.cards.length === 0) {
      s.phase = 'over';
      s.winner = s.players.reduce((best, pl, i) => (pl.score > s.players[best].score ? i : best), 0);
    }
  }
  return s;
}

/** Leftover rolled dice return to hand; play passes on. */
export function endTurn(state) {
  assertPhase(state, 'placing');
  const s = structuredClone(state);
  s.lastClaim = null;
  s.rolled = [];
  s.current = (s.current + 1) % s.players.length;
  s.phase = 'start';
  return s;
}

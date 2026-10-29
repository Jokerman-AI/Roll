// Pure game rules for Roll for It. No DOM access; every transition returns a new state.

export const DICE_PER_PLAYER = 6;
export const CARDS_IN_PLAY = 3;
export const TARGET_SCORE = 40;

// How many cards of each size go in the deck, and what they are worth.
const TIERS = [
  { size: 2, points: 10, count: 12 },
  { size: 3, points: 20, count: 12 },
  { size: 4, points: 30, count: 6 },
];

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

export function buildDeck(rng) {
  const deck = [];
  for (const tier of TIERS) {
    for (const need of shuffle(multisets(tier.size), rng).slice(0, tier.count)) {
      deck.push({ points: tier.points, need });
    }
  }
  return shuffle(deck, rng);
}

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

export function newGame(configs, rng = Math.random) {
  const players = configs.map((c) => ({ name: c.name, cpu: !!c.cpu, score: 0 }));
  const deck = buildDeck(rng);
  const state = {
    players,
    deck,
    cards: [],
    current: 0,
    phase: 'start', // start -> placing -> (next player's) start ... -> over
    rolled: [],
    winner: null,
    lastClaim: null,
    nextId: 1,
  };
  for (let i = 0; i < CARDS_IN_PLAY; i++) draw(state);
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

/** Take a placed die back into hand (only before rolling). */
export function pickUp(state, cardIdx, face) {
  assertPhase(state, 'start');
  const s = structuredClone(state);
  s.lastClaim = null;
  const placed = s.cards[cardIdx]?.placed[s.current];
  const i = placed ? placed.indexOf(face) : -1;
  if (i < 0) throw new Error('No such die to pick up');
  placed.splice(i, 1);
  return s;
}

export function roll(state, rng = Math.random) {
  assertPhase(state, 'start');
  const n = handSize(state, state.current);
  if (n <= 0) throw new Error('No dice in hand; pick one up first');
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

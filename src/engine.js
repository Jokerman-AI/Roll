// Pure game rules for Rollick. No DOM access; every transition returns a new state.

export const DICE_PER_PLAYER = 6;
export const TARGET_SCORE = 40;
/** The choices a room can make: how many points win, and how many dice each player owns. */
export const SETTINGS = { targets: [20, 30, 40, 60], dice: [4, 5, 6, 7, 8] };
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

export function buildDeck(rng, sets = 1, maxDice = 5) {
  const deck = [];
  for (let s = 0; s < sets; s++) {
    for (const [shape, points] of SET_SHAPES) {
      const size = shape.reduce((a, b) => a + b, 0);
      if (size > maxDice) continue; // a card that needs more dice than anyone owns could never be finished
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

/** The points that win this game, and the dice each player owns. Older saved games carry neither. */
export const targetOf = (state) => state.target ?? TARGET_SCORE;
export const diceOf = (state) => state.dice ?? DICE_PER_PLAYER;

export function handSize(state, player) {
  const onCards = state.cards.reduce((n, c) => n + c.placed[player].length, 0);
  return diceOf(state) - onCards;
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

export const LEVEL_NAMES = ['easy', 'normal', 'hard'];

/* ---------- Rollick Extreme ---------- */

export const MODES = ['classic', 'extreme'];
export const MAX_POWERS = 3; // power cards a player can hold
export const BONUS_POINTS = 3;

/** One-use cards, played during your own turn after rolling. */
export const POWERS = {
  reroll: { name: 'Re-roll', icon: '🔄', text: 'Re-roll one of the dice you just rolled.', weight: 3 },
  set: { name: 'Set a die', icon: '🎯', text: 'Turn one rolled die into any number you like.', weight: 2 },
  knock: { name: 'Knock off', icon: '💥', text: "Remove one of a rival's dice from a card.", weight: 2 },
  bonus: { name: 'Bonus +3', icon: '⭐', text: `The next card you claim this turn scores ${BONUS_POINTS} extra points.`, weight: 2 },
  skip: { name: 'Skip', icon: '⏭️', text: 'The next player misses their turn.', weight: 1 },
};
export const POWER_KINDS = Object.keys(POWERS);
const POWER_START = 1; // power cards each player starts with
const POWER_FROM_CLAIM = 7; // claim a card worth this many points or more to earn a power card
const LUCKY_ROLL = 3; // roll this many of the same number to earn a power card
const CHAOS_DOUBLE = 0.3; // chance a new round starts as a double-points round
const CHAOS_RESET = 0.1; // chance a new round starts with every die sent home

const isExtreme = (s) => s.mode === 'extreme';

function randomPower(rng) {
  const total = POWER_KINDS.reduce((n, k) => n + POWERS[k].weight, 0);
  let r = rng() * total;
  for (const k of POWER_KINDS) { r -= POWERS[k].weight; if (r < 0) return k; }
  return POWER_KINDS[0];
}

/** Give `player` a random power card if they have room. Returns the kind, or null when their hand is full. */
function grantPower(s, player, rng) {
  const hand = s.players[player].powers;
  if (hand.length >= MAX_POWERS) return null;
  const kind = randomPower(rng);
  hand.push(kind);
  return kind;
}

const pickSetting = (value, list, fallback) => (list.includes(value) ? value : fallback);

/** Settings from outside (a saved file, or another player's room) turned into safe numbers. */
export function cleanSettings(raw) {
  return {
    target: pickSetting(Number(raw?.target), SETTINGS.targets, TARGET_SCORE),
    dice: pickSetting(Number(raw?.dice), SETTINGS.dice, DICE_PER_PLAYER),
  };
}

export function newGame(configs, rng = Math.random, { mode = 'classic', target, dice } = {}) {
  if (configs.length < 2 || configs.length > MAX_PLAYERS) throw new Error('2-8 players');
  const players = configs.map((c) => ({ name: c.name, cpu: !!c.cpu, level: LEVEL_NAMES.includes(c.level) ? c.level : 'normal', score: 0, pile: [] })); // pile: points of cards claimed
  const extreme = mode === 'extreme';
  const diceCount = pickSetting(dice, SETTINGS.dice, DICE_PER_PLAYER);
  if (extreme) for (const p of players) p.powers = Array.from({ length: POWER_START }, () => randomPower(rng));
  const { first, total } = rollOff(players.length, rng);
  const state = {
    mode: extreme ? 'extreme' : 'classic',
    target: pickSetting(target, SETTINGS.targets, TARGET_SCORE),
    dice: diceCount,
    players,
    deck: buildDeck(rng, players.length > 4 ? 2 : 1, diceCount),
    cards: [],
    current: first,
    firstRoll: total,
    phase: 'start', // start -> placing -> (next player's) start ... -> over
    rolled: [],
    winner: null,
    lastClaim: null,
    nextId: 1,
    ...(extreme ? { turn: 0, chaos: null, bonus: 0, skipNext: false, events: [] } : {}),
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
  if (isExtreme(s)) s.events = [];
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
  if (isExtreme(s)) {
    s.events = [];
    const counts = new Map();
    for (const f of s.rolled) counts.set(f, (counts.get(f) || 0) + 1);
    if (Math.max(...counts.values()) >= LUCKY_ROLL) {
      const kind = grantPower(s, s.current, rng);
      if (kind) s.events.push({ type: 'lucky', player: s.current, kind });
    }
  }
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

export function place(state, rolledIdx, cardIdx, rng = Math.random) {
  if (!canPlace(state, rolledIdx, cardIdx)) throw new Error('Illegal placement');
  const s = structuredClone(state);
  s.lastClaim = null;
  if (isExtreme(s)) s.events = [];
  const p = s.current;
  const card = s.cards[cardIdx];
  card.placed[p].push(s.rolled[rolledIdx]);
  s.rolled.splice(rolledIdx, 1);

  if (missing(card, p).length === 0) {
    let points = card.points;
    if (isExtreme(s)) {
      if (s.chaos?.kind === 'double') points *= 2;
      points += s.bonus;
      s.bonus = 0;
      if (card.points >= POWER_FROM_CLAIM) {
        const kind = grantPower(s, p, rng);
        if (kind) s.events.push({ type: 'earned', player: p, kind });
      }
    }
    s.players[p].score += points;
    s.players[p].pile = [...(s.players[p].pile || []), points];
    s.lastClaim = { player: p, points, need: card.need };
    // Every player's dice on the claimed card go back to their hands.
    s.cards.splice(cardIdx, 1);
    draw(s);
    if (s.players[p].score >= targetOf(s)) {
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
export function endTurn(state, rng = Math.random) {
  assertPhase(state, 'placing');
  const s = structuredClone(state);
  s.lastClaim = null;
  s.rolled = [];
  s.current = (s.current + 1) % s.players.length;
  s.phase = 'start';
  if (isExtreme(s)) {
    s.events = [];
    s.bonus = 0; // an unused bonus is lost
    const n = s.players.length;
    const round = Math.floor(s.turn / n);
    s.turn++;
    if (s.skipNext) {
      s.skipNext = false;
      s.events.push({ type: 'skipped', player: s.current });
      s.current = (s.current + 1) % n;
      s.turn++;
    }
    if (Math.floor(s.turn / n) > round) newRound(s, rng); // also when a skipped turn carried us over the line
  }
  return s;
}

/** A new round: the last round's chaos ends, and a new one may begin. */
function newRound(s, rng) {
  s.chaos = null;
  const r = rng();
  if (r < CHAOS_DOUBLE) {
    s.chaos = { kind: 'double' };
    s.events.push({ type: 'chaos', kind: 'double' });
  } else if (r < CHAOS_DOUBLE + CHAOS_RESET) {
    for (const c of s.cards) c.placed = s.players.map(() => []);
    s.events.push({ type: 'chaos', kind: 'reset' });
  }
}

/** Why `kind` cannot be played with `args` right now, or null if it can. */
export function powerProblem(state, kind, args = {}) {
  if (!isExtreme(state)) return 'Power cards are only in Rollick Extreme';
  if (state.phase !== 'placing') return 'Roll first';
  if (!POWERS[kind] || !state.players[state.current].powers.includes(kind)) return 'You do not hold that card';
  const me = state.current;
  switch (kind) {
    case 'reroll': return state.rolled[args.rolled] === undefined ? 'Pick a die' : null;
    case 'set':
      if (state.rolled[args.rolled] === undefined) return 'Pick a die';
      return Number.isInteger(args.face) && args.face >= 1 && args.face <= 6 ? null : 'Pick a number';
    case 'knock': {
      const card = state.cards[args.card];
      if (!card || !Number.isInteger(args.player) || args.player === me || !card.placed[args.player]?.length) return "Pick a rival's die on a card";
      return null;
    }
    case 'bonus': return null;
    case 'skip': return state.skipNext ? 'Already skipping the next player' : null;
    default: return 'Unknown card';
  }
}

/** Play a power card. `args` depends on the card: { rolled }, { rolled, face }, { card, player }. */
export function usePower(state, kind, args = {}, rng = Math.random) {
  const problem = powerProblem(state, kind, args);
  if (problem) throw new Error(problem);
  const s = structuredClone(state);
  s.lastClaim = null;
  const me = s.current;
  const hand = s.players[me].powers;
  hand.splice(hand.indexOf(kind), 1);
  const event = { type: 'power', player: me, kind };
  switch (kind) {
    case 'reroll': s.rolled[args.rolled] = 1 + Math.floor(rng() * 6); break;
    case 'set': s.rolled[args.rolled] = args.face; break;
    case 'knock': s.cards[args.card].placed[args.player].pop(); event.target = args.player; break;
    case 'bonus': s.bonus += BONUS_POINTS; break;
    case 'skip': s.skipNext = true; break;
    default: break;
  }
  s.events = [event];
  return s;
}

/** Every way the current player could play a power card right now (for hints, the computer and tests). */
export function powerMoves(state) {
  if (!isExtreme(state) || state.phase !== 'placing') return [];
  const me = state.current;
  const out = [];
  for (const kind of new Set(state.players[me].powers)) {
    if (kind === 'reroll') state.rolled.forEach((_, rolled) => out.push({ kind, rolled }));
    else if (kind === 'set') state.rolled.forEach((_, rolled) => { for (let face = 1; face <= 6; face++) if (face !== state.rolled[rolled]) out.push({ kind, rolled, face }); });
    else if (kind === 'knock') state.cards.forEach((c, card) => state.players.forEach((_, player) => { if (player !== me && c.placed[player].length) out.push({ kind, card, player }); }));
    else if (!powerProblem(state, kind)) out.push({ kind });
  }
  return out;
}

/* ---------- the guided first game ---------- */

/** The dice the tutorial's first roll lands on, so every lesson has an obvious move. */
export const TUTORIAL_ROLL = [3, 5, 5, 2, 6, 1];

/** A generator that hands back exactly these faces, one per call, for `roll`. */
export const scriptedRng = (faces) => {
  const queue = [...faces];
  return () => ((queue.shift() ?? 1) - 0.5) / 6;
};

/**
 * A table set up for teaching: with TUTORIAL_ROLL, the 3 finishes the first card, the two 5s the second, the
 * 2 and 6 the third, and the 1 fits nowhere. The cards that replace them avoid the numbers still to be placed.
 */
export function tutorialGame() {
  const players = [
    { name: 'You', cpu: false, level: 'normal', score: 0, pile: [] },
    { name: 'Coach', cpu: true, level: 'easy', score: 0, pile: [] },
  ];
  const card = (id, points, need) => ({ id, points, need, placed: players.map(() => []) });
  const queue = [{ points: 2, need: [4] }, { points: 4, need: [4, 4] }, { points: 3, need: [3, 4] }];
  const rest = buildDeck(mulberry32(21), 1).filter((c) => !c.need.includes(1)); // nothing needs a 1 early on
  return {
    mode: 'classic',
    target: TARGET_SCORE,
    dice: DICE_PER_PLAYER,
    players,
    deck: [...queue, ...rest],
    cards: [card(1, 2, [3]), card(2, 4, [5, 5]), card(3, 3, [2, 6])],
    current: 0,
    firstRoll: 0,
    phase: 'start',
    rolled: [],
    winner: null,
    lastClaim: null,
    nextId: 4,
  };
}

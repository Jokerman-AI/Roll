import * as E from '../src/engine.js';

/** Decide the CPU's next single action for the current state. */
export function aiNextAction(s, rng = Math.random) {
  const me = s.current;

  if (s.phase === 'start') {
    const hand = E.handSize(s, me);
    if (hand === 0) return { type: 'takeback' };
    // Take Back resets everything, so only do it when stuck with few dice and no card nearly done.
    const closest = Math.min(...s.cards.map((c) => (c.placed[me].length ? E.missing(c, me).length : Infinity)));
    if (hand <= 2 && closest > 1 && rng() < 0.6) return { type: 'takeback' };
    return { type: 'roll' };
  }

  const best = bestPlacement(s, rng);
  return best ? { type: 'place', ...best } : { type: 'end' };
}

/** The placement the CPU would choose: finishing a card beats progress, and bigger cards beat smaller ones. */
export function bestPlacement(s, rng = Math.random) {
  const me = s.current;
  const moves = E.legalMoves(s);
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const card = s.cards[m.card];
    const left = E.missing(card, me).length - 1;
    const score = card.points / (left + 1) + (left === 0 ? 100 : 0) + rng() * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = { rolled: m.rolled, card: m.card };
    }
  }
  return best;
}

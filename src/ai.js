import * as E from './engine.js';

/** Decide the CPU's next single action for the current state. */
export function aiNextAction(s, rng = Math.random) {
  const me = s.current;

  if (s.phase === 'start') {
    const hand = E.handSize(s, me);
    if (hand === 0 || (hand === 1 && rng() < 0.5)) {
      const pick = weakestPlacedDie(s, me);
      if (pick) return { type: 'pickup', ...pick };
    }
    return { type: 'roll' };
  }

  const moves = E.legalMoves(s);
  if (!moves.length) return { type: 'end' };
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const card = s.cards[m.card];
    const left = E.missing(card, me).length - 1;
    const score = card.points / (left + 1) + (left === 0 ? 100 : 0) + rng() * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return { type: 'place', rolled: best.rolled, card: best.card };
}

// The die sitting on the card furthest from completion.
function weakestPlacedDie(s, me) {
  let best = null;
  s.cards.forEach((card, ci) => {
    const placed = card.placed[me];
    if (!placed.length) return;
    const progress = placed.length / card.need.length;
    if (!best || progress < best.progress) best = { progress, card: ci, face: placed[placed.length - 1] };
  });
  return best && { card: best.card, face: best.face };
}

// Plays the current computer player against the previous one and reports win rates.
//   node tools/bench-ai.mjs [games per matchup]
import * as E from '../src/engine.js';
import { aiNextAction, LEVELS, DEFAULT_LEVEL } from '../src/ai.js';
import { aiNextAction as legacy } from './legacy-ai.mjs';

const GAMES = +process.argv[2] || 200;
const LEVEL_NAMES = (process.argv[3] || DEFAULT_LEVEL).split(','); // e.g. normal,hard

function play(agents, seed) {
  const rng = E.mulberry32(seed * 104729);
  let s = E.newGame(agents.map((_, i) => ({ name: `p${i}` })), rng);
  let steps = 0;
  while (s.phase !== 'over' && steps++ < 30000) {
    const a = agents[s.current](s, rng);
    if (a.type === 'takeback') s = E.takeBack(s);
    else if (a.type === 'roll') s = E.roll(s, rng);
    else if (a.type === 'place') s = E.place(s, a.rolled, a.card);
    else s = E.endTurn(s);
  }
  return { winner: s.phase === 'over' ? s.winner : -1, turns: steps, scores: s.players.map((p) => p.score) };
}

function matchup(label, seats, n, level) {
  const current = (s, rng) => aiNextAction(s, { level, rng });
  // seats: array of 'new' | 'old'; rotate who sits first so seat order does not matter
  const wins = { new: 0, old: 0, none: 0 };
  let ms = 0;
  for (let g = 0; g < n; g++) {
    const order = seats.map((_, i) => seats[(i + g) % seats.length]);
    const agents = order.map((k) => (k === 'new' ? current : legacy));
    const t0 = performance.now();
    const r = play(agents, g + 1);
    ms += performance.now() - t0;
    if (r.winner < 0) wins.none++; else wins[order[r.winner]]++;
  }
  const newSeats = seats.filter((k) => k === 'new').length;
  const expected = (newSeats / seats.length) * 100;
  console.log(`${level.padEnd(6)} ${label.padEnd(28)} new bot wins ${(wins.new / n * 100).toFixed(0).padStart(3)}% (even skill would be ${expected.toFixed(0)}%) | unfinished ${wins.none} | ${(ms / n).toFixed(0)} ms/game`);
}

for (const level of LEVEL_NAMES) {
  matchup('2 players: new vs old', ['new', 'old'], GAMES, level);
  matchup('4 players: 1 new vs 3 old', ['new', 'old', 'old', 'old'], GAMES, level);
}

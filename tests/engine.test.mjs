import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { aiNextAction, bestPlacement } from '../src/ai.js';
import { cpuName } from '../src/profile.js';

const cfg = [{ name: 'A' }, { name: 'B', cpu: true }];

test('one set is 30 cards worth 2-15 points; 3 are dealt', () => {
  const s = E.newGame(cfg, E.mulberry32(1));
  assert.equal(s.cards.length, 3);
  const all = [...s.cards, ...s.deck];
  assert.equal(all.length, 30);
  assert.equal(Math.min(...all.map((c) => c.points)), 2);
  assert.equal(Math.max(...all.map((c) => c.points)), 15);
});

test('harder cards are worth more points', () => {
  const all = E.buildDeck(E.mulberry32(11));
  const ofPoints = (pts) => all.filter((c) => c.points === pts);
  assert.ok(ofPoints(2).every((c) => c.need.length === 1));
  assert.ok(ofPoints(15).every((c) => c.need.length === 5 && new Set(c.need).size === 1)); // five of a kind
  const hard = all.filter((c) => c.points >= 11);
  assert.ok(hard.length >= 9 && hard.every((c) => c.need.length === 5));
  const dice = (pts) => ofPoints(pts)[0].need.length;
  assert.ok(dice(15) > dice(7) && dice(7) > dice(3));
  assert.deepEqual([...new Set(all.map((c) => c.points))].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 9, 11, 13, 15]);
});

test('5+ players use two sets and four face-up cards', () => {
  const s = E.newGame(Array.from({ length: 6 }, (_, i) => ({ name: `p${i}` })), E.mulberry32(7));
  assert.equal(s.cards.length, 4);
  assert.equal(s.cards.length + s.deck.length, 60);
  assert.throws(() => E.newGame(Array.from({ length: 9 }, () => ({ name: 'x' }))));
});

test('start player has the highest two-dice roll-off', () => {
  for (let seed = 1; seed < 50; seed++) {
    const s = E.newGame(cfg, E.mulberry32(seed));
    assert.ok(s.current === 0 || s.current === 1);
    assert.ok(s.firstRoll >= 2 && s.firstRoll <= 12);
  }
});

test('rolling uses all dice in hand', () => {
  const s = E.roll(E.newGame(cfg, E.mulberry32(2)), E.mulberry32(3));
  assert.equal(s.rolled.length, 6);
  assert.equal(s.phase, 'placing');
});

test('only needed faces can be placed; claim scores and refills', () => {
  let s = E.newGame(cfg, E.mulberry32(4));
  const card = s.cards[0];
  s.phase = 'placing';
  s.rolled = [...card.need, 6];
  const id = card.id;
  for (let i = 0; i < card.need.length; i++) s = E.place(s, 0, 0);
  assert.equal(s.players[s.current].score, card.points);
  assert.equal(s.cards.length, 3);
  assert.notEqual(s.cards[2].id, id);
  assert.equal(E.handSize(s, s.current), 6);
});

test('claimed cards go into the claimer\'s pile', () => {
  let s = E.newGame(cfg, E.mulberry32(21));
  const me = s.current;
  const card = s.cards[0];
  s.phase = 'placing';
  s.rolled = [...card.need];
  for (let i = 0; i < card.need.length; i++) s = E.place(s, 0, 0);
  assert.deepEqual(s.players[me].pile, [card.points]);
  assert.deepEqual(s.players[1 - me].pile, []);
});

test('piles always add up to scores across whole games', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = E.mulberry32(seed);
    let s = E.newGame([{ name: 'a' }, { name: 'b' }, { name: 'c' }], rng);
    for (let n = 0; s.phase !== 'over' && n < 20000; n++) {
      const a = aiNextAction(s, { rng });
      if (a.type === 'takeback') s = E.takeBack(s);
      else if (a.type === 'roll') s = E.roll(s, rng);
      else if (a.type === 'place') s = E.place(s, a.rolled, a.card);
      else s = E.endTurn(s);
    }
    for (const p of s.players) assert.equal(p.pile.reduce((x, y) => x + y, 0), p.score);
  }
});

test('claiming returns opponents dice too', () => {
  let s = E.newGame(cfg, E.mulberry32(5));
  const card = s.cards[0];
  const other = 1 - s.current;
  card.placed[other].push(card.need[0]);
  s.phase = 'placing';
  s.rolled = [...card.need];
  for (let i = 0; i < card.need.length; i++) s = E.place(s, 0, 0);
  assert.equal(E.handSize(s, other), 6);
});

test('takeBack returns every die to hand', () => {
  let s = E.newGame(cfg, E.mulberry32(6));
  const me = s.current;
  s.cards[0].placed[me].push(s.cards[0].need[0]);
  s.cards[1].placed[me].push(s.cards[1].need[0]);
  assert.equal(E.handSize(s, me), 4);
  s = E.takeBack(s);
  assert.equal(E.handSize(s, me), 6);
  assert.equal(E.roll(s, E.mulberry32(1)).rolled.length, 6);
});

test('cannot roll with no dice in hand', () => {
  const full = E.newGame(cfg, E.mulberry32(8));
  full.cards[0].placed[full.current] = [1, 1, 1, 1, 1, 1];
  assert.throws(() => E.roll(full));
});

test('CPU vs CPU games always finish', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = E.mulberry32(seed);
    let s = E.newGame(Array.from({ length: 1 + (seed % 7) + 1 }, (_, i) => ({ name: `p${i}` })), rng);
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 20000) {
      const a = aiNextAction(s, { rng });
      if (a.type === 'takeback') s = E.takeBack(s);
      else if (a.type === 'roll') s = E.roll(s, rng);
      else if (a.type === 'place') s = E.place(s, a.rolled, a.card);
      else s = E.endTurn(s);
    }
    assert.equal(s.phase, 'over', `seed ${seed} did not finish`);
    assert.ok(s.players[s.winner].score >= 40 || s.cards.length === 0);
  }
});

test('computer players get short, unique, generated names', () => {
  const taken = [];
  for (let i = 0; i < 40; i++) {
    const name = cpuName(taken);
    assert.ok(name.length > 0 && name.length <= 12, `"${name}" fits a scoreboard chip`);
    assert.ok(!taken.some((n) => n.toLowerCase() === name.toLowerCase()), `"${name}" is new`);
    taken.push(name);
  }
  assert.match(cpuName(taken), /^Robo \d+$/); // the pool is used up, so it numbers them
  assert.notEqual(cpuName(['Dicey', 'dicey ']), 'Dicey'); // ignores case and spaces when avoiding repeats
});

/** Everything that must hold after every single move, whoever made it. */
function checkInvariants(s, deckSize, label) {
  const ids = s.cards.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: card ids are unique`);
  assert.ok(s.cards.length <= E.cardsInPlay(s.players.length), `${label}: no more cards than seats allow`);
  let claimed = 0;
  s.players.forEach((p, i) => {
    const hand = E.handSize(s, i);
    assert.ok(hand >= 0 && hand <= E.DICE_PER_PLAYER, `${label}: player ${i} has ${hand} dice in hand`);
    assert.equal(p.pile.reduce((a, b) => a + b, 0), p.score, `${label}: pile adds up to the score`);
    claimed += p.pile.length;
    s.cards.forEach((c) => {
      const left = [...c.need];
      for (const f of c.placed[i]) {
        const k = left.indexOf(f);
        assert.ok(k >= 0, `${label}: a placed die matches a picture the card needs`);
        left.splice(k, 1);
      }
      assert.ok(left.length > 0, `${label}: a completed card must have been claimed already`);
    });
  });
  assert.equal(s.cards.length + s.deck.length + claimed, deckSize, `${label}: no card is lost or duplicated`);
  if (s.phase === 'placing') assert.ok(s.rolled.length <= E.handSize(s, s.current), `${label}: rolled dice come from the hand`);
  else if (s.phase === 'start') assert.equal(s.rolled.length, 0, `${label}: nothing is rolled between turns`);
  assert.ok(s.current >= 0 && s.current < s.players.length, `${label}: current player exists`);
  if (s.phase === 'over') assert.ok(s.winner !== null, `${label}: a finished game has a winner`);
}

test('random legal play keeps every rule invariant (2-8 players, 60 games)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = E.mulberry32(seed * 7919);
    const count = 2 + (seed % 7);
    let s = E.newGame(Array.from({ length: count }, (_, i) => ({ name: `p${i}` })), rng);
    const deckSize = s.cards.length + s.deck.length;
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 80000) {
      const label = `seed ${seed} step ${steps}`;
      if (s.phase === 'start') {
        const hand = E.handSize(s, s.current);
        const onCards = E.DICE_PER_PLAYER - hand;
        if (hand === 0 || (onCards > 0 && rng() < 0.15)) s = E.takeBack(s);
        s = E.roll(s, rng);
      } else {
        const moves = E.legalMoves(s);
        if (!moves.length || rng() < 0.12) s = E.endTurn(s);
        else { const m = rng() < 0.6 ? bestPlacement(s, rng) : moves[Math.floor(rng() * moves.length)]; s = E.place(s, m.rolled, m.card); } // a mix of sensible and random moves
      }
      checkInvariants(s, deckSize, label);
    }
    assert.equal(s.phase, 'over', `seed ${seed} should finish`);
  }
});

test('illegal moves are rejected and leave the game untouched', () => {
  const s = E.newGame(cfg, E.mulberry32(99));
  assert.throws(() => E.place(s, 0, 0), 'cannot place before rolling');
  assert.throws(() => E.endTurn(s), 'cannot end a turn that has not started');
  const rolled = E.roll(s, E.mulberry32(5));
  assert.throws(() => E.roll(rolled), 'cannot roll twice');
  assert.throws(() => E.takeBack(rolled), 'cannot take back after rolling');
  const before = JSON.stringify(rolled);
  const bad = rolled.cards.findIndex((c, ci) => !E.canPlace(rolled, 0, ci));
  if (bad >= 0) assert.throws(() => E.place(rolled, 0, bad), 'cannot place a die on a card that does not need it');
  assert.equal(JSON.stringify(rolled), before, 'failed moves do not change the state');
});

test('hints are deterministic: the same state always gets the same advice', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = E.mulberry32(seed);
    const s = E.roll(E.newGame(cfg, rng), rng);
    assert.deepEqual(bestPlacement(s), bestPlacement(s));
    assert.deepEqual(aiNextAction(s, { level: 'hard' }), aiNextAction(s, { level: 'hard' }));
    const start = E.newGame(cfg, rng);
    assert.deepEqual(aiNextAction(start, { level: 'hard' }), aiNextAction(start, { level: 'hard' }));
  }
});

test('every strength of computer player finishes games, alone or mixed', () => {
  for (const levels of [['easy', 'easy'], ['normal', 'normal', 'normal'], ['hard', 'hard'], ['hard', 'normal', 'easy', 'hard']]) {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = E.mulberry32(seed * 31);
      let s = E.newGame(levels.map((_, i) => ({ name: `p${i}` })), rng);
      let steps = 0;
      while (s.phase !== 'over' && steps++ < 40000) {
        const a = aiNextAction(s, { level: levels[s.current], rng });
        if (a.type === 'takeback') s = E.takeBack(s);
        else if (a.type === 'roll') s = E.roll(s, rng);
        else if (a.type === 'place') s = E.place(s, a.rolled, a.card);
        else s = E.endTurn(s);
      }
      assert.equal(s.phase, 'over', `${levels.join('/')} seed ${seed} should finish`);
    }
  }
});

test('the computer takes a card that wins it the game', () => {
  const s = E.newGame(cfg, E.mulberry32(3));
  s.phase = 'placing';
  const me = s.current;
  s.players[me].score = 38; // any card wins
  const card = s.cards[0];
  card.placed[me] = card.need.slice(1); // one die short
  s.rolled = [card.need[0], card.need[0]];
  const a = aiNextAction(s, { level: 'hard' });
  assert.equal(a.type, 'place');
  assert.equal(a.card, 0, 'completes the card that wins');
});

test('no strength of computer player ever spends its last free die on a card it does not finish', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    for (let seed = 1; seed <= 15; seed++) {
      const rng = E.mulberry32(seed * 977);
      let s = E.newGame([{ name: 'a' }, { name: 'b' }, { name: 'c' }], rng);
      let steps = 0;
      while (s.phase !== 'over' && steps++ < 40000) {
        if (s.phase === 'start') assert.ok(E.handSize(s, s.current) > 0, `${level} seed ${seed}: started a turn with nothing to roll`);
        const a = aiNextAction(s, { level, rng });
        if (a.type === 'takeback') s = E.takeBack(s);
        else if (a.type === 'roll') s = E.roll(s, rng);
        else if (a.type === 'place') s = E.place(s, a.rolled, a.card);
        else s = E.endTurn(s);
      }
    }
  }
});

function craftedPosition(placedOnBig) {
  const s = E.newGame(cfg, E.mulberry32(8));
  s.phase = 'placing';
  const me = s.current;
  const blank = () => s.players.map(() => []);
  s.cards = [
    { id: 901, points: 15, need: [2, 2, 2, 2, 2], placed: blank() },
    { id: 902, points: 9, need: [1, 1, 3], placed: blank() },
    { id: 903, points: 3, need: [4, 5], placed: blank() },
  ];
  s.cards[0].placed[me] = Array(placedOnBig).fill(2);
  s.cards[1].placed[me] = [1, 1];
  s.rolled = [2]; // matches the big card
  return { s, me };
}

test('the computer keeps its last free die instead of filling every card', () => {
  const { s, me } = craftedPosition(3); // five dice on cards, one free die, and the big card would still need one more
  assert.equal(E.handSize(s, me), 1);
  for (const level of ['easy', 'normal', 'hard']) {
    assert.equal(aiNextAction(s, { level }).type, 'end', `${level} keeps its last free die`);
  }
});

test('the computer does spend a die when it finishes a card', () => {
  const { s, me } = craftedPosition(4); // six dice on cards... one free die that completes the 15-point card
  s.cards[0].placed[me] = [2, 2, 2, 2];
  s.cards[1].placed[me] = [1]; // five dice on cards, one free
  assert.equal(E.handSize(s, me), 1);
  for (const level of ['easy', 'normal', 'hard']) {
    const a = aiNextAction(s, { level });
    assert.deepEqual([a.type, a.card], ['place', 0], `${level} finishes the card`);
  }
});

test('each computer player keeps its own difficulty', () => {
  const g = E.newGame([{ name: 'A', cpu: true, level: 'hard' }, { name: 'B', cpu: true, level: 'easy' }, { name: 'C', cpu: true, level: 'bogus' }, { name: 'D' }]);
  assert.deepEqual(g.players.map((p) => p.level), ['hard', 'easy', 'normal', 'normal']);
});

/* ---------- Rollick Extreme ---------- */

const xcfg = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
const extreme = (seed = 3) => E.newGame(xcfg, E.mulberry32(seed), { mode: 'extreme' });
const placing = (s, rolled, powers = []) => {
  const t = structuredClone(s);
  t.phase = 'placing';
  t.rolled = rolled;
  t.players[t.current].powers = powers;
  return t;
};

test('classic games have no power cards; extreme players start with one', () => {
  const c = E.newGame(xcfg, E.mulberry32(1));
  assert.equal(c.mode, 'classic');
  assert.ok(c.players.every((p) => p.powers === undefined));
  const x = extreme();
  assert.equal(x.mode, 'extreme');
  assert.ok(x.players.every((p) => p.powers.length === 1 && E.POWER_KINDS.includes(p.powers[0])));
  assert.deepEqual(E.newGame(xcfg, E.mulberry32(1), { mode: 'bogus' }).mode, 'classic');
});

test('re-roll, set and bonus change the right things and use up the card', () => {
  const s = placing(extreme(), [2, 3, 4], ['reroll', 'set', 'bonus']);
  const r = E.usePower(s, 'reroll', { rolled: 1 }, () => 0.99);
  assert.deepEqual(r.rolled, [2, 6, 4]);
  assert.deepEqual(r.players[r.current].powers, ['set', 'bonus']);
  const t = E.usePower(r, 'set', { rolled: 0, face: 5 });
  assert.deepEqual(t.rolled, [5, 6, 4]);
  const u = E.usePower(t, 'bonus');
  assert.equal(u.bonus, E.BONUS_POINTS);
  assert.deepEqual(u.players[u.current].powers, []);
  assert.deepEqual(s.rolled, [2, 3, 4], 'the original state is untouched');
});

test('power cards are refused when they should be', () => {
  const s = placing(extreme(), [2, 3], ['reroll']);
  assert.throws(() => E.usePower(s, 'set', { rolled: 0, face: 2 }), /hold/);
  assert.throws(() => E.usePower(s, 'reroll', { rolled: 9 }), /die/);
  const start = structuredClone(s);
  start.phase = 'start';
  assert.throws(() => E.usePower(start, 'reroll', { rolled: 0 }), /Roll first/);
  assert.throws(() => E.usePower(E.newGame(xcfg, E.mulberry32(1)), 'reroll', {}), /Extreme/);
  const k = placing(extreme(), [2], ['knock']);
  assert.throws(() => E.usePower(k, 'knock', { card: 0, player: k.current }), /rival/);
  assert.throws(() => E.usePower(k, 'knock', { card: 0, player: (k.current + 1) % 3 }), /rival/, 'nothing to knock off');
});

test('knock off removes a rival die and skip makes the next player miss a turn', () => {
  const s = placing(extreme(), [2], ['knock', 'skip']);
  const rival = (s.current + 1) % 3;
  s.cards[0].placed[rival] = [s.cards[0].need[0]];
  const k = E.usePower(s, 'knock', { card: 0, player: rival });
  assert.equal(k.cards[0].placed[rival].length, 0);
  assert.equal(E.handSize(k, rival), E.DICE_PER_PLAYER);
  const sk = E.usePower(k, 'skip');
  assert.equal(sk.skipNext, true);
  assert.throws(() => E.usePower(placing(sk, [1], ['skip']), 'skip'), /Already/);
  const after = E.endTurn(sk, () => 0.9);
  assert.equal(after.current, (s.current + 2) % 3, 'the next player was skipped');
  assert.equal(after.skipNext, false);
  assert.deepEqual(after.events[0].type, 'skipped');
});

test('a bonus is added to the next claim and lost if unused', () => {
  const s = placing(extreme(), [], []);
  const card = s.cards[0];
  const me = s.current;
  card.placed[me] = card.need.slice(1);
  s.rolled = [card.need[0]];
  s.bonus = E.BONUS_POINTS;
  const claimed = E.place(s, 0, 0, () => 0.5);
  assert.equal(claimed.lastClaim.points, card.points + E.BONUS_POINTS);
  assert.equal(claimed.players[me].score, card.points + E.BONUS_POINTS);
  assert.equal(claimed.bonus, 0);
  const ended = E.endTurn(placing(extreme(), [1]));
  assert.equal(ended.bonus, 0);
  const lost = placing(extreme(), [1]);
  lost.bonus = 3;
  assert.equal(E.endTurn(lost).bonus, 0);
});

test('big claims and three-of-a-kind rolls earn power cards, up to the limit', () => {
  const s = placing(extreme(), [], []);
  const me = s.current;
  s.cards[0].points = 9;
  s.cards[0].placed[me] = s.cards[0].need.slice(1);
  s.rolled = [s.cards[0].need[0]];
  const won = E.place(s, 0, 0, () => 0.1);
  assert.equal(won.players[me].powers.length, 1);
  assert.equal(won.events[0].type, 'earned');
  const small = placing(extreme(), [], []);
  small.cards[0].points = 2;
  small.cards[0].need = [4];
  small.rolled = [4];
  assert.equal(E.place(small, 0, 0, () => 0.1).players[me].powers.length, 0);
  const lucky = E.roll({ ...extreme(), phase: 'start' }, () => 0.5); // every die shows the same number
  assert.equal(lucky.players[lucky.current].powers.length, 2);
  assert.equal(lucky.events[0].type, 'lucky');
  const full = extreme();
  full.players[full.current].powers = ['reroll', 'reroll', 'reroll'];
  assert.equal(E.roll(full, () => 0.5).players[full.current].powers.length, E.MAX_POWERS);
});

test('chaos: a new round can double points or send every die home', () => {
  const round = (r) => {
    let s = extreme();
    for (let i = 0; i < 3; i++) s = E.endTurn({ ...s, phase: 'placing', rolled: [] }, i === 2 ? () => r : () => 0.99);
    return s;
  };
  assert.equal(round(0.1).chaos.kind, 'double');
  assert.equal(round(0.99).chaos, null);
  let s = extreme();
  s.cards[0].placed[0] = [s.cards[0].need[0]];
  for (let i = 0; i < 3; i++) s = E.endTurn({ ...s, phase: 'placing', rolled: [] }, i === 2 ? () => 0.35 : () => 0.99);
  assert.ok(s.cards.every((c) => c.placed.every((p) => p.length === 0)), 'every die went home');
  const d = placing({ ...extreme(), chaos: { kind: 'double' } }, [], []);
  d.cards[0].placed[d.current] = d.cards[0].need.slice(1);
  d.rolled = [d.cards[0].need[0]];
  assert.equal(E.place(d, 0, 0, () => 0.9).lastClaim.points, d.cards[0].points * 2);
});

test('computer players play whole Extreme games, using power cards, without breaking the rules', () => {
  let powersPlayed = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const rng = E.mulberry32(seed);
    const n = 2 + (seed % 4);
    let s = E.newGame(Array.from({ length: n }, (_, i) => ({ name: `p${i}`, cpu: true, level: E.LEVEL_NAMES[(i + seed) % 3] })), rng, { mode: 'extreme' });
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 4000) {
      const a = aiNextAction(s, { level: s.players[s.current].level, rng });
      if (a.type === 'takeback') s = E.takeBack(s);
      else if (a.type === 'roll') s = E.roll(s, rng);
      else if (a.type === 'place') s = E.place(s, a.rolled, a.card, rng);
      else if (a.type === 'power') { s = E.usePower(s, a.kind, a, rng); powersPlayed++; } else s = E.endTurn(s, rng);
      for (let p = 0; p < n; p++) {
        assert.ok(E.handSize(s, p) >= 0 && E.handSize(s, p) <= E.DICE_PER_PLAYER);
        assert.ok(s.players[p].powers.length <= E.MAX_POWERS);
      }
    }
    assert.equal(s.phase, 'over', `game ${seed} finished`);
  }
  assert.ok(powersPlayed > 20, `the computer played ${powersPlayed} power cards`);
});

test('a skipped turn that carries play over a round boundary still starts the new round', () => {
  let s = extreme();
  s.current = 1;
  s.turn = 2; // the last turn of round 0 (3 players)
  s.skipNext = true;
  s.phase = 'placing';
  s.rolled = [];
  const next = E.endTurn(s, () => 0.1); // turn 3 is skipped, so play moves to turn 4
  assert.equal(next.turn, 4);
  assert.equal(next.chaos?.kind, 'double', 'the new round began');
});

test('the tutorial table teaches in order: 3, then the 5s, then the 2 and 6, and the 1 is left over', () => {
  let s = E.tutorialGame();
  assert.equal(s.cards.length, 3);
  s = E.roll(s, E.scriptedRng(E.TUTORIAL_ROLL));
  assert.deepEqual(s.rolled, E.TUTORIAL_ROLL);
  const only = (face) => s.cards.map((_, c) => c).filter((c) => E.canPlace(s, s.rolled.indexOf(face), c));
  assert.equal(only(3).length, 1);
  s = E.place(s, s.rolled.indexOf(3), only(3)[0]);
  assert.equal(s.players[0].score, 2);
  assert.equal(only(5).length, 1);
  s = E.place(s, s.rolled.indexOf(5), only(5)[0]);
  s = E.place(s, s.rolled.indexOf(5), only(5)[0]);
  assert.equal(s.players[0].score, 6);
  s = E.place(s, s.rolled.indexOf(2), only(2)[0]);
  s = E.place(s, s.rolled.indexOf(6), only(6)[0]);
  assert.equal(s.players[0].score, 9);
  assert.deepEqual(s.rolled, [1]);
  assert.equal(E.legalMoves(s).length, 0, 'nothing takes the leftover 1');
  assert.equal(s.cards.length, 3);
  assert.equal(E.endTurn(s).current, 1);
});

/* ---------- room settings ---------- */

test('a room can set the winning score and the dice each player owns; odd values fall back', () => {
  const g = E.newGame(cfg, E.mulberry32(1), { target: 20, dice: 8 });
  assert.equal(E.targetOf(g), 20);
  assert.equal(E.diceOf(g), 8);
  assert.equal(E.handSize(g, 0), 8);
  const d = E.newGame(cfg, E.mulberry32(1), { target: 13, dice: 99 });
  assert.equal(E.targetOf(d), E.TARGET_SCORE);
  assert.equal(E.diceOf(d), E.DICE_PER_PLAYER);
  assert.equal(E.targetOf({}), E.TARGET_SCORE, 'older saved games carry no settings');
  assert.equal(E.diceOf({}), E.DICE_PER_PLAYER);
});

test('with only four dice, no card in the deck needs more than four', () => {
  const g = E.newGame(cfg, E.mulberry32(5), { dice: 4 });
  assert.ok([...g.cards, ...g.deck].every((c) => c.need.length <= 4));
  assert.equal(g.cards.length + g.deck.length, 21);
  assert.equal(E.newGame(cfg, E.mulberry32(5), { dice: 5 }).deck.length + 3, 30);
});

test('the first player to reach the chosen score wins', () => {
  const s = placing(E.newGame(cfg, E.mulberry32(2), { target: 20 }), [], []);
  s.cards[0].points = 5;
  s.cards[0].need = [2];
  s.rolled = [2];
  s.players[s.current].score = 15;
  const won = E.place(s, 0, 0);
  assert.equal(won.phase, 'over');
  assert.equal(won.winner, s.current);
  const notYet = placing(E.newGame(cfg, E.mulberry32(2), { target: 40 }), [], []);
  notYet.cards[0].points = 5;
  notYet.cards[0].need = [2];
  notYet.rolled = [2];
  notYet.players[notYet.current].score = 15;
  assert.equal(E.place(notYet, 0, 0).phase, 'placing', 'a 40-point game carries on');
});

test('computer players finish games at every winning score and dice count, in both modes', () => {
  for (const target of E.SETTINGS.targets) {
    for (const dice of E.SETTINGS.dice) {
      for (const mode of E.MODES) {
        const rng = E.mulberry32(target * 31 + dice * 7 + (mode === 'extreme' ? 1 : 0));
        let s = E.newGame(Array.from({ length: 3 }, (_, i) => ({ name: `p${i}`, cpu: true, level: E.LEVEL_NAMES[i] })), rng, { mode, target, dice });
        let steps = 0;
        while (s.phase !== 'over' && steps++ < 3000) {
          const a = aiNextAction(s, { level: s.players[s.current].level, rng });
          if (a.type === 'takeback') s = E.takeBack(s);
          else if (a.type === 'roll') s = E.roll(s, rng);
          else if (a.type === 'place') s = E.place(s, a.rolled, a.card, rng);
          else if (a.type === 'power') s = E.usePower(s, a.kind, a, rng);
          else s = E.endTurn(s, rng);
          for (let p = 0; p < 3; p++) assert.ok(E.handSize(s, p) >= 0 && E.handSize(s, p) <= dice);
        }
        assert.equal(s.phase, 'over', `${mode} game to ${target} with ${dice} dice finished`);
      }
    }
  }
});

/* ---------- stats and unlockable looks ---------- */

import { afterGame, isUnlocked, newlyUnlocked, requirementText, UNLOCKS } from '../src/stats.js';

const fresh = { games: 0, wins: 0, claims: 0, streak: 0, bestStreak: 0, extremeWins: 0, online: 0, best: 0 };

test('the first look in each group is free; the rest need playing', () => {
  assert.ok(isUnlocked('table', 'felt', fresh));
  assert.ok(isUnlocked('back', 'blue', fresh));
  assert.ok(isUnlocked('dice', 'classic', fresh));
  assert.ok(!isUnlocked('table', 'midnight', fresh));
  assert.equal(requirementText('table', 'midnight'), 'Play 3 games');
  assert.equal(requirementText('back', 'night'), 'Win a Rollick Extreme game');
  assert.equal(requirementText('table', 'felt'), '');
});

test('finished games count, streaks reset on a loss, and looks unlock at their threshold', () => {
  let s = afterGame(fresh, { won: true, claims: 4, score: 41, mode: 'classic', online: false });
  assert.deepEqual([s.games, s.wins, s.streak, s.claims, s.best], [1, 1, 1, 4, 41]);
  s = afterGame(s, { won: true, claims: 3, score: 40, mode: 'extreme', online: true });
  assert.deepEqual([s.wins, s.streak, s.bestStreak, s.extremeWins, s.online], [2, 2, 2, 1, 1]);
  s = afterGame(s, { won: false, claims: 1, score: 12, mode: 'classic', online: false });
  assert.deepEqual([s.streak, s.bestStreak, s.games], [0, 2, 3]);
  const opened = newlyUnlocked(fresh, s).map((u) => `${u.part}:${u.id}`).sort();
  assert.deepEqual(opened, ['back:mint', 'back:night', 'dice:bubble', 'table:midnight', 'table:wine']);
  assert.equal(newlyUnlocked(s, s).length, 0, 'nothing new the second time');
});

test('every look that can be locked has a requirement the stats can meet', () => {
  const rich = { games: 99, wins: 99, claims: 99, streak: 0, bestStreak: 0, extremeWins: 9, online: 9, best: 99 };
  for (const part of Object.keys(UNLOCKS)) for (const id of Object.keys(UNLOCKS[part])) assert.ok(isUnlocked(part, id, rich) && requirementText(part, id));
});

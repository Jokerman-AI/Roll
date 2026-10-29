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

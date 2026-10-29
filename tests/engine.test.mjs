import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { aiNextAction } from '../src/ai.js';

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
  for (let seed = 1; seed <= 200; seed++) {
    const rng = E.mulberry32(seed);
    let s = E.newGame(Array.from({ length: 1 + (seed % 7) + 1 }, (_, i) => ({ name: `p${i}` })), rng);
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 20000) {
      const a = aiNextAction(s, rng);
      if (a.type === 'takeback') s = E.takeBack(s);
      else if (a.type === 'roll') s = E.roll(s, rng);
      else if (a.type === 'place') s = E.place(s, a.rolled, a.card);
      else s = E.endTurn(s);
    }
    assert.equal(s.phase, 'over', `seed ${seed} did not finish`);
    assert.ok(s.players[s.winner].score >= 40 || s.cards.length === 0);
  }
});

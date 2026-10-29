import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { aiNextAction } from '../src/ai.js';

const cfg = [{ name: 'A' }, { name: 'B', cpu: true }];

test('deck has 30 unique-sized cards and 3 are dealt', () => {
  const s = E.newGame(cfg, E.mulberry32(1));
  assert.equal(s.cards.length, 3);
  assert.equal(s.cards.length + s.deck.length, 30);
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
  assert.equal(s.players[0].score, card.points);
  assert.equal(s.cards.length, 3);
  assert.notEqual(s.cards[2].id, id);
  assert.equal(E.handSize(s, 0), 6);
  assert.throws(() => E.place(s, 0, 0)); // 6 may not be needed (or card changed)
});

test('claiming returns opponents dice too', () => {
  let s = E.newGame(cfg, E.mulberry32(5));
  const card = s.cards[0];
  card.placed[1].push(card.need[0]);
  s.phase = 'placing';
  s.rolled = [...card.need];
  for (let i = 0; i < card.need.length; i++) s = E.place(s, 0, 0);
  assert.equal(E.handSize(s, 1), 6);
});

test('pickUp returns a die to hand', () => {
  let s = E.newGame(cfg, E.mulberry32(6));
  s.cards[1].placed[0].push(s.cards[1].need[0]);
  assert.equal(E.handSize(s, 0), 5);
  s = E.pickUp(s, 1, s.cards[1].need[0]);
  assert.equal(E.handSize(s, 0), 6);
});

test('CPU vs CPU games always finish', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = E.mulberry32(seed);
    let s = E.newGame([{ name: 'a' }, { name: 'b' }, { name: 'c' }], rng);
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 20000) {
      const a = aiNextAction(s, rng);
      if (a.type === 'pickup') s = E.pickUp(s, a.card, a.face);
      else if (a.type === 'roll') s = E.roll(s, rng);
      else if (a.type === 'place') s = E.place(s, a.rolled, a.card);
      else s = E.endTurn(s);
    }
    assert.equal(s.phase, 'over', `seed ${seed} did not finish`);
    assert.ok(s.players[s.winner].score >= 40 || s.cards.length === 0);
  }
});

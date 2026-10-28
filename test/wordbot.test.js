import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDictionary, dealLetters, WORD_TURNS } from '../js/words.js';
import { botPlay, botPlaySeed, goalFor, goalPercent } from '../js/wordbot.js';

const dict = parseDictionary(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));

test('goal schedule: 35% at level 1, +5 per level, capped at 100%', () => {
  assert.equal(goalPercent(1), 35);
  assert.equal(goalPercent(2), 40);
  assert.equal(goalPercent(14), 100);
  assert.equal(goalPercent(30), 100);
  assert.equal(goalFor(1, 150), 52);
  assert.equal(goalFor(14, 150), 150);
  assert.equal(goalFor(1, 0), 10, 'floor of 10');
});

test('bot plays a legal game within 20 turns, deterministically, and scores', () => {
  const a = botPlaySeed(7, dict);
  const b = botPlaySeed(7, dict);
  assert.deepEqual(a, b);
  assert.ok(a.turnsUsed <= WORD_TURNS);
  assert.ok(a.score > 0);
  assert.ok(a.words.length >= 1);
  for (const w of a.words) assert.ok(dict.has(w.word));
  const { board, bag } = dealLetters(7);
  assert.deepEqual(botPlay(board, bag, dict), a);
});

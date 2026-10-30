import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDictionary, dealLetters, WORD_TURNS } from '../js/words.js';
import { botPlay, botPlaySeed, goalFor, goalPercent } from '../js/wordbot.js';

const dict = parseDictionary(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));

test('goal schedule: 50% at level 1, +4 per level, capped at 100% from level 14', () => {
  assert.equal(goalPercent(1), 50);
  assert.equal(goalPercent(2), 54);
  assert.equal(goalPercent(13), 98);
  assert.equal(goalPercent(14), 100);
  assert.equal(goalPercent(30), 100);
  assert.equal(goalFor(1, 150), 80, '75 rounds up to 80');
  assert.equal(goalFor(14, 150), 150);
  assert.equal(goalFor(1, 200), 100, 'exact multiples stay');
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

test('bot plays a 6x6 board within 25 turns and its moves cover the whole 156-move list', () => {
  const r = botPlaySeed(3, dict, {}, 6);
  assert.ok(r.turnsUsed <= 25);
  assert.ok(r.score > 0 && r.banked > 0 && r.words.length >= 1);
  assert.ok(r.locked <= 36);
  for (const w of r.words) assert.ok(dict.has(w.word) && w.word.length <= 6);
});

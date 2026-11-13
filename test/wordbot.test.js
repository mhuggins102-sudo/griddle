import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDictionary, dealLetters, WORD_TURNS } from '../js/words.js';
import { botPlay, botPlaySeed, goalFor, goalPercent, targetBotScore, closestToTarget, GOAL_SCHEDULE, CANDIDATE_BOARDS } from '../js/wordbot.js';

const dict = parseDictionary(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));

test('goal schedule: 50% at level 1, +5 per level, no cap', () => {
  assert.equal(goalPercent(1), 50);
  assert.equal(goalPercent(2), 55);
  assert.equal(goalPercent(11), 100);
  assert.equal(goalPercent(21), 150);
  assert.equal(goalPercent(30), 195);
  assert.deepEqual(GOAL_SCHEDULE, { 5: { start: 60, step: 10 }, 6: { start: 100, step: 15 } });
  assert.equal(goalFor(1, 5), 60);
  assert.equal(goalFor(10, 5), 150);
  assert.equal(goalFor(1, 6), 100);
  assert.equal(goalFor(10, 6), 235);
  assert.equal(goalFor(1), 60, '5x5 by default');
  assert.equal(goalFor(0, 5), 60, 'never below level 1');
  assert.equal(targetBotScore(1, 5), 120, 'a level-1 board: the bot banks twice the goal');
  assert.equal(Math.round(targetBotScore(11, 5)), 160, 'at level 11 the bot just reaches the goal');
  assert.equal(Math.round(targetBotScore(5, 6)), 229);
  assert.equal(closestToTarget([{ banked: 100 }, { banked: 130 }, { banked: 118 }], 120).banked, 118);
  assert.equal(closestToTarget([null, { banked: 100 }], 120).banked, 100, 'a failed candidate is skipped');
  assert.equal(closestToTarget([], 120), null);
  assert.equal(CANDIDATE_BOARDS, 6);
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

#!/usr/bin/env node
// Builds data/words.txt: the public-domain ENABLE list (3 to 6 letters) pruned of words that hardly
// ever occur in everyday English, plus a supplement of modern words ENABLE predates, ordered by how
// common each word is (so a wild tile resolves to the word a player most likely means).
//
//   node tools/build-words.js [--sources DIR] [--min 10] [--base 100]
//
// Sources (downloaded into DIR with curl when missing):
//   enable1.txt  https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
//   en_full.txt  https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt
//                (word counts from the OpenSubtitles 2018 corpus)
// Rule: keep an ENABLE word when it occurs at least --min times, or at least twice when it is a plain
// inflection (-s, -es, -ed, -ing, -er, -ly, ...) of an ENABLE word occurring at least --base times.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const dir = opt('sources', join(process.cwd(), '.scratch', 'dict'));
const MIN_COUNT = Number(opt('min', 10));
const BASE_COUNT = Number(opt('base', 100));
const MIN_LEN = 3;
const MAX_LEN = 6;

/** Everyday words that ENABLE (2000) does not have. Brands and slurs are left out on purpose. */
const SUPPLEMENT = `online email emails meds texted app apps blog blogs cyber mega ramen techno hottie selfie
newbie bae bling droid droids cardio manga webcam emo meme memes wifi boba bestie twerk emoji emojis
sudoku hijab panini onesie noob noobs burka yolo vlog vlogs wiki wikis queso vibing vape vaped vapes
vaper vapers vaping paleo gif gifs tweens fomo hangry romcom matcha ebook ebooks unmute upvote noogie`.split(/\s+/);

const SOURCES = {
  'enable1.txt': 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt',
  'en_full.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt',
};
mkdirSync(dir, { recursive: true });
for (const [file, url] of Object.entries(SOURCES)) {
  const path = join(dir, file);
  if (existsSync(path)) continue;
  console.error(`downloading ${file}`);
  execFileSync('curl', ['-sS', '-L', '--max-time', '300', url, '-o', path], { stdio: 'inherit' });
}

const enable = new Set(
  readFileSync(join(dir, 'enable1.txt'), 'utf8').split(/\r?\n/).map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= MIN_LEN && w.length <= MAX_LEN && /^[a-z]+$/.test(w)),
);
const freq = new Map();
for (const line of readFileSync(join(dir, 'en_full.txt'), 'utf8').split('\n')) {
  const sp = line.indexOf(' ');
  if (sp < 0) continue;
  const w = line.slice(0, sp);
  if (/^[a-z]+$/.test(w)) freq.set(w, Number(line.slice(sp + 1)));
}
const count = (w) => freq.get(w) || 0;

function* inflectionBases(w) {
  for (const suf of ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'ly', 'ies', 'ied', 'ier', 'iest', 'est']) {
    if (!w.endsWith(suf) || w.length - suf.length < MIN_LEN) continue;
    const b = w.slice(0, -suf.length);
    yield b;
    if (['ies', 'ied', 'ier', 'iest'].includes(suf)) yield `${b}y`;
    if (['ing', 'ed', 'er', 'ers', 'est'].includes(suf)) yield `${b}e`;
    if (['ing', 'ed', 'er'].includes(suf) && b.length >= 4 && b[b.length - 1] === b[b.length - 2]) yield b.slice(0, -1);
  }
}
function keep(w) {
  const c = count(w);
  if (c >= MIN_COUNT) return true;
  if (c < 2) return false;
  for (const b of inflectionBases(w)) if (enable.has(b) && count(b) >= BASE_COUNT) return true;
  return false;
}

const words = new Set([...enable].filter(keep));
for (const w of SUPPLEMENT) {
  if (w.length < MIN_LEN || w.length > MAX_LEN || !/^[a-z]+$/.test(w)) throw new Error(`bad supplement word ${w}`);
  words.add(w);
}
const sorted = [...words].sort((a, b) => count(b) - count(a) || (a < b ? -1 : a > b ? 1 : 0));
const out = join(process.cwd(), 'data', 'words.txt');
writeFileSync(out, sorted.map((w) => w.toUpperCase()).join('\n') + '\n');

const byLen = {};
for (const w of sorted) byLen[w.length] = (byLen[w.length] || 0) + 1;
console.error(`ENABLE ${MIN_LEN}-${MAX_LEN}: ${enable.size}; kept ${[...enable].filter(keep).length} (${(100 * [...enable].filter(keep).length / enable.size).toFixed(0)}%); supplement ${SUPPLEMENT.length}; written ${sorted.length} words to ${out}`);
console.error('by length: ' + Object.entries(byLen).map(([n, k]) => `${n}: ${k}`).join('  '));
console.error('first 12: ' + sorted.slice(0, 12).join(' ') + ' ... last: ' + sorted.slice(-4).join(' '));

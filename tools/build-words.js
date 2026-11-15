#!/usr/bin/env node
// Builds data/words.txt: the whole public-domain ENABLE list (3 to 6 letters; the open stand-in for the
// Scrabble dictionary) plus a supplement of modern words ENABLE predates, in two tiers. The common tier
// comes first, ordered by how often each word occurs in everyday English (so a wild tile resolves to the
// word a player most likely means); a "#rare" line follows, then every other ENABLE word, rarest last.
// Every word in the file is accepted when a player locks it; the bot (which sets the level goals) and
// anything that should prefer everyday words only use the common tier (dict.common in js/words.js).
//
//   node tools/build-words.js [--sources DIR] [--min 10] [--base 100]
//
// Sources (downloaded into DIR with curl when missing):
//   enable1.txt  https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
//   en_full.txt  https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt
//                (word counts from the OpenSubtitles 2018 corpus)
//   lemmatization-en.txt  https://raw.githubusercontent.com/michmech/lemmatization-lists/master/lemmatization-en.txt
//                (inflected form -> lemma; a word that is an inflection of another listed word is written as
//                WORD>LEMMA so that locking DOOR then DOORS on the same tiles can be refused)
// Common tier: an ENABLE word that occurs at least --min times, or at least twice when it is a plain
// inflection (-s, -es, -ed, -ing, -er, -ly, ...) of an ENABLE word occurring at least --base times; the
// supplement is common too. Everything else in ENABLE is the rare tier.
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

/**
 * Everyday words that ENABLE (2000) does not have. Brands and slurs are left out on purpose. An inflected
 * form names its lemma after ">" (the lemmatization table predates these words too), so that the same
 * one-form-per-tiles rule applies to them.
 */
const SUPPLEMENT = `online email emails>email meds texted>text app apps>app blog blogs>blog cyber mega ramen techno
hottie selfie newbie bae bling droid droids>droid cardio manga webcam emo meme memes>meme wifi boba bestie
twerk emoji emojis>emoji sudoku hijab panini onesie noob noobs>noob burka yolo vlog vlogs>vlog wiki wikis>wiki
queso vibing>vibe vape vaped>vape vapes>vape vaper vapers>vaper vaping>vape paleo gif gifs>gif tweens>tween
fomo hangry romcom matcha ebook ebooks>ebook unmute upvote noogie`.split(/\s+/);

const SOURCES = {
  'enable1.txt': 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt',
  'en_full.txt': 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt',
  'lemmatization-en.txt': 'https://raw.githubusercontent.com/michmech/lemmatization-lists/master/lemmatization-en.txt',
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

const common = new Set([...enable].filter(keep));
const supplementLemmas = new Map();
for (const entry of SUPPLEMENT) {
  const [w, lemma] = entry.split('>');
  if (w.length < MIN_LEN || w.length > MAX_LEN || !/^[a-z]+$/.test(w)) throw new Error(`bad supplement word ${w}`);
  common.add(w);
  if (lemma) supplementLemmas.set(w, lemma);
}
const byCount = (a, b) => count(b) - count(a) || (a < b ? -1 : a > b ? 1 : 0);
const commonSorted = [...common].sort(byCount);
const rareSorted = [...enable].filter((w) => !common.has(w)).sort(byCount);
const sorted = commonSorted.concat(rareSorted);
const words = new Set(sorted);
const lemmas = new Map();
for (const [w, lemma] of supplementLemmas) {
  if (!words.has(lemma)) throw new Error(`supplement lemma ${lemma} of ${w} is not a listed word`);
  lemmas.set(w, [lemma]);
}
// A word the grammar table treats as a headword (some other form, of any length, points to it: LIVERS to
// LIVER, MATTERED to MATTER) is a word in its own right even when the table also lists it as a form of a
// shorter word (LIVER as the comparative of LIVE); such a word carries no ending link, so LIVE then LIVER
// is allowed while PLAY then PLAYS (nothing points to PLAYS) is refused.
const headwords = new Set(supplementLemmas.values());
const table = [];
for (const line of readFileSync(join(dir, 'lemmatization-en.txt'), 'utf8').split(/\r?\n/)) {
  const [lemma, form] = line.replace(/^\ufeff/, '').split('\t').map((x) => (x || '').trim().toLowerCase());
  if (!form || !lemma || form === lemma) continue;
  headwords.add(lemma);
  table.push([form, lemma]);
}
let dropped = 0;
for (const [form, lemma] of table) {
  if (!words.has(form) || !words.has(lemma)) continue;
  if (headwords.has(form)) {
    dropped++;
    continue;
  }
  if (!lemmas.has(form)) lemmas.set(form, []);
  lemmas.get(form).push(lemma);
}
const out = join(process.cwd(), 'data', 'words.txt');
const line = (w) => (lemmas.has(w) ? `${w}>${lemmas.get(w).join('/')}` : w).toUpperCase();
writeFileSync(out, commonSorted.map(line).concat(['#rare'], rareSorted.map(line)).join('\n') + '\n');

const byLen = {};
for (const w of sorted) byLen[w.length] = (byLen[w.length] || 0) + 1;
console.error(`ENABLE ${MIN_LEN}-${MAX_LEN}: ${enable.size}; common tier ${commonSorted.length} (${(100 * [...enable].filter(keep).length / enable.size).toFixed(0)}% of ENABLE, plus the supplement of ${SUPPLEMENT.length}); rare tier ${rareSorted.length}; written ${sorted.length} words to ${out}`);
console.error('by length: ' + Object.entries(byLen).map(([n, k]) => `${n}: ${k}`).join('  ') + `; ${lemmas.size} words carry a lemma; ${dropped} links dropped from headwords`);
console.error('first 12: ' + sorted.slice(0, 12).join(' ') + ' ... last: ' + sorted.slice(-4).join(' '));

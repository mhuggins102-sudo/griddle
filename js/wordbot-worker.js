// Web Worker: plays a board with the word bot off the main thread and posts the result.
import { parseDictionary } from './words.js';
import { botPlay } from './wordbot.js';

let dictPromise = null;
function dict() {
  if (!dictPromise) {
    dictPromise = fetch(new URL('../data/words.txt', import.meta.url), { cache: 'force-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(parseDictionary);
    dictPromise.catch(() => {
      dictPromise = null; // try again on the next job instead of failing forever
    });
  }
  return dictPromise;
}

self.onmessage = async (e) => {
  const { id, board, bag } = e.data;
  try {
    const result = botPlay(board, bag, await dict());
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};

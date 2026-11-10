// GridLock leaderboard: four boards (5x5 and 6x6, best single-board score and highest level reached), each a
// top 10 kept in Supabase and read and written with plain fetch through the functions in
// supabase/schema.sql. The player is a random id made on the device plus a chosen name; results wait in
// an outbox until the player has a name and the network is there. A player who stays anonymous sends
// nothing. Replays never count.

import { SUPABASE_URL, SUPABASE_KEY } from './leaderboard-config.js';
import { openSheet, closeSheet } from './sheet.js';

export const NAME_MAX = 16;
export const TOP_N = 10;
const PROMPT_DELAY_MS = 700; // the result shows first, then the question
const RPC_TIMEOUT_MS = 10000; // a stalled request is given up, and tried again later

/**
 * A name as the server keeps it: control and invisible characters (zero-width spaces, joiners, direction
 * marks, soft hyphens, the byte-order mark) dropped, every kind of whitespace collapsed to one space,
 * trimmed, at most NAME_MAX characters; null if nothing is left. clean_name in supabase/schema.sql does the same.
 */
export function cleanName(raw) {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g, '')
    .replace(/[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g, ' ')
    .trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim() || null; // counted in characters, as the server does
}

/**
 * The identity and outbox as stored under store.leaderboard. status: 'unasked' | 'named' | 'anonymous';
 * pending holds results waiting to go out; removals holds player ids whose rows still have to come down
 * (a player who went anonymous or was forgotten while the network was away); rename is a new name not yet
 * on every row.
 */
export function defaultIdentity() {
  return { playerId: null, name: null, status: 'unasked', pending: [], removals: [], rename: null };
}

/** Put a result in the outbox, in place: one entry per board, the highest value wins. Returns true if anything changed. */
export function queueResult(pending, entry) {
  if (!entry || !(entry.value >= 0)) return false;
  const i = pending.findIndex((e) => e.size === entry.size && e.kind === entry.kind);
  if (i < 0) {
    pending.push({ size: entry.size, kind: entry.kind, value: entry.value });
    return true;
  }
  if (entry.value <= pending[i].value) return false;
  pending[i] = { size: entry.size, kind: entry.kind, value: entry.value };
  return true;
}

/**
 * Bring the per-size counters up to what the recent history proves. Stores from before the counters only
 * had a global top level across both sizes (bestReached, bestLevel); that figure cannot be told apart by
 * size, so it is neither shown per size nor posted to a board. Returns true if a counter moved.
 */
export function seedReached(word) {
  if (!word) return false;
  const proven = bestReachedBySize(word);
  let moved = false;
  for (const size of [5, 6]) {
    const key = `bestReached${size}`;
    if ((word[key] || 0) < proven[size]) {
      word[key] = proven[size];
      moved = true;
    }
  }
  return moved;
}

/** The highest level reached per board size, from the per-size counters and the recent history. */
export function bestReachedBySize(word) {
  const out = { 5: word?.bestReached5 || 0, 6: word?.bestReached6 || 0 };
  for (const g of word?.history || []) {
    if (g.mode !== 'levels' || g.perks) continue; // a perk run keeps its own ladder
    const size = g.size === 6 ? 6 : 5;
    out[size] = Math.max(out[size], g.passed ? g.level + 1 : g.level);
  }
  return out;
}

/** Everything the local stats know that belongs on a board: the best score and highest level per size. */
export function localBests(word) {
  const out = [];
  if (word?.best != null) out.push({ size: 5, kind: 'score', value: word.best });
  if (word?.best6 != null) out.push({ size: 6, kind: 'score', value: word.best6 });
  const reached = bestReachedBySize(word);
  for (const size of [5, 6]) if (reached[size] > 0) out.push({ size, kind: 'level', value: reached[size] });
  return out;
}

/** The rows of one board as the sheet lists them: the top 10, then a gap marker and the player's own row if it sits further down. */
export function listRows(rows) {
  const out = [];
  let last = 0;
  for (const r of rows || []) {
    if (r.rank > TOP_N && r.rank > last + 1) out.push({ gap: true });
    out.push(r);
    last = r.rank;
  }
  return out;
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The leaderboard sheet, the name sheet and the outbox. ctx: { store, saveStore, showToast, boardSize }. */
export function initLeaderboard(ctx) {
  const $ = (sel) => document.querySelector(sel);
  const sheet = $('#leaderboard');
  const nameSheet = $('#lb-name');
  const configured = !!(SUPABASE_URL && SUPABASE_KEY);
  const base = String(SUPABASE_URL).replace(/\/+$/, '');
  const view = { size: 5, kind: 'score', loadToken: 0 };
  let flushing = null;
  let promptTimer = null;

  function identity() {
    const s = ctx.store;
    if (!s.leaderboard || typeof s.leaderboard !== 'object') s.leaderboard = defaultIdentity();
    const id = s.leaderboard;
    if (!Array.isArray(id.pending)) id.pending = [];
    if (!Array.isArray(id.removals)) id.removals = [];
    if (typeof id.rename !== 'string') id.rename = null;
    if (!['unasked', 'named', 'anonymous'].includes(id.status)) id.status = 'unasked';
    if (id.status === 'named' && !id.playerId) id.playerId = randomId();
    return id;
  }

  async function rpc(name, args) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), RPC_TIMEOUT_MS) : null;
    try {
      const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, // the public key travels in apikey only
        body: JSON.stringify(args),
        signal: ac ? ac.signal : undefined,
      });
      if (!res.ok) {
        const err = new Error(`${name}: HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Only a request the server examined and refused is final; a missing key, a missing grant, a stale schema cache or a rate limit is tried again. */
  function rejected(err) {
    return err.status === 400 || err.status === 422;
  }

  /**
   * Send what is waiting: removals first, then a pending rename, then results oldest first. An entry the
   * server refused (HTTP 400) is dropped; anything else (no network, a server error, a missing key or grant,
   * a rate limit) keeps it for next time. The identity is read afresh at every step, so a reset or a change
   * of mind while a request is in flight is honoured. Resolves to the number of requests that went through.
   */
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      if (!configured) return sent;
      for (;;) {
        const id = identity();
        if (id.removals.length) {
          const gone = id.removals[0];
          try {
            await rpc('remove_player', { p_player: gone });
            sent++;
          } catch (err) {
            if (!rejected(err)) break;
          }
          const now = identity();
          const i = now.removals.indexOf(gone);
          if (i >= 0) now.removals.splice(i, 1);
          ctx.saveStore(ctx.store);
          continue;
        }
        if (id.status !== 'named') break;
        if (id.rename) {
          try {
            await rpc('rename_player', { p_player: id.playerId, p_name: id.rename });
            sent++;
          } catch (err) {
            if (!rejected(err)) break;
          }
          const now = identity();
          if (now === id && now.rename === id.rename) now.rename = null;
          ctx.saveStore(ctx.store);
          continue;
        }
        if (!id.pending.length) break;
        const e = id.pending[0];
        try {
          await rpc('submit_score', { p_player: id.playerId, p_name: id.name, p_size: e.size, p_kind: e.kind, p_value: e.value });
          sent++;
        } catch (err) {
          if (!rejected(err)) break;
        }
        const now = identity();
        if (now !== id) continue; // the identity changed under the request: start over with the new one
        const i = now.pending.indexOf(e);
        if (i >= 0) now.pending.splice(i, 1);
        ctx.saveStore(ctx.store);
      }
      return sent;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  /**
   * A board just finished. score is its final score; levelReached is the level the run stands at after this
   * board (the next level if it was passed, this one if not), or 0 outside a run; replay marks a replay or
   * retry, which never counts. The first time, the player is asked for a name (prompt false defers that
   * question, for a board scored while leaving the screen); after that results go out.
   */
  function afterBoard({ size, score, levelReached = 0, replay = false, prompt = true }) {
    if (replay || !configured) return; // replays never count; without a project there is nothing to post to
    const id = identity();
    if (id.status === 'anonymous') return;
    let changed = queueResult(id.pending, { size, kind: 'score', value: score });
    if (levelReached > 0) changed = queueResult(id.pending, { size, kind: 'level', value: levelReached }) || changed;
    if (changed) ctx.saveStore(ctx.store);
    if (id.status === 'unasked') {
      if (!prompt) return; // a board scored on the way out: the question waits for one whose result is on screen
      clearTimeout(promptTimer);
      promptTimer = setTimeout(() => {
        // the player may have moved on already (new board, home, the tutorial): then the next result asks
        const result = $('#w-result');
        const screen = $('#screen-word');
        if (!result || result.hidden || !screen || screen.hidden || document.querySelector('.sheet:not([hidden]):not(#w-result)')) return;
        openNameSheet();
      }, PROMPT_DELAY_MS);
    } else {
      flush();
    }
  }

  // ---- the name sheet -------------------------------------------------------------------------------

  function openNameSheet() {
    const id = identity();
    const named = id.status === 'named';
    $('#lb-name-title').textContent = named ? 'Your leaderboard name' : id.status === 'anonymous' ? 'Join the leaderboard' : 'Join the leaderboard?';
    $('#lb-name-input').value = named ? id.name : '';
    $('#lb-name-error').hidden = true;
    $('#btn-lb-anon').textContent = named ? 'Remove my name' : id.status === 'anonymous' ? 'Cancel' : 'Stay anonymous';
    $('#btn-lb-save').textContent = named ? 'Save' : 'Post my scores';
    openSheet(nameSheet);
    $('#lb-name-input').focus({ preventScroll: true }); // within the tap, so phones bring the keyboard up
  }

  function closeNameSheet() {
    closeSheet(nameSheet);
  }

  /** The player chose a name: new player or rename. Local bests go out so the boards show them straight away. */
  function saveName() {
    const name = cleanName($('#lb-name-input').value);
    if (!name) {
      const err = $('#lb-name-error');
      err.textContent = `Enter a name of up to ${NAME_MAX} characters`;
      err.hidden = false;
      return;
    }
    const id = identity();
    if (id.status === 'named' && id.name !== name) id.rename = name; // every row takes the new name, retried until it does
    if (!id.playerId) id.playerId = randomId();
    id.name = name;
    id.status = 'named';
    for (const b of localBests(ctx.store.word)) queueResult(id.pending, b);
    ctx.saveStore(ctx.store);
    closeNameSheet();
    flush().then(() => {
      if (sheet && !sheet.hidden) load();
    });
    renderFoot();
  }

  /** Stay (or go back to being) anonymous: nothing is sent, and a named player's rows are taken down. */
  function goAnonymous() {
    const id = identity();
    if (id.status === 'anonymous') {
      closeNameSheet();
      return;
    }
    if (id.status === 'named' && id.playerId) id.removals.push(id.playerId);
    id.status = 'anonymous';
    id.name = null;
    id.playerId = null; // a later join is a fresh player
    id.pending = [];
    ctx.saveStore(ctx.store);
    closeNameSheet();
    renderFoot();
    flush().then(() => {
      if (sheet && !sheet.hidden) load();
    });
  }

  // ---- the leaderboard sheet ------------------------------------------------------------------------

  function renderFoot() {
    const id = identity();
    const b = $('#btn-lb-name');
    b.hidden = !configured;
    if (id.status === 'named') {
      b.textContent = `✎ ${id.name}`;
      b.setAttribute('aria-label', `Playing as ${id.name}. Change your name`);
    } else {
      b.textContent = 'Join';
      b.setAttribute('aria-label', 'Join the leaderboard');
    }
  }

  function describe() {
    return `${view.size}×${view.size} · ${view.kind === 'score' ? 'high scores' : 'top level'}`;
  }

  async function load() {
    const list = $('#lb-list');
    const status = $('#lb-status');
    list.innerHTML = '';
    if (!configured) {
      status.textContent = 'The leaderboard is not set up yet';
      return;
    }
    status.textContent = 'Loading…';
    const token = ++view.loadToken;
    const id = identity();
    flush().then((sent) => {
      if (sent && token === view.loadToken && !sheet.hidden) load(); // the boards just changed: show it
    });
    let rows;
    try {
      rows = await rpc('get_leaderboard', { p_size: view.size, p_kind: view.kind, p_player: id.status === 'named' ? id.playerId : null });
    } catch {
      if (token !== view.loadToken) return;
      status.textContent = 'Couldn’t reach the leaderboard. Check your connection and try again';
      return;
    }
    if (token !== view.loadToken) return;
    for (const r of listRows(rows)) {
      const li = document.createElement('li');
      if (r.gap) {
        li.className = 'lb-gap';
        li.textContent = '…';
      } else {
        li.className = r.me ? 'me' : '';
        li.innerHTML = `<span class="lb-rank">${Number(r.rank)}</span><span class="lb-name"></span><span class="lb-value">${Number(r.value)}</span>`;
        li.querySelector('.lb-name').textContent = r.name;
      }
      list.appendChild(li);
    }
    if (!rows || !rows.length) status.textContent = `No ${view.kind === 'score' ? 'scores' : 'levels'} on the ${view.size}×${view.size} board yet`;
    else if (id.status !== 'named') status.textContent = 'Join to post your own results';
    else status.textContent = '';
    list.setAttribute('aria-label', `Top ${TOP_N}, ${describe()}`);
  }

  function open() {
    if (ctx.boardSize) view.size = ctx.boardSize() === 6 ? 6 : 5; // the board chosen on the home screen
    $(`#lb-size-${view.size}`).checked = true;
    $(`#lb-kind-${view.kind}`).checked = true;
    renderFoot();
    openSheet(sheet);
    load();
  }

  function close() {
    closeSheet(sheet);
  }

  // ---- wiring ----------------------------------------------------------------------------------------

  $('#btn-leaderboard').addEventListener('click', open);
  $('#btn-lb-close').addEventListener('click', close);
  $('#btn-lb-done').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  $('#btn-lb-name').addEventListener('click', openNameSheet);
  for (const r of document.querySelectorAll('input[name="lb-size"]')) {
    r.addEventListener('change', () => {
      view.size = Number(document.querySelector('input[name="lb-size"]:checked').value);
      load();
    });
  }
  for (const r of document.querySelectorAll('input[name="lb-kind"]')) {
    r.addEventListener('change', () => {
      view.kind = document.querySelector('input[name="lb-kind"]:checked').value;
      load();
    });
  }
  $('#btn-lb-name-close').addEventListener('click', closeNameSheet);
  nameSheet.addEventListener('click', (e) => {
    if (e.target === nameSheet) closeNameSheet();
  });
  $('#btn-lb-save').addEventListener('click', saveName);
  $('#btn-lb-anon').addEventListener('click', goAnonymous);
  $('#lb-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      saveName();
    }
  });
  window.addEventListener('online', () => flush());
  flush();

  return {
    open,
    close,
    afterBoard,
    flush,
    identity,
    promptName: openNameSheet,
    configured,
    /** Forget who this device is on the leaderboard; a named player's rows come down (retried until they do). */
    forgetIdentity() {
      const id = identity();
      const fresh = defaultIdentity();
      fresh.removals = id.removals.slice();
      if (id.status === 'named' && id.playerId) fresh.removals.push(id.playerId);
      ctx.store.leaderboard = fresh;
      return fresh;
    },
  };
}

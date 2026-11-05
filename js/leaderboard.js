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

/** A name as the server keeps it: no control characters, single spaces, trimmed, at most NAME_MAX; null if nothing is left. */
export function cleanName(raw) {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return s || null;
}

/** The identity and outbox as stored under store.leaderboard. status: 'unasked' | 'named' | 'anonymous'. */
export function defaultIdentity() {
  return { playerId: null, name: null, status: 'unasked', pending: [] };
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

/** The highest level reached per board size, from the per-size counters and the recent history (older stores only had a global one). */
export function bestReachedBySize(word) {
  const out = { 5: word?.bestReached5 || 0, 6: word?.bestReached6 || 0 };
  for (const g of word?.history || []) {
    if (g.mode !== 'levels') continue;
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
    if (!['unasked', 'named', 'anonymous'].includes(id.status)) id.status = 'unasked';
    if (id.status === 'named' && !id.playerId) id.playerId = randomId();
    return id;
  }

  async function rpc(name, args) {
    const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, // the public key travels in apikey only
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const err = new Error(`${name}: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /** Send what is waiting, oldest first. A rejected entry is dropped; a network or server failure keeps the rest for next time. */
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const id = identity();
      while (configured && id.status === 'named' && id.pending.length) {
        const e = id.pending[0];
        try {
          await rpc('submit_score', { p_player: id.playerId, p_name: id.name, p_size: e.size, p_kind: e.kind, p_value: e.value });
        } catch (err) {
          if (!(err.status >= 400 && err.status < 500)) break;
        }
        const i = id.pending.indexOf(e);
        if (i >= 0) id.pending.splice(i, 1);
        ctx.saveStore(ctx.store);
      }
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
    if (replay) return;
    const id = identity();
    if (id.status === 'anonymous') return;
    let changed = queueResult(id.pending, { size, kind: 'score', value: score });
    if (levelReached > 0) changed = queueResult(id.pending, { size, kind: 'level', value: levelReached }) || changed;
    if (changed) ctx.saveStore(ctx.store);
    if (id.status === 'unasked') {
      if (!prompt) return; // a board scored on the way out: the question waits for one whose result is on screen
      clearTimeout(promptTimer);
      promptTimer = setTimeout(() => openNameSheet(), PROMPT_DELAY_MS);
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
    setTimeout(() => $('#lb-name-input').focus({ preventScroll: true }), 50);
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
    const rename = id.status === 'named' && id.name !== name;
    if (!id.playerId) id.playerId = randomId();
    id.name = name;
    id.status = 'named';
    for (const b of localBests(ctx.store.word)) queueResult(id.pending, b);
    ctx.saveStore(ctx.store);
    closeNameSheet();
    if (rename && configured) rpc('rename_player', { p_player: id.playerId, p_name: name }).catch(() => {});
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
    const wasNamed = id.status === 'named';
    if (wasNamed && configured) rpc('remove_player', { p_player: id.playerId }).catch(() => {});
    id.status = 'anonymous';
    id.name = null;
    id.pending = [];
    ctx.saveStore(ctx.store);
    closeNameSheet();
    renderFoot();
    if (sheet && !sheet.hidden) load();
  }

  // ---- the leaderboard sheet ------------------------------------------------------------------------

  function renderFoot() {
    const id = identity();
    const b = $('#btn-lb-name');
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
    await flush();
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
    if (e.key === 'Enter') {
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
    /** Forget who this device is on the leaderboard (and take a named player's rows down). */
    forgetIdentity() {
      const id = identity();
      if (id.status === 'named' && configured) rpc('remove_player', { p_player: id.playerId }).catch(() => {});
      ctx.store.leaderboard = defaultIdentity();
    },
  };
}

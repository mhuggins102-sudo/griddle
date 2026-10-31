// Synthesized sound effects (Web Audio, no asset files). One short cue per action.
// Audio contexts need a user gesture, so the context is created lazily on first play.

let ctx = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = !!on;
}

export function soundEnabled() {
  return enabled;
}

/** The audio context's state ('running' once a tap has unlocked it), for diagnostics. */
export function audioState() {
  return ctx ? ctx.state : 'none';
}

function audio() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** A tone with an attack/decay envelope. */
function tone(ac, { freq = 440, to = null, type = 'sine', start = 0, dur = 0.15, gain = 0.2, attack = 0.005 }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  const t0 = ac.currentTime + start;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Filtered noise burst (whoosh, rattle). */
function noise(ac, { start = 0, dur = 0.2, gain = 0.15, from = 800, to = 200, q = 1 }) {
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  const t0 = ac.currentTime + start;
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const CUES = {
  // a quick whoosh that settles with a soft thud
  slide: (ac) => {
    noise(ac, { dur: 0.22, gain: 0.18, from: 1500, to: 300, q: 0.8 });
    tone(ac, { freq: 180, to: 120, type: 'sine', start: 0.16, dur: 0.1, gain: 0.12 });
  },
  // two tiles trading places: two blips crossing in pitch
  swap: (ac) => {
    tone(ac, { freq: 520, to: 780, type: 'triangle', dur: 0.12, gain: 0.14 });
    tone(ac, { freq: 780, to: 520, type: 'triangle', start: 0.07, dur: 0.12, gain: 0.14 });
  },
  // a mechanical click as the letter steps
  nudge: (ac) => {
    tone(ac, { freq: 900, to: 600, type: 'square', dur: 0.05, gain: 0.08 });
    tone(ac, { freq: 300, type: 'sine', start: 0.03, dur: 0.08, gain: 0.1 });
  },
  nudgeDown: (ac) => {
    tone(ac, { freq: 600, to: 900, type: 'square', dur: 0.05, gain: 0.08 });
    tone(ac, { freq: 260, type: 'sine', start: 0.03, dur: 0.08, gain: 0.1 });
  },
  // tiles rattling in the bag, then a bright chime for the new letter
  draw: (ac) => {
    for (let i = 0; i < 5; i++) noise(ac, { start: i * 0.045, dur: 0.05, gain: 0.1, from: 2500, to: 1200, q: 3 });
    tone(ac, { freq: 880, type: 'sine', start: 0.26, dur: 0.22, gain: 0.16 });
    tone(ac, { freq: 1320, type: 'sine', start: 0.3, dur: 0.25, gain: 0.1 });
  },
  // a rising three-note chord as the word locks in
  lock: (ac) => {
    tone(ac, { freq: 523, type: 'triangle', dur: 0.3, gain: 0.14 });
    tone(ac, { freq: 659, type: 'triangle', start: 0.08, dur: 0.3, gain: 0.14 });
    tone(ac, { freq: 784, type: 'triangle', start: 0.16, dur: 0.4, gain: 0.14 });
    tone(ac, { freq: 1046, type: 'sine', start: 0.24, dur: 0.45, gain: 0.1 });
  },
  // a locked tile going wild: a shimmer
  wild: (ac) => {
    tone(ac, { freq: 600, to: 1800, type: 'sine', dur: 0.3, gain: 0.12 });
    tone(ac, { freq: 900, to: 2700, type: 'sine', start: 0.05, dur: 0.3, gain: 0.08 });
  },
  // board complete / level passed fanfare
  fanfare: (ac) => {
    [523, 659, 784, 1046].forEach((f, i) => tone(ac, { freq: f, type: 'triangle', start: i * 0.12, dur: 0.35, gain: 0.14 }));
    tone(ac, { freq: 1568, type: 'sine', start: 0.5, dur: 0.6, gain: 0.1 });
  },
  // goal reached mid-board: a bright rising arpeggio
  win: (ac) => {
    [659, 784, 988, 1319].forEach((f, i) => tone(ac, { freq: f, type: 'triangle', start: i * 0.08, dur: 0.3, gain: 0.13 }));
    tone(ac, { freq: 1976, type: 'sine', start: 0.34, dur: 0.5, gain: 0.08 });
  },
  // level failed: two falling notes
  fail: (ac) => {
    tone(ac, { freq: 440, to: 330, type: 'triangle', dur: 0.25, gain: 0.12 });
    tone(ac, { freq: 330, to: 220, type: 'triangle', start: 0.22, dur: 0.35, gain: 0.12 });
  },
  // undo: a short reverse sweep
  undo: (ac) => {
    tone(ac, { freq: 700, to: 350, type: 'sine', dur: 0.18, gain: 0.12 });
  },
  tap: (ac) => {
    tone(ac, { freq: 1200, type: 'sine', dur: 0.03, gain: 0.05 });
  },
  // not a word / not allowed: a short low buzz
  buzz: (ac) => {
    tone(ac, { freq: 160, to: 120, type: 'square', dur: 0.12, gain: 0.06 });
  },
};

/**
 * Browsers only let a page start audio inside a tap or click. Cues that play later (the tutorial's
 * demos run on timers) need the context created and resumed during an earlier gesture, so every
 * pointerdown on the page warms it up; a running context costs nothing to touch again.
 */
export function unlockAudio() {
  if (!enabled) return;
  try {
    audio();
  } catch {
    // audio is best-effort
  }
}
if (typeof document !== 'undefined') document.addEventListener('pointerdown', unlockAudio, { passive: true, capture: true });

/** Play a named cue; silently does nothing when sound is off or unavailable. */
export function play(name) {
  if (!enabled) return;
  const cue = CUES[name];
  if (!cue) return;
  try {
    const ac = audio();
    if (ac) cue(ac);
  } catch {
    // audio is best-effort
  }
}

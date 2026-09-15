// ==========================================================================
// COGNITRIXX click tone — the cursor, heard instead of seen.
//
// cursor.js draws three layers that chase the pointer at three different
// rates, and that stagger is what stops it reading as a sticker glued to the
// mouse. The click is the same instrument in sound: three partials with the
// same stagger and the same weighting.
//
//   dot   — top note, lands instantly, gone in 45ms. Precision.
//   ring  — the body of the sound, 6ms later, glides down a touch.
//   glow  — a low sine arriving last and ringing longest. The bloom.
//
// Oscillators, not a sample: nothing is fetched, and nothing exists until
// the first click — which is itself the gesture browsers demand before an
// AudioContext may start, so the cost is zero on a page nobody touches.
//
// Governed by the site mute button. Same localStorage key as audio.js and
// signal-game.js, so one switch owns every sound the site makes.
//
// Mounts on the same devices cursor.js does — fine pointer, motion allowed.
// A phone has no cursor for this to be the sound OF, and a tick on every tap
// of a site that already plays music is a lot to hand someone who never
// asked for either.
// ==========================================================================

import { INTERACTIVE, TEXTUAL } from '/js/cursor.js';

const MUTE_KEY = 'e26.audio.muted';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// The game synthesises its own charge/fire sounds on the same pointerdown.
// Playing this on top of those muddies both, so the arena is left alone.
const GAME = '[data-js="signal-game-mount"]';

const MIN_GAP_MS = 45;   // a fast double-click is two sounds, not a burst

let ctx = null;
let master = null;
let last = 0;

const muted = () => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { return false; }
};

function ensure() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    // The music sits at 0.091 and the game's master at 0.14. A UI tick is
    // the smallest thing on the page and should stay under both.
    master.gain.value = 0.11;
    master.connect(ctx.destination);
  } catch (_) {
    ctx = null;
  }
  return ctx;
}

/**
 * One partial of the chime. `delay` is what produces the three-layer
 * stagger; `glide` (a ratio) bends the pitch over the note's life.
 */
function partial(freq, { type = 'triangle', dur = 0.09, vol = 0.25, delay = 0, glide = 0 }) {
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t0 + dur);

  // Exponential ramps both ways: a linear fade to zero on a short note is
  // audible as a click of its own, which is not the click we want.
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/**
 * @param {boolean} hot — was the pointer over something interactive? The
 * glow swells over a real target and the sound follows it: a full chime
 * when the reticle latches onto something, a quiet low tick when it does
 * not. Clicking dead space should feel like nothing happened, because
 * nothing did.
 */
function strike(hot) {
  if (!ensure() || muted()) return;
  // A context created before its first gesture starts suspended; resuming
  // inside the click handler is what unblocks it.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  if (hot) {
    partial(1568, { type: 'triangle', dur: 0.045, vol: 0.20, delay: 0.000 });                // dot
    partial(1046, { type: 'triangle', dur: 0.110, vol: 0.30, delay: 0.006, glide: 0.94 });   // ring
    partial(523,  { type: 'sine',     dur: 0.220, vol: 0.16, delay: 0.014 });                // glow
  } else {
    partial(392,  { type: 'sine',     dur: 0.100, vol: 0.10, delay: 0.000 });
    partial(784,  { type: 'triangle', dur: 0.050, vol: 0.05, delay: 0.004 });
  }
}

/**
 * The gain column's tick — one note per segment as the music level moves.
 *
 * Two things are encoded in it, and they are the reason this is a tone and
 * not a generic click:
 *
 *   PITCH  climbs a pentatonic run across the column, so dragging through
 *          the segments sounds like a scale going up or down. Pentatonic
 *          because every interval in it is consonant — a chromatic run
 *          would sound like an error at the halfway point.
 *   VOLUME tracks the level you just chose, on the same squared curve the
 *          music itself uses. So the tick is not a confirmation that you
 *          changed something, it is a PREVIEW of what you changed it to:
 *          at segment 1 it is a whisper, at 7 it is the loudest the site
 *          gets. You set the volume by ear instead of by eye.
 *
 * Zero is its own sound — a short low thud with no pitch, because there is
 * no level left to demonstrate.
 *
 * @param {number} level  the new level, 0..steps
 * @param {number} steps  segments in the column
 */
const PENTATONIC = [523, 587, 659, 784, 880, 1046, 1175];   // C D E G A C D

export function gainTick(level, steps) {
  if (!ensure() || muted()) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  if (level <= 0) {
    partial(150, { type: 'sine', dur: 0.09, vol: 0.10, delay: 0, glide: 0.72 });
    return;
  }

  const f = PENTATONIC[Math.min(PENTATONIC.length - 1, level - 1)];
  // Squared, matching volFor() in audio.js — the tick is as loud, relative
  // to itself, as the music will be relative to its own ceiling.
  const amp = Math.pow(level / steps, 2);

  partial(f,     { type: 'triangle', dur: 0.055, vol: 0.05 + 0.22 * amp, delay: 0 });
  // A fifth underneath, quiet, so the note has a body rather than being a
  // bare sine — the same two-layer trick the "cold" click uses.
  partial(f / 2, { type: 'sine',     dur: 0.120, vol: 0.03 + 0.12 * amp, delay: 0.004 });
}

/**
 * Mount the click tone. Returns a handle with destroy(), or null on a touch
 * device (no cursor for this to be the sound of) or when the visitor has
 * asked for reduced motion — that preference is a request for less of
 * everything the page does at them, sound included.
 */
export function initClickTone() {
  if (REDUCED_MOTION || !FINE_POINTER) return null;

  const onDown = (e) => {
    const el = e.target instanceof Element ? e.target : null;
    // Over a text field the custom cursor hands back the native caret; the
    // sound steps back at the same boundary, for the same reason.
    if (el && (el.closest(TEXTUAL) || el.closest(GAME))) return;

    const now = performance.now();
    if (now - last < MIN_GAP_MS) return;
    last = now;

    strike(!!(el && el.closest(INTERACTIVE)));
  };

  window.addEventListener('pointerdown', onDown, { passive: true });

  return {
    destroy() { window.removeEventListener('pointerdown', onDown); },
  };
}

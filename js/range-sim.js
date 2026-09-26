/* ==========================================================================
   SIGNAL RANGE — the authoritative simulation.

   Pure, deterministic, and free of the DOM, so the SAME module runs in the
   browser (public/js/signal-game.js drives and draws it) and in Node
   (index.js replays it to verify a submitted run). Given a seed and a list
   of shots, both must arrive at byte-identical numbers — that equality is
   the whole basis for treating a leaderboard score as a fact rather than a
   claim, so nothing in here may read the clock, the viewport, or Math.random.

   Three things make that possible, and each replaced something in the old
   client-only game:

     FIXED ARENA     The old game placed the node relative to the live canvas
                     width, so a 27" monitor played a materially different
                     game from a phone — unfair even before cheating. Play now
                     happens in a fixed 1280x620 field that the client scales
                     for display only.

     FIXED TIMESTEP  The old loop integrated by frame delta, so physics
                     depended on frame rate. Time here advances in whole
                     ticks of TICK_MS and nothing else.

     SEEDED RNG      Wind and node placement drew from Math.random. They now
                     draw from a seeded PRNG, and the SERVER issues the seed,
                     so a client cannot pick a friendly one.
   ========================================================================== */

export const ARENA = { w: 1280, h: 620 };
export const TICK_MS = 1000 / 60;          // one tick == one frame of the old loop

export const GRAV = 0.34;
export const SPEED_MIN = 6;
export const SPEED_MAX = 22;
export const CHARGE_MS = 900;
export const WIND_MAX = 0.09;
export const WIND_ROTATE_EVERY = 3;
export const NODE_TTL_TICKS = Math.round(3500 / TICK_MS);
export const MAX_MISSES = 3;
export const RING_R = [34, 21, 9];         // outer, mid, core
export const BARREL_LEN = 46;
export const EMITTER = { x: 110, y: ARENA.h - 108 };

// Aim clamp — from nearly straight up to a little below horizontal.
export const AIM_MIN = -Math.PI * 0.44;
export const AIM_MAX = 0.26;

// A run cannot outlast this. Bounds replay cost on the server: a submitted
// trace can never make it loop forever.
export const MAX_TICKS = 60 * 60 * 30;     // 30 minutes at 60fps
export const MAX_SHOTS = 2000;

// Chrome the node must not spawn under. In the old game these were measured
// from the DOM every resize, which is exactly the kind of environment-derived
// value that makes a run unreplayable — they are now fixed logical rects and
// the stylesheet positions the real panels to match.
export const EXCLUSIONS = [
  { x: 0, y: 0, w: 300, h: 74 },                                   // save/load chips
  { x: ARENA.w / 2 - 110, y: 0, w: 220, h: 54 },                   // wind readout
  { x: ARENA.w - 470, y: 0, w: 470, h: 100 },                      // stat HUD
  { x: 0, y: ARENA.h - 92, w: 280, h: 92 },                        // charge gauge
  { x: ARENA.w - 220, y: ARENA.h - 84, w: 220, h: 84 },            // restart chip
  { x: EMITTER.x - 96, y: EMITTER.y - 96, w: 192, h: 220 },        // emitter bay
];

/** mulberry32 — small, fast, and identical across JS engines, which is the
 *  only property that matters here. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clampAim(a) {
  if (a < AIM_MIN) return AIM_MIN;
  if (a > AIM_MAX) return AIM_MAX;
  return a;
}

/** Points for a hit at distance `d` from the node centre, or 0 for a miss. */
function ringPoints(d) {
  const [rOuter, rMid, rCore] = RING_R;
  if (d >= rOuter) return 0;
  if (d < rCore) return 100;
  if (d < rMid) return 40;
  return 15;
}

export function createSim(seed) {
  const rand = rng(seed);

  const state = {
    tick: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    shots: 0,
    hits: 0,
    misses: 0,
    over: false,
    wind: 0,
    shotsSinceWind: 0,
    projectile: null,
    node: { x: 0, y: 0, baseY: 0, bornTick: 0 },
    // Purely cosmetic, but it lives here so the renderer and the verifier
    // agree on what the node was doing at any tick.
    lastEvent: null,
  };

  function rotateWind() {
    // Bias away from the previous direction so the wind actually changes
    // rather than nudging the same way twice running.
    const sign = state.wind === 0 ? (rand() < 0.5 ? -1 : 1) : (state.wind > 0 ? -1 : 1);
    state.wind = sign * (0.35 + rand() * 0.65) * WIND_MAX;
    state.shotsSinceWind = 0;
  }

  function placeNode() {
    // Range widens with score, so late-game shots are longer. Derived from
    // score alone — never from the display size.
    const scoreStretch = Math.min(0.28, state.score / 1200);
    const marginTop = 50;
    const marginBottom = ARENA.h - 200;
    const range = Math.max(80, marginBottom - marginTop);
    const pad = RING_R[0] + 30;
    const clear = (cx, cy) => !EXCLUSIONS.some(z =>
      cx + pad > z.x && cx - pad < z.x + z.w &&
      cy + pad > z.y && cy - pad < z.y + z.h);

    let nx = ARENA.w - 130, ny = ARENA.h * 0.5;
    for (let i = 0; i < 30; i++) {
      const backoff = 90 + rand() * Math.min(260, ARENA.w * (0.14 + scoreStretch));
      const candX = ARENA.w - backoff;
      const candY = marginTop + rand() * range;
      // Both draws happen every iteration, hit or miss, so the PRNG advances
      // the same number of steps on every machine.
      if (clear(candX, candY)) { nx = candX; ny = candY; break; }
    }
    state.node.x = nx;
    state.node.baseY = ny;
    state.node.y = ny;
    state.node.bornTick = state.tick;
  }

  // Opening conditions, drawn from the seed so every player who is issued
  // that seed starts the identical run.
  state.wind = (rand() * 2 - 1) * WIND_MAX * 0.7;
  placeNode();

  /** Fire from the emitter. `angle` is clamped, `charge` is 0..1. Returns
   *  false when the shot is refused (already in flight, or run over). */
  function fire(angle, charge) {
    if (state.over || state.projectile) return false;
    if (!(charge > 0.06)) return false;                 // twitch click
    const a = clampAim(Number(angle) || 0);
    const c = Math.min(1, Math.max(0, Number(charge) || 0));
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * c;
    state.projectile = {
      x: EMITTER.x + Math.cos(a) * BARREL_LEN,
      y: EMITTER.y + Math.sin(a) * BARREL_LEN,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      age: 0,
    };
    state.shots++;
    state.shotsSinceWind++;
    if (state.shotsSinceWind >= WIND_ROTATE_EVERY) rotateWind();
    return true;
  }

  function endRunIfSpent() {
    if (state.misses >= MAX_MISSES) state.over = true;
  }

  /** Advance exactly one tick. */
  function step() {
    if (state.over) return;
    state.tick++;
    state.lastEvent = null;

    // The node relocates on its own if it is left alone too long.
    if (!state.projectile && (state.tick - state.node.bornTick) > NODE_TTL_TICKS) {
      placeNode();
      state.lastEvent = { type: 'respawn' };
    }

    // Idle vertical drift. A function of tick alone, so it replays exactly.
    state.node.y = state.node.baseY + Math.sin((state.tick * TICK_MS / 1000) * 0.6) * 12;

    const p = state.projectile;
    if (!p) return;

    p.vy += GRAV;
    p.vx += state.wind;
    p.x += p.vx;
    p.y += p.vy;
    p.age++;

    const d = Math.hypot(p.x - state.node.x, p.y - state.node.y);
    const pts = ringPoints(d);
    if (pts > 0) {
      const streakMult = 1 + Math.floor(state.streak / 3) * 0.5;
      const gained = Math.round(pts * streakMult);
      state.score += gained;
      state.streak++;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      state.hits++;
      state.projectile = null;
      state.lastEvent = { type: 'hit', pts, gained, x: state.node.x, y: state.node.y };
      placeNode();
      return;
    }

    // Miss: hit the floor or left the field.
    if (p.y > ARENA.h - 4 || p.x > ARENA.w + 30 || p.x < -30) {
      state.streak = 0;
      state.misses++;
      state.projectile = null;
      state.lastEvent = { type: 'miss', x: p.x, y: Math.min(p.y, ARENA.h - 4) };
      endRunIfSpent();
    }
  }

  return {
    state,
    step,
    fire,
    result: () => ({
      score: state.score,
      streak: state.bestStreak,
      shots: state.shots,
      hits: state.hits,
      ticks: state.tick,
      over: state.over,
    }),
  };
}

/** Re-run a trace and return what it ACTUALLY scores.
 *
 *  `shots` is [{ tick, angle, charge }] in ascending tick order. The result
 *  is authoritative: the client's own numbers are never consulted. Returns
 *  `{ ok: false, reason }` for a trace that could not have been produced by
 *  playing — out-of-order ticks, a shot fired while one was in flight, a
 *  shot after the run ended.
 */
export function replay(seed, shots) {
  if (!Array.isArray(shots)) return { ok: false, reason: 'Trace missing.' };
  if (shots.length > MAX_SHOTS) return { ok: false, reason: 'Too many shots.' };

  const sim = createSim(seed);
  let last = -1;

  for (const s of shots) {
    const tick = Math.floor(Number(s?.tick));
    const angle = Number(s?.angle);
    const charge = Number(s?.charge);
    if (!Number.isFinite(tick) || !Number.isFinite(angle) || !Number.isFinite(charge)) {
      return { ok: false, reason: 'Malformed shot.' };
    }
    if (tick <= last) return { ok: false, reason: 'Shots out of order.' };
    if (tick > MAX_TICKS) return { ok: false, reason: 'Run too long.' };

    while (sim.state.tick < tick && !sim.state.over) sim.step();
    if (sim.state.over) return { ok: false, reason: 'Shot fired after the run ended.' };
    if (!sim.fire(angle, charge)) return { ok: false, reason: 'Shot rejected by the simulation.' };
    last = tick;
  }

  // Let whatever is still in the air land, so the final shot counts.
  let guard = 0;
  while (!sim.state.over && sim.state.projectile && guard++ < 4000) sim.step();

  return { ok: true, ...sim.result() };
}

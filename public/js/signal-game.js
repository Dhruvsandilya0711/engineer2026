/* ==========================================================================
   SIGNAL RANGE — an interactive between-sections moment.

   A bowmaster-style shooter, restyled as a data-signal transmission range:
   an angular EMITTER on the left, a NODE (three concentric rings, magenta
   ring / indigo ring / cyan core) on the right. The visitor aims by moving
   the pointer, holds to charge the emitter — the barrel glows and a HUD
   gauge fills — releases to fire a photon that arcs across the range under
   a little gravity, leaves a fading trail, and either drills into a ring
   (score + burst) or falls short (streak reset, dust puff).

   The whole surface is 2D canvas, no WebGL — this is deliberately cheap
   enough to run on a low-end phone next to the rest of the WebGL work on
   the page. Palette is the site palette (--color-cyan / --color-magenta /
   --color-indigo), typography inherits var(--font-mono) via the HUD DOM.
   ========================================================================== */

const IS_TOUCH = window.matchMedia('(hover: none)').matches;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Physics — tuned so mid-charge with the right angle drops onto the node
// most of the time. Harder now: smaller rings (in state), sideways wind
// that changes every few shots, and the node relocates on its own if the
// visitor sits on a shot for too long.
const GRAV = 0.34;
const SPEED_MIN = 6;
const SPEED_MAX = 22;
const CHARGE_MS = 900;                 // 0 → max in this many ms of hold
const AUTO_FIRE_AT_FULL = true;        // release the shot at max charge
const WIND_MAX = 0.09;                 // px/frame^2 sideways nudge
const WIND_ROTATE_EVERY = 3;           // shots between wind rotations
const NODE_TTL_MS = 3500;              // node moves on its own after this
const NODE_WARN_MS = 1200;             // last N ms it pulses red
const MAX_MISSES = 3;                  // 3 misses and the run ends

// Best score is per-visitor, persisted client-side.
const BEST_KEY = 'e26.signalRange.best';
// Shared with site audio: if music is muted, so are game SFX. One switch.
const MUTE_KEY = 'e26.audio.muted';

export function mountSignalGame() {
  const host = document.querySelector('[data-js="signal-game-mount"]');
  if (!host) return;
  const canvas = host.querySelector('canvas[data-js="signal-game"]');
  const ctx = canvas.getContext('2d', { alpha: true });

  // Colours pulled from the site's cascade so this lives inside the palette
  // rather than beside it. --color-* are hex strings; parse to r,g,b once.
  const css = getComputedStyle(document.documentElement);
  const CYAN    = hex(css.getPropertyValue('--color-cyan')    || '#67e8f9');
  const MAGENTA = hex(css.getPropertyValue('--color-magenta') || '#e879f9');
  const INDIGO  = hex(css.getPropertyValue('--color-indigo')  || '#6366f1');
  const PAPER   = hex(css.getPropertyValue('--paper')         || '#e6e9ef');

  const scoreEl  = host.querySelector('[data-js="sg-score"]');
  const streakEl = host.querySelector('[data-js="sg-streak"]');
  const bestEl   = host.querySelector('[data-js="sg-best"]');
  const chargeEl = host.querySelector('[data-js="sg-charge"]');
  const livesEl  = host.querySelector('[data-js="sg-lives"]');
  const resetBtn = host.querySelector('[data-js="sg-reset"]');
  const saveBtn  = host.querySelector('[data-js="sg-save"]');
  const lifeDots = livesEl ? Array.from(livesEl.querySelectorAll('.signal-range__life')) : [];

  const state = {
    w: 0, h: 0, dpr: 1,
    pointer: { x: 0, y: 0, inside: false },
    emitter: { x: 0, y: 0, angle: -0.35 },
    node:    { x: 0, y: 0, ringR: [34, 21, 9], drift: 0, driftY: 0, bornAt: 0 },
    projectile: null,
    trail: [],                         // recent projectile positions
    bursts: [],
    hitFlashes: [],
    ambient: [],                       // drifting background signal dots
    ripples: [],                       // radial pulses from big hits
    shake: 0,                          // camera shake amplitude (px)
    wind: 0,                           // current sideways nudge (px/frame^2)
    shotsSinceWind: 0,                 // rotate wind every WIND_ROTATE_EVERY
    charging: false,
    charge: 0,
    chargeStart: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,                     // longest streak THIS run — the streak
                                       // board scores this, not the live value,
                                       // which is 0 the moment a run ends
    runStartedAt: Date.now(),
    shots: 0,
    hits: 0,
    misses: 0,                         // consecutive misses toward MAX_MISSES
    best: Number(localStorage.getItem(BEST_KEY) || 0),
    lastPop: null,                     // { text, x, y, life, color }
    lockUntil: 0,                      // frozen input during game-over flash
    time: 0,
  };
  // Start with a random wind direction so the very first shot must reckon
  // with it too.
  state.wind = (Math.random() * 2 - 1) * WIND_MAX * 0.7;
  bestEl.textContent = String(state.best);

  // Life dots — leftmost dot goes dark first, so the row reads "3 → 2 → 1
  // → out" left-to-right. Keeps the visual grammar the same as most arcade
  // life bars people already know.
  function paintLives() {
    const left = MAX_MISSES - state.misses;
    for (let i = 0; i < lifeDots.length; i++) {
      lifeDots[i].classList.toggle('is-lost', i < state.misses);
      lifeDots[i].classList.toggle('is-warn', i === state.misses - 1 && left > 0);
    }
    // Keep the accessible label in sync so the live region announces "Signal
    // at 2 of 3" rather than the same static label after a miss.
    if (livesEl) {
      livesEl.setAttribute('aria-label',
        left === MAX_MISSES ? 'Signal at full strength' :
        left === 0          ? 'Signal lost' :
                              `Signal at ${left} of ${MAX_MISSES}`);
    }
  }
  paintLives();

  // End of a run — reset the score column but keep the best. A short input
  // freeze prevents an in-flight click from starting the next charge on top
  // of the "SIGNAL LOST" flash. Both the lose-condition and the Restart
  // button funnel through restartRun so the arena reboots the same way.
  function restartRun(text, color, sound) {
    if (state.charging) {
      state.charging = false; state.charge = 0;
      chargeEl.style.width = '0%';
      sfx('chargeEnd');
    }
    state.projectile = null;
    state.trail.length = 0;
    state.score = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.shots = 0;
    state.hits = 0;
    state.runStartedAt = Date.now();
    state.misses = 0;
    scoreEl.textContent = '0';
    streakEl.textContent = '×0';
    paintLives();
    spawnPop(text, state.w / 2, state.h * 0.42, color);
    state.shake = Math.min(20, state.shake + 14);
    sfx(sound);
    state.lockUntil = state.time + 900;
    rotateWind();
    placeNode();
    // Ping the Restart chip so it flashes and its icon spins even when the
    // reboot came from an internal trigger (lose or R key), not a click.
    if (resetBtn) {
      resetBtn.classList.remove('is-firing');
      void resetBtn.offsetWidth;              // restart the animation cleanly
      resetBtn.classList.add('is-firing');
      setTimeout(() => resetBtn.classList.remove('is-firing'), 640);
    }
  }
  // A run's final numbers, taken BEFORE restartRun wipes them. The streak
  // board scores `bestStreak`, not the live streak — that one is always 0 at
  // the moment a run ends, because a run ends on misses.
  function snapshotRun() {
    return {
      score: state.score,
      streak: state.bestStreak,
      shots: state.shots,
      hits: state.hits,
      runMs: Math.max(0, Date.now() - state.runStartedAt),
    };
  }

  // Every run end funnels through here, whether the player lost or chose to
  // bank the run. The leaderboard UI (public/js/leaderboard.js) listens for
  // the event and offers to submit; the game itself stays unaware of names,
  // networks and prizes.
  //
  // Banking ENDS the run deliberately: if you could save and keep playing,
  // you could bank a good score, gamble the next shot, and re-save — which
  // would quietly hollow out the streak prize.
  function endRun(reason) {
    const run = snapshotRun();
    if (reason === 'lost') restartRun('SIGNAL LOST — RESTART', MAGENTA, 'miss');
    else restartRun('RUN BANKED', CYAN, 'spawn');
    host.dispatchEvent(new CustomEvent('e26:range:runend', {
      detail: { run, reason }, bubbles: true,
    }));
  }

  function gameOver() { endRun('lost'); }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (state.score <= 0 && state.bestStreak <= 0) return;
      endRun('banked');
    });
  }

  // -------------------------------------------------------------------------
  // SOUND — a tiny WebAudio synth. No sample files: everything is oscillators
  // routed through a master gain so a single mute switch (shared with the
  // site music button) governs the whole game's audible surface.
  // The context is created lazily on the first user gesture; browsers won't
  // start one before that anyway.
  let audioCtx = null, master = null, chargeOsc = null, chargeGain = null;
  const isMuted = () => {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { return false; }
  };
  const ensureAudio = () => {
    if (audioCtx) return audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      master = audioCtx.createGain();
      master.gain.value = 0.14;         // game sits under the music
      master.connect(audioCtx.destination);
    } catch (_) { audioCtx = null; }
    return audioCtx;
  };
  window.addEventListener('storage', (e) => {
    if (e.key === MUTE_KEY && isMuted() && chargeGain && audioCtx) {
      chargeGain.gain.cancelScheduledValues(audioCtx.currentTime);
      chargeGain.gain.setValueAtTime(0, audioCtx.currentTime);
    }
  });
  function pluck(freq, dur = 0.12, type = 'triangle', vol = 0.5) {
    const c = ensureAudio(); if (!c || isMuted()) return;
    const t0 = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    const g = c.createGain(); g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function chord(freqs, dur = 0.32, vol = 0.35) {
    freqs.forEach((f, i) => pluck(f, dur, i === 0 ? 'sine' : 'triangle', vol));
  }
  function chirp(f0, f1, dur = 0.16, vol = 0.4, type = 'sawtooth') {
    const c = ensureAudio(); if (!c || isMuted()) return;
    const t0 = c.currentTime;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noiseBurst(dur = 0.14, vol = 0.35) {
    const c = ensureAudio(); if (!c || isMuted()) return;
    const t0 = c.currentTime;
    const buf = c.createBuffer(1, Math.max(1, Math.round(c.sampleRate * dur)), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.4;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(bp).connect(g).connect(master); src.start(t0);
  }
  function sfx(kind) {
    if (isMuted()) return;
    switch (kind) {
      case 'chargeStart':
        (function startCharge() {
          const c = ensureAudio(); if (!c) return;
          if (chargeOsc) { try { chargeOsc.stop(); } catch (_) {} }
          const o = c.createOscillator(); o.type = 'sawtooth';
          const g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime);
          g.gain.exponentialRampToValueAtTime(0.10, c.currentTime + 0.05);
          o.frequency.setValueAtTime(160, c.currentTime);
          o.connect(g).connect(master); o.start();
          chargeOsc = o; chargeGain = g;
        })();
        break;
      case 'chargeUpdate':
        if (chargeOsc && audioCtx) {
          chargeOsc.frequency.setTargetAtTime(160 + state.charge * 480, audioCtx.currentTime, 0.03);
          chargeGain.gain.setTargetAtTime(0.05 + state.charge * 0.14, audioCtx.currentTime, 0.03);
        }
        break;
      case 'chargeEnd':
        if (chargeOsc && audioCtx) {
          chargeGain.gain.cancelScheduledValues(audioCtx.currentTime);
          chargeGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
          try { chargeOsc.stop(audioCtx.currentTime + 0.12); } catch (_) {}
          chargeOsc = null; chargeGain = null;
        }
        break;
      case 'fire':
        chirp(900, 220, 0.14, 0.35);
        noiseBurst(0.06, 0.15);
        break;
      case 'hitRing':   chord([440, 660], 0.22, 0.3); break;
      case 'hitMid':    chord([550, 825, 1100], 0.28, 0.35); break;
      case 'hitCore':   chord([660, 990, 1320, 1760], 0.42, 0.42); break;
      case 'miss':      pluck(120, 0.18, 'sine', 0.22); noiseBurst(0.10, 0.10); break;
      case 'spawn':     pluck(880, 0.06, 'sine', 0.16); break;
      case 'gust':      pluck(180, 0.14, 'sine', 0.15); break;
    }
  }

  // ---- sizing --------------------------------------------------------------
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.w = Math.max(1, r.width);
    state.h = Math.max(1, r.height);
    canvas.width  = Math.round(state.w * state.dpr);
    canvas.height = Math.round(state.h * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.emitter.x = 110;
    state.emitter.y = state.h - 108;
    computeExclusions();
    if (state.node.x === 0) placeNode(true);
    else {
      // Nudge the node's home base into the new arena bounds on resize.
      state.node.x = Math.min(state.node.x, state.w - 130);
    }
    // Seed the ambient signal drift only on first size.
    if (state.ambient.length === 0) {
      const n = Math.round(Math.min(70, (state.w * state.h) / 24000));
      for (let i = 0; i < n; i++) {
        state.ambient.push({
          x: Math.random() * state.w,
          y: Math.random() * state.h,
          vx: (Math.random() - 0.5) * 0.14,
          vy: (Math.random() - 0.5) * 0.09,
          r: 0.6 + Math.random() * 1.6,
          hue: Math.random() < 0.5 ? CYAN : (Math.random() < 0.6 ? INDIGO : MAGENTA),
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  resize();

  // ---- HUD exclusion zones -------------------------------------------------
  // The node must never land behind the Score/Streak/Best/Signal HUD, the
  // wind readout, the charge gauge, or the Restart chip — chrome eats the
  // target and the shot has nothing to read against. Rects here are in the
  // canvas's local space and include a small pad so the node's outer bloom
  // stays clear too. Recomputed on resize.
  function computeExclusions() {
    const zones = [];
    const cr = canvas.getBoundingClientRect();
    const local = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
    };
    // Wind readout — drawn on the canvas itself, coords match drawWindIndicator.
    const ww = Math.min(180, state.w * 0.22);
    zones.push({ x: state.w / 2 - ww / 2 - 20, y: 0, w: ww + 40, h: 54 });
    // Emitter cabinet — the whole bay around the tank stays clear.
    zones.push({ x: state.emitter.x - 96, y: state.emitter.y - 96, w: 192, h: 220 });
    for (const sel of ['.signal-range__hud', '.signal-range__gauge',
                       '.signal-range__actions', '.signal-range__reset']) {
      const b = local(host.querySelector(sel));
      if (b) zones.push({ x: b.x - 14, y: b.y - 14, w: b.w + 28, h: b.h + 28 });
    }
    state.exclusion = zones;
  }
  state.exclusion = [];

  // ---- node placement ------------------------------------------------------
  function placeNode(initial = false) {
    // Choose a fresh position that isn't too close to the emitter, stays in
    // the top half so the shot has to arc, and doesn't collide with any of
    // the HUD panels around the arena edges. Range widens with score so
    // late-game shots are longer and harder to line up.
    if (!state.exclusion || !state.exclusion.length) computeExclusions();
    const scoreStretch = Math.min(0.28, state.score / 1200);
    const marginTop = 50;
    const marginBottom = state.h - 200;
    const range = Math.max(80, marginBottom - marginTop);
    // Padding matches the node's visible extent: outer ring + halo + brackets.
    const pad = state.node.ringR[0] + 30;
    const clear = (cx, cy) => {
      for (const z of state.exclusion) {
        if (cx + pad > z.x && cx - pad < z.x + z.w &&
            cy + pad > z.y && cy - pad < z.y + z.h) return false;
      }
      return true;
    };
    let nx = state.w - 130, ny = state.h * 0.5;
    for (let i = 0; i < 30; i++) {
      const backoff = 90 + Math.random() * Math.min(260, state.w * (0.14 + scoreStretch));
      const candX = state.w - backoff;
      const candY = marginTop + Math.random() * range;
      if (clear(candX, candY)) { nx = candX; ny = candY; break; }
    }
    state.node.x = nx;
    state.node.y = ny;
    state.node.driftY = state.node.y;
    state.node.drift = 0;
    state.node.bornAt = state.time;
    if (initial) return;
    spawnBurst(state.node.x, state.node.y, CYAN, 6, 0.6);
    sfx('spawn');
  }

  function rotateWind() {
    // Fresh direction, biased away from the previous one so the wind
    // actually changes rather than nudging the same way twice in a row.
    const sign = state.wind === 0 ? (Math.random() < 0.5 ? -1 : 1) : (state.wind > 0 ? -1 : 1);
    state.wind = sign * (0.35 + Math.random() * 0.65) * WIND_MAX;
    state.shotsSinceWind = 0;
  }

  // ---- input ---------------------------------------------------------------
  const localPt = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Duck the site music while the visitor is playing — the SFX and their
  // own concentration have room. Restored the moment they leave the arena.
  const duckMusic    = () => document.dispatchEvent(new CustomEvent('e26:music:duck'));
  const restoreMusic = () => document.dispatchEvent(new CustomEvent('e26:music:restore'));
  canvas.addEventListener('pointerenter', () => {
    state.pointer.inside = true;
    duckMusic();
  });
  canvas.addEventListener('pointerleave', () => {
    state.pointer.inside = false;
    if (state.charging) release();
    restoreMusic();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = localPt(e); state.pointer.x = p.x; state.pointer.y = p.y;
  });
  const start = (e) => {
    if (state.projectile) return;
    if (state.time < state.lockUntil) return;
    const p = localPt(e); state.pointer.x = p.x; state.pointer.y = p.y;
    state.pointer.inside = true;
    state.charging = true;
    state.charge = 0;
    state.chargeStart = performance.now();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    sfx('chargeStart');
    e.preventDefault();
  };
  const end = () => { if (state.charging) release(); };
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // Keyboard: space to charge/release. Focus lands on the canvas via tabindex.
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !state.charging && !state.projectile && state.time >= state.lockUntil) {
      state.charging = true; state.charge = 0; state.chargeStart = performance.now();
      e.preventDefault();
    }
  });
  canvas.addEventListener('keyup', (e) => { if (e.code === 'Space') end(); });

  resetBtn?.addEventListener('click', () => {
    state.shots = 0; state.hits = 0;
    restartRun('RANGE REBOOTED', CYAN, 'spawn');
  });
  // R key — global shortcut so pressing R anywhere on the page reboots
  // the range even when the canvas doesn't hold focus.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyR') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    state.shots = 0; state.hits = 0;
    restartRun('RANGE REBOOTED', CYAN, 'spawn');
  });

  function release() {
    if (!state.charging) return;
    const charge = state.charge;
    state.charging = false; state.charge = 0;
    chargeEl.style.width = '0%';
    sfx('chargeEnd');
    if (charge < 0.06) return;             // twitch click, don't fire
    fire(charge);
  }

  function fire(power) {
    const angle = state.emitter.angle;     // already aimed at the pointer
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * power;
    // Emerge from the tip of the barrel — visually and hit-wise.
    const barrelLen = 46;
    const x = state.emitter.x + Math.cos(angle) * barrelLen;
    const y = state.emitter.y + Math.sin(angle) * barrelLen;
    state.projectile = {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
    };
    // Recoil puff at the muzzle + fire SFX.
    spawnBurst(x, y, CYAN, 8, 0.7);
    sfx('fire');
    state.shots++;
    state.shotsSinceWind++;
    if (state.shotsSinceWind >= WIND_ROTATE_EVERY) { rotateWind(); sfx('gust'); }
  }

  // ---- particles -----------------------------------------------------------
  function spawnBurst(x, y, color, n = 18, force = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.8 + Math.random() * 3.2) * force;
      state.bursts.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1.1 * force,
        life: 1,
        size: 1 + Math.random() * 2.2,
        color,
      });
    }
  }

  function spawnPop(text, x, y, color) {
    state.lastPop = { text, x, y, life: 1, color };
  }

  // ---- per-frame -----------------------------------------------------------
  // The RAF loop is gated by two signals so it doesn't waste frames when the
  // arena isn't on screen:
  //   • an IntersectionObserver — pauses the moment the arena leaves the
  //     viewport (scrolled past, or the section unmounted).
  //   • document.hidden — pauses when the tab is backgrounded, and drives a
  //     time-offset restart so charge / TTL don't sprint through the gap.
  // Restart uses a fresh performance.now baseline for `state.time` so the
  // very first frame after resuming doesn't see a giant `dt`.
  let raf = 0;
  let running = false;
  let onScreen = true;
  const startLoop = () => {
    if (running) return;
    // Reset time baselines so the pause interval doesn't count toward the
    // node's TTL or the charge timer. Only applies to a real resume — a
    // first-time start has state.time = 0 and nothing to offset.
    if (state.time > 0) {
      const pauseDur = performance.now() - state.time;
      if (state.node.bornAt) state.node.bornAt += pauseDur;
      if (state.chargeStart) state.chargeStart += pauseDur;
      if (state.lockUntil)   state.lockUntil   += pauseDur;
    }
    running = true;
    raf = requestAnimationFrame(frame);
  };
  const stopLoop = () => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    // Kill any live charge so the visitor doesn't come back to an armed shot.
    if (state.charging) {
      state.charging = false;
      state.charge = 0;
      chargeEl.style.width = '0%';
      sfx('chargeEnd');
    }
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      onScreen = e.isIntersecting;
      if (onScreen && !document.hidden) startLoop();
      else stopLoop();
    }
  }, { rootMargin: '120px' });                 // wake a touch before it slides in
  io.observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else if (onScreen) startLoop();
  });

  function frame(now) {
    state.time = now;
    // Aim: emitter always points at the current pointer, clamped so it can't
    // fire straight down / straight back.
    const dx = state.pointer.x - state.emitter.x;
    const dy = state.pointer.y - state.emitter.y;
    let a = Math.atan2(dy, dx);
    // Clamp: from -80° (nearly straight up) to +15° (a bit below horizontal).
    if (a < -Math.PI * 0.44) a = -Math.PI * 0.44;
    if (a > 0.26) a = 0.26;
    // If pointer is behind the emitter, hold a default upward aim.
    if (dx < 30) a = -0.42;
    // Smooth for silky follow.
    state.emitter.angle += (a - state.emitter.angle) * (REDUCED_MOTION ? 1 : 0.22);

    // Charging.
    if (state.charging) {
      state.charge = Math.min(1, (now - state.chargeStart) / CHARGE_MS);
      chargeEl.style.width = (state.charge * 100).toFixed(1) + '%';
      sfx('chargeUpdate');
      if (AUTO_FIRE_AT_FULL && state.charge >= 1) release();
    }

    // Auto-move the node if it's been sitting too long.
    if (!state.projectile && (now - state.node.bornAt) > NODE_TTL_MS) {
      placeNode();
    }

    // The node drifts a little on its Y axis — it's alive, not a bullseye
    // painted on a wall. Idle drift only, and it's slow.
    const t = now / 1000;
    state.node.y = state.node.driftY + Math.sin(t * 0.6) * 12;

    // Projectile physics + collision.
    if (state.projectile) {
      const p = state.projectile;
      state.trail.push({ x: p.x, y: p.y, life: 1 });
      if (state.trail.length > 60) state.trail.shift();
      p.vy += GRAV;
      p.vx += state.wind;                  // sideways nudge
      p.x += p.vx;
      p.y += p.vy;
      p.age++;

      // Hit test against the node's outer ring.
      const nx = p.x - state.node.x, ny = p.y - state.node.y;
      const d = Math.hypot(nx, ny);
      const [rOuter, rMid, rCore] = state.node.ringR;
      if (d < rOuter) {
        let pts, ringColor, label;
        if (d < rCore)      { pts = 100; ringColor = CYAN;    label = 'BULLSEYE +100'; }
        else if (d < rMid)  { pts = 40;  ringColor = MAGENTA; label = 'RING +40';      }
        else                { pts = 15;  ringColor = INDIGO;  label = '+15';           }
        // Streak bonus: every third consecutive hit adds a multiplier.
        const streakMult = 1 + Math.floor(state.streak / 3) * 0.5;
        const gained = Math.round(pts * streakMult);
        state.score += gained;
        state.streak += 1;
        if (state.streak > state.bestStreak) state.bestStreak = state.streak;
        if (state.score > state.best) {
          state.best = state.score;
          try { localStorage.setItem(BEST_KEY, String(state.best)); } catch (_) {}
          bestEl.textContent = String(state.best);
        }
        scoreEl.textContent = String(state.score);
        streakEl.textContent = '×' + state.streak;
        spawnBurst(state.node.x, state.node.y, ringColor, 30 + pts / 4, 1.4);
        state.hitFlashes.push({ x: state.node.x, y: state.node.y, life: 1, color: ringColor });
        state.ripples.push({ x: state.node.x, y: state.node.y, r: rOuter, life: 1, color: ringColor });
        sfx(pts >= 100 ? 'hitCore' : pts >= 40 ? 'hitMid' : 'hitRing');
        state.hits++;
        // Camera shake scales with points; bullseye is a proper thump.
        state.shake = Math.min(14, state.shake + (pts >= 100 ? 10 : pts >= 40 ? 5 : 2));
        spawnPop(streakMult > 1 ? `${label}  ×${streakMult.toFixed(1)}` : label,
                 state.node.x, state.node.y - 46, ringColor);
        state.projectile = null;
        state.trail.length = 0;
        placeNode();
      } else if (p.y > state.h - 4 || p.x > state.w + 30 || p.x < -30) {
        // Miss: ground puff or off-screen, streak resets, life burned.
        const gy = Math.min(p.y, state.h - 4);
        spawnBurst(p.x, gy, hex('#642'), 10, 0.6);
        if (state.streak > 0) state.streak = 0;
        streakEl.textContent = '×' + state.streak;
        state.projectile = null;
        state.trail.length = 0;
        state.misses += 1;
        paintLives();
        if (state.misses >= MAX_MISSES) {
          gameOver();
        } else {
          const left = MAX_MISSES - state.misses;
          spawnPop(`SIGNAL DROPPED — ${left} LEFT`, state.w / 2, state.h * 0.32, MAGENTA);
          sfx('miss');
        }
      }
    } else {
      // Fade the trail into the void after the shot resolves.
      for (const t of state.trail) t.life *= 0.88;
      if (state.trail.length && state.trail[0].life < 0.02) state.trail.length = 0;
    }

    // Particles.
    for (const b of state.bursts) {
      b.life -= 0.024;
      b.x += b.vx;
      b.y += b.vy;
      b.vy += 0.10;
      b.vx *= 0.985;
    }
    state.bursts = state.bursts.filter(b => b.life > 0);

    for (const f of state.hitFlashes) f.life -= 0.045;
    state.hitFlashes = state.hitFlashes.filter(f => f.life > 0);

    for (const r of state.ripples) { r.life -= 0.018; r.r += 3.2; }
    state.ripples = state.ripples.filter(r => r.life > 0);

    // Ambient signals drift and wrap around the arena.
    for (const s of state.ambient) {
      s.x += s.vx; s.y += s.vy;
      if (s.x < -4) s.x = state.w + 4;
      if (s.x > state.w + 4) s.x = -4;
      if (s.y < -4) s.y = state.h + 4;
      if (s.y > state.h + 4) s.y = -4;
    }

    // Decay shake fast.
    if (state.shake > 0) state.shake = Math.max(0, state.shake - 0.5);

    if (state.lastPop) {
      state.lastPop.life -= 0.018;
      state.lastPop.y -= 0.6;
      if (state.lastPop.life <= 0) state.lastPop = null;
    }

    draw();
    if (running) raf = requestAnimationFrame(frame);
  }
  // Loop starts through the IntersectionObserver callback the moment the
  // arena reports its first intersection (whether it's already on-screen or
  // not) — no eager RAF here.

  // ---- draw ----------------------------------------------------------------
  function draw() {
    const { w, h } = state;
    ctx.clearRect(0, 0, w, h);

    // Camera shake — wrap the whole scene in a small translate.
    if (state.shake > 0) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }

    drawGrid();
    drawAmbient();
    drawFloor();
    drawRipples();
    drawTrajectoryPreview();
    drawTrail();
    drawNode();
    drawEmitter();
    drawProjectile();
    drawBursts();
    drawHitFlashes();
    drawPop();
    drawWindIndicator();
    drawScanline();

    if (state.shake > 0) ctx.restore();
  }

  function drawWindIndicator() {
    // Small tape at the top-centre: arrow + strength bar. The visitor needs
    // to see which way the shot will drift or the wind isn't a mechanic,
    // it's a punishment.
    const cx = state.w / 2, cy = 26;
    const w = Math.min(180, state.w * 0.22);
    ctx.save();
    // Frame.
    ctx.strokeStyle = rgba(PAPER, 0.25);
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2 + 0.5, cy - 10 + 0.5, w, 20);
    // Fill for magnitude, coloured by sign.
    const mag = Math.min(1, Math.abs(state.wind) / WIND_MAX);
    const dir = state.wind >= 0 ? 1 : -1;
    const fillW = (w / 2 - 2) * mag;
    const fillC = dir > 0 ? MAGENTA : CYAN;
    ctx.fillStyle = rgba(fillC, 0.6);
    if (dir > 0) ctx.fillRect(cx + 1, cy - 8, fillW, 16);
    else         ctx.fillRect(cx - 1 - fillW, cy - 8, fillW, 16);
    // Zero line.
    ctx.strokeStyle = rgba(PAPER, 0.5);
    ctx.beginPath(); ctx.moveTo(cx + 0.5, cy - 10); ctx.lineTo(cx + 0.5, cy + 10); ctx.stroke();
    // Label.
    ctx.font = '600 9px "Chakra Petch", ui-monospace, monospace';
    ctx.fillStyle = rgba(PAPER, 0.55);
    ctx.textAlign = 'center';
    ctx.fillText('WIND', cx, cy - 14);
    // Arrow to reinforce direction.
    if (Math.abs(state.wind) > 0.002) {
      ctx.strokeStyle = rgba(fillC, 0.9);
      ctx.lineWidth = 1.4;
      const ax = cx + dir * (w / 2 + 12);
      const ay = cy;
      ctx.beginPath();
      ctx.moveTo(ax - dir * 8, ay - 4);
      ctx.lineTo(ax, ay);
      ctx.lineTo(ax - dir * 8, ay + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAmbient() {
    const t = state.time / 1000;
    ctx.save();
    for (const s of state.ambient) {
      const twinkle = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.6 + s.phase));
      ctx.fillStyle = rgba(s.hue, 0.35 * twinkle);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawRipples() {
    ctx.save();
    for (const r of state.ripples) {
      ctx.strokeStyle = rgba(r.color, 0.35 * r.life);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // Diagonal scanline — a slow CRT-like wipe across the arena.
  function drawScanline() {
    const t = state.time / 1000;
    const y = (t * 40) % (state.h + 80) - 40;
    const g = ctx.createLinearGradient(0, y - 10, 0, y + 30);
    g.addColorStop(0, rgba(CYAN, 0));
    g.addColorStop(0.5, rgba(CYAN, 0.05));
    g.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 10, state.w, 40);
  }

  function drawGrid() {
    // Very faint blueprint grid, denser near the foot of the range.
    ctx.save();
    const grid = 40;
    ctx.strokeStyle = rgba(PAPER, 0.05);
    ctx.lineWidth = 1;
    for (let x = grid; x < state.w; x += grid) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, state.h); ctx.stroke();
    }
    for (let y = grid; y < state.h; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(state.w, y + 0.5); ctx.stroke();
    }
    // Horizon line so the arena has a floor to reference.
    ctx.strokeStyle = rgba(CYAN, 0.22);
    ctx.beginPath(); ctx.moveTo(0, state.h - 60.5); ctx.lineTo(state.w, state.h - 60.5); ctx.stroke();
    ctx.restore();
  }

  function drawFloor() {
    // Soft glow at the foot — the range sits inside a bay of light.
    const g = ctx.createLinearGradient(0, state.h - 90, 0, state.h);
    g.addColorStop(0, rgba(INDIGO, 0.00));
    g.addColorStop(1, rgba(INDIGO, 0.14));
    ctx.fillStyle = g;
    ctx.fillRect(0, state.h - 90, state.w, 90);
  }

  function drawEmitter() {
    const { x, y, angle } = state.emitter;
    const t = state.time / 1000;
    ctx.save();
    ctx.translate(x, y);

    // Outer halo when charging — pulls the eye to the emitter.
    if (state.charging) {
      const glow = state.charge;
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 90);
      halo.addColorStop(0, rgba(CYAN, 0.25 * glow));
      halo.addColorStop(1, rgba(CYAN, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(-90, -90, 180, 180);
    }

    // Hex backplate — bigger, cleaner geometry.
    ctx.fillStyle = 'rgba(6, 8, 14, 0.92)';
    ctx.strokeStyle = rgba(CYAN, 0.6 + 0.3 * state.charge);
    ctx.lineWidth = 1.4;
    const hx = 32, hy = 22;
    ctx.beginPath();
    ctx.moveTo(-hx + 8, hy);
    ctx.lineTo(-hx, 0);
    ctx.lineTo(-hx + 8, -hy);
    ctx.lineTo( hx - 8, -hy);
    ctx.lineTo( hx, 0);
    ctx.lineTo( hx - 8, hy);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Segment marks on the chassis (three ticks per side, telegraphs "instrument").
    ctx.strokeStyle = rgba(CYAN, 0.28);
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-hx + 4, i * 7);
      ctx.lineTo(-hx + 10, i * 7);
      ctx.moveTo(hx - 4, i * 7);
      ctx.lineTo(hx - 10, i * 7);
      ctx.stroke();
    }

    // Core pip — grows and brightens with charge, pulses when idle.
    const pip = 5 + state.charge * 4 + (state.charging ? 0 : Math.sin(t * 2.4) * 0.6);
    ctx.fillStyle = rgba(CYAN, 0.4 + 0.55 * state.charge);
    ctx.beginPath(); ctx.arc(0, 0, pip, 0, Math.PI * 2); ctx.fill();
    // Inner white spark.
    ctx.fillStyle = rgba(PAPER, 0.5 + 0.4 * state.charge);
    ctx.beginPath(); ctx.arc(0, 0, 2 + state.charge * 1.6, 0, Math.PI * 2); ctx.fill();

    // Barrel — rotates with aim.
    ctx.rotate(state.emitter.angle);
    const bl = 56, bw = 10;
    // Two-tone body: dark base + cyan accent stripe.
    ctx.fillStyle = 'rgba(20, 26, 40, 0.95)';
    ctx.strokeStyle = rgba(CYAN, 0.8);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, -bw);
    ctx.lineTo(bl - 6, -bw);
    ctx.lineTo(bl, 0);
    ctx.lineTo(bl - 6, bw);
    ctx.lineTo(0, bw);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Accent stripe running the length.
    ctx.strokeStyle = rgba(CYAN, 0.45 + 0.4 * state.charge);
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(bl - 4, 0); ctx.stroke();

    // Muzzle glow — always a little, big when charging.
    const glow = state.charging ? 0.15 + state.charge * 0.85 : 0.35;
    const gr = ctx.createRadialGradient(bl, 0, 0, bl, 0, 28 + glow * 22);
    gr.addColorStop(0, rgba(CYAN, 0.9 * glow));
    gr.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(bl - 16, -28, 50, 56);

    ctx.restore();

    // Rail on the ground + label.
    ctx.save();
    ctx.strokeStyle = rgba(CYAN, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 48, y + 36); ctx.lineTo(x + 48, y + 36); ctx.stroke();
    // Tick marks on the rail.
    ctx.strokeStyle = rgba(CYAN, 0.35);
    for (let i = -3; i <= 3; i++) {
      const tx = x + i * 14;
      ctx.beginPath();
      ctx.moveTo(tx, y + 36); ctx.lineTo(tx, y + 40 + (i === 0 ? 3 : 0)); ctx.stroke();
    }
    ctx.font = '600 9px "Chakra Petch", ui-monospace, monospace';
    ctx.fillStyle = rgba(CYAN, 0.75);
    ctx.textAlign = 'center';
    ctx.fillText('EMITTER · 01', x, y + 54);
    // Small angle readout when actively aiming.
    if (state.charging || state.pointer.inside) {
      const deg = Math.round(state.emitter.angle * 180 / Math.PI);
      ctx.fillStyle = rgba(PAPER, 0.55);
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(`ANGLE ${-deg}°`, x, y + 66);
    }
    ctx.restore();
  }

  function drawNode() {
    const { x, y, ringR } = state.node;
    const [rOuter, rMid, rCore] = ringR;
    const t = state.time / 1000;
    ctx.save();

    // Time-to-move warning: last NODE_WARN_MS the node pulses magenta so the
    // visitor knows it's about to jump — that's the "hurry up" cue.
    const ageMs = state.time - state.node.bornAt;
    const warn = Math.max(0, ageMs - (NODE_TTL_MS - NODE_WARN_MS)) / NODE_WARN_MS;
    const warnPulse = warn > 0 ? 0.5 + 0.5 * Math.sin(t * 22) : 0;

    // Outer halo bloom — sells the "beacon" read.
    const halo = ctx.createRadialGradient(x, y, rCore * 0.4, x, y, rOuter + 28);
    if (warn > 0) {
      halo.addColorStop(0, rgba(MAGENTA, 0.35 * warnPulse));
      halo.addColorStop(0.6, rgba(MAGENTA, 0.14));
      halo.addColorStop(1, rgba(INDIGO, 0));
    } else {
      halo.addColorStop(0, rgba(CYAN, 0.22));
      halo.addColorStop(0.6, rgba(MAGENTA, 0.10));
      halo.addColorStop(1, rgba(INDIGO, 0));
    }
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, y, rOuter + 30, 0, Math.PI * 2); ctx.fill();

    // Outer ring — indigo, dashed so it reads as an aperture.
    ctx.strokeStyle = rgba(INDIGO, 0.9);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(x, y, rOuter, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // Middle — magenta, solid.
    ctx.strokeStyle = rgba(MAGENTA, 0.95);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, rMid, 0, Math.PI * 2); ctx.stroke();

    // Radar sweep — one arm rotating through the outer ring, the tell for
    // "this thing is alive and tracking".
    const sweepA = (t * 1.8) % (Math.PI * 2);
    const sweepGrad = ctx.createLinearGradient(
      x + Math.cos(sweepA - 0.6) * rOuter,
      y + Math.sin(sweepA - 0.6) * rOuter,
      x + Math.cos(sweepA) * rOuter,
      y + Math.sin(sweepA) * rOuter,
    );
    sweepGrad.addColorStop(0, rgba(CYAN, 0));
    sweepGrad.addColorStop(1, rgba(CYAN, 0.55));
    ctx.strokeStyle = sweepGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, rOuter - 4, sweepA - 0.6, sweepA);
    ctx.stroke();

    // Crosshair ticks at N/E/S/W of the outer ring.
    ctx.strokeStyle = rgba(INDIGO, 0.6);
    ctx.lineWidth = 1;
    const tick = 6;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const cx = x + Math.cos(a), cy = y + Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (rOuter - 4), y + Math.sin(a) * (rOuter - 4));
      ctx.lineTo(x + Math.cos(a) * (rOuter + tick), y + Math.sin(a) * (rOuter + tick));
      ctx.stroke();
    }

    // Core — cyan, pulsing, with white spark inside.
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3));
    ctx.fillStyle = rgba(CYAN, 0.85 * pulse);
    ctx.beginPath(); ctx.arc(x, y, rCore, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(PAPER, 0.75 * pulse);
    ctx.beginPath(); ctx.arc(x, y, rCore * 0.42, 0, Math.PI * 2); ctx.fill();

    // Corner brackets around the node — "targeting" chrome.
    const bs = rOuter + 14;    // bracket span from centre
    const bl = 10;             // bracket line length
    ctx.strokeStyle = rgba(CYAN, 0.7);
    ctx.lineWidth = 1;
    const brackets = [[-1,-1],[1,-1],[1,1],[-1,1]];
    for (const [sx, sy] of brackets) {
      const cx = x + sx * bs, cy = y + sy * bs;
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx - sx * bl, cy);
      ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - sy * bl);
      ctx.stroke();
    }

    // Coordinate readout.
    ctx.font = '600 9px "Chakra Petch", ui-monospace, monospace';
    ctx.fillStyle = rgba(PAPER, 0.6);
    ctx.textAlign = 'left';
    ctx.fillText(`NODE ${Math.round(x).toString().padStart(4,'0')} · ${Math.round(y).toString().padStart(4,'0')}`,
                 x + bs + 6, y + 3);
    ctx.restore();
  }

  function drawProjectile() {
    if (!state.projectile) return;
    const p = state.projectile;
    ctx.save();
    // Core dot.
    ctx.fillStyle = rgba(CYAN, 1);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill();
    // Bright halo.
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
    g.addColorStop(0, rgba(CYAN, 0.9));
    g.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = g;
    ctx.fillRect(p.x - 14, p.y - 14, 28, 28);
    ctx.restore();
  }

  function drawTrail() {
    if (state.trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < state.trail.length; i++) {
      const a = state.trail[i - 1], b = state.trail[i];
      const life = (i / state.trail.length);
      ctx.strokeStyle = rgba(CYAN, 0.55 * life);
      ctx.lineWidth = 1 + life * 2.6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawTrajectoryPreview() {
    // Only show the arc while charging — a coach line, not clutter.
    if (!state.charging || state.projectile) return;
    ctx.save();
    // Halved again — the coach line is now a whisper of dots. Enough to see
    // the arc while charging, quiet enough to disappear the moment you fire.
    ctx.setLineDash([0.5, 1.5]);
    ctx.strokeStyle = rgba(CYAN, 0.35);
    ctx.lineWidth = 1;
    const angle = state.emitter.angle;
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * state.charge;
    const barrelLen = 46;
    let px = state.emitter.x + Math.cos(angle) * barrelLen;
    let py = state.emitter.y + Math.sin(angle) * barrelLen;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let i = 0; i < 60; i++) {
      vy += GRAV;
      px += vx; py += vy;
      if (py > state.h - 4 || px > state.w + 20) break;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawBursts() {
    ctx.save();
    for (const b of state.bursts) {
      ctx.fillStyle = rgba(b.color, Math.max(0, b.life));
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size * b.life + 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawHitFlashes() {
    ctx.save();
    for (const f of state.hitFlashes) {
      const r = 20 + (1 - f.life) * 90;
      ctx.strokeStyle = rgba(f.color, 0.5 * f.life);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPop() {
    if (!state.lastPop) return;
    const p = state.lastPop;
    ctx.save();
    ctx.font = '600 13px "Chakra Petch", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba(p.color, p.life);
    ctx.fillText(p.text, p.x, p.y);
    ctx.restore();
  }

  return {
    destroy() {
      stopLoop();
      ro.disconnect();
      io.disconnect();
    },
  };
}

// ---- tiny colour helpers ---------------------------------------------------
function hex(h) {
  const s = String(h).trim().replace('#', '');
  const x = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  return {
    r: parseInt(x.slice(0, 2), 16),
    g: parseInt(x.slice(2, 4), 16),
    b: parseInt(x.slice(4, 6), 16),
  };
}
function rgba(c, a) { return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`; }

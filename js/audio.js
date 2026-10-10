/* ==========================================================================
   Site background audio.

   One <audio> element mounted at document root, plays /audio/tentative.mp3
   from the 25-second mark. When it reaches the end it seeks back to 25s and
   keeps going — the intro before 25s is never heard again.

   Plays by default; the pill mutes, and the choice persists in localStorage
   so it sticks page-to-page. Volume tops out at 0.091 — this is background,
   not a speaker demo.

   AUTOPLAY. Browsers refuse sound until the visitor has tapped, clicked or
   pressed a key — scrolling does not count. So the song starts silently and
   is brought up on the first real activation. Unmuting on anything else
   makes Chrome PAUSE the element, which is the "song stops by itself" bug
   this used to have (it listened for scroll/wheel/touchstart).

   BACKGROUND. On a phone, closing the browser or switching apps only hides
   the page, so the song kept playing. It now pauses whenever the page is
   hidden and picks up again when it comes back.

   VOLUME. iOS ignores HTMLMediaElement.volume entirely, so on iPhone/iPad
   the song played at full device volume and every fade was a no-op. Where
   volume is ignored, the element is routed through a Web Audio GainNode
   instead. Every level change goes through one fade that cancels the last,
   so ducking, the gain column and the loop seam cannot fight each other.

   Wired from public/js/site.js -> initAudio().
   ========================================================================== */

import { gainTick } from '/engineer2026/js/click-sfx.js?v=a6c965a';

const SRC = '/engineer2026/audio/tentative.mp3';
const START_AT = 25;              // seconds — skip the intro
// Full clip is 124.26s @ 256 kbps CBR / 44.1 kHz, so the effective loop
// window is START_AT..DURATION ≈ 99s of music per cycle.
const VOLUME = 0.091;             // −50% from 0.182, which was itself −25% from 0.243
const FADE_MS = 450;              // ramp at each loop boundary — hides the seam
const KEY = 'e26.audio.muted';    // localStorage flag (mute preference)
const LVL_KEY = 'e26.audio.level';// localStorage — gain column, 0..STEPS
const STEPS = 7;                  // segments in the gain column
const POS_KEY = 'e26.audio.pos';  // sessionStorage — carry playhead across pages
const GEST_KEY = 'e26.audio.gest';// sessionStorage — user has gestured this tab

// SVG icons — inline so no extra requests and they inherit currentColor.
const ICON_ON  = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06A7 7 0 0 1 19 12a7 7 0 0 1-5 6.71v2.06A9 9 0 0 0 21 12 9 9 0 0 0 14 3.23z"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.59 3L14 9.41 15.41 8 18 10.59 20.59 8 22 9.41 19.41 12 22 14.59 20.59 16 18 13.41 15.41 16 14 14.59 16.59 12z"/></svg>';

export function initAudio(whenReady) {
  // One instance per document — the nav partial is included on every page,
  // but each page load starts fresh, so a simple guard is enough.
  if (document.querySelector('audio[data-js="site-audio"]')) return;

  const audio = document.createElement('audio');
  audio.dataset.js = 'site-audio';
  audio.src = SRC;
  audio.preload = 'auto';
  audio.loop = false;                    // the seek-back is manual (below)
  audio.playsInline = true;
  document.body.appendChild(audio);

  // On a fresh tab we start at 25s. Within the same tab, we carry the
  // playhead across page navigations via sessionStorage so the music feels
  // continuous instead of restarting each time a link is followed. The
  // stored position is only ever inside the valid loop window.
  let carriedPos = NaN;
  try {
    const s = sessionStorage.getItem(POS_KEY);
    if (s) carriedPos = parseFloat(s);
  } catch (_) {}
  const seedStart = () => {
    try {
      const dur = audio.duration || Infinity;
      const target = (Number.isFinite(carriedPos) && carriedPos >= START_AT && carriedPos < dur - 1)
        ? carriedPos
        : START_AT;
      if (Math.abs(audio.currentTime - target) > 0.25) audio.currentTime = target;
    } catch (_) { /* Safari sometimes throws until it has enough buffered */ }
  };
  audio.addEventListener('loadedmetadata', seedStart);

  // Every 800ms, persist the playhead. On beforeunload, one last write —
  // the next page picks up where this one left off.
  const savePos = () => { try { sessionStorage.setItem(POS_KEY, String(audio.currentTime)); } catch (_) {} };
  setInterval(savePos, 800);
  window.addEventListener('beforeunload', savePos);
  window.addEventListener('pagehide', savePos);

  // Wait until 25s of buffer is decoded AND the caller says "go" before the
  // first play(). Fixes the audible lag right after the preloader: without
  // this we started play() during boot, the audio stalled while the browser
  // fetched, and the loop dropped its first ~half-second of samples the
  // moment the preloader removed itself.
  const canPlayReady = new Promise(resolve => {
    if (audio.readyState >= 3) return resolve();
    audio.addEventListener('canplaythrough', resolve, { once: true });
    audio.addEventListener('canplay', resolve, { once: true });
    // Hard fallback so a slow network can't stall forever.
    setTimeout(resolve, 4000);
  });
  const gateReady = Promise.all([canPlayReady, whenReady || Promise.resolve()]);

  // Small linear volume ramp — used at each loop boundary so the seam from
  // the last sample back to the 25s mark doesn't click. Held in a Web Audio
  // GainNode if available, but a manual ramp on audio.volume is enough here.
  // VOLUME is now the TOP of the range rather than a fixed value: the column
  // scales 0..VOLUME across STEPS, so full column == exactly what the site
  // played before the control existed. Nobody who never touches it hears a
  // difference.
  let level = STEPS;
  try {
    const st = parseInt(localStorage.getItem(LVL_KEY), 10);
    if (Number.isFinite(st) && st >= 0 && st <= STEPS) level = st;
  } catch (_) {}
  // Perceptual, not linear. Loudness follows roughly a square law, so a
  // linear column would put every useful setting in the bottom two segments
  // and waste the top five.
  const volFor = (n) => VOLUME * Math.pow(n / STEPS, 2);
  let userVol = volFor(level);
  // Set it on the element NOW, not at first play. The old code assigned
  // VOLUME at construction; moving the value behind the level calculation
  // left a window where the element sat at the default 1.0. It is muted
  // through that window so nothing is audible, but anything that unmuted
  // early would have gone out at full volume — not a gap worth leaving in
  // something that plays sound.
  audio.volume = userVol;
  // Ducking — while the visitor is actively engaging with the signal-range
  // game, the music drops to this fraction of userVol so the SFX and their
  // own concentration have room. Restored when they leave the arena.
  const DUCK_FACTOR = 0.32;
  let ducked = false;
  const effectiveVol = () => audio.muted ? 0 : (ducked ? userVol * DUCK_FACTOR : userVol);

  // iOS ignores element volume (it always reads back 1). Detected once; where
  // it is ignored, a GainNode carries the level instead. The graph can only
  // be built inside a user gesture (AudioContext rules), so ensureGraph() is
  // called from the gesture paths below.
  const VOLUME_WORKS = (() => { try { const a = new Audio(); a.volume = 0.5; return a.volume === 0.5; } catch (_) { return true; } })();
  let ctx = null;
  let gainNode = null;
  const ensureGraph = () => {
    if (VOLUME_WORKS || gainNode) { ctx?.resume?.().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      gainNode = ctx.createGain();
      gainNode.gain.value = audio.volume;
      ctx.createMediaElementSource(audio).connect(gainNode).connect(ctx.destination);
      audio.volume = 1;
      ctx.resume?.().catch(() => {});
    } catch (_) { ctx = null; gainNode = null; }
  };
  const getVol = () => (gainNode ? gainNode.gain.value : audio.volume);
  const setVolNow = (v) => {
    v = Math.max(0, Math.min(1, v));
    if (gainNode) gainNode.gain.value = v; else audio.volume = v;
  };
  // ONE fade at a time: a new one cancels whatever was running, so two
  // callers can never leave the level stepping back and forth.
  let fadeRaf = 0;
  const fadeTo = (to, ms = 0) => {
    cancelAnimationFrame(fadeRaf);
    const from = getVol();
    if (!ms || document.hidden) { setVolNow(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      setVolNow(from + (to - from) * p);
      if (p < 1) fadeRaf = requestAnimationFrame(step);
    };
    fadeRaf = requestAnimationFrame(step);
  };

  // The custom loop: instead of `audio.loop = true` (which restarts at 0 and
  // makes the intro audible every cycle), we watch the play head, fade out
  // just before the end, seek to 25s, and fade back in. That is the
  // "optimal snippet" — every cycle you hear is a 99s slice of music with a
  // hidden join.
  let loopingBack = false;
  const loopBack = () => {
    if (loopingBack) return;
    loopingBack = true;
    fadeTo(0, FADE_MS);
    setTimeout(() => {
      audio.currentTime = START_AT;
      const play = audio.play();
      const finish = () => {
        fadeTo(effectiveVol(), FADE_MS);
        loopingBack = false;
      };
      if (play && play.then) play.then(finish, finish); else finish();
    }, FADE_MS);
  };
  audio.addEventListener('ended', loopBack);
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    if (!loopingBack && audio.currentTime >= audio.duration - FADE_MS / 1000 - 0.02) {
      loopBack();
    } else if (audio.currentTime < START_AT - 1) {
      audio.currentTime = START_AT;
    }
  });

  // Default is UNMUTED — the site wants the music on; muting is the opt-out.
  const savedMuted = localStorage.getItem(KEY);
  const startMuted = savedMuted === '1';
  let intendedMuted = startMuted;
  audio.muted = true;                    // start silent so autoplay is allowed
  const tryPlay = () => audio.play().catch(() => {});
  const audible = () => !audio.paused && !audio.muted;

  // Activation events only. Scroll, wheel and touchstart are deliberately
  // absent: they are not user activation, so unmuting on them gets the
  // element paused. A tap ends in pointerup/touchend; a click, a key.
  const ACTIVATION = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click'];
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    for (const t of ACTIVATION) window.addEventListener(t, unlock, { capture: true, passive: true });
  };
  const disarm = () => {
    armed = false;
    for (const t of ACTIVATION) window.removeEventListener(t, unlock, true);
  };

  // Bring the song up with sound. Resolves true when it is actually audible;
  // on refusal it falls back to silent playback and stays armed for the next
  // activation rather than giving up.
  const startAudible = async () => {
    ensureGraph();
    audio.muted = false;
    setVolNow(0);
    try {
      await audio.play();
      if (ctx && ctx.state !== 'running') await ctx.resume();
      fadeTo(effectiveVol(), 400);
      disarm();
      return true;
    } catch (_) {
      audio.muted = true;
      setVolNow(effectiveVol());
      tryPlay();
      arm();
      return false;
    } finally {
      render();
    }
  };

  function unlock(e) {
    // The pill handles its own clicks.
    if (e && e.target && e.target.closest && e.target.closest('[data-js="audio-toggle"]')) return;
    // Where the browser can tell us, ignore events that did not activate.
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    try { sessionStorage.setItem(GEST_KEY, '1'); } catch (_) {}
    if (intendedMuted) { ensureGraph(); disarm(); return; }
    if (!audible()) startAudible();
    else disarm();
  }

  // First play waits for buffer + preloader (whenReady), which stops the
  // half-second stall after the wipe. Sound is tried first — it is allowed
  // wherever the browser already trusts the site — then silent + armed.
  gateReady.then(async () => {
    if (startMuted) { tryPlay(); arm(); return; }
    audio.muted = false;
    setVolNow(effectiveVol());
    try {
      await audio.play();
      render();
    } catch (_) {
      audio.muted = true;
      tryPlay();
      arm();
      render();
    }
  });

  // Hidden page (app switched, browser closed, tab backgrounded): pause, and
  // resume on return if it was playing. bfcache restores get the same.
  let resumeOnShow = false;
  const onHide = () => {
    if (!audio.paused) resumeOnShow = true;
    audio.pause();
    savePos();
  };
  const onShow = async () => {
    if (!resumeOnShow) return;
    resumeOnShow = false;
    if (intendedMuted) { tryPlay(); return; }
    try {
      if (ctx && ctx.state !== 'running') await ctx.resume();
      if (ctx && ctx.state !== 'running') throw new Error('suspended');
      await audio.play();
    } catch (_) {
      // Needs a fresh tap (iOS can insist): play silently until then.
      audio.muted = true;
      tryPlay();
      arm();
    }
    render();
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', (e) => { if (e.persisted) { resumeOnShow = true; onShow(); } });

  // Wire every button carrying data-js="audio-toggle".
  const buttons = [...document.querySelectorAll('[data-js="audio-toggle"]')];

  // The pill shows INTENT (on/off) and, separately, whether sound is really
  // coming out (is-live), so "on but waiting for a tap" never looks broken.
  let gainPaint = () => {};
  function render() {
    for (const b of buttons) {
      b.innerHTML = intendedMuted ? ICON_OFF : ICON_ON;
      b.setAttribute('aria-pressed', String(!intendedMuted));
      b.setAttribute('aria-label', intendedMuted ? 'Unmute background music' : 'Mute background music');
      b.title = intendedMuted ? 'Unmute music' : 'Mute music';
      b.classList.toggle('is-on', !intendedMuted);
      b.classList.toggle('is-live', !intendedMuted && audible());
    }
    gainPaint();
  }
  for (const ev of ['play', 'pause', 'volumechange']) audio.addEventListener(ev, render);
  render();

  for (const b of buttons) {
    b.addEventListener('click', async () => {
      try { sessionStorage.setItem(GEST_KEY, '1'); } catch (_) {}
      // On, but the browser has been holding it silent: this tap is the
      // permission it was waiting for — start the sound, do not mute.
      if (!intendedMuted && !audible()) { await startAudible(); return; }
      intendedMuted = !intendedMuted;
      localStorage.setItem(KEY, intendedMuted ? '1' : '0');
      if (intendedMuted) {
        fadeTo(0, 160);
        setTimeout(() => { if (intendedMuted) audio.muted = true; render(); }, 170);
      } else {
        await startAudible();
      }
      render();
    });
  }
  if (!buttons.length) return;

  /* ── THE GAIN COLUMN ──────────────────────────────────────────────────
     Seven emitter segments stacked above the pill. Click one to jump to it,
     drag through them to scrub, wheel to step, arrow keys when focused. The
     top lit segment breathes while the music is actually audible, so the
     control doubles as a "yes, this is playing" readout — the reason it is a
     meter shape and not a slider. */
  const gain = document.querySelector('[data-js="gain"]');
  const dock = document.querySelector('[data-js="audio-dock"]');
  if (gain && dock) {
    const segs = [...gain.querySelectorAll('.gain__seg')];
    const readout = gain.querySelector('[data-js="gain-readout"]');

    const paintGain = () => {
      for (const s of segs) {
        const n = Number(s.dataset.seg);
        s.classList.toggle('is-lit', n <= level);
        // Only the highest lit segment breathes — a whole column pulsing
        // reads as an error state, one tip reads as a live signal.
        s.classList.toggle('is-tip', n === level && level > 0);
      }
      const pct = Math.round((level / STEPS) * 100);
      if (readout) readout.textContent = String(pct);
      gain.setAttribute('aria-valuenow', String(level));
      gain.setAttribute('aria-valuetext', pct + '%');
      gain.classList.toggle('is-zero', level === 0);
      // Live only when it can actually be heard.
      gain.classList.toggle('is-live', !audio.muted && !audio.paused && level > 0);
    };

    const setLevel = (n, { silent = false } = {}) => {
      n = Math.max(0, Math.min(STEPS, Math.round(n)));
      if (n === level) return;
      level = n;
      userVol = volFor(level);
      try { localStorage.setItem(LVL_KEY, String(level)); } catch (_) {}
      if (!audio.muted && !loopingBack) fadeTo(effectiveVol(), silent ? 0 : 120);
      // Tick at the new level. It carries the setting as sound, so the column
      // works before the browser's autoplay gate has let the music through —
      // you can still hear what you are choosing. The site mute button
      // silences this too: one switch owns every sound the site makes.
      if (!silent) gainTick(level, STEPS);
      paintGain();
    };

    // Which segment is under this Y? Measured off the stack, so it keeps
    // working when the column is mid-transition or the layout changes.
    const levelAtY = (clientY) => {
      const stack = gain.querySelector('.gain__stack').getBoundingClientRect();
      const t = 1 - (clientY - stack.top) / stack.height;      // bottom-up
      // ceil, not round: anywhere inside segment n selects n. Rounding put
      // the boundary through the middle of each segment, so clicking the
      // centre of one landed on its neighbour half the time. Below the
      // bottom segment is zero.
      if (t <= 0) return 0;
      return Math.min(STEPS, Math.ceil(t * STEPS));
    };

    // STICKY OPEN. Hover alone was too fragile: the column is a narrow
    // strip, and drifting a few pixels off it mid-drag (or letting go just
    // outside it) shut it under the hand, with no way back short of
    // re-hovering the pill. Once opened it now stays open until the pointer
    // has been away for a beat, or the visitor clicks elsewhere / presses
    // Escape. CSS still opens it instantly on hover and on keyboard focus.
    let dragging = false;
    let closeTimer = 0;
    const openGain = () => { clearTimeout(closeTimer); dock.classList.add('is-open'); };
    const closeGain = () => { clearTimeout(closeTimer); dock.classList.remove('is-open'); };
    const scheduleClose = (ms = 1200) => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (dragging || dock.matches(':hover') || dock.matches(':focus-within')) return;
        closeGain();
      }, ms);
    };
    dock.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') openGain(); });
    dock.addEventListener('pointerleave', () => scheduleClose());
    document.addEventListener('pointerdown', (e) => {
      if (!dock.contains(e.target)) closeGain();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dock.classList.contains('is-open')) { closeGain(); gain.blur(); }
    });

    gain.addEventListener('pointerdown', (e) => {
      openGain();
      dragging = true;
      gain.setPointerCapture(e.pointerId);
      gain.classList.add('is-dragging');
      setLevel(levelAtY(e.clientY));
      e.preventDefault();
    });
    gain.addEventListener('pointermove', (e) => { if (dragging) setLevel(levelAtY(e.clientY)); });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      gain.classList.remove('is-dragging');
      try { gain.releasePointerCapture(e.pointerId); } catch (_) {}
      // Let go outside the dock: the column waits for the pointer to come
      // back instead of vanishing on release.
      scheduleClose(1600);
    };
    gain.addEventListener('pointerup', endDrag);
    gain.addEventListener('pointercancel', endDrag);

    // Wheel, but only once the pointer has actually MOVED inside the dock.
    // The column opens on hover, and a cursor left parked in the bottom-right
    // corner opens it without anyone asking — at which point scrolling the
    // page would quietly change the music volume. A parked cursor generates
    // no pointermove, so this tells "reaching for the control" apart from
    // "happens to be resting on it".
    let engaged = false;
    dock.addEventListener('pointermove', () => { engaged = true; });
    dock.addEventListener('pointerleave', () => { engaged = false; });
    gain.addEventListener('wheel', (e) => {
      if (!engaged) return;
      e.preventDefault();
      openGain();
      setLevel(level + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });

    gain.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowRight') { setLevel(level + 1); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 'ArrowLeft') { setLevel(level - 1); e.preventDefault(); }
      else if (k === 'Home') { setLevel(0); e.preventDefault(); }
      else if (k === 'End') { setLevel(STEPS); e.preventDefault(); }
    });

    // Keep the live tip honest about what is actually coming out (render()
    // calls this on every play / pause / volume change).
    gainPaint = paintGain;
    paintGain();
  }

  // Duck / restore — driven by whichever surface on the page wants the
  // music quieter for a beat. The signal-range game fires these when the
  // pointer enters and leaves its arena. Anything else can too.
  const duck = () => {
    if (ducked) return;
    ducked = true;
    if (audio.muted) return;
    fadeTo(effectiveVol(), 220);
  };
  const restore = () => {
    if (!ducked) return;
    ducked = false;
    if (audio.muted) return;
    fadeTo(effectiveVol(), 260);
  };
  document.addEventListener('e26:music:duck', duck);
  document.addEventListener('e26:music:restore', restore);

}

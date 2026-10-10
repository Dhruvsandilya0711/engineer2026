/* ==========================================================================
   Site background audio.

   One <audio> element mounted at document root, plays /audio/tentative.mp3
   from the 25-second mark. When it reaches the end it seeks back to 25s and
   keeps going — the intro before 25s is never heard again.

   Plays by default; the pill mutes, and the choice persists in localStorage
   so it sticks page-to-page. Volume tops out at 0.091 — this is background,
   not a speaker demo.

   ONE RULE: the music only ever makes sound when the visitor wants it on
   (the pill), the page is in front of them, and it is not being left. Every
   path that could start it — the first autoplay attempt, a tap, coming back
   to the tab, the loop seam, lock-screen controls — goes through shouldPlay(),
   and a watchdog pauses anything that slips past while the page is hidden.

   AUTOPLAY. Browsers refuse sound until the visitor has tapped, clicked or
   pressed a key — scrolling does not count — and Safari asks again on every
   page. So each page tries to start on its own (Chrome allows that once the
   site has been interacted with), and otherwise starts on the first real tap
   anywhere, with a small "tap for sound" hint by the pill until then. A tap
   on a link is left alone: the next page starts the music, rather than this
   one playing half a second of it before the navigation cuts it off.

   BACKGROUND. Minimising the browser, switching apps or tabs, locking the
   phone or the page being frozen all pause it at once (visibilitychange,
   pagehide, freeze, and window blur on touch devices, which some phones
   send when the visibility event is late). It picks up again on return.

   NAVIGATION. A page transition fades the music out (e26:music:leave), the
   playhead is carried in sessionStorage, and the next page fades back in
   from the same spot.

   VOLUME. iOS ignores HTMLMediaElement.volume entirely, so on iPhone/iPad
   the song played at full device volume and every fade was a no-op. Where
   volume is ignored, the element is routed through a Web Audio GainNode
   instead. Every level change goes through one fade that cancels the last,
   so ducking, the gain column and the loop seam cannot fight each other.

   Wired from public/js/site.js -> initAudio().
   ========================================================================== */

import { gainTick } from '/engineer2026/js/click-sfx.js?v=0af0bc4';

const SRC = '/engineer2026/audio/tentative.mp3';
const START_AT = 25;              // seconds — skip the intro
// Full clip is 124.26s @ 256 kbps CBR / 44.1 kHz, so the effective loop
// window is START_AT..DURATION ≈ 99s of music per cycle.
const VOLUME = 0.091;             // −50% from 0.182, which was itself −25% from 0.243
const FADE_MS = 450;              // ramp at each loop boundary — hides the seam
const FADE_IN_MS = 900;           // coming up: first start, a tap, coming back
const FADE_OUT_MS = 220;          // going down: muting
const LEAVE_MS = 380;             // going down: a page transition (covers in 500)
const KEY = 'e26.audio.muted';    // localStorage flag (mute preference)
const LVL_KEY = 'e26.audio.level';// localStorage — gain column, 0..STEPS
const STEPS = 7;                  // segments in the gain column
const POS_KEY = 'e26.audio.pos';  // sessionStorage — carry playhead across pages
const TOUCH = window.matchMedia('(hover: none), (pointer: coarse)').matches;

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

  /* ── PLAYHEAD ACROSS PAGES ────────────────────────────────────────────
     A fresh tab starts at 25s; within a tab the playhead is carried across
     navigations so the music continues instead of restarting. Only a
     position inside the loop window is ever saved: before the stored spot
     has been seeked to, the element reads 0, and saving that is what used to
     send the song back to the start after a slow page load. */
  let carriedPos = NaN;
  try {
    const s = sessionStorage.getItem(POS_KEY);
    if (s) carriedPos = parseFloat(s);
  } catch (_) {}
  let seeded = false;
  const seedStart = () => {
    try {
      const dur = audio.duration || Infinity;
      const target = (Number.isFinite(carriedPos) && carriedPos >= START_AT && carriedPos < dur - 1)
        ? carriedPos
        : START_AT;
      if (Math.abs(audio.currentTime - target) > 0.25) audio.currentTime = target;
      seeded = true;
    } catch (_) { /* Safari sometimes throws until it has enough buffered */ }
  };
  audio.addEventListener('loadedmetadata', seedStart);
  const savePos = () => {
    if (!seeded || !(audio.currentTime >= START_AT)) return;
    try { sessionStorage.setItem(POS_KEY, String(audio.currentTime)); } catch (_) {}
  };
  setInterval(savePos, 800);
  window.addEventListener('beforeunload', savePos);

  // The first autoplay attempt waits until the track can play AND the caller
  // says "go" (the homepage passes the preloader's promise). Without this,
  // play() started during boot stalled while the browser fetched, and the
  // loop dropped its first half-second the moment the preloader lifted. A
  // tap does not wait for it: a tap is a request, and Safari only honours
  // play() called inside the tap itself.
  const canPlayReady = new Promise(resolve => {
    if (audio.readyState >= 3) return resolve();
    audio.addEventListener('canplaythrough', resolve, { once: true });
    audio.addEventListener('canplay', resolve, { once: true });
    // Hard fallback so a slow network (or iOS, which ignores preload) can't
    // stall forever.
    setTimeout(resolve, 4000);
  });
  const gateReady = Promise.all([canPlayReady, whenReady || Promise.resolve()]);

  /* ── LEVEL ────────────────────────────────────────────────────────────
     VOLUME is the TOP of the range: the column scales 0..VOLUME across
     STEPS, so a full column is exactly what the site played before the
     control existed. */
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
  // Ducking — while the visitor is playing the signal-range game, the music
  // drops to this fraction so the SFX and their concentration have room.
  const DUCK_FACTOR = 0.32;
  let ducked = false;
  const effectiveVol = () => (ducked ? userVol * DUCK_FACTOR : userVol);

  // iOS ignores element volume (it always reads back 1). Detected once; where
  // it is ignored, a GainNode carries the level instead. The graph can only
  // be started inside a user gesture (AudioContext rules), so ensureGraph()
  // is called from the gesture paths below.
  const VOLUME_WORKS = (() => { try { const a = new Audio(); a.volume = 0.5; return a.volume === 0.5; } catch (_) { return true; } })();
  let ctx = null;
  let gainNode = null;
  const ensureGraph = () => {
    if (VOLUME_WORKS || gainNode) { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      ctx.createMediaElementSource(audio).connect(gainNode).connect(ctx.destination);
      audio.volume = 1;
      ctx.resume().catch(() => {});
    } catch (_) { ctx = null; gainNode = null; }
  };
  const getVol = () => (gainNode ? gainNode.gain.value : audio.volume);
  const setVolNow = (v) => {
    v = Math.max(0, Math.min(1, v));
    if (gainNode) gainNode.gain.value = v; else audio.volume = v;
  };
  audio.volume = VOLUME_WORKS ? 0 : 1;   // silent until a start fades it up

  // ONE fade at a time: a new one cancels whatever was running, so two
  // callers can never leave the level stepping back and forth. A hidden page
  // gets no animation frames, so there the level is set at once.
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

  /* ── WHEN SOUND IS ALLOWED ────────────────────────────────────────── */
  let wantOn = (() => { try { return localStorage.getItem(KEY) !== '1'; } catch (_) { return true; } })();
  let gateOpen = false;      // the first autoplay attempt may be made
  let leaving = false;       // a page transition is fading us out
  let blurred = false;       // touch only: the browser has been switched away
  let pending = null;        // a start in flight

  const visible = () => document.visibilityState === 'visible' && !blurred;
  const shouldPlay = () => wantOn && visible() && !leaving;

  // Lock-screen / notification controls report what the page is doing.
  const ms = navigator.mediaSession;
  const setSession = (state) => { try { if (ms) ms.playbackState = state; } catch (_) {} };

  // Hard stop: hidden, frozen, gone. No fade — nothing should be heard from
  // a page nobody is looking at — and the Web Audio graph is suspended too.
  const stopNow = () => {
    cancelAnimationFrame(fadeRaf);
    clearTimeout(pauseTimer);
    setVolNow(0);
    if (!audio.paused) audio.pause();
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    savePos();
    setSession('paused');
    render();
  };

  // Soft stop: muted or leaving. The pause is on a timer, not the end of
  // the fade, because a hidden page gets no animation frames to finish it.
  let pauseTimer = 0;
  const fadeOutAndPause = (msDur = FADE_OUT_MS) => {
    clearTimeout(pauseTimer);
    if (audio.paused) { render(); return; }
    fadeTo(0, msDur);
    pauseTimer = setTimeout(() => {
      if (!shouldPlay()) { audio.pause(); setSession('paused'); }
      render();
    }, msDur + 30);
  };

  // Bring the music up with sound. play() is called synchronously, so when
  // this runs inside a tap Safari counts it as that tap's. Resolves true
  // once it is actually audible; on refusal it waits for the next tap.
  const startSound = (fadeMs = FADE_IN_MS) => {
    if (!shouldPlay()) return Promise.resolve(false);
    if (pending) return pending;
    clearTimeout(pauseTimer);
    audio.muted = false;
    if (audio.paused) setVolNow(0);
    let p;
    try { p = audio.play(); } catch (e) { p = Promise.reject(e); }
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    pending = Promise.resolve(p).then(async () => {
      if (ctx && ctx.state !== 'running') await ctx.resume();
      if (ctx && ctx.state !== 'running') throw new Error('audio context suspended');
      // The page may have been hidden or muted while play() was pending.
      if (!shouldPlay()) { visible() ? fadeOutAndPause() : stopNow(); return false; }
      disarm();
      fadeTo(effectiveVol(), fadeMs);
      setSession('playing');
      return true;
    }).catch(() => {
      if (!audio.paused) audio.pause();
      setVolNow(0);
      arm();
      return false;
    }).finally(() => { pending = null; render(); });
    return pending;
  };

  // Work out what the element should be doing now, and do it.
  const sync = () => {
    if (!visible()) { stopNow(); return; }
    if (!wantOn || leaving) { fadeOutAndPause(leaving ? LEAVE_MS : FADE_OUT_MS); return; }
    if (!audio.paused && !pending) { if (!loopingBack) fadeTo(effectiveVol(), 300); render(); return; }
    if (gateOpen || everStarted) startSound();
    else render();
  };
  let everStarted = false;
  audio.addEventListener('playing', () => { everStarted = true; });

  /* ── THE LOOP ─────────────────────────────────────────────────────────
     Instead of `audio.loop` (which restarts at 0 and replays the intro), the
     playhead is watched: fade out just before the end, seek to 25s, fade
     back in. The seek is on a timer, so it still happens on a hidden page —
     and it never restarts playback unless shouldPlay() says so. */
  let loopingBack = false;
  const loopBack = () => {
    if (loopingBack) return;
    loopingBack = true;
    fadeTo(0, FADE_MS);
    setTimeout(() => {
      try { audio.currentTime = START_AT; } catch (_) {}
      loopingBack = false;
      if (!shouldPlay()) { if (!audio.paused) audio.pause(); render(); return; }
      const p = audio.paused ? audio.play() : null;
      Promise.resolve(p).then(() => fadeTo(effectiveVol(), FADE_MS), () => { arm(); render(); });
    }, FADE_MS);
  };
  audio.addEventListener('ended', loopBack);
  audio.addEventListener('timeupdate', () => {
    // Watchdog: whatever started it, nothing plays behind a hidden page.
    if (!visible() && !audio.paused) { stopNow(); return; }
    if (!audio.duration) return;
    if (!loopingBack && audio.currentTime >= audio.duration - FADE_MS / 1000 - 0.02) {
      loopBack();
    } else if (audio.currentTime < START_AT - 1 && seeded) {
      audio.currentTime = START_AT;
    }
  });
  audio.addEventListener('play', () => { if (!visible()) stopNow(); });

  /* ── TAPS ─────────────────────────────────────────────────────────────
     Activation events only. Scroll, wheel and touchstart are not user
     activation, and starting sound on them gets the element paused. A tap
     ends in pointerup/touchend; a click, a key. Armed from the start, so a
     tap that lands before the first autoplay attempt still counts. */
  const ACTIVATION = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click'];
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    for (const t of ACTIVATION) window.addEventListener(t, onActivation, { capture: true, passive: true });
  };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const t of ACTIVATION) window.removeEventListener(t, onActivation, true);
  };

  // A plain click on a same-site link that leaves this page.
  const isNavigation = (e, el) => {
    const a = el.closest && el.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    try {
      const u = new URL(a.href, location.href);
      return u.origin === location.origin && (u.pathname !== location.pathname || u.search !== location.search);
    } catch (_) { return false; }
  };

  function onActivation(e) {
    const el = e.target;
    if (el && el.closest && el.closest('[data-js="audio-toggle"]')) return;   // the pill decides
    // Where the browser can tell us, ignore events that did not activate.
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    blurred = false;                       // a tap means the page is in front
    if (!wantOn) { disarm(); return; }
    // Leaving this page: let the next one start the music instead of
    // playing a moment of it here and cutting it off.
    if (el && isNavigation(e, el)) return;
    ensureGraph();
    startSound();
  }

  /* ── THE PILL ──────────────────────────────────────────────────────── */
  const buttons = [...document.querySelectorAll('[data-js="audio-toggle"]')];
  const dockEl = document.querySelector('[data-js="audio-dock"]');

  // The "tap for sound" hint: shown by the pill only while the music is on
  // but the browser is still holding it silent, so a quiet page never looks
  // broken. It goes the moment sound comes out.
  let hint = null;
  if (dockEl) {
    hint = document.createElement('span');
    hint.className = 'audio-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = TOUCH ? 'Tap for sound' : 'Click for sound';
    dockEl.appendChild(hint);
  }

  // The pill shows INTENT (on/off) and, separately, whether sound is really
  // coming out (is-live), so "on but waiting for a tap" never looks broken.
  let gainPaint = () => {};
  function render() {
    const live = wantOn && !audio.paused && (!ctx || ctx.state === 'running');
    for (const b of buttons) {
      b.innerHTML = wantOn ? ICON_ON : ICON_OFF;
      b.setAttribute('aria-pressed', String(wantOn));
      b.setAttribute('aria-label', wantOn ? 'Mute background music' : 'Unmute background music');
      b.title = wantOn ? 'Mute music' : 'Unmute music';
      b.classList.toggle('is-on', wantOn);
      b.classList.toggle('is-live', live);
    }
    if (dockEl) dockEl.classList.toggle('is-waiting', wantOn && gateOpen && visible() && !leaving && !live && !pending);
    gainPaint();
  }
  for (const ev of ['play', 'pause', 'volumechange']) audio.addEventListener(ev, render);

  const setWant = (on, { persist = true } = {}) => {
    wantOn = on;
    if (persist) { try { localStorage.setItem(KEY, on ? '0' : '1'); } catch (_) {} }
    if (on) { ensureGraph(); arm(); startSound(); }
    else { disarm(); fadeOutAndPause(160); }
    render();
  };

  for (const b of buttons) {
    b.addEventListener('click', () => {
      blurred = false;
      // On, but the browser has been holding it silent: this tap is the
      // permission it was waiting for — start the sound, do not mute.
      if (wantOn && audio.paused) { ensureGraph(); startSound(); return; }
      setWant(!wantOn);
    });
  }

  // Lock-screen, notification and headphone controls. A pause from there is
  // for this visit only; it does not overwrite the visitor's own choice.
  if (ms) {
    try {
      ms.setActionHandler('play', () => { if (visible()) setWant(true, { persist: false }); });
      ms.setActionHandler('pause', () => setWant(false, { persist: false }));
      ms.setActionHandler('stop', () => setWant(false, { persist: false }));
    } catch (_) {}
  }

  /* ── PAGE LIFECYCLE ───────────────────────────────────────────────────
     Every way a page can stop being in front of someone stops the music:
     a hidden tab or minimised browser (visibilitychange), navigating away
     or into the back/forward cache (pagehide), being frozen by the browser
     (freeze), and on touch devices the window losing focus — some phones
     report that before, or instead of, the visibility change. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') blurred = false;
    sync();
  });
  window.addEventListener('pagehide', stopNow);
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    leaving = false;
    blurred = false;
    sync();
  });
  document.addEventListener('freeze', stopNow);
  document.addEventListener('resume', sync);
  if (TOUCH) {
    window.addEventListener('blur', () => { blurred = true; sync(); });
    window.addEventListener('focus', () => { if (blurred) { blurred = false; sync(); } });
  }

  // A page transition is about to navigate (public/js/page-transition.js).
  let leaveTimer = 0;
  document.addEventListener('e26:music:leave', () => {
    leaving = true;
    sync();
    // If the navigation never happens, do not stay silent forever.
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { if (leaving) { leaving = false; sync(); } }, 8000);
  });

  // First autoplay attempt, once the track is buffered and the preloader
  // (homepage) has finished. Refused? Then the first tap anywhere starts it.
  if (wantOn) arm();
  gateReady.then(() => { gateOpen = true; sync(); });
  render();

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
      gain.classList.toggle('is-live', wantOn && !audio.paused && level > 0);
    };

    const setLevel = (n, { silent = false } = {}) => {
      n = Math.max(0, Math.min(STEPS, Math.round(n)));
      if (n === level) return;
      level = n;
      userVol = volFor(level);
      try { localStorage.setItem(LVL_KEY, String(level)); } catch (_) {}
      if (!audio.paused && wantOn && !leaving && !loopingBack) fadeTo(effectiveVol(), silent ? 0 : 120);
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
  // music quieter for a beat. The signal-range game fires these while a run
  // is being played. Anything else can too.
  const duck = () => {
    if (ducked) return;
    ducked = true;
    if (!audio.paused && wantOn && !leaving && !loopingBack) fadeTo(effectiveVol(), 220);
  };
  const restore = () => {
    if (!ducked) return;
    ducked = false;
    if (!audio.paused && wantOn && !leaving && !loopingBack) fadeTo(effectiveVol(), 260);
  };
  document.addEventListener('e26:music:duck', duck);
  document.addEventListener('e26:music:restore', restore);
}

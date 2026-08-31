/* ==========================================================================
   Site background audio.

   One <audio> element mounted at document root, plays /audio/tentative.mp3
   from the 25-second mark. When it reaches the end it seeks back to 25s and
   keeps going — the intro before 25s is never heard again.

   Muted by default (browser autoplay policies + politeness). The user opts
   in with the header button; the choice persists in localStorage so it
   sticks page-to-page. Volume held at 0.28 — this is background, not a
   speaker demo.

   Wired from public/js/site.js -> initAudio().
   ========================================================================== */

const SRC = '/audio/tentative.mp3';
const START_AT = 25;              // seconds — skip the intro
// Full clip is 124.26s @ 256 kbps CBR / 44.1 kHz, so the effective loop
// window is START_AT..DURATION ≈ 99s of music per cycle.
const VOLUME = 0.243;             // quiet, sits under the site chrome
const FADE_MS = 450;              // ramp at each loop boundary — hides the seam
const KEY = 'e26.audio.muted';    // localStorage flag (mute preference)
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
  audio.volume = VOLUME;
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
  let userVol = VOLUME;
  // Ducking — while the visitor is actively engaging with the signal-range
  // game, the music drops to this fraction of userVol so the SFX and their
  // own concentration have room. Restored when they leave the arena.
  const DUCK_FACTOR = 0.32;
  let ducked = false;
  const effectiveVol = () => audio.muted ? 0 : (ducked ? userVol * DUCK_FACTOR : userVol);
  const rampVolume = (from, to, ms) => {
    const steps = Math.max(1, Math.round(ms / 16));
    let i = 0;
    const iv = setInterval(() => {
      i++;
      audio.volume = from + (to - from) * (i / steps);
      if (i >= steps) { clearInterval(iv); audio.volume = to; }
    }, 16);
    return () => clearInterval(iv);
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
    rampVolume(audio.volume, 0, FADE_MS);
    setTimeout(() => {
      audio.currentTime = START_AT;
      const play = audio.play();
      const finish = () => {
        rampVolume(0, effectiveVol(), FADE_MS);
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
  // First-ever page load on a fresh tab still needs a user gesture (browser
  // policy — no way around it), but once ANY interaction has happened in
  // this tab we mark sessionStorage and every subsequent navigation plays
  // audibly from the start.
  const savedMuted = localStorage.getItem(KEY);
  const startMuted = savedMuted === '1';
  let hasGesture = false;
  try { hasGesture = sessionStorage.getItem(GEST_KEY) === '1'; } catch (_) {}
  audio.muted = true;                    // start silent so autoplay is allowed
  const tryPlay = () => audio.play().catch(() => {});
  // Wait for buffer + preloader (whenReady) before the first play — this is
  // what stops the audible half-second stall after the preloader wipe.
  gateReady.then(async () => {
    if (startMuted) { tryPlay(); return; }
    // Attempt UNMUTED autoplay first — this succeeds on any domain the
    // browser has already granted autoplay privilege to (localhost, and
    // production once Media Engagement Index has built up), and on same-tab
    // navigations after any prior gesture. If the browser refuses, we
    // silently fall back to muted playback and wait for a natural gesture
    // (scroll, wheel, touch — see below).
    audio.muted = false;
    audio.volume = userVol;
    try {
      await audio.play();
    } catch (_) {
      audio.muted = true;
      audio.volume = VOLUME;
      tryPlay();
    }
  });

  // Wire every button carrying data-js="audio-toggle" — the nav partial
  // ships one, but we'll upgrade any that appear (e.g. the mobile drawer).
  const buttons = [...document.querySelectorAll('[data-js="audio-toggle"]')];
  if (!buttons.length) return;

  // The button reflects INTENT, not the momentary silent-autoplay state.
  // Until the first user gesture, `audio.muted` is forced to true so the
  // browser will let it play; the button already shows the state we're
  // heading toward.
  let intendedMuted = startMuted;
  const render = () => {
    for (const b of buttons) {
      b.innerHTML = intendedMuted ? ICON_OFF : ICON_ON;
      b.setAttribute('aria-pressed', String(!intendedMuted));
      b.setAttribute('aria-label', intendedMuted ? 'Unmute background music' : 'Mute background music');
      b.title = intendedMuted ? 'Unmute music' : 'Mute music';
      b.classList.toggle('is-on', !intendedMuted);
    }
  };
  render();

  // If the user had previously unmuted, unmute on the first interaction that
  // ISN'T the audio button itself — that gesture satisfies the browser's
  // audible autoplay policy. Ignoring the button avoids a race where the
  // user clicks it expecting a state change and lands back where they
  // started.
  // Catch the first NATURAL gesture — not just a click. Browsers count
  // pointerdown / keydown / wheel / touchstart / mousedown as activating
  // gestures, and every visitor does one of those within a second or two
  // (they scroll). `mousemove` alone does NOT count and is not listened to.
  // The audio button itself is excluded so its own click doesn't race.
  const GESTURE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousedown', 'click', 'scroll'];
  const firstGesture = (e) => {
    if (e && e.target && e.target.closest && e.target.closest('[data-js="audio-toggle"]')) return;
    hasGesture = true;
    try { sessionStorage.setItem(GEST_KEY, '1'); } catch (_) {}
    if (!intendedMuted && audio.muted) {
      audio.muted = false;
      audio.volume = userVol;
      tryPlay();
      render();
    }
    for (const t of GESTURE_EVENTS) window.removeEventListener(t, firstGesture, true);
  };
  for (const t of GESTURE_EVENTS) window.addEventListener(t, firstGesture, { capture: true, passive: true });

  for (const b of buttons) {
    b.addEventListener('click', () => {
      intendedMuted = !intendedMuted;
      audio.muted = intendedMuted;
      localStorage.setItem(KEY, intendedMuted ? '1' : '0');
      if (intendedMuted) audio.volume = 0;
      else rampVolume(0, effectiveVol(), 200);
      tryPlay();
      render();
    });
  }

  // Duck / restore — driven by whichever surface on the page wants the
  // music quieter for a beat. The signal-range game fires these when the
  // pointer enters and leaves its arena. Anything else can too.
  const duck = () => {
    if (ducked) return;
    ducked = true;
    if (audio.muted) return;
    rampVolume(audio.volume, effectiveVol(), 220);
  };
  const restore = () => {
    if (!ducked) return;
    ducked = false;
    if (audio.muted) return;
    rampVolume(audio.volume, effectiveVol(), 260);
  };
  document.addEventListener('e26:music:duck', duck);
  document.addEventListener('e26:music:restore', restore);

}

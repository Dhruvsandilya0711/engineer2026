// ==========================================================================
// PRELOADER — boot sequence.
//
// Ported from the reference implementation
// (design_handoff / "Engineer26 Preloader.dc.html", class Component).
// Timings, easing, hash function, shard maths and band stagger all match that
// source; only the framework differs.
//
//   LOAD   0 → L              progress with stutter, micro-glitches
//   BURST  L → L+0.45         pct locked 100, full shard displacement
//   WIPE   L+0.45 → L+1.05    nine bands collapse, content fades
//   DONE   > L+1.05 + 0.25    overlay removed, rAF stops
//
// L defaults to 2.0s (the reference's `loadDuration`). Real asset readiness
// can only ever make it LONGER, never shorter, so the sequence always plays
// at its designed pace instead of flashing past on a warm cache — and a hard
// cap means it can never hang waiting on a slow asset.
//
// Randomness is a deterministic hash of a 20fps-quantised frame index, not
// Math.random(): quantising gives the digital, non-smooth feel and determinism
// keeps it reproducible.
// ==========================================================================

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The chroma-split colour on the torn slivers. Read from the palette once here
// rather than written as a literal in the frame loop: the boot sequence is the
// first thing anyone sees, so it being the one screen still lit by the old
// palette was the most visible leak of the lot.
const CHROMA = 'rgba(' +
  (getComputedStyle(document.documentElement).getPropertyValue('--rgb-cyan').trim() || '31, 182, 173') +
  ', 0.95)';

const LOAD_DEFAULT = 2.0;   // reference default
const LOAD_MAX = 4.0;       // never hang
const BURST = 0.45;
const WIPE = 0.60;
const TAIL = 0.25;

// Shard geometry — clip + base horizontal offset, per the reference.
const SHARD_BASE = [16, 0, -12];

// Reference hash: Math.sin(n * 127.1 + 0.7) * 43758.5453
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 0.7) * 43758.5453;
  return x - Math.floor(x);
};
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function initPreloader() {
  const el = document.getElementById('preloader');
  if (!el) return Promise.resolve();

  const finish = () => {
    el.remove();
    document.documentElement.classList.remove('pl-locked');
  };

  let seen = false;
  try { seen = sessionStorage.getItem('engi26.loaded') === '1'; } catch { /* private mode */ }

  // The hero's entrance (see _hero.ejs) starts the moment the shutter
  // opens, so the page is already assembling as the bands collapse off it.
  const heroGo = () => {
    const html = document.documentElement;
    if (html.classList.contains('hero-go')) return;
    window.__heroGoAt = performance.now();
    html.classList.add('hero-go');
  };

  if (seen || REDUCED_MOTION) {
    heroGo();
    el.classList.add('is-instant');
    setTimeout(finish, REDUCED_MOTION ? 200 : 0);
    return Promise.resolve();
  }
  try { sessionStorage.setItem('engi26.loaded', '1'); } catch { /* ignore */ }

  document.documentElement.classList.add('pl-locked');

  const lock = el.querySelector('[data-js="pl-wm"]');
  const shards = [...el.querySelectorAll('.pl-shard')];
  const slivers = [...el.querySelectorAll('.pl-sliver')];
  const bands = [...el.querySelectorAll('.pl-band')];
  const scan = el.querySelector('.pl-scan');
  const fill = el.querySelector('[data-js="pl-fill"]');
  const pctEl = el.querySelector('[data-js="pl-pct"]');
  const msgEl = el.querySelector('[data-js="pl-msg"]');
  const subEl = el.querySelector('[data-js="pl-sub"]');
  const bootEl = el.querySelector('[data-js="pl-boot"]');

  // Readiness can extend the load, never shorten it. We record WHEN it landed
  // rather than testing a boolean each frame — deriving L from the live clock
  // made L chase T, so the load never ended until the hard cap.
  let readyAt = null;
  const startedAt = performance.now();
  Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((res) => {
      // Only images needed for FIRST PAINT. `loading="lazy"` images (the event
      // grid, the gallery) do not load until scrolled to, so waiting on
      // document.images meant readiness could never fire and the load always
      // ran to the hard cap.
      const imgs = [...document.images]
        .filter(i => i.loading !== 'lazy' && !i.complete);
      if (!imgs.length) return res();
      let left = imgs.length;
      const tick = () => { if (--left <= 0) res(); };
      imgs.forEach(i => {
        i.addEventListener('load', tick, { once: true });
        i.addEventListener('error', tick, { once: true });
      });
    }),
  ]).then(() => { readyAt = (performance.now() - startedAt) / 1000; });

  return new Promise((resolve) => {
    const t0 = performance.now();
    let raf = null;

    function frame(now) {
      const T = (now - t0) / 1000;

      // Hold at the designed duration; stretch only as far as assets actually
      // needed, and never past the cap.
      //
      // While readiness is still pending L trails the clock rather than sitting
      // at LOAD_MAX: pinning it at the cap ran the bar at quarter pace and then
      // snapped it forward (74% -> 98% in one frame) the instant readiness
      // landed. Trailing at T * 1.25 keeps raw at 0.8 — the bar creeps to 99%
      // and waits — and the two branches meet continuously at both ends, so
      // the number only ever moves forward smoothly.
      const L = readyAt !== null
        ? Math.min(LOAD_MAX, Math.max(LOAD_DEFAULT, readyAt))
        : Math.min(LOAD_MAX, Math.max(LOAD_DEFAULT, T * 1.25));

      const loadEnd = L, burstEnd = L + BURST, wipeEnd = burstEnd + WIPE;

      if (T > wipeEnd + TAIL) {
        cancelAnimationFrame(raf);
        finish();
        resolve();
        return;
      }

      // ---- progress (reference: ease the raw ratio, then subtract stutter)
      const raw = clamp01(T / L);
      const stutter = (raw > 0.35 && raw < 0.9) ? hash(Math.floor(T * 6)) * 0.05 : 0;
      const pct = Math.min(100, Math.max(0, Math.round((easeOutCubic(raw) - stutter) * 100)));

      // ---- glitch envelope
      let g;
      if (T < loadEnd)       g = hash(Math.floor(T * 5)) > 0.78 ? 0.18 + 0.2 * hash(Math.floor(T * 11)) : 0.05;
      else if (T < burstEnd) g = 0.7 + 0.3 * hash(Math.floor(T * 16));
      else                   g = 0;

      const f = Math.floor(T * 20);            // 20fps quantised frame index
      const wipe = T > burstEnd ? clamp01((T - burstEnd) / WIPE) : 0;
      if (T > burstEnd) heroGo();

      // ---- readouts
      if (pctEl) pctEl.textContent = String(pct).padStart(3, '0') + '%';
      if (fill) fill.style.width = pct + '%';
      if (msgEl) msgEl.textContent = g > 0.5 ? 'SIGNAL LOSS' : 'REWIRING REALITY';
      if (subEl) subEl.style.setProperty('--sub-alpha', (0.55 + g * 0.4).toFixed(3));
      if (bootEl && T >= loadEnd) bootEl.textContent = 'INTERFACE READY';

      el.style.setProperty('--g', g.toFixed(4));
      el.style.setProperty('--pl-content', String(1 - clamp01(wipe * 2.4)));
      if (wipe > 0.05) el.style.pointerEvents = 'none';

      // ---- whole-lockup shake
      if (lock) {
        lock.style.transform =
          `translate(${((hash(f * 7.3) - 0.5) * 26 * g).toFixed(2)}px, ${((hash(f * 8.9) - 0.5) * 10 * g).toFixed(2)}px)`;
      }

      // ---- shards: base offset scales in with g, plus per-shard jitter
      shards.forEach((sh, i) => {
        const jx = (hash(f * 1.7 + i * 5.1) - 0.5) * 150 * g;
        const jy = (hash(f * 2.3 + i * 9.4) - 0.5) * 18 * g;
        const x = SHARD_BASE[i] * (0.35 + g) + jx;
        sh.style.setProperty('--x', x.toFixed(2) + 'px');
        sh.style.setProperty('--jy', jy.toFixed(2) + 'px');
        sh.style.setProperty('--chroma', (5 + g * 30).toFixed(2) + 'px');
        sh.style.setProperty('--a-alpha', (0.5 + g * 0.4).toFixed(3));
        sh.style.setProperty('--b-alpha', (0.45 + g * 0.4).toFixed(3));
        sh.style.setProperty('--glow', `${(14 + g * 34).toFixed(1)}px`);
        sh.style.setProperty('--glow-alpha', (0.28 + g * 0.4).toFixed(3));
      });

      // ---- torn slivers: thin sheared bands displaced hard during the burst
      slivers.forEach((sl, i) => {
        const seed = f * 0.61 + i * 13.7;
        if (hash(seed) >= 0.6 * g) { sl.style.display = 'none'; return; }
        const top = hash(seed + 1.1) * 100;
        const hgt = 2 + hash(seed + 2.2) * 8;
        sl.style.display = 'flex';
        sl.style.clipPath = `polygon(0 ${top}%, 100% ${top - 3}%, 100% ${top + hgt}%, 0 ${top + hgt + 3}%)`;
        sl.style.color = hash(seed + 4.4) > 0.6 ? CHROMA : '#fff';
        sl.style.transform = `translateX(${((hash(seed + 3.3) - 0.5) * 380 * g).toFixed(2)}px)`;
      });

      // ---- rolling scanlines
      if (scan) scan.style.transform = `translateY(${((T * 90) % 24) - 24}px)`;

      // ---- shutter bands
      bands.forEach((band, i) => {
        const d = i * 0.045;
        const p = clamp01((wipe - d) / (1 - d || 1));
        band.style.transform = `scaleX(${1 - easeOutCubic(p)})`;
      });

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
  });
}

// ==========================================================================
// COGNITRIXX scroll system — the single owner of scroll behaviour.
//
// Lenis drives smooth scrolling; GSAP ScrollTrigger drives everything that is
// scroll-LINKED (pinned, scrubbed, parallax). They are wired together so both
// read the same scroll position — running them independently is the classic
// way to get drift between pinned elements and the page.
//
// Every consumer registers through this module. Nothing else may create a
// Lenis instance or its own rAF scroll loop.
// ==========================================================================

export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const IS_TOUCH = window.matchMedia('(hover: none), (pointer: coarse)').matches;

// Live scroll telemetry, read every frame by the spatial layer (the neural
// spine in cognitrixx-3d.js) so scroll position and velocity drive the camera
// journey. One source, updated from the single Lenis instance below — never a
// second scroll listener that could disagree with Lenis.
export const scrollState = { progress: 0, velocity: 0 };

let lenis = null;
let gsap = null;
let ScrollTrigger = null;
let ready = null;

/**
 * Boot the scroll system once. Returns { gsap, ScrollTrigger, lenis } or null
 * if animation libraries are unavailable / reduced motion is on — callers must
 * handle null and render a readable static page.
 */
export function initScroll() {
  if (ready) return ready;

  ready = (async () => {
    if (REDUCED_MOTION) return null;

    try {
      ({ gsap } = await import('/vendor/gsap/index.js'));
      ({ ScrollTrigger } = await import('/vendor/gsap/ScrollTrigger.js'));
    } catch {
      return null; // vendor bundle missing — page stays static but legible
    }
    gsap.registerPlugin(ScrollTrigger);

    // Lenis: smooth on pointer devices, native on touch. Touch devices already
    // have momentum scrolling and hijacking it makes them feel broken.
    try {
      const { default: Lenis } = await import('/vendor/lenis/lenis.mjs');
      lenis = new Lenis({
        duration: 1.05,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        syncTouch: false,     // never hijack touch momentum
        touchMultiplier: 1.6,
      });

      // One clock: Lenis advances inside GSAP's ticker so both agree on time.
      // The same scroll event feeds ScrollTrigger AND the spine telemetry.
      lenis.on('scroll', (e) => {
        ScrollTrigger.update();
        scrollState.progress = e.progress ?? (e.limit ? e.scroll / e.limit : 0);
        scrollState.velocity = e.velocity ?? 0;
      });
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } catch {
      lenis = null; // native scrolling; ScrollTrigger still works
    }

    // Native fallback (Lenis unavailable): keep the spine telemetry alive so
    // the journey still tracks scroll, without a second smooth-scroll system.
    if (!lenis) {
      let lastY = window.scrollY, lastT = performance.now();
      window.addEventListener('scroll', () => {
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const now = performance.now();
        scrollState.progress = max > 0 ? y / max : 0;
        scrollState.velocity = (y - lastY) / Math.max(1, now - lastT) * 16;
        lastY = y; lastT = now;
      }, { passive: true });
    }

    return { gsap, ScrollTrigger, lenis };
  })();

  return ready;
}

/** Programmatic scrolling that respects Lenis when it is running. */
export function scrollTo(target, opts = {}) {
  if (lenis) return lenis.scrollTo(target, { offset: -80, duration: 1.1, ...opts });
  // Lenis absent: honour a numeric target too, so callers that scroll to a
  // position (the scroll rail) work on the native path as well as a selector.
  if (typeof target === 'number') {
    window.scrollTo({ top: target + (opts.offset ?? 0), behavior: 'smooth' });
    return;
  }
  document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
}

export function stopScroll() { lenis?.stop(); }
export function startScroll() { lenis?.start(); }

/**
 * Scroll-linked reveal. Unlike an IntersectionObserver toggle this stays tied
 * to scroll position, so a section eases in as it enters rather than firing
 * once at a threshold.
 */
export function registerReveals(ctx) {
  const targets = [...document.querySelectorAll('[data-reveal]')];
  if (!ctx) { targets.forEach(t => t.classList.add('is-visible')); return; }

  const { gsap } = ctx;
  const perParent = new Map();

  targets.forEach((el) => {
    const parent = el.parentElement;
    const n = perParent.get(parent) || 0;
    perParent.set(parent, n + 1);

    // Direction from the element's own position, so the page reads as content
    // converging through space rather than a column of identical slide-ups:
    // left-of-centre enters from the left, right-of-centre from the right,
    // centred content approaches from depth (scale). Explicit override via
    // data-reveal="up|left|right|depth". Transient x-offsets are clipped by
    // the body's overflow-x:hidden, so they never add a scrollbar.
    const rect = el.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    const dir = el.dataset.reveal
      || (rect.width > innerWidth * 0.7 ? 'depth'
        : mid < innerWidth * 0.42 ? 'left'
        : mid > innerWidth * 0.58 ? 'right' : 'depth');
    const from = dir === 'left'  ? { x: -46, y: 0, scale: 1 }
      : dir === 'right' ? { x: 46, y: 0, scale: 1 }
      : dir === 'up'    ? { x: 0, y: 24, scale: 1 }
      : { x: 0, y: 30, scale: 0.965 }; // depth

    gsap.fromTo(el,
      { opacity: 0, ...from },
      {
        opacity: 1, x: 0, y: 0, scale: 1,
        duration: 0.9,
        ease: 'power3.out',
        delay: Math.min(n, 5) * 0.07,
        // Inside the deck the element's own document position is the wrong
        // clock: the card is sticky, so it parks in view long before that
        // position reaches the trigger line, and its contents would still be
        // at opacity 0 while the card is sitting there being read. The card
        // is what actually arrives, so the card is what triggers.
        scrollTrigger: { trigger: el.closest('.deck-item') || el, start: 'top 92%', once: true },
        onStart: () => el.classList.add('is-visible'),
      });
  });
}

/**
 * Section-to-section seams: the outgoing section's content drifts and fades as
 * the next one arrives, so boundaries read as transitions instead of edges.
 */
export function registerSeams(ctx) {
  if (!ctx || IS_TOUCH) return; // too costly on touch, and less legible
  const { gsap } = ctx;

  document.querySelectorAll('[data-seam]').forEach((section) => {
    const inner = section.querySelector('[data-seam-inner]') || section.firstElementChild;
    if (!inner) return;

    // Dim rather than dissolve: at 0.35 the outgoing chapter read as broken
    // while it was still on screen and still legible. It only has to recede.
    gsap.fromTo(inner,
      { yPercent: 0, opacity: 1 },
      {
        yPercent: -4, opacity: 0.55, ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'bottom 78%',
          end: 'bottom top',
          scrub: 0.6,
        },
      });
  });
}

/** Depth parallax — one layer per element, capped so it stays atmospheric. */
export function registerParallax(ctx) {
  if (!ctx) return;
  const { gsap } = ctx;

  document.querySelectorAll('[data-parallax]').forEach((el) => {
    const strength = parseFloat(el.dataset.parallax) || 12;
    gsap.fromTo(el,
      { yPercent: -strength / 2 },
      {
        yPercent: strength / 2, ease: 'none',
        scrollTrigger: { trigger: el.parentElement || el, start: 'top bottom', end: 'bottom top', scrub: true },
      });
  });
}

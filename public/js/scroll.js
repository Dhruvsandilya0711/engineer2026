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
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } catch {
      lenis = null; // native scrolling; ScrollTrigger still works
    }

    return { gsap, ScrollTrigger, lenis };
  })();

  return ready;
}

/** Programmatic scrolling that respects Lenis when it is running. */
export function scrollTo(target, opts = {}) {
  if (lenis) lenis.scrollTo(target, { offset: -80, duration: 1.1, ...opts });
  else document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
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

    gsap.fromTo(el,
      { opacity: 0, y: 18 },
      {
        opacity: 1, y: 0,
        duration: 0.9,
        ease: 'power3.out',
        delay: Math.min(n, 5) * 0.07,
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
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

    gsap.fromTo(inner,
      { yPercent: 0, opacity: 1 },
      {
        yPercent: -6, opacity: 0.35, ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'bottom 85%',
          end: 'bottom top',
          scrub: true,
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

// ==========================================================================
// ENGINEER '26 homepage orchestration.
//
// Shared chrome (nav, magnetic CTAs, countdown) lives in site.js.
// Scroll ownership lives in scroll.js. 3D lives in cognitrixx-3d.js.
// This file only sequences homepage-specific moments.
// ==========================================================================

import { initHeroScene } from '/js/hero-scene.js';
import { mountFields, hasWebGL } from '/js/cognitrixx-3d.js';
import {
  initScroll, registerReveals, registerSeams, registerParallax,
  scrollTo, stopScroll, startScroll, REDUCED_MOTION, IS_TOUCH,
} from '/js/scroll.js';
import { initNav, initMagneticButtons, initCountdown } from '/js/site.js';

// -- Entry sequence --------------------------------------------------------
function initEntrySequence() {
  const el = document.getElementById('entry-sequence');
  if (!el) return Promise.resolve();
  if (REDUCED_MOTION) { el.remove(); return Promise.resolve(); }

  stopScroll();
  document.documentElement.style.overflow = 'hidden';

  const stages = el.querySelectorAll('.stage');
  [0, 260, 560, 850].forEach((t, i) => setTimeout(() => stages[i]?.classList.add('is-active'), t));
  setTimeout(() => el.classList.add('glitch-pulse'), 560);

  return new Promise((resolve) => {
    setTimeout(() => {
      el.classList.add('is-hidden');
      document.documentElement.style.overflow = '';
      startScroll();
      setTimeout(() => { el.remove(); resolve(); }, 550);
    }, 1200);
  });
}

// -- Hero: the Penrose hands off to the nav mark instead of just scrolling away
function registerHeroHandoff(ctx) {
  if (!ctx || IS_TOUCH) return;
  const { gsap } = ctx;
  const frame = document.querySelector('[data-js="hero-logo"]');
  const hero = document.querySelector('#top');
  if (!frame || !hero) return;

  gsap.to(frame, {
    scale: 0.28,
    yPercent: -38,
    opacity: 0.15,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'center center', end: 'bottom top', scrub: 0.6 },
  });
}

// -- Cognitrixx narrative: pinned, scrubbed, six beats ----------------------
function registerNarrative(ctx, fields) {
  const section = document.getElementById('transformation');
  const stages = section?.querySelectorAll('.transform-stage');
  const dots = section?.querySelectorAll('.dot');
  if (!section || !stages?.length) return;

  const field = fields.transformation;

  const setStage = (i) => {
    stages.forEach(s => s.classList.toggle('is-active', Number(s.dataset.stage) === i));
    dots?.forEach(d => d.classList.toggle('is-active', Number(d.dataset.dot) === i));
  };

  if (!ctx) {
    // Static fallback must still be readable, not an empty pinned void.
    section.style.height = 'auto';
    section.querySelector('.sticky')?.classList.remove('sticky', 'h-screen');
    setStage(0);
    field?.setProgress(1);
    return;
  }

  ctx.ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      field?.setProgress(self.progress);
      setStage(Math.min(5, Math.floor(self.progress * 6)));
    },
  });
}

// -- Events rail: vertical scroll drives horizontal travel -----------------
function registerEventsRail(ctx) {
  const section = document.querySelector('[data-js="events-rail"]');
  const track = section?.querySelector('[data-js="rail-track"]');
  const viewport = section?.querySelector('[data-js="rail-viewport"]');
  const items = section?.querySelectorAll('[data-js="rail-item"]');
  const label = section?.querySelector('[data-js="rail-index"]');
  const prev = section?.querySelector('[data-js="rail-prev"]');
  const next = section?.querySelector('[data-js="rail-next"]');
  if (!section || !track || !items?.length) return;

  const setLabel = (i) => { if (label) label.textContent = String(Math.min(items.length, i + 1)).padStart(2, '0'); };

  // Touch + reduced motion + no-GSAP: a plain horizontal scroller. The arrows
  // still work, so the whole set is reachable without a pointer or a wheel.
  const nativeScroller = () => {
    section.classList.add('is-native');
    let index = 0;
    const go = (dir) => {
      index = Math.max(0, Math.min(items.length - 1, index + dir));
      items[index].scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
      setLabel(index);
    };
    prev?.addEventListener('click', () => go(-1));
    next?.addEventListener('click', () => go(1));
    viewport?.addEventListener('scroll', () => {
      const i = Math.round(viewport.scrollLeft / (items[0].offsetWidth + 24));
      setLabel(i);
    }, { passive: true });
  };

  if (!ctx || IS_TOUCH || REDUCED_MOTION) { nativeScroller(); return; }

  const { gsap } = ctx;
  section.classList.add('is-pinned');

  const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);

  const tween = gsap.to(track, {
    x: () => -distance(),
    ease: 'none',
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => '+=' + distance(),
      pin: true,
      scrub: 0.8,
      invalidateOnRefresh: true,
      anticipatePin: 1,
      onUpdate(self) { setLabel(Math.round(self.progress * (items.length - 1))); },
    },
  });

  // Arrow buttons map to positions along the pinned scroll range, so keyboard
  // users get the same coverage as someone scrolling.
  const st = tween.scrollTrigger;
  const jump = (dir) => {
    const span = st.end - st.start;
    const step = span / (items.length - 1 || 1);
    scrollTo(Math.round(st.scroll() + dir * step), { immediate: false });
  };
  prev?.addEventListener('click', () => jump(-1));
  next?.addEventListener('click', () => jump(1));
}

// -- Boot ------------------------------------------------------------------
(async function boot() {
  initNav();
  initMagneticButtons();
  initCountdown();

  const entryDone = initEntrySequence();
  const ctx = await initScroll();

  // Mount every declared 3D moment. Skipped wholesale without WebGL — the page
  // is still complete, just without the fields.
  const fields = hasWebGL() ? mountFields() : {};

  registerReveals(ctx);
  registerParallax(ctx);
  registerSeams(ctx);
  registerHeroHandoff(ctx);
  registerNarrative(ctx, fields);
  registerEventsRail(ctx);

  const heroMount = document.querySelector('[data-js="hero-logo"]');
  if (heroMount) initHeroScene(heroMount);

  await entryDone;
  ctx?.ScrollTrigger.refresh();
})();

// ==========================================================================
// ENGINEER '26 homepage orchestration.
//
// Shared chrome (nav, magnetic CTAs, countdown) lives in site.js.
// Scroll ownership lives in scroll.js. 3D lives in cognitrixx-3d.js.
// This file only sequences homepage-specific moments.
//
// The hero no longer mounts a Penrose object — the landing view is
// typography-led. public/js/hero-scene.js (logo + particle dissolve) is kept
// but unused; re-adding the object means restoring the frame markup in
// _hero.ejs and re-importing that module here.
// ==========================================================================

import { mountFields, hasWebGL } from '/js/cognitrixx-3d.js';
import {
  initScroll, registerReveals, registerSeams, registerParallax,
  scrollState, REDUCED_MOTION, IS_TOUCH,
} from '/js/scroll.js';
import { initNav, initMagneticButtons, initCountdown, initCursor, initScrollRail } from '/js/site.js';
import { initDots } from '/js/dots.js';
import { initGalleryFlow } from '/js/gallery-flow.js';
import { initPreloader } from '/js/preloader.js';

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

// -- Events rail (deck card 02) --------------------------------------------
// The rail used to pin the section and translate the track horizontally. It
// now lives inside a sticky deck card, and a ScrollTrigger pin nested inside
// a sticky ancestor fights it — the pin measures a position the sticky parent
// then moves. So the rail is the native horizontal scroller everywhere: the
// same path touch devices always took, with the arrows driving it.
function registerEventsRail() {
  const section = document.querySelector('[data-js="events-rail"]');
  const track = section?.querySelector('[data-js="rail-track"]');
  const viewport = section?.querySelector('[data-js="rail-viewport"]');
  const items = section?.querySelectorAll('[data-js="rail-item"]');
  const label = section?.querySelector('[data-js="rail-index"]');
  const prev = section?.querySelector('[data-js="rail-prev"]');
  const next = section?.querySelector('[data-js="rail-next"]');
  if (!section || !track || !items?.length) return;

  section.classList.add('is-native');
  const setLabel = (i) => {
    if (label) label.textContent = String(Math.min(items.length, Math.max(1, i + 1))).padStart(2, '0');
  };

  let index = 0;
  const go = (dir) => {
    index = Math.max(0, Math.min(items.length - 1, index + dir));
    items[index].scrollIntoView({
      behavior: REDUCED_MOTION ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
    setLabel(index);
  };
  prev?.addEventListener('click', () => go(-1));
  next?.addEventListener('click', () => go(1));

  // Keep the readout honest when the rail is swiped or wheeled directly.
  viewport?.addEventListener('scroll', () => {
    const step = items[0].offsetWidth + 24;
    index = Math.max(0, Math.min(items.length - 1, Math.round(viewport.scrollLeft / step)));
    setLabel(index);
  }, { passive: true });

  setLabel(0);
}

// -- The deck: six sticky cards ---------------------------------------------
// CSS `position: sticky` already does the stacking, and the page is complete
// without this. All GSAP adds is the depth: as the next card climbs over one,
// that card eases back and dims, so the stack reads as plates at different
// distances rather than a flat pile.
function registerDeck(ctx) {
  const items = [...document.querySelectorAll('.deck-item')];
  if (!ctx || !items.length) return;

  const { gsap } = ctx;
  // Phones carry the same effect at half the travel: the same idea, a
  // fraction of the compositing.
  const depth = IS_TOUCH ? 0.04 : 0.08;

  items.forEach((item, i) => {
    const covering = items[i + 1];
    if (!covering) return; // the last card is never covered

    const card = item.querySelector('.deck-card');
    const scrim = item.querySelector('[data-js="deck-scrim"]');
    if (!card) return;

    // One timeline, one ScrollTrigger per card: from the moment the covering
    // card appears at the bottom of the viewport to the moment it has parked.
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: covering,
        start: 'top bottom',
        end: 'top top',
        scrub: true,
        invalidateOnRefresh: true,
      },
    });
    tl.fromTo(card, { scale: 1 }, { scale: 1 - depth, ease: 'none' }, 0);
    if (scrim) tl.fromTo(scrim, { opacity: 0 }, { opacity: 1, ease: 'none' }, 0);
  });
}

// -- Boot ------------------------------------------------------------------
(async function boot() {
  initNav();
  initMagneticButtons();
  initCountdown();
  initCursor();
  initScrollRail();

  const entryDone = initPreloader();
  const ctx = await initScroll();

  // Mount every declared 3D moment. Skipped wholesale without WebGL — the page
  // is still complete, just without the fields.
  const fields = hasWebGL() ? mountFields({ scroll: scrollState }) : {};

  registerReveals(ctx);
  registerParallax(ctx);
  registerSeams(ctx);
  registerNarrative(ctx, fields);
  registerEventsRail();
  registerDeck(ctx);
  initGalleryFlow();
  initDots(ctx);

  await entryDone;
  ctx?.ScrollTrigger.refresh();
})();

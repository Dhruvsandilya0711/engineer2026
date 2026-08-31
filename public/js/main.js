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
  scrollState, REDUCED_MOTION,
  scrollTo, stopScroll, startScroll,
} from '/js/scroll.js';
import { initNav, initMagneticButtons, initCountdown, initCursor, initScrollRail, initAudio } from '/js/site.js';
import { initDots } from '/js/dots.js';
import { initGalleryFlow } from '/js/gallery-flow.js';
import { initPreloader } from '/js/preloader.js';
import { initPageTransition } from '/js/page-transition.js';
import { mountNeuralMark } from '/js/neural-mark.js';
import { mountSignalGame } from '/js/signal-game.js';

// -- Cognitrixx narrative: pinned, scrubbed, six beats ----------------------
function registerNarrative(ctx, subject) {
  const section = document.getElementById('transformation');
  const stages = section?.querySelectorAll('.transform-stage');
  const dots = section?.querySelectorAll('.dot');
  if (!section || !stages?.length) return;


  const setStage = (i) => {
    stages.forEach(s => s.classList.toggle('is-active', Number(s.dataset.stage) === i));
    dots?.forEach(d => d.classList.toggle('is-active', Number(d.dataset.dot) === i));
  };

  if (!ctx) {
    // Static fallback must still be readable, not an empty pinned void.
    section.style.height = 'auto';
    section.querySelector('.sticky')?.classList.remove('sticky', 'h-screen');
    setStage(0);
    subject?.setProgress(1);
    return;
  }

  ctx.ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      subject?.setProgress(self.progress);
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
  if (!section || !track || !viewport || !items?.length) return;

  section.classList.add('is-native');

  // One card plus the track's gap. Measured live so it's right at any breakpoint
  // (the card runs inside the fandeck panel, which reflows the rail width).
  const stepSize = () => {
    const gap = parseFloat(getComputedStyle(track).columnGap) || 24;
    return items[0].getBoundingClientRect().width + gap;
  };
  // The readout follows the ACTUAL scroll position — the single source of truth,
  // whether the rail moved by button, swipe, or wheel.
  const setLabel = () => {
    if (!label) return;
    const i = Math.round(viewport.scrollLeft / stepSize());
    label.textContent = String(Math.min(items.length, Math.max(1, i + 1))).padStart(2, '0');
  };

  // Page the rail itself by exactly one card. scrollBy is called ON the viewport
  // so it never disturbs an ancestor (the old scrollIntoView could nudge the
  // card body vertically and desynced a shared index, breaking prev/next).
  const go = (dir) => {
    viewport.scrollBy({ left: dir * stepSize(), behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  };
  prev?.addEventListener('click', () => go(-1));
  next?.addEventListener('click', () => go(1));

  viewport.addEventListener('scroll', setLabel, { passive: true });
  setLabel();
}

// -- The fan deck: five tilted cards, hover to lift, click to open ----------
// The fan and the hover-lift are pure CSS (see .fandeck / .fancard). JS only
// runs the OPEN interaction: a FLIP morph that flies the clicked card to the
// centre and grows it into a full panel, plus the ways back out (scrim, ✕,
// Esc). The nav anchors (#about … #sponsors) open the matching card too.
function initFanDeck() {
  const deck = document.querySelector('[data-js="fandeck"]');
  if (!deck) return;

  const cards = [...deck.querySelectorAll('.fancard')];
  const scrim = deck.querySelector('[data-js="fandeck-scrim"]');
  if (!cards.length) return;

  let open = null;            // the currently open card, or null
  let animating = false;
  let animTimer = null;
  // Scroll position captured at open, restored on close so the deck lands back
  // exactly where it was even if the page leaked a scroll behind the overlay.
  let savedScroll = 0;

  // FLIP: capture the card's box before the state flips, let the browser lay
  // out the new box, then play the visual delta as a transform back to zero.
  // rotateY isn't inverted — the card visibly straightens as it grows, which
  // is exactly the reference's open.
  function flip(card, mutate) {
    if (REDUCED_MOTION) { mutate(); return; }
    const first = card.getBoundingClientRect();
    mutate();
    const last = card.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = first.width / last.width || 1;
    const sy = first.height / last.height || 1;
    card.style.transition = 'none';
    card.style.transform =
      `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    // Force the browser to accept the inverted start before we clear it.
    card.getBoundingClientRect();
    animating = true;
    card.style.transition = '';
    requestAnimationFrame(() => { card.style.transform = ''; });
    // Clear the guard on a timer, not on transitionend alone: if the inverted
    // start happens to equal the end, no transition fires and the flag would
    // stick, freezing every later open/close.
    clearTimeout(animTimer);
    animTimer = setTimeout(() => { animating = false; }, 620);
  }

  function openCard(card) {
    if (open || animating || !card) return;
    open = card;
    savedScroll = window.scrollY;
    deck.classList.add('is-open');
    card.setAttribute('aria-expanded', 'true');
    flip(card, () => card.classList.add('is-open'));
    stopScroll();
    document.documentElement.classList.add('fandeck-lock');
    // Move focus to the close button for keyboard users.
    card.querySelector('[data-js="fancard-close"]')?.focus({ preventScroll: true });
  }

  function closeCard() {
    if (!open || animating) return;
    const card = open;
    open = null;
    deck.classList.remove('is-open');
    card.setAttribute('aria-expanded', 'false');
    // Put the page back exactly where it was when the card opened, BEFORE the
    // flip measures the fan slot. Some mobile browsers let the page scroll
    // behind the open overlay despite the lock; without this the deck stays
    // shifted and the card flips home to the wrong place.
    document.documentElement.classList.remove('fandeck-lock');
    if (Math.abs(window.scrollY - savedScroll) > 1) window.scrollTo(0, savedScroll);
    // The inline transform ends at '' → the card falls back to its CSS fan
    // transform, so FLIP-ing the removal lands it neatly back in its slot.
    flip(card, () => card.classList.remove('is-open'));
    startScroll();
    // Do NOT return focus to the card's open button: that lands :focus-within
    // on the card and leaves it stuck in the lifted (hover) pose. Drop focus to
    // the body instead so the card settles flat back into the fan.
    document.activeElement?.blur?.();
  }

  cards.forEach((card) => {
    card.querySelector('[data-js="fancard-open"]')
      ?.addEventListener('click', () => openCard(card));
    card.querySelector('[data-js="fancard-close"]')
      ?.addEventListener('click', (e) => { e.preventDefault(); closeCard(); });
  });

  scrim?.addEventListener('click', closeCard);

  // The open card is a scrollable panel: its body (data-lenis-prevent,
  // overflow-y:auto) takes wheel/touch scrolling while the page stays locked
  // behind it. Scrolling no longer dismisses the card — only the scrim, the ✕,
  // or Esc closes it.
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') closeCard();
  });

  // Nav anchors (and the hero bays) that point at a card open it rather than
  // scrolling to a small tilted face. Scroll the deck into view first, then
  // open once it has settled.
  const byId = new Map(cards.map((c) => [c.id, c]));
  document.querySelectorAll('a[href*="#"]').forEach((a) => {
    const id = (a.getAttribute('href') || '').split('#').pop();
    if (!id || !byId.has(id)) return;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      scrollTo('#deck', { offset: 0 });
      setTimeout(() => openCard(byId.get(id)), REDUCED_MOTION ? 0 : 650);
    });
  });
}

// -- Boot ------------------------------------------------------------------
(async function boot() {
  initPageTransition();
  initNav();
  initMagneticButtons();
  initCountdown();
  initCursor();
  initScrollRail();

  const entryDone = initPreloader();
  initAudio(entryDone);
  const ctx = await initScroll();

  // Mount every declared 3D moment. Skipped wholesale without WebGL — the page
  // is still complete, just without the fields.
  if (hasWebGL()) mountFields({ scroll: scrollState });
  // The transformation section's subject: its own scene, not a [data-field]
  // moment. It samples the mark PNG, assembles, and takes a drag — none of
  // which the shared field vocabulary has any business knowing about.
  const subject = mountNeuralMark();
  mountSignalGame();

  registerReveals(ctx);
  registerParallax(ctx);
  registerSeams(ctx);
  registerNarrative(ctx, subject);
  registerEventsRail();
  initFanDeck();
  initGalleryFlow();
  initDots(ctx);

  await entryDone;
  ctx?.ScrollTrigger.refresh();
})();

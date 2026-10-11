// Inner pages (/events, /events/:slug, /schedule, /team, /register).
// Same scroll and 3D systems as the homepage, but only the light moments:
// no pinned narrative, no events rail, no hero WebGL scene.

import { initNav, initMagneticButtons, initCountdown, initCursor, initClickTone, initScrollRail, initAudio } from '/engineer2026/js/site.js?v=80f296e';
import { initScroll, registerReveals, registerParallax, registerImageDrift, scrollState } from '/engineer2026/js/scroll.js?v=80f296e';
import { mountFields, hasWebGL } from '/engineer2026/js/cognitrixx-3d.js?v=80f296e';
import { initDots } from '/engineer2026/js/dots.js?v=80f296e';
import { initPageTransition, pageRevealed, revealStarted } from '/engineer2026/js/page-transition.js?v=80f296e';

(async function boot() {
  initPageTransition();
  initNav();
  initMagneticButtons();
  initCountdown();
  initCursor();
  initClickTone();
  initScrollRail();
  initAudio();

  const ctx = await initScroll();

  // Content rises as an arriving page's veil starts to lift, not behind it.
  await revealStarted();
  registerReveals(ctx);
  registerParallax(ctx);
  registerImageDrift(ctx);
  initDots(ctx);
  ctx?.ScrollTrigger.refresh();

  // The background field starts once an arriving page's transition veil has
  // lifted, so its shaders never compile while the blades are flying.
  await pageRevealed();
  if (hasWebGL()) mountFields({ scroll: scrollState });
})();

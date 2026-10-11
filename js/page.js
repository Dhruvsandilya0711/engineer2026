// Inner pages (/events, /events/:slug, /schedule, /team, /register).
// Same scroll and 3D systems as the homepage, but only the light moments:
// no pinned narrative, no events rail, no hero WebGL scene.

import { initNav, initMagneticButtons, initCountdown, initCursor, initClickTone, initScrollRail, initAudio } from '/engineer2026/js/site.js?v=e48b109';
import { initScroll, registerReveals, registerParallax, registerImageDrift, scrollState } from '/engineer2026/js/scroll.js?v=e48b109';
import { mountFields, hasWebGL } from '/engineer2026/js/cognitrixx-3d.js?v=e48b109';
import { initDots } from '/engineer2026/js/dots.js?v=e48b109';
import { initPageTransition } from '/engineer2026/js/page-transition.js?v=e48b109';

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
  if (hasWebGL()) mountFields({ scroll: scrollState });

  registerReveals(ctx);
  registerParallax(ctx);
  registerImageDrift(ctx);
  initDots(ctx);

  ctx?.ScrollTrigger.refresh();
})();

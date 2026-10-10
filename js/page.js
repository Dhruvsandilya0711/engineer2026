// Inner pages (/events, /events/:slug, /schedule, /team, /register).
// Same scroll and 3D systems as the homepage, but only the light moments:
// no pinned narrative, no events rail, no hero WebGL scene.

import { initNav, initMagneticButtons, initCountdown, initCursor, initClickTone, initScrollRail, initAudio } from '/engineer2026/js/site.js?v=mv2vnxtt';
import { initScroll, registerReveals, registerParallax, scrollState } from '/engineer2026/js/scroll.js?v=mv2vnxtt';
import { mountFields, hasWebGL } from '/engineer2026/js/cognitrixx-3d.js?v=mv2vnxtt';
import { initDots } from '/engineer2026/js/dots.js?v=mv2vnxtt';
import { initPageTransition } from '/engineer2026/js/page-transition.js?v=mv2vnxtt';

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
  initDots(ctx);

  ctx?.ScrollTrigger.refresh();
})();

// Inner pages (/events, /events/:slug, /schedule, /team, /register).
// Same scroll and 3D systems as the homepage, but only the light moments:
// no pinned narrative, no events rail, no hero WebGL scene.

import { initNav, initMagneticButtons, initCountdown, initCursor, initScrollRail } from '/js/site.js';
import { initScroll, registerReveals, registerParallax, scrollState } from '/js/scroll.js';
import { mountFields, hasWebGL } from '/js/cognitrixx-3d.js';
import { initDots } from '/js/dots.js';
import { initPageTransition } from '/js/page-transition.js';

(async function boot() {
  initPageTransition();
  initNav();
  initMagneticButtons();
  initCountdown();
  initCursor();
  initScrollRail();

  const ctx = await initScroll();
  if (hasWebGL()) mountFields({ scroll: scrollState });

  registerReveals(ctx);
  registerParallax(ctx);
  initDots(ctx);

  ctx?.ScrollTrigger.refresh();
})();

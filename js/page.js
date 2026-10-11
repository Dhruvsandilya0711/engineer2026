// Inner pages (/events, /events/:slug, /schedule, /team, /register).
// Same scroll and 3D systems as the homepage, but only the light moments:
// no pinned narrative, no events rail, no hero WebGL scene.

import { initNav, initMagneticButtons, initCountdown, initCursor, initClickTone, initScrollRail, initAudio } from '/engineer2026/js/site.js?v=3f4b266';
import { initScroll, registerReveals, registerParallax, registerImageDrift, scrollState } from '/engineer2026/js/scroll.js?v=3f4b266';
import { mountFields, hasWebGL } from '/engineer2026/js/cognitrixx-3d.js?v=3f4b266';
import { initDots } from '/engineer2026/js/dots.js?v=3f4b266';
import { initPageTransition, pageRevealed } from '/engineer2026/js/page-transition.js?v=3f4b266';

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

// Inner pages (/events, /events/:slug, /schedule, /team, /register).
// Same scroll and 3D systems as the homepage, but only the light moments:
// no pinned narrative, no events rail, no hero WebGL scene.

import { initNav, initMagneticButtons, initCountdown, initCursor, initClickTone, initScrollRail, initAudio } from '/js/site.js';
import { initScroll, registerReveals, registerParallax, registerImageDrift, scrollState } from '/js/scroll.js';
import { mountFields, hasWebGL } from '/js/cognitrixx-3d.js';
import { initDots } from '/js/dots.js';
import { initPageTransition, pageRevealed, revealStarted } from '/js/page-transition.js';

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

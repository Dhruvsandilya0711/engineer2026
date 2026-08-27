// Inner pages (/events, /events/:slug, /schedule, /team, /register).
// Same scroll and 3D systems as the homepage, but only the light moments:
// no pinned narrative, no events rail, no hero WebGL scene.

import { initNav, initMagneticButtons, initCountdown } from '/js/site.js';
import { initScroll, registerReveals, registerParallax } from '/js/scroll.js';
import { mountFields, hasWebGL } from '/js/cognitrixx-3d.js';

(async function boot() {
  initNav();
  initMagneticButtons();
  initCountdown();

  const ctx = await initScroll();
  if (hasWebGL()) mountFields();

  registerReveals(ctx);
  registerParallax(ctx);

  ctx?.ScrollTrigger.refresh();
})();

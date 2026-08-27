// Inner pages (/events, /events/:slug). Everything these need is shared —
// no hero WebGL scene and no scroll-scrubbed transformation section, so no
// three.js or gsap is loaded on these routes at all.

import { initNav, initMagneticButtons, initReveal, initAmbientField, initCountdown } from '/js/site.js';

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initMagneticButtons();
  initReveal();
  initCountdown();
  initAmbientField();
});

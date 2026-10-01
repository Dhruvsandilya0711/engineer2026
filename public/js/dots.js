// ==========================================================================
// DOT DISSOLVE — content breaks into dots at the viewport edges and
// reassembles as it returns. Fully reversible: scrolling back restores it.
//
// WHY A MASK, NOT PARTICLES
// The hero logo dissolve sampled one bitmap into a GPU particle buffer. That
// cannot generalise to "every element": each one would need rasterising to a
// texture and its own draw pass. Instead this shrinks a *tiled radial-gradient
// mask* — as the dot radius drops below the tile's half-size the surface stops
// being solid and becomes discrete dots, then nothing. Composited by the GPU,
// works identically on text, images and boxes, and costs one custom-property
// write per frame per active element.
//
// Progress model (per element, over its full travel through the viewport):
//     entering bottom → solid through the middle → dots → exits top
// so the same element dissolves on the way out and rebuilds on the way back,
// in either scroll direction.
// ==========================================================================

import { REDUCED_MOTION, IS_TOUCH } from '/js/scroll.js';

// Content blocks worth dissolving. Deliberately not "every node in the DOM" —
// masking every wrapper would multiply cost with no visual gain, since only
// the elements that actually paint content read as dots.
const SELECTOR = [
  '[data-reveal]',
  '.rail-card',
  '.gallery-tile',
  '.event-row',
  '.schedule-slot',
  '.team-card',
].join(', ');

// Middle of the travel stays fully solid so content is readable; the dissolve
// only occupies the outer band at each edge.
const SOLID_BAND = 0.52;

export function initDots(ctx) {
  if (!ctx || REDUCED_MOTION) return null;

  const { gsap, ScrollTrigger } = ctx;

  // Mobile-forward: masking is cheap per element but not free, so phones get
  // the effect on fewer, larger blocks rather than every row and tile.
  const selector = IS_TOUCH ? '[data-reveal], .rail-card, .gallery-tile' : SELECTOR;

  const hero = document.querySelector('#top');
  const deck = document.getElementById('deck');

  const targets = [...document.querySelectorAll(selector)]
    // The hero is the landing view and must render crisp. Its content sits at
    // the top of the viewport at scroll 0, which this effect would otherwise
    // read as "exiting" and dissolve on load — that is what made the location
    // line look broken before anyone had scrolled.
    // The wordmark keeps its own permanent dot rendering (data-dots-strong),
    // which is a separate, always-on treatment.
    .filter(el => !(hero && hero.contains(el)))
    // Same problem, different cause: the deck's cards are `position: sticky`,
    // so their content parks in the viewport while its DOCUMENT position —
    // which is what ScrollTrigger measures — keeps travelling. Progress
    // reaches the exit edge with the card still parked and fully readable, so
    // the text dissolves in place. The dissolve is for content that moves
    // through the viewport; the deck's does not.
    .filter(el => !(deck && deck.contains(el)))
    // Skip anything already inside another target: nested masks stack and the
    // inner one would dissolve twice as fast as its parent.
    .filter((el, _, all) => !all.some(other => other !== el && other.contains(el)));

  targets.forEach((el) => {
    // Elements that render as dots permanently (the wordmark) style
    // themselves — they only need the --dots value, not the generic mask,
    // or the two mask rules would fight.
    const ownsMask = el.hasAttribute('data-dots-strong');
    if (!ownsMask) el.classList.add('dots-target');

    ScrollTrigger.create({
      trigger: el,
      start: 'top bottom',   // element's top enters the viewport bottom
      end: 'bottom top',     // element's bottom leaves the viewport top
      scrub: true,
      onUpdate(self) {
        // 0 through the lower half of travel, rising to 1 at the top edge.
        // Exit only: content arriving from below is the headline masks' and
        // the reveals' job, and dotting it as well made text that was still
        // being read look broken. It still dissolves as it leaves upward and
        // rebuilds on the way back down.
        const edge = Math.max(0, self.progress * 2 - 1);
        // Hold solid through the middle band, then ramp to fully dispersed.
        const p = Math.min(1, Math.max(0, (edge - SOLID_BAND) / (1 - SOLID_BAND)));
        setDots(el, p, ownsMask);
      },
      onLeave: () => setDots(el, 1, ownsMask),
      onLeaveBack: () => setDots(el, 0, ownsMask),
    });
  });

  return { count: targets.length };
}

function setDots(el, p, ownsMask) {
  if (ownsMask) {
    // Always keep the property set: this element is dotted at rest too.
    el.style.setProperty('--dots', p.toFixed(3));
    return;
  }
  if (p <= 0.001) {
    // Fully solid: drop the mask entirely so we are not paying for a
    // no-op composite on every static element on the page.
    if (el.dataset.dotsOn === '1') {
      el.style.removeProperty('--dots');
      el.style.removeProperty('will-change');
      el.classList.remove('is-dotting');
      delete el.dataset.dotsOn;
    }
    return;
  }

  if (el.dataset.dotsOn !== '1') {
    el.dataset.dotsOn = '1';
    el.style.willChange = 'mask-size, mask-image, opacity';
    el.classList.add('is-dotting');
  }
  el.style.setProperty('--dots', p.toFixed(3));
}

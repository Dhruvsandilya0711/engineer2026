// ==========================================================================
// MOTION — the revamp's shared motion vocabulary.
//
// Loaded as its OWN entry module on every page, not imported by main.js or
// page.js. Those two statically import three.js through cognitrixx-3d.js, so
// nothing in their graph runs until ~600KB of WebGL has downloaded — on a
// phone that is seconds of headlines sitting invisible. This module's only
// static dependency is scroll.js (a few KB, GSAP/Lenis load lazily inside
// it), so the type starts moving as soon as the document can.
//
//   [data-split]      headline lines rise out of a mask as they arrive
//   [data-img-reveal] photographs wipe open as they arrive
//   [data-scramble]   short labels decode from signal noise
//   [data-marquee]    kinetic bands whose speed follows scroll velocity
//   [data-highlight]  a paragraph that lights word by word as it scrolls
//   [data-spotlight]  a light that follows the pointer across a surface
//   [data-tilt]       a card that leans toward the cursor in 3D
//   [data-preview]    links that float their event photo beside the cursor
//   scroll progress   the hairline under the header
//   hero              pointer parallax + scroll-away on the homepage hero
//
// Every effect has a static end state that is also the no-JS and
// reduced-motion state: nothing here can leave content hidden.
// ==========================================================================

import { initScroll, REDUCED_MOTION } from '/engineer2026/js/scroll.js?v=3299070';

const root = document.documentElement;
const FINE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// ---------------------------------------------------------------- split
/**
 * Wrap each <br>-separated line of a headline in a clipping mask so the line
 * can rise into view from below its own baseline. Lines are taken from the
 * markup's <br>s rather than measured, so a gradient span stays one element
 * and its fill does not restart on every word.
 */
function splitLines(el) {
  if (el.classList.contains('is-split')) return;
  const lines = [[]];
  [...el.childNodes].forEach((n) => {
    if (n.nodeName === 'BR') lines.push([]);
    else lines[lines.length - 1].push(n);
  });
  const frag = document.createDocumentFragment();
  lines
    .filter((nodes) => nodes.some((n) => n.nodeType !== 3 || n.textContent.trim()))
    .forEach((nodes, i) => {
      const mask = document.createElement('span');
      mask.className = 'sl';
      const inner = document.createElement('span');
      inner.className = 'sl__i';
      inner.style.setProperty('--li', i);
      nodes.forEach((n) => inner.appendChild(n));
      mask.appendChild(inner);
      frag.appendChild(mask);
    });
  el.textContent = '';
  el.appendChild(frag);
  el.classList.add('is-split');
}

// One observer for everything that plays once on arrival.
const arrivals = new Map();
const arrivalIO = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const fn = arrivals.get(e.target);
        arrivalIO.unobserve(e.target);
        arrivals.delete(e.target);
        fn?.(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 })
  : null;

// An arriving page is under the transition veil until its reveal starts
// (views/partials/_transition.ejs). Entrances wait for that moment, so a
// headline rises as the page appears on every page, never early behind the
// logo on one page and late on the next. At once on any other load.
const revealStart = window.__ptRevealStart || Promise.resolve();

function onArrive(el, fn) {
  const play = (t) => revealStart.then(() => fn(t));
  if (!arrivalIO) { play(el); return; }
  arrivals.set(el, play);
  arrivalIO.observe(el);
}

function initSplits() {
  document.querySelectorAll('[data-split]').forEach((el) => {
    if (REDUCED_MOTION) { el.classList.add('is-in'); return; }
    splitLines(el);
    onArrive(el, (t) => {
      t.classList.add('is-in');
      // Once every line has landed the masks let go, so a headline's glow
      // is not cut to a hard rectangle at each line box.
      const lines = t.querySelectorAll('.sl').length;
      setTimeout(() => t.classList.add('is-done'), 1350 + lines * 110);
    });
  });
  // Photographs that wipe open from below as they arrive (CSS does the wipe).
  document.querySelectorAll('[data-img-reveal]').forEach((el) => {
    onArrive(el, (t) => t.classList.add('is-in'));
  });
}

// ------------------------------------------------------------- scramble
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/';

/**
 * Decode an element's text out of noise, left to right. Width is held for
 * the duration so a proportional face does not make its neighbours jitter.
 */
export function scramble(el, { duration = 900, delay = 0 } = {}) {
  const final = el.dataset.scrambleText ?? el.textContent;
  el.dataset.scrambleText = final;
  if (REDUCED_MOTION) { el.textContent = final; return; }

  const chars = [...final];
  const n = chars.length || 1;
  const settle = chars.map((_, i) => (i / n) * duration * 0.72 + Math.random() * duration * 0.28);
  const lockWidth = getComputedStyle(el).display !== 'inline';
  if (lockWidth) el.style.minWidth = `${el.getBoundingClientRect().width}px`;

  const t0 = performance.now() + delay;
  let lastStep = -1;
  const tick = (now) => {
    const t = now - t0;
    if (t < 0) { requestAnimationFrame(tick); return; }
    const step = Math.floor(t / 45);           // 22fps noise reads as signal, not blur
    if (step !== lastStep) {
      lastStep = step;
      let out = '';
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (c === ' ' || t >= settle[i]) { out += c; continue; }
        const g = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        out += c === c.toLowerCase() && c !== c.toUpperCase() ? g.toLowerCase() : g;
      }
      el.textContent = out;
    }
    if (t < duration) requestAnimationFrame(tick);
    else {
      el.textContent = final;
      if (lockWidth) el.style.minWidth = '';
    }
  };
  requestAnimationFrame(tick);
}

function initScrambles() {
  document.querySelectorAll('[data-scramble]').forEach((el) => {
    // The hero's labels run on the hero's own clock (see initHero).
    if (el.closest('#top')) return;
    onArrive(el, (t) => scramble(t, { duration: Number(t.dataset.scramble) || 800 }));
  });
}

// -------------------------------------------------------------- marquee
/**
 * The band's travel is a plain CSS animation, so it runs with no JS at all.
 * Once GSAP is here it takes the band over: scrolling speeds it up and turns
 * it with the scroll direction, then it eases back to cruising.
 *
 * It used to steer the CSS animation's playbackRate instead. Every write to
 * that re-synchronises the animation with the compositor, and during a
 * scroll it was written every frame, which made this the most expensive
 * script on the homepage. A GSAP tween's timeScale is just a number.
 */
function initMarquees(ctx) {
  const bands = [...document.querySelectorAll('[data-marquee]')];
  if (!bands.length || REDUCED_MOTION || !ctx) return;
  const { gsap } = ctx;

  const state = bands.map((el) => {
    const track = el.querySelector('.mq__track');
    if (!track) return null;
    const cs = getComputedStyle(track);
    const duration = parseFloat(cs.animationDuration) || 40;
    // A band set to animation-direction: reverse runs against its
    // neighbour; the tween keeps that.
    const back = cs.animationDirection === 'reverse';
    track.style.animation = 'none';
    const tween = gsap.fromTo(track,
      { xPercent: back ? -50 : 0 },
      { xPercent: back ? 0 : -50, duration, ease: 'none', repeat: -1, paused: true });
    // Far from the start, so turning it backwards never runs out of loops.
    tween.totalTime(duration * 1000);
    return { el, tween, rate: 1, hold: false, visible: false };
  }).filter(Boolean);
  if (!state.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const s = state.find((x) => x.el === e.target);
      if (!s) return;
      s.visible = e.isIntersecting;
      // Off screen, the band stops costing anything at all.
      if (s.visible) s.tween.resume(); else s.tween.pause();
    });
    wake();
  });
  state.forEach((s) => {
    io.observe(s.el);
    // A pointer over the band or keyboard focus inside it brings the band
    // to a stop, so a chip can be read and aimed at.
    if (s.el.hasAttribute('data-marquee-hover')) {
      const hold = (on) => () => { s.hold = on; wake(); };
      if (FINE) {
        s.el.addEventListener('pointerenter', hold(true));
        s.el.addEventListener('pointerleave', hold(false));
      }
      s.el.addEventListener('focusin', hold(true));
      s.el.addEventListener('focusout', hold(false));
    }
  });

  // The position is taken in the scroll event, where reading it is free;
  // read inside the frame, after GSAP and Lenis have written their styles,
  // it forced the browser to restyle the page early, twice a frame.
  let y = window.scrollY;
  let lastY = y;
  let vel = 0;
  let dir = 1;
  let raf = null;

  // The loop only runs while a band is still easing toward its target
  // speed; once every visible band has settled and the page is still, it
  // stops until the next scroll or hover wakes it.
  function frame() {
    const dy = y - lastY;
    lastY = y;
    vel += (dy - vel) * 0.18;
    if (Math.abs(dy) > 0.5) dir = dy > 0 ? 1 : -1;

    let busy = false;
    state.forEach((s) => {
      if (!s.visible) return;
      const boost = Math.min(Math.abs(vel) * 0.16, 6);
      // Same sign for every band, so a reversed band still runs against its
      // neighbour in both scroll directions.
      const target = s.hold ? 0 : dir * (1 + boost);
      const gap = target - s.rate;
      if (Math.abs(gap) < 0.004 && Math.abs(vel) < 0.05) s.rate = target;
      else { s.rate += gap * 0.08; busy = true; }
      s.tween.timeScale(Math.abs(s.rate));
      s.tween.reversed(s.rate < 0);
    });
    raf = busy ? requestAnimationFrame(frame) : null;
  }
  function wake() { if (!raf) { lastY = y; raf = requestAnimationFrame(frame); } }
  window.addEventListener('scroll', () => { y = window.scrollY; wake(); }, { passive: true });
  wake();
}

// ------------------------------------------------------ scroll progress
function initProgress() {
  const bar = document.querySelector('[data-js="scroll-progress"]');
  if (!bar) return;
  // The scrollable length is cached and refreshed when the page changes
  // size, and the position is taken in the scroll event, where reading it is
  // free. Read in the frame, either one forced an early layout whenever a
  // reveal had just dirtied the page.
  let max = 0;
  let y = window.scrollY;
  let queued = false;
  const paint = () => {
    queued = false;
    bar.style.setProperty('--p', max > 0 ? Math.min(1, y / max).toFixed(4) : '0');
  };
  const q = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  const measure = () => { max = root.scrollHeight - window.innerHeight; q(); };
  window.addEventListener('scroll', () => { y = window.scrollY; q(); }, { passive: true });
  window.addEventListener('resize', measure);
  new ResizeObserver(measure).observe(document.body);
  measure();
}

// ------------------------------------------------------------ spotlight
function initSpotlights() {
  if (!FINE || REDUCED_MOTION) return;
  document.querySelectorAll('[data-spotlight]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(0)}px`);
      el.style.setProperty('--my', `${(e.clientY - r.top).toFixed(0)}px`);
    }, { passive: true });
    el.addEventListener('pointerenter', () => el.classList.add('is-lit'));
    el.addEventListener('pointerleave', () => el.classList.remove('is-lit'));
  });
}

// -------------------------------------------------------- tilt
/**
 * [data-tilt] cards lean toward the cursor in 3D. Sets --rx / --ry (degrees)
 * and --px / --py (0–100%, for a highlight that tracks the pointer) on the
 * element; the stylesheet decides what to do with them. Fine pointers only.
 */
function initTilts() {
  if (!FINE || REDUCED_MOTION) return;
  document.querySelectorAll('[data-tilt]').forEach((el) => {
    const max = Number(el.dataset.tilt) || 8;
    let raf = 0;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
        el.style.setProperty('--px', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--py', `${(y * 100).toFixed(1)}%`);
      });
    }, { passive: true });
    el.addEventListener('pointerleave', () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  });
}

// -------------------------------------------------------- hover preview
/**
 * One floating plate, shared by every [data-preview] link: the event's photo
 * trails the cursor and leans into the direction of travel. Decorative only —
 * the link text already names the event.
 */
function initPreviews() {
  const links = [...document.querySelectorAll('[data-preview]')];
  if (!links.length || !FINE || REDUCED_MOTION) return;

  const plate = document.createElement('div');
  plate.className = 'hover-preview';
  plate.setAttribute('aria-hidden', 'true');
  plate.innerHTML = '<img alt="">';
  document.body.appendChild(plate);
  const img = plate.firstElementChild;

  const t = { x: 0, y: 0 };
  const c = { x: 0, y: 0, r: 0 };
  let raf = null;
  let on = false;

  const render = () => {
    const dx = t.x - c.x;
    c.x += dx * 0.14;
    c.y += (t.y - c.y) * 0.14;
    c.r += (Math.max(-14, Math.min(14, dx * 0.06)) - c.r) * 0.12;
    plate.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) rotate(${c.r.toFixed(2)}deg)`;
    raf = on || Math.abs(dx) > 0.5 ? requestAnimationFrame(render) : null;
  };

  window.addEventListener('pointermove', (e) => {
    t.x = e.clientX + 24;
    t.y = e.clientY - 90;
  }, { passive: true });

  links.forEach((a) => {
    a.addEventListener('pointerenter', (e) => {
      const src = a.dataset.preview;
      if (!src) { plate.classList.remove('is-on'); on = false; return; }
      if (img.getAttribute('src') !== src) img.src = src;
      if (!on && !plate.classList.contains('is-on')) {
        c.x = t.x = e.clientX + 24;
        c.y = t.y = e.clientY - 90;
      }
      on = true;
      plate.classList.add('is-on');
      if (!raf) raf = requestAnimationFrame(render);
    });
    a.addEventListener('pointerleave', () => {
      on = false;
      plate.classList.remove('is-on');
    });
  });
}

// ------------------------------------------------------------ highlight
function splitWords(el) {
  const words = [];
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const parts = n.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        parts.forEach((p) => {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
          const w = document.createElement('span');
          w.className = 'hw';
          w.textContent = p;
          words.push(w);
          frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) {
        walk(n);
      }
    });
  };
  walk(el);
  return words;
}

function initHighlights(ctx) {
  const els = document.querySelectorAll('[data-highlight]');
  if (!els.length || !ctx) return;
  const { gsap } = ctx;
  els.forEach((el) => {
    const words = splitWords(el);
    el.classList.add('is-highlighting');
    gsap.fromTo(words, { opacity: 0.14 }, {
      opacity: 1,
      ease: 'none',
      stagger: 0.12,
      scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 52%', scrub: 0.4 },
    });
  });
}

// ----------------------------------------------------------------- hero
/**
 * The entrance itself is CSS (keyed to html.hero-go, which the preloader or
 * the inline gate in _entry.ejs sets) so it never waits on this module. What
 * lives here is the part that needs a pointer and a scroll position.
 */
function whenHeroGo(fn) {
  if (root.classList.contains('hero-go')) { fn(); return; }
  const mo = new MutationObserver(() => {
    if (root.classList.contains('hero-go')) { mo.disconnect(); fn(); }
  });
  mo.observe(root, { attributes: true, attributeFilter: ['class'] });
}

function initHero(ctx) {
  const hero = document.getElementById('top');
  if (!hero || !hero.hasAttribute('data-hero-root')) return;

  // Labels decode on the entrance's clock — measured from when hero-go was
  // actually set (window.__heroGoAt), because this module can load well
  // after the CSS entrance began. A label whose moment has already passed is
  // left alone rather than scrambled after it has been read.
  whenHeroGo(() => {
    const elapsed = performance.now() - (window.__heroGoAt ?? performance.now());
    hero.querySelectorAll('[data-scramble]').forEach((el) => {
      const duration = Number(el.dataset.scramble) || 900;
      const delay = (Number(el.dataset.scrambleDelay) || 0) - elapsed;
      if (delay < -duration * 0.5) return;
      scramble(el, { duration, delay: Math.max(0, delay) });
    });
  });

  if (REDUCED_MOTION) return;

  // Pointer parallax: layers drift against the cursor by their own depth.
  // Written to --px/--py, consumed by the CSS `translate` property so it
  // composes with the entrance animation's `transform` instead of fighting it.
  if (FINE) {
    const t = { x: 0, y: 0 };
    const c = { x: 0, y: 0 };
    let raf = null;
    const step = () => {
      c.x += (t.x - c.x) * 0.06;
      c.y += (t.y - c.y) * 0.06;
      hero.style.setProperty('--px', c.x.toFixed(4));
      hero.style.setProperty('--py', c.y.toFixed(4));
      raf = Math.abs(t.x - c.x) + Math.abs(t.y - c.y) > 0.001 ? requestAnimationFrame(step) : null;
    };
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      t.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      t.y = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      t.x = 0; t.y = 0;
      if (!raf) raf = requestAnimationFrame(step);
    });
  }

  // Scroll-away: the fold recedes into depth as the page takes over.
  if (ctx) {
    const { gsap } = ctx;
    const main = hero.querySelector('.hero-main');
    if (main) {
      gsap.to(main, {
        yPercent: -14, scale: 0.94, opacity: 0.2, ease: 'none',
        scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
      });
    }
    const horizon = hero.querySelector('.hero-horizon');
    if (horizon) {
      gsap.to(horizon, {
        yPercent: 18, opacity: 0.3, ease: 'none',
        scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
      });
    }
  }
}

// ---------------------------------------------------------------- boot
initSplits();
initScrambles();
initProgress();
initSpotlights();
initTilts();
initPreviews();

(async () => {
  // Shares the single memoised scroll system with main.js / page.js — this
  // never creates a second Lenis. null under reduced motion.
  const ctx = await initScroll();
  initMarquees(ctx);
  initHero(ctx);
  initHighlights(ctx);
  ctx?.ScrollTrigger.refresh();
})();

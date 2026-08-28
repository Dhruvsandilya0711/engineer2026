// ==========================================================================
// Chrome shared by every page: nav, drawer, magnetic CTAs, countdown.
//
// Scroll behaviour lives in scroll.js and 3D fields in cognitrixx-3d.js —
// this file deliberately owns neither, so there is one implementation of each.
// ==========================================================================

export { initCursor } from '/js/cursor.js';

import { scrollTo } from '/js/scroll.js';

export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initNav() {
  const header = document.getElementById('site-nav');
  const toggle = document.querySelector('[data-js="nav-toggle"]');
  const close = document.querySelector('[data-js="nav-close"]');
  const drawer = document.getElementById('mobile-drawer');
  if (!header) return;

  // On the homepage the hero carries its own nav bays, so the fixed header
  // would duplicate them. It stays hidden until the hero has scrolled past —
  // the handoff drops the header entirely, but a long page (especially on a
  // phone) still needs navigation within reach.
  const deferred = header.hasAttribute('data-deferred');
  const heroEl = document.querySelector('#top');

  const onScroll = () => {
    if (deferred) {
      const past = window.scrollY > (heroEl ? heroEl.offsetHeight - 120 : 400);
      header.classList.toggle('is-revealed', past);
    }
    const scrolled = window.scrollY > 80;
    header.classList.toggle('bg-charcoal/90', scrolled);
    header.classList.toggle('backdrop-blur-md', scrolled);
    header.classList.toggle('border-b', scrolled);
    header.classList.toggle('border-[var(--hairline)]', scrolled);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (toggle && drawer) {
    const open = () => {
      drawer.classList.remove('translate-x-full');
      toggle.setAttribute('aria-expanded', 'true');
      document.documentElement.style.overflow = 'hidden';
    };
    const shut = () => {
      drawer.classList.add('translate-x-full');
      toggle.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
    };
    toggle.addEventListener('click', open);
    close?.addEventListener('click', shut);
    drawer.querySelectorAll('[data-js="drawer-link"]').forEach(a => a.addEventListener('click', shut));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); });
  }
}

export function initMagneticButtons() {
  if (REDUCED_MOTION) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  document.querySelectorAll('[data-js="magnetic"]').forEach((btn) => {
    btn.addEventListener('pointermove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
    });
    btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
  });
}

export function initCountdown() {
  document.querySelectorAll('[data-js="countdown"]').forEach((el) => {
    const target = new Date(el.dataset.target).getTime();
    const units = {
      days: el.querySelector('[data-unit="days"]'),
      hours: el.querySelector('[data-unit="hours"]'),
      minutes: el.querySelector('[data-unit="minutes"]'),
      seconds: el.querySelector('[data-unit="seconds"]'),
    };
    function tick() {
      const diff = Math.max(0, target - Date.now());
      const s = Math.floor(diff / 1000);
      if (units.days) units.days.textContent = String(Math.floor(s / 86400)).padStart(2, '0');
      if (units.hours) units.hours.textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
      if (units.minutes) units.minutes.textContent = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      if (units.seconds) units.seconds.textContent = String(s % 60).padStart(2, '0');
    }
    tick();
    setInterval(tick, 1000);
  });
}

/**
 * SCROLL RAIL — the vertical SCROLL / TOP marker on the left edge.
 *
 * It is one control with two meanings, decided by how much page is left:
 * a cue to keep going, then a way back once there is nothing below. Reading
 * scroll position on every event is cheap (no layout is forced — scrollY and
 * the cached document height only), so it stays passive.
 */
export function initScrollRail() {
  const rail = document.querySelector('[data-js="scroll-rail"]');
  if (!rail) return;

  const word = rail.querySelector('[data-js="scroll-rail-word"]');
  let atEnd = false;

  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    // "Nearly done" rather than "done": the flip has to happen while the
    // rail is still useful, not on the last pixel of travel.
    const next = max > 0 && window.scrollY > max - window.innerHeight * 0.75;
    if (next === atEnd) return;

    atEnd = next;
    rail.classList.toggle('is-end', atEnd);
    rail.setAttribute('aria-label', atEnd ? 'Back to top' : 'Scroll down');
    if (word) word.textContent = atEnd ? 'Top' : 'Scroll';
  };

  rail.addEventListener('click', () => {
    if (atEnd) scrollTo(0, { offset: 0 });
    else scrollTo(Math.round(window.scrollY + window.innerHeight * 0.9), { offset: 0 });
  });

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

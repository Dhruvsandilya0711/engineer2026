// ==========================================================================
// Behaviour shared by every page (homepage and inner pages alike).
// main.js (homepage) and page.js (inner pages) both build on this, so nav,
// reveals and the ambient field have exactly one implementation.
// ==========================================================================

import { initNeuralCanvas } from '/js/neural-network.js';

export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initNav() {
  const header = document.getElementById('site-nav');
  const toggle = document.querySelector('[data-js="nav-toggle"]');
  const close = document.querySelector('[data-js="nav-close"]');
  const drawer = document.getElementById('mobile-drawer');
  if (!header) return;

  const onScroll = () => {
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

export function initReveal() {
  const targets = [...document.querySelectorAll('[data-reveal]')];
  if (REDUCED_MOTION || !('IntersectionObserver' in window)) {
    targets.forEach(t => t.classList.add('is-visible'));
    return;
  }

  // Stagger comes from each element's position among its [data-reveal]
  // siblings, assigned once up front as a CSS transition-delay.
  // Previously the delay was `(batchIndex % 6) * 60`, where batchIndex was the
  // element's position in whatever group IntersectionObserver happened to
  // deliver — so the same element got a different delay on every scroll and
  // the sequencing looked random. This is deterministic.
  const perParent = new Map();
  targets.forEach((el) => {
    const parent = el.parentElement;
    const n = perParent.get(parent) || 0;
    perParent.set(parent, n + 1);
    const delay = Math.min(n, 5) * 70;
    if (delay) el.style.transitionDelay = `${delay}ms`;
  });

  // Fires a little earlier than before (was threshold .15 / -8% bottom margin)
  // so a section is already easing in as it enters the viewport instead of
  // popping once it is well inside it.
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -3% 0px' });

  targets.forEach(t => io.observe(t));
}

// The sitewide ambient field — the one every page gets behind its content.
export function initAmbientField() {
  const canvas = document.querySelector('canvas[data-canvas="neural"][data-tone="ambient"]');
  if (!canvas) return null;
  return initNeuralCanvas(canvas, { tone: 'ambient', density: 0.75, alphaScale: 0.72 });
}

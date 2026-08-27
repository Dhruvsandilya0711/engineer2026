// ==========================================================================
// ENGINEER '26 — homepage orchestration.
// Shared behaviour (nav, reveals, magnetic CTAs, countdown, ambient field)
// lives in site.js. This file adds only what is unique to the homepage: the
// entry sequence, the focus-aware hero field, the Three.js Penrose scene and
// the scroll-scrubbed transformation section.
// ==========================================================================

import { initNeuralCanvas } from '/js/neural-network.js';
import { initHeroScene } from '/js/hero-scene.js';
import {
  REDUCED_MOTION, initNav, initMagneticButtons, initCountdown, initReveal, initAmbientField,
} from '/js/site.js';

// -- Entry sequence --------------------------------------------------------
// "A system initializing" — text-only stages, ~1.2s, then gone from the DOM.
function initEntrySequence() {
  const el = document.getElementById('entry-sequence');
  if (!el) return;

  if (REDUCED_MOTION) {
    el.remove();
    return;
  }

  document.documentElement.style.overflow = 'hidden';
  const stages = el.querySelectorAll('.stage');
  const timings = [0, 260, 560, 850]; // ms — matches stages 0..3 in _entry.ejs

  stages.forEach((stage, i) => {
    setTimeout(() => stage.classList.add('is-active'), timings[i]);
  });
  setTimeout(() => el.classList.add('glitch-pulse'), timings[2]);

  setTimeout(() => {
    el.classList.add('is-hidden');
    document.documentElement.style.overflow = '';
    setTimeout(() => el.remove(), 550);
  }, 1200);
}

// -- Hero field ------------------------------------------------------------
// Aimed at the Penrose logo. Its signal pulses trigger the logo's rewire —
// glitch on arrival, never at random.
function initHeroField() {
  const canvas = document.querySelector('canvas[data-canvas="neural"][data-tone="amber"]');
  const logoFrame = document.querySelector('[data-js="hero-logo"]');
  if (!canvas) return null;

  let lastRewire = 0;
  const rewireLogo = () => {
    if (!logoFrame) return;
    const now = performance.now();
    if (now - lastRewire < 1900) return;
    lastRewire = now;
    logoFrame.classList.add('is-rewiring');
    setTimeout(() => logoFrame.classList.remove('is-rewiring'), 260);
  };

  const controller = initNeuralCanvas(canvas, {
    tone: 'amber',
    density: 0.8,
    alphaScale: 0.85,
    focusEl: logoFrame,
    onSignalArrive: rewireLogo,
  });

  // The logo's box only settles once fonts and the 3D scene have laid out.
  setTimeout(() => controller?.remeasure?.(), 1600);
  return controller;
}

// -- Cognitrixx transformation (pinned scroll storytelling) --------------
async function initTransformation() {
  const section = document.getElementById('transformation');
  const stages = section?.querySelectorAll('.transform-stage');
  const dots = section?.querySelectorAll('.dot');
  if (!section || !stages?.length) return;

  const canvas = section.querySelector('canvas[data-tone="transform"]');
  const field = canvas ? initNeuralCanvas(canvas, { tone: 'transform' }) : null;

  const setStage = (index) => {
    stages.forEach(s => s.classList.toggle('is-active', Number(s.dataset.stage) === index));
    dots?.forEach(d => d.classList.toggle('is-active', Number(d.dataset.dot) === index));
  };

  if (REDUCED_MOTION) {
    section.style.height = 'auto';
    section.querySelector('.sticky')?.classList.remove('sticky', 'h-screen');
    setStage(5);
    field?.setProgress(1);
    return;
  }

  let gsap, ScrollTrigger;
  try {
    ({ gsap } = await import('/vendor/gsap/index.js'));
    ({ ScrollTrigger } = await import('/vendor/gsap/ScrollTrigger.js'));
  } catch (e) {
    setStage(0); // vendor bundle unavailable — static, still legible
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      field?.setProgress(self.progress);
      setStage(Math.min(5, Math.floor(self.progress * 6)));
    },
  });
}

// -- Boot ----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initEntrySequence();
  initNav();
  initMagneticButtons();
  initCountdown();
  initReveal();

  initAmbientField();
  initHeroField();
  initTransformation();

  const heroLogoMount = document.querySelector('[data-js="hero-logo"]');
  if (heroLogoMount) initHeroScene(heroLogoMount);
});

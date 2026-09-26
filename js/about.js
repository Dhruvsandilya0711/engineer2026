// ==========================================================================
// About page — the scale figures counting up as they arrive.
//
// The numbers ARE the argument this page makes, so they land rather than
// simply being there. Deliberately small in scope: one IntersectionObserver,
// one rAF, and it disconnects as soon as it has fired.
//
// PROGRESSIVE: the real figure is server-rendered as the element's own text.
// This only replaces it while animating and writes it back at the end, so a
// visitor with JS off, or a failed module load, sees the finished number —
// never a zero that never moves.
// ==========================================================================

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const DURATION = 1100;

/**
 * Split "15K+" into { value: 15, suffix: "K+" } so the multiplier and the
 * plus travel with the number instead of being animated as digits.
 * Anything with no leading number is left alone entirely.
 */
function parse(text) {
  const m = String(text).trim().match(/^(\d+(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  return { value: parseFloat(m[1]), suffix: m[2] || '' };
}

// Decelerating: fast at the start, settling at the end. A linear count reads
// like a loading bar; this reads like a figure arriving.
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function run(els) {
  const parts = els
    .map((el) => ({ el, parsed: parse(el.dataset.count ?? el.textContent) }))
    .filter((p) => p.parsed);

  if (!parts.length) return;

  // Whole numbers stay whole while counting; a decimal keeps one place, so
  // "1.5K+" does not flicker through 1.4999.
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / DURATION);
    const k = easeOut(t);
    for (const { el, parsed } of parts) {
      const n = parsed.value * k;
      const shown = Number.isInteger(parsed.value) ? Math.round(n) : n.toFixed(1);
      el.textContent = `${shown}${parsed.suffix}`;
    }
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // Land on the authored string, not on our reconstruction of it — that
      // way the page always ends up showing exactly what the data said.
      for (const { el } of parts) el.textContent = el.dataset.count ?? el.textContent;
    }
  };
  requestAnimationFrame(step);
}

export function initCountUp() {
  const band = document.querySelector('[data-js="count-band"]');
  if (!band) return null;

  const els = [...band.querySelectorAll('[data-count]')];
  if (!els.length) return null;

  // Reduced motion asks for less movement, and a number ticking upward is
  // movement. The figure is already on screen; leave it.
  if (REDUCED_MOTION || typeof IntersectionObserver === 'undefined') return null;

  // Zero them only now — after every early-exit above — so a visitor who
  // never reaches the animation is never left looking at a 0.
  for (const el of els) {
    const p = parse(el.dataset.count ?? el.textContent);
    if (p) el.textContent = `0${p.suffix}`;
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.disconnect();          // once only; this is a reveal, not a loop
      run(els);
    }
  }, { threshold: 0.35 });

  io.observe(band);

  return { destroy() { io.disconnect(); } };
}

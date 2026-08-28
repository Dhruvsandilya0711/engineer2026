// ==========================================================================
// COGNITRIXX cursor.
//
// Three layers, each following the pointer at a different rate so the whole
// thing reads as one instrument with weight rather than a sticker glued to
// the mouse:
//
//   glow  — large soft bloom, heaviest lag. This is the "light source".
//   ring  — hairline reticle with crosshair ticks, medium lag.
//   dot   — 1:1 with the real pointer, zero lag, so precision never suffers.
//
// Only mounts on fine-pointer devices with motion allowed. Over text fields
// the native caret is restored — a custom cursor that hides the I-beam makes
// forms genuinely harder to use, and the registration form matters more than
// the effect.
// ==========================================================================

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Elements that should make the reticle react.
const INTERACTIVE = 'a, button, [role="button"], summary, .rail-card, .gallery-tile__link, .cat-chip, .event-row__link';
const TEXTUAL = 'input:not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]';

export function initCursor() {
  if (REDUCED_MOTION || !FINE_POINTER) return null;

  const root = document.createElement('div');
  root.className = 'cx-cursor';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="cx-glow"></div>
    <div class="cx-ring">
      <svg viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="17" class="cx-ring__circle"/>
        <line x1="24" y1="1"  x2="24" y2="7"  class="cx-ring__tick"/>
        <line x1="24" y1="41" x2="24" y2="47" class="cx-ring__tick"/>
        <line x1="1"  y1="24" x2="7"  y2="24" class="cx-ring__tick"/>
        <line x1="41" y1="24" x2="47" y2="24" class="cx-ring__tick"/>
      </svg>
    </div>
    <div class="cx-dot"></div>
  `;
  document.body.appendChild(root);
  document.documentElement.classList.add('cx-active');

  const glow = root.querySelector('.cx-glow');
  const ring = root.querySelector('.cx-ring');
  const dot = root.querySelector('.cx-dot');

  // target = true pointer; the rest chase it at their own rates.
  const t = { x: innerWidth / 2, y: innerHeight / 2 };
  const r = { x: t.x, y: t.y };
  const g = { x: t.x, y: t.y };

  let raf = null;
  let visible = false;
  let idleTimer = null;

  // Wake the cursor and re-arm the idle timer. A genuinely parked pointer
  // should not leave a static bloom — but only the GLOW is the blob, so idle
  // fades that layer alone (via .is-idle) and leaves the precision dot and
  // reticle in place. Previously idle removed .is-visible, which faded the
  // whole cursor away; combined with `cursor: none` that left no pointer at
  // all whenever the mouse sat still.
  function wake() {
    if (!visible) { visible = true; root.classList.add('is-visible'); }
    root.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add('is-idle'), 4000);
  }

  function onMove(e) {
    t.x = e.clientX;
    t.y = e.clientY;
    wake();

    // Restore the native caret over anything you type into.
    const overText = e.target instanceof Element && e.target.closest(TEXTUAL);
    root.classList.toggle('is-text', !!overText);
    document.documentElement.classList.toggle('cx-native', !!overText);

    const hot = e.target instanceof Element && e.target.closest(INTERACTIVE);
    root.classList.toggle('is-hot', !!hot);
  }

  // Scrolling is activity even when the mouse is still. Wheel / trackpad /
  // Lenis scrolling emits no pointermove, so on a long page (the deck) the
  // cursor used to fade out mid-scroll and only return on a mouse jiggle.
  function onScroll() {
    if (visible) wake();
  }

  function loop() {
    // Ring and glow lag by different amounts — that difference is what gives
    // the cursor its sense of mass.
    r.x += (t.x - r.x) * 0.19;
    r.y += (t.y - r.y) * 0.19;
    g.x += (t.x - g.x) * 0.085;
    g.y += (t.y - g.y) * 0.085;

    dot.style.transform  = `translate3d(${t.x}px, ${t.y}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${r.x}px, ${r.y}px, 0) translate(-50%, -50%)`;
    glow.style.transform = `translate3d(${g.x}px, ${g.y}px, 0) translate(-50%, -50%)`;

    raf = requestAnimationFrame(loop);
  }

  const onDown = () => root.classList.add('is-down');
  const onUp = () => root.classList.remove('is-down');
  const onLeave = () => { visible = false; root.classList.remove('is-visible'); };
  const onEnter = () => { visible = true; root.classList.add('is-visible'); };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerenter', onEnter);

  // Never burn frames on a hidden tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
    else if (!raf) raf = requestAnimationFrame(loop);
  });

  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerenter', onEnter);
      root.remove();
      document.documentElement.classList.remove('cx-active', 'cx-native');
    },
  };
}

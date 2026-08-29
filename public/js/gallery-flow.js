// ==========================================================================
// GALLERY FLOW — the COGNITRIXX neural archive.
//
// Event frames sit on a large 3D cylinder; the ring rotates on Y to flow them
// past. A cylinder is a closed loop, so the flow is seamless by construction.
// Inputs, all summed into one rotation:
//   • idle drift  — it never fully stops
//   • Lenis scroll velocity (shared scrollState — the one instance)
//   • drag / swipe — horizontal pointer drag scrubs the ring 1:1 with momentum
//   • prev/next buttons (desktop) — hold to keep scrolling, tap for a nudge
//
// No extra WebGL canvas (depth is CSS 3D; the neural spine renders behind).
// Pauses when off-screen or the tab is hidden.
// ==========================================================================

import { scrollState, REDUCED_MOTION } from '/js/scroll.js';

const RAD = Math.PI / 180;

export function initGalleryFlow() {
  const section = document.querySelector('[data-js="gallery"]');
  const stage = section?.querySelector('[data-js="gflow-stage"]');
  const ring = section?.querySelector('[data-js="gflow-ring"]');
  if (!section || !ring) return null;

  const cards = [...ring.querySelectorAll('.gflow__card')];
  const baseAngle = cards.map(c => parseFloat(c.dataset.a) || 0);
  const isSmall = window.innerWidth < 768;
  let radius = parseFloat(getComputedStyle(stage).getPropertyValue('--radius')) || 560;
  const degPerPx = () => 57.2958 / radius;

  // Auto motion off under reduced motion, but the user can still operate the
  // controls (that's user-initiated, which reduced-motion allows).
  const BASE = REDUCED_MOTION ? 0 : (isSmall ? 0.11 : 0.155);   // +50% flow speed
  const COUPLE = REDUCED_MOTION ? 0 : (isSmall ? 0.033 : 0.045);
  const HOLD = 1.6;      // deg/frame while a button is held
  const NUDGE = 4.5;     // deg impulse on a button tap / keypress

  let angle = 0, vel = 0;
  let held = 0;                 // -1 / 0 / +1 from the buttons
  const tilt = { x: 0, tx: 0, y: 0, ty: 0 };
  const drag = { on: false, locked: false, sx: 0, sy: 0, lx: 0, mom: 0 };
  let raf = null, running = false;

  function paint() {
    ring.style.transform =
      `translateZ(${-radius}px) rotateY(${angle.toFixed(3)}deg) rotateX(${tilt.x.toFixed(2)}deg)`;
    for (let i = 0; i < cards.length; i++) {
      const front = Math.cos((baseAngle[i] + angle) * RAD);
      cards[i].style.opacity = Math.max(0.14, Math.min(1, 0.34 + front * 0.78)).toFixed(3);
    }
  }
  paint(); // initial render (covers the reduced-motion static case)

  function frame() {
    const r = section.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    const cover = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const inView = Math.max(0, Math.min(1, cover / Math.min(r.height, vh)));

    if (drag.on) {
      vel = drag.mom;               // carry the throw velocity for release
    } else {
      const sv = Math.max(-70, Math.min(70, scrollState.velocity || 0));
      const drive = BASE * (0.3 + 0.7 * inView) + sv * COUPLE + held * HOLD;
      vel += (drive - vel) * 0.07;  // ease toward target -> momentum + settle
      angle += vel;
    }

    tilt.x += (tilt.tx - tilt.x) * 0.06;
    tilt.y += (tilt.ty - tilt.y) * 0.06;
    if (!isSmall) stage.style.setProperty('--pox', (tilt.y * 9).toFixed(2));

    // Skip the writes when genuinely still (reduced-motion idle) to save cycles.
    if (Math.abs(vel) > 0.0008 || held || drag.on || Math.abs(tilt.tx - tilt.x) > 0.01) {
      paint();
    }
    section.style.setProperty('--flow-in', inView.toFixed(3));
    raf = requestAnimationFrame(frame);
  }

  const vis = new IntersectionObserver((entries) => {
    const on = entries[0]?.isIntersecting;
    if (on && !running) {
      running = true;
      radius = parseFloat(getComputedStyle(stage).getPropertyValue('--radius')) || radius;
      raf = requestAnimationFrame(frame);
    } else if (!on && running) {
      running = false; cancelAnimationFrame(raf); raf = null;
    }
  }, { threshold: 0 });
  vis.observe(section);

  window.addEventListener('resize', () => {
    radius = parseFloat(getComputedStyle(stage).getPropertyValue('--radius')) || radius;
  }, { passive: true });

  // --- drag / swipe scrub -------------------------------------------------
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.gflow__nav')) return;   // buttons manage themselves
    drag.on = true; drag.locked = false; drag.mom = 0;
    drag.sx = drag.lx = e.clientX; drag.sy = e.clientY;
    try { stage.setPointerCapture(e.pointerId); } catch {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (drag.on) {
      const totX = e.clientX - drag.sx, totY = e.clientY - drag.sy;
      if (!drag.locked && (Math.abs(totX) > 6 || Math.abs(totY) > 6)) {
        drag.locked = true;
        if (Math.abs(totY) > Math.abs(totX)) { drag.on = false; return; } // vertical -> let the page scroll
      }
      if (drag.on) {
        const d = -(e.clientX - drag.lx) * degPerPx();
        angle += d; drag.mom = d; drag.lx = e.clientX;
      }
    } else if (!isSmall) {
      const b = stage.getBoundingClientRect();     // hover tilt
      tilt.tx = ((e.clientY - b.top) / b.height - 0.5) * -5;
      tilt.ty = ((e.clientX - b.left) / b.width - 0.5) * 2;
    }
  });
  const endDrag = () => { drag.on = false; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => { drag.on = false; tilt.tx = 0; tilt.ty = 0; });
  // Window-level safety: never leave a drag stuck (which would freeze the flow)
  // if a pointerup is missed outside the stage.
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // --- buttons (desktop): hold to scroll, tap to nudge --------------------
  const bind = (sel, dir) => {
    const btn = section.querySelector(sel);
    if (!btn) return;
    const down = (e) => { e.preventDefault(); e.stopPropagation(); held = dir; };
    const up = () => { held = 0; };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('blur', up);
    btn.addEventListener('click', () => { vel += dir * NUDGE; });  // keyboard / quick tap
  };
  bind('[data-js="gflow-prev"]', 1);
  bind('[data-js="gflow-next"]', -1);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) { running = false; cancelAnimationFrame(raf); raf = null; }
    else if (!document.hidden && !running) { running = true; raf = requestAnimationFrame(frame); }
  });

  return { destroy() { running = false; if (raf) cancelAnimationFrame(raf); vis.disconnect(); } };
}

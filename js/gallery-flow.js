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

import { scrollState, REDUCED_MOTION } from '/engineer2026/js/scroll.js?v=3299070';

const RAD = Math.PI / 180;

export function initGalleryFlow() {
  const section = document.querySelector('[data-js="gallery"]');
  const stage = section?.querySelector('[data-js="gflow-stage"]');
  const ring = section?.querySelector('[data-js="gflow-ring"]');
  if (!section || !ring) return null;

  const cards = [...ring.querySelectorAll('.gflow__card')];
  const baseAngle = cards.map(c => parseFloat(c.dataset.a) || 0);
  const isSmall = window.innerWidth < 768;
  // Same formula as --radius in input.css: the frames close the loop edge to
  // edge. CSS cannot hand back a resolved calc() through a custom property,
  // so it is measured here from the card width the stylesheet settled on.
  const measureRadius = () => {
    const gap = parseFloat(getComputedStyle(stage).getPropertyValue('--gap')) || 0;
    return (cards.length * (ring.offsetWidth + gap)) / (2 * Math.PI) || 560;
  };
  let radius = measureRadius();
  const degPerPx = () => 57.2958 / radius;

  // Auto motion off under reduced motion, but the user can still operate the
  // controls (that's user-initiated, which reduced-motion allows).
  // All speeds are deg/frame, tuned at the radius below. The radius now grows
  // with the number of photos, and the same angle covers more ground on a
  // bigger cylinder — so they are scaled to keep the on-screen speed as tuned.
  const TUNED_R = isSmall ? 360 : 1000;
  const BASE = REDUCED_MOTION ? 0 : (isSmall ? 0.11 : 0.155);   // +50% flow speed
  const COUPLE = REDUCED_MOTION ? 0 : (isSmall ? 0.033 : 0.045);
  const HOLD = 1.6;      // deg/frame while a button is held
  const NUDGE = 4.5;     // deg impulse on a button tap / keypress
  const k = () => TUNED_R / radius;

  let angle = 0, vel = 0;
  let held = 0;                 // -1 / 0 / +1 from the buttons
  const tilt = { x: 0, tx: 0, y: 0, ty: 0 };
  const drag = { on: false, locked: false, sx: 0, sy: 0, lx: 0, mom: 0 };
  let raf = null, running = false;
  // How much of the section is on screen (0..1), from the observer below
  // rather than measured in the frame: a getBoundingClientRect() there, after
  // Lenis and GSAP had written their styles, forced an early layout every
  // frame. `flowIn` eases toward it, so the observer's steps never show.
  let inView = 0, flowIn = 0, flowInWritten = -1, poxWritten = '';

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
    flowIn += (inView - flowIn) * 0.15;

    if (drag.on) {
      vel = drag.mom;               // carry the throw velocity for release
    } else {
      const sv = Math.max(-70, Math.min(70, scrollState.velocity || 0));
      const drive = (BASE * (0.3 + 0.7 * flowIn) + sv * COUPLE + held * HOLD) * k();
      vel += (drive - vel) * 0.07;  // ease toward target -> momentum + settle
      angle += vel;
    }

    tilt.x += (tilt.tx - tilt.x) * 0.06;
    tilt.y += (tilt.ty - tilt.y) * 0.06;
    // Custom properties are only written when they change: --flow-in is
    // inherited by the whole gallery, so every write restyled all of it.
    if (!isSmall) {
      const pox = (tilt.y * 9).toFixed(2);
      if (pox !== poxWritten) { poxWritten = pox; stage.style.setProperty('--pox', pox); }
    }

    // Skip the writes when genuinely still (reduced-motion idle) to save cycles.
    if (Math.abs(vel) > 0.0008 || held || drag.on || Math.abs(tilt.tx - tilt.x) > 0.01) {
      paint();
    }
    if (Math.abs(flowIn - flowInWritten) > 0.004) {
      flowInWritten = flowIn;
      section.style.setProperty('--flow-in', flowIn.toFixed(3));
    }
    raf = requestAnimationFrame(frame);
  }

  const vis = new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    const on = e?.isIntersecting;
    if (e) {
      const vh = e.rootBounds?.height || window.innerHeight || 1;
      inView = Math.max(0, Math.min(1, e.intersectionRect.height / Math.min(e.boundingClientRect.height || 1, vh)));
    }
    if (on && !running) {
      running = true;
      radius = measureRadius();
      raf = requestAnimationFrame(frame);
    } else if (!on && running) {
      running = false; cancelAnimationFrame(raf); raf = null;
    }
  }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
  vis.observe(section);

  window.addEventListener('resize', () => { radius = measureRadius(); }, { passive: true });

  // --- drag / swipe scrub -------------------------------------------------
  // The pointer is captured only once a gesture is known to be a horizontal
  // drag. Capturing on pointerdown would retarget the click of a plain tap to
  // the stage, and a tap on a frame has to reach its link to open the photo.
  // A drag, conversely, must never open one — `dragged` swallows that click.
  let dragged = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.gflow__nav')) return;   // buttons manage themselves
    drag.on = true; drag.locked = false; drag.mom = 0; dragged = false;
    drag.sx = drag.lx = e.clientX; drag.sy = e.clientY;
  });
  // Links and images are natively draggable; that would steal the gesture.
  stage.addEventListener('dragstart', (e) => e.preventDefault());
  stage.addEventListener('click', (e) => {
    if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; }
  }, true);
  stage.addEventListener('pointermove', (e) => {
    if (drag.on) {
      const totX = e.clientX - drag.sx, totY = e.clientY - drag.sy;
      if (!drag.locked && (Math.abs(totX) > 6 || Math.abs(totY) > 6)) {
        drag.locked = true;
        if (Math.abs(totY) > Math.abs(totX)) { drag.on = false; return; } // vertical -> let the page scroll
        dragged = true;
        try { stage.setPointerCapture(e.pointerId); } catch {}
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

  // Held while a page transition covers the screen (page-transition.js),
  // and picked up again if the page comes back from the back/forward cache.
  document.addEventListener('e26:leave', () => {
    if (running) { running = false; cancelAnimationFrame(raf); raf = null; }
  });
  document.addEventListener('e26:resume', () => {
    if (!running && !document.hidden && inView > 0) { running = true; raf = requestAnimationFrame(frame); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) { running = false; cancelAnimationFrame(raf); raf = null; }
    else if (!document.hidden && !running) { running = true; raf = requestAnimationFrame(frame); }
  });

  return { destroy() { running = false; if (raf) cancelAnimationFrame(raf); vis.disconnect(); } };
}

// ==========================================================================
// GALLERY LIGHTBOX — opens a gallery frame full size.
//
// A native modal <dialog> does the hard parts: focus trap, Esc to close, the
// rest of the page made inert, and focus handed back on close. This module
// only fills it in and steps through the photos.
//
// Each frame is a link straight to its full image, so where <dialog> is
// missing (Safari < 15.4) nothing is intercepted and a tap simply opens the
// photo. Taps that were really drags never get here: gallery-flow.js swallows
// those clicks before they reach a link.
// ==========================================================================

import { stopScroll, startScroll } from '/js/scroll.js';

export function initGalleryLightbox() {
  const section = document.querySelector('[data-js="gallery"]');
  const dialog = section?.querySelector('[data-js="glb"]');
  if (!dialog || typeof dialog.showModal !== 'function') return null;

  const links = [...section.querySelectorAll('[data-js="gflow-open"]')];
  if (!links.length) return null;

  const $ = (name) => dialog.querySelector(`[data-js="${name}"]`);
  const img = $('glb-img');
  const count = $('glb-count');
  const cat = $('glb-cat');
  const alt = $('glb-alt');
  const credit = $('glb-credit');

  const items = links.map((a) => ({
    full: a.dataset.full,
    thumb: a.querySelector('img')?.currentSrc || a.querySelector('img')?.src,
    w: +a.dataset.w,
    h: +a.dataset.h,
    alt: a.querySelector('img')?.alt || '',
    cat: a.dataset.cat || '',
    credit: a.dataset.credit || '',
  }));
  const n = items.length;
  let index = 0;
  let opener = null;

  const preload = (i) => { const im = new Image(); im.decoding = 'async'; im.src = items[(i + n) % n].full; };

  function show(i) {
    index = (i + n) % n;
    const it = items[index];
    // The thumb is already in cache, so something is on screen at once; the
    // full frame replaces it when it has decoded — unless the viewer has moved
    // on by then.
    img.width = it.w;
    img.height = it.h;
    img.alt = it.alt;
    img.src = it.thumb || it.full;
    const full = new Image();
    full.decoding = 'async';
    full.onload = () => { if (index === items.indexOf(it)) img.src = it.full; };
    full.src = it.full;

    count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
    cat.textContent = it.cat;
    alt.textContent = it.alt;
    credit.textContent = it.credit;
    preload(index + 1);
    preload(index - 1);
  }

  function open(i, from) {
    opener = from;
    show(i);
    dialog.showModal();
    stopScroll();
    document.documentElement.style.overflow = 'hidden';
  }

  dialog.addEventListener('close', () => {
    startScroll();
    document.documentElement.style.overflow = '';
    opener?.focus({ preventScroll: true });
  });

  links.forEach((a, i) => a.addEventListener('click', (e) => {
    // Let modified clicks (new tab, etc.) do what the user asked for.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    open(i, a);
  }));

  $('glb-close').addEventListener('click', () => dialog.close());
  $('glb-prev').addEventListener('click', () => show(index - 1));
  $('glb-next').addEventListener('click', () => show(index + 1));

  // A click on the dimmed backdrop (the dialog box itself, outside the
  // figure and buttons) closes it.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
  });

  // Swipe between photos on touch screens.
  let sx = null, sy = 0;
  dialog.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
  dialog.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
  });
  dialog.addEventListener('pointercancel', () => { sx = null; });

  return { open, close: () => dialog.close() };
}

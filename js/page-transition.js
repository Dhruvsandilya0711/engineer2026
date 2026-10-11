// ==========================================================================
// PAGE TRANSITION — the mark winds/unwinds across a navigation.
//
// This is a server-rendered multi-page site, so a transition has to span a
// real document swap. It is done in two halves that meet at the navigation:
//
//   leaving   veil drops, blades UNWIND into the assembled logo, then we
//             set a sessionStorage flag and hand over to the browser
//   arriving  the inline gate in _transition.ejs has already put the veil up
//             at first paint (so the new page never flashes in), the blades
//             fly back out past the camera as the veil fades. Back/forward
//             arrive the same way, from the gate or, out of the bfcache,
//             from pageshow below
//
// What keeps it smooth:
//   - the animation is transform and opacity only (input.css), so the
//     compositor runs it even while the page underneath is busy
//   - the page's own work stops while the veil covers it: the 3D scenes
//     pause (e26:leave) and smooth scrolling stops, so the GPU and the main
//     thread are free for the blades
//   - the next page is fetched ahead, on hover or touch (speculation rules
//     in _transition.ejs, or the fallback below), so by the time the cover
//     has played the document is usually already here and the new page
//     paints straight away
//   - the arriving page's 3D waits for the reveal to finish (pageRevealed)
//
// The first-visit preloader is a separate system and is left alone: it only
// runs when there is no transition flag, so the two never overlap.
// ==========================================================================

import { stopScroll, startScroll } from '/engineer2026/js/scroll.js?v=80f296e';

const FLAG = 'engi26.pt';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The veil's fade plus the last blade's unwind (input.css), so the new
// document is requested behind a fully covered screen.
const COVER_MS = REDUCED_MOTION ? 160 : 470;
// The blades' flight plus the veil's fade, as in the gate (_transition.ejs).
const REVEAL_MS = REDUCED_MOTION ? 180 : 620;
// If the browser is still on this page this long after being sent away (a
// navigation that was stopped, or turned into a download), it is given back.
const STRANDED_MS = 10000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves once an arriving page's veil has lifted (at once on a page that
 * was not reached through a transition). Heavy work that would compete with
 * the reveal, compiling the 3D scenes above all, waits for it.
 */
export function pageRevealed() {
  return window.__ptRevealed || Promise.resolve();
}

/**
 * Resolves the moment an arriving page's veil starts to lift (at once on a
 * page that was not reached through a transition). Entrance animations wait
 * for it, so on every page they play as the page appears, never early,
 * behind the logo.
 */
export function revealStarted() {
  return window.__ptRevealStart || Promise.resolve();
}

// A same-origin link to another page of this site, or null.
function pageLink(target) {
  const a = target?.closest?.('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return null;
  let url;
  try { url = new URL(a.href, location.href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  // Same-document jumps (deck cards, #top, the scroll rail) are not
  // navigations — those belong to initFanDeck and the anchor handlers.
  if (url.pathname === location.pathname && url.search === location.search) return null;
  // Files (the gallery's full-size photos, PDFs) are not pages.
  if (/\.(?:jpe?g|png|webp|gif|svg|pdf|mp4|zip)$/i.test(url.pathname)) return null;
  return url;
}

// Whether the browser runs the speculation rules in _transition.ejs.
const SPECULATES = !!(window.HTMLScriptElement?.supports?.('speculationrules'));

// Fetch a page ahead of the click, once, where speculation rules are not
// supported. The browser keeps a prefetched document for a few minutes.
const fetched = new Set();
function prefetch(url) {
  const key = url.pathname + url.search;
  if (fetched.has(key)) return;
  fetched.add(key);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = url.href;
  document.head.appendChild(link);
}

export function initPageTransition() {
  const veil = document.querySelector('[data-js="page-transition"]');
  if (!veil) return;

  const root = document.documentElement;
  let leaving = false;

  // ---- arriving half -----------------------------------------------------
  // The inline gate in _transition.ejs plays the reveal on a fresh load. A
  // page restored from the back/forward cache never runs that gate, so it
  // gets the same reveal here (see pageshow below), cut straight to the held
  // logo so it opens like every other arrival.
  function revealRestored() {
    if (REDUCED_MOTION) return;
    veil.style.transition = 'none';
    root.classList.add('pt-arriving');
    veil.getBoundingClientRect();           // take the held pose without easing into it
    veil.style.transition = '';
    veil.classList.add('is-active');
    requestAnimationFrame(() => {
      veil.classList.add('is-revealing');
      root.classList.remove('pt-arriving');
      setTimeout(() => veil.classList.remove('is-active', 'is-revealing'), REVEAL_MS);
    });
  }

  // ---- fetching ahead ------------------------------------------------------
  // Chrome and Edge do this from the speculation rules in _transition.ejs.
  // Elsewhere: a short dwell on a link (a pass of the pointer across the nav
  // should not fetch every page), and at once on a touch, which is a tap on
  // its way.
  if (!SPECULATES) {
    let dwell = 0;
    document.addEventListener('pointerover', (e) => {
      const url = pageLink(e.target);
      clearTimeout(dwell);
      if (url) dwell = setTimeout(() => prefetch(url), 80);
    }, { passive: true });
    document.addEventListener('touchstart', (e) => {
      const url = pageLink(e.target);
      if (url) prefetch(url);
    }, { passive: true });
  }

  // ---- leaving half ------------------------------------------------------
  async function leaveTo(url) {
    if (leaving) return;
    leaving = true;
    // A timestamp, not a plain flag: the arriving page honours it for a few
    // seconds only, so a navigation that never completes cannot make some
    // later page open with a reveal out of nowhere.
    try { sessionStorage.setItem(FLAG, String(Date.now())); } catch { /* non-fatal */ }
    if (!SPECULATES) prefetch(url);
    // Everything that animates underneath stops: the veil is about to hide
    // it, and the blades get the whole frame budget.
    stopScroll();
    document.dispatchEvent(new CustomEvent('e26:leave'));
    // The music fades out under the veil (public/js/audio.js) instead of
    // being cut off when the document goes; the next page fades it back in.
    document.dispatchEvent(new CustomEvent('e26:music:leave'));
    veil.classList.add('is-active', 'is-covering');
    await wait(COVER_MS);
    window.location.href = url.href;
    // Still here long after? The navigation was stopped or became a
    // download: give the page back rather than leave it under the logo.
    setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      try { sessionStorage.removeItem(FLAG); } catch { /* non-fatal */ }
      restore();
    }, STRANDED_MS);
  }

  // Undo the leaving half: veil down, scrolling and the scenes running.
  function restore() {
    leaving = false;
    veil.classList.remove('is-active', 'is-covering', 'is-revealing');
    root.classList.remove('pt-arriving');
    startScroll();
    document.dispatchEvent(new CustomEvent('e26:resume'));
  }

  document.addEventListener('click', (e) => {
    // Let the browser handle anything that isn't a plain left-click.
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = pageLink(e.target);
    if (!url) return;
    e.preventDefault();
    leaveTo(url);
  });

  // Coming back via bfcache: the page would otherwise be restored with the
  // veil still painted over it and everything underneath paused. It is
  // brought back to life and opened with the reveal, like any arrival.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    restore();
    revealRestored();
  });
}

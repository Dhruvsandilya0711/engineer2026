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
//             wind back out, and the veil lifts
//
// The first-visit preloader is a separate system and is left alone: it only
// runs when there is no transition flag, so the two never overlap.
// ==========================================================================

const FLAG = 'engi26.pt';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Long enough for the veil (320ms) plus the last blade's unwind, so the new
// document is requested behind a fully-covered screen.
const COVER_MS = REDUCED_MOTION ? 160 : 900;
// No deliberate hold on arrival: the module already loads after the document,
// and CSS holds the mark assembled until then (.pt-arriving), so any extra
// wait here just extends a pause the viewer is already sitting through.
const REVEAL_HOLD_MS = 0;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

export function initPageTransition() {
  const veil = document.querySelector('[data-js="page-transition"]');
  if (!veil) return;

  const root = document.documentElement;
  let leaving = false;

  // ---- arriving half -----------------------------------------------------
  // Normally the inline gate in _transition.ejs has already played the reveal
  // by now — it runs at DOMContentLoaded instead of waiting for this module,
  // which sits behind the whole three/gsap/lenis graph. This branch is the
  // fallback for when that script did not run.
  if (!window.__engiPtArrival) {
    let arriving = false;
    try {
      arriving = sessionStorage.getItem(FLAG) === '1';
      if (arriving) sessionStorage.removeItem(FLAG);
    } catch { /* private mode: just skip the reveal */ }

    if (arriving) {
      veil.classList.add('is-active');
      requestAnimationFrame(async () => {
        await wait(REVEAL_HOLD_MS);
        veil.classList.add('is-revealing');
        await wait(REDUCED_MOTION ? 120 : 700);
        veil.classList.remove('is-active', 'is-revealing');
        root.classList.remove('pt-arriving');
      });
    } else {
      // No transition inbound — make sure the gate class can never strand the
      // veil over the page (e.g. a restored bfcache entry).
      root.classList.remove('pt-arriving');
    }
  }

  // ---- leaving half ------------------------------------------------------
  async function leaveTo(url) {
    if (leaving) return;
    leaving = true;
    try { sessionStorage.setItem(FLAG, '1'); } catch { /* non-fatal */ }
    veil.classList.add('is-active', 'is-covering');
    await wait(COVER_MS);
    window.location.href = url;
  }

  document.addEventListener('click', (e) => {
    // Let the browser handle anything that isn't a plain left-click.
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const a = e.target.closest?.('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;

    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (url.origin !== location.origin) return;
    // Same-document jumps (deck cards, #top, the scroll rail) are not
    // navigations — those belong to initFanDeck and the anchor handlers.
    if (url.pathname === location.pathname && url.search === location.search) return;

    e.preventDefault();
    leaveTo(url.href);
  });

  // Coming back via bfcache would otherwise restore the page with the veil
  // still painted over it.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    leaving = false;
    veil.classList.remove('is-active', 'is-covering', 'is-revealing');
    root.classList.remove('pt-arriving');
  });
}

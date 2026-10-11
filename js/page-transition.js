// ==========================================================================
// PAGE TRANSITION — the outgoing half of the native view transition.
//
// The swap itself is the browser's (`@view-transition { navigation: auto }`
// in input.css): it holds the old page until the new one can paint, then the
// stylesheet animates one into the other. Links are left alone, so nothing
// here delays a navigation by a single frame.
//
// What this module adds on the way out:
//   - the picture that should fly into the next page is named, and a note is
//     left for the arriving page (views/partials/_transition.ejs) to name
//     its partner: a competition card's image into the event header, and the
//     header back into its card
//   - the custom cursor and the hover preview are hidden, so they are not
//     frozen into the snapshot of the page that slides away
//   - the music begins to fade (public/js/audio.js)
//   - a hairline runs across the top while the next page is on its way, so
//     a click on a slow connection still answers at once
// ==========================================================================

const KEY = 'engi26.vt';
const NAME = 'event-media';

const named = new Set();
const name = (el) => {
  if (!el) return;
  el.style.viewTransitionName = NAME;
  named.add(el);
};
const note = (v) => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

const slugOf = (path) => (String(path).match(/\/events\/([^/]+)/) || [])[1] || '';
const isList = (path) => /\/competitions\/?(index\.html)?$/.test(path);

export function initPageTransition() {
  const root = document.documentElement;
  const here = location.pathname;
  const onEvent = !!slugOf(here) && !!document.querySelector('[data-vt-media]');

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (url.origin !== location.origin) return;
    if (url.pathname === here && url.search === location.search) return;

    // A competition card: its picture becomes the event page's header.
    const card = a.closest('[data-vt-slug]');
    if (card) {
      name(card.querySelector('img'));
      note({ to: 'event', path: url.pathname });
    } else if (onEvent && isList(url.pathname)) {
      // Back to the list from an event page: the header returns to its card.
      name(document.querySelector('[data-vt-media]'));
      note({ to: 'list', slug: slugOf(here) });
    }
    root.classList.add('is-navigating');
  });

  // The browser's own back button never passes through the click above. The
  // Navigation API (where there is one) says where the page is going.
  window.addEventListener('pageswap', (e) => {
    if (!e.viewTransition) return;
    const dest = e.activation?.entry?.url;
    if (onEvent && dest && !named.size) {
      try {
        if (isList(new URL(dest).pathname)) {
          name(document.querySelector('[data-vt-media]'));
          note({ to: 'list', slug: slugOf(here) });
        }
      } catch { /* malformed URL: no flight, the sheet still runs */ }
    }
    root.classList.add('vt-leaving');
    document.dispatchEvent(new CustomEvent('e26:music:leave'));
  });

  // Restored from the back/forward cache: undo everything the leaving half
  // did, or the page comes back with its cursor hidden and a picture named.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    root.classList.remove('is-navigating', 'vt-leaving');
    named.forEach((el) => { el.style.viewTransitionName = ''; });
    named.clear();
  });
}

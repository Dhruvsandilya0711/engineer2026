// ==========================================================================
// TEAM — tap to flip a card to its punchline.
//
// On a mouse the card flips on hover (pure CSS). A touch screen has no
// hover, so a tap toggles .is-open instead: one card open at a time, and a
// tap anywhere else closes it. Enter / Space do the same from the keyboard.
// ==========================================================================

const cards = [...document.querySelectorAll('[data-js="team-card"][aria-expanded]')];
let open = null;

function setOpen(card, on) {
  card.classList.toggle('is-open', on);
  card.setAttribute('aria-expanded', String(on));
}

cards.forEach((card) => {
  card.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;            // links inside still work
    if (open && open !== card) setOpen(open, false);
    const on = !card.classList.contains('is-open');
    setOpen(card, on);
    open = on ? card : null;
  });
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    card.click();
  });
});

document.addEventListener('click', (e) => {
  if (open && !e.target.closest('[data-js="team-card"]')) { setOpen(open, false); open = null; }
});

// Only the cards near the screen keep their orbit and shine running. Each
// is a looping animation on its own compositor layer, and with forty cards
// the off-screen ones were most of the team page's per-frame layer work.
// The stylesheet stops a card's loops until it is marked .is-near.
if ('IntersectionObserver' in window) {
  const near = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.target.classList.toggle('is-near', e.isIntersecting));
  }, { rootMargin: '25% 0px' });
  document.querySelectorAll('.tcard-cell').forEach((cell) => near.observe(cell));
} else {
  document.querySelectorAll('.tcard-cell').forEach((cell) => cell.classList.add('is-near'));
}

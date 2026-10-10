// ==========================================================================
// TEAM — tap to open a card's punchline.
//
// On a mouse the punchline unfolds on hover (pure CSS). A touch screen has
// no hover, so a tap toggles .is-open instead: one card open at a time, and
// a tap anywhere else closes it. Enter / Space do the same from the keyboard.
// ==========================================================================

const cards = [...document.querySelectorAll('.crew[aria-expanded]')];
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
  if (open && !e.target.closest('.crew')) { setOpen(open, false); open = null; }
});

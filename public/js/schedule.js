// Day tabs for /schedule — progressive enhancement only.
// Every day is rendered server-side and visible by default, so with JS off the
// full timetable is still reachable; this just narrows the view to one day.

const tabs = document.querySelector('[data-js="day-tabs"]');
const blocks = [...document.querySelectorAll('[data-js="day-block"]')];

if (tabs && blocks.length) {
  const buttons = [...tabs.querySelectorAll('button[data-day]')];

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const day = btn.dataset.day;

      buttons.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });

      blocks.forEach((block) => {
        block.hidden = day !== 'all' && block.dataset.day !== day;
      });

      const params = new URLSearchParams();
      if (day !== 'all') params.set('day', day);
      const qs = params.toString();
      history.replaceState(null, '', qs ? `/schedule?${qs}` : '/schedule');
    });
  });

  // Honour ?day=… on load so a filtered view is shareable.
  const wanted = new URLSearchParams(location.search).get('day');
  if (wanted) {
    const match = buttons.find(b => b.dataset.day === wanted);
    if (match) match.click();
  }
}

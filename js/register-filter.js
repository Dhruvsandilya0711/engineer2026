// ==========================================================================
// Progressive enhancement for /register: instant search and filters.
//
// The page already filters server-side from query params (q, status,
// category), so everything works with JavaScript off. This does the same
// filtering in place as you type or tap a chip, hides a section that has
// nothing left in it, and keeps the URL in step so a filtered view is
// shareable and survives a reload.
// ==========================================================================

const form = document.querySelector('[data-js="reg-filter"]');
if (form) {
  const search = form.querySelector('[data-js="reg-search"]');
  const statusChips = [...form.querySelectorAll('[data-js="reg-status"]')];
  const catChips = [...form.querySelectorAll('[data-js="reg-cat"]')];
  const items = [...document.querySelectorAll('[data-js="reg-item"]')];
  const sections = [...document.querySelectorAll('[data-js="reg-section"]')];
  const count = document.querySelector('[data-js="reg-count"]');
  const empty = document.querySelector('[data-js="reg-empty"]');
  const reset = document.querySelector('[data-js="reg-reset"]');
  const resetLink = document.querySelector('[data-js="reg-reset-link"]');

  let status = form.dataset.status || 'all';
  let category = form.dataset.category || 'All';

  // Does the page hold every event? The live server only renders what
  // matched the URL's filters, so after a filtered first load a change has
  // to reload once to widen. The static GitHub Pages build always holds
  // everything, and there the filters in the URL are applied right here.
  const complete = items.length === Number(form.dataset.total);
  const fromUrl = new URLSearchParams(location.search);
  if (complete && fromUrl.toString()) {
    if (search && fromUrl.get('q')) search.value = fromUrl.get('q');
    const st = fromUrl.get('status');
    if (statusChips.some((c) => c.dataset.val === st)) status = st;
    const cat = fromUrl.get('category');
    if (catChips.some((c) => c.dataset.val === cat)) category = cat;
  }

  const press = (chips, val) => chips.forEach((c) => {
    const on = c.dataset.val === val;
    c.classList.toggle('is-active', on);
    c.setAttribute('aria-pressed', String(on));
  });

  function apply() {
    const q = (search?.value || '').trim().toLowerCase();
    let shown = 0;
    items.forEach((it) => {
      const ok = (!q || it.dataset.search.includes(q))
        && (status === 'all' || it.dataset.status === status)
        && (category === 'All' || it.dataset.cat === category);
      it.hidden = !ok;
      if (ok) shown++;
    });
    sections.forEach((sec) => {
      const n = sec.querySelectorAll('[data-js="reg-item"]:not([hidden])').length;
      sec.hidden = n === 0;
      const label = sec.querySelector('[data-js="reg-section-count"]');
      if (label) label.textContent = String(n);
    });
    if (count) count.textContent = String(shown);
    if (empty) empty.hidden = shown !== 0;
    const filtered = Boolean(q) || status !== 'all' || category !== 'All';
    if (reset) reset.hidden = !filtered;

    const params = new URLSearchParams();
    if (q) params.set('q', search.value.trim());
    if (status !== 'all') params.set('status', status);
    if (category !== 'All') params.set('category', category);
    const qs = params.toString();
    history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
  }

  // Arrived on a filtered URL: the page holds only the matches, so changing
  // a filter reloads once with the new query (fast, and still correct).
  const go = () => {
    if (complete) { apply(); return; }
    const params = new URLSearchParams();
    const q = (search?.value || '').trim();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    if (category !== 'All') params.set('category', category);
    const qs = params.toString();
    location.href = qs ? `${location.pathname}?${qs}` : location.pathname;
  };

  search?.addEventListener('input', () => { if (complete) apply(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); go(); });

  statusChips.forEach((chip) => chip.addEventListener('click', (e) => {
    e.preventDefault();
    status = chip.dataset.val;
    press(statusChips, status);
    go();
  }));
  catChips.forEach((chip) => chip.addEventListener('click', (e) => {
    e.preventDefault();
    category = chip.dataset.val;
    press(catChips, category);
    go();
  }));

  const clear = (e) => {
    e?.preventDefault();
    if (search) search.value = '';
    status = 'all';
    category = 'All';
    press(statusChips, status);
    press(catChips, category);
    go();
  };
  reset?.addEventListener('click', clear);
  resetLink?.addEventListener('click', clear);

  press(statusChips, status);
  press(catChips, category);
  if (complete && fromUrl.toString()) apply();

  // Escape in the search box clears it.
  search?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) { search.value = ''; go(); }
  });
}

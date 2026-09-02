// ==========================================================================
// Progressive enhancement for /events.
//
// The server already filters via query params, so search and category
// filtering work fully with JavaScript disabled. This just makes it instant:
// with only ~14 events there's no reason to round-trip on every keystroke.
//
// It also keeps the URL in sync (history.replaceState) so a filtered view is
// still shareable and reload-safe.
// ==========================================================================

const form = document.querySelector('[data-js="event-filter-form"]');
if (form) {
  const search = form.querySelector('[data-js="event-search"]');
  const chips = [...form.querySelectorAll('[data-js="cat-chip"]')];
  const items = [...document.querySelectorAll('[data-js="event-item"]')];
  const countNum = document.querySelector('[data-js="count-num"]');
  const emptyLive = document.querySelector('[data-js="empty-live"]');
  const emptyServer = document.querySelector('[data-js="empty-state"]');
  const resetBtn = document.querySelector('[data-js="reset-live"]');
  const list = document.querySelector('[data-js="event-list"]');

  let activeCat = form.querySelector('[data-js="cat-chip"].is-active')?.dataset.cat || 'All';

  function apply() {
    const q = (search?.value || '').trim().toLowerCase();
    let shown = 0;

    items.forEach((item) => {
      const matchesQuery = !q
        || item.dataset.name.includes(q)
        || item.dataset.cat.toLowerCase().includes(q);
      const matchesCat = activeCat === 'All' || item.dataset.cat === activeCat;
      const visible = matchesQuery && matchesCat;
      item.hidden = !visible;
      if (visible) {
        shown++;
        // Renumber so the index always reads 01, 02, 03… for what's on screen.
        const idx = item.querySelector('.event-row__idx');
        if (idx) idx.textContent = String(shown).padStart(2, '0');
      }
    });

    if (countNum) countNum.textContent = String(shown);
    if (list) list.hidden = shown === 0;
    if (emptyLive) emptyLive.classList.toggle('hidden', shown !== 0);
    // The server-rendered empty state is replaced by the live one once JS runs.
    if (emptyServer) emptyServer.classList.add('hidden');

    // Keep the URL shareable.
    const params = new URLSearchParams();
    if (q) params.set('q', search.value.trim());
    if (activeCat && activeCat !== 'All') params.set('category', activeCat);
    const qs = params.toString();
    history.replaceState(null, '', qs ? `/events?${qs}` : '/events');
  }

  search?.addEventListener('input', apply);

  chips.forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.preventDefault(); // don't submit — filter in place
      activeCat = chip.dataset.cat;
      chips.forEach((c) => {
        const on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', String(on));
      });
      apply();
    });
  });

  resetBtn?.addEventListener('click', () => {
    if (search) search.value = '';
    activeCat = 'All';
    chips.forEach((c) => {
      const on = c.dataset.cat === 'All';
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    apply();
  });

  // Submitting with Enter should filter, not reload.
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
}

// --- Desktop hover preview (decorative; adds no new information) ----------
const preview = document.querySelector('[data-js="event-preview"]');
const previewImg = document.querySelector('[data-js="event-preview-img"]');
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (preview && previewImg && canHover && !reduced) {
  let raf = null, tx = 0, ty = 0, cx = 0, cy = 0;

  const render = () => {
    cx += (tx - cx) * 0.16;
    cy += (ty - cy) * 0.16;
    preview.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    raf = requestAnimationFrame(render);
  };

  document.querySelectorAll('.event-row__link').forEach((link) => {
    link.addEventListener('pointerenter', () => {
      // Some events have no photograph yet. Without this the panel would
      // stay open still showing the LAST event's image, captioning one
      // event with another's picture.
      const src = link.dataset.img;
      if (!src) { preview.classList.remove('is-visible'); return; }
      if (previewImg.getAttribute('src') !== src) previewImg.src = src;
      preview.classList.add('is-visible');
      if (!raf) raf = requestAnimationFrame(render);
    });
    link.addEventListener('pointerleave', () => {
      preview.classList.remove('is-visible');
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    });
  });

  window.addEventListener('pointermove', (e) => {
    tx = e.clientX + 28;
    ty = e.clientY - 110;
  }, { passive: true });
}

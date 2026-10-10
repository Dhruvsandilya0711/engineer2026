// ==========================================================================
// TEAM TREE — flowing gold lines between the cards.
//
// One SVG behind the cards (the cards sit above it, so a line only shows in
// the gaps), rebuilt whenever the tree changes size. On a desktop the lines
// follow the tree: the Convenor forks to the Chief Coordinators, they fork
// to the row below, each card of that row feeds the column under it, every
// column flows down row by row into the base row. On a phone the tree is a
// single column, so one gold thread runs down its middle, through the gaps
// between cards.
//
// Lines grow downward as the page scrolls to them and stay drawn; then a
// bead of light runs along each one now and then. Hovering a card lights
// the lines that touch it. Reduced motion: the lines drawn, still, no beads.
// ==========================================================================

const NS = 'http://www.w3.org/2000/svg';
const tree = document.querySelector('.tree');

if (tree && tree.querySelector('.tcard-cell')) init(tree);

function init(tree) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wide = matchMedia('(min-width: 1024px)');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tree-lines');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  tree.prepend(svg);

  let links = [];          // { d, a, b, len, cards: Set<li>, base, glow, bead, shown }
  const grown = new WeakSet();   // destination cards whose line has fully grown

  // ---- geometry: layout boxes relative to the tree --------------------------
  // offsetLeft/Top ignore transforms, so the reveal and hover motion of a
  // card never bends a line; a relatively shifted cell (.is-inward) is
  // counted, which is exactly where the card sits at rest.
  const box = (el) => {
    let x = 0, y = 0, e = el;
    while (e && e !== tree) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  };
  const cardsIn = (el) => [...el.querySelectorAll('.tcard-cell')];
  const span = (els) => {
    const bs = els.map(box);
    const x = Math.min(...bs.map((b) => b.x));
    const y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  };
  const top = (b) => ({ x: b.x + b.w / 2, y: b.y });
  const bottom = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h });

  // A soft S: leaves straight down, arrives straight down.
  const curve = (a, b) => {
    const k = (b.y - a.y) * 0.5;
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${a.x.toFixed(1)} ${(a.y + k).toFixed(1)} ${b.x.toFixed(1)} ${(b.y - k).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  };

  // ---- which lines -----------------------------------------------------------
  function plan() {
    const out = [];
    const add = (a, b, from, to) => out.push({ a, b, d: curve(a, b), cards: new Set([...from, ...to]), dest: to[0] });

    if (!wide.matches) {
      // One thread down the middle of the single column.
      const all = cardsIn(tree);
      const s = span(all);
      const x = tree.clientWidth / 2;
      add({ x, y: s.y }, { x, y: s.y + s.h }, [], [all[all.length - 1]]);
      out[0].thread = true;
      return out;
    }

    const tiers = [...tree.querySelectorAll('.tree__tier')].filter((t) => cardsIn(t).length);
    // Spine: each tier forks into every card of the tier below.
    for (let i = 0; i + 1 < tiers.length; i++) {
      const from = cardsIn(tiers[i]);
      const a = bottom(span(from));
      cardsIn(tiers[i + 1]).forEach((c) => add(a, top(box(c)), from, [c]));
    }
    // Columns: the nearest card of the last spine tier feeds each column,
    // then the column flows down cell by cell, base row included.
    const feed = tiers.length ? cardsIn(tiers[tiers.length - 1]) : [];
    ['left', 'centre', 'right'].forEach((id) => {
      const cells = [...tree.querySelectorAll(`.tree__wings .tree__cell--${id}, .tree__base .tree__cell--${id}`)]
        .filter((c) => cardsIn(c).length);
      if (!cells.length) return;
      const head = span(cardsIn(cells[0]));
      if (feed.length) {
        const mid = head.x + head.w / 2;
        const src = feed.map((c) => ({ c, b: box(c) }))
          .sort((p, q) => Math.abs(p.b.x + p.b.w / 2 - mid) - Math.abs(q.b.x + q.b.w / 2 - mid))[0];
        add(bottom(src.b), top(head), [src.c], cardsIn(cells[0]));
      }
      for (let k = 0; k + 1 < cells.length; k++) {
        const from = cardsIn(cells[k]);
        const to = cardsIn(cells[k + 1]);
        add(bottom(span(from)), top(span(to)), from, to);
      }
    });
    return out;
  }

  // ---- drawing ---------------------------------------------------------------
  function build() {
    const W = tree.clientWidth;
    const H = tree.scrollHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = `
      <defs>
        <linearGradient id="tl-gold" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">
          <stop offset="0" stop-color="#ffe7b0"/>
          <stop offset="0.5" stop-color="#f2c068"/>
          <stop offset="1" stop-color="#c98a2e"/>
        </linearGradient>
      </defs>
      <g class="tl-glows"></g>
      <g class="tl-lines"></g>
      <g class="tl-beads"></g>
      <g class="tl-ports"></g>`;
    // No SVG filters: a blur over a tree-sized group re-renders on every
    // frame a line grows or a bead moves. Wide, faint strokes under the thin
    // ones give the glow instead, at the cost of a plain stroke.
    const [gGlow, gLine, gBead, gPort] = ['.tl-glows', '.tl-lines', '.tl-beads', '.tl-ports'].map((s) => svg.querySelector(s));

    const mk = (tag, cls, parent, attrs) => {
      const el = document.createElementNS(NS, tag);
      el.setAttribute('class', cls);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      parent.appendChild(el);
      return el;
    };
    const port = (pt) => mk('circle', 'tl-port', gPort, { cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: '2.2' });

    links = plan();
    links.forEach((l, i) => {
      l.glow = mk('path', 'tl-glow', gGlow, { d: l.d });
      l.base = mk('path', 'tl-line', gLine, { d: l.d });
      l.len = l.base.getTotalLength();
      [l.glow, l.base].forEach((p) => p.style.setProperty('--len', l.len.toFixed(1)));
      if (!reduced) {
        // A short bright dash on a long gap, shifted by exactly one period
        // per loop: one bead runs the line, then it rests (on the long
        // phone thread the period is shorter than the line, so several run).
        const bead = l.thread ? 26 : 16;
        const gap = l.thread ? 520 : l.len * 2.4;
        const speed = l.thread ? 170 : 120;                  // px per second
        l.beads = ['tl-halo', 'tl-bead'].map((cls) => {
          const p = mk('path', cls, gBead, { d: l.d });
          p.style.strokeDasharray = `${bead} ${gap.toFixed(1)}`;
          p.style.setProperty('--from', String(bead));
          p.style.setProperty('--to', (-gap).toFixed(1));
          p.style.animationDuration = `${((bead + gap) / speed).toFixed(2)}s`;
          p.style.animationDelay = `${(-((i * 1.37) % 6)).toFixed(2)}s`;
          return p;
        });
      }
      // Small lit ports where a line leaves a card and where it arrives.
      if (!l.thread) { l.pa = port(l.a); l.pb = port(l.b); }
      l.shown = grown.has(l.dest) || reduced ? 1 : 0;
    });
    paint(true);
  }

  // ---- growth with the scroll ------------------------------------------------
  // A line grows as the viewport's lower part passes from its start to its
  // end, and never shrinks back.
  function paint(now) {
    const vh = innerHeight;
    const t = tree.getBoundingClientRect().top;
    links.forEach((l) => {
      if (l.shown < 1) {
        const y0 = t + l.a.y;
        const y1 = t + l.b.y;
        const edge = vh * 0.86;
        const p = Math.min(1, Math.max(0, (edge - y0) / Math.max(1, y1 - y0)));
        if (p > l.shown) l.shown = p;
        if (l.shown >= 1) grown.add(l.dest);
      }
      const off = (l.len * (1 - l.shown)).toFixed(1);
      l.base.style.strokeDashoffset = off;
      l.glow.style.strokeDashoffset = off;
      if (l.beads) l.beads.forEach((p) => p.classList.toggle('is-live', l.shown >= 1));
      if (l.pa) l.pa.classList.toggle('is-on', l.shown > 0);
      if (l.pb) l.pb.classList.toggle('is-on', l.shown >= 1);
    });
    if (now) svg.classList.add('is-ready');
  }

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (links.some((l) => l.shown < 1)) paint(); });
  };
  if (!reduced) addEventListener('scroll', onScroll, { passive: true });

  // ---- hover: light the lines that touch the card ------------------------------
  tree.addEventListener('pointerover', (e) => {
    const cell = e.target.closest('.tcard-cell');
    links.forEach((l) => l.base.classList.toggle('is-lit', !!cell && l.cards.has(cell)));
  });
  tree.addEventListener('pointerleave', () => links.forEach((l) => l.base.classList.remove('is-lit')));

  // ---- keep in step with the layout -----------------------------------------
  let rt = 0;
  const rebuild = () => { clearTimeout(rt); rt = setTimeout(build, 120); };
  new ResizeObserver(rebuild).observe(tree);
  wide.addEventListener('change', rebuild);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuild);
  addEventListener('load', rebuild);
  build();
}

// ==========================================================================
// Procedural neural / circuit field (Canvas2D — deliberately not WebGL, so
// the only GPU context on the page belongs to the hero logo scene; see
// design-system §09 "do not put WebGL on every section").
//
// THE CORE IDEA (brief §3 + §7): the field is not wallpaper. Around the hero
// it is aimed at the Penrose logo — a "focus" — and it enacts the color
// relationship the brief describes:
//
//     far from the logo  = AMBER      (COGNITRIXX: raw neural intelligence)
//     near the logo      = CYAN/VIOLET/MAGENTA (ENGINEER: engineered identity)
//
// so intelligence visibly REWIRES into the ENGINEER identity as it converges
// on the impossible object. Signal pulses travel inward along the links; when
// one reaches the logo it reports back via onSignalArrive so the logo can
// react. That makes the glitch *caused* by arriving information rather than
// random — brief §24 rules out random glitch.
//
// Two roles, one renderer:
//   tone "amber"     — hero field, focus-aware.
//   tone "transform" — same renderer, exposes setProgress(0..1) so the
//                      transformation section can morph chaotic amber into
//                      structured cyan circuitry on scroll.
//
// Perf: paused via IntersectionObserver + visibilitychange, capped DPR,
// single static frame under prefers-reduced-motion (no pulses, no glitch).
// ==========================================================================

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2;

const AMBER = [232, 146, 60];
const CYAN = [52, 216, 232];
const VIOLET = [123, 92, 250];
const MAGENTA = [226, 63, 209];
const ENGI = [CYAN, VIOLET, MAGENTA];

const rand = (min, max) => min + Math.random() * (max - min);
const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

export function initNeuralCanvas(canvas, opts = {}) {
  const {
    tone = 'amber',
    density = 1,
    alphaScale = 1,        // global dimmer — the sitewide ambient field runs low
    focusEl = null,        // element the field converges on (the hero logo)
    onSignalArrive = null, // called when a pulse reaches the focus
  } = opts;

  const ctx = canvas.getContext('2d');
  if (!ctx) return { setProgress() {}, destroy() {} };

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0, height = 0;
  let nodes = [];
  let pulses = [];
  let edges = [];          // reused each frame; candidates for pulse spawning
  let focus = null;        // { x, y, r } in canvas-local px
  let progress = 0;        // transform tone only
  let running = false, visible = true, rafId = null;
  let lastSpawn = 0;

  const isFocused = !!focusEl && tone === 'amber';

  function nodeCount() {
    const base = width < 640 ? 38 : width < 1024 ? 58 : 80;
    return Math.round(base * density);
  }

  function seed() {
    nodes = Array.from({ length: nodeCount() }, (_, i) => ({
      x: rand(0, width),
      y: rand(0, height),
      vx: rand(-0.07, 0.07),
      vy: rand(-0.07, 0.07),
      r: rand(1, 2.5),
      pulse: rand(0, TAU),
      engi: ENGI[i % ENGI.length], // which ENGINEER hue this node rewires into
    }));
    pulses = [];
  }

  // Where the field converges. Measured on resize only — calling
  // getBoundingClientRect every frame would thrash layout.
  function measureFocus() {
    if (!focusEl) { focus = null; return; }
    const cb = canvas.getBoundingClientRect();
    const fb = focusEl.getBoundingClientRect();
    if (!fb.width) { focus = null; return; }
    focus = {
      x: fb.left + fb.width / 2 - cb.left,
      y: fb.top + fb.height / 2 - cb.top,
      r: fb.width / 2,
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    measureFocus();
  }

  // 0 at the logo's edge, 1 far away — drives the amber→ENGINEER rewire ramp.
  // Ramped off the logo's own radius (not the viewport) so the rewire reads as
  // a property of the object, and stays consistent across screen sizes.
  function rewireT(x, y) {
    if (!focus) return 1;
    const d = Math.hypot(x - focus.x, y - focus.y);
    return Math.min(1, Math.max(0, (d - focus.r) / (focus.r * 2.8)));
  }

  // Brief §7: "the neural network should NOT obscure the logo". Nothing draws
  // inside the object's footprint — the field opens up around it, which also
  // makes the structure look like it's holding the network back.
  function clearZone(x, y) {
    if (!focus) return 1;
    const d = Math.hypot(x - focus.x, y - focus.y);
    const inner = focus.r * 1.02;
    const outer = focus.r * 1.62;
    if (d <= inner) return 0;
    if (d >= outer) return 1;
    return (d - inner) / (outer - inner);
  }

  function nodeColor(n) {
    if (tone === 'transform') {
      const mid = mix(AMBER, VIOLET, Math.min(progress * 2, 1));
      return mix(mid, CYAN, Math.max(progress * 2 - 1, 0));
    }
    if (!isFocused) return AMBER;
    return mix(n.engi, AMBER, rewireT(n.x, n.y)); // near → ENGI, far → amber
  }

  function spawnPulse(now) {
    if (!edges.length || pulses.length > 7) return;
    // Prefer edges that actually make progress toward the focus.
    for (let attempt = 0; attempt < 6; attempt++) {
      const e = edges[(Math.random() * edges.length) | 0];
      const a = nodes[e[0]], b = nodes[e[1]];
      if (!a || !b) continue;
      const da = focus ? Math.hypot(a.x - focus.x, a.y - focus.y) : 1;
      const db = focus ? Math.hypot(b.x - focus.x, b.y - focus.y) : 0;
      const from = da > db ? a : b;
      const to = da > db ? b : a;
      pulses.push({ from, to, t: 0, speed: rand(0.010, 0.020) });
      lastSpawn = now;
      return;
    }
  }

  function drawPulses() {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += p.speed;

      const px = p.from.x + (p.to.x - p.from.x) * p.t;
      const py = p.from.y + (p.to.y - p.from.y) * p.t;
      const [r, g, b] = mix(p.to.engi || CYAN, AMBER, rewireT(px, py));
      // Pulses dim as they meet the object — reads as absorption, and keeps
      // the clear zone clear.
      const cz = clearZone(px, py);

      ctx.fillStyle = `rgba(${r},${g},${b},${0.14 * cz})`;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(${r},${g},${b},${0.9 * cz})`;
      ctx.beginPath(); ctx.arc(px, py, 2.1, 0, TAU); ctx.fill();

      if (p.t >= 1) {
        // Arrived. If it landed on the logo, let the caller react.
        if (focus && onSignalArrive) {
          const d = Math.hypot(p.to.x - focus.x, p.to.y - focus.y);
          if (d < focus.r * 1.45) onSignalArrive();
        }
        pulses.splice(i, 1);
      }
    }
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    edges.length = 0;

    const jitter = tone === 'transform' ? 1 - progress * 0.7 : 1;
    const linkDist = tone === 'transform' ? 90 + progress * 40 : (width < 640 ? 105 : 125);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!REDUCED_MOTION) {
        n.x += n.vx * jitter;
        n.y += n.vy * jitter;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }

      for (let j = i + 1; j < nodes.length; j++) {
        const m = nodes[j];
        const dx = n.x - m.x, dy = n.y - m.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > linkDist * linkDist) continue;
        const dist = Math.sqrt(d2);

        const mx = (n.x + m.x) / 2, my = (n.y + m.y) / 2;
        const t = rewireT(mx, my);
        // Links tighten and brighten as they close on the logo — but only
        // modestly, and never inside its clear zone.
        const near = 1 - t;
        const alpha = (1 - dist / linkDist) * (0.13 + near * 0.20)
          * clearZone(mx, my) * alphaScale;
        if (alpha <= 0.004) continue;
        const [r, g, b] = tone === 'transform'
          ? nodeColor(n)
          : (isFocused ? mix(n.engi, AMBER, t) : AMBER);

        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = near > 0.65 ? 1.3 : 1;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();

        if (edges.length < 400) edges.push([i, j]);
      }
    }

    for (const n of nodes) {
      const [r, g, b] = nodeColor(n);
      const near = isFocused ? 1 - rewireT(n.x, n.y) : 0.4;
      const cz = clearZone(n.x, n.y);
      if (cz <= 0.01) continue;
      const flicker = REDUCED_MOTION ? 0.62 : 0.4 + Math.sin((time || 0) / 900 + n.pulse) * 0.18;
      const a = Math.min(1, flicker + near * 0.25) * cz * alphaScale;

      if (near > 0.6) { // halo only on the nodes closest to the structure
        ctx.fillStyle = `rgba(${r},${g},${b},${0.07 * near * cz * alphaScale})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 5, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + near * 0.6, 0, TAU); ctx.fill();
    }

    if (!REDUCED_MOTION && isFocused) {
      if ((time || 0) - lastSpawn > 420) spawnPulse(time || 0);
      drawPulses();
    }
  }

  function loop(time) {
    if (!running) return;
    draw(time);
    if (!REDUCED_MOTION && visible) rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    if (REDUCED_MOTION) draw(0); else rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible) start(); else stop();
  }, { threshold: 0 });
  io.observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else if (visible) start();
  });

  const onResize = () => { resize(); };
  window.addEventListener('resize', onResize, { passive: true });

  resize();
  start();

  return {
    setProgress(p) {
      progress = Math.max(0, Math.min(1, p));
      if (REDUCED_MOTION) draw(0);
    },
    remeasure: measureFocus,
    destroy() {
      stop();
      io.disconnect();
      window.removeEventListener('resize', onResize);
    },
  };
}

// ==========================================================================
// REWIRE REALITY — a real photograph, rewired by scrolling.
//
// Scroll progress p (0..1) through the pinned section drives three beats:
//   0.00–0.40  the photograph, dimming as its edges light up as dots
//   0.35–0.85  each dot travels from where the camera saw it onto one of a
//              set of ordered signal traces (staggered left to right)
//   0.80–1.00  the traces connect and pulses run along them
//
// Every dot is sampled from the photo's own edges (a Sobel pass on a small
// copy), so the network is the campus, rearranged — nothing drawn from
// nothing.
//
// THE HIGGS FIELD. The pointer is a field that gives dots mass. Each dot is
// a spring toward where the scroll wants it; inside the field its mass goes
// up, so it answers the spring sluggishly, swells, warms to amber and is
// drawn toward the pointer. Leave, and the mass drains away and it snaps
// back. Scroll while holding the field over the picture and you can watch
// heavy dots lag behind the rest.
//
// 2D canvas only — the page already runs WebGL fields; this must stay cheap
// on a phone. Paused off screen; one static frame per scroll under reduced
// motion.
// ==========================================================================

import { REDUCED_MOTION, IS_TOUCH } from '/js/scroll.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Site palette (tokens in input.css).
const LANE_RGB = [[31, 182, 173], [59, 111, 212], [111, 154, 224], [192, 106, 137], [31, 182, 173], [59, 111, 212]];
const AMBER = [240, 163, 67];

export function mountRewire() {
  const section = document.querySelector('[data-js="rewire"]');
  if (!section) return null;
  const canvas = section.querySelector('[data-js="rewire-canvas"]');
  const img = section.querySelector('[data-js="rewire-src"]');
  const video = section.querySelector('[data-js="rewire-video"]');
  const lines = [...section.querySelectorAll('[data-rw-line]')];
  const meter = section.querySelector('[data-js="rewire-meter"]');
  const ctx = canvas.getContext('2d');
  const small = window.innerWidth < 768;
  const N = small ? 2000 : 4200;
  const LANES = small ? 9 : 12;

  let W = 0, H = 0, dpr = 1;
  let pts = null;              // particles, built once the photo has decoded
  let laneOrder = [];          // per lane: particle indices sorted by target x
  let p = 0, lastP = -1;
  let raf = 0, running = false, onScreen = false;
  const field = { x: 0, y: 0, on: false, r: small ? 90 : 140, s: 0 };

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    field.r = Math.min(W, H) * (small ? 0.2 : 0.15);
  }

  // "cover" placement of the photo in the canvas, in canvas px.
  function cover() {
    const iw = 1920, ih = 1020;
    const s = Math.max(W / iw, H / ih);
    return { s, ox: (W - iw * s) / 2, oy: (H - ih * s) / 2, iw, ih };
  }

  // Sample N points from the photo's edges (Sobel magnitude on a 320px copy).
  function build() {
    const aw = 320, ah = Math.round(320 * 1020 / 1920);
    const off = document.createElement('canvas');
    off.width = aw; off.height = ah;
    const o = off.getContext('2d', { willReadFrequently: true });
    o.drawImage(img, 0, 0, aw, ah);
    const d = o.getImageData(0, 0, aw, ah).data;
    const g = new Float32Array(aw * ah);
    for (let i = 0; i < aw * ah; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const mag = new Float32Array(aw * ah);
    let max = 1;
    for (let y = 1; y < ah - 1; y++) for (let x = 1; x < aw - 1; x++) {
      const i = y * aw + x;
      const gx = g[i - aw + 1] + 2 * g[i + 1] + g[i + aw + 1] - g[i - aw - 1] - 2 * g[i - 1] - g[i + aw - 1];
      const gy = g[i + aw - 1] + 2 * g[i + aw] + g[i + aw + 1] - g[i - aw - 1] - 2 * g[i - aw] - g[i - aw + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m; if (m > max) max = m;
    }
    // Weighted sampling without replacement, deterministic (seeded) so the
    // network is the same on every visit.
    let seed = 20261023;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const out = [];
    let guard = 0;
    while (out.length < N && guard++ < N * 60) {
      const x = 1 + Math.floor(rnd() * (aw - 2)), y = 1 + Math.floor(rnd() * (ah - 2));
      // Strong edges only (rooflines, walls, roads): foliage texture is weak
      // and is filtered out, so the dots draw the campus, not noise.
      const e = mag[y * aw + x] / max;
      if (e < 0.16) continue;
      if (rnd() > Math.pow(e, 1.4) * 3) continue;
      const i = (y * aw + x) * 4;
      const u = (x + rnd() - 0.5) / aw, v = (y + rnd() - 0.5) / ah;
      out.push({
        u, v, c: [d[i], d[i + 1], d[i + 2]],
        lane: 0, tu: 0,
        // live state (canvas px), spring-driven
        x: 0, y: 0, vx: 0, vy: 0, m: 1, glow: 0,
        stagger: 0, jitter: rnd() * Math.PI * 2,
      });
    }
    // Rewired layout: each dot keeps its horizontal place but snaps to the
    // nearest of LANES horizontal traces, so the edges of the campus become
    // ordered signal lines.
    laneOrder = Array.from({ length: LANES }, () => []);
    out.forEach((q, i) => {
      q.lane = Math.min(LANES - 1, Math.floor(q.v * LANES));
      q.tu = q.u;
      q.stagger = q.u * 0.35;
      laneOrder[q.lane].push(i);
    });
    laneOrder.forEach((l) => l.sort((a, b) => out[a].tu - out[b].tu));
    pts = out;
    placeAll(true);
  }

  // Where the scroll wants dot q right now.
  function target(q, c) {
    const px = c.ox + q.u * c.iw * c.s, py = c.oy + q.v * c.ih * c.s;
    const top = H * 0.26, bottom = H * 0.9;
    const lx = W * (0.04 + q.tu * 0.92);
    const ly = top + (q.lane + 0.5) / LANES * (bottom - top);
    const m = ease(clamp01((p - 0.35 - q.stagger * 0.5) / 0.35));
    const wob = Math.sin(q.jitter + p * 9) * 2.2 * (1 - m);
    return { x: px + (lx - px) * m, y: py + (ly - py) * m + wob, m };
  }

  function placeAll(snap) {
    if (!pts) return;
    const c = cover();
    for (const q of pts) {
      const t = target(q, c);
      if (snap) { q.x = t.x; q.y = t.y; q.vx = q.vy = 0; }
    }
  }

  function step(dt, now) {
    const c = cover();
    const f = field;
    f.s += ((f.on ? 1 : 0) - f.s) * 0.12;
    for (const q of pts) {
      const t = target(q, c);
      q.tm = t.m;
      // Mass from the Higgs field: up to ~9x inside it, draining outside.
      let want = 1;
      if (f.s > 0.01) {
        const dx = q.x - f.x, dy = q.y - f.y;
        const d2 = dx * dx + dy * dy, r2 = f.r * f.r;
        if (d2 < r2) {
          const k = 1 - Math.sqrt(d2) / f.r;
          want = 1 + 8 * k * f.s;
          // Heavy dots are drawn in toward the field's centre.
          q.vx -= dx * 0.0025 * k * f.s * dt;
          q.vy -= dy * 0.0025 * k * f.s * dt;
        }
      }
      q.m += (want - q.m) * 0.15;
      q.glow = (q.m - 1) / 8;
      const kspring = 0.09 / q.m, damp = Math.pow(0.78, 1 / Math.sqrt(q.m));
      q.vx = (q.vx + (t.x - q.x) * kspring * dt) * damp;
      q.vy = (q.vy + (t.y - q.y) * kspring * dt) * damp;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
  }

  function drawPhoto(alpha) {
    if (alpha <= 0.002) return;
    const c = cover();
    ctx.globalAlpha = alpha;
    const src = video && video.readyState >= 2 ? video : img;
    ctx.drawImage(src, c.ox, c.oy, c.iw * c.s, c.ih * c.s);
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    const photoA = 1 - smooth(0.08, 0.3, p) * 0.82 - smooth(0.4, 0.62, p) * 0.18;
    drawPhoto(photoA * 0.92);
    // darken the photo as it hands over to the signal
    ctx.fillStyle = `rgba(5,7,13,${0.15 + 0.6 * smooth(0.05, 0.4, p)})`;
    ctx.fillRect(0, 0, W, H);
    if (!pts) return;

    const dotA = smooth(0.06, 0.28, p);
    const traceA = smooth(0.72, 0.92, p);

    // Traces: connect neighbours along each lane once dots have arrived.
    if (traceA > 0.01) {
      ctx.lineWidth = 1;
      for (let l = 0; l < LANES; l++) {
        const [r, g, b] = LANE_RGB[l % LANE_RGB.length];
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.32 * traceA})`;
        ctx.beginPath();
        const ord = laneOrder[l];
        for (let k = 0; k < ord.length; k++) {
          const q = pts[ord[k]];
          if (k === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
      }
      // Pulses: bright packets travelling along every trace.
      const t = now / 1000;
      for (let l = 0; l < LANES; l++) {
        const ord = laneOrder[l];
        if (ord.length < 2) continue;
        for (let s = 0; s < 2; s++) {
          const u = ((t * (0.08 + l * 0.009) + s * 0.5 + l * 0.137) % 1);
          const q = pts[ord[Math.floor(u * (ord.length - 1))]];
          const [r, g, b] = LANE_RGB[l % LANE_RGB.length];
          ctx.fillStyle = `rgba(${r},${g},${b},${0.9 * traceA})`;
          ctx.beginPath(); ctx.arc(q.x, q.y, 3.2, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // Dots.
    for (const q of pts) {
      const m = q.tm || 0;
      const [pr, pg, pb] = q.c;
      const [lr, lg, lb] = LANE_RGB[q.lane % LANE_RGB.length];
      // Before the rewire, dots are the photo's own colour lifted toward white so
      // the campus reads in them; after, they take their trace's colour.
      const lift = 0.55 * (1 - m);
      let r = pr + (255 - pr) * lift, g = pg + (255 - pg) * lift, b = pb + (255 - pb) * lift;
      r += (lr - r) * m; g += (lg - g) * m; b += (lb - b) * m;
      if (q.glow > 0.02) { r += (AMBER[0] - r) * q.glow; g += (AMBER[1] - g) * q.glow; b += (AMBER[2] - b) * q.glow; }
      const size = (small ? 1.6 : 1.9) + q.glow * 3.2;
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${dotA * (0.75 + 0.25 * q.glow)})`;
      ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
    }

    // The field itself: a faint ring where the pointer is.
    if (field.s > 0.02) {
      ctx.strokeStyle = `rgba(240,163,67,${0.35 * field.s})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(field.x, field.y, field.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(240,163,67,${0.7 * field.s})`;
      ctx.font = '10px "Space Mono", monospace';
      ctx.fillText('HIGGS FIELD · m ↑', field.x + field.r * 0.72, field.y - field.r * 0.72);
    }
  }

  function progress() {
    const r = section.getBoundingClientRect();
    const travel = Math.max(1, r.height - window.innerHeight);
    return clamp01(-r.top / travel);
  }

  function syncCopy() {
    const i = p < 0.2 ? 0 : p < 0.66 ? 1 : 2;
    lines.forEach((el, k) => el.classList.toggle('is-active', k === i));
    if (meter) meter.style.transform = `scaleX(${p.toFixed(3)})`;
    if (video && video.readyState >= 1 && video.duration) {
      const t = p * video.duration;
      if (Math.abs(video.currentTime - t) > 0.04) video.currentTime = t;
    }
  }

  let last = 0;
  function frame(now) {
    if (!running) return;
    p = progress();
    if (p !== lastP) { syncCopy(); lastP = p; }
    const dt = Math.min(3, (now - (last || now)) / 16.667 || 1);
    last = now;
    if (pts) step(dt, now);
    draw(now);
    raf = requestAnimationFrame(frame);
  }

  function start() { if (running || REDUCED_MOTION) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // Reduced motion: no loop, just the right still for the scroll position.
  function still() {
    p = 1; syncCopy();
    if (pts) { placeAll(true); for (const q of pts) q.tm = target(q, cover()).m; }
    draw(performance.now());
  }

  const ready = () => { resize(); build(); if (REDUCED_MOTION) still(); };
  if (img.complete && img.naturalWidth) ready();
  else { img.loading = 'eager'; img.addEventListener('load', ready, { once: true }); }

  new IntersectionObserver((es) => {
    onScreen = es[0].isIntersecting;
    if (onScreen && !document.hidden) start(); else stop();
  }, { rootMargin: '100px' }).observe(section);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (onScreen) start(); });
  window.addEventListener('resize', () => { resize(); placeAll(true); if (REDUCED_MOTION) still(); }, { passive: true });
  if (REDUCED_MOTION) window.addEventListener('scroll', still, { passive: true });

  // ---- the field follows the pointer / finger ---------------------------
  const at = (e) => { const r = canvas.getBoundingClientRect(); field.x = e.clientX - r.left; field.y = e.clientY - r.top; };
  const sticky = section.querySelector('.rewire__sticky');
  sticky.addEventListener('pointermove', (e) => { at(e); if (!IS_TOUCH || e.buttons) field.on = true; });
  sticky.addEventListener('pointerdown', (e) => { at(e); field.on = true; });
  sticky.addEventListener('pointerleave', () => { field.on = false; });
  sticky.addEventListener('pointerup', () => { if (IS_TOUCH) field.on = false; });
  sticky.addEventListener('pointercancel', () => { field.on = false; });

  return { destroy() { stop(); } };
}

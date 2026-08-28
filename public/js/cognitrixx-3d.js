// ==========================================================================
// COGNITRIXX 3D — the reusable neural-field visual system.
//
// One module, several "moments". Each moment is an independent, small scene
// mounted on its own element — deliberately NOT one page-sized WebGL canvas,
// which would force every section to pay for the GPU even when nothing is on
// screen and would take HTML/CSS out of the information-heavy sections.
//
// Shared vocabulary across every moment:
//   nodes      instanced points, drifting in a bounded 3D volume
//   links      lines between nodes within a radius, drawn as one geometry
//   signals    bright travellers running along links toward a focus
//   colour     amber far from focus -> ENGINEER cyan/violet/magenta near it
//
// Cost control: DPR capped, paused off-screen and on tab-hide, node counts
// scale by viewport, and reduced-motion renders one static frame.
// ==========================================================================

import * as THREE from '/vendor/three/three.module.js';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const AMBER   = new THREE.Color('#e8923c');
const CYAN    = new THREE.Color('#34d8e8');
const VIOLET  = new THREE.Color('#5f79f2');
const MAGENTA = new THREE.Color('#e23fd1');
const ENGI = [CYAN, VIOLET, MAGENTA];

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Mount a neural field moment.
 *
 * @param {HTMLElement} host    element the canvas fills
 * @param {object} opts
 *   density   0..2 multiplier on node count
 *   spread    world-space radius of the volume
 *   focus     THREE.Vector3 the signals travel toward (defaults to origin)
 *   tone      'amber' | 'engi' | 'mixed' — which end of the ramp dominates
 *   signals   how many travellers at once
 *   rotate    idle rotation speed (radians/sec)
 *   depth     camera z
 */
export function createNeuralField(host, opts = {}) {
  if (!host || !hasWebGL()) return null;

  const {
    density = 1, spread = 9, tone = 'mixed',
    signals: signalCount = 6, rotate = 0.035, depth = 16,
  } = opts;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = depth;

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
  });

  const group = new THREE.Group();
  scene.add(group);

  // ---- nodes -------------------------------------------------------------
  const isSmall = window.innerWidth < 768;
  const count = Math.round((isSmall ? 42 : 78) * density);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const velocities = [];
  const tmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3(
      rand(-spread, spread),
      rand(-spread * 0.62, spread * 0.62),
      rand(-spread * 0.55, spread * 0.55),
    );
    positions.set([p.x, p.y, p.z], i * 3);
    velocities.push(new THREE.Vector3(rand(-0.006, 0.006), rand(-0.006, 0.006), rand(-0.004, 0.004)));

    // Distance from centre decides how far along the amber -> ENGINEER ramp.
    const t = Math.min(1, p.length() / spread);
    const engi = ENGI[i % ENGI.length];
    if (tone === 'amber') tmp.copy(AMBER);
    else if (tone === 'engi') tmp.copy(engi);
    else tmp.copy(engi).lerp(AMBER, t);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  nodeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const nodeMat = new THREE.PointsMaterial({
    size: isSmall ? 0.11 : 0.085,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(nodeGeo, nodeMat);
  group.add(points);

  // ---- links -------------------------------------------------------------
  // One LineSegments for every connection, rebuilt in place each frame. Cheaper
  // than a mesh per link by orders of magnitude.
  const LINK_DIST = spread * 0.42;
  const maxLinks = count * 5;
  const linkPos = new Float32Array(maxLinks * 6);
  const linkCol = new Float32Array(maxLinks * 6);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
  linkGeo.setAttribute('color', new THREE.BufferAttribute(linkCol, 3));
  const linkMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.24,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(linkGeo, linkMat);
  group.add(lines);

  // ---- signals -----------------------------------------------------------
  const sigCount = REDUCED_MOTION ? 0 : signalCount;
  const sigPos = new Float32Array(Math.max(1, sigCount) * 3);
  const sigCol = new Float32Array(Math.max(1, sigCount) * 3);
  const sigGeo = new THREE.BufferGeometry();
  sigGeo.setAttribute('position', new THREE.BufferAttribute(sigPos, 3));
  sigGeo.setAttribute('color', new THREE.BufferAttribute(sigCol, 3));
  const sigMat = new THREE.PointsMaterial({
    size: isSmall ? 0.3 : 0.24, vertexColors: true, transparent: true,
    opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const signalPoints = new THREE.Points(sigGeo, sigMat);
  if (sigCount) group.add(signalPoints);

  const travellers = [];
  for (let i = 0; i < sigCount; i++) {
    travellers.push({ a: (Math.random() * count) | 0, b: (Math.random() * count) | 0, t: Math.random(), speed: rand(0.004, 0.011) });
  }

  // ---- loop --------------------------------------------------------------
  let raf = null, running = false, visible = true;
  let width = 0, height = 0;
  let progress = 0;      // external scrub 0..1
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  function resize() {
    const r = host.getBoundingClientRect();
    width = Math.max(1, r.width); height = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.5 : 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function rebuildLinks() {
    const pos = nodeGeo.attributes.position.array;
    const col = nodeGeo.attributes.color.array;
    let n = 0;

    for (let i = 0; i < count && n < maxLinks; i++) {
      const ix = i * 3;
      for (let j = i + 1; j < count && n < maxLinks; j++) {
        const jx = j * 3;
        const dx = pos[ix] - pos[jx], dy = pos[ix + 1] - pos[jx + 1], dz = pos[ix + 2] - pos[jx + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > LINK_DIST * LINK_DIST) continue;

        const o = n * 6;
        linkPos[o] = pos[ix]; linkPos[o + 1] = pos[ix + 1]; linkPos[o + 2] = pos[ix + 2];
        linkPos[o + 3] = pos[jx]; linkPos[o + 4] = pos[jx + 1]; linkPos[o + 5] = pos[jx + 2];
        linkCol[o] = col[ix]; linkCol[o + 1] = col[ix + 1]; linkCol[o + 2] = col[ix + 2];
        linkCol[o + 3] = col[jx]; linkCol[o + 4] = col[jx + 1]; linkCol[o + 5] = col[jx + 2];
        n++;
      }
    }
    linkGeo.setDrawRange(0, n * 2);
    linkGeo.attributes.position.needsUpdate = true;
    linkGeo.attributes.color.needsUpdate = true;
  }

  function step(time) {
    const pos = nodeGeo.attributes.position.array;
    const col = nodeGeo.attributes.color.array;

    if (!REDUCED_MOTION) {
      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        const v = velocities[i];
        pos[ix] += v.x; pos[ix + 1] += v.y; pos[ix + 2] += v.z;
        if (Math.abs(pos[ix]) > spread) v.x *= -1;
        if (Math.abs(pos[ix + 1]) > spread * 0.62) v.y *= -1;
        if (Math.abs(pos[ix + 2]) > spread * 0.55) v.z *= -1;
      }
      nodeGeo.attributes.position.needsUpdate = true;
    }

    // progress rewires the field from amber chaos toward ENGINEER structure
    if (tone === 'mixed' && progress > 0) {
      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        const d = Math.hypot(pos[ix], pos[ix + 1], pos[ix + 2]) / spread;
        const t = Math.min(1, Math.max(0, d - progress));
        tmp.copy(ENGI[i % ENGI.length]).lerp(AMBER, t);
        col[ix] = tmp.r; col[ix + 1] = tmp.g; col[ix + 2] = tmp.b;
      }
      nodeGeo.attributes.color.needsUpdate = true;
    }

    rebuildLinks();

    for (let s = 0; s < travellers.length; s++) {
      const tr = travellers[s];
      tr.t += tr.speed;
      if (tr.t >= 1) {
        tr.t = 0;
        tr.a = tr.b;
        tr.b = (Math.random() * count) | 0;
      }
      const ax = tr.a * 3, bx = tr.b * 3, o = s * 3;
      sigPos[o]     = pos[ax]     + (pos[bx]     - pos[ax])     * tr.t;
      sigPos[o + 1] = pos[ax + 1] + (pos[bx + 1] - pos[ax + 1]) * tr.t;
      sigPos[o + 2] = pos[ax + 2] + (pos[bx + 2] - pos[ax + 2]) * tr.t;
      sigCol[o] = CYAN.r; sigCol[o + 1] = CYAN.g; sigCol[o + 2] = CYAN.b;
    }
    if (travellers.length) {
      sigGeo.attributes.position.needsUpdate = true;
      sigGeo.attributes.color.needsUpdate = true;
    }

    // idle rotation + pointer-led tilt, both deliberately small
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    if (!REDUCED_MOTION) group.rotation.y = (time || 0) * 0.001 * rotate + pointer.x * 0.22;
    group.rotation.x = pointer.y * 0.16;

    renderer.render(scene, camera);
  }

  function loop(time) {
    if (!running) return;
    step(time);
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    if (REDUCED_MOTION) { step(0); running = false; }
    else raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible) start(); else stop();
  }, { threshold: 0 });
  io.observe(host);

  const onVis = () => { if (document.hidden) stop(); else if (visible) start(); };
  document.addEventListener('visibilitychange', onVis);

  const onResize = () => resize();
  window.addEventListener('resize', onResize, { passive: true });

  const onPointer = (e) => {
    const r = host.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  if (!REDUCED_MOTION) window.addEventListener('pointermove', onPointer, { passive: true });

  resize();
  start();

  return {
    setProgress(p) { progress = Math.max(0, Math.min(1, p)); if (REDUCED_MOTION) step(0); },
    resize,
    destroy() {
      stop(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      nodeGeo.dispose(); linkGeo.dispose(); sigGeo.dispose();
      nodeMat.dispose(); linkMat.dispose(); sigMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

// This site is mobile-forward, and WebGL contexts are the scarce resource on a
// phone: each one holds GPU memory, drains battery, and mobile Safari will
// silently drop the oldest once a handful are live. So small screens mount only
// the highest-priority moments and everything else degrades to a CSS wash.
const MOBILE_CONTEXT_BUDGET = 2;

/**
 * Mount [data-field] elements as neural moments, reading configuration from
 * data attributes. `data-priority` (1 = essential … 3 = decorative) decides
 * what survives the mobile budget. Returns a slug -> controller map so scroll
 * code can scrub specific fields; skipped hosts are absent from the map and
 * marked `.is-static` for the CSS fallback.
 */
export function mountFields() {
  const out = {};
  if (!hasWebGL()) {
    document.querySelectorAll('[data-field]').forEach(h => h.classList.add('is-static'));
    return out;
  }

  const hosts = [...document.querySelectorAll('[data-field]')];
  const isSmall = window.innerWidth < 768;

  let allowed = hosts;
  if (isSmall) {
    allowed = [...hosts]
      .sort((a, b) => (parseInt(a.dataset.priority || '3', 10) - parseInt(b.dataset.priority || '3', 10)))
      .slice(0, MOBILE_CONTEXT_BUDGET);
  }
  const allowedSet = new Set(allowed);

  hosts.forEach((host) => {
    if (!allowedSet.has(host)) { host.classList.add('is-static'); return; }

    // Phones also get a thinner field inside the moments they do keep.
    const density = (parseFloat(host.dataset.density) || 1) * (isSmall ? 0.7 : 1);
    const signals = parseInt(host.dataset.signals || '6', 10);

    out[host.dataset.field] = createNeuralField(host, {
      density,
      spread: parseFloat(host.dataset.spread) || 9,
      tone: host.dataset.tone || 'mixed',
      signals: isSmall ? Math.min(signals, 4) : signals,
      rotate: parseFloat(host.dataset.rotate || '0.035'),
      depth: parseFloat(host.dataset.depth || '16'),
    });
  });
  return out;
}

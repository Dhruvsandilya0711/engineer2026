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
const CYAN    = new THREE.Color('#22d3ee');
const INDIGO  = new THREE.Color('#6366f1');
const VIOLET  = new THREE.Color('#8b78f6');
const MAGENTA = new THREE.Color('#e879f9');
const ENGI = [CYAN, VIOLET, MAGENTA];
// Cool theme ramp for the sitewide background field, and the deep indigo it
// dissolves into at depth so the web reads as distance, not a flat wall.
const NEBULA = [CYAN, INDIGO, VIOLET, MAGENTA];
const DEEP   = new THREE.Color('#0e1338');
// Signals get theme colours rather than all-cyan.
const SIGNAL_HUES = [CYAN, MAGENTA, VIOLET, CYAN];

// A soft radial dot, generated once and shared by every field. Square points
// are what made the web read as scattered specks; a glow sprite gives each node
// a core and a falloff, so the same node count reads as a lit network instead.
let GLOW_TEX = null;
function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.72)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.19)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  GLOW_TEX = new THREE.CanvasTexture(c);
  return GLOW_TEX;
}

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
    scroll = null, journey = false,
  } = opts;

  // JOURNEY — the continuous "spine". The camera holds still while the whole
  // node cloud FLOWS toward it as the page scrolls, wrapping at the corridor
  // ends, so scrolling reads as travelling forward through the network.
  // Velocity adds momentum to the signals and lights the connections; the
  // camera drifts along a gentle curved path (no constant spin). Off entirely
  // under reduced motion (the field renders one static frame as before).
  const JOURNEY = !!(journey && scroll && !REDUCED_MOTION);
  const CORRIDOR = 52;   // world depth of the tunnel the cloud loops through
  const TRAVEL = 150;    // world units the cloud flows over one full page scroll

  const scene = new THREE.Scene();
  // Depth fog: with additive blending, fading fragments toward near-black as
  // they recede makes distant nodes dissolve. That is what lets the field be
  // dense up close yet stay soft and off the foreground in the background.
  scene.fog = new THREE.Fog(0x03040c, depth * 0.35, depth * 2.15);
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
  // The journey spine flows through a 52-deep corridor, so its nodes are spread
  // over far more volume than a fixed moment's — it needs a bigger population to
  // read as a network rather than scattered specks. Phones get the same lift:
  // link-building is O(n²) but at these counts that is a few thousand distance
  // checks a frame, which is not what costs on a phone (the GPU context is).
  const base = journey ? (isSmall ? 108 : 190) : (isSmall ? 46 : 104);
  const count = Math.round(base * density);

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

    // Distance from centre decides how far along the colour ramp each node is.
    const t = Math.min(1, p.length() / spread);
    const engi = ENGI[i % ENGI.length];
    if (tone === 'amber') tmp.copy(AMBER);
    else if (tone === 'engi') tmp.copy(engi);
    else if (tone === 'nebula') tmp.copy(NEBULA[i % NEBULA.length]).lerp(DEEP, t * 0.78);
    else tmp.copy(engi).lerp(AMBER, t);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  nodeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const nodeMat = new THREE.PointsMaterial({
    // Glow sprites carry much further than hard squares, so nodes can be larger
    // without turning into blobs — the falloff does the work.
    // EVERY field uses the same sprite, sized to look alike at its own camera
    // depth. That is what makes the travelling spine read as flowing OUT of the
    // hero's field rather than as a second, unrelated system fading in over it.
    size: journey ? (isSmall ? 0.52 : 0.46) : (isSmall ? 0.4 : 0.34),
    map: glowTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(nodeGeo, nodeMat);
  group.add(points);

  // Recast the volume as a deep corridor for the journey: camera at the mouth
  // (z=0) looking down -z, every node in front of it, spread over CORRIDOR of
  // depth. Fog is measured in distance from the camera, so the far end fades.
  if (JOURNEY) {
    camera.position.set(0, 0, 0);
    scene.fog = new THREE.Fog(0x03040c, 9, CORRIDOR * 1.02);
    const pz = nodeGeo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      pz[i * 3]     = rand(-spread, spread);
      pz[i * 3 + 1] = rand(-spread * 0.7, spread * 0.7);
      pz[i * 3 + 2] = rand(-CORRIDOR - 2, -2);
      velocities[i].set(rand(-0.004, 0.004), rand(-0.004, 0.004), 0);
    }
    nodeGeo.attributes.position.needsUpdate = true;
  }

  // ---- links -------------------------------------------------------------
  // One LineSegments for every connection, rebuilt in place each frame. Cheaper
  // than a mesh per link by orders of magnitude.
  // The spine's nodes sit in a much deeper volume, so the same ratio leaves
  // most of them unconnected — hence the "sparse" look. Reach further there.
  const LINK_DIST = spread * (journey ? 0.55 : 0.48);
  const maxLinks = count * (journey ? 12 : 7);
  const linkPos = new Float32Array(maxLinks * 6);
  const linkCol = new Float32Array(maxLinks * 6);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
  linkGeo.setAttribute('color', new THREE.BufferAttribute(linkCol, 3));
  const linkMat = new THREE.LineBasicMaterial({
    // Matched to the spine's resting value so every field on the site reads as
    // the same material: lit nodes leading, links as the depth between them.
    vertexColors: true, transparent: true, opacity: 0.16,
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
    size: journey ? (isSmall ? 0.9 : 0.8) : (isSmall ? 0.62 : 0.54),
    map: glowTexture(),
    vertexColors: true, transparent: true,
    opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const signalPoints = new THREE.Points(sigGeo, sigMat);
  if (sigCount) group.add(signalPoints);

  const travellers = [];
  for (let i = 0; i < sigCount; i++) {
    travellers.push({
      a: (Math.random() * count) | 0, b: (Math.random() * count) | 0,
      t: Math.random(), speed: rand(0.004, 0.011),
      col: SIGNAL_HUES[i % SIGNAL_HUES.length],
    });
  }

  // ---- loop --------------------------------------------------------------
  let raf = null, running = false, visible = true;
  let width = 0, height = 0;
  let progress = 0;      // external scrub 0..1
  let flowAccum = 0;     // journey: smoothed cloud position along the corridor
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

    // ---- JOURNEY: fly the cloud past a fixed camera, driven by scroll -------
    if (JOURNEY) {
      // Scrub the cloud toward the scroll target; the easing IS the inertia,
      // so a hard stop settles instead of snapping. `delta` is this frame's
      // travel — its magnitude is the effective scroll velocity.
      const target = scroll.progress * TRAVEL;
      const delta = (target - flowAccum) * 0.1;
      flowAccum += delta;
      const speed = Math.min(2.6, Math.abs(delta) * 7);

      for (let i = 0; i < count; i++) {
        const ix = i * 3;
        pos[ix + 2] += delta;                    // flow toward the camera
        const v = velocities[i];
        pos[ix] += v.x; pos[ix + 1] += v.y;      // faint lateral shimmer
        if (Math.abs(pos[ix]) > spread) v.x *= -1;
        if (Math.abs(pos[ix + 1]) > spread * 0.7) v.y *= -1;
        if (pos[ix + 2] > -2) pos[ix + 2] -= CORRIDOR;            // wrap behind -> far
        else if (pos[ix + 2] < -CORRIDOR - 2) pos[ix + 2] += CORRIDOR; // (scrolling up)
      }
      nodeGeo.attributes.position.needsUpdate = true;

      // Pointer-driven parallax — sensitivity dialled up so the field
      // visibly leans with the cursor (was 1.3/-0.9 with a 0.05 lerp; now
      // 3.6/-2.7 with a 0.10 lerp). Combined with a look-at that follows
      // the cursor in world space, the near nodes swing more than the far
      // ones and the corridor reads as a real 3D volume rather than a
      // static backdrop.
      pointer.x += (pointer.tx - pointer.x) * 0.10;
      pointer.y += (pointer.ty - pointer.y) * 0.10;
      camera.position.x += ((Math.sin(scroll.progress * Math.PI * 3) * 1.7) + pointer.x * 3.6 - camera.position.x) * 0.08;
      camera.position.y += ((Math.cos(scroll.progress * Math.PI * 2) * 1.1) - pointer.y * 2.7 - camera.position.y) * 0.08;
      // A subtle pointer-led group rotation on top of the camera shift.
      // Near nodes travel more than far ones under camera-only motion, but
      // the added yaw/pitch pushes the whole cloud around the look-at
      // point, doubling the sense of depth.
      group.rotation.y += (pointer.x * 0.12 - group.rotation.y) * 0.08;
      group.rotation.x += (-pointer.y * 0.09 - group.rotation.x) * 0.08;
      // Look-at chases the cursor a little into world space so the framing
      // recomposes as you move around, not just a lateral pan.
      camera.lookAt(pointer.x * 2.4, -pointer.y * 1.8, -20);

      // Connections brighten with scroll speed; signals accelerate. Kept low at
      // rest so the lit NODES carry the image and the links read as the depth
      // between them — at the old 0.2 the denser web turned into flat wireframe
      // noise.
      linkMat.opacity = 0.12 + Math.min(0.2, speed * 0.13);
      rebuildLinks();
      for (let s = 0; s < travellers.length; s++) {
        const tr = travellers[s];
        tr.t += tr.speed * (1 + speed * 1.8);
        if (tr.t >= 1) { tr.t = 0; tr.a = tr.b; tr.b = (Math.random() * count) | 0; }
        const ax = tr.a * 3, bx = tr.b * 3, o = s * 3;
        sigPos[o]     = pos[ax]     + (pos[bx]     - pos[ax])     * tr.t;
        sigPos[o + 1] = pos[ax + 1] + (pos[bx + 1] - pos[ax + 1]) * tr.t;
        sigPos[o + 2] = pos[ax + 2] + (pos[bx + 2] - pos[ax + 2]) * tr.t;
        const c = tr.col;
        sigCol[o] = c.r; sigCol[o + 1] = c.g; sigCol[o + 2] = c.b;
      }
      if (travellers.length) {
        sigGeo.attributes.position.needsUpdate = true;
        sigGeo.attributes.color.needsUpdate = true;
      }
      renderer.render(scene, camera);
      return;
    }

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
      const c = tr.col;
      sigCol[o] = c.r; sigCol[o + 1] = c.g; sigCol[o + 2] = c.b;
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

// Mobile and desktop both matter here, and WebGL CONTEXTS are the scarce
// resource on a phone: each one holds GPU memory, drains battery, and mobile
// Safari will silently drop the oldest once a handful are live. So small
// screens mount fewer moments — but the ones they keep run at close to full
// strength (see the density note below), rather than a thinned-out version.
const MOBILE_CONTEXT_BUDGET = 2;

/**
 * Mount [data-field] elements as neural moments, reading configuration from
 * data attributes. `data-priority` (1 = essential … 3 = decorative) decides
 * what survives the mobile budget. Returns a slug -> controller map so scroll
 * code can scrub specific fields; skipped hosts are absent from the map and
 * marked `.is-static` for the CSS fallback.
 */
export function mountFields(opts = {}) {
  const scroll = opts.scroll || null;
  const out = {};
  if (!hasWebGL()) {
    document.querySelectorAll('[data-field]').forEach(h => h.classList.add('is-static'));
    return out;
  }

  const hosts = [...document.querySelectorAll('[data-field]')];
  const isSmall = window.innerWidth < 768;
  const isSpine = (h) => h.dataset.field === 'ambient';

  let allowed = hosts;
  if (isSmall) {
    // The ambient field IS the continuous spine, so it must survive the mobile
    // budget — it becomes the whole spatial experience on a phone. Keep it
    // first, then fill the remaining budget by priority.
    const spine = hosts.find(isSpine);
    const rest = hosts.filter(h => h !== spine)
      .sort((a, b) => (parseInt(a.dataset.priority || '3', 10) - parseInt(b.dataset.priority || '3', 10)));
    allowed = [spine, ...rest].filter(Boolean).slice(0, MOBILE_CONTEXT_BUDGET);
  }
  const allowedSet = new Set(allowed);

  hosts.forEach((host) => {
    if (!allowedSet.has(host)) { host.classList.add('is-static'); return; }

    // Phones still get a slightly thinner field inside the moments they keep,
    // but only slightly: the scarce resource on a phone is the GPU CONTEXT
    // (handled by the budget above), not the node count. Thinning to 0.7 was
    // what left the spine looking like scattered specks on mobile.
    const density = (parseFloat(host.dataset.density) || 1) * (isSmall ? 0.85 : 1);
    const signals = parseInt(host.dataset.signals || '6', 10);

    out[host.dataset.field] = createNeuralField(host, {
      density,
      spread: parseFloat(host.dataset.spread) || 9,
      tone: host.dataset.tone || 'mixed',
      signals: isSmall ? Math.min(signals, 6) : signals,
      rotate: parseFloat(host.dataset.rotate || '0.035'),
      depth: parseFloat(host.dataset.depth || '16'),
      // The ambient field becomes the scroll-driven spine; everything else
      // stays a fixed accent moment.
      scroll,
      journey: isSpine(host),
    });
  });
  return out;
}

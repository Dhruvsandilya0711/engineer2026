// ==========================================================================
// NEURAL MARK — the ENGINEER '26 logotype rebuilt as a rotating point cloud.
//
// The mark PNG is sampled on a grid, every covered pixel becomes a particle,
// and the sheet is given THICKNESS: two shells a little forward and a little
// back of the plane, plus a wall of particles through the depth wherever the
// artwork has an edge. Face-on it reads as the logo drawn in dots; turned, it
// reads as a solid extruded object. That is the whole trick.
//
// Sampling the PNG rather than shipping a mesh means the mark stays a single
// source of truth: change public/images/engineer26-mark.png and this follows,
// with no export step and nothing to keep in sync.
//
// Cost control matches cognitrixx-3d.js: DPR capped, paused off-screen and on
// tab-hide, a lighter sample grid on phones, one static frame under reduced
// motion.
// ==========================================================================

import * as THREE from '/engineer2026/vendor/three/three.module.js';
import { hasWebGL, tokenColor } from '/engineer2026/js/cognitrixx-3d.js';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Site tokens, read from the cascade — see tokenColor in cognitrixx-3d.js.
const CYAN    = tokenColor('--color-cyan',       '#1fb6ad');
const INDIGO  = tokenColor('--color-indigo',     '#3b6fd4');
const VIOLET  = tokenColor('--color-violet',     '#6f9ae0');
const ORCHID  = tokenColor('--color-orchid',     '#b0567f');
const MAGENTA = tokenColor('--color-magenta',    '#c06a89');

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);

const MARK_W = 2.45;      // world width of the logotype
const THICK = 0.115;      // half-depth of the extrusion
const CY = 0.24;          // world y the mark is centred on
const FLOOR = -1.30;

/**
 * The dot sprite.
 *
 * Mostly CORE, with a short halo. Additive blending multiplies each fragment
 * by the sprite's alpha, so a sprite that is 80% soft falloff spends 80% of
 * its area contributing almost nothing — which is why the first pass rendered
 * as a dark speckle no matter how far the gain was pushed. A solid centre out
 * to 0.3 of the radius is what makes the mark read at a glance.
 */
let DOT_TEX = null;
function dotTexture() {
  if (DOT_TEX) return DOT_TEX;
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.00, 'rgba(255,255,255,1)');
  grad.addColorStop(0.30, 'rgba(255,255,255,1)');
  grad.addColorStop(0.46, 'rgba(255,255,255,0.62)');
  grad.addColorStop(0.68, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  DOT_TEX = new THREE.CanvasTexture(c);
  return DOT_TEX;
}

/** Wide soft bloom — the glow the mark casts on the floor. */
let BLOOM_TEX = null;
function bloomTexture() {
  if (BLOOM_TEX) return BLOOM_TEX;
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.00, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.34)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  BLOOM_TEX = new THREE.CanvasTexture(c);
  return BLOOM_TEX;
}

/**
 * Read the mark PNG into a coverage grid.
 *
 * Coverage is alpha weighted by luminance, so a mark drawn as light-on-nothing
 * and one drawn as light-on-dark both sample the same way — the file is a
 * transparent PNG today, and this does not care if that changes.
 */
function sampleMark(img, S) {
  const ratio = img.width / img.height;
  const w = ratio >= 1 ? S : Math.round(S * ratio);
  const h = ratio >= 1 ? Math.round(S / ratio) : S;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;

  const cover = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = d[o + 3] / 255;
    const l = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) / 255;
    cover[i] = a * (0.30 + 0.70 * l);
  }
  return { cover, w, h };
}

// ==========================================================================

export function createMarkField(host, img, opts = {}) {
  if (!host || !hasWebGL()) return null;

  const isSmall = window.innerWidth < 900;
  const { cover, w, h } = sampleMark(img, opts.sample || (isSmall ? 112 : 152));
  const ON = 0.40;                              // coverage threshold
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : cover[y * w + x]);

  const MARK_H = MARK_W * (h / w);
  const px = MARK_W / w;                        // world size of one sample cell

  // ---- build the cloud ---------------------------------------------------
  const tx = [], ty = [], tz = [], cr = [], cg = [], cb = [];
  const tmp = new THREE.Color();

  const emit = (gx, gy, z, weight) => {
    const X = ((gx + 0.5) / w - 0.5) * MARK_W;
    const Y = (0.5 - (gy + 0.5) / h) * MARK_H + CY;
    tx.push(X + rand(-px * 0.18, px * 0.18));
    ty.push(Y + rand(-px * 0.18, px * 0.18));
    tz.push(z);

    // --gradient-impossible, laid across the mark: cyan, indigo, magenta,
    // the same ramp the logotype and the register button already use. Violet
    // sat in the middle at first and washed the whole object out — it is a
    // pale periwinkle, and additive blending only lightens it further.
    const u = clamp((X / MARK_W) + 0.5, 0, 1);
    const depth = clamp((z / THICK) * 0.5 + 0.5, 0, 1);
    tmp.copy(CYAN).lerp(INDIGO, Math.min(1, u * 2)).lerp(MAGENTA, Math.max(0, u * 2 - 1));
    // The far shell drops back so the depth is visible before it even turns.
    tmp.multiplyScalar(0.62 + 0.38 * depth);
    const lit = weight * (0.70 + 0.30 * depth);
    cr.push(tmp.r * lit); cg.push(tmp.g * lit); cb.push(tmp.b * lit);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = cover[y * w + x];
      if (v < ON) continue;
      // Two shells rather than one plane: face-on they overlay into the logo,
      // and any turn at all separates them into a solid.
      emit(x, y, THICK * rand(0.72, 1), v);
      emit(x, y, -THICK * rand(0.72, 1), v * 0.82);
      // Edges get the wall between the shells, which is what makes the object
      // read as extruded rather than as two stickers back to back.
      const edge = at(x - 1, y) < ON || at(x + 1, y) < ON || at(x, y - 1) < ON || at(x, y + 1) < ON;
      if (edge) {
        emit(x, y, rand(-THICK * 0.7, THICK * 0.7), v * 0.9);
        if (Math.random() < 0.5) emit(x, y, rand(-THICK * 0.7, THICK * 0.7), v * 0.75);
      }
    }
  }

  // Loose specks around the mark — the same scattered field the rest of the
  // site's moments carry, so this does not sit on the page as a hard cutout.
  for (let i = 0, n = isSmall ? 70 : 170; i < n; i++) {
    const a = rand(0, TAU), rr = rand(1.5, 3.4);
    tx.push(Math.cos(a) * rr);
    ty.push(CY + Math.sin(a) * rr * 0.62);
    tz.push(rand(-1.2, 0.6));
    tmp.copy(VIOLET).lerp(MAGENTA, Math.random());
    const dim = rand(0.12, 0.45);
    cr.push(tmp.r * dim); cg.push(tmp.g * dim); cb.push(tmp.b * dim);
  }

  const N = tx.length;
  const target = new Float32Array(N * 3);
  const seed = new Float32Array(N * 3);
  const position = new Float32Array(N * 3);
  const color = new Float32Array(N * 3);
  const base = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  const delay = new Float32Array(N);
  // Cursor disturbance, held as an OFFSET from where each particle belongs
  // plus its own velocity. Keeping it separate from the assemble means the
  // two never fight: the assemble decides where home is, this decides how far
  // from home the particle currently is.
  const disp = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);

  for (let i = 0; i < N; i++) {
    const o = i * 3;
    target[o] = tx[i]; target[o + 1] = ty[i]; target[o + 2] = tz[i];
    base[o] = cr[i]; base[o + 1] = cg[i]; base[o + 2] = cb[i];
    // Scattered start: pushed out along its own outward direction, so the
    // cloud collapses INTO the mark rather than sliding in from one side.
    const k = rand(1.8, 4.2);
    seed[o]     = tx[i] * k + rand(-0.8, 0.8);
    seed[o + 1] = CY + (ty[i] - CY) * k + rand(-0.8, 0.8);
    seed[o + 2] = tz[i] * k + rand(-2.2, 1.1);
    phase[i] = Math.random() * TAU;
    // Assembles left to right, with enough jitter that it never arrives as a
    // clean sweeping line.
    delay[i] = clamp(0.38 * clamp(tx[i] / MARK_W + 0.5, 0, 1) + Math.random() * 0.18, 0, 0.58);
  }
  position.set(seed);

  // ---- scene -------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x04070f, 4.2, 15);

  const FOV = 34;
  const CAM_Y = 0.24, LOOK_Y = 0.10;
  // The world box the panel has to contain. Widening it shrinks the mark on
  // screen; the mark clears the radial mask that feathers the panel edge with
  // room to spare at these values.
  const FRAME_H = 3.55, FRAME_W = 3.59;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, CAM_Y, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
  });

  const root = new THREE.Group();
  scene.add(root);

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(position, 3);
  const colAttr = new THREE.BufferAttribute(color, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);

  const dotMat = new THREE.PointsMaterial({
    size: isSmall ? 0.032 : 0.030,
    map: dotTexture(),
    vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  root.add(new THREE.Points(geo, dotMat));

  // ---- floor -------------------------------------------------------------
  const fp = [], fc = [];
  const GX = 15, GZ = 17, STEP = 1.2;
  const fcol = new THREE.Color();
  const pushSeg = (x1, z1, x2, z2) => {
    fp.push(x1, FLOOR, z1, x2, FLOOR, z2);
    const ends = [[x1, z1], [x2, z2]];
    for (let e = 0; e < 2; e++) {
      const d = Math.hypot(ends[e][0], ends[e][1] + 1.0);
      const b = 0.09 + 0.66 * Math.exp(-d / 6.0);
      fcol.copy(INDIGO).lerp(ORCHID, Math.exp(-d / 7));
      fc.push(fcol.r * b, fcol.g * b, fcol.b * b);
    }
  };
  for (let z = -GZ; z <= GZ * 0.4; z += STEP) pushSeg(-GX, z, GX, z);
  for (let x = -GX; x <= GX; x += STEP) pushSeg(x, -GZ, x, GZ * 0.4);
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  floorGeo.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
  const floorMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.LineSegments(floorGeo, floorMat));

  // ---- reflection --------------------------------------------------------
  // The mark mirrored through the floor plane. One extra draw call, sharing
  // the geometry; the fog and the low opacity do the rest.
  let mirrorInner = null, mirrorMat = null;
  if (!isSmall) {
    mirrorMat = new THREE.PointsMaterial({
      size: 0.030, map: dotTexture(),
      vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const SQUASH = 0.40;
    const mirror = new THREE.Group();
    mirror.scale.set(1, -SQUASH, 1);
    mirror.position.y = FLOOR * (1 + SQUASH);
    mirrorInner = new THREE.Points(geo, mirrorMat);
    mirror.add(mirrorInner);
    scene.add(mirror);
  }

  // Pool of light the mark throws on the plane below it.
  const poolMat = new THREE.SpriteMaterial({
    map: bloomTexture(), color: 0xbfe6e0, transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pool = new THREE.Sprite(poolMat);
  pool.position.set(0, FLOOR + 0.02, 0);
  pool.scale.set(3.2, 0.44, 1);
  scene.add(pool);

  // ---- state -------------------------------------------------------------
  let raf = null, running = false, visible = false, started = 0;
  let width = 0, height = 0, progress = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const drag = { on: false, last: 0, yaw: 0, vel: 0 };

  // Cursor, in normalised device coords. Deliberately NOT the smoothed
  // `pointer` above: the parallax wants easing, the disturbance wants to land
  // on the frame the cursor actually moved.
  const cursor = { nx: 0, ny: 0, on: false, speed: 0, pnx: 0, pny: 0 };
  const ptr = new THREE.Vector3();
  const PUSH_R = 0.56;                 // world radius of the disturbance
  const PUSH_R2 = PUSH_R * PUSH_R;
  const SPRING = 0.055;                // how hard a particle is pulled home
  const DAMP = 0.89;                   // long enough that the wake is visible
  const MAX_DISP = 0.52;               // hard ceiling on how far it can be thrown

  function resize() {
    const r = host.getBoundingClientRect();
    width = Math.max(1, r.width); height = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSmall ? 1.5 : 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Fit on BOTH axes and take whichever distance is larger, so a tall narrow
    // panel does not simply retreat until the mark is a speck in the middle.
    const halfV = Math.tan((FOV / 2) * Math.PI / 180);
    camera.position.set(0, CAM_Y, Math.max(
      (FRAME_H / 2) / halfV,
      (FRAME_W / 2) / (halfV * camera.aspect),
    ));
    camera.updateProjectionMatrix();
    camera.lookAt(0, LOOK_Y, 0);
  }

  function frame(now) {
    const t = now * 0.001;
    if (!started) started = now;
    const life = REDUCED_MOTION ? 1 : clamp((now - started) / 2000, 0, 1);

    // Drag spins it and releases into a spring back to the resting sway, so
    // the mark always returns to a readable angle.
    if (!drag.on) {
      drag.yaw += drag.vel;
      drag.vel *= 0.94;
      drag.yaw *= 0.955;
    }
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;

    // A slow swing rather than a full spin: at 90 degrees an extruded sheet is
    // a line, and the mark has to stay legible while it shows its depth.
    root.rotation.y = drag.yaw + Math.sin(t * 0.26) * 0.34 + pointer.x * 0.22 + progress * 0.18;
    root.rotation.x = -pointer.y * 0.11 + Math.sin(t * 0.19) * 0.05;

    // Scan band travelling up the mark; it sharpens as the section advances.
    const scanY = CY - 1.4 + ((t * 0.4) % 1) * 2.8;
    const scanK = 0.35 + progress * 1.25;
    const gain = (4.2 + 2.2 * progress) * (0.25 + 0.75 * life);

    // Where the cursor is, in the mark's OWN space. The mark is turning, so a
    // screen position has to be cast onto the scene and then pulled back
    // through the group's transform — otherwise the hole the cursor opens
    // would slide across the face as the logo rotates.
    root.updateMatrixWorld();
    let px0 = 0, py0 = 0, kick0 = 0;
    if (cursor.on && !REDUCED_MOTION) {
      ptr.set(cursor.nx, cursor.ny, 0.5).unproject(camera).sub(camera.position).normalize();
      const hit = Math.abs(ptr.z) > 1e-4 ? -camera.position.z / ptr.z : 0;
      ptr.multiplyScalar(hit).add(camera.position);
      root.worldToLocal(ptr);
      px0 = ptr.x; py0 = ptr.y;
      // The push comes from MOVEMENT, not from presence. A constant force
      // under a parked cursor integrates against the spring until the whole
      // mark blows apart; sweeping through it is what should break it, and
      // leaving the cursor still is what should let it settle.
      cursor.speed = Math.min(0.9, Math.hypot(cursor.nx - cursor.pnx, cursor.ny - cursor.pny) * 9);
      cursor.pnx = cursor.nx; cursor.pny = cursor.ny;
      kick0 = 0.014 + cursor.speed * 0.62;
    }

    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const a = clamp((life - delay[i]) / (1 - delay[i]), 0, 1);
      const e = 1 - Math.pow(1 - a, 3);       // easeOutCubic
      const ty0 = target[o + 1];
      // A slow breath once home, small enough never to blur the letterforms.
      const br = REDUCED_MOTION ? 0 : Math.sin(t * 0.9 + phase[i]) * 0.006;
      position[o]     = seed[o]     + (target[o] - seed[o])         * e;
      position[o + 1] = seed[o + 1] + (ty0 + br - seed[o + 1])      * e;
      position[o + 2] = seed[o + 2] + (target[o + 2] - seed[o + 2]) * e;

      // BREAK — shove anything the cursor passes through, straight out from
      // it. Measured against where the particle BELONGS rather than where it
      // currently is, which keeps the force bounded: a particle already
      // thrown clear cannot be thrown again by its own displacement.
      if (kick0) {
        const dx = target[o] - px0, dy = ty0 - py0;
        const d2 = dx * dx + dy * dy;
        if (d2 < PUSH_R2) {
          const d = Math.sqrt(d2) || 1e-4;
          const f = 1 - d / PUSH_R;
          const k = kick0 * f * f;
          vel[o]     += (dx / d) * k;
          vel[o + 1] += (dy / d) * k;
          vel[o + 2] += (Math.random() - 0.5) * k * 2.2;
        }
      }
      // REFORM — a critically-ish damped spring back to zero offset.
      vel[o]     = (vel[o]     - disp[o]     * SPRING) * DAMP;
      vel[o + 1] = (vel[o + 1] - disp[o + 1] * SPRING) * DAMP;
      vel[o + 2] = (vel[o + 2] - disp[o + 2] * SPRING) * DAMP;
      // Ceiling as well as spring: a fast enough sweep would otherwise fling
      // particles clean off the panel, and they read as lost rather than as
      // displaced.
      disp[o]     = clamp(disp[o]     + vel[o],     -MAX_DISP, MAX_DISP);
      disp[o + 1] = clamp(disp[o + 1] + vel[o + 1], -MAX_DISP, MAX_DISP);
      disp[o + 2] = clamp(disp[o + 2] + vel[o + 2], -MAX_DISP, MAX_DISP);
      position[o] += disp[o]; position[o + 1] += disp[o + 1]; position[o + 2] += disp[o + 2];

      // Disturbed particles burn brighter, so the wake reads as energy rather
      // than as a hole punched in the logo.
      const away = Math.abs(disp[o]) + Math.abs(disp[o + 1]) + Math.abs(disp[o + 2]);
      const m = e * gain
        * (1 + scanK * Math.exp(-Math.abs(ty0 - scanY) * 9))
        * (1 + 2.4 * Math.min(1, away * 1.9));
      color[o]     = base[o]     * m;
      color[o + 1] = base[o + 1] * m;
      color[o + 2] = base[o + 2] * m;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    floorMat.opacity = 0.9 * life;
    poolMat.opacity = (0.30 + 0.24 * progress) * life;
    if (mirrorInner) {
      mirrorMat.opacity = 0.20 * life;
      mirrorInner.rotation.copy(root.rotation);
    }

    renderer.render(scene, camera);
  }

  function loop(now) {
    if (!running) return;
    frame(now);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    if (!started) started = performance.now();
    if (REDUCED_MOTION) { frame(performance.now()); running = false; }
    else raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  // ---- interaction -------------------------------------------------------
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const onPointerMove = (e) => {
    const r = host.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    // Same numbers as NDC, but y is up. Only disturb while the cursor is
    // actually over the panel — the listener is on the window so that a drag
    // can continue past the edge, which would otherwise leave a phantom
    // cursor shoving the mark from off-screen.
    cursor.nx = pointer.tx;
    cursor.ny = -pointer.ty;
    cursor.on = Math.abs(pointer.tx) <= 1.02 && Math.abs(pointer.ty) <= 1.02;
    if (drag.on) {
      const dx = e.clientX - drag.last;
      drag.last = e.clientX;
      drag.yaw += dx * 0.007;
      drag.vel = dx * 0.007;
    }
  };
  const onDown = (e) => {
    drag.on = true; drag.last = e.clientX; drag.vel = 0;
    host.setPointerCapture?.(e.pointerId);
    host.classList.add('is-grabbing');
  };
  const onUp = (e) => {
    if (!drag.on) return;
    drag.on = false;
    host.releasePointerCapture?.(e.pointerId);
    host.classList.remove('is-grabbing');
  };
  if (!REDUCED_MOTION && fine) {
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    host.classList.add('is-grabbable');
  }

  // ---- touch -------------------------------------------------------------
  // This used to be pointer-only: the panel was transparent to touch so that a
  // pinned section could not swallow the page scroll and trap the visitor.
  // That was the right worry and the wrong cure — it left the mark completely
  // inert on a phone, which is where most people see it.
  //
  // The fix is the bargain the gallery ring already strikes: CSS gives the
  // panel `touch-action: pan-y`, so the BROWSER keeps vertical panning for
  // itself and only hands us gestures it has judged horizontal. Scrolling
  // straight through the section still works exactly as before; a sideways
  // swipe turns the mark. No axis detection here — the browser has already
  // done it, and it does it better than a threshold check would.
  const touchAt = (e) => {
    const r = host.getBoundingClientRect();
    cursor.nx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    cursor.ny = -(((e.clientY - r.top) / r.height - 0.5) * 2);
    cursor.on = true;
  };
  const onTouchDown = (e) => {
    drag.on = true; drag.last = e.clientX; drag.vel = 0;
    touchAt(e);
    host.classList.add('is-grabbing');
  };
  const onTouchMove = (e) => {
    if (!drag.on) return;
    touchAt(e);
    const dx = e.clientX - drag.last;
    drag.last = e.clientX;
    drag.yaw += dx * 0.007;
    drag.vel = dx * 0.007;
  };
  const onTouchUp = () => {
    if (!drag.on) return;
    drag.on = false;
    // Let go of the cursor too, so the mark reforms once the finger lifts
    // instead of staying broken around a contact point that no longer exists.
    cursor.on = false;
    host.classList.remove('is-grabbing');
  };

  if (!REDUCED_MOTION && !fine) {
    host.addEventListener('pointerdown', onTouchDown);
    host.addEventListener('pointermove', onTouchMove, { passive: true });
    host.addEventListener('pointerup', onTouchUp);
    host.addEventListener('pointercancel', onTouchUp);
    host.classList.add('is-swipeable');
  }

  const onLeave = () => { cursor.on = false; };
  if (!REDUCED_MOTION && fine) host.addEventListener('pointerleave', onLeave);

  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible) start(); else stop();
  }, { threshold: 0 });
  io.observe(host);

  const onVis = () => { if (document.hidden) stop(); else if (visible) start(); };
  document.addEventListener('visibilitychange', onVis);
  const onResize = () => resize();
  window.addEventListener('resize', onResize, { passive: true });

  resize();
  if (REDUCED_MOTION) { started = performance.now() - 3000; frame(performance.now()); }

  return {
    setProgress(p) {
      progress = clamp(p, 0, 1);
      if (REDUCED_MOTION) frame(performance.now());
    },
    resize,
    destroy() {
      stop(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onUp);
      host.removeEventListener('pointerleave', onLeave);
      geo.dispose(); floorGeo.dispose();
      dotMat.dispose(); floorMat.dispose(); poolMat.dispose(); mirrorMat?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * Mount the mark on [data-js="neural-mark"], if the page has one.
 *
 * The PNG has to decode before there is anything to sample, so this returns a
 * controller immediately and remembers the last progress it was handed —
 * otherwise the section's ScrollTrigger would scrub against nothing for the
 * first few hundred milliseconds and the mark would arrive at the wrong state.
 */
export function mountNeuralMark(src = '/engineer2026/images/engineer26-mark.png') {
  const host = document.querySelector('[data-js="neural-mark"]');
  if (!host) return null;
  if (!hasWebGL()) { host.classList.add('is-static'); return null; }

  let inner = null, pending = 0;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    inner = createMarkField(host, img);
    inner?.setProgress(pending);
  };
  img.onerror = () => host.classList.add('is-static');
  img.src = src;

  return {
    setProgress(p) { pending = p; inner?.setProgress(p); },
    resize() { inner?.resize(); },
    destroy() { inner?.destroy(); inner = null; },
  };
}

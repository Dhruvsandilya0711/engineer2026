// ==========================================================================
// NEURAL HEAD — a point-cloud human face.
//
// KEPT BUT NOT MOUNTED. The transformation section's subject is now the
// ENGINEER '26 mark (public/js/neural-mark.js). This is the alternative
// subject it was built against; re-adding it means importing
// mountNeuralHead() in main.js and pointing the section's host at
// data-js="neural-head".
//
// A point-cloud human head: one UV grid (rings around, columns over the
// crown) drawn twice — as glowing nodes and as the wireframe between them —
// standing on a perspective floor grid inside a HUD frame.
//
// There is no model file. The head is a LATHE (a vertical radius profile
// swept around Y) with the face sculpted onto its front by analytic features
// — nose ridge, brow, sockets, cheekbones, lips, chin — and the eyes,
// nostrils and mouth cut as HOLES in the grid rather than shaded. That is
// what the reference artwork actually is: the openings read as absences in
// the dot field, and a lathe gives exactly its two line families, columns
// converging at the crown and rings running round.
//
// The other thing the reference is: a MASK. Nothing writes depth here, so
// without the `lit` term below the back of the skull draws straight over the
// face and the whole thing collapses into an egg. Fading the far side to
// nothing is what makes the openings black and the face read as lit.
//
// Doing it analytically means the geometry is ~50 lines of maths rather than
// a multi-megabyte model download on a festival landing page, and every
// proportion stays tunable from the constants below. Those proportions are
// measured off the reference frame, not off anatomy — the artwork has a
// notably tall forehead and a long lower face, and copying the drawing is
// the point.
//
// Cost control matches cognitrixx-3d.js: DPR capped, paused off-screen and on
// tab-hide, a lighter grid on phones, one static frame under reduced motion.
// ==========================================================================

import * as THREE from '/vendor/three/three.module.js';
import { hasWebGL } from '/js/cognitrixx-3d.js';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Site tokens (input.css @theme). The reference is violet-dominant, which is
// the register ENGINEER 26 already sits in — so the head is built out of the
// page palette rather than recoloured after the fact.
const CYAN    = new THREE.Color('#22d3ee');
const INDIGO  = new THREE.Color('#6366f1');
const VIOLET  = new THREE.Color('#8a9cf4');
const ORCHID  = new THREE.Color('#d676e0');
const MAGENTA = new THREE.Color('#e879f9');
const DEEP    = new THREE.Color('#241a63');

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
// Unit-height gaussian — every facial feature below is one of these.
const gauss = (d, s) => Math.exp(-(d / s) * (d / s));

// ---- proportions ---------------------------------------------------------
// World units, taken off the reference frame: crown +1.06, chin -1.06, and a
// short neck dropping to a floor plane just below the jaw.
const H = {
  CROWN: 1.06,
  W: 0.80,         // half-width at the cheekbones
  D: 0.92,         // half-depth (a head is deeper than it is wide)
  BACK: 0.16,      // extra depth on the occiput, blended smoothly round
  NECK_LEN: 0.40,  // how far the column runs on below the chin
  NECK_R: 0.220,
  FLOOR: -1.44,
};

// Landmark heights, read off the artwork rather than off a proportion canon:
// its eye line sits at 35% of head height (a canon face is at 50%), which is
// most of what gives the reference its engineered, not-quite-human look.
const EYE   = { x: 0.352, y: 0.310, len: 0.228, h: 0.112, lid: 0.70 };
const NOSE  = { base: -0.150, bridge: 0.330 };
const MOUTH = { y: -0.455, w: 0.272 };

/**
 * Radius profile of the skull, as a fraction of the cheekbone radius.
 * `yn` runs +1 (crown) to -1 (chin), and this function IS the silhouette.
 *
 * The two halves are shaped separately because a head is not an ellipse:
 * above the cheekbones it is nearly a full dome (a low exponent on the circle
 * keeps it broad right up to the crown), and below them it has to fall away
 * hard into the jaw. Fitted to the reference outline, which measures roughly
 * 0.53 of its maximum width at the jawline and 0.28 at the chin — an ellipse
 * gives 0.86 and 0.61 there, which is what made the first pass read as a
 * balloon rather than a face.
 */
function latheR(yn) {
  if (yn >= 0) return Math.pow(Math.sqrt(Math.max(0, 1 - yn * yn)), 0.55);
  return Math.pow(Math.max(0, 1 - Math.pow(-yn, 1.30)), 0.95);
}

/**
 * Which ring row `i` sits on.
 *
 * ONE profile, not two. The neck used to be a separate cylinder starting up
 * inside the jaw — which, with nothing writing depth, drew straight through
 * the chin as a bright tube, and left a visible seam where the two surfaces
 * met. Taking `max(skull, column)` at each height instead gives a single
 * continuous silhouette: the skull is wider everywhere down to the jaw, the
 * column is wider below it, and the changeover IS the jawline.
 */
function ringAt(i, headRows, neckRows) {
  let y;
  if (i < headRows) {
    // Stop just short of both poles so the crown and chin close on small rings
    // rather than COLS coincident vertices — the reference has both.
    const phi = 0.055 + (i / (headRows - 1)) * (Math.PI * 0.982 - 0.055);
    y = Math.cos(phi) * H.CROWN;
  } else {
    y = -H.CROWN * 0.982 - ((i - headRows + 1) / neckRows) * H.NECK_LEN;
  }
  const yn = y / H.CROWN;
  const skull = Math.abs(yn) <= 1 ? latheR(yn) : 0;
  const column = H.NECK_R * (1 + 0.34 * Math.max(0, (-y - 0.60) / 1.1));
  return {
    y,
    rw: Math.max(skull * H.W, column),
    rd: Math.max(skull * H.D, column),
    neck: skull * H.W < column ? 1 : 0,
  };
}

/**
 * Light spilling around the openings — the bright lid line over each eye and
 * the lip edge around the mouth. In the reference these rims are what make
 * the black almonds read as eyes rather than as damage to the mesh.
 */
function lidGlow(x, y) {
  const ax = Math.abs(x);
  let g = 0;
  const dx = (ax - EYE.x) / (EYE.len * 1.18);
  if (Math.abs(dx) < 1) {
    const k = 1 - dx * dx;
    const dy = (y - EYE.y - dx * 0.035) / (EYE.h * 1.60);
    if (dy < Math.pow(k, 0.55) && dy > -EYE.lid * Math.pow(k, 0.80)) g = 1;
  }
  const mx = x / (MOUTH.w * 1.10);
  if (Math.abs(mx) < 1) {
    const my = (y - MOUTH.y + mx * mx * 0.026) / (0.055 * 1.95);
    if (Math.abs(my) < Math.sqrt(1 - mx * mx)) g = Math.max(g, 0.85);
  }
  return g;
}

/**
 * Depth the face adds at (x, y), before the front-facing mask. Everything is
 * a sum of gaussians, so the surface stays smooth and each landmark is one
 * legible line.
 */
function faceRelief(x, y) {
  const ax = Math.abs(x);
  let d = 0;

  // NOSE — one ridge, parametrised bottom (s = 0, the base) to top (s = 1,
  // the bridge between the eyes). It projects hardest just above the base and
  // narrows to a thin ridge by the brow. This is the strongest feature on the
  // face and the one the grid visibly bends around.
  const s = (y - NOSE.base) / (NOSE.bridge - NOSE.base);
  if (s > -0.34 && s < 1.45) {
    const amp = 0.092 + 0.210 * gauss(s - 0.16, 0.34);
    const wid = 0.070 + 0.095 * gauss(s, 0.36);
    const env = smoothstep(-0.34, 0.05, s) * (1 - smoothstep(0.90, 1.45, s));
    d += amp * env * gauss(x, wid);
  }

  d += 0.046 * gauss(y - 0.430, 0.090) * smoothstep(0.50, 0.12, ax);   // brow ridge
  d -= 0.090 * gauss(ax - EYE.x, 0.170) * gauss(y - EYE.y, 0.150);     // eye socket
  d += 0.028 * gauss(ax - 0.400, 0.170) * gauss(y - 0.040, 0.185);     // cheekbone
  d -= 0.016 * gauss(x, 0.040) * gauss(y + 0.290, 0.062);              // philtrum

  // LIPS — a mound with the mouth line pressed into it.
  d += 0.046 * gauss(y - MOUTH.y, 0.105) * gauss(x, 0.250);
  d -= 0.028 * gauss(y - MOUTH.y, 0.026) * gauss(x, 0.240);

  d += 0.034 * gauss(y + 0.760, 0.185) * gauss(x, 0.200);              // chin
  return d;
}

/** The openings. Cut, not shaded — that is how the reference reads. */
function isOpening(x, y) {
  const ax = Math.abs(x);

  // EYE — an almond built from two lid arcs meeting at the corners, tilted so
  // the outer corner rides a little high.
  const dx = (ax - EYE.x) / EYE.len;
  if (Math.abs(dx) < 1) {
    const k = 1 - dx * dx;
    const dy = (y - EYE.y - dx * 0.035) / EYE.h;
    if (dy < Math.pow(k, 0.55) && dy > -EYE.lid * Math.pow(k, 0.80)) return true;
  }

  // NOSTRILS
  const nx = (ax - 0.118) / 0.054, ny = (y + 0.139) / 0.042;
  if (nx * nx + ny * ny < 1) return true;

  // MOUTH LINE — a shallow lens that droops slightly at the corners.
  const mx = x / MOUTH.w;
  if (Math.abs(mx) < 1) {
    const my = (y - MOUTH.y + mx * mx * 0.026) / 0.055;
    if (Math.abs(my) < Math.sqrt(1 - mx * mx)) return true;
  }
  return false;
}

/**
 * A tight glow sprite. Deliberately NOT the shared field sprite from
 * cognitrixx-3d.js: the fields want soft specks that dissolve into one
 * another, and the head wants thousands of dots that still read as the
 * individual points of a grid. Same idea, harder core.
 */
let DOT_TEX = null;
function dotTexture() {
  if (DOT_TEX) return DOT_TEX;
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.00, 'rgba(255,255,255,1)');
  grad.addColorStop(0.16, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.34, 'rgba(255,255,255,0.34)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.07)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  DOT_TEX = new THREE.CanvasTexture(c);
  return DOT_TEX;
}

/** Wide soft bloom — the contact flare where the neck meets the floor. */
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

// ==========================================================================

export function createNeuralHead(host, opts = {}) {
  if (!host || !hasWebGL()) return null;

  const isSmall = window.innerWidth < 900;
  const COLS = opts.cols || (isSmall ? 80 : 112);
  const ROWS = opts.rows || (isSmall ? 60 : 84);
  const HEAD_ROWS = Math.round(ROWS * 0.86);
  const NECK_ROWS = ROWS - HEAD_ROWS;
  const N = ROWS * COLS;

  const scene = new THREE.Scene();
  // Additive fragments faded toward near-black read as distance.
  scene.fog = new THREE.Fog(0x03030d, 4.4, 15);

  const FOV = 34;
  // Composition, matched to the reference: the head about 70% of the frame
  // height, the floor grazing across the bottom. FRAME_* is the world box the
  // panel has to contain.
  const CAM_Y = 0.02, LOOK_Y = -0.14;
  const FRAME_H = 3.05, FRAME_W = 2.50;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, CAM_Y, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
  });

  const root = new THREE.Group();      // everything that turns with the head
  scene.add(root);

  // ---- head grid ---------------------------------------------------------
  // target     where the vertex belongs on the head
  // seed       where it starts, scattered, for the assemble
  // colA/colB  two colour sets, crossfaded by scroll progress
  const target = new Float32Array(N * 3);
  const seed = new Float32Array(N * 3);
  const position = new Float32Array(N * 3);
  const color = new Float32Array(N * 3);
  const colA = new Float32Array(N * 3);
  const colB = new Float32Array(N * 3);
  const alive = new Float32Array(N);
  const phase = new Float32Array(N);
  const delay = new Float32Array(N);

  const cA = new THREE.Color(), cB = new THREE.Color();
  const CX = 0, CY = 0.05, CZ = 0;     // the point the cloud collapses toward

  for (let r = 0; r < ROWS; r++) {
    const ring = ringAt(r, HEAD_ROWS, NECK_ROWS);
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const th = (c / COLS) * TAU;            // 0 = straight ahead
      const ct = Math.cos(th), st = Math.sin(th);

      const x = ring.rw * st;
      const y = ring.y;
      // Occiput bulge, blended by cos so there is no crease down the sides.
      let z = ring.rd * ct * (1 + H.BACK * (1 - ct) * 0.5);

      // The face exists only on the front, and fades out toward the ears —
      // without this mask the same maths would carve a second face into the
      // back of the skull, where x and y repeat.
      const front = Math.max(0, ct);
      alive[i] = 1;
      let relief = 0, lid = 0;
      if (!ring.neck && front > 0.08) {
        relief = faceRelief(x, y);
        z += Math.pow(front, 1.15) * relief;
        if (front > 0.22) {
          if (isOpening(x, y)) alive[i] = 0;
          else lid = lidGlow(x, y);
        }
      }

      target[i * 3] = x; target[i * 3 + 1] = y; target[i * 3 + 2] = z;

      // Scattered start: pushed out along its own outward direction, so the
      // cloud collapses INTO a head rather than sliding in from one side.
      const k = rand(1.9, 4.4);
      seed[i * 3]     = CX + (x - CX) * k + rand(-0.7, 0.7);
      seed[i * 3 + 1] = CY + (y - CY) * k + rand(-0.7, 0.7);
      seed[i * 3 + 2] = CZ + (z - CZ) * k + rand(-1.6, 0.9);

      phase[i] = Math.random() * TAU;
      // Assembles crown-downward, with enough jitter that it never arrives as
      // a clean sweeping line.
      delay[i] = clamp(0.40 * (1 - (y + 1.4) / 2.5) + Math.random() * 0.16, 0, 0.60);

      // ---- colour ----
      // THE lighting term, and the one that decides whether this reads as a
      // face or as an egg. Three parts:
      //   mask    the far side of the lathe fades to nothing, so the cut eyes,
      //           nostrils and mouth read as black instead of showing the back
      //           of the skull through them
      //   lambert the centre of the face is the brightest thing in the frame.
      //           Without it the silhouette wins on sheer pile-up — dozens of
      //           columns landing on the same few pixels — and the face itself
      //           sits dark, which is exactly backwards
      //   relief  the modelled features catch the light. This is what draws the
      //           nose ridge, brow, lips and chin as bright lines
      // A lathe seen head-on piles DOZENS of columns onto the few pixels at
      // its silhouette while the face itself gets one column per pixel. Left
      // alone, additive blending turns that into a bright ring around a dark
      // middle — precisely the wrong picture. The falloff below is tuned to
      // cancel that pile-up, so the face carries the image and the temples
      // dissolve, exactly as the reference does.
      const mask = smoothstep(0.10, 0.50, ct);
      const lambert = 0.12 + 0.88 * front;
      // Key light on the middle of the face, dropping off toward the crown.
      const key = 0.40 + 0.60 * gauss(x, 0.58) * gauss(y - 0.05, 0.74);
      // Same pile-up at the poles, where the rings converge on the crown.
      const pole = 1 - 0.68 * smoothstep(0.62, 1.0, Math.abs(y / H.CROWN));
      const lit = mask * lambert * key * pole
        * (1 + 7.5 * Math.max(0, relief))
        * (1 + 1.5 * lid);
      const rim = Math.abs(st);
      const hgt = clamp((y + 1.3) / 2.4, 0, 1);
      cB.copy(VIOLET).lerp(ORCHID, 0.40)              // the artwork's purple
        .lerp(CYAN, Math.pow(front, 2.0) * 0.30)      // cool light down the centre
        .lerp(MAGENTA, Math.pow(rim, 2.0) * 0.55)     // magenta toward the silhouette
        .lerp(INDIGO, (1 - hgt) * 0.30)               // cooler into the neck
        .multiplyScalar(lit);
      cA.copy(INDIGO).lerp(DEEP, 0.42 + 0.34 * (1 - front)).multiplyScalar(lit);
      colB[i * 3] = cB.r; colB[i * 3 + 1] = cB.g; colB[i * 3 + 2] = cB.b;
      colA[i * 3] = cA.r; colA[i * 3 + 1] = cA.g; colA[i * 3 + 2] = cA.b;
    }
  }
  position.set(seed);

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(position, 3);
  const colAttr = new THREE.BufferAttribute(color, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);

  const nodeMat = new THREE.PointsMaterial({
    size: isSmall ? 0.032 : 0.028,
    map: dotTexture(),
    vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const nodes = new THREE.Points(geo, nodeMat);
  root.add(nodes);

  // ---- wireframe ---------------------------------------------------------
  // Fixed topology, unlike the distance-linked fields: rings across, columns
  // down. So it is an INDEXED geometry sharing the very same position and
  // colour attributes as the points — one buffer upload drives both, and a
  // segment simply is not indexed when either end falls in an opening.
  const idx = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const right = r * COLS + ((c + 1) % COLS);
      if (alive[i] && alive[right]) idx.push(i, right);
      if (r + 1 < ROWS) {
        const down = (r + 1) * COLS + c;
        if (alive[i] && alive[down]) idx.push(i, down);
      }
    }
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', posAttr);
  wireGeo.setAttribute('color', colAttr);
  wireGeo.setIndex(idx);
  const wireMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.18,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const wire = new THREE.LineSegments(wireGeo, wireMat);
  root.add(wire);

  // ---- hair --------------------------------------------------------------
  // Grown as TUFTS, not scattered: a root on the side of the skull and a
  // wandering chain of particles out from it. Isotropic scatter gives an even
  // dusting; the reference has filament structure, and only a walk produces
  // that. Roots avoid the front of the face, so there is a clean hairline.
  const TUFTS = isSmall ? 130 : 280;
  const PER = isSmall ? 12 : 16;
  const hp = [], hc = [];
  const hcol = new THREE.Color();
  for (let t = 0; t < TUFTS; t++) {
    const yn = rand(-0.18, 0.95);
    const side = Math.random() < 0.5 ? -1 : 1;
    const th = side * rand(0.50, 2.55);     // sides and back, never dead ahead
    const ct = Math.cos(th), st = Math.sin(th);
    const r = latheR(yn);

    let px = r * H.W * st;
    let py = yn * H.CROWN;
    let pz = r * H.D * ct * (1 + H.BACK * (1 - ct) * 0.5);

    // Out from the head, biased sideways and up — the reference's mass sits
    // beside the skull, not above it.
    let dx = (px - CX) * 1.5 + side * 0.75;
    let dy = (py - CY) * 0.55 + 0.30;
    let dz = (pz - CZ) * 0.9;
    const len0 = Math.hypot(dx, dy, dz) || 1;
    dx /= len0; dy /= len0; dz /= len0;

    const reach = rand(0.18, 0.78);
    for (let k = 0; k < PER; k++) {
      const step = reach / PER;
      px += dx * step; py += dy * step; pz += dz * step;
      // Curl, renormalised each step so the strand wanders without stalling.
      dx += rand(-0.18, 0.18); dy += rand(-0.20, 0.13); dz += rand(-0.16, 0.16);
      const L = Math.hypot(dx, dy, dz) || 1;
      dx /= L; dy /= L; dz /= L;

      const f = k / PER;                    // 0 root -> 1 tip
      const j = 0.02 + f * 0.10;
      hp.push(px + rand(-j, j), py + rand(-j, j), pz + rand(-j, j));
      hcol.copy(ORCHID).lerp(MAGENTA, f * 0.8).lerp(VIOLET, Math.random() * 0.3);
      const dim = (1.15 - 0.55 * f) * rand(0.6, 1.2);
      hc.push(hcol.r * dim, hcol.g * dim, hcol.b * dim);
    }
  }
  // Loose specks well off the head — the reference's scattered field.
  for (let i = 0, n = isSmall ? 60 : 140; i < n; i++) {
    const a = rand(0, TAU), rr = rand(1.5, 4.2);
    hp.push(Math.cos(a) * rr, rand(-0.9, 2.2), Math.sin(a) * rr * 0.5 - 0.4);
    hcol.copy(VIOLET).lerp(MAGENTA, Math.random());
    const dim = rand(0.18, 0.6);
    hc.push(hcol.r * dim, hcol.g * dim, hcol.b * dim);
  }
  const hairGeo = new THREE.BufferGeometry();
  hairGeo.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
  hairGeo.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
  const hairMat = new THREE.PointsMaterial({
    size: isSmall ? 0.040 : 0.035,
    map: dotTexture(),
    vertexColors: true, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const hair = new THREE.Points(hairGeo, hairMat);
  root.add(hair);

  // ---- floor -------------------------------------------------------------
  // Plain lines rather than GridHelper: the brightness has to fall off around
  // the head so the plane reads as lit BY it, and that lives in the vertex
  // colours.
  const fp = [], fc = [];
  const GX = 15, GZ = 17, STEP = 1.25;
  const fcol = new THREE.Color();
  const pushSeg = (x1, z1, x2, z2) => {
    fp.push(x1, H.FLOOR, z1, x2, H.FLOOR, z2);
    const ends = [[x1, z1], [x2, z2]];
    for (let e = 0; e < 2; e++) {
      const d = Math.hypot(ends[e][0], ends[e][1] + 1.0);
      const b = 0.10 + 0.72 * Math.exp(-d / 6.2);
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
  const floor = new THREE.LineSegments(floorGeo, floorMat);
  scene.add(floor);   // outside `root` — the floor does not turn with the head

  // ---- reflection --------------------------------------------------------
  // The head mirrored through the floor plane. Most of it falls below the
  // frame; what survives is the smear under the chin, which is what the
  // reference shows. One extra draw call, sharing the geometry.
  let mirrorInner = null, mirrorMat = null;
  if (!isSmall) {
    mirrorMat = new THREE.PointsMaterial({
      size: 0.030, map: dotTexture(),
      vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const mirror = new THREE.Group();
    mirror.scale.set(1, -1, 1);
    mirror.position.y = 2 * H.FLOOR;
    mirrorInner = new THREE.Points(geo, mirrorMat);
    mirror.add(mirrorInner);
    scene.add(mirror);
  }

  // Contact flare: a wide horizontal smear plus a hot core where the neck
  // lands on the plane.
  const flareMat = new THREE.SpriteMaterial({
    map: bloomTexture(), color: 0xc9b6ff, transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flare = new THREE.Sprite(flareMat);
  flare.position.set(0, H.FLOOR + 0.03, -0.10);
  flare.scale.set(2.6, 0.34, 1);
  scene.add(flare);

  const coreMat = new THREE.SpriteMaterial({
    map: bloomTexture(), color: 0xffffff, transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const core = new THREE.Sprite(coreMat);
  core.position.set(0, H.FLOOR + 0.05, -0.10);
  core.scale.set(0.62, 0.34, 1);
  scene.add(core);

  // ---- state -------------------------------------------------------------
  let raf = null, running = false, visible = false, started = 0;
  let width = 0, height = 0, progress = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const drag = { on: false, last: 0, yaw: 0, vel: 0 };

  function resize() {
    const r = host.getBoundingClientRect();
    width = Math.max(1, r.width); height = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSmall ? 1.5 : 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Fit the subject to the panel on BOTH axes and take whichever distance is
    // larger. Scaling the pull-back by 1/aspect alone (the obvious version)
    // retreats without bound on a tall narrow panel, which is what left the
    // head sitting small in the middle of the frame.
    const halfV = Math.tan((FOV / 2) * Math.PI / 180);
    const dH = (FRAME_H / 2) / halfV;
    const dW = (FRAME_W / 2) / (halfV * camera.aspect);
    camera.position.set(0, CAM_Y, Math.max(dH, dW));
    camera.updateProjectionMatrix();
    camera.lookAt(0, LOOK_Y, 0);
  }

  function frame(now) {
    const t = now * 0.001;
    if (!started) started = now;
    // 2.1s assemble, played once the panel is actually on screen.
    const life = REDUCED_MOTION ? 1 : clamp((now - started) / 2100, 0, 1);

    // Drag spins the head and releases into a slow spring back to front-on,
    // so it always returns to the pose the section is composed around.
    if (!drag.on) {
      drag.yaw += drag.vel;
      drag.vel *= 0.94;
      drag.yaw *= 0.965;
    }
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;

    root.rotation.y = drag.yaw + pointer.x * 0.22 + Math.sin(t * 0.22) * 0.028 + progress * 0.07;
    root.rotation.x = -pointer.y * 0.10 + Math.sin(t * 0.17) * 0.016;

    // Scan band: a bright line travelling up the head. Its strength rises with
    // scroll progress, so the section reads as the subject coming online.
    const scanY = -1.6 + ((t * 0.40) % 1) * 3.1;
    const scanK = 0.30 + progress * 1.10;

    // Colour crossfade A -> B is the transformation the section narrates.
    const mix = REDUCED_MOTION ? 1 : progress;
    const gain = (1.45 + 0.85 * progress) * (0.25 + 0.75 * life);

    for (let i = 0; i < N; i++) {
      const ix = i * 3;
      const a = clamp((life - delay[i]) / (1 - delay[i]), 0, 1);
      const e = 1 - Math.pow(1 - a, 3);       // easeOutCubic

      const tx = target[ix], ty = target[ix + 1], tz = target[ix + 2];
      // Once home, a slow breath along the outward direction keeps the surface
      // alive without ever leaving the silhouette.
      const br = REDUCED_MOTION ? 1 : 1 + Math.sin(t * 0.9 + phase[i]) * 0.005;
      position[ix]     = seed[ix]     + (tx * br - seed[ix])     * e;
      position[ix + 1] = seed[ix + 1] + (ty * br - seed[ix + 1]) * e;
      position[ix + 2] = seed[ix + 2] + (tz * br - seed[ix + 2]) * e;

      const scan = 1 + scanK * Math.exp(-Math.abs(ty - scanY) * 11);
      const m = alive[i] * e * gain * scan;
      color[ix]     = (colA[ix]     + (colB[ix]     - colA[ix])     * mix) * m;
      color[ix + 1] = (colA[ix + 1] + (colB[ix + 1] - colA[ix + 1]) * mix) * m;
      color[ix + 2] = (colA[ix + 2] + (colB[ix + 2] - colA[ix + 2]) * mix) * m;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    wireMat.opacity = (0.04 + 0.04 * progress) * life;
    hairMat.opacity = 0.92 * life;
    floorMat.opacity = 0.9 * life;
    flareMat.opacity = (0.30 + 0.28 * progress) * life;
    coreMat.opacity = (0.45 + 0.35 * progress) * life;
    if (mirrorInner) {
      mirrorMat.opacity = 0.16 * life;
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
    if (drag.on) {
      const dx = e.clientX - drag.last;
      drag.last = e.clientX;
      drag.yaw += dx * 0.006;
      drag.vel = dx * 0.006;
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
  // Drag is a POINTER affordance only. On touch the panel stays transparent to
  // the page scroll — this is a pinned section, and stealing the gesture would
  // trap the visitor inside it.
  if (!REDUCED_MOTION && fine) {
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    host.classList.add('is-grabbable');
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
      geo.dispose(); wireGeo.dispose(); hairGeo.dispose(); floorGeo.dispose();
      nodeMat.dispose(); wireMat.dispose(); hairMat.dispose(); floorMat.dispose();
      flareMat.dispose(); coreMat.dispose(); mirrorMat?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** Mount the head on [data-js="neural-head"], if the page has one. */
export function mountNeuralHead() {
  const host = document.querySelector('[data-js="neural-head"]');
  if (!host) return null;
  if (!hasWebGL()) { host.classList.add('is-static'); return null; }
  return createNeuralHead(host);
}

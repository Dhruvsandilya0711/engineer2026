// ==========================================================================
// Hero Penrose object.
//
// Two representations of the SAME artwork, cross-faded by scroll:
//
//   1. At rest — a plane textured with the real logo asset. Pixel-faithful,
//      so the official mark is never redrawn or approximated.
//   2. On scroll — the logo DISSOLVES into particles. Every particle is
//      sampled from an actual pixel of the logo (position + colour), so the
//      swarm is literally made of the mark rather than being generic dust.
//      They scatter outward into the surrounding neural field: the structure
//      returning to the network it was rewired from.
//
// Dispersal runs entirely in the vertex shader off a single `uProgress`
// uniform, so scrubbing it costs nothing on the CPU regardless of particle
// count.
//
// Falls back to the plain <img> whenever: prefers-reduced-motion, no WebGL,
// or the texture fails to load.
// ==========================================================================

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

// Sample the logo bitmap into particle attributes. Reads on a grid and keeps
// only pixels that actually carry the mark, so empty space costs nothing.
function sampleLogo(image, planeW, planeH, step) {
  const c = document.createElement('canvas');
  const maxW = 260; // sampling resolution — plenty for a dense swarm
  const scale = Math.min(1, maxW / image.width);
  c.width = Math.max(1, Math.round(image.width * scale));
  c.height = Math.max(1, Math.round(image.height * scale));

  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, c.width, c.height);

  let data;
  try {
    data = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch (e) {
    return null; // tainted canvas (cross-origin asset) — skip particles
  }

  const positions = [];
  const colors = [];
  const dirs = [];
  const seeds = [];

  for (let y = 0; y < c.height; y += step) {
    for (let x = 0; x < c.width; x += step) {
      const i = (y * c.width + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255, a = data[i + 3] / 255;
      // The source art sits on black, so brightness is the real mask.
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) * a;
      if (lum < 0.10) continue;

      const nx = (x / c.width - 0.5) * planeW;
      const ny = -(y / c.height - 0.5) * planeH;
      positions.push(nx, ny, 0);
      colors.push(r, g, b);

      // Outward from centre, with jitter so it scatters rather than explodes
      // in perfect radial lines.
      const len = Math.hypot(nx, ny) || 0.0001;
      dirs.push(
        nx / len + (Math.random() - 0.5) * 0.75,
        ny / len + (Math.random() - 0.5) * 0.75,
        (Math.random() - 0.5) * 1.1,
      );
      seeds.push(Math.random());
    }
  }
  return { positions, colors, dirs, seeds };
}

const VERT = `
  attribute vec3 aColor;
  attribute vec3 aDir;
  attribute float aSeed;

  uniform float uProgress;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;

    // Particles further from the centre begin leaving first, so the mark
    // erodes from its edges inward instead of vanishing all at once.
    float d = length(position.xy);
    float stagger = d * 0.14 + aSeed * 0.18;
    float local = clamp((uProgress - stagger) / 1.05, 0.0, 1.0);
    float e = local * local * (3.0 - 2.0 * local); // smoothstep easing

    vec3 pos = position + aDir * e * (1.3 + aSeed * 2.0);
    pos.z += sin(uTime * 0.7 + aSeed * 12.0) * e * 0.45;

    // Fade in as the plane fades out, then fade away as they travel.
    vAlpha = smoothstep(0.0, 0.08, uProgress) * (1.0 - smoothstep(0.62, 1.0, e));

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = uSize * uPixelRatio * (1.0 + e * 1.4) * (1.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Round, soft-edged point.
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;
    float soft = 1.0 - smoothstep(0.18, 0.5, r);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`;

export async function initHeroScene(container) {
  const img = container.querySelector('[data-js="hero-logo-img"]');
  if (REDUCED_MOTION || !hasWebGL() || !img) return null;

  let THREE;
  try {
    THREE = await import('/engineer2026/vendor/three/three.module.js');
  } catch (e) {
    return null;
  }

  const loader = new THREE.TextureLoader();
  let texture;
  try {
    texture = await new Promise((res, rej) => loader.load(img.src, res, undefined, rej));
  } catch (e) {
    return null;
  }
  texture.colorSpace = THREE.SRGBColorSpace;

  img.style.display = 'none';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  camera.position.z = 3.4;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.mixBlendMode = 'screen';
  container.appendChild(renderer.domElement);

  const aspect = texture.image.width / texture.image.height;
  const planeW = 2.4 * aspect;
  const planeH = 2.4;

  // --- intact logo ---------------------------------------------------------
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(planeW, planeH),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  );
  scene.add(plane);

  // --- dissolved logo ------------------------------------------------------
  const isSmall = window.innerWidth < 768;
  const sample = sampleLogo(texture.image, planeW, planeH, isSmall ? 3 : 2);

  let points = null;
  if (sample && sample.seeds.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(sample.colors, 3));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(sample.dirs, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sample.seeds, 1));

    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: isSmall ? 5.5 : 4.4 },
        uPixelRatio: { value: dpr },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    points = new THREE.Points(g, m);
    scene.add(points);
  }

  let target = { x: 0, y: 0 };
  let current = { x: 0, y: 0 };
  let progress = 0;
  let running = false, visible = true, rafId = null;

  function resize() {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }

  function onPointerMove(e) {
    const rect = container.getBoundingClientRect();
    target.y = ((e.clientX - rect.left) / rect.width - 0.5) * 0.14;
    target.x = -((e.clientY - rect.top) / rect.height - 0.5) * 0.14;
  }

  function loop(time) {
    if (!running) return;
    current.x += (target.x - current.x) * 0.06;
    current.y += (target.y - current.y) * 0.06;

    const t = (time || 0) * 0.001;
    const swayY = Math.sin(t * 0.22) * 0.13;
    const swayX = Math.sin(t * 0.17) * 0.045;

    // Flat plane: never a full revolution, or it turns edge-on and vanishes.
    plane.rotation.x = current.x + swayX;
    plane.rotation.y = current.y + swayY;
    if (points) {
      points.rotation.copy(plane.rotation);
      points.material.uniforms.uTime.value = t;
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  function start() { if (!running) { running = true; rafId = requestAnimationFrame(loop); } }
  function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; }

  const io = new IntersectionObserver((e) => {
    visible = e[0]?.isIntersecting ?? true;
    if (visible) start(); else stop();
  }, { threshold: 0 });
  io.observe(container);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else if (visible) start();
  });
  window.addEventListener('resize', resize, { passive: true });
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerleave', () => { target = { x: 0, y: 0 }; });

  resize();
  renderer.render(scene, camera);
  start();

  return {
    /** 0 = intact logo, 1 = fully dispersed. Driven by scroll. */
    setDisperse(p) {
      progress = Math.max(0, Math.min(1, p));
      // The solid mark yields quickly so the two never read as a double image.
      plane.material.opacity = Math.max(0, 1 - progress / 0.34);
      plane.visible = plane.material.opacity > 0.001;
      if (points) points.material.uniforms.uProgress.value = progress;
    },
    destroy() { stop(); io.disconnect(); renderer.dispose(); renderer.domElement.remove(); },
  };
}

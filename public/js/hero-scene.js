// ==========================================================================
// Hero Penrose object — a Three.js scene containing exactly one mesh: a
// plane textured with the ACTUAL logo asset (public/images/engineer26logo.png).
// This is deliberate: rather than hand-modeling new 3D geometry (risking
// drift from the reference), the real artwork is staged in a lit 3D scene —
// pointer parallax tilt and slow idle rotation — so the
// mark stays pixel-faithful while still reading as "engineered object in
// space." See design-system §09 for the performance budget this follows.
//
// Falls back to the plain <img> already in the DOM (with its own onerror
// placeholder) whenever: prefers-reduced-motion, no WebGL, or the texture
// fails to load. No console errors, no partial/broken canvas either way.
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

export async function initHeroScene(container) {
  const img = container.querySelector('[data-js="hero-logo-img"]');
  if (REDUCED_MOTION || !hasWebGL() || !img) return;

  let THREE;
  try {
    THREE = await import('/vendor/three/three.module.js');
  } catch (e) {
    return; // vendor bundle unavailable — the static image stays as-is
  }

  const loader = new THREE.TextureLoader();
  let texture;
  try {
    texture = await new Promise((resolve, reject) => loader.load(img.src, resolve, undefined, reject));
  } catch (e) {
    return; // asset missing/broken — img's own onerror already shows the placeholder
  }

  texture.colorSpace = THREE.SRGBColorSpace;

  // Texture loaded successfully: swap the flat <img> for the 3D scene.
  img.style.display = 'none';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  camera.position.z = 3.4;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Absolute, not in normal flow: the container is sized purely by CSS
  // (.hero-logo-frame). If the canvas participated in layout it would inflate
  // the container, and resize() — which measures that container — would read
  // its own output back, so the logo could grow but never shrink.
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.mixBlendMode = 'screen'; // source art sits on black — this drops the black
  container.appendChild(renderer.domElement);

  const aspect = texture.image.width / texture.image.height;
  const geo = new THREE.PlaneGeometry(2.4 * aspect, 2.4);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const plane = new THREE.Mesh(geo, mat);
  scene.add(plane);

  // No additive highlight sprite here: against the canvas's mix-blend-mode
  // screen compositing it rendered as a visible grey quad beside the logo
  // rather than a reflection. The logo art carries its own glow — the CSS
  // drop-shadow on the fallback and the scene's depth do the rest.

  let target = { x: 0, y: 0 };
  let current = { x: 0, y: 0 };
  let running = false;
  let visible = true;
  let rafId = null;

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    renderer.setSize(rect.width, rect.height);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }

  function onPointerMove(e) {
    const rect = container.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    // restrained: max ~8 degrees (0.14 rad)
    target.y = px * 0.14;
    target.x = -py * 0.14;
  }

  function loop(time) {
    if (!running) return;
    current.x += (target.x - current.x) * 0.06;
    current.y += (target.y - current.y) * 0.06;

    // The logo is a flat textured plane, so it must never make a full
    // revolution — it would turn edge-on and vanish, then show mirrored.
    // Instead it breathes around front-facing: a slow, time-based sway
    // (frame-rate independent, so it looks identical at 60Hz and 144Hz).
    // Brief §8: "do NOT make the logo spin constantly."
    const t = (time || 0) * 0.001;
    const swayY = Math.sin(t * 0.22) * 0.13;  // ±7.5°
    const swayX = Math.sin(t * 0.17) * 0.045; // ±2.6°

    plane.rotation.x = current.x + swayX;
    plane.rotation.y = current.y + swayY;

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    if (visible) start(); else stop();
  }, { threshold: 0.1 });
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
}

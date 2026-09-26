// ==========================================================================
// STATIC EXPORT — a GitHub Pages build of the site.
//
// Pages serves files, not an Express app, so this crawls the RUNNING server
// (npm run dev) and saves what it actually renders — no second templating
// path to drift from the real one. Assets are copied alongside, with the
// three / gsap / lenis files the server mounts under /vendor.
//
// A project site lives under a sub-path (https://<user>.github.io/<repo>/),
// while every URL on this site is root-absolute ("/images/…", "/js/…"), so
// BASE_PATH is prefixed onto those in the HTML, CSS and site JS.
//
// What cannot work on static hosting, and does not pretend to: anything that
// POSTs or calls /api (registration, payments, the game's leaderboard). The
// pages render; those requests simply fail as they would offline.
//
//   npm run dev                                   # in one terminal
//   BASE_PATH=/engineer2026 PUBLIC_URL=https://<user>.github.io/engineer2026 \
//     npm run export:static                       # writes dist/
// ==========================================================================

import { mkdir, writeFile, readFile, cp, rm, readdir } from 'fs/promises';
import path from 'path';

const ORIGIN = (process.env.ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || ORIGIN + BASE).replace(/\/$/, '');
const OUT = process.env.OUT || 'dist';

const events = JSON.parse(await readFile('data/events.json', 'utf8')).events;
const legalDocs = Object.keys(JSON.parse(await readFile('data/legal.json', 'utf8')).docs);

const routes = [
  '/', '/events', '/schedule', '/team', '/sponsors', '/about', '/register',
  ...legalDocs.map((d) => '/' + d),
  ...events.map((e) => '/events/' + e.slug),
];

// Every top-level path segment the site links or loads from. Only these are
// rebased, so a "/" inside a sentence or a regex is never touched.
const SEGMENTS = [
  'images', 'js', 'vendor', 'src', 'fonts', 'audio',
  'events', 'schedule', 'team', 'sponsors', 'about', 'register',
  ...legalDocs, 'api', 'ticket',
];
const segmentPath = new RegExp(
  `(["'\`(])\\/(?=(?:${SEGMENTS.join('|')})(?:[/?#"'\`)]|$))`, 'g');

function rebase(text) {
  if (!BASE) return text;
  return text
    .replace(segmentPath, `$1${BASE}/`)
    // The home link and its in-page anchors: href="/" and href="/#deck".
    .replace(/(href=["'])\/(["'#])/g, `$1${BASE}/$2`);
}

async function page(route, file) {
  const res = await fetch(ORIGIN + route);
  if (!res.ok && route !== '/__missing__') throw new Error(`${route} → ${res.status}`);
  let html = await res.text();
  html = rebase(html).split(ORIGIN).join(PUBLIC_URL);
  const dest = path.join(OUT, file);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, html);
  console.log(`  ${route.padEnd(34)} → ${file}`);
}

async function rebaseTree(dir, exts) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await rebaseTree(p, exts);
    else if (exts.includes(path.extname(entry.name))) {
      await writeFile(p, rebase(await readFile(p, 'utf8')));
    }
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

console.log(`Crawling ${ORIGIN} (base "${BASE || '/'}")`);
for (const r of routes) {
  await page(r, r === '/' ? 'index.html' : path.join(r.slice(1), 'index.html'));
}
// Pages serves 404.html for any path it does not have.
await page('/__missing__', '404.html');

// Static assets. input.css is the Tailwind source, not something a browser loads.
await cp('public', OUT, {
  recursive: true,
  filter: (src) => !/\.DS_Store$|input\.css$/.test(src),
});
await rebaseTree(path.join(OUT, 'js'), ['.js']);
await rebaseTree(path.join(OUT, 'src'), ['.css']);

// The three vendor mounts index.js serves straight from node_modules.
await mkdir(path.join(OUT, 'vendor/three'), { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) {
  await cp(path.join('node_modules/three/build', f), path.join(OUT, 'vendor/three', f));
}
await mkdir(path.join(OUT, 'vendor/gsap'), { recursive: true });
for (const f of await readdir('node_modules/gsap')) {
  if (f.endsWith('.js')) await cp(path.join('node_modules/gsap', f), path.join(OUT, 'vendor/gsap', f));
}
await cp('node_modules/lenis/dist/lenis.mjs', path.join(OUT, 'vendor/lenis/lenis.mjs'));

// Without this Pages runs the output through Jekyll, which drops any path
// starting with an underscore.
await writeFile(path.join(OUT, '.nojekyll'), '');

console.log(`\nDone: ${routes.length + 1} pages in ${OUT}/`);

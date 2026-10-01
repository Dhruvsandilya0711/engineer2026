# project_context.md

## Project Overview & Goal

**ENGINEER '26 — COGNITRIXX: "Rewire Reality"** — the website for the annual technical
festival of **NIT Karnataka, Surathkal**, running **23–25 October 2026**.

Brand hierarchy (do not conflate these):
- **ENGINEER '26** = the festival / official brand
- **COGNITRIXX** = the 2026 theme
- **REWIRE REALITY** = the theme tagline
- **The Penrose object** = the official ENGINEER logo (`public/images/engineer26logo.png`).
  It must never be redesigned, remodelled, recoloured or replaced.

**Mobile is the primary target, not a scaled-down desktop.** Stated explicitly by the
user; also saved to Claude's project memory. Budget WebGL contexts, particle counts
and canvas count for phones first. Test mobile emulation *before* declaring anything done.

### Standing content rule
Never invent event names, dates, times, venues, prizes, rules, speakers, sponsors,
statistics or team members. Unknown values stay `null` and render as honest empty
states ("TBA", "Awaiting brief", "Roster pending"). This has been applied consistently
and should not be relaxed.

---

## System Architecture & Tech Stack

**Repo:** `github.com/wildcodesmith/engineer_nitk26` (branch `main`)
**Working dir:** `C:\Users\WELCOME\Downloads\engineer_nitk26\.claude\worktrees\engineer-nitk-audit-db7bab`
(a git worktree — run everything from here, never `cd` to the original checkout)

**Stack** — deliberately unchanged from the original project; no framework migration:
| Layer | Tech |
|---|---|
| Runtime | Node.js v22 |
| Server | Express 5.2 (`index.js`) |
| Views | EJS 6 — server-rendered, no bundler |
| CSS | Tailwind v4 (CSS-first `@theme`), built to `public/src/output.css` |
| 3D | three.js 0.185 |
| Animation | GSAP 3.15 + ScrollTrigger, Lenis 1.3 (smooth scroll) |
| DB | mongoose 9 (**idle — no `DBURL` set**) + dotenv |

Vendor ESM is served straight from `node_modules` via `/vendor/three`, `/vendor/gsap`,
`/vendor/lenis`. There is **no build step for JS**.

### Commands
```bash
npm run dev          # node index.js — port 3000, HOST 0.0.0.0
npm run build:css    # Tailwind build (REQUIRED after any input.css edit)
```
LAN URL: `http://10.50.47.158:3000` (campus network NITK-NET, classified Public).
`HOST=127.0.0.1 npm run dev` to keep it local-only.

### Routes (`index.js`)
`/` · `/events` · `/events/:slug` · `/schedule` · `/team` · `/register` (GET+POST) · 404 handler

### Data layer — single source of truth, all derived
- `data/events.json` — 14 **real** events (names/images from the original repo). Categories
  are *derived* from the data, so the UI can never offer a category that doesn't exist.
- `data/schedule.json` — 3 real days (23/24/25 Oct). **All `slots` empty.** Weekday is
  derived from the date at render time, never stored.
- `data/team.json` — **`members: []`**. Groups derive from members, so no empty section
  can appear.
- `data/registrations.json` — local dev store, **gitignored (contains PII)**.

### Key JS modules (`public/js/`)
| File | Owns |
|---|---|
| `scroll.js` | **Sole owner of scroll.** Lenis + ScrollTrigger wired to one clock. Nothing else may create a Lenis instance or scroll rAF loop. |
| `cognitrixx-3d.js` | Reusable neural field. `[data-field]` mounts + `data-priority` mobile budget. |
| `preloader.js` | Boot sequence (LOAD→BURST→WIPE→DONE), ported from the reference `.dc.html`. |
| `dots.js` | Scroll dot-dissolve (tiled mask, not particles). |
| `cursor.js` | Custom cursor — desktop-only by design. |
| `site.js` | Shared chrome: nav, drawer, magnetic CTAs, countdown. |
| `main.js` / `page.js` | Homepage / inner-page orchestration. |
| `hero-scene.js` | **Retained but NOT mounted** (logo + particle dissolve, from an earlier direction). |

---

## Current Progress & What Works

### Design system — currently the **design handoff** tokens
Superseded the earlier Unbounded/IBM Plex system. Now:
- **Chakra Petch** (display, 700 + italic) + **Space Mono** (everything else)
- `#000` bg, `#05060a` panel, slate text ramp (`#f1f5f9` → `#475569`)
- Accents step **cyan `#22d3ee` → indigo `#6366f1` → violet `#a78bfa` → magenta `#e879f9`**
- **Radius 0 everywhere** — shape comes from clip-path bevels

Colour roles kept distinct (do not flatten): amber = Cognitrixx neural energy,
blue/violet/magenta = ENGINEER Penrose identity, cyan = technical signal.

### The revamp layer (Sep 2026) — "same circuitry, turned up"
Palette, faces, bevels and all content are unchanged; scale, light and motion
were raised. Everything lives in the `R1`–`R13` block at the end of
`public/src/input.css` (unlayered, so it wins over the component layer) and in
`public/js/motion.js`, which is loaded as its **own** `<script type="module">`
on every page so it never waits for three.js to download.

| Hook | Does |
|---|---|
| `data-split` | Headline `<br>`-lines rise out of masks on arrival (`.sl` / `.sl__i`) |
| `data-scramble="ms"` | Label decodes out of glyph noise on arrival |
| `data-marquee` + `.mq__track` | CSS-looped band; JS modulates `playbackRate` with scroll velocity/direction. `animation-direction: reverse` on a row makes it counter-rotate |
| `data-highlight` | Paragraph lights word by word as it scrolls (GSAP scrub) |
| `data-spotlight` (+ `--spot: r,g,b`) | Cursor-following light on a surface (fine pointer only) |
| `data-preview="/img"` | Floating photo plate that trails the cursor over links |
| `data-img-reveal` | Photo wipes open on arrival |
| `data-hero` + `--hd` (ms) | Hero entrance, pure CSS, keyed to `html.hero-go` (set by preloader at wipe start, or the inline gate in `_entry.ejs` on repeat visits; 7s failsafe) |

Hidden poses are always scoped to `html.js` (set inline in `_transition.ejs`)
and `prefers-reduced-motion: no-preference`, so JS-off and reduced-motion get a
complete static page. `[data-reveal]` was fixed the same way — it used to be
opacity 0 forever with JS off.

### Working and verified
- **Preloader** — 4 phases, measured **3.51s** total (reference 3.30s). Shard base offsets,
  torn slivers, chroma split, rolling scanlines, 9-band shutter wipe. First-visit only
  (sessionStorage); `prefers-reduced-motion` → 200ms fade. Hero is in the DOM underneath.
- **Hero** — HUD status bar, 6 angular nav bays (2→3→6 across), sliced scanline wordmark,
  status strip, COGNITRIXX, tagline, date, CTA, live countdown. **Fits one screen at
  320/390/414/768/1024/1440.**
- **Homepage flow** — intro → hero → cognitrixx → narrative (pinned, 6 beats) → about →
  events rail (pinned horizontal) → schedule → speakers → NITK → gallery → legacy →
  sponsors → final CTA → footer.
- **Registration** — works end to end. Server-side validation, duplicate detection (409),
  honest error states. **Reuses the existing `useraccounts` schema** from the user's
  `payment_gateway` project (userName, userRollNumber, userEvent, userMail, isPaid) so
  there is no second registration system. **No Razorpay, passes, tickets or QR.**
- **Events platform** — editorial index, search + category filters (server-side, works
  with JS off; client-side is progressive enhancement), data-driven detail pages with
  per-event SEO/OG.
- **Scroll dot-dissolve** — content breaks into dots at viewport edges, reassembles on
  return. **Hero is excluded** (it rendered dotted on load otherwise).
- **Mobile** — 0 undersized tap targets across all 5 routes, no overflow 320→1920px,
  max 2 WebGL fields on phones (down from 6), native swipe rail, no custom cursor.

### Bugs found and fixed (do not reintroduce)
1. Preloader readiness waited on `document.images` incl. `loading="lazy"` — 20/24 never
   loaded, so load always hit the 4s cap. Now filters lazy images.
2. Preloader `L` derived from live clock → chased `T`, load never ended. Now records
   *when* readiness landed.
3. Shutter bands painted on top → blacked out the whole preloader. Now the backdrop.
4. Hero overran viewport at 5/6 widths, clipping the countdown. Stacked margins can't
   respond to viewport *height* → replaced with one clamped gap.
5. Events rail viewport expanded to full track width → `travelNeeded: 0`, pinned scroll
   did nothing. Flex child now constrained.
6. Logo rotated edge-on and vanished (flat plane, full Y-rotation). Now a time-based sway.

### Testing gotchas (important — these produced false results)
- **`body { overflow-x: hidden }` makes `scrollWidth` overflow checks give false
  negatives.** Measure rendered text against its container instead.
- **Lenis intercepts programmatic `scrollTo`.** Drive real wheel events via CDP.
- **Synthetic `PointerEvent`s get overridden** by the browser's next real pointermove.
- **Mobile emulation FPS is meaningless** (desktop GPU, small viewport). It reported
  101fps while 6 WebGL contexts were live — a real phone would have suffered.
- Verification is done with headless Chrome + CDP scripts in
  `C:\Users\WELCOME\AppData\Local\Temp\claude\` (`check-mobile.mjs`, `check-hf.mjs`,
  `pl-timing.mjs`, `shoot-mob.mjs`, etc.). These are scratch files, not in the repo.

---

## Current Active Task & Blockers

### Uncommitted work
**Last push: `2ddd42e`** ("Redesign: continuous scroll experience…").
Since then there are **23 modified tracked files + 3 untracked** covering:
custom cursor, mobile WebGL budget, tap-target fixes, clean/typography hero, scroll
dot-dissolve, the full design-handoff application (fonts, tokens, HUD nav bays, sliced
wordmark), and the rebuilt preloader.
**None of this is pushed.** The user has not yet asked to commit it.

### Blockers
1. **No auth or database.** Registration writes to a local JSON file because `DBURL`
   is unset. The **mongoose path is written but UNTESTED** — no connection string
   available. Set `DBURL` in `.env` to activate; startup logs which store is active.
2. **No real data** for Speakers, Sponsors, Team, or any event date/venue/prize/rule.
   All render as honest empty states by design.
3. **No typecheck or lint configured** in this project. `node --check` on each JS file
   is the substitute. "Build" = the Tailwind CSS build only.
4. **`/events/:slug/register`** is referenced by the `open` registration state but has
   no route — currently unreachable, would 404 if a state changed.

### Open decisions for the user
- Whether ENGINEER '26 is **ticketed** (Cognizance sells passes via cart + payments;
  the user's `payment_gateway` zip contains Razorpay). Currently registration-only per
  explicit instruction.
- Whether to keep `b.mp4`, `engilogo.jpg`, `theme-cognitrixx.png`, `proshows.png` —
  unreferenced but recent/owner-supplied, so deliberately not deleted.
- 4 junk files `screenshots$num-*.png` remain untracked in the working dir (gitignored).

---

## Next Steps (Numbered)

1. **Commit and push the outstanding work to `main`** — 26 files covering cursor, mobile
   budget, hero, dot-dissolve, design handoff and preloader. Check `git log origin/main`
   for divergence first: main has moved under us before, and a force push would have
   destroyed a collaborator's commits.
2. **Propagate the handoff design system to inner pages** — `/events`, `/events/:slug`,
   `/schedule`, `/team`, `/register` still use the older component styling in places
   (`.btn`, `.card-bracket`, old eyebrow). Fonts and tokens already switched sitewide.
3. **Verify on a real phone** over the LAN URL. All mobile results so far are emulated:
   emulation gets viewport/touch/pointer right but **not GPU or CPU**.
4. **Decide the registration backend** — provide `DBURL` to activate mongoose and test
   the Mongo path, or confirm the file store is acceptable for now.
5. **Add `/events/:slug/register`** or remove the reference, so no state can 404.
6. **Fill real data** as it is confirmed: schedule slots, team roster, speakers,
   sponsors, event details. All three JSON files document their expected shape inline.
7. **Optional / deferred:** the standalone 4s looping glitch composition
   (`Darken Glitch.dc.html`) — only needed if a video/background asset is wanted; the
   homepage does not depend on it.

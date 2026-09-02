import express from 'express';
import 'dotenv/config';
import {fileURLToPath} from 'url';
import {dirname} from 'path';
import path from 'path'
import {readFileSync} from 'fs';
import {networkInterfaces} from 'os';
import {initRegistrationStore, validate, saveRegistration, storeMode} from './lib/registration.js';
import {
  initLeaderboardStore, leaderboardMode, hasStableSalt,
  hashIp, validateRun, rateLimit, saveRun, topRuns, rankFor, hideRun,
} from './lib/leaderboard.js';

const __fileName = fileURLToPath(import.meta.url)
const __dirname = dirname(__fileName)

const app = express();
// HOST defaults to 0.0.0.0 so the site is reachable from other devices on the
// same network (phones, teammates' laptops) — not just this machine.
// Set HOST=127.0.0.1 to keep it private to localhost.
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

// ENGINEER '26 is happening 23–25 October 2026 (as given in the brief) —
// single source of truth for the hero countdown and the date shown in copy.
const FEST_DATES = { start: '2026-10-23', end: '2026-10-25', display: '23—25 OCTOBER 2026' };

const eventData = JSON.parse(readFileSync(path.join(__dirname, 'data/events.json'), 'utf-8'));
const allEvents = eventData.events;

// Categories are DERIVED from the actual event data — never a hand-written
// list, so the filter bar can only ever offer categories that exist.
const categories = [...new Set(allEvents.map(e => e.category))].sort();

// Registration copy lives server-side so every surface (listing, detail,
// homepage) describes the same state in the same words.
const REGISTRATION_STATES = {
  not_open:      { label: 'Registration not open',  tone: 'idle',   actionable: false },
  opening_soon:  { label: 'Opening soon',           tone: 'idle',   actionable: false },
  open:          { label: 'Registration open',      tone: 'live',   actionable: true  },
  closing_soon:  { label: 'Closing soon',           tone: 'warn',   actionable: true  },
  closed:        { label: 'Registration closed',    tone: 'closed', actionable: false },
  full:          { label: 'Event full',             tone: 'closed', actionable: false },
  completed:     { label: 'Completed',              tone: 'closed', actionable: false },
};
const regState = (e) => REGISTRATION_STATES[e.registration] || REGISTRATION_STATES.not_open;

const events = {
  all: allEvents,
  featured: allEvents.filter(e => e.featured),
  categories,
};

// Gallery is DERIVED from the real event photographs already in the repo —
// no separate gallery dataset is invented.
const gallery = allEvents.filter(e => e.image).map(e => ({ image: e.image, caption: e.name, slug: e.slug }));

const schedule = JSON.parse(readFileSync(path.join(__dirname, 'data/schedule.json'), 'utf-8'));
const teamData = JSON.parse(readFileSync(path.join(__dirname, 'data/team.json'), 'utf-8'));

// Everything sourced from the ENGINEER '26 sponsorship brochure: the scale
// figures, the research centres, and the three logo walls (past sponsors,
// alumni-founded companies, industry partners). See data/fest.json for the
// provenance note — none of it is estimated here.
const fest = JSON.parse(readFileSync(path.join(__dirname, 'data/fest.json'), 'utf-8'));
const proshows = JSON.parse(readFileSync(path.join(__dirname, 'data/proshows.json'), 'utf-8'));

// The line-up heading depends on whether anything is signed for '26 yet, so
// derive it rather than hard-coding a claim that will quietly go stale.
const proshowState = {
  ...proshows,
  confirmed: proshows.acts.filter(a => a.status === 'confirmed'),
  past: proshows.acts.filter(a => a.status !== 'confirmed'),
};

// Programme tracks (brochure §03). Each carries the events mapped to it so a
// track can render its own roster without the view re-filtering.
const tracks = Object.entries(eventData._tracks || {}).map(([id, t]) => ({
  id, ...t, events: allEvents.filter(e => e.track === id),
}));

// Slots reference events by slug; resolve them once so views never have to.
function resolvedDays() {
  return schedule.days.map(day => ({
    ...day,
    // Derived, never stored — a hand-written weekday could contradict the date.
    weekday: new Date(`${day.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' }),
    slots: [...day.slots]
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .map(slot => ({ ...slot, linkedEvent: slot.event ? allEvents.find(e => e.slug === slot.event) || null : null })),
  }));
}

// Events that exist but haven't been given a slot yet — shown honestly rather
// than being quietly dropped or assigned a made-up time.
function unscheduledEvents() {
  const scheduled = new Set(schedule.days.flatMap(d => d.slots.map(s => s.event).filter(Boolean)));
  return allEvents.filter(e => !scheduled.has(e.slug));
}

// Groups are DERIVED from the roster, so an empty roster yields no groups and
// the page can never advertise a section that has nobody in it.
function teamGroups() {
  const members = (teamData.members || []).filter(m => m && m.name && m.role);
  const order = [...new Set(members.map(m => m.group || 'Team'))];
  return order.map(group => ({ group, members: members.filter(m => (m.group || 'Team') === group) }));
}

app.set('view engine', 'ejs');

app.use(express.static('public'));
// Serve the browser (ESM) builds of three.js and gsap directly — no bundler
// in this project, so these are mounted as static vendor assets instead.
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/gsap', express.static(path.join(__dirname, 'node_modules/gsap')));
app.use('/vendor/lenis', express.static(path.join(__dirname, 'node_modules/lenis/dist')));

// Form posts for registration.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  // The homepage deck's TEAM card shows counts only when there is a real
  // roster (data/team.json ships empty on purpose), so it needs the same
  // derived groups /team uses rather than a second source of truth.
  const groups = teamGroups();
  res.render('index', {
    festDates: FEST_DATES,
    events,
    scheduleDays: resolvedDays(),
    gallery,
    regState,
    teamTotal: groups.reduce((n, g) => n + g.members.length, 0),
    teamGroupCount: groups.length,
    fest,
    tracks,
    proshows: proshowState,
  });
});

// Event discovery. Filtering runs server-side off query params so search and
// category filters work with JavaScript disabled; public/js/events-filter.js
// then layers instant client-side filtering on top as a progressive
// enhancement (14 events — no need to round-trip for every keystroke).
app.get('/events', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const category = (req.query.category || '').toString().trim();

  const needle = q.toLowerCase();
  const results = allEvents.filter(e => {
    const matchesQuery = !needle
      || e.name.toLowerCase().includes(needle)
      || e.category.toLowerCase().includes(needle);
    const matchesCategory = !category || category === 'All' || e.category === category;
    return matchesQuery && matchesCategory;
  });

  res.render('events', {
    festDates: FEST_DATES,
    events,
    results,
    query: q,
    activeCategory: category || 'All',
    regState,
    tracks,
  });
});

app.get('/schedule', (req, res) => {
  const days = resolvedDays();
  res.render('schedule', {
    festDates: FEST_DATES,
    days,
    unscheduled: unscheduledEvents(),
    totalSlots: days.reduce((n, d) => n + d.slots.length, 0),
    regState,
  });
});

app.get('/team', (req, res) => {
  const groups = teamGroups();
  res.render('team', {
    festDates: FEST_DATES,
    groups,
    totalMembers: groups.reduce((n, g) => n + g.members.length, 0),
  });
});

// Sponsors. Tier STRUCTURE only — there is no sponsor data in this codebase and
// none is invented here, so every slot renders as open (same rule as the deck
// card in partials/_sponsors.ejs). Wire a real list in once partners confirm.
const SPONSOR_TIERS = [
  { name: 'Title',  accent: '232,121,249' },
  { name: 'Gold',   accent: '232,146,60'  },
  { name: 'Silver', accent: '148,163,184' },
];

app.get('/sponsors', (req, res) => {
  res.render('sponsors', {
    festDates: FEST_DATES,
    tiers: SPONSOR_TIERS,
    openSlots: SPONSOR_TIERS.length,
    eventCount: allEvents.length,
    fest,
  });
});

app.get('/events/:slug', (req, res, next) => {
  const event = allEvents.find(e => e.slug === req.params.slug);
  if (!event) return next(); // falls through to the 404 handler

  const related = allEvents
    .filter(e => e.category === event.category && e.slug !== event.slug)
    .slice(0, 3);

  res.render('event-detail', {
    festDates: FEST_DATES,
    event,
    related,
    regState,
    // The brochure describes TRACKS, not individual events, so an event with
    // no description of its own can still say what kind of thing it is.
    track: tracks.find(t => t.id === event.track) || null,
    index: allEvents.indexOf(event) + 1,
    canonical: `${req.protocol}://${req.get('host')}/events/${event.slug}`,
  });
});


// ---------------------------------------------------------------- register
// Registration ONLY. No passes, tickets, QR or payment — see lib/registration.js.
app.get('/register', (req, res) => {
  res.render('register', {
    festDates: FEST_DATES,
    events,
    values: { userName: '', userRollNumber: '', userEvent: req.query.event || '', userMail: '' },
    errors: {},
    status: null,
  });
});

app.post('/register', async (req, res) => {
  const { valid, errors, value } = validate(req.body || {});

  if (!valid) {
    return res.status(400).render('register', {
      festDates: FEST_DATES, events, values: req.body || {}, errors, status: 'invalid',
    });
  }

  const result = await saveRegistration(value);

  if (result.duplicate) {
    return res.status(409).render('register', {
      festDates: FEST_DATES, events, values: req.body,
      errors: { userMail: 'This email is already registered for that event.' },
      status: 'duplicate',
    });
  }
  if (!result.ok) {
    return res.status(500).render('register', {
      festDates: FEST_DATES, events, values: req.body, errors: {}, status: 'error',
    });
  }

  res.render('register', {
    festDates: FEST_DATES, events,
    values: { userName: '', userRollNumber: '', userEvent: '', userMail: '' },
    errors: {}, status: 'success',
  });
});

// -------------------------------------------------------- signal range board
// PHASE 1: the browser reports its own score, so these numbers are CLAIMS.
// lib/leaderboard.js rejects runs that are impossible under the game's own
// scoring rules, which stops a hand-edited payload but not a patched client —
// the board is labelled unverified for exactly that reason. Do not settle the
// two ₹2,500 prizes on these alone; see the note at the top of that module.

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || req.socket?.remoteAddress || '';

app.get('/api/range/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(25, Math.max(1, Number(req.query.limit) || 10));
    const [score, streak] = await Promise.all([
      topRuns('score', limit),
      topRuns('streak', limit),
    ]);
    res.json({ ok: true, verified: false, boards: { score, streak } });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Leaderboard unavailable.' });
  }
});

app.post('/api/range/score', async (req, res) => {
  try {
    const { valid, errors, value } = validateRun(req.body || {});
    if (!valid) return res.status(400).json({ ok: false, errors });

    const ipHash = hashIp(clientIp(req));
    const gate = await rateLimit(ipHash);
    if (!gate.ok) return res.status(429).json({ ok: false, errors: { form: gate.reason } });

    const { id } = await saveRun(value, ipHash);
    const [scoreRank, streakRank] = await Promise.all([
      rankFor('score', value.score),
      rankFor('streak', value.streak),
    ]);
    res.json({ ok: true, id, rank: { score: scoreRank, streak: streakRank } });
  } catch (err) {
    res.status(500).json({ ok: false, errors: { form: 'Could not save that run.' } });
  }
});

// Moderation. A public free-text board WILL collect names that have to come
// off it; this is the way to do that without a database client. Requires
// ADMIN_TOKEN to be set — with no token configured the route stays closed
// rather than defaulting to open.
app.post('/api/range/hide', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.get('x-admin-token') !== token) return res.status(404).end();
  const ok = await hideRun(String(req.body?.id || ''), req.body?.hidden !== false);
  res.status(ok ? 200 : 404).json({ ok });
});

app.use((req, res) => {
  res.status(404).render('404', { url: req.originalUrl });
});

// Every non-internal IPv4 address, so the startup log prints a URL that can
// actually be shared rather than just "localhost".
function lanAddresses() {
  return Object.entries(networkInterfaces())
    .flatMap(([name, addrs]) => (addrs || []).map(a => ({ ...a, name })))
    .filter(a => a.family === 'IPv4' && !a.internal)
    .map(a => ({ name: a.name, address: a.address }));
}

const storeInfo = await initRegistrationStore();
console.log(`
  Registration store: ${storeMode()} — ${storeInfo.reason}`);

const boardInfo = await initLeaderboardStore();
console.log(`  Leaderboard store:  ${leaderboardMode()} — ${boardInfo.reason}`);
if (!hasStableSalt) {
  console.log(`  ! LEADERBOARD_SALT unset — IP hashes reset each restart, so the`);
  console.log(`    rate limiter forgets everything when the server bounces.`);
}
if (!process.env.ADMIN_TOKEN) {
  console.log(`  ! ADMIN_TOKEN unset — /api/range/hide is closed, so there is no`);
  console.log(`    way to take an abusive name off the public board.`);
}

app.listen(port, host, () => {
  console.log(`\n  ENGINEER '26 — Cognitrixx\n`);
  console.log(`  Local:    http://localhost:${port}`);
  if (host === '0.0.0.0') {
    for (const { name, address } of lanAddresses()) {
      console.log(`  Network:  http://${address}:${port}   (${name})`);
    }
    console.log(`\n  Share a Network URL with anyone on the same Wi-Fi/LAN.`);
    console.log(`  If Windows Firewall prompts, allow Node.js on the profile this`);
    console.log(`  network actually uses (check with: Get-NetConnectionProfile).`);
    console.log(`  Note: many campus/guest networks isolate clients, which blocks`);
    console.log(`  device-to-device access regardless of firewall settings.`);
  } else {
    console.log(`  (bound to ${host} — this machine only)`);
  }
  console.log('');
});
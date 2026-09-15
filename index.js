import express from 'express';
import 'dotenv/config';
import {fileURLToPath} from 'url';
import {dirname} from 'path';
import path from 'path'
import {readFileSync} from 'fs';
import {networkInterfaces} from 'os';
import crypto from 'crypto';
import {
  initRegistrationStore, validate, saveRegistration, storeMode,
  createPendingRegistration, markPaid, findByOrderId, hasPaidRegistration,
} from './lib/registration.js';
import {
  initPayments, paymentsMode, paymentsEnabled, publicKeyId, feeFor, feeMap,
  createOrder, verifyCheckoutSignature, verifyWebhookSignature,
} from './lib/payments.js';
import {
  generateTicketPDF, sendTicket, ticketToken, ticketTokenValid,
  emailConfigured, hasStableTicketSecret, publicOrigin,
} from './lib/tickets.js';
// Aliased: lib/leaderboard.js exports its own `rateLimit`, which counts saved
// runs rather than requests. Two different limiters, two different names.
import { securityHeaders, rateLimit as requestLimit, errorHandler } from './lib/security.js';
import {
  initLeaderboardStore, leaderboardMode, hasStableSalt,
  hashIp, validateName, rateLimit, saveRun, topRuns, rankFor, hideRun,
  issueSession, verifySession, sessionUsed,
} from './lib/leaderboard.js';
// The SAME simulation the browser runs. Replaying a submitted trace through
// it is what makes a leaderboard score a fact rather than a claim.
import { replay } from './public/js/range-sim.js';

const __fileName = fileURLToPath(import.meta.url)
const __dirname = dirname(__fileName)

const app = express();
// CCC will serve engineer.nitk.ac.in through a reverse proxy terminating TLS.
// Without this, req.protocol reports the http hop between proxy and node, so
// every canonical and og:image on the site would advertise an http:// URL on
// an https:// page — which is an SEO error and stops social cards resolving.
// 1 = trust exactly one proxy hop, not an arbitrary X-Forwarded-For chain.
app.set('trust proxy', 1);
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

/**
 * The site's public origin. PUBLIC_ORIGIN wins when set, because it is the
 * only thing that is right in every context: the Razorpay webhook arrives
 * with no `req` to read a host from, and a request's Host header is
 * attacker-controlled. Falls back to the request so local development needs
 * no configuration.
 */
const originFor = (req) =>
  publicOrigin() || `${req.protocol}://${req.get('host')}`;

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
// Express advertises itself by default; there is no reason to tell an
// attacker which stack to look up exploits for.
app.disable('x-powered-by');

/**
 * JSON destined for a <script> block.
 *
 * JSON.stringify does NOT escape "<", so a value containing a literal
 * </script> closes the tag and everything after it is parsed as HTML. The
 * payment payload carries the registrant's own name, so that value is
 * attacker-chosen. \u003c is valid JSON and JSON.parse turns it back into
 * "<", so the page reads the same data and the tag cannot be closed.
 */
app.locals.safeJson = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

// FIRST middleware: every response carries the headers, including the ones
// express.static answers by itself.
app.use(securityHeaders(() => paymentsEnabled()));

app.use(express.static('public'));
// Serve the browser (ESM) builds of three.js and gsap directly — no bundler
// in this project, so these are mounted as static vendor assets instead.
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/gsap', express.static(path.join(__dirname, 'node_modules/gsap')));
app.use('/vendor/lenis', express.static(path.join(__dirname, 'node_modules/lenis/dist')));

// Form posts for registration.
app.use(express.urlencoded({ extended: true }));
// The Razorpay webhook signature is computed over the RAW bytes. Re-serialising
// the parsed object reorders keys and drops whitespace, so the signature would
// never match — the raw buffer has to be kept as it arrives.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

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

  const origin = originFor(req);
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
    canonical: `${origin}/events/${event.slug}`,
    // og:image has to be an ABSOLUTE url -- a crawler will not resolve a
    // site-relative path against the page, so the relative one this used to
    // emit produced no card at all when an event link was pasted into
    // WhatsApp or Instagram. The four events with no photo of their own
    // fall back to the wordmark rather than to an empty content="".
    ogImage: origin + (event.image || '/images/engineer26-wordmark.png'),
  });
});


// ---------------------------------------------------------------- register
// Registration ONLY. No passes, tickets, QR or payment — see lib/registration.js.
// `payment` is null on every path except the one that has just created a
// Razorpay order. The view opens checkout when it is present, so there is one
// template rather than a separate payment page to keep in step with this one.
const renderRegister = (res, opts) => res.render('register', {
  festDates: FEST_DATES,
  events,
  values: { userName: '', userRollNumber: '', userEvent: '', userMail: '' },
  errors: {},
  status: null,
  payment: null,
  fees: {},
  ...opts,
});

/**
 * Prices for the event picker. Looked up on every render rather than cached,
 * because a fee added in the database has to reach the form immediately —
 * showing yesterday's price next to today's charge is the one bug here that
 * costs somebody money.
 *
 * A lookup failure yields {} and the form simply shows no prices; the real
 * charge is decided again on POST, where a failure is a 503 instead of a
 * silent free pass.
 */
async function eventFees() {
  try { return await feeMap(allEvents.map(e => e.name)); }
  catch { return {}; }
}

app.get('/register', async (req, res) => {
  renderRegister(res, {
    values: { userName: '', userRollNumber: '', userEvent: req.query.event || '', userMail: '' },
    fees: await eventFees(),
  });
});

// A dozen registrations in a second were accepted before this existed, so
// a script could fill the table and bury the real entries. Twelve an hour
// from one address is far above any genuine student and far below useful to
// a spammer. Keyed on the forwarded address because CCC runs a proxy.
const registerLimit = requestLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  key: (req) => clientIp(req),
  message: 'Too many registrations from this connection. Please try again later.',
});

app.post('/register', registerLimit, async (req, res) => {
  const { valid, errors, value } = validate(req.body || {});
  // Needed by every path that re-renders the form: coming back with an error
  // must not drop the prices out of the event picker.
  const fees = await eventFees();

  if (!valid) {
    return res.status(400).render('register', {
      festDates: FEST_DATES, events, values: req.body || {}, errors, status: 'invalid', payment: null, fees,
    });
  }

  // Does this event cost anything? The price is looked up server-side and the
  // request has no say in it, so a posted amount is simply ignored. Events
  // with no fee row are free and take the original one-step path below.
  let fee = null;
  try {
    fee = await feeFor(value.userEvent);
  } catch {
    return res.status(503).render('register', {
      festDates: FEST_DATES, events, values: req.body, errors: {}, status: 'error', payment: null, fees,
    });
  }

  if (fee && paymentsEnabled()) {
    // A PAID row is what blocks a second attempt. An abandoned checkout leaves
    // an unpaid row behind and must not lock the person out of trying again.
    if (await hasPaidRegistration(value.userMail, value.userEvent)) {
      return res.status(409).render('register', {
        festDates: FEST_DATES, events, values: req.body,
        errors: { userMail: 'This email has already paid for that event.' },
        status: 'duplicate', payment: null, fees,
      });
    }

    try {
      const order = await createOrder({
        rupees: fee,
        receipt: `engi26_${Date.now()}`,
        // Echoed back on the webhook, which otherwise knows only an order id.
        notes: { event: value.userEvent, roll: value.userRollNumber },
      });

      // The row is written BEFORE the money moves. The webhook arrives with an
      // order id and nothing else, so the row it updates has to exist already.
      const pending = await createPendingRegistration(value, order.id, fee);
      if (!pending.ok) throw new Error(pending.error || 'could not record the order');

      return renderRegister(res, {
        values: req.body,
        status: 'pay',
        payment: {
          orderId: order.id,
          amountPaise: order.amount,
          rupees: fee,
          keyId: publicKeyId(),
          eventName: value.userEvent,
          userName: value.userName,
          userMail: value.userMail,
        },
      });
    } catch (err) {
      console.error('order creation failed:', err.message);
      return res.status(502).render('register', {
        festDates: FEST_DATES, events, values: req.body, errors: {}, status: 'pay-error', payment: null, fees,
      });
    }
  }

  // ---- free event: unchanged from before payments existed ----
  const result = await saveRegistration(value);

  if (result.duplicate) {
    return res.status(409).render('register', {
      festDates: FEST_DATES, events, values: req.body,
      errors: { userMail: 'This email is already registered for that event.' },
      status: 'duplicate', payment: null, fees,
    });
  }
  if (!result.ok) {
    return res.status(500).render('register', {
      festDates: FEST_DATES, events, values: req.body, errors: {}, status: 'error', payment: null, fees,
    });
  }

  renderRegister(res, { status: 'success' });
});


// ------------------------------------------------------------------ payments
// Two independent confirmations of the same payment, on purpose:
//
//   /api/pay/verify   the browser's checkout handler. Fast, so the visitor
//                     gets an answer, but it only ever arrives if the visitor
//                     kept the tab open.
//   /api/pay/webhook  Razorpay calling the server directly. Slower, but it
//                     arrives even if the browser was closed mid-payment, and
//                     it is retried until it gets a 2xx.
//
// Both call markPaid(), which is idempotent and reports whether IT was the
// call that flipped the row — so whichever lands first sends the one ticket
// and the other is a no-op.

async function issueTicket(orderId, label) {
  const user = await findByOrderId(orderId);
  if (!user) return { ok: false, reason: 'order has no registration' };
  try {
    const pdf = await generateTicketPDF(user);
    const mail = await sendTicket(user, pdf);
    if (!mail.sent) console.warn(`  ticket for ${orderId} not emailed (${label}): ${mail.reason}`);
    return { ok: true, emailed: mail.sent };
  } catch (err) {
    // A ticket that cannot be rendered must not un-pay a payment. The row is
    // already marked paid and /ticket can regenerate it on demand.
    console.error(`  ticket generation failed for ${orderId}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

app.post('/api/pay/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id) {
    return res.status(400).json({ ok: false, error: 'Incomplete payment details.' });
  }

  if (!verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    console.warn('  checkout signature mismatch for', razorpay_order_id);
    return res.status(400).json({ ok: false, error: 'Payment could not be verified.' });
  }

  const marked = await markPaid(razorpay_order_id, razorpay_payment_id);
  if (!marked.ok) return res.status(500).json({ ok: false, error: 'Could not record the payment.' });

  if (marked.changed) await issueTicket(razorpay_order_id, 'checkout');

  res.json({
    ok: true,
    ticket: `/ticket/${encodeURIComponent(razorpay_order_id)}?t=${ticketToken(razorpay_order_id)}`,
  });
});

app.post('/api/pay/webhook', async (req, res) => {
  if (!verifyWebhookSignature(req.rawBody, req.get('x-razorpay-signature'))) {
    return res.status(400).send('invalid signature');
  }
  // 2xx for events we do not act on, or Razorpay retries them forever.
  if (req.body?.event !== 'payment.captured') return res.status(200).send('ignored');

  const payment = req.body?.payload?.payment?.entity;
  if (!payment?.order_id) return res.status(200).send('no order id');

  const marked = await markPaid(payment.order_id, payment.id);
  if (!marked.ok) return res.status(500).send('could not record');
  if (marked.changed) await issueTicket(payment.order_id, 'webhook');

  res.status(200).send('ok');
});

// The ticket itself. The token is an HMAC of the order id: order ids travel
// in emails, URLs and screenshots and are an identifier, not a secret, so a
// bare one must not be enough to pull down somebody's name, roll number and
// address. A bad token is a 404, not a 403 — there is no reason to confirm
// that an order exists to someone who cannot prove they own it.
app.get('/ticket/:orderId', async (req, res) => {
  const { orderId } = req.params;
  if (!ticketTokenValid(orderId, req.query.t)) return res.status(404).end();

  const user = await findByOrderId(orderId);
  if (!user || !user.isPaid) return res.status(404).end();

  try {
    const pdf = await generateTicketPDF(user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="ENGINEER26_Ticket_${String(user.userRollNumber).replace(/[^\w-]/g, '')}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('ticket render failed:', err.message);
    res.status(500).send('Could not generate that ticket.');
  }
});

// -------------------------------------------------------- signal range board
// PHASE 2: the client never sends a score. It sends the seed the server
// issued and the inputs the player made, and the server replays that trace
// through the same deterministic simulation the browser ran to derive what
// those inputs actually score. Patching the game changes nothing that
// reaches the board. See lib/leaderboard.js for what this does and does not
// defend against.

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
    res.json({ ok: true, verified: true, boards: { score, streak } });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Leaderboard unavailable.' });
  }
});

// A run begins by asking for a seed. Rate-limited on its own so a client
// cannot mint thousands of sessions looking for a soft one.
app.post('/api/range/session', async (req, res) => {
  try {
    const gate = await rateLimit(hashIp(clientIp(req)), 'session');
    if (!gate.ok) return res.status(429).json({ ok: false, error: gate.reason });
    res.json({ ok: true, session: issueSession() });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not start a run.' });
  }
});

app.post('/api/range/score', async (req, res) => {
  try {
    const body = req.body || {};

    const nameCheck = validateName(body.name);
    if (!nameCheck.valid) return res.status(400).json({ ok: false, errors: { name: nameCheck.error } });

    const session = verifySession(body.session);
    if (!session.ok) return res.status(400).json({ ok: false, errors: { form: session.reason } });
    if (await sessionUsed(session.sessionId)) {
      return res.status(409).json({ ok: false, errors: { form: 'That run has already been saved.' } });
    }

    const ipHash = hashIp(clientIp(req));
    const gate = await rateLimit(ipHash);
    if (!gate.ok) return res.status(429).json({ ok: false, errors: { form: gate.reason } });

    // THE authoritative step. Nothing the client claimed about its own run is
    // consulted — only the seed it was issued and the inputs it recorded.
    const outcome = replay(session.seed, body.shots);
    if (!outcome.ok) return res.status(400).json({ ok: false, errors: { form: outcome.reason } });
    if (outcome.score === 0 && outcome.streak === 0) {
      return res.status(400).json({ ok: false, errors: { form: 'Nothing to save yet.' } });
    }

    const value = {
      name: nameCheck.name,
      score: outcome.score,
      streak: outcome.streak,
      shots: outcome.shots,
      hits: outcome.hits,
      // Derived from the simulation's own tick count, so it describes the run
      // rather than however long the tab happened to be open.
      runMs: Math.round(outcome.ticks * (1000 / 60)),
    };

    const { id } = await saveRun(value, ipHash, session.sessionId);
    const [scoreRank, streakRank] = await Promise.all([
      rankFor('score', value.score),
      rankFor('streak', value.streak),
    ]);
    res.json({ ok: true, id, verified: true, run: value, rank: { score: scoreRank, streak: streakRank } });
  } catch (err) {
    res.status(500).json({ ok: false, errors: { form: 'Could not save that run.' } });
  }
});

/* Constant-time token compare, matching what verifySession already does for
   session signatures in lib/leaderboard.js.

   A plain `!==` returns as soon as two bytes differ, so how long the check
   takes depends on how much of the token was guessed correctly — enough, over
   many requests, to recover it a byte at a time. Hashing both sides to a
   fixed 32 bytes first means every comparison costs the same and a wrong
   LENGTH is indistinguishable from wrong content; timingSafeEqual throws on
   mismatched lengths, and that throw would leak the length by itself. */
function tokenMatches(sent, expected) {
  if (typeof sent !== 'string' || !sent) return false;
  const a = crypto.createHash('sha256').update(sent).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Moderation. A public free-text board WILL collect names that have to come
// off it; this is the way to do that without a database client. Requires
// ADMIN_TOKEN to be set — with no token configured the route stays closed
// rather than defaulting to open.
app.post('/api/range/hide', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || !tokenMatches(req.get('x-admin-token'), token)) return res.status(404).end();
  const ok = await hideRun(String(req.body?.id || ''), req.body?.hidden !== false);
  res.status(ok ? 200 : 404).json({ ok });
});

app.use((req, res) => {
  res.status(404).render('404', { url: req.originalUrl, status: 404 });
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

// AFTER the registration store, which owns the mongo connection payments
// borrows. Every warning below describes something that still WORKS but
// works worse, which is why none of them stop the boot.
const payInfo = await initPayments();
console.log(`  Payments:           ${paymentsMode()} — ${payInfo.reason}`);
if (paymentsEnabled()) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.log(`  ! RAZORPAY_WEBHOOK_SECRET unset — a payment is only confirmed if`);
    console.log(`    the payer's browser survives the redirect back. Close the tab`);
    console.log(`    mid-payment and the money is taken with no ticket issued.`);
  }
  if (!publicOrigin()) {
    console.log(`  ! PUBLIC_ORIGIN unset — ticket QR codes and emailed links are`);
    console.log(`    built with no host and will not resolve. Set it to the real`);
    console.log(`    site origin (https://engineer.nitk.ac.in).`);
  }
  if (!emailConfigured()) {
    console.log(`  ! EMAIL_ADDRESS / EMAIL_APP_PASSKEY unset — tickets are generated`);
    console.log(`    and downloadable, but nothing is posted to the registrant.`);
  }
  if (!hasStableTicketSecret) {
    console.log(`  ! No TICKET_SECRET / RANGE_SECRET / LEADERBOARD_SALT — ticket`);
    console.log(`    links are signed with a per-boot key, so every link already`);
    console.log(`    emailed stops working the next time the server restarts.`);
  }
}

// LAST middleware. Express's default error handler renders the stack trace
// into the response unless NODE_ENV is "production", which is how a single
// malformed form field was handing out absolute server paths. Registered
// after every route so it catches whatever they throw.
app.use(errorHandler((req, res, status) =>
  res.status(status).render('404', { url: req.originalUrl, status })));

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
// ==========================================================================
// Signal Range leaderboard store.
//
// PHASE 2 — scores are SERVER-DERIVED. The client never submits a score at
// all: it submits the seed it was issued and the inputs the player made, and
// the server replays that trace through the same deterministic simulation
// (public/js/range-sim.js) to work out what those inputs actually score.
// Patching the browser game therefore changes nothing that reaches the board.
//
// Two ₹2,500 prizes ride on this, so the remaining ways in are worth naming:
//   - the seed is issued and SIGNED by the server, so a client cannot search
//     offline for a generous one and then submit a genuine trace against it
//   - a session is single-use, so a strong trace cannot be posted twice
//   - a trace is still a trace: someone can compute optimal inputs offline
//     and submit those. That is a BOT, not a forged score, and no server-side
//     scheme fixes it. Treat an implausibly perfect run as a bot and settle
//     the final prize on a supervised device.
//
// Storage mirrors lib/registration.js: MongoDB when DBURL is set, otherwise
// an append-only JSON file so the flow is genuinely functional in local
// development. The file fallback is dev-only — it is not safe for concurrent
// writes at real traffic.
// ==========================================================================

import mongoose from 'mongoose';
import crypto from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const runSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  score:     { type: Number, required: true, min: 0 },
  streak:    { type: Number, required: true, min: 0 },   // best streak in the run
  shots:     { type: Number, required: true, min: 0 },
  hits:      { type: Number, required: true, min: 0 },
  runMs:     { type: Number, required: true, min: 0 },
  // Salted hash only. The raw address is never stored or shown: on a campus
  // network it identifies nobody useful (everyone NATs to a handful of
  // addresses) and it is personal data under the DPDP Act. It exists purely
  // so the rate limiter has something to key on.
  ipHash:    { type: String, required: true },
  hidden:    { type: Boolean, default: false },          // moderation
  // Set by the server after it replays the run's input trace, never by
  // the client. One submission per session, enforced by the index below.
  sessionId: { type: String, required: true },
  verified:  { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});
runSchema.index({ sessionId: 1 }, { unique: true });
runSchema.index({ score: -1, createdAt: 1 });
runSchema.index({ streak: -1, createdAt: 1 });

let RUN = null;
let mode = 'file';
let connecting = null;

const FILE_DIR = path.join(process.cwd(), 'data');
const FILE_PATH = path.join(FILE_DIR, 'leaderboard.json');

// Rotating the salt invalidates every stored hash, which is the point: it is
// how you expire the rate-limiting data. Set LEADERBOARD_SALT in production —
// without it the salt is per-boot, so limits reset on every restart.
const SALT = process.env.LEADERBOARD_SALT || crypto.randomBytes(16).toString('hex');
export const hasStableSalt = Boolean(process.env.LEADERBOARD_SALT);

export function hashIp(ip) {
  return crypto.createHmac('sha256', SALT).update(String(ip || '')).digest('hex').slice(0, 32);
}

// ------------------------------------------------------------------ sessions
// The SERVER issues the seed. That is the hinge of the whole verification
// scheme: if a client could choose its own seed it could search for a
// generous one offline and then submit a genuine, replayable trace against
// it. The seed is signed so it cannot be swapped after issue, and stamped so
// a session cannot be hoarded.
const SESSION_SECRET = process.env.RANGE_SECRET || SALT;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const sessionSig = (id, seed, issuedAt) =>
  crypto.createHmac('sha256', SESSION_SECRET).update(`${id}.${seed}.${issuedAt}`).digest('hex').slice(0, 32);

export function issueSession() {
  const sessionId = crypto.randomUUID();
  // 32-bit, because the simulation's PRNG is seeded with a uint32.
  const seed = crypto.randomBytes(4).readUInt32BE(0);
  const issuedAt = Date.now();
  return { sessionId, seed, issuedAt, sig: sessionSig(sessionId, seed, issuedAt) };
}

export function verifySession(s) {
  const id = String(s?.sessionId || '');
  const seed = Number(s?.seed);
  const issuedAt = Number(s?.issuedAt);
  const sig = String(s?.sig || '');
  if (!id || !Number.isInteger(seed) || !Number.isFinite(issuedAt) || !sig) {
    return { ok: false, reason: 'Missing session.' };
  }
  const expect = sessionSig(id, seed, issuedAt);
  // Constant-time compare, so the signature cannot be discovered byte by byte.
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'Session signature invalid.' };
  const age = Date.now() - issuedAt;
  if (age < -60_000) return { ok: false, reason: 'Session timestamp is in the future.' };
  if (age > SESSION_TTL_MS) return { ok: false, reason: 'Session expired — start a new run.' };
  return { ok: true, sessionId: id, seed, issuedAt };
}

/** A session is good for exactly one submission, so a strong trace cannot be
 *  posted repeatedly to flood the board. */
export async function sessionUsed(sessionId) {
  if (mode === 'mongo' && RUN) return Boolean(await RUN.exists({ sessionId }));
  return readFile().some(r => r.sessionId === sessionId);
}

export function leaderboardMode() { return mode; }

export async function initLeaderboardStore() {
  const dbURL = process.env.DBURL;
  if (!dbURL) return { mode: (mode = 'file'), reason: 'DBURL not set — using local file store' };

  if (!connecting) {
    connecting = mongoose.connect(dbURL, { serverSelectionTimeoutMS: 8000 })
      .then(() => {
        RUN = mongoose.models.signalruns || mongoose.model('signalruns', runSchema);
        mode = 'mongo';
        return { mode, reason: 'connected' };
      })
      // Never take the site down because the database is unreachable — the
      // rest of ENGINEER '26 is static content and must stay up.
      .catch(err => ({ mode: (mode = 'file'), reason: `mongo connect failed (${err.message}) — using file store` }));
  }
  return connecting;
}

// ----------------------------------------------------------------- file store
function readFile() {
  if (!existsSync(FILE_PATH)) return [];
  try { return JSON.parse(readFileSync(FILE_PATH, 'utf-8')).runs || []; }
  catch (_) { return []; }
}
function writeFile(runs) {
  if (!existsSync(FILE_DIR)) mkdirSync(FILE_DIR, { recursive: true });
  writeFileSync(FILE_PATH, JSON.stringify({
    _note: 'Signal Range runs. Scores are SERVER-DERIVED by replaying each input trace — see lib/leaderboard.js and public/js/range-sim.js.',
    runs,
  }, null, 2) + '\n');
}

// ------------------------------------------------------------------ validation
const NAME_RE = /^[\p{L}\p{N} _.'-]{2,20}$/u;

// Deliberately short. A public free-text board attached to prize money will
// attract worse than this, so treat it as a speed bump in front of the
// moderation endpoint, never as the whole answer.
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'rape', 'chut', 'lund', 'bhosd', 'madarch', 'behenc'];

/** The name is the ONLY field the client still supplies. Everything that can
 *  be scored is derived by replaying the trace, so there is nothing else here
 *  left to disbelieve. */
export function validateName(raw) {
  const name = String(raw ?? '').trim();
  if (!NAME_RE.test(name)) {
    return { valid: false, error: 'Use 2–20 characters: letters, numbers, spaces, . _ - \'' };
  }
  if (BLOCKED.some(w => name.toLowerCase().replace(/[^a-z]/g, '').includes(w))) {
    return { valid: false, error: 'Pick a different name.' };
  }
  return { valid: true, name };
}

// ----------------------------------------------------------------- rate limit
const MAX_PER_WINDOW = 20;
const WINDOW_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 5000;

// Session issuance is limited separately and in memory: sessions are not
// stored until a run is submitted, so there is nothing on disk to count. This
// resets when the server restarts, which is acceptable — its job is to stop
// someone minting thousands of seeds to shop for a soft one, not to be a
// durable ledger.
const sessionHits = new Map();   // ipHash -> number[] of issue timestamps
const MAX_SESSIONS_PER_WINDOW = 120;

export async function rateLimit(ipHash, kind = 'submit') {
  if (kind === 'session') {
    const since = Date.now() - WINDOW_MS;
    const hits = (sessionHits.get(ipHash) || []).filter(t => t >= since);
    if (hits.length >= MAX_SESSIONS_PER_WINDOW) {
      return { ok: false, reason: 'Too many runs started from here in the last hour.' };
    }
    hits.push(Date.now());
    sessionHits.set(ipHash, hits);
    // Keep the map from growing without bound on a long-lived process.
    if (sessionHits.size > 5000) {
      for (const [k, v] of sessionHits) if (!v.some(t => t >= since)) sessionHits.delete(k);
    }
    return { ok: true };
  }

  const since = Date.now() - WINDOW_MS;
  let recent;
  if (mode === 'mongo' && RUN) {
    recent = await RUN.find({ ipHash, createdAt: { $gte: new Date(since) } })
      .sort({ createdAt: -1 }).limit(MAX_PER_WINDOW).lean();
  } else {
    recent = readFile()
      .filter(r => r.ipHash === ipHash && new Date(r.createdAt).getTime() >= since)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  if (recent.length >= MAX_PER_WINDOW) return { ok: false, reason: 'Too many runs saved from here in the last hour.' };
  const last = recent[0];
  if (last && Date.now() - new Date(last.createdAt).getTime() < MIN_GAP_MS) {
    return { ok: false, reason: 'Give it a few seconds before saving again.' };
  }
  return { ok: true };
}

// --------------------------------------------------------------------- writes
export async function saveRun(value, ipHash, sessionId) {
  const doc = { ...value, ipHash, sessionId, hidden: false, verified: true,
                createdAt: new Date().toISOString() };
  if (mode === 'mongo' && RUN) {
    const saved = await RUN.create(doc);
    return { id: String(saved._id) };
  }
  const runs = readFile();
  const id = crypto.randomUUID();
  runs.push({ id, ...doc });
  writeFile(runs);
  return { id };
}

/** Moderation. Hides rather than deletes, so an entry can be restored and so
 *  the rate limiter keeps its history. */
export async function hideRun(id, hidden = true) {
  if (mode === 'mongo' && RUN) {
    const r = await RUN.findByIdAndUpdate(id, { hidden }, { new: true });
    return Boolean(r);
  }
  const runs = readFile();
  const row = runs.find(r => r.id === id);
  if (!row) return false;
  row.hidden = hidden;
  writeFile(runs);
  return true;
}

// ---------------------------------------------------------------------- reads
const METRICS = new Set(['score', 'streak']);

/** Top runs for a metric. One row per NAME — a board where the same person
 *  holds the top ten reads as broken, and the prize goes to a person, not a
 *  run. Ties break on earliest submission, which is the published rule. */
export async function topRuns(metric = 'score', limit = 10) {
  const key = METRICS.has(metric) ? metric : 'score';
  let rows;
  if (mode === 'mongo' && RUN) {
    rows = await RUN.find({ hidden: false }).sort({ [key]: -1, createdAt: 1 }).limit(500).lean();
    rows = rows.map(r => ({ ...r, id: String(r._id) }));
  } else {
    rows = readFile().filter(r => !r.hidden)
      .sort((a, b) => (b[key] - a[key]) || (new Date(a.createdAt) - new Date(b.createdAt)));
  }

  const seen = new Set();
  const best = [];
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    best.push({ id: r.id, name: r.name, score: r.score, streak: r.streak, verified: r.verified, createdAt: r.createdAt });
    if (best.length >= limit) break;
  }
  return best;
}

/** Where a value would place on a board, 1-based. Used to tell a player what
 *  their run achieved without making them scan the table. */
export async function rankFor(metric, value) {
  const key = METRICS.has(metric) ? metric : 'score';
  if (mode === 'mongo' && RUN) return (await RUN.countDocuments({ hidden: false, [key]: { $gt: value } })) + 1;
  return readFile().filter(r => !r.hidden && r[key] > value).length + 1;
}

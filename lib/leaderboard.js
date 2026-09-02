// ==========================================================================
// Signal Range leaderboard store.
//
// PHASE 1 — scores are NOT verified. The game computes its score in the
// browser (public/js/signal-game.js), so a submitted score is a claim, not a
// fact, and the board labels every row accordingly. The checks below only
// catch casual tampering: they reject runs that are impossible under the
// game's own scoring rules, not runs from a patched client.
//
// This is deliberate and documented rather than hidden: two ₹2,500 prizes
// ride on this board, so the honest position is that the online board is a
// QUALIFIER and the prize is settled on a supervised device — or Phase 2
// lands (server-issued seed + input-trace replay) and the board becomes
// authoritative. Until one of those, do not pay out on these numbers alone.
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
  verified:  { type: Boolean, default: false },          // reserved for Phase 2
  createdAt: { type: Date, default: Date.now },
});
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
    _note: 'Signal Range runs. Scores are CLIENT-REPORTED and unverified — see lib/leaderboard.js.',
    runs,
  }, null, 2) + '\n');
}

// ------------------------------------------------------------------ validation
const NAME_RE = /^[\p{L}\p{N} _.'-]{2,20}$/u;

// Deliberately short. A public free-text board attached to prize money will
// attract worse than this, so treat it as a speed bump in front of the
// moderation endpoint, never as the whole answer.
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'rape', 'chut', 'lund', 'bhosd', 'madarch', 'behenc'];

/** Highest score the game itself can produce from `hits` hits: every hit a
 *  bullseye (100) with the streak multiplier at its maximum for that index.
 *  Mirrors signal-game.js — streakMult = 1 + floor(streak / 3) * 0.5. */
export function maxPlausibleScore(hits) {
  let total = 0;
  for (let i = 0; i < hits; i++) total += 100 * (1 + Math.floor(i / 3) * 0.5);
  return total;
}

export function validateRun(body) {
  const errors = {};
  const name = String(body?.name ?? '').trim();
  const num = (v) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : NaN);
  const score = num(body?.score);
  const streak = num(body?.streak);
  const shots = num(body?.shots);
  const hits = num(body?.hits);
  const runMs = num(body?.runMs);

  if (!NAME_RE.test(name)) {
    errors.name = 'Use 2–20 characters: letters, numbers, spaces, . _ - \'';
  } else if (BLOCKED.some(w => name.toLowerCase().replace(/[^a-z]/g, '').includes(w))) {
    errors.name = 'Pick a different name.';
  }

  for (const [k, v] of Object.entries({ score, streak, shots, hits, runMs })) {
    if (!Number.isFinite(v) || v < 0) errors[k] = 'Invalid value.';
  }

  if (!Object.keys(errors).length) {
    // Integrity checks against the game's OWN rules. These catch a hand-edited
    // payload, not a patched client — see the header note.
    if (hits > shots) errors.hits = 'More hits than shots.';
    if (streak > hits) errors.streak = 'Streak longer than hit count.';
    if (score > maxPlausibleScore(hits)) errors.score = 'Score exceeds what those hits can produce.';
    // Every shot needs a charge-and-release; nobody fires 10 a second.
    if (shots > 0 && runMs < shots * 300) errors.runMs = 'Run too short for that many shots.';
    if (runMs > 6 * 60 * 60 * 1000) errors.runMs = 'Run too long.';
    if (score === 0 && streak === 0) errors.score = 'Nothing to save yet.';
  }

  return { valid: !Object.keys(errors).length, errors, value: { name, score, streak, shots, hits, runMs } };
}

// ----------------------------------------------------------------- rate limit
const MAX_PER_WINDOW = 20;
const WINDOW_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 5000;

export async function rateLimit(ipHash) {
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
export async function saveRun(value, ipHash) {
  const doc = { ...value, ipHash, hidden: false, verified: false, createdAt: new Date().toISOString() };
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

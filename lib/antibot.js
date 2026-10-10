// ==========================================================================
// Signal Range — bot and automation checks.
//
// Replaying a trace (public/js/range-sim.js) proves a score is what its
// inputs produce. It cannot prove a PERSON produced those inputs: a script
// that knows the seed can compute a perfect run offline, and a bot can drive
// the page. Nothing a website does stops that outright, so these checks do
// three narrower things, and the prize rules (a supervised replay at the
// fest before anything is paid) remain the final word:
//
//   1. REFUSE what no real player's browser can send: an automated browser
//      (navigator.webdriver), or a run submitted faster than it could have
//      been played in real time.
//   2. DERIVE what a client could otherwise choose: shot power comes from how
//      many ticks the trigger was held (range-sim.js → chargeFor), so a bot
//      cannot submit a perfectly tuned float.
//   3. HOLD FOR REVIEW what looks machine-made: near-perfect accuracy over a
//      long run, a run of bullseyes, or shots released faster than a person
//      can see a target and aim at it. A held run is saved but hidden until
//      someone with ADMIN_TOKEN approves it (GET /api/range/review lists
//      them, POST /api/range/hide with hidden:false publishes one).
//
// The thresholds below are deliberately loose: a strong human run should
// sail through, and the cost of a false flag is a short wait, not a ban.
// ==========================================================================

import { TICK_MS } from '../public/js/range-sim.js';

// A run is never accepted sooner than its own length after the server
// issued its seed. The slack covers the request round trip and the last
// shot, which the server lets land after the player banked the run.
const PACE_SLACK_MS = 4000;

/** Hard check: was there enough wall-clock time to actually play this? */
export function checkPace(issuedAt, ticks, now = Date.now()) {
  const played = ticks * TICK_MS;
  if (now - issuedAt + PACE_SLACK_MS < played) {
    return { ok: false, reason: 'That run arrived faster than it could have been played.' };
  }
  return { ok: true };
}

/** Hard check: signals the browser itself reports. Spoofable by anyone who
 *  tries, but it turns away every off-the-shelf automation setup (Selenium,
 *  Puppeteer, Playwright all set navigator.webdriver by default). */
export function checkClient(env) {
  if (env && env.webdriver === true) {
    return { ok: false, reason: 'Automated browsers can’t submit runs.' };
  }
  return { ok: true };
}

// ---- review heuristics -----------------------------------------------------
const MIN_SHOTS_ACCURACY = 15;
const MAX_ACCURACY = 0.95;          // hit rate at or above this, over 15+ shots
const MIN_HITS_PRECISION = 12;
const MAX_BULLSEYE_SHARE = 0.75;    // share of hits that are bullseyes
const HUMAN_REACT_TICKS = 15;       // 250 ms from target in place to release
const MAX_FAST_HITS = 3;            // hits released faster than that
const MIN_SHOTS_RHYTHM = 12;
const MIN_REACT_SPREAD = 0.08;      // coefficient of variation of react times

/**
 * Reasons a verified run should be held for review rather than published,
 * from the per-shot audit replay() returns. Empty means publish.
 */
export function reviewReasons(audit) {
  const shots = audit.length;
  const hits = audit.filter((s) => s.pts > 0);
  const reasons = [];

  if (shots >= MIN_SHOTS_ACCURACY && hits.length / shots >= MAX_ACCURACY) {
    reasons.push(`accuracy ${hits.length}/${shots}`);
  }

  const bulls = hits.filter((s) => s.pts >= 100).length;
  if (hits.length >= MIN_HITS_PRECISION && bulls / hits.length >= MAX_BULLSEYE_SHARE) {
    reasons.push(`bullseyes ${bulls}/${hits.length}`);
  }

  const fast = hits.filter((s) => s.react < HUMAN_REACT_TICKS).length;
  if (fast >= MAX_FAST_HITS) {
    reasons.push(`${fast} hits under ${Math.round(HUMAN_REACT_TICKS * TICK_MS)} ms`);
  }

  // A person's timing wanders; a script with a fixed delay does not.
  if (shots >= MIN_SHOTS_RHYTHM) {
    const r = audit.map((s) => s.react);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
    if (mean > 0 && sd / mean < MIN_REACT_SPREAD) {
      reasons.push(`timing spread ${(sd / mean).toFixed(3)}`);
    }
  }

  return reasons;
}

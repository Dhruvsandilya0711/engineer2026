// ==========================================================================
// Registration store.
//
// REUSES the existing schema from the payment_gateway project (same author,
// same MongoDB collection "useraccounts": userName, userRollNumber, userEvent,
// userMail, isPaid) so this is the SAME registration system, not a second one.
//
// Payment fields (isPaid, orderId, paymentId) are the SAME ones the payment
// gateway project writes, so a document created here and a document created
// there are the same shape and either app can read the other's rows.
//
// An event with no fee is still a one-step free registration and never
// touches Razorpay — see lib/payments.js. `isPaid` stays false on those,
// exactly as it always has.
//
// If DBURL is absent the store falls back to an append-only JSON file so the
// flow is genuinely functional in local development. That fallback is for dev
// only — it is not safe for concurrent writes at real traffic.
// ==========================================================================

import mongoose from 'mongoose';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const accountSchema = new mongoose.Schema({
  // NOTE: the original schema used `require` (not `required`), which mongoose
  // ignores — so nothing was actually validated. Corrected here.
  userName:       { type: String, required: true, trim: true },
  userRollNumber: { type: String, required: true, trim: true },
  userEvent:      { type: String, required: true, trim: true },
  userMail:       { type: String, required: true, trim: true, lowercase: true },
  isPaid:         { type: Boolean, default: false },
  // sparse, so the many free registrations that carry no order id do not all
  // collide on a single null in the unique index.
  orderId:        { type: String, unique: true, sparse: true },
  paymentId:      { type: String },
  amountPaid:     { type: Number },
  createdAt:      { type: Date, default: Date.now },
});

let USER_ACCOUNT = null;
let mode = 'file';   // 'mongo' | 'file'
let connecting = null;

const FILE_DIR = path.join(process.cwd(), 'data');
const FILE_PATH = path.join(FILE_DIR, 'registrations.json');

export function storeMode() { return mode; }

export async function initRegistrationStore() {
  const dbURL = process.env.DBURL;
  if (!dbURL) {
    mode = 'file';
    return { mode, reason: 'DBURL not set — using local file store' };
  }

  if (!connecting) {
    connecting = mongoose.connect(dbURL, { serverSelectionTimeoutMS: 8000 })
      .then(() => {
        USER_ACCOUNT = mongoose.models.useraccounts
          || mongoose.model('useraccounts', accountSchema);
        mode = 'mongo';
        return { mode, reason: 'connected' };
      })
      .catch((err) => {
        // Never crash the site because the database is unreachable — the rest
        // of ENGINEER '26 is static content and must stay up.
        mode = 'file';
        return { mode, reason: `mongo connect failed (${err.message}) — using file store` };
      });
  }
  return connecting;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Coerce a form field to a string, or to '' if it is anything else.
 *
 * express.urlencoded({ extended: true }) turns `userMail[$ne]=1` into an
 * OBJECT. Two things went wrong with that before this existed:
 *
 *   1. `.trim()` on an object threw, and Express's default handler answered
 *      with the stack trace — absolute paths, file names and line numbers —
 *      to whoever sent the malformed field.
 *   2. Had it not thrown, that object would have travelled into
 *      USER_ACCOUNT.findOne({ userMail: <object> }), and `{$ne: 1}` as a
 *      Mongo query operand is a NoSQL injection. Nothing exploits it today
 *      only because there is no database attached yet — which is exactly the
 *      wrong reason to be safe, since CCC is about to attach one.
 *
 * Anything that is not a plain string is not a name, so it becomes '' and
 * fails validation with a normal field error.
 */
const asString = (v) => (typeof v === 'string' ? v : '');

/** Server-side validation. Returns { valid, errors } — never trusts the client. */
export function validate(body) {
  const errors = {};
  const b = (body && typeof body === 'object') ? body : {};
  const name = asString(b.userName).trim();
  const roll = asString(b.userRollNumber).trim();
  const event = asString(b.userEvent).trim();
  const mail = asString(b.userMail).trim().toLowerCase();

  if (name.length < 2) errors.userName = 'Enter your full name.';
  if (roll.length < 3) errors.userRollNumber = 'Enter your roll number.';
  if (!event) errors.userEvent = 'Choose an event.';
  if (!EMAIL.test(mail)) errors.userMail = 'Enter a valid email address.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { userName: name, userRollNumber: roll, userEvent: event, userMail: mail, isPaid: false },
  };
}

function readFileStore() {
  if (!existsSync(FILE_PATH)) return [];
  try { return JSON.parse(readFileSync(FILE_PATH, 'utf-8')); } catch { return []; }
}

/** @returns {Promise<{ok:boolean, duplicate?:boolean, error?:string}>} */
export async function saveRegistration(value) {
  if (mode === 'mongo' && USER_ACCOUNT) {
    try {
      const existing = await USER_ACCOUNT.findOne({ userMail: value.userMail, userEvent: value.userEvent });
      if (existing) return { ok: false, duplicate: true };
      await USER_ACCOUNT.create(value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  try {
    mkdirSync(FILE_DIR, { recursive: true });
    const all = readFileStore();
    if (all.some(r => r.userMail === value.userMail && r.userEvent === value.userEvent)) {
      return { ok: false, duplicate: true };
    }
    all.push({ ...value, createdAt: new Date().toISOString() });
    writeFileSync(FILE_PATH, JSON.stringify(all, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function registrationCount() {
  if (mode === 'mongo' && USER_ACCOUNT) {
    try { return await USER_ACCOUNT.countDocuments(); } catch { return null; }
  }
  return readFileStore().length;
}

// ------------------------------------------------------------------ payments
// A paid registration is created BEFORE the money moves, holding the order id
// and isPaid:false, and is flipped to paid only by a verified signature. That
// ordering is what lets a captured payment always find its row: the webhook
// arrives with an order id and nothing else, so the row has to exist first.

/** Create the pending row for an order. @returns {Promise<{ok, error?}>} */
export async function createPendingRegistration(value, orderId, amountPaid) {
  const row = { ...value, isPaid: false, orderId, amountPaid };

  if (mode === 'mongo' && USER_ACCOUNT) {
    try { await USER_ACCOUNT.create(row); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  }
  try {
    mkdirSync(FILE_DIR, { recursive: true });
    const all = readFileStore();
    all.push({ ...row, createdAt: new Date().toISOString() });
    writeFileSync(FILE_PATH, JSON.stringify(all, null, 2));
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

/**
 * Flip a pending row to paid. IDEMPOTENT on purpose: Razorpay retries a
 * webhook until it gets a 2xx, and the checkout handler races it, so this is
 * routinely called twice for one payment. `changed` says whether THIS call
 * was the one that did it — the caller uses that to send exactly one ticket.
 */
export async function markPaid(orderId, paymentId) {
  if (!orderId) return { ok: false, changed: false, error: 'no order id' };

  if (mode === 'mongo' && USER_ACCOUNT) {
    try {
      const r = await USER_ACCOUNT.updateOne(
        { orderId, isPaid: false },
        { $set: { isPaid: true, paymentId } },
      );
      return { ok: true, changed: r.modifiedCount > 0 };
    } catch (err) { return { ok: false, changed: false, error: err.message }; }
  }
  try {
    const all = readFileStore();
    const row = all.find(r => r.orderId === orderId);
    if (!row) return { ok: false, changed: false, error: 'order not found' };
    if (row.isPaid) return { ok: true, changed: false };
    row.isPaid = true;
    row.paymentId = paymentId;
    writeFileSync(FILE_PATH, JSON.stringify(all, null, 2));
    return { ok: true, changed: true };
  } catch (err) { return { ok: false, changed: false, error: err.message }; }
}

/** The row behind an order id, or null. */
export async function findByOrderId(orderId) {
  if (!orderId) return null;
  if (mode === 'mongo' && USER_ACCOUNT) {
    try { return await USER_ACCOUNT.findOne({ orderId }).lean(); } catch { return null; }
  }
  return readFileStore().find(r => r.orderId === orderId) || null;
}

/**
 * Is this person already IN for this event? Only a PAID row blocks a retry —
 * an abandoned checkout leaves an unpaid row behind, and that must not lock
 * someone out of paying properly on their second attempt.
 */
export async function hasPaidRegistration(userMail, userEvent) {
  if (mode === 'mongo' && USER_ACCOUNT) {
    try { return Boolean(await USER_ACCOUNT.findOne({ userMail, userEvent, isPaid: true })); }
    catch { return false; }
  }
  return readFileStore().some(r => r.userMail === userMail && r.userEvent === userEvent && r.isPaid);
}

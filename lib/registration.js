// ==========================================================================
// Registration store.
//
// REUSES the existing schema from the payment_gateway project (same author,
// same MongoDB collection "useraccounts": userName, userRollNumber, userEvent,
// userMail, isPaid) so this is the SAME registration system, not a second one.
//
// Deliberately NOT included: Razorpay, passes, tickets, QR. The brief is
// registration only. `isPaid` is written as false purely to keep documents
// shape-compatible with the existing collection.
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

/** Server-side validation. Returns { valid, errors } — never trusts the client. */
export function validate(body) {
  const errors = {};
  const name = (body.userName || '').trim();
  const roll = (body.userRollNumber || '').trim();
  const event = (body.userEvent || '').trim();
  const mail = (body.userMail || '').trim().toLowerCase();

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

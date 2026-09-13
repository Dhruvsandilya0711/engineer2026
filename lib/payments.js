// ==========================================================================
// Payments — Razorpay orders, and the two signature checks that make a
// payment a fact rather than a claim.
//
// Ported from the engi_nitk_paymentgateway project (same author, same
// `useraccounts` collection, same `event_fee` collection) so this is the SAME
// payment system rather than a second one. Three things were changed on the
// way in, and they are the reason this file exists instead of a copy:
//
//   1. The checkout signature was compared with `===`, which returns early on
//      the first differing byte. That is a timing oracle against the key
//      secret. It is a constant-time compare here.
//   2. Nothing degraded when the keys were absent — the module built a
//      Razorpay client out of `undefined` and the site fell over. Payments
//      are OFF unless both keys are present, and the rest of ENGINEER '26 is
//      static content that must stay up regardless.
//   3. The amount is still read from the database and never from the request,
//      which the original got right and is worth saying out loud: a client
//      that posts its own price gets the database's price anyway.
//
// FEES. An event with no fee row is FREE, and registration for it behaves
// exactly as it did before this file existed. That is deliberate: it means
// shipping this cannot break a fest that has not set any prices yet, and
// pricing an event later is a data change, not a deploy.
// ==========================================================================

import crypto from 'crypto';
import mongoose from 'mongoose';
import Razorpay from 'razorpay';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// Mirrors model/event-fee.js in the payment gateway project, field for field,
// so both apps read the same collection.
const eventFeeSchema = new mongoose.Schema({
  eventName: { type: String, index: true },
  eventFee:  { type: Number },
});

let EVENT_FEE = null;
let razorpay = null;
let mode = 'off';                // 'off' | 'mongo' | 'file'

const FILE_PATH = path.join(process.cwd(), 'data', 'fees.json');

/** 'off' when there are no keys; otherwise where the FEES come from. */
export function paymentsMode() { return mode; }
export function paymentsEnabled() { return razorpay !== null; }

/** The publishable key. Safe to hand the browser — that is what it is for. */
export function publicKeyId() { return process.env.RAZORPAY_KEY_ID || null; }

export async function initPayments() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    mode = 'off';
    return { mode, reason: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — every event is free' };
  }

  razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

  // Fees live in Mongo when there is a Mongo. The connection itself is owned
  // by lib/registration.js — this only borrows the live one, so there is one
  // connection to the same database rather than two.
  if (mongoose.connection.readyState === 1) {
    EVENT_FEE = mongoose.models.event_fee || mongoose.model('event_fee', eventFeeSchema);
    mode = 'mongo';
    return { mode, reason: 'live — fees from the event_fee collection' };
  }

  mode = 'file';
  return {
    mode,
    reason: existsSync(FILE_PATH)
      ? 'live — fees from data/fees.json (no database)'
      : 'live — no fee source found, so every event is free',
  };
}

function readFileFees() {
  if (!existsSync(FILE_PATH)) return [];
  try {
    const j = JSON.parse(readFileSync(FILE_PATH, 'utf-8'));
    return Array.isArray(j) ? j : (j.fees || []);
  } catch { return []; }
}

/**
 * What does this event cost, in whole rupees? `null` means free — which is
 * the answer for every event until somebody prices one, and the answer the
 * whole flow is built to handle gracefully.
 *
 * Never takes an amount from the caller. This is the only place a price is
 * decided, so a client cannot pay itself a discount.
 */
export async function feeFor(eventName) {
  if (!eventName) return null;

  if (mode === 'mongo' && EVENT_FEE) {
    try {
      const row = await EVENT_FEE.findOne({ eventName });
      const fee = row && Number(row.eventFee);
      return Number.isFinite(fee) && fee > 0 ? fee : null;
    } catch {
      // A database hiccup must not silently turn a paid event free.
      throw new Error('fee lookup failed');
    }
  }

  const row = readFileFees().find(r => r.eventName === eventName);
  const fee = row && Number(row.eventFee);
  return Number.isFinite(fee) && fee > 0 ? fee : null;
}

/**
 * Create a Razorpay order for a fee already looked up by feeFor().
 * `notes` is echoed back on the webhook, which is how a captured payment is
 * traced to a person without trusting anything the browser says.
 */
export async function createOrder({ rupees, receipt, notes }) {
  if (!razorpay) throw new Error('payments are not configured');
  return razorpay.orders.create({
    amount: Math.round(rupees * 100),   // Razorpay counts in paise
    currency: 'INR',
    receipt,
    notes,
  });
}

/**
 * The checkout handler's signature: HMAC-SHA256 of "<order_id>|<payment_id>"
 * under the key secret.
 *
 * Constant time. Both digests are hashed again before the compare so that a
 * wrong-length input cannot make timingSafeEqual throw — a throw is itself an
 * observable difference, and the length of a secret-derived value is exactly
 * the kind of thing not to leak.
 */
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || typeof signature !== 'string' || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(signature).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * The webhook's signature, over the RAW request body. It has to be the raw
 * bytes: re-serialising the parsed JSON reorders keys and changes whitespace,
 * and the signature is over what was actually sent.
 */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !rawBody || !signature) return false;
  try {
    return Razorpay.validateWebhookSignature(rawBody.toString(), signature, secret);
  } catch {
    return false;
  }
}

// ==========================================================================
// Tickets — the PDF a paid registration produces, its QR, and the email it
// arrives in.
//
// Ported from engi_nitk_paymentgateway, with one change that matters:
//
//   THE DOWNLOAD LINK IS SIGNED. The original served /download-ticket/:orderId
//   off a bare order id, so anyone holding or guessing one got back a PDF
//   carrying that person's name, roll number and email. Order ids travel in
//   URLs, emails and screenshots; they are an identifier, not a secret. Every
//   ticket link now carries an HMAC of the order id, and a link without a
//   valid one is a 404.
//
// The QR encodes the signed ticket URL, so scanning it at the gate opens the
// same check the server would do rather than a bare string a phone can fake.
//
// Email is OPTIONAL. With no SMTP credentials the ticket is still generated
// and still downloadable — sendTicket() reports that it could not post it
// rather than failing the payment. A captured payment must never be lost
// because a mail server was down.
// ==========================================================================

import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';

// Falls back the same way RANGE_SECRET does, so a deployment that set only
// LEADERBOARD_SALT still gets unguessable links rather than a fixed string.
const SECRET = process.env.TICKET_SECRET
  || process.env.RANGE_SECRET
  || process.env.LEADERBOARD_SALT
  || crypto.randomBytes(32).toString('hex');   // per-boot: links die on restart

export const hasStableTicketSecret = Boolean(
  process.env.TICKET_SECRET || process.env.RANGE_SECRET || process.env.LEADERBOARD_SALT
);

/** The public origin, needed because the webhook builds URLs with no `req`. */
export function publicOrigin() {
  return (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
}

/** HMAC tying a download link to one order id. */
export function ticketToken(orderId) {
  return crypto.createHmac('sha256', SECRET).update(String(orderId)).digest('hex').slice(0, 32);
}

/** Constant-time check of a token off the URL. */
export function ticketTokenValid(orderId, token) {
  if (typeof token !== 'string' || !token) return false;
  const a = crypto.createHash('sha256').update(ticketToken(orderId)).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

export function ticketUrl(orderId) {
  return `${publicOrigin()}/ticket/${encodeURIComponent(orderId)}?t=${ticketToken(orderId)}`;
}

// ---------------------------------------------------------------------- PDF

const INK = '#0b0b12';
const DIM = '#585868';
const ACCENT = '#3b82f6';

/**
 * Render the ticket. Built-in Helvetica only — a missing font file would
 * throw inside the webhook, which is the one place a throw costs a paid
 * registration its ticket.
 *
 * @returns {Promise<Buffer>}
 */
export async function generateTicketPDF(user) {
  const qrPng = await QRCode.toBuffer(ticketUrl(user.orderId), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: INK, light: '#ffffff' },
  });

  const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 36 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const W = doc.page.width, H = doc.page.height;

  doc.rect(0, 0, W, 6).fill(ACCENT);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20)
    .text("ENGINEER '26", 36, 34);
  doc.fillColor(DIM).font('Helvetica').fontSize(9)
    .text('COGNITRIXX — REWIRE REALITY   ·   NITK SURATHKAL   ·   23–25 OCTOBER 2026', 36, 60);

  doc.moveTo(36, 82).lineTo(W - 36, 82).strokeColor('#d8d8e0').lineWidth(1).stroke();

  const field = (label, value, x, y, size = 13) => {
    doc.fillColor(DIM).font('Helvetica').fontSize(7.5).text(label.toUpperCase(), x, y, { characterSpacing: 1.1 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(size).text(value || '—', x, y + 12, { width: 250 });
  };

  field('Name', user.userName, 36, 100, 16);
  field('Event', user.userEvent, 36, 146, 13);
  field('Roll number', user.userRollNumber, 36, 192);
  field('Email', user.userMail, 36, 238, 10);

  // The QR sits on white regardless of anything above it — a scanner needs
  // the quiet zone more than the layout needs to be clever.
  const qrSize = 132;
  const qrX = W - 36 - qrSize, qrY = 104;
  doc.rect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16).fill('#ffffff');
  doc.image(qrPng, qrX, qrY, { width: qrSize });
  doc.fillColor(DIM).font('Helvetica').fontSize(7)
    .text('Scan at the gate', qrX, qrY + qrSize + 8, { width: qrSize, align: 'center' });

  doc.fillColor(DIM).font('Helvetica').fontSize(7);
  doc.text(`ORDER ${user.orderId || '—'}`, 36, H - 52);
  if (user.paymentId) doc.text(`PAYMENT ${user.paymentId}`, 36, H - 42);
  doc.text('Admits the named person only. Bring a college ID.', 36, H - 32);

  doc.end();
  return done;
}

// -------------------------------------------------------------------- email

let transporter = null;

export function emailConfigured() {
  return Boolean(process.env.EMAIL_ADDRESS && process.env.EMAIL_APP_PASSKEY);
}

function getTransport() {
  if (transporter || !emailConfigured()) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.EMAIL_ADDRESS, pass: process.env.EMAIL_APP_PASSKEY },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transporter;
}

/**
 * Post the ticket. Resolves `{ sent:false, reason }` rather than throwing when
 * mail is not configured or the server refuses — the caller is a webhook
 * handler, and a payment that was captured must still be recorded as paid.
 */
export async function sendTicket(user, pdfBuffer) {
  const t = getTransport();
  if (!t) return { sent: false, reason: 'EMAIL_ADDRESS / EMAIL_APP_PASSKEY not set' };

  const link = publicOrigin() ? ticketUrl(user.orderId) : null;

  try {
    const info = await t.sendMail({
      from: `"ENGINEER '26 — NITK Surathkal" <${process.env.EMAIL_ADDRESS}>`,
      to: user.userMail,
      subject: `Your ENGINEER '26 ticket — ${user.userEvent}`,
      text: [
        `Hello ${user.userName},`,
        ``,
        `Your registration for ${user.userEvent} at ENGINEER '26 is confirmed and paid.`,
        `Your ticket is attached. Bring it and a college ID to the gate.`,
        ``,
        `Roll number: ${user.userRollNumber}`,
        `Order: ${user.orderId}`,
        link ? `Ticket link: ${link}` : ``,
        ``,
        `NITK Surathkal · 23–25 October 2026`,
      ].filter(Boolean).join('\n'),
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#0b0b12">
          <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#585868;margin:0 0 6px">ENGINEER '26 — Cognitrixx</p>
          <h2 style="margin:0 0 16px;font-size:20px">Registration confirmed</h2>
          <p>Hello ${escapeHtml(user.userName)},</p>
          <p>Your registration for <strong>${escapeHtml(user.userEvent)}</strong> is confirmed and paid. Your ticket is attached to this email — bring it and a college ID to the gate.</p>
          <table style="border-collapse:collapse;font-size:14px;margin:18px 0">
            <tr><td style="padding:4px 18px 4px 0;color:#585868">Roll number</td><td><strong>${escapeHtml(user.userRollNumber)}</strong></td></tr>
            <tr><td style="padding:4px 18px 4px 0;color:#585868">Order</td><td><code>${escapeHtml(user.orderId)}</code></td></tr>
          </table>
          ${link ? `<p><a href="${link}" style="color:#3b82f6">Download your ticket again</a></p>` : ''}
          <p style="color:#585868;font-size:13px">NITK Surathkal · 23–25 October 2026</p>
        </div>`,
      attachments: [{
        filename: `ENGINEER26_Ticket_${String(user.userRollNumber).replace(/[^\w-]/g, '')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

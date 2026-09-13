// ==========================================================================
// Razorpay checkout, for events that charge a fee.
//
// The server has already created the order and written an unpaid row for it
// by the time this runs — see POST /register in index.js. All this does is
// open Razorpay's own modal and hand the result back for verification.
//
// NOTHING here decides what anything costs. The amount, the order id and the
// key id all come from the server, and the server checks the signature on
// whatever comes back, so a patched copy of this file cannot buy a cheaper
// ticket. It can only fail to report a payment that was already made — which
// is exactly what the webhook exists to catch.
// ==========================================================================

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function el(sel) { return document.querySelector(sel); }

function say(kind, html) {
  const box = el('[data-js="pay-status"]');
  if (!box) return;
  box.dataset.kind = kind;
  box.innerHTML = html;
  box.hidden = false;
}

/** Razorpay's script is external and may be blocked; never hang on it. */
function loadCheckout() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const tag = document.createElement('script');
    tag.src = CHECKOUT_SRC;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error('checkout script blocked'));
    document.head.appendChild(tag);
    setTimeout(() => reject(new Error('checkout script timed out')), 15000);
  });
}

async function verify(result) {
  say('working', 'Confirming your payment…');
  try {
    const res = await fetch('/api/pay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: result.razorpay_order_id,
        razorpay_payment_id: result.razorpay_payment_id,
        razorpay_signature: result.razorpay_signature,
      }),
    });
    const data = await res.json();

    if (data.ok) {
      say('ok', [
        '<strong>Payment confirmed.</strong> Your ticket is on its way to your email.',
        `<a class="btn btn-secondary mt-4" href="${data.ticket}">Download your ticket</a>`,
      ].join(' '));
      return;
    }
    // The money may well have left their account — the webhook will still
    // pick it up. Saying "failed" here would be a lie and would get us a
    // support queue of people who actually did pay.
    say('warn', [
      '<strong>We could not confirm that payment from this page.</strong>',
      'If money left your account it will still be recorded, and your ticket',
      'will arrive by email shortly. Contact',
      '<a href="mailto:engineerconvenor@nitk.edu.in">engineerconvenor@nitk.edu.in</a>',
      'if it does not.',
    ].join(' '));
  } catch {
    say('warn', [
      '<strong>Could not reach the server to confirm.</strong>',
      'If the payment went through it will still be recorded and emailed to you.',
    ].join(' '));
  }
}

export function initPay() {
  const node = el('[data-js="pay-data"]');
  if (!node) return;

  let pay;
  try { pay = JSON.parse(node.textContent); } catch { return; }
  if (!pay || !pay.orderId || !pay.keyId) return;

  const open = async () => {
    say('working', 'Opening the payment window…');
    try {
      await loadCheckout();
    } catch {
      say('error', [
        '<strong>The payment window could not load.</strong>',
        'An ad blocker or a restricted network usually causes this — try again',
        'on a different connection. Nothing has been charged.',
      ].join(' '));
      return;
    }

    const rz = new window.Razorpay({
      key: pay.keyId,
      order_id: pay.orderId,
      amount: pay.amountPaise,
      currency: 'INR',
      name: "ENGINEER '26",
      description: pay.eventName,
      prefill: { name: pay.userName, email: pay.userMail },
      notes: { event: pay.eventName },
      theme: { color: '#3b82f6' },
      handler: verify,
      modal: {
        ondismiss: () => say('idle',
          'Payment cancelled — nothing was charged. '
          + '<button type="button" class="btn btn-secondary mt-4" data-js="pay-retry">Try again</button>'),
      },
    });

    // A failed attempt is not a cancelled one; say which it was.
    rz.on('payment.failed', (e) => {
      const reason = (e && e.error && e.error.description) || 'The bank declined it.';
      say('error', `<strong>Payment failed.</strong> ${reason} `
        + '<button type="button" class="btn btn-secondary mt-4" data-js="pay-retry">Try again</button>');
    });

    rz.open();
  };

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-js="pay-retry"], [data-js="pay-now"]')) open();
  });

  open();   // the visitor already pressed submit; do not make them press twice
}

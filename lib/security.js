// ==========================================================================
// Security layer — response headers, a general rate limiter, and the error
// handler that stops the server describing itself to strangers.
//
// No helmet or express-rate-limit: both are one more dependency to keep
// patched on a machine CCC administers, and what the site needs from them is
// this file. Every header below is set because something on this site would
// otherwise be exploitable, and the comments say which.
// ==========================================================================

import crypto from 'crypto';

// Origins Razorpay's checkout actually reaches. Added ONLY when payments are
// configured, so the default deployment carries the tighter policy.
const RAZORPAY = {
  script: ['https://checkout.razorpay.com'],
  connect: ['https://lumberjack.razorpay.com', 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
  frame: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
};

/**
 * Per-request nonce + the header set.
 *
 * The nonce is what lets the CSP forbid inline script in general while still
 * allowing the four inline blocks this site legitimately ships. Without it
 * the policy would need 'unsafe-inline', which permits exactly the injected
 * <script> a CSP exists to stop.
 *
 * @param {() => boolean} paymentsOn read at request time, not boot time, so
 *        the policy follows configuration rather than a cached snapshot.
 */
export function securityHeaders(paymentsOn = () => false) {
  return function security(req, res, next) {
    const nonce = crypto.randomBytes(16).toString('base64');
    res.locals.nonce = nonce;

    const pay = paymentsOn();
    const script = ["'self'", `'nonce-${nonce}'`, ...(pay ? RAZORPAY.script : [])];
    const connect = ["'self'", ...(pay ? RAZORPAY.connect : [])];
    const frame = pay ? RAZORPAY.frame : ["'none'"];

    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src ${script.join(' ')}`,
      // 63 inline style attributes drive the accent colours per section, and
      // a style attribute cannot carry a nonce. Inline CSS is a far smaller
      // prize than inline script, so this is the one relaxation made.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // data: for the inline SVG/canvas work; blob: for anything three.js
      // generates at runtime.
      "img-src 'self' data: blob:",
      "media-src 'self'",
      "worker-src 'self' blob:",
      `connect-src ${connect.join(' ')}`,
      `frame-src ${frame.join(' ')}`,
      "object-src 'none'",
      // Stops an injected <base> silently re-pointing every relative URL.
      "base-uri 'self'",
      // The registration form must only ever post back here.
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));

    // frame-ancestors covers modern browsers; this covers the rest.
    res.setHeader('X-Frame-Options', 'DENY');
    // Stops a browser second-guessing Content-Type and running an uploaded
    // or user-influenced response as script.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Keeps roll numbers and event names out of the Referer sent to
    // Instagram, LinkedIn and Razorpay.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    // Only meaningful over TLS, and only truthful once CCC terminates it.
    // `req.secure` reads X-Forwarded-Proto because trust proxy is set.
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }

    next();
  };
}

// --------------------------------------------------------------- rate limit

/**
 * Sliding-window limiter, in memory.
 *
 * In memory is a deliberate limit, not an oversight: it resets on restart and
 * does not span processes. It is here to stop a script filling the
 * registration table from one machine, which is the realistic threat for a
 * fest site. It is not a defence against a distributed flood — that belongs
 * at CCC's proxy, above this application.
 */
export function rateLimit({ windowMs, max, key, message }) {
  const hits = new Map();

  return function limiter(req, res, next) {
    const k = key(req);
    if (!k) return next();

    const now = Date.now();
    const since = now - windowMs;
    const recent = (hits.get(k) || []).filter(t => t >= since);

    if (recent.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).type('text/plain').send(message);
    }

    recent.push(now);
    hits.set(k, recent);

    // Bound the map. Without this an attacker rotating source addresses
    // turns the limiter itself into the memory leak.
    if (hits.size > 5000) {
      for (const [kk, vv] of hits) if (!vv.some(t => t >= since)) hits.delete(kk);
    }

    next();
  };
}

// ------------------------------------------------------------ error handler

/**
 * The last middleware. Express's default handler renders the stack trace into
 * the response whenever NODE_ENV is not "production" — which is how a single
 * malformed field was handing out absolute server paths and line numbers.
 *
 * The trace goes to the log, where it is useful. The visitor gets a page.
 */
export function errorHandler(render404) {
  return function onError(err, req, res, _next) {
    console.error(`  ${req.method} ${req.originalUrl} ->`, err && err.stack ? err.stack : err);

    if (res.headersSent) return res.end();

    // An API caller gets JSON; a browser gets the site's own error page.
    const wantsJson = req.path.startsWith('/api/')
      || (req.get('accept') || '').includes('application/json');

    if (wantsJson) {
      return res.status(500).json({ ok: false, error: 'Something went wrong.' });
    }
    return render404(req, res, 500);
  };
}

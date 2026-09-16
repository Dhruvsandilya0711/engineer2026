# Deploying ENGINEER '26 to the CCC container

The Central Computer Centre has assigned a container for `engineer`. This is
how the 2026 site goes onto it without taking the current page down until the
last step.

Everything here is run **on the container**, as the `engineer` user.

## What is actually there right now

Probed from a machine on the campus network, so this is measured, not assumed:

| | |
|---|---|
| `engineer.nitk.ac.in` resolves to | `10.14.0.138` — a private address, so the name only answers inside the campus network |
| Web server | **nginx/1.18.0 (Ubuntu)** |
| Port 80 | **open**, serving a 469-byte static HTML file last modified 1 Oct 2025 |
| Port 443 | **CLOSED — there is no HTTPS on this host at all** |
| Port 3000 | closed (nothing running yet) |

Two things follow from that, and they change the order of the work:

**1. The "2025 site" is a placeholder, not an app.** 469 bytes of static HTML
being served by nginx from disk. There is no Node process, no database and no
application to migrate — so the cutover is just pointing one nginx `location`
block at a port. That makes this much easier than it sounded.

**2. There is no TLS, and that is a blocker for two things.** Not for putting
the site up — it will work fine over plain HTTP — but:

- **Razorpay will not operate over HTTP.** Live keys need an HTTPS checkout
  page. So payments cannot go live until CCC issues a certificate.
- `PUBLIC_ORIGIN` must match reality. Set it to `http://engineer.nitk.ac.in`
  today and change it to `https://` the day TLS lands, or every canonical URL
  and emailed ticket link will point at a scheme the server does not answer.

Only CCC can fix this — they hold the domain and the certificate. **Ask them
for TLS on `engineer.nitk.ac.in` now**, in the same thread as the container
request, because a certificate request inside an institution is measured in
days and it gates payments.

Also worth confirming with them: whether the name resolves to anything from
*outside* the campus network. `10.14.0.138` is an RFC1918 address, so as
things stand a parent or a participant from another college cannot reach the
site from home or on mobile data. If that is the intent for a public
registration page, it needs a public address or a NAT rule — again, CCC.

---

## 0. Before anything — change the password

CCC's own mail says to. Do it first, because until it is done the account is
sudo-capable with a password that has travelled through email and a chat
screenshot:

```bash
passwd
```

Then, so you stop typing a password at all — from **your laptop**:

```bash
ssh-copy-id engineer@10.14.0.138
```

After that, `ssh engineer@10.14.0.138` logs in on your key. Ask CCC to set
`PasswordAuthentication no` in `/etc/ssh/sshd_config` once everyone who needs
access has a key on the box; a sudo account reachable by password is the thing
that gets a campus server owned.

---

## 1. Bootstrap

```bash
ssh engineer@10.14.0.138
```

```bash
git clone https://github.com/Dhruvsandilya0711/engineer2026.git ~/engineer26 && cd ~/engineer26 && bash deploy/bootstrap.sh
```

`deploy/bootstrap.sh` is idempotent — safe to re-run — and it does not touch
the running 2025 site. It:

- checks Node is **≥ 20.6** (the floor in `package.json`; older Node fails at
  import, it does not degrade)
- installs dependencies from the lockfile with `npm ci`
- rebuilds `public/src/output.css`
- creates `.env` with **freshly generated secrets**, mode `600`
- creates `data/` at `700` with the two stores at `600`
- **boots the app on port 3999 and checks all 10 routes return 200**, then
  stops it

If the smoke test fails, nothing has been changed that needs undoing — fix the
error and run it again.

---

## 2. Fill in what only CCC can give you

```bash
nano ~/engineer26/.env
```

| Variable | Now | Why |
|---|---|---|
| `DBURL` | **ask CCC** | Without it, registrations go to `data/registrations.json` on the container's disk. That works, but it is a file on a container that CCC may rebuild. Get the Mongo string before registration opens. |
| `PUBLIC_ORIGIN` | bootstrap sets `https://...` — **change it to `http://engineer.nitk.ac.in` until CCC issues a certificate**, then change it back | Ticket QR codes and emailed links are built from this. It cannot be read from a request, because a `Host` header is attacker-controlled. Pointing it at a scheme the server does not answer breaks every link it generates. |
| `LEADERBOARD_SALT`, `RANGE_SECRET`, `TICKET_SECRET`, `ADMIN_TOKEN` | generated | **Never regenerate these.** Rotating `TICKET_SECRET` breaks every ticket link already emailed. |

Everything else can stay empty. With no Razorpay keys, **payments are off,
every event is free, and registration behaves exactly as it did before
payments existed** — there is no half-on state.

---

## 3. Run it as a service

```bash
sudo cp /tmp/engineer26.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now engineer26
systemctl status engineer26
```

> **`/tmp`, not `deploy/`.** bootstrap.sh stages a copy there with the absolute
> path to *this machine's* node substituted in. The one in `deploy/` carries a
> placeholder, because the right path is not knowable until install time — an
> nvm install puts node under `$HOME`, and systemd runs services with a bare
> `PATH` that contains no home directory. A unit that says `env node` starts,
> exits 127, and restart-loops with nothing but
> `/usr/bin/env: 'node': No such file or directory` in the journal.

```bash
curl -I http://127.0.0.1:3000/
```

Live logs:

```bash
journalctl -u engineer26 -f
```

The unit binds the app to **127.0.0.1 only** — CCC's web server is the thing
facing the world. It also runs with `ProtectSystem=strict` and a writable-path
allowlist, because this process handles names, roll numbers and email
addresses.

---

## 4. Point the web server at it

The server is nginx/1.18.0 on Ubuntu, so the vhost is almost certainly
`/etc/nginx/sites-available/`. Find the one that answers for this host:

```bash
grep -rl "engineer" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
nginx -T 2>/dev/null | grep -n "server_name\|root\|listen"
```

Hand `deploy/nginx.conf.example` to whoever owns it. Three things are
**required**; the rest is optional hygiene:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

The app runs `app.set('trust proxy', 1)`. Without `X-Forwarded-Proto`, every
canonical URL, `og:image` and emailed ticket link will advertise `http://` on
an `https://` page. Without `X-Forwarded-For`, the registration rate limiter
keys every visitor to the proxy's own address — so one person hitting the
limit locks out everybody.

> **Do not add a CSP header at the proxy.** The app already sends one with a
> per-request nonce (`lib/security.js`). Two CSP headers are intersected, and
> a static one cannot know the nonce, so it would kill every inline script on
> the site.

---

## 5. Cut over

Only now does 2025 come down. Keep it recoverable:

```bash
# whatever CCC's vhost is called
sudo cp /etc/nginx/sites-available/engineer /etc/nginx/sites-available/engineer.2025.bak
# edit it to proxy to 127.0.0.1:3000
sudo nginx -t && sudo systemctl reload nginx
```

Then check all ten routes. Use `http://` — port 443 is closed until CCC
issues a certificate:

```bash
for p in / /about /events /schedule /team /sponsors /register /terms /privacy /refunds; do
  printf '%-11s %s
' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://engineer.nitk.ac.in$p)"
done
```

All ten should be `200`. Then confirm the proxy headers actually arrived:

```bash
curl -s http://engineer.nitk.ac.in/ | grep -o '<link rel="canonical"[^>]*>'
```

The canonical must match the scheme the server really answers on. One
claiming `https://` while 443 is closed points every search engine and every
shared link at a dead address — so it stays `http://` until TLS lands, and
changes the same day it does.

Test from a phone **on mobile data** as well as campus wifi. That is the one
check that tells you whether anyone off campus can reach the site at all —
see the note at the top about the `10.x` address.

**Rollback** is one command:

```bash
sudo cp /etc/nginx/sites-available/engineer.2025.bak /etc/nginx/sites-available/engineer && sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. Updating later

```bash
cd ~/engineer26 && git pull && npm ci --no-audit --no-fund && npm run build:css && sudo systemctl restart engineer26
```

Roughly two seconds of downtime. For a fest week where that matters, run a
second copy on `PORT=3001`, flip the proxy, then stop the old one.

---

## What is still outstanding

Not blockers for putting the site up, but they are real:

| Item | Status |
|---|---|
| **TLS on the domain** | **Missing — port 443 is closed.** CCC must issue it. Blocks Razorpay entirely, and should be in place before registration opens regardless. |
| **Public reachability** | `engineer.nitk.ac.in` resolves to a private `10.x` address. Confirm with CCC whether it answers from outside campus. |
| **Razorpay KYC** | Not started. Live keys need it and it takes days, not hours. Until then every event is free. |
| **Refund policy decisions** | `/refunds` ships with my defaults — non-refundable, no transfers. Three decisions are flagged in `data/legal.json` under `todo`. |
| **Legal review** | The three policy pages are written from what the code actually does, but no one qualified has read them. Get a staff advisor to, before real money moves. |
| **`DBURL`** | File store until CCC provides it. |
| **SMTP** | No tickets are emailed until `EMAIL_ADDRESS` / `EMAIL_APP_PASSKEY` are set. Ask CCC for an institutional relay rather than a personal Gmail — mail claiming to be from the fest should come from the fest. |
| **Prize-rule clauses** | Four in `_signal-range.ejs` are still my defaults (close time, contact address, claim with college ID). |
| **Schedule times** | `data/schedule.json` has day assignments only. |
| **Event content** | IE, Technights, Tronix, IET still missing; RoboTech one-pager pending from Vedant. Wright Flight and ChronoForge PDFs need re-sending as images. |

---

## If something breaks

```bash
journalctl -u engineer26 -n 100 --no-pager   # what the app said
systemctl status engineer26                   # is it even running
ss -tlnp | grep 3000                          # is it listening
curl -I http://127.0.0.1:3000/                # does it answer locally
sudo nginx -t                                 # is the proxy config valid
```

If it answers on `127.0.0.1:3000` but not on the domain, the problem is the
proxy, not the app.

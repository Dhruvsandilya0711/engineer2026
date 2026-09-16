# Deploying ENGINEER '26 to the CCC container

The Central Computer Centre has assigned a container for `engineer` and it
currently runs the 2025 site. This is how the 2026 site goes onto it without
taking 2025 down until the last step.

Everything here is run **on the container**, as the `engineer` user.

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
git clone https://github.com/wildcodesmith/engineer_nitk26.git ~/engineer26 && cd ~/engineer26 && bash deploy/bootstrap.sh
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
| `PUBLIC_ORIGIN` | already set to `https://engineer.nitk.ac.in` | Ticket QR codes and emailed links are built from this. It cannot be read from a request, because a `Host` header is attacker-controlled. |
| `LEADERBOARD_SALT`, `RANGE_SECRET`, `TICKET_SECRET`, `ADMIN_TOKEN` | generated | **Never regenerate these.** Rotating `TICKET_SECRET` breaks every ticket link already emailed. |

Everything else can stay empty. With no Razorpay keys, **payments are off,
every event is free, and registration behaves exactly as it did before
payments existed** — there is no half-on state.

---

## 3. Run it as a service

```bash
sudo cp ~/engineer26/deploy/engineer26.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now engineer26
systemctl status engineer26
```

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

Hand `deploy/nginx.conf.example` to whoever owns the vhost. Three things are
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

Then check from **outside** the campus network — a phone on mobile data is the
easiest honest test:

```bash
for p in / /about /events /schedule /team /sponsors /register /terms /privacy /refunds; do
  printf '%-11s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://engineer.nitk.ac.in$p)"
done
```

All ten should be `200`. Then confirm the proxy headers actually arrived:

```bash
curl -s https://engineer.nitk.ac.in/ | grep -o '<link rel="canonical"[^>]*>'
```

It must say `https://engineer.nitk.ac.in`. If it says `http://`, step 4 did not
take.

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

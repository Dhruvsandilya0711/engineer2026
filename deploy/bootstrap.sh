#!/usr/bin/env bash
# ============================================================================
#  ENGINEER '26 / Cognitrixx — first-time setup on the CCC container.
#
#  Run this ONCE, as the `engineer` user, on 10.14.0.138.
#  It is idempotent: running it twice is safe and changes nothing the second
#  time except pulling the latest code.
#
#      bash deploy/bootstrap.sh
#
#  What it does NOT do, on purpose:
#    - it never writes a password anywhere
#    - it never touches the running 2025 site until the last step, which is
#      manual (see DEPLOY.md, "Cut over")
#    - it generates secrets locally and prints nothing sensitive to stdout
# ============================================================================
set -euo pipefail

APP_USER="${APP_USER:-engineer}"
APP_DIR="${APP_DIR:-/home/$APP_USER/engineer26}"
REPO="${REPO:-https://github.com/Dhruvsandilya0711/engineer2026.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

say() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Node ≥ 20.6 ──────────────────────────────────────────────────────────
# 20.6 is the floor in package.json. The app is ESM with top-level await and
# uses Node's own .env handling in places, so an older Node fails at import
# time rather than degrading.
say "Checking Node"
if ! command -v node >/dev/null 2>&1; then
  die "Node is not installed. Ask CCC for Node 20 LTS or newer, or install nvm:
     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
     exec \$SHELL -l && nvm install 20"
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 6 ]; }; then
  die "Node $(node -v) is too old. package.json requires >= 20.6.0."
fi
echo "    node $(node -v)  npm $(npm -v)"

# ── 2. Code ─────────────────────────────────────────────────────────────────
say "Fetching the site into $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
  echo "    updated to $(git -C "$APP_DIR" rev-parse --short HEAD)"
else
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --quiet --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
  echo "    cloned at $(git -C "$APP_DIR" rev-parse --short HEAD)"
fi
cd "$APP_DIR"

# ── 3. Dependencies ─────────────────────────────────────────────────────────
# Everything is a runtime dependency (there are no devDependencies), so this
# is a plain install. `npm ci` because it honours the lockfile exactly; a
# fresh `npm install` on a server is how versions drift away from what was
# tested.
say "Installing dependencies"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund
else npm install --no-audit --no-fund; fi

# ── 4. Stylesheet ───────────────────────────────────────────────────────────
# public/src/output.css IS committed, so this is belt-and-braces — but it
# costs 250ms and it means the served CSS always matches the source in this
# checkout rather than whatever was last committed.
say "Building the stylesheet"
npm run build:css

# ── 5. Secrets ──────────────────────────────────────────────────────────────
# Created once and never regenerated: rotating TICKET_SECRET breaks every
# ticket link already emailed, and rotating LEADERBOARD_SALT wipes the rate
# limiter's memory. If .env exists, it is left exactly as it is.
say "Environment"
if [ -f .env ]; then
  echo "    .env already exists — leaving it untouched"
else
  cp .env.example .env
  gen() { node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'; }
  # Written with a temp file + mv so a half-written .env can never be read.
  TMP=$(mktemp)
  sed -e "s|^LEADERBOARD_SALT=.*|LEADERBOARD_SALT=$(gen)|" \
      -e "s|^RANGE_SECRET=.*|RANGE_SECRET=$(gen)|" \
      -e "s|^TICKET_SECRET=.*|TICKET_SECRET=$(gen)|" \
      -e "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$(gen)|" \
      -e "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://engineer.nitk.ac.in|" \
      .env > "$TMP"
  # Behind CCC's proxy the app should not also be listening on the LAN.
  printf '\nHOST=127.0.0.1\nPORT=%s\n' "$PORT" >> "$TMP"
  mv "$TMP" .env
  chmod 600 .env
  echo "    .env created with fresh secrets, mode 600"
  echo "    STILL TO FILL IN BY HAND:  DBURL (from CCC), and the Razorpay /"
  echo "    SMTP block once those accounts exist. The site runs without them."
fi

# ── 6. Data directory ───────────────────────────────────────────────────────
# Only used while DBURL is unset. These hold personal data, so they are
# owner-only from the moment they exist.
say "Data directory"
mkdir -p data
chmod 700 data
touch data/registrations.json data/leaderboard.json 2>/dev/null || true
chmod 600 data/registrations.json data/leaderboard.json 2>/dev/null || true
echo "    data/ is 700, the two stores are 600"

# ── 7. Smoke test on a throwaway port ───────────────────────────────────────
# Proves the build actually boots BEFORE anything is pointed at it. Uses a
# port nothing else is on, so it cannot collide with the running 2025 site.
say "Smoke test"
TEST_PORT=3999
PORT=$TEST_PORT HOST=127.0.0.1 node index.js > /tmp/e26-smoke.log 2>&1 &
SMOKE_PID=$!
trap 'kill $SMOKE_PID 2>/dev/null || true' EXIT
for i in $(seq 1 25); do
  sleep 0.4
  if curl -fsS -o /dev/null "http://127.0.0.1:$TEST_PORT/" 2>/dev/null; then break; fi
  if [ "$i" = 25 ]; then cat /tmp/e26-smoke.log; die "server did not come up"; fi
done
FAILED=""
for p in / /about /events /schedule /team /sponsors /register /terms /privacy /refunds; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TEST_PORT$p")
  printf '    %-11s %s\n' "$p" "$CODE"
  [ "$CODE" = "200" ] || FAILED="$FAILED $p"
done
kill $SMOKE_PID 2>/dev/null || true
trap - EXIT
[ -z "$FAILED" ] || die "these routes did not return 200:$FAILED"

# ── 8. Stage the unit with node's real path ────────────────────────────────
# Resolved HERE, at install time, on the machine that will run it. nvm puts
# node under $HOME and systemd's PATH does not include $HOME, so a unit that
# says `env node` starts, fails with 127, and restart-loops silently.
say "Preparing the systemd unit"
NODE_BIN="$(command -v node)"
sed "s|^ExecStart=.*|ExecStart=$NODE_BIN index.js|" deploy/engineer26.service > /tmp/engineer26.service
echo "    ExecStart=$NODE_BIN index.js"
echo "    staged at /tmp/engineer26.service — install it in the next step"

say "Bootstrap complete"
cat <<EOF

  Next, from DEPLOY.md:
    1. Fill in DBURL in $APP_DIR/.env          (ask CCC for the connection string)
    2. Install the service (note: /tmp, not deploy/ — it has node's real path):
                             sudo cp /tmp/engineer26.service /etc/systemd/system/
                             sudo systemctl daemon-reload
                             sudo systemctl enable --now engineer26
    3. Point the web server at 127.0.0.1:$PORT  (deploy/nginx.conf.example)
    4. Cut over from the 2025 site

  The app is NOT yet serving. Nothing about the running 2025 site was touched.
EOF

#!/usr/bin/env bash
# One-time provisioning for an Ubuntu EC2 instance (22.04/24.04).
# Run as a sudo-capable user (e.g. ubuntu):
#   REPO_URL=git@github.com:you/awardhomebootstrap.git ./setup_server.sh
#
# What it does: installs Node 22 + nginx + litestream, creates the awardhome
# user and /opt/awardhome, clones the repo, installs deps, generates .env
# (you fill in the secrets), runs DB migrations, installs systemd units and
# the nginx site. Safe to re-run.
set -euo pipefail

REPO_URL="${REPO_URL:?Set REPO_URL to your git remote, e.g. REPO_URL=git@github.com:you/awardhomebootstrap.git}"
APP_DIR=/opt/awardhome
APP_USER=awardhome
LITESTREAM_VERSION=0.3.13

echo "==> System packages"
sudo apt-get update -y
sudo apt-get install -y git curl nginx sqlite3 ca-certificates

echo "==> Node.js 22 (NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "==> Litestream ${LITESTREAM_VERSION}"
if ! command -v litestream >/dev/null; then
  ARCH=$(dpkg --print-architecture)   # amd64 or arm64
  curl -fsSL -o /tmp/litestream.deb \
    "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${ARCH}.deb"
  sudo dpkg -i /tmp/litestream.deb
fi
litestream version

echo "==> App user + directory"
id -u $APP_USER >/dev/null 2>&1 || sudo useradd --system --create-home --shell /usr/sbin/nologin $APP_USER
sudo mkdir -p $APP_DIR
sudo chown $APP_USER:$APP_USER $APP_DIR

echo "==> Code"
if [ -d $APP_DIR/.git ]; then
  sudo -u $APP_USER git -C $APP_DIR pull --ff-only || echo "WARN: git pull failed (no reachable remote?) — deploying code as-is"
elif [ -n "$(ls -A $APP_DIR 2>/dev/null)" ]; then
  echo "==> Code already present (rsync deploy) — skipping clone"
else
  sudo -u $APP_USER git clone "$REPO_URL" $APP_DIR
fi

echo "==> Dependencies"
cd $APP_DIR
sudo -u $APP_USER npm ci --omit=dev

echo "==> Environment file"
if [ ! -f $APP_DIR/.env ]; then
  sudo -u $APP_USER tee $APP_DIR/.env >/dev/null <<EOF
NODE_ENV=production
PORT=3008
BASE_URL=https://awardhome.com            # <-- set your real domain
SESSION_SECRET=$(openssl rand -hex 32)

SUPERADMIN_EMAIL=                          # <-- fill in
SUPERADMIN_PASSWORD=                       # <-- fill in

EMAIL_PROVIDER=resend
RESEND_API_KEY=                            # <-- fill in
RESEND_FROM_EMAIL=                         # e.g. hello@awardhome.com (verified in Resend)

OPENAI_API_KEY=                            # <-- fill in (AI summaries)

SENTRY_DSN=                                # optional: error tracking (sentry.io project DSN)

BETA_MODE=false                            # true = private beta gate on /dance + /dancer
BETA_ACCESS_KEY=                           # beta password / magic-link key

SEARCH_RATE_LIMIT=30                       # hero search: max requests/min per IP

ENABLE_NIGHTLY_BACKUPS=true
# S3 credentials NOT needed here if the instance has an IAM role (preferred).
EOF
  sudo chmod 600 $APP_DIR/.env
  echo "!!  Created $APP_DIR/.env — EDIT IT NOW (secrets marked <-- fill in), then re-run this script."
  exit 0
fi

echo "==> Database migrations"
sudo -u $APP_USER node $APP_DIR/database.js

echo "==> systemd units"
sudo cp $APP_DIR/deploy/awardhome.service /etc/systemd/system/
sudo cp $APP_DIR/deploy/litestream.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now awardhome litestream

echo "==> nginx"
sudo cp $APP_DIR/deploy/nginx-awardhome.conf /etc/nginx/sites-available/awardhome
sudo ln -sf /etc/nginx/sites-available/awardhome /etc/nginx/sites-enabled/awardhome
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "==> Health check"
sleep 2
curl -fsS http://127.0.0.1:3008/healthz && echo && echo "OK — app is up."
echo
echo "Next steps (see docs/deployment.md):"
echo "  1. Attach the IAM role with S3 access for Litestream (or set AWS keys)."
echo "  2. Point DNS at this instance (via Cloudflare), get TLS in place."
echo "  3. Run the Litestream restore drill once."

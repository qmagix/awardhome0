#!/usr/bin/env bash
# Redeploy: pull latest code, install deps, run migrations, restart, health-check.
# Run on the server as a sudo-capable user:  /opt/awardhome/deploy/deploy.sh
set -euo pipefail

APP_DIR=/opt/awardhome
APP_USER=awardhome

cd $APP_DIR
echo "==> Pulling latest code"
sudo -u $APP_USER git pull --ff-only

echo "==> Installing dependencies"
sudo -u $APP_USER npm ci --omit=dev

echo "==> Running DB migrations (idempotent)"
sudo -u $APP_USER node database.js

echo "==> Restarting app"
sudo systemctl restart awardhome

echo "==> Health check"
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3008/healthz >/dev/null 2>&1; then
    echo "OK — deployed $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done
echo "FAILED — app did not become healthy; check: journalctl -u awardhome -n 50"
exit 1

# Deployment Runbook — AWS EC2 (Ubuntu)

Everything lives in `deploy/`. One-time setup is `setup_server.sh`; every
subsequent release is `deploy.sh`. Backups stream continuously to S3 via
Litestream (`litestream.yml`, `docs/db_operations.md`).

## Architecture

```
Cloudflare (DNS + TLS + caching + bot protection)
        │
   EC2 Ubuntu instance
        │
      nginx :80  ── reverse proxy ──▶  Node app :3008  (systemd: awardhome)
                                        │
                              database.sqlite (WAL)
                                        │
                     litestream (systemd: litestream) ──▶ S3 bucket
```

## Prerequisites (once)

**AWS side — one script.** With awscli configured locally:

```bash
./deploy/provision_aws.sh                 # us-east-1, t3.small by default
# REGION=us-west-2 INSTANCE_TYPE=t3.medium ./deploy/provision_aws.sh
```

Idempotent. It creates the S3 backup bucket (`awardhome-backups-<account>`,
public access blocked), the `awardhome-ec2` IAM role + instance profile
scoped to that bucket, a key pair (PEM saved to `deploy/`, gitignored),
a security group (22 from your IP only, 80/443 open), an Ubuntu 24.04
instance (IMDSv2 required, 30GB gp3), and an Elastic IP. It prints the
SSH command and the bucket name — **copy that bucket/region into
`litestream.yml`** before deploying.

Then, manually:

1. **Push the repo to a git remote** (private GitHub repo) the server can
   pull from — add the server's deploy key or use HTTPS + token.
2. **Cloudflare**: add the domain, point an A record (proxied) at the
   Elastic IP the script printed. SSL mode "Full (strict)": create an
   origin certificate in Cloudflare and install it in nginx (or run
   certbot and use "Full"). Until TLS is set up, keep the record
   unproxied for testing.

## First deploy

```bash
ssh ubuntu@<instance>
git clone <REPO_URL> /tmp/bootstrap && cd /tmp/bootstrap    # just for the script
REPO_URL=<REPO_URL> ./deploy/setup_server.sh                # 1st run: creates /opt/awardhome/.env, exits
sudo nano /opt/awardhome/.env                               # fill in the "<-- fill in" secrets
REPO_URL=<REPO_URL> ./deploy/setup_server.sh                # 2nd run: migrations, services, nginx
```

The script is idempotent — re-run it after fixing anything.

**Seed the database**: the fresh server has an empty DB. Copy your local
`database.sqlite` up once (stop the app first, then restart):

```bash
sudo systemctl stop awardhome litestream
scp database.sqlite ubuntu@<instance>:/tmp/ && ssh ubuntu@<instance> \
  'sudo mv /tmp/database.sqlite /opt/awardhome/ && sudo chown awardhome:awardhome /opt/awardhome/database.sqlite'
sudo systemctl start awardhome litestream
```

**Then run the restore drill once** (proves backups actually work):

```bash
cd /opt/awardhome
sudo -u awardhome litestream restore -config litestream.yml -o /tmp/restored.sqlite database.sqlite
sqlite3 /tmp/restored.sqlite "PRAGMA integrity_check; SELECT COUNT(*) FROM awards;"
rm /tmp/restored.sqlite
```

## Every release

```bash
ssh ubuntu@<instance> /opt/awardhome/deploy/deploy.sh
```

Pulls, installs, migrates, restarts, and fails loudly if `/healthz` doesn't
come back within 15s. Roll back = `git revert` locally, push, redeploy.

## Uploads folder

`uploads/` and `public/uploads/` (logos, org branding) live on the EBS
volume. Add a nightly sync to S3 (the IAM role already permits it if you
widen the policy to a `uploads/` prefix, or reuse the same bucket):

```bash
# crontab -e  (as awardhome)
15 3 * * * aws s3 sync /opt/awardhome/uploads s3://awardhome-backups/uploads --quiet
20 3 * * * aws s3 sync /opt/awardhome/public/uploads s3://awardhome-backups/public-uploads --quiet
```

(Requires `sudo apt install awscli`.) Move to direct-to-S3 uploads when
volume justifies it.

## Error tracking & request logs

- **Request logs** go to stdout → journald: `journalctl -u awardhome -f`
  shows every request with client IP (real IP via the Cloudflare snippet),
  status, and response time. Static assets and /healthz are excluded.
- **Sentry** (crash/error tracking): create a free project at sentry.io
  (platform: Node.js/Express), copy the DSN into `SENTRY_DSN=` in
  `/opt/awardhome/.env`, and `sudo systemctl restart awardhome`. Boot log
  prints "Sentry error tracking enabled" when active. Unhandled route
  errors are reported with request context; users still get the friendly
  500 page. Without a DSN the integration is a no-op.

## Operations quick reference

| What | Command |
|---|---|
| App logs | `journalctl -u awardhome -f` |
| Litestream logs | `journalctl -u litestream -f` |
| Restart app | `sudo systemctl restart awardhome` |
| Health | `curl localhost:3008/healthz` |
| Smoke suite | `cd /opt/awardhome && npm run smoke` (uses port 3997) |
| DB console | `sudo -u awardhome sqlite3 /opt/awardhome/database.sqlite` |
| Restore drill | see above |

## Troubleshooting

- **App won't start, "SESSION_SECRET must be set"** — `.env` missing or not
  readable; check `EnvironmentFile` path and permissions (600, owner
  `awardhome`).
- **Litestream unit failing** — usually IAM: `aws sts get-caller-identity`
  from the instance should show the role; check bucket name/region in
  `litestream.yml`.
- **Emails not arriving** — verify the sending domain in Resend (DKIM/SPF
  records in Cloudflare DNS) and that `RESEND_FROM_EMAIL` uses that domain.
- **502 from nginx** — app down; `journalctl -u awardhome -n 50`.

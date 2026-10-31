# VPS deployment automation

These scripts target a fresh Ubuntu VPS and this app's systemd service. They do not configure a domain's DNS or the VPS provider's external firewall: allow inbound TCP 22, 80 and 443 only.

## Initial setup

First push the scripts to the GitHub `main` branch. On a fresh VPS, set the DNS `A` record for the website domain to the VPS IPv4 address and allow inbound TCP ports 22, 80 and 443 in the provider firewall. Then download, inspect and run the bootstrap script as root:

```bash
curl -fsSLO https://raw.githubusercontent.com/serasdeva/photoprint-service/main/deploy/setup-vps.sh
less setup-vps.sh
sudo bash setup-vps.sh https://github.com/serasdeva/photoprint-service.git docs.co99.win
```

The script installs Node.js 20, Nginx, Certbot and SQLite tooling; creates or uses the `photoprint` system account; clones the repository; installs production dependencies; creates `.env` with generated secrets if one does not already exist; seeds a new database only; configures systemd and Nginx; checks the local app; installs monitoring and daily backups; requests HTTPS; and verifies `https://<domain>/healthz`. It prints the generated admin password once. Save it securely.

The app listens on `127.0.0.1:3000` (`HOST` in `.env`), so port 3000 must stay closed in the provider firewall: only Nginx with TLS is public.

The script fails if HTTPS cannot be configured, and that is intentional. With `NODE_ENV=production` every cookie (CSRF, auth, session) is marked `Secure`, so over plain HTTP the browser does not store them: order forms return 403 and nobody can log into the admin panel.

If certificate issuance fails, the script exits with instructions. Fix DNS and inbound ports 80/443, then run:

```bash
sudo certbot --nginx -d docs.co99.win --email your-email@example.com --agree-tos --non-interactive --redirect
```

If the repository is private, configure GitHub SSH/deploy-key access before running the script and pass the SSH clone URL instead.

The script does not overwrite an existing `.env` or seed an existing SQLite database.

## Apply updates from GitHub

Commit and push code changes to `main` from your development machine. On the VPS run:

```bash
sudo bash /var/www/photoprint-service/deploy/update-vps.sh
```

The updater refuses dirty or divergent checkouts, fetches `origin/main`, creates a SQLite online backup and an uploads archive, fast-forward merges only, runs `npm ci --omit=dev`, builds hashed static assets (`npm run build:assets`), restarts systemd, checks the configured `BASE_URL`, and refreshes the monitoring and backup units. Backups are stored under `/var/backups/photoprint-service/`.

If the Git remote's default branch is not `main`, invoke it with `BRANCH=branch-name`:

```bash
sudo env BRANCH=branch-name bash /var/www/photoprint-service/deploy/update-vps.sh
```

## Backups and restore

`install-backup.sh` (called by both setup and update scripts) installs `photoprint-backup.timer`:

- runs `deploy/backup.sh` daily at 03:30; `Persistent=true` catches up after host downtime;
- takes a consistent snapshot with `sqlite3 .backup`, verifies it with `PRAGMA integrity_check`, then archives `public/uploads`;
- keeps the last 14 runs (`KEEP_COUNT`), older timestamp directories are deleted;
- writes to `/var/backups/photoprint-service/<UTC stamp>/`, readable only by the app user.

Manual run and logs:

```bash
sudo systemctl start photoprint-backup.service
sudo journalctl -u photoprint-backup -n 50 --no-pager
```

Restore a specific backup:

```bash
sudo bash /var/www/photoprint-service/deploy/restore.sh /var/backups/photoprint-service/20261101T033000Z
```

The restore script verifies the dump, stops the service, moves the current database and uploads to `data/pre-restore-<stamp>/` (never into `public/`), removes stale `-wal`/`-shm` files (they would corrupt the restored database), unpacks the new copy, starts the service and waits for `/healthz`. It asks for confirmation; pass `--yes` for non-interactive use. A corrupted backup is rejected before the service is touched.

Backups stay on the same VPS: copy them off-site (provider snapshots, `rclone`, S3/B2) and rehearse a restore on a copy before relying on them.

## Migrations

Schema changes live in `migrations/*.js` and run automatically at startup: the runner records applied files in `_schema_migrations` and wraps each migration in a transaction. Do not change the production schema by hand — add a migration file, test it on a copy of the production database, and deploy through `update-vps.sh`, which takes a database and uploads backup before merging.

## Monitoring and alerts

`setup-vps.sh` and `update-vps.sh` call `install-monitoring.sh`, which installs an idempotent set of systemd units:

- `photoprint-healthcheck.timer` runs `healthcheck.sh` every minute and checks `/healthz`;
- a failed check sends one Telegram alert per outage plus a recovery message (repeats at most hourly);
- `OnFailure=` in a `photoprint.service` drop-in triggers an immediate alert when the service unit fails;
- a journald drop-in caps logs at `SystemMaxUse=500M` / `SystemMaxFileSize=50M`.

Alerts require `BOT_TOKEN` and a chat id: `ALERT_CHAT_ID` from `.env`, otherwise `BOT_ADMIN_CHAT_ID`, otherwise the Telegram chat id saved in the admin settings (read from SQLite via `sqlite3`). To verify:

```bash
sudo -u photoprint /usr/local/bin/photoprint-healthcheck.sh --test
sudo systemctl status photoprint-healthcheck.timer
sudo journalctl -u photoprint-healthcheck.service -n 50 --no-pager
```

The timer runs on the same VPS: it survives an application crash but not a host outage. For host-level monitoring point an external uptime service at `https://<domain>/healthz`; `503` means the database is unavailable.

## Important

- Keep `.env` out of Git and do not share its contents.
- If `.env` was created before `HOST` support, add `HOST=127.0.0.1` and restart the service: otherwise the app keeps listening on all interfaces.
- The updater does not run `npm run seed`; seed is for first-time initialization only.
- Configure SMTP `MAIL_*` values in `.env` separately if order email notifications are needed. Restart the service after changing `.env`.
- Check service logs with `sudo journalctl -u photoprint -n 100 --no-pager`.
- Backups are rotated locally (14 runs) but never copied off the VPS: keep separate off-server backups or provider snapshots for disaster recovery.

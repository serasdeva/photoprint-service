# VPS deployment automation

These scripts target a fresh Ubuntu VPS and this app's systemd service. They do not configure a domain's DNS or the VPS provider's external firewall.

## Initial setup

First push the scripts to the GitHub `main` branch. On a fresh VPS, set the DNS `A` record for the website domain to the VPS IPv4 address and allow inbound TCP ports 22, 80 and 443 in the provider firewall. Then download, inspect and run the bootstrap script as root:

```bash
curl -fsSLO https://raw.githubusercontent.com/serasdeva/photoprint-service/main/deploy/setup-vps.sh
less setup-vps.sh
sudo bash setup-vps.sh https://github.com/serasdeva/photoprint-service.git docs.co99.win
```

The script installs Node.js 20, Nginx, Certbot and SQLite tooling; creates or uses the `photoprint` system account; clones the repository; installs production dependencies; creates `.env` with generated secrets if one does not already exist; seeds a new database only; configures systemd and Nginx; checks the local app; and requests HTTPS. It prints the generated admin password once. Save it securely.

If the repository is private, configure GitHub SSH/deploy-key access before running the script and pass the SSH clone URL instead.

The script does not overwrite an existing `.env` or seed an existing SQLite database. If certificate issuance fails, verify DNS and external firewall ports 80/443, then run:

```bash
sudo certbot --nginx -d docs.co99.win --email your-email@example.com --agree-tos --non-interactive --redirect
```

## Apply updates from GitHub

Commit and push code changes to `main` from your development machine. On the VPS run:

```bash
sudo bash /var/www/photoprint-service/deploy/update-vps.sh
```

The updater refuses dirty or divergent checkouts, fetches `origin/main`, creates a SQLite online backup and an uploads archive, fast-forward merges only, runs `npm ci --omit=dev`, builds hashed static assets (`npm run build:assets`), restarts systemd and checks the configured `BASE_URL`. Backups are stored under `/var/backups/photoprint-service/`.

If the Git remote's default branch is not `main`, invoke it with `BRANCH=branch-name`:

```bash
sudo env BRANCH=branch-name bash /var/www/photoprint-service/deploy/update-vps.sh
```

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
- The updater does not run `npm run seed`; seed is for first-time initialization only.
- The current app uses Sequelize `sync` without production schema alterations and does not include a migration system. For database model/schema changes, prepare and test a migration/backup/restore procedure before deploying; the update script cannot migrate schemas automatically.
- Configure SMTP `MAIL_*` values in `.env` separately if order email notifications are needed. Restart the service after changing `.env`.
- Check service logs with `sudo journalctl -u photoprint -n 100 --no-pager`.
- The scripts create backups but do not clean them up or copy them off the VPS. Keep separate off-server backups for disaster recovery.

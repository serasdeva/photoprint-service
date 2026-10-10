#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${APP_USER:-photoprint}"
APP_DIR="${APP_DIR:-/var/www/photoprint-service}"
SERVICE_NAME="${SERVICE_NAME:-photoprint}"
BRANCH="${BRANCH:-main}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/photoprint-service}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

[[ -d "$APP_DIR/.git" ]] || fail "Git checkout not found at $APP_DIR."
[[ -f "$APP_DIR/.env" ]] || fail "Production .env not found at $APP_DIR/.env."
id "$APP_USER" >/dev/null 2>&1 || fail "App user $APP_USER does not exist."
systemctl is-active --quiet "$SERVICE_NAME" || fail "Service $SERVICE_NAME is not active; inspect it before updating."

if [[ -n "$(runuser -u "$APP_USER" -- git -C "$APP_DIR" status --porcelain)" ]]; then
  fail 'The server checkout has local changes. Do not overwrite them; inspect git status first.'
fi

CURRENT_COMMIT="$(runuser -u "$APP_USER" -- git -C "$APP_DIR" rev-parse HEAD)"
runuser -u "$APP_USER" -- git -C "$APP_DIR" fetch origin "$BRANCH"
REMOTE_COMMIT="$(runuser -u "$APP_USER" -- git -C "$APP_DIR" rev-parse FETCH_HEAD)"
if ! runuser -u "$APP_USER" -- git -C "$APP_DIR" merge-base --is-ancestor "$CURRENT_COMMIT" "$REMOTE_COMMIT"; then
  fail "Local and origin/$BRANCH have diverged. No files were changed; reconcile Git history manually."
fi
if [[ "$CURRENT_COMMIT" == "$REMOTE_COMMIT" ]]; then
  printf 'Already up to date with origin/%s.\n' "$BRANCH"
  exit 0
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
install -d -m 700 "$BACKUP_DIR"
DB_FILE="$APP_DIR/data/photoprint.sqlite"

if [[ -f "$DB_FILE" ]]; then
  command -v sqlite3 >/dev/null 2>&1 || fail 'sqlite3 CLI is required to make a consistent online backup.'
  sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/photoprint.sqlite'"
fi

if [[ -d "$APP_DIR/public/uploads" ]]; then
  tar -C "$APP_DIR" -czf "$BACKUP_DIR/uploads.tar.gz" public/uploads
fi

printf 'Backup created at %s\n' "$BACKUP_DIR"
runuser -u "$APP_USER" -- git -C "$APP_DIR" merge --ff-only "$REMOTE_COMMIT"
runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" ci --omit=dev
systemctl restart "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME" || {
  journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2 || true
  fail 'Service did not start after update; inspect logs and restore the backup if needed.'
}

BASE_URL="$(sed -n 's/^BASE_URL=//p' "$APP_DIR/.env" | tail -n 1 | tr -d '\r\"' | sed 's:/*$::')"
[[ "$BASE_URL" == https://* || "$BASE_URL" == http://* ]] || fail 'BASE_URL is missing or invalid in .env.'
if ! curl --fail --silent --show-error --max-time 15 -o /dev/null "$BASE_URL/"; then
  journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2 || true
  fail "Updated service is active, but $BASE_URL/ did not return HTTP success. Backup: $BACKUP_DIR"
fi

printf 'Update finished successfully. Commit: %s\n' "$REMOTE_COMMIT"
printf 'Backup: %s\n' "$BACKUP_DIR"
#!/usr/bin/env bash
# Восстановление из бэкапа, сделанного deploy/backup.sh или update-vps.sh:
# база + uploads. Текущие данные сохраняются рядом как *.pre-restore-<время>.
# Использование: sudo bash deploy/restore.sh /var/backups/photoprint-service/<STAMP> [--yes]
set -Eeuo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH" 2>/dev/null || printf '%s' "$SCRIPT_PATH")"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
SERVICE_NAME="${SERVICE_NAME:-photoprint}"
APP_USER="${APP_USER:-photoprint}"

usage() {
  printf 'Usage: sudo bash %s <backup-directory> [--yes]\n' "$0"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

SOURCE="${1:-}"
if [[ -z "$SOURCE" || "$SOURCE" == '--yes' ]]; then
  usage >&2
  exit 2
fi
[[ -d "$SOURCE" ]] || fail "Backup directory not found: $SOURCE"

DB_COPY="$SOURCE/photoprint.sqlite"
UPLOADS_COPY="$SOURCE/uploads.tar.gz"
[[ -f "$DB_COPY" || -f "$UPLOADS_COPY" ]] || fail 'Backup has neither photoprint.sqlite nor uploads.tar.gz.'

command -v sqlite3 >/dev/null 2>&1 || fail 'sqlite3 CLI is required.'
command -v curl >/dev/null 2>&1 || fail 'curl is required for the health check.'
command -v tar >/dev/null 2>&1 || fail 'tar is required.'

if [[ "${2:-}" != '--yes' ]]; then
  printf 'Restore %s into %s and restart %s?\n' "$SOURCE" "$APP_DIR" "$SERVICE_NAME"
  printf 'Current data will be kept as *.pre-restore-<stamp>. Type "restore" to continue: '
  read -r answer
  [[ "$answer" == 'restore' ]] || {
    printf 'Cancelled.\n'
    exit 1
  }
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -f "$DB_COPY" ]]; then
  INTEGRITY="$(sqlite3 "$DB_COPY" 'PRAGMA integrity_check;' 2>&1 || true)"
  [[ "$INTEGRITY" == 'ok' ]] || fail "Backup database is corrupted: $INTEGRITY"
fi

DB_FILE="${DB_STORAGE:-data/photoprint.sqlite}"
[[ "$DB_FILE" = /* ]] || DB_FILE="$APP_DIR/$DB_FILE"
# Текущие данные убираем в data/, а не в public/: иначе старые файлы остались бы доступны по URL.
PRERESTORE_DIR="$APP_DIR/data/pre-restore-$STAMP"

systemctl stop "$SERVICE_NAME"
SERVICE_STOPPED='yes'
# Если восстановление упадёт на середине, сайт всё равно должен вернуться.
trap '[[ -z "$SERVICE_STOPPED" ]] || systemctl start "$SERVICE_NAME" || true' EXIT

if [[ -f "$DB_COPY" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$(dirname "$DB_FILE")"
  if [[ -f "$DB_FILE" ]]; then
    mv "$DB_FILE" "$DB_FILE.pre-restore-$STAMP"
  fi
  # WAL и SHM от прежней базы применились бы к новой и испортили её.
  rm -f "$DB_FILE-wal" "$DB_FILE-shm"
  install -m 600 -o "$APP_USER" -g "$APP_USER" "$DB_COPY" "$DB_FILE"
  printf 'Database restored: %s\n' "$DB_FILE"
fi

if [[ -f "$UPLOADS_COPY" ]]; then
  if [[ -d "$APP_DIR/public/uploads" ]]; then
    install -d -o "$APP_USER" -g "$APP_USER" "$PRERESTORE_DIR"
    mv "$APP_DIR/public/uploads" "$PRERESTORE_DIR/uploads"
  fi
  tar -C "$APP_DIR" -xzf "$UPLOADS_COPY"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR/public/uploads"
  printf 'Uploads restored: %s/public/uploads\n' "$APP_DIR"
fi

systemctl start "$SERVICE_NAME"
SERVICE_STOPPED=''

PORT_VALUE="${PORT:-3000}"
HEALTH_OK=''
for _ in {1..15}; do
  if curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:${PORT_VALUE}/healthz"; then
    HEALTH_OK='yes'
    break
  fi
  sleep 2
done

if [[ -z "$HEALTH_OK" ]]; then
  printf 'ERROR: service started but /healthz did not respond. Previous data: %s\n' "$STAMP" >&2
  journalctl -u "$SERVICE_NAME" -n 50 --no-pager >&2 || true
  exit 1
fi

printf 'Restore finished. Service is healthy.\n'
printf 'Previous data kept in %s and *.pre-restore-%s\n' "$PRERESTORE_DIR" "$STAMP"

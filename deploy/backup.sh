#!/usr/bin/env bash
# Ежедневный бэкап PhotoPrint: согласованный снимок SQLite, архив uploads и ретенция.
# Запускается systemd-таймером photoprint-backup.timer, но пригоден и для ручного вызова.
set -Eeuo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH" 2>/dev/null || printf '%s' "$SCRIPT_PATH")"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

# .env нужен, чтобы взять DB_STORAGE: базу можно вынести из data/ через переменную.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/photoprint-service}"
KEEP_COUNT="${KEEP_COUNT:-14}"
DB_FILE="${DB_STORAGE:-data/photoprint.sqlite}"
UPLOADS_DIR="$APP_DIR/public/uploads"

# umask вместо chmod: каталоги бэкапа сразу создаются доступными только владельцу.
umask 077

[[ "$DB_FILE" = /* ]] || DB_FILE="$APP_DIR/$DB_FILE"
[[ "$KEEP_COUNT" =~ ^[0-9]+$ ]] && (( KEEP_COUNT > 0 )) || fail 'KEEP_COUNT must be a positive number.'

command -v sqlite3 >/dev/null 2>&1 || fail 'sqlite3 CLI is required to make a consistent online backup.'
[[ -f "$DB_FILE" ]] || fail "Database not found: $DB_FILE"

[[ -d "$BACKUP_ROOT" ]] || fail "Backup directory is missing: $BACKUP_ROOT (run deploy/install-backup.sh as root)."
[[ -w "$BACKUP_ROOT" ]] || fail "Backup directory is not writable: $BACKUP_ROOT"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_DIR"

# .backup — консистентный снимок живой базы. Копирование файла вместе с WAL дало бы битую копию.
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/photoprint.sqlite'"
[[ -s "$BACKUP_DIR/photoprint.sqlite" ]] || fail 'Backup file is empty.'

INTEGRITY="$(sqlite3 "$BACKUP_DIR/photoprint.sqlite" 'PRAGMA integrity_check;' 2>&1 || true)"
[[ "$INTEGRITY" == 'ok' ]] || fail "Backup integrity check failed: $INTEGRITY"

if [[ -d "$UPLOADS_DIR" ]]; then
  tar -C "$APP_DIR" -czf "$BACKUP_DIR/uploads.tar.gz" public/uploads
fi

# Ретенция: оставляем KEEP_COUNT последних каталогов, остальные удаляем.
mapfile -t OLD_BACKUPS < <(
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%f\n' |
    sort |
    head -n -"$KEEP_COUNT"
)
for old in "${OLD_BACKUPS[@]}"; do
  rm -rf -- "${BACKUP_ROOT:?}/$old"
done

printf 'Backup created: %s\n' "$BACKUP_DIR"
printf 'Kept backups: %s (KEEP_COUNT=%s)\n' "$BACKUP_ROOT" "$KEEP_COUNT"

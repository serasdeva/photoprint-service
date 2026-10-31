#!/usr/bin/env bash
# Ставит ежедневный бэкап PhotoPrint: скрипт в /usr/local/bin, systemd-сервис и таймер.
# Идемпотентен: setup-vps.sh и update-vps.sh вызывают его при каждом обновлении.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"
APP_USER="${APP_USER:-photoprint}"
BACKUP_BIN="${BACKUP_BIN:-/usr/local/bin/photoprint-backup.sh}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/photoprint-service}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail 'Run this script as root (for example through setup-vps.sh or update-vps.sh).'
fi

[[ -f "$APP_DIR/deploy/backup.sh" ]] || fail "backup.sh is missing in $APP_DIR/deploy."
command -v sqlite3 >/dev/null 2>&1 || fail 'sqlite3 CLI is required for backups.'

# Каталог создаём от имени приложения: таймер работает под APP_USER и должен в него писать.
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$BACKUP_ROOT"

chmod +x "$APP_DIR/deploy/backup.sh"
ln -sfn "$APP_DIR/deploy/backup.sh" "$BACKUP_BIN"

render_unit() {
  local source="$1"
  local target="$2"
  sed -e "s|@APP_DIR@|${APP_DIR}|g" -e "s|@APP_USER@|${APP_USER}|g" "$source" > "$target"
  chmod 0644 "$target"
}

render_unit "$SCRIPT_DIR/photoprint-backup.service" /etc/systemd/system/photoprint-backup.service
install -m 0644 "$SCRIPT_DIR/photoprint-backup.timer" /etc/systemd/system/photoprint-backup.timer

systemctl daemon-reload
systemctl enable --now photoprint-backup.timer

printf 'Backup installed: photoprint-backup.timer writes to %s daily at 03:30.\n' "$BACKUP_ROOT"
printf 'Run once now: sudo systemctl start photoprint-backup.service\n'
printf 'Restore: sudo bash %s/deploy/restore.sh <backup-directory>\n' "$APP_DIR"

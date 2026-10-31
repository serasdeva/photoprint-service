#!/usr/bin/env bash
# Ставит мониторинг PhotoPrint: таймер проверки /healthz, Telegram-алерты и ротацию journald.
# Идемпотентен: setup-vps.sh и update-vps.sh вызывают его при каждом обновлении.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"
APP_USER="${APP_USER:-photoprint}"
SERVICE_NAME="${SERVICE_NAME:-photoprint}"
HEALTHCHECK_BIN="${HEALTHCHECK_BIN:-/usr/local/bin/photoprint-healthcheck.sh}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail 'Run this script as root (for example through setup-vps.sh or update-vps.sh).'
fi

[[ -x "$APP_DIR/deploy/healthcheck.sh" ]] || fail "healthcheck.sh is missing or not executable in $APP_DIR/deploy."
command -v curl >/dev/null 2>&1 || fail 'curl is required for health checks.'
command -v sqlite3 >/dev/null 2>&1 || printf 'WARNING: sqlite3 is missing; chat id must be set in .env.\n' >&2

install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data"
chmod +x "$APP_DIR/deploy/healthcheck.sh"
ln -sfn "$APP_DIR/deploy/healthcheck.sh" "$HEALTHCHECK_BIN"

render_unit() {
  local source="$1"
  local target="$2"
  sed -e "s|@APP_DIR@|${APP_DIR}|g" -e "s|@APP_USER@|${APP_USER}|g" "$source" > "$target"
  chmod 0644 "$target"
}

render_unit "$SCRIPT_DIR/photoprint-healthcheck.service" "/etc/systemd/system/photoprint-healthcheck.service"
render_unit "$SCRIPT_DIR/photoprint-alert@.service" "/etc/systemd/system/photoprint-alert@.service"
install -m 0644 "$SCRIPT_DIR/photoprint-healthcheck.timer" "/etc/systemd/system/photoprint-healthcheck.timer"

# OnFailure в drop-in, а не в основном юните: обновления не перезаписывают настройки сервиса.
install -d "/etc/systemd/system/${SERVICE_NAME}.service.d"
cat > "/etc/systemd/system/${SERVICE_NAME}.service.d/monitoring.conf" <<EOF
[Unit]
OnFailure=photoprint-alert@%n.service
EOF
chmod 0644 "/etc/systemd/system/${SERVICE_NAME}.service.d/monitoring.conf"

# journald иначе растёт без предела: ограничиваем общий объём и размер одного файла.
install -d /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/photoprint.conf <<'EOF'
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
EOF
chmod 0644 /etc/systemd/journald.conf.d/photoprint.conf

systemctl daemon-reload
systemctl enable --now photoprint-healthcheck.timer
systemctl restart systemd-journald

printf 'Monitoring installed: photoprint-healthcheck.timer checks %s/healthz every minute.\n' "$APP_DIR"
printf 'Test Telegram alert: sudo -u %s %s --test\n' "$APP_USER" "$HEALTHCHECK_BIN"

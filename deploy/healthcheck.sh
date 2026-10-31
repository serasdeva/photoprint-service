#!/usr/bin/env bash
# Проверка /healthz раз в минуту и уведомления в Telegram. Запускается systemd-таймером
# отдельно от приложения, поэтому переживает падение сайта. Состояние хранится в data/,
# чтобы не спамить одним и тем же сообщением каждый час: тревога уходит один раз,
# повтор — не чаще REMINDER_SECONDS, а восстановление — отдельным сообщением.
set -Eeuo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH" 2>/dev/null || printf '%s' "$SCRIPT_PATH")"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"

log() {
  printf '[healthcheck] %s\n' "$*" >&2
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi

  HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:${PORT:-3000}/healthz}"
  TELEGRAM_API_BASE="${TELEGRAM_API_BASE:-https://api.telegram.org}"
  STATE_FILE="${STATE_FILE:-$APP_DIR/data/healthcheck.state}"
  REMINDER_SECONDS="${REMINDER_SECONDS:-3600}"
}

db_chat_id() {
  local db_file="${DB_STORAGE:-data/photoprint.sqlite}"
  [[ "$db_file" = /* ]] || db_file="$APP_DIR/$db_file"
  [[ -f "$db_file" ]] || return 0
  command -v sqlite3 >/dev/null 2>&1 || return 0

  sqlite3 "$db_file" \
    "SELECT value FROM Settings WHERE key = 'telegramAdminChatId' LIMIT 1;" \
    2>/dev/null | head -n 1 || true
}

chat_id() {
  local configured="${ALERT_CHAT_ID:-${BOT_ADMIN_CHAT_ID:-}}"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return
  fi
  db_chat_id
}

send_telegram() {
  local text="$1"
  local chat
  chat="$(chat_id)"

  if [[ -z "${BOT_TOKEN:-}" || -z "$chat" ]]; then
    log 'Telegram alert skipped: BOT_TOKEN or chat id is not configured.'
    return 1
  fi

  if curl -fsS --max-time 10 -o /dev/null \
    -X POST "${TELEGRAM_API_BASE%/}/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${chat}" \
    --data-urlencode "text=${text}" \
    --data-urlencode 'disable_web_page_preview=true'; then
    return 0
  fi

  log 'Telegram alert failed.'
  return 1
}

read_state() {
  if [[ -f "$STATE_FILE" ]]; then
    sed -n '1p' "$STATE_FILE" 2>/dev/null || true
  else
    printf 'ok'
  fi
}

read_last_alert() {
  if [[ -f "$STATE_FILE" ]]; then
    sed -n '2p' "$STATE_FILE" 2>/dev/null || true
  else
    printf '0'
  fi
}

write_state() {
  local status="$1"
  local timestamp="$2"
  local dir
  dir="$(dirname "$STATE_FILE")"
  mkdir -p "$dir"
  printf '%s\n%s\n' "$status" "$timestamp" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
}

now_text() {
  date -u '+%Y-%m-%d %H:%M UTC'
}

check_health() {
  local previous last_alert now
  previous="$(read_state)"
  last_alert="$(read_last_alert)"
  [[ "$previous" == 'fail' ]] || previous='ok'
  [[ "$last_alert" =~ ^[0-9]+$ ]] || last_alert=0
  now="$(date +%s)"

  local output
  if output="$(curl -fsS --max-time 10 "$HEALTHCHECK_URL" 2>&1)"; then
    if [[ "$previous" == 'fail' ]]; then
      # Если Telegram недоступен, состояние не сбрасываем: восстановление повторим в следующую минуту.
      if send_telegram "🟢 PhotoPrint снова доступен: ${HEALTHCHECK_URL} ($(now_text))"; then
        write_state 'ok' '0'
        log 'Health check recovered.'
      fi
    else
      write_state 'ok' '0'
    fi
    return 0
  fi

  log "Health check failed: ${output}"
  if [[ "$previous" != 'fail' || $((now - last_alert)) -ge "$REMINDER_SECONDS" ]]; then
    # Состояние фиксируем только после успешной отправки, иначе следующая проверка повторит алерт.
    if send_telegram "🔴 PhotoPrint недоступен: ${HEALTHCHECK_URL} ($(now_text))
${output}"; then
      write_state 'fail' "$now"
    fi
  fi
  return 1
}

main() {
  local mode="${1:-check}"

  load_env

  case "$mode" in
    check)
      check_health
      ;;
    --service-failed)
      local unit="${2:-unknown.service}"
      if send_telegram "🔴 PhotoPrint: systemd-юнит ${unit} завершился с ошибкой ($(now_text))."; then
        # Таймер увидит fail и не пришлёт дубль; если отправка не удалась, он попробует сам.
        write_state 'fail' "$(date +%s)"
        log "Reported failed unit: ${unit}"
      else
        exit 1
      fi
      ;;
    --test)
      send_telegram "✅ PhotoPrint: тестовое сообщение мониторинга ($(now_text))."
      log 'Test alert sent.'
      ;;
    *)
      printf 'Usage: %s [check|--service-failed <unit>|--test]\n' "$0" >&2
      exit 2
      ;;
  esac
}

main "$@"

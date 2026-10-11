#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${APP_USER:-photoprint}"
APP_DIR="${APP_DIR:-/var/www/photoprint-service}"
SERVICE_NAME="${SERVICE_NAME:-photoprint}"

usage() {
  printf 'Usage: sudo bash setup-vps.sh <git-repository-url> <domain>\n'
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail 'Run this script as root, for example: sudo bash setup-vps.sh <repo-url> <domain>'
fi

if [[ "$#" -ne 2 ]]; then
  usage >&2
  exit 2
fi

REPO_URL="$1"
DOMAIN="$2"

[[ -f /etc/os-release ]] || fail 'Cannot identify Linux distribution.'
# shellcheck source=/etc/os-release
. /etc/os-release
[[ "${ID:-}" == 'ubuntu' ]] || fail 'This setup script currently supports Ubuntu only.'
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail 'Invalid domain name.'

if [[ -e "$APP_DIR" && ! -d "$APP_DIR/.git" ]]; then
  if [[ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    fail "$APP_DIR exists and is not a Git checkout. Move it or choose another APP_DIR."
  fi
fi

printf 'Installing system packages...\n'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx sqlite3 build-essential

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"
if (( NODE_MAJOR < 20 )); then
  printf 'Installing Node.js 20...\n'
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
fi

command -v node >/dev/null || fail 'Node.js installation failed.'
NODE_BIN="$(command -v node)"

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
fi

install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
  runuser -u "$APP_USER" -- git clone "$REPO_URL" "$APP_DIR"
fi

[[ -f "$APP_DIR/package-lock.json" ]] || fail 'package-lock.json is missing; deploy a repository with its lockfile.'
install -d -o "$APP_USER" -g "$APP_USER" \
  "$APP_DIR/data" \
  "$APP_DIR/data/sessions" \
  "$APP_DIR/public/uploads/services" \
  "$APP_DIR/public/uploads/gallery"

if [[ ! -f "$APP_DIR/.env" ]]; then
  read -r -p "Confirm website domain [$DOMAIN]: " INPUT_DOMAIN
  INPUT_DOMAIN="${INPUT_DOMAIN:-$DOMAIN}"
  [[ "$INPUT_DOMAIN" == "$DOMAIN" ]] || fail 'The entered domain must match the domain argument.'

  read -r -p 'Admin username [siteadmin]: ' ADMIN_USERNAME
  ADMIN_USERNAME="${ADMIN_USERNAME:-siteadmin}"
  [[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9_-]{3,64}$ ]] || fail 'Admin username may contain only letters, digits, _ and - (3-64 chars).'

  read -r -p 'Email for admin and certificate notices: ' ADMIN_EMAIL
  [[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail 'Invalid email address.'

  SESSION_SECRET="$(openssl rand -hex 32)"
  JWT_SECRET="$(openssl rand -hex 32)"
  ADMIN_PASSWORD="$(openssl rand -hex 24)"

  umask 077
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=3000
SESSION_SECRET=$SESSION_SECRET
JWT_SECRET=$JWT_SECRET
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_EMAIL=$ADMIN_EMAIL
BASE_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  printf '\nGenerated admin password (save it now; it will not be printed again):\n%s\n\n' "$ADMIN_PASSWORD"
else
  printf 'Keeping existing .env unchanged. Verify BASE_URL, secrets and admin credentials yourself.\n'
fi

printf 'Installing Node dependencies...\n'
runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" ci --omit=dev

if [[ ! -f "$APP_DIR/data/photoprint.sqlite" ]]; then
  printf 'Initializing database and demo content...\n'
  runuser -u "$APP_USER" -- npm --prefix "$APP_DIR" run seed
else
  printf 'Existing SQLite database found; skipping seed to preserve data.\n'
fi

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=PhotoPrint Service
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/nginx/sites-available/photoprint <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sfn /etc/nginx/sites-available/photoprint /etc/nginx/sites-enabled/photoprint
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow OpenSSH
  ufw allow 'Nginx Full'
fi

nginx -t
systemctl enable --now nginx
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl reload nginx

printf 'Checking application on localhost...\n'
for attempt in {1..10}; do
  if curl --fail --silent --show-error --max-time 5 -o /dev/null -H "Host: $DOMAIN" http://127.0.0.1:3000/; then
    break
  fi
  if [[ "$attempt" -eq 10 ]]; then
    journalctl -u "$SERVICE_NAME" -n 50 --no-pager >&2 || true
    fail 'Application did not return HTTP success. Inspect the service logs above.'
  fi
  sleep 2
done

printf '\nRequesting a Let\x27s Encrypt certificate for %s...\n' "$DOMAIN"
read -r -p 'Certificate contact email: ' CERT_EMAIL
[[ "$CERT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail 'Invalid certificate email address.'
SITE_SCHEME='http'
if certbot --nginx -d "$DOMAIN" --email "$CERT_EMAIL" --agree-tos --non-interactive --redirect; then
  printf 'HTTPS configured successfully.\n'
  SITE_SCHEME='https'
else
  printf 'WARNING: Certificate setup failed. HTTP is serving the site; verify DNS and ports 80/443, then retry Certbot.\n' >&2
fi

printf '\nSetup finished. Site: %s://%s\nAdmin: %s://%s/admin/login\n' "$SITE_SCHEME" "$DOMAIN" "$SITE_SCHEME" "$DOMAIN"
printf 'Check service with: systemctl status %s\n' "$SERVICE_NAME"
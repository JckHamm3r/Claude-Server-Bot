#!/usr/bin/env bash
# setup-domain.sh — Configure nginx + SSL for a domain
# Called by the Settings UI domain API via sudo
# Usage: setup-domain.sh <domain> <port> <path-prefix> <slug> <install-dir> <admin-email>
set -euo pipefail

DOMAIN="$1"
PORT="${2:-3000}"
PATH_PREFIX="${3:-}"
SLUG="${4:-}"
INSTALL_DIR="${5:-}"
ADMIN_EMAIL="${6:-}"

json_ok()    { echo "{\"ok\":true}"; }
json_fail()  { echo "{\"ok\":false,\"error\":$(printf '%s' "$1" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}"; exit 0; }

# Validate domain format
if ! echo "$DOMAIN" | grep -qE '^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  json_fail "Invalid domain format: $DOMAIN"
fi

# Validate PORT
if ! echo "$PORT" | grep -qE '^[0-9]+$'; then
  json_fail "Invalid port (must be numeric): $PORT"
fi
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  json_fail "Port out of range (1-65535): $PORT"
fi

# Validate PATH_PREFIX (allow empty)
if [ -n "$PATH_PREFIX" ] && ! echo "$PATH_PREFIX" | grep -qE '^[a-zA-Z0-9_-]*$'; then
  json_fail "Invalid path prefix (alphanumeric, hyphens, underscores only): $PATH_PREFIX"
fi

# Validate SLUG
if [ -n "$SLUG" ] && ! echo "$SLUG" | grep -qE '^[a-zA-Z0-9]+$'; then
  json_fail "Invalid slug (alphanumeric only): $SLUG"
fi

# Validate INSTALL_DIR does not contain path traversal
if echo "$INSTALL_DIR" | grep -q '\.\.'; then
  json_fail "Invalid install directory (must not contain '..'): $INSTALL_DIR"
fi

# Validate ADMIN_EMAIL (basic format check)
if [ -n "$ADMIN_EMAIL" ] && ! echo "$ADMIN_EMAIL" | grep -qE '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
  json_fail "Invalid email format: $ADMIN_EMAIL"
fi

# Install nginx if missing
if ! command -v nginx &>/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq nginx >/dev/null 2>&1 || json_fail "Failed to install nginx"
fi

# Determine config path
nginx_conf=""
nginx_link=""
if [ -d /etc/nginx/sites-available ]; then
  nginx_conf="/etc/nginx/sites-available/claude-bot"
  nginx_link="/etc/nginx/sites-enabled/claude-bot"
else
  nginx_conf="/etc/nginx/conf.d/claude-bot.conf"
fi

# Build location path
LOCATION_PATH="/"
if [ -n "$PATH_PREFIX" ] && [ -n "$SLUG" ]; then
  LOCATION_PATH="/${PATH_PREFIX}/${SLUG}/"
fi

# Write nginx config
cat > "$nginx_conf" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location $LOCATION_PATH {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10;
        proxy_send_timeout 86400;
        proxy_read_timeout 86400;
        proxy_buffering off;
        proxy_cache off;
        client_max_body_size 10m;
    }
}
NGINX

# Symlink if using sites-available/sites-enabled
if [ -n "$nginx_link" ]; then
  ln -sf "$nginx_conf" "$nginx_link"
fi

# Test nginx config
if ! nginx -t -q 2>/dev/null; then
  json_fail "nginx config test failed"
fi

systemctl reload nginx 2>/dev/null || systemctl start nginx 2>/dev/null || json_fail "Failed to start/reload nginx"

# Install certbot if missing
if ! command -v certbot &>/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null 2>&1 || json_fail "Failed to install certbot"
fi

# Run certbot
CERTBOT_EMAIL="${ADMIN_EMAIL:-admin@$DOMAIN}"
certbot_log=$(mktemp /tmp/certbot-XXXXXX.log)
if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect -q 2>"$certbot_log"; then
  err_msg=$(tail -5 "$certbot_log" 2>/dev/null | tr '\n' ' ')
  rm -f "$certbot_log"
  json_fail "Certbot failed: ${err_msg:-unknown error}"
fi
rm -f "$certbot_log"

# Update .env NEXTAUTH_URL if install dir provided
if [ -n "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/.env" ]; then
  NEW_URL="https://${DOMAIN}/${PATH_PREFIX}/${SLUG}"
  if command -v node &>/dev/null; then
    node -e "
const fs = require('fs');
const envPath = process.argv[1];
const newUrl = process.argv[2];
let env = fs.readFileSync(envPath, 'utf8');
env = env.replace(/^NEXTAUTH_URL=.*/m, 'NEXTAUTH_URL=' + newUrl);
fs.writeFileSync(envPath, env);
" "$INSTALL_DIR/.env" "$NEW_URL"
  else
    sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=${NEW_URL}|" "$INSTALL_DIR/.env"
  fi
fi

# Open firewall ports if ufw is active
if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi

json_ok

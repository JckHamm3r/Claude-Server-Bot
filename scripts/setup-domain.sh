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
json_fail()  {
  local msg
  # Escape the error string for JSON without requiring python3
  msg=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr -d '\n')
  echo "{\"ok\":false,\"error\":\"${msg}\"}"
  exit 0
}

# ─── DNS + reachability pre-checks ────────────────────────────────────────────
# Resolve domain IPs using whatever tool is available
_resolve_ips() {
  local domain="$1"
  local ips=""
  if command -v dig &>/dev/null; then
    ips=$(dig +short "$domain" A 2>/dev/null | grep -E '^[0-9]+\.' || true)
    [ -z "$ips" ] && ips=$(dig +short "$domain" AAAA 2>/dev/null | grep -v '^\.' || true)
  fi
  if [ -z "$ips" ] && command -v host &>/dev/null; then
    ips=$(host -t A "$domain" 2>/dev/null | grep "has address" | awk '{print $NF}' || true)
  fi
  if [ -z "$ips" ] && command -v getent &>/dev/null; then
    ips=$(getent hosts "$domain" 2>/dev/null | awk '{print $1}' || true)
  fi
  echo "$ips"
}

# Get this server's public IP
_server_public_ip() {
  local ip=""
  # Try AWS IMDSv2 first (works on EC2)
  local token
  token=$(curl -sf --max-time 2 -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 5" \
    http://169.254.169.254/latest/api/token 2>/dev/null) || true
  if [ -n "$token" ]; then
    ip=$(curl -sf --max-time 2 -H "X-aws-ec2-metadata-token: $token" \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null) || true
  fi
  [ -z "$ip" ] && ip=$(curl -sf --max-time 3 https://api.ipify.org 2>/dev/null) || true
  [ -z "$ip" ] && ip=$(curl -sf --max-time 3 https://ifconfig.me 2>/dev/null) || true
  echo "$ip"
}

# Check if port 80 is accessible on the domain from outside
_check_port80() {
  local domain="$1"
  # curl with very short timeout — just testing TCP connection
  curl -sf --max-time 5 --connect-timeout 5 -o /dev/null \
    "http://${domain}/" 2>/dev/null && echo "open" || echo "closed"
}

SERVER_IP=$(_server_public_ip)
DNS_IPS=$(_resolve_ips "$DOMAIN")
DNS_RESOLVED=false
IP_MATCH=false

if [ -n "$DNS_IPS" ]; then
  DNS_RESOLVED=true
  if [ -n "$SERVER_IP" ] && echo "$DNS_IPS" | grep -qF "$SERVER_IP"; then
    IP_MATCH=true
  fi
fi

# Hard-fail if DNS doesn't resolve at all — certbot will fail too
if ! $DNS_RESOLVED; then
  if [ -n "$SERVER_IP" ]; then
    json_fail "DNS for ${DOMAIN} does not resolve yet. Create an A record pointing ${DOMAIN} to ${SERVER_IP} and wait for propagation, then retry."
  else
    json_fail "DNS for ${DOMAIN} does not resolve yet. Create an A record pointing ${DOMAIN} to this server's public IP and wait for propagation, then retry."
  fi
fi

# Warn-as-fail if DNS resolves but to the wrong IP
if ! $IP_MATCH && [ -n "$SERVER_IP" ]; then
  RESOLVED_DISPLAY=$(echo "$DNS_IPS" | tr '\n' ' ' | sed 's/ $//')
  json_fail "DNS mismatch: ${DOMAIN} resolves to ${RESOLVED_DISPLAY} but this server's IP is ${SERVER_IP}. Update your A record to point to ${SERVER_IP} and wait for DNS propagation, then retry."
fi

# Check port 80 reachability (required for Let's Encrypt HTTP-01 challenge)
PORT80_STATUS=$(_check_port80 "$DOMAIN")
if [ "$PORT80_STATUS" = "closed" ]; then
  json_fail "Port 80 is not reachable on ${DOMAIN}. Ensure port 80 (HTTP) is open in your firewall or cloud security group — Let's Encrypt requires it to issue certificates."
fi

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

# Detect package manager
_pkg_install() {
  if command -v apt-get &>/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq "$@" >/dev/null 2>&1
  elif command -v dnf &>/dev/null; then
    dnf install -y -q "$@" >/dev/null 2>&1
  elif command -v yum &>/dev/null; then
    yum install -y -q "$@" >/dev/null 2>&1
  else
    return 1
  fi
}

# Install nginx if missing
if ! command -v nginx &>/dev/null; then
  _pkg_install nginx || json_fail "Failed to install nginx — no supported package manager found"
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

# Build location path — both PATH_PREFIX and SLUG are required for safe operation
if [ -z "$PATH_PREFIX" ] || [ -z "$SLUG" ]; then
  json_fail "Both path-prefix and slug are required for nginx configuration"
fi
LOCATION_PATH="/${PATH_PREFIX}/${SLUG}/"

# Detect whether upstream Node.js server uses TLS (self-signed certs)
UPSTREAM_SCHEME="http"
PROXY_SSL_EXTRA=""
if [ -n "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/.env" ]; then
  if grep -q '^SSL_CERT_PATH=' "$INSTALL_DIR/.env" && grep -q '^SSL_KEY_PATH=' "$INSTALL_DIR/.env"; then
    UPSTREAM_SCHEME="https"
    PROXY_SSL_EXTRA=$'\n        proxy_ssl_verify off;'
  fi
fi

# Write nginx config
# API / socket proxy block MUST come before the static-asset regex block.
# nginx evaluates regex locations in definition order; if the static-file
# rule appeared first it would match paths like /api/foo.js and serve a 404.
cat > "$nginx_conf" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    server_tokens off;

    location /api/w {
        proxy_pass ${UPSTREAM_SCHEME}://127.0.0.1:$PORT;${PROXY_SSL_EXTRA}
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^${LOCATION_PATH}(api|socket\.io|_next)/ {
        proxy_pass ${UPSTREAM_SCHEME}://127.0.0.1:$PORT;${PROXY_SSL_EXTRA}
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

    location $LOCATION_PATH {
        proxy_pass ${UPSTREAM_SCHEME}://127.0.0.1:$PORT;${PROXY_SSL_EXTRA}
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
  _pkg_install certbot python3-certbot-nginx || json_fail "Failed to install certbot — no supported package manager found"
fi

# Run certbot
CERTBOT_EMAIL="${ADMIN_EMAIL:-admin@$DOMAIN}"
certbot_log=$(mktemp /tmp/certbot-XXXXXX.log)
if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect -q 2>"$certbot_log"; then
  raw_err=$(tail -10 "$certbot_log" 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')
  rm -f "$certbot_log"

  # Translate common certbot errors into actionable messages
  friendly_err=""
  if echo "$raw_err" | grep -qi "too many certificates\|rate limit"; then
    friendly_err="Let's Encrypt rate limit reached for ${DOMAIN}. You can issue at most 5 certificates per domain per week. Wait before retrying, or use a different subdomain."
  elif echo "$raw_err" | grep -qi "connection refused\|timeout\|could not connect"; then
    friendly_err="Let's Encrypt could not reach ${DOMAIN} on port 80. Ensure port 80 is open and DNS is correctly propagated, then retry."
  elif echo "$raw_err" | grep -qi "dns\|NXDOMAIN\|no valid ip"; then
    friendly_err="Let's Encrypt DNS check failed for ${DOMAIN}. Verify your A record is correct and fully propagated, then retry."
  elif echo "$raw_err" | grep -qi "already exists\|certificate not yet due"; then
    friendly_err="A certificate for ${DOMAIN} already exists and is not yet due for renewal. If the nginx config is correct, your SSL is already active."
  else
    friendly_err="Certificate issuance failed for ${DOMAIN}. Details: ${raw_err:-unknown error}. Check that DNS resolves to this server and port 80 is reachable."
  fi

  json_fail "$friendly_err"
fi
rm -f "$certbot_log"

# Verify the certificate was actually written
if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  json_fail "Certbot reported success but no certificate was found at /etc/letsencrypt/live/${DOMAIN}. Try running: sudo certbot --nginx -d ${DOMAIN}"
fi

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

# Block external access to the app port — nginx is now the only entry point.
# This prevents the Next.js 404 page from leaking the basePath/slug to anyone
# who hits the app port directly.
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "active"; then
  ufw delete allow "$PORT/tcp" >/dev/null 2>&1 || true
  ufw deny in on any to any port "$PORT" proto tcp >/dev/null 2>&1 || true
  ufw allow in on lo to any port "$PORT" proto tcp >/dev/null 2>&1 || true
elif command -v iptables &>/dev/null; then
  iptables -D INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || true
  iptables -C INPUT -i lo -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || \
    iptables -I INPUT -i lo -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || true
  iptables -C INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null || \
    iptables -A INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null || true
  command -v iptables-save &>/dev/null && sh -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || true
fi

json_ok

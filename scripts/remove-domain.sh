#!/usr/bin/env bash
# remove-domain.sh — Remove nginx config and optionally revoke SSL cert for a domain
# Called by the Settings UI domain DELETE API via sudo
# Usage: remove-domain.sh <domain> [--revoke-cert]
set -euo pipefail

DOMAIN="${1:-}"
REVOKE_CERT=false
if [ "${2:-}" = "--revoke-cert" ]; then
  REVOKE_CERT=true
fi

json_ok()   { echo "{\"ok\":true}"; }
json_fail() {
  local msg
  msg=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr -d '\n')
  echo "{\"ok\":false,\"error\":\"${msg}\"}"
  exit 0
}

if [ -z "$DOMAIN" ]; then
  json_fail "No domain provided"
fi

# Validate domain format
if ! echo "$DOMAIN" | grep -qE '^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  json_fail "Invalid domain format: $DOMAIN"
fi

REMOVED_NGINX=false
REMOVED_CERT=false

# Remove nginx config
if [ -f "/etc/nginx/sites-available/claude-bot" ]; then
  # Check if this config serves our domain before removing
  if grep -q "server_name ${DOMAIN}" /etc/nginx/sites-available/claude-bot 2>/dev/null; then
    rm -f /etc/nginx/sites-available/claude-bot
    rm -f /etc/nginx/sites-enabled/claude-bot
    REMOVED_NGINX=true
  fi
elif [ -f "/etc/nginx/conf.d/claude-bot.conf" ]; then
  if grep -q "server_name ${DOMAIN}" /etc/nginx/conf.d/claude-bot.conf 2>/dev/null; then
    rm -f /etc/nginx/conf.d/claude-bot.conf
    REMOVED_NGINX=true
  fi
fi

# Reload nginx if it is running
if $REMOVED_NGINX && command -v nginx &>/dev/null; then
  if nginx -t -q 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || true
  fi
fi

# Optionally revoke and delete the Let's Encrypt cert
if $REVOKE_CERT && command -v certbot &>/dev/null; then
  if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    certbot delete --cert-name "$DOMAIN" --non-interactive -q 2>/dev/null || true
    REMOVED_CERT=true
  fi
fi

# Relax firewall rules if nginx was the only domain using ports 80/443
# (Only remove deny on the app port if no other nginx configs exist)
remaining_nginx_configs=0
[ -d /etc/nginx/sites-enabled ] && remaining_nginx_configs=$(find /etc/nginx/sites-enabled -type f | wc -l)
[ -d /etc/nginx/conf.d ] && remaining_nginx_configs=$((remaining_nginx_configs + $(find /etc/nginx/conf.d -name "*.conf" | wc -l)))

if [ "$remaining_nginx_configs" -eq 0 ]; then
  # No more nginx vhosts — re-open the app port if it was locked down
  if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "active"; then
    ufw delete deny in on any to any port "$PORT" proto tcp 2>/dev/null || true
    ufw allow in on lo to any port "${PORT:-3000}" proto tcp 2>/dev/null || true
  fi
fi

echo "{\"ok\":true,\"removed_nginx\":${REMOVED_NGINX},\"removed_cert\":${REMOVED_CERT}}"

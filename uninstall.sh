#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
#  Octoby AI — Uninstaller
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()  { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
error() { echo -e "  ${RED}✗${NC} $*"; }

SERVICE_NAME="claude-bot"
LAUNCHD_LABEL="com.claude-server-bot"
FORCE=false
KEEP_DATA=false
INSTALL_DIR=""

# ─── Usage ────────────────────────────────────────────────────────────────
usage() {
  echo ""
  echo -e "${BOLD}Usage:${NC} $0 [OPTIONS] [INSTALL_DIR]"
  echo ""
  echo "  Remove Octoby AI and all associated system configuration."
  echo ""
  echo -e "${BOLD}Options:${NC}"
  echo "  --force       Skip all confirmation prompts"
  echo "  --keep-data   Preserve the data/ directory (database, uploads)"
  echo "  --help        Show this help message"
  echo ""
  echo -e "${BOLD}Arguments:${NC}"
  echo "  INSTALL_DIR   Path to the installation directory (default: current directory)"
  echo ""
  exit 0
}

# ─── Parse arguments ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)     FORCE=true; shift ;;
    --keep-data) KEEP_DATA=true; shift ;;
    --help|-h)   usage ;;
    -*)          error "Unknown option: $1"; usage ;;
    *)           INSTALL_DIR="$1"; shift ;;
  esac
done

# ─── Detect install directory ─────────────────────────────────────────────
if [ -z "$INSTALL_DIR" ]; then
  INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
fi

if [ ! -d "$INSTALL_DIR" ]; then
  error "Install directory not found: $INSTALL_DIR"
  exit 1
fi

if [ ! -f "$INSTALL_DIR/package.json" ]; then
  error "Does not look like an Octoby AI installation: $INSTALL_DIR"
  exit 1
fi

# ─── Helpers ──────────────────────────────────────────────────────────────
confirm() {
  if $FORCE; then return 0; fi
  local prompt="$1"
  local default="${2:-n}"
  local yn
  if [ "$default" = "y" ]; then
    read -rp "  $prompt [Y/n] " yn
    yn="${yn:-y}"
  else
    read -rp "  $prompt [y/N] " yn
    yn="${yn:-n}"
  fi
  [[ "$yn" =~ ^[Yy] ]]
}

has_sudo() {
  command -v sudo &>/dev/null && sudo -n true 2>/dev/null
}

# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}       Octoby AI — Uninstaller${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Install directory: ${BOLD}${INSTALL_DIR}${NC}"
echo ""

if ! $FORCE; then
  if ! confirm "Proceed with uninstall?" "n"; then
    echo "  Cancelled."
    exit 0
  fi
  echo ""
fi

# ─── Stop & disable systemd service ──────────────────────────────────────
if systemctl list-unit-files "${SERVICE_NAME}.service" &>/dev/null 2>&1 && \
   systemctl cat "${SERVICE_NAME}.service" &>/dev/null 2>&1; then
  echo "  Stopping systemd service..."
  sudo systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
  sudo systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
  if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    sudo systemctl daemon-reload
  fi
  info "systemd service removed"
elif systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
  echo "  Stopping systemd service..."
  sudo systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
  sudo systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
  if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    sudo systemctl daemon-reload
  fi
  info "systemd service removed"
else
  echo -e "  ${DIM}No systemd service found${NC}"
fi

# ─── Stop & remove launchd service ───────────────────────────────────────
PLIST_PATH="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
if [ -f "$PLIST_PATH" ]; then
  echo "  Stopping launchd service..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  launchctl stop "$LAUNCHD_LABEL" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  info "launchd service removed"
else
  echo -e "  ${DIM}No launchd service found${NC}"
fi

# ─── Remove nginx config ─────────────────────────────────────────────────
NGINX_REMOVED=false
for nginx_path in \
  "/etc/nginx/sites-available/claude-bot" \
  "/etc/nginx/sites-enabled/claude-bot" \
  "/etc/nginx/conf.d/claude-bot.conf"; do
  if [ -f "$nginx_path" ] || [ -L "$nginx_path" ]; then
    if ! $NGINX_REMOVED; then
      echo "  Removing nginx configuration..."
    fi
    sudo rm -f "$nginx_path"
    NGINX_REMOVED=true
  fi
done

if $NGINX_REMOVED; then
  if command -v nginx &>/dev/null && nginx -t -q 2>/dev/null; then
    sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null || true
  fi
  info "nginx configuration removed"
else
  echo -e "  ${DIM}No nginx configuration found${NC}"
fi

# ─── Remove UFW rules ────────────────────────────────────────────────────
if command -v ufw &>/dev/null && has_sudo; then
  if sudo ufw status 2>/dev/null | grep -qE '80/tcp|443/tcp'; then
    if confirm "Remove UFW rules for ports 80 and 443?" "n"; then
      echo "  Removing UFW rules..."
      sudo ufw delete allow 80/tcp 2>/dev/null || true
      sudo ufw delete allow 443/tcp 2>/dev/null || true
      info "UFW rules removed"
    else
      warn "UFW rules kept"
    fi
  else
    echo -e "  ${DIM}No UFW rules found for ports 80/443${NC}"
  fi
  # Also remove port-blocking deny rule for the app port
  APP_PORT="3000"
  if [ -f "$INSTALL_DIR/.env" ]; then
    APP_PORT="$(grep -E '^PORT=' "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "3000")"
  fi
  sudo ufw delete deny in on any to any port "$APP_PORT" proto tcp 2>/dev/null || true
  sudo ufw delete allow in on lo to any port "$APP_PORT" proto tcp 2>/dev/null || true
else
  echo -e "  ${DIM}UFW not present or no sudo${NC}"
fi

# ─── Remove sudoers entry ────────────────────────────────────────────────
SUDOERS_FILE="/etc/sudoers.d/claude-bot"
if [ -f "$SUDOERS_FILE" ] && has_sudo; then
  echo "  Removing sudoers entry..."
  sudo rm -f "$SUDOERS_FILE"
  info "sudoers entry removed"
else
  echo -e "  ${DIM}No sudoers entry found${NC}"
fi

# ─── Remove setup-domain.sh from system bin ───────────────────────────────
SETUP_DOMAIN_BIN="/usr/local/bin/setup-domain.sh"
if [ -f "$SETUP_DOMAIN_BIN" ] && has_sudo; then
  echo "  Removing $SETUP_DOMAIN_BIN..."
  sudo rm -f "$SETUP_DOMAIN_BIN"
  info "setup-domain.sh removed from system"
else
  echo -e "  ${DIM}No system setup-domain.sh found${NC}"
fi

# ─── Remove Cloudflare tunnel config ─────────────────────────────────────
CF_CONFIG_DIR="$HOME/.cloudflared"
CF_REMOVED=false
if [ -d "$CF_CONFIG_DIR" ]; then
  for cfg in "$CF_CONFIG_DIR"/config-claude-bot*.yml; do
    [ -f "$cfg" ] || continue
    if ! $CF_REMOVED; then
      echo "  Removing Cloudflare tunnel configuration..."
    fi
    # Extract tunnel name from config to clean up
    tunnel_name=$(grep -E '^tunnel:' "$cfg" 2>/dev/null | awk '{print $2}' || true)
    if [ -n "$tunnel_name" ] && command -v cloudflared &>/dev/null; then
      cloudflared tunnel delete "$tunnel_name" 2>/dev/null || true
    fi
    rm -f "$cfg"
    # Remove credentials file if it matches
    if [ -n "$tunnel_name" ] && [ -f "$CF_CONFIG_DIR/${tunnel_name}.json" ]; then
      rm -f "$CF_CONFIG_DIR/${tunnel_name}.json"
    fi
    CF_REMOVED=true
  done
fi

if $CF_REMOVED; then
  info "Cloudflare tunnel configuration removed"
else
  echo -e "  ${DIM}No Cloudflare tunnel configuration found${NC}"
fi

# ─── Handle data directory ────────────────────────────────────────────────
DATA_PATH="$INSTALL_DIR/data"
KEEP_DATA_EFFECTIVELY=false
if [ -d "$DATA_PATH" ]; then
  if $KEEP_DATA; then
    warn "Keeping data directory: $DATA_PATH"
    KEEP_DATA_EFFECTIVELY=true
  elif confirm "Remove data directory? (database, sessions, uploads)" "n"; then
    echo "  Removing data directory..."
    rm -rf "$DATA_PATH"
    info "Data directory removed"
  else
    warn "Keeping data directory: $DATA_PATH"
    KEEP_DATA_EFFECTIVELY=true
  fi
else
  echo -e "  ${DIM}No data directory found${NC}"
fi

# ─── Remove install directory ─────────────────────────────────────────────
echo ""
if confirm "Remove the entire install directory ($INSTALL_DIR)?" "n"; then
  if [ -z "$INSTALL_DIR" ] || [ "$INSTALL_DIR" = "/" ] || [ "$INSTALL_DIR" = "$HOME" ]; then
    error "Refusing to delete '$INSTALL_DIR' — safety check failed"
    exit 1
  fi
  if $KEEP_DATA_EFFECTIVELY && [ -d "$DATA_PATH" ]; then
    # Move data out before removing the install dir
    local_data_backup="$(dirname "$INSTALL_DIR")/claude-server-bot-data-backup-$(date +%Y%m%d-%H%M%S)"
    echo "  Moving data to $local_data_backup before removing install dir..."
    mv "$DATA_PATH" "$local_data_backup"
    warn "Data preserved at: $local_data_backup"
  fi
  echo "  Removing install directory..."
  # If we're inside the directory, move out first
  if [[ "$(pwd)" == "$INSTALL_DIR"* ]]; then
    cd /
  fi
  rm -rf "$INSTALL_DIR"
  info "Install directory removed"
else
  warn "Install directory kept: $INSTALL_DIR"
  echo -e "  ${DIM}You can remove it manually with: rm -rf ${INSTALL_DIR}${NC}"
fi

# ─── Done ─────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}Uninstall complete.${NC}"
echo ""

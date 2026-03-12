#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
#  Claude Server Bot — Installer
#  Usage: curl -fsSL https://bitbucket.org/e-space-main/claude-server-bot/raw/main/install.sh | bash
# ─────────────────────────────────────────────────────────────────────────────

REPO_URL="git@bitbucket.org:e-space-main/claude-server-bot.git"
INSTALL_DIR="$HOME/claude-server-bot"
SERVICE_NAME="claude-bot"
DEFAULT_PORT=3000

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${GREEN}✓${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
error()   { echo -e "  ${RED}✗${NC} $*"; }
step()    { echo -e "\n${BOLD}${CYAN}$*${NC}"; }
divider() { echo -e "${CYAN}══════════════════════════════════════════════════${NC}"; }

divider
echo -e "${BOLD}       Claude Server Bot — Installer${NC}"
divider
echo ""

# ─── [1/8] Prerequisites ───────────────────────────────────────────────────
step "[1/8] Checking prerequisites..."

# Node.js
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install Node.js 18+ first: https://nodejs.org"
  exit 1
fi
NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  error "Node.js 18+ required (found v$(node --version))"
  exit 1
fi
info "Node $(node --version) found"

# pnpm
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found → Installing pnpm..."
  npm install -g pnpm --silent
  info "pnpm installed"
else
  info "pnpm $(pnpm --version) found"
fi

# git
if ! command -v git &>/dev/null; then
  error "git not found. Install git first."
  exit 1
fi
info "git found"

# openssl (for slug generation)
if ! command -v openssl &>/dev/null; then
  error "openssl not found."
  exit 1
fi
info "openssl found"

# ─── [2/8] Clone repo ──────────────────────────────────────────────────────
step "[2/8] Cloning Claude Server Bot..."

if [ -d "$INSTALL_DIR" ]; then
  warn "Directory $INSTALL_DIR already exists."
  read -r -p "  Overwrite? [y/N]: " OVERWRITE
  if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
    echo "  Aborted."
    exit 0
  fi
  rm -rf "$INSTALL_DIR"
fi

git clone "$REPO_URL" "$INSTALL_DIR" --quiet
info "Cloned into $INSTALL_DIR"
cd "$INSTALL_DIR"

# ─── [3/8] Claude CLI ──────────────────────────────────────────────────────
step "[3/8] Checking Claude CLI..."

CLAUDE_BIN=""
for candidate in \
    "$HOME/.local/bin/claude" \
    "$HOME/.npm-global/bin/claude" \
    "/usr/local/bin/claude" \
    "$(command -v claude 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    CLAUDE_BIN="$candidate"
    break
  fi
done

if [ -z "$CLAUDE_BIN" ]; then
  warn "Claude CLI not found."
  echo "  Install it first: npm install -g @anthropic-ai/claude-code"
  echo "  Then re-run this installer."
  CLAUDE_BIN="claude"
else
  info "Found at $CLAUDE_BIN"
fi

echo ""
read -r -p "  Do you need to authenticate Claude Code now? [y/N]: " DO_AUTH
if [[ "$DO_AUTH" =~ ^[Yy]$ ]]; then
  echo ""
  echo -e "  ${YELLOW}Open a NEW terminal and run:${NC}  $CLAUDE_BIN"
  echo "  Complete the browser login, then return here and press Enter."
  read -r -p "  (Press Enter when done) "
fi

# ─── [4/8] Account setup ───────────────────────────────────────────────────
step "[4/8] Account setup..."

read -r -p "  Admin email: " ADMIN_EMAIL
if [ -z "$ADMIN_EMAIL" ]; then
  error "Email is required."
  exit 1
fi

info "Password will be auto-generated and shown at the end"

# Generate password (80–126 chars)
ADMIN_PASSWORD=$(node -e "
const len = Math.floor(Math.random() * 47) + 80;
process.stdout.write(require('crypto').randomBytes(96).toString('base64').slice(0, len));
")

# ─── [5/8] Project configuration ───────────────────────────────────────────
step "[5/8] Project configuration..."

DEFAULT_PROJECT="$HOME"
read -r -p "  Project directory for Claude to work in [$DEFAULT_PROJECT]: " PROJECT_ROOT
PROJECT_ROOT="${PROJECT_ROOT:-$DEFAULT_PROJECT}"

if [ ! -d "$PROJECT_ROOT" ]; then
  error "Directory '$PROJECT_ROOT' does not exist."
  exit 1
fi
info "Directory exists"

if [ -f "$PROJECT_ROOT/CLAUDE.md" ]; then
  info "CLAUDE.md found — project already initialized"
else
  warn "CLAUDE.md not found — you can run /init from the chat after setup"
fi

# ─── [6/8] Web server setup ────────────────────────────────────────────────
step "[6/8] Web server setup..."

PORT=$DEFAULT_PORT
DOMAIN=""
USE_HTTPS=false
SETUP_NGINX=false
CERTBOT_EMAIL=""
SETUP_UFW=false
BASE_URL=""

read -r -p "  Do you have a domain name? [y/N]: " HAS_DOMAIN
if [[ "$HAS_DOMAIN" =~ ^[Yy]$ ]]; then
  read -r -p "  Domain: " DOMAIN

  read -r -p "  Set up nginx reverse proxy? [Y/n]: " DO_NGINX
  if [[ ! "$DO_NGINX" =~ ^[Nn]$ ]]; then
    SETUP_NGINX=true

    if command -v nginx &>/dev/null; then
      info "nginx already installed"
    else
      echo "  Installing nginx..."
      sudo apt-get update -qq && sudo apt-get install -y nginx -qq
      info "nginx installed"
    fi

    read -r -p "  Set up HTTPS with Let's Encrypt? [Y/n]: " DO_CERTBOT
    if [[ ! "$DO_CERTBOT" =~ ^[Nn]$ ]]; then
      USE_HTTPS=true
      read -r -p "  Email for renewal notices: " CERTBOT_EMAIL
      CERTBOT_EMAIL="${CERTBOT_EMAIL:-$ADMIN_EMAIL}"

      if ! command -v certbot &>/dev/null; then
        echo "  Installing certbot..."
        sudo apt-get install -y certbot python3-certbot-nginx -qq
        info "certbot installed"
      fi
    fi

    read -r -p "  Enable UFW firewall (ports 80, 443)? [Y/n]: " DO_UFW
    if [[ ! "$DO_UFW" =~ ^[Nn]$ ]]; then
      SETUP_UFW=true
    fi
  fi
fi

if $USE_HTTPS; then
  BASE_URL="https://$DOMAIN"
elif [ -n "$DOMAIN" ]; then
  BASE_URL="http://$DOMAIN"
else
  SERVER_IP=$(hostname -I | awk '{print $1}')
  BASE_URL="http://$SERVER_IP:$PORT"
fi

# ─── Generate slug and secrets ─────────────────────────────────────────────
SLUG=$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c12)
NEXTAUTH_SECRET=$(openssl rand -base64 32)

# ─── [7/8] Build ───────────────────────────────────────────────────────────
step "[7/8] Building..."

# Write .env before build (slug must be baked in)
cat > "$INSTALL_DIR/.env" <<EOF
PORT=$PORT
NEXTAUTH_URL=$BASE_URL/c/$SLUG
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
CLAUDE_BOT_SLUG=$SLUG
NEXT_PUBLIC_CLAUDE_BOT_SLUG=$SLUG
CLAUDE_BOT_ADMIN_EMAIL=$ADMIN_EMAIL
CLAUDE_BOT_ADMIN_HASH=__HASH_PLACEHOLDER__
CLAUDE_CLI_PATH=$CLAUDE_BIN
CLAUDE_PROJECT_ROOT=$PROJECT_ROOT
NEXT_PUBLIC_CLAUDE_PROJECT_ROOT=$PROJECT_ROOT
DATA_DIR=$INSTALL_DIR/data
CLAUDE_PROVIDER=subprocess
EOF

echo "  pnpm install..."
pnpm install --silent

# Hash password (bcryptjs available after install)
ADMIN_HASH=$(node -e "require('bcryptjs').hash(process.argv[1], 12).then(h => process.stdout.write(h))" "$ADMIN_PASSWORD")

# Update .env with real hash
sed -i "s|__HASH_PLACEHOLDER__|$ADMIN_HASH|" "$INSTALL_DIR/.env"
info ".env written"

echo "  pnpm build..."
CLAUDE_BOT_SLUG="$SLUG" pnpm build --silent
info "Build complete"

# ─── nginx config ──────────────────────────────────────────────────────────
if $SETUP_NGINX; then
  NGINX_CONF="/etc/nginx/sites-available/claude-bot"
  sudo tee "$NGINX_CONF" > /dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location /c/$SLUG/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}
NGINX

  sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/claude-bot
  sudo nginx -t -q
  sudo systemctl reload nginx
  info "nginx configured"

  if $USE_HTTPS; then
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect -q
    info "Let's Encrypt certificate issued"
    # Update .env with https URL
    sed -i "s|NEXTAUTH_URL=.*|NEXTAUTH_URL=https://$DOMAIN/c/$SLUG|" "$INSTALL_DIR/.env"
    BASE_URL="https://$DOMAIN"
  fi

  if $SETUP_UFW; then
    sudo ufw allow 80/tcp > /dev/null 2>&1 || true
    sudo ufw allow 443/tcp > /dev/null 2>&1 || true
    info "UFW rules added"
  fi
fi

# ─── [8/8] Systemd service ─────────────────────────────────────────────────
step "[8/8] Starting service..."

# Sudoers entry for service restart (needed for Settings panel project change)
SUDOERS_FILE="/etc/sudoers.d/claude-bot"
echo "$USER ALL=(ALL) NOPASSWD: /bin/systemctl restart ${SERVICE_NAME}.service" | sudo tee "$SUDOERS_FILE" > /dev/null
sudo chmod 0440 "$SUDOERS_FILE"

PNPM_BIN=$(command -v pnpm)
NODE_BIN=$(command -v node)

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<SERVICE
[Unit]
Description=Claude Server Bot
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$PNPM_BIN start
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$(dirname "$NODE_BIN")

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}.service" --quiet
sudo systemctl start "${SERVICE_NAME}.service"

# Wait up to 10s for service to come up
for i in $(seq 1 10); do
  if sudo systemctl is-active --quiet "${SERVICE_NAME}.service"; then
    break
  fi
  sleep 1
done

if sudo systemctl is-active --quiet "${SERVICE_NAME}.service"; then
  info "${SERVICE_NAME}.service started"
else
  warn "Service may not have started. Check: sudo journalctl -u ${SERVICE_NAME}.service -n 30"
fi

# ─── Done ──────────────────────────────────────────────────────────────────
echo ""
divider
echo -e "${BOLD}  ✓ Claude Server Bot is live!${NC}"
echo ""
echo -e "  ${BOLD}URL:${NC}      $BASE_URL/c/$SLUG"
echo -e "  ${BOLD}Email:${NC}    $ADMIN_EMAIL"
echo -e "  ${BOLD}Password:${NC} $ADMIN_PASSWORD"
echo ""
echo -e "  ${YELLOW}!! Save these credentials — password shown once only !!${NC}"
echo ""
echo -e "  To update later:"
echo "    cd $INSTALL_DIR"
echo "    ./update.sh"
divider
echo ""

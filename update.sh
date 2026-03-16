#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ─────────────────────────────────────────────────────────────────────────────
#  Claude Server Bot — Updater with Rollback Support
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()  { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
error() { echo -e "  ${RED}✗${NC} $*"; }

SERVICE_NAME="claude-bot"
# shellcheck disable=SC2034
INSTALL_DIR="$(pwd)"
BACKUP_DIR=""
OLD_SHA=""
ROLLBACK_NEEDED=false
YES=false

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=true ;;
    --help|-h)
      echo "Usage: $0 [--yes]"
      echo "  --yes   Skip confirmation prompts (non-interactive)"
      exit 0
      ;;
  esac
done

# ─── Cleanup on failure ───────────────────────────────────────────────────
cleanup() {
  if $ROLLBACK_NEEDED && [ -n "$OLD_SHA" ]; then
    echo ""
    error "Update failed! Rolling back..."
    rollback
  fi
  # Clean up backup
  if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    rm -rf "$BACKUP_DIR"
  fi
  # Release update lock
  rmdir "${UPDATE_LOCKDIR:-/tmp/claude-bot-update.lock}" 2>/dev/null || true
}
trap cleanup EXIT

# ─── Rollback function ────────────────────────────────────────────────────
rollback() {
  echo "  Restoring previous version ($OLD_SHA)..."

  # Restore .next build
  if [ -d "$BACKUP_DIR/.next" ]; then
    rm -rf .next
    cp -r "$BACKUP_DIR/.next" .next
    info "Build restored from backup"
  fi

  # Restore certs
  if [ -d "$BACKUP_DIR/certs" ]; then
    rm -rf certs
    cp -r "$BACKUP_DIR/certs" certs
    info "Certs restored from backup"
  fi

  # Restore node_modules state
  if [ -f "$BACKUP_DIR/pnpm-lock.yaml" ]; then
    cp "$BACKUP_DIR/pnpm-lock.yaml" pnpm-lock.yaml
    pnpm install --reporter=silent 2>/dev/null || true
  fi

  # Preserve any uncommitted changes before resetting
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    git stash 2>/dev/null && warn "Uncommitted changes have been stashed (recover with: git stash pop)"
  fi

  # Reset git to old commit
  git checkout "$OLD_SHA" -- . 2>/dev/null || git reset --hard "$OLD_SHA" 2>/dev/null || true
  info "Code restored to $OLD_SHA"

  # Restart service
  restart_service
  info "Rollback complete. Running previous version."
  ROLLBACK_NEEDED=false
}

# ─── Service management ───────────────────────────────────────────────────
restart_service() {
  if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
    echo "  Restarting systemd service..."
    sudo systemctl restart "${SERVICE_NAME}.service"
    info "Service restarted"
  elif [ -f "$HOME/Library/LaunchAgents/com.claude-server-bot.plist" ]; then
    echo "  Restarting launchd service..."
    launchctl stop com.claude-server-bot 2>/dev/null || true
    launchctl start com.claude-server-bot 2>/dev/null || true
    info "Service restarted"
  fi
}

# ─── Health check ──────────────────────────────────────────────────────────
health_check() {
  local port slug prefix health_url scheme curl_flags
  port=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo "3000")
  slug=$(grep -E '^CLAUDE_BOT_SLUG=' .env 2>/dev/null | cut -d= -f2 || echo "")
  prefix=$(grep -E '^CLAUDE_BOT_PATH_PREFIX=' .env 2>/dev/null | cut -d= -f2 || echo "c")

  scheme="http"
  curl_flags="-s -o /dev/null -w %{http_code}"
  if grep -qE '^SSL_CERT_PATH=.+' .env 2>/dev/null && grep -qE '^SSL_KEY_PATH=.+' .env 2>/dev/null; then
    scheme="https"
    curl_flags="-sk -o /dev/null -w %{http_code}"
  fi

  if [ -n "$slug" ]; then
    health_url="${scheme}://localhost:${port}/${prefix}/${slug}/api/health/ping"
  else
    health_url="${scheme}://localhost:${port}/api/health/ping"
  fi

  echo "  Running health check..."
  sleep 3

  for attempt in $(seq 1 12); do
    echo -e "  ${DIM}Attempt ${attempt}/12...${NC}"
    local http_code
    http_code=$(curl $curl_flags "$health_url" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# ─── Migrate .env — add missing keys from .env.example ──────────────────
migrate_env() {
  local env_file=".env"
  local example_file=".env.example"

  if { [ ! -f "$example_file" ] || [ ! -f "$env_file" ]; }; then
    return
  fi

  local added=0
  local deprecated=0

  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    local key="${line%%=*}"
    if ! grep -q "^${key}=" "$env_file" 2>/dev/null; then
      echo "$line" >> "$env_file"
      added=$((added + 1))
      echo -e "  ${DIM}  Added missing env var: $key${NC}"
    fi
  done < "$example_file"

  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    local key="${line%%=*}"
    if ! grep -q "^${key}=" "$example_file" 2>/dev/null; then
      deprecated=$((deprecated + 1))
      warn "Env var $key is not in .env.example — may be deprecated"
    fi
  done < "$env_file"

  if [ "$added" -gt 0 ]; then
    info "Added $added new env var(s) from .env.example"
  fi
  if [ "$deprecated" -gt 0 ]; then
    warn "$deprecated env var(s) not in .env.example (possibly deprecated)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════
# Acquire update lock (atomic via mkdir)
UPDATE_LOCKDIR="/tmp/claude-bot-update.lock"
if ! mkdir "$UPDATE_LOCKDIR" 2>/dev/null; then
  echo ""
  error "Another update is in progress (lock: $UPDATE_LOCKDIR)"
  echo "  If no update is running, remove the lock: rmdir $UPDATE_LOCKDIR"
  exit 1
fi

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}       Claude Server Bot — Updater${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo ""

# Check node/pnpm are available
if ! command -v node &>/dev/null; then
  error "Node.js not found — cannot update. Install Node.js 20+ and retry."
  exit 1
else
  node_major=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
  if [ "${node_major:-0}" -lt 20 ]; then
    warn "Node.js $(node --version) detected — version 20+ is recommended."
  fi
fi
if ! command -v pnpm &>/dev/null; then
  error "pnpm not found — cannot update. Install pnpm and retry."
  exit 1
fi

# Save current state for rollback
OLD_SHA=$(git rev-parse HEAD)
info "Current version: ${OLD_SHA:0:8}"

# Create build backup (for rollback)
BACKUP_DIR="$(mktemp -d)"
echo "  Creating build backup..."
[ -d .next ] && cp -r .next "$BACKUP_DIR/.next"
[ -f pnpm-lock.yaml ] && cp pnpm-lock.yaml "$BACKUP_DIR/pnpm-lock.yaml"
[ -d certs ] && cp -r certs "$BACKUP_DIR/certs"
info "Build backup created at $BACKUP_DIR"

# Back up SQLite database before update (keep last 3 upgrade backups)
DATA_DIR_RESOLVED=$(grep -E '^DATA_DIR=' .env 2>/dev/null | cut -d= -f2 || echo "./data")
: "${DATA_DIR_RESOLVED:=./data}"
DB_FILE="${DATA_DIR_RESOLVED}/claude-bot.db"
if [ -f "$DB_FILE" ]; then
  DB_BACKUP_DIR="${DATA_DIR_RESOLVED}/backups/upgrade"
  mkdir -p "$DB_BACKUP_DIR"
  DB_BACKUP_NAME="claude-bot-$(date +%Y%m%d-%H%M%S).db"
  cp "$DB_FILE" "${DB_BACKUP_DIR}/${DB_BACKUP_NAME}"
  # Also copy WAL if present
  [ -f "${DB_FILE}-wal" ] && cp "${DB_FILE}-wal" "${DB_BACKUP_DIR}/${DB_BACKUP_NAME}-wal"
  info "Database backed up to backups/upgrade/${DB_BACKUP_NAME}"
  # Rotate: keep only the 3 most recent backups
  # shellcheck disable=SC2012
  ls -1t "${DB_BACKUP_DIR}"/claude-bot-*.db 2>/dev/null | tail -n +4 | while read -r old_backup; do
    rm -f "$old_backup" "${old_backup}-wal"
  done
else
  warn "No database file found at ${DB_FILE} — skipping DB backup"
fi

# Mark that rollback is now possible
ROLLBACK_NEEDED=true

# Detect branch and remote
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
REMOTE=$(git config "branch.${BRANCH}.remote" 2>/dev/null || echo "origin")

# Check disk space (warn if < 1GB free)
AVAIL_KB=$(df -k . | awk 'NR==2 {print $4}')
if [ "${AVAIL_KB:-0}" -lt 1048576 ]; then
  warn "Low disk space: $(( AVAIL_KB / 1024 )) MB available (recommended: 1 GB)"
  if $YES; then
    warn "Continuing anyway (--yes flag set)."
  else
    read -r -p "  Continue anyway? [y/N]: " REPLY
    if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
      echo "  Aborted."
      ROLLBACK_NEEDED=false
      exit 0
    fi
  fi
fi

# Pull latest
echo ""
echo "  Pulling latest changes..."
git fetch "$REMOTE" 2>/dev/null
NEW_SHA=$(git rev-parse "${REMOTE}/${BRANCH}" 2>/dev/null || echo "")

if [ "$OLD_SHA" = "$NEW_SHA" ] && [ -n "$NEW_SHA" ]; then
  info "Already up to date!"
  ROLLBACK_NEEDED=false
  exit 0
fi

git pull --ff-only || {
  error "git pull failed. You may have local changes."
  echo "  Try: git stash && ./update.sh"
  ROLLBACK_NEEDED=false
  exit 1
}

NEW_SHA=$(git rev-parse HEAD)
info "Updated to: ${NEW_SHA:0:8}"

# Show changelog
echo ""
echo -e "  ${BOLD}Changes:${NC}"
git log --oneline "${OLD_SHA}..${NEW_SHA}" | head -20 | while read -r line; do
  echo "    $line"
done
echo ""

# Migrate env vars
migrate_env

# Install dependencies
echo "  Installing dependencies..."
pnpm install --frozen-lockfile --reporter=silent 2>/dev/null || pnpm install --reporter=silent
info "Dependencies updated"

# Build
echo "  Building..."
if [ -f .env ]; then
  CLAUDE_BOT_SLUG="$(grep -E '^CLAUDE_BOT_SLUG=' .env | head -1 | cut -d= -f2-)"
  CLAUDE_BOT_PATH_PREFIX="$(grep -E '^CLAUDE_BOT_PATH_PREFIX=' .env | head -1 | cut -d= -f2-)"
  export CLAUDE_BOT_SLUG CLAUDE_BOT_PATH_PREFIX
fi
BUILD_LOG="$(mktemp)"
if ! pnpm build > "$BUILD_LOG" 2>&1; then
  error "Build failed! Last 50 lines:"
  tail -50 "$BUILD_LOG"
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"
info "Build complete"

# Restart service
restart_service

# Health check
if health_check; then
  info "Health check passed!"
  ROLLBACK_NEEDED=false
  echo ""
  echo -e "  ${GREEN}${BOLD}Update successful!${NC} (${OLD_SHA:0:8} → ${NEW_SHA:0:8})"
  echo ""
else
  error "Health check failed after update!"
  echo "  Initiating automatic rollback..."
  # rollback() will be called by the trap since ROLLBACK_NEEDED=true
  exit 1
fi

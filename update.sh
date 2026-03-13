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

  # Restore node_modules state
  if [ -f "$BACKUP_DIR/pnpm-lock.yaml" ]; then
    cp "$BACKUP_DIR/pnpm-lock.yaml" pnpm-lock.yaml
    pnpm install --reporter=silent 2>/dev/null || true
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
  local port slug prefix health_url
  port=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo "3000")
  slug=$(grep -E '^CLAUDE_BOT_SLUG=' .env 2>/dev/null | cut -d= -f2 || echo "")
  prefix=$(grep -E '^CLAUDE_BOT_PATH_PREFIX=' .env 2>/dev/null | cut -d= -f2 || echo "c")

  if [ -n "$slug" ]; then
    health_url="http://localhost:${port}/${prefix}/${slug}/api/health/ping"
  else
    health_url="http://localhost:${port}/api/health/ping"
  fi

  echo "  Running health check..."
  sleep 3

  for attempt in $(seq 1 5); do
    echo -e "  ${DIM}Attempt ${attempt}/5...${NC}"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "$health_url" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# ─── Migrate .env — add missing keys from .env.example ──────────────────
migrate_env() {
  local env_file=".env"
  local example_file=".env.example"

  if [ ! -f "$example_file" ] || [ ! -f "$env_file" ]; then
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
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}       Claude Server Bot — Updater${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo ""

# Save current state for rollback
OLD_SHA=$(git rev-parse HEAD)
info "Current version: ${OLD_SHA:0:8}"

# Create backup
BACKUP_DIR="$(mktemp -d)"
echo "  Creating backup..."
[ -d .next ] && cp -r .next "$BACKUP_DIR/.next"
[ -f pnpm-lock.yaml ] && cp pnpm-lock.yaml "$BACKUP_DIR/pnpm-lock.yaml"
info "Backup created at $BACKUP_DIR"

# Mark that rollback is now possible
ROLLBACK_NEEDED=true

# Detect branch and remote
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
REMOTE=$(git config "branch.${BRANCH}.remote" 2>/dev/null || echo "origin")

# Check disk space (warn if < 1GB free)
AVAIL_KB=$(df -k . | awk 'NR==2 {print $4}')
if [ "${AVAIL_KB:-0}" -lt 1048576 ]; then
  warn "Low disk space: $(( AVAIL_KB / 1024 )) MB available (recommended: 1 GB)"
  read -r -p "  Continue anyway? [y/N]: " REPLY
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    echo "  Aborted."
    ROLLBACK_NEEDED=false
    exit 0
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
pnpm install --frozen-lockfile --reporter=silent 2>/dev/null
info "Dependencies updated"

# Build
echo "  Building..."
if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^CLAUDE_BOT_SLUG=|^CLAUDE_BOT_PATH_PREFIX=' .env | xargs)
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

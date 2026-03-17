#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ─────────────────────────────────────────────────────────────────────────────
#  Octoby AI — Updater with Rollback Support
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()  { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
error() { echo -e "  ${RED}✗${NC} $*"; }
qinfo() { $QUIET || echo -e "  ${GREEN}✓${NC} $*"; }

SERVICE_NAME="claude-bot"
# shellcheck disable=SC2034
INSTALL_DIR="$(pwd)"
BACKUP_DIR=""
OLD_SHA=""
ROLLBACK_NEEDED=false
YES=false
QUIET=false
SERVICE_MANAGED=false
STASH_APPLIED=false

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --yes|-y)   YES=true ;;
    --quiet|-q) QUIET=true ;;
    --help|-h)
      echo "Usage: $0 [--yes] [--quiet]"
      echo "  --yes    Skip confirmation prompts (non-interactive)"
      echo "  --quiet  Suppress non-essential output (useful for CI/cron)"
      exit 0
      ;;
  esac
done

# ─── Cleanup on failure ───────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  if $ROLLBACK_NEEDED && [ -n "$OLD_SHA" ]; then
    echo ""
    error "Update failed! Rolling back..."
    rollback
  fi
  # Clean up backup dir
  if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    rm -rf "$BACKUP_DIR"
  fi
  # Release update lock
  rmdir "${UPDATE_LOCKDIR:-/tmp/claude-bot-update.lock}" 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ─── Rollback function ────────────────────────────────────────────────────
rollback() {
  echo "  Restoring previous version ($OLD_SHA)..."

  # 1. Reset git FIRST so it doesn't clobber artifacts restored in step 2
  # Stash any uncommitted changes introduced by the partial update
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    git stash 2>/dev/null && warn "Uncommitted changes stashed (recover with: git stash pop)"
  fi
  git checkout "$OLD_SHA" -- . 2>/dev/null || git reset --hard "$OLD_SHA" 2>/dev/null || true
  info "Code restored to $OLD_SHA"

  # 2. Overlay backup artifacts on top of the restored source
  if [ -d "$BACKUP_DIR/.next" ]; then
    rm -rf .next
    mv "$BACKUP_DIR/.next" .next
    info "Build restored from backup"
  fi

  if [ -d "$BACKUP_DIR/certs" ]; then
    rm -rf certs
    mv "$BACKUP_DIR/certs" certs
    info "Certs restored from backup"
  fi

  # 3. Restore lockfile and reinstall deps
  if [ -f "$BACKUP_DIR/pnpm-lock.yaml" ]; then
    cp "$BACKUP_DIR/pnpm-lock.yaml" pnpm-lock.yaml
    pnpm install --reporter=silent 2>/dev/null || true
  fi

  # Restart service (best-effort)
  restart_service

  info "Rollback complete. Running previous version."
  ROLLBACK_NEEDED=false
}

# ─── Service management ───────────────────────────────────────────────────
# Sets SERVICE_MANAGED=true when a recognised service manager owns the process.
detect_service_manager() {
  if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
    SERVICE_MANAGED=true
  elif [ -f "$HOME/Library/LaunchAgents/com.claude-server-bot.plist" ]; then
    SERVICE_MANAGED=true
  fi
}

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
  else
    warn "No managed service detected — restart the process manually."
  fi
}

# ─── Health check ──────────────────────────────────────────────────────────
health_check() {
  local port slug prefix health_url scheme
  local -a curl_flags
  port=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo "3000")
  slug=$(grep -E '^CLAUDE_BOT_SLUG=' .env 2>/dev/null | cut -d= -f2 || echo "")
  prefix=$(grep -E '^CLAUDE_BOT_PATH_PREFIX=' .env 2>/dev/null | cut -d= -f2 || echo "c")

  scheme="http"
  curl_flags=(-s -o /dev/null -w '%{http_code}')
  if grep -qE '^SSL_CERT_PATH=.+' .env 2>/dev/null && grep -qE '^SSL_KEY_PATH=.+' .env 2>/dev/null; then
    scheme="https"
    curl_flags=(-sk -o /dev/null -w '%{http_code}')
  fi

  if [ -n "$slug" ]; then
    health_url="${scheme}://localhost:${port}/${prefix}/${slug}/api/health/ping"
  else
    health_url="${scheme}://localhost:${port}/api/health/ping"
  fi

  echo "  Running health check ($health_url)..."
  sleep 3

  local attempt http_code
  for attempt in $(seq 1 12); do
    $QUIET || echo -e "  ${DIM}Attempt ${attempt}/12...${NC}"
    http_code=$(curl "${curl_flags[@]}" "$health_url" 2>/dev/null || echo "000")
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
      $QUIET || echo -e "  ${DIM}  Added missing env var: $key${NC}"
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

$QUIET || echo ""
$QUIET || echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
$QUIET || echo -e "${BOLD}       Octoby AI — Updater${NC}"
$QUIET || echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
$QUIET || echo ""

# Check required tools
if ! command -v git &>/dev/null; then
  error "git not found — cannot update. Install git and retry."
  exit 1
fi
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

# Detect service manager early (used later to decide whether to run health check)
detect_service_manager

# Save current state for rollback
OLD_SHA=$(git rev-parse HEAD)
info "Current version: ${OLD_SHA:0:8}"

# Create build backup (for rollback)
# Use mv for .next (instant, same FS) — pnpm build will recreate it.
BACKUP_DIR="$(mktemp -d)"
$QUIET || echo "  Creating build backup..."
[ -d .next ] && mv .next "$BACKUP_DIR/.next"
[ -f pnpm-lock.yaml ] && cp pnpm-lock.yaml "$BACKUP_DIR/pnpm-lock.yaml"
[ -d certs ] && cp -r certs "$BACKUP_DIR/certs"
qinfo "Build backup created"

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

# Check disk space (warn if < 1GB free); -Pk guarantees single-line output
AVAIL_KB=$(df -Pk . | awk 'NR==2 {print $4}')
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
$QUIET || echo ""
$QUIET || echo "  Pulling latest changes..."

git fetch "$REMOTE" 2>/dev/null
NEW_SHA=$(git rev-parse "${REMOTE}/${BRANCH}" 2>/dev/null || echo "")

if [ "$OLD_SHA" = "$NEW_SHA" ] && [ -n "$NEW_SHA" ]; then
  info "Already up to date!"
  ROLLBACK_NEEDED=false
  exit 0
fi

# Auto-stash dirty working tree so --ff-only doesn't fail on local changes
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  warn "Local changes detected — stashing before pull..."
  git stash push -m "update.sh auto-stash $(date +%Y%m%d-%H%M%S)" 2>/dev/null
  STASH_APPLIED=true
fi

git pull --ff-only || {
  error "git pull --ff-only failed. Branch may have diverged."
  echo "  Check: git status && git log --oneline ${REMOTE}/${BRANCH}"
  ROLLBACK_NEEDED=false
  exit 1
}

# Restore stash if we applied one
if $STASH_APPLIED; then
  git stash pop 2>/dev/null && info "Auto-stash restored" || warn "Could not restore stash automatically — run: git stash pop"
  STASH_APPLIED=false
fi

NEW_SHA=$(git rev-parse HEAD)
info "Updated to: ${NEW_SHA:0:8}"

# Show changelog
if ! $QUIET; then
  echo ""
  echo -e "  ${BOLD}Changes:${NC}"
  git log --oneline "${OLD_SHA}..${NEW_SHA}" | head -20 | while read -r line; do
    echo "    $line"
  done
  echo ""
fi

# Migrate env vars
migrate_env

# Install dependencies
$QUIET || echo "  Installing dependencies..."
pnpm install --frozen-lockfile --reporter=silent 2>/dev/null || pnpm install --reporter=silent
info "Dependencies updated"

# Build
$QUIET || echo "  Building..."
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

# Health check — only meaningful when a service manager is managing the process.
# If unmanaged, skip and warn instead of reporting a false negative.
if $SERVICE_MANAGED; then
  if health_check; then
    info "Health check passed!"
    ROLLBACK_NEEDED=false
    $QUIET || echo ""
    echo -e "  ${GREEN}${BOLD}Update successful!${NC} (${OLD_SHA:0:8} → ${NEW_SHA:0:8})"
    $QUIET || echo ""
  else
    error "Health check failed after update!"
    echo "  Initiating automatic rollback..."
    # rollback() will be called by the trap since ROLLBACK_NEEDED=true
    exit 1
  fi
else
  warn "No managed service detected — skipping health check."
  warn "Restart the process manually, then verify: curl http://localhost:\${PORT}/api/health/ping"
  ROLLBACK_NEEDED=false
  $QUIET || echo ""
  echo -e "  ${GREEN}${BOLD}Update complete!${NC} (${OLD_SHA:0:8} → ${NEW_SHA:0:8})"
  $QUIET || echo ""
fi

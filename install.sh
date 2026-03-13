#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
#  Claude Server Bot — Interactive Installer
#
#  Usage:
#    bash install.sh                          # Interactive mode
#    bash install.sh --unattended [options]   # Non-interactive mode
#    bash install.sh --dry-run [options]      # Preview without changes
#    bash install.sh --config install.conf    # Load from config file
#
#  Do NOT pipe directly to bash (curl | bash) — interactive prompts need stdin.
# ─────────────────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/JckHamm3r/Claude-Server-Bot.git"
REPO_BRANCH="main"
SERVICE_NAME="claude-bot"
DEFAULT_PORT=3000
SCRIPT_VERSION="2.0.0"

# ─── Collected configuration (set by step functions) ────────────────────────
BOT_NAME=""
DEPLOY_MODE=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
PROJECT_ROOT=""
INSTALL_DIR=""
PORT="$DEFAULT_PORT"
DOMAIN=""
USE_HTTPS=false
HTTPS_METHOD=""   # "letsencrypt" or "cloudflare"
SETUP_NGINX=false
CERTBOT_EMAIL=""
SETUP_UFW=false
BASE_URL=""
SLUG=""
BOT_PATH_PREFIX=""
NEXTAUTH_SECRET=""
CLAUDE_BIN=""
SETUP_SERVICE=false
SETUP_CF_TUNNEL=false

# ─── Platform detection results ────────────────────────────────────────────
PLATFORM=""        # linux, macos, wsl
PKG_MGR=""
PKG_INSTALL=""
PKG_UPDATE=""

# ─── Cleanup / rollback state ─────────────────────────────────────────────
INSTALL_IN_PROGRESS=false
CLONE_DONE=false
SERVICE_CREATED=false

# ─── Unattended mode flags ─────────────────────────────────────────────────
UNATTENDED=false
DRY_RUN=false
VERBOSE=false
CONFIG_FILE=""
# CLI overrides
CLI_MODE="" CLI_BOT_NAME="" CLI_EMAIL="" CLI_DOMAIN="" CLI_HTTPS=""
CLI_PROJECT_ROOT="" CLI_PORT="" CLI_INSTALL_DIR="" CLI_PASSWORD=""

# ─── Step navigation ───────────────────────────────────────────────────────
CURRENT_STEP=1
NEXT_STEP=0
MAX_COLLECTION_STEP=7   # Steps 1-7 are navigable; 8+ are execution
TOTAL_STEPS=11

# ─── Colors & helpers ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; MAGENTA='\033[0;35m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

info()    { echo -e "  ${GREEN}✓${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
error()   { echo -e "  ${RED}✗${NC} $*"; }
hint()    { echo -e "  ${DIM}$*${NC}"; }
step()    { echo -e "\n${BOLD}${CYAN}$*${NC}"; }
divider() { echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"; }

# Prompt with back navigation support. Sets REPLY.
# Usage: prompt_input "Question" [default]
# Returns 1 if user wants to go back.
prompt_input() {
  local question="$1"
  local default="${2:-}"
  if $UNATTENDED; then
    REPLY="$default"
    return 0
  fi
  local suffix=""
  if [ -n "$default" ]; then
    suffix=" [$default]"
  fi
  if [ "$CURRENT_STEP" -gt 1 ] && [ "$CURRENT_STEP" -le "$MAX_COLLECTION_STEP" ]; then
    hint "Type 'b' to go back"
  fi
  read -r -p "  ${question}${suffix}: " REPLY
  if [[ "$REPLY" == "b" || "$REPLY" == "B" ]] && [ "$CURRENT_STEP" -gt 1 ] && [ "$CURRENT_STEP" -le "$MAX_COLLECTION_STEP" ]; then
    NEXT_STEP=$((CURRENT_STEP - 1))
    return 1
  fi
  REPLY="${REPLY:-$default}"
  return 0
}

# Yes/No prompt with back support. Returns 0=yes, 1=no, 2=back.
prompt_yn() {
  local question="$1"
  local default="${2:-n}"  # y or n
  if $UNATTENDED; then
    [[ "$default" == "y" ]] && return 0 || return 1
  fi
  local hint_text=""
  if [[ "$default" == "y" ]]; then
    hint_text="[Y/n]"
  else
    hint_text="[y/N]"
  fi
  if [ "$CURRENT_STEP" -gt 1 ] && [ "$CURRENT_STEP" -le "$MAX_COLLECTION_STEP" ]; then
    hint "Type 'b' to go back"
  fi
  read -r -p "  ${question} ${hint_text}: " REPLY
  if [[ "$REPLY" == "b" || "$REPLY" == "B" ]] && [ "$CURRENT_STEP" -gt 1 ] && [ "$CURRENT_STEP" -le "$MAX_COLLECTION_STEP" ]; then
    NEXT_STEP=$((CURRENT_STEP - 1))
    return 2
  fi
  if [[ "$default" == "y" ]]; then
    [[ ! "$REPLY" =~ ^[Nn]$ ]] && return 0 || return 1
  else
    [[ "$REPLY" =~ ^[Yy]$ ]] && return 0 || return 1
  fi
}

# ─── Mascot ────────────────────────────────────────────────────────────────
mascot() {
  local pose="${1:-greeting}"
  local name="${BOT_NAME:-Bot}"
  echo ""
  case "$pose" in
    greeting)
      echo -e "${CYAN}      ╔═══╗${NC}"
      echo -e "${CYAN}      ║ ${GREEN}◉${CYAN} ║  ${NC}${BOLD}/ Hi there! \\\\${NC}"
      echo -e "${CYAN}    ╔═╩═══╩═╗${NC}"
      echo -e "${CYAN}    ║ ${MAGENTA}█${NC}${CYAN}███${MAGENTA}█${NC}${CYAN} ║${NC}"
      echo -e "${CYAN}    ║ ╰───╯ ║${NC}"
      echo -e "${CYAN}   ╔╩═══════╩╗${NC}"
      echo -e "${CYAN}  ═╩═  ═══  ═╩═${NC}"
      echo -e "${CYAN}  ║║   ╚═╝   ║║${NC}"
      ;;
    thinking)
      echo -e "${CYAN}      ╔═══╗  ${YELLOW}?${NC}"
      echo -e "${CYAN}      ║ ${YELLOW}◑${CYAN} ║ ${YELLOW}?${NC}"
      echo -e "${CYAN}    ╔═╩═══╩═╗${NC}"
      echo -e "${CYAN}    ║ █████ ║${NC}"
      echo -e "${CYAN}    ║ ╰───╯ ║${NC}"
      echo -e "${CYAN}   ╔╩═══════╩╗${NC}"
      echo -e "${CYAN}  ═╩═  ═══  ═╩═${NC}"
      echo -e "${CYAN}  ║║   ╚═╝   ║║${NC}"
      ;;
    working)
      echo -e "${CYAN}      ╔═══╗${NC}"
      echo -e "${CYAN}      ║ ${BLUE}◉${CYAN} ║  ${DIM}* whirr *${NC}"
      echo -e "${CYAN}    ╔═╩═══╩═╗${NC}"
      echo -e "${CYAN}  ${YELLOW}⚡${CYAN}║ █████ ║${YELLOW}⚡${NC}"
      echo -e "${CYAN}    ║ ╰───╯ ║${NC}"
      echo -e "${CYAN}   ╔╩═══════╩╗${NC}"
      echo -e "${CYAN}  ═╩═  ═══  ═╩═${NC}"
      echo -e "${CYAN}  ║║   ╚═╝   ║║${NC}"
      ;;
    celebrating)
      echo -e "${YELLOW}  🎉${CYAN}  ╔═══╗  ${YELLOW}🎉${NC}"
      echo -e "${CYAN}      ║ ${GREEN}◉${CYAN} ║${NC}  ${BOLD}${GREEN}Woohoo!${NC}"
      echo -e "${CYAN}    ╔═╩═══╩═╗${NC}"
      echo -e "${CYAN}    ║ █████ ║${NC}"
      echo -e "${CYAN}    ║ ╰▽▽▽╯ ║${NC}"
      echo -e "${CYAN}   ╔╩═══════╩╗${NC}"
      echo -e "${CYAN}  ═╩═  ═══  ═╩═${NC}"
      echo -e "${CYAN}  ║║   ╚═╝   ║║${NC}"
      ;;
    error)
      echo -e "${CYAN}      ╔═══╗${NC}  ${RED}! !${NC}"
      echo -e "${CYAN}      ║ ${RED}◉${CYAN} ║${NC}  ${RED}Uh oh...${NC}"
      echo -e "${CYAN}    ╔═╩═══╩═╗${NC}"
      echo -e "${RED}  ⚡${CYAN}║ █████ ║${RED}⚡${NC}"
      echo -e "${CYAN}    ║ ╰~~~╯ ║${NC}"
      echo -e "${CYAN}   ╔╩═══════╩╗${NC}"
      echo -e "${CYAN}  ═╩═  ═══  ═╩═${NC}"
      echo -e "${CYAN}  ║║   ╚═╝   ║║${NC}"
      ;;
    goodbye)
      echo -e "${CYAN}      ╔═══╗${NC}"
      echo -e "${CYAN}      ║ ${GREEN}◉${CYAN} ║  ${NC}${BOLD}Bye! Have fun!${NC}"
      echo -e "${CYAN}    ╔═╩═══╩═╗${NC}"
      echo -e "${CYAN}    ║ █████ ║ ${DIM}~wave~${NC}"
      echo -e "${CYAN}    ║ ╰───╯ ║${NC}"
      echo -e "${CYAN}   ╔╩═══════╩╗${NC}"
      echo -e "${CYAN}  ═╩═  ═══  ═╩═${NC}"
      echo -e "${CYAN}  ║║   ╚═╝   ║║${NC}"
      ;;
  esac
  echo ""
}

# Fun quips shown during long operations
QUIPS=(
  "Reticulating splines..."
  "Teaching robots to love..."
  "Downloading more RAM..."
  "Convincing electrons to cooperate..."
  "Warming up the flux capacitor..."
  "Calibrating the quantum stabilizer..."
  "Asking Claude nicely..."
  "Compiling compliments..."
  "Optimizing happiness levels..."
  "Feeding the hamsters that power the server..."
  "Aligning neural pathways..."
  "Brewing digital coffee..."
)
# Real tips mixed in
TIPS=(
  "Tip: Use CLAUDE.md to give your bot project context"
  "Tip: The bot auto-saves chat sessions to SQLite"
  "Tip: You can run multiple agents in parallel"
  "Tip: Check 'sudo journalctl -u claude-bot -f' for live logs"
  "Tip: The update script supports automatic rollback"
  "Tip: Guard rails protect sensitive files by default"
)

# Background spinner with rotating quips
# Usage: start_spinner; <long command>; stop_spinner
SPINNER_PID=""
start_spinner() {
  if $UNATTENDED; then return; fi
  local all_messages=("${QUIPS[@]}" "${TIPS[@]}")
  (
    local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0
    local msg_i=0
    while true; do
      local char="${chars:$((i % ${#chars})):1}"
      local msg="${all_messages[$((msg_i % ${#all_messages[@]}))]}"
      printf "\r  ${CYAN}%s${NC} ${DIM}%s${NC}   " "$char" "$msg"
      i=$((i + 1))
      if (( i % 8 == 0 )); then
        msg_i=$((msg_i + 1))
      fi
      sleep 0.1
    done
  ) &
  SPINNER_PID=$!
  disown "$SPINNER_PID" 2>/dev/null || true
}

stop_spinner() {
  if [ -n "$SPINNER_PID" ]; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
    SPINNER_PID=""
    printf "\r%80s\r" ""  # Clear the line
  fi
}

# Run a command, suppressing stderr unless VERBOSE is set
run_cmd() {
  if $VERBOSE; then
    "$@"
  else
    "$@" 2>/dev/null
  fi
}

# Cleanup on exit — stop spinner + handle partial installs
cleanup_on_exit() {
  stop_spinner
  # Remove installation lockfile
  rmdir /tmp/claude-bot-install.lock 2>/dev/null || true
  if $INSTALL_IN_PROGRESS && ! $DRY_RUN; then
    if $CLONE_DONE && [ -d "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/.next/BUILD_ID" ]; then
      echo ""
      error "Installation failed before completing build."
      if [ -n "${INSTALL_LOG:-}" ] && [ -f "$INSTALL_LOG" ]; then
        echo "  Install log: $INSTALL_LOG"
      fi
      if $UNATTENDED; then
        echo "  Cleaning up partial install..."
        rm -rf "$INSTALL_DIR"
      else
        read -r -p "  Remove partial install at $INSTALL_DIR? [Y/n]: " REPLY
        if [[ ! "$REPLY" =~ ^[Nn]$ ]]; then
          rm -rf "$INSTALL_DIR"
          info "Cleaned up partial install"
        fi
      fi
    fi
    if $SERVICE_CREATED; then
      if systemctl is-failed --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        sudo systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
        warn "Disabled failed service"
      fi
    fi
  fi
}
trap 'cleanup_on_exit' EXIT

# ─── Platform detection ────────────────────────────────────────────────────
detect_platform() {
  local uname_s
  uname_s="$(uname -s)"
  case "$uname_s" in
    Darwin)
      PLATFORM="macos"
      ;;
    Linux)
      if grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
        PLATFORM="wsl"
      else
        PLATFORM="linux"
      fi
      ;;
    *)
      PLATFORM="linux"  # fallback
      ;;
  esac
}

detect_pkg_manager() {
  case "$PLATFORM" in
    macos)
      if command -v brew &>/dev/null; then
        PKG_MGR="brew"
        PKG_INSTALL="brew install"
        PKG_UPDATE=""
      else
        PKG_MGR=""
        PKG_INSTALL=""
        PKG_UPDATE=""
      fi
      ;;
    *)
      if command -v apt-get &>/dev/null; then
        PKG_MGR="apt"
        PKG_INSTALL="sudo apt-get install -y"
        PKG_UPDATE="sudo apt-get update -qq"
      elif command -v dnf &>/dev/null; then
        PKG_MGR="dnf"
        PKG_INSTALL="sudo dnf install -y"
        PKG_UPDATE=""
      elif command -v yum &>/dev/null; then
        PKG_MGR="yum"
        PKG_INSTALL="sudo yum install -y"
        PKG_UPDATE=""
      else
        PKG_MGR=""
        PKG_INSTALL=""
        PKG_UPDATE=""
      fi
      ;;
  esac
}

install_pkg() {
  if [ -z "$PKG_INSTALL" ]; then
    error "No supported package manager found. Install '$1' manually."
    return 1
  fi
  if [ -n "${PKG_UPDATE:-}" ]; then
    $PKG_UPDATE 2>/dev/null || true
  fi
  $PKG_INSTALL "$@"
}

# ─── Utility functions ─────────────────────────────────────────────────────
check_sudo() {
  if ! sudo -v 2>/dev/null; then
    error "sudo access is required but is not available."
    echo "  Run this installer with a user that has sudo privileges."
    return 1
  fi
}

get_local_ip() {
  case "$PLATFORM" in
    macos)
      ipconfig getifaddr en0 2>/dev/null || echo "localhost"
      ;;
    *)
      hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost"
      ;;
  esac
}

get_clipboard_cmd() {
  if [ "$PLATFORM" = "macos" ]; then
    command -v pbcopy 2>/dev/null && return
  fi
  command -v xclip 2>/dev/null && return
  command -v wl-copy 2>/dev/null && return
  command -v xsel 2>/dev/null && return
  echo ""
}

copy_to_clipboard() {
  local text="$1"
  local clip_cmd
  clip_cmd="$(get_clipboard_cmd)"
  if [ -n "$clip_cmd" ]; then
    echo -n "$text" | "$clip_cmd" 2>/dev/null && return 0
  fi
  return 1
}

validate_bot_name() {
  local name="$1"
  # 2-20 chars, alphanumeric + hyphens, no leading/trailing/consecutive hyphens
  if [ ${#name} -lt 2 ] || [ ${#name} -gt 20 ]; then
    echo "Must be 2-20 characters long"
    return 1
  fi
  if ! [[ "$name" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]; then
    echo "Only letters, numbers, and hyphens allowed (no leading/trailing hyphens)"
    return 1
  fi
  if [[ "$name" =~ -- ]]; then
    echo "No consecutive hyphens allowed"
    return 1
  fi
  return 0
}

validate_email() {
  local email="$1"
  if [[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
    return 0
  fi
  return 1
}

validate_port() {
  local port="$1"
  if ! [[ "$port" =~ ^[0-9]+$ ]]; then
    echo "Port must be a number"
    return 1
  fi
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "Port must be between 1 and 65535"
    return 1
  fi
  if [ "$port" -lt 1024 ] && [ "$(id -u)" -ne 0 ]; then
    echo "Ports below 1024 require root privileges"
    return 1
  fi
  return 0
}

check_port_available() {
  local port="$1"
  if command -v ss &>/dev/null; then
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
      return 1
    fi
  elif command -v lsof &>/dev/null; then
    if lsof -i ":${port}" -sTCP:LISTEN &>/dev/null; then
      return 1
    fi
  fi
  return 0
}

suggest_port() {
  local base="${1:-3000}"
  local port=$base
  while ! check_port_available "$port"; do
    port=$((port + 1))
    if [ "$port" -gt $((base + 100)) ]; then
      echo "$base"
      return 1
    fi
  done
  echo "$port"
}

system_info_banner() {
  echo ""
  echo -e "  ${BOLD}System Information${NC}"
  echo -e "  ${DIM}─────────────────────────────────────${NC}"
  echo -e "  ${DIM}Platform:${NC}  $PLATFORM ($(uname -s) $(uname -m))"

  if [ "$PLATFORM" = "macos" ]; then
    echo -e "  ${DIM}OS:${NC}        $(sw_vers -productName 2>/dev/null || echo 'macOS') $(sw_vers -productVersion 2>/dev/null || echo '')"
  elif [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    echo -e "  ${DIM}OS:${NC}        $(. /etc/os-release && echo "${PRETTY_NAME:-$NAME}")"
  fi

  if [ "$PLATFORM" = "wsl" ]; then
    echo -e "  ${YELLOW}WSL:${NC}       Detected (Windows Subsystem for Linux)"
  fi

  local mem_total=""
  if [ "$PLATFORM" = "macos" ]; then
    mem_total="$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 ))MB"
  elif [ -f /proc/meminfo ]; then
    mem_total="$(awk '/MemTotal/ {printf "%.0fMB", $2/1024}' /proc/meminfo)"
  fi
  [ -n "$mem_total" ] && echo -e "  ${DIM}Memory:${NC}    $mem_total"

  local disk_avail=""
  disk_avail="$(df -h "${HOME}" 2>/dev/null | awk 'NR==2 {print $4}' || echo '')"
  [ -n "$disk_avail" ] && echo -e "  ${DIM}Disk free:${NC} $disk_avail (home)"

  command -v node &>/dev/null && echo -e "  ${DIM}Node:${NC}      $(node --version)"
  command -v pnpm &>/dev/null && echo -e "  ${DIM}pnpm:${NC}      $(pnpm --version)"
  command -v git &>/dev/null && echo -e "  ${DIM}git:${NC}       $(git --version | awk '{print $3}')"

  if [ -n "$PKG_MGR" ]; then
    echo -e "  ${DIM}Pkg mgr:${NC}   $PKG_MGR"
  fi
  echo -e "  ${DIM}─────────────────────────────────────${NC}"
}

# ─── Parse CLI arguments ───────────────────────────────────────────────────
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --unattended)  UNATTENDED=true ;;
      --dry-run)     DRY_RUN=true; UNATTENDED=true ;;
      --verbose)     VERBOSE=true ;;
      --config)      shift; CONFIG_FILE="$1" ;;
      --config=*)    CONFIG_FILE="${1#*=}" ;;
      --mode)        shift; CLI_MODE="$1" ;;
      --mode=*)      CLI_MODE="${1#*=}" ;;
      --bot-name)    shift; CLI_BOT_NAME="$1" ;;
      --bot-name=*)  CLI_BOT_NAME="${1#*=}" ;;
      --email)       shift; CLI_EMAIL="$1" ;;
      --email=*)     CLI_EMAIL="${1#*=}" ;;
      --domain)      shift; CLI_DOMAIN="$1" ;;
      --domain=*)    CLI_DOMAIN="${1#*=}" ;;
      --https)       shift; CLI_HTTPS="$1" ;;
      --https=*)     CLI_HTTPS="${1#*=}" ;;
      --project-root)   shift; CLI_PROJECT_ROOT="$1" ;;
      --project-root=*) CLI_PROJECT_ROOT="${1#*=}" ;;
      --port)        shift; CLI_PORT="$1" ;;
      --port=*)      CLI_PORT="${1#*=}" ;;
      --install-dir)    shift; CLI_INSTALL_DIR="$1" ;;
      --install-dir=*)  CLI_INSTALL_DIR="${1#*=}" ;;
      --password)       shift; CLI_PASSWORD="$1" ;;
      --password=*)     CLI_PASSWORD="${1#*=}" ;;
      --help|-h)
        show_help
        exit 0
        ;;
      *)
        error "Unknown option: $1"
        echo "  Run 'bash install.sh --help' for usage."
        exit 1
        ;;
    esac
    shift
  done
}

show_help() {
  cat <<'HELP'
Claude Server Bot — Installer

Usage:
  bash install.sh                          # Interactive mode
  bash install.sh --unattended [options]   # Non-interactive mode
  bash install.sh --dry-run [options]      # Preview without changes
  bash install.sh --config install.conf    # Load from config file

Options:
  --unattended          Skip all prompts (requires mandatory fields)
  --dry-run             Print what would happen, then exit
  --config <file>       Load settings from config file (flags override)
  --mode <mode>         Deployment mode: vps, local
  --bot-name <name>     Bot display name (2-20 chars, alphanumeric + hyphens)
  --email <email>       Admin email address
  --domain <domain>     Domain name (required for VPS mode)
  --https <method>      HTTPS method: letsencrypt, cloudflare, none
  --project-root <dir>  Working directory for Claude
  --port <port>         Server port (default: 3000)
  --install-dir <dir>   Installation directory
  --password <pass>     Admin password (min 12 chars; auto-generated if omitted)
  --verbose             Show full command output (don't suppress)
  -h, --help            Show this help

Config file format (install.conf):
  mode=vps
  bot_name=Jarvis
  email=admin@example.com
  domain=bot.example.com
  https=letsencrypt
  project_root=/home/user/project
  port=3000
  password=your-secure-password-here

HELP
}

load_config_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    error "Config file not found: $file"
    exit 1
  fi
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    key="$(echo "$key" | tr -d '[:space:]')"
    value="$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "$key" in
      mode)          [ -z "$CLI_MODE" ] && CLI_MODE="$value" ;;
      bot_name)      [ -z "$CLI_BOT_NAME" ] && CLI_BOT_NAME="$value" ;;
      email)         [ -z "$CLI_EMAIL" ] && CLI_EMAIL="$value" ;;
      domain)        [ -z "$CLI_DOMAIN" ] && CLI_DOMAIN="$value" ;;
      https)         [ -z "$CLI_HTTPS" ] && CLI_HTTPS="$value" ;;
      project_root)  [ -z "$CLI_PROJECT_ROOT" ] && CLI_PROJECT_ROOT="$value" ;;
      port)          [ -z "$CLI_PORT" ] && CLI_PORT="$value" ;;
      install_dir)   [ -z "$CLI_INSTALL_DIR" ] && CLI_INSTALL_DIR="$value" ;;
      password)      [ -z "$CLI_PASSWORD" ] && CLI_PASSWORD="$value" ;;
    esac
  done < "$file"
}

validate_unattended() {
  local missing=()
  [ -z "$CLI_MODE" ] && missing+=("--mode")
  [ -z "$CLI_BOT_NAME" ] && missing+=("--bot-name")
  [ -z "$CLI_EMAIL" ] && missing+=("--email")
  if [ "$CLI_MODE" = "vps" ] && [ -z "$CLI_DOMAIN" ]; then
    missing+=("--domain (required for VPS mode)")
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing required fields for unattended mode:"
    for field in "${missing[@]}"; do
      echo "    $field"
    done
    exit 1
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
#  STEP FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Step 1: Welcome ──────────────────────────────────────────────────────
step_welcome() {
  clear 2>/dev/null || true
  divider
  echo -e "${BOLD}       Claude Server Bot — Installer v${SCRIPT_VERSION}${NC}"
  divider

  mascot greeting

  detect_platform
  detect_pkg_manager
  system_info_banner

  if [ "$PLATFORM" = "wsl" ]; then
    echo ""
    warn "WSL detected. A few things to note:"
    echo "    - Avoid installing in /mnt/c/... (slow I/O)"
    echo "    - Use the WSL filesystem (e.g., ~/project) for best performance"
    echo "    - systemd may not be available depending on WSL version"
  fi

  echo ""
  echo -e "  ${BOLD}Let's name your bot!${NC}"
  echo -e "  ${DIM}This name appears in the UI and URL (e.g., Jarvis, Friday, Botsworth)${NC}"
  echo ""

  if [ -n "$CLI_BOT_NAME" ]; then
    BOT_NAME="$CLI_BOT_NAME"
    local err
    if err="$(validate_bot_name "$BOT_NAME")"; then
      info "Bot name: $BOT_NAME"
    else
      error "Invalid bot name '$BOT_NAME': $err"
      exit 1
    fi
  else
    while true; do
      if ! prompt_input "Bot name" "Claude-Bot"; then
        # Can't go back from step 1
        continue
      fi
      BOT_NAME="$REPLY"
      local err
      if err="$(validate_bot_name "$BOT_NAME")"; then
        break
      else
        error "$err"
      fi
    done
  fi

  info "Meet ${BOLD}${BOT_NAME}${NC}! Great name."
  echo ""

  NEXT_STEP=2
}

# ─── Step 2: Prerequisites ────────────────────────────────────────────────
step_prerequisites() {
  step "[2/$TOTAL_STEPS] Checking prerequisites for ${BOT_NAME}..."
  mascot thinking

  # Package manager
  if [ -n "$PKG_MGR" ]; then
    info "Package manager: $PKG_MGR"
  else
    warn "No supported package manager detected. Some auto-installs may fail."
  fi

  # Node.js
  local need_node=false
  if ! command -v node &>/dev/null; then
    need_node=true
  else
    local node_major
    node_major=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$node_major" -lt 20 ]; then
      need_node=true
      warn "Node.js 20+ required (found $(node --version))."
    fi
  fi

  if $need_node; then
    local do_install=false
    if $UNATTENDED; then
      do_install=true
    else
      warn "Node.js 20+ not found."
      local node_result
      prompt_yn "  Install Node.js 20 now?" "y" && node_result=0 || node_result=$?
      if [ "$node_result" -eq 0 ]; then
        do_install=true
      elif [ "$node_result" -eq 2 ]; then
        return  # go back
      else
        error "Node.js 20+ is required. Please install manually and re-run."
        exit 1
      fi
    fi

    if $do_install; then
      info "Installing Node.js 20..."
      case "$PKG_MGR" in
        apt)
          curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
          sudo apt-get install -y nodejs
          ;;
        dnf)
          curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
          sudo dnf install -y nodejs
          ;;
        yum)
          curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
          sudo yum install -y nodejs
          ;;
        brew)
          brew install node@20
          ;;
        *)
          error "No supported package manager found. Please install Node.js 20+ manually and re-run."
          exit 1
          ;;
      esac
    fi

    if ! command -v node &>/dev/null; then
      error "Failed to install Node.js. Please install manually and re-run."
      exit 1
    fi
    local node_major
    node_major=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$node_major" -lt 20 ]; then
      error "Node.js 20+ required but got $(node --version). Please upgrade manually and re-run."
      exit 1
    fi
    info "Node.js installed: $(node --version)"
  else
    info "Node $(node --version)"
  fi

  # pnpm
  if ! command -v pnpm &>/dev/null; then
    if $UNATTENDED; then
      echo "  Installing pnpm..."
      npm install -g pnpm
    else
      local pnpm_result
      prompt_yn "pnpm not found. Install it now?" "y" && pnpm_result=0 || pnpm_result=$?
      if [ "$pnpm_result" -eq 0 ]; then
        echo "  Installing pnpm..."
        npm install -g pnpm
      elif [ "$pnpm_result" -eq 2 ]; then
        return  # go back
      else
        error "pnpm is required. Install it: npm install -g pnpm"
        exit 1
      fi
    fi
    info "pnpm installed"
  else
    info "pnpm $(pnpm --version)"
  fi

  # git
  if ! command -v git &>/dev/null; then
    if $UNATTENDED; then
      info "Installing git..."
      install_pkg git
    else
      warn "git not found."
      local git_result
      prompt_yn "  Install git now?" "y" && git_result=0 || git_result=$?
      if [ "$git_result" -eq 0 ]; then
        info "Installing git..."
        install_pkg git
      elif [ "$git_result" -eq 2 ]; then
        return  # go back
      else
        error "git is required. Please install manually and re-run."
        exit 1
      fi
    fi
    if ! command -v git &>/dev/null; then
      error "Failed to install git. Please install manually and re-run."
      exit 1
    fi
    info "git installed: $(git --version | awk '{print $3}')"
  else
    info "git $(git --version | awk '{print $3}')"
  fi

  # openssl
  if ! command -v openssl &>/dev/null; then
    if $UNATTENDED; then
      info "Installing openssl..."
      install_pkg openssl
    else
      warn "openssl not found."
      local openssl_result
      prompt_yn "  Install openssl now?" "y" && openssl_result=0 || openssl_result=$?
      if [ "$openssl_result" -eq 0 ]; then
        info "Installing openssl..."
        install_pkg openssl
      elif [ "$openssl_result" -eq 2 ]; then
        return  # go back
      else
        error "openssl is required. Please install manually and re-run."
        exit 1
      fi
    fi
    if ! command -v openssl &>/dev/null; then
      error "Failed to install openssl. Please install manually and re-run."
      exit 1
    fi
    info "openssl installed"
  else
    info "openssl found"
  fi

  # Disk space check
  local avail_kb
  avail_kb=$(df -k . | awk 'NR==2 {print $4}')
  if [ "${avail_kb:-0}" -lt 512000 ]; then
    error "Insufficient disk space: $(( avail_kb / 1024 )) MB available (minimum: 500 MB)"
    exit 1
  elif [ "${avail_kb:-0}" -lt 2097152 ]; then
    warn "Low disk space: $(( avail_kb / 1024 )) MB available (recommended: 2 GB)"
  else
    info "Disk space: $(( avail_kb / 1024 )) MB available"
  fi

  info "All prerequisites satisfied!"

  NEXT_STEP=3
}

# ─── Step 3: Deploy Mode ──────────────────────────────────────────────────
step_deploy_mode() {
  step "[3/$TOTAL_STEPS] How do you want to deploy ${BOT_NAME}?"
  echo ""

  if [ -n "$CLI_MODE" ]; then
    DEPLOY_MODE="$CLI_MODE"
    info "Mode: $DEPLOY_MODE (from config)"
    NEXT_STEP=4
    return
  fi

  echo -e "  ${BOLD}1) VPS (Full)${NC}  — Production server with domain, nginx, HTTPS, systemd"
  echo -e "     ${DIM}For: DigitalOcean, Linode, AWS EC2, etc.${NC}"
  echo ""
  echo -e "  ${BOLD}2) Local${NC}       — Run locally or on a home server. Optional domain/nginx."
  echo -e "     ${DIM}For: dev machines, Raspberry Pi, home servers${NC}"
  echo ""

  if ! prompt_input "Choose deployment mode" "1"; then
    return
  fi

  case "$REPLY" in
    1|vps)    DEPLOY_MODE="vps"    ;;
    2|local)  DEPLOY_MODE="local"  ;;
    *)
      error "Invalid choice. Please enter 1 or 2."
      NEXT_STEP=$CURRENT_STEP  # retry
      return
      ;;
  esac
  info "Mode: $DEPLOY_MODE"

  # Check sudo for modes that need it
  if [ "$DEPLOY_MODE" = "vps" ]; then
    if ! check_sudo; then
      error "VPS mode requires sudo. Try 'local' mode or run with a privileged user."
      NEXT_STEP=$CURRENT_STEP
      return
    fi
  fi

  NEXT_STEP=4
}

# ─── Step 4: Account Setup ────────────────────────────────────────────────
step_account() {
  step "[4/$TOTAL_STEPS] Setting up the admin account for ${BOT_NAME}..."
  echo ""

  echo -e "  ${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "  ${YELLOW}║  Your admin password will be auto-generated and shown ONCE  ║${NC}"
  echo -e "  ${YELLOW}║  at the end of installation. Save it in a secure location.  ║${NC}"
  echo -e "  ${YELLOW}║  There is no way to recover it later.                       ║${NC}"
  echo -e "  ${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  if [ -n "$CLI_EMAIL" ]; then
    ADMIN_EMAIL="$CLI_EMAIL"
    if ! validate_email "$ADMIN_EMAIL"; then
      error "Invalid email: $ADMIN_EMAIL"
      exit 1
    fi
    info "Admin email: $ADMIN_EMAIL"
  else
    while true; do
      if ! prompt_input "Admin email" ""; then
        return
      fi
      ADMIN_EMAIL="$REPLY"
      if [ -z "$ADMIN_EMAIL" ]; then
        error "Email is required."
        continue
      fi
      if ! validate_email "$ADMIN_EMAIL"; then
        error "Invalid email format. Expected: user@domain.com"
        continue
      fi
      break
    done
    info "Admin email: $ADMIN_EMAIL"
  fi

  # Password: use --password flag, or auto-generate
  if [ -n "$CLI_PASSWORD" ]; then
    if [ ${#CLI_PASSWORD} -lt 12 ]; then
      error "Password must be at least 12 characters (got ${#CLI_PASSWORD})."
      exit 1
    fi
    ADMIN_PASSWORD="$CLI_PASSWORD"
    info "Using provided password"
  else
    ADMIN_PASSWORD=""
    for _ in $(seq 1 5); do
      ADMIN_PASSWORD=$(openssl rand -base64 64 | tr -dc 'a-zA-Z0-9_-+=.' | head -c32)
      [ ${#ADMIN_PASSWORD} -eq 32 ] && break
    done
    if [ ${#ADMIN_PASSWORD} -ne 32 ]; then
      error "Failed to generate a secure password"
      exit 1
    fi
    info "Password will be generated (32 chars, shown at end)"
  fi

  NEXT_STEP=5
}

# ─── Step 5: Project Directory ─────────────────────────────────────────────
step_project() {
  step "[5/$TOTAL_STEPS] Where should ${BOT_NAME} work?"
  echo ""
  echo -e "  ${DIM}This is the project directory Claude will have access to.${NC}"

  if [ "$PLATFORM" = "wsl" ]; then
    echo ""
    warn "Avoid /mnt/c/... paths — use the WSL filesystem for better performance."
  fi

  echo ""

  local default_project="$HOME"
  if [ -n "$CLI_PROJECT_ROOT" ]; then
    PROJECT_ROOT="$CLI_PROJECT_ROOT"
  else
    if ! prompt_input "Project directory" "$default_project"; then
      return
    fi
    PROJECT_ROOT="$REPLY"
  fi

  # Expand ~ if used
  PROJECT_ROOT="${PROJECT_ROOT/#\~/$HOME}"

  if [ ! -d "$PROJECT_ROOT" ]; then
    error "Directory '$PROJECT_ROOT' does not exist."
    if $UNATTENDED; then
      exit 1
    fi
    NEXT_STEP=$CURRENT_STEP
    return
  fi
  info "Project directory: $PROJECT_ROOT"

  if [ -f "$PROJECT_ROOT/CLAUDE.md" ]; then
    info "CLAUDE.md found — project context available"
  else
    hint "No CLAUDE.md found — you can create one from the chat later (/init)"
  fi

  # Install directory
  echo ""
  local default_install="$HOME/claude-server-bot"
  if [ -n "$CLI_INSTALL_DIR" ]; then
    INSTALL_DIR="$CLI_INSTALL_DIR"
  else
    if ! prompt_input "Installation directory" "$default_install"; then
      return
    fi
    INSTALL_DIR="$REPLY"
  fi
  INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"
  info "Install directory: $INSTALL_DIR"

  NEXT_STEP=6
}

# ─── Step 6: Network Configuration ────────────────────────────────────────
step_network() {
  step "[6/$TOTAL_STEPS] Network setup for ${BOT_NAME}..."
  echo ""

  # Port
  local default_port="${CLI_PORT:-$DEFAULT_PORT}"
  if [ -n "$CLI_PORT" ]; then
    PORT="$CLI_PORT"
  else
    if ! check_port_available "$default_port"; then
      local suggested
      suggested="$(suggest_port "$default_port")"
      warn "Port $default_port is already in use!"
      default_port="$suggested"
      echo -e "  ${DIM}Suggested available port: $suggested${NC}"
    fi
    if ! prompt_input "Port" "$default_port"; then
      return
    fi
    PORT="$REPLY"
  fi

  # Validate port number
  local port_err
  port_err=$(validate_port "$PORT") || {
    error "$port_err"
    NEXT_STEP=$CURRENT_STEP
    return
  }

  if ! check_port_available "$PORT"; then
    warn "Port $PORT is currently in use."
    if command -v ss &>/dev/null; then
      echo -e "  ${DIM}$(ss -tlnp 2>/dev/null | grep ":${PORT} " | head -3)${NC}"
    elif command -v lsof &>/dev/null; then
      echo -e "  ${DIM}$(lsof -i ":${PORT}" -sTCP:LISTEN 2>/dev/null | head -3)${NC}"
    fi
    echo "  It may conflict at startup."
  fi
  info "Port: $PORT"

  # Reset network config
  DOMAIN=""
  USE_HTTPS=false
  HTTPS_METHOD=""
  SETUP_NGINX=false
  SETUP_UFW=false
  SETUP_CF_TUNNEL=false

  # Domain
  if [ -n "$CLI_DOMAIN" ]; then
    DOMAIN="$CLI_DOMAIN"
  elif [ "$DEPLOY_MODE" = "vps" ]; then
    echo ""
    while true; do
      if ! prompt_input "Domain name (required for VPS)" ""; then
        return
      fi
      DOMAIN="$REPLY"
      if [ -n "$DOMAIN" ]; then break; fi
      error "A domain name is required for VPS mode."
    done
  else
    echo ""
    local has_domain_result
    prompt_yn "Do you have a domain name?" "n" && has_domain_result=0 || has_domain_result=$?
    if [ "$has_domain_result" -eq 2 ]; then
      return  # go back
    elif [ "$has_domain_result" -eq 0 ]; then
      if ! prompt_input "Domain" ""; then
        return
      fi
      DOMAIN="$REPLY"
    fi
  fi

  if [ -n "$DOMAIN" ]; then
    info "Domain: $DOMAIN"

    # DNS resolution check (non-blocking warning)
    local dns_resolved=false
    if command -v dig &>/dev/null; then
      dig +short "$DOMAIN" 2>/dev/null | grep -q '.' && dns_resolved=true
    elif command -v host &>/dev/null; then
      host "$DOMAIN" &>/dev/null && dns_resolved=true
    elif command -v getent &>/dev/null; then
      getent hosts "$DOMAIN" &>/dev/null && dns_resolved=true
    fi
    if ! $dns_resolved; then
      warn "Domain '$DOMAIN' does not appear to resolve yet."
      hint "  Make sure DNS is configured before requesting HTTPS certificates."
    fi

    # HTTPS method
    if [ -n "$CLI_HTTPS" ]; then
      case "$CLI_HTTPS" in
        letsencrypt) USE_HTTPS=true; HTTPS_METHOD="letsencrypt"; SETUP_NGINX=true ;;
        cloudflare)  USE_HTTPS=true; HTTPS_METHOD="cloudflare"; SETUP_CF_TUNNEL=true ;;
        none)        USE_HTTPS=false ;;
      esac
    else
      echo ""
      echo -e "  ${BOLD}How do you want to handle HTTPS?${NC}"
      echo -e "  ${BOLD}1)${NC} nginx + Let's Encrypt (recommended)"
      echo -e "  ${BOLD}2)${NC} Cloudflare Tunnel (no port exposure needed)"
      echo -e "  ${BOLD}3)${NC} No HTTPS (HTTP only)"
      echo ""
      if ! prompt_input "Choice" "1"; then
        return
      fi
      case "$REPLY" in
        1)
          USE_HTTPS=true
          HTTPS_METHOD="letsencrypt"
          SETUP_NGINX=true
          CERTBOT_EMAIL="$ADMIN_EMAIL"
          ;;
        2)
          USE_HTTPS=true
          HTTPS_METHOD="cloudflare"
          SETUP_CF_TUNNEL=true
          ;;
        3)
          USE_HTTPS=false
          ;;
      esac
    fi

    # nginx setup details
    if $SETUP_NGINX; then
      if [ "$DEPLOY_MODE" = "local" ]; then
        if ! check_sudo; then
          warn "nginx setup needs sudo. Skipping nginx — you can set it up manually."
          SETUP_NGINX=false
        fi
      fi

      if $SETUP_NGINX; then
        # Check/install nginx
        if ! command -v nginx &>/dev/null; then
          info "nginx will be installed during setup"
        else
          info "nginx already installed"
        fi

        # UFW (Linux only, not macOS)
        if [ "$PLATFORM" != "macos" ]; then
          echo ""
          local ufw_result
          prompt_yn "Enable UFW firewall rules (ports 80, 443)?" "y" && ufw_result=0 || ufw_result=$?
          if [ "$ufw_result" -eq 0 ]; then
            SETUP_UFW=true
          elif [ "$ufw_result" -eq 2 ]; then
            return  # go back
          fi
        fi
      fi
    fi

    # Cloudflare tunnel setup details
    if $SETUP_CF_TUNNEL; then
      if ! command -v cloudflared &>/dev/null; then
        warn "cloudflared not found — will be installed during setup"
      else
        info "cloudflared found"
      fi
    fi
  fi

  # Compute BASE_URL
  if $USE_HTTPS && [ -n "$DOMAIN" ]; then
    BASE_URL="https://$DOMAIN"
  elif [ -n "$DOMAIN" ]; then
    BASE_URL="http://$DOMAIN"
  else
    local server_ip
    server_ip="$(get_local_ip)"
    BASE_URL="http://${server_ip}:${PORT}"
  fi

  info "Base URL: $BASE_URL"

  NEXT_STEP=7
}

# ─── Step 7: Confirmation Summary ─────────────────────────────────────────
step_confirm() {
  # Generate slug, path prefix, and secrets now
  SLUG=$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c12)
  BOT_PATH_PREFIX=$(echo "$BOT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')
  NEXTAUTH_SECRET=$(openssl rand -base64 32)

  local full_url="$BASE_URL/$BOT_PATH_PREFIX/$SLUG"
  local mode_display=""
  case "$DEPLOY_MODE" in
    vps)    mode_display="VPS (Full)" ;;
    local)  mode_display="Local" ;;
  esac
  local https_display="None (HTTP)"
  if $USE_HTTPS; then
    case "$HTTPS_METHOD" in
      letsencrypt) https_display="Let's Encrypt" ;;
      cloudflare)  https_display="Cloudflare Tunnel" ;;
    esac
  fi
  local service_display="Manual"
  if [ "$DEPLOY_MODE" = "vps" ]; then
    service_display="systemd"
    SETUP_SERVICE=true
  fi

  step "[7/$TOTAL_STEPS] Ready to install ${BOT_NAME}!"
  mascot thinking
  echo ""
  echo -e "  ${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "  ${BOLD}║  Installation Summary                                       ║${NC}"
  echo -e "  ${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
  printf "  ${BOLD}║${NC}  Bot Name:      ${GREEN}%-41s${NC}${BOLD}║${NC}\n" "$BOT_NAME"
  printf "  ${BOLD}║${NC}  Mode:          %-41s${BOLD}║${NC}\n" "$mode_display"
  printf "  ${BOLD}║${NC}  Domain:        %-41s${BOLD}║${NC}\n" "${DOMAIN:-N/A}"
  printf "  ${BOLD}║${NC}  HTTPS:         %-41s${BOLD}║${NC}\n" "$https_display"
  printf "  ${BOLD}║${NC}  Port:          %-41s${BOLD}║${NC}\n" "$PORT"
  printf "  ${BOLD}║${NC}  Admin Email:   %-41s${BOLD}║${NC}\n" "$ADMIN_EMAIL"
  printf "  ${BOLD}║${NC}  Project Dir:   %-41s${BOLD}║${NC}\n" "$PROJECT_ROOT"
  printf "  ${BOLD}║${NC}  Install Dir:   %-41s${BOLD}║${NC}\n" "$INSTALL_DIR"
  printf "  ${BOLD}║${NC}  Service:       %-41s${BOLD}║${NC}\n" "$service_display"
  printf "  ${BOLD}║${NC}  URL:           %-41s${BOLD}║${NC}\n" "$full_url"
  echo -e "  ${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  if $DRY_RUN; then
    echo ""
    echo -e "  ${YELLOW}${BOLD}DRY RUN — no changes will be made.${NC}"
    echo ""
    echo "  What would happen:"
    local n=1
    echo "    $((n++)). Clone $REPO_URL → $INSTALL_DIR"
    echo "    $((n++)). Install dependencies (pnpm install)"
    echo "    $((n++)). Generate .env with the above configuration"
    echo "    $((n++)). Build the application (pnpm build)"
    if $SETUP_NGINX; then
      echo "    $((n++)). Configure nginx reverse proxy"
    fi
    if $USE_HTTPS && [ "$HTTPS_METHOD" = "letsencrypt" ]; then
      echo "    $((n++)). Obtain Let's Encrypt certificate"
    fi
    if $SETUP_CF_TUNNEL; then
      echo "    $((n++)). Set up Cloudflare Tunnel"
    fi
    echo "    $((n++)). Set up $service_display service"
    echo "    $((n++)). Health check and verification"
    echo ""
    exit 0
  fi

  if ! $UNATTENDED; then
    local confirm_result
    prompt_yn "Proceed with installation?" "y" && confirm_result=0 || confirm_result=$?
    if [ "$confirm_result" -eq 2 ]; then
      return  # go back
    elif [ "$confirm_result" -ne 0 ]; then
      echo ""
      echo "  Installation cancelled."
      exit 0
    fi
  fi

  NEXT_STEP=8
}

# ─── Step 8: Clone & Build ────────────────────────────────────────────────
step_build() {
  step "[8/$TOTAL_STEPS] Building ${BOT_NAME}..."
  mascot working

  INSTALL_IN_PROGRESS=true

  # Lockfile to prevent concurrent installations
  local lockdir="/tmp/claude-bot-install.lock"
  if ! mkdir "$lockdir" 2>/dev/null; then
    error "Another installation is already in progress (lock: $lockdir)."
    echo "  If you're sure no other installer is running, remove the lock:"
    echo "    rmdir $lockdir"
    exit 1
  fi

  # Handle existing directory
  if [ -d "$INSTALL_DIR" ]; then
    local has_env=false has_build=false
    [ -f "$INSTALL_DIR/.env" ] && has_env=true
    [ -d "$INSTALL_DIR/.next" ] && has_build=true

    if $has_env && $has_build && ! $UNATTENDED; then
      warn "Existing installation detected at $INSTALL_DIR"
      echo ""
      echo -e "  ${BOLD}1) Upgrade in-place${NC} — pull latest, rebuild (preserves data)"
      echo -e "  ${BOLD}2) Fresh install${NC}   — backup data, re-clone"
      echo ""
      if ! prompt_input "Choice" "1"; then return; fi
      case "$REPLY" in
        1) upgrade_in_place; return ;;
        2) ;; # fall through to fresh install
      esac
    fi

    warn "Directory $INSTALL_DIR already exists."

    # Backup data/ and .env before removing
    local backup_dir=""
    if [ -d "$INSTALL_DIR/data" ] || [ -f "$INSTALL_DIR/.env" ]; then
      backup_dir="$(mktemp -d)"
      info "Backing up existing data to $backup_dir"
      [ -d "$INSTALL_DIR/data" ] && cp -r "$INSTALL_DIR/data" "$backup_dir/data"
      [ -f "$INSTALL_DIR/.env" ] && cp "$INSTALL_DIR/.env" "$backup_dir/.env.old"
    fi

    if $UNATTENDED; then
      rm -rf "$INSTALL_DIR"
    else
      read -r -p "  Remove and re-clone (fresh install)? [Y/n]: " OVERWRITE
      if [[ "$OVERWRITE" =~ ^[Nn]$ ]]; then
        echo "  Aborted."
        exit 0
      fi
      rm -rf "$INSTALL_DIR"
    fi
  fi

  # Check write permissions on parent directory
  local parent_dir
  parent_dir="$(dirname "$INSTALL_DIR")"
  if [ ! -w "$parent_dir" ]; then
    error "Cannot write to $parent_dir — check permissions or choose a different install directory."
    exit 1
  fi

  echo "  Cloning repository..."
  start_spinner
  git clone "$REPO_URL" "$INSTALL_DIR" --branch "$REPO_BRANCH" --depth 1 --quiet 2>&1
  stop_spinner
  CLONE_DONE=true
  info "Cloned into $INSTALL_DIR"
  cd "$INSTALL_DIR"

  # Move install log into the install directory
  if [ -f "$INSTALL_LOG" ]; then
    cp "$INSTALL_LOG" "$INSTALL_DIR/install.log"
    INSTALL_LOG="$INSTALL_DIR/install.log"
    exec > >(tee -a "$INSTALL_LOG") 2>&1
  fi

  # Restore backed up data
  if [ -n "${backup_dir:-}" ] && [ -d "$backup_dir" ]; then
    [ -d "$backup_dir/data" ] && cp -r "$backup_dir/data" "$INSTALL_DIR/data"
    info "Restored previous data directory"
    rm -rf "$backup_dir"
  fi

  # ─── Claude CLI ────────────────────────────────────────────────────────
  echo ""
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
    if $UNATTENDED; then
      echo "  Installing Claude CLI..."
      npm install -g @anthropic-ai/claude-code
      CLAUDE_BIN="$(command -v claude 2>/dev/null || echo "claude")"
    else
      warn "Claude CLI not found."
      local install_cli_result
      prompt_yn "Install Claude CLI now?" "y" && install_cli_result=0 || install_cli_result=$?
      if [ "$install_cli_result" -eq 0 ]; then
        echo "  Installing @anthropic-ai/claude-code..."
        npm install -g @anthropic-ai/claude-code
        CLAUDE_BIN="$(command -v claude 2>/dev/null || echo "claude")"
        if [ -n "$CLAUDE_BIN" ] && [ "$CLAUDE_BIN" != "claude" ]; then
          info "Claude CLI installed at $CLAUDE_BIN"
        else
          CLAUDE_BIN="claude"
          warn "Installed but could not detect path. Using 'claude' as default."
        fi
      else
        echo ""
        echo -e "  ${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "  ${YELLOW}║  Claude Server Bot requires the Claude CLI to function.     ║${NC}"
        echo -e "  ${YELLOW}║  Install it before using the app:                           ║${NC}"
        echo -e "  ${YELLOW}║    npm install -g @anthropic-ai/claude-code                 ║${NC}"
        echo -e "  ${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        CLAUDE_BIN="claude"
      fi
    fi
  else
    info "Claude CLI found at $CLAUDE_BIN"
    # Verify it works
    if "$CLAUDE_BIN" --version &>/dev/null 2>&1; then
      info "Claude CLI version: $("$CLAUDE_BIN" --version 2>/dev/null || echo 'unknown')"
    else
      warn "Claude CLI found but could not verify version"
    fi
  fi

  # Auth verification
  if [ -n "$CLAUDE_BIN" ] && [ "$CLAUDE_BIN" != "claude" ] && [ -x "$CLAUDE_BIN" ]; then
    echo ""
    echo "  Checking Claude CLI authentication..."
    if "$CLAUDE_BIN" --version &>/dev/null 2>&1; then
      # Try a lightweight auth check — "claude api-key" or similar
      # The most reliable check: attempt to use the CLI and check exit code
      local auth_ok=false
      if "$CLAUDE_BIN" /dev/null 2>&1 --output-format json -p "reply with ok" </dev/null &>/dev/null; then
        auth_ok=true
      fi
      if ! $auth_ok; then
        if $UNATTENDED; then
          warn "Claude CLI may not be authenticated. Authenticate after install with: $CLAUDE_BIN"
        else
          warn "Claude CLI does not appear to be authenticated."
          echo ""
          echo -e "  ${YELLOW}Please authenticate before continuing.${NC}"
          echo -e "  ${YELLOW}Open a NEW terminal and run:${NC}  $CLAUDE_BIN"
          echo "  Complete the browser login, then return here and press Enter."
          echo ""
          while true; do
            read -r -p "  Press Enter when authenticated (or type 'skip' to continue anyway): " auth_reply
            if [[ "$auth_reply" == "skip" ]]; then
              warn "Skipping auth check — you'll need to authenticate before using the bot."
              break
            fi
            # Re-check
            if "$CLAUDE_BIN" /dev/null 2>&1 --output-format json -p "reply with ok" </dev/null &>/dev/null; then
              info "Claude CLI authenticated!"
              break
            else
              warn "Still not authenticated. Try again or type 'skip'."
            fi
          done
        fi
      else
        info "Claude CLI authenticated"
      fi
    fi
  fi

  # Install dependencies
  echo ""
  echo "  Installing dependencies..."
  start_spinner
  local deps_log
  deps_log="$(mktemp)"
  if ! pnpm install --frozen-lockfile --reporter=silent > "$deps_log" 2>&1; then
    stop_spinner
    error "Dependency installation failed! Last 30 lines:"
    tail -30 "$deps_log"
    rm -f "$deps_log"
    exit 1
  fi
  rm -f "$deps_log"
  stop_spinner
  info "Dependencies installed"

  # Generate .env
  generate_env

  # Build
  echo "  Building ${BOT_NAME}..."
  start_spinner
  local build_log
  build_log="$(mktemp)"
  if ! CLAUDE_BOT_SLUG="$SLUG" CLAUDE_BOT_PATH_PREFIX="$BOT_PATH_PREFIX" pnpm build > "$build_log" 2>&1; then
    stop_spinner
    error "Build failed! Output:"
    tail -50 "$build_log"
    rm -f "$build_log"
    exit 1
  fi
  rm -f "$build_log"
  stop_spinner
  info "Build complete!"

  INSTALL_IN_PROGRESS=false
  NEXT_STEP=9
}

# ─── Upgrade in place (re-used by update path) ──────────────────────────
upgrade_in_place() {
  local target_dir="${1:-$INSTALL_DIR}"
  step "Upgrading in place..."

  # Backup .env and data
  local backup_dir
  backup_dir="$(mktemp -d)"
  [ -f "$target_dir/.env" ] && cp "$target_dir/.env" "$backup_dir/.env"
  [ -d "$target_dir/data" ] && cp -r "$target_dir/data" "$backup_dir/data"
  info "Backed up .env and data to $backup_dir"

  # Try git pull, fall back to re-clone if dirty
  cd "$target_dir"
  if ! git pull --ff-only 2>/dev/null; then
    warn "git pull failed — re-cloning..."
    local repo_url
    repo_url=$(git remote get-url origin 2>/dev/null || echo "$REPO_URL")
    cd ..
    rm -rf "$target_dir"
    git clone --depth 1 -b "$REPO_BRANCH" "$repo_url" "$target_dir"
    cd "$target_dir"
    info "Re-cloned from $repo_url"
  else
    info "Pulled latest changes"
  fi

  # Restore .env and data
  [ -f "$backup_dir/.env" ] && cp "$backup_dir/.env" "$target_dir/.env"
  [ -d "$backup_dir/data" ] && cp -r "$backup_dir/data" "$target_dir/data"
  rm -rf "$backup_dir"
  info "Restored .env and data"

  # Migrate env vars
  migrate_env "$target_dir/.env" "$target_dir/.env.example"

  # Rebuild
  echo "  Installing dependencies..."
  start_spinner
  pnpm install --frozen-lockfile --reporter=silent 2>&1
  stop_spinner
  info "Dependencies installed"

  # Source SLUG and PATH_PREFIX from existing .env if not already set
  if [ -z "${SLUG:-}" ] && [ -f "$target_dir/.env" ]; then
    SLUG=$(grep -E '^CLAUDE_BOT_SLUG=' "$target_dir/.env" 2>/dev/null | cut -d= -f2 || true)
  fi
  if [ -z "${BOT_PATH_PREFIX:-}" ] && [ -f "$target_dir/.env" ]; then
    BOT_PATH_PREFIX=$(grep -E '^CLAUDE_BOT_PATH_PREFIX=' "$target_dir/.env" 2>/dev/null | cut -d= -f2 || true)
  fi

  echo "  Building..."
  start_spinner
  local build_log
  build_log="$(mktemp)"
  if ! CLAUDE_BOT_SLUG="${SLUG:-}" CLAUDE_BOT_PATH_PREFIX="${BOT_PATH_PREFIX:-c}" pnpm build > "$build_log" 2>&1; then
    stop_spinner
    error "Build failed! Output:"
    tail -50 "$build_log"
    rm -f "$build_log"
    exit 1
  fi
  rm -f "$build_log"
  stop_spinner
  info "Build complete!"

  # Restart running service
  restart_existing_service

  NEXT_STEP=10
}

# ─── Migrate .env — add missing keys from .env.example ──────────────────
migrate_env() {
  local env_file="${1:-.env}"
  local example_file="${2:-.env.example}"

  if [ ! -f "$example_file" ]; then
    return
  fi
  if [ ! -f "$env_file" ]; then
    return
  fi

  local added=0
  local deprecated=0

  # Find keys in .env.example that are missing from .env
  while IFS= read -r line; do
    # Skip comments and blank lines
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    local key="${line%%=*}"
    if ! grep -q "^${key}=" "$env_file" 2>/dev/null; then
      echo "$line" >> "$env_file"
      added=$((added + 1))
      hint "  Added missing env var: $key"
    fi
  done < "$example_file"

  # Warn about keys in .env not present in .env.example
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

# ─── Restart existing service (systemd or launchd) ──────────────────────
restart_existing_service() {
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

generate_env() {
  # Generate .env using Node.js with argv to avoid injection
  node -e "
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const password = process.argv[1];
const port = process.argv[2];
const baseUrl = process.argv[3];
const slug = process.argv[4];
const secret = process.argv[5];
const email = process.argv[6];
const cliBin = process.argv[7];
const projectRoot = process.argv[8];
const installDir = process.argv[9];
const botName = process.argv[10];
const pathPrefix = process.argv[11];

const hash = bcrypt.hashSync(password, 12);

const env = [
  'NODE_ENV=production',
  'PORT=' + port,
  'NEXTAUTH_URL=' + baseUrl + '/' + pathPrefix + '/' + slug,
  'NEXTAUTH_SECRET=' + secret,
  'CLAUDE_BOT_PATH_PREFIX=' + pathPrefix,
  'NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX=' + pathPrefix,
  'CLAUDE_BOT_SLUG=' + slug,
  'NEXT_PUBLIC_CLAUDE_BOT_SLUG=' + slug,
  'CLAUDE_BOT_NAME=' + botName,
  'CLAUDE_BOT_ADMIN_EMAIL=' + email,
  'CLAUDE_BOT_ADMIN_HASH=' + hash,
  'CLAUDE_CLI_PATH=' + cliBin,
  'CLAUDE_PROJECT_ROOT=' + projectRoot,
  'NEXT_PUBLIC_CLAUDE_PROJECT_ROOT=' + projectRoot,
  'DATA_DIR=' + path.join(installDir, 'data'),
  'CLAUDE_PROVIDER=subprocess',
].join('\n') + '\n';

fs.writeFileSync(path.join(installDir, '.env'), env);
" "$ADMIN_PASSWORD" "$PORT" "$BASE_URL" "$SLUG" "$NEXTAUTH_SECRET" \
  "$ADMIN_EMAIL" "$CLAUDE_BIN" "$PROJECT_ROOT" "$INSTALL_DIR" "$BOT_NAME" "$BOT_PATH_PREFIX"
  info ".env generated"
}

# ─── Step 9: Service Setup ────────────────────────────────────────────────
step_service() {
  step "[9/$TOTAL_STEPS] Setting up ${BOT_NAME} service..."
  mascot working

  # nginx config
  if $SETUP_NGINX; then
    setup_nginx
  fi

  # Cloudflare tunnel
  if $SETUP_CF_TUNNEL; then
    setup_cloudflare_tunnel
  fi

  # systemd / launchd / manual
  if [ "$DEPLOY_MODE" = "vps" ]; then
    SETUP_SERVICE=true
  elif [ "$DEPLOY_MODE" = "local" ]; then
    if ! $UNATTENDED; then
      local svc_result
      prompt_yn "Set up as system service (auto-start on boot)?" "n" && svc_result=0 || svc_result=$?
      if [ "$svc_result" -eq 0 ]; then
        check_sudo && SETUP_SERVICE=true
      fi
    fi
  fi

  if $SETUP_SERVICE; then
    if [ "$PLATFORM" = "macos" ]; then
      setup_launchd
    else
      setup_systemd
    fi
  else
    info "No system service configured."
    echo ""
    echo -e "  To start manually:"
    echo "    cd $INSTALL_DIR"
    echo "    pnpm start"
  fi

  NEXT_STEP=10
}

setup_nginx() {
  echo "  Configuring nginx..."

  # Install if needed
  if ! command -v nginx &>/dev/null; then
    install_pkg nginx
  fi

  # Determine config path
  local nginx_conf nginx_link=""
  if [ -d /etc/nginx/sites-available ]; then
    nginx_conf="/etc/nginx/sites-available/claude-bot"
    nginx_link="/etc/nginx/sites-enabled/claude-bot"
  else
    nginx_conf="/etc/nginx/conf.d/claude-bot.conf"
  fi

  sudo tee "$nginx_conf" > /dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location /$BOT_PATH_PREFIX/$SLUG/ {
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

  if [ -n "$nginx_link" ]; then
    sudo ln -sf "$nginx_conf" "$nginx_link"
  fi
  sudo nginx -t -q
  sudo systemctl reload nginx
  info "nginx configured"

  # Let's Encrypt
  if $USE_HTTPS && [ "$HTTPS_METHOD" = "letsencrypt" ]; then
    if ! command -v certbot &>/dev/null; then
      echo "  Installing certbot..."
      install_pkg certbot python3-certbot-nginx
    fi
    CERTBOT_EMAIL="${CERTBOT_EMAIL:-$ADMIN_EMAIL}"
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect -q
    info "Let's Encrypt certificate issued"

    # Update .env with https URL
    node -e "
const fs = require('fs');
const envPath = process.argv[1];
let env = fs.readFileSync(envPath, 'utf8');
env = env.replace(/^NEXTAUTH_URL=.*/m, 'NEXTAUTH_URL=https://${DOMAIN}/${BOT_PATH_PREFIX}/${SLUG}');
fs.writeFileSync(envPath, env);
" "$INSTALL_DIR/.env"
    BASE_URL="https://$DOMAIN"
  fi

  # UFW
  if $SETUP_UFW; then
    sudo ufw allow 80/tcp > /dev/null 2>&1 || true
    sudo ufw allow 443/tcp > /dev/null 2>&1 || true
    info "UFW rules added"
  fi
}

setup_cloudflare_tunnel() {
  echo "  Setting up Cloudflare Tunnel..."

  # Install cloudflared if needed
  if ! command -v cloudflared &>/dev/null; then
    echo "  Installing cloudflared..."
    case "$PLATFORM" in
      macos)
        if [ "$PKG_MGR" = "brew" ]; then
          brew install cloudflared
        else
          error "Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
          return
        fi
        ;;
      *)
        if [ "$PKG_MGR" = "apt" ]; then
          # Official cloudflare repo
          if ! dpkg -l cloudflared &>/dev/null 2>&1; then
            curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
            echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
            sudo apt-get update -qq
            sudo apt-get install -y cloudflared
          fi
        else
          error "Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
          return
        fi
        ;;
    esac
  fi

  if ! command -v cloudflared &>/dev/null; then
    error "cloudflared installation failed. Set up the tunnel manually."
    return
  fi

  info "cloudflared available"
  echo ""
  echo -e "  ${YELLOW}You need to authenticate cloudflared with your Cloudflare account.${NC}"
  echo -e "  ${YELLOW}This will open a browser window.${NC}"
  echo ""

  if ! $UNATTENDED; then
    read -r -p "  Press Enter to start authentication... "
  fi

  cloudflared tunnel login 2>&1 || true

  local tunnel_name
  tunnel_name="claude-bot-$(echo "$BOT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
  echo "  Creating tunnel: $tunnel_name"
  cloudflared tunnel create "$tunnel_name" 2>&1 || true

  # Create config
  local cf_config_dir="$HOME/.cloudflared"
  mkdir -p "$cf_config_dir"
  cat > "$cf_config_dir/config-${tunnel_name}.yml" <<CFCONFIG
tunnel: ${tunnel_name}
credentials-file: ${cf_config_dir}/${tunnel_name}.json

ingress:
  - hostname: ${DOMAIN}
    service: http://localhost:${PORT}
  - service: http_status:404
CFCONFIG

  echo ""
  echo -e "  ${YELLOW}Next steps for Cloudflare Tunnel:${NC}"
  echo "    1. Create a DNS CNAME record pointing $DOMAIN to ${tunnel_name}.cfargotunnel.com"
  echo "    2. Start the tunnel: cloudflared tunnel --config ${cf_config_dir}/config-${tunnel_name}.yml run"
  echo ""
  echo -e "  ${DIM}To install as a system service: cloudflared service install${NC}"
  echo ""
  info "Cloudflare Tunnel configured"

  # Update .env with https URL
  node -e "
const fs = require('fs');
const envPath = process.argv[1];
let env = fs.readFileSync(envPath, 'utf8');
env = env.replace(/^NEXTAUTH_URL=.*/m, 'NEXTAUTH_URL=https://${DOMAIN}/${BOT_PATH_PREFIX}/${SLUG}');
fs.writeFileSync(envPath, env);
" "$INSTALL_DIR/.env"
  BASE_URL="https://$DOMAIN"
}

setup_systemd() {
  echo "  Creating systemd service..."

  # Check if systemd is actually running (may not be on WSL)
  if [ ! -d /run/systemd/system ]; then
    warn "systemd is not running (common on WSL without systemd enabled)."
    echo "  Skipping service setup. Start the bot manually:"
    echo "    cd $INSTALL_DIR && pnpm start"
    echo ""
    hint "To enable systemd on WSL, add [boot] systemd=true to /etc/wsl.conf and restart WSL."
    SETUP_SERVICE=false
    return
  fi

  check_sudo || return

  if systemctl cat "${SERVICE_NAME}.service" &>/dev/null 2>&1; then
    info "Existing service found — stopping before reconfiguration"
    sudo systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
  fi

  # Sudoers for service restart
  local sudoers_file="/etc/sudoers.d/claude-bot"
  echo "$USER ALL=(ALL) NOPASSWD: /bin/systemctl restart ${SERVICE_NAME}.service" | sudo tee "$sudoers_file" > /dev/null
  sudo chmod 0440 "$sudoers_file"

  local pnpm_bin node_bin
  pnpm_bin=$(command -v pnpm)
  node_bin=$(command -v node)

  sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<SERVICE
[Unit]
Description=Claude Server Bot (${BOT_NAME})
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$pnpm_bin start
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$(dirname "$node_bin")

[Install]
WantedBy=multi-user.target
SERVICE

  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}.service" --quiet
  sudo systemctl start "${SERVICE_NAME}.service"

  # Wait for service
  local started=false
  for _ in $(seq 1 10); do
    if sudo systemctl is-active --quiet "${SERVICE_NAME}.service"; then
      started=true
      break
    fi
    sleep 1
  done

  SERVICE_CREATED=true
  if $started; then
    info "systemd service started"
  else
    warn "Service may not have started. Check: sudo journalctl -u ${SERVICE_NAME} -n 30"
  fi
  hint "Tip: manage log size with: sudo journalctl --vacuum-size=500M"
}

setup_launchd() {
  echo "  Creating launchd service..."

  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_name="com.claude-server-bot.plist"
  local plist_path="$plist_dir/$plist_name"
  local pnpm_bin
  pnpm_bin=$(command -v pnpm)

  mkdir -p "$plist_dir"

  if [ -f "$plist_path" ]; then
    info "Existing service found — stopping before reconfiguration"
    launchctl unload "$plist_path" 2>/dev/null || true
  fi

  cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-server-bot</string>
    <key>ProgramArguments</key>
    <array>
        <string>${pnpm_bin}</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/data/claude-bot.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/data/claude-bot-error.log</string>
</dict>
</plist>
PLIST

  launchctl load "$plist_path" 2>/dev/null || true
  launchctl start com.claude-server-bot 2>/dev/null || true

  info "launchd service configured"
  echo "    Control: launchctl start/stop com.claude-server-bot"

  SERVICE_CREATED=true
  hint "Tip: log files at ${INSTALL_DIR}/data/claude-bot*.log — consider logrotate"
}

# ─── Step 10: Health Check ─────────────────────────────────────────────────
step_verify() {
  step "[10/$TOTAL_STEPS] Verifying ${BOT_NAME} is running..."

  local health_url
  local slug_path="/$BOT_PATH_PREFIX/$SLUG"

  # For health check, use localhost
  health_url="http://localhost:${PORT}${slug_path}/api/health/ping"

  echo "  Waiting for server to start..."
  sleep 3

  local healthy=false
  for attempt in $(seq 1 5); do
    echo -e "  ${DIM}Health check attempt ${attempt}/5...${NC}"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "$health_url" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
      healthy=true
      break
    fi
    sleep 2
  done

  if $healthy; then
    info "Health check passed!"
  else
    warn "Health check did not return 200. The server may still be starting."
    echo ""
    echo "  Troubleshooting tips:"
    if $SETUP_SERVICE; then
      echo "    - Check logs: sudo journalctl -u ${SERVICE_NAME} -f"
    else
      echo "    - Try starting manually: cd $INSTALL_DIR && pnpm start"
    fi
    echo "    - Verify port $PORT is not in use by another process"
    echo "    - Check .env file: cat $INSTALL_DIR/.env"
  fi

  NEXT_STEP=11
}

# ─── Step 11: Done ────────────────────────────────────────────────────────
step_done() {
  local full_url="$BASE_URL/$BOT_PATH_PREFIX/$SLUG"

  echo ""
  divider

  if true; then  # Always show celebrating mascot at the end
    mascot celebrating
  fi

  echo -e "${BOLD}  ${BOT_NAME} is live!${NC}"
  echo ""
  echo -e "  ${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "  ${BOLD}║  ${GREEN}Your Credentials${NC}${BOLD}                                          ║${NC}"
  echo -e "  ${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
  printf "  ${BOLD}║${NC}  URL:       ${CYAN}%-45s${NC}${BOLD}║${NC}\n" "$full_url"
  printf "  ${BOLD}║${NC}  Email:     %-45s${BOLD}║${NC}\n" "$ADMIN_EMAIL"
  printf "  ${BOLD}║${NC}  Password:  %-45s${BOLD}║${NC}\n" "$ADMIN_PASSWORD"
  echo -e "  ${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Try to copy password to clipboard
  if copy_to_clipboard "$ADMIN_PASSWORD"; then
    info "Password copied to clipboard!"
  fi

  echo -e "  ${RED}${BOLD}!! SAVE THIS PASSWORD — IT WILL NEVER BE SHOWN AGAIN !!${NC}"
  echo ""

  if $SETUP_SERVICE; then
    echo -e "  ${BOLD}Service commands:${NC}"
    if [ "$PLATFORM" = "macos" ]; then
      echo "    launchctl start com.claude-server-bot   # start"
      echo "    launchctl stop com.claude-server-bot    # stop"
      echo "    tail -f $INSTALL_DIR/data/claude-bot.log  # logs"
    else
      echo "    sudo systemctl status ${SERVICE_NAME}   # check status"
      echo "    sudo journalctl -u ${SERVICE_NAME} -f   # view logs"
      echo "    sudo systemctl restart ${SERVICE_NAME}   # restart"
    fi
  else
    echo -e "  ${BOLD}Start manually:${NC}"
    echo "    cd $INSTALL_DIR && pnpm start"
  fi

  echo ""
  echo -e "  ${BOLD}To update later:${NC}"
  echo "    cd $INSTALL_DIR && ./update.sh"
  echo ""

  if [ -n "${INSTALL_LOG:-}" ] && [ -f "$INSTALL_LOG" ]; then
    hint "Install log saved to: $INSTALL_LOG"
    echo ""
  fi

  mascot goodbye
  divider
  echo ""

  # Signal main loop to exit
  NEXT_STEP=0
}

# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════
main() {
  parse_args "$@"

  # Set up install log — capture all output
  INSTALL_LOG="/tmp/claude-bot-install.log"
  exec > >(tee -a "$INSTALL_LOG") 2>&1
  hint "Install log: $INSTALL_LOG"

  # Detect curl|bash pipe — refuse to run without a terminal unless --unattended
  if ! $UNATTENDED && [ ! -t 0 ]; then
    echo ""
    echo "ERROR: stdin is not a terminal."
    echo ""
    echo "  It looks like you're piping this script (e.g. curl | bash)."
    echo "  This installer requires interactive input."
    echo ""
    echo "  Instead, download and run it directly:"
    echo "    curl -fsSL <url> -o install.sh"
    echo "    bash install.sh"
    echo ""
    echo "  Or use non-interactive mode:"
    echo "    bash install.sh --unattended --bot-name=MyBot --email=admin@example.com --mode=vps --domain=bot.example.com"
    echo ""
    exit 1
  fi

  # Load config file if specified (CLI flags override)
  if [ -n "$CONFIG_FILE" ]; then
    load_config_file "$CONFIG_FILE"
  fi

  # Validate unattended mode has required fields
  if $UNATTENDED; then
    validate_unattended
  fi

  # Main step loop
  CURRENT_STEP=1
  while true; do
    NEXT_STEP=0

    case $CURRENT_STEP in
      1)  step_welcome ;;
      2)  step_prerequisites ;;
      3)  step_deploy_mode ;;
      4)  step_account ;;
      5)  step_project ;;
      6)  step_network ;;
      7)  step_confirm ;;
      8)  step_build ;;
      9)  step_service ;;
      10) step_verify ;;
      11) step_done ;;
      *)  break ;;
    esac

    # Exit if step_done signals completion
    if [ "$NEXT_STEP" -eq 0 ] && [ "$CURRENT_STEP" -eq 11 ]; then
      break
    fi

    # Navigate
    if [ "$NEXT_STEP" -gt 0 ]; then
      CURRENT_STEP=$NEXT_STEP
    else
      CURRENT_STEP=$((CURRENT_STEP + 1))
    fi
  done
}

main "$@"

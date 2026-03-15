#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
#  Claude Server Bot — Interactive Installer v3.0.0
#
#  Usage:
#    bash install.sh                          # Interactive mode
#    bash install.sh --unattended [options]   # Non-interactive mode
#    bash install.sh --dry-run [options]      # Preview without changes
#    bash install.sh --config install.conf    # Load from config file
#
#  Curl install (downloads first, then runs interactively):
#    curl -fsSL https://raw.githubusercontent.com/JckHamm3r/Claude-Server-Bot/main/install.sh | bash
# ─────────────────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/JckHamm3r/Claude-Server-Bot.git"
REPO_BRANCH="main"
SERVICE_NAME="claude-bot"
DEFAULT_PORT=3000
SCRIPT_VERSION="3.0.0"

# ─── Collected configuration (set by screen functions) ────────────────────
BOT_NAME=""
DEPLOY_MODE=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
PROJECT_ROOT=""
INSTALL_DIR=""
PORT="$DEFAULT_PORT"
DOMAIN=""
USE_HTTPS=false
HTTPS_METHOD=""
SETUP_NGINX=false
CERTBOT_EMAIL=""
SETUP_UFW=false
BASE_URL=""
SLUG=""
BOT_PATH_PREFIX=""
NEXTAUTH_SECRET=""
SETUP_SERVICE=false
SETUP_CF_TUNNEL=false

# ─── Platform detection results ────────────────────────────────────────────
PLATFORM=""
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
CLI_MODE="" CLI_BOT_NAME="" CLI_EMAIL="" CLI_DOMAIN="" CLI_HTTPS=""
CLI_PROJECT_ROOT="" CLI_PORT="" CLI_INSTALL_DIR="" CLI_PASSWORD=""
CLI_API_KEY=""

# ─── Step navigation ───────────────────────────────────────────────────────
CURRENT_SCREEN=1
NEXT_STEP=0
MAX_COLLECTION_STEP=3

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

prompt_input() {
  local question="$1"
  local default="${2:-}"
  if $UNATTENDED; then
    REPLY="$default"
    return 0
  fi
  local suffix=""
  [ -n "$default" ] && suffix=" [$default]"
  if [ "$CURRENT_SCREEN" -gt 1 ] && [ "$CURRENT_SCREEN" -le "$MAX_COLLECTION_STEP" ]; then
    hint "Type 'b' to go back"
  fi
  read -r -p "  ${question}${suffix}: " REPLY
  if [[ "$REPLY" == "b" || "$REPLY" == "B" ]] && [ "$CURRENT_SCREEN" -gt 1 ] && [ "$CURRENT_SCREEN" -le "$MAX_COLLECTION_STEP" ]; then
    NEXT_STEP=$((CURRENT_SCREEN - 1))
    return 1
  fi
  REPLY="${REPLY:-$default}"
  return 0
}

prompt_dir() {
  local question="$1"
  local default="${2:-}"
  if $UNATTENDED; then
    REPLY="$default"
    return 0
  fi
  if [ "$CURRENT_SCREEN" -gt 1 ] && [ "$CURRENT_SCREEN" -le "$MAX_COLLECTION_STEP" ]; then
    hint "Type 'b' to go back"
  fi
  hint "Tab completion is available for directory paths"
  read -e -i "$default" -p "  ${question}: " REPLY
  if [[ "$REPLY" == "b" || "$REPLY" == "B" ]] && [ "$CURRENT_SCREEN" -gt 1 ] && [ "$CURRENT_SCREEN" -le "$MAX_COLLECTION_STEP" ]; then
    NEXT_STEP=$((CURRENT_SCREEN - 1))
    return 1
  fi
  REPLY="${REPLY:-$default}"
  return 0
}

prompt_yn() {
  local question="$1"
  local default="${2:-n}"
  if $UNATTENDED; then
    [[ "$default" == "y" ]] && return 0 || return 1
  fi
  local hint_text=""
  [[ "$default" == "y" ]] && hint_text="[Y/n]" || hint_text="[y/N]"
  if [ "$CURRENT_SCREEN" -gt 1 ] && [ "$CURRENT_SCREEN" -le "$MAX_COLLECTION_STEP" ]; then
    hint "Type 'b' to go back"
  fi
  read -r -p "  ${question} ${hint_text}: " REPLY
  if [[ "$REPLY" == "b" || "$REPLY" == "B" ]] && [ "$CURRENT_SCREEN" -gt 1 ] && [ "$CURRENT_SCREEN" -le "$MAX_COLLECTION_STEP" ]; then
    NEXT_STEP=$((CURRENT_SCREEN - 1))
    return 2
  fi
  if [[ "$default" == "y" ]]; then
    [[ ! "$REPLY" =~ ^[Nn]$ ]] && return 0 || return 1
  else
    [[ "$REPLY" =~ ^[Yy]$ ]] && return 0 || return 1
  fi
}

# ─── Mascot: Zorp the Alien ───────────────────────────────────────────────
mascot() {
  local pose="${1:-greeting}"
  echo ""
  case "$pose" in
    greeting)
      printf "       ${CYAN}${BOLD}o   o${NC}\n"
      printf "       ${CYAN}${BOLD} \\ / ${NC}\n"
      printf "      ${CYAN}${BOLD}.-\"\"\"-.${NC}\n"
      printf "     ${CYAN}${BOLD}/ o   o \\\\${NC}   ${MAGENTA}~{ greetings, earthling }~${NC}\n"
      printf "     ${CYAN}${BOLD}|   ${GREEN}^${CYAN}${BOLD}   |${NC}\n"
      printf "     ${CYAN}${BOLD}|  '-'  |${NC}\n"
      printf "      ${CYAN}${BOLD}\\\\_____/${NC}\n"
      printf "      ${CYAN}${BOLD} |   |${NC}\n"
      case $((RANDOM % 3)) in
        0) echo -e "  ${CYAN}I come in peace. Mostly. Let's install some stuff.${NC}" ;;
        1) echo -e "  ${CYAN}Take me to your server. Actually, I'll just set one up.${NC}" ;;
        2) echo -e "  ${CYAN}Your planet's tech is... cute. Let me help with that.${NC}" ;;
      esac
      ;;
    working)
      printf "       ${YELLOW}${BOLD}~   ~${NC}\n"
      printf "       ${YELLOW}${BOLD} \\ / ${NC}\n"
      printf "      ${YELLOW}${BOLD}.-\"\"\"-.${NC}\n"
      printf "     ${YELLOW}${BOLD}/ -   - \\\\${NC}   ${DIM}*beaming data*${NC}\n"
      printf "     ${YELLOW}${BOLD}|   ${YELLOW}o${YELLOW}${BOLD}   |${NC}\n"
      printf "     ${YELLOW}${BOLD}|  '~'  |${NC}\n"
      printf "      ${YELLOW}${BOLD}\\\\_____/${NC}\n"
      printf "      ${YELLOW}${BOLD} |   |${NC}\n"
      case $((RANDOM % 3)) in
        0) echo -e "  ${YELLOW}Engaging hyperdrive... I mean, pnpm install.${NC}" ;;
        1) echo -e "  ${YELLOW}Shhh. Alien genius at work. No probing questions.${NC}" ;;
        2) echo -e "  ${YELLOW}On my planet this would take 0.003 seconds. Patience.${NC}" ;;
      esac
      ;;
    celebrating)
      printf "       ${GREEN}${BOLD}*   *${NC}\n"
      printf "       ${GREEN}${BOLD} \\ / ${NC}\n"
      printf "      ${GREEN}${BOLD}.-\"\"\"-.${NC}\n"
      printf "    ${GREEN}${BOLD}\\\\/ ^   ^ \\\\/${NC}   ${GREEN}~{ MISSION COMPLETE }~${NC}\n"
      printf "     ${GREEN}${BOLD}|   ${GREEN}v${GREEN}${BOLD}   |${NC}\n"
      printf "     ${GREEN}${BOLD}|  'v'  |${NC}\n"
      printf "      ${GREEN}${BOLD}\\\\_____/${NC}\n"
      printf "      ${GREEN}${BOLD} |   |${NC}\n"
      case $((RANDOM % 3)) in
        0) echo -e "  ${GREEN}WOOOO! *does zero-gravity victory dance*${NC}" ;;
        1) echo -e "  ${GREEN}Another successful deployment across the galaxy!${NC}" ;;
        2) echo -e "  ${GREEN}Nailed it. I'm putting this on my space resume.${NC}" ;;
      esac
      ;;
    error)
      printf "       ${RED}${BOLD}!   !${NC}\n"
      printf "       ${RED}${BOLD} \\ / ${NC}\n"
      printf "      ${RED}${BOLD}.-\"\"\"-.${NC}\n"
      printf "     ${RED}${BOLD}/ x   x \\\\${NC}   ${RED}~{ MAYDAY MAYDAY }~${NC}\n"
      printf "     ${RED}${BOLD}|   ${RED}o${RED}${BOLD}   |${NC}\n"
      printf "     ${RED}${BOLD}|  '~'  |${NC}\n"
      printf "      ${RED}${BOLD}\\\\_____/${NC}\n"
      printf "      ${RED}${BOLD} |   |${NC}\n"
      case $((RANDOM % 3)) in
        0) echo -e "  ${RED}Houston, we have a problem. And I'm not even from Houston.${NC}" ;;
        1) echo -e "  ${RED}*antenna sparking* This was NOT in the mission briefing!${NC}" ;;
        2) echo -e "  ${RED}Uh oh. Deploying emergency protocols. Don't panic.${NC}" ;;
      esac
      ;;
    goodbye)
      printf "       ${DIM}${BOLD}.   .${NC}\n"
      printf "       ${DIM}${BOLD} \\ / ${NC}\n"
      printf "      ${DIM}${BOLD}.-\"\"\"-.${NC}\n"
      printf "     ${DIM}${BOLD}/ o   o \\\\${NC}   ${DIM}~{ transmission ending }~${NC}\n"
      printf "     ${DIM}${BOLD}|   ${DIM}^${DIM}${BOLD}   |${NC}\n"
      printf "     ${DIM}${BOLD}|  '.'  |${NC}\n"
      printf "      ${DIM}${BOLD}\\\\_____/${NC}\n"
      printf "      ${DIM}${BOLD} |   |${NC}\n"
      case $((RANDOM % 3)) in
        0) echo -e "  ${DIM}Beaming back to the mothership. Don't forget your password.${NC}" ;;
        1) echo -e "  ${DIM}See you, space cowboy. I'll be watching from orbit.${NC}" ;;
        2) echo -e "  ${DIM}Zorp out. *vanishes in a puff of stardust*${NC}" ;;
      esac
      ;;
    *)
      printf "      ${BOLD}.-\"\"\"-.${NC}\n"
      printf "     ${BOLD}/ ?   ? \\\\${NC}\n"
      printf "     ${BOLD}|   o   |${NC}\n"
      printf "      ${BOLD}\\\\_____/${NC}\n"
      echo -e "  ${DIM}*confused alien noises*${NC}"
      ;;
  esac
  echo ""
}

# ─── Quips & spinner ──────────────────────────────────────────────────────
QUIPS=(
  "Reticulating splines..."
  "Teaching robots to love..."
  "Downloading more RAM..."
  "Convincing electrons to cooperate..."
  "Warming up the flux capacitor..."
  "Asking Claude nicely..."
  "Compiling compliments..."
  "Feeding the hamsters that power the server..."
  "Bribing the compiler..."
  "Negotiating with pnpm..."
  "Performing calculations... just kidding, it's JavaScript..."
  "Consulting the ancient scrolls of Stack Overflow..."
  "Summoning the mass of node_modules..."
  "Polishing the pixels..."
  "Untangling the spaghetti code..."
  "Charging the laser sharks..."
  "Waking up the server gnomes..."
  "Counting backwards from infinity..."
  "Dividing by zero... carefully..."
  "Generating witty loading messages..."
  "Herding cats (they're feral)..."
  "Calibrating the sassiness module..."
  "Debugging the debugger..."
  "Turning it off and on again..."
  "Calibrating the alien antennae..."
  "Tip: Use CLAUDE.md to give your bot project context"
  "Tip: The bot auto-saves chat sessions to SQLite"
  "Tip: You can run multiple agents in parallel"
  "Tip: Guard rails protect sensitive files by default"
  "Tip: Check Settings to configure rate limits and budgets"
  "Tip: Customize bot personality in Settings"
  "Tip: IP protection blocks brute-force logins automatically"
  "Tip: Upload files directly in chat with drag-and-drop"
  "Tip: Export chat sessions from the toolbar"
  "Tip: The update script at ./update.sh supports rollback"
)

SPINNER_PID=""
start_spinner() {
  if $UNATTENDED; then return; fi
  (
    local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0
    local msg_i=0
    local quip_count=${#QUIPS[@]}
    while true; do
      local char="${chars:$((i % ${#chars})):1}"
      local msg="${QUIPS[$((msg_i % quip_count))]}"
      printf "\r  ${CYAN}%s${NC} ${DIM}%s${NC}   \033[K" "$char" "$msg"
      i=$((i + 1))
      if (( i % 16 == 0 )); then
        msg_i=$((msg_i + 1))
      fi
      sleep 0.2
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
    printf "\r\033[K"
  fi
}

# ─── Progress bar ─────────────────────────────────────────────────────────
progress_bar() {
  local percent="$1"
  local phase_label="$2"
  local bar_width=30
  local filled_count=$((bar_width * percent / 100))
  local empty_count=$((bar_width - filled_count))
  local filled=""
  local empty=""
  [ "$filled_count" -gt 0 ] && filled=$(printf '%*s' "$filled_count" '' | tr ' ' '█')
  [ "$empty_count" -gt 0 ] && empty=$(printf '%*s' "$empty_count" '' | tr ' ' '░')
  printf "\r  ${BOLD}[${GREEN}%s${DIM}%s${NC}${BOLD}]${NC} ${CYAN}%3d%%${NC} — ${BOLD}%s${NC}\033[K" \
    "$filled" "$empty" "$percent" "$phase_label"
}

run_cmd() {
  if $VERBOSE; then "$@"; else "$@" 2>/dev/null; fi
}

safe_rm_install_dir() {
  if [ -z "$INSTALL_DIR" ] || [ "$INSTALL_DIR" = "/" ] || [ "$INSTALL_DIR" = "$HOME" ]; then
    error "Refusing to delete '$INSTALL_DIR' — safety check failed"
    exit 1
  fi
  rm -rf "$INSTALL_DIR"
}

# ─── Cleanup on exit ──────────────────────────────────────────────────────
cleanup_on_exit() {
  stop_spinner
  rmdir /tmp/claude-bot-install.lock 2>/dev/null || true
  if $INSTALL_IN_PROGRESS && ! $DRY_RUN; then
    if $CLONE_DONE && [ -d "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/.next/BUILD_ID" ]; then
      echo ""
      mascot error
      error "Installation failed before completing build."
      [ -n "${INSTALL_LOG:-}" ] && [ -f "$INSTALL_LOG" ] && echo "  Install log: $INSTALL_LOG"
      if $UNATTENDED; then
        echo "  Cleaning up partial install..."
        safe_rm_install_dir
      else
        read -r -p "  Remove partial install at $INSTALL_DIR? [Y/n]: " REPLY
        [[ ! "$REPLY" =~ ^[Nn]$ ]] && safe_rm_install_dir && info "Cleaned up partial install"
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
    Darwin) PLATFORM="macos" ;;
    Linux)
      if grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
        PLATFORM="wsl"
      else
        PLATFORM="linux"
      fi
      ;;
    *) PLATFORM="linux" ;;
  esac
}

detect_pkg_manager() {
  case "$PLATFORM" in
    macos)
      if command -v brew &>/dev/null; then
        PKG_MGR="brew"; PKG_INSTALL="brew install"; PKG_UPDATE=""
      fi
      ;;
    *)
      if command -v apt-get &>/dev/null; then
        PKG_MGR="apt"; PKG_INSTALL="sudo apt-get install -y"; PKG_UPDATE="sudo apt-get update -qq"
      elif command -v dnf &>/dev/null; then
        PKG_MGR="dnf"; PKG_INSTALL="sudo dnf install -y"; PKG_UPDATE=""
      elif command -v yum &>/dev/null; then
        PKG_MGR="yum"; PKG_INSTALL="sudo yum install -y"; PKG_UPDATE=""
      fi
      ;;
  esac
}

install_pkg() {
  if [ -z "$PKG_INSTALL" ]; then
    error "No supported package manager found. Install '$1' manually."
    return 1
  fi
  [ -n "${PKG_UPDATE:-}" ] && $PKG_UPDATE 2>/dev/null || true
  $PKG_INSTALL "$@"
}

# ─── Utility functions ─────────────────────────────────────────────────────
check_sudo() {
  if sudo -n true 2>/dev/null; then return 0; fi
  echo "  sudo access is required. You may be prompted for your password."
  if sudo -v; then return 0; fi
  error "sudo access is required but is not available."
  return 1
}

get_local_ip() {
  case "$PLATFORM" in
    macos) ipconfig getifaddr en0 2>/dev/null || echo "localhost" ;;
    *)     hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost" ;;
  esac
}

get_public_ip() {
  local token
  token=$(curl -sf --max-time 2 -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 5" \
    http://169.254.169.254/latest/api/token 2>/dev/null) || true
  if [ -n "$token" ]; then
    curl -sf --max-time 2 -H "X-aws-ec2-metadata-token: $token" \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null && return
  fi
  curl -sf --max-time 3 https://api.ipify.org 2>/dev/null && return
  curl -sf --max-time 3 https://ifconfig.me 2>/dev/null && return
  echo ""
}

copy_to_clipboard() {
  local text="$1"
  local clip_cmd=""
  if [ "$PLATFORM" = "macos" ]; then
    clip_cmd="$(command -v pbcopy 2>/dev/null)"
  fi
  [ -z "$clip_cmd" ] && clip_cmd="$(command -v xclip 2>/dev/null)"
  [ -z "$clip_cmd" ] && clip_cmd="$(command -v wl-copy 2>/dev/null)"
  [ -z "$clip_cmd" ] && clip_cmd="$(command -v xsel 2>/dev/null)"
  if [ -n "$clip_cmd" ]; then
    echo -n "$text" | "$clip_cmd" 2>/dev/null && return 0
  fi
  return 1
}

validate_bot_name() {
  local name="$1"
  if [ ${#name} -lt 2 ] || [ ${#name} -gt 20 ]; then
    echo "Must be 2-20 characters long"; return 1
  fi
  if ! [[ "$name" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]; then
    echo "Only letters, numbers, and hyphens allowed (no leading/trailing hyphens)"; return 1
  fi
  if [[ "$name" =~ -- ]]; then echo "No consecutive hyphens allowed"; return 1; fi
  return 0
}

validate_email() {
  [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]
}

validate_port() {
  local port="$1"
  if ! [[ "$port" =~ ^[0-9]+$ ]]; then echo "Port must be a number"; return 1; fi
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then echo "Port must be between 1 and 65535"; return 1; fi
  if [ "$port" -lt 1024 ] && [ "$(id -u)" -ne 0 ]; then echo "Ports below 1024 require root"; return 1; fi
  return 0
}

check_port_available() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -tlnp 2>/dev/null | grep -q ":${port} " && return 1
  elif command -v lsof &>/dev/null; then
    lsof -i ":${port}" -sTCP:LISTEN &>/dev/null && return 1
  fi
  return 0
}

port_listener_info() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -tlnp 2>/dev/null | grep ":${port} " | head -3
  elif command -v lsof &>/dev/null; then
    lsof -i ":${port}" -sTCP:LISTEN 2>/dev/null | head -3
  fi
}

get_port_listener_pids() {
  local port="$1"
  if command -v lsof &>/dev/null; then
    lsof -t -i ":${port}" -sTCP:LISTEN 2>/dev/null | awk '!seen[$0]++'
    return 0
  fi
  if command -v ss &>/dev/null; then
    ss -tlnp 2>/dev/null | grep ":${port} " | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | awk '!seen[$0]++'
    return 0
  fi
}

kill_port_listener() {
  local port="$1"
  local pids
  pids="$(get_port_listener_pids "$port" | tr '\n' ' ' | xargs 2>/dev/null || true)"
  [ -z "$pids" ] && return 1
  local pid
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  sleep 1
  check_port_available "$port" && return 0
  for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
  sleep 1
  check_port_available "$port"
}

suggest_port() {
  local base="${1:-3000}"
  local port=$base
  while ! check_port_available "$port"; do
    port=$((port + 1))
    [ "$port" -gt $((base + 100)) ] && { echo "$base"; return 1; }
  done
  echo "$port"
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
      --api-key)        shift; CLI_API_KEY="$1" ;;
      --api-key=*)      CLI_API_KEY="${1#*=}" ;;
      --help|-h)     show_help; exit 0 ;;
      *)             error "Unknown option: $1"; echo "  Run 'bash install.sh --help'"; exit 1 ;;
    esac
    shift
  done
}

show_help() {
  cat <<'HELP'
Claude Server Bot — Installer v3.0.0

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
  --domain <domain>     Domain name (optional)
  --https <method>      HTTPS method: letsencrypt, cloudflare, none
  --project-root <dir>  Working directory for Claude
  --port <port>         Server port (default: 3000)
  --install-dir <dir>   Installation directory
  --password <pass>     Admin password (min 12 chars; auto-generated if omitted)
  --api-key <key>       Anthropic API key (sk-ant-...) — enables SDK provider
  --verbose             Show full command output
  -h, --help            Show this help

HELP
}

load_config_file() {
  local file="$1"
  [ ! -f "$file" ] && { error "Config file not found: $file"; exit 1; }
  while IFS='=' read -r key value; do
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
      api_key)       [ -z "$CLI_API_KEY" ] && CLI_API_KEY="$value" ;;
    esac
  done < "$file"
}

validate_unattended() {
  local missing=()
  [ -z "$CLI_MODE" ] && missing+=("--mode")
  [ -z "$CLI_BOT_NAME" ] && missing+=("--bot-name")
  [ -z "$CLI_EMAIL" ] && missing+=("--email")
  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing required fields for unattended mode:"
    for field in "${missing[@]}"; do echo "    $field"; done
    exit 1
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
#  SCREEN 1: Welcome + Name
# ═══════════════════════════════════════════════════════════════════════════════
screen_welcome() {
  CURRENT_SCREEN=1
  clear 2>/dev/null || true
  divider
  echo -e "${BOLD}       Claude Server Bot — Installer v${SCRIPT_VERSION}${NC}"
  divider

  mascot greeting

  detect_platform
  detect_pkg_manager

  # Compact system info
  local os_info=""
  if [ "$PLATFORM" = "macos" ]; then
    os_info="$(sw_vers -productName 2>/dev/null || echo 'macOS') $(sw_vers -productVersion 2>/dev/null || echo '')"
  elif [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    os_info="$(. /etc/os-release && echo "${PRETTY_NAME:-$NAME}")"
  else
    os_info="$(uname -s)"
  fi
  local node_ver=""
  command -v node &>/dev/null && node_ver="$(node --version)" || node_ver="not installed"
  local disk_free=""
  disk_free="$(df -h "${HOME}" 2>/dev/null | awk 'NR==2 {print $4}' || echo '?')"
  echo -e "  ${DIM}$PLATFORM ($os_info) | Node: $node_ver | Disk: ${disk_free} free${NC}"
  echo ""

  if [ "$PLATFORM" = "wsl" ]; then
    warn "WSL detected — use WSL filesystem paths (not /mnt/c/) for best performance."
  fi

  # Bot name
  if [ -n "$CLI_BOT_NAME" ]; then
    BOT_NAME="$CLI_BOT_NAME"
    local err
    if ! err="$(validate_bot_name "$BOT_NAME")"; then
      error "Invalid bot name '$BOT_NAME': $err"; exit 1
    fi
  else
    echo -e "  ${BOLD}What should we call your bot?${NC}"
    hint "This name appears in the UI and URL (e.g. Jarvis, Friday, Botsworth)"
    echo ""
    while true; do
      if ! prompt_input "Bot name" "Claude-Bot"; then continue; fi
      BOT_NAME="$REPLY"
      local err
      if err="$(validate_bot_name "$BOT_NAME")"; then break; fi
      error "$err"
    done
  fi
  info "Nice to meet you, ${BOLD}${BOT_NAME}${NC}!"
  echo ""

  # Deploy mode
  if [ -n "$CLI_MODE" ]; then
    DEPLOY_MODE="$CLI_MODE"
  else
    echo -e "  ${BOLD}Where will ${BOT_NAME} live?${NC}"
    echo -e "    ${BOLD}1)${NC} Production server ${DIM}(VPS/cloud — includes systemd, nginx, HTTPS)${NC}"
    echo -e "    ${BOLD}2)${NC} Local machine     ${DIM}(dev, home server, Raspberry Pi)${NC}"
    echo ""
    if ! prompt_input "Choice" "1"; then continue; fi
    case "$REPLY" in
      1|vps)   DEPLOY_MODE="vps" ;;
      2|local) DEPLOY_MODE="local" ;;
      *)       error "Pick 1 or 2."; NEXT_STEP=1; return ;;
    esac
  fi
  info "Deploy mode: $DEPLOY_MODE"

  if [ "$DEPLOY_MODE" = "vps" ]; then
    check_sudo || { error "VPS mode requires sudo."; NEXT_STEP=1; return; }
  fi

  NEXT_STEP=2
}

# ═══════════════════════════════════════════════════════════════════════════════
#  SCREEN 2: Configure
# ═══════════════════════════════════════════════════════════════════════════════
screen_configure() {
  CURRENT_SCREEN=2
  clear 2>/dev/null || true
  divider
  echo -e "${BOLD}       Configure ${BOT_NAME}${NC}"
  divider
  echo ""

  # Admin email
  if [ -n "$CLI_EMAIL" ]; then
    ADMIN_EMAIL="$CLI_EMAIL"
    validate_email "$ADMIN_EMAIL" || { error "Invalid email: $ADMIN_EMAIL"; exit 1; }
  else
    while true; do
      if ! prompt_input "Admin email" ""; then NEXT_STEP=1; return; fi
      ADMIN_EMAIL="$REPLY"
      [ -z "$ADMIN_EMAIL" ] && { error "Email is required."; continue; }
      validate_email "$ADMIN_EMAIL" || { error "Invalid email format."; continue; }
      break
    done
  fi
  info "Email: $ADMIN_EMAIL"

  # Project directory
  local default_project="${CLI_PROJECT_ROOT:-$PWD}"
  if [ -n "$CLI_PROJECT_ROOT" ]; then
    PROJECT_ROOT="$CLI_PROJECT_ROOT"
  else
    echo ""
    if ! prompt_dir "Project directory (where Claude works)" "$default_project"; then
      NEXT_STEP=1; return
    fi
    PROJECT_ROOT="$REPLY"
  fi
  PROJECT_ROOT="${PROJECT_ROOT/#\~/$HOME}"
  if [ ! -d "$PROJECT_ROOT" ]; then
    error "Directory '$PROJECT_ROOT' does not exist."
    NEXT_STEP=$CURRENT_SCREEN; return
  fi
  info "Project: $PROJECT_ROOT"
  [ -f "$PROJECT_ROOT/CLAUDE.md" ] && info "CLAUDE.md found — project context available"

  INSTALL_DIR="${CLI_INSTALL_DIR:-$HOME/claude-server-bot}"
  INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"

  # Port
  echo ""
  local default_port="${CLI_PORT:-$DEFAULT_PORT}"
  if [ -z "$CLI_PORT" ]; then
    if ! check_port_available "$default_port"; then
      local suggested
      suggested="$(suggest_port "$default_port")"
      warn "Port $default_port is in use."
      local linfo
      linfo="$(port_listener_info "$default_port")"
      [ -n "$linfo" ] && hint "$linfo"
      hint "Type 'y' to kill and reclaim, or Enter for port $suggested"
      local reclaim_choice
      read -r -p "  Reclaim port $default_port? [y/N]: " reclaim_choice
      if [[ "$reclaim_choice" == "b" || "$reclaim_choice" == "B" ]]; then
        NEXT_STEP=1; return
      fi
      if [[ "$reclaim_choice" == "y" || "$reclaim_choice" == "Y" ]]; then
        kill_port_listener "$default_port" && info "Reclaimed port $default_port" || default_port="$suggested"
      else
        default_port="$suggested"
      fi
    fi
    if ! prompt_input "Port" "$default_port"; then NEXT_STEP=1; return; fi
    PORT="$REPLY"
  else
    PORT="$CLI_PORT"
  fi
  local port_err
  port_err="$(validate_port "$PORT")" || { error "$port_err"; NEXT_STEP=$CURRENT_SCREEN; return; }

  if ! check_port_available "$PORT"; then
    warn "Port $PORT is in use."
    local kill_result
    prompt_yn "Kill process and continue?" "n" && kill_result=0 || kill_result=$?
    [ "$kill_result" -eq 2 ] && { NEXT_STEP=1; return; }
    [ "$kill_result" -eq 0 ] && { kill_port_listener "$PORT" && info "Reclaimed" || warn "Could not reclaim."; }
  fi
  info "Port: $PORT"

  # Domain
  echo ""
  DOMAIN=""
  USE_HTTPS=false
  HTTPS_METHOD=""
  SETUP_NGINX=false
  SETUP_UFW=false
  SETUP_CF_TUNNEL=false

  if [ -n "$CLI_DOMAIN" ]; then
    DOMAIN="$CLI_DOMAIN"
  else
    local has_domain_result
    prompt_yn "Do you have a domain name? (optional — can add later)" "n" && has_domain_result=0 || has_domain_result=$?
    [ "$has_domain_result" -eq 2 ] && { NEXT_STEP=1; return; }
    if [ "$has_domain_result" -eq 0 ]; then
      if ! prompt_input "Domain" ""; then NEXT_STEP=1; return; fi
      DOMAIN="$REPLY"
    fi
  fi

  if [ -n "$DOMAIN" ]; then
    info "Domain: $DOMAIN"
    local dns_resolved=false
    command -v dig &>/dev/null && dig +short "$DOMAIN" 2>/dev/null | grep -q '.' && dns_resolved=true
    command -v host &>/dev/null && ! $dns_resolved && host "$DOMAIN" &>/dev/null && dns_resolved=true
    ! $dns_resolved && warn "Domain doesn't resolve yet — configure DNS before requesting certs."

    if [ -n "$CLI_HTTPS" ]; then
      case "$CLI_HTTPS" in
        letsencrypt) USE_HTTPS=true; HTTPS_METHOD="letsencrypt"; SETUP_NGINX=true ;;
        cloudflare)  USE_HTTPS=true; HTTPS_METHOD="cloudflare"; SETUP_CF_TUNNEL=true ;;
        *)           USE_HTTPS=true; HTTPS_METHOD="selfsigned" ;;
      esac
    else
      echo ""
      echo -e "  ${BOLD}HTTPS method:${NC}"
      echo -e "    ${BOLD}1)${NC} nginx + Let's Encrypt ${DIM}(recommended)${NC}"
      echo -e "    ${BOLD}2)${NC} Cloudflare Tunnel     ${DIM}(no port exposure)${NC}"
      echo -e "    ${BOLD}3)${NC} Self-signed            ${DIM}(browser warning)${NC}"
      echo ""
      if ! prompt_input "Choice" "1"; then NEXT_STEP=1; return; fi
      case "$REPLY" in
        1) USE_HTTPS=true; HTTPS_METHOD="letsencrypt"; SETUP_NGINX=true; CERTBOT_EMAIL="$ADMIN_EMAIL" ;;
        2) USE_HTTPS=true; HTTPS_METHOD="cloudflare"; SETUP_CF_TUNNEL=true ;;
        *) USE_HTTPS=true; HTTPS_METHOD="selfsigned" ;;
      esac
    fi

    if $SETUP_NGINX && [ "$PLATFORM" != "macos" ]; then
      local ufw_result
      prompt_yn "Enable UFW firewall (ports 80, 443)?" "y" && ufw_result=0 || ufw_result=$?
      [ "$ufw_result" -eq 2 ] && { NEXT_STEP=1; return; }
      [ "$ufw_result" -eq 0 ] && SETUP_UFW=true
    fi
  fi

  # Compute BASE_URL
  if [ -n "$DOMAIN" ]; then
    BASE_URL="https://$DOMAIN"
  else
    local private_ip public_ip server_ip
    private_ip="$(get_local_ip)"
    public_ip="$(get_public_ip)"
    if $UNATTENDED; then
      server_ip="${public_ip:-$private_ip}"
    elif [ -n "$public_ip" ] && [ "$public_ip" != "$private_ip" ]; then
      echo ""
      echo -e "  ${BOLD}Which IP for remote access?${NC}"
      echo -e "    ${BOLD}1)${NC} Public:  ${GREEN}$public_ip${NC}"
      echo -e "    ${BOLD}2)${NC} Private: $private_ip"
      echo ""
      if ! prompt_input "Choice" "1"; then NEXT_STEP=1; return; fi
      case "$REPLY" in
        1) server_ip="$public_ip" ;;
        2) server_ip="$private_ip" ;;
        *) server_ip="$public_ip" ;;
      esac
    else
      server_ip="${public_ip:-$private_ip}"
    fi
    USE_HTTPS=true
    HTTPS_METHOD="${HTTPS_METHOD:-selfsigned}"
    BASE_URL="https://${server_ip}:${PORT}"
  fi
  info "Base URL: $BASE_URL"

  NEXT_STEP=3
}

# ═══════════════════════════════════════════════════════════════════════════════
#  SCREEN 3: Confirm & Go
# ═══════════════════════════════════════════════════════════════════════════════
screen_confirm() {
  CURRENT_SCREEN=3
  clear 2>/dev/null || true
  divider
  echo -e "${BOLD}       Ready to install ${BOT_NAME}${NC}"
  divider
  echo ""

  SLUG=$(openssl rand -base64 96 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c64)
  BOT_PATH_PREFIX=$(echo "$BOT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')
  NEXTAUTH_SECRET=$(openssl rand -base64 32 2>/dev/null)
  if [ -z "$NEXTAUTH_SECRET" ] || [ ${#NEXTAUTH_SECRET} -lt 32 ]; then
    error "Failed to generate NEXTAUTH_SECRET (got ${#NEXTAUTH_SECRET} chars, need ≥32)"
    exit 1
  fi

  # Generate password now
  if [ -n "$CLI_PASSWORD" ]; then
    if [ ${#CLI_PASSWORD} -lt 12 ]; then
      error "Password must be at least 12 characters."; exit 1
    fi
    ADMIN_PASSWORD="$CLI_PASSWORD"
  else
    ADMIN_PASSWORD=""
    for _ in $(seq 1 5); do
      ADMIN_PASSWORD=$(openssl rand -base64 64 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c32)
      [ ${#ADMIN_PASSWORD} -eq 32 ] && break
    done
    [ ${#ADMIN_PASSWORD} -ne 32 ] && { error "Failed to generate password"; exit 1; }
  fi

  local full_url="$BASE_URL/$BOT_PATH_PREFIX/$SLUG"
  local mode_display=""
  case "$DEPLOY_MODE" in vps) mode_display="VPS (Production)" ;; local) mode_display="Local" ;; esac
  local https_display="Self-signed"
  $USE_HTTPS && case "$HTTPS_METHOD" in
    letsencrypt) https_display="Let's Encrypt" ;;
    cloudflare)  https_display="Cloudflare Tunnel" ;;
    selfsigned)  https_display="Self-signed" ;;
  esac

  echo -e "  ${BOLD}Bot name:${NC}    $BOT_NAME"
  echo -e "  ${BOLD}Mode:${NC}        $mode_display"
  echo -e "  ${BOLD}Admin:${NC}       $ADMIN_EMAIL"
  echo -e "  ${BOLD}Project:${NC}     $PROJECT_ROOT"
  echo -e "  ${BOLD}Install to:${NC}  $INSTALL_DIR"
  echo -e "  ${BOLD}Port:${NC}        $PORT"
  echo -e "  ${BOLD}Domain:${NC}      ${DOMAIN:-—}"
  echo -e "  ${BOLD}HTTPS:${NC}       $https_display"
  echo ""
  echo -e "  ${BOLD}URL:${NC} ${CYAN}${full_url}${NC}"
  echo ""

  if $DRY_RUN; then
    echo -e "  ${YELLOW}${BOLD}DRY RUN — no changes will be made.${NC}"
    echo ""
    echo "  Would: clone repo, install deps, generate .env, build"
    $SETUP_NGINX && echo "  Would: configure nginx + Let's Encrypt"
    $SETUP_CF_TUNNEL && echo "  Would: set up Cloudflare Tunnel"
    [ "$DEPLOY_MODE" = "vps" ] && echo "  Would: set up systemd service"
    echo ""
    exit 0
  fi

  local confirm_result
  prompt_yn "Ready to install?" "y" && confirm_result=0 || confirm_result=$?
  if [ "$confirm_result" -eq 2 ]; then NEXT_STEP=2; return; fi
  if [ "$confirm_result" -ne 0 ]; then echo "  Installation cancelled."; exit 0; fi

  NEXT_STEP=4
}

# ═══════════════════════════════════════════════════════════════════════════════
#  PREREQUISITES (batch check + single confirm)
# ═══════════════════════════════════════════════════════════════════════════════
check_and_install_prerequisites() {
  local missing=()
  local need_node=false need_pnpm=false need_git=false need_openssl=false need_build_tools=false

  if ! command -v node &>/dev/null; then
    need_node=true
  else
    local node_major
    node_major=$(node --version | sed 's/v//' | cut -d. -f1)
    [ "${node_major:-0}" -lt 20 ] && need_node=true
  fi
  $need_node && missing+=("Node.js 20+")

  command -v pnpm &>/dev/null || { need_pnpm=true; missing+=("pnpm"); }
  command -v git &>/dev/null || { need_git=true; missing+=("git"); }
  command -v openssl &>/dev/null || { need_openssl=true; missing+=("openssl"); }
  { command -v make &>/dev/null && command -v g++ &>/dev/null; } || { need_build_tools=true; missing+=("build tools (make, g++)"); }

  if [ ${#missing[@]} -eq 0 ]; then
    info "All prerequisites satisfied"
    return 0
  fi

  echo ""
  warn "Missing prerequisites:"
  for m in "${missing[@]}"; do echo -e "    ${YELLOW}•${NC} $m"; done
  echo ""

  if ! $UNATTENDED; then
    local install_result
    prompt_yn "Install all missing tools now?" "y" && install_result=0 || install_result=$?
    if [ "$install_result" -ne 0 ]; then
      error "Prerequisites are required. Install manually and re-run."
      exit 1
    fi
  fi

  if $need_node; then
    echo "  Installing Node.js 20..."
    # SECURITY NOTE: These NodeSource setup scripts are piped to bash, which carries inherent
    # supply-chain risk. For higher security, consider installing Node.js via nvm instead:
    #   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    #   nvm install 20
    case "$PKG_MGR" in
      apt)  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs ;;
      dnf)  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo dnf install -y nodejs ;;
      yum)  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install -y nodejs ;;
      brew) brew install node@20 ;;
      *)    error "No package manager for Node.js. Install manually."; exit 1 ;;
    esac
    command -v node &>/dev/null || { error "Node.js installation failed."; exit 1; }
    info "Node.js $(node --version) installed"
  fi

  if $need_pnpm; then
    echo "  Installing pnpm..."
    sudo npm install -g pnpm
    info "pnpm installed"
  fi

  if $need_git; then
    echo "  Installing git..."
    install_pkg git
    info "git installed"
  fi

  if $need_openssl; then
    echo "  Installing openssl..."
    install_pkg openssl
    info "openssl installed"
  fi

  if $need_build_tools; then
    echo "  Installing build tools..."
    case "$PKG_MGR" in
      apt)  sudo apt-get install -y build-essential python3 ;;
      dnf)  sudo dnf groupinstall -y "Development Tools" && sudo dnf install -y python3 ;;
      yum)  sudo yum groupinstall -y "Development Tools" && sudo yum install -y python3 ;;
      brew) xcode-select --install 2>/dev/null || true ;;
      *)    warn "Install make/g++ manually for native modules" ;;
    esac
    info "Build tools installed"
  fi

  # Disk space
  local avail_kb
  avail_kb=$(df -k . 2>/dev/null | awk 'NR==2 {print $4}')
  if [ "${avail_kb:-0}" -lt 512000 ]; then
    error "Insufficient disk space (need 500 MB minimum)"
    exit 1
  fi

  info "All prerequisites satisfied"
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
#  ENV GENERATION
# ═══════════════════════════════════════════════════════════════════════════════
generate_env() {
  local config_file
  config_file="$(mktemp)"
  node -e "
const fs = require('fs');
const config = {
  password: process.argv[1],
  port: process.argv[2],
  baseUrl: process.argv[3],
  slug: process.argv[4],
  secret: process.argv[5],
  email: process.argv[6],
  projectRoot: process.argv[7],
  installDir: process.argv[8],
  botName: process.argv[9],
  pathPrefix: process.argv[10]
};
fs.writeFileSync(process.argv[11], JSON.stringify(config));
" "$ADMIN_PASSWORD" "$PORT" "$BASE_URL" "$SLUG" "$NEXTAUTH_SECRET" \
  "$ADMIN_EMAIL" "$PROJECT_ROOT" "$INSTALL_DIR" "$BOT_NAME" "$BOT_PATH_PREFIX" "$config_file"

  if [ $? -ne 0 ] || [ ! -s "$config_file" ]; then
    rm -f "$config_file"
    error "Failed to serialize configuration"
    exit 1
  fi

  local gen_output
  gen_output="$(node "$INSTALL_DIR/scripts/generate-env.js" "$config_file" 2>&1)"
  local gen_exit=$?
  rm -f "$config_file"

  if [ "$gen_exit" -ne 0 ]; then
    error "Failed to generate .env file!"
    echo "  $gen_output"
    exit 1
  fi

  [ ! -f "$INSTALL_DIR/.env" ] && { error ".env file was not created"; exit 1; }
  info ".env generated"

  echo "  Verifying credentials..."
  local verify_output
  verify_output="$(echo "$ADMIN_PASSWORD" | node "$INSTALL_DIR/scripts/verify-credentials.js" "$INSTALL_DIR/.env" 2>&1)"
  local verify_exit=$?

  if [ "$verify_exit" -ne 0 ]; then
    error "Credential verification FAILED!"
    echo "  $verify_output"
    exit 1
  fi
  info "Credentials verified"

  # Write API key to .env if provided
  if [ -n "${CLI_API_KEY:-}" ]; then
    echo "ANTHROPIC_API_KEY=$CLI_API_KEY" >> "$INSTALL_DIR/.env"
    info "Anthropic API key added to .env"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
#  SERVICE SETUP (systemd, launchd, nginx, certs, cloudflare)
# ═══════════════════════════════════════════════════════════════════════════════
generate_selfsigned_cert() {
  local cert_dir="$INSTALL_DIR/certs"
  mkdir -p "$cert_dir"
  local cert_cn="${DOMAIN:-$1}"
  [ -z "$cert_cn" ] && cert_cn="localhost"
  local san="DNS:$cert_cn,DNS:localhost"
  [[ "$cert_cn" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && san="IP:$cert_cn,IP:127.0.0.1,DNS:localhost"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$cert_dir/key.pem" -out "$cert_dir/cert.pem" -days 365 \
    -subj "/CN=$cert_cn" -addext "subjectAltName=$san" 2>/dev/null
  chmod 600 "$cert_dir/key.pem"
  chmod 644 "$cert_dir/cert.pem"
  if [ -f "$INSTALL_DIR/.env" ]; then
    echo "SSL_CERT_PATH=$cert_dir/cert.pem" >> "$INSTALL_DIR/.env"
    echo "SSL_KEY_PATH=$cert_dir/key.pem" >> "$INSTALL_DIR/.env"
  fi
  info "Self-signed cert generated (365 days)"
}

restrict_app_port() {
  local port="$1"
  if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "active"; then
    sudo ufw delete allow "$port/tcp" > /dev/null 2>&1 || true
    sudo ufw deny in on any to any port "$port" proto tcp > /dev/null 2>&1 || true
    sudo ufw allow in on lo to any port "$port" proto tcp > /dev/null 2>&1 || true
    info "Firewall: port $port blocked externally (localhost only)"
  elif command -v iptables &>/dev/null; then
    sudo iptables -D INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
    sudo iptables -C INPUT -i lo -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
      sudo iptables -I INPUT -i lo -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
    sudo iptables -C INPUT -p tcp --dport "$port" -j DROP 2>/dev/null || \
      sudo iptables -A INPUT -p tcp --dport "$port" -j DROP 2>/dev/null || true
    if command -v iptables-save &>/dev/null; then
      sudo sh -c 'iptables-save > /etc/iptables/rules.v4' 2>/dev/null || true
    fi
    info "Firewall: port $port blocked externally (localhost only)"
  else
    warn "No firewall tool found — port $port is exposed. Consider installing ufw."
  fi
}

setup_nginx() {
  if ! command -v nginx &>/dev/null; then install_pkg nginx; fi
  local nginx_conf nginx_link=""
  if [ -d /etc/nginx/sites-available ]; then
    nginx_conf="/etc/nginx/sites-available/claude-bot"
    nginx_link="/etc/nginx/sites-enabled/claude-bot"
  else
    nginx_conf="/etc/nginx/conf.d/claude-bot.conf"
  fi
  # Detect whether upstream Node.js server uses TLS (self-signed certs)
  local upstream_scheme="http" proxy_ssl_extra=""
  if [ -f "$INSTALL_DIR/.env" ]; then
    if grep -q '^SSL_CERT_PATH=' "$INSTALL_DIR/.env" && grep -q '^SSL_KEY_PATH=' "$INSTALL_DIR/.env"; then
      upstream_scheme="https"
      proxy_ssl_extra=$'\n        proxy_ssl_verify off;'
    fi
  fi

  # API / socket proxy block MUST come before any static-asset regex block.
  # nginx evaluates regex locations in definition order; if a static-file
  # rule appeared first it would match paths like /api/foo.js and 404.
  sudo tee "$nginx_conf" > /dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location ~ ^/${BOT_PATH_PREFIX}/${SLUG}/(api|socket\.io|_next)/ {
        proxy_pass ${upstream_scheme}://127.0.0.1:$PORT;${proxy_ssl_extra}
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

    location /$BOT_PATH_PREFIX/$SLUG/ {
        proxy_pass ${upstream_scheme}://127.0.0.1:$PORT;${proxy_ssl_extra}
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
  [ -n "$nginx_link" ] && sudo ln -sf "$nginx_conf" "$nginx_link"
  sudo nginx -t -q && sudo systemctl reload nginx
  info "nginx configured"

  if $USE_HTTPS && [ "$HTTPS_METHOD" = "letsencrypt" ]; then
    command -v certbot &>/dev/null || { echo "  Installing certbot..."; install_pkg certbot python3-certbot-nginx; }
    CERTBOT_EMAIL="${CERTBOT_EMAIL:-$ADMIN_EMAIL}"
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect -q
    info "Let's Encrypt certificate issued"
    node -e "
const fs = require('fs');
const envPath = process.argv[1];
let env = fs.readFileSync(envPath, 'utf8');
env = env.replace(/^NEXTAUTH_URL=.*/m, 'NEXTAUTH_URL=https://${DOMAIN}/${BOT_PATH_PREFIX}/${SLUG}');
fs.writeFileSync(envPath, env);
" "$INSTALL_DIR/.env"
    BASE_URL="https://$DOMAIN"
  fi

  if $SETUP_UFW; then
    sudo ufw allow 80/tcp > /dev/null 2>&1 || true
    sudo ufw allow 443/tcp > /dev/null 2>&1 || true
    info "UFW rules added"
  fi

  # Block external access to the app port — nginx is now the only entry point.
  # This prevents the Next.js 404 page from leaking the basePath/slug to anyone
  # who hits the app port directly.
  restrict_app_port "$PORT"
}

setup_cloudflare_tunnel() {
  if ! command -v cloudflared &>/dev/null; then
    case "$PLATFORM" in
      macos)
        [ "$PKG_MGR" = "brew" ] && brew install cloudflared || { error "Install cloudflared manually"; return; }
        ;;
      *)
        if [ "$PKG_MGR" = "apt" ]; then
          curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
          echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
          sudo apt-get update -qq && sudo apt-get install -y cloudflared
        else
          error "Install cloudflared manually"; return
        fi
        ;;
    esac
  fi
  command -v cloudflared &>/dev/null || { error "cloudflared installation failed"; return; }
  ! $UNATTENDED && read -r -p "  Press Enter to authenticate cloudflared... "
  cloudflared tunnel login 2>&1 || true
  local tunnel_name
  tunnel_name="claude-bot-$(echo "$BOT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
  cloudflared tunnel create "$tunnel_name" 2>&1 || true
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
  hint "DNS: CNAME $DOMAIN -> ${tunnel_name}.cfargotunnel.com"
  hint "Start: cloudflared tunnel --config ${cf_config_dir}/config-${tunnel_name}.yml run"
  info "Cloudflare Tunnel configured"
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
  if [ ! -d /run/systemd/system ]; then
    warn "systemd not running (common on WSL). Start manually: cd $INSTALL_DIR && pnpm start"
    SETUP_SERVICE=false
    return
  fi
  check_sudo || return
  systemctl cat "${SERVICE_NAME}.service" &>/dev/null 2>&1 && sudo systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
  # SECURITY NOTE: The sudoers entry grants passwordless access to setup-domain.sh.
  # Argument validation is enforced inside setup-domain.sh itself (domain format,
  # port range, slug charset, path traversal checks) rather than in sudoers patterns,
  # which have limited regex support and are fragile to maintain.
  local sudoers_file="/etc/sudoers.d/claude-bot"
  echo "$USER ALL=(ALL) NOPASSWD: /bin/systemctl restart ${SERVICE_NAME}.service, /usr/local/bin/setup-domain.sh [a-zA-Z0-9._-]* [0-9]* [a-zA-Z0-9_-]* [a-zA-Z0-9]* /[a-zA-Z0-9/_-]* *" | sudo tee "$sudoers_file" > /dev/null
  sudo chmod 0440 "$sudoers_file"
  if ! sudo visudo -c -f "$sudoers_file" >/dev/null 2>&1; then
    warn "Sudoers argument restriction failed validation — falling back to unrestricted entry"
    echo "$USER ALL=(ALL) NOPASSWD: /bin/systemctl restart ${SERVICE_NAME}.service, /usr/local/bin/setup-domain.sh" | sudo tee "$sudoers_file" > /dev/null
    sudo chmod 0440 "$sudoers_file"
  fi
  [ -f "$INSTALL_DIR/scripts/setup-domain.sh" ] && sudo cp "$INSTALL_DIR/scripts/setup-domain.sh" /usr/local/bin/setup-domain.sh && sudo chmod +x /usr/local/bin/setup-domain.sh
  local pnpm_bin node_bin
  pnpm_bin=$(command -v pnpm)
  node_bin=$(command -v node)
  sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<SERVICE
[Unit]
Description=Claude Server Bot (${BOT_NAME})
After=network.target
StartLimitIntervalSec=300
StartLimitBurst=5
[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$pnpm_bin start
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$(dirname "$node_bin")
[Install]
WantedBy=multi-user.target
SERVICE
  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}.service" --quiet
  sudo systemctl start "${SERVICE_NAME}.service"
  local started=false
  for _ in $(seq 1 10); do
    sudo systemctl is-active --quiet "${SERVICE_NAME}.service" && { started=true; break; }
    sleep 1
  done
  SERVICE_CREATED=true
  $started && info "systemd service started" || warn "Service may not have started. Check: sudo journalctl -u ${SERVICE_NAME} -n 30"
}

setup_launchd() {
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_name="com.claude-server-bot.plist"
  local plist_path="$plist_dir/$plist_name"
  local pnpm_bin
  pnpm_bin=$(command -v pnpm)
  mkdir -p "$plist_dir"
  [ -f "$plist_path" ] && launchctl unload "$plist_path" 2>/dev/null || true
  cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.claude-server-bot</string>
    <key>ProgramArguments</key><array><string>${pnpm_bin}</string><string>start</string></array>
    <key>WorkingDirectory</key><string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin</string></dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${INSTALL_DIR}/data/claude-bot.log</string>
    <key>StandardErrorPath</key><string>${INSTALL_DIR}/data/claude-bot-error.log</string>
</dict>
</plist>
PLIST
  launchctl load "$plist_path" 2>/dev/null || true
  launchctl start com.claude-server-bot 2>/dev/null || true
  info "launchd service configured"
  SERVICE_CREATED=true
}

# ─── Upgrade in place ─────────────────────────────────────────────────────
upgrade_in_place() {
  local target_dir="${1:-$INSTALL_DIR}"
  local backup_dir
  backup_dir="$(mktemp -d)"
  [ -f "$target_dir/.env" ] && cp "$target_dir/.env" "$backup_dir/.env"
  [ -d "$target_dir/data" ] && cp -r "$target_dir/data" "$backup_dir/data"
  cd "$target_dir"
  if ! git pull --ff-only 2>/dev/null; then
    local repo_url
    repo_url=$(git remote get-url origin 2>/dev/null || echo "$REPO_URL")
    cd ..
    rm -rf "$target_dir"
    git clone --depth 1 -b "$REPO_BRANCH" "$repo_url" "$target_dir"
    cd "$target_dir"
  fi
  [ -f "$backup_dir/.env" ] && cp "$backup_dir/.env" "$target_dir/.env"
  [ -d "$backup_dir/data" ] && cp -r "$backup_dir/data" "$target_dir/data"
  rm -rf "$backup_dir"
  [ -f "$target_dir/.env.example" ] && migrate_env "$target_dir/.env" "$target_dir/.env.example"
  pnpm install --frozen-lockfile --reporter=silent 2>&1 || pnpm install --reporter=silent 2>&1
  if [ -z "${SLUG:-}" ] && [ -f "$target_dir/.env" ]; then
    SLUG=$(grep -E '^CLAUDE_BOT_SLUG=' "$target_dir/.env" 2>/dev/null | cut -d= -f2 || true)
  fi
  if [ -z "${BOT_PATH_PREFIX:-}" ] && [ -f "$target_dir/.env" ]; then
    BOT_PATH_PREFIX=$(grep -E '^CLAUDE_BOT_PATH_PREFIX=' "$target_dir/.env" 2>/dev/null | cut -d= -f2 || true)
  fi
  local build_log
  build_log="$(mktemp)"
  if ! CLAUDE_BOT_SLUG="${SLUG:-}" CLAUDE_BOT_PATH_PREFIX="${BOT_PATH_PREFIX:-c}" pnpm build > "$build_log" 2>&1; then
    error "Build failed!"; tail -50 "$build_log"; rm -f "$build_log"; exit 1
  fi
  rm -f "$build_log"
  restart_existing_service
}

migrate_env() {
  local env_file="${1:-.env}" example_file="${2:-.env.example}"
  [ ! -f "$example_file" ] || [ ! -f "$env_file" ] && return
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    local key="${line%%=*}"
    grep -q "^${key}=" "$env_file" 2>/dev/null || { echo "$line" >> "$env_file"; hint "Added: $key"; }
  done < "$example_file"
}

restart_existing_service() {
  if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
    sudo systemctl restart "${SERVICE_NAME}.service"
    info "Service restarted"
  elif [ -f "$HOME/Library/LaunchAgents/com.claude-server-bot.plist" ]; then
    launchctl stop com.claude-server-bot 2>/dev/null || true
    launchctl start com.claude-server-bot 2>/dev/null || true
    info "Service restarted"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
#  INSTALLATION EXECUTION (progress bar driven)
# ═══════════════════════════════════════════════════════════════════════════════
run_installation() {
  local lockdir="/tmp/claude-bot-install.lock"
  if ! mkdir "$lockdir" 2>/dev/null; then
    error "Another installation is in progress (lock: $lockdir)"
    exit 1
  fi

  INSTALL_IN_PROGRESS=true
  echo ""

  mascot working

  # Phase 1: Prerequisites
  progress_bar 5 "Checking prerequisites..."
  echo ""
  check_and_install_prerequisites

  # Handle existing directory
  if [ -d "$INSTALL_DIR" ]; then
    local has_env=false has_build=false
    [ -f "$INSTALL_DIR/.env" ] && has_env=true
    [ -d "$INSTALL_DIR/.next" ] && has_build=true
    if $has_env && $has_build && ! $UNATTENDED; then
      warn "Existing installation at $INSTALL_DIR"
      echo -e "    ${BOLD}1)${NC} Upgrade in-place (preserves data)"
      echo -e "    ${BOLD}2)${NC} Fresh install (backup + re-clone)"
      if ! prompt_input "Choice" "1"; then rmdir "$lockdir" 2>/dev/null || true; exit 0; fi
      if [ "$REPLY" = "1" ]; then
        progress_bar 15 "Upgrading..."
        start_spinner
        upgrade_in_place
        stop_spinner
        progress_bar 100 "Complete!"
        echo ""
        INSTALL_IN_PROGRESS=false
        show_completion_summary
        return
      fi
    fi
    local backup_dir=""
    if [ -d "$INSTALL_DIR/data" ] || [ -f "$INSTALL_DIR/.env" ]; then
      backup_dir="$(mktemp -d)"
      [ -d "$INSTALL_DIR/data" ] && cp -r "$INSTALL_DIR/data" "$backup_dir/data"
      [ -f "$INSTALL_DIR/.env" ] && cp "$INSTALL_DIR/.env" "$backup_dir/.env.old"
    fi
    if $UNATTENDED; then
      safe_rm_install_dir
    else
      read -r -p "  Remove and re-clone? [Y/n]: " OVERWRITE
      [[ "$OVERWRITE" =~ ^[Nn]$ ]] && { rmdir "$lockdir" 2>/dev/null || true; exit 0; }
      safe_rm_install_dir
    fi
  fi

  # Phase 2: Clone
  progress_bar 12 "Cloning repository..."
  echo ""
  start_spinner
  # TODO: Verifying a signed tag/commit here would improve supply-chain integrity,
  # but is deferred to avoid breaking the shallow-clone + update flow.
  git clone "$REPO_URL" "$INSTALL_DIR" --branch "$REPO_BRANCH" --depth 1 --quiet 2>&1
  stop_spinner
  CLONE_DONE=true
  info "Cloned into $INSTALL_DIR"
  cd "$INSTALL_DIR"
  [ -n "${INSTALL_LOG:-}" ] && [ -f "$INSTALL_LOG" ] && cp "$INSTALL_LOG" "$INSTALL_DIR/install.log"
  if [ -n "${backup_dir:-}" ] && [ -d "${backup_dir:-}" ]; then
    [ -d "$backup_dir/data" ] && cp -r "$backup_dir/data" "$INSTALL_DIR/data"
    rm -rf "$backup_dir"
  fi

  # Phase 3: Anthropic API key
  progress_bar 20 "Setting up Anthropic API key..."
  echo ""

  if [ -n "$CLI_API_KEY" ]; then
    info "Anthropic API key provided"
  elif ! $UNATTENDED; then
    echo -e "  ${BOLD}Enter your Anthropic API key${NC}"
    echo -e "  ${DIM}Get one at: https://console.anthropic.com/settings/keys${NC}"
    echo ""
    read -r -p "  API key (sk-ant-...): " api_key_input
    if [ -n "$api_key_input" ]; then
      CLI_API_KEY="$api_key_input"
      info "API key accepted"
    else
      warn "No API key entered — you can add one later in Settings."
    fi
  else
    warn "No --api-key provided. Add one in Settings after install."
  fi

  # Phase 5: Dependencies
  progress_bar 36 "Installing dependencies..."
  echo ""
  start_spinner
  local deps_log
  deps_log="$(mktemp)"
  if ! pnpm install --frozen-lockfile --reporter=silent > "$deps_log" 2>&1; then
    stop_spinner
    warn "Lockfile mismatch — retrying with resolution..."
    start_spinner
    if ! pnpm install --reporter=silent > "$deps_log" 2>&1; then
      stop_spinner
      mascot error
      error "pnpm install failed!"
      tail -30 "$deps_log"
      rm -f "$deps_log"
      exit 1
    fi
  fi
  rm -f "$deps_log"
  stop_spinner
  info "Dependencies installed"

  # Phase 6: Generate .env
  progress_bar 52 "Generating configuration..."
  echo ""
  generate_env

  # Phase 8: Build
  progress_bar 64 "Building ${BOT_NAME}..."
  echo ""
  start_spinner
  local build_log
  build_log="$(mktemp)"
  if ! CLAUDE_BOT_SLUG="$SLUG" CLAUDE_BOT_PATH_PREFIX="$BOT_PATH_PREFIX" pnpm build > "$build_log" 2>&1; then
    stop_spinner
    mascot error
    error "Build failed!"
    tail -50 "$build_log"
    rm -f "$build_log"
    exit 1
  fi
  rm -f "$build_log"
  stop_spinner
  info "Build complete!"

  # Phase 9: Self-signed cert
  progress_bar 72 "Setting up HTTPS..."
  echo ""
  if $USE_HTTPS && [ "$HTTPS_METHOD" = "selfsigned" ] && ! $SETUP_NGINX; then
    local cert_host
    cert_host=$(echo "$BASE_URL" | sed -E 's|https?://||;s|:.*||')
    generate_selfsigned_cert "$cert_host"
  else
    info "HTTPS: $HTTPS_METHOD"
  fi

  # Phase 10: nginx / Cloudflare
  progress_bar 80 "Configuring services..."
  echo ""
  $SETUP_NGINX && setup_nginx
  $SETUP_CF_TUNNEL && setup_cloudflare_tunnel

  # Phase 11: System service
  progress_bar 85 "Setting up service..."
  echo ""
  if [ "$DEPLOY_MODE" = "vps" ]; then
    SETUP_SERVICE=true
  elif [ "$DEPLOY_MODE" = "local" ] && ! $UNATTENDED; then
    local svc_result
    prompt_yn "Set up as system service (auto-start on boot)?" "n" && svc_result=0 || svc_result=$?
    [ "$svc_result" -eq 0 ] && check_sudo && SETUP_SERVICE=true
  fi
  if $SETUP_SERVICE; then
    [ "$PLATFORM" = "macos" ] && setup_launchd || setup_systemd
  else
    info "No system service (start manually: cd $INSTALL_DIR && pnpm start)"
  fi

  # Phase 12: Health check
  progress_bar 92 "Health check..."
  echo ""
  local health_scheme="http"
  local health_curl_flags="-s -o /dev/null -w %{http_code}"
  if $USE_HTTPS && [ "$HTTPS_METHOD" = "selfsigned" ] && ! $SETUP_NGINX; then
    health_scheme="https"
    health_curl_flags="-sk -o /dev/null -w %{http_code}"
  fi
  local health_url="${health_scheme}://localhost:${PORT}/$BOT_PATH_PREFIX/$SLUG/api/health/ping"
  sleep 3
  local healthy=false
  for _ in $(seq 1 5); do
    local http_code
    http_code=$(curl $health_curl_flags "$health_url" 2>/dev/null || echo "000")
    [ "$http_code" = "200" ] && { healthy=true; break; }
    sleep 2
  done
  $healthy && info "Health check passed!" || warn "Health check inconclusive — server may still be starting."

  progress_bar 100 "Complete!"
  echo ""
  INSTALL_IN_PROGRESS=false

  show_completion_summary
}

show_completion_summary() {
  local full_url="$BASE_URL/$BOT_PATH_PREFIX/$SLUG"

  echo ""
  divider
  mascot celebrating

  echo -e "  ${BOLD}${BOT_NAME} is live!${NC}"
  echo ""

  # Print credentials to /dev/tty only, bypassing tee log capture
  {
    echo -e "  ${BOLD}${GREEN}═══ Your Credentials ═══${NC}"
    echo ""
    echo -e "  ${BOLD}URL:${NC}       ${CYAN}${full_url}${NC}"
    echo -e "  ${BOLD}Email:${NC}     ${ADMIN_EMAIL}"
    echo -e "  ${BOLD}Password:${NC}  ${ADMIN_PASSWORD}"
    echo ""
    copy_to_clipboard "$ADMIN_PASSWORD" && echo -e "  ${GREEN}✓${NC} Password copied to clipboard!"
    echo -e "  ${RED}${BOLD}!! SAVE THIS PASSWORD — IT WILL NEVER BE SHOWN AGAIN !!${NC}"
    echo ""
  } > /dev/tty

  if $SETUP_SERVICE; then
    echo -e "  ${BOLD}Service commands:${NC}"
    if [ "$PLATFORM" = "macos" ]; then
      echo "    launchctl start com.claude-server-bot"
      echo "    launchctl stop com.claude-server-bot"
      echo "    tail -f $INSTALL_DIR/data/claude-bot.log"
    else
      echo "    sudo systemctl status ${SERVICE_NAME}"
      echo "    sudo journalctl -u ${SERVICE_NAME} -f"
      echo "    sudo systemctl restart ${SERVICE_NAME}"
    fi
  else
    echo -e "  ${BOLD}Start manually:${NC}"
    echo "    cd $INSTALL_DIR && pnpm start"
  fi

  echo ""
  echo -e "  ${BOLD}To update:${NC} cd $INSTALL_DIR && ./update.sh"
  echo ""
  [ -n "${INSTALL_LOG:-}" ] && [ -f "$INSTALL_LOG" ] && hint "Install log: $INSTALL_LOG"

  mascot goodbye
  divider
  echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════
main() {
  parse_args "$@"

  INSTALL_LOG="/tmp/claude-bot-install-$(date +%s).log"
  touch "$INSTALL_LOG"
  chmod 0600 "$INSTALL_LOG"
  exec > >(tee -a "$INSTALL_LOG") 2>&1

  # Handle curl|bash pipe
  if ! $UNATTENDED && [ ! -t 0 ]; then
    local tmp_script
    tmp_script="$(mktemp /tmp/claude-bot-install-XXXXXX.sh)"
    cat > "$tmp_script"
    if [ ! -s "$tmp_script" ]; then
      curl -fsSL "https://raw.githubusercontent.com/JckHamm3r/Claude-Server-Bot/main/install.sh" -o "$tmp_script" || {
        echo "ERROR: Failed to download installer."; rm -f "$tmp_script"; exit 1
      }
    fi
    chmod +x "$tmp_script"
    echo "  Re-launching installer interactively..."
    exec bash "$tmp_script" "$@" < /dev/tty
  fi

  [ -n "$CONFIG_FILE" ] && load_config_file "$CONFIG_FILE"
  $UNATTENDED && validate_unattended

  # 3-screen wizard loop
  CURRENT_SCREEN=1
  while true; do
    NEXT_STEP=0
    case $CURRENT_SCREEN in
      1) screen_welcome ;;
      2) screen_configure ;;
      3) screen_confirm ;;
      4) break ;;
      *) break ;;
    esac
    [ "$NEXT_STEP" -gt 0 ] && CURRENT_SCREEN=$NEXT_STEP || CURRENT_SCREEN=$((CURRENT_SCREEN + 1))
  done

  # Run the installation
  run_installation
}

main "$@"

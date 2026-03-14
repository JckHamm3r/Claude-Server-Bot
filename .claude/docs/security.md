# Security

Three independent security systems, each toggleable via `app_settings`.

## Guard Rails (`src/lib/security-guard.ts`)

Protected file paths (.env, certs, DB, bot source) and config-modification patterns. Intercepts permission requests in the socket handler before the tool use is approved.

Protected paths include:
- `.env` and environment files
- SSL certificates directory
- SQLite database files
- Bot source code directory

## Command Sandbox (`src/lib/command-sandbox.ts`)

Classifies Bash commands as safe/restricted/dangerous. Admin-configurable whitelist/blacklist stored in `app_settings`.

Settings keys:
- `sandbox_enabled` — Toggle on/off
- `sandbox_always_allowed` — JSON array of always-allowed command patterns
- `sandbox_always_blocked` — JSON array of always-blocked command patterns

UI location: Settings > Security > Command Sandbox sub-tab (do not duplicate this toggle elsewhere).

## IP Protection (`src/lib/ip-protection.ts`)

Tracks failed login attempts per IP, auto-blocks after configurable threshold. Periodic cleanup of expired blocks.

Settings keys:
- `ip_protection_enabled` — Toggle on/off
- `ip_max_attempts` — Max failed attempts before block
- `ip_window_minutes` — Time window for counting attempts
- `ip_block_duration_minutes` — How long an IP stays blocked

Database tables: `login_attempts`, `blocked_ips`.

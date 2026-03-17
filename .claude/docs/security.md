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

## UFW Firewall (`src/lib/ufw-manager.ts`)

Expert-only sub-tab under Settings > Security > Firewall. Wraps `sudo ufw` commands to provide firewall management from within the admin panel.

### Core functions

- `isUfwAvailable()` — Checks if `ufw` binary is present
- `getUfwStatus()` — Parses `sudo ufw status numbered` + `verbose`; returns active state, default policies, logging level, and a structured rule list
- `addRule(action, port, protocol, fromIP?, comment?)` — Adds an allow/deny/limit rule
- `deleteRule(ruleNumber)` — Deletes by rule number with `--force`
- `setUfwEnabled(enabled)` — Enables (`--force`) or disables UFW

### Rollback / lockout protection

Destructive changes (delete rule, disable UFW, add deny/limit rule) trigger a 60-second rollback window:

1. Server snapshots current rules before applying the change
2. Applies the change
3. Returns `{ pendingConfirmation: true, changeId, confirmDeadlineMs: 60000 }` to the client
4. Client shows a countdown modal — user must click "I still have access" to confirm
5. If the timer expires without confirmation, the server auto-restores the snapshot via `ufw --force reset` + re-add rules
6. Manual rollback available at any time during the window

Module-level `Map<changeId, PendingChange>` stores in-flight rollback state. Safe changes (adding `allow` rules) skip the rollback entirely.

### API route

`/api/security/ufw` — GET returns status + rules + protected port info. POST actions:

| Body `action` | Description |
|---|---|
| `enable` / `disable` | Toggle UFW on/off |
| `add_rule` | Add a new rule |
| `delete_rule` | Delete by rule number |
| `confirm_change` | Cancel pending rollback (keep changes) |
| `rollback` | Manually revert pending change |

All mutations are logged to `activity_log` with `security_ufw_*` event types.

### UI

Security sub-tab "Firewall" (Flame icon) — visible to expert-level users only:

- **Status banner** — Active/inactive badge, enable/disable button, default policies, protected port info
- **Quick presets** — One-click allow buttons for SSH (22), HTTP (80), HTTPS (443), app port
- **Add rule form** — Action (allow/deny/limit), protocol (tcp/udp/any), port/range, from IP/CIDR or Anywhere
- **Rules table** — Numbered list with color-coded action badges, warning icon on protected ports, delete button per rule
- **Rollback modal** — Full-screen overlay with countdown ring when a destructive change is pending

# Security

Three independent security systems, each toggleable via admin settings. They protect against unauthorized file access, dangerous command execution, and brute-force login attacks.

## Guard Rails

Protects sensitive file paths and intercepts configuration-modification patterns before tool use is approved.

**Protected paths:**
- `.env` and environment files
- SSL certificates directory
- SQLite database files
- Bot source code directory

When a tool request targets a protected path, the security guard intercepts the permission request in the socket handler and emits a `security:warn` event. The request is blocked before it reaches Claude.

**Setting:** `guard_rails_enabled` in `app_settings` (toggle on/off).

## Command Sandbox

Classifies Bash commands into three categories:

| Category | Behavior |
|----------|----------|
| Safe | Allowed without extra approval |
| Restricted | Requires explicit user approval |
| Dangerous | Blocked entirely |

Admins can define custom whitelist and blacklist patterns to override the default classification.

**Settings:**
| Key | Description |
|-----|-------------|
| `sandbox_enabled` | Toggle on/off |
| `sandbox_always_allowed` | JSON array of always-allowed command patterns |
| `sandbox_always_blocked` | JSON array of always-blocked command patterns |

**UI location:** Settings > Security > Command Sandbox sub-tab. This is the only place the sandbox toggle appears -- do not duplicate it elsewhere.

## IP Protection

Tracks failed login attempts per IP address and automatically blocks IPs that exceed a configurable threshold. Expired blocks are cleaned up periodically.

**Settings:**
| Key | Description |
|-----|-------------|
| `ip_protection_enabled` | Toggle on/off |
| `ip_max_attempts` | Max failed attempts before an IP is blocked |
| `ip_window_minutes` | Time window for counting failed attempts |
| `ip_block_duration_minutes` | How long a blocked IP stays blocked |

**Database tables:** `login_attempts`, `blocked_ips`.

Admins can view blocked IPs and manually unblock them from the Security section in Settings.

## Security Log

The Security section in Settings includes a log viewer that shows security events such as blocked commands, guard rail violations, and IP blocks.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/security-guard.ts` | Guard rails implementation |
| `src/lib/command-sandbox.ts` | Command classification and sandbox logic |
| `src/lib/ip-protection.ts` | IP tracking and blocking |
| `src/components/claude-code/settings/security-section.tsx` | Security settings UI |
| `src/socket/security-handlers.ts` | Sandbox whitelist management via Socket.IO |
| `src/app/api/security/settings/route.ts` | Security settings API |
| `src/app/api/security/sandbox/route.ts` | Sandbox configuration API |
| `src/app/api/security/ip-protection/` | IP protection management API |
| `src/app/api/security/log/route.ts` | Security log API |

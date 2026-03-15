# Admin Settings

A global key-value configuration store (`app_settings` table) that controls platform behavior. All settings are managed through the Settings panel in the dashboard.

## API Key

The Anthropic API key for the Claude Agent SDK. Can be set during initial setup or updated later in Settings.

**Setting key:** `anthropic_api_key`

## Rate Limits

Control how much Claude usage each session is allowed.

| Key | Default | Description |
|-----|---------|-------------|
| `rate_limit_commands` | 100 | Max commands per session |
| `rate_limit_runtime_min` | 30 | Max session runtime in minutes |
| `rate_limit_concurrent` | 0 (unlimited) | Max concurrent sessions per user |

When a rate limit is hit, the session receives a `claude:rate_limited` event and further commands are blocked until the limit resets.

## Cost Budgets

Set spending caps to control API costs. When a budget is exceeded, the session receives a `claude:budget_exceeded` event. Warnings fire at 80% of the limit.

| Key | Default | Description |
|-----|---------|-------------|
| `budget_limit_session_usd` | 0 (no cap) | Max cost per session |
| `budget_limit_daily_usd` | 0 (no cap) | Max daily spend |
| `budget_limit_monthly_usd` | 0 (no cap) | Max monthly spend |

## Upload Limits

| Key | Default | Description |
|-----|---------|-------------|
| `upload_max_size_bytes` | 10 MB | Max file upload size |

## Security Toggles

| Key | Description |
|-----|-------------|
| `guard_rails_enabled` | Enable/disable file path protection |
| `sandbox_enabled` | Enable/disable command sandbox |
| `ip_protection_enabled` | Enable/disable IP brute-force protection |

See [security.md](security.md) for details on each system.

## Message Retention

Configurable retention period for old messages. Messages older than the configured number of days are automatically cleaned up.

## Settings Sections in the UI

| Section | What it controls |
|---------|-----------------|
| General | Auto-naming, full-trust mode, custom default context |
| Bot Identity | Name, avatar, tagline |
| API Key (SDK) | Anthropic API key |
| Rate Limits | Commands, runtime, concurrent sessions |
| Budgets | Session, daily, monthly cost caps |
| Users | User management (see [user-management.md](user-management.md)) |
| Project | Project root directory (restarts service on change) |
| Notifications | Notification preferences (see [notifications.md](notifications.md)) |
| Activity Log | Event audit log with pagination |
| Backup & Restore | Download database backup, upload restore |
| Database | Storage stats, row counts, retention, VACUUM, manual backups |
| System | Health checks, CPU/RAM/disk, Kill All Sessions |
| Updates | Update instructions |
| Domains | Custom domain setup (see [installation-and-deployment.md](installation-and-deployment.md)) |
| Email / SMTP | SMTP configuration (see [notifications.md](notifications.md)) |
| Security | Guard rails, IP protection, sandbox, security log (see [security.md](security.md)) |
| Templates | Session templates (see [session-templates.md](session-templates.md)) |

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/settings-panel.tsx` | Settings panel with all sections |
| `src/app/api/app-settings/route.ts` | App settings API |
| `src/app/api/app-settings/api-key/route.ts` | API key management |
| `src/lib/app-settings.ts` | Settings access helpers |
| `src/lib/activity-log.ts` | Activity log utilities |

## Database Table

| Table | Purpose |
|-------|---------|
| `app_settings` | Global key-value config store |
| `activity_log` | Audit trail (event_type, user_email, details JSON) |
| `metrics` | Aggregated platform metrics (session_count, command_count, avg_response_ms) |

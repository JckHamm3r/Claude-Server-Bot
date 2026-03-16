# API Routes

All routes live under the Next.js App Router (`src/app/api/`).

| Route | Purpose |
|-------|---------|
| `/api/auth/[...nextauth]` | Authentication |
| `/api/bot-identity` | Bot name, tagline, avatar (GET/POST) |
| `/api/health`, `/api/health/ping` | Health checks |
| `/api/setup/complete` | Initial setup completion |
| `/api/users` | User CRUD (admin) |
| `/api/app-settings` | App settings (admin) |
| `/api/app-settings/api-key` | Anthropic API key management |
| `/api/activity-log` | Audit log |
| `/api/claude-code/search` | Full-text message search |
| `/api/claude-code/memory` | Memory file read/write |
| `/api/claude-code/test` | Claude connectivity test |
| `/api/claude-code/upload` | File upload/list |
| `/api/claude-code/files` | Project file browser |
| `/api/claude-code/export` | Session/data export |
| `/api/settings/smtp` | SMTP configuration |
| `/api/settings/domains` | Domain management |
| `/api/settings/notifications` | Notification preferences |
| `/api/notifications` | In-app notification inbox (GET list, POST mark-read) |
| `/api/settings/customization` | Personality settings |
| `/api/settings/project` | Project root config |
| `/api/settings/restore` | Backup restore |
| `/api/security/*` | Security settings, sandbox, IP protection |
| `/api/system/resources` | System resource monitoring |
| `/api/system/service` | Service status (GET), restart/stop/start (POST), apply update (PATCH) |
| `/api/system/version` | Current commit/tag and GitHub latest version check |
| `/api/system/claude-update` | Deprecated (returns 410) |

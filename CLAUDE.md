# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm run dev` — Next.js dev server (port 3000)
- `npm run build` — Production build
- `npm start` — Run custom server with Socket.IO (uses tsx to run server.ts)
- `npm run lint` — ESLint

## Architecture

**Next.js 14 App Router + custom HTTP server with Socket.IO + SQLite (better-sqlite3, WAL mode)**

### Custom Server (`server.ts`)
The app does NOT use the standard Next.js server. `server.ts` creates an HTTP server (or HTTPS when SSL certs are configured), attaches Socket.IO for real-time WebSocket communication, then hands HTTP requests to Next.js. The Socket.IO path is configurable for slug-based multi-tenant routing. When HTTPS is active, the server sets `x-forwarded-proto: https` on requests so Next.js generates correct redirect URLs.

### Claude Provider Abstraction (`src/lib/claude/`)
Two provider modes controlled by `CLAUDE_PROVIDER` env var (default: "subprocess"):
- **subprocess-provider.ts** — Spawns the `claude` CLI as a child process with `--output-format stream-json`. Manages per-session state (claudeSessionId, running flag, allowedTools, waitingForPermission). Supports session resume via `--resume`. Handles permission denials by pausing until the user grants/denies via the UI.
- **sdk-provider.ts** — Alternative SDK-based provider using the Anthropic SDK directly.
- **output-parser.ts** — Parses newline-delimited JSON stream events (text, tool_call, permission_request, done, error).

### Real-Time Layer (`src/socket/`)
All Claude interactions flow through Socket.IO events, not REST APIs. Split across handler files:
- **`handlers.ts`** — Core orchestration: token-based auth, user presence tracking, message streaming to/from Claude subprocess, security interception, metrics buffering (flushed to DB every 60s).
- **`session-handlers.ts`** — Session CRUD, model switching, state sync, templates, session sharing/collaboration, usage tracking, kill-all.
- **`message-handlers.ts`** — Send messages, interrupt, tool permissions, edit/delete messages, rate limiting, budget checks, file attachments.
- **`plan-handlers.ts`** — Agent CRUD, plan generation/approval/execution/refinement, step management.
- **`presence-handlers.ts`** — Typing indicators, in-app notifications, PTY terminal sessions.
- **`security-handlers.ts`** — Command sandbox whitelist management.

### Authentication (`src/lib/auth.ts` + `src/middleware.ts`)
NextAuth with Credentials provider, JWT strategy. Middleware handles:
- Public routes: `/api/auth/*`, `/api/bot-identity`, `/api/health/*`, static assets
- Setup gate: redirects to `/setup` if setup not complete (checked via cookie flag)
- Protected routes: all others require valid JWT

### Security Layers
Three independent security systems, each toggleable via `app_settings`:
- **Guard Rails** (`src/lib/security-guard.ts`) — Protected file paths (.env, certs, DB, bot source) and config-modification patterns. Intercepts permission requests in socket handler.
- **Command Sandbox** (`src/lib/command-sandbox.ts`) — Classifies Bash commands as safe/restricted/dangerous. Admin-configurable whitelist/blacklist stored in `app_settings`.
- **IP Protection** (`src/lib/ip-protection.ts`) — Tracks failed login attempts per IP, auto-blocks after configurable threshold. Periodic cleanup of expired blocks.

## Database

SQLite at `./data/claude-bot.db` with WAL mode. Schema auto-migrates on startup in `db.ts`. `claude-db.ts` provides all data access functions. No ORM — raw SQL with better-sqlite3.

### Tables

| Table | Purpose |
|-------|---------|
| `sessions` | Chat sessions (id, name, tags, created_by, status: idle/running/needs_attention, model, provider_type, skip_permissions) |
| `messages` | Chat messages (session_id, sender_type: admin/claude, content, message_type: chat/system/error, metadata). Has FTS5 virtual table `messages_fts` for full-text search. |
| `agents` | Reusable agent definitions (name, description, icon, model, allowed_tools, status: active/disabled/archived, versioned) |
| `agent_versions` | Agent version history with config snapshots |
| `plans` | Multi-step execution plans (session_id, goal, status: drafting/reviewing/executing/completed/failed/cancelled) |
| `plan_steps` | Individual plan steps (step_order, summary, details, status: pending/approved/rejected/executing/completed/failed/rolled_back, result, error) |
| `users` | User accounts (email, bcrypt hash, is_admin flag) |
| `user_settings` | Per-user preferences (full_trust_mode, custom_default_context, auto_naming_enabled) |
| `bot_settings` | Bot identity (name, avatar, tagline) |
| `app_settings` | Global key-value config store |
| `session_templates` | Reusable session presets (name, system_prompt, model, skip_permissions, icon, is_default) |
| `session_participants` | Session sharing/collaboration (session_id, user_email, role) |
| `uploads` | File uploads attached to sessions |
| `metrics` | Aggregated platform metrics (session_count, command_count, avg_response_ms) |
| `activity_log` | Audit trail (event_type, user_email, details JSON) |
| `domains` | Custom domain configuration |
| `smtp_settings` | SMTP email configuration |
| `notification_preferences` | Per-user notification settings (event_type, email_enabled, inapp_enabled) |
| `inapp_notifications` | In-app notification store |
| `login_attempts` | Login attempt tracking for IP protection |
| `blocked_ips` | Blocked IP addresses |

## Platform Features

### Sessions
- Create, rename, delete, tag sessions
- Switch models per session (claude-sonnet-4-20250514, claude-opus-4-6, etc.)
- Skip permissions mode (auto-approve tool use)
- Session collaboration — invite other users to view/participate
- Message editing and deletion with re-execution
- Full-text search across all messages
- Session export

### Agents
Reusable agent definitions with:
- Name, description, emoji icon
- Model selection
- Allowed tools list (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent)
- Version history with config snapshots
- AI-powered agent generation from natural language description
- Status management (active/disabled/archived)

### Plan Mode
Multi-step execution plans with human-in-the-loop approval:
1. **Generate** — Describe a goal, AI generates ordered steps (max 50)
2. **Review** — Approve/reject individual steps or all at once
3. **Reorder/Edit** — Change step order, modify summaries and details
4. **Refine** — Give additional instructions to regenerate steps
5. **Execute** — Run approved steps sequentially in isolated sessions
6. **Failure handling** — Pause on failure with retry/skip/cancel options
7. **Notifications** — Alerts on plan completion or failure
8. Max 2 concurrent plan executions per user

### Session Templates
Admin-created presets for starting new sessions:
- Custom system prompt
- Pre-configured model
- Skip permissions setting
- Provider type selection
- Icon and description
- Default template support

### Memory
Project context files stored on disk (not in DB):
- `CLAUDE.md` — Main project instructions (this file)
- `.claude/memory/*.md` — Additional memory files
- Readable/writable via Memory tab in UI
- Admin-only write access via API

### Notifications
Two channels: **in-app** (real-time push) and **email** (via SMTP).
Event types: plan_completed, plan_failed, command_error, session_limit_reached, user_added, user_removed, kill_all_triggered, backup_created, backup_failed, domain_changed, smtp_configured, claude_offline, claude_recovered, high_cpu, high_ram, low_disk, update_completed, update_failed, security_prompt_injection_detected, security_ip_blocked.
Per-user preferences for each event type and channel.

### Bot Customization
- **Identity** — Name, avatar image, tagline (stored in `bot_settings`)
- **Personality presets** — professional, friendly, technical, concise, creative, or custom free-text
- **Theme** — CSS variables for colors (bot-bg, bot-text, bot-accent, etc.)
- System prompt composition order: security prompt → template prompt → personality prefix → CLAUDE.md

### Admin Settings
Key-value store in `app_settings`:
- `anthropic_api_key` — API key for SDK provider
- `guard_rails_enabled` / `sandbox_enabled` / `ip_protection_enabled` — Security toggles
- `sandbox_always_allowed` / `sandbox_always_blocked` — Command whitelist/blacklist (JSON arrays)
- `ip_max_attempts` / `ip_window_minutes` / `ip_block_duration_minutes` — IP protection config
- `personality` / `personality_custom` — Bot personality
- `rate_limit_commands` (default 100) / `rate_limit_runtime_min` (default 30) / `rate_limit_concurrent` (default 0 = unlimited) — Rate limits
- `budget_limit_session_usd` / `budget_limit_daily_usd` / `budget_limit_monthly_usd` — Cost budgets (0 = no cap)
- `upload_max_size_bytes` (default 10MB) — File upload limit

### PTY Terminal
Admin-accessible terminal sessions via Socket.IO for direct server access.

### File Browser & Uploads
- Browse project files via `/api/claude-code/files`
- Upload files to sessions (size-limited, stored on disk)
- Attach uploaded files to messages sent to Claude

## API Routes

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
| `/api/settings/customization` | Personality settings |
| `/api/settings/project` | Project root config |
| `/api/settings/restore` | Backup restore |
| `/api/security/*` | Security settings, sandbox, IP protection |
| `/api/system/resources` | System resource monitoring |
| `/api/system/claude-update` | Claude CLI update trigger |

## Key Environment Variables

- `CLAUDE_PROJECT_ROOT` — Working directory for Claude subprocess
- `CLAUDE_CLI_PATH` — Path to claude binary (default: "claude")
- `CLAUDE_PROVIDER` — "subprocess" or "sdk"
- `CLAUDE_BOT_PATH_PREFIX` — URL path prefix derived from bot name (e.g. "jarvis")
- `CLAUDE_BOT_SLUG` — Random URL slug for basePath routing (e.g. "a8Bx3kQ9m2pR")
- `NEXTAUTH_SECRET` — JWT signing secret
- `DATA_DIR` — Database directory (default: ./data)
- `SSL_CERT_PATH` / `SSL_KEY_PATH` — Optional SSL certificate paths for HTTPS
- `ANTHROPIC_API_KEY` — API key (also settable via app_settings)

## Path Alias

`@/*` maps to `./src/*` in TypeScript and Next.js config.

## Styling

Tailwind CSS with class-based dark mode. Custom CSS variables for theming defined in `globals.css`:
- Layout: `bot-bg`, `bot-surface`, `bot-elevated`, `bot-border`
- Text: `bot-text`, `bot-muted`, `bot-accent`
- Status: `bot-green`, `bot-red`, `bot-amber`, `bot-blue`

## UI Components (`src/components/claude-code/`)

- **`chat-tab.tsx`** — Main chat interface with message streaming, permission handling, heartbeat state sync
- **`message-list.tsx`** / **`message-item.tsx`** — Message rendering with code blocks, diffs, tool calls, permission cards
- **`agents-tab.tsx`** — Agent management UI
- **`plan-mode-tab.tsx`** — Plan creation, review, and execution UI
- **`memory-tab.tsx`** — Memory file editor
- **`settings-panel.tsx`** — Admin settings with sub-sections for users, security, templates, customization
- **`permission-card.tsx`** — Tool permission approval UI (Allow for Session / Allow Once / Always Allow)
- **`session-sidebar.tsx`** — Session list with search, tags, and template selection

## Widget for User-Built Pages

When creating HTML pages, web apps, or any content served via HTTP on this server, **always include the Claude chat widget** by adding this script tag before the closing `</body>` tag. Build the URL from the environment:

- Scheme: `https` if SSL certs are configured, else `http`
- Host: the server's public hostname or IP
- Port: `$PORT` (default 3000)
- Base path: `/$CLAUDE_BOT_PATH_PREFIX/$CLAUDE_BOT_SLUG`

```html
<script src="{scheme}://{host}:{port}/{prefix}/{slug}/api/widget"></script>
```

The widget:
- Only renders if the user is authenticated with the Claude Server Bot
- Shows a floating chat bubble in the bottom-right corner
- Opens the full chat interface in an embedded panel when clicked
- Is completely invisible to unauthenticated visitors

**Important:** Always include this widget in any HTML you create so the admin can chat with you while viewing the page.

## Installation & Deployment

Installed via curl one-liner (`install.sh`). Managed by:
- `install.sh` — Full installation with dependency setup, env generation, build
- `update.sh` — Pull latest, rebuild, health check with auto-rollback
- `uninstall.sh` — Clean removal
- `scripts/setup-domain.sh` — Custom domain + SSL setup
- `scripts/generate-env.js` — Environment file generation with credential hashing

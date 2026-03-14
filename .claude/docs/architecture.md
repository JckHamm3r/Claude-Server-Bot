# Architecture

**Next.js 14 App Router + custom HTTP server with Socket.IO + SQLite (better-sqlite3, WAL mode)**

## Build & Development Commands

- `npm run dev` — Next.js dev server (port 3000)
- `npm run build` — Production build
- `npm start` — Run custom server with Socket.IO (uses tsx to run server.ts)
- `npm run lint` — ESLint

## Custom Server (`server.ts`)

The app does NOT use the standard Next.js server. `server.ts` creates an HTTP server (or HTTPS when SSL certs are configured), attaches Socket.IO for real-time WebSocket communication, then hands HTTP requests to Next.js. The Socket.IO path is configurable for slug-based multi-tenant routing. When HTTPS is active, the server sets `x-forwarded-proto: https` on requests so Next.js generates correct redirect URLs.

## Claude Provider Abstraction (`src/lib/claude/`)

Two provider modes controlled by `CLAUDE_PROVIDER` env var (default: "subprocess"):

- **subprocess-provider.ts** — Spawns the `claude` CLI as a child process with `--output-format stream-json`. Manages per-session state (claudeSessionId, running flag, allowedTools, waitingForPermission). Supports session resume via `--resume`. Handles permission denials by pausing until the user grants/denies via the UI.
- **sdk-provider.ts** — Alternative SDK-based provider using the Anthropic SDK directly.
- **output-parser.ts** — Parses newline-delimited JSON stream events (text, tool_call, permission_request, done, error).

## Real-Time Layer (`src/socket/`)

All Claude interactions flow through Socket.IO events, not REST APIs. Split across handler files:

- **`handlers.ts`** — Core orchestration: token-based auth, user presence tracking, message streaming to/from Claude subprocess, security interception, metrics buffering (flushed to DB every 60s).
- **`session-handlers.ts`** — Session CRUD, model switching, state sync, templates, session sharing/collaboration, usage tracking, kill-all.
- **`message-handlers.ts`** — Send messages, interrupt, tool permissions, edit/delete messages, rate limiting, budget checks, file attachments.
- **`plan-handlers.ts`** — Agent CRUD, plan generation/approval/execution/refinement, step management.
- **`presence-handlers.ts`** — Typing indicators, in-app notifications, PTY terminal sessions.
- **`security-handlers.ts`** — Command sandbox whitelist management.

## Authentication (`src/lib/auth.ts` + `src/middleware.ts`)

NextAuth with Credentials provider, JWT strategy. Middleware handles:

- Public routes: `/api/auth/*`, `/api/bot-identity`, `/api/health/*`, static assets
- Setup gate: redirects to `/setup` if setup not complete (checked via cookie flag)
- Protected routes: all others require valid JWT

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

## Path Alias

`@/*` maps to `./src/*` in TypeScript and Next.js config.

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

## Installation & Deployment

Installed via curl one-liner (`install.sh`). Managed by:

- `install.sh` — Full installation with dependency setup, env generation, build
- `update.sh` — Pull latest, rebuild, health check with auto-rollback
- `uninstall.sh` — Clean removal
- `scripts/setup-domain.sh` — Custom domain + SSL setup
- `scripts/generate-env.js` — Environment file generation with credential hashing

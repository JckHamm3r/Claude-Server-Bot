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
The app does NOT use the standard Next.js server. `server.ts` creates an HTTP server, attaches Socket.IO for real-time WebSocket communication, then hands HTTP requests to Next.js. The Socket.IO path is configurable for slug-based multi-tenant routing.

### Claude Provider Abstraction (`src/lib/claude/`)
Two provider modes controlled by `CLAUDE_PROVIDER` env var (default: "subprocess"):
- **subprocess-provider.ts** — Spawns the `claude` CLI as a child process with `--output-format stream-json`. Manages per-session state (claudeSessionId, running flag, allowedTools). Supports session resume via `--resume`.
- **sdk-provider.ts** — Alternative SDK-based provider.
- **output-parser.ts** — Parses newline-delimited JSON stream events (text, tool_call, permission_request, done, error).

### Real-Time Layer (`src/socket/handlers.ts`)
This is the largest file (~1150 lines) and the core orchestration point. All Claude interactions flow through Socket.IO events, not REST APIs. Key responsibilities:
- Token-based auth on connection, user presence tracking
- Session CRUD, message streaming to/from Claude subprocess
- Agent management, plan generation/approval/execution
- Rate limiting (per-user, per-session, concurrent limits)
- Security interception (guard rails, command sandbox checks)
- Metrics buffering (flushed to DB every 60s)

### Authentication (`src/lib/auth.ts` + `src/middleware.ts`)
NextAuth with Credentials provider, JWT strategy. Middleware handles:
- Public routes: `/api/auth/*`, `/api/bot-identity`, static assets
- Setup gate: redirects to `/setup` if setup not complete (checked via cookie flag)
- Protected routes: all others require valid JWT

### Security Layers (Phase 4)
Three independent security systems, each toggleable via `app_settings`:
- **Guard Rails** (`src/lib/security-guard.ts`) — Protected file paths (.env, certs, DB, bot source) and config-modification patterns. Intercepts permission requests in socket handler.
- **Command Sandbox** (`src/lib/command-sandbox.ts`) — Classifies Bash commands as safe/restricted/dangerous. Admin-configurable whitelist/blacklist.
- **IP Protection** (`src/lib/ip-protection.ts`) — Tracks failed login attempts per IP, auto-blocks after threshold. Periodic cleanup of expired blocks.

### Database (`src/lib/db.ts`, `src/lib/claude-db.ts`)
SQLite at `./data/claude-bot.db` with WAL mode. Schema auto-migrates on startup in `db.ts`. `claude-db.ts` provides all data access functions (sessions, messages, agents, plans, settings). No ORM — raw SQL with better-sqlite3.

### Settings & Configuration
- `src/lib/app-settings.ts` — Key-value store for global config (rate limits, personality presets, security flags)
- `src/lib/customization.ts` — Bot personality and theme customization
- `src/lib/notifications.ts` — In-app + email notifications with per-user preferences
- `src/lib/smtp.ts` — Email dispatch via SMTP

## Key Environment Variables

- `CLAUDE_PROJECT_ROOT` — Working directory for Claude subprocess
- `CLAUDE_CLI_PATH` — Path to claude binary (default: "claude")
- `CLAUDE_PROVIDER` — "subprocess" or "sdk"
- `CLAUDE_BOT_PATH_PREFIX` — URL path prefix derived from bot name (e.g. "jarvis")
- `CLAUDE_BOT_SLUG` — Random URL slug for basePath routing (e.g. "a8Bx3kQ9m2pR")
- `NEXTAUTH_SECRET` — JWT signing secret
- `DATA_DIR` — Database directory (default: ./data)

## Path Alias

`@/*` maps to `./src/*` in TypeScript and Next.js config.

## Styling

Tailwind CSS with class-based dark mode. Custom CSS variables for theming: `bot-bg`, `bot-text`, `bot-accent`, `bot-red`, `bot-green`, `bot-amber`, `bot-blue` (defined in `globals.css`).

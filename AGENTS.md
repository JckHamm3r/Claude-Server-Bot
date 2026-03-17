# AGENTS.md — Cursor Cloud Agent Environment Setup

This project is normally installed via `curl | bash` (see `install.sh`). In the Cursor Cloud testing environment the setup script has **not** been run, so you must bootstrap the dev environment yourself before running or testing anything.

## Quick Start (run these first, every time)

```bash
# 1. Install dependencies (project uses pnpm, NOT npm)
pnpm install

# 2. Create .env from the committed test config (if missing)
cp -n .env.backup .env

# 3. Start the dev server
npm run dev
```

The dev server will be ready when you see `✓ Ready` in the output. Typical startup time is ~1-2 seconds.

## Accessing the App

The app uses a slug-based URL path. You **cannot** access `http://localhost:3000/` directly — it will 404.

| Item | Value |
|------|-------|
| **Base URL** | `http://localhost:3000/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa` |
| **Login page** | `http://localhost:3000/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa/login` |
| **Admin email** | `admin@dev.local` |
| **Admin password** | `TestPassword123!` |

## Key Environment Details

- **Package manager**: `pnpm` (v10.32.1) — do NOT use `npm install` for dependencies. `npm run <script>` is fine for running scripts.
- **Node version**: 22.x (managed via nvm)
- **Dev command**: `npm run dev` — starts Next.js in dev mode on port 3000 (auto-increments if busy).
- **Production command**: `npm run build && npm start` — only needed if testing production mode specifically.
- **Lint**: `npm run lint`
- **Database**: SQLite via `better-sqlite3`. DB file auto-creates at `data/claude-bot.db` on first run. No external DB services needed.
- **SSL**: Not available in this testing env. The `.env` references cert paths that don't exist; the server gracefully falls back to HTTP.

## Common Pitfalls

1. **Using `npm install` instead of `pnpm install`** — will fail or produce a mismatched lockfile. Always use `pnpm install`.
2. **Hitting `http://localhost:3000/` directly** — returns 404. All routes are behind the slug base path.
3. **Running `npm start` without building first** — production mode requires `npm run build` before `npm start`. Use `npm run dev` for development.
4. **Port already in use** — if port 3000 is occupied, Next.js auto-picks the next available port. Check the terminal output for the actual port.
5. **Missing `.env`** — if the `.env` file is missing, copy from `.env.backup`: `cp .env.backup .env`

## Project Architecture (brief)

- **Framework**: Next.js 14 App Router + custom Socket.IO server (`server.ts`)
- **AI**: `@anthropic-ai/claude-agent-sdk` in streaming input mode over Socket.IO
- **DB**: SQLite (`data/claude-bot.db`), auto-migrates on startup
- **Auth**: NextAuth with credentials provider
- **Config**: See `CLAUDE.md` for full project documentation and `.claude/docs/` for detailed subsystem docs

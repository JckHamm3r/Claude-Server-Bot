# AGENTS.md — Cursor Cloud Agent Environment Setup

This project is normally installed via `curl | bash` (see `install.sh`). In the Cursor Cloud testing environment the setup script has **not** been run, so you must bootstrap the dev environment yourself before running or testing anything.

## Cursor Cloud specific instructions

### 1. Bootstrap (run once per session)

```bash
pnpm install          # MUST use pnpm — NOT npm install
cp -n .env.backup .env
npm run dev           # starts on port 3000
```

Wait for `✓ Ready` in the output before proceeding (~1-2 seconds).

### 2. URL structure — READ THIS BEFORE OPENING ANY URL

**CRITICAL: Every URL in this app MUST include the base path prefix. `http://localhost:3000/` alone will 404. `http://localhost:3000/login` will 404. There is NO route that works without the full base path.**

The base path for the test environment is:

```
/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa
```

Construct ALL URLs like this:

```
http://localhost:3000/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa/<page>
```

Examples:
- **Login**: `http://localhost:3000/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa/login`
- **Home/dashboard**: `http://localhost:3000/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa`
- **Setup wizard**: `http://localhost:3000/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa/setup`
- **API routes**: `http://localhost:3000/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa/api/...`

**DO NOT** try `http://localhost:3000/`, `http://localhost:3000/login`, or any path without the prefix — they will ALL return 404.

### 3. Admin login credentials

```
Email:    admin@dev.local
Password: TestPassword123!
```

### 4. If port 3000 is busy

Next.js will auto-pick the next free port (3001, 3002, etc.). Read the terminal output for the actual port and substitute it in the URLs above.

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
2. **Hitting any URL without the full base path prefix** — returns 404. See section 2 above. EVERY route requires the `/2z497sunoicl/SqNBw2gJNow2GhTIfu8Jn70fPjk92MPGyJsZeia8vj3h0uuXCFR2miLZhw9klRwa` prefix.
3. **Running `npm start` without building first** — production mode requires `npm run build` before `npm start`. Use `npm run dev` for development.
4. **Port already in use** — if port 3000 is occupied, Next.js auto-picks the next available port. Check the terminal output for the actual port.
5. **Missing `.env`** — if the `.env` file is missing, copy from `.env.backup`: `cp .env.backup .env`

## Project Architecture (brief)

- **Framework**: Next.js 14 App Router + custom Socket.IO server (`server.ts`)
- **AI**: `@anthropic-ai/claude-agent-sdk` in streaming input mode over Socket.IO
- **DB**: SQLite (`data/claude-bot.db`), auto-migrates on startup
- **Auth**: NextAuth with credentials provider
- **Config**: See `CLAUDE.md` for full project documentation and `.claude/docs/` for detailed subsystem docs

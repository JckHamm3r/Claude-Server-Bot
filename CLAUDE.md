# CLAUDE.md

Octoby AI platform: Next.js 14 App Router + custom Socket.IO server + SQLite. Powered by `@anthropic-ai/claude-agent-sdk` (TypeScript) in streaming input mode. Installed via curl one-liner; users run it on their own servers.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (port 3000) |
| `npm run build` | Production build |
| `npm start` | Custom server with Socket.IO |
| `npm run lint` | ESLint |

## Key Rules

- `@/*` maps to `./src/*`
- All Claude AI interactions go through Socket.IO, not REST
- SDK provider uses streaming input mode — one long-lived `query()` per session with messages fed via AsyncGenerator. Do not call `query()` per message.
- `persistSession: false` and `settingSources: []` — we manage persistence in SQLite. CLAUDE.md from `CLAUDE_PROJECT_ROOT` is read and appended to the system prompt manually.
- Personality is set per-session at creation time (in the New Session dialog), not in global settings; "Command Sandbox" toggle lives only in Security > Command Sandbox sub-tab
- System prompt composition order: security → template → identity + personality → project CLAUDE.md

## Detailed Docs (read on demand — not auto-ingested)

| File | Contents |
|------|----------|
| `.claude/docs/architecture.md` | Server, providers, socket layer, auth, database schema, env vars, install scripts |
| `.claude/docs/features.md` | Sessions, agents, plan mode, templates, memory, notifications, admin settings |
| `.claude/docs/security.md` | Guard rails, command sandbox, IP protection — toggles and config keys |
| `.claude/docs/api-routes.md` | All API route paths and their purpose |
| `.claude/docs/ui-and-styling.md` | Tailwind theme variables, component list, chat widget embed instructions |

Read the relevant doc file when you need detail on a specific area. Do not guess — look it up.

## Web Development & Hosting

The server's address is in `NEXTAUTH_URL`. It may be a public IP, domain, or local address. When asked to build or serve something, ask the user how they want it hosted. The system prompt includes live server environment details at runtime.

## Cursor Cloud specific instructions

### Dev server vs custom server

- `npm run dev` starts **only** the Next.js frontend. Socket.IO does NOT run, so chat, sessions, typing indicators, presence, and all real-time features will not work. The UI will show "Connecting to server..." indefinitely.
- `npm start` runs the **custom server** (`server.ts`) which attaches Socket.IO to the HTTP server and then hands requests to Next.js. This is required for any Socket.IO feature to function. You must run `npm run build` before `npm start`.
- Full end-to-end testing of chat features requires `npm start` **plus** a valid `ANTHROPIC_API_KEY` in `.env` and a configured `CLAUDE_PROJECT_ROOT`. Cloud agents typically won't have these, so treat `npm run build` + `npm run lint` as the primary automated verification, and note the limitation honestly.

### BasePath routing

The app uses a dynamic basePath derived from env vars (`CLAUDE_BOT_PATH_PREFIX` + `CLAUDE_BOT_SLUG`). Navigating to `http://localhost:3000/` will return a **404**. To find the correct URL, read `NEXTAUTH_URL` from `.env` — that contains the full base URL including the path prefix. For example, if `NEXTAUTH_URL=http://localhost:3000/foo/bar`, the app is served at `http://localhost:3000/foo/bar`.

### Testing strategy for UI changes

1. **Always run** `npm run build` and `npm run lint` — these catch type errors, import issues, and lint violations.
2. **For Socket.IO–dependent features** (chat, sessions, typing, streaming, tools, presence): full interactive testing requires `npm start` with valid API keys. If those aren't available, verify via build + lint + code review.
3. **For non-Socket.IO UI** (login page, settings pages, static layout): `npm run dev` works. Use the basePath URL from `.env`.

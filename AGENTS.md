# AGENTS.md

Instructions for Cursor agents working on this codebase. This file is NOT read by the product's system prompt — only `CLAUDE.md` and `.claude/CLAUDE.md` are injected into the AI's runtime context.

## Dev server vs custom server

- `npm run dev` starts **only** the Next.js frontend. Socket.IO does NOT run, so chat, sessions, typing indicators, presence, and all real-time features will not work. The UI will show "Connecting to server..." indefinitely.
- `npm start` runs the **custom server** (`server.ts`) which attaches Socket.IO to the HTTP server and then hands requests to Next.js. This is required for any Socket.IO feature to function. You must run `npm run build` before `npm start`.
- Full end-to-end testing of chat features requires `npm start` **plus** a valid `ANTHROPIC_API_KEY` in `.env` and a configured `CLAUDE_PROJECT_ROOT`. Cloud agents typically won't have these, so treat `npm run build` + `npm run lint` as the primary automated verification, and note the limitation honestly.

## BasePath routing

The app uses a dynamic basePath derived from env vars (`CLAUDE_BOT_PATH_PREFIX` + `CLAUDE_BOT_SLUG`). Navigating to `http://localhost:3000/` will return a **404**. To find the correct URL, read `NEXTAUTH_URL` from `.env` — that contains the full base URL including the path prefix. For example, if `NEXTAUTH_URL=http://localhost:3000/foo/bar`, the app is served at `http://localhost:3000/foo/bar`.

## Testing strategy for UI changes

1. **Always run** `npm run build` and `npm run lint` — these catch type errors, import issues, and lint violations.
2. **For Socket.IO–dependent features** (chat, sessions, typing, streaming, tools, presence): full interactive testing requires `npm start` with valid API keys. If those aren't available, verify via build + lint + code review.
3. **For non-Socket.IO UI** (login page, settings pages, static layout): `npm run dev` works. Use the basePath URL from `.env`.

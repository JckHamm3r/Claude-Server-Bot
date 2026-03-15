## Cursor Cloud specific instructions

### Overview
Next.js 14 App Router + Socket.IO + SQLite self-hosted AI assistant platform. See `CLAUDE.md` for quick reference and `docs/README.md` for feature index.

### Running the application
- **Dev (Next.js only):** `pnpm dev` — hot-reload on port 3000 but lacks Socket.IO (chat won't work)
- **Full server:** `pnpm build && pnpm start` — runs `tsx server.ts` with Socket.IO attached; required for testing chat/session features
- **Lint:** `pnpm lint`
- **Build:** `pnpm build`

### Key dev environment gotchas

1. **bcrypt hash escaping in `.env`**: Dollar signs in `CLAUDE_BOT_ADMIN_HASH` are expanded by dotenv-expand. You **must** escape them with backslashes inside double quotes:
   ```
   CLAUDE_BOT_ADMIN_HASH="\$2a\$12\$..."
   ```
   Single quotes do NOT prevent expansion in Next.js's env loading.

2. **Cookie `sameSite` for HTTP dev**: The codebase has `sameSite: "none"` in `src/lib/auth.ts` cookies config, which requires HTTPS. For local HTTP development, this must be changed to `"lax"`. The current branch includes this fix.

3. **SQLite database lock during build**: If `pnpm build` fails with `SQLITE_BUSY`, delete `data/claude-bot.db*` before building. The DB is auto-created on first server start.

4. **`pnpm dev` vs `pnpm start`**: `pnpm dev` runs Next.js dev server only (no Socket.IO). The full app requires `pnpm start` (via `server.ts`). Build first with `pnpm build`.

5. **basePath routing**: All app URLs are under `/<prefix>/<slug>/` (e.g. `/devbot/1df19083efb0/`). When navigating in the browser, always start from the base URL (not `/login` directly) so the middleware sets the correct `callbackUrl`.

6. **ESLint config**: The repo expects `.eslintrc.json` with `@typescript-eslint` plugin configured. The setup branch includes this file and the necessary devDependencies.

### Dev credentials (set in `.env`)
- Email: `admin@dev.local`
- Password: `admin123`
- Base URL: `http://localhost:3000/devbot/1df19083efb0/`

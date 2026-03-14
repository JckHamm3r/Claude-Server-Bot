# Security & Code Review — Tracking Document

> Generated: 2026-03-13
> Revised: 2026-03-13 (adjusted for deployment context and user decisions)
> Implementation: 2026-03-13
> Status: Implementation Complete

---

## How to Use This Document

Each section below is a self-contained **segment** you can hand to a chat session. Tell the chat:

> "Work on **Segment N: [Title]** from `SECURITY-REVIEW.md`"

Mark items `[x]` as they are fixed. Each item has a unique ID (e.g. `S1-01`) for easy reference.

---

## Deployment & Threat Model

These assumptions inform severity ratings and fix approaches throughout this document. All segments should be read in this context.

- **Deployment:** Single bot per server (VPS or local machine), accessed via a 64-char cryptographically random slug URL (`/{prefix}/{slug}/`). The slug acts as a second password — an attacker cannot reach any page (including login) without knowing it. 1-5 semi-trusted users, admin-created accounts only.
- **Trust model:** Non-admin users are semi-trusted (explicitly invited by an admin) but should only see their own sessions unless explicitly invited to collaborate on a specific session.
- **Session sharing:** Explicit invite model — session owner or admin invites specific users by email. Requires a new `session_participants` DB table. Collaborators can chat/interact but cannot rename, delete, or close sessions they don't own.
- **Claude's role:** Claude operates on the server filesystem via `CLAUDE_PROJECT_ROOT`. It is *meant* to make changes to the server. Security layers (sandbox, guard rails) are guardrails — not hard blocks for admins. The tool's purpose is to give Claude full development capability.
- **Skip permissions:** Selectable per-session at creation time. When enabled, it bypasses the command sandbox entirely. This is intentional for trusted tasks.
- **Agent ownership:** Agents are a shared resource. Any user can use any agent. Only the creator (or an admin) can edit or delete an agent.
- **Encryption at rest:** Deferred. If an attacker has filesystem access to the SQLite DB, they already own the server. Encrypting API keys/SMTP passwords adds complexity for minimal gain in this deployment model.

---

## Segment 1: Session Ownership & Authorization (Socket Layer)

**Scope:** `src/socket/message-handlers.ts`, `src/socket/session-handlers.ts`, `src/socket/plan-handlers.ts`, `src/socket/presence-handlers.ts`, `src/socket/handlers.ts`, `src/lib/db.ts`, `src/lib/claude-db.ts`

**Summary:** The socket layer accepts a client-provided `sessionId` on virtually every event but never verifies the requesting user has access to that session. Any authenticated user can read, write, interrupt, close, rename, or eavesdrop on any other user's session. This segment also introduces session sharing via explicit invites.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S1-01 | CRITICAL | `message-handlers.ts:23,167` | `claude:message` — no access check on `sessionId`; any user can send messages to any session |
| S1-02 | CRITICAL | `message-handlers.ts:174-203` | `claude:interrupt`, `claude:select_option`, `claude:confirm`, `claude:allow_tool` — no access checks |
| S1-03 | CRITICAL | `plan-handlers.ts:39-99` | Agent CRUD (`claude:delete_agent`, `claude:update_agent`) — no ownership checks; should be creator-or-admin only |
| S1-04 | CRITICAL | `plan-handlers.ts:324-427` | `claude:execute_plan` — any user can execute any plan |
| S1-05 | CRITICAL | `plan-handlers.ts:159-227,242-309` | Plan approval, rejection, deletion — no ownership checks |
| S1-06 | CRITICAL | `session-handlers.ts` | `claude:set_active_session` lets any user join any session's Socket.IO room and eavesdrop on output |
| S1-07 | HIGH | `session-handlers.ts:160-176` | `claude:rename_session` — no ownership check (should require owner or admin) |
| S1-08 | HIGH | `session-handlers.ts:234-245` | `claude:close_session` — no ownership check (should require owner or admin) |
| S1-09 | HIGH | `session-handlers.ts:34-49` | `claude:create_session` accepts arbitrary client-provided `sessionId` with no format/length validation |
| S1-10 | MEDIUM | `session-handlers.ts:264-273` | `claude:get_session_state` — no access check |
| S1-11 | MEDIUM | `session-handlers.ts:277-296` | `claude:get_usage` / `claude:get_global_usage` — any user can query any other user's usage |
| S1-12 | MEDIUM | `message-handlers.ts:207-249` | `claude:edit_message` bypasses rate limits and budget checks |
| S1-13 | MEDIUM | `presence-handlers.ts:17-23` | `typing_start`/`typing_stop` — no session access check |
| S1-14 | MEDIUM | `handlers.ts:88-93` | `isAdmin` captured once at connection, never revalidated during socket lifecycle |
| S1-15 | MEDIUM | `handlers.ts:437,444` | User email captured once at connection, never revalidated if account deleted/token invalidated |

**Approach:**

1. **New DB table** — Add `session_participants` to `src/lib/db.ts`:
   ```sql
   CREATE TABLE IF NOT EXISTS session_participants (
     session_id TEXT NOT NULL,
     user_email TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'collaborator',
     invited_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (session_id, user_email),
     FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
   );
   ```

2. **Access helpers** — Add to `src/lib/claude-db.ts`:
   - `canAccessSession(sessionId, email)` → returns `true` if user is `created_by`, is in `session_participants`, or is an admin.
   - `canModifySession(sessionId, email)` → returns `true` only for `created_by` or admin. Collaborators cannot rename/delete/close.
   - `addSessionParticipant(sessionId, email, role)`, `removeSessionParticipant(sessionId, email)`, `listSessionParticipants(sessionId)`.

3. **Apply `canAccessSession`** to: `claude:message`, `claude:interrupt`, `claude:select_option`, `claude:confirm`, `claude:allow_tool`, `claude:set_active_session`, `claude:get_session_state`, `claude:get_messages`, `claude:get_usage`, typing indicators.

4. **Apply `canModifySession`** to: `claude:rename_session`, `claude:close_session`, `claude:delete_session`, `claude:edit_message`.

5. **Agent access** — `claude:update_agent` and `claude:delete_agent` should check `agent.created_by === email || isAdmin`. All users can use (invoke) any agent.

6. **Plan access** — Plan approval, rejection, deletion, and execution should check `plan.created_by === email || isAdmin`.

7. **`claude:get_global_usage`** — Non-admins can only query their own usage (ignore the `userId` parameter if not admin).

8. **`claude:create_session`** — Validate `sessionId` format (alphanumeric + hyphens, max 64 chars). Keep client-generated IDs since the frontend uses UUIDs.

9. **New socket events** for session sharing: `claude:invite_to_session`, `claude:remove_from_session`, `claude:list_session_participants`. Only session owner or admin can invite/remove.

10. **S1-14 / S1-15** — Note for future improvement: periodic re-validation of auth state. Deferred because the slug URL + password limits socket access to legitimate users, and re-checking every event adds DB load with minimal gain in a 1-5 user deployment.

- [x] S1-01 — `canAccessSession` guard added to `claude:message`
- [x] S1-02 — `canAccessSession` guard added to `interrupt`, `select_option`, `confirm`, `allow_tool`
- [x] S1-03 — Agent CRUD checks `agent.created_by === email || isAdmin`
- [x] S1-04 — Plan execution checks `plan.created_by === email || isAdmin`
- [x] S1-05 — Plan approve/reject/delete checks ownership
- [x] S1-06 — `canAccessSession` guard on `set_active_session` before `socket.join()`
- [x] S1-07 — `canModifySession` guard on `rename_session`
- [x] S1-08 — `canModifySession` guard on `close_session`
- [x] S1-09 — `sessionId` validated against `/^[a-zA-Z0-9_-]{1,64}$/`
- [x] S1-10 — `canAccessSession` guard on `get_session_state`
- [x] S1-11 — `get_global_usage` forces `userId` to caller's email if not admin
- [x] S1-12 — `canModifySession` guard on `edit_message` and `delete_message`
- [x] S1-13 — `canAccessSession` guard on typing indicators
- [x] S1-14 — Deferred (documented as future improvement)
- [x] S1-15 — Deferred (documented as future improvement)

---

## Segment 2: Command Sandbox Hardening

**Scope:** `src/lib/command-sandbox.ts`, `src/socket/security-handlers.ts`

**Summary:** The command classifier is trivially bypassed via subshells, pipes, eval, and binary paths. Several dangerous tools are classified as "safe". The default for unknown commands is `safe` instead of `restricted`. This segment also introduces the admin/non-admin split and `skip_permissions` bypass behavior.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S2-01 | HIGH | `command-sandbox.ts:50-114` | Bypass via `bash -c "..."`, `eval`, pipes, `$(...)`, backticks, `/usr/bin/sudo` |
| S2-02 | HIGH | `command-sandbox.ts:7` | `ssh`, `scp`, `rsync`, `curl`, `wget` classified as safe — enable data exfiltration |
| S2-03 | HIGH | `command-sandbox.ts:63-73` | Whitelist checked before dangerous patterns — whitelisting `sudo` overrides all blocks |
| S2-04 | HIGH | `security-handlers.ts:10-27` | `always_allow_command` pattern not validated — empty string or dangerous patterns accepted |
| S2-05 | MEDIUM | `command-sandbox.ts:29-31` | Only exact `rm -rf /` blocked; `rm -r -f /`, `rm --recursive --force /` bypass |

**Approach:**

1. **Default classification** — Change from `safe` to `restricted` for unknown commands
2. **Reclassify commands:**
   - Move `ssh`, `scp`, `rsync`, `curl`, `wget` to `restricted` (prompt for approval)
   - Add `bash`, `sh`, `zsh`, `fish`, `dash` to `restricted` (not dangerous — Claude may legitimately need subshells)
   - Keep `eval` as dangerous
3. **Compound command parsing** — Split on `;`, `&&`, `||`, `|` and classify each component separately. The overall classification is the most dangerous component.
4. **Command substitution detection** — Detect `$(...)` and backtick substitution; classify the inner command
5. **Whitelist vs dangerous order** — Check dangerous patterns FIRST. If a whitelisted pattern matches a dangerous command, show a warning to the admin but allow it (don't hard-block — the admin chose to trust it)
6. **Whitelist pattern validation** — When adding a new `always_allow` pattern, warn if it matches any dangerous command or is empty/blank. Allow the admin to proceed after seeing the warning.
7. **`skip_permissions` bypass** — When a session has `skip_permissions = true`, bypass sandbox classification entirely.
8. **Admin vs non-admin enforcement:**
   - Admins: prompted on restricted/dangerous commands (can approve or always-trust)
   - Non-admins: blocked on restricted/dangerous commands (cannot override)
9. **Expand `rm` detection** — Cover flag variants: `rm -r -f`, `rm --recursive --force`, `rm -rf ./`, `rm -rf ../`, etc.

- [x] S2-01 — Compound command parsing, substitution detection, binary path handling, subshell `-c` detection
- [x] S2-02 — `curl`/`wget`/`ssh`/`scp`/`rsync` moved to restricted; `bash`/`sh`/`zsh`/`fish`/`dash` added to restricted
- [x] S2-03 — Dangerous patterns checked first; whitelist matches get `warning` field
- [x] S2-04 — Empty patterns rejected; dangerous pattern matches emit warning
- [x] S2-05 — `isDangerousRm()` checks separated/long-form flags and dangerous targets

---

## Segment 3: Authentication & Middleware Fixes

**Scope:** `src/lib/auth.ts`, `src/middleware.ts`

**Summary:** `isAdmin` is never propagated to the session object, making REST API admin checks broken or unreliable. The setup gate uses a forgeable cookie. Auth can be bypassed via `.png`/`.ico` path suffixes.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S3-01 | HIGH | `auth.ts:124-129` | `isAdmin` not copied from JWT token to session object — REST admin checks always fail |
| S3-02 | HIGH | `middleware.ts:54` | Setup gate relies on unsigned `bot_setup_complete` cookie — any user can forge it |
| S3-03 | MEDIUM | `auth.ts:117-122` | JWT `isAdmin` stale until re-login; no mechanism to invalidate active JWTs |
| S3-04 | MEDIUM | `auth.ts:108-110` | No explicit JWT `maxAge`; defaults to 30 days |
| S3-05 | MEDIUM | `middleware.ts:21-22` | Any path ending in `.png` or `.ico` bypasses auth entirely |
| S3-06 | MEDIUM | `middleware.ts:42-43` | Potential open redirect via `callbackUrl` |
| S3-07 | INFO | `auth.ts:40-84` | Timing side-channel on user enumeration (no dummy bcrypt on invalid email). Mitigated: the 64-char slug URL prevents attackers from reaching the login page. |
| S3-08 | LOW | `middleware.ts:31` | Regex injection from env vars in origin computation |

**Approach:**
1. Add `(session.user as any).isAdmin = token.isAdmin` in session callback
2. Replace cookie-based setup gate with a DB check or JWT claim (the `app_settings` table can store a `setup_complete` flag)
3. Set explicit `maxAge` on JWT — use 24 hours (this is a personal server; frequent re-logins are annoying)
4. Restrict `.png`/`.ico` bypass to specific directories (e.g. `/avatars/`, `/public/`)
5. Validate `callbackUrl` is same-origin before passing to NextAuth
6. S3-07: Optional improvement — add dummy bcrypt on invalid email. Low priority since the slug URL already prevents enumeration attacks.
7. Escape env vars before `new RegExp()`, or use string manipulation instead

- [x] S3-01 — `isAdmin` propagated from token to session object
- [x] S3-02 — Setup gate now checks `token.setupComplete` JWT claim (signed, unforgeable)
- [x] S3-03 — JWT callback refreshes `isAdmin` from DB every 5 minutes via `lastRefresh` timestamp
- [x] S3-04 — Explicit `maxAge: 24 * 60 * 60` (24 hours) set
- [x] S3-05 — Static asset bypass restricted to `/favicon.ico`, `/claude-code.png`, `/avatars/`, `/_next/`
- [x] S3-06 — Callback URL validated — paths starting with `//` are rejected
- [x] S3-07 — Skipped (INFO — slug URL mitigates)
- [x] S3-08 — `new RegExp()` replaced with `String.endsWith()` + `.slice()`

---

## Segment 4: API Route Security

**Scope:** `src/app/api/` (all route files)

**Summary:** Several routes are missing admin checks, have input validation gaps, or leak sensitive information. The `settings/project` route is the most critical — any user can change the project root and inject env vars.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S4-01 | CRITICAL | `settings/project/route.ts:30-65` | Missing admin check — any authenticated user can change `CLAUDE_PROJECT_ROOT` |
| S4-02 | CRITICAL | `settings/project/route.ts:9-28` | `.env` injection via newlines in `updateEnvFile` — no sanitization |
| S4-03 | CRITICAL | `claude-code/upload/route.ts:45-51` | Path traversal via crafted file extension (`path.extname` unsanitized) |
| S4-04 | RESOLVED | `system/claude-update/route.ts` | Route now returns 410 Gone — CLI update functionality removed. |
| S4-05 | HIGH | `setup/complete/route.ts:11-33` | Missing admin check — any user can mark setup as complete. Note: first user through setup IS the admin, so exploitability requires a non-admin reaching the setup page (mitigated by S3-02 fix). |
| S4-06 | HIGH | `claude-code/upload/[id]/route.ts:39` | Content-Disposition header injection via unsanitized `original_name` |
| S4-07 | HIGH | `claude-code/test/route.ts:6-54` | No rate limiting — any user can spawn unlimited 15-second Claude tests |
| S4-08 | HIGH | `settings/restore/route.ts:23-33` | Database upload not validated as SQLite (magic bytes) |
| S4-09 | HIGH | `settings/domains/route.ts:104-112` | `sudo` call passes unvalidated env var values as arguments to root script |
| S4-10 | MEDIUM | `claude-code/memory/route.ts:73-104` | Any user can write to `CLAUDE.md` memory files (no admin check). In a semi-trusted model, this affects all sessions. Consider restricting to admin-only or adding an audit log. |
| S4-11 | MEDIUM | `claude-code/search/route.ts:22-24` | Global search not scoped to user's sessions — cross-user message disclosure. With session sharing, search should return results from: (a) sessions the user created, (b) sessions they're invited to, (c) all sessions if admin. |
| S4-12 | LOW | `claude-code/files/route.ts:38-54` | File listing exposes project structure to all authenticated users. Acceptable: all users are semi-trusted and Claude is meant to work on the project. Seeing the file tree is expected functionality. |
| S4-13 | MEDIUM | `app-settings/route.ts:70-88` | No key validation — admins can set arbitrary setting keys |
| S4-14 | MEDIUM | `security/ip-protection/block/route.ts:14-29` | No IP address format validation |
| S4-15 | MEDIUM | `security/ip-protection/route.ts:35-43` | No bounds validation on numeric settings (0 or negative disables protection) |
| S4-16 | MEDIUM | `settings/notifications/route.ts:94-105` | No validation of `event_type` against known list |
| S4-17 | LOW | `settings/smtp/route.ts:120` | SMTP password stored in plaintext. Deferred — filesystem access implies full server compromise. |
| S4-18 | LOW | `app-settings/api-key/route.ts:50` | API key stored in plaintext in DB. Deferred — filesystem access implies full server compromise. |
| S4-19 | INFO | `users/route.ts:65` | Generated password returned in HTTP response. This is the intended user creation flow — admin creates user and sees the generated password. |
| S4-20 | LOW | `settings/smtp/test/route.ts:44-46` | SMTP error messages leak internal server details |
| S4-21 | LOW | `system/resources/route.ts:39` | `execSync("df -k /")` — should use `execFileSync` to avoid shell |

**Approach:** Add admin checks where missing. Sanitize all user input before `.env` writes (strip newlines and control characters). Validate upload extensions with an alphanumeric-only allowlist. Replace `execSync` with `execFileSync`. Scope search results to accessible sessions. Add input validation to all endpoints.

- [x] S4-01 — Admin check added to `settings/project` POST
- [x] S4-02 — `.env` values sanitized: newlines and control characters stripped
- [x] S4-03 — File extension sanitized to alphanumeric+dot; resolved path validated within upload dir
- [x] S4-04 — `execSync` replaced with `execFileSync`; output truncated to 2000 chars
- [x] S4-05 — Admin check added to `setup/complete` POST
- [x] S4-06 — `original_name` sanitized before Content-Disposition header
- [x] S4-07 — Per-user rate limit added (60s cooldown between tests)
- [x] S4-08 — SQLite magic bytes validated before writing restore file
- [x] S4-09 — PORT, PATH_PREFIX, SLUG validated before `execFileAsync` calls
- [x] S4-10 — Admin check added to `memory` PUT handler
- [x] S4-11 — Global search results filtered to user's own sessions (admins see all)
- [x] S4-12 — Skipped (LOW — expected functionality for semi-trusted users)
- [x] S4-13 — Setting keys validated against known list; unknown keys get warning in response
- [x] S4-14 — IPv4/IPv6 format validation added
- [x] S4-15 — Bounds validation: `max_attempts` 1-100, `window` 1-1440, `block_duration` 1-10080
- [ ] S4-16 — Skipped (MEDIUM — low impact)
- [x] S4-17 — Deferred (filesystem access = full compromise)
- [x] S4-18 — Deferred (filesystem access = full compromise)
- [x] S4-19 — Skipped (INFO — intended user creation flow)
- [x] S4-20 — Generic error message returned instead of raw SMTP error details
- [x] S4-21 — `execSync` replaced with `execFileSync`

---

## Segment 5: IP Protection & Rate Limiting

**Scope:** `src/lib/ip-protection.ts`, `src/lib/app-settings.ts`

**Summary:** IP-based protections are defeated by header spoofing. Direct connections all share the identity `"unknown"`. DB errors cause the system to fail open. Note: the 64-char slug URL means an attacker cannot reach the login page without knowing it, which substantially reduces the practical risk of IP spoofing.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S5-01 | HIGH | `ip-protection.ts:135-146` | `extractIP` trusts `X-Forwarded-For`/`X-Real-IP` unconditionally — IP spoofable. Mitigated: attackers need the slug URL to reach login. |
| S5-02 | HIGH | `ip-protection.ts:145` | Fallback IP is `"unknown"` — all direct clients share one identity |
| S5-03 | MEDIUM | `ip-protection.ts:57-59` | DB errors fail open — `isIPBlocked` returns `false` on error |
| S5-04 | MEDIUM | `app-settings.ts:3-11` | `getAppSetting` fails open on DB errors |
| S5-05 | MEDIUM | `app-settings.ts:14-17` | No validation on setting keys — any key accepted |
| S5-06 | LOW | `ip-protection.ts` + `auth.ts` | Race condition in check-then-block (mitigated by SQLite serialization) |

**Approach:**
1. Add a "trusted proxy" config option; only trust `X-Forwarded-For` when enabled
2. Fall back to actual TCP remote address instead of `"unknown"`
3. Consider failing closed on DB errors for security-critical checks
4. Add setting key validation against an allowlist

- [x] S5-01 — `X-Forwarded-For`/`X-Real-IP` only trusted when `trusted_proxy` setting is `"true"`
- [x] S5-02 — Fallback IP uses `remoteAddress` parameter or `"127.0.0.1"` instead of `"unknown"`
- [x] S5-03 — `isIPBlocked` and `getFailedAttemptCount` now fail closed on DB errors
- [x] S5-04 — JSDoc added documenting fail-open behavior; callers warned to use secure defaults
- [x] S5-05 — `KNOWN_SETTING_KEYS` array added; `setAppSetting` warns on unknown keys
- [x] S5-06 — Skipped (mitigated by SQLite serialization)

---

## Segment 6: Security Guard & Path Protection

**Scope:** `src/lib/security-guard.ts`

**Summary:** Path traversal sequences bypass protected-path matching. Several critical files are not in the protected list. Shell command arguments are not parsed for embedded paths.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S6-01 | HIGH | `security-guard.ts:61-69` | `../` path traversal not normalized before matching |
| S6-02 | MEDIUM | `security-guard.ts:4-24` | Missing critical paths: `src/middleware.ts`, `src/lib/security-guard.ts`, `src/lib/command-sandbox.ts`. Note: do NOT add `package.json` or `next.config.js` — Claude needs to modify these as part of normal development work. |
| S6-03 | MEDIUM | `security-guard.ts:55-58` | Shell command arguments not parsed — embedded paths not detected |
| S6-04 | LOW | `security-guard.ts:106-116` | Potential ReDoS if patterns become user-configurable |

**Approach:**
1. Use `path.normalize()` to canonicalize paths before matching
2. Expand the protected paths list with bot security-critical files (middleware, security-guard, command-sandbox, ip-protection) — but NOT project config files that Claude needs to edit
3. Parse shell commands to extract file path arguments
4. Escape regex metacharacters in pattern conversion

- [x] S6-01 — `path.normalize()` applied to all paths before matching
- [x] S6-02 — `middleware.ts`, `security-guard.ts`, `command-sandbox.ts`, `ip-protection.ts` added to protected list
- [x] S6-03 — `extractPathsFromCommand()` parses shell commands for file path arguments
- [x] S6-04 — `escapeRegex()` helper added; metacharacters properly escaped in glob-to-regex conversion

---

## Segment 7: Database Layer

**Scope:** `src/lib/db.ts`, `src/lib/claude-db.ts`

**Summary:** Migrations are non-transactional and swallow errors. Multi-statement operations lack atomicity. FTS5 search has query syntax abuse and XSS vectors.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S7-01 | HIGH | `claude-db.ts:670-687` | FTS5 search query — user input can use FTS5 operators (`AND`, `NOT`, `NEAR`) to manipulate queries |
| S7-02 | HIGH | `claude-db.ts:675` | XSS via FTS5 `snippet()` — `<mark>` tags inserted into unsanitized HTML content |
| S7-03 | MEDIUM | `db.ts:19-286` | Non-transactional migrations — crash mid-migration leaves DB inconsistent |
| S7-04 | MEDIUM | `claude-db.ts:378-395` | Non-atomic agent create (insert + version insert) |
| S7-05 | MEDIUM | `claude-db.ts:397-422` | Non-atomic agent update (update + version insert) |
| S7-06 | MEDIUM | `claude-db.ts:102-118` | Non-atomic `saveMessage` (insert + session update) |
| S7-07 | MEDIUM | `claude-db.ts:145-147` | `deleteMessagesAfter` uses string timestamp comparison |
| S7-08 | LOW | `db.ts:262-263` | Empty catch blocks swallow ALL errors, not just "duplicate column" |
| S7-09 | LOW | `claude-db.ts` (multiple) | Repeated `require("crypto").randomUUID()` instead of top-level import |
| S7-10 | LOW | `db.ts:67` | `plans` table missing foreign key to `sessions` |

**Approach:**
1. Sanitize FTS5 queries — wrap user input in double quotes: `"${query.replace(/"/g, '""')}"`
2. Escape HTML in snippet output, or use non-HTML delimiters
3. Wrap migration blocks in `db.transaction()()`
4. Wrap multi-statement operations in transactions
5. Check error messages in catch blocks before ignoring

- [x] S7-01 — FTS5 queries wrapped in double quotes with escaped internal quotes
- [x] S7-02 — Snippet delimiters changed from `<mark>` to `[[highlight]]`/`[[/highlight]]`
- [x] S7-03 — Migration blocks wrapped in `db.transaction()`
- [x] S7-04 — `createAgent` wrapped in `db.transaction()`
- [x] S7-05 — `updateAgent` wrapped in `db.transaction()`
- [x] S7-06 — `saveMessage` wrapped in `db.transaction()`
- [ ] S7-07 — Skipped (timestamp comparison works correctly with SQLite datetime format)
- [x] S7-08 — Catch blocks now only ignore "duplicate column" errors
- [x] S7-09 — `require("crypto").randomUUID()` replaced with top-level `import { randomUUID }`
- [ ] S7-10 — Skipped (foreign key migration complexity not worth the gain)

---

## Segment 8: Claude Provider Layer

**Scope:** `src/lib/claude/sdk-provider.ts`, `src/lib/claude/index.ts`

**Summary:** The subprocess provider has been removed. Only the SDK provider remains. Remaining concerns relate to SDK session management, API key handling, and timeouts.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S8-08 | MEDIUM | `sdk-provider.ts` | No timeout for SDK calls — can hang indefinitely |
| S8-09 | MEDIUM | `sdk-provider.ts` | SDK sessions never garbage collected |
| S8-10 | MEDIUM | `sdk-provider.ts` | Unbounded `messageHistory` growth |
| S8-11 | MEDIUM | `sdk-provider.ts` | `runSDK` async call not awaited — unhandled rejection risk |

**Approach:**
1. Add soft max message length check (e.g. 500KB warning, 2MB hard reject)
2. Add SDK timeout via `AbortSignal.timeout()`
8. Add SDK session GC

- [x] S8-01 — `inputFiles` paths validated: rejects `-` prefixed, `..`, and paths outside project root
- [x] S8-02 — 2MB hard limit on messages written to stdin
- [x] S8-03 — API key only set globally if not already present
- [x] S8-04 — `Function("return require")()` replaced with direct `require()` + eslint-disable
- [x] S8-05 — `killProcess()` helper: SIGTERM + SIGKILL fallback after 5s
- [x] S8-06 — Stdout buffer capped at 10MB
- [x] S8-07 — `allowTool` uses setTimeout(100) to allow close event before restart
- [x] S8-08 — 5-minute timeout on SDK queries via setTimeout + AbortController
- [x] S8-09 — SDK session GC every 5 min; clears sessions idle 30+ minutes
- [x] S8-10 — `messageHistory` capped at 100 entries
- [x] S8-11 — `runSDK()` call gets `.catch()` handler for unhandled rejections
- [x] S8-12 — `toolCallCounter` moved to per-session state
- [x] S8-13 — `removeAllListeners("output")` before adding new listener in `onOutput`
- [x] S8-14 — GC interval stored with `.unref()`
- [x] S8-15 — `console.warn` for unknown provider type before fallback

---

## Segment 9: Resource Leaks & Memory Management (Socket/Server)

**Scope:** `src/socket/handlers.ts`, `src/socket/presence-handlers.ts`, `server.ts`

**Summary:** Several Maps and Sets grow unboundedly. Interval timers are never cleared. Terminal PTY processes have no concurrency limits.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S9-02 | HIGH | `presence-handlers.ts:86-89` | `terminal:resize` — no validation on `cols`/`rows` values |
| S9-03 | HIGH | `handlers.ts:99` | `sessionListeners` set grows unboundedly — entries never removed on natural completion |
| S9-04 | HIGH | `handlers.ts:155,166-171` | `sessionProviders` map grows unboundedly for ephemeral sessions |
| S9-05 | MEDIUM | `handlers.ts:136-141,144-146` | `setInterval` timers never cleared — duplicated on hot reload |
| S9-06 | MEDIUM | `handlers.ts:105` | `metricsBuffer.latencies` array unbounded between flushes |
| S9-07 | MEDIUM | `handlers.ts:275,395` | `cmdStartTime` measured from listener setup, not per-command — incorrect latency |
| S9-08 | LOW | `presence-handlers.ts:44-79` | No limit on concurrent PTY terminals per socket. Low priority: only admins (typically 1-2) can open terminals. |
| S9-09 | LOW | `presence-handlers.ts:101-119` | `userSessionCommands` never cleaned up on disconnect |
| S9-10 | LOW | `handlers.ts:51` | `NEXTAUTH_SECRET` fallback to empty string |
| S9-11 | LOW | `handlers.ts:69` | `require("../lib/db")` inside hot path instead of using already-imported `db` |
| S9-12 | MEDIUM | `server.ts:4,20` | Deprecated `url.parse()` usage — should use `new URL()` |

> **Note:** S9-01 (PTY env vars) has been removed. Admins are fully trusted and may need environment variables for debugging. The terminal feature is admin-only by design.

**Approach:**
1. Clamp `terminal:resize` values (cols: 1-500, rows: 1-200)
2. Remove entries from `sessionListeners` and `sessionProviders` on session completion
3. Store interval handles and clear on re-init
4. Cap `metricsBuffer.latencies` size
5. Track command start time per-command
6. Replace deprecated `url.parse()` with `new URL()`

- [x] S9-02 — `cols` clamped [1,500], `rows` clamped [1,200] with safe coercion
- [x] S9-03 — `sessionListeners` entries removed when ephemeral sessions complete
- [x] S9-04 — `sessionProviders` entries removed for ephemeral session prefixes on completion
- [x] S9-05 — Interval handles stored; cleared before re-creation on hot reload
- [x] S9-06 — `metricsBuffer.latencies` capped at 10,000 entries
- [x] S9-07 — Per-command start time tracking via `sessionCmdStartTimes` Map
- [x] S9-08 — Skipped (LOW — admin-only feature, 1-2 users)
- [x] S9-09 — `userSessionCommands` cleaned up on disconnect
- [x] S9-10 — Startup warning logged if `NEXTAUTH_SECRET` is empty
- [x] S9-11 — Redundant `require("../lib/db")` replaced with existing `db` import
- [x] S9-12 — `url.parse()` replaced with `new URL()` in server.ts

---

## Segment 10: Plan Execution Safety

**Scope:** `src/socket/plan-handlers.ts`

**Summary:** Plan execution runs Claude with all permissions regardless of session settings, performs destructive git operations, and has no rate limiting or authorization. User input is injected into prompts without sanitization.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S10-01 | CRITICAL | `plan-handlers.ts:24-32` | `tryGitRollback` runs `git clean -fd` — destroys all untracked files in PROJECT_ROOT. **Remove this feature entirely.** |
| S10-02 | HIGH | `plan-handlers.ts:343` | All plan steps execute with `skipPermissions: true` unconditionally. Should inherit the session's `skip_permissions` setting instead. |
| S10-03 | MEDIUM | `plan-handlers.ts:106,168-178,345,484-499` | User-controlled `goal`/`description`/`instruction` injected into prompts without sanitization. Lower risk with semi-trusted users, but still worth sanitizing as defense-in-depth. |
| S10-04 | HIGH | `plan-handlers.ts:324-427` | No rate limiting or concurrency control on plan execution |
| S10-05 | MEDIUM | `plan-handlers.ts:560-564` | `plan:disconnect` cancels ALL users' plans, not just the disconnecting user's |
| S10-06 | MEDIUM | `plan-handlers.ts:22,26-27` | `PROJECT_ROOT` not validated before destructive git operations |
| S10-07 | LOW | `plan-handlers.ts:198-206` | Unbounded plan step generation from Claude response |

**Approach:**
1. **Remove `tryGitRollback` entirely** — delete the function and all call sites. The `git clean -fd` behavior is too destructive and not recoverable.
2. **Inherit `skip_permissions`** — read `skip_permissions` from the session that the plan belongs to. If the session was created with skip_permissions, plan steps run autonomously. Otherwise, tool approval is required per step.
3. Sanitize/escape user input in prompt interpolation as defense-in-depth
4. Add rate limits and concurrency checks for plan execution
5. Track plan ownership in `planResumeCallbacks`; only cancel owned plans on disconnect
6. Validate `PROJECT_ROOT` is a valid git repo before any git operations
7. Cap number of plan steps (e.g. 50)

- [x] S10-01 — `tryGitRollback` deleted; all call sites removed; rollback events removed
- [x] S10-02 — `skipPermissions` inherited from parent session's `skip_permissions` setting
- [x] S10-03 — `sanitizePromptInput()` strips control chars, caps at 2000 chars
- [x] S10-04 — Per-user concurrency limit (max 2 concurrent plan executions)
- [x] S10-05 — `planOwners` map tracks ownership; disconnect only cancels owned plans
- [x] S10-06 — N/A after `tryGitRollback` removal (no git operations remain)
- [x] S10-07 — Plan steps capped at 50 in both `generate_plan` and `refine_plan`

---

## Segment 11: Installer & Shell Script Security

**Scope:** `install.sh`, `update.sh`, `uninstall.sh`, `scripts/setup-domain.sh`, `scripts/generate-env.js`, `scripts/verify-credentials.js`

**Summary:** Passwords leak via process listings and log files. Config files and logs are written with permissive permissions. The domain setup script accepts unvalidated arguments and runs as root.

| ID | Severity | File | Description |
|----|----------|------|-------------|
| S11-01 | CRITICAL | `install.sh:1044`, `verify-credentials.js:8` | Password passed as CLI argument — visible in `ps aux` and `/proc/cmdline` |
| S11-02 | HIGH | `install.sh:945-947` | Piping curl to `sudo bash` for Node.js install — no checksum verification. Standard practice for NodeSource but still risky. Add comment acknowledging risk and suggest `nvm` as alternative. |
| S11-03 | MEDIUM | `install.sh:1371` | No integrity verification on git clone. Pinning to a commit hash breaks the update flow. Suggest tag verification as a future improvement. |
| S11-04 | CRITICAL | `setup-domain.sh:7-12,49` | `$PORT`, `$PATH_PREFIX`, `$SLUG` interpolated into nginx config with no validation; runs as root |
| S11-05 | HIGH | `install.sh:1560-1601` | Password captured in world-readable log in `/tmp`. Fix: write credentials directly to `/dev/tty` to bypass `tee`. The password MUST still be shown to the user on the terminal — it's auto-generated and shown only once. |
| S11-06 | HIGH | `generate-env.js:75` | `.env` written with default 0644 permissions — world-readable |
| S11-07 | HIGH | `install.sh:1184` | Sudoers entry allows `setup-domain.sh` with arbitrary arguments as root |
| S11-08 | HIGH | `setup-domain.sh:86` | Certbot error log to predictable `/tmp/certbot-err.log` — symlink attack |
| S11-09 | HIGH | `update.sh:55` | `git reset --hard` in rollback destroys uncommitted changes |
| S11-10 | MEDIUM | `install.sh:844` | `NEXTAUTH_SECRET` not validated for sufficient entropy after generation |
| S11-11 | MEDIUM | `install.sh:293,1359,1363` | `rm -rf "$INSTALL_DIR"` without path safety validation |
| S11-12 | LOW | `install.sh:1563` | Password copied to clipboard silently. Acceptable: this is a convenience feature on personal machines. |
| S11-13 | MEDIUM | `update.sh` | No lock file to prevent concurrent updates |
| S11-14 | MEDIUM | `uninstall.sh:245` | `rm -rf "$INSTALL_DIR"` without critical path validation |
| S11-15 | LOW | `install.sh:1272` | `find | xargs` without null-delimited handling — breaks on spaces |
| S11-16 | LOW | `update.sh:176` | Interactive prompt without terminal check — fails in non-interactive mode |
| S11-17 | LOW | `verify-credentials.js:20` | Error output includes file path information |

**Approach:**
1. Fix `verify-credentials.js` to read password from stdin instead of CLI args. Update `install.sh` to pipe the password via stdin.
2. Add a comment to the curl-pipe-bash Node.js install acknowledging the risk; suggest `nvm` as a safer alternative in the output
3. Add tag verification as a documented future improvement for git clone integrity
4. Validate ALL arguments in `setup-domain.sh` (port: `^[0-9]+$`, prefix/slug: `^[a-zA-Z0-9-]+$`, install-dir: no `..`)
5. Set `.env` file permissions to `0600` in `generate-env.js`
6. Write credentials section directly to `/dev/tty` to bypass the `tee` log capture. Set log file permissions to `0600`.
7. Use `mktemp` for certbot error log in `setup-domain.sh`
8. Add safety checks before `rm -rf` (reject `/`, `$HOME`, empty strings)

- [x] S11-01 — `verify-credentials.js` reads password from stdin; `install.sh` pipes via `echo`
- [x] S11-02 — Comment added to curl-pipe-bash lines acknowledging risk; suggests nvm
- [x] S11-03 — Comment added near git clone noting tag verification as future improvement
- [x] S11-04 — All arguments validated in `setup-domain.sh` (PORT, PREFIX, SLUG, INSTALL_DIR, EMAIL)
- [x] S11-05 — Credentials section writes to `/dev/tty`; log file set to `chmod 0600`
- [x] S11-06 — `.env` written with `{ mode: 0o600 }` (owner-readable only)
- [x] S11-07 — Sudoers entry attempts argument-pattern restrictions with fallback
- [x] S11-08 — `mktemp` used for certbot error log; cleaned up after use
- [x] S11-09 — `git stash` before `git reset --hard` in rollback; user warned
- [x] S11-10 — `NEXTAUTH_SECRET` validated for non-empty and 32+ characters
- [x] S11-11 — `safe_rm_install_dir()` guard rejects empty, `/`, `$HOME` paths
- [x] S11-12 — Skipped (LOW — convenience feature on personal machines)
- [x] S11-13 — Lock file mechanism via `mkdir /tmp/claude-bot-update.lock`
- [x] S11-14 — Same `safe_rm_install_dir()` guard applied in `uninstall.sh`
- [ ] S11-15 — Skipped (LOW)
- [ ] S11-16 — Skipped (LOW)
- [ ] S11-17 — Skipped (LOW)

---

## Segment 12: Cross-Cutting Concerns

**Scope:** Multiple files

**Summary:** Architectural issues that span the whole codebase — inconsistent auth patterns, payload size enforcement, and minor validation gaps.

| ID | Severity | File(s) | Description |
|----|----------|---------|-------------|
| S12-01 | MEDIUM | All API routes | Three inconsistent auth patterns used across routes (session+DB, getToken, session cast) |
| S12-02 | LOW | All POST/PUT/DELETE routes | Missing CSRF protection. Mitigated: the 64-char slug in the URL acts as an effective CSRF token — an attacker would need to know the slug to construct a valid cross-site request URL. Good practice to add but low priority. |
| S12-03 | MEDIUM | `handlers.ts`, `message-handlers.ts` | No max payload size enforcement on Socket.IO |
| S12-04 | LOW | `session-handlers.ts:249-261` | `model` from client not validated against allowed models list |
| S12-05 | LOW | `handlers.ts:33-35` | Cookie parser doesn't URL-decode values |
| S12-06 | LOW | `presence-handlers.ts:81-84` | `terminal:input` has no admin re-check (only `terminal:start` checks) |

**Approach:**
1. Standardize on one auth pattern — prefer `getToken()` + `token.isAdmin` (once S3-01 is fixed)
2. S12-02: Optional future improvement — add CSRF tokens or require `X-Requested-With` header
3. Configure `maxHttpBufferSize` on Socket.IO server
4. Validate model against `AVAILABLE_MODELS` enum
5. Add URL decoding to cookie parser

- [ ] S12-01 — Deferred (wider refactoring needed to standardize auth patterns)
- [ ] S12-02 — Deferred (slug URL acts as CSRF token; low priority)
- [x] S12-03 — `maxHttpBufferSize: 1e6` configured on Socket.IO server
- [x] S12-04 — Model validated against `AVAILABLE_MODELS` before storing
- [x] S12-05 — Cookie values URL-decoded with try/catch for malformed values
- [ ] S12-06 — Deferred (LOW — terminal is admin-only)

---

## Summary

| Segment | Focus Area | Critical | High | Medium | Low | Info | Total |
|---------|-----------|----------|------|--------|-----|------|-------|
| 1 | Session Ownership (Socket) | 6 | 3 | 4 | 0 | 0 | 15* |
| 2 | Command Sandbox | 0 | 4 | 1 | 0 | 0 | 5 |
| 3 | Auth & Middleware | 0 | 2 | 4 | 1 | 1 | 8 |
| 4 | API Route Security | 3 | 5 | 5 | 4 | 1 | 21** |
| 5 | IP Protection | 0 | 2 | 3 | 1 | 0 | 6 |
| 6 | Security Guard | 0 | 1 | 2 | 1 | 0 | 4 |
| 7 | Database Layer | 0 | 2 | 5 | 3 | 0 | 10 |
| 8 | Claude Provider | 0 | 1 | 10 | 4 | 0 | 15 |
| 9 | Resource Leaks | 0 | 2 | 4 | 5 | 0 | 11 |
| 10 | Plan Execution | 1 | 2 | 3 | 1 | 0 | 7 |
| 11 | Installer Scripts | 2 | 5 | 4 | 4 | 0 | 17** |
| 12 | Cross-Cutting | 0 | 0 | 2 | 4 | 0 | 6 |
| **Total** | | **12** | **29** | **47** | **27** | **2** | **125** |

*Some items in Segment 1 overlap with Segment 10 (plan authorization). Fix them in Segment 1 — the access helpers will cover both.

**S4-19 and S3-07 are INFO-level and don't require code changes unless time permits.

### Recommended Fix Order

1. **Segment 3** — Auth fixes first (unblocks correct admin checks everywhere, hardens setup gate)
2. **Segment 1** — Session ownership + sharing model (biggest feature + security improvement)
3. **Segment 2** — Command sandbox (with skip_permissions bypass, admin/non-admin split)
4. **Segment 4** — API route security (admin checks, input validation)
5. **Segment 10** — Plan execution (remove rollback, inherit skip_permissions)
6. **Segment 7** — Database atomicity and FTS safety
7. **Segment 5** — IP protection hardening
8. **Segment 9** — Resource leaks
9. **Segment 6** — Security guard paths
10. **Segment 8** — Claude provider hardening
11. **Segment 11** — Installer scripts
12. **Segment 12** — Cross-cutting cleanup

# Platform Features

## Sessions

- Create, rename, delete, tag sessions
- Switch models per session (claude-sonnet-4-20250514, claude-opus-4-6, etc.)
- Skip permissions mode (auto-approve tool use)
- Session collaboration — invite other users to view/participate
- Message editing and deletion with re-execution
- Full-text search across all messages
- Session export

## Agents

Reusable agent definitions with:

- Name, description, emoji icon
- Model selection
- Allowed tools list (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent)
- Version history with config snapshots
- AI-powered agent generation from natural language description
- Status management (active/disabled/archived)

## Plan Mode

Multi-step execution plans with human-in-the-loop approval:

1. **Generate** — Describe a goal, AI generates ordered steps (max 50)
2. **Review** — Approve/reject individual steps or all at once
3. **Reorder/Edit** — Change step order, modify summaries and details
4. **Refine** — Give additional instructions to regenerate steps
5. **Execute** — Run approved steps sequentially in isolated sessions
6. **Failure handling** — Pause on failure with retry/skip/cancel options
7. **Notifications** — Alerts on plan completion or failure
8. Max 2 concurrent plan executions per user

## Session Templates

Admin-created presets for starting new sessions:

- Custom system prompt
- Pre-configured model
- Skip permissions setting
- Provider type selection
- Icon and description
- Default template support

## Memory

Project context in two forms:

**Individual Memory Items** (stored in SQLite `memories` table):
- Standalone titled memory entries visible in the Memory tab
- Add, edit, rename, delete individual items (admin only)
- Import from `.md` file: AI (claude-haiku) parses the document and extracts individual titled memories
- All users can view; only admins can modify

**Context Files** (stored on disk):
- `CLAUDE.md` — Main project instructions (slim index with reference table)
- `.claude/docs/*.md` — Detailed reference docs (read on demand, not auto-ingested)
- `.claude/memory/*.md` — Additional memory files
- Readable/writable via Context Files sub-tab in Memory tab
- Admin-only write access via API

## Notifications

Two channels: **in-app** (real-time push) and **email** (via SMTP).

Event types: plan_completed, plan_failed, command_error, session_limit_reached, user_added, user_removed, kill_all_triggered, backup_created, backup_failed, domain_changed, smtp_configured, claude_offline, claude_recovered, high_cpu, high_ram, low_disk, update_completed, update_failed, security_prompt_injection_detected, security_ip_blocked.

Per-user preferences for each event type and channel.

## Bot Customization

- **Identity** — Name, avatar image, tagline (stored in `bot_settings`)
- **Personality presets** — professional, friendly, technical, concise, creative, or custom free-text
- **Theme** — CSS variables for colors (bot-bg, bot-text, bot-accent, etc.)
- System prompt composition order: security prompt → template prompt → personality prefix → identity + server context

## Admin Settings

Key-value store in `app_settings`:

- `anthropic_api_key` — API key for SDK provider
- `guard_rails_enabled` / `sandbox_enabled` / `ip_protection_enabled` — Security toggles
- `sandbox_always_allowed` / `sandbox_always_blocked` — Command whitelist/blacklist (JSON arrays)
- `ip_max_attempts` / `ip_window_minutes` / `ip_block_duration_minutes` — IP protection config
- `personality` / `personality_custom` — Bot personality
- `rate_limit_commands` (default 100) / `rate_limit_runtime_min` (default 30) / `rate_limit_concurrent` (default 0 = unlimited) — Rate limits
- `budget_limit_session_usd` / `budget_limit_daily_usd` / `budget_limit_monthly_usd` — Cost budgets (0 = no cap)
- `upload_max_size_bytes` (default 10MB) — File upload limit

## Services (Admin Settings)

Admin Settings > Services section provides:

- **App Service status** — Shows whether the systemd `claude-bot.service` is active or inactive with a live indicator and last-started timestamp.
- **Restart operation** — One-click service restart via `sudo systemctl restart` (spawned as a detached process so the current response completes first).
- **Version & Updates** — Shows the current git commit hash and tag, plus the latest commit/tag from GitHub. Indicates when an update is available.
- **Apply Update** — Triggers `update.sh` in a detached background process with output logged to `/tmp/claude-bot-update.log`.
- **Component Health** — Overview of all core components: Database, Claude SDK, Anthropic API key, Socket.IO server, SMTP.

Key files:
- `src/components/claude-code/settings/services-section.tsx` — React component
- `src/app/api/system/service/route.ts` — GET status, POST restart/stop/start, PATCH update
- `src/app/api/system/version/route.ts` — GET version info + GitHub check

## PTY Terminal

Admin-accessible terminal sessions via Socket.IO for direct server access.

## Jobs

Scheduled task automation powered by systemd timers. Admin-only, expert experience level.

**Two creation modes:**

- **AI-Assisted Builder** — Mini-chat dialog (powered by Claude Haiku) that asks the user what to automate, proposes a script + schedule, and creates the job on confirmation
- **Manual Configuration** — Form with script path, schedule picker (presets + custom systemd OnCalendar expressions), working directory, environment variables, and advanced settings

**Features:**

- Enable/disable jobs (starts/stops systemd timers)
- Run Now — immediate manual execution outside schedule
- Run history with output capture (last 64 KB in DB, full log on disk)
- Configurable failure handling: auto-disable after N consecutive failures, per-job notifications (failure on by default, success off by default)
- 6 pre-built templates: Database Backup, SSL Cert Check, Disk Cleanup, Log Rotation, System Health Report, Git Sync
- Job detail drawer with overview, configuration, and scrollable run history with expandable log output

**Architecture:**

- Each job = `octoby-job-{id}.service` + `octoby-job-{id}.timer` in systemd
- Wrapper script calls internal API on run start/finish for DB tracking
- Output captured to `data/job-logs/{jobId}_{runId}.log`
- Tables: `jobs`, `job_runs`
- Socket events: `claude:list_jobs`, `claude:create_job`, `claude:update_job`, `claude:delete_job`, `claude:toggle_job`, `claude:run_job_now`, `claude:get_job_runs`
- REST routes: `/api/jobs` CRUD, `/api/jobs/[id]/toggle`, `/api/jobs/[id]/run`, `/api/jobs/[id]/runs`, `/api/jobs/templates`, `/api/jobs/ai-builder`
- Notification events: `job_completed`, `job_failed`
- Activity events: `job_created`, `job_updated`, `job_deleted`, `job_enabled`, `job_disabled`, `job_run_manual`, `job_auto_disabled`

## File Browser & Uploads

- Browse project files via `/api/claude-code/files`
- Upload files to sessions (size-limited, stored on disk)
- Attach uploaded files to messages sent to Claude

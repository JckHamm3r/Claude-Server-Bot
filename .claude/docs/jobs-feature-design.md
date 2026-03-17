# Jobs Feature — Design Document

## Overview

The Jobs feature adds scheduled task automation to Octoby, powered by systemd timers. Users can create recurring or one-shot jobs either through an AI-assisted chat workflow (the AI asks what they want to automate and builds the job for them) or by directly pointing to a script and configuring the schedule manually. Jobs are managed through a dedicated top-level tab with full CRUD, enable/disable toggling, run history, and live status.

## Finalized Decisions

| Question | Decision |
|----------|----------|
| Who can create jobs? | Admin only |
| Sandbox integration | Yes — respects existing command sandbox |
| Max active jobs | No limit |
| Inline scripts vs file paths | File paths only — must reference existing script |
| Job templates | Yes — 6 pre-built templates shipped |
| Dry run | Yes — "Run Now" button for immediate execution |
| Run detection | Wrapper script approach — pings internal API on start/finish |
| Output capture | Last 64 KB in DB + pointer to full log file on disk |
| Failure behavior | All configurable per-job (retry, auto-disable, notify) |
| Experience level | Expert only |
| Detail view | Slide-over drawer from right |
| AI builder | Mini-chat modal dialog with job-building context |
| Success notifications | Off by default |
| Per-job notification overrides | Yes |

---

## Design Questions (Archived — All Answered)

### 1. Scope & Permissions

- **Who can create jobs?** Admin only, or should non-admin users be allowed to create jobs too? If non-admin users can create jobs, should there be an approval workflow (admin must approve before the timer is installed)?
- **Job ownership model**: Should jobs be per-user (each user sees only their own jobs) or global (all users see all jobs, like sessions)?
- **Security boundary**: Jobs will execute shell commands on the server. Should they run inside the command sandbox (respecting the same allow/block lists as chat commands), or have their own security policy? Running arbitrary scripts via systemd timers is a significant privilege escalation compared to interactive chat.
- **Max concurrent jobs**: Should there be a configurable limit on how many active jobs a user (or the system) can have? This prevents runaway timer creation.
- **Resource limits**: Should jobs have optional CPU/memory/timeout limits (e.g., via systemd `CPUQuota=`, `MemoryMax=`, `TimeoutStopSec=`)?

### 2. Job Creation Modes

The feature supports two creation paths:

#### Mode A: AI-Assisted (Interactive Chat)

The user opens a "New Job" dialog and an embedded mini-chat guides them through what they want to automate. The AI:
1. Asks what they want to accomplish
2. Proposes a script or command sequence
3. Asks about frequency/timing
4. Shows a preview of the complete job definition
5. User confirms → job is created

**Questions:**
- Should this use a dedicated lightweight session (like agent generation does), or should it be a full chat session that gets tagged as a "job builder" session?
- Should the AI be able to *write* the script file to disk as part of job creation, or should it only output the script content and the user saves it?
- Should the AI preview include a "dry run" option (execute the script once immediately to verify it works)?
- Which model should the AI-assisted builder use? Should it default to a fast/cheap model (like Haiku) since it's a structured task, or respect the user's default model preference?

#### Mode B: Manual (Direct Configuration)

The user fills out a form:
- **Script/command**: Either a path to an existing script or an inline command
- **Schedule**: Cron expression, or a friendly picker (every X minutes/hours/days, specific day of week, specific time)
- **Working directory**: Where the script executes from (default: `CLAUDE_PROJECT_ROOT`)
- **Environment variables**: Optional key-value pairs passed to the job
- **Description**: What this job does

**Questions:**
- Should we support inline scripts (user pastes multi-line script content into a textarea) in addition to file paths? If so, where do we store them on disk?
- Should we validate that the script file exists and is executable before saving?
- For the schedule picker, should we support both a "friendly" mode (dropdowns for common intervals) and an "advanced" mode (raw cron/systemd calendar expression)?
- Should there be pre-built job templates? (e.g., "Database backup every night at 2am", "SSL certificate renewal check weekly", "Disk cleanup when usage > 80%")

### 3. systemd Integration

Each job maps to a pair of systemd files:
- `octoby-job-{id}.service` — The unit that runs the script
- `octoby-job-{id}.timer` — The timer that triggers it

**Questions:**
- **Unit file location**: `/etc/systemd/system/` (system-wide, requires root) or `~/.config/systemd/user/` (user-level, no root needed but different lifecycle)? System-wide is more reliable for server automation. The existing `claude-bot.service` is system-wide, so this is the natural choice — but it means the app needs sudo access for systemd operations.
- **User context**: Should all jobs run as the same system user (e.g., the user running the Octoby process), or should we support per-job user specification (requires root)?
- **Output capture**: systemd journals (`journalctl -u octoby-job-{id}`) capture stdout/stderr automatically. Should we *also* redirect output to a log file in the data directory for easy in-app viewing? Or rely solely on journalctl parsing?
- **Failure handling**: What should happen when a job fails?
  - Just log it?
  - Send a notification (in-app / email)?
  - Auto-disable after N consecutive failures?
  - Retry with backoff?
- **Cleanup**: When a job is deleted, should we also delete its systemd unit files and journal logs? Or keep logs for a retention period?
- **Timer accuracy**: systemd timers support `AccuracySec=` for batching wakeups. Should we expose this, or default to something reasonable (e.g., `1min`)?
- **Persistent timers**: Should timers use `Persistent=true` so that if the server was down when a job was supposed to run, it runs immediately on next boot?

### 4. Database Schema

Proposed tables:

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  script_path TEXT,          -- Path to script file, NULL if inline command
  command TEXT,              -- Inline command, NULL if script_path is set
  working_directory TEXT,    -- CWD for execution
  schedule TEXT NOT NULL,    -- systemd OnCalendar expression
  schedule_display TEXT,     -- Human-readable version ("Every day at 2:00 AM")
  environment TEXT DEFAULT '{}',  -- JSON key-value pairs
  status TEXT DEFAULT 'active',   -- active | paused | failed | draft
  created_by TEXT NOT NULL,       -- User email
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_run_at TEXT,
  last_run_status TEXT,           -- success | failed | running | null
  next_run_at TEXT,               -- Computed from timer
  run_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  consecutive_failures INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 0,
  timeout_seconds INTEGER DEFAULT 0,  -- 0 = no limit
  tags TEXT DEFAULT '[]',             -- JSON array
  ai_generated INTEGER DEFAULT 0,     -- Was this created via AI assistant?
  systemd_unit TEXT                    -- Name of the systemd unit (for reference)
);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT DEFAULT 'running',  -- running | success | failed | cancelled
  exit_code INTEGER,
  output TEXT,                     -- stdout + stderr capture (truncated if huge)
  duration_ms INTEGER,
  triggered_by TEXT DEFAULT 'timer',  -- timer | manual | retry
  error_summary TEXT
);
```

**Questions:**
- Should `job_runs` store full stdout/stderr output, or just a summary/tail? Full output for long-running jobs could bloat the database. Perhaps store only the last N KB and point to log files for the rest?
- Should we add an `output_log_path` column that points to a file on disk for large outputs?
- Do we need a `job_notifications` table for per-job notification preferences, or is the existing notification system (event types) sufficient with new event types like `job_completed`, `job_failed`?
- Should jobs support input parameters (arguments passed at runtime), or is environment variables sufficient?

### 5. UI Design

#### Tab Placement

Jobs would be a new top-level tab, positioned between "Plan Mode" and "Memory":

`Chat | Agents | Plan Mode | **Jobs** | Memory | Files | Settings | Terminal`

**Questions:**
- Should Jobs be visible at the intermediate experience level, or expert only? Beginners probably shouldn't see it. Intermediate users might benefit from AI-assisted job creation.
- Should there be a "Jobs" section in Settings too (for global job settings like max concurrent, default timeout, auto-disable threshold)?

#### Jobs List View (Main View)

Layout similar to Agents tab — a card-based list with:

| Column/Info | Details |
|------------|---------|
| Status indicator | Green dot (active), gray (paused), red (failed), amber (running) |
| Name + description | Job name, truncated description |
| Schedule | Human-readable ("Every 6 hours", "Daily at 2am") |
| Last run | Relative time + status badge |
| Next run | Relative time |
| Actions | Enable/Disable toggle, Edit, Run Now, View History, Delete |

**Empty state**: Friendly illustration + "Create your first job" with two paths: "Build with AI" and "Configure manually".

**Questions:**
- Should the list support filtering/search (by name, status, tags)?
- Should there be a "Run Now" button that triggers the job immediately outside its schedule?
- Should there be a bulk actions bar (enable all, disable all, delete selected)?
- Card layout or table layout? Cards feel more consistent with Agents, but tables are more information-dense for many jobs.

#### Job Detail / Edit View

When clicking a job, show a detail panel (slide-over or full page?) with:

1. **Overview**: Name, description, status, schedule, script/command preview
2. **Configuration**: Edit all fields (schedule, script, env vars, etc.)
3. **Run History**: Scrollable list of recent runs with expandable output
4. **Logs**: Live-tail of current run output (if running)

**Questions:**
- Slide-over panel (like a drawer from the right) or navigate to a full detail view?
- Should editing be inline (click field to edit) or via a dedicated edit mode/dialog?
- How many run history entries should we show by default? Paginated?
- Should the log viewer support ANSI color codes (like the terminal tab does)?

#### AI Job Builder Dialog

A modal dialog with a mini-chat interface. The conversation flow:

1. AI: "What would you like to automate? Describe what you want to happen."
2. User describes the task
3. AI: Proposes script + schedule, asks for confirmation
4. User adjusts if needed
5. AI: Creates the job, shows the created job card

**Questions:**
- Should this be a modal overlay, or should it open in the existing chat tab with a special "job builder" context?
- Should the AI be able to browse the filesystem to suggest scripts that already exist?
- Should completed AI job builder conversations be saved (for reference/audit), or discarded?
- Should the builder support multi-step refinement, or be a simple back-and-forth?

### 6. API & Socket Design

Following the existing patterns, jobs would use **both** Socket.IO (for real-time operations) and REST (for CRUD that doesn't need real-time).

#### Socket Events (Real-Time)

```
claude:list_jobs        → claude:jobs                    # List all jobs
claude:create_job       → claude:job_created             # Create new job
claude:update_job       → claude:job_updated             # Update job config
claude:delete_job       → claude:job_deleted             # Delete job
claude:toggle_job       → claude:job_updated             # Enable/disable
claude:run_job_now      → claude:job_run_started         # Manual trigger
claude:get_job_runs     → claude:job_runs                # Run history
claude:get_job_output   → claude:job_output              # Live output stream
```

#### REST API Routes

```
GET    /api/jobs                # List jobs (with filters)
POST   /api/jobs                # Create job
GET    /api/jobs/[id]           # Get job detail
PUT    /api/jobs/[id]           # Update job
DELETE /api/jobs/[id]           # Delete job
POST   /api/jobs/[id]/run       # Run now
GET    /api/jobs/[id]/runs      # Run history
GET    /api/jobs/[id]/runs/[runId]  # Single run detail + output
POST   /api/jobs/[id]/toggle    # Enable/disable
```

**Questions:**
- Should the AI job builder use Socket.IO (like plan generation does) or REST? Socket feels more natural for the streaming chat interaction.
- Should job output streaming (for currently-running jobs) go through Socket.IO for real-time tailing?
- Should we add a socket event for AI-assisted job creation: `claude:generate_job` → streams AI conversation → `claude:job_generated`?

### 7. Execution Engine

The execution engine is the backend component that translates job definitions into systemd units and manages their lifecycle.

#### Responsibilities:
1. **Install**: Write `.service` and `.timer` unit files, run `systemctl daemon-reload`, `systemctl enable --now`
2. **Update**: Rewrite unit files, daemon-reload, restart timer
3. **Remove**: Stop and disable timer, remove unit files, daemon-reload
4. **Status sync**: Periodically poll `systemctl` status and sync to database
5. **Output capture**: Read journal entries for job runs and store in `job_runs`
6. **Run tracking**: Detect when a job starts/finishes (via journal or ExecStartPost/ExecStopPost hooks)

**Questions:**
- **Status sync frequency**: How often should we poll systemd for job status? Every 30s? Every 60s? Or use `systemd-journal-gatewayd` / `journalctl --follow` for real-time?
- **Run detection**: How do we reliably detect each invocation start/end?
  - Option A: Use `ExecStartPost=` and `ExecStopPost=` in the unit file to call a webhook/script that creates `job_runs` entries
  - Option B: Parse journal entries periodically
  - Option C: Wrap the actual command in a shell script that notifies our API on start/finish
- **Sudo access**: Installing system-wide timers requires sudo. The existing service restart already uses `sudo systemctl restart`. Should we assume the same sudo access for job management?
- **Startup reconciliation**: On server start, should we scan for existing `octoby-job-*` timers and reconcile with the database (in case someone manually deleted a timer, or the DB was restored from backup)?

### 8. Notifications

New notification event types:

| Event | Description |
|-------|-------------|
| `job_completed` | A scheduled job finished successfully |
| `job_failed` | A job run failed (non-zero exit) |
| `job_disabled_auto` | A job was auto-disabled after N failures |

**Questions:**
- Should `job_completed` notifications be opt-in (off by default) to avoid spamming for frequently-running jobs?
- Should there be per-job notification overrides (e.g., "notify me on failure for THIS job, but not others")?
- Should we show a toast/banner in the UI when a job finishes while the user is on the Jobs tab?

### 9. Security Considerations

- **Script validation**: Should we scan scripts for dangerous patterns before execution? Or trust the admin?
- **Path restrictions**: Should scripts be restricted to certain directories (e.g., within `CLAUDE_PROJECT_ROOT`)?
- **Environment variable secrets**: Should job environment variables be encrypted at rest in the database? They might contain API keys or passwords.
- **Audit trail**: Should job CRUD operations be logged to `activity_log`? (Strongly recommended: yes.)
- **Command sandbox**: If sandbox is enabled, should job commands also pass through the sandbox allow/block lists?

### 10. Edge Cases & Error Handling

- What happens if the user creates a job but the systemd timer fails to install? (Show error, keep job in "draft" status?)
- What if the server restarts while a job is running? (systemd handles this — the process continues, but we might miss the completion event)
- What if someone manually edits the systemd unit files outside of Octoby? (Reconciliation on startup)
- What if the clock changes (NTP sync, timezone change) — do timers adjust automatically? (systemd handles this)
- What if disk is full and output can't be written?
- Maximum output size per run — truncate at what threshold?

---

## Proposed Implementation Phases

### Phase 1: Core Foundation
- Database tables (`jobs`, `job_runs`)
- REST API CRUD routes
- systemd unit file generation and management (install/remove/enable/disable)
- Jobs tab UI with list view, create/edit dialog (manual mode only)
- Enable/disable toggle
- "Run Now" functionality
- Basic run history view

### Phase 2: AI-Assisted Creation & Live Features
- AI job builder dialog (mini-chat)
- Job output live-tailing via Socket.IO
- Run history detail view with log output
- Notifications integration
- Status sync engine (poll systemd → update DB)

### Phase 3: Polish & Advanced Features
- Job templates (pre-built common jobs)
- Schedule picker with friendly UI (in addition to cron expressions)
- Bulk actions
- Per-job notification overrides
- Resource limits (CPU/memory/timeout via systemd)
- Auto-disable after N failures
- Environment variable encryption

---

## Summary

This design covers a full-featured Jobs system that integrates deeply with the existing Octoby patterns (Socket.IO events, SQLite storage, systemd service management, experience-level gating, notification system). The two creation paths (AI-assisted and manual) make it accessible to beginners while giving experts full control.

The biggest architectural decisions to make are around **security boundaries** (sandbox integration, who can create jobs) and **systemd integration depth** (how we track run status, handle failures, manage output). Answers to the questions above will shape the final implementation.

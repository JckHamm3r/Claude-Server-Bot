import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR ?? "./data";

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "claude-bot.db");

const db = new Database(DB_PATH);

// Performance settings
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

// Enable incremental auto-vacuum so freed pages can be reclaimed periodically.
// Switching mode requires a one-time VACUUM if the DB was created without it.
const autoVacuumMode = (db.pragma("auto_vacuum") as { auto_vacuum: number }[])[0]?.auto_vacuum;
if (autoVacuumMode !== 2) {
  db.pragma("auto_vacuum = INCREMENTAL");
  db.exec("VACUUM");
  console.log("[db] Switched to incremental auto_vacuum (one-time VACUUM applied)");
}

// Auto-migrate: create all tables on startup
// Using plain db.exec() instead of transactions for CREATE TABLE IF NOT EXISTS
// statements, since they are idempotent and transactions cause SQLITE_BUSY
// during Next.js parallel worker builds.
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      skip_permissions INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK(sender_type IN ('admin', 'claude')),
      sender_id TEXT,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'chat' CHECK(message_type IN ('chat', 'system', 'error')),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT,
      model TEXT NOT NULL DEFAULT 'claude-opus-4-6',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'archived')),
      current_version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_versions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      config_snapshot TEXT NOT NULL DEFAULT '{}',
      change_description TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      session_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafting' CHECK(status IN ('drafting', 'reviewing', 'executing', 'completed', 'failed', 'cancelled')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plan_steps (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      summary TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'executing', 'completed', 'failed', 'rolled_back')),
      result TEXT,
      error TEXT,
      approved_by TEXT,
      executed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      email TEXT PRIMARY KEY,
      full_trust_mode INTEGER NOT NULL DEFAULT 0,
      custom_default_context TEXT,
      auto_naming_enabled INTEGER NOT NULL DEFAULT 1,
      setup_complete INTEGER NOT NULL DEFAULT 0,
      experience_level TEXT NOT NULL DEFAULT 'expert',
      server_purposes TEXT NOT NULL DEFAULT '[]',
      project_type TEXT NOT NULL DEFAULT '',
      auto_summary INTEGER NOT NULL DEFAULT 1,
      profile_wizard_complete INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

// Add user profile columns for existing databases (safe no-ops if already present)
for (const migration of [
  "ALTER TABLE user_settings ADD COLUMN experience_level TEXT NOT NULL DEFAULT 'expert'",
  "ALTER TABLE user_settings ADD COLUMN server_purposes TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE user_settings ADD COLUMN project_type TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_settings ADD COLUMN auto_summary INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE user_settings ADD COLUMN profile_wizard_complete INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN avatar_url TEXT",
  "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE agents ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0",
]) {
  try { db.exec(migration); } catch { /* column already exists */ }
}

// New Phase-2 tables
db.exec(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      id        INTEGER PRIMARY KEY DEFAULT 1,
      name      TEXT NOT NULL DEFAULT 'Octoby AI',
      avatar    TEXT,
      tagline   TEXT NOT NULL DEFAULT 'Your AI assistant',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO bot_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at  TEXT NOT NULL DEFAULT (datetime('now')),
      session_count   INTEGER DEFAULT 0,
      command_count   INTEGER DEFAULT 0,
      agent_count     INTEGER DEFAULT 0,
      avg_response_ms INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
      event_type TEXT NOT NULL,
      user_email TEXT,
      details    TEXT
    );
  `);

// Seed bot name from CLAUDE_BOT_NAME env var (set during install)
const envBotName = process.env.CLAUDE_BOT_NAME;
if (envBotName) {
  db.prepare(
    "UPDATE bot_settings SET name = ? WHERE id = 1 AND name = 'Octoby AI'"
  ).run(envBotName);
}

// Seed default app_settings if missing
const defaultAppSettings: Record<string, string> = {
  rate_limit_commands: "100",
  rate_limit_runtime_min: "30",
  rate_limit_concurrent: "0",
  personality: "professional",
  personality_custom: "",
  // Phase 4: Security defaults
  guard_rails_enabled: "true",
  ip_protection_enabled: "true",
  ip_max_attempts: "5",
  ip_window_minutes: "10",
  ip_block_duration_minutes: "60",
  sandbox_enabled: "true",
  sandbox_always_allowed: "[]",
  sandbox_always_blocked: "[]",
  anthropic_api_key: "",
  upload_max_size_bytes: "10485760",
  budget_limit_session_usd: "0",
  budget_limit_daily_usd: "0",
  budget_limit_monthly_usd: "0",
  message_retention_days: "0",
  // File lock settings
  file_lock_enabled: "true",
  file_lock_timeout_minutes: "5",
  file_lock_queue_max_size: "50",
  file_lock_cleanup_interval_seconds: "60",
};
const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)"
);
for (const [k, v] of Object.entries(defaultAppSettings)) {
  insertSetting.run(k, v);
}

// Phase 3: Domains, SMTP, Notifications
db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      hostname    TEXT NOT NULL UNIQUE,
      is_primary  INTEGER NOT NULL DEFAULT 0,
      ssl_enabled INTEGER NOT NULL DEFAULT 0,
      verified    INTEGER NOT NULL DEFAULT 0,
      added_at    TEXT NOT NULL DEFAULT (datetime('now')),
      notes       TEXT
    );

    CREATE TABLE IF NOT EXISTS smtp_settings (
      id           INTEGER PRIMARY KEY DEFAULT 1,
      host         TEXT NOT NULL DEFAULT '',
      port         INTEGER NOT NULL DEFAULT 587,
      secure       INTEGER NOT NULL DEFAULT 0,
      username     TEXT NOT NULL DEFAULT '',
      password     TEXT NOT NULL DEFAULT '',
      from_name    TEXT NOT NULL DEFAULT '',
      from_address TEXT NOT NULL DEFAULT '',
      reply_to     TEXT NOT NULL DEFAULT '',
      enabled      INTEGER NOT NULL DEFAULT 1,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO smtp_settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_email    TEXT NOT NULL,
      event_type    TEXT NOT NULL,
      email_enabled INTEGER NOT NULL DEFAULT 0,
      inapp_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_email, event_type)
    );

    CREATE TABLE IF NOT EXISTS inapp_notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      event_type TEXT NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_inapp_notifications_user
    ON inapp_notifications (user_email, id DESC);
`);

// Phase 4: Security tables
db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT NOT NULL,
      email_attempted TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, created_at);

    CREATE TABLE IF NOT EXISTS blocked_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT NOT NULL UNIQUE,
      block_reason TEXT NOT NULL,
      block_type TEXT NOT NULL DEFAULT 'temporary',
      failed_attempt_count INTEGER DEFAULT 0,
      blocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      unblock_at TEXT,
      blocked_by TEXT NOT NULL DEFAULT 'system'
    );
  `);

// Session sharing / collaboration
db.exec(`
  CREATE TABLE IF NOT EXISTS session_participants (
    session_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'collaborator',
    invited_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, user_email),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

// Phase 3: Uploads table
db.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_session ON uploads(session_id);
  `);

// ── Schema versioning ─────────────────────────────────────────────────────
// Numbered migrations run sequentially on startup. Each is idempotent so
// re-running an already-applied migration is harmless.
function getSchemaVersion(): number {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(v: number) {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  ).run(String(v), String(v));
}

function addColumnSafe(table: string, col: string, def: string) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (err: unknown) {
    if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err;
  }
}

const migrations: Record<number, () => void> = {
  4: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_sessions (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_email TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Terminal',
        tmux_session_name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        scrollback_json TEXT NOT NULL DEFAULT '[]',
        cwd TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user ON terminal_sessions(user_email, order_index);

      CREATE TABLE IF NOT EXISTS terminal_bookmarks (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        terminal_session_id TEXT NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
        line_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#58a6ff',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_bookmarks_session ON terminal_bookmarks(terminal_session_id);

      CREATE TABLE IF NOT EXISTS terminal_shares (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        terminal_session_id TEXT NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
        owner_email TEXT NOT NULL,
        invited_email TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(terminal_session_id, invited_email)
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_shares_session ON terminal_shares(terminal_session_id);
      CREATE INDEX IF NOT EXISTS idx_terminal_shares_invited ON terminal_shares(invited_email);
    `);
  },
  1: () => {
    addColumnSafe("sessions", "model", "TEXT NOT NULL DEFAULT 'claude-sonnet-4-6'");
    addColumnSafe("sessions", "provider_type", "TEXT NOT NULL DEFAULT 'sdk'");
    addColumnSafe("sessions", "status", "TEXT NOT NULL DEFAULT 'idle'");
    addColumnSafe("sessions", "personality", "TEXT");
    addColumnSafe("sessions", "claude_session_id", "TEXT");
    addColumnSafe("sessions", "context_journal", "TEXT");

    db.exec(`
      CREATE TABLE IF NOT EXISTS session_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        system_prompt TEXT,
        model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
        skip_permissions INTEGER NOT NULL DEFAULT 0,
        provider_type TEXT NOT NULL DEFAULT 'sdk',
        icon TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
  2: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
    `);
  },
  3: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_locks (
        file_path TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        locked_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS file_operation_queue (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        file_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_input TEXT NOT NULL,
        queued_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'executing', 'completed', 'failed', 'cancelled')),
        started_at TEXT,
        completed_at TEXT,
        error TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_queue_file_status ON file_operation_queue(file_path, status);
      CREATE INDEX IF NOT EXISTS idx_queue_session ON file_operation_queue(session_id);
    `);
  },
  5: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        script_path TEXT NOT NULL,
        schedule TEXT NOT NULL,
        schedule_display TEXT DEFAULT '',
        working_directory TEXT DEFAULT '',
        environment TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'failed', 'draft')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_run_at TEXT,
        last_run_status TEXT CHECK(last_run_status IN ('success', 'failed', 'running') OR last_run_status IS NULL),
        next_run_at TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 0,
        timeout_seconds INTEGER NOT NULL DEFAULT 0,
        auto_disable_after INTEGER NOT NULL DEFAULT 0,
        notify_on_failure INTEGER NOT NULL DEFAULT 1,
        notify_on_success INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        ai_generated INTEGER NOT NULL DEFAULT 0,
        systemd_unit TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_by ON jobs(created_by);

      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'success', 'failed', 'cancelled')),
        exit_code INTEGER,
        output TEXT DEFAULT '',
        output_log_path TEXT,
        duration_ms INTEGER,
        triggered_by TEXT NOT NULL DEFAULT 'timer' CHECK(triggered_by IN ('timer', 'manual', 'retry')),
        error_summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status);
    `);
  },
  6: () => {
    // Add source_type to blocked_ips to distinguish auto/manual/fail2ban origins
    addColumnSafe("blocked_ips", "source_type", "TEXT NOT NULL DEFAULT 'app'");
    // Seed fail2ban integration settings
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run("fail2ban_enabled", "false");
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run("fail2ban_jail", "octoby-auth");
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run("fail2ban_sync_interval_seconds", "30");
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run("api_abuse_protection_enabled", "true");
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run("api_abuse_max_requests", "200");
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run("api_abuse_window_seconds", "60");
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run("api_abuse_block_minutes", "30");
    // Track API request counts for abuse detection
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_request_counts (
        ip_address TEXT NOT NULL,
        window_start TEXT NOT NULL DEFAULT (datetime('now')),
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip_address, window_start)
      );
      CREATE INDEX IF NOT EXISTS idx_api_request_counts_ip ON api_request_counts(ip_address, window_start);
    `);
  },
  7: () => {
    addColumnSafe("sessions", "context_journal", "TEXT");
  },
  9: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS secret_metadata (
        key         TEXT PRIMARY KEY,
        type        TEXT NOT NULL DEFAULT 'secret'
                      CHECK(type IN ('secret', 'api_key', 'variable')),
        description TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
  8: () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#6366f1',
        icon TEXT NOT NULL DEFAULT 'shield',
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS group_permissions (
        group_id TEXT NOT NULL,
        category TEXT NOT NULL,
        permission_key TEXT NOT NULL,
        permission_value TEXT NOT NULL,
        PRIMARY KEY (group_id, category, permission_key),
        FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE
      );
    `);
    addColumnSafe("users", "group_id", "TEXT REFERENCES user_groups(id) ON DELETE SET NULL");
  },
};

const LATEST_SCHEMA_VERSION = Math.max(...Object.keys(migrations).map(Number));
const currentVersion = getSchemaVersion();
for (let v = currentVersion + 1; v <= LATEST_SCHEMA_VERSION; v++) {
  if (migrations[v]) {
    migrations[v]();
    setSchemaVersion(v);
    console.log(`[db] Applied migration ${v}`);
  }
}

// Seed system groups
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('crypto') as { randomUUID: () => string };
  const existingGroups = db.prepare("SELECT COUNT(*) as count FROM user_groups").get() as { count: number };
  if (existingGroups.count === 0) {
    const adminGroupId = randomUUID();
    const defaultGroupId = randomUUID();

    db.prepare("INSERT OR IGNORE INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, ?)").run(
      adminGroupId, 'Administrators', 'Full platform access with all permissions enabled', '#ef4444', 'shield', 1
    );
    db.prepare("INSERT OR IGNORE INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, ?)").run(
      defaultGroupId, 'Default', 'Standard user group with sensible defaults', '#6366f1', 'users', 1
    );

    const defaultPerms: [string, string, string][] = [
      ['platform', 'sessions_create', 'true'],
      ['platform', 'sessions_view_others', 'false'],
      ['platform', 'sessions_collaborate', 'true'],
      ['platform', 'templates_view', 'true'],
      ['platform', 'templates_manage', 'false'],
      ['platform', 'memories_view', 'true'],
      ['platform', 'memories_manage', 'true'],
      ['platform', 'files_browse', 'true'],
      ['platform', 'files_upload', 'true'],
      ['platform', 'terminal_access', 'true'],
      ['ai', 'commands_allowed', '[]'],
      ['ai', 'commands_blocked', '[]'],
      ['ai', 'shell_access', 'true'],
      ['ai', 'full_trust_allowed', 'true'],
      ['ai', 'directories_allowed', '[]'],
      ['ai', 'directories_blocked', '[]'],
      ['ai', 'filetypes_allowed', '[]'],
      ['ai', 'filetypes_blocked', '[]'],
      ['ai', 'read_only', 'false'],
      ['session', 'max_active', '0'],
      ['session', 'max_turns', '0'],
      ['session', 'models_allowed', '[]'],
      ['session', 'delegation_enabled', 'true'],
      ['session', 'delegation_max_depth', '5'],
      ['session', 'default_model', ''],
      ['session', 'default_template', ''],
      ['prompt', 'system_prompt_append', ''],
      ['prompt', 'default_context', ''],
    ];
    const insertPerm = db.prepare("INSERT OR IGNORE INTO group_permissions (group_id, category, permission_key, permission_value) VALUES (?, ?, ?, ?)");
    for (const [cat, key, val] of defaultPerms) {
      insertPerm.run(defaultGroupId, cat, key, val);
    }

    const adminPerms: [string, string, string][] = [
      ['platform', 'sessions_create', 'true'],
      ['platform', 'sessions_view_others', 'true'],
      ['platform', 'sessions_collaborate', 'true'],
      ['platform', 'templates_view', 'true'],
      ['platform', 'templates_manage', 'true'],
      ['platform', 'memories_view', 'true'],
      ['platform', 'memories_manage', 'true'],
      ['platform', 'files_browse', 'true'],
      ['platform', 'files_upload', 'true'],
      ['platform', 'terminal_access', 'true'],
      ['ai', 'commands_allowed', '[]'],
      ['ai', 'commands_blocked', '[]'],
      ['ai', 'shell_access', 'true'],
      ['ai', 'full_trust_allowed', 'true'],
      ['ai', 'directories_allowed', '[]'],
      ['ai', 'directories_blocked', '[]'],
      ['ai', 'filetypes_allowed', '[]'],
      ['ai', 'filetypes_blocked', '[]'],
      ['ai', 'read_only', 'false'],
      ['session', 'max_active', '0'],
      ['session', 'max_turns', '0'],
      ['session', 'models_allowed', '[]'],
      ['session', 'delegation_enabled', 'true'],
      ['session', 'delegation_max_depth', '10'],
      ['session', 'default_model', ''],
      ['session', 'default_template', ''],
      ['prompt', 'system_prompt_append', ''],
      ['prompt', 'default_context', ''],
    ];
    for (const [cat, key, val] of adminPerms) {
      insertPerm.run(adminGroupId, cat, key, val);
    }

    console.log('[db] Seeded system groups: Administrators, Default');
  }
} catch (err) {
  console.error('[db] Failed to seed system groups:', err);
}

// Reset stale statuses on startup (server restart means no session is running)
db.exec("UPDATE sessions SET status = 'idle' WHERE status IN ('running', 'needs_attention')");

// Seed or sync admin user from env
const adminEmail = process.env.CLAUDE_BOT_ADMIN_EMAIL;
const adminHash = process.env.CLAUDE_BOT_ADMIN_HASH;
if (adminEmail && adminHash) {
  const existing = db.prepare("SELECT hash FROM users WHERE email = ?").get(adminEmail) as { hash: string } | undefined;
  if (!existing) {
    db.prepare("INSERT INTO users (email, hash, is_admin) VALUES (?, ?, 1)").run(adminEmail, adminHash);
    console.log(`[db] Seeded admin user: ${adminEmail}`);
  } else if (existing.hash !== adminHash) {
    db.prepare("UPDATE users SET hash = ? WHERE email = ?").run(adminHash, adminEmail);
    console.log(`[db] Synced admin password from env: ${adminEmail}`);
  }
}

// Phase 5: Full-Text Search for messages
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content=messages,
      content_rowid=rowid
    );
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  // One-time rebuild of FTS index from existing data.
  // Only runs if the FTS table is empty but messages exist.
  // Guard: skip if message count exceeds 50k to avoid blocking startup.
  const FTS_REBUILD_THRESHOLD = 50_000;
  const ftsCount = (db.prepare("SELECT COUNT(*) as count FROM messages_fts").get() as { count: number }).count;
  const msgCount = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
  if (ftsCount === 0 && msgCount > 0) {
    if (msgCount > FTS_REBUILD_THRESHOLD) {
      console.warn(
        `[db] Skipping FTS rebuild: ${msgCount} messages exceeds threshold (${FTS_REBUILD_THRESHOLD}). ` +
        "Run manually via SQLite: INSERT INTO messages_fts(messages_fts) VALUES('rebuild')"
      );
    } else {
      db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
      console.log("[db] Rebuilt FTS index for", msgCount, "messages");
    }
  }
} catch (err) {
  console.error("[db] FTS5 setup failed (may not be available):", err);
}

export default db;

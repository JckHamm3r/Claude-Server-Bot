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
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

// New Phase-2 tables
db.exec(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      id        INTEGER PRIMARY KEY DEFAULT 1,
      name      TEXT NOT NULL DEFAULT 'Claude Server Bot',
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
    "UPDATE bot_settings SET name = ? WHERE id = 1 AND name = 'Claude Server Bot'"
  ).run(envBotName);
}

// Seed default app_settings if missing
const defaultAppSettings: Record<string, string> = {
  rate_limit_commands: "100",
  rate_limit_runtime_min: "30",
  rate_limit_concurrent: "0",
  personality: "professional",
  personality_custom: "",
  auto_update_enabled: "false",
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

// Chat improvements: add model + provider_type columns to sessions
try { db.exec("ALTER TABLE sessions ADD COLUMN model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6'"); } catch (err: unknown) { if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err; }
try { db.exec("ALTER TABLE sessions ADD COLUMN provider_type TEXT NOT NULL DEFAULT 'subprocess'"); } catch (err: unknown) { if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err; }

// Session status tracking for background persistence
try { db.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'"); } catch (err: unknown) { if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err; }

// Store which personality was active when the session was created
try { db.exec("ALTER TABLE sessions ADD COLUMN personality TEXT"); } catch (err: unknown) { if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err; }
// Reset stale statuses on startup (server restart means no subprocess is running)
db.exec("UPDATE sessions SET status = 'idle' WHERE status IN ('running', 'needs_attention')");

// Session templates table
db.exec(`
  CREATE TABLE IF NOT EXISTS session_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT,
    model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    skip_permissions INTEGER NOT NULL DEFAULT 0,
    provider_type TEXT NOT NULL DEFAULT 'subprocess',
    icon TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

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

  // One-time rebuild of FTS index from existing data
  // Only runs if the FTS table is empty but messages exist
  const ftsCount = (db.prepare("SELECT COUNT(*) as count FROM messages_fts").get() as { count: number }).count;
  const msgCount = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
  if (ftsCount === 0 && msgCount > 0) {
    db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
    console.log("[db] Rebuilt FTS index for", msgCount, "messages");
  }
} catch (err) {
  console.error("[db] FTS5 setup failed (may not be available):", err);
}

export default db;

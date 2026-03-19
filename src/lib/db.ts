import { createClient, type Client, type InValue } from "@libsql/client";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "claude-bot.db");

let client: Client;

function getClient(): Client {
  if (!client) {
    client = createClient({ url: `file:${DB_PATH}` });
  }
  return client;
}

// ── Core async helpers ────────────────────────────────────────────────────────

export async function dbGet<T = Record<string, unknown>>(
  sql: string,
  params: InValue[] = []
): Promise<T | undefined> {
  const result = await getClient().execute({ sql, args: params });
  if (result.rows.length === 0) return undefined;
  return rowToObject<T>(result);
}

export async function dbAll<T = Record<string, unknown>>(
  sql: string,
  params: InValue[] = []
): Promise<T[]> {
  const result = await getClient().execute({ sql, args: params });
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < result.columns.length; i++) {
      obj[result.columns[i]] = row[i];
    }
    return obj as T;
  });
}

export async function dbRun(
  sql: string,
  params: InValue[] = []
): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
  const result = await getClient().execute({ sql, args: params });
  return {
    changes: result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid ?? 0,
  };
}

export async function dbExec(sql: string): Promise<void> {
  // Split on semicolons for multi-statement blocks; libsql executes one at a time
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await getClient().execute(stmt);
  }
}

export async function dbTransaction<T>(
  fn: (helpers: {
    get: typeof dbGet;
    all: typeof dbAll;
    run: typeof dbRun;
  }) => Promise<T>
): Promise<T> {
  // @libsql/client local-file mode supports interactive transactions
  const tx = await getClient().transaction("write");
  try {
    const helpers = {
      get: async <R = Record<string, unknown>>(sql: string, params: InValue[] = []) => {
        const result = await tx.execute({ sql, args: params });
        if (result.rows.length === 0) return undefined as R | undefined;
        return rowToObjectFromResult<R>(result.columns, result.rows[0]);
      },
      all: async <R = Record<string, unknown>>(sql: string, params: InValue[] = []) => {
        const result = await tx.execute({ sql, args: params });
        return result.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          for (let i = 0; i < result.columns.length; i++) obj[result.columns[i]] = row[i];
          return obj as R;
        });
      },
      run: async (sql: string, params: InValue[] = []) => {
        const result = await tx.execute({ sql, args: params });
        return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid ?? 0 };
      },
    };
    const result = await fn(helpers);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function dbPragma(pragma: string): Promise<void> {
  await getClient().execute(`PRAGMA ${pragma}`);
}

export async function dbClose(): Promise<void> {
  if (client) {
    client.close();
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function rowToObject<T>(result: { columns: string[]; rows: ArrayLike<unknown>[] }): T {
  return rowToObjectFromResult<T>(result.columns, result.rows[0]);
}

function rowToObjectFromResult<T>(columns: string[], row: ArrayLike<unknown>): T {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]] = (row as unknown[])[i];
  }
  return obj as T;
}

// ── Schema & migrations ───────────────────────────────────────────────────────

async function getSchemaVersion(): Promise<number> {
  try {
    const row = await dbGet<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'schema_version'"
    );
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

async function setSchemaVersion(v: number): Promise<void> {
  await dbRun(
    "INSERT INTO app_settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')",
    [String(v), String(v)]
  );
}

async function addColumnSafe(table: string, col: string, def: string): Promise<void> {
  try {
    await getClient().execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  } catch (err: unknown) {
    if (!(err instanceof Error && err.message.includes("duplicate column"))) throw err;
  }
}

const migrations: Record<number, () => Promise<void>> = {
  1: async () => {
    await addColumnSafe("sessions", "model", "TEXT NOT NULL DEFAULT 'claude-sonnet-4-6'");
    await addColumnSafe("sessions", "provider_type", "TEXT NOT NULL DEFAULT 'sdk'");
    await addColumnSafe("sessions", "status", "TEXT NOT NULL DEFAULT 'idle'");
    await addColumnSafe("sessions", "personality", "TEXT");
    await addColumnSafe("sessions", "claude_session_id", "TEXT");
    await addColumnSafe("sessions", "context_journal", "TEXT");

    await dbExec(`
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
      )
    `);
  },
  2: async () => {
    await dbExec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC)
    `);
  },
  3: async () => {
    await dbExec(`
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
      CREATE INDEX IF NOT EXISTS idx_queue_session ON file_operation_queue(session_id)
    `);
  },
  4: async () => {
    await dbExec(`
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
      CREATE INDEX IF NOT EXISTS idx_terminal_shares_invited ON terminal_shares(invited_email)
    `);
  },
  5: async () => {
    await dbExec(`
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
      CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status)
    `);
  },
  6: async () => {
    await addColumnSafe("blocked_ips", "source_type", "TEXT NOT NULL DEFAULT 'app'");
    const seedSettings = [
      ["fail2ban_enabled", "false"],
      ["fail2ban_jail", "octoby-auth"],
      ["fail2ban_sync_interval_seconds", "30"],
      ["api_abuse_protection_enabled", "true"],
      ["api_abuse_max_requests", "200"],
      ["api_abuse_window_seconds", "60"],
      ["api_abuse_block_minutes", "30"],
    ];
    for (const [k, v] of seedSettings) {
      await dbRun("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)", [k, v]);
    }
    await dbExec(`
      CREATE TABLE IF NOT EXISTS api_request_counts (
        ip_address TEXT NOT NULL,
        window_start TEXT NOT NULL DEFAULT (datetime('now')),
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip_address, window_start)
      );
      CREATE INDEX IF NOT EXISTS idx_api_request_counts_ip ON api_request_counts(ip_address, window_start)
    `);
  },
  7: async () => {
    await addColumnSafe("sessions", "context_journal", "TEXT");
  },
  8: async () => {
    await dbExec(`
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
      )
    `);
    await addColumnSafe("users", "group_id", "TEXT REFERENCES user_groups(id) ON DELETE SET NULL");
  },
  9: async () => {
    const { randomUUID } = await import("crypto");

    async function applyPerms(groupId: string, perms: [string, string, string][]) {
      for (const [cat, key, val] of perms) {
        await dbRun(
          "INSERT INTO group_permissions (group_id, category, permission_key, permission_value) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, category, permission_key) DO UPDATE SET permission_value = excluded.permission_value",
          [groupId, cat, key, val]
        );
      }
    }

    const ALL_SETTINGS = JSON.stringify([
      "general","notifications","bot_identity","transformer","templates",
      "user_management","user_groups","security","rate_limits","budgets","api_key","secrets",
      "system","services","service_manager","packages","updates","project",
      "domains","smtp","backup","database","activity_log"
    ]);
    const ALL_TABS = JSON.stringify(["chat","agents","plan","jobs","memory","files","terminal"]);

    const techAdminRow = await dbGet<{ id: string }>("SELECT id FROM user_groups WHERE name = 'Administrators'");
    if (techAdminRow) {
      await dbRun(
        "UPDATE user_groups SET name=?, description=?, color=?, icon=?, updated_at=datetime('now') WHERE id=?",
        ['Technical Admin', 'Full server access including terminal, security, and all infrastructure controls.', '#ef4444', 'shield-check', techAdminRow.id]
      );
      await applyPerms(techAdminRow.id, [
        ['platform','sessions_create','true'],['platform','sessions_view_others','true'],
        ['platform','sessions_collaborate','true'],['platform','templates_view','true'],
        ['platform','templates_manage','true'],['platform','memories_view','true'],
        ['platform','memories_manage','true'],['platform','files_browse','true'],
        ['platform','files_upload','true'],['platform','terminal_access','true'],
        ['platform','observe_only','false'],
        ['platform','visible_tabs',ALL_TABS],
        ['platform','visible_settings',ALL_SETTINGS],
        ['ai','commands_allowed','[]'],['ai','commands_blocked','[]'],
        ['ai','shell_access','true'],['ai','full_trust_allowed','true'],
        ['ai','directories_allowed','[]'],['ai','directories_blocked','[]'],
        ['ai','filetypes_allowed','[]'],['ai','filetypes_blocked','[]'],
        ['ai','read_only','false'],
        ['session','max_active','0'],['session','max_turns','0'],
        ['session','models_allowed','[]'],['session','delegation_enabled','true'],
        ['session','delegation_max_depth','10'],['session','default_model',''],
        ['session','default_template',''],
        ['prompt','system_prompt_append',''],['prompt','default_context',''],
        ['prompt','communication_style','expert'],
      ]);
    }

    const employeeRow = await dbGet<{ id: string }>("SELECT id FROM user_groups WHERE name = 'Default'");
    if (employeeRow) {
      await dbRun(
        "UPDATE user_groups SET name=?, description=?, color=?, icon=?, updated_at=datetime('now') WHERE id=?",
        ['Employee', 'Standard employee access. Can create sessions and use AI within sandboxed AI permissions.', '#6366f1', 'user', employeeRow.id]
      );
      await applyPerms(employeeRow.id, [
        ['platform','sessions_create','true'],['platform','sessions_view_others','false'],
        ['platform','sessions_collaborate','true'],['platform','templates_view','true'],
        ['platform','templates_manage','false'],['platform','memories_view','true'],
        ['platform','memories_manage','false'],['platform','files_browse','false'],
        ['platform','files_upload','false'],['platform','terminal_access','false'],
        ['platform','observe_only','false'],
        ['platform','visible_tabs',JSON.stringify(["chat","agents","plan","memory"])],
        ['platform','visible_settings',JSON.stringify(["general","notifications"])],
        ['ai','commands_allowed','[]'],['ai','commands_blocked','[]'],
        ['ai','shell_access','true'],['ai','full_trust_allowed','false'],
        ['ai','directories_allowed','[]'],['ai','directories_blocked','[]'],
        ['ai','filetypes_allowed','[]'],['ai','filetypes_blocked','[]'],
        ['ai','read_only','false'],
        ['session','max_active','5'],['session','max_turns','200'],
        ['session','models_allowed','[]'],['session','delegation_enabled','false'],
        ['session','delegation_max_depth','1'],['session','default_model',''],
        ['session','default_template',''],
        ['prompt','system_prompt_append',''],['prompt','default_context',''],
        ['prompt','communication_style','intermediate'],
      ]);
    }

    const existingAdmin = await dbGet("SELECT id FROM user_groups WHERE name = 'Admin'");
    if (!existingAdmin) {
      const adminId = randomUUID();
      await dbRun(
        "INSERT OR IGNORE INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, ?)",
        [adminId, 'Admin', 'Platform administrator. Manages users, settings, and content. No infrastructure or security access.', '#f97316', 'shield', 1]
      );
      await applyPerms(adminId, [
        ['platform','sessions_create','true'],['platform','sessions_view_others','true'],
        ['platform','sessions_collaborate','true'],['platform','templates_view','true'],
        ['platform','templates_manage','true'],['platform','memories_view','true'],
        ['platform','memories_manage','true'],['platform','files_browse','true'],
        ['platform','files_upload','true'],['platform','terminal_access','false'],
        ['platform','observe_only','false'],
        ['platform','visible_tabs',JSON.stringify(["chat","agents","plan","jobs","memory","files"])],
        ['platform','visible_settings',JSON.stringify([
          "general","notifications","bot_identity","templates","user_management","user_groups",
          "rate_limits","budgets","system","services","updates","activity_log"
        ])],
        ['ai','commands_allowed','[]'],['ai','commands_blocked','[]'],
        ['ai','shell_access','true'],['ai','full_trust_allowed','false'],
        ['ai','directories_allowed','[]'],['ai','directories_blocked','[]'],
        ['ai','filetypes_allowed','[]'],['ai','filetypes_blocked','[]'],
        ['ai','read_only','false'],
        ['session','max_active','0'],['session','max_turns','0'],
        ['session','models_allowed','[]'],['session','delegation_enabled','true'],
        ['session','delegation_max_depth','5'],['session','default_model',''],
        ['session','default_template',''],
        ['prompt','system_prompt_append',''],['prompt','default_context',''],
        ['prompt','communication_style','expert'],
      ]);
    }

    const existingManager = await dbGet("SELECT id FROM user_groups WHERE name = 'Manager'");
    if (!existingManager) {
      const managerId = randomUUID();
      await dbRun(
        "INSERT OR IGNORE INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, ?)",
        [managerId, 'Manager', 'Team manager with elevated collaboration access. Can oversee users and view activity.', '#8b5cf6', 'briefcase', 1]
      );
      await applyPerms(managerId, [
        ['platform','sessions_create','true'],['platform','sessions_view_others','true'],
        ['platform','sessions_collaborate','true'],['platform','templates_view','true'],
        ['platform','templates_manage','true'],['platform','memories_view','true'],
        ['platform','memories_manage','false'],['platform','files_browse','true'],
        ['platform','files_upload','true'],['platform','terminal_access','false'],
        ['platform','observe_only','false'],
        ['platform','visible_tabs',JSON.stringify(["chat","agents","plan","memory","files"])],
        ['platform','visible_settings',JSON.stringify([
          "general","notifications","bot_identity","templates","user_management",
          "rate_limits","budgets","activity_log"
        ])],
        ['ai','commands_allowed','[]'],['ai','commands_blocked','[]'],
        ['ai','shell_access','true'],['ai','full_trust_allowed','false'],
        ['ai','directories_allowed','[]'],['ai','directories_blocked','[]'],
        ['ai','filetypes_allowed','[]'],['ai','filetypes_blocked','[]'],
        ['ai','read_only','false'],
        ['session','max_active','10'],['session','max_turns','0'],
        ['session','models_allowed','[]'],['session','delegation_enabled','true'],
        ['session','delegation_max_depth','3'],['session','default_model',''],
        ['session','default_template',''],
        ['prompt','system_prompt_append',''],['prompt','default_context',''],
        ['prompt','communication_style','intermediate'],
      ]);
    }

    const existingGuest = await dbGet("SELECT id FROM user_groups WHERE name = 'Guest'");
    if (!existingGuest) {
      const guestId = randomUUID();
      await dbRun(
        "INSERT OR IGNORE INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, ?)",
        [guestId, 'Guest', 'Read-only observer. Can view sessions shared with them but cannot create sessions or interact with AI.', '#94a3b8', 'eye', 1]
      );
      await applyPerms(guestId, [
        ['platform','sessions_create','false'],['platform','sessions_view_others','false'],
        ['platform','sessions_collaborate','false'],['platform','templates_view','false'],
        ['platform','templates_manage','false'],['platform','memories_view','false'],
        ['platform','memories_manage','false'],['platform','files_browse','false'],
        ['platform','files_upload','false'],['platform','terminal_access','false'],
        ['platform','observe_only','true'],
        ['platform','visible_tabs',JSON.stringify(["chat"])],
        ['platform','visible_settings',JSON.stringify(["general"])],
        ['ai','commands_allowed','[]'],['ai','commands_blocked','[]'],
        ['ai','shell_access','false'],['ai','full_trust_allowed','false'],
        ['ai','directories_allowed','[]'],['ai','directories_blocked','[]'],
        ['ai','filetypes_allowed','[]'],['ai','filetypes_blocked','[]'],
        ['ai','read_only','true'],
        ['session','max_active','0'],['session','max_turns','0'],
        ['session','models_allowed','[]'],['session','delegation_enabled','false'],
        ['session','delegation_max_depth','1'],['session','default_model',''],
        ['session','default_template',''],
        ['prompt','system_prompt_append',''],['prompt','default_context',''],
        ['prompt','communication_style','beginner'],
      ]);
    }

    console.log('[db] Migration 9: applied 5-group role hierarchy');
  },
  10: async () => {
    await addColumnSafe("users", "allowed_ips", "TEXT");
    await dbExec(`
      CREATE TABLE IF NOT EXISTS security_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        allowed_ips TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_security_groups (
        user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        security_group_id TEXT NOT NULL REFERENCES security_groups(id) ON DELETE CASCADE,
        assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
        assigned_by TEXT,
        PRIMARY KEY (user_email, security_group_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_security_groups_email ON user_security_groups(user_email);
      CREATE INDEX IF NOT EXISTS idx_user_security_groups_group ON user_security_groups(security_group_id)
    `);
    console.log('[db] Migration 10: added security_groups and user_security_groups tables');
  },
  11: async () => {
    await addColumnSafe("memories", "is_global", "INTEGER NOT NULL DEFAULT 1");
    await dbExec(`
      CREATE TABLE IF NOT EXISTS memory_agent_assignments (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (memory_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_maa_agent ON memory_agent_assignments(agent_id);
      CREATE INDEX IF NOT EXISTS idx_maa_memory ON memory_agent_assignments(memory_id)
    `);
    console.log('[db] Migration 11: agent-scoped memories (is_global + memory_agent_assignments)');
  },
  12: async () => {
    // Plan mode cost tracking
    await addColumnSafe("plan_steps", "input_tokens", "INTEGER NOT NULL DEFAULT 0");
    await addColumnSafe("plan_steps", "output_tokens", "INTEGER NOT NULL DEFAULT 0");
    await addColumnSafe("plan_steps", "cost_usd", "REAL NOT NULL DEFAULT 0");
    await addColumnSafe("plans", "total_input_tokens", "INTEGER NOT NULL DEFAULT 0");
    await addColumnSafe("plans", "total_output_tokens", "INTEGER NOT NULL DEFAULT 0");
    await addColumnSafe("plans", "total_cost_usd", "REAL NOT NULL DEFAULT 0");
    // Dependency support (Phase 2 column, added now to avoid a second migration)
    await addColumnSafe("plan_steps", "depends_on", "TEXT");
    console.log("[db] Migration 12: plan mode cost tracking + dependency columns");
  },
  13: async () => {
    // Performance indexes for commonly queried paths
    await dbExec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_ts ON messages(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);
      CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_ts ON activity_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_email, timestamp DESC);
    `);
    console.log("[db] Migration 13: add performance indexes");
  },
};

// ── initDb: run once at server startup ───────────────────────────────────────

export async function initDb(): Promise<void> {
  // Performance PRAGMAs
  await dbPragma("journal_mode = WAL");
  await dbPragma("busy_timeout = 5000");
  await dbPragma("foreign_keys = ON");

  // Incremental auto-vacuum
  const avRow = await dbGet<{ auto_vacuum: number }>("PRAGMA auto_vacuum");
  if (avRow?.auto_vacuum !== 2) {
    await dbPragma("auto_vacuum = INCREMENTAL");
    await dbExec("VACUUM");
    console.log("[db] Switched to incremental auto_vacuum (one-time VACUUM applied)");
  }

  // Base schema (always idempotent)
  await dbExec(`
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
    )
  `);

  // Safe column additions for existing databases
  for (const [table, col, def] of [
    ["user_settings", "experience_level", "TEXT NOT NULL DEFAULT 'expert'"],
    ["user_settings", "server_purposes", "TEXT NOT NULL DEFAULT '[]'"],
    ["user_settings", "project_type", "TEXT NOT NULL DEFAULT ''"],
    ["user_settings", "auto_summary", "INTEGER NOT NULL DEFAULT 1"],
    ["user_settings", "profile_wizard_complete", "INTEGER NOT NULL DEFAULT 0"],
    ["users", "first_name", "TEXT NOT NULL DEFAULT ''"],
    ["users", "last_name", "TEXT NOT NULL DEFAULT ''"],
    ["users", "avatar_url", "TEXT"],
    ["users", "must_change_password", "INTEGER NOT NULL DEFAULT 0"],
    ["agents", "use_count", "INTEGER NOT NULL DEFAULT 0"],
  ]) {
    try { await getClient().execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  }

  // Phase-2 tables
  await dbExec(`
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
    )
  `);

  // Seed bot name from env
  const envBotName = process.env.CLAUDE_BOT_NAME;
  if (envBotName) {
    await dbRun(
      "UPDATE bot_settings SET name = ? WHERE id = 1 AND name = 'Octoby AI'",
      [envBotName]
    );
  }

  // Seed default app_settings
  const defaultAppSettings: Record<string, string> = {
    rate_limit_commands: "100",
    rate_limit_runtime_min: "30",
    rate_limit_concurrent: "0",
    personality: "professional",
    personality_custom: "",
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
    setup_complete: "false",
    file_lock_enabled: "true",
    file_lock_timeout_minutes: "5",
    file_lock_queue_max_size: "50",
    file_lock_cleanup_interval_seconds: "60",
  };
  for (const [k, v] of Object.entries(defaultAppSettings)) {
    await dbRun("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)", [k, v]);
  }

  // Phase-3 tables
  await dbExec(`
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
    )
  `);

  await dbExec(`
    CREATE INDEX IF NOT EXISTS idx_inapp_notifications_user
      ON inapp_notifications (user_email, id DESC)
  `);

  // Phase-4 security tables
  await dbExec(`
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
    )
  `);

  // Session sharing
  await dbExec(`
    CREATE TABLE IF NOT EXISTS session_participants (
      session_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'collaborator',
      invited_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, user_email),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  // Uploads table
  await dbExec(`
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
    CREATE INDEX IF NOT EXISTS idx_uploads_session ON uploads(session_id)
  `);

  // Secret metadata
  await dbExec(`
    CREATE TABLE IF NOT EXISTS secret_metadata (
      key         TEXT PRIMARY KEY,
      type        TEXT NOT NULL DEFAULT 'secret'
                    CHECK(type IN ('secret', 'api_key', 'variable')),
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Numbered migrations
  const currentVersion = await getSchemaVersion();
  const LATEST_SCHEMA_VERSION = Math.max(...Object.keys(migrations).map(Number));
  for (let v = currentVersion + 1; v <= LATEST_SCHEMA_VERSION; v++) {
    if (migrations[v]) {
      await migrations[v]();
      await setSchemaVersion(v);
      console.log(`[db] Applied migration ${v}`);
    }
  }

  // Reset stale statuses on startup
  await dbRun("UPDATE sessions SET status = 'idle' WHERE status IN ('running', 'needs_attention')");

  // Seed/sync admin user from env
  const adminEmail = process.env.CLAUDE_BOT_ADMIN_EMAIL;
  const adminHash = process.env.CLAUDE_BOT_ADMIN_HASH;
  if (adminEmail && adminHash) {
    const existing = await dbGet<{ hash: string }>(
      "SELECT hash FROM users WHERE email = ?",
      [adminEmail]
    );
    if (!existing) {
      await dbRun("INSERT INTO users (email, hash, is_admin) VALUES (?, ?, 1)", [adminEmail, adminHash]);
      console.log(`[db] Seeded admin user: ${adminEmail}`);
    } else if (existing.hash !== adminHash) {
      await dbRun("UPDATE users SET hash = ? WHERE email = ?", [adminHash, adminEmail]);
      console.log(`[db] Synced admin password from env: ${adminEmail}`);
    }
  }

  // FTS5 setup
  try {
    await dbExec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=rowid
      )
    `);

    await dbExec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);
    await dbExec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END
    `);
    await dbExec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    const FTS_REBUILD_THRESHOLD = 50_000;
    const ftsRow = await dbGet<{ count: number }>("SELECT COUNT(*) as count FROM messages_fts");
    const msgRow = await dbGet<{ count: number }>("SELECT COUNT(*) as count FROM messages");
    const ftsCount = ftsRow?.count ?? 0;
    const msgCount = msgRow?.count ?? 0;
    if (ftsCount === 0 && msgCount > 0) {
      if (msgCount > FTS_REBUILD_THRESHOLD) {
        console.warn(
          `[db] Skipping FTS rebuild: ${msgCount} messages exceeds threshold (${FTS_REBUILD_THRESHOLD}). ` +
          "Run manually via SQLite: INSERT INTO messages_fts(messages_fts) VALUES('rebuild')"
        );
      } else {
        await dbExec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
        console.log("[db] Rebuilt FTS index for", msgCount, "messages");
      }
    }
  } catch (err) {
    console.error("[db] FTS5 setup failed (may not be available):", err);
  }

  console.log("[db] Database initialized");
}

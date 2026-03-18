/**
 * transformer-db.ts
 *
 * Read-only database helper that transformer modules (api/hook types) can
 * require() to query app data without direct DB file access.
 *
 * All queries are strictly SELECT — write operations are rejected.
 *
 * Usage in a transformer (handler.js or hooks.js):
 *   const { getSessionStats, queryReadonly } = require('/path/to/transformer-db');
 */

import { dbGet, dbAll } from "./db";

/** Reject any SQL that contains write operations */
function assertReadonly(sql: string): void {
  const normalized = sql.trim().toUpperCase();
  const writeKeywords = ["INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "REPLACE", "TRUNCATE", "ATTACH", "DETACH"];
  for (const kw of writeKeywords) {
    if (normalized.startsWith(kw) || normalized.includes(" " + kw + " ")) {
      throw new Error(`Write operation not allowed in transformer queries: ${kw}`);
    }
  }
  if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH") && !normalized.startsWith("EXPLAIN") && !normalized.startsWith("PRAGMA")) {
    throw new Error("Only SELECT queries are allowed in transformer queries");
  }
}

export interface SessionStats {
  total_sessions: number;
  active_sessions: number;
  total_messages: number;
  total_users: number;
  recent_sessions: Array<{
    id: string;
    name: string | null;
    created_by: string;
    created_at: string;
    status: string;
    message_count: number;
  }>;
}

export async function getSessionStats(): Promise<SessionStats> {
  const [totals, active, msgCount, userCount, recent] = await Promise.all([
    dbGet<{ count: number }>("SELECT COUNT(*) as count FROM sessions"),
    dbGet<{ count: number }>("SELECT COUNT(*) as count FROM sessions WHERE status = 'running'"),
    dbGet<{ count: number }>("SELECT COUNT(*) as count FROM messages"),
    dbGet<{ count: number }>("SELECT COUNT(*) as count FROM users"),
    dbAll<{ id: string; name: string | null; created_by: string; created_at: string; status: string; message_count: number }>(
      `SELECT s.id, s.name, s.created_by, s.created_at, s.status,
       COUNT(m.id) as message_count
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id
       GROUP BY s.id
       ORDER BY s.updated_at DESC
       LIMIT 20`
    ),
  ]);

  return {
    total_sessions: totals?.count ?? 0,
    active_sessions: active?.count ?? 0,
    total_messages: msgCount?.count ?? 0,
    total_users: userCount?.count ?? 0,
    recent_sessions: recent,
  };
}

export interface MessageRecord {
  id: string;
  session_id: string;
  sender_type: string;
  content: string;
  timestamp: string;
  message_type: string;
}

export async function getMessagesBySession(sessionId: string): Promise<MessageRecord[]> {
  return dbAll<MessageRecord>(
    "SELECT id, session_id, sender_type, content, timestamp, message_type FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
    [sessionId]
  );
}

export interface UserRecord {
  email: string;
  first_name: string;
  last_name: string;
  is_admin: number;
  created_at: string;
}

export async function getUserList(): Promise<UserRecord[]> {
  return dbAll<UserRecord>(
    "SELECT email, first_name, last_name, is_admin, created_at FROM users ORDER BY created_at DESC"
  );
}

export async function queryReadonly<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  assertReadonly(sql);
  return dbAll<T>(sql, params as import("@libsql/client").InValue[]);
}

export async function queryReadonlyOne<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T | undefined> {
  assertReadonly(sql);
  return dbGet<T>(sql, params as import("@libsql/client").InValue[]);
}

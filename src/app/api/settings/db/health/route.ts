import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbAll } from "@/lib/db";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const DB_PATH = path.join(DATA_DIR, "claude-bot.db");

async function safeCount(table: string): Promise<number> {
  try {
    const row = await dbGet<{ c: number }>(`SELECT COUNT(*) as c FROM ${table}`);
    return row?.c ?? -1;
  } catch {
    return -1;
  }
}

function fileSize(fp: string): number {
  try { return fs.statSync(fp).size; } catch { return 0; }
}

function latestBackup(pool: string): { name: string; created: string; size: number } | null {
  const dir = path.join(DATA_DIR, "backups", pool);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith("claude-bot-") && f.endsWith(".db"))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, created: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
  return files[0] ?? null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dbSize = fileSize(DB_PATH);
  const walSize = fileSize(DB_PATH + "-wal");

  const [sessionsCount, messagesCount, activityCount, loginCount, usersCount, agentsCount] = await Promise.all([
    safeCount("sessions"),
    safeCount("messages"),
    safeCount("activity_log"),
    safeCount("login_attempts"),
    safeCount("users"),
    safeCount("agents"),
  ]);

  const rowCounts: Record<string, number> = {
    sessions: sessionsCount,
    messages: messagesCount,
    activity_log: activityCount,
    login_attempts: loginCount,
    users: usersCount,
    agents: agentsCount,
  };

  let schemaVersion = 0;
  try {
    const row = await dbGet<{ value: string }>("SELECT value FROM app_settings WHERE key = 'schema_version'");
    schemaVersion = row ? parseInt(row.value, 10) : 0;
  } catch { /* ignore */ }

  let lastVacuumAt: string | null = null;
  try {
    const row = await dbGet<{ value: string }>("SELECT value FROM app_settings WHERE key = 'last_vacuum_at'");
    lastVacuumAt = row?.value ?? null;
  } catch { /* ignore */ }

  let messageRetentionDays = 0;
  try {
    const row = await dbGet<{ value: string }>("SELECT value FROM app_settings WHERE key = 'message_retention_days'");
    messageRetentionDays = row ? parseInt(row.value, 10) : 0;
  } catch { /* ignore */ }

  const lastManualBackup = latestBackup("manual");
  const lastUpgradeBackup = latestBackup("upgrade");

  let autoVacuumMode = "unknown";
  try {
    const rows = await dbAll<{ auto_vacuum: number }>("PRAGMA auto_vacuum");
    const row = rows[0];
    if (row) {
      autoVacuumMode = row.auto_vacuum === 2 ? "incremental" : row.auto_vacuum === 1 ? "full" : "none";
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    dbSize,
    walSize,
    rowCounts,
    schemaVersion,
    lastVacuumAt,
    messageRetentionDays,
    autoVacuumMode,
    lastManualBackup,
    lastUpgradeBackup,
  });
}

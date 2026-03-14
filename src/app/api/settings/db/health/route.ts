import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import path from "path";
import fs from "fs";
import type Database from "better-sqlite3";

export const dynamic = "force-dynamic";

let dbInstance: Database.Database | null = null;

async function getDb(): Promise<Database.Database> {
  if (!dbInstance) {
    const mod = (await import("@/lib/db")) as { default: Database.Database };
    dbInstance = mod.default;
  }
  return dbInstance;
}

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const DB_PATH = path.join(DATA_DIR, "claude-bot.db");

function safeCount(db: Database.Database, table: string): number {
  try {
    return (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
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

  const db = await getDb();
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dbSize = fileSize(DB_PATH);
  const walSize = fileSize(DB_PATH + "-wal");

  const rowCounts: Record<string, number> = {
    sessions: safeCount(db, "sessions"),
    messages: safeCount(db, "messages"),
    activity_log: safeCount(db, "activity_log"),
    login_attempts: safeCount(db, "login_attempts"),
    users: safeCount(db, "users"),
    agents: safeCount(db, "agents"),
  };

  let schemaVersion = 0;
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get() as { value: string } | undefined;
    schemaVersion = row ? parseInt(row.value, 10) : 0;
  } catch { /* ignore */ }

  let lastVacuumAt: string | null = null;
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'last_vacuum_at'").get() as { value: string } | undefined;
    lastVacuumAt = row?.value ?? null;
  } catch { /* ignore */ }

  let messageRetentionDays = 0;
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'message_retention_days'").get() as { value: string } | undefined;
    messageRetentionDays = row ? parseInt(row.value, 10) : 0;
  } catch { /* ignore */ }

  const lastManualBackup = latestBackup("manual");
  const lastUpgradeBackup = latestBackup("upgrade");

  let autoVacuumMode = "unknown";
  try {
    const row = (db.pragma("auto_vacuum") as { auto_vacuum: number }[])[0];
    autoVacuumMode = row.auto_vacuum === 2 ? "incremental" : row.auto_vacuum === 1 ? "full" : "none";
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

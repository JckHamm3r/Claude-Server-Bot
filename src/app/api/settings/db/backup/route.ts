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
const MANUAL_BACKUP_DIR = path.join(DATA_DIR, "backups", "manual");
const MAX_MANUAL_BACKUPS = 3;

function rotateBackups(dir: string, max: number) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith("claude-bot-") && f.endsWith(".db"))
    .sort()
    .reverse();
  for (let i = max; i < files.length; i++) {
    const fp = path.join(dir, files[i]);
    fs.unlinkSync(fp);
    // Also remove WAL sidecar if present
    const wal = fp + "-wal";
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
  }
}

export async function POST() {
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

  try {
    fs.mkdirSync(MANUAL_BACKUP_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const backupName = `claude-bot-${timestamp}.db`;
    const backupPath = path.join(MANUAL_BACKUP_DIR, backupName);

    await db.backup(backupPath);

    rotateBackups(MANUAL_BACKUP_DIR, MAX_MANUAL_BACKUPS);

    const stat = fs.statSync(backupPath);
    return NextResponse.json({
      ok: true,
      backup: {
        name: backupName,
        pool: "manual",
        size: stat.size,
        created: stat.mtime.toISOString(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[db-backup] Backup failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

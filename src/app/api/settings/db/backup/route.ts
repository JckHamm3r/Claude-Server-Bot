import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbPragma } from "@/lib/db";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const DB_PATH = path.join(DATA_DIR, "claude-bot.db");
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

  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    fs.mkdirSync(MANUAL_BACKUP_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const backupName = `claude-bot-${timestamp}.db`;
    const backupPath = path.join(MANUAL_BACKUP_DIR, backupName);

    // Checkpoint WAL to ensure all data is flushed to main DB file before copy
    await dbPragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(DB_PATH, backupPath);

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

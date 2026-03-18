import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbRun } from "@/lib/db";
import { readFileSync, existsSync } from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // WAL checkpoint to ensure all data is flushed to the main DB file
    await dbRun("PRAGMA wal_checkpoint(PASSIVE)");

    const dbPath = path.join(DATA_DIR, "claude-bot.db");
    if (!existsSync(dbPath)) {
      return NextResponse.json({ error: "Database file not found" }, { status: 500 });
    }

    // Build a simple tar-like archive manually (POSIX ustar format would need a library).
    // For simplicity: return just the SQLite database file as a downloadable .db file.
    // A full tar.gz would require a streaming tar library not currently in the project.
    // Returning the raw .db is the most universally useful backup format.
    const dbBuffer = readFileSync(dbPath);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `claude-bot-backup-${timestamp}.db`;

    return new NextResponse(dbBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(dbBuffer.length),
      },
    });
  } catch (err) {
    console.error("[backup] Export error:", err);
    return NextResponse.json({ error: "Failed to export backup" }, { status: 500 });
  }
}

// Keep the variable to satisfy the import (used for PROJECT_ROOT reference in description)
const _projectRoot = PROJECT_ROOT;
void _projectRoot;

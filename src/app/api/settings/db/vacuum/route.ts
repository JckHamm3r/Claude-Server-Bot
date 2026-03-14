import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";
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
    let sizeBefore = 0;
    try { sizeBefore = fs.statSync(DB_PATH).size; } catch { /* ignore */ }

    db.exec("VACUUM");

    let sizeAfter = 0;
    try { sizeAfter = fs.statSync(DB_PATH).size; } catch { /* ignore */ }

    const freedBytes = Math.max(0, sizeBefore - sizeAfter);

    // Store last vacuum timestamp
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('last_vacuum_at', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')"
    ).run();

    return NextResponse.json({
      ok: true,
      sizeBefore,
      sizeAfter,
      freedBytes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[db-vacuum] VACUUM failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

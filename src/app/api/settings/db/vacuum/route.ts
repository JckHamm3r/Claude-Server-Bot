import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbExec, dbRun } from "@/lib/db";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const DB_PATH = path.join(DATA_DIR, "claude-bot.db");

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
    let sizeBefore = 0;
    try { sizeBefore = fs.statSync(DB_PATH).size; } catch { /* ignore */ }

    await dbExec("VACUUM");

    let sizeAfter = 0;
    try { sizeAfter = fs.statSync(DB_PATH).size; } catch { /* ignore */ }

    const freedBytes = Math.max(0, sizeBefore - sizeAfter);

    // Store last vacuum timestamp
    await dbRun(
      "INSERT INTO app_settings (key, value) VALUES ('last_vacuum_at', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')"
    );

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

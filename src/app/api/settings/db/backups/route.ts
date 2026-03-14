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

interface BackupEntry {
  name: string;
  pool: "manual" | "upgrade";
  size: number;
  created: string;
}

function listPool(pool: "manual" | "upgrade"): BackupEntry[] {
  const dir = path.join(DATA_DIR, "backups", pool);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith("claude-bot-") && f.endsWith(".db"))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, pool, size: stat.size, created: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
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

  const manual = listPool("manual");
  const upgrade = listPool("upgrade");

  return NextResponse.json({ manual, upgrade });
}

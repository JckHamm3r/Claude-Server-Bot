import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";

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

  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const manual = listPool("manual");
  const upgrade = listPool("upgrade");

  return NextResponse.json({ manual, upgrade });
}

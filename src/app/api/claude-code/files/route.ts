import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "venv", "__pycache__",
  "dist", ".next", ".turbo", "coverage",
]);

const EXCLUDE_FILE_PATTERNS = [/\.lock$/, /\.log$/, /\.pyc$/];

function walkSync(dir: string, base: string, results: string[], limit: number): void {
  if (results.length >= limit) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= limit) return;
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walkSync(path.join(dir, entry.name), base, results, limit);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILE_PATTERNS.some((p) => p.test(entry.name))) continue;
      const rel = path.relative(base, path.join(dir, entry.name));
      results.push(rel);
    }
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").toLowerCase();

  const all: string[] = [];
  walkSync(PROJECT_ROOT, PROJECT_ROOT, all, 2000);

  const filtered = q
    ? all.filter((f) => f.toLowerCase().includes(q)).slice(0, 20)
    : all.slice(0, 20);

  return NextResponse.json({ files: filtered });
}

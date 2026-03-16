import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

export interface TreeEntry {
  name: string;
  path: string;  // relative to PROJECT_ROOT
  type: "file" | "dir";
  size?: number;
  modified?: number;
  ext?: string;
}

/** Resolve and jail a relative path inside PROJECT_ROOT. Returns null if it escapes. */
function jailResolve(relPath: string): string | null {
  const root = path.resolve(PROJECT_ROOT);
  const resolved = path.resolve(root, relPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".next", "venv", "__pycache__",
  "dist", ".turbo", "coverage", ".cache", ".yarn",
]);

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin only for the file browser
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const relDir = req.nextUrl.searchParams.get("dir") ?? "";

  // Jail check
  const absDir = relDir ? jailResolve(relDir) : path.resolve(PROJECT_ROOT);
  if (!absDir) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    return NextResponse.json({ error: "Directory not found" }, { status: 404 });
  }

  try {
    const rawEntries = fs.readdirSync(absDir, { withFileTypes: true });
    const entries: TreeEntry[] = [];

    for (const dirent of rawEntries) {
      // Skip hidden files and excluded dirs
      if (dirent.name.startsWith(".") && dirent.name !== ".claude") continue;
      if (dirent.isDirectory() && EXCLUDE_DIRS.has(dirent.name)) continue;

      const absEntryPath = path.join(absDir, dirent.name);
      const relEntryPath = path.relative(PROJECT_ROOT, absEntryPath);

      if (dirent.isDirectory()) {
        entries.push({ name: dirent.name, path: relEntryPath, type: "dir" });
      } else if (dirent.isFile()) {
        try {
          const stat = fs.statSync(absEntryPath);
          const ext = path.extname(dirent.name).slice(1).toLowerCase();
          entries.push({
            name: dirent.name,
            path: relEntryPath,
            type: "file",
            size: stat.size,
            modified: stat.mtimeMs,
            ext,
          });
        } catch {
          entries.push({ name: dirent.name, path: relEntryPath, type: "file" });
        }
      }
    }

    // Sort: directories first, then files, both alphabetically (case-insensitive)
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return NextResponse.json({ entries, dir: relDir });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

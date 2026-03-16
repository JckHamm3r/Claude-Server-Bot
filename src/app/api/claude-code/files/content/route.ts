import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

// Max file size to read/write: 4 MB
const MAX_FILE_SIZE = 4 * 1024 * 1024;

// File extensions treated as binary (not readable as text)
const BINARY_EXTS = new Set([
  "png","jpg","jpeg","gif","webp","bmp","ico","svg",
  "pdf","zip","tar","gz","bz2","7z","rar",
  "exe","dll","so","dylib","bin","dat",
  "mp3","mp4","wav","avi","mkv","mov",
  "woff","woff2","ttf","otf","eot",
  "db","sqlite","sqlite3",
]);

function jailResolve(relPath: string): string | null {
  const root = path.resolve(PROJECT_ROOT);
  const resolved = path.resolve(root, relPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeMap: Record<string, string> = {
    md: "text/markdown", markdown: "text/markdown",
    ts: "text/typescript", tsx: "text/typescript",
    js: "text/javascript", jsx: "text/javascript",
    json: "application/json", jsonc: "application/json",
    html: "text/html", htm: "text/html",
    css: "text/css", scss: "text/scss", sass: "text/sass",
    py: "text/x-python", rb: "text/x-ruby", rs: "text/x-rust",
    go: "text/x-go", java: "text/x-java", c: "text/x-c", cpp: "text/x-c++",
    sh: "text/x-shellscript", bash: "text/x-shellscript", zsh: "text/x-shellscript",
    yaml: "text/yaml", yml: "text/yaml",
    toml: "application/toml", ini: "text/plain", env: "text/plain",
    txt: "text/plain", log: "text/plain", csv: "text/csv",
    xml: "text/xml", svg: "image/svg+xml",
  };
  return mimeMap[ext] ?? "text/plain";
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const relPath = req.nextUrl.searchParams.get("path");
  if (!relPath) return NextResponse.json({ error: "path is required" }, { status: 400 });

  const absPath = jailResolve(relPath);
  if (!absPath) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  if (!fs.existsSync(absPath)) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 400 });

  const ext = path.extname(absPath).slice(1).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    return NextResponse.json({ error: "Binary files cannot be displayed as text" }, { status: 415 });
  }

  if (stat.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB, max 4 MB)` }, { status: 413 });
  }

  try {
    const content = fs.readFileSync(absPath, "utf-8");
    const mimeType = getMimeType(absPath);
    return NextResponse.json({ content, mimeType, size: stat.size, modified: stat.mtimeMs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { path?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { path: relPath, content } = body;
  if (!relPath) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (typeof content !== "string") return NextResponse.json({ error: "content must be a string" }, { status: 400 });

  const absPath = jailResolve(relPath);
  if (!absPath) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  if (content.length > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Content too large (max 4 MB)" }, { status: 413 });
  }

  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
    const stat = fs.statSync(absPath);
    return NextResponse.json({ ok: true, size: stat.size, modified: stat.mtimeMs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

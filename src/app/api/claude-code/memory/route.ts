import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import fs from "fs/promises";
import path from "path";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
const MEMORY_DIR = path.join(PROJECT_ROOT, ".claude/memory");
const CLAUDE_MD_PATH = path.join(PROJECT_ROOT, "CLAUDE.md");

async function getAvailableFiles(): Promise<string[]> {
  const files = new Set<string>(["CLAUDE.md"]);

  try {
    const entries = await fs.readdir(MEMORY_DIR);
    for (const entry of entries) {
      if (entry.endsWith(".md")) {
        files.add(`memory/${entry}`);
      }
    }
  } catch {
    // memory dir might not exist yet — that's fine
  }

  return Array.from(files);
}

function resolvePath(file: string): string | null {
  if (file === "CLAUDE.md") {
    return CLAUDE_MD_PATH;
  }
  if (file.startsWith("memory/") && file.endsWith(".md")) {
    const basename = path.basename(file);
    // Prevent path traversal
    if (basename === path.basename(basename) && !basename.includes("..")) {
      return path.join(MEMORY_DIR, basename);
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  if (!file) {
    const files = await getAvailableFiles();
    return NextResponse.json({ files });
  }

  const filePath = resolvePath(file);
  if (!filePath) {
    return NextResponse.json({ error: "Unknown file" }, { status: 400 });
  }

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return NextResponse.json({ content });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ content: "" });
    }
    console.error("memory GET error:", err);
    return NextResponse.json({ error: "Read error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!requester?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { file: string; content: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { file, content } = body;
  if (!file || typeof content !== "string") {
    return NextResponse.json({ error: "Missing file or content" }, { status: 400 });
  }

  const filePath = resolvePath(file);
  if (!filePath) {
    return NextResponse.json({ error: "Unknown file" }, { status: 400 });
  }

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("memory PUT error:", err);
    return NextResponse.json({ error: "Write error" }, { status: 500 });
  }
}

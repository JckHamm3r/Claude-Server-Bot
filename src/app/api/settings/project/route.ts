import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import fs from "fs";
import path from "path";

const ENV_FILE = path.join(process.cwd(), ".env");

function updateEnvFile(key: string, value: string): void {
  let content = "";
  try {
    content = fs.readFileSync(ENV_FILE, "utf-8");
  } catch {
    // file doesn't exist yet
  }

  const lines = content.split("\n");
  const existingIdx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const sanitizedValue = value.replace(/[\r\n\x00-\x1F\x7F]/g, '');
  const newLine = `${key}=${sanitizedValue}`;

  if (existingIdx >= 0) {
    lines[existingIdx] = newLine;
  } else {
    lines.push(newLine);
  }

  fs.writeFileSync(ENV_FILE, lines.join("\n"), "utf-8");
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
  if (!requester?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { projectRoot: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { projectRoot } = body;
  if (!projectRoot || typeof projectRoot !== "string") {
    return NextResponse.json({ error: "Missing projectRoot" }, { status: 400 });
  }

  // Validate path exists
  if (!fs.existsSync(projectRoot)) {
    return NextResponse.json({ error: "Path does not exist" }, { status: 400 });
  }

  const hasClaudeMd = fs.existsSync(path.join(projectRoot, "CLAUDE.md"));
  const hasClaudeDir = fs.existsSync(path.join(projectRoot, ".claude"));

  // Update .env and set in-memory so current process picks it up immediately
  try {
    updateEnvFile("CLAUDE_PROJECT_ROOT", projectRoot);
  } catch (err) {
    console.error("[settings/project] updateEnvFile failed:", err);
    return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
  }
  process.env.CLAUDE_PROJECT_ROOT = projectRoot;

  return NextResponse.json({ ok: true, hasClaudeMd, hasClaudeDir });
}

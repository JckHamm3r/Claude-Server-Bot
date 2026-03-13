import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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
  const newLine = `${key}=${value}`;

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
  updateEnvFile("CLAUDE_PROJECT_ROOT", projectRoot);
  process.env.CLAUDE_PROJECT_ROOT = projectRoot;

  return NextResponse.json({ ok: true, hasClaudeMd, hasClaudeDir });
}

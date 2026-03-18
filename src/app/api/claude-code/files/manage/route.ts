import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

function jailResolve(relPath: string): string | null {
  const root = path.resolve(PROJECT_ROOT);
  const resolved = path.resolve(root, relPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

async function requireAdmin(_req: NextRequest): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body;

  // ── create-file ──────────────────────────────────────────────────────────
  if (action === "create-file") {
    const relPath = body.path as string | undefined;
    if (!relPath) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const absPath = jailResolve(relPath);
    if (!absPath) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

    if (fs.existsSync(absPath)) {
      return NextResponse.json({ error: "File already exists" }, { status: 409 });
    }

    try {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      const content = typeof body.content === "string" ? body.content : "";
      fs.writeFileSync(absPath, content, "utf-8");
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── create-folder ─────────────────────────────────────────────────────────
  if (action === "create-folder") {
    const relPath = body.path as string | undefined;
    if (!relPath) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const absPath = jailResolve(relPath);
    if (!absPath) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

    if (fs.existsSync(absPath)) {
      return NextResponse.json({ error: "Folder already exists" }, { status: 409 });
    }

    try {
      fs.mkdirSync(absPath, { recursive: true });
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── rename ────────────────────────────────────────────────────────────────
  if (action === "rename") {
    const oldRelPath = body.oldPath as string | undefined;
    const newRelPath = body.newPath as string | undefined;
    if (!oldRelPath || !newRelPath) {
      return NextResponse.json({ error: "oldPath and newPath are required" }, { status: 400 });
    }

    const absOld = jailResolve(oldRelPath);
    const absNew = jailResolve(newRelPath);
    if (!absOld || !absNew) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

    if (!fs.existsSync(absOld)) {
      return NextResponse.json({ error: "Source path does not exist" }, { status: 404 });
    }
    if (fs.existsSync(absNew)) {
      return NextResponse.json({ error: "Destination already exists" }, { status: 409 });
    }

    try {
      fs.mkdirSync(path.dirname(absNew), { recursive: true });
      fs.renameSync(absOld, absNew);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (action === "delete") {
    const relPath = body.path as string | undefined;
    if (!relPath) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const absPath = jailResolve(relPath);
    if (!absPath) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

    // Protect the project root itself
    if (absPath === path.resolve(PROJECT_ROOT)) {
      return NextResponse.json({ error: "Cannot delete project root" }, { status: 400 });
    }

    if (!fs.existsSync(absPath)) {
      return NextResponse.json({ error: "Path does not exist" }, { status: 404 });
    }

    try {
      fs.rmSync(absPath, { recursive: true, force: true });
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${String(action)}` }, { status: 400 });
}

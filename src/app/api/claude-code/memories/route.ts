import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

interface MemoryRow {
  id: string;
  title: string;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function requireAdmin(email: string): boolean {
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(email) as { is_admin: number } | undefined;
  return Boolean(user?.is_admin);
}

// GET /api/claude-code/memories — list all memories (any authenticated user)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memories = db
    .prepare("SELECT id, title, content, created_by, created_at, updated_at FROM memories ORDER BY updated_at DESC")
    .all() as MemoryRow[];

  return NextResponse.json({ memories });
}

// POST /api/claude-code/memories — create a memory (admin only)
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { title: string; content: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, content } = body;
  if (!title?.trim() || typeof content !== "string") {
    return NextResponse.json({ error: "Missing title or content" }, { status: 400 });
  }

  const result = db
    .prepare(
      "INSERT INTO memories (title, content, created_by) VALUES (?, ?, ?) RETURNING id, title, content, created_by, created_at, updated_at"
    )
    .get(title.trim(), content, session.user.email) as MemoryRow;

  return NextResponse.json({ memory: result }, { status: 201 });
}

// PUT /api/claude-code/memories — update a memory (admin only)
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { id: string; title?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, title, content } = body;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const existing = db.prepare("SELECT id FROM memories WHERE id = ?").get(id) as { id: string } | undefined;
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (title !== undefined && content !== undefined) {
    db.prepare(
      "UPDATE memories SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(title.trim(), content, id);
  } else if (title !== undefined) {
    db.prepare("UPDATE memories SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title.trim(), id);
  } else if (content !== undefined) {
    db.prepare("UPDATE memories SET content = ?, updated_at = datetime('now') WHERE id = ?").run(content, id);
  }

  const updated = db
    .prepare("SELECT id, title, content, created_by, created_at, updated_at FROM memories WHERE id = ?")
    .get(id) as MemoryRow;

  return NextResponse.json({ memory: updated });
}

// DELETE /api/claude-code/memories — delete a memory (admin only)
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const result = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

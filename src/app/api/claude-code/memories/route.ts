import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getMemories,
  setMemoryAssignments,
  getMemoryAssignments,
} from "@/lib/claude-db";
import { dbGet, dbRun } from "@/lib/db";

async function requireAdmin(email: string): Promise<boolean> {
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [email]);
  return Boolean(user?.is_admin);
}

// GET /api/claude-code/memories — list all memories with assignment info (any authenticated user)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memories = await getMemories();
  return NextResponse.json({ memories });
}

// POST /api/claude-code/memories — create a memory (admin only)
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!await requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { title: string; content: string; is_global?: boolean; agent_ids?: string[]; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, content, is_global = true, agent_ids = [], tags } = body;
  if (!title?.trim() || typeof content !== "string") {
    return NextResponse.json({ error: "Missing title or content" }, { status: 400 });
  }

  const row = await dbGet<{
    id: string; title: string; content: string; is_global: number; tags: string | null;
    source_session_id: string | null; created_by: string; created_at: string; updated_at: string;
  }>(
    "INSERT INTO memories (title, content, created_by, is_global, tags) VALUES (?, ?, ?, ?, ?) RETURNING id, title, content, is_global, tags, source_session_id, created_by, created_at, updated_at",
    [title.trim(), content, session.user.email, is_global ? 1 : 0, JSON.stringify(tags ?? [])]
  );

  if (!row) {
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  await setMemoryAssignments(row.id, is_global, agent_ids);

  const assigned_agent_ids = await getMemoryAssignments(row.id);
  const memory = { ...row, is_global: row.is_global === 1, tags: JSON.parse(row.tags ?? '[]'), assigned_agent_ids };

  return NextResponse.json({ memory }, { status: 201 });
}

// PUT /api/claude-code/memories — update a memory (admin only)
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!await requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { id: string; title?: string; content?: string; is_global?: boolean; agent_ids?: string[]; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, title, content, is_global, agent_ids, tags } = body;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const existing = await dbGet<{ id: string }>("SELECT id FROM memories WHERE id = ?", [id]);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (title !== undefined && content !== undefined) {
    await dbRun(
      "UPDATE memories SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?",
      [title.trim(), content, id]
    );
  } else if (title !== undefined) {
    await dbRun("UPDATE memories SET title = ?, updated_at = datetime('now') WHERE id = ?", [title.trim(), id]);
  } else if (content !== undefined) {
    await dbRun("UPDATE memories SET content = ?, updated_at = datetime('now') WHERE id = ?", [content, id]);
  }

  if (tags !== undefined) {
    await dbRun("UPDATE memories SET tags = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(tags), id]);
  }

  // Update assignment scope if provided
  if (is_global !== undefined || agent_ids !== undefined) {
    const currentRow = await dbGet<{ is_global: number }>("SELECT is_global FROM memories WHERE id = ?", [id]);
    const newIsGlobal = is_global !== undefined ? is_global : currentRow!.is_global === 1;
    const newAgentIds = agent_ids !== undefined ? agent_ids : await getMemoryAssignments(id);
    await setMemoryAssignments(id, newIsGlobal, newAgentIds);
  }

  const updated = await dbGet<{
    id: string; title: string; content: string; is_global: number; tags: string | null;
    source_session_id: string | null; created_by: string; created_at: string; updated_at: string;
  }>(
    "SELECT id, title, content, is_global, tags, source_session_id, created_by, created_at, updated_at FROM memories WHERE id = ?",
    [id]
  );

  const assigned_agent_ids = await getMemoryAssignments(id);
  const memory = { ...updated!, is_global: updated!.is_global === 1, tags: JSON.parse((updated as Record<string, unknown>).tags as string ?? '[]'), assigned_agent_ids };

  return NextResponse.json({ memory });
}

// DELETE /api/claude-code/memories — delete a memory (admin only)
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!await requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const result = await dbRun("DELETE FROM memories WHERE id = ?", [id]);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

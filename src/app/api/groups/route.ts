import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { listGroups, createGroup, cloneGroup } from "@/lib/claude-db";
import { randomUUID } from "crypto";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const groups = listGroups();
  return NextResponse.json({ groups });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { name: string; description?: string; color?: string; icon?: string; clone_from?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { name, description = '', color = '#6366f1', icon = 'shield', clone_from } = body;
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const existing = db.prepare("SELECT id FROM user_groups WHERE name = ?").get(name.trim());
  if (existing) return NextResponse.json({ error: "Group name already exists" }, { status: 409 });

  const newId = randomUUID();

  if (clone_from) {
    const source = db.prepare("SELECT id FROM user_groups WHERE id = ?").get(clone_from);
    if (!source) return NextResponse.json({ error: "Source group not found" }, { status: 404 });
    const group = cloneGroup(clone_from, newId, name.trim());
    return NextResponse.json({ group }, { status: 201 });
  }

  const group = createGroup(newId, name.trim(), description, color, icon);
  return NextResponse.json({ group }, { status: 201 });
}

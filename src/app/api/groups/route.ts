import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { listGroups, createGroup, cloneGroup } from "@/lib/claude-db";
import { randomUUID } from "crypto";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const groups = await listGroups();
  return NextResponse.json({ groups });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { name: string; description?: string; color?: string; icon?: string; clone_from?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { name, description = '', color = '#6366f1', icon = 'shield', clone_from } = body;
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const existing = await dbGet("SELECT id FROM user_groups WHERE name = ?", [name.trim()]);
  if (existing) return NextResponse.json({ error: "Group name already exists" }, { status: 409 });

  const newId = randomUUID();

  if (clone_from) {
    const source = await dbGet("SELECT id FROM user_groups WHERE id = ?", [clone_from]);
    if (!source) return NextResponse.json({ error: "Source group not found" }, { status: 404 });
    const group = await cloneGroup(clone_from, newId, name.trim());
    return NextResponse.json({ group }, { status: 201 });
  }

  const group = await createGroup(newId, name.trim(), description, color, icon);
  return NextResponse.json({ group }, { status: 201 });
}

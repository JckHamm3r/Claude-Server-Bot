import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { getGroup, updateGroup, deleteGroup, getGroupPermissions } from "@/lib/claude-db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = getGroup(params.id);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  const permissions = getGroupPermissions(params.id);
  return NextResponse.json({ group, permissions });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = getGroup(params.id);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  let body: { name?: string; description?: string; color?: string; icon?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.name && body.name !== group.name) {
    const existing = db.prepare("SELECT id FROM user_groups WHERE name = ? AND id != ?").get(body.name, params.id);
    if (existing) return NextResponse.json({ error: "Group name already exists" }, { status: 409 });
  }

  updateGroup(params.id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.color !== undefined ? { color: body.color } : {}),
    ...(body.icon !== undefined ? { icon: body.icon } : {}),
  });

  return NextResponse.json({ ok: true, group: getGroup(params.id) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = getGroup(params.id);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (group.is_system) return NextResponse.json({ error: "Cannot delete system groups" }, { status: 400 });

  deleteGroup(params.id);
  return NextResponse.json({ ok: true });
}

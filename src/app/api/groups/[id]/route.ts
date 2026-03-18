import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { getGroup, updateGroup, deleteGroup, getGroupPermissions } from "@/lib/claude-db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getGroup(params.id);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  const permissions = await getGroupPermissions(params.id);
  return NextResponse.json({ group, permissions });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getGroup(params.id);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  let body: { name?: string; description?: string; color?: string; icon?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.name && body.name !== group.name) {
    const existing = await dbGet("SELECT id FROM user_groups WHERE name = ? AND id != ?", [body.name, params.id]);
    if (existing) return NextResponse.json({ error: "Group name already exists" }, { status: 409 });
  }

  await updateGroup(params.id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.color !== undefined ? { color: body.color } : {}),
    ...(body.icon !== undefined ? { icon: body.icon } : {}),
  });

  return NextResponse.json({ ok: true, group: await getGroup(params.id) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getGroup(params.id);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (group.is_system) return NextResponse.json({ error: "Cannot delete system groups" }, { status: 400 });

  await deleteGroup(params.id);
  return NextResponse.json({ ok: true });
}

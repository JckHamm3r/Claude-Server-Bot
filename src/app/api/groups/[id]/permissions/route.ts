import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { getGroup, getGroupPermissions, setGroupPermissions } from "@/lib/claude-db";

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
  return NextResponse.json({ permissions });
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

  let body: Record<string, Record<string, unknown>>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  await setGroupPermissions(params.id, body);
  const permissions = await getGroupPermissions(params.id);
  return NextResponse.json({ ok: true, permissions });
}

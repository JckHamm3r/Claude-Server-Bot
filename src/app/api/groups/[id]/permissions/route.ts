import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { getGroup, getGroupPermissions, setGroupPermissions } from "@/lib/claude-db";

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
  return NextResponse.json({ permissions });
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

  let body: Record<string, Record<string, unknown>>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  setGroupPermissions(params.id, body);
  const permissions = getGroupPermissions(params.id);
  return NextResponse.json({ ok: true, permissions });
}

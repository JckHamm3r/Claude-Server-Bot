import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { getGroup, listGroupMembers, assignUserToGroup } from "@/lib/claude-db";

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

  const members = await listGroupMembers(params.id);
  return NextResponse.json({ members });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getGroup(params.id);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  let body: { email: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const targetUser = await dbGet("SELECT email FROM users WHERE email = ?", [body.email]);
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await assignUserToGroup(body.email, params.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params: _params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [session.user.email]);
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { email: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.email) return NextResponse.json({ error: "email required" }, { status: 400 });

  await assignUserToGroup(body.email, null);
  return NextResponse.json({ ok: true });
}

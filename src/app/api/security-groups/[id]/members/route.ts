import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import {
  getSecurityGroup,
  assignUserSecurityGroup,
  removeUserSecurityGroup,
} from "@/lib/claude-db";
import { logActivity } from "@/lib/activity-log";

async function isAdmin(email: string): Promise<boolean> {
  const row = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [email]);
  return Boolean(row?.is_admin);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getSecurityGroup(params.id);
  if (!group) return NextResponse.json({ error: "Security group not found" }, { status: 404 });

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email } = body;
  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  const userExists = await dbGet("SELECT email FROM users WHERE email = ?", [email]);
  if (!userExists) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await assignUserSecurityGroup(email, params.id, session.user.email);
  await logActivity("security_group_member_added", session.user.email, { group_id: params.id, group_name: group.name, user_email: email });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getSecurityGroup(params.id);
  if (!group) return NextResponse.json({ error: "Security group not found" }, { status: 404 });

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email } = body;
  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  await removeUserSecurityGroup(email, params.id);
  await logActivity("security_group_member_removed", session.user.email, { group_id: params.id, group_name: group.name, user_email: email });

  return NextResponse.json({ ok: true });
}

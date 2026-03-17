import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import {
  getSecurityGroup,
  assignUserSecurityGroup,
  removeUserSecurityGroup,
} from "@/lib/claude-db";
import { logActivity } from "@/lib/activity-log";

function isAdmin(email: string): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(email) as { is_admin: number } | undefined;
  return Boolean(row?.is_admin);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = getSecurityGroup(params.id);
  if (!group) return NextResponse.json({ error: "Security group not found" }, { status: 404 });

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email } = body;
  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  const userExists = db.prepare("SELECT email FROM users WHERE email = ?").get(email);
  if (!userExists) return NextResponse.json({ error: "User not found" }, { status: 404 });

  assignUserSecurityGroup(email, params.id, session.user.email);
  logActivity("security_group_member_added", session.user.email, { group_id: params.id, group_name: group.name, user_email: email });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = getSecurityGroup(params.id);
  if (!group) return NextResponse.json({ error: "Security group not found" }, { status: 404 });

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email } = body;
  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  removeUserSecurityGroup(email, params.id);
  logActivity("security_group_member_removed", session.user.email, { group_id: params.id, group_name: group.name, user_email: email });

  return NextResponse.json({ ok: true });
}

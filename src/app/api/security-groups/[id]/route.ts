import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import {
  getSecurityGroup,
  updateSecurityGroup,
  deleteSecurityGroup,
  getSecurityGroupMembers,
} from "@/lib/claude-db";
import { validateIPOrCIDR } from "@/lib/ip-allowlist";
import { logActivity } from "@/lib/activity-log";

async function isAdmin(email: string): Promise<boolean> {
  const row = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [email]);
  return Boolean(row?.is_admin);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getSecurityGroup(params.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const members = await getSecurityGroupMembers(params.id);
  return NextResponse.json({ group, members });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getSecurityGroup(params.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { name?: string; description?: string; allowed_ips?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.allowed_ips !== undefined) {
    for (const entry of body.allowed_ips) {
      const v = validateIPOrCIDR(String(entry));
      if (!v.valid) {
        return NextResponse.json({ error: `Invalid IP/CIDR: ${entry} — ${v.error}` }, { status: 400 });
      }
    }
    body.allowed_ips = body.allowed_ips.map((e) => String(e).trim()).filter(Boolean);
  }

  if (body.name !== undefined) {
    const clash = await dbGet("SELECT id FROM security_groups WHERE name = ? AND id != ?", [body.name.trim(), params.id]);
    if (clash) return NextResponse.json({ error: "A security group with that name already exists" }, { status: 409 });
  }

  await updateSecurityGroup(params.id, body);
  await logActivity("security_group_updated", session.user.email, { group_id: params.id, group_name: group.name });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const group = await getSecurityGroup(params.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteSecurityGroup(params.id);
  await logActivity("security_group_deleted", session.user.email, { group_id: params.id, group_name: group.name });

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { randomUUID } from "crypto";
import {
  listSecurityGroups,
  createSecurityGroup,
} from "@/lib/claude-db";
import { validateIPOrCIDR } from "@/lib/ip-allowlist";
import { logActivity } from "@/lib/activity-log";

function isAdmin(email: string): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(email) as { is_admin: number } | undefined;
  return Boolean(row?.is_admin);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const groups = listSecurityGroups();
  return NextResponse.json({ groups });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { name: string; description?: string; allowed_ips?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, description = "", allowed_ips = [] } = body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  for (const entry of allowed_ips) {
    const v = validateIPOrCIDR(String(entry));
    if (!v.valid) {
      return NextResponse.json({ error: `Invalid IP/CIDR: ${entry} — ${v.error}` }, { status: 400 });
    }
  }

  const existing = db.prepare("SELECT id FROM security_groups WHERE name = ?").get(name.trim());
  if (existing) return NextResponse.json({ error: "A security group with that name already exists" }, { status: 409 });

  const id = randomUUID();
  const group = createSecurityGroup(id, name.trim(), description, allowed_ips.map((e) => String(e).trim()).filter(Boolean));
  logActivity("security_group_created", session.user.email, { group_id: id, group_name: name.trim() });

  return NextResponse.json({ group }, { status: 201 });
}

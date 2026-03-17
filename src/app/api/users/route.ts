import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import db from "@/lib/db";
import { assignUserToGroup, getGroup, getUserSecurityGroups } from "@/lib/claude-db";
import { validateIPOrCIDR } from "@/lib/ip-allowlist";
import { logActivity } from "@/lib/activity-log";

function generatePassword(): string {
  const len = Math.floor(Math.random() * 47) + 80; // 80–126 chars
  return crypto.randomBytes(96).toString("base64").slice(0, len);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if user is admin
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = db.prepare(`
    SELECT u.email, u.is_admin, u.first_name, u.last_name, u.avatar_url, u.created_at, u.group_id,
           u.allowed_ips,
           g.name as group_name, g.color as group_color, g.icon as group_icon
    FROM users u
    LEFT JOIN user_groups g ON g.id = u.group_id
    ORDER BY u.created_at ASC
  `).all() as Array<{ email: string; is_admin: number; first_name: string; last_name: string; avatar_url: string | null; created_at: string; group_id: string | null; allowed_ips: string | null; group_name: string | null; group_color: string | null; group_icon: string | null }>;

  // Attach security group names for each user
  const usersWithSecurityGroups = users.map((u) => {
    const secGroups = getUserSecurityGroups(u.email);
    return { ...u, security_groups: secGroups.map((sg) => ({ id: sg.id, name: sg.name })) };
  });

  return NextResponse.json({ users: usersWithSecurityGroups });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!requester?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email: string; firstName?: string; lastName?: string; groupId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, firstName = '', lastName = '', groupId } = body;
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  const existing = db.prepare("SELECT email FROM users WHERE email = ?").get(email);
  if (existing) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  if (groupId !== undefined && groupId !== null) {
    const grp = getGroup(groupId);
    if (!grp) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const password = generatePassword();
  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO users (email, hash, is_admin, first_name, last_name, group_id) VALUES (?, ?, 0, ?, ?, ?)").run(email, hash, firstName, lastName, groupId ?? null);

  return NextResponse.json({ email, password });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!requester?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email } = body;
  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  if (email === session.user.email) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  db.prepare("DELETE FROM users WHERE email = ?").run(email);
  db.prepare("DELETE FROM user_settings WHERE email = ?").run(email);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!requester?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email: string; newEmail?: string; is_admin?: boolean; resetPassword?: boolean; first_name?: string; last_name?: string; group_id?: string | null; allowed_ips?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, newEmail, is_admin, resetPassword, first_name, last_name, group_id, allowed_ips } = body;
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  const target = db.prepare("SELECT email, is_admin FROM users WHERE email = ?").get(email) as
    | { email: string; is_admin: number }
    | undefined;
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const seedEmail = process.env.CLAUDE_BOT_ADMIN_EMAIL;

  // Prevent changing the env-seeded admin's email
  if (newEmail && email === seedEmail) {
    return NextResponse.json({ error: "Cannot change the primary admin email" }, { status: 400 });
  }

  // Prevent demoting yourself
  if (is_admin === false && email === session.user.email) {
    return NextResponse.json({ error: "Cannot remove your own admin role" }, { status: 400 });
  }

  const result: { password?: string } = {};

  if (newEmail && newEmail !== email) {
    if (typeof newEmail !== "string" || !newEmail.includes("@")) {
      return NextResponse.json({ error: "Invalid new email" }, { status: 400 });
    }
    const clash = db.prepare("SELECT email FROM users WHERE email = ?").get(newEmail);
    if (clash) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    db.prepare("UPDATE users SET email = ? WHERE email = ?").run(newEmail, email);
    db.prepare("UPDATE user_settings SET email = ? WHERE email = ?").run(newEmail, email);
  }

  const effectiveEmail = newEmail && newEmail !== email ? newEmail : email;

  if (typeof is_admin === "boolean") {
    db.prepare("UPDATE users SET is_admin = ? WHERE email = ?").run(is_admin ? 1 : 0, effectiveEmail);
  }

  if (resetPassword) {
    const password = generatePassword();
    const hash = await bcrypt.hash(password, 12);
    db.prepare("UPDATE users SET hash = ?, must_change_password = 1 WHERE email = ?").run(hash, effectiveEmail);
    result.password = password;
  }

  if (first_name !== undefined) {
    db.prepare("UPDATE users SET first_name = ? WHERE email = ?").run(first_name, effectiveEmail);
  }

  if (last_name !== undefined) {
    db.prepare("UPDATE users SET last_name = ? WHERE email = ?").run(last_name, effectiveEmail);
  }

  if (group_id !== undefined) {
    if (group_id !== null) {
      const grp = getGroup(group_id);
      if (!grp) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    assignUserToGroup(effectiveEmail, group_id);
  }

  if (allowed_ips !== undefined) {
    if (!Array.isArray(allowed_ips)) {
      return NextResponse.json({ error: "allowed_ips must be an array" }, { status: 400 });
    }
    for (const entry of allowed_ips) {
      const v = validateIPOrCIDR(String(entry));
      if (!v.valid) {
        return NextResponse.json({ error: `Invalid IP/CIDR: ${entry} — ${v.error}` }, { status: 400 });
      }
    }
    const normalizedIPs = allowed_ips.map((e) => String(e).trim()).filter(Boolean);
    db.prepare("UPDATE users SET allowed_ips = ? WHERE email = ?").run(
      JSON.stringify(normalizedIPs),
      effectiveEmail
    );
    logActivity("user_ip_allowlist_updated", session.user.email, { target_email: effectiveEmail, ip_count: normalizedIPs.length });
  }

  return NextResponse.json({ ok: true, email: effectiveEmail, ...result });
}

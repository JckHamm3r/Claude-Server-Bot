import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { dbGet, dbAll, dbRun } from "@/lib/db";
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

  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await dbAll<{ email: string; is_admin: number; first_name: string; last_name: string; avatar_url: string | null; created_at: string; group_id: string | null; allowed_ips: string | null; group_name: string | null; group_color: string | null; group_icon: string | null }>(
    `SELECT u.email, u.is_admin, u.first_name, u.last_name, u.avatar_url, u.created_at, u.group_id,
           u.allowed_ips,
           g.name as group_name, g.color as group_color, g.icon as group_icon
    FROM users u
    LEFT JOIN user_groups g ON g.id = u.group_id
    ORDER BY u.created_at ASC`
  );

  const usersWithSecurityGroups = await Promise.all(
    users.map(async (u) => {
      const secGroups = await getUserSecurityGroups(u.email);
      return { ...u, security_groups: secGroups.map((sg) => ({ id: sg.id, name: sg.name })) };
    })
  );

  return NextResponse.json({ users: usersWithSecurityGroups });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
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

  const existing = await dbGet("SELECT email FROM users WHERE email = ?", [email]);
  if (existing) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  if (groupId !== undefined && groupId !== null) {
    const grp = await getGroup(groupId);
    if (!grp) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const password = generatePassword();
  const hash = await bcrypt.hash(password, 12);
  await dbRun(
    "INSERT INTO users (email, hash, is_admin, first_name, last_name, group_id) VALUES (?, ?, 0, ?, ?, ?)",
    [email, hash, firstName, lastName, groupId ?? null]
  );

  return NextResponse.json({ email, password });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
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

  await dbRun("DELETE FROM users WHERE email = ?", [email]);
  await dbRun("DELETE FROM user_settings WHERE email = ?", [email]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
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

  const target = await dbGet<{ email: string; is_admin: number }>(
    "SELECT email, is_admin FROM users WHERE email = ?",
    [email]
  );
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const seedEmail = process.env.CLAUDE_BOT_ADMIN_EMAIL;

  if (newEmail && email === seedEmail) {
    return NextResponse.json({ error: "Cannot change the primary admin email" }, { status: 400 });
  }

  if (is_admin === false && email === session.user.email) {
    return NextResponse.json({ error: "Cannot remove your own admin role" }, { status: 400 });
  }

  const result: { password?: string } = {};

  if (newEmail && newEmail !== email) {
    if (typeof newEmail !== "string" || !newEmail.includes("@")) {
      return NextResponse.json({ error: "Invalid new email" }, { status: 400 });
    }
    const clash = await dbGet("SELECT email FROM users WHERE email = ?", [newEmail]);
    if (clash) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    await dbRun("UPDATE users SET email = ? WHERE email = ?", [newEmail, email]);
    await dbRun("UPDATE user_settings SET email = ? WHERE email = ?", [newEmail, email]);
  }

  const effectiveEmail = newEmail && newEmail !== email ? newEmail : email;

  if (typeof is_admin === "boolean") {
    await dbRun("UPDATE users SET is_admin = ? WHERE email = ?", [is_admin ? 1 : 0, effectiveEmail]);
  }

  if (resetPassword) {
    const password = generatePassword();
    const hash = await bcrypt.hash(password, 12);
    await dbRun("UPDATE users SET hash = ?, must_change_password = 1 WHERE email = ?", [hash, effectiveEmail]);
    result.password = password;
  }

  if (first_name !== undefined) {
    await dbRun("UPDATE users SET first_name = ? WHERE email = ?", [first_name, effectiveEmail]);
  }

  if (last_name !== undefined) {
    await dbRun("UPDATE users SET last_name = ? WHERE email = ?", [last_name, effectiveEmail]);
  }

  if (group_id !== undefined) {
    if (group_id !== null) {
      const grp = await getGroup(group_id);
      if (!grp) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    await assignUserToGroup(effectiveEmail, group_id);
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
    await dbRun(
      "UPDATE users SET allowed_ips = ? WHERE email = ?",
      [JSON.stringify(normalizedIPs), effectiveEmail]
    );
    await logActivity("user_ip_allowlist_updated", session.user.email, { target_email: effectiveEmail, ip_count: normalizedIPs.length });
  }

  return NextResponse.json({ ok: true, email: effectiveEmail, ...result });
}

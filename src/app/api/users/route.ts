import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import db from "@/lib/db";
import { getUserSettings, updateUserSettings } from "@/lib/claude-db";

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

  const users = db.prepare("SELECT email, is_admin, first_name, last_name, avatar_url, created_at FROM users ORDER BY created_at ASC").all() as Array<{ email: string; is_admin: number; first_name: string; last_name: string; avatar_url: string | null; created_at: string }>;
  // Attach experience_level from user_settings for each user
  const usersWithLevel = users.map((u) => {
    const settings = getUserSettings(u.email);
    return { ...u, experience_level: settings.experience_level };
  });
  return NextResponse.json({ users: usersWithLevel });
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

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email } = body;
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  const existing = db.prepare("SELECT email FROM users WHERE email = ?").get(email);
  if (existing) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  const password = generatePassword();
  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO users (email, hash, is_admin) VALUES (?, ?, 0)").run(email, hash);

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

  let body: { email: string; newEmail?: string; is_admin?: boolean; resetPassword?: boolean; experience_level?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, newEmail, is_admin, resetPassword, experience_level } = body;
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

  if (experience_level !== undefined) {
    const validLevels = ["beginner", "intermediate", "expert"];
    if (!validLevels.includes(experience_level)) {
      return NextResponse.json({ error: "Invalid experience_level" }, { status: 400 });
    }
    updateUserSettings(effectiveEmail, { experience_level });
  }

  return NextResponse.json({ ok: true, email: effectiveEmail, ...result });
}

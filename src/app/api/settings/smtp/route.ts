import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbRun } from "@/lib/db";
import type { InValue } from "@libsql/client";

interface SmtpRow {
  host: string;
  port: number;
  secure: number;
  username: string;
  password: string;
  from_name: string;
  from_address: string;
  reply_to: string;
  enabled: number;
  updated_at: string;
}

async function requireAdmin(email: string): Promise<boolean> {
  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [email]
  );
  return Boolean(user?.is_admin);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await dbGet<SmtpRow>(
    "SELECT host, port, secure, username, password, from_name, from_address, reply_to, enabled, updated_at FROM smtp_settings WHERE id = 1"
  );

  if (!row) {
    return NextResponse.json({
      host: "",
      port: 587,
      secure: false,
      username: "",
      password: "",
      from_name: "",
      from_address: "",
      reply_to: "",
      enabled: true,
    });
  }

  // Mask the password: return empty string if set so the frontend knows
  // a password exists without exposing it. Client sends the real value back
  // only if it changes the field.
  const maskedPassword = row.password ? "••••••••" : "";

  return NextResponse.json({
    host: row.host,
    port: row.port,
    secure: Boolean(row.secure),
    username: row.username,
    password: maskedPassword,
    from_name: row.from_name,
    from_address: row.from_address,
    reply_to: row.reply_to,
    enabled: Boolean(row.enabled),
    updated_at: row.updated_at,
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Partial<{
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from_name: string;
    from_address: string;
    reply_to: string;
    enabled: boolean;
  }>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // If the password is the masked sentinel value, keep the existing password.
  let passwordSql = "password = ?";
  let useExistingPassword = false;
  if (body.password === "••••••••" || body.password === undefined) {
    passwordSql = "password = (SELECT password FROM smtp_settings WHERE id = 1)";
    useExistingPassword = true;
  }

  const params: InValue[] = [
    body.host ?? "",
    body.port ?? 587,
    body.secure ? 1 : 0,
    body.username ?? "",
    body.from_name ?? "",
    body.from_address ?? "",
    body.reply_to ?? "",
    body.enabled !== false ? 1 : 0,
  ];

  if (!useExistingPassword) {
    params.push(body.password ?? "");
  }

  await dbRun(
    `UPDATE smtp_settings SET
      host = ?,
      port = ?,
      secure = ?,
      username = ?,
      from_name = ?,
      from_address = ?,
      reply_to = ?,
      enabled = ?,
      ${passwordSql},
      updated_at = datetime('now')
    WHERE id = 1`,
    params
  );

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbRun } from "@/lib/db";

async function requireAdmin(email: string): Promise<boolean> {
  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [email]
  );
  return Boolean(user?.is_admin);
}

async function getSetting(key: string): Promise<string> {
  const row = await dbGet<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = ?",
    [key]
  );
  return row?.value ?? "";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    personality: (await getSetting("personality")) || "professional",
    personality_custom: await getSetting("personality_custom"),
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

  let body: { personality?: string; personality_custom?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const upsertSql =
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

  if (body.personality !== undefined) {
    await dbRun(upsertSql, ["personality", String(body.personality)]);
  }
  if (body.personality_custom !== undefined) {
    await dbRun(upsertSql, ["personality_custom", String(body.personality_custom)]);
  }

  return NextResponse.json({ ok: true });
}

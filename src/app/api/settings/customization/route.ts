import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

function requireAdmin(email: string): boolean {
  const user = db
    .prepare("SELECT is_admin FROM users WHERE email = ?")
    .get(email) as { is_admin: number } | undefined;
  return Boolean(user?.is_admin);
}

function getSetting(key: string): string {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? "";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    personality: getSetting("personality") || "professional",
    personality_custom: getSetting("personality_custom"),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { personality?: string; personality_custom?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );

  if (body.personality !== undefined) {
    upsert.run("personality", String(body.personality));
  }
  if (body.personality_custom !== undefined) {
    upsert.run("personality_custom", String(body.personality_custom));
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbAll, dbRun } from "@/lib/db";

export const dynamic = "force-dynamic";

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

  const rows = await dbAll<{ key: string; value: string }>(
    "SELECT key, value FROM app_settings ORDER BY key ASC"
  );

  const SENSITIVE_KEYS = new Set(["anthropic_api_key"]);
  const settings: Record<string, string> = {};
  for (const row of rows) {
    if (SENSITIVE_KEYS.has(row.key)) continue;
    settings[row.key] = row.value;
  }

  return NextResponse.json(settings);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  const KNOWN_KEYS = new Set([
    "personality", "personality_custom",
    "guard_rails_enabled", "sandbox_enabled", "ip_protection_enabled",
    "sandbox_always_allowed", "sandbox_always_blocked",
    "ip_max_attempts", "ip_window_minutes", "ip_block_duration_minutes",
    "rate_limit_commands", "rate_limit_runtime_min", "rate_limit_concurrent",
    "upload_max_size_bytes",
    "anthropic_api_key",
    "trusted_proxy",
    "budget_limit_session_usd", "budget_limit_daily_usd", "budget_limit_monthly_usd",
  ]);

  const entries = Object.entries(body)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as [string, string]);

  if (entries.length === 0) {
    return NextResponse.json({ error: "No settings provided" }, { status: 400 });
  }

  const unknownKeys = entries.filter(([k]) => !KNOWN_KEYS.has(k)).map(([k]) => k);

  const upsertSql =
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

  for (const [k, v] of entries) {
    await dbRun(upsertSql, [k, v]);
  }

  if (unknownKeys.length > 0) {
    return NextResponse.json({ ok: true, warning: `Unrecognized keys: ${unknownKeys.join(", ")}` });
  }

  return NextResponse.json({ ok: true });
}

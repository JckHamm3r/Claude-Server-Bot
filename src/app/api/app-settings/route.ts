import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type Database from "better-sqlite3";

export const dynamic = "force-dynamic";

let dbInstance: Database.Database | null = null;

async function getDb(): Promise<Database.Database> {
  if (!dbInstance) {
    // Lazy-load DB so build-time route analysis does not initialize SQLite.
    const mod = (await import("@/lib/db")) as { default: Database.Database };
    dbInstance = mod.default;
  }
  return dbInstance;
}

async function requireAdmin(email: string): Promise<boolean> {
  const db = await getDb();
  const user = db
    .prepare("SELECT is_admin FROM users WHERE email = ?")
    .get(email) as { is_admin: number } | undefined;
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

  const db = await getDb();
  const rows = db
    .prepare("SELECT key, value FROM app_settings ORDER BY key ASC")
    .all() as { key: string; value: string }[];

  const settings: Record<string, string> = {};
  for (const row of rows) {
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

  const db = await getDb();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );

  const upsertMany = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) {
      upsert.run(k, v);
    }
  });

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

  upsertMany(entries);

  if (unknownKeys.length > 0) {
    return NextResponse.json({ ok: true, warning: `Unrecognized keys: ${unknownKeys.join(", ")}` });
  }

  return NextResponse.json({ ok: true });
}

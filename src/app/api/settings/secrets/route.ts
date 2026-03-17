import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import fs from "fs";
import path from "path";

const ENV_FILE = path.join(process.cwd(), ".env");

// Vars managed by the install script or framework — never editable via UI
const DENYLIST = new Set([
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "CLAUDE_BOT_ADMIN_HASH",
  "CLAUDE_BOT_ADMIN_EMAIL",
  "CLAUDE_BOT_SLUG",
  "CLAUDE_BOT_PATH_PREFIX",
  "NODE_ENV",
  "DATA_DIR",
  "SSL_CERT_PATH",
  "SSL_KEY_PATH",
]);

const DENYLIST_PREFIXES = ["NEXT_PUBLIC_"];

const KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

function isDenied(key: string): boolean {
  if (DENYLIST.has(key)) return true;
  return DENYLIST_PREFIXES.some((p) => key.startsWith(p));
}

async function requireExpertAdmin(): Promise<NextResponse | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email;

  const user = db
    .prepare("SELECT is_admin FROM users WHERE email = ?")
    .get(email) as { is_admin: number } | undefined;

  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = db
    .prepare("SELECT experience_level FROM user_settings WHERE email = ?")
    .get(email) as { experience_level: string } | undefined;

  const level = settings?.experience_level ?? "expert";
  if (level !== "expert") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { email };
}

function readEnvLines(): string[] {
  try {
    return fs.readFileSync(ENV_FILE, "utf-8").split("\n");
  } catch {
    return [];
  }
}

function writeEnvLines(lines: string[]): void {
  fs.writeFileSync(ENV_FILE, lines.join("\n"), "utf-8");
}

function parseEnvLines(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1);
    map.set(key, value);
  }
  return map;
}

function upsertEnvLine(lines: string[], key: string, value: string): string[] {
  const sanitized = value.replace(/[\r\n\x00-\x1F\x7F]/g, "");
  const newLine = `${key}=${sanitized}`;
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (idx >= 0) {
    const updated = [...lines];
    updated[idx] = newLine;
    return updated;
  }
  return [...lines, newLine];
}

function deleteEnvLine(lines: string[], key: string): string[] {
  return lines.filter((l) => !l.trim().startsWith(`${key}=`));
}

// GET /api/settings/secrets — list keys (never values)
export async function GET() {
  const auth = await requireExpertAdmin();
  if ("error" in auth) return auth;

  const lines = readEnvLines();
  const parsed = parseEnvLines(lines);

  const vars = Array.from(parsed.entries())
    .filter(([key]) => !isDenied(key))
    .map(([key, value]) => ({ key, isSet: value.trim().length > 0 }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return NextResponse.json({ vars });
}

// PUT /api/settings/secrets — create or update a var
export async function PUT(request: NextRequest) {
  const auth = await requireExpertAdmin();
  if ("error" in auth) return auth;

  let body: { key?: string; value?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key, value } = body;
  if (!key || typeof key !== "string" || value === undefined || typeof value !== "string") {
    return NextResponse.json({ error: "Missing key or value" }, { status: 400 });
  }

  const upperKey = key.trim().toUpperCase();
  if (!KEY_REGEX.test(upperKey)) {
    return NextResponse.json(
      { error: "Key must match pattern A-Z, 0-9, underscore and start with a letter or underscore" },
      { status: 400 },
    );
  }
  if (isDenied(upperKey)) {
    return NextResponse.json({ error: "This variable cannot be modified" }, { status: 403 });
  }

  const sanitizedValue = (value ?? "").replace(/[\r\n\x00-\x1F\x7F]/g, "");

  try {
    const lines = readEnvLines();
    const updated = upsertEnvLine(lines, upperKey, sanitizedValue);
    writeEnvLines(updated);
    process.env[upperKey] = sanitizedValue;
  } catch (err) {
    console.error("[settings/secrets] write failed:", err);
    return NextResponse.json({ error: "Failed to write configuration" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, requiresRestart: true });
}

// DELETE /api/settings/secrets — remove a var
export async function DELETE(request: NextRequest) {
  const auth = await requireExpertAdmin();
  if ("error" in auth) return auth;

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key } = body;
  if (!key || typeof key !== "string") {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const upperKey = key.trim().toUpperCase();
  if (isDenied(upperKey)) {
    return NextResponse.json({ error: "This variable cannot be deleted" }, { status: 403 });
  }

  try {
    const lines = readEnvLines();
    const updated = deleteEnvLine(lines, upperKey);
    writeEnvLines(updated);
    delete process.env[upperKey];
  } catch (err) {
    console.error("[settings/secrets] delete failed:", err);
    return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, requiresRestart: true });
}

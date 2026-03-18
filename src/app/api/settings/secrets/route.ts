import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbRun } from "@/lib/db";
import fs from "fs";
import path from "path";

const ENV_FILE = path.join(process.cwd(), ".env");

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

type SecretType = "secret" | "api_key" | "variable";

interface SecretMetaRow {
  key: string;
  type: SecretType;
  description: string;
}

/** Known installer-seeded keys with their canonical type and description. */
const DEFAULT_TYPES: Record<string, { type: SecretType; description: string }> = {
  ANTHROPIC_API_KEY: { type: "api_key", description: "Anthropic API key for Claude" },
  PORT: { type: "variable", description: "Server listening port" },
  CLAUDE_BOT_NAME: { type: "variable", description: "Bot display name" },
  CLAUDE_PROJECT_ROOT: { type: "variable", description: "Working directory for Claude sessions" },
};

/** Infer a type from the key name when no metadata row exists. */
function inferType(key: string): { type: SecretType; description: string } {
  if (DEFAULT_TYPES[key]) return DEFAULT_TYPES[key];
  if (/API_?KEY|APIKEY/i.test(key)) return { type: "api_key", description: "" };
  if (/SECRET|PASSWORD|PASSWD|TOKEN|HASH|PRIVATE/i.test(key)) return { type: "secret", description: "" };
  return { type: "variable", description: "" };
}

/** Mask a value: show first 4 and last 4 chars. Handles short values gracefully. */
function maskValue(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 8) return `${"*".repeat(v.length)}`;
  return `${v.slice(0, 4)}...${ v.slice(-4)}`;
}

function isDenied(key: string): boolean {
  if (DENYLIST.has(key)) return true;
  return DENYLIST_PREFIXES.some((p) => key.startsWith(p));
}

async function getExpertAdminEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const email = session.user.email;

  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [email]
  );
  if (!user?.is_admin) return null;

  return email;
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

async function getMetadata(key: string): Promise<SecretMetaRow> {
  const row = await dbGet<SecretMetaRow>(
    "SELECT key, type, description FROM secret_metadata WHERE key = ?",
    [key]
  );
  if (row) return row;

  // Auto-classify and persist
  const inferred = inferType(key);
  await dbRun(
    "INSERT OR IGNORE INTO secret_metadata (key, type, description) VALUES (?, ?, ?)",
    [key, inferred.type, inferred.description]
  );
  return { key, type: inferred.type, description: inferred.description };
}

// GET /api/settings/secrets — list keys with metadata and conditional values
// ?reveal=KEY returns { key, value } for api_key type only
export async function GET(request: NextRequest) {
  const email = await getExpertAdminEmail();
  if (!email) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const revealKey = request.nextUrl.searchParams.get("reveal");

  const lines = readEnvLines();
  const parsed = parseEnvLines(lines);

  // Handle reveal request
  if (revealKey) {
    const upperRevealKey = revealKey.trim().toUpperCase();
    if (isDenied(upperRevealKey)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const meta = await getMetadata(upperRevealKey);
    if (meta.type !== "api_key") {
      return NextResponse.json({ error: "Only API keys can be revealed" }, { status: 403 });
    }
    const value = parsed.get(upperRevealKey) ?? "";
    return NextResponse.json({ key: upperRevealKey, value });
  }

  const entries = Array.from(parsed.entries()).filter(([key]) => !isDenied(key));
  const vars = await Promise.all(
    entries.map(async ([key, rawValue]) => {
      const meta = await getMetadata(key);
      const isSet = rawValue.trim().length > 0;

      const base = {
        key,
        isSet,
        type: meta.type,
        description: meta.description,
      };

      if (meta.type === "variable") {
        return { ...base, value: rawValue };
      }
      if (meta.type === "api_key") {
        return { ...base, maskedValue: isSet ? maskValue(rawValue) : "" };
      }
      // secret — no value exposed
      return base;
    })
  );

  vars.sort((a, b) => a.key.localeCompare(b.key));

  return NextResponse.json({ vars });
}

// PUT /api/settings/secrets — create or update a var
export async function PUT(request: NextRequest) {
  const email = await getExpertAdminEmail();
  if (!email) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { key?: string; value?: string; type?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key, value, type, description } = body;
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

  const validTypes: SecretType[] = ["secret", "api_key", "variable"];
  const existingMeta = await getMetadata(upperKey);
  const resolvedType: SecretType = (type && validTypes.includes(type as SecretType))
    ? (type as SecretType)
    : (existingMeta.type ?? "secret");

  const resolvedDescription = typeof description === "string" ? description : "";

  const sanitizedValue = value.replace(/[\r\n\x00-\x1F\x7F]/g, "");

  try {
    const lines = readEnvLines();
    const updated = upsertEnvLine(lines, upperKey, sanitizedValue);
    writeEnvLines(updated);
    process.env[upperKey] = sanitizedValue;
  } catch (err) {
    console.error("[settings/secrets] write failed:", err);
    return NextResponse.json({ error: "Failed to write configuration" }, { status: 500 });
  }

  await dbRun(
    "INSERT INTO secret_metadata (key, type, description) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET type = excluded.type, description = excluded.description",
    [upperKey, resolvedType, resolvedDescription]
  );

  return NextResponse.json({ ok: true, requiresRestart: true });
}

// DELETE /api/settings/secrets — remove a var
export async function DELETE(request: NextRequest) {
  const email = await getExpertAdminEmail();
  if (!email) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  await dbRun("DELETE FROM secret_metadata WHERE key = ?", [upperKey]);

  return NextResponse.json({ ok: true, requiresRestart: true });
}

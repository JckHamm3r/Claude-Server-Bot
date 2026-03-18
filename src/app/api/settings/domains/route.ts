import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbAll, dbRun } from "@/lib/db";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface DomainRow {
  id: string;
  hostname: string;
  is_primary: number;
  ssl_enabled: number;
  verified: number;
  added_at: string;
  notes: string | null;
}

async function requireAdmin(email: string): Promise<boolean> {
  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [email]
  );
  return Boolean(user?.is_admin);
}

async function getAdminEmail(): Promise<string> {
  const row = await dbGet<{ email: string }>(
    "SELECT email FROM users WHERE is_admin = 1 LIMIT 1"
  );
  return row?.email ?? "";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await dbAll<DomainRow>(
    "SELECT id, hostname, is_primary, ssl_enabled, verified, added_at, notes FROM domains ORDER BY added_at ASC"
  );

  const domains = rows.map((r) => ({
    id: r.id,
    hostname: r.hostname,
    is_primary: Boolean(r.is_primary),
    ssl_enabled: Boolean(r.ssl_enabled),
    verified: Boolean(r.verified),
    added_at: r.added_at,
    notes: r.notes ?? null,
  }));

  return NextResponse.json({ domains });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { hostname?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const hostname = body.hostname?.trim();
  if (!hostname) {
    return NextResponse.json({ error: "Missing hostname" }, { status: 400 });
  }

  // Basic hostname validation
  const hostnameRegex =
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (!hostnameRegex.test(hostname)) {
    return NextResponse.json({ error: "Invalid hostname" }, { status: 400 });
  }

  const existing = await dbGet("SELECT id FROM domains WHERE hostname = ?", [hostname]);
  if (existing) {
    return NextResponse.json({ error: "Domain already exists" }, { status: 409 });
  }

  await dbRun(
    "INSERT INTO domains (hostname, notes) VALUES (?, ?)",
    [hostname, body.notes ?? null]
  );

  // Validate arguments before shell invocation
  const port = process.env.PORT || "3000";
  const pathPrefix = process.env.CLAUDE_BOT_PATH_PREFIX || "";
  const slug = process.env.CLAUDE_BOT_SLUG || "";

  if (!/^\d+$/.test(port)) {
    return NextResponse.json({ error: "Invalid PORT configuration" }, { status: 500 });
  }
  if (pathPrefix && !/^[a-zA-Z0-9_-]*$/.test(pathPrefix)) {
    return NextResponse.json({ error: "Invalid PATH_PREFIX configuration" }, { status: 500 });
  }
  if (slug && !/^[a-zA-Z0-9]+$/.test(slug)) {
    return NextResponse.json({ error: "Invalid SLUG configuration" }, { status: 500 });
  }

  let setupResult: { ok: boolean; error?: string } = { ok: false, error: "Setup script not available" };
  try {
    const { stdout } = await execFileAsync("sudo", [
      "/usr/local/bin/setup-domain.sh",
      hostname,
      port,
      pathPrefix,
      slug,
      process.cwd(),
      await getAdminEmail(),
    ], { timeout: 120000 });

    setupResult = JSON.parse(stdout.trim());
    if (setupResult.ok) {
      await dbRun("UPDATE domains SET ssl_enabled = 1, verified = 1 WHERE hostname = ?", [hostname]);
    } else {
      await dbRun("UPDATE domains SET notes = ? WHERE hostname = ?", [
        `Setup failed: ${setupResult.error ?? "unknown error"}`,
        hostname,
      ]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    setupResult = { ok: false, error: message };
    await dbRun("UPDATE domains SET notes = ? WHERE hostname = ?", [
      `Setup failed: ${message}`,
      hostname,
    ]);
  }

  return NextResponse.json({
    ok: true,
    setup: setupResult,
  });
}

// POST to retry setup for an existing domain
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const domain = await dbGet<{ hostname: string }>(
    "SELECT hostname FROM domains WHERE id = ?",
    [id]
  );
  if (!domain) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const retryPort = process.env.PORT || "3000";
  const retryPathPrefix = process.env.CLAUDE_BOT_PATH_PREFIX || "";
  const retrySlug = process.env.CLAUDE_BOT_SLUG || "";

  if (!/^\d+$/.test(retryPort)) {
    return NextResponse.json({ error: "Invalid PORT configuration" }, { status: 500 });
  }
  if (retryPathPrefix && !/^[a-zA-Z0-9_-]*$/.test(retryPathPrefix)) {
    return NextResponse.json({ error: "Invalid PATH_PREFIX configuration" }, { status: 500 });
  }
  if (retrySlug && !/^[a-zA-Z0-9]+$/.test(retrySlug)) {
    return NextResponse.json({ error: "Invalid SLUG configuration" }, { status: 500 });
  }

  let setupResult: { ok: boolean; error?: string } = { ok: false, error: "Setup script not available" };
  try {
    const { stdout } = await execFileAsync("sudo", [
      "/usr/local/bin/setup-domain.sh",
      domain.hostname,
      retryPort,
      retryPathPrefix,
      retrySlug,
      process.cwd(),
      await getAdminEmail(),
    ], { timeout: 120000 });

    setupResult = JSON.parse(stdout.trim());
    if (setupResult.ok) {
      await dbRun(
        "UPDATE domains SET ssl_enabled = 1, verified = 1, notes = NULL WHERE hostname = ?",
        [domain.hostname]
      );
    } else {
      await dbRun("UPDATE domains SET notes = ? WHERE hostname = ?", [
        `Setup failed: ${setupResult.error ?? "unknown error"}`,
        domain.hostname,
      ]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    setupResult = { ok: false, error: message };
    await dbRun("UPDATE domains SET notes = ? WHERE hostname = ?", [
      `Setup failed: ${message}`,
      domain.hostname,
    ]);
  }

  return NextResponse.json({ ok: true, setup: setupResult });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id query parameter" }, { status: 400 });
  }

  const domain = await dbGet<{ id: string; hostname: string }>(
    "SELECT id, hostname FROM domains WHERE id = ?",
    [id]
  );
  if (!domain) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  // Attempt cleanup of nginx config and certs before removing from DB
  let cleanupResult: { ok: boolean; error?: string } | null = null;
  try {
    const { stdout } = await execFileAsync(
      "sudo",
      ["/usr/local/bin/remove-domain.sh", domain.hostname],
      { timeout: 30000 }
    );
    cleanupResult = JSON.parse(stdout.trim());
  } catch {
    // Cleanup failure is non-fatal — remove from DB regardless
    cleanupResult = null;
  }

  await dbRun("DELETE FROM domains WHERE id = ?", [id]);

  return NextResponse.json({ ok: true, cleanup: cleanupResult });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

interface DomainRow {
  id: string;
  hostname: string;
  is_primary: number;
  ssl_enabled: number;
  verified: number;
  added_at: string;
  notes: string | null;
}

function requireAdmin(email: string): boolean {
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
  if (!requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = db
    .prepare(
      "SELECT id, hostname, is_primary, ssl_enabled, verified, added_at, notes FROM domains ORDER BY added_at ASC"
    )
    .all() as DomainRow[];

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
  if (!requireAdmin(session.user.email)) {
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

  const existing = db
    .prepare("SELECT id FROM domains WHERE hostname = ?")
    .get(hostname);
  if (existing) {
    return NextResponse.json({ error: "Domain already exists" }, { status: 409 });
  }

  db.prepare(
    "INSERT INTO domains (hostname, notes) VALUES (?, ?)"
  ).run(hostname, body.notes ?? null);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!requireAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id query parameter" }, { status: 400 });
  }

  const domain = db.prepare("SELECT id FROM domains WHERE id = ?").get(id);
  if (!domain) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  db.prepare("DELETE FROM domains WHERE id = ?").run(id);

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbRun } from "@/lib/db";
import { broadcastToAll } from "@/lib/broadcast";

interface BotSettingsRow {
  name: string;
  tagline: string;
  avatar: string | null;
}

export async function GET(_request: NextRequest) {
  const row = await dbGet<BotSettingsRow>(
    "SELECT name, tagline, avatar FROM bot_settings WHERE id = 1"
  );

  const response: Record<string, unknown> = {
    name: row?.name ?? "Octoby AI",
    tagline: row?.tagline ?? "Your AI assistant",
    avatar: row?.avatar ?? null,
  };

  // Only expose projectRoot to authenticated users
  const session = await getServerSession(authOptions);
  if (session?.user) {
    response.projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? "";
  }

  return NextResponse.json(response);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; tagline?: string; avatar?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, tagline, avatar } = body;

  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }
  if (tagline !== undefined && typeof tagline !== "string") {
    return NextResponse.json({ error: "Invalid tagline" }, { status: 400 });
  }

  // Build partial update
  const updates: string[] = ["updated_at = datetime('now')"];
  const params: import("@libsql/client").InValue[] = [];

  if (name !== undefined) {
    updates.push("name = ?");
    params.push(name.trim());
  }
  if (tagline !== undefined) {
    updates.push("tagline = ?");
    params.push(tagline);
  }
  if (avatar !== undefined) {
    updates.push("avatar = ?");
    params.push(avatar);
  }

  await dbRun(
    `UPDATE bot_settings SET ${updates.join(", ")} WHERE id = 1`,
    params
  );

  const updated = await dbGet<BotSettingsRow>(
    "SELECT name, tagline, avatar FROM bot_settings WHERE id = 1"
  );

  // Broadcast to all connected clients so they update without page refresh
  broadcastToAll("bot:identity_updated", {
    name: updated?.name,
    tagline: updated?.tagline,
    avatar: updated?.avatar,
  });

  return NextResponse.json({ ok: true, ...updated });
}

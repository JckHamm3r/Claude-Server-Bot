import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbAll } from "@/lib/db";

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

  const entries = await dbAll<{ id: number; timestamp: string; event_type: string; user_email: string | null; details: string | null }>(
    "SELECT id, timestamp, event_type, user_email, details FROM activity_log ORDER BY timestamp DESC LIMIT ? OFFSET ?",
    [limit, offset]
  );

  const totalRow = await dbGet<{ total: number }>("SELECT COUNT(*) as total FROM activity_log");
  const total = totalRow?.total ?? 0;

  return NextResponse.json({ entries, total, offset, limit });
}

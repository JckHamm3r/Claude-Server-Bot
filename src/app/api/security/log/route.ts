import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
  const cursor = searchParams.get("cursor");

  let rows: { id: number; timestamp: string; event_type: string; user_email: string | null; details: string | null }[];

  if (cursor) {
    rows = db.prepare(`
      SELECT id, timestamp, event_type, user_email, details
      FROM activity_log
      WHERE event_type LIKE 'security_%' AND id < ?
      ORDER BY id DESC
      LIMIT ?
    `).all(parseInt(cursor, 10), limit) as typeof rows;
  } else {
    rows = db.prepare(`
      SELECT id, timestamp, event_type, user_email, details
      FROM activity_log
      WHERE event_type LIKE 'security_%'
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as typeof rows;
  }

  const nextCursor = rows.length === limit ? String(rows[rows.length - 1].id) : null;

  return NextResponse.json({ events: rows, nextCursor });
}

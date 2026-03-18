import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { dbGet, dbAll } from "@/lib/db";
import { searchMessages, searchSessionMessages } from "@/lib/claude-db";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return NextResponse.json({ results: [] });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);

  // Sanitize FTS5 query: wrap each word in quotes to prevent syntax errors
  const sanitized = q.trim().split(/\s+/).map(w => `"${w.replace(/"/g, '""')}"`).join(" ");

  const results = sessionId
    ? await searchSessionMessages(sessionId, sanitized, limit)
    : await searchMessages(sanitized, limit);

  // For non-admin users, filter results to only sessions they own or participate in
  const user = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [token.email]);
  if (!user?.is_admin && !sessionId) {
    const owned = await dbAll<{ id: string }>("SELECT id FROM sessions WHERE created_by = ?", [token.email]);
    const participating = await dbAll<{ session_id: string }>("SELECT session_id FROM session_participants WHERE user_email = ?", [token.email]);
    const userSessionIds = new Set([...owned.map(r => r.id), ...participating.map(r => r.session_id)]);
    const filtered = results.filter((r: { sessionId: string }) => userSessionIds.has(r.sessionId));
    return NextResponse.json({ results: filtered });
  }

  return NextResponse.json({ results });
}

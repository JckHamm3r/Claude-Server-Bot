import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
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
    ? searchSessionMessages(sessionId, sanitized, limit)
    : searchMessages(sanitized, limit);

  return NextResponse.json({ results });
}

import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import db from "@/lib/db";
import { getSession, getMessages } from "@/lib/claude-db";
import { exportToMarkdown, exportToJSON } from "@/lib/session-export";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const format = req.nextUrl.searchParams.get("format") ?? "markdown";

  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Check access: creator, admin, or session participant
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(token.email) as { is_admin: number } | undefined;
  if (session.created_by !== token.email && !user?.is_admin) {
    const participant = db.prepare("SELECT 1 FROM session_participants WHERE session_id = ? AND user_email = ?").get(sessionId, token.email);
    if (!participant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const messages = getMessages(sessionId);
  const sessionName = (session.name ?? "session").replace(/[^a-zA-Z0-9-_]/g, "_");

  if (format === "json") {
    const content = exportToJSON(session, messages);
    return new NextResponse(content, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${sessionName}.json"`,
      },
    });
  }

  const content = exportToMarkdown(session, messages);
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sessionName}.md"`,
    },
  });
}

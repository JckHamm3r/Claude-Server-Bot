import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { dbGet, dbAll, dbRun } from "@/lib/db";

interface NotificationRow {
  id: number;
  event_type: string;
  title: string;
  body: string;
  read: number;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);

  const notifications = await dbAll<NotificationRow>(
    "SELECT id, event_type, title, body, read, created_at FROM inapp_notifications WHERE user_email = ? ORDER BY id DESC LIMIT ?",
    [token.email as string, limit]
  );

  const unread = await dbGet<{ count: number }>(
    "SELECT COUNT(*) as count FROM inapp_notifications WHERE user_email = ? AND read = 0",
    [token.email as string]
  );

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      ...n,
      read: Boolean(n.read),
    })),
    unread: unread?.count ?? 0,
  });
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ids?: number[]; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.all) {
    await dbRun(
      "UPDATE inapp_notifications SET read = 1 WHERE user_email = ?",
      [token.email as string]
    );
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    const placeholders = body.ids.map(() => "?").join(",");
    await dbRun(
      `UPDATE inapp_notifications SET read = 1 WHERE user_email = ? AND id IN (${placeholders})`,
      [token.email as string, ...body.ids]
    );
  }

  return NextResponse.json({ ok: true });
}

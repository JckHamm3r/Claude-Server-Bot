import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { updateUserSettings } from "@/lib/claude-db";

function isHttps(): boolean {
  const url = process.env.NEXTAUTH_URL ?? "";
  return url.startsWith("https");
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!requester?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await updateUserSettings(session.user.email, { setup_complete: true });
  } catch (err) {
    console.error("[setup/complete] updateUserSettings failed:", err);
    return NextResponse.json({ error: "Setup completion failed" }, { status: 500 });
  }

  // Return response with cookie to signal setup is done
  const response = NextResponse.json({ ok: true });
  response.cookies.set("bot_setup_complete", "1", {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    secure: isHttps(),
  });
  return response;
}

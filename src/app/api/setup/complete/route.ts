import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbRun } from "@/lib/db";
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

  const requester = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );

  const isAdmin = Boolean(requester?.is_admin);

  try {
    await updateUserSettings(session.user.email, { setup_complete: true });
    await dbRun(
      "INSERT INTO app_settings (key, value) VALUES ('setup_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = datetime('now')"
    );
  } catch (err) {
    console.error("[setup/complete] updateUserSettings failed:", err);
    return NextResponse.json({ error: "Setup completion failed" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });

  if (isAdmin) {
    response.cookies.set("bot_setup_complete", "1", {
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: isHttps(),
    });
  }

  return response;
}

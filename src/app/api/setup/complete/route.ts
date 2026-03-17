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

  // The full setup wizard (API key, bot name, project dir) is admin-only.
  // Non-admin users should never reach this via the wizard, but if they somehow
  // do (e.g. direct URL navigation), mark them as complete so they aren't stuck.
  // Only admin users get the cookie that gates the global setup state.
  const isAdmin = Boolean(requester?.is_admin);

  try {
    await updateUserSettings(session.user.email, { setup_complete: true });
    // Set the global flag so all future admins are not re-prompted
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('setup_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = datetime('now')"
    ).run();
  } catch (err) {
    console.error("[setup/complete] updateUserSettings failed:", err);
    return NextResponse.json({ error: "Setup completion failed" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });

  // Set the long-lived cookie only for admins (it signals the global setup is done)
  if (isAdmin) {
    response.cookies.set("bot_setup_complete", "1", {
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: "lax",
      secure: isHttps(),
    });
  }

  return response;
}

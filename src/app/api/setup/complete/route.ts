import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { updateUserSettings } from "@/lib/claude-db";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await updateUserSettings(session.user.email, { setup_complete: true });

  // Return response with cookie to signal setup is done
  const response = NextResponse.json({ ok: true });
  response.cookies.set("bot_setup_complete", "1", {
    httpOnly: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
  });
  return response;
}

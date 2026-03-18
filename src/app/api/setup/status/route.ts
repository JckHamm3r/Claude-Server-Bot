import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [session.user.email]
  );

  if (!user?.is_admin) {
    return NextResponse.json({ needsSetup: false });
  }

  const row = await dbGet<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'setup_complete'"
  );

  const needsSetup = !row || row.value !== "true";
  return NextResponse.json({ needsSetup });
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;

  if (!user?.is_admin) {
    return NextResponse.json({ needsSetup: false });
  }

  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'").get() as
    | { value: string }
    | undefined;

  const needsSetup = !row || row.value !== "true";
  return NextResponse.json({ needsSetup });
}

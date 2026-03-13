import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { execSync } from "child_process";
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let database = false;
  try {
    db.prepare("SELECT 1").get();
    database = true;
  } catch {
    database = false;
  }

  let claudeProcess = false;
  try {
    execSync("which claude");
    claudeProcess = true;
  } catch {
    claudeProcess = false;
  }

  const socketServer = true;

  return NextResponse.json({ database, claudeProcess, socketServer });
}

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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let database = false;
  try {
    await dbGet("SELECT 1");
    database = true;
  } catch {
    database = false;
  }

  let apiKeyConfigured = false;
  try {
    const row = await dbGet<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'anthropic_api_key'"
    );
    apiKeyConfigured = !!(row?.value || process.env.ANTHROPIC_API_KEY);
  } catch {
    apiKeyConfigured = !!process.env.ANTHROPIC_API_KEY;
  }

  let sdkInstalled = false;
  try {
    require.resolve("@anthropic-ai/claude-agent-sdk");
    sdkInstalled = true;
  } catch {
    sdkInstalled = false;
  }

  const socketServer = true;

  return NextResponse.json({
    database,
    apiKeyConfigured,
    sdkInstalled,
    socketServer,
  });
}

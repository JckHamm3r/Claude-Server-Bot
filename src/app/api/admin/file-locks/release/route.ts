import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getFileLock } from "@/lib/claude-db";
import { releaseLock } from "@/lib/file-lock-manager";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "";

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request as never, secret: NEXTAUTH_SECRET });
    const isAdmin = Boolean((token as { isAdmin?: boolean })?.isAdmin);

    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { filePath } = body;

    if (!filePath) {
      return NextResponse.json({ error: "Missing filePath" }, { status: 400 });
    }

    // Get the lock to find the tool call ID
    const lock = getFileLock(filePath);

    if (!lock) {
      return NextResponse.json({ error: "Lock not found" }, { status: 404 });
    }

    // Release the lock and process queue
    await releaseLock(filePath, lock.tool_call_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[file-locks] Error releasing lock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

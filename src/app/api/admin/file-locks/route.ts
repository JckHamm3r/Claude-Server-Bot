import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAllActiveLocks } from "@/lib/claude-db";

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "";

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request as never, secret: NEXTAUTH_SECRET });
    const isAdmin = Boolean((token as { isAdmin?: boolean })?.isAdmin);

    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const locks = getAllActiveLocks();

    return NextResponse.json({ locks });
  } catch (error) {
    console.error("[file-locks] Error fetching locks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

// Prevent static prerendering so timestamp is always live
export const dynamic = "force-dynamic";

// Public health check endpoint (no auth required) — used by install.sh and monitoring
export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: Date.now() });
}

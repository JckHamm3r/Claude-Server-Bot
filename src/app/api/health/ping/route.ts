import { NextResponse } from "next/server";

// Public health check endpoint (no auth required) — used by install.sh and monitoring
export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: Date.now() });
}

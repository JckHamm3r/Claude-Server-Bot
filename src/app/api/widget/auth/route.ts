import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

interface BotSettingsRow {
  name: string;
}

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ authenticated: false }, { status: 401, headers });
  }

  const row = db
    .prepare("SELECT name FROM bot_settings WHERE id = 1")
    .get() as BotSettingsRow | undefined;

  return NextResponse.json({
    authenticated: true,
    name: row?.name ?? "Claude",
  }, { headers });
}

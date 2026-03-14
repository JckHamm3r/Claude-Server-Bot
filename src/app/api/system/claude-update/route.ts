import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { ok: false, output: "Claude CLI updates are no longer needed. The server uses the Anthropic SDK with an API key." },
    { status: 410 },
  );
}

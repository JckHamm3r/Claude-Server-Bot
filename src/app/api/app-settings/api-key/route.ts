import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";

const NEXTAUTH_COOKIE =
  (process.env.NEXTAUTH_URL ?? "").startsWith("https")
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";

async function requireAdmin(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? "",
    cookieName: NEXTAUTH_COOKIE,
    secureCookie: NEXTAUTH_COOKIE.startsWith("__Secure-"),
  });
  if (!token || !(token as Record<string, unknown>).isAdmin) {
    return null;
  }
  return token;
}

export async function GET(req: NextRequest) {
  const token = await requireAdmin(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const key = await getAppSetting("anthropic_api_key", "");
  // Return masked key for display
  const masked = key ? key.slice(0, 7) + "..." + key.slice(-4) : "";
  return NextResponse.json({ hasKey: !!key, maskedKey: masked });
}

export async function PUT(req: NextRequest) {
  const token = await requireAdmin(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: { apiKey?: string };
  try {
    body = (await req.json()) as { apiKey: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { apiKey } = body;
  if (typeof apiKey !== "string") {
    return NextResponse.json({ error: "Invalid API key" }, { status: 400 });
  }

  setAppSetting("anthropic_api_key", apiKey);

  // Update runtime env so SDK provider can use it immediately
  if (apiKey) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }

  const masked = apiKey ? apiKey.slice(0, 7) + "..." + apiKey.slice(-4) : "";
  return NextResponse.json({ success: true, hasKey: !!apiKey, maskedKey: masked });
}

export async function DELETE(req: NextRequest) {
  const token = await requireAdmin(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  setAppSetting("anthropic_api_key", "");
  delete process.env.ANTHROPIC_API_KEY;

  return NextResponse.json({ success: true, hasKey: false, maskedKey: "" });
}

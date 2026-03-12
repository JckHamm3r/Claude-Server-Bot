import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    guard_rails_enabled: getAppSetting("guard_rails_enabled", "true") === "true",
    sandbox_enabled: getAppSetting("sandbox_enabled", "true") === "true",
    ip_protection_enabled: getAppSetting("ip_protection_enabled", "true") === "true",
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as {
    guard_rails_enabled?: boolean;
    sandbox_enabled?: boolean;
    ip_protection_enabled?: boolean;
  };

  if (typeof body.guard_rails_enabled === "boolean") {
    setAppSetting("guard_rails_enabled", body.guard_rails_enabled ? "true" : "false");
  }
  if (typeof body.sandbox_enabled === "boolean") {
    setAppSetting("sandbox_enabled", body.sandbox_enabled ? "true" : "false");
  }
  if (typeof body.ip_protection_enabled === "boolean") {
    setAppSetting("ip_protection_enabled", body.ip_protection_enabled ? "true" : "false");
  }

  return NextResponse.json({ ok: true });
}

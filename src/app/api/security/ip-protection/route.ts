import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getBlockedIPs, getIPProtectionSettings } from "@/lib/ip-protection";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    settings: getIPProtectionSettings(),
    blockedIPs: getBlockedIPs(),
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as {
    ip_protection_enabled?: boolean;
    ip_max_attempts?: number;
    ip_window_minutes?: number;
    ip_block_duration_minutes?: number;
  };

  if (typeof body.ip_protection_enabled === "boolean") {
    setAppSetting("ip_protection_enabled", body.ip_protection_enabled ? "true" : "false");
  }
  if (typeof body.ip_max_attempts === "number") {
    if (body.ip_max_attempts < 1 || body.ip_max_attempts > 100) {
      return NextResponse.json({ error: "ip_max_attempts must be between 1 and 100" }, { status: 400 });
    }
    setAppSetting("ip_max_attempts", String(body.ip_max_attempts));
  }
  if (typeof body.ip_window_minutes === "number") {
    if (body.ip_window_minutes < 1 || body.ip_window_minutes > 1440) {
      return NextResponse.json({ error: "ip_window_minutes must be between 1 and 1440" }, { status: 400 });
    }
    setAppSetting("ip_window_minutes", String(body.ip_window_minutes));
  }
  if (typeof body.ip_block_duration_minutes === "number") {
    if (body.ip_block_duration_minutes < 1 || body.ip_block_duration_minutes > 10080) {
      return NextResponse.json({ error: "ip_block_duration_minutes must be between 1 and 10080" }, { status: 400 });
    }
    setAppSetting("ip_block_duration_minutes", String(body.ip_block_duration_minutes));
  }

  return NextResponse.json({
    ok: true,
    settings: {
      ip_protection_enabled: getAppSetting("ip_protection_enabled", "true") === "true",
      ip_max_attempts: parseInt(getAppSetting("ip_max_attempts", "5"), 10),
      ip_window_minutes: parseInt(getAppSetting("ip_window_minutes", "10"), 10),
      ip_block_duration_minutes: parseInt(getAppSetting("ip_block_duration_minutes", "60"), 10),
    },
  });
}

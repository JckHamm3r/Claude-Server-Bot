import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getBlockedIPs, getIPProtectionSettings, getApiAbuseSettings } from "@/lib/ip-protection";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";
import { getFail2BanSettings, getFail2BanStatus } from "@/lib/fail2ban";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fail2banStatus = getFail2BanStatus();

  return NextResponse.json({
    settings: getIPProtectionSettings(),
    apiAbuseSettings: getApiAbuseSettings(),
    fail2banSettings: getFail2BanSettings(),
    fail2banStatus,
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
    // API abuse settings
    api_abuse_protection_enabled?: boolean;
    api_abuse_max_requests?: number;
    api_abuse_window_seconds?: number;
    api_abuse_block_minutes?: number;
    // Fail2ban settings
    fail2ban_enabled?: boolean;
    fail2ban_jail?: string;
    fail2ban_sync_interval_seconds?: number;
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

  // API abuse settings
  if (typeof body.api_abuse_protection_enabled === "boolean") {
    setAppSetting("api_abuse_protection_enabled", body.api_abuse_protection_enabled ? "true" : "false");
  }
  if (typeof body.api_abuse_max_requests === "number") {
    if (body.api_abuse_max_requests < 10 || body.api_abuse_max_requests > 10000) {
      return NextResponse.json({ error: "api_abuse_max_requests must be between 10 and 10000" }, { status: 400 });
    }
    setAppSetting("api_abuse_max_requests", String(body.api_abuse_max_requests));
  }
  if (typeof body.api_abuse_window_seconds === "number") {
    if (body.api_abuse_window_seconds < 10 || body.api_abuse_window_seconds > 3600) {
      return NextResponse.json({ error: "api_abuse_window_seconds must be between 10 and 3600" }, { status: 400 });
    }
    setAppSetting("api_abuse_window_seconds", String(body.api_abuse_window_seconds));
  }
  if (typeof body.api_abuse_block_minutes === "number") {
    if (body.api_abuse_block_minutes < 1 || body.api_abuse_block_minutes > 10080) {
      return NextResponse.json({ error: "api_abuse_block_minutes must be between 1 and 10080" }, { status: 400 });
    }
    setAppSetting("api_abuse_block_minutes", String(body.api_abuse_block_minutes));
  }

  // Fail2ban settings
  if (typeof body.fail2ban_enabled === "boolean") {
    setAppSetting("fail2ban_enabled", body.fail2ban_enabled ? "true" : "false");
  }
  if (typeof body.fail2ban_jail === "string") {
    const jail = body.fail2ban_jail.trim();
    if (!jail || !/^[a-zA-Z0-9_-]+$/.test(jail)) {
      return NextResponse.json({ error: "Invalid jail name (alphanumeric, hyphens, underscores only)" }, { status: 400 });
    }
    setAppSetting("fail2ban_jail", jail);
  }
  if (typeof body.fail2ban_sync_interval_seconds === "number") {
    if (body.fail2ban_sync_interval_seconds < 10 || body.fail2ban_sync_interval_seconds > 3600) {
      return NextResponse.json({ error: "fail2ban_sync_interval_seconds must be between 10 and 3600" }, { status: 400 });
    }
    setAppSetting("fail2ban_sync_interval_seconds", String(body.fail2ban_sync_interval_seconds));
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

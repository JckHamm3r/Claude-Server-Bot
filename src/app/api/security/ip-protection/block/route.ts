import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { blockIP } from "@/lib/ip-protection";
import { logActivity } from "@/lib/activity-log";
import { getAppSetting } from "@/lib/app-settings";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as {
    ip: string;
    reason?: string;
    type?: "temporary" | "permanent";
    durationMinutes?: number;
  };

  if (!body.ip) {
    return NextResponse.json({ error: "ip is required" }, { status: 400 });
  }

  const blockType = body.type ?? "temporary";
  const duration = body.durationMinutes ?? parseInt(getAppSetting("ip_block_duration_minutes", "60"), 10);
  const reason = body.reason ?? "Manually blocked by admin";

  blockIP(body.ip, reason, blockType, duration, session.user.email);
  logActivity("security_manual_ip_block", session.user.email, { ip: body.ip, reason, type: blockType });

  return NextResponse.json({ ok: true });
}

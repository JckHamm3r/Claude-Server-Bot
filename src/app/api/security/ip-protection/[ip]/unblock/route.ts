import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { unblockIP } from "@/lib/ip-protection";
import { logActivity } from "@/lib/activity-log";

export async function POST(
  _request: Request,
  { params }: { params: { ip: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = decodeURIComponent(params.ip);
  unblockIP(ip);
  logActivity("security_ip_unblocked", session.user.email, { ip });

  return NextResponse.json({ ok: true });
}

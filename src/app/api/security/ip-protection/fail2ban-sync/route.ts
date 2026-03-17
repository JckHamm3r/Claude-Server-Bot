import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { syncFail2BanBans } from "@/lib/ip-protection";
import { getFail2BanStatus } from "@/lib/fail2ban";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getFail2BanStatus();
  if (!status.available) {
    return NextResponse.json({ error: "fail2ban is not installed on this server" }, { status: 400 });
  }
  if (!status.running) {
    return NextResponse.json({ error: "fail2ban service is not running" }, { status: 400 });
  }
  if (!status.jailExists) {
    return NextResponse.json({ error: `Jail '${status.jailName}' does not exist in fail2ban` }, { status: 400 });
  }

  const result = syncFail2BanBans();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getFail2BanStatus();
  return NextResponse.json(status);
}

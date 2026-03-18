import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbAll } from "@/lib/db";
import {
  findSecurityGroupsMatchingIP,
  findUsersBlockedByIP,
  getUserEffectiveAllowedIPs,
} from "@/lib/claude-db";
import { isIPInAllowList, validateIPOrCIDR } from "@/lib/ip-allowlist";

async function isAdmin(email: string): Promise<boolean> {
  const row = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [email]);
  return Boolean(row?.is_admin);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { ip: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { ip } = body;
  if (!ip || typeof ip !== "string") {
    return NextResponse.json({ error: "Missing ip" }, { status: 400 });
  }

  const validation = validateIPOrCIDR(ip.trim());
  if (!validation.valid) {
    return NextResponse.json({ error: `Invalid IP: ${validation.error}` }, { status: 400 });
  }

  const normalizedIP = ip.trim();

  const matchingGroups = await findSecurityGroupsMatchingIP(normalizedIP);
  const blockedUsers = await findUsersBlockedByIP(normalizedIP);

  const allUsers = await dbAll<{ email: string; first_name: string; last_name: string; allowed_ips: string | null }>(`
    SELECT u.email, u.first_name, u.last_name, u.allowed_ips
    FROM users u
  `);

  const userResults = await Promise.all(allUsers.map(async (u) => {
    const allowedIPs = await getUserEffectiveAllowedIPs(u.email);
    if (allowedIPs.length === 0) {
      return { email: u.email, first_name: u.first_name, last_name: u.last_name, restricted: false, allowed: true };
    }
    return {
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      restricted: true,
      allowed: isIPInAllowList(normalizedIP, allowedIPs),
    };
  }));

  return NextResponse.json({
    ip: normalizedIP,
    matching_groups: matchingGroups,
    blocked_users: blockedUsers,
    user_results: userResults,
  });
}

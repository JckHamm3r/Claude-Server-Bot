import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { findSecurityGroupsMatchingIP, findUsersBlockedByIP } from "@/lib/claude-db";
import { isIPInAllowList, validateIPOrCIDR } from "@/lib/ip-allowlist";

function isAdmin(email: string): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(email) as { is_admin: number } | undefined;
  return Boolean(row?.is_admin);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  // Security groups that would allow this IP
  const matchingGroups = findSecurityGroupsMatchingIP(normalizedIP);

  // Users who would be BLOCKED by this IP
  const blockedUsers = findUsersBlockedByIP(normalizedIP);

  // All users with restrictions and whether this IP would be allowed
  const allUsers = db.prepare(`
    SELECT u.email, u.first_name, u.last_name, u.allowed_ips
    FROM users u
  `).all() as Array<{ email: string; first_name: string; last_name: string; allowed_ips: string | null }>;

  const { getUserEffectiveAllowedIPs } = await import("@/lib/claude-db");
  const userResults = allUsers.map((u) => {
    const allowedIPs = getUserEffectiveAllowedIPs(u.email);
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
  });

  return NextResponse.json({
    ip: normalizedIP,
    matching_groups: matchingGroups,
    blocked_users: blockedUsers,
    user_results: userResults,
  });
}

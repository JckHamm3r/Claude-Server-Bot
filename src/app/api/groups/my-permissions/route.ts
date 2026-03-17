import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserGroupPermissions, DEFAULT_GROUP_PERMISSIONS } from "@/lib/claude-db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if ((session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ permissions: DEFAULT_GROUP_PERMISSIONS, isAdmin: true });
  }

  const permissions = getUserGroupPermissions(session.user.email);
  return NextResponse.json({ permissions, isAdmin: false });
}

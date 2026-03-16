import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requester = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as
    | { is_admin: number }
    | undefined;
  if (!requester?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { first_name?: string; last_name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const firstName = (body.first_name ?? "").trim();
  const lastName = (body.last_name ?? "").trim();

  if (!firstName) {
    return NextResponse.json({ error: "First name is required" }, { status: 400 });
  }

  db.prepare("UPDATE users SET first_name = ?, last_name = ? WHERE email = ?")
    .run(firstName, lastName, session.user.email);

  return NextResponse.json({ ok: true, first_name: firstName, last_name: lastName });
}

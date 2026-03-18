import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { sendMail } from "@/lib/smtp";

async function requireAdmin(email: string): Promise<boolean> {
  const user = await dbGet<{ is_admin: number }>(
    "SELECT is_admin FROM users WHERE email = ?",
    [email]
  );
  return Boolean(user?.is_admin);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await requireAdmin(session.user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = body.to?.trim();
  if (!to) {
    return NextResponse.json({ error: "Missing recipient email" }, { status: 400 });
  }

  try {
    await sendMail(
      to,
      "Octoby AI – SMTP Test",
      `<p>This is a test email from <strong>Octoby AI</strong>.</p>
       <p>If you received this, your SMTP configuration is working correctly.</p>
       <p style="color:#888;font-size:12px;">Sent at ${new Date().toISOString()}</p>`
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[smtp/test] SMTP test failed:", err);
    return NextResponse.json({ error: "SMTP connection test failed" }, { status: 500 });
  }
}

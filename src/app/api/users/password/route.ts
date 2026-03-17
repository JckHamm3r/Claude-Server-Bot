import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import bcrypt from "bcrypt";
import { logActivity } from "@/lib/activity-log";

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 12) {
    return { valid: false, error: "Password must be at least 12 characters long" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one uppercase letter" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one lowercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain at least one number" };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, error: "Password must contain at least one special character" };
  }
  return { valid: true };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = session.user.email;
    const body = await req.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required" },
        { status: 400 }
      );
    }

    const user = db.prepare("SELECT hash FROM users WHERE email = ?").get(email) as
      | { hash: string }
      | undefined;

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const validCurrent = await bcrypt.compare(currentPassword, user.hash);
    if (!validCurrent) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    db.prepare("UPDATE users SET hash = ?, must_change_password = 0 WHERE email = ?").run(
      newHash,
      email
    );

    logActivity("user_password_changed", email);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[password] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

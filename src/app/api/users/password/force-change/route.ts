import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbGet, dbRun } from "@/lib/db";
import bcrypt from "bcryptjs";
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
    const { newPassword } = body;

    if (!newPassword) {
      return NextResponse.json({ error: "New password is required" }, { status: 400 });
    }

    const user = await dbGet<{ must_change_password: number }>(
      "SELECT must_change_password FROM users WHERE email = ?",
      [email]
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.must_change_password) {
      return NextResponse.json({ error: "Password change not required" }, { status: 400 });
    }

    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await dbRun(
      "UPDATE users SET hash = ?, must_change_password = 0 WHERE email = ?",
      [newHash, email]
    );

    await logActivity("user_password_changed", email, { reason: "forced" });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[force-change] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

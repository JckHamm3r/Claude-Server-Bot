import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getUserSettings, updateUserSettings } from "@/lib/claude-db";
import { applyProfileToClaudeMd } from "@/lib/user-profile-context";
import db from "@/lib/db";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = getUserSettings(token.email as string);
  return NextResponse.json({
    experience_level: settings.experience_level,
    server_purposes: settings.server_purposes,
    project_type: settings.project_type,
    auto_summary: settings.auto_summary,
    profile_wizard_complete: settings.profile_wizard_complete,
  });
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    experience_level?: string;
    server_purposes?: string[];
    project_type?: string;
    auto_summary?: boolean;
    profile_wizard_complete?: boolean;
    update_claude_md?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const email = token.email as string;

  // Check if the user is an admin
  const userRow = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(email) as { is_admin: number } | undefined;
  const isAdmin = Boolean(userRow?.is_admin);

  // Only admins can change experience_level
  if (body.experience_level !== undefined && !isAdmin) {
    return NextResponse.json({ error: "Experience level can only be changed by an admin" }, { status: 403 });
  }

  // Validate experience_level if provided
  const validLevels = ["beginner", "intermediate", "expert"];
  if (body.experience_level && !validLevels.includes(body.experience_level)) {
    return NextResponse.json({ error: "Invalid experience_level" }, { status: 400 });
  }

  const updated = updateUserSettings(email, {
    ...(body.experience_level !== undefined && { experience_level: body.experience_level }),
    ...(body.server_purposes !== undefined && { server_purposes: body.server_purposes }),
    ...(body.project_type !== undefined && { project_type: body.project_type }),
    ...(body.auto_summary !== undefined && { auto_summary: body.auto_summary }),
    ...(body.profile_wizard_complete !== undefined && { profile_wizard_complete: body.profile_wizard_complete }),
  });

  // Optionally update CLAUDE.md with the new profile context
  if (body.update_claude_md !== false) {
    try {
      await applyProfileToClaudeMd(updated);
    } catch (err) {
      console.warn("[profile] Failed to update CLAUDE.md:", err);
    }
  }

  return NextResponse.json({ ok: true, profile: {
    experience_level: updated.experience_level,
    server_purposes: updated.server_purposes,
    project_type: updated.project_type,
    auto_summary: updated.auto_summary,
    profile_wizard_complete: updated.profile_wizard_complete,
  }});
}

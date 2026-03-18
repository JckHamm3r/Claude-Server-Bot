import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getUserSettings, updateUserSettings } from "@/lib/claude-db";
import { applyProfileToClaudeMd } from "@/lib/user-profile-context";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET ?? "" });
  if (!token?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getUserSettings(token.email as string);
  return NextResponse.json({
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
    server_purposes?: string[];
    project_type?: string;
    auto_summary?: boolean;
    profile_wizard_complete?: boolean;
    update_claude_md?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const email = token.email as string;

  const updated = await updateUserSettings(email, {
    ...(body.server_purposes !== undefined && { server_purposes: body.server_purposes }),
    ...(body.project_type !== undefined && { project_type: body.project_type }),
    ...(body.auto_summary !== undefined && { auto_summary: body.auto_summary }),
    ...(body.profile_wizard_complete !== undefined && { profile_wizard_complete: body.profile_wizard_complete }),
  });

  if (body.update_claude_md !== false) {
    try {
      await applyProfileToClaudeMd(updated);
    } catch (err) {
      console.warn("[profile] Failed to update CLAUDE.md:", err);
    }
  }

  return NextResponse.json({ ok: true, profile: {
    server_purposes: updated.server_purposes,
    project_type: updated.project_type,
    auto_summary: updated.auto_summary,
    profile_wizard_complete: updated.profile_wizard_complete,
  }});
}

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";
import { SAFE_COMMANDS, RESTRICTED_COMMANDS, DANGEROUS_PATTERNS } from "@/lib/command-sandbox";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let alwaysAllowed: string[] = [];
  let alwaysBlocked: string[] = [];
  try { alwaysAllowed = JSON.parse(await getAppSetting("sandbox_always_allowed", "[]")); } catch { /* ignore */ }
  try { alwaysBlocked = JSON.parse(await getAppSetting("sandbox_always_blocked", "[]")); } catch { /* ignore */ }

  return NextResponse.json({
    enabled: await getAppSetting("sandbox_enabled", "true") === "true",
    safeCommands: SAFE_COMMANDS,
    restrictedCommands: RESTRICTED_COMMANDS,
    dangerousPatterns: DANGEROUS_PATTERNS,
    alwaysAllowed,
    alwaysBlocked,
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as {
    enabled?: boolean;
    alwaysAllowed?: string[];
    alwaysBlocked?: string[];
    addAlwaysAllowed?: string;
    removeAlwaysAllowed?: string;
    addAlwaysBlocked?: string;
    removeAlwaysBlocked?: string;
  };

  if (typeof body.enabled === "boolean") {
    await setAppSetting("sandbox_enabled", body.enabled ? "true" : "false");
  }

  if (Array.isArray(body.alwaysAllowed)) {
    await setAppSetting("sandbox_always_allowed", JSON.stringify(body.alwaysAllowed));
    await logActivity("security_command_policy_changed", session.user.email, { action: "always_allowed_updated" });
  }
  if (Array.isArray(body.alwaysBlocked)) {
    await setAppSetting("sandbox_always_blocked", JSON.stringify(body.alwaysBlocked));
    await logActivity("security_command_policy_changed", session.user.email, { action: "always_blocked_updated" });
  }

  // Add/remove individual patterns
  if (body.addAlwaysAllowed) {
    const current: string[] = JSON.parse(await getAppSetting("sandbox_always_allowed", "[]"));
    if (!current.includes(body.addAlwaysAllowed)) {
      current.push(body.addAlwaysAllowed);
      await setAppSetting("sandbox_always_allowed", JSON.stringify(current));
      await logActivity("security_command_policy_changed", session.user.email, { action: "always_allow_added", pattern: body.addAlwaysAllowed });
    }
  }
  if (body.removeAlwaysAllowed) {
    const current: string[] = JSON.parse(await getAppSetting("sandbox_always_allowed", "[]"));
    const updated = current.filter((p) => p !== body.removeAlwaysAllowed);
    await setAppSetting("sandbox_always_allowed", JSON.stringify(updated));
    await logActivity("security_command_policy_changed", session.user.email, { action: "always_allow_removed", pattern: body.removeAlwaysAllowed });
  }
  if (body.addAlwaysBlocked) {
    const current: string[] = JSON.parse(await getAppSetting("sandbox_always_blocked", "[]"));
    if (!current.includes(body.addAlwaysBlocked)) {
      current.push(body.addAlwaysBlocked);
      await setAppSetting("sandbox_always_blocked", JSON.stringify(current));
      await logActivity("security_command_policy_changed", session.user.email, { action: "always_blocked_added", pattern: body.addAlwaysBlocked });
    }
  }
  if (body.removeAlwaysBlocked) {
    const current: string[] = JSON.parse(await getAppSetting("sandbox_always_blocked", "[]"));
    const updated = current.filter((p) => p !== body.removeAlwaysBlocked);
    await setAppSetting("sandbox_always_blocked", JSON.stringify(updated));
    await logActivity("security_command_policy_changed", session.user.email, { action: "always_blocked_removed", pattern: body.removeAlwaysBlocked });
  }

  return NextResponse.json({ ok: true });
}

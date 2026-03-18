import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dbAll, dbRun } from "@/lib/db";

// Canonical set of notification event types — must match NotificationEventType
// in src/lib/notifications.ts.
const EVENT_TYPES: { event_type: string; label: string }[] = [
  { event_type: "plan_completed", label: "Plan completed" },
  { event_type: "plan_failed", label: "Plan failed" },
  { event_type: "command_error", label: "Command error" },
  { event_type: "session_limit_reached", label: "Session limit reached" },
  { event_type: "user_added", label: "User added" },
  { event_type: "user_removed", label: "User removed" },
  { event_type: "kill_all_triggered", label: "Kill-all triggered" },
  { event_type: "backup_created", label: "Backup created" },
  { event_type: "backup_failed", label: "Backup failed" },
  { event_type: "domain_changed", label: "Domain changed" },
  { event_type: "smtp_configured", label: "SMTP configured" },
  { event_type: "claude_offline", label: "Claude offline" },
  { event_type: "claude_recovered", label: "Claude recovered" },
  { event_type: "high_cpu", label: "High CPU usage" },
  { event_type: "high_ram", label: "High RAM usage" },
  { event_type: "low_disk", label: "Low disk space" },
  { event_type: "update_completed", label: "Update completed" },
  { event_type: "update_failed", label: "Update failed" },
  { event_type: "security_prompt_injection_detected", label: "Prompt injection detected" },
  { event_type: "security_ip_blocked", label: "IP blocked — brute force" },
];

interface PrefRow {
  event_type: string;
  email_enabled: number;
  inapp_enabled: number;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userEmail = session.user.email;

  const rows = await dbAll<PrefRow>(
    "SELECT event_type, email_enabled, inapp_enabled FROM notification_preferences WHERE user_email = ?",
    [userEmail]
  );

  const prefMap: Record<string, PrefRow> = {};
  for (const row of rows) {
    prefMap[row.event_type] = row;
  }

  const preferences = EVENT_TYPES.map(({ event_type, label }) => {
    const saved = prefMap[event_type];
    return {
      event_type,
      label,
      email_enabled: saved ? Boolean(saved.email_enabled) : false,
      inapp_enabled: saved ? Boolean(saved.inapp_enabled) : false,
    };
  });

  return NextResponse.json({ preferences });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userEmail = session.user.email;

  let body: {
    preferences?: {
      event_type: string;
      email_enabled: boolean;
      inapp_enabled: boolean;
    }[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.preferences)) {
    return NextResponse.json({ error: "Missing preferences array" }, { status: 400 });
  }

  for (const pref of body.preferences) {
    await dbRun(
      `INSERT INTO notification_preferences (user_email, event_type, email_enabled, inapp_enabled, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_email, event_type) DO UPDATE SET
         email_enabled = excluded.email_enabled,
         inapp_enabled = excluded.inapp_enabled,
         updated_at = excluded.updated_at`,
      [userEmail, pref.event_type, pref.email_enabled ? 1 : 0, pref.inapp_enabled ? 1 : 0]
    );
  }

  return NextResponse.json({ ok: true });
}

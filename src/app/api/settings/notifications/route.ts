import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";

// Canonical set of notification event types with human-readable labels.
const EVENT_TYPES: { event_type: string; label: string }[] = [
  { event_type: "session_started", label: "Session started" },
  { event_type: "session_completed", label: "Session completed" },
  { event_type: "session_error", label: "Session error" },
  { event_type: "plan_ready", label: "Plan ready for review" },
  { event_type: "plan_approved", label: "Plan approved" },
  { event_type: "plan_rejected", label: "Plan rejected" },
  { event_type: "agent_status_changed", label: "Agent status changed" },
  { event_type: "system_alert", label: "System alert" },
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

  const rows = db
    .prepare(
      "SELECT event_type, email_enabled, inapp_enabled FROM notification_preferences WHERE user_email = ?"
    )
    .all(userEmail) as PrefRow[];

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

  const upsert = db.prepare(
    `INSERT INTO notification_preferences (user_email, event_type, email_enabled, inapp_enabled, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_email, event_type) DO UPDATE SET
       email_enabled = excluded.email_enabled,
       inapp_enabled = excluded.inapp_enabled,
       updated_at = excluded.updated_at`
  );

  const upsertAll = db.transaction(
    (
      prefs: { event_type: string; email_enabled: boolean; inapp_enabled: boolean }[]
    ) => {
      for (const pref of prefs) {
        upsert.run(
          userEmail,
          pref.event_type,
          pref.email_enabled ? 1 : 0,
          pref.inapp_enabled ? 1 : 0
        );
      }
    }
  );

  upsertAll(body.preferences);

  return NextResponse.json({ ok: true });
}

import { dbGet, dbAll, dbRun } from "./db";
import { sendMail } from "./smtp";

export type NotificationEventType =
  | "plan_completed"
  | "plan_failed"
  | "command_error"
  | "session_limit_reached"
  | "session_invited"
  | "user_added"
  | "user_removed"
  | "kill_all_triggered"
  | "backup_created"
  | "backup_failed"
  | "domain_changed"
  | "smtp_configured"
  | "claude_offline"
  | "claude_recovered"
  | "high_cpu"
  | "high_ram"
  | "low_disk"
  | "update_completed"
  | "update_failed"
  | "security_prompt_injection_detected"
  | "security_ip_blocked"
  | "job_completed"
  | "job_failed";

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  plan_completed: "Plan completed",
  plan_failed: "Plan failed",
  command_error: "Command error",
  session_limit_reached: "Session limit reached",
  session_invited: "Invited to session",
  user_added: "User added",
  user_removed: "User removed",
  kill_all_triggered: "Kill-all triggered",
  backup_created: "Backup created",
  backup_failed: "Backup failed",
  domain_changed: "Domain changed",
  smtp_configured: "SMTP configured",
  claude_offline: "Claude offline",
  claude_recovered: "Claude recovered",
  high_cpu: "High CPU usage",
  high_ram: "High RAM usage",
  low_disk: "Low disk space",
  update_completed: "Update completed",
  update_failed: "Update failed",
  security_prompt_injection_detected: "Prompt injection detected",
  security_ip_blocked: "IP blocked — brute force",
  job_completed: "Job completed",
  job_failed: "Job failed",
};

export interface InAppNotification {
  id: number;
  user_email: string;
  event_type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export interface NotificationPreference {
  event_type: NotificationEventType;
  label: string;
  email_enabled: boolean;
  inapp_enabled: boolean;
}

// ── Emitter hook (set by socket/handlers.ts to push real-time events) ────────

type NotificationEmitter = (email: string, notification: InAppNotification) => void;
let notificationEmitter: NotificationEmitter | null = null;

export function setNotificationEmitter(fn: NotificationEmitter): void {
  notificationEmitter = fn;
}

// ── Core dispatch ──────────────────────────────────────────────────────────

export async function dispatchNotification(
  event_type: NotificationEventType,
  recipientEmail: string,
  title: string,
  body: string,
): Promise<void> {
  const pref = await dbGet<{ email_enabled: number; inapp_enabled: number }>(
    "SELECT email_enabled, inapp_enabled FROM notification_preferences WHERE user_email = ? AND event_type = ?",
    [recipientEmail, event_type]
  );

  const emailEnabled = Boolean(pref?.email_enabled ?? 0);
  const inappEnabled = Boolean(pref?.inapp_enabled ?? 0);

  if (inappEnabled) {
    const row = await dbGet<{
      id: number; user_email: string; event_type: string; title: string; body: string; read: number; created_at: string;
    }>(
      "INSERT INTO inapp_notifications (user_email, event_type, title, body) VALUES (?, ?, ?, ?) RETURNING *",
      [recipientEmail, event_type, title, body]
    );

    if (row) {
      const notification: InAppNotification = { ...row, read: Boolean(row.read) };
      await purgeOldInAppNotifications(recipientEmail);
      if (notificationEmitter) {
        notificationEmitter(recipientEmail, notification);
      }
    }
  }

  if (emailEnabled) {
    const html = `<h2>${title}</h2><p>${body}</p><hr><p style="color:#888;font-size:12px">Octoby AI Notification</p>`;
    await sendMail(recipientEmail, `[Octoby AI] ${title}`, html).catch(() => {});
  }
}

export async function purgeOldInAppNotifications(userEmail: string): Promise<void> {
  await dbRun(`
    DELETE FROM inapp_notifications
    WHERE user_email = ?
    AND id NOT IN (
      SELECT id FROM inapp_notifications
      WHERE user_email = ?
      ORDER BY id DESC
      LIMIT 15
    )
  `, [userEmail, userEmail]);
}

export async function getInAppNotifications(userEmail: string): Promise<InAppNotification[]> {
  const rows = await dbAll<{ id: number; user_email: string; event_type: string; title: string; body: string; read: number; created_at: string }>(
    "SELECT * FROM inapp_notifications WHERE user_email = ? ORDER BY id DESC",
    [userEmail]
  );
  return rows.map((r) => ({ ...r, read: Boolean(r.read) }));
}

export async function getUnreadCount(userEmail: string): Promise<number> {
  const row = await dbGet<{ count: number }>(
    "SELECT COUNT(*) as count FROM inapp_notifications WHERE user_email = ? AND read = 0",
    [userEmail]
  );
  return row?.count ?? 0;
}

export async function markNotificationsRead(userEmail: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await dbRun(
    `UPDATE inapp_notifications SET read = 1 WHERE user_email = ? AND id IN (${placeholders})`,
    [userEmail, ...ids]
  );
}

export async function markAllNotificationsRead(userEmail: string): Promise<void> {
  await dbRun("UPDATE inapp_notifications SET read = 1 WHERE user_email = ?", [userEmail]);
}

export async function getNotificationPreferences(userEmail: string): Promise<NotificationPreference[]> {
  const rows = await dbAll<{ event_type: string; email_enabled: number; inapp_enabled: number }>(
    "SELECT event_type, email_enabled, inapp_enabled FROM notification_preferences WHERE user_email = ?",
    [userEmail]
  );

  const existing = new Map(rows.map((r) => [r.event_type, r]));

  return (Object.keys(NOTIFICATION_EVENT_LABELS) as NotificationEventType[]).map((event_type) => {
    const row = existing.get(event_type);
    return {
      event_type,
      label: NOTIFICATION_EVENT_LABELS[event_type],
      email_enabled: Boolean(row?.email_enabled ?? 0),
      inapp_enabled: Boolean(row?.inapp_enabled ?? 0),
    };
  });
}

export async function setNotificationPreference(
  userEmail: string,
  event_type: string,
  email_enabled: boolean,
  inapp_enabled: boolean,
): Promise<void> {
  await dbRun(`
    INSERT INTO notification_preferences (user_email, event_type, email_enabled, inapp_enabled, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_email, event_type) DO UPDATE SET
      email_enabled = excluded.email_enabled,
      inapp_enabled = excluded.inapp_enabled,
      updated_at    = excluded.updated_at
  `, [userEmail, event_type, email_enabled ? 1 : 0, inapp_enabled ? 1 : 0]);
}

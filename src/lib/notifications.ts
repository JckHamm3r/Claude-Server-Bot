import db from "./db";
import { sendMail } from "./smtp";

export type NotificationEventType =
  | "plan_completed"
  | "plan_failed"
  | "command_error"
  | "session_limit_reached"
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
  | "security_ip_blocked";

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  plan_completed: "Plan completed",
  plan_failed: "Plan failed",
  command_error: "Command error",
  session_limit_reached: "Session limit reached",
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
  // Check preferences
  const pref = db.prepare(
    "SELECT email_enabled, inapp_enabled FROM notification_preferences WHERE user_email = ? AND event_type = ?"
  ).get(recipientEmail, event_type) as { email_enabled: number; inapp_enabled: number } | undefined;

  const emailEnabled = Boolean(pref?.email_enabled ?? 0);
  const inappEnabled = Boolean(pref?.inapp_enabled ?? 0);

  // In-app notification
  if (inappEnabled) {
    const row = db.prepare(
      "INSERT INTO inapp_notifications (user_email, event_type, title, body) VALUES (?, ?, ?, ?) RETURNING *"
    ).get(recipientEmail, event_type, title, body) as {
      id: number; user_email: string; event_type: string; title: string; body: string; read: number; created_at: string;
    };

    const notification: InAppNotification = { ...row, read: Boolean(row.read) };

    // Purge to keep only 15 most recent
    purgeOldInAppNotifications(recipientEmail);

    // Real-time push
    if (notificationEmitter) {
      notificationEmitter(recipientEmail, notification);
    }
  }

  // Email notification
  if (emailEnabled) {
    const html = `<h2>${title}</h2><p>${body}</p><hr><p style="color:#888;font-size:12px">Octoby AI Notification</p>`;
    await sendMail(recipientEmail, `[Octoby AI] ${title}`, html).catch(() => {});
  }
}

export function purgeOldInAppNotifications(userEmail: string): void {
  db.prepare(`
    DELETE FROM inapp_notifications
    WHERE user_email = ?
    AND id NOT IN (
      SELECT id FROM inapp_notifications
      WHERE user_email = ?
      ORDER BY id DESC
      LIMIT 15
    )
  `).run(userEmail, userEmail);
}

// ── Query helpers ─────────────────────────────────────────────────────────

export function getInAppNotifications(userEmail: string): InAppNotification[] {
  const rows = db.prepare(
    "SELECT * FROM inapp_notifications WHERE user_email = ? ORDER BY id DESC"
  ).all(userEmail) as { id: number; user_email: string; event_type: string; title: string; body: string; read: number; created_at: string }[];
  return rows.map((r) => ({ ...r, read: Boolean(r.read) }));
}

export function getUnreadCount(userEmail: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM inapp_notifications WHERE user_email = ? AND read = 0"
  ).get(userEmail) as { count: number };
  return row.count;
}

export function markNotificationsRead(userEmail: string, ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE inapp_notifications SET read = 1 WHERE user_email = ? AND id IN (${placeholders})`
  ).run(userEmail, ...ids);
}

export function markAllNotificationsRead(userEmail: string): void {
  db.prepare("UPDATE inapp_notifications SET read = 1 WHERE user_email = ?").run(userEmail);
}

// ── Preferences ──────────────────────────────────────────────────────────

export function getNotificationPreferences(userEmail: string): NotificationPreference[] {
  const rows = db.prepare(
    "SELECT event_type, email_enabled, inapp_enabled FROM notification_preferences WHERE user_email = ?"
  ).all(userEmail) as { event_type: string; email_enabled: number; inapp_enabled: number }[];

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

export function setNotificationPreference(
  userEmail: string,
  event_type: string,
  email_enabled: boolean,
  inapp_enabled: boolean,
): void {
  db.prepare(`
    INSERT INTO notification_preferences (user_email, event_type, email_enabled, inapp_enabled, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_email, event_type) DO UPDATE SET
      email_enabled = excluded.email_enabled,
      inapp_enabled = excluded.inapp_enabled,
      updated_at    = excluded.updated_at
  `).run(userEmail, event_type, email_enabled ? 1 : 0, inapp_enabled ? 1 : 0);
}

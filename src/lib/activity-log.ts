import db from "./db";

export type ActivityEventType =
  | "user_login"
  | "user_logout"
  | "command_executed"
  | "agent_created"
  | "agent_executed"
  | "plan_created"
  | "plan_executed"
  | "project_changed"
  | "user_added"
  | "user_removed"
  | "kill_all"
  | "factory_reset"
  | "backup_created"
  | "backup_restored"
  | "domain_added"
  | "domain_removed"
  | "domain_primary_changed"
  | "certbot_run"
  | "smtp_saved"
  | "smtp_test_sent"
  | "customization_session_started"
  | "notification_preference_updated"
  | "security_mod_blocked"
  | "security_prompt_injection_detected"
  | "security_failed_login"
  | "security_ip_blocked"
  | "security_ip_unblocked"
  | "security_manual_ip_block"
  | "security_command_blocked"
  | "security_command_policy_changed"
  | "app_setting_changed"
  | "user_avatar_changed"
  | "user_password_changed";

export function logActivity(
  event_type: ActivityEventType,
  user_email: string | null,
  details?: object
): void {
  try {
    db.prepare(
      "INSERT INTO activity_log (event_type, user_email, details) VALUES (?, ?, ?)"
    ).run(event_type, user_email ?? null, details ? JSON.stringify(details) : null);
  } catch (err) {
    console.error("[activity-log] failed to log:", err);
  }
}

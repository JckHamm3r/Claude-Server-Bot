# Notifications

Two-channel notification system for alerting users about system events: in-app (real-time push via Socket.IO) and email (via SMTP).

## Channels

| Channel | Delivery | Requires |
|---------|----------|----------|
| In-app | Instant push via Socket.IO | Nothing (always available) |
| Email | SMTP delivery | SMTP configured in Settings |

## Event Types

| Event | Description |
|-------|-------------|
| `plan_completed` | A plan finished all steps successfully |
| `plan_failed` | A plan step failed |
| `command_error` | A command execution error occurred |
| `session_limit_reached` | Concurrent session limit hit |
| `user_added` | A new user was created |
| `user_removed` | A user was deleted |
| `kill_all_triggered` | All sessions were killed |
| `backup_created` | Database backup completed |
| `backup_failed` | Database backup failed |
| `domain_changed` | Custom domain was updated |
| `smtp_configured` | SMTP settings were saved |
| `claude_offline` | Claude SDK became unreachable |
| `claude_recovered` | Claude SDK reconnected |
| `high_cpu` | CPU usage exceeded threshold |
| `high_ram` | Memory usage exceeded threshold |
| `low_disk` | Disk space below threshold |
| `update_completed` | Application update succeeded |
| `update_failed` | Application update failed |
| `security_prompt_injection_detected` | A potential prompt injection was detected |
| `security_ip_blocked` | An IP was auto-blocked for failed login attempts |

## Per-User Preferences

Each user can enable or disable notifications for each event type on each channel independently. Preferences are managed in Settings > Notifications.

## SMTP Configuration

Email notifications require SMTP to be configured in Settings > Email / SMTP. The configuration includes host, port, authentication credentials, sender address, and TLS settings.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/notifications.ts` | Notification dispatch logic (in-app and email) |
| `src/socket/presence-handlers.ts` | In-app notification delivery via Socket.IO |
| `src/components/claude-code/settings/notifications-section.tsx` | Notification preferences UI |
| `src/components/claude-code/settings/smtp-section.tsx` | SMTP configuration UI |
| `src/app/api/settings/notifications/route.ts` | Notification preferences API |
| `src/app/api/settings/smtp/route.ts` | SMTP settings API |

## Database Tables

| Table | Purpose |
|-------|---------|
| `notification_preferences` | Per-user settings (event_type, email_enabled, inapp_enabled) |
| `inapp_notifications` | Stored in-app notifications |
| `smtp_settings` | SMTP server configuration |

## Socket Events

**Client to server:** `notification:get_all`, `notification:read`

**Server to client:** `notification:new`, `notification:count`

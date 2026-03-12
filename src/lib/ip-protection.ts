import { getAppSetting } from "./app-settings";

export interface BlockedIP {
  id: number;
  ip_address: string;
  block_reason: string;
  block_type: "temporary" | "permanent";
  failed_attempt_count: number;
  blocked_at: string;
  unblock_at: string | null;
  blocked_by: string;
}

function getDb() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("./db") as { default: import("better-sqlite3").Database }).default;
}

export function recordLoginAttempt(ip: string, email: string | null, success: boolean): void {
  try {
    getDb().prepare(
      "INSERT INTO login_attempts (ip_address, email_attempted, success) VALUES (?, ?, ?)"
    ).run(ip, email ?? null, success ? 1 : 0);
  } catch (err) {
    console.error("[ip-protection] recordLoginAttempt error:", err);
  }
}

export function getFailedAttemptCount(ip: string, windowMinutes: number): number {
  try {
    const row = getDb().prepare(`
      SELECT COUNT(*) as count FROM login_attempts
      WHERE ip_address = ?
        AND success = 0
        AND created_at > datetime('now', '-' || ? || ' minutes')
    `).get(ip, windowMinutes) as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}

export function isIPBlocked(ip: string): { blocked: boolean; reason?: string; unblockAt?: string } {
  try {
    const row = getDb().prepare(`
      SELECT ip_address, block_reason, block_type, unblock_at FROM blocked_ips
      WHERE ip_address = ?
        AND (block_type = 'permanent' OR unblock_at IS NULL OR unblock_at > datetime('now'))
    `).get(ip) as { ip_address: string; block_reason: string; block_type: string; unblock_at: string | null } | undefined;

    if (!row) return { blocked: false };
    return {
      blocked: true,
      reason: row.block_reason,
      unblockAt: row.unblock_at ?? undefined,
    };
  } catch {
    return { blocked: false };
  }
}

export function blockIP(
  ip: string,
  reason: string,
  type: "temporary" | "permanent",
  durationMinutes: number,
  blockedBy: string
): void {
  try {
    const db = getDb();
    const failedCount = getFailedAttemptCount(ip, durationMinutes);
    if (type === "temporary") {
      db.prepare(`
        INSERT INTO blocked_ips (ip_address, block_reason, block_type, failed_attempt_count, blocked_by, unblock_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))
        ON CONFLICT(ip_address) DO UPDATE SET
          block_reason = excluded.block_reason,
          block_type = excluded.block_type,
          failed_attempt_count = excluded.failed_attempt_count,
          blocked_by = excluded.blocked_by,
          blocked_at = datetime('now'),
          unblock_at = datetime('now', '+' || ? || ' minutes')
      `).run(ip, reason, type, failedCount, blockedBy, durationMinutes, durationMinutes);
    } else {
      db.prepare(`
        INSERT INTO blocked_ips (ip_address, block_reason, block_type, failed_attempt_count, blocked_by, unblock_at)
        VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(ip_address) DO UPDATE SET
          block_reason = excluded.block_reason,
          block_type = excluded.block_type,
          failed_attempt_count = excluded.failed_attempt_count,
          blocked_by = excluded.blocked_by,
          blocked_at = datetime('now'),
          unblock_at = NULL
      `).run(ip, reason, type, failedCount, blockedBy);
    }
  } catch (err) {
    console.error("[ip-protection] blockIP error:", err);
  }
}

export function unblockIP(ip: string): void {
  try {
    getDb().prepare("DELETE FROM blocked_ips WHERE ip_address = ?").run(ip);
  } catch (err) {
    console.error("[ip-protection] unblockIP error:", err);
  }
}

export function getBlockedIPs(): BlockedIP[] {
  try {
    return getDb().prepare(
      "SELECT * FROM blocked_ips ORDER BY blocked_at DESC"
    ).all() as BlockedIP[];
  } catch {
    return [];
  }
}

export function cleanupExpiredBlocks(): void {
  try {
    const db = getDb();
    db.prepare(
      "DELETE FROM blocked_ips WHERE block_type = 'temporary' AND unblock_at IS NOT NULL AND unblock_at <= datetime('now')"
    ).run();
    // Also clean up old login attempts (keep last 7 days)
    db.prepare(
      "DELETE FROM login_attempts WHERE created_at < datetime('now', '-7 days')"
    ).run();
  } catch (err) {
    console.error("[ip-protection] cleanupExpiredBlocks error:", err);
  }
}

export function extractIP(headers: Record<string, string | string[] | undefined>): string {
  const realIp = headers["x-real-ip"];
  if (realIp && typeof realIp === "string") return realIp.trim();

  const forwardedFor = headers["x-forwarded-for"];
  if (forwardedFor) {
    const first = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return first.split(",")[0].trim();
  }

  return "unknown";
}

export function getIPProtectionSettings() {
  return {
    enabled: getAppSetting("ip_protection_enabled", "true") === "true",
    maxAttempts: parseInt(getAppSetting("ip_max_attempts", "5"), 10),
    windowMinutes: parseInt(getAppSetting("ip_window_minutes", "10"), 10),
    blockDurationMinutes: parseInt(getAppSetting("ip_block_duration_minutes", "60"), 10),
  };
}

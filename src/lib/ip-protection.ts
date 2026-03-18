import { getAppSettingSync } from "./app-settings";
import { dbGet, dbAll, dbRun } from "./db";

// source_type values:
//   "app"       — blocked by app's own login-failure threshold
//   "manual"    — manually blocked by an admin
//   "fail2ban"  — synced in from the fail2ban daemon
//   "api_abuse" — blocked due to API rate-limit abuse

export interface BlockedIP {
  id: number;
  ip_address: string;
  block_reason: string;
  block_type: "temporary" | "permanent";
  failed_attempt_count: number;
  blocked_at: string;
  unblock_at: string | null;
  blocked_by: string;
  source_type: "app" | "manual" | "fail2ban" | "api_abuse";
}

export async function recordLoginAttempt(ip: string, email: string | null, success: boolean): Promise<void> {
  try {
    await dbRun(
      "INSERT INTO login_attempts (ip_address, email_attempted, success) VALUES (?, ?, ?)",
      [ip, email ?? null, success ? 1 : 0]
    );
  } catch (err) {
    console.error("[ip-protection] recordLoginAttempt error:", err);
  }
}

export async function getFailedAttemptCount(ip: string, windowMinutes: number): Promise<number> {
  try {
    const row = await dbGet<{ count: number }>(`
      SELECT COUNT(*) as count FROM login_attempts
      WHERE ip_address = ?
        AND success = 0
        AND created_at > datetime('now', '-' || ? || ' minutes')
    `, [ip, windowMinutes]);
    return row?.count ?? 0;
  } catch (err) {
    console.error("[ip-protection] getFailedAttemptCount error:", err);
    return 999;
  }
}

export async function isIPBlocked(ip: string): Promise<{ blocked: boolean; reason?: string; unblockAt?: string }> {
  try {
    const row = await dbGet<{ ip_address: string; block_reason: string; block_type: string; unblock_at: string | null }>(`
      SELECT ip_address, block_reason, block_type, unblock_at FROM blocked_ips
      WHERE ip_address = ?
        AND (block_type = 'permanent' OR unblock_at IS NULL OR unblock_at > datetime('now'))
    `, [ip]);

    if (!row) return { blocked: false };
    return {
      blocked: true,
      reason: row.block_reason,
      unblockAt: row.unblock_at ?? undefined,
    };
  } catch (err) {
    console.error("[ip-protection] isIPBlocked error:", err);
    return { blocked: true, reason: "Database error — failing closed" };
  }
}

export async function blockIP(
  ip: string,
  reason: string,
  type: "temporary" | "permanent",
  durationMinutes: number,
  blockedBy: string,
  sourceType: BlockedIP["source_type"] = "app"
): Promise<void> {
  try {
    const failedCount = sourceType === "api_abuse" ? 0 : await getFailedAttemptCount(ip, Math.max(durationMinutes, 60));
    if (type === "temporary") {
      await dbRun(`
        INSERT INTO blocked_ips (ip_address, block_reason, block_type, failed_attempt_count, blocked_by, unblock_at, source_type)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'), ?)
        ON CONFLICT(ip_address) DO UPDATE SET
          block_reason = excluded.block_reason,
          block_type = excluded.block_type,
          failed_attempt_count = excluded.failed_attempt_count,
          blocked_by = excluded.blocked_by,
          blocked_at = datetime('now'),
          unblock_at = datetime('now', '+' || ? || ' minutes'),
          source_type = excluded.source_type
      `, [ip, reason, type, failedCount, blockedBy, durationMinutes, sourceType, durationMinutes]);
    } else {
      await dbRun(`
        INSERT INTO blocked_ips (ip_address, block_reason, block_type, failed_attempt_count, blocked_by, unblock_at, source_type)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(ip_address) DO UPDATE SET
          block_reason = excluded.block_reason,
          block_type = excluded.block_type,
          failed_attempt_count = excluded.failed_attempt_count,
          blocked_by = excluded.blocked_by,
          blocked_at = datetime('now'),
          unblock_at = NULL,
          source_type = excluded.source_type
      `, [ip, reason, type, failedCount, blockedBy, sourceType]);
    }

    // Bidirectional fail2ban sync: push app-originated blocks into fail2ban
    if (sourceType !== "fail2ban") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getFail2BanSettings, isFail2BanAvailable, banIPAsync } = require("./fail2ban") as typeof import("./fail2ban");
        const f2bSettings = getFail2BanSettings();
        if (f2bSettings.enabled && isFail2BanAvailable()) {
          banIPAsync(f2bSettings.jail, ip);
        }
      } catch {
        // fail2ban module or binary not available — skip silently
      }
    }
  } catch (err) {
    console.error("[ip-protection] blockIP error:", err);
  }
}

export async function unblockIP(ip: string): Promise<void> {
  try {
    await dbRun("DELETE FROM blocked_ips WHERE ip_address = ?", [ip]);

    // Bidirectional fail2ban sync: unban in fail2ban too
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getFail2BanSettings, isFail2BanAvailable, unbanIPAsync } = require("./fail2ban") as typeof import("./fail2ban");
      const f2bSettings = getFail2BanSettings();
      if (f2bSettings.enabled && isFail2BanAvailable()) {
        unbanIPAsync(f2bSettings.jail, ip);
      }
    } catch {
      // fail2ban module or binary not available — skip silently
    }
  } catch (err) {
    console.error("[ip-protection] unblockIP error:", err);
  }
}

export async function getBlockedIPs(): Promise<BlockedIP[]> {
  try {
    return await dbAll<BlockedIP>("SELECT * FROM blocked_ips ORDER BY blocked_at DESC");
  } catch {
    return [];
  }
}

export async function cleanupExpiredBlocks(): Promise<void> {
  try {
    await dbRun(
      "DELETE FROM blocked_ips WHERE block_type = 'temporary' AND unblock_at IS NOT NULL AND unblock_at <= datetime('now')"
    );
    // Also clean up old login attempts (keep last 7 days)
    await dbRun(
      "DELETE FROM login_attempts WHERE created_at < datetime('now', '-7 days')"
    );
    // Clean up stale API request count windows (older than 2 hours)
    await dbRun(
      "DELETE FROM api_request_counts WHERE window_start < datetime('now', '-2 hours')"
    );
  } catch (err) {
    console.error("[ip-protection] cleanupExpiredBlocks error:", err);
  }
}

export function extractIP(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress?: string
): string {
  const trustedProxy = getAppSettingSync("trusted_proxy", "false") === "true";

  if (trustedProxy) {
    const realIp = headers["x-real-ip"];
    if (realIp && typeof realIp === "string") return realIp.trim();

    const forwardedFor = headers["x-forwarded-for"];
    if (forwardedFor) {
      const first = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      return first.split(",")[0].trim();
    }
  }

  return remoteAddress ?? "127.0.0.1";
}

export function getIPProtectionSettings() {
  return {
    enabled: getAppSettingSync("ip_protection_enabled", "true") === "true",
    maxAttempts: parseInt(getAppSettingSync("ip_max_attempts", "5"), 10),
    windowMinutes: parseInt(getAppSettingSync("ip_window_minutes", "10"), 10),
    blockDurationMinutes: parseInt(getAppSettingSync("ip_block_duration_minutes", "60"), 10),
  };
}

// ── API Abuse Protection ──────────────────────────────────────────────────────

export function getApiAbuseSettings() {
  return {
    enabled: getAppSettingSync("api_abuse_protection_enabled", "true") === "true",
    maxRequests: parseInt(getAppSettingSync("api_abuse_max_requests", "200"), 10),
    windowSeconds: parseInt(getAppSettingSync("api_abuse_window_seconds", "60"), 10),
    blockMinutes: parseInt(getAppSettingSync("api_abuse_block_minutes", "30"), 10),
  };
}

/**
 * Record one API request for an IP and return whether it should be blocked.
 * Uses a 60-second tumbling window stored in api_request_counts.
 */
export async function checkAndRecordApiRequest(ip: string): Promise<{ blocked: boolean; count?: number }> {
  try {
    const settings = getApiAbuseSettings();
    if (!settings.enabled) return { blocked: false };

    // Skip loopback
    if (ip === "127.0.0.1" || ip === "::1") return { blocked: false };

    // Current window key: truncate to the nearest window boundary
    const windowStart = new Date();
    windowStart.setSeconds(
      Math.floor(windowStart.getSeconds() / settings.windowSeconds) * settings.windowSeconds,
      0
    );
    const windowKey = windowStart.toISOString().slice(0, 19).replace("T", " ");

    // Upsert count
    await dbRun(`
      INSERT INTO api_request_counts (ip_address, window_start, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(ip_address, window_start) DO UPDATE SET
        request_count = request_count + 1
    `, [ip, windowKey]);

    const row = await dbGet<{ request_count: number }>(
      "SELECT request_count FROM api_request_counts WHERE ip_address = ? AND window_start = ?",
      [ip, windowKey]
    );

    const count = row?.request_count ?? 1;
    if (count >= settings.maxRequests) {
      // Auto-block
      await blockIP(
        ip,
        `API abuse — ${count} requests in ${settings.windowSeconds}s`,
        "temporary",
        settings.blockMinutes,
        "system",
        "api_abuse"
      );
      return { blocked: true, count };
    }

    return { blocked: false, count };
  } catch (err) {
    console.error("[ip-protection] checkAndRecordApiRequest error:", err);
    return { blocked: false };
  }
}

// ── Fail2Ban Sync ─────────────────────────────────────────────────────────────

/**
 * Pull currently-banned IPs from fail2ban and mirror them into blocked_ips.
 * Any IP that fail2ban has banned but isn't in our DB gets inserted with
 * source_type='fail2ban'. IPs that were previously synced from fail2ban
 * but are no longer in fail2ban's ban list are removed.
 */
export async function syncFail2BanBans(): Promise<{ added: number; removed: number; error?: string }> {
  try {
    const { getFail2BanSettings, getBannedIPs, jailExists: checkJailExists } = (() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("./fail2ban") as typeof import("./fail2ban");
    })();
    const settings = getFail2BanSettings();

    if (!settings.enabled) return { added: 0, removed: 0 };

    const { available, running } = (() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isFail2BanAvailable, isFail2BanRunning } = require("./fail2ban") as typeof import("./fail2ban");
      return { available: isFail2BanAvailable(), running: isFail2BanRunning() };
    })();

    if (!available || !running) return { added: 0, removed: 0, error: "fail2ban unavailable" };

    if (!checkJailExists(settings.jail)) {
      return { added: 0, removed: 0, error: `Jail '${settings.jail}' does not exist` };
    }

    const bannedByF2B = new Set(getBannedIPs(settings.jail));

    // IPs already tracked in DB that came from fail2ban
    const existingF2B = await dbAll<{ ip_address: string }>(
      "SELECT ip_address FROM blocked_ips WHERE source_type = 'fail2ban'"
    );
    const existingF2BSet = new Set(existingF2B.map((r) => r.ip_address));

    let added = 0;
    let removed = 0;

    // Add newly banned IPs from fail2ban
    for (const ip of bannedByF2B) {
      if (!existingF2BSet.has(ip)) {
        // Insert as permanent (fail2ban manages expiry)
        await dbRun(`
          INSERT INTO blocked_ips (ip_address, block_reason, block_type, failed_attempt_count, blocked_by, unblock_at, source_type)
          VALUES (?, ?, 'permanent', 0, 'fail2ban', NULL, 'fail2ban')
          ON CONFLICT(ip_address) DO UPDATE SET
            source_type = CASE WHEN source_type = 'fail2ban' THEN 'fail2ban' ELSE source_type END
        `, [ip, `Banned by fail2ban (jail: ${settings.jail})`]);
        added++;
      }
    }

    // Remove IPs that were sourced from fail2ban but are no longer in fail2ban's ban list
    for (const { ip_address } of existingF2B) {
      if (!bannedByF2B.has(ip_address)) {
        await dbRun("DELETE FROM blocked_ips WHERE ip_address = ? AND source_type = 'fail2ban'", [ip_address]);
        removed++;
      }
    }

    return { added, removed };
  } catch (err) {
    const msg = String(err);
    console.error("[ip-protection] syncFail2BanBans error:", msg);
    return { added: 0, removed: 0, error: msg };
  }
}

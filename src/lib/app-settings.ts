import db from "./db";

const KNOWN_SETTING_KEYS = [
  "anthropic_api_key",
  "guard_rails_enabled",
  "sandbox_enabled",
  "sandbox_always_allowed",
  "sandbox_always_blocked",
  "ip_protection_enabled",
  "ip_max_attempts",
  "ip_window_minutes",
  "ip_block_duration_minutes",
  "trusted_proxy",
  "personality",
  "personality_custom",
  "rate_limit_commands",
  "rate_limit_runtime_min",
  "rate_limit_concurrent",
  "budget_limit_session_usd",
  "budget_limit_daily_usd",
  "budget_limit_monthly_usd",
  "upload_max_size_bytes",
];

/**
 * Returns a setting value from the database, falling back to `defaultValue`
 * on any error (DB unavailable, corrupt row, etc.).
 *
 * WARNING — fail-open pattern: On database errors this returns `defaultValue`,
 * which means a misconfigured or failing DB silently reverts every setting to
 * its caller-supplied default. Callers that use this for security-critical
 * settings (e.g. guard_rails_enabled, ip_protection_enabled) MUST pass a
 * secure default (typically "true" / enabled) so that failures don't
 * silently disable protections.
 */
export function getAppSetting(key: string, defaultValue = ""): string {
  try {
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setAppSetting(key: string, value: string): void {
  if (!KNOWN_SETTING_KEYS.includes(key)) {
    console.warn(
      `[app-settings] setAppSetting called with unknown key "${key}". ` +
      "This may indicate a typo or an unregistered setting. " +
      "Consider adding it to KNOWN_SETTING_KEYS."
    );
  }

  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  ).run(key, value, value);
}

const PERSONALITY_PROMPTS: Record<string, string> = {
  professional:
    "Personality: professional, precise, and efficient. Use clear, formal language and focus on accuracy.",
  friendly:
    "Personality: warm, approachable, and encouraging. Use friendly, conversational language.",
  technical:
    "Personality: highly technical. Use precise technical terminology and provide detailed, expert-level responses.",
  concise:
    "Personality: concise. Keep responses brief and to the point. Avoid unnecessary elaboration.",
  creative:
    "Personality: creative and innovative. Think outside the box and offer unique perspectives.",
};

export function getPersonalityPrefix(): string {
  const personality = getAppSetting("personality", "professional");
  if (personality === "custom") {
    return getAppSetting("personality_custom", "");
  }
  return PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.professional;
}

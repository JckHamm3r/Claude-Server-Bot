import db from "./db";

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
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  ).run(key, value, value);
}

const PERSONALITY_PROMPTS: Record<string, string> = {
  professional:
    "You are a professional, precise, and efficient AI assistant. Use clear, formal language and focus on accuracy.",
  friendly:
    "You are a warm, approachable, and encouraging AI assistant. Use friendly, conversational language.",
  technical:
    "You are a highly technical AI assistant. Use precise technical terminology and provide detailed, expert-level responses.",
  concise:
    "You are a concise AI assistant. Keep responses brief and to the point. Avoid unnecessary elaboration.",
  creative:
    "You are a creative and innovative AI assistant. Think outside the box and offer unique perspectives.",
};

export function getPersonalityPrefix(): string {
  const personality = getAppSetting("personality", "professional");
  if (personality === "custom") {
    return getAppSetting("personality_custom", "");
  }
  return PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.professional;
}

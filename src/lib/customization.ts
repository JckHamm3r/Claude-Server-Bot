import path from "path";
import fs from "fs";
import db from "./db";
import { getPersonalityPrefix } from "./app-settings";

/**
 * The bot's own install directory. The subprocess cwd (CLAUDE_PROJECT_ROOT) may
 * point to the user's project, so we resolve from this source file to reach the
 * repo root where the bot's own CLAUDE.md lives.
 */
const BOT_INSTALL_DIR = path.resolve(__dirname, "../..");

interface BotSettings {
  name: string;
  tagline: string;
}

function getBotSettings(): BotSettings {
  try {
    const row = db
      .prepare("SELECT name, tagline FROM bot_settings WHERE id = 1")
      .get() as { name: string; tagline: string } | undefined;
    return {
      name: row?.name ?? "Claude Server Bot",
      tagline: row?.tagline ?? "Your AI assistant",
    };
  } catch {
    return { name: "Claude Server Bot", tagline: "Your AI assistant" };
  }
}

function getBotClaudeMd(): string | null {
  const claudeMdPath = path.join(BOT_INSTALL_DIR, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    try {
      const content = fs.readFileSync(claudeMdPath, "utf-8").trim();
      return content || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function getBotSelfIdentityPrompt(): string | null {
  const bot = getBotSettings();
  const instructions = getBotClaudeMd();
  if (!instructions) return null;

  return [
    `You are ${bot.name} — ${bot.tagline}. The following is documentation about yourself, the platform you are running on, and your capabilities. Use it to answer questions about what you are and what you can do.`,
    `--- Platform Documentation (CLAUDE.md) ---`,
    instructions,
  ].join("\n\n");
}

export async function getCustomizationSystemPrompt(): Promise<string> {
  const parts: string[] = [];

  const bot = getBotSettings();
  parts.push(
    `You are ${bot.name} — ${bot.tagline}. You are in customization mode, helping the administrator configure and personalise this bot.`
  );

  const personalityPrefix = getPersonalityPrefix();
  if (personalityPrefix) {
    parts.push(personalityPrefix);
  }

  const instructions = getBotClaudeMd();
  if (instructions) {
    parts.push(`--- Project Instructions ---\n${instructions}`);
  }

  return parts.join("\n\n");
}

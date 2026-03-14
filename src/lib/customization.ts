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

  const identityLines = [
    `YOUR IDENTITY (always use this when asked who you are):`,
    `Your name is "${bot.name}". Your tagline is "${bot.tagline}".`,
    `When asked "who are you" or similar, introduce yourself as ${bot.name}. Never say you are "Claude", "Claude Code", or an "Anthropic assistant". You are ${bot.name}.`,
    `You are a self-hosted AI-powered server management and coding assistant running on the Claude Server Bot platform. You can read/write files, run commands, search codebases, manage sessions, execute multi-step plans, and more.`,
  ];

  return identityLines.join("\n");
}

export async function getCustomizationSystemPrompt(): Promise<string> {
  const parts: string[] = [];

  const bot = getBotSettings();
  parts.push(
    `Your name is "${bot.name}" — ${bot.tagline}. Never identify as "Claude" or "Claude Code". You are ${bot.name}. You are in customization mode, helping the administrator configure and personalise this bot.`
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

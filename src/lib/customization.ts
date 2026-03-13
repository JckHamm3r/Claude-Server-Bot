import path from "path";
import fs from "fs";
import db from "./db";
import { getPersonalityPrefix } from "./app-settings";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

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

  // Include CLAUDE.md project instructions if present
  const claudeMdPath = path.join(PROJECT_ROOT, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    try {
      const instructions = fs.readFileSync(claudeMdPath, "utf-8").trim();
      if (instructions) {
        parts.push(`--- Project Instructions ---\n${instructions}`);
      }
    } catch {
      // ignore read errors
    }
  }

  return parts.join("\n\n");
}

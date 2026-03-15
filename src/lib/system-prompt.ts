import * as fs from "fs";
import * as path from "path";
import { getAppSetting, getPersonalityPrefix } from "./app-settings";
import { getCustomizationSystemPrompt, getBotSelfIdentityPrompt } from "./customization";
import { getSecuritySystemPrompt } from "./security-guard";

export type InterfaceType = "ui_chat" | "customization_interface" | "system_agent";

interface BuildSystemPromptOpts {
  interfaceType?: InterfaceType;
  personality?: string;
  personalityCustom?: string;
  templateSystemPrompt?: string;
}

/**
 * Read CLAUDE.md from the project root if it exists.
 * Checks CLAUDE.md and .claude/CLAUDE.md (same precedence as the SDK).
 * We read this ourselves instead of using settingSources: ['project']
 * to avoid loading .claude/settings.json permission rules.
 */
function readProjectClaudeMd(): string | undefined {
  const root = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
  const candidates = [
    path.join(root, "CLAUDE.md"),
    path.join(root, ".claude", "CLAUDE.md"),
  ];
  for (const candidate of candidates) {
    try {
      const content = fs.readFileSync(candidate, "utf-8").trim();
      if (content) return content;
    } catch { /* file doesn't exist or unreadable */ }
  }
  return undefined;
}

/**
 * Single source of truth for composing the system prompt sent to Claude.
 * Composition order: security → template → project CLAUDE.md → identity + personality
 */
export async function buildSystemPrompt(opts: BuildSystemPromptOpts = {}): Promise<string | undefined> {
  const {
    interfaceType = "ui_chat",
    personality,
    personalityCustom,
    templateSystemPrompt,
  } = opts;

  let systemPrompt: string | undefined;

  if (interfaceType === "customization_interface") {
    systemPrompt = await getCustomizationSystemPrompt();
  } else if (interfaceType === "system_agent") {
    systemPrompt = undefined;
  } else {
    const parts: string[] = [];
    const selfIdentity = getBotSelfIdentityPrompt();
    if (selfIdentity) parts.push(selfIdentity);
    const personalityPrefix = getPersonalityPrefix(personality ?? "professional", personalityCustom);
    if (personalityPrefix) parts.push(personalityPrefix);
    systemPrompt = parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  if (templateSystemPrompt) {
    systemPrompt = systemPrompt
      ? templateSystemPrompt + "\n\n" + systemPrompt
      : templateSystemPrompt;
  }

  // Append CLAUDE.md from project root (if present) so the SDK agent
  // gets project-level context without enabling settingSources.
  const claudeMd = readProjectClaudeMd();
  if (claudeMd) {
    const claudeSection = `<project-instructions>\n${claudeMd}\n</project-instructions>`;
    systemPrompt = systemPrompt
      ? systemPrompt + "\n\n" + claudeSection
      : claudeSection;
  }

  const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
  const securityPrefix = getSecuritySystemPrompt(guardEnabled);
  if (securityPrefix) {
    systemPrompt = systemPrompt
      ? securityPrefix + "\n\n" + systemPrompt
      : securityPrefix;
  }

  return systemPrompt;
}

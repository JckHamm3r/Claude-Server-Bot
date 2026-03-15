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

const CONTEXT_BOOTSTRAP_INSTRUCTION = `CONTEXT SYSTEM: You have a .context/ folder for persistent project/server knowledge.
No context has been recorded yet. After discovering or installing anything notable, create:
  .context/_index.md  -- Master table of contents (keep under 40 lines)
  .context/services.md -- Installed services with versions, config paths, status
  .context/stack.md    -- Languages, frameworks, package managers, build tools
  .context/structure.md -- Key directories and what lives where
  .context/connections.md -- Ports, hostnames, users (NEVER secrets/passwords)
  .context/history.md  -- Chronological log of what you built/changed
Always update _index.md when you create or modify a context file.`;

const CONTEXT_USAGE_INSTRUCTION = `CONTEXT SYSTEM: The .context/ folder contains your persistent knowledge about this server/project.
- Before installing or checking for software, read the relevant .context/ file first.
- After installing software, configuring services, or making significant changes, update the relevant .context/ file and _index.md.
- Keep _index.md under 40 lines. It is loaded into every session's system prompt.
- Use Read/Write tools to access .context/ files. Never store secrets or passwords.`;

/**
 * Read .context/_index.md from the project root.
 * Returns a <project-context> block for the system prompt, or a bootstrap
 * instruction if no context files exist yet.
 */
function readContextIndex(): string {
  const root = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
  const indexPath = path.join(root, ".context", "_index.md");
  try {
    const content = fs.readFileSync(indexPath, "utf-8").trim();
    if (content) {
      return `<project-context>\n${content}\n\n${CONTEXT_USAGE_INSTRUCTION}\n</project-context>`;
    }
  } catch { /* file doesn't exist */ }
  return `<project-context>\n${CONTEXT_BOOTSTRAP_INSTRUCTION}\n</project-context>`;
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

  // Append .context/_index.md (or bootstrap instruction) so the agent
  // always knows what persistent context is available.
  const contextSection = readContextIndex();
  systemPrompt = systemPrompt
    ? systemPrompt + "\n\n" + contextSection
    : contextSection;

  const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
  const securityPrefix = getSecuritySystemPrompt(guardEnabled);
  if (securityPrefix) {
    systemPrompt = systemPrompt
      ? securityPrefix + "\n\n" + systemPrompt
      : securityPrefix;
  }

  return systemPrompt;
}

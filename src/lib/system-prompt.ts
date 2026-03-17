import * as fs from "fs";
import * as path from "path";
import { getAppSetting, getPersonalityPrefix } from "./app-settings";
import { getCustomizationSystemPrompt, getBotSelfIdentityPrompt } from "./customization";
import { getSecuritySystemPrompt } from "./security-guard";
import { getMemories } from "./claude-db";
import { buildAgentToolBlock } from "./agent-tool-injector";

export type InterfaceType = "ui_chat" | "customization_interface" | "system_agent";

interface BuildSystemPromptOpts {
  interfaceType?: InterfaceType;
  personality?: string;
  personalityCustom?: string;
  templateSystemPrompt?: string;
  experienceLevel?: string;
  autoSummary?: boolean;
  includeAgentTools?: boolean;
}

function getExperienceLevelInstruction(level: string, autoSummary: boolean): string {
  const summaryNote = autoSummary
    ? "After completing any task or group of actions, always provide a brief summary of what was done."
    : "";

  switch (level) {
    case "beginner":
      return [
        "COMMUNICATION STYLE: Beginner user. Always use plain, everyday language.",
        "- Never use technical jargon (nginx, reverse proxy, environment variable, daemon, cron, etc.) without explaining it first.",
        "- Explain what you're about to do BEFORE doing it, in simple terms.",
        "- Compare technical things to familiar real-world concepts when helpful.",
        "- Prefer simple, proven solutions over complex ones.",
        summaryNote,
      ].filter(Boolean).join("\n");

    case "intermediate":
      return [
        "COMMUNICATION STYLE: Intermediate user. Mix technical clarity with context.",
        "- Use technical terms for common concepts (git, npm, etc.), but explain unfamiliar infrastructure/server concepts.",
        "- Explain the reasoning behind non-obvious architectural decisions.",
        summaryNote,
      ].filter(Boolean).join("\n");

    default: // expert
      return [
        "COMMUNICATION STYLE: Expert user. Be concise and fully technical.",
        "- No explanations needed for standard concepts. Skip hand-holding.",
        summaryNote,
      ].filter(Boolean).join("\n");
  }
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
 * Composition order: security (prepended last) → template → CLAUDE.md → identity + personality (first)
 */
export async function buildSystemPrompt(opts: BuildSystemPromptOpts = {}): Promise<string | undefined> {
  const {
    interfaceType = "ui_chat",
    personality,
    personalityCustom,
    templateSystemPrompt,
    experienceLevel = "expert",
    autoSummary = true,
    includeAgentTools = true,
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
    const levelInstruction = getExperienceLevelInstruction(experienceLevel, autoSummary);
    if (levelInstruction) parts.push(levelInstruction);
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

  // Append saved memories from the database so Claude has access to
  // project-level knowledge items curated by admins.
  const memories = getMemories();
  if (memories.length > 0) {
    const memoriesText = memories
      .map((m) => `### ${m.title}\n${m.content}`)
      .join("\n\n");
    const memoriesSection = `<memories>\nThe following are important memory items for this project. Treat them as ground truth.\n\n${memoriesText}\n</memories>`;
    systemPrompt = systemPrompt
      ? systemPrompt + "\n\n" + memoriesSection
      : memoriesSection;
  }

  // Append .context/_index.md (or bootstrap instruction) so the agent
  // always knows what persistent context is available.
  const contextSection = readContextIndex();
  systemPrompt = systemPrompt
    ? systemPrompt + "\n\n" + contextSection
    : contextSection;

  // Append agent delegation tools block for ui_chat sessions so Claude can
  // autonomously invoke specialized agents mid-conversation.
  if (includeAgentTools && interfaceType === "ui_chat") {
    const agentToolBlock = buildAgentToolBlock();
    if (agentToolBlock) {
      systemPrompt = systemPrompt
        ? systemPrompt + "\n\n" + agentToolBlock
        : agentToolBlock;
    }
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

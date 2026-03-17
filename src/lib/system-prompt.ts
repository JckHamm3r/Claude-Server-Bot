import * as fs from "fs";
import * as path from "path";
import { getAppSetting, getPersonalityPrefix } from "./app-settings";
import { getCustomizationSystemPrompt, getBotSelfIdentityPrompt } from "./customization";
import { getSecuritySystemPrompt } from "./security-guard";
import { getMemoriesForTarget, MAIN_SESSION_TARGET, getSessionContext } from "./claude-db";
import { buildAgentToolBlock } from "./agent-tool-injector";

export type InterfaceType = "ui_chat" | "customization_interface" | "system_agent";

interface BuildSystemPromptOpts {
  interfaceType?: InterfaceType;
  personality?: string;
  personalityCustom?: string;
  templateSystemPrompt?: string;
  communicationStyle?: string;
  autoSummary?: boolean;
  includeAgentTools?: boolean;
  /** When set, injects per-session context journal and the save instruction. */
  sessionId?: string;
  /** Optional text appended after the auto-generated role block. */
  groupPromptAppend?: string;
  /** Full group permissions for the current user — used to build the role awareness block. */
  groupPermissions?: import("./claude-db").GroupPermissions | null;
  /** Display name of the user's group (e.g. "Employee"). */
  groupName?: string;
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
 * Builds a concise <user-role> block injected into the system prompt so Claude
 * understands the user's role and knows not to suggest unavailable features.
 * Returns an empty string for admins (null groupPermissions).
 */
function buildRoleAwarenessBlock(
  groupName: string | undefined,
  groupPermissions: import("./claude-db").GroupPermissions | null | undefined
): string {
  if (!groupPermissions) return "";
  const name = groupName ?? "User";
  const p = groupPermissions.platform;
  const ai = groupPermissions.ai;
  const sess = groupPermissions.session;

  if (p.observe_only) {
    return `<user-role>\nRole: ${name} | Observe-only. This user can only view sessions — they cannot create sessions or interact with you.\n</user-role>`;
  }

  const lines: string[] = [`Role: ${name}`];

  // Visible tabs
  const tabs = (p.visible_tabs ?? []).map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  if (tabs.length > 0) lines.push(`Tabs: ${tabs.join(", ")}`);

  // Key restrictions
  const restrictions: string[] = [];
  if (!p.terminal_access) restrictions.push("no terminal access");
  if (!p.files_browse) restrictions.push("no file browsing");
  if (!p.sessions_view_others) restrictions.push("cannot view others' sessions");
  if (!p.templates_manage) restrictions.push("cannot manage templates");
  if (!p.memories_manage) restrictions.push("cannot manage memories");
  if (ai.read_only) restrictions.push("AI is in read-only mode (no file writes)");
  if (!ai.shell_access) restrictions.push("no shell access");
  if (!ai.full_trust_allowed) restrictions.push("no full-trust mode");
  if (restrictions.length > 0) lines.push(`Restrictions: ${restrictions.join(", ")}`);

  // Session limits
  const limits: string[] = [];
  if (sess.max_active > 0) limits.push(`max ${sess.max_active} active sessions`);
  if (sess.max_turns > 0) limits.push(`max ${sess.max_turns} turns per session`);
  if (!sess.delegation_enabled) limits.push("no sub-agent delegation");
  if (limits.length > 0) lines.push(`Session limits: ${limits.join(", ")}`);

  // Settings access summary
  const visSettings = p.visible_settings ?? [];
  const hasAdminSettings = visSettings.some((s) => !["general", "notifications"].includes(s));
  if (!hasAdminSettings) lines.push("Settings access: personal settings only (no admin sections)");

  // Behavioral directive
  const directives: string[] = [];
  if (!p.terminal_access) directives.push("terminal commands");
  if (!p.files_browse) directives.push("file management");
  if (!hasAdminSettings) directives.push("admin configuration changes");
  if (ai.read_only) directives.push("file write operations");
  if (directives.length > 0) {
    lines.push(`Do not suggest ${directives.join(", ")} to this user — these features are unavailable for their role.`);
  }

  return `<user-role>\n${lines.join("\n")}\n</user-role>`;
}

/**
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
    communicationStyle = "expert",
    autoSummary = true,
    includeAgentTools = true,
    sessionId,
    groupPromptAppend,
    groupPermissions,
    groupName,
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
    const levelInstruction = getExperienceLevelInstruction(communicationStyle, autoSummary);
    if (levelInstruction) parts.push(levelInstruction);
    systemPrompt = parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  if (templateSystemPrompt) {
    systemPrompt = systemPrompt
      ? templateSystemPrompt + "\n\n" + systemPrompt
      : templateSystemPrompt;
  }

  // Inject role awareness block (auto-generated from group permissions) + optional custom append
  const roleBlock = buildRoleAwarenessBlock(groupName, groupPermissions);
  if (roleBlock) {
    systemPrompt = systemPrompt ? systemPrompt + "\n\n" + roleBlock : roleBlock;
  }
  if (groupPromptAppend) {
    const groupSection = `\n## Group Context\n${groupPromptAppend}`;
    systemPrompt = systemPrompt
      ? systemPrompt + "\n\n" + groupSection
      : groupSection;
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
  const memories = getMemoriesForTarget(MAIN_SESSION_TARGET);
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

  // Inject per-session context journal (if the session has one from a previous interaction).
  // Also inject the instruction for the AI to maintain it via update_session_context tool.
  if (sessionId && interfaceType === "ui_chat") {
    const journal = getSessionContext(sessionId);
    const journalParts: string[] = [];
    if (journal) {
      journalParts.push(`<session_context>\nThe following is your running context journal from previous interactions in this session. Use it to maintain continuity.\n\n${journal}\n</session_context>`);
    }
    journalParts.push(
      `<session_context_tool>\n` +
      `You have a virtual tool called "update_session_context". At the end of each significant interaction ` +
      `(after completing a task, making key decisions, or learning important facts), call it to save a concise ` +
      `summary of what happened. This context is loaded when the session resumes so you remember prior work.\n\n` +
      `To use it, call the tool with input: { "context": "<your concise context summary>" }\n` +
      `The context should include: key decisions made, files modified, current state/progress, ` +
      `important facts learned, and any pending work. Keep it under 4000 characters.\n` +
      `The context REPLACES the previous one (not appends), so include everything important.\n` +
      `</session_context_tool>`
    );
    const journalBlock = journalParts.join("\n\n");
    systemPrompt = systemPrompt
      ? systemPrompt + "\n\n" + journalBlock
      : journalBlock;
  }

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

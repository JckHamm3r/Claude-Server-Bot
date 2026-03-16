import * as fs from "fs";
import * as path from "path";
import type { ClaudeUserSettings } from "./claude-db";
import { SERVER_PURPOSES } from "./user-profile-constants";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

const PROFILE_START = "<!-- ASSISTANT-PROFILE:START -->";
const PROFILE_END = "<!-- ASSISTANT-PROFILE:END -->";

function getLevelInstructions(level: string): string {
  switch (level) {
    case "beginner":
      return `**Communication style**: The user is a beginner. Always communicate in plain, everyday language.
- Never use technical jargon (like "nginx", "reverse proxy", "environment variable", "cron job", "daemon") without immediately explaining what it means in simple terms.
- Prefer analogies: explain technical concepts by comparing them to familiar real-world things.
- Always explain what you are about to do BEFORE doing it, in plain language.
- After completing any action or set of actions, write a brief summary explaining what was done and what changed — as if explaining to someone non-technical.
- Be proactive: suggest logical next steps after completing a task.
- Prefer simple, stable, well-documented solutions over cutting-edge or complex ones.
- When presenting options, limit to 2-3 and explain each clearly.`;

    case "intermediate":
      return `**Communication style**: The user has intermediate technical knowledge (familiar with code, basic Linux, etc.).
- Use technical terms when they improve clarity, but briefly explain unfamiliar infrastructure concepts.
- Explain the reasoning behind architectural decisions when they're non-obvious.
- After completing significant tasks, provide a brief technical summary covering what changed and anything to verify.
- Assume familiarity with: code, basic terminal use, package managers, and common web concepts.
- May not be familiar with: advanced server configuration, networking, security hardening, deployment pipelines.`;

    default: // expert
      return `**Communication style**: The user is an expert developer and sysadmin.
- Use full technical terminology without explanation.
- Be concise and direct. Skip hand-holding and introductory context.
- Provide technical summaries focused on what changed, configuration details, and things to watch.
- Assume deep familiarity with Linux, networking, deployment, and software development.`;
  }
}

function getServerPurposeInstructions(purposes: string[]): string {
  if (!purposes || purposes.length === 0) return "";

  const purposeLabels = purposes
    .map((id) => SERVER_PURPOSES.find((p) => p.id === id)?.label ?? id)
    .join(", ");

  const lines: string[] = [`**Server purpose(s)**: ${purposeLabels}`];

  // Add purpose-specific guidance
  if (purposes.includes("personal-website") || purposes.includes("business-website")) {
    lines.push("- Favor simple, stable hosting solutions (static sites, WordPress, Ghost, or small Node/Python apps).");
    lines.push("- Recommend Let's Encrypt for SSL, nginx or Caddy as a reverse proxy.");
  }
  if (purposes.includes("web-app")) {
    lines.push("- This server runs a custom web application. Consider scalability, security, and maintainability.");
  }
  if (purposes.includes("api-backend")) {
    lines.push("- Focus on API reliability, security (auth, rate limiting), and clear documentation.");
  }
  if (purposes.includes("mail-server")) {
    lines.push("- Mail server configuration requires careful attention to DNS (MX, SPF, DKIM, DMARC), deliverability, and security.");
  }
  if (purposes.includes("database-server")) {
    lines.push("- Prioritize data security, regular backups, and access control for database operations.");
  }
  if (purposes.includes("home-lab")) {
    lines.push("- This is a home lab. Solutions can prioritize learning and experimentation over production-grade reliability.");
  }
  if (purposes.includes("dev-staging")) {
    lines.push("- This is a development/staging environment. Prioritize developer experience and easy iteration over hardening.");
  }

  return lines.join("\n");
}

function getProjectTypeInstructions(projectType: string): string {
  if (projectType === "existing") {
    return `**Project**: Existing project
- There is already a project running on this server. Work within the existing structure and respect existing configuration.
- Before making changes, read and understand the current setup.
- Prefer incremental improvements over full rewrites unless explicitly requested.`;
  }
  if (projectType === "new") {
    return `**Project**: Starting fresh
- This is a new project. Establish good foundations: clear directory structure, version control, and documentation.
- Set up basic tooling (git, appropriate package manager, etc.) as part of the initial setup.`;
  }
  return "";
}

/**
 * Generate the profile context block for CLAUDE.md.
 */
export function generateProfileBlock(settings: ClaudeUserSettings): string {
  const parts: string[] = [`${PROFILE_START}`, `## Assistant Configuration`, ""];

  const levelInstructions = getLevelInstructions(settings.experience_level);
  if (levelInstructions) {
    parts.push(levelInstructions);
    parts.push("");
  }

  const purposeInstructions = getServerPurposeInstructions(settings.server_purposes);
  if (purposeInstructions) {
    parts.push(purposeInstructions);
    parts.push("");
  }

  const projectInstructions = getProjectTypeInstructions(settings.project_type);
  if (projectInstructions) {
    parts.push(projectInstructions);
    parts.push("");
  }

  if (settings.auto_summary) {
    parts.push(`**Summary requirement**: After completing any task or group of actions, always provide a concise summary of what was done.`);
    parts.push("");
  }

  parts.push(PROFILE_END);
  return parts.join("\n");
}

/**
 * Append or update the profile block in CLAUDE.md.
 * If the block markers exist, replace only that section.
 * If not, append to the end of the file.
 */
export async function applyProfileToClaudeMd(settings: ClaudeUserSettings): Promise<void> {
  const claudeMdPath = path.join(PROJECT_ROOT, "CLAUDE.md");
  const newBlock = generateProfileBlock(settings);

  let existing = "";
  try {
    existing = fs.readFileSync(claudeMdPath, "utf-8");
  } catch {
    // File doesn't exist — create it with just the profile block
    fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
    fs.writeFileSync(claudeMdPath, newBlock + "\n", "utf-8");
    return;
  }

  const startIdx = existing.indexOf(PROFILE_START);
  const endIdx = existing.indexOf(PROFILE_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block
    const before = existing.slice(0, startIdx).trimEnd();
    const after = existing.slice(endIdx + PROFILE_END.length).trimStart();
    const updated = [before, newBlock, after].filter(Boolean).join("\n\n");
    fs.writeFileSync(claudeMdPath, updated + "\n", "utf-8");
  } else {
    // Append to end
    const trimmed = existing.trimEnd();
    fs.writeFileSync(claudeMdPath, trimmed + "\n\n" + newBlock + "\n", "utf-8");
  }
}

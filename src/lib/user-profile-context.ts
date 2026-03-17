import * as fs from "fs";
import * as path from "path";
import type { ClaudeUserSettings } from "./claude-db";
import { SERVER_PURPOSES } from "./user-profile-constants";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

const PROFILE_START = "<!-- ASSISTANT-PROFILE:START -->";
const PROFILE_END = "<!-- ASSISTANT-PROFILE:END -->";

function getServerPurposeInstructions(purposes: string[]): string {
  if (!purposes || purposes.length === 0) return "";

  const purposeLabels = purposes
    .map((id) => SERVER_PURPOSES.find((p) => p.id === id)?.label ?? id)
    .join(", ");

  const lines: string[] = [`**Server purpose(s)**: ${purposeLabels}`];

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
 * Communication style is handled per-session via group permissions (buildRoleAwarenessBlock).
 */
export function generateProfileBlock(settings: ClaudeUserSettings): string {
  const parts: string[] = [`${PROFILE_START}`, `## Assistant Configuration`, ""];

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
    fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
    fs.writeFileSync(claudeMdPath, newBlock + "\n", "utf-8");
    return;
  }

  const startIdx = existing.indexOf(PROFILE_START);
  const endIdx = existing.indexOf(PROFILE_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).trimEnd();
    const after = existing.slice(endIdx + PROFILE_END.length).trimStart();
    const updated = [before, newBlock, after].filter(Boolean).join("\n\n");
    fs.writeFileSync(claudeMdPath, updated + "\n", "utf-8");
  } else {
    const trimmed = existing.trimEnd();
    fs.writeFileSync(claudeMdPath, trimmed + "\n\n" + newBlock + "\n", "utf-8");
  }
}

import { getAppSetting } from "./app-settings";

export const SAFE_COMMANDS = [
  "ls", "cat", "echo", "grep", "find", "git", "node", "npm", "npx", "pnpm",
  "yarn", "pip", "pip3", "python", "python3", "tsc", "tsx", "eslint",
  "prettier", "jest", "vitest", "mocha", "cargo", "go", "rustc",
  "tar", "gzip", "unzip",
  "mkdir", "touch", "cp", "mv", "head", "tail", "wc", "sort", "uniq",
  "awk", "sed", "jq", "env", "export", "which", "type", "pwd", "cd",
  "diff", "patch", "make", "cmake", "ninja", "zip", "gunzip",
];

export const RESTRICTED_COMMANDS = [
  "docker", "docker-compose", "systemctl", "service", "journalctl",
  "apt", "apt-get", "snap", "brew", "yum", "dnf", "pacman",
  "nginx", "apache2", "pm2", "supervisorctl",
  "crontab", "at", "nohup", "screen", "tmux",
  "kill", "pkill", "killall",
  "useradd", "userdel", "usermod", "groupadd", "passwd",
  "mount", "umount", "fdisk", "parted",
  "netstat", "ss", "nmap", "tcpdump",
  "firewall-cmd", "ufw",
  "curl", "wget", "ssh", "scp", "rsync",
  "bash", "sh", "zsh", "fish", "dash",
];

export const DANGEROUS_COMMANDS = [
  "sudo", "eval",
  "mkfs", "shred",
  "iptables", "ip6tables",
  "shutdown", "reboot", "halt", "poweroff",
];

// Patterns that are always auto-denied regardless of settings
export const DANGEROUS_PATTERNS = [
  "sudo",
  "su -",
  "rm -rf /",
  "rm -rf ~",
  "rm -rf *",
  "chmod -R 777",
  "chmod -R 000",
  "chown -R",
  "mkfs",
  "dd if=/dev/zero",
  "dd if=/dev/urandom",
  "shred",
  "iptables",
  "ip6tables",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  ":(){ :|:& };:",
];

const SHELL_INTERPRETERS = ["bash", "sh", "zsh", "fish", "dash"];

export type SandboxCategory = "safe" | "restricted" | "dangerous" | "blocked" | "custom_blocked" | "whitelisted";

export interface ClassifyResult {
  category: SandboxCategory;
  displayName: string;
  reason?: string;
  warning?: string;
}

/**
 * Detect dangerous `rm` invocations: any `rm` with both recursive and force
 * flags, or `rm` targeting /, ~, ./, ../, or *.
 */
function isDangerousRm(normalized: string): string | null {
  const tokens = normalized.split(/\s+/);
  if (tokens[0] !== "rm") return null;

  const hasRecursive = tokens.some(t => t === "-r" || t === "--recursive" || (t.startsWith("-") && !t.startsWith("--") && t.includes("r")));
  const hasForce = tokens.some(t => t === "-f" || t === "--force" || (t.startsWith("-") && !t.startsWith("--") && t.includes("f")));

  if (hasRecursive && hasForce) {
    const targets = tokens.filter(t => !t.startsWith("-") && t !== "rm");
    const dangerousTargets = ["/", "~", "./", "../", "*"];
    for (const target of targets) {
      if (dangerousTargets.includes(target)) {
        return `Dangerous rm with recursive+force targeting ${target}`;
      }
    }
    return "Dangerous rm with both recursive and force flags";
  }

  return null;
}

function extractBasename(word: string): string {
  const slashIdx = word.lastIndexOf("/");
  return slashIdx >= 0 ? word.substring(slashIdx + 1) : word;
}

/**
 * Split a command string on shell compound operators (; && || |),
 * respecting quoted strings. Returns individual command segments.
 */
function splitCompoundCommand(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
    } else if (!inSingle && !inDouble) {
      if (ch === ";" || ch === "|") {
        if (ch === "|" && command[i + 1] === "|") {
          segments.push(current.trim());
          current = "";
          i += 2;
        } else {
          segments.push(current.trim());
          current = "";
          i++;
        }
      } else if (ch === "&" && command[i + 1] === "&") {
        segments.push(current.trim());
        current = "";
        i += 2;
      } else {
        current += ch;
        i++;
      }
    } else {
      current += ch;
      i++;
    }
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments.filter(s => s.length > 0);
}

/**
 * Extract commands from $(...) and backtick substitutions.
 */
function extractSubstitutionCommands(command: string): string[] {
  const results: string[] = [];

  // Match $(...)  — handles non-nested only
  const dollarParenRe = /\$\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = dollarParenRe.exec(command)) !== null) {
    results.push(match[1].trim());
  }

  // Match backtick substitutions
  const backtickRe = /`([^`]+)`/g;
  while ((match = backtickRe.exec(command)) !== null) {
    results.push(match[1].trim());
  }

  return results;
}

/**
 * If the command is a shell interpreter invocation with -c, extract the
 * argument string after -c for separate classification.
 */
function extractShellDashC(normalized: string, firstWord: string): string | null {
  if (!SHELL_INTERPRETERS.includes(firstWord)) return null;

  const dashCIdx = normalized.indexOf(" -c ");
  if (dashCIdx < 0) return null;

  let rest = normalized.substring(dashCIdx + 4).trim();
  // Strip surrounding quotes
  if ((rest.startsWith("'") && rest.endsWith("'")) || (rest.startsWith('"') && rest.endsWith('"'))) {
    rest = rest.slice(1, -1);
  }
  return rest || null;
}

const CATEGORY_SEVERITY: Record<SandboxCategory, number> = {
  safe: 0,
  whitelisted: 1,
  restricted: 2,
  dangerous: 3,
  custom_blocked: 4,
  blocked: 5,
};

function mostDangerous(a: ClassifyResult, b: ClassifyResult): ClassifyResult {
  return CATEGORY_SEVERITY[a.category] >= CATEGORY_SEVERITY[b.category] ? a : b;
}

/**
 * Classify a single simple command (no compound operators).
 */
function classifySingleCommand(normalized: string, originalDisplay: string): ClassifyResult {
  const tokens = normalized.split(/\s+/);
  const rawFirstWord = tokens[0] || "";
  const firstWord = extractBasename(rawFirstWord);

  // Check dangerous patterns first (S2-03)
  const rmDanger = isDangerousRm(normalized);
  if (rmDanger) {
    return { category: "blocked", displayName: originalDisplay, reason: rmDanger };
  }

  for (const dangerous of DANGEROUS_PATTERNS) {
    const dp = dangerous.toLowerCase();
    if (firstWord === dp || normalized.includes(dp)) {
      return {
        category: "blocked",
        displayName: originalDisplay,
        reason: `Dangerous command auto-blocked: ${dangerous}`,
      };
    }
  }

  if (DANGEROUS_COMMANDS.includes(firstWord)) {
    return {
      category: "blocked",
      displayName: originalDisplay,
      reason: `Dangerous command auto-blocked: ${firstWord}`,
    };
  }

  // Check custom always-blocked patterns
  try {
    const alwaysBlocked: string[] = JSON.parse(getAppSetting("sandbox_always_blocked", "[]"));
    for (const pattern of alwaysBlocked) {
      if (normalized.includes(pattern.toLowerCase().trim())) {
        return {
          category: "custom_blocked",
          displayName: originalDisplay,
          reason: `Command matches custom blocked pattern: ${pattern}`,
        };
      }
    }
  } catch {
    // ignore parse errors
  }

  // Check restricted
  if (RESTRICTED_COMMANDS.includes(firstWord)) {
    return {
      category: "restricted",
      displayName: originalDisplay,
      reason: `Restricted command requires explicit approval: ${firstWord}`,
    };
  }

  // Check safe list
  if (SAFE_COMMANDS.includes(firstWord)) {
    return { category: "safe", displayName: originalDisplay };
  }

  // Default: unknown commands are restricted
  return { category: "restricted", displayName: originalDisplay };
}

export function classifyCommand(command: string, options?: { skipPermissions?: boolean }): ClassifyResult {
  if (!command || typeof command !== "string") {
    return { category: "safe", displayName: "unknown" };
  }

  if (options?.skipPermissions) {
    return { category: "safe", displayName: command };
  }

  const normalized = command.trim().toLowerCase();

  // Dangerous patterns are checked before the whitelist (S2-03).
  // If the command matches both, we return whitelisted with a warning.
  let dangerousMatch: string | null = null;

  const rmDanger = isDangerousRm(normalized);
  if (rmDanger) {
    dangerousMatch = rmDanger;
  } else {
    for (const dangerous of DANGEROUS_PATTERNS) {
      const dp = dangerous.toLowerCase();
      const fw = extractBasename(normalized.split(/\s+/)[0] || "");
      if (fw === dp || normalized.includes(dp)) {
        dangerousMatch = `Dangerous command auto-blocked: ${dangerous}`;
        break;
      }
    }
    if (!dangerousMatch) {
      const fw = extractBasename(normalized.split(/\s+/)[0] || "");
      if (DANGEROUS_COMMANDS.includes(fw)) {
        dangerousMatch = `Dangerous command auto-blocked: ${fw}`;
      }
    }
  }

  // Check always-allowed whitelist (S2-03: runs after dangerous check)
  try {
    const alwaysAllowed: string[] = JSON.parse(getAppSetting("sandbox_always_allowed", "[]"));
    for (const pattern of alwaysAllowed) {
      const lp = pattern.toLowerCase().trim();
      if (normalized === lp || normalized.startsWith(lp + " ")) {
        const result: ClassifyResult = { category: "whitelisted", displayName: command };
        if (dangerousMatch) {
          result.warning = "This command matches a dangerous pattern";
        }
        return result;
      }
    }
  } catch {
    // ignore parse errors
  }

  // If dangerous and not whitelisted, block it
  if (dangerousMatch) {
    return { category: "blocked", displayName: command, reason: dangerousMatch };
  }

  // Check custom always-blocked patterns
  try {
    const alwaysBlocked: string[] = JSON.parse(getAppSetting("sandbox_always_blocked", "[]"));
    for (const pattern of alwaysBlocked) {
      if (normalized.includes(pattern.toLowerCase().trim())) {
        return {
          category: "custom_blocked",
          displayName: command,
          reason: `Command matches custom blocked pattern: ${pattern}`,
        };
      }
    }
  } catch {
    // ignore parse errors
  }

  // Split compound commands (S2-01)
  const segments = splitCompoundCommand(normalized);
  let worstResult: ClassifyResult = { category: "safe", displayName: command };

  for (const segment of segments) {
    const segResult = classifySingleCommand(segment, command);
    worstResult = mostDangerous(worstResult, segResult);

    // Check for command substitutions within this segment
    const substitutions = extractSubstitutionCommands(segment);
    for (const sub of substitutions) {
      const subResult = classifySingleCommand(sub, command);
      worstResult = mostDangerous(worstResult, subResult);
    }

    // Check for subshell -c invocations (S2-01)
    const segFirstWord = extractBasename(segment.split(/\s+/)[0] || "");
    const shellCmdBody = extractShellDashC(segment, segFirstWord);
    if (shellCmdBody) {
      const innerSegments = splitCompoundCommand(shellCmdBody);
      for (const inner of innerSegments) {
        const innerResult = classifySingleCommand(inner, command);
        worstResult = mostDangerous(worstResult, innerResult);
      }
    }
  }

  return worstResult;
}

export function isSandboxEnabled(): boolean {
  return getAppSetting("sandbox_enabled", "true") === "true";
}

import { getAppSetting } from "./app-settings";

export const SAFE_COMMANDS = [
  "ls", "cat", "echo", "grep", "find", "git", "node", "npm", "npx", "pnpm",
  "yarn", "pip", "pip3", "python", "python3", "tsc", "tsx", "eslint",
  "prettier", "jest", "vitest", "mocha", "cargo", "go", "rustc",
  "curl", "wget", "ssh", "scp", "rsync", "tar", "gzip", "unzip",
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

export type SandboxCategory = "safe" | "restricted" | "dangerous" | "blocked" | "custom_blocked" | "whitelisted";

export function classifyCommand(command: string): {
  category: SandboxCategory;
  displayName: string;
  reason?: string;
} {
  if (!command || typeof command !== "string") {
    return { category: "safe", displayName: "unknown" };
  }

  const normalized = command.trim().toLowerCase();
  const firstWord = normalized.split(/\s+/)[0];

  // Check always-allowed whitelist first
  try {
    const alwaysAllowed: string[] = JSON.parse(getAppSetting("sandbox_always_allowed", "[]"));
    for (const pattern of alwaysAllowed) {
      const lp = pattern.toLowerCase().trim();
      if (normalized === lp || normalized.startsWith(lp + " ")) {
        return { category: "whitelisted", displayName: command };
      }
    }
  } catch {
    // ignore parse errors
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

  // Check dangerous patterns (auto-block)
  for (const dangerous of DANGEROUS_PATTERNS) {
    if (firstWord === dangerous.toLowerCase() || normalized.includes(dangerous.toLowerCase())) {
      return {
        category: "blocked",
        displayName: command,
        reason: `Dangerous command auto-blocked: ${dangerous}`,
      };
    }
  }

  // Check restricted (warn, require explicit approval)
  for (const restricted of RESTRICTED_COMMANDS) {
    if (firstWord === restricted.toLowerCase()) {
      return {
        category: "restricted",
        displayName: command,
        reason: `Restricted command requires explicit approval: ${restricted}`,
      };
    }
  }

  // Default to safe
  return { category: "safe", displayName: command };
}

export function isSandboxEnabled(): boolean {
  return getAppSetting("sandbox_enabled", "true") === "true";
}

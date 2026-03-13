import type { HandlerContext } from "./types";
import { getAppSetting, setAppSetting } from "../lib/app-settings";
import { logActivity } from "../lib/activity-log";
import { DANGEROUS_PATTERNS, DANGEROUS_COMMANDS } from "../lib/command-sandbox";

function matchesDangerousPattern(pattern: string): boolean {
  const lp = pattern.toLowerCase().trim();
  for (const dp of DANGEROUS_PATTERNS) {
    if (lp === dp.toLowerCase() || lp.includes(dp.toLowerCase())) {
      return true;
    }
  }
  const firstWord = lp.split(/\s+/)[0] || "";
  if (DANGEROUS_COMMANDS.includes(firstWord)) {
    return true;
  }
  return false;
}

export function registerSecurityHandlers(ctx: HandlerContext) {
  const { socket, email, isAdmin } = ctx;

  socket.on(
    "claude:always_allow_command",
    ({ pattern }: { pattern: string }) => {
      if (!isAdmin) {
        socket.emit("claude:error", { message: "Admin only" });
        return;
      }

      if (!pattern || !pattern.trim()) {
        socket.emit("claude:error", { message: "Pattern cannot be empty" });
        return;
      }

      try {
        const current: string[] = JSON.parse(getAppSetting("sandbox_always_allowed", "[]"));
        if (!current.includes(pattern)) {
          current.push(pattern);
          setAppSetting("sandbox_always_allowed", JSON.stringify(current));
          logActivity("security_command_policy_changed", email, { action: "always_allow_added", pattern });
        }

        const isDangerous = matchesDangerousPattern(pattern);
        if (isDangerous) {
          socket.emit("claude:command_whitelisted", {
            pattern,
            warning: "Warning: this pattern matches a dangerous command",
          });
        }

        socket.emit("claude:always_allow_command_ack", { pattern, allowed: true });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );
}

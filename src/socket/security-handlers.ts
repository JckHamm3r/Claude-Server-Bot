import type { HandlerContext } from "./types";
import { getAppSetting, setAppSetting } from "../lib/app-settings";
import { logActivity } from "../lib/activity-log";

export function registerSecurityHandlers(ctx: HandlerContext) {
  const { socket, email, isAdmin } = ctx;

  socket.on(
    "claude:always_allow_command",
    ({ pattern }: { pattern: string }) => {
      if (!isAdmin) {
        socket.emit("claude:error", { message: "Admin only" });
        return;
      }
      try {
        const current: string[] = JSON.parse(getAppSetting("sandbox_always_allowed", "[]"));
        if (!current.includes(pattern)) {
          current.push(pattern);
          setAppSetting("sandbox_always_allowed", JSON.stringify(current));
          logActivity("security_command_policy_changed", email, { action: "always_allow_added", pattern });
        }
        socket.emit("claude:always_allow_command_ack", { pattern, allowed: true });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );
}

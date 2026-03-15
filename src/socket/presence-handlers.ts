import type { HandlerContext } from "./types";
import { logActivity } from "../lib/activity-log";
import {
  getInAppNotifications,
  getUnreadCount,
  markNotificationsRead,
  markAllNotificationsRead,
} from "../lib/notifications";
import { canAccessSession } from "../lib/claude-db";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

export function registerPresenceHandlers(ctx: HandlerContext) {
  const { socket, email, isAdmin } = ctx;

  // ── Typing indicators ─────────────────────────────────────────────────

  socket.on("claude:typing_start", ({ sessionId }: { sessionId: string }) => {
    if (!canAccessSession(sessionId, email)) return;
    socket.to(`session:${sessionId}`).emit("claude:typing", { email, typing: true });
  });

  socket.on("claude:typing_stop", ({ sessionId }: { sessionId: string }) => {
    if (!canAccessSession(sessionId, email)) return;
    socket.to(`session:${sessionId}`).emit("claude:typing", { email, typing: false });
  });

  // ── Notification handlers ─────────────────────────────────────────────

  socket.on("notification:get_all", () => {
    const notifications = getInAppNotifications(email);
    const unread = getUnreadCount(email);
    socket.emit("notification:list", { notifications, unread });
  });

  socket.on("notification:read", ({ ids, all }: { ids?: number[]; all?: boolean }) => {
    if (all) {
      markAllNotificationsRead(email);
    } else if (Array.isArray(ids)) {
      markNotificationsRead(email, ids);
    }
    socket.emit("notification:count", { unread: getUnreadCount(email) });
  });

  // ── Terminal (admin only) ────────────────────────────────────────────

  socket.on(
    "terminal:start",
    async ({ cols, rows }: { cols: number; rows: number }) => {
      if (!isAdmin) {
        socket.emit("claude:error", { message: "Terminal is admin-only" });
        return;
      }
      try {
        // Dynamic import for optional native module (may not be installed)
        const pty = await import("node-pty");
        const shell = process.env.SHELL ?? "/bin/bash";
        const ptyProcess = pty.spawn(shell, [], {
          name: "xterm-color",
          cols: cols ?? 80,
          rows: rows ?? 24,
          cwd: PROJECT_ROOT,
          env: process.env as Record<string, string>,
        });

        ctx.ptyProcesses.set(socket.id, ptyProcess);

        ptyProcess.onData((data: string) => {
          socket.emit("terminal:output", { data });
        });

        ptyProcess.onExit(() => {
          ctx.ptyProcesses.delete(socket.id);
          socket.emit("terminal:close");
        });
      } catch (err) {
        socket.emit("claude:error", { message: "Failed to start terminal: " + String(err) });
      }
    }
  );

  socket.on("terminal:input", ({ data }: { data: string }) => {
    const pty = ctx.ptyProcesses.get(socket.id);
    if (pty) pty.write(data);
  });

  socket.on("terminal:resize", ({ cols, rows }: { cols: number; rows: number }) => {
    const pty = ctx.ptyProcesses.get(socket.id);
    if (pty) {
      const safeCols = Math.max(1, Math.min(500, Number(cols) || 80));
      const safeRows = Math.max(1, Math.min(200, Number(rows) || 24));
      pty.resize(safeCols, safeRows);
    }
  });

  socket.on("terminal:close", () => {
    const pty = ctx.ptyProcesses.get(socket.id);
    if (pty) {
      pty.kill();
      ctx.ptyProcesses.delete(socket.id);
    }
  });

  // ── Disconnect ────────────────────────────────────────────────────────

  socket.on("disconnect", () => {
    logActivity("user_logout", email);

    // Kill terminal if active
    const pty = ctx.ptyProcesses.get(socket.id);
    if (pty) {
      try { pty.kill(); } catch { /* ignore */ }
      ctx.ptyProcesses.delete(socket.id);
    }

    // Clean up session maps for sessions owned by this socket
    const userInfo = ctx.connectedUsers.get(socket.id);
    if (userInfo?.activeSession) {
      // Don't delete command submitter — the command may still be running
    }

    // Clean up rate-limit command counts for this user
    for (const [key] of ctx.userSessionCommands) {
      if (key === email) {
        ctx.userSessionCommands.delete(key);
      }
    }

    ctx.connectedUsers.delete(socket.id);
    ctx.broadcastPresence();
  });
}

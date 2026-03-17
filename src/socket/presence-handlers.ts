import type { HandlerContext } from "./types";
import { logActivity } from "../lib/activity-log";
import {
  getInAppNotifications,
  getUnreadCount,
  markNotificationsRead,
  markAllNotificationsRead,
} from "../lib/notifications";
import { canAccessSession } from "../lib/claude-db";
import db from "../lib/db";

export function registerPresenceHandlers(ctx: HandlerContext) {
  const { socket, email } = ctx;

  // ── Typing indicators ─────────────────────────────────────────────────

  socket.on("claude:typing_start", ({ sessionId }: { sessionId: string }) => {
    if (!canAccessSession(sessionId, email)) return;
    
    const user = db.prepare("SELECT first_name, last_name, avatar_url FROM users WHERE email = ?").get(email) as 
      { first_name: string; last_name: string; avatar_url: string | null } | undefined;
    
    socket.to(`session:${sessionId}`).emit("claude:typing", { 
      email, 
      typing: true,
      firstName: user?.first_name || "",
      lastName: user?.last_name || "",
      avatarUrl: user?.avatar_url || null,
    });
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
  // Terminal handlers are now managed in terminal-handlers.ts

  // ── Disconnect ────────────────────────────────────────────────────────

  socket.on("disconnect", () => {
    logActivity("user_logout", email);

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

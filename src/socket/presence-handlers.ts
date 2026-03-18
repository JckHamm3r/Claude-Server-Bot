import type { HandlerContext } from "./types";
import { logActivity } from "../lib/activity-log";
import {
  getInAppNotifications,
  getUnreadCount,
  markNotificationsRead,
  markAllNotificationsRead,
} from "../lib/notifications";
import { canAccessSession } from "../lib/claude-db";
import { dbGet } from "../lib/db";

export function registerPresenceHandlers(ctx: HandlerContext) {
  const { socket, email } = ctx;

  // ── Typing indicators ─────────────────────────────────────────────────

  socket.on("claude:typing_start", async ({ sessionId }: { sessionId: string }) => {
    if (!await canAccessSession(sessionId, email)) return;
    
    const user = await dbGet<{ first_name: string; last_name: string; avatar_url: string | null }>(
      "SELECT first_name, last_name, avatar_url FROM users WHERE email = ?",
      [email]
    );
    
    socket.to(`session:${sessionId}`).emit("claude:typing", { 
      email, 
      typing: true,
      firstName: user?.first_name || "",
      lastName: user?.last_name || "",
      avatarUrl: user?.avatar_url || null,
    });
  });

  socket.on("claude:typing_stop", async ({ sessionId }: { sessionId: string }) => {
    if (!await canAccessSession(sessionId, email)) return;
    socket.to(`session:${sessionId}`).emit("claude:typing", { email, typing: false });
  });

  // ── Notification handlers ─────────────────────────────────────────────

  socket.on("notification:get_all", async () => {
    const notifications = await getInAppNotifications(email);
    const unread = await getUnreadCount(email);
    socket.emit("notification:list", { notifications, unread });
  });

  socket.on("notification:read", async ({ ids, all }: { ids?: number[]; all?: boolean }) => {
    if (all) {
      await markAllNotificationsRead(email);
    } else if (Array.isArray(ids)) {
      await markNotificationsRead(email, ids);
    }
    socket.emit("notification:count", { unread: await getUnreadCount(email) });
  });

  // ── Terminal (admin only) ────────────────────────────────────────────
  // Terminal handlers are now managed in terminal-handlers.ts

  // ── Disconnect ────────────────────────────────────────────────────────

  socket.on("disconnect", async () => {
    await logActivity("user_logout", email);

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

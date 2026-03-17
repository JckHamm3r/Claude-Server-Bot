import { exec, execSync } from "child_process";
import { promisify } from "util";
import type { HandlerContext } from "./types";
import {
  getTerminalSessions,
  getTerminalSession,
  createTerminalSession,
  updateTerminalSessionName,
  updateTerminalSessionCwd,
  updateTerminalScrollback,
  touchTerminalSession,
  deleteTerminalSession,
  reorderTerminalSessions,
  countTerminalSessions,
  getBookmarks,
  addBookmark,
  removeBookmark,
  getShares,
  addShare,
  removeShare,
  getSharedSessionsForUser,
  canAccessTerminalSession,
  MAX_TABS_PER_USER,
  MAX_SCROLLBACK_LINES,
  type TerminalSession,
} from "../lib/terminal-db";
import db from "../lib/db";

const execAsync = promisify(exec);
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

// ── In-memory state ────────────────────────────────────────────────────────

// tabId -> pty process
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const terminalPtyProcesses = new Map<string, any>();

// tabId -> rolling scrollback buffer (lines)
const scrollbackBuffers = new Map<string, string[]>();

// tabId -> line count (for bookmark tracking)
const lineCounters = new Map<string, number>();

// tabId -> flush timer
const scrollbackFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

// tabId -> active socket ids (for shared sessions: owner + invited)
const tabSocketMap = new Map<string, Set<string>>();

const SCROLLBACK_FLUSH_MS = 30_000; // flush to DB every 30s

// ── Helpers ────────────────────────────────────────────────────────────────

function tmuxSessionExists(tmuxName: string): boolean {
  try {
    execSync(`tmux has-session -t ${tmuxName} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

async function createTmuxSession(tmuxName: string, cwd: string): Promise<void> {
  const startDir = cwd || PROJECT_ROOT;
  await execAsync(`tmux new-session -d -s ${tmuxName} -x 220 -y 50 -c ${JSON.stringify(startDir)}`);
}

async function ensureTmuxSession(session: TerminalSession): Promise<void> {
  if (!tmuxSessionExists(session.tmux_session_name)) {
    await createTmuxSession(session.tmux_session_name, session.cwd || PROJECT_ROOT);
  }
  // If it already exists, that's fine — reuse it
}

function appendToScrollback(tabId: string, data: string) {
  if (!scrollbackBuffers.has(tabId)) {
    scrollbackBuffers.set(tabId, []);
  }
  const buf = scrollbackBuffers.get(tabId)!;

  // Split data into lines, track count
  const lines = data.split(/\r?\n/);
  buf.push(...lines);

  // Track line count for bookmarks
  const current = lineCounters.get(tabId) ?? 0;
  lineCounters.set(tabId, current + lines.length);

  // Keep only last MAX_SCROLLBACK_LINES
  if (buf.length > MAX_SCROLLBACK_LINES) {
    buf.splice(0, buf.length - MAX_SCROLLBACK_LINES);
  }
}

function scheduleScrollbackFlush(tabId: string) {
  const existing = scrollbackFlushTimers.get(tabId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    flushScrollback(tabId);
    scrollbackFlushTimers.delete(tabId);
  }, SCROLLBACK_FLUSH_MS);
  scrollbackFlushTimers.set(tabId, timer);
}

function flushScrollback(tabId: string) {
  const buf = scrollbackBuffers.get(tabId);
  if (!buf) return;
  try {
    updateTerminalScrollback(tabId, buf);
  } catch { /* ignore */ }
}

function flushAllScrollbacks() {
  for (const [tabId] of scrollbackBuffers) {
    flushScrollback(tabId);
  }
}

// Flush scrollbacks every 30s regardless of activity
setInterval(flushAllScrollbacks, SCROLLBACK_FLUSH_MS);

function getOrCreateTabSocketSet(tabId: string): Set<string> {
  if (!tabSocketMap.has(tabId)) tabSocketMap.set(tabId, new Set());
  return tabSocketMap.get(tabId)!;
}

// ── Ensure default session exists ──────────────────────────────────────────

export function ensureDefaultTerminalSession(userEmail: string): TerminalSession {
  const sessions = getTerminalSessions(userEmail);
  if (sessions.length === 0) {
    return createTerminalSession(userEmail, "Terminal", true);
  }
  return sessions[0];
}

// ── On server startup: verify tmux sessions for all DB entries ──────────────

export async function reconcileTmuxSessions() {
  try {
    const rows = db.prepare("SELECT * FROM terminal_sessions").all() as TerminalSession[];
    for (const session of rows) {
      if (!tmuxSessionExists(session.tmux_session_name)) {
        // Recreate tmux session; it was lost (server restart etc.)
        try {
          await createTmuxSession(session.tmux_session_name, session.cwd || PROJECT_ROOT);
          console.log(`[terminal] Recreated tmux session: ${session.tmux_session_name}`);
        } catch (err) {
          console.warn(`[terminal] Could not recreate tmux session ${session.tmux_session_name}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[terminal] reconcileTmuxSessions error:", err);
  }
}

// ── Kill idle sessions (30-min idle) ──────────────────────────────────────

export function cleanupIdleTerminalSessions() {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
    const idleSessions = db.prepare(`
      SELECT * FROM terminal_sessions WHERE last_active_at < ?
    `).all(cutoff) as TerminalSession[];

    for (const session of idleSessions) {
      // Kill tmux session if alive
      if (tmuxSessionExists(session.tmux_session_name)) {
        try {
          execSync(`tmux kill-session -t ${session.tmux_session_name}`);
        } catch { /* ignore */ }
      }
      // Flush scrollback then clear PTY ref
      flushScrollback(session.id);
      terminalPtyProcesses.delete(session.id);
    }
  } catch { /* ignore */ }
}

// Run cleanup every 5 minutes
setInterval(cleanupIdleTerminalSessions, 5 * 60 * 1000);

// ── Shutdown ──────────────────────────────────────────────────────────────

export function shutdownTerminals() {
  flushAllScrollbacks();
  for (const [, pty] of terminalPtyProcesses) {
    try { pty.kill?.(); } catch { /* best-effort */ }
  }
  terminalPtyProcesses.clear();
}

// ── Socket handler registration ───────────────────────────────────────────

export function registerTerminalHandlers(ctx: HandlerContext) {
  const { socket, email, isAdmin, io } = ctx;

  if (!isAdmin) {
    // Non-admins: still allow shared terminal access (checked per-event)
  }

  // ── terminal:list ──────────────────────────────────────────────────────
  socket.on("terminal:list", () => {
    try {
      ensureDefaultTerminalSession(email);
      const owned = getTerminalSessions(email);
      const shared = getSharedSessionsForUser(email);
      socket.emit("terminal:sessions", { owned, shared });
    } catch (err) {
      socket.emit("claude:error", { message: "Failed to list terminal sessions: " + String(err) });
    }
  });

  // ── terminal:create ────────────────────────────────────────────────────
  socket.on("terminal:create", async ({ name }: { name?: string }) => {
    if (!isAdmin) {
      socket.emit("claude:error", { message: "Terminal is admin-only" });
      return;
    }
    try {
      const count = countTerminalSessions(email);
      if (count >= MAX_TABS_PER_USER) {
        socket.emit("terminal:error", { message: `Maximum ${MAX_TABS_PER_USER} terminal tabs allowed` });
        return;
      }
      const tabName = name || `Terminal ${count + 1}`;
      const session = createTerminalSession(email, tabName);
      await ensureTmuxSession(session);
      socket.emit("terminal:created", { session });
    } catch (err) {
      socket.emit("terminal:error", { message: "Failed to create terminal: " + String(err) });
    }
  });

  // ── terminal:attach ────────────────────────────────────────────────────
  socket.on(
    "terminal:attach",
    async ({ tabId, cols, rows }: { tabId: string; cols: number; rows: number }) => {
      try {
        const session = getTerminalSession(tabId);
        if (!session) {
          socket.emit("terminal:error", { message: "Terminal session not found" });
          return;
        }
        if (!canAccessTerminalSession(tabId, email)) {
          socket.emit("terminal:error", { message: "Access denied" });
          return;
        }

        // If already has a live PTY for this tab, detach old socket listeners only
        const existingPty = terminalPtyProcesses.get(tabId);
        if (existingPty) {
          // Just add this socket to the tab's listener set and replay scrollback
          const sockets = getOrCreateTabSocketSet(tabId);
          sockets.add(socket.id);

          const scrollback = scrollbackBuffers.get(tabId)
            ?? JSON.parse(session.scrollback_json || "[]") as string[];
          socket.emit("terminal:scrollback", { tabId, lines: scrollback });
          socket.emit("terminal:attached", { tabId });
          return;
        }

        // Ensure tmux session exists (for scrollback capture and process tracking)
        await ensureTmuxSession(session);

        // Spawn shell directly via node-pty (NOT tmux attach-session — that renders
        // the full tmux UI with status bars which corrupts xterm output).
        // We keep this PTY alive server-side between browser detach/attach cycles.
        const pty = await import("node-pty");
        const safeCols = Math.max(1, Math.min(500, Number(cols) || 80));
        const safeRows = Math.max(1, Math.min(200, Number(rows) || 24));
        const shell = process.env.SHELL ?? "/bin/bash";

        const ptyProcess = pty.spawn(shell, [], {
          name: "xterm-color",
          cols: safeCols,
          rows: safeRows,
          cwd: session.cwd || PROJECT_ROOT,
          env: {
            ...(process.env as Record<string, string>),
            TERM: "xterm-color",
            TMUX: "",  // clear TMUX env so nested tmux is not confused
          },
        });

        terminalPtyProcesses.set(tabId, ptyProcess);
        const sockets = getOrCreateTabSocketSet(tabId);
        sockets.add(socket.id);

        ptyProcess.onData((data: string) => {
          appendToScrollback(tabId, data);
          scheduleScrollbackFlush(tabId);

          // Parse OSC 7 (CWD tracking): \x1b]7;file://hostname/path\x07 or \x1b]7;/path\x1b\\
          const oscMatch = data.match(/\x1b\]7;(?:file:\/\/[^\/]*)?([^\x07\x1b]+)[\x07\x1b]/);
          if (oscMatch) {
            const newCwd = oscMatch[1];
            updateTerminalSessionCwd(tabId, newCwd);
            // Broadcast CWD update to all sockets watching this tab
            const watching = tabSocketMap.get(tabId);
            if (watching) {
              for (const sid of watching) {
                io.to(sid).emit("terminal:cwd", { tabId, cwd: newCwd });
              }
            }
          }

          // Broadcast output to all sockets watching this tab
          const watching = tabSocketMap.get(tabId);
          if (watching) {
            for (const sid of watching) {
              io.to(sid).emit("terminal:output", { tabId, data });
            }
          }
        });

        ptyProcess.onExit(() => {
          flushScrollback(tabId);
          terminalPtyProcesses.delete(tabId);
          tabSocketMap.delete(tabId);
          lineCounters.delete(tabId);
          const watching = tabSocketMap.get(tabId);
          if (watching) {
            for (const sid of watching) {
              io.to(sid).emit("terminal:closed", { tabId });
            }
          }
        });

        // Replay scrollback only if we have an active in-memory buffer
        // (means this is a reconnect to a session that already had output).
        // On a fresh PTY spawn (new session or server restart), don't replay
        // stale DB scrollback as it pushes new output off screen.
        const activeBuffer = scrollbackBuffers.get(tabId);
        if (activeBuffer && activeBuffer.length > 0) {
          socket.emit("terminal:scrollback", { tabId, lines: activeBuffer });
        } else {
          // Seed the in-memory buffer from DB so future reconnects have scrollback
          const storedLines = JSON.parse(session.scrollback_json || "[]") as string[];
          if (storedLines.length > 0) {
            scrollbackBuffers.set(tabId, storedLines);
          }
        }

        // Small delay to let the PTY initialize before client sends resize
        setTimeout(() => {
          socket.emit("terminal:attached", { tabId });
        }, 100);
        touchTerminalSession(tabId);
      } catch (err) {
        socket.emit("terminal:error", { message: "Failed to attach to terminal: " + String(err) });
      }
    }
  );

  // ── terminal:detach ────────────────────────────────────────────────────
  socket.on("terminal:detach", ({ tabId }: { tabId: string }) => {
    const sockets = tabSocketMap.get(tabId);
    if (sockets) sockets.delete(socket.id);
    // PTY stays alive — we just remove this socket from the watcher set.
    // The process continues running on the server.
    flushScrollback(tabId);
  });

  // ── terminal:input ─────────────────────────────────────────────────────
  socket.on("terminal:input", ({ tabId, data }: { tabId: string; data: string }) => {
    if (!canAccessTerminalSession(tabId, email)) return;
    const pty = terminalPtyProcesses.get(tabId);
    if (pty) pty.write(data);
    touchTerminalSession(tabId);
  });

  // ── terminal:resize ────────────────────────────────────────────────────
  socket.on("terminal:resize", ({ tabId, cols, rows }: { tabId: string; cols: number; rows: number }) => {
    if (!canAccessTerminalSession(tabId, email)) return;
    const pty = terminalPtyProcesses.get(tabId);
    if (pty) {
      const safeCols = Math.max(1, Math.min(500, Number(cols) || 80));
      const safeRows = Math.max(1, Math.min(200, Number(rows) || 24));
      pty.resize(safeCols, safeRows);
    }
  });

  // ── terminal:destroy ───────────────────────────────────────────────────
  socket.on("terminal:destroy", async ({ tabId }: { tabId: string }) => {
    if (!isAdmin) return;
    const session = getTerminalSession(tabId);
    if (!session || session.user_email !== email) {
      socket.emit("terminal:error", { message: "Cannot destroy: not owner" });
      return;
    }
    if (session.is_default) {
      socket.emit("terminal:error", { message: "Cannot destroy the default terminal tab" });
      return;
    }

    // Kill tmux session
    if (tmuxSessionExists(session.tmux_session_name)) {
      try { execSync(`tmux kill-session -t ${session.tmux_session_name}`); } catch { /* ignore */ }
    }

    // Kill PTY if live
    const pty = terminalPtyProcesses.get(tabId);
    if (pty) {
      try { pty.kill?.(); } catch { /* ignore */ }
      terminalPtyProcesses.delete(tabId);
    }

    tabSocketMap.delete(tabId);
    scrollbackBuffers.delete(tabId);
    lineCounters.delete(tabId);
    deleteTerminalSession(tabId);

    socket.emit("terminal:destroyed", { tabId });
  });

  // ── terminal:rename ────────────────────────────────────────────────────
  socket.on("terminal:rename", ({ tabId, name }: { tabId: string; name: string }) => {
    if (!isAdmin) return;
    if (!canAccessTerminalSession(tabId, email)) return;
    const trimmed = name.trim().slice(0, 64) || "Terminal";
    updateTerminalSessionName(tabId, trimmed);
    // Notify all watchers
    const watching = tabSocketMap.get(tabId);
    if (watching) {
      for (const sid of watching) {
        io.to(sid).emit("terminal:renamed", { tabId, name: trimmed });
      }
    }
    socket.emit("terminal:renamed", { tabId, name: trimmed });
  });

  // ── terminal:reorder ──────────────────────────────────────────────────
  socket.on("terminal:reorder", ({ orderedIds }: { orderedIds: string[] }) => {
    if (!isAdmin) return;
    reorderTerminalSessions(email, orderedIds);
    socket.emit("terminal:reordered", { orderedIds });
  });

  // ── terminal:auto_name ─────────────────────────────────────────────────
  // Called by frontend after first command to set a meaningful name
  socket.on("terminal:auto_name", ({ tabId, name }: { tabId: string; name: string }) => {
    if (!isAdmin) return;
    if (!canAccessTerminalSession(tabId, email)) return;
    const session = getTerminalSession(tabId);
    if (!session) return;
    // Only auto-name if name is still the default
    if (session.name === "Terminal" || session.name.match(/^Terminal \d+$/)) {
      const trimmed = name.trim().slice(0, 64);
      if (trimmed) {
        updateTerminalSessionName(tabId, trimmed);
        socket.emit("terminal:renamed", { tabId, name: trimmed });
      }
    }
  });

  // ── terminal:bookmark:add ─────────────────────────────────────────────
  socket.on(
    "terminal:bookmark:add",
    ({ tabId, lineIndex, label, color }: { tabId: string; lineIndex: number; label: string; color?: string }) => {
      if (!canAccessTerminalSession(tabId, email)) return;
      const bookmark = addBookmark(tabId, lineIndex, label, color);
      socket.emit("terminal:bookmark:added", { tabId, bookmark });
    }
  );

  // ── terminal:bookmark:remove ──────────────────────────────────────────
  socket.on("terminal:bookmark:remove", ({ bookmarkId }: { bookmarkId: string }) => {
    removeBookmark(bookmarkId, email);
    socket.emit("terminal:bookmark:removed", { bookmarkId });
  });

  // ── terminal:bookmark:list ────────────────────────────────────────────
  socket.on("terminal:bookmark:list", ({ tabId }: { tabId: string }) => {
    if (!canAccessTerminalSession(tabId, email)) return;
    const bookmarks = getBookmarks(tabId);
    socket.emit("terminal:bookmark:list", { tabId, bookmarks });
  });

  // ── terminal:share:invite ─────────────────────────────────────────────
  socket.on(
    "terminal:share:invite",
    ({ tabId, invitedEmail }: { tabId: string; invitedEmail: string }) => {
      if (!isAdmin) return;
      const session = getTerminalSession(tabId);
      if (!session || session.user_email !== email) {
        socket.emit("terminal:error", { message: "Only the owner can share a terminal" });
        return;
      }
      // Verify invited user is an admin
      const invitedUser = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(invitedEmail) as { is_admin: number } | undefined;
      if (!invitedUser?.is_admin) {
        socket.emit("terminal:error", { message: "Can only share with admin users" });
        return;
      }
      const share = addShare(tabId, email, invitedEmail);
      socket.emit("terminal:share:added", { tabId, share });
      // Notify the invited user if they're online
      for (const [sid, info] of (ctx.connectedUsers as Map<string, { email: string }>).entries()) {
        if (info.email === invitedEmail) {
          io.to(sid).emit("terminal:share:received", { session, invitedBy: email });
        }
      }
    }
  );

  // ── terminal:share:revoke ─────────────────────────────────────────────
  socket.on(
    "terminal:share:revoke",
    ({ tabId, invitedEmail }: { tabId: string; invitedEmail: string }) => {
      if (!isAdmin) return;
      const session = getTerminalSession(tabId);
      if (!session || session.user_email !== email) return;
      removeShare(tabId, email, invitedEmail);
      socket.emit("terminal:share:revoked", { tabId, invitedEmail });
      // Remove invited user from active tab watchers
      const watching = tabSocketMap.get(tabId);
      if (watching) {
        for (const [sid, info] of (ctx.connectedUsers as Map<string, { email: string }>).entries()) {
          if (info.email === invitedEmail && watching.has(sid)) {
            watching.delete(sid);
            io.to(sid).emit("terminal:share:removed", { tabId });
          }
        }
      }
    }
  );

  // ── terminal:share:list ───────────────────────────────────────────────
  socket.on("terminal:share:list", ({ tabId }: { tabId: string }) => {
    if (!canAccessTerminalSession(tabId, email)) return;
    const shares = getShares(tabId);
    socket.emit("terminal:share:list", { tabId, shares });
  });

  // ── terminal:history ──────────────────────────────────────────────────
  // Fetch native shell history + in-memory scrollback for search
  socket.on("terminal:history:get", async ({ tabId }: { tabId: string }) => {
    if (!canAccessTerminalSession(tabId, email)) return;
    try {
      const session = getTerminalSession(tabId);
      const tmuxName = session?.tmux_session_name;
      let shellHistory: string[] = [];

      // Try to read shell history file
      const shell = process.env.SHELL ?? "/bin/bash";
      let histFile = "";
      if (shell.includes("zsh")) {
        histFile = `${process.env.HOME}/.zsh_history`;
      } else {
        histFile = `${process.env.HOME}/.bash_history`;
      }

      try {
        const { stdout } = await execAsync(`cat ${histFile} 2>/dev/null | tail -n 1000`);
        // Parse zsh extended history (: timestamp:elapsed;command) or plain bash history
        shellHistory = stdout
          .split("\n")
          .map(l => l.replace(/^: \d+:\d+;/, "").trim())
          .filter(l => l.length > 0);
      } catch { /* ignore */ }

      // Also get tmux pane history if available
      let tmuxHistory: string[] = [];
      if (tmuxName && tmuxSessionExists(tmuxName)) {
        try {
          const { stdout } = await execAsync(`tmux capture-pane -t ${tmuxName} -p -S -${MAX_SCROLLBACK_LINES}`);
          tmuxHistory = stdout.split("\n").filter(l => l.trim().length > 0);
        } catch { /* ignore */ }
      }

      const scrollback = scrollbackBuffers.get(tabId)
        ?? JSON.parse(session?.scrollback_json || "[]") as string[];

      socket.emit("terminal:history:data", {
        tabId,
        shellHistory,
        tmuxHistory,
        scrollback,
      });
    } catch {
      socket.emit("terminal:history:data", { tabId, shellHistory: [], tmuxHistory: [], scrollback: [] });
    }
  });

  // ── Legacy terminal:start (backward compat) ────────────────────────────
  socket.on(
    "terminal:start",
    async ({ cols, rows }: { cols: number; rows: number }) => {
      if (!isAdmin) {
        socket.emit("claude:error", { message: "Terminal is admin-only" });
        return;
      }
      // Create or get default session
      const session = ensureDefaultTerminalSession(email);
      socket.emit("terminal:sessions", {
        owned: getTerminalSessions(email),
        shared: getSharedSessionsForUser(email),
      });
      // Auto-attach to default tab
      socket.emit("terminal:auto_attach", { tabId: session.id, cols, rows });
    }
  );

  // ── Disconnect: keep PTY alive, just unsubscribe this socket ────────────
  socket.on("disconnect", () => {
    for (const [tabId, sockets] of tabSocketMap.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        flushScrollback(tabId);
      }
    }
  });
}

import type { Server, Socket } from "socket.io";
import { getClaudeProvider } from "../lib/claude";
import type { ClaudeCodeProvider, TokenUsage } from "../lib/claude/provider";
import { saveMessage, updateSessionStatus, updateClaudeSessionId, getSession, getMessages, getUserSettings, renameSession, listSessions, getUser } from "../lib/claude-db";
import type { SessionStatus } from "../lib/claude-db";
import { generateSessionName } from "../lib/claude/session-namer";
import { getToken } from "next-auth/jwt";
import { logActivity } from "../lib/activity-log";
import { getAppSetting } from "../lib/app-settings";
import {
  getUnreadCount,
  setNotificationEmitter,
  type InAppNotification,
} from "../lib/notifications";
import { setBroadcaster } from "../lib/broadcast";
import { checkProtectedPath } from "../lib/security-guard";
import { classifyCommand, isSandboxEnabled } from "../lib/command-sandbox";
import { cleanupExpiredBlocks } from "../lib/ip-protection";
import db from "../lib/db";
import type { HandlerContext, PlanAction } from "./types";
import { registerSessionHandlers } from "./session-handlers";
import { registerMessageHandlers } from "./message-handlers";
import { registerSecurityHandlers } from "./security-handlers";
import { registerPresenceHandlers } from "./presence-handlers";
import { registerPlanHandlers } from "./plan-handlers";
import { registerTerminalHandlers, reconcileTmuxSessions, shutdownTerminals } from "./terminal-handlers";
import { registerJobHandlers } from "./job-handlers";
import { 
  lockEventEmitter, 
  initFileLockManager, 
  cancelQueuedOperation,
  getSessionQueuedOperations 
} from "../lib/file-lock-manager";

// ── Auth helpers ──────────────────────────────────────────────────────────────

function makeMockReq(socket: Socket) {
  const cookieHeader = socket.handshake.headers.cookie ?? "";
  return {
    headers: { cookie: cookieHeader },
    cookies: Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [k, ...rest] = c.trim().split("=");
        let value = rest.join("=");
        try {
          value = decodeURIComponent(value);
        } catch {
          /* leave raw on malformed values */
        }
        return [k, value];
      }),
    ),
  } as Parameters<typeof getToken>[0]["req"];
}

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "";
if (!NEXTAUTH_SECRET) {
  console.warn("WARNING: NEXTAUTH_SECRET is not set — socket authentication will fail");
}

const NEXTAUTH_COOKIE =
  (process.env.NEXTAUTH_URL ?? "").startsWith("https")
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";

async function getTokenFromSocket(socket: Socket) {
  const req = makeMockReq(socket);
  try {
    const token = await getToken({
      req,
      secret: NEXTAUTH_SECRET,
      cookieName: NEXTAUTH_COOKIE,
      secureCookie: NEXTAUTH_COOKIE.startsWith("__Secure-"),
    });
    return token;
  } catch (err) {
    console.error("[socket] getToken error:", err);
    return null;
  }
}

async function verifySocket(socket: Socket): Promise<boolean> {
  try {
    const token = await getTokenFromSocket(socket);
    if (!token) return false;
    const email = (token.email as string) ?? "";
    if (!email) return false;
    const user = db.prepare("SELECT email FROM users WHERE email = ?").get(email);
    return !!user;
  } catch {
    return false;
  }
}

async function getEmailFromSocket(socket: Socket): Promise<string> {
  try {
    const token = await getTokenFromSocket(socket);
    return (token?.email as string) ?? "";
  } catch {
    return "";
  }
}

async function isAdminSocket(socket: Socket): Promise<boolean> {
  try {
    const token = await getTokenFromSocket(socket);
    return Boolean((token as Record<string, unknown>)?.isAdmin);
  } catch {
    return false;
  }
}

// ── Module-level state ──────────────────────────────────────────────────────

const connectedUsers = new Map<string, { email: string; activeSession: string | null }>();
const sessionStreamingContent = new Map<string, string>();
const sessionListeners = new Set<string>();
const sessionCommandSubmitter = new Map<string, string>();
const sessionStartTimes = new Map<string, number>();
const userSessionCommands = new Map<string, Map<string, number>>();
const sessionCmdStartTimes = new Map<string, number>();

// Ring buffer of recent output events per session for replay on reconnect.
// Capped at MAX_EVENT_BUFFER_SIZE; cleared on "done".
const MAX_EVENT_BUFFER_SIZE = 50;
const sessionEventBuffers = new Map<string, { sessionId: string; parsed: unknown; submittedBy?: string }[]>();

// Throttle streaming events to avoid flooding the Socket.IO connection.
const STREAMING_THROTTLE_MS = 50;
const sessionStreamingThrottles = new Map<string, {
  timer: ReturnType<typeof setTimeout>;
  pending: { sessionId: string; parsed: unknown; submittedBy?: string } | null;
}>();

const MAX_LATENCIES = 10000;

// In-memory metrics counter (flushed to DB every minute)
let metricsBuffer = { session_count: 0, command_count: 0, agent_count: 0, latencies: [] as number[] };
let lastMetricsFlush = Date.now();

function flushMetrics() {
  if (
    metricsBuffer.session_count === 0 &&
    metricsBuffer.command_count === 0 &&
    metricsBuffer.agent_count === 0
  ) {
    return;
  }
  const avg = metricsBuffer.latencies.length
    ? Math.round(metricsBuffer.latencies.reduce((a, b) => a + b, 0) / metricsBuffer.latencies.length)
    : 0;
  try {
    db.prepare(
      "INSERT INTO metrics (session_count, command_count, agent_count, avg_response_ms) VALUES (?, ?, ?, ?)"
    ).run(
      metricsBuffer.session_count,
      metricsBuffer.command_count,
      metricsBuffer.agent_count,
      avg
    );
    // Purge metrics older than 30 days
    db.prepare("DELETE FROM metrics WHERE recorded_at < datetime('now', '-30 days')").run();
  } catch {
    // ignore
  }
  metricsBuffer = { session_count: 0, command_count: 0, agent_count: 0, latencies: [] };
}

function runRetentionCleanup() {
  try {
    db.prepare("DELETE FROM activity_log WHERE timestamp < datetime('now', '-30 days')").run();
    db.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-30 days')").run();
  } catch {
    // ignore
  }

  try {
    const retentionDays = parseInt(
      (db.prepare("SELECT value FROM app_settings WHERE key = 'message_retention_days'").get() as { value: string } | undefined)?.value ?? "0",
      10,
    );
    if (retentionDays > 0) {
      const modifier = `-${retentionDays} days`;
      db.prepare(
        "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE updated_at < datetime('now', ?))",
      ).run(modifier);
      db.prepare("DELETE FROM sessions WHERE updated_at < datetime('now', ?) AND id NOT IN (SELECT DISTINCT session_id FROM messages)").run(modifier);
    }
  } catch {
    // ignore
  }
}

let metricsInterval: NodeJS.Timeout | undefined;
let cleanupInterval: NodeJS.Timeout | undefined;

const planResumeCallbacks = new Map<string, (action: PlanAction) => void>();

// Active PTY sessions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ptyProcesses = new Map<string, any>();

// Per-session provider tracking
const sessionProviders = new Map<string, ClaudeCodeProvider>();
// Per-session pending usage (captured between streaming and done)
const sessionPendingUsage = new Map<string, TokenUsage>();

// ── Helpers ─────────────────────────────────────────────────────────────────

function broadcastPresence(io: Server) {
  const presence = Array.from(connectedUsers.values());
  io.emit("claude:presence_update", { presence });
}

function getSessionProvider(sessionId: string, providerType?: string): ClaudeCodeProvider {
  if (!sessionProviders.has(sessionId)) {
    sessionProviders.set(sessionId, getClaudeProvider(providerType));
  }
  return sessionProviders.get(sessionId)!;
}

function checkRateLimit(email: string, sessionId: string): { ok: boolean; reason?: string } {
  const maxCommands = parseInt(getAppSetting("rate_limit_commands", "100"), 10);
  const maxRuntimeMin = parseInt(getAppSetting("rate_limit_runtime_min", "30"), 10);
  const maxConcurrent = parseInt(getAppSetting("rate_limit_concurrent", "0"), 10);

  // Count actually-running sessions for this user (0 = unlimited)
  if (maxConcurrent > 0) {
    let runningCount = 0;
    for (const [sid, sp] of sessionProviders.entries()) {
      if (sp.isRunning(sid)) {
        const submitter = sessionCommandSubmitter.get(sid);
        if (submitter === email) runningCount++;
      }
    }
    if (runningCount >= maxConcurrent) {
      return { ok: false, reason: `Concurrent session limit reached (${maxConcurrent})` };
    }
  }

  // Check command count for this session
  const userCmds = userSessionCommands.get(email);
  const sessionCmds = userCmds?.get(sessionId) ?? 0;
  if (sessionCmds >= maxCommands) {
    return { ok: false, reason: `Command limit reached (${maxCommands} per session)` };
  }

  // Check runtime
  const startTime = sessionStartTimes.get(sessionId);
  if (startTime) {
    const elapsedMin = (Date.now() - startTime) / 1000 / 60;
    if (elapsedMin > maxRuntimeMin) {
      return { ok: false, reason: `Session runtime limit reached (${maxRuntimeMin} min)` };
    }
  }

  return { ok: true };
}

function incrementSessionCommands(email: string, sessionId: string) {
  if (!userSessionCommands.has(email)) {
    userSessionCommands.set(email, new Map());
  }
  const m = userSessionCommands.get(email)!;
  m.set(sessionId, (m.get(sessionId) ?? 0) + 1);
}

// ── Main export ──────────────────────────────────────────────────────────────

export function shutdownAllSessions() {
  // Flush pending metrics before shutdown
  flushMetrics();

  // Close all active Claude sessions
  for (const [sessionId, provider] of sessionProviders.entries()) {
    try {
      provider.closeSession(sessionId);
    } catch {
      // best-effort during shutdown
    }
  }
  sessionProviders.clear();

  // Kill any PTY processes
  for (const [id, pty] of ptyProcesses.entries()) {
    try {
      pty.kill?.();
    } catch {
      // best-effort
    }
    ptyProcesses.delete(id);
  }

  // Shutdown persistent terminal sessions
  shutdownTerminals();

  // Clear intervals
  if (metricsInterval) clearInterval(metricsInterval);
  if (cleanupInterval) clearInterval(cleanupInterval);
}

export function registerHandlers(io: Server) {
  // Clear any existing intervals to prevent duplicates on re-register
  if (metricsInterval) clearInterval(metricsInterval);
  if (cleanupInterval) clearInterval(cleanupInterval);

  // Reconcile tmux sessions for persistent terminals
  reconcileTmuxSessions().catch(err => console.error("[terminal] reconcile error:", err));
  metricsInterval = setInterval(() => {
    if (Date.now() - lastMetricsFlush > 60_000) {
      flushMetrics();
      lastMetricsFlush = Date.now();
    }
  }, 60_000);
  cleanupInterval = setInterval(() => {
    cleanupExpiredBlocks();
    runRetentionCleanup();
    try { db.pragma("incremental_vacuum"); } catch { /* ignore */ }
  }, 5 * 60_000);

  // Initialize file lock manager
  initFileLockManager();

  const provider = getClaudeProvider();

  // Wire notification emitter so dispatchNotification can push real-time events
  setNotificationEmitter((email: string, notification: InAppNotification) => {
    for (const [socketId, info] of Array.from(connectedUsers.entries())) {
      if (info.email === email) {
        io.to(socketId).emit("notification:new", { notification });
        io.to(socketId).emit("notification:count", { unread: getUnreadCount(email) });
      }
    }
  });

  // Wire broadcaster so REST API routes can push real-time events to all clients
  setBroadcaster((event: string, data: unknown) => {
    io.emit(event, data);
  });

  // Set up file lock event listeners
  lockEventEmitter.on("operation_queued", (event: {
    queueId: string;
    sessionId: string;
    userEmail: string;
    filePath: string;
    toolName: string;
    toolCallId: string;
    position: number;
  }) => {
    const user = getUser(event.userEmail);
    const userName = user ? `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email : event.userEmail;
    
    io.to(`session:${event.sessionId}`).emit("file:operation_queued", {
      sessionId: event.sessionId,
      queueId: event.queueId,
      filePath: event.filePath,
      queuePosition: event.position,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      userEmail: event.userEmail,
      userName,
    });
  });

  lockEventEmitter.on("queue_executing", (event: {
    queueId: string;
    sessionId: string;
    userEmail: string;
    filePath: string;
    toolName: string;
    toolCallId: string;
  }) => {
    io.to(`session:${event.sessionId}`).emit("file:queue_executing", {
      sessionId: event.sessionId,
      queueId: event.queueId,
      filePath: event.filePath,
      toolCallId: event.toolCallId,
    });
  });

  lockEventEmitter.on("lock_released", (event: {
    filePath: string;
    toolCallId: string;
  }) => {
    io.emit("file:lock_released", {
      filePath: event.filePath,
      toolCallId: event.toolCallId,
    });
  });

  lockEventEmitter.on("operation_cancelled", (event: {
    queueId: string;
    sessionId: string;
    userEmail: string;
    filePath: string;
    toolCallId: string;
  }) => {
    io.to(`session:${event.sessionId}`).emit("file:operation_cancelled", {
      sessionId: event.sessionId,
      queueId: event.queueId,
      filePath: event.filePath,
      toolCallId: event.toolCallId,
    });
  });

  // Session status helper: updates DB and broadcasts to all sockets
  function setSessionStatus(sessionId: string, status: SessionStatus) {
    try {
      updateSessionStatus(sessionId, status);
      io.emit("claude:session_status", { sessionId, status });
    } catch (err) {
      console.error("[status] Failed to update session status:", err);
    }
  }

  // Retry helper for critical DB saves
  async function retrySaveMessage(
    sessionId: string,
    senderType: "admin" | "claude",
    content: string,
    senderId?: string,
    messageType: "chat" | "system" | "error" = "chat",
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const delays = [100, 200, 300];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      try {
        saveMessage(sessionId, senderType, content, senderId, messageType, metadata);
        return true;
      } catch (err) {
        console.error(`[db] saveMessage attempt ${attempt + 1} failed:`, err);
        if (attempt < delays.length - 1) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    return false;
  }

  function flushStreamingThrottle(sessionId: string) {
    const throttle = sessionStreamingThrottles.get(sessionId);
    if (!throttle) return;
    clearTimeout(throttle.timer);
    if (throttle.pending) {
      io.to(`session:${sessionId}`).emit("claude:output", throttle.pending);
    }
    sessionStreamingThrottles.delete(sessionId);
  }

  function ensureSessionListener(sessionId: string) {
    if (sessionListeners.has(sessionId)) return;
    sessionListeners.add(sessionId);

    const sessionProvider = getSessionProvider(sessionId) ?? provider;

    let pendingContent = sessionStreamingContent.get(sessionId) ?? "";
    sessionCmdStartTimes.set(sessionId, Date.now());
    const toolCalls: { toolCallId: string; toolName: string; toolInput: unknown; status: string; result?: string; exitCode?: number }[] = [];

    sessionProvider.onOutput(sessionId, async (parsed) => {
      const submittedBy = sessionCommandSubmitter.get(sessionId);

      // Persist session ID to DB for resume across server restarts
      if (parsed.type === "session_id" && parsed.claudeSessionId) {
        try { updateClaudeSessionId(sessionId, parsed.claudeSessionId); } catch { /* ignore for ephemeral sessions */ }
        return;
      }

      // Capture usage data for later inclusion in saved message
      if (parsed.type === "usage" && parsed.usage) {
        sessionPendingUsage.set(sessionId, parsed.usage);
        // Flush any buffered streaming so the client has the latest
        // content before usage/done finalize the turn.
        flushStreamingThrottle(sessionId);
        io.to(`session:${sessionId}`).emit("claude:usage", { sessionId, usage: parsed.usage });
        return;
      }

      if (parsed.type === "compacting") {
        io.to(`session:${sessionId}`).emit("claude:compacting", { sessionId });
        return;
      }

      if (parsed.type === "compact_done") {
        io.to(`session:${sessionId}`).emit("claude:compact_done", { sessionId });
        return;
      }

      // Track tool calls for metadata
      if (parsed.type === "tool_call" && parsed.toolCallId) {
        toolCalls.push({
          toolCallId: parsed.toolCallId,
          toolName: parsed.toolName ?? "unknown",
          toolInput: parsed.toolInput,
          status: "running",
        });
      }

      // Track tool results
      if (parsed.type === "tool_result" && parsed.toolCallId) {
        const tc = toolCalls.find((t) => t.toolCallId === parsed.toolCallId);
        if (tc) {
          tc.status = parsed.toolStatus ?? "done";
          tc.result = parsed.toolResult;
          tc.exitCode = parsed.exitCode;
        }
      }

      // Handle file queued notifications
      if (parsed.type === "file_queued") {
        io.to(`session:${sessionId}`).emit("file:operation_queued", {
          sessionId,
          filePath: parsed.filePath,
          queuePosition: parsed.queuePosition,
          lockedBy: parsed.lockedBy,
          toolName: parsed.toolName,
          toolCallId: parsed.toolCallId,
        });
        // Also send as regular output so it appears in the UI
        io.to(`session:${sessionId}`).emit("claude:output", { sessionId, parsed, submittedBy });
        return;
      }

      // Guard rails: intercept permission_request for protected paths
      if (parsed.type === "permission_request") {
        const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
        if (guardEnabled && parsed.toolName) {
          const check = checkProtectedPath(parsed.toolName, parsed.toolInput);
          if (check.blocked) {
            sessionProvider.denyPermission(sessionId);
            logActivity("security_mod_blocked", submittedBy ?? null, {
              tool: parsed.toolName,
              input: parsed.toolInput,
              reason: check.reason,
            });
            io.to(`session:${sessionId}`).emit("security:warn", {
              type: "protected_path_blocked",
              message: check.reason ?? "Blocked access to protected path",
            });
            return;
          }
        }

        // Sandbox: classify commands in Bash tool calls
        const sandboxEnabled = isSandboxEnabled();
        if (sandboxEnabled && parsed.toolName === "Bash" && parsed.toolInput) {
          const toolInput = parsed.toolInput as Record<string, unknown>;
          const command = typeof toolInput.command === "string" ? toolInput.command : "";
          if (command) {
            const classification = classifyCommand(command);
            if (classification.category === "blocked" || classification.category === "custom_blocked") {
              sessionProvider.denyPermission(sessionId);
              logActivity("security_command_blocked", submittedBy ?? null, {
                command: command.slice(0, 200),
                category: classification.category,
                reason: classification.reason,
              });
              io.to(`session:${sessionId}`).emit("security:warn", {
                type: "command_blocked",
                message: classification.reason ?? `Command auto-blocked: ${command.slice(0, 100)}`,
              });
              return;
            }
            // For restricted/dangerous/whitelisted: augment the output
            if (classification.category !== "safe") {
              io.to(`session:${sessionId}`).emit("claude:output", {
                sessionId,
                parsed: {
                  ...parsed,
                  sandboxCategory: classification.category,
                  sandboxReason: classification.reason,
                },
                submittedBy,
              });
              return;
            }
          }
        }
      }

      // Status transitions for interactive events
      if (parsed.type === "permission_request" || parsed.type === "user_question") {
        setSessionStatus(sessionId, "needs_attention");
      }
      if (parsed.type === "error" && parsed.retryable) {
        setSessionStatus(sessionId, "needs_attention");
      }

      // Throttle streaming events to prevent flooding; send all others immediately
      if (parsed.type === "streaming") {
        let throttle = sessionStreamingThrottles.get(sessionId);
        if (!throttle) {
          // First streaming event -- send immediately, start throttle window
          io.to(`session:${sessionId}`).emit("claude:output", { sessionId, parsed, submittedBy });
          throttle = { timer: setTimeout(() => flushStreamingThrottle(sessionId), STREAMING_THROTTLE_MS), pending: null };
          sessionStreamingThrottles.set(sessionId, throttle);
        } else {
          // Within throttle window -- buffer the latest
          throttle.pending = { sessionId, parsed, submittedBy };
        }
      } else {
        // Flush any pending streaming event before sending a non-streaming event
        flushStreamingThrottle(sessionId);
        io.to(`session:${sessionId}`).emit("claude:output", { sessionId, parsed, submittedBy });
      }

      // Buffer recent events for replay when a client reconnects mid-stream
      if (parsed.type !== "progress") {
        let buf = sessionEventBuffers.get(sessionId);
        if (!buf) { buf = []; sessionEventBuffers.set(sessionId, buf); }
        buf.push({ sessionId, parsed, submittedBy });
        if (buf.length > MAX_EVENT_BUFFER_SIZE) buf.shift();
      }

      if ((parsed.type === "text" || parsed.type === "streaming") && parsed.content) {
        pendingContent = parsed.content;
        sessionStreamingContent.set(sessionId, parsed.content);
      }

      if (parsed.type === "done") {
        sessionEventBuffers.delete(sessionId);
        // Check if session is waiting for permission before setting idle
        const sp = getSessionProvider(sessionId);
        if (!sp?.isRunning(sessionId)) {
          setSessionStatus(sessionId, "idle");
        }

        // S9-03 + S9-04: Clean up listener set and providers for ephemeral sessions
        const ephemeralPrefixes = ["agent-gen-", "plan-gen-", "plan-step-", "plan-refine-"];
        if (ephemeralPrefixes.some((p) => sessionId.startsWith(p))) {
          sessionListeners.delete(sessionId);
          sessionProviders.delete(sessionId);
        }
      }

      if (parsed.type === "done" && pendingContent) {
        const contentToSave = pendingContent;
        pendingContent = "";
        sessionStreamingContent.delete(sessionId);

        // Record latency using per-command start time
        const cmdStart = sessionCmdStartTimes.get(sessionId) ?? Date.now();
        const latency = Date.now() - cmdStart;
        sessionCmdStartTimes.delete(sessionId);
        if (metricsBuffer.latencies.length < MAX_LATENCIES) {
          metricsBuffer.latencies.push(latency);
        }
        metricsBuffer.command_count++;

        const submitterEmail = sessionCommandSubmitter.get(sessionId);
        sessionCommandSubmitter.delete(sessionId);

        // Include usage and tool calls in metadata
        const usage = sessionPendingUsage.get(sessionId);
        const metadata: Record<string, unknown> = {};
        if (usage) metadata.usage = usage;
        if (toolCalls.length > 0) metadata.toolCalls = [...toolCalls];
        sessionPendingUsage.delete(sessionId);

        // Critical save with retry
        const saved = await retrySaveMessage(
          sessionId, "claude", contentToSave, undefined, "chat",
          Object.keys(metadata).length > 0 ? metadata : undefined,
        );
        if (!saved) {
          io.to(`session:${sessionId}`).emit("claude:error", {
            message: "Failed to save Claude's response. The message was displayed but not persisted.",
          });
        }

        // Clear tool calls for next interaction
        toolCalls.length = 0;

        logActivity("command_executed", submitterEmail ?? null, { sessionId, latency_ms: latency });
        io.to(`session:${sessionId}`).emit("claude:command_done", { sessionId });

        // AI-powered auto-naming on first completed exchange
        if (submitterEmail) {
          const ephemeralPrefixes = ["agent-gen-", "plan-gen-", "plan-step-", "plan-refine-"];
          const isEphemeral = ephemeralPrefixes.some((p) => sessionId.startsWith(p));
          if (!isEphemeral) {
            const session = getSession(sessionId);
            if (session && !session.name) {
              const settings = getUserSettings(submitterEmail);
              if (settings.auto_naming_enabled) {
                const msgs = getMessages(sessionId);
                const firstUserMsg = msgs.find((m) => m.sender_type === "admin");
                if (firstUserMsg) {
                  const claudeMsgCount = msgs.filter((m) => m.sender_type === "claude").length;
                  if (claudeMsgCount <= 1) {
                    generateSessionName(firstUserMsg.content, contentToSave).then((name) => {
                      renameSession(sessionId, name);
                      io.to(`session:${sessionId}`).emit("claude:session_renamed", { sessionId, name });
                      // Broadcast updated session list to all sockets of the submitter
                      const sessions = listSessions(submitterEmail);
                      io.to(`session:${sessionId}`).emit("claude:sessions", { sessions });
                    }).catch(() => {});
                  }
                }
              }
            }
          }
        }
      }
    });
  }

  // Auth middleware — rejects before connection so the client gets a clean
  // connect_error with the reason instead of an opaque disconnect loop.
  io.use(async (socket, next) => {
    const authorized = await verifySocket(socket);
    if (!authorized) {
      console.warn("[socket] unauthorized connection rejected:", socket.id);
      return next(new Error("unauthorized"));
    }
    next();
  });

  io.on("connection", async (socket) => {
    const email = await getEmailFromSocket(socket);
    const isAdmin = await isAdminSocket(socket);

    connectedUsers.set(socket.id, { email, activeSession: null });
    broadcastPresence(io);

    // Build the handler context
    const ctx: HandlerContext = {
      io,
      socket,
      email,
      isAdmin,
      provider,
      connectedUsers,
      sessionStreamingContent,
      sessionListeners,
      sessionCommandSubmitter,
      sessionStartTimes,
      sessionProviders,
      sessionPendingUsage,
      sessionEventBuffers,
      userSessionCommands,
      metricsBuffer,
      planResumeCallbacks,
      ptyProcesses,
      getSessionProvider,
      setSessionStatus,
      ensureSessionListener,
      broadcastPresence: () => broadcastPresence(io),
      checkRateLimit,
      incrementSessionCommands,
      retrySaveMessage,
    };

    // Register all sub-handlers
    registerSessionHandlers(ctx);
    registerMessageHandlers(ctx);
    registerSecurityHandlers(ctx);
    registerPresenceHandlers(ctx);
    registerPlanHandlers(ctx);
    registerTerminalHandlers(ctx);
    registerJobHandlers(ctx);

    // File lock handlers
    socket.on("file:cancel_queued_operation", async ({ queueId }: { queueId: string }) => {
      const cancelled = cancelQueuedOperation(queueId, email);
      if (cancelled) {
        console.log(`[file-lock] User ${email} cancelled queued operation: ${queueId}`);
      }
    });

    socket.on("file:get_queue_status", async ({ sessionId }: { sessionId: string }, callback: (data: unknown) => void) => {
      try {
        const operations = getSessionQueuedOperations(sessionId);
        callback({ success: true, operations });
      } catch (err) {
        console.error("[file-lock] Error getting queue status:", err);
        callback({ success: false, error: String(err) });
      }
    });
  });
}

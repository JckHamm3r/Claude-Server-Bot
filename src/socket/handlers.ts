import type { Server, Socket } from "socket.io";
import { execSync } from "child_process";
import { getClaudeProvider } from "../lib/claude";
import {
  createSession,
  getSession,
  saveMessage,
  getMessages,
  listSessions,
  renameSession,
  deleteSession,
  updateSessionTags,
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentVersions,
  createPlan,
  getPlan,
  updatePlanStatus,
  listPlans,
  addPlanStep,
  getPlanSteps,
  updatePlanStep,
  getUserSettings,
  updateUserSettings,
} from "../lib/claude-db";
import { getToken } from "next-auth/jwt";
import { logActivity } from "../lib/activity-log";
import { getAppSetting, setAppSetting, getPersonalityPrefix } from "../lib/app-settings";
import {
  dispatchNotification,
  getInAppNotifications,
  getUnreadCount,
  markNotificationsRead,
  markAllNotificationsRead,
  setNotificationEmitter,
  type InAppNotification,
} from "../lib/notifications";
import { getCustomizationSystemPrompt } from "../lib/customization";
import { checkProtectedPath, checkBotConfigRequest, getSecuritySystemPrompt } from "../lib/security-guard";
import { classifyCommand, isSandboxEnabled } from "../lib/command-sandbox";
import { cleanupExpiredBlocks } from "../lib/ip-protection";
import db from "../lib/db";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

function makeMockReq(socket: Socket) {
  const cookieHeader = socket.handshake.headers.cookie ?? "";
  return {
    headers: { cookie: cookieHeader },
    cookies: Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k, v.join("=")];
      }),
    ),
  } as Parameters<typeof getToken>[0]["req"];
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
      secret: process.env.NEXTAUTH_SECRET ?? "",
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbInstance = (require("../lib/db") as { default: import("better-sqlite3").Database }).default;
    const user = dbInstance.prepare("SELECT email FROM users WHERE email = ?").get(email);
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

setInterval(() => {
  if (Date.now() - lastMetricsFlush > 60_000) {
    flushMetrics();
    lastMetricsFlush = Date.now();
  }
}, 60_000);

// Periodic security cleanup: expire temporary IP blocks every 5 minutes
setInterval(() => {
  cleanupExpiredBlocks();
}, 5 * 60_000);

type PlanAction = "retry" | "skip" | "cancel" | "rollback_stop" | "rollback_continue";
const planResumeCallbacks = new Map<string, (action: PlanAction) => void>();

// Active PTY sessions
const ptyProcesses = new Map<string, import("node-pty").IPty>();

// ── Helpers ─────────────────────────────────────────────────────────────────

function broadcastPresence(io: Server) {
  const presence = Array.from(connectedUsers.values());
  io.emit("claude:presence_update", { presence });
}

function tryGitRollback(): { ok: boolean; error?: string } {
  try {
    execSync("git checkout -- .", { cwd: PROJECT_ROOT, stdio: "pipe" });
    execSync("git clean -fd", { cwd: PROJECT_ROOT, stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}


function checkRateLimit(email: string, sessionId: string): { ok: boolean; reason?: string } {
  const maxCommands = parseInt(getAppSetting("rate_limit_commands", "100"), 10);
  const maxRuntimeMin = parseInt(getAppSetting("rate_limit_runtime_min", "30"), 10);
  const maxConcurrent = parseInt(getAppSetting("rate_limit_concurrent", "3"), 10);

  // Count active sessions for this user
  let activeSessions = 0;
  for (const info of Array.from(connectedUsers.values())) {
    if (info.email === email && info.activeSession) activeSessions++;
  }
  if (activeSessions > maxConcurrent) {
    return { ok: false, reason: `Concurrent session limit reached (${maxConcurrent})` };
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

export function registerHandlers(io: Server) {
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

  function ensureSessionListener(sessionId: string) {
    if (sessionListeners.has(sessionId)) return;
    sessionListeners.add(sessionId);

    let pendingContent = sessionStreamingContent.get(sessionId) ?? "";
    const cmdStartTime = Date.now();

    provider.onOutput(sessionId, async (parsed) => {
      const submittedBy = sessionCommandSubmitter.get(sessionId);

      // Guard rails: intercept permission_request for protected paths
      if (parsed.type === "permission_request") {
        const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
        if (guardEnabled && parsed.toolName) {
          const check = checkProtectedPath(parsed.toolName, parsed.toolInput);
          if (check.blocked) {
            provider.denyPermission(sessionId);
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
              provider.denyPermission(sessionId);
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

      io.to(`session:${sessionId}`).emit("claude:output", { sessionId, parsed, submittedBy });

      if ((parsed.type === "text" || parsed.type === "streaming") && parsed.content) {
        pendingContent = parsed.content;
        sessionStreamingContent.set(sessionId, parsed.content);
      }

      if (parsed.type === "done" && pendingContent) {
        const contentToSave = pendingContent;
        pendingContent = "";
        sessionStreamingContent.delete(sessionId);

        // Record latency
        const latency = Date.now() - cmdStartTime;
        metricsBuffer.latencies.push(latency);
        metricsBuffer.command_count++;

        const submitterEmail = sessionCommandSubmitter.get(sessionId);
        sessionCommandSubmitter.delete(sessionId);

        await saveMessage(sessionId, "claude", contentToSave).catch(() => {});
        logActivity("command_executed", submitterEmail ?? null, { sessionId, latency_ms: latency });

        io.to(`session:${sessionId}`).emit("claude:command_done", { sessionId });
      }
    });
  }

  io.on("connection", async (socket) => {
    const authorized = await verifySocket(socket);
    if (!authorized) {
      socket.emit("claude:error", { message: "Unauthorized" });
      socket.disconnect(true);
      return;
    }

    const email = await getEmailFromSocket(socket);
    const isAdmin = await isAdminSocket(socket);

    connectedUsers.set(socket.id, { email, activeSession: null });
    broadcastPresence(io);

    // ── Session handlers ──────────────────────────────────────────────────

    socket.on(
      "claude:create_session",
      async ({
        sessionId,
        skipPermissions,
        interface_type,
      }: {
        sessionId: string;
        skipPermissions?: boolean;
        interface_type?: "ui_chat" | "customization_interface" | "system_agent";
      }) => {
        try {
          await createSession(sessionId, email, skipPermissions ?? false);

          // Build system prompt based on interface_type
          let systemPrompt: string | undefined;
          if (interface_type === "customization_interface") {
            systemPrompt = await getCustomizationSystemPrompt();
            logActivity("customization_session_started", email, { sessionId });
          } else if (interface_type === "system_agent") {
            systemPrompt = undefined; // bare, no personality
          } else {
            // Default: ui_chat — personality prefix only
            const personalityPrefix = getPersonalityPrefix();
            systemPrompt = personalityPrefix || undefined;
          }

          // Prepend security system prompt if guard rails are enabled
          const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
          const securityPrefix = getSecuritySystemPrompt(guardEnabled);
          if (securityPrefix) {
            systemPrompt = systemPrompt ? securityPrefix + "\n\n" + systemPrompt : securityPrefix;
          }

          provider.createSession(sessionId, {
            skipPermissions,
            ...(systemPrompt ? { systemPrompt } : {}),
          });

          socket.join(`session:${sessionId}`);

          connectedUsers.set(socket.id, { email, activeSession: sessionId });
          broadcastPresence(io);

          sessionStartTimes.set(sessionId, Date.now());
          metricsBuffer.session_count++;

          ensureSessionListener(sessionId);

          const currentContent = sessionStreamingContent.get(sessionId);
          if (currentContent && provider.isRunning(sessionId)) {
            socket.emit("claude:output", {
              sessionId,
              parsed: { type: "streaming", content: currentContent },
              submittedBy: sessionCommandSubmitter.get(sessionId),
            });
          }

          socket.emit("claude:session_ready", { sessionId, running: provider.isRunning(sessionId) });
        } catch (err) {
          socket.emit("claude:error", { sessionId, message: String(err) });
        }
      },
    );

    socket.on(
      "claude:set_active_session",
      ({ sessionId }: { sessionId: string | null }) => {
        connectedUsers.set(socket.id, { email, activeSession: sessionId });
        if (sessionId) socket.join(`session:${sessionId}`);
        broadcastPresence(io);
      },
    );

    socket.on(
      "claude:message",
      async ({ sessionId, content }: { sessionId: string; content: string }) => {
        try {
          // Rate limiting
          const rl = checkRateLimit(email, sessionId);
          if (!rl.ok) {
            socket.emit("claude:rate_limited", {
              sessionId,
              reason: rl.reason,
              limits: {
                commands: getAppSetting("rate_limit_commands", "100"),
                runtime_min: getAppSetting("rate_limit_runtime_min", "30"),
                concurrent: getAppSetting("rate_limit_concurrent", "3"),
              },
            });
            dispatchNotification(
              "session_limit_reached",
              email,
              "Session limit reached",
              rl.reason ?? "A session limit was reached.",
            ).catch(() => {});
            return;
          }

          // Guard rails: check for bot-config modification attempts
          const guardEnabled = getAppSetting("guard_rails_enabled", "true") === "true";
          if (guardEnabled) {
            const suspicion = checkBotConfigRequest(content);
            if (suspicion.suspicious) {
              logActivity("security_mod_blocked", email, { reason: suspicion.reason, message: content.slice(0, 200) });
              io.to(`session:${sessionId}`).emit("claude:output", {
                sessionId,
                parsed: {
                  type: "text",
                  content: "I'm not able to modify bot configuration through chat. Please use the **Settings** panel to manage users, rate limits, SMTP, and other configuration. This is a security restriction to prevent unauthorized changes.",
                },
                submittedBy: email,
              });
              io.to(`session:${sessionId}`).emit("claude:command_done", { sessionId });
              io.to(`session:${sessionId}`).emit("security:warn", {
                type: "suspicious_input",
                message: "Message blocked: suspected bot configuration modification request.",
              });
              return;
            }
          }

          incrementSessionCommands(email, sessionId);
          await saveMessage(sessionId, "admin", content, email);
          sessionCommandSubmitter.set(sessionId, email);
          io.to(`session:${sessionId}`).emit("claude:command_started", { sessionId, submittedBy: email });
          provider.sendMessage(sessionId, content);
        } catch (err) {
          socket.emit("claude:error", { sessionId, message: String(err) });
        }
      },
    );

    socket.on("claude:interrupt", ({ sessionId }: { sessionId: string }) => {
      provider.interrupt(sessionId);
    });

    socket.on("claude:close_session", ({ sessionId }: { sessionId: string }) => {
      provider.offOutput(sessionId);
      provider.closeSession(sessionId);
      sessionListeners.delete(sessionId);
      sessionStartTimes.delete(sessionId);
    });

    socket.on(
      "claude:select_option",
      ({ sessionId, choice }: { sessionId: string; choice: string }) => {
        provider.sendMessage(sessionId, choice);
      },
    );

    socket.on(
      "claude:confirm",
      ({ sessionId, value }: { sessionId: string; value: boolean }) => {
        provider.sendMessage(sessionId, value ? "y" : "n");
      },
    );

    // ── Typing indicators ─────────────────────────────────────────────────

    socket.on("claude:typing_start", ({ sessionId }: { sessionId: string }) => {
      socket.to(`session:${sessionId}`).emit("claude:typing", { email, typing: true });
    });

    socket.on("claude:typing_stop", ({ sessionId }: { sessionId: string }) => {
      socket.to(`session:${sessionId}`).emit("claude:typing", { email, typing: false });
    });

    // ── Session management ────────────────────────────────────────────────

    socket.on("claude:list_sessions", async () => {
      const sessions = await listSessions(email).catch(() => []);
      socket.emit("claude:sessions", { sessions });
    });

    socket.on("claude:get_messages", async ({ sessionId }: { sessionId: string }) => {
      const session = await getSession(sessionId).catch(() => null);
      if (!session || session.created_by !== email) {
        socket.emit("claude:error", { sessionId, message: "Session not found" });
        return;
      }
      const messages = await getMessages(sessionId).catch(() => []);
      socket.emit("claude:messages", { sessionId, messages });
    });

    socket.on(
      "claude:rename_session",
      async ({ sessionId, name }: { sessionId: string; name: string }) => {
        await renameSession(sessionId, name).catch(() => {});
        const sessions = await listSessions(email).catch(() => []);
        socket.emit("claude:sessions", { sessions });
      },
    );

    socket.on("claude:delete_session", async ({ sessionId }: { sessionId: string }) => {
      const session = await getSession(sessionId).catch(() => null);
      if (!session || session.created_by !== email) return;
      provider.offOutput(sessionId);
      provider.closeSession(sessionId);
      sessionStreamingContent.delete(sessionId);
      sessionListeners.delete(sessionId);
      sessionStartTimes.delete(sessionId);
      await deleteSession(sessionId).catch(() => {});
      const sessions = await listSessions(email).catch(() => []);
      socket.emit("claude:sessions", { sessions });
    });

    socket.on(
      "claude:update_session_tags",
      async ({ sessionId, tags }: { sessionId: string; tags: string[] }) => {
        const session = await getSession(sessionId).catch(() => null);
        if (!session || session.created_by !== email) return;
        await updateSessionTags(sessionId, tags).catch(() => {});
        const sessions = await listSessions(email).catch(() => []);
        socket.emit("claude:sessions", { sessions });
      },
    );

    socket.on(
      "claude:allow_tool",
      ({ sessionId, toolName, scope }: { sessionId: string; toolName: string; scope?: "session" | "once" }) => {
        provider.allowTool(sessionId, toolName, scope ?? "once");
      },
    );

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

    // ── Kill all ──────────────────────────────────────────────────────────

    socket.on("claude:kill_all", async () => {
      try {
        const allSessionIds = Array.from(sessionStreamingContent.keys());
        for (const sid of allSessionIds) {
          try { provider.interrupt(sid); } catch { /* ignore */ }
          sessionStreamingContent.delete(sid);
          sessionListeners.delete(sid);
        }
        logActivity("kill_all", email);
        socket.emit("claude:kill_all_done", { killed: allSessionIds.length });
        io.emit("claude:sessions_aborted");

        // Notify all admins
        const admins = db.prepare("SELECT email FROM users WHERE is_admin = 1").all() as { email: string }[];
        for (const admin of admins) {
          dispatchNotification("kill_all_triggered", admin.email, "Kill-all triggered", `All active sessions were terminated by ${email}.`).catch(() => {});
        }
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });

    // ── Agent handlers ────────────────────────────────────────────────────

    socket.on("claude:list_agents", async () => {
      const agents = await listAgents(email).catch(() => []);
      socket.emit("claude:agents", { agents });
    });

    socket.on(
      "claude:create_agent",
      async ({
        name, description, icon, model, allowed_tools,
      }: {
        name: string; description: string; icon?: string; model: string; allowed_tools: string[];
      }) => {
        try {
          await createAgent({ name, description, icon, model, allowed_tools }, email);
          metricsBuffer.agent_count++;
          logActivity("agent_created", email, { name });
          const agents = await listAgents(email);
          socket.emit("claude:agents", { agents });
        } catch (err) {
          socket.emit("claude:error", { message: String(err) });
        }
      },
    );

    socket.on(
      "claude:update_agent",
      async ({
        agentId, data, changeDescription,
      }: {
        agentId: string;
        data: Partial<{ name: string; description: string; icon: string; model: string; allowed_tools: string[]; status: string }>;
        changeDescription?: string;
      }) => {
        try {
          await updateAgent(agentId, data, email, changeDescription);
          const agents = await listAgents(email);
          socket.emit("claude:agents", { agents });
        } catch (err) {
          socket.emit("claude:error", { message: String(err) });
        }
      },
    );

    socket.on("claude:delete_agent", async ({ agentId }: { agentId: string }) => {
      try {
        await deleteAgent(agentId);
        const agents = await listAgents(email);
        socket.emit("claude:agents", { agents });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });

    socket.on("claude:get_agent_versions", async ({ agentId }: { agentId: string }) => {
      try {
        const versions = await getAgentVersions(agentId);
        socket.emit("claude:agent_versions", { agentId, versions });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });

    socket.on("claude:generate_agent", async ({ description }: { description: string }) => {
      const sessionId = `agent-gen-${Date.now()}`;
      try {
        provider.createSession(sessionId, { skipPermissions: true });

        const prompt = `Generate a Claude Code agent configuration for: ${description}

Return ONLY valid JSON with these fields:
{
  "name": "string",
  "description": "string",
  "model": "claude-opus-4-6",
  "allowed_tools": ["array", "of", "tool", "names"],
  "icon": "emoji"
}

Available tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent
Return only the JSON object, no markdown, no explanation.`;

        let lastTextOutput = "";

        provider.onOutput(sessionId, (parsed) => {
          if ((parsed.type === "text" || parsed.type === "streaming") && parsed.content) {
            lastTextOutput = parsed.content;
          }
          if (parsed.type === "done") {
            provider.offOutput(sessionId);
            provider.closeSession(sessionId);
            try {
              const cleaned = lastTextOutput
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```\s*$/, "")
                .trim();
              const config = JSON.parse(cleaned);
              socket.emit("claude:agent_generated", { config });
            } catch {
              socket.emit("claude:error", { message: "Failed to parse agent config from Claude response" });
            }
          }
          if (parsed.type === "error") {
            provider.offOutput(sessionId);
            provider.closeSession(sessionId);
            socket.emit("claude:error", { message: parsed.message ?? "Claude error during agent generation" });
          }
        });

        provider.sendMessage(sessionId, prompt);
      } catch (err) {
        provider.offOutput(sessionId);
        provider.closeSession(sessionId);
        socket.emit("claude:error", { message: String(err) });
      }
    });

    // ── Settings handlers ─────────────────────────────────────────────────

    socket.on("claude:get_settings", async () => {
      const s = await getUserSettings(email).catch(() => null);
      if (s) socket.emit("claude:settings", { settings: s });
    });

    socket.on(
      "claude:update_settings",
      async (data: Partial<{ full_trust_mode: boolean; custom_default_context: string | null; auto_naming_enabled: boolean }>) => {
        try {
          const updated = await updateUserSettings(email, data);
          socket.emit("claude:settings", { settings: updated });
        } catch (err) {
          socket.emit("claude:error", { message: String(err) });
        }
      },
    );

    // ── Plan handlers ─────────────────────────────────────────────────────

    socket.on(
      "claude:generate_plan",
      async ({ sessionId, goal }: { sessionId: string; goal: string }) => {
        try {
          const plan = await createPlan(sessionId, goal, email);
          logActivity("plan_created", email, { planId: plan.id, goal });
          const planSessionId = "plan-gen-" + plan.id;
          provider.createSession(planSessionId, { skipPermissions: true });

          const prompt = `You are helping plan a multi-step development task for a software project.

Goal: ${goal}

Generate a detailed step-by-step plan. Return ONLY a JSON array of steps:
[
  { "summary": "brief one-line summary", "details": "detailed explanation of what will be done" },
  ...
]

Be specific. Each step should be atomic and independently executable. Return only the JSON array.`;

          let lastOutput = "";

          provider.onOutput(planSessionId, async (parsed) => {
            if ((parsed.type === "text" || parsed.type === "streaming") && parsed.content) {
              lastOutput = parsed.content;
            }
            if (parsed.type === "done") {
              provider.offOutput(planSessionId);
              provider.closeSession(planSessionId);
              try {
                const cleaned = lastOutput
                  .replace(/^```(?:json)?\s*/i, "")
                  .replace(/\s*```\s*$/, "")
                  .trim();
                const steps: { summary: string; details?: string }[] = JSON.parse(cleaned);
                await updatePlanStatus(plan.id, "reviewing");
                for (let i = 0; i < steps.length; i++) {
                  await addPlanStep(plan.id, {
                    step_order: i + 1,
                    summary: steps[i].summary,
                    details: steps[i].details,
                  });
                }
                const fullPlan = await getPlan(plan.id);
                socket.emit("claude:plan_generated", { plan: fullPlan });
              } catch {
                socket.emit("claude:error", { message: "Failed to parse plan steps from Claude response" });
              }
            }
            if (parsed.type === "error") {
              provider.offOutput(planSessionId);
              provider.closeSession(planSessionId);
              socket.emit("claude:error", { message: parsed.message ?? "Claude error during plan generation" });
            }
          });

          provider.sendMessage(planSessionId, prompt);
        } catch (err) {
          socket.emit("claude:error", { message: String(err) });
        }
      },
    );

    socket.on("claude:list_plans", async ({ sessionId }: { sessionId: string }) => {
      try {
        const plans = await listPlans(sessionId);
        const plansWithSteps = await Promise.all(
          plans.map(async (p) => {
            const steps = await getPlanSteps(p.id);
            return { ...p, steps };
          }),
        );
        socket.emit("claude:plans", { sessionId, plans: plansWithSteps });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });

    socket.on(
      "claude:approve_step",
      async ({ stepId, planId }: { stepId: string; planId: string }) => {
        try {
          await updatePlanStep(stepId, { status: "approved", approved_by: email });
          const plan = await getPlan(planId);
          socket.emit("claude:plan_updated", { plan });
        } catch (err) {
          socket.emit("claude:error", { message: String(err) });
        }
      },
    );

    socket.on(
      "claude:reject_step",
      async ({ stepId, planId }: { stepId: string; planId: string }) => {
        try {
          await updatePlanStep(stepId, { status: "rejected" });
          const plan = await getPlan(planId);
          socket.emit("claude:plan_updated", { plan });
        } catch (err) {
          socket.emit("claude:error", { message: String(err) });
        }
      },
    );

    socket.on("claude:approve_all_steps", async ({ planId }: { planId: string }) => {
      try {
        const steps = await getPlanSteps(planId);
        for (const step of steps) {
          if (step.status === "pending") {
            await updatePlanStep(step.id, { status: "approved", approved_by: email });
          }
        }
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });

    socket.on("claude:reject_all_steps", async ({ planId }: { planId: string }) => {
      try {
        const steps = await getPlanSteps(planId);
        for (const step of steps) {
          if (step.status === "pending") {
            await updatePlanStep(step.id, { status: "rejected" });
          }
        }
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });

    socket.on(
      "claude:reorder_step",
      async ({ stepId, planId, newOrder }: { stepId: string; planId: string; newOrder: number }) => {
        try {
          await updatePlanStep(stepId, { step_order: newOrder });
          const plan = await getPlan(planId);
          socket.emit("claude:plan_updated", { plan });
        } catch (err) {
          socket.emit("claude:error", { message: String(err) });
        }
      },
    );

    socket.on(
      "claude:edit_step",
      async ({ stepId, planId, summary, details }: { stepId: string; planId: string; summary: string; details: string }) => {
        try {
          await updatePlanStep(stepId, { summary, details });
          const plan = await getPlan(planId);
          socket.emit("claude:plan_updated", { plan });
        } catch (err) {
          socket.emit("claude:error", { message: String(err) });
        }
      },
    );

    socket.on("claude:execute_plan", async ({ planId }: { planId: string }) => {
      try {
        const plan = await getPlan(planId);
        if (!plan) {
          socket.emit("claude:error", { message: "Plan not found" });
          return;
        }
        logActivity("plan_executed", email, { planId });
        const approvedSteps = (plan.steps ?? []).filter((s) => s.status === "approved");
        await updatePlanStatus(planId, "executing");
        socket.emit("claude:plan_executing", { planId });

        for (const step of approvedSteps) {
          await updatePlanStep(step.id, { status: "executing", executed_at: new Date().toISOString() });
          socket.emit("claude:step_executing", { planId, stepId: step.id });

          const stepSessionId = "plan-step-" + step.id;
          provider.createSession(stepSessionId, { skipPermissions: true });

          const stepPrompt = `Execute this step: ${step.summary}\n\nDetails: ${step.details ?? ""}`;

          let stepOutput = "";
          let stepError = "";

          await new Promise<void>((resolve) => {
            provider.onOutput(stepSessionId, (parsed) => {
              if ((parsed.type === "text" || parsed.type === "streaming") && parsed.content) {
                stepOutput = parsed.content;
              }
              if (parsed.type === "error") {
                stepError = parsed.message ?? "Unknown error";
              }
              if (parsed.type === "done") {
                provider.offOutput(stepSessionId);
                provider.closeSession(stepSessionId);
                resolve();
              }
            });
            provider.sendMessage(stepSessionId, stepPrompt);
          });

          if (stepError) {
            await updatePlanStep(step.id, { status: "failed", error: stepError });
            socket.emit("claude:step_failed", { planId, stepId: step.id, error: stepError });
            socket.emit("claude:plan_paused", {
              planId,
              stepId: step.id,
              error: stepError,
              canRollback: true,
            });

            const action = await new Promise<PlanAction>((resolve) => {
              planResumeCallbacks.set(planId, resolve);
            });
            planResumeCallbacks.delete(planId);

            if (action === "rollback_stop" || action === "rollback_continue") {
              const rollback = tryGitRollback();
              const rollbackStatus = rollback.ok ? "rolled_back" : "failed";
              await updatePlanStep(step.id, { status: rollbackStatus });
              socket.emit("claude:step_rolled_back", {
                planId,
                stepId: step.id,
                ok: rollback.ok,
                error: rollback.error,
              });
            }

            if (action === "cancel" || action === "rollback_stop") {
              await updatePlanStatus(planId, "cancelled");
              const updatedPlan = await getPlan(planId);
              socket.emit("claude:plan_updated", { plan: updatedPlan });
              dispatchNotification("plan_failed", email, "Plan cancelled", `Plan execution was cancelled after a step failed.`).catch(() => {});
              return;
            }
            continue;
          }

          await updatePlanStep(step.id, { status: "completed", result: stepOutput });
          socket.emit("claude:step_completed", { planId, stepId: step.id, result: stepOutput });
        }

        await updatePlanStatus(planId, "completed");
        const completedPlan = await getPlan(planId);
        socket.emit("claude:plan_completed", { plan: completedPlan });
        dispatchNotification("plan_completed", email, "Plan completed", `Your plan has been executed successfully.`).catch(() => {});
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    });

    socket.on("claude:resume_plan", ({ planId }: { planId: string }) => {
      const cb = planResumeCallbacks.get(planId);
      if (cb) cb("retry");
    });

    socket.on("claude:skip_step", ({ planId }: { planId: string }) => {
      const cb = planResumeCallbacks.get(planId);
      if (cb) cb("skip");
    });

    socket.on("claude:rollback_stop", ({ planId }: { planId: string }) => {
      const cb = planResumeCallbacks.get(planId);
      if (cb) cb("rollback_stop");
    });

    socket.on("claude:rollback_continue", ({ planId }: { planId: string }) => {
      const cb = planResumeCallbacks.get(planId);
      if (cb) cb("rollback_continue");
    });

    socket.on("claude:cancel_plan", async ({ planId }: { planId: string }) => {
      try {
        const cb = planResumeCallbacks.get(planId);
        if (cb) {
          cb("cancel");
          return;
        }
        await updatePlanStatus(planId, "cancelled");
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
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
          // Lazy require to avoid issues when node-pty is not built
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pty = require("node-pty") as typeof import("node-pty");
          const shell = process.env.SHELL ?? "/bin/bash";
          const ptyProcess = pty.spawn(shell, [], {
            name: "xterm-color",
            cols: cols ?? 80,
            rows: rows ?? 24,
            cwd: PROJECT_ROOT,
            env: process.env as Record<string, string>,
          });

          ptyProcesses.set(socket.id, ptyProcess);

          ptyProcess.onData((data: string) => {
            socket.emit("terminal:output", { data });
          });

          ptyProcess.onExit(() => {
            ptyProcesses.delete(socket.id);
            socket.emit("terminal:close");
          });
        } catch (err) {
          socket.emit("claude:error", { message: "Failed to start terminal: " + String(err) });
        }
      }
    );

    socket.on("terminal:input", ({ data }: { data: string }) => {
      const pty = ptyProcesses.get(socket.id);
      if (pty) pty.write(data);
    });

    socket.on("terminal:resize", ({ cols, rows }: { cols: number; rows: number }) => {
      const pty = ptyProcesses.get(socket.id);
      if (pty) pty.resize(cols, rows);
    });

    socket.on("terminal:close", () => {
      const pty = ptyProcesses.get(socket.id);
      if (pty) {
        pty.kill();
        ptyProcesses.delete(socket.id);
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────

    socket.on("disconnect", () => {
      logActivity("user_logout", email);

      // Kill terminal if active
      const pty = ptyProcesses.get(socket.id);
      if (pty) {
        try { pty.kill(); } catch { /* ignore */ }
        ptyProcesses.delete(socket.id);
      }

      connectedUsers.delete(socket.id);
      broadcastPresence(io);
    });
  });
}

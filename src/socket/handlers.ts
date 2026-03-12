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
    // Verify user exists in SQLite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = (require("../lib/db") as { default: import("better-sqlite3").Database }).default;
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

// ── Module-level state ──────────────────────────────────────────────────────

const connectedUsers = new Map<string, { email: string; activeSession: string | null }>();
const sessionStreamingContent = new Map<string, string>();
const sessionListeners = new Set<string>();
const sessionCommandSubmitter = new Map<string, string>();

type PlanAction = "retry" | "skip" | "cancel" | "rollback_stop" | "rollback_continue";
const planResumeCallbacks = new Map<string, (action: PlanAction) => void>();

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

// ── Main export ──────────────────────────────────────────────────────────────

export function registerHandlers(io: Server) {
  const provider = getClaudeProvider();

  function ensureSessionListener(sessionId: string) {
    if (sessionListeners.has(sessionId)) return;
    sessionListeners.add(sessionId);

    let pendingContent = sessionStreamingContent.get(sessionId) ?? "";

    provider.onOutput(sessionId, async (parsed) => {
      const submittedBy = sessionCommandSubmitter.get(sessionId);
      io.to(`session:${sessionId}`).emit("claude:output", { sessionId, parsed, submittedBy });

      if ((parsed.type === "text" || parsed.type === "streaming") && parsed.content) {
        pendingContent = parsed.content;
        sessionStreamingContent.set(sessionId, parsed.content);
      }

      if (parsed.type === "done" && pendingContent) {
        const contentToSave = pendingContent;
        pendingContent = "";
        sessionStreamingContent.delete(sessionId);
        sessionCommandSubmitter.delete(sessionId);
        await saveMessage(sessionId, "claude", contentToSave).catch(() => {});
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

    connectedUsers.set(socket.id, { email, activeSession: null });
    broadcastPresence(io);

    // ── Session handlers ──────────────────────────────────────────────────

    socket.on(
      "claude:create_session",
      async ({ sessionId, skipPermissions }: { sessionId: string; skipPermissions?: boolean }) => {
        try {
          await createSession(sessionId, email, skipPermissions ?? false);
          provider.createSession(sessionId, { skipPermissions });

          socket.join(`session:${sessionId}`);

          connectedUsers.set(socket.id, { email, activeSession: sessionId });
          broadcastPresence(io);

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

    // ── Disconnect ────────────────────────────────────────────────────────

    socket.on("disconnect", () => {
      connectedUsers.delete(socket.id);
      broadcastPresence(io);
    });
  });
}

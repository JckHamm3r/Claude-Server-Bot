import { execSync } from "child_process";
import type { HandlerContext, PlanAction } from "./types";
import {
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
} from "../lib/claude-db";
import { logActivity } from "../lib/activity-log";
import { dispatchNotification } from "../lib/notifications";

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

function tryGitRollback(): { ok: boolean; error?: string } {
  try {
    execSync("git checkout -- .", { cwd: PROJECT_ROOT, stdio: "pipe" });
    execSync("git clean -fd", { cwd: PROJECT_ROOT, stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function registerPlanHandlers(ctx: HandlerContext) {
  const { socket, email, provider } = ctx;

  // ── Agent handlers ────────────────────────────────────────────────────

  socket.on("claude:list_agents", () => {
    try {
      const agents = listAgents(email);
      socket.emit("claude:agents", { agents });
    } catch {
      socket.emit("claude:agents", { agents: [] });
    }
  });

  socket.on(
    "claude:create_agent",
    ({ name, description, icon, model, allowed_tools }: {
      name: string; description: string; icon?: string; model: string; allowed_tools: string[];
    }) => {
      try {
        createAgent({ name, description, icon, model, allowed_tools }, email);
        ctx.metricsBuffer.agent_count++;
        logActivity("agent_created", email, { name });
        const agents = listAgents(email);
        socket.emit("claude:agents", { agents });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:update_agent",
    ({ agentId, data, changeDescription }: {
      agentId: string;
      data: Partial<{ name: string; description: string; icon: string; model: string; allowed_tools: string[]; status: string }>;
      changeDescription?: string;
    }) => {
      try {
        updateAgent(agentId, data, email, changeDescription);
        const agents = listAgents(email);
        socket.emit("claude:agents", { agents });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:delete_agent", ({ agentId }: { agentId: string }) => {
    try {
      deleteAgent(agentId);
      const agents = listAgents(email);
      socket.emit("claude:agents", { agents });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:get_agent_versions", ({ agentId }: { agentId: string }) => {
    try {
      const versions = getAgentVersions(agentId);
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

  // ── Plan handlers ─────────────────────────────────────────────────────

  socket.on(
    "claude:generate_plan",
    async ({ sessionId, goal }: { sessionId: string; goal: string }) => {
      try {
        const plan = createPlan(sessionId, goal, email);
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

        provider.onOutput(planSessionId, (parsed) => {
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
              updatePlanStatus(plan.id, "reviewing");
              for (let i = 0; i < steps.length; i++) {
                addPlanStep(plan.id, {
                  step_order: i + 1,
                  summary: steps[i].summary,
                  details: steps[i].details,
                });
              }
              const fullPlan = getPlan(plan.id);
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

  socket.on("claude:list_plans", ({ sessionId }: { sessionId: string }) => {
    try {
      const plans = listPlans(sessionId);
      const plansWithSteps = plans.map((p) => {
        const steps = getPlanSteps(p.id);
        return { ...p, steps };
      });
      socket.emit("claude:plans", { sessionId, plans: plansWithSteps });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on(
    "claude:approve_step",
    ({ stepId, planId }: { stepId: string; planId: string }) => {
      try {
        updatePlanStep(stepId, { status: "approved", approved_by: email });
        const plan = getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:reject_step",
    ({ stepId, planId }: { stepId: string; planId: string }) => {
      try {
        updatePlanStep(stepId, { status: "rejected" });
        const plan = getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:approve_all_steps", ({ planId }: { planId: string }) => {
    try {
      const steps = getPlanSteps(planId);
      for (const step of steps) {
        if (step.status === "pending") {
          updatePlanStep(step.id, { status: "approved", approved_by: email });
        }
      }
      const plan = getPlan(planId);
      socket.emit("claude:plan_updated", { plan });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:reject_all_steps", ({ planId }: { planId: string }) => {
    try {
      const steps = getPlanSteps(planId);
      for (const step of steps) {
        if (step.status === "pending") {
          updatePlanStep(step.id, { status: "rejected" });
        }
      }
      const plan = getPlan(planId);
      socket.emit("claude:plan_updated", { plan });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on(
    "claude:reorder_step",
    ({ stepId, planId, newOrder }: { stepId: string; planId: string; newOrder: number }) => {
      try {
        updatePlanStep(stepId, { step_order: newOrder });
        const plan = getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:edit_step",
    ({ stepId, planId, summary, details }: { stepId: string; planId: string; summary: string; details: string }) => {
      try {
        updatePlanStep(stepId, { summary, details });
        const plan = getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:execute_plan", async ({ planId }: { planId: string }) => {
    try {
      const plan = getPlan(planId);
      if (!plan) {
        socket.emit("claude:error", { message: "Plan not found" });
        return;
      }
      logActivity("plan_executed", email, { planId });
      const approvedSteps = (plan.steps ?? []).filter((s) => s.status === "approved");
      updatePlanStatus(planId, "executing");
      socket.emit("claude:plan_executing", { planId });

      for (const step of approvedSteps) {
        updatePlanStep(step.id, { status: "executing", executed_at: new Date().toISOString() });
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
          updatePlanStep(step.id, { status: "failed", error: stepError });
          socket.emit("claude:step_failed", { planId, stepId: step.id, error: stepError });
          socket.emit("claude:plan_paused", {
            planId,
            stepId: step.id,
            error: stepError,
            canRollback: true,
          });

          const action = await new Promise<PlanAction>((resolve) => {
            ctx.planResumeCallbacks.set(planId, resolve);
          });
          ctx.planResumeCallbacks.delete(planId);

          if (action === "rollback_stop" || action === "rollback_continue") {
            const rollback = tryGitRollback();
            const rollbackStatus = rollback.ok ? "rolled_back" : "failed";
            updatePlanStep(step.id, { status: rollbackStatus });
            socket.emit("claude:step_rolled_back", {
              planId,
              stepId: step.id,
              ok: rollback.ok,
              error: rollback.error,
            });
          }

          if (action === "cancel" || action === "rollback_stop") {
            updatePlanStatus(planId, "cancelled");
            const updatedPlan = getPlan(planId);
            socket.emit("claude:plan_updated", { plan: updatedPlan });
            dispatchNotification("plan_failed", email, "Plan cancelled", `Plan execution was cancelled after a step failed.`).catch(() => {});
            return;
          }
          continue;
        }

        updatePlanStep(step.id, { status: "completed", result: stepOutput });
        socket.emit("claude:step_completed", { planId, stepId: step.id, result: stepOutput });
      }

      updatePlanStatus(planId, "completed");
      const completedPlan = getPlan(planId);
      socket.emit("claude:plan_completed", { plan: completedPlan });
      dispatchNotification("plan_completed", email, "Plan completed", `Your plan has been executed successfully.`).catch(() => {});
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:resume_plan", ({ planId }: { planId: string }) => {
    const cb = ctx.planResumeCallbacks.get(planId);
    if (cb) cb("retry");
  });

  socket.on("claude:skip_step", ({ planId }: { planId: string }) => {
    const cb = ctx.planResumeCallbacks.get(planId);
    if (cb) cb("skip");
  });

  socket.on("claude:rollback_stop", ({ planId }: { planId: string }) => {
    const cb = ctx.planResumeCallbacks.get(planId);
    if (cb) cb("rollback_stop");
  });

  socket.on("claude:rollback_continue", ({ planId }: { planId: string }) => {
    const cb = ctx.planResumeCallbacks.get(planId);
    if (cb) cb("rollback_continue");
  });

  socket.on("claude:cancel_plan", ({ planId }: { planId: string }) => {
    try {
      const cb = ctx.planResumeCallbacks.get(planId);
      if (cb) {
        cb("cancel");
        return;
      }
      updatePlanStatus(planId, "cancelled");
      const plan = getPlan(planId);
      socket.emit("claude:plan_updated", { plan });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });
}

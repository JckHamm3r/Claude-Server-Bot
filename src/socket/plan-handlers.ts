import type { HandlerContext, PlanAction } from "./types";
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgent,
  getAgentVersions,
  createPlan,
  getPlan,
  updatePlanStatus,
  listPlansForUser,
  addPlanStep,
  getPlanSteps,
  updatePlanStep,
  deletePlanSteps,
  deletePlan,
  isUserAdmin,
  getAgentMemories,
  setMemoryAssignments,
  getMemories,
} from "../lib/claude-db";
import { logActivity } from "../lib/activity-log";
import { dispatchNotification } from "../lib/notifications";
import { DEFAULT_MODEL } from "../lib/models";

function sanitizePromptInput(input: string, maxLen = 2000): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen);
}

const planExecutionCounts = new Map<string, number>();

const planOwners = new Map<string, string>();

export function registerPlanHandlers(ctx: HandlerContext) {
  const { socket, email, provider } = ctx;

  // ── Agent handlers ────────────────────────────────────────────────────

  socket.on("claude:list_agents", async () => {
    try {
      const agents = await listAgents(email);
      socket.emit("claude:agents", { agents });
    } catch {
      socket.emit("claude:agents", { agents: [] });
    }
  });

  socket.on(
    "claude:create_agent",
    async ({ name, description, icon, model, allowed_tools }: {
      name: string; description: string; icon?: string; model: string; allowed_tools: string[];
    }) => {
      try {
        await createAgent({ name, description, icon, model, allowed_tools }, email);
        ctx.metricsBuffer.agent_count++;
        await logActivity("agent_created", email, { name });
        const agents = await listAgents(email);
        socket.emit("claude:agents", { agents });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:update_agent",
    async ({ agentId, data, changeDescription }: {
      agentId: string;
      data: Partial<{ name: string; description: string; icon: string; model: string; allowed_tools: string[]; status: string }>;
      changeDescription?: string;
    }) => {
      try {
        const agent = await getAgent(agentId);
        if (!agent || (agent.created_by !== email && !await isUserAdmin(email))) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
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
      const agent = await getAgent(agentId);
      if (!agent || (agent.created_by !== email && !await isUserAdmin(email))) {
        socket.emit("claude:error", { message: "Access denied" });
        return;
      }
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

  socket.on("claude:get_agent_memories", async ({ agentId }: { agentId: string }) => {
    try {
      const memories = await getAgentMemories(agentId);
      socket.emit("claude:agent_memories", { agentId, memories });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on(
    "claude:set_memory_assignments",
    async ({ memoryId, isGlobal, agentIds }: { memoryId: string; isGlobal: boolean; agentIds: string[] }) => {
      try {
        if (!await isUserAdmin(email)) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
        await setMemoryAssignments(memoryId, isGlobal, agentIds);
        const memories = await getMemories();
        socket.emit("claude:memories_updated", { memories });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:generate_agent", async ({ description }: { description: string }) => {
    const sessionId = `agent-gen-${Date.now()}`;
    try {
      provider.createSession(sessionId, { skipPermissions: true });

      const prompt = `Generate a Claude Code agent configuration for: ${sanitizePromptInput(description)}

Return ONLY valid JSON with these fields:
{
  "name": "string",
  "description": "string",
  "model": "${DEFAULT_MODEL}",
  "allowed_tools": ["array", "of", "tool", "names"],
  "icon": "emoji"
}

Available tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent
Return only the JSON object, no markdown, no explanation.`;

      let lastTextOutput = "";

      provider.onOutput(sessionId, (parsed) => {
        if (parsed.type === "text" && parsed.content) {
          lastTextOutput = parsed.content;
        } else if (parsed.type === "streaming" && parsed.content) {
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
        if (!goal?.trim()) {
          socket.emit("claude:error", { message: "Goal is required" });
          return;
        }
        // Plans are user-owned; no session access check needed.
        // sessionId is a stable per-user grouping key, not a real chat session.
        const plan = await createPlan(sessionId, goal, email);
        await logActivity("plan_created", email, { planId: plan.id, goal });
        const planSessionId = "plan-gen-" + plan.id;
        provider.createSession(planSessionId, { skipPermissions: true });

        const prompt = `You are helping plan a multi-step development task for a software project.

Goal: ${sanitizePromptInput(goal)}

Generate a detailed step-by-step plan. Return ONLY a JSON array of steps:
[
  { "summary": "brief one-line summary", "details": "detailed explanation of what will be done" },
  ...
]

Be specific. Each step should be atomic and independently executable. Return only the JSON array.`;

        let lastOutput = "";

        provider.onOutput(planSessionId, async (parsed) => {
          if (parsed.type === "text" && parsed.content) {
            lastOutput = parsed.content;
            socket.emit("claude:plan_progress", { planId: plan.id, content: lastOutput });
          } else if (parsed.type === "streaming" && parsed.content) {
            lastOutput = parsed.content;
            socket.emit("claude:plan_progress", { planId: plan.id, content: lastOutput });
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
              const cappedSteps = steps.slice(0, 50);
              await updatePlanStatus(plan.id, "reviewing");
              for (let i = 0; i < cappedSteps.length; i++) {
                await addPlanStep(plan.id, {
                  step_order: i + 1,
                  summary: cappedSteps[i].summary,
                  details: cappedSteps[i].details,
                });
              }
              const fullPlan = await getPlan(plan.id);
              socket.emit("claude:plan_generated", { plan: fullPlan });
            } catch {
              await updatePlanStatus(plan.id, "failed");
              socket.emit("claude:error", { message: "Failed to parse plan steps from Claude response" });
            }
          }
          if (parsed.type === "error") {
            provider.offOutput(planSessionId);
            provider.closeSession(planSessionId);
            await updatePlanStatus(plan.id, "failed");
            socket.emit("claude:error", { message: parsed.message ?? "Claude error during plan generation" });
          }
        });

        provider.sendMessage(planSessionId, prompt);
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:list_plans", async ({ sessionId }: { sessionId?: string }) => {
    try {
      // List ALL plans for this user so they persist across page refreshes.
      const plans = await listPlansForUser(email);
      const plansWithSteps = await Promise.all(
        plans.map(async (p) => {
          const steps = await getPlanSteps(p.id);
          return { ...p, steps };
        }),
      );
      socket.emit("claude:plans", { sessionId: sessionId ?? "", plans: plansWithSteps });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on(
    "claude:approve_step",
    async ({ stepId, planId }: { stepId: string; planId: string }) => {
      try {
        const existingPlan = await getPlan(planId);
        if (!existingPlan || (existingPlan.created_by !== email && !await isUserAdmin(email))) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
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
        const existingPlan = await getPlan(planId);
        if (!existingPlan || (existingPlan.created_by !== email && !await isUserAdmin(email))) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
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
      if (plan.created_by !== email && !await isUserAdmin(email)) {
        socket.emit("claude:error", { message: "Access denied" });
        return;
      }

      const currentCount = planExecutionCounts.get(email) ?? 0;
      if (currentCount >= 2) {
        socket.emit("claude:error", { message: "Too many concurrent plan executions. Please wait for an existing plan to complete." });
        return;
      }
      planExecutionCounts.set(email, currentCount + 1);
      planOwners.set(planId, email);

      await logActivity("plan_executed", email, { planId });
      const approvedSteps = (plan.steps ?? []).filter((s) => s.status === "approved");
      await updatePlanStatus(planId, "executing");
      socket.emit("claude:plan_executing", { planId });

      // Plan steps are user-approved, so always run with skipPermissions to
      // avoid the execution hanging indefinitely on tool permission prompts.
      const planSessionId = `plan-step-${planId}-${Date.now()}`;
      provider.createSession(planSessionId, {
        skipPermissions: true,
        model: DEFAULT_MODEL,
        maxTurns: 200,
      });

      const cleanupPlanSession = () => {
        provider.offOutput(planSessionId);
        provider.closeSession(planSessionId);
      };

      // First message establishes the plan context once
      const stepSummaries = approvedSteps
        .map((s, i) => `${i + 1}. ${s.summary}`)
        .join("\n");
      const initPrompt = `You are executing a multi-step plan. Execute each step I give you.\n\nOverall goal: ${sanitizePromptInput(plan.goal)}\n\nFull plan (${approvedSteps.length} steps):\n${stepSummaries}\n\nI will now give you each step one at a time. Execute only the step I provide, then stop and wait for the next.`;

      // Send the plan overview as the first message so Claude has full context
      await new Promise<void>((resolve) => {
        provider.onOutput(planSessionId, (parsed) => {
          if (parsed.type === "done") resolve();
        });
        provider.sendMessage(planSessionId, initPrompt);
      });

      let stepIdx = 0;
      while (stepIdx < approvedSteps.length) {
        const step = approvedSteps[stepIdx];
        await updatePlanStep(step.id, { status: "executing", executed_at: new Date().toISOString() });
        socket.emit("claude:step_executing", { planId, stepId: step.id });

        const stepPrompt = `Execute step ${stepIdx + 1}: ${sanitizePromptInput(step.summary)}${step.details ? `\nDetails: ${sanitizePromptInput(step.details)}` : ""}`;

        let stepOutput = "";
        let stepError = "";

        await new Promise<void>((resolve) => {
          provider.onOutput(planSessionId, (parsed) => {
            if (parsed.type === "text" && parsed.content) {
              stepOutput = parsed.content;
              socket.emit("claude:step_progress", { planId, stepId: step.id, content: stepOutput });
            } else if (parsed.type === "streaming" && parsed.content) {
              stepOutput = parsed.content;
              socket.emit("claude:step_progress", { planId, stepId: step.id, content: stepOutput });
            }
            if (parsed.type === "error") {
              stepError = parsed.message ?? "Unknown error";
            }
            if (parsed.type === "done") {
              resolve();
            }
          });
          provider.sendMessage(planSessionId, stepPrompt);
        });

        if (stepError) {
          await updatePlanStep(step.id, { status: "failed", error: stepError });
          socket.emit("claude:step_failed", { planId, stepId: step.id, error: stepError });
          socket.emit("claude:plan_paused", {
            planId,
            stepId: step.id,
            error: stepError,
          });

          const action = await new Promise<PlanAction>((resolve) => {
            ctx.planResumeCallbacks.set(planId, resolve);
          });
          ctx.planResumeCallbacks.delete(planId);

          if (action === "cancel") {
            cleanupPlanSession();
            planExecutionCounts.set(email, (planExecutionCounts.get(email) ?? 1) - 1);
            planOwners.delete(planId);
            await updatePlanStatus(planId, "failed");
            const updatedPlan = await getPlan(planId);
            socket.emit("claude:plan_updated", { plan: updatedPlan });
            dispatchNotification("plan_failed", email, "Plan failed", `Plan execution failed and was stopped.`).catch(() => {});
            return;
          }

          if (action === "retry") {
            continue;
          }

          stepIdx++;
          continue;
        }

        await updatePlanStep(step.id, { status: "completed", result: stepOutput });
        socket.emit("claude:step_completed", { planId, stepId: step.id, result: stepOutput });
        stepIdx++;
      }

      cleanupPlanSession();
      planExecutionCounts.set(email, (planExecutionCounts.get(email) ?? 1) - 1);
      planOwners.delete(planId);
      await updatePlanStatus(planId, "completed");
      const completedPlan = await getPlan(planId);
      socket.emit("claude:plan_completed", { plan: completedPlan });
      dispatchNotification("plan_completed", email, "Plan completed", `Your plan has been executed successfully.`).catch(() => {});
    } catch (err) {
      planExecutionCounts.set(email, (planExecutionCounts.get(email) ?? 1) - 1);
      planOwners.delete(planId);
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
    if (cb) cb("cancel");
  });

  socket.on("claude:rollback_continue", ({ planId }: { planId: string }) => {
    const cb = ctx.planResumeCallbacks.get(planId);
    if (cb) cb("skip");
  });

  socket.on("claude:cancel_plan", async ({ planId }: { planId: string }) => {
    try {
      const cb = ctx.planResumeCallbacks.get(planId);
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

  socket.on(
    "claude:refine_plan",
    async ({ planId, instruction }: { planId: string; instruction: string }) => {
      try {
        const existingPlan = await getPlan(planId);
        if (!existingPlan) {
          socket.emit("claude:error", { message: "Plan not found" });
          return;
        }

        const existingSteps = existingPlan.steps ?? [];
        const numberedSteps = existingSteps
          .map((s, i) => `${i + 1}. ${s.summary}${s.details ? ` — ${s.details}` : ""}`)
          .join("\n");

        await updatePlanStatus(planId, "drafting");

        const refineSessionId = `plan-refine-${planId}-${Date.now()}`;
        provider.createSession(refineSessionId, { skipPermissions: true });

        const prompt = `You are helping refine a multi-step development plan.

Here is an existing plan for: ${sanitizePromptInput(existingPlan.goal)}

Current steps:
${numberedSteps}

User instruction: ${sanitizePromptInput(instruction)}

Generate an updated plan incorporating the user's instruction. Return ONLY a JSON array of steps:
[
  { "summary": "brief one-line summary", "details": "detailed explanation of what will be done" },
  ...
]

Be specific. Each step should be atomic and independently executable. Return only the JSON array.`;

        let lastOutput = "";

        provider.onOutput(refineSessionId, async (parsed) => {
          if (parsed.type === "text" && parsed.content) {
            lastOutput = parsed.content;
            socket.emit("claude:plan_progress", { planId, content: lastOutput });
          } else if (parsed.type === "streaming" && parsed.content) {
            lastOutput = parsed.content;
            socket.emit("claude:plan_progress", { planId, content: lastOutput });
          }
          if (parsed.type === "done") {
            provider.offOutput(refineSessionId);
            provider.closeSession(refineSessionId);
            try {
              const cleaned = lastOutput
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```\s*$/, "")
                .trim();
              const steps: { summary: string; details?: string }[] = JSON.parse(cleaned);
              const cappedSteps = steps.slice(0, 50);
              await deletePlanSteps(planId);
              for (let i = 0; i < cappedSteps.length; i++) {
                await addPlanStep(planId, {
                  step_order: i + 1,
                  summary: cappedSteps[i].summary,
                  details: cappedSteps[i].details,
                });
              }
              await updatePlanStatus(planId, "reviewing");
              const fullPlan = await getPlan(planId);
              socket.emit("claude:plan_generated", { plan: fullPlan });
            } catch {
              await updatePlanStatus(planId, "failed");
              socket.emit("claude:error", { message: "Failed to parse refined plan from Claude response" });
            }
          }
          if (parsed.type === "error") {
            provider.offOutput(refineSessionId);
            provider.closeSession(refineSessionId);
            await updatePlanStatus(planId, "failed");
            socket.emit("claude:error", { message: parsed.message ?? "Claude error during plan refinement" });
          }
        });

        provider.sendMessage(refineSessionId, prompt);
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:delete_plan", async ({ planId }: { planId: string }) => {
    try {
      const existingPlan = await getPlan(planId);
      if (!existingPlan || (existingPlan.created_by !== email && !await isUserAdmin(email))) {
        socket.emit("claude:error", { message: "Access denied" });
        return;
      }
      await deletePlan(planId);
      socket.emit("claude:plan_deleted", { planId });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("disconnect", () => {
    // Cancel plans waiting for user action (paused at a resume callback)
    for (const [planId, cb] of ctx.planResumeCallbacks) {
      if (planOwners.get(planId) === email) {
        cb("cancel");
      }
    }
    // Decrement counts for any plans that are still running but have no resume
    // callback (i.e. they are actively executing a step, not waiting for input).
    // Without this the in-memory counter leaks and blocks new plan executions
    // for the lifetime of the server process.
    for (const [planId, owner] of planOwners) {
      if (owner === email && !ctx.planResumeCallbacks.has(planId)) {
        planExecutionCounts.set(email, Math.max(0, (planExecutionCounts.get(email) ?? 1) - 1));
        planOwners.delete(planId);
      }
    }
  });
}

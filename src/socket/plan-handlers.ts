import { execFileSync } from "child_process";
import type { HandlerContext, PlanAction } from "./types";
import {
  type ClaudePlanStep,
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
  incrementPlanCost,
} from "../lib/claude-db";
import { logActivity } from "../lib/activity-log";
import { dispatchNotification } from "../lib/notifications";
import { DEFAULT_MODEL } from "../lib/models";
import { buildSystemPrompt } from "../lib/system-prompt";
import { validateDependencyGraph, getReadySteps } from "../lib/plan-scheduler";

function sanitizePromptInput(input: string, maxLen = 2000): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen);
}

function isValidPlanId(id: string): boolean {
  return /^[0-9a-f-]+$/i.test(id) && id.length <= 64;
}

interface StepResult {
  summary: string;
  toolCalls: {
    tool: string;
    input: string;
    status: "done" | "error";
    exitCode?: number;
  }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  } | null;
}

function parseStepResult(raw: string | null): StepResult {
  if (!raw) return { summary: "", toolCalls: [], usage: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.summary === "string") return parsed;
  } catch { /* not JSON — legacy plain text */ }
  return { summary: raw, toolCalls: [], usage: null };
}

function buildStepPrompt(
  plan: { goal: string; steps?: { step_order: number; summary: string; status: string; result: string | null }[] },
  step: { summary: string; details: string | null },
  stepIdx: number,
  totalSteps: number,
): string {
  const lines: string[] = [];

  lines.push("## Plan Overview");
  lines.push(`Goal: ${plan.goal}`);
  lines.push("Steps:");
  for (const s of (plan.steps ?? []).slice().sort((a, b) => a.step_order - b.step_order)) {
    const marker = s.status === "completed" ? "✓" : s.status === "executing" ? "→" : s.status === "failed" ? "✗" : "○";
    lines.push(`  ${marker} ${s.step_order}. ${s.summary}`);
  }
  lines.push("");

  const completedSteps = (plan.steps ?? [])
    .filter((s) => s.status === "completed" && s.result)
    .sort((a, b) => a.step_order - b.step_order);
  if (completedSteps.length > 0) {
    lines.push("## Previous Step Results");
    let contextLen = 0;
    for (const s of completedSteps) {
      const parsed = parseStepResult(s.result);
      const snippet = parsed.summary.slice(0, 500);
      const entry = `Step ${s.step_order}: ${s.summary} → ${snippet}`;
      if (contextLen + entry.length > 4000) break;
      lines.push(entry);
      contextLen += entry.length;
    }
    lines.push("");
  }

  lines.push(`## Current Step (${stepIdx + 1} of ${totalSteps})`);
  lines.push(step.summary);
  if (step.details) lines.push(step.details);
  lines.push("");
  lines.push("Execute this step now. Use tools to make the actual changes.");

  return lines.join("\n");
}

async function executeStep(
  ctx: HandlerContext,
  plan: NonNullable<Awaited<ReturnType<typeof getPlan>>>,
  step: NonNullable<NonNullable<typeof plan>["steps"]>[number],
  stepIdx: number,
  totalSteps: number,
  systemPrompt: string | undefined,
): Promise<{ result: StepResult; error?: string }> {
  const { socket, provider } = ctx;
  const planId = plan.id;
  const stepSessionId = `plan-step-${planId}-${step.id}`;
  const STEP_TIMEOUT_MS = 5 * 60 * 1000;

  const toolCalls: StepResult["toolCalls"] = [];
  let stepOutput = "";
  let stepError = "";
  let stepUsage: StepResult["usage"] = null;

  const preamble = [
    `You are executing step ${stepIdx + 1} of ${totalSteps} in a multi-step plan.`,
    "",
    `Goal: ${plan.goal}`,
    "",
    "Your job is to EXECUTE this step by using your tools (Write, Bash, Edit, etc.).",
    "Do not just describe what to do — actually do it. Use tools to create files, run",
    "commands, and make changes. When done, provide a brief summary of what you did.",
  ].join("\n");

  const fullSystemPrompt = systemPrompt
    ? preamble + "\n\n" + systemPrompt
    : preamble;

  provider.createSession(stepSessionId, {
    skipPermissions: true,
    systemPrompt: fullSystemPrompt,
    model: DEFAULT_MODEL,
    maxTurns: 50,
    userEmail: ctx.email,
  });

  ctx.activePlanSessions ??= new Map();
  if (!ctx.activePlanSessions.has(planId)) ctx.activePlanSessions.set(planId, new Set());
  ctx.activePlanSessions.get(planId)!.add(stepSessionId);

  const stepPrompt = buildStepPrompt(plan, step, stepIdx, totalSteps);

  return new Promise((resolve) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      provider.offOutput(stepSessionId);
      provider.closeSession(stepSessionId);
      ctx.activePlanSessions?.get(planId)?.delete(stepSessionId);
    };

    timeoutHandle = setTimeout(() => {
      provider.interrupt(stepSessionId);
      cleanup();
      resolve({
        result: { summary: stepOutput, toolCalls, usage: stepUsage },
        error: `Step timed out after ${STEP_TIMEOUT_MS / 1000}s`,
      });
    }, STEP_TIMEOUT_MS);

    provider.onOutput(stepSessionId, (parsed) => {
      if (parsed.type === "streaming" && parsed.content) {
        stepOutput = parsed.content;
        socket.emit("claude:step_progress", {
          planId, stepId: step.id, type: "text", content: stepOutput,
        });
      }
      if (parsed.type === "text" && parsed.content) {
        stepOutput = parsed.content;
        socket.emit("claude:step_progress", {
          planId, stepId: step.id, type: "text", content: stepOutput,
        });
      }

      if (parsed.type === "tool_call") {
        socket.emit("claude:step_tool_activity", {
          planId, stepId: step.id,
          toolCallId: parsed.toolCallId,
          toolName: parsed.toolName,
          toolInput: parsed.toolInput,
          status: "running",
        });
      }
      if (parsed.type === "tool_result") {
        const inputSummary = parsed.toolName === "Bash"
          ? String((parsed as { toolInput?: { command?: string } }).toolInput?.command ?? "").slice(0, 200)
          : String((parsed as { toolInput?: { file_path?: string } }).toolInput?.file_path ?? "").slice(0, 200);
        toolCalls.push({
          tool: parsed.toolName ?? "unknown",
          input: inputSummary,
          status: parsed.toolStatus === "error" ? "error" : "done",
          exitCode: parsed.exitCode,
        });
        socket.emit("claude:step_tool_activity", {
          planId, stepId: step.id,
          toolCallId: parsed.toolCallId,
          toolName: parsed.toolName,
          toolResult: typeof parsed.toolResult === "string" ? parsed.toolResult.slice(0, 2000) : "",
          toolStatus: parsed.toolStatus,
          exitCode: parsed.exitCode,
        });
      }

      if (parsed.type === "progress" && parsed.message) {
        socket.emit("claude:step_progress", {
          planId, stepId: step.id, type: "progress", message: parsed.message,
        });
      }

      if (parsed.type === "usage" && parsed.usage) {
        stepUsage = {
          input_tokens: parsed.usage.input_tokens,
          output_tokens: parsed.usage.output_tokens,
          cost_usd: parsed.usage.cost_usd ?? 0,
        };
        socket.emit("claude:step_usage", {
          planId, stepId: step.id, usage: stepUsage,
        });
      }

      if (parsed.type === "error") {
        stepError = parsed.message ?? "Unknown error";
        socket.emit("claude:step_progress", {
          planId, stepId: step.id, type: "error", message: stepError,
        });
      }

      if (parsed.type === "done") {
        cleanup();
        if (stepError) {
          resolve({
            result: { summary: stepOutput, toolCalls, usage: stepUsage },
            error: stepError,
          });
        } else {
          resolve({
            result: { summary: stepOutput, toolCalls, usage: stepUsage },
          });
        }
      }
    });

    provider.sendMessage(stepSessionId, stepPrompt);
  });
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
  { "summary": "brief one-line summary", "details": "detailed explanation", "depends_on": [] },
  ...
]

The "depends_on" array contains 1-based step numbers that must complete before this step can start.
Most steps should depend on the previous step (sequential). Only mark steps as independent
(empty depends_on) if they can truly run in parallel with no shared state.

Be specific. Each step should be atomic and independently executable. Max 50 steps. Return only the JSON array.`;

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
              const steps: { summary: string; details?: string; depends_on?: number[] }[] = JSON.parse(cleaned);
              const cappedSteps = steps.slice(0, 50);
              await updatePlanStatus(plan.id, "reviewing");

              // First pass: create all steps to get their IDs
              const createdSteps: ClaudePlanStep[] = [];
              for (let i = 0; i < cappedSteps.length; i++) {
                const created = await addPlanStep(plan.id, {
                  step_order: i + 1,
                  summary: cappedSteps[i].summary,
                  details: cappedSteps[i].details,
                });
                createdSteps.push(created);
              }

              // Second pass: resolve depends_on indices to UUIDs
              for (let i = 0; i < cappedSteps.length; i++) {
                const deps = cappedSteps[i].depends_on;
                if (Array.isArray(deps) && deps.length > 0) {
                  const resolvedIds = deps
                    .filter((idx: number) => idx >= 1 && idx <= createdSteps.length && idx !== i + 1)
                    .map((idx: number) => createdSteps[idx - 1].id);
                  if (resolvedIds.length > 0) {
                    await updatePlanStep(createdSteps[i].id, {
                      depends_on: JSON.stringify(resolvedIds),
                    });
                  }
                }
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

      // Create git checkpoint for rollback if project is a git repo
      let canRollback = false;
      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      try {
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot, stdio: "pipe" });
        if (isValidPlanId(planId)) {
          execFileSync("git", ["tag", "-f", `plan-checkpoint-${planId}`], { cwd: projectRoot, stdio: "pipe" });
          canRollback = true;
        }
      } catch { /* not a git repo — rollback unavailable */ }

      socket.emit("claude:plan_executing", { planId, canRollback });

      const systemPrompt = await buildSystemPrompt({ interfaceType: "plan_execution" });

      const MAX_PARALLEL = 3;
      const completedIds = new Set<string>();
      const runningIds = new Set<string>();
      const skippedIds = new Set<string>();
      let cancelled = false;

      // Validate dependency graph — fall back to sequential if cycles found
      const hasDeps = approvedSteps.some((s) => s.depends_on && s.depends_on.length > 0);
      const isAcyclic = hasDeps ? validateDependencyGraph(approvedSteps) : true;
      if (hasDeps && !isAcyclic) {
        socket.emit("claude:step_progress", {
          planId, stepId: approvedSteps[0].id,
          type: "progress",
          message: "Warning: Circular dependencies detected. Running steps sequentially.",
        });
        for (const s of approvedSteps) {
          (s as { depends_on: null }).depends_on = null;
        }
      }

      while (!cancelled) {
        const freshPlan = await getPlan(planId);
        if (!freshPlan) break;

        const dbSteps = freshPlan.steps ?? [];
        for (const s of dbSteps) {
          if (s.status === "completed") completedIds.add(s.id);
        }

        const ready = getReadySteps(approvedSteps, completedIds, runningIds);
        if (ready.length === 0 && runningIds.size === 0) break;
        if (ready.length === 0) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        const toLaunch = ready.slice(0, MAX_PARALLEL - runningIds.size);

        const promises = toLaunch.map(async (step) => {
          const stepIdx = approvedSteps.findIndex((s) => s.id === step.id);
          runningIds.add(step.id);

          await updatePlanStep(step.id, { status: "executing", executed_at: new Date().toISOString() });
          socket.emit("claude:step_executing", { planId, stepId: step.id });

          const { result, error } = await executeStep(
            ctx, freshPlan, approvedSteps[stepIdx], stepIdx, approvedSteps.length, systemPrompt,
          );

          runningIds.delete(step.id);

          if (result.usage) {
            await updatePlanStep(step.id, {
              input_tokens: result.usage.input_tokens,
              output_tokens: result.usage.output_tokens,
              cost_usd: result.usage.cost_usd,
            });
            await incrementPlanCost(planId, result.usage.input_tokens, result.usage.output_tokens, result.usage.cost_usd);
          }

          return { step, result, error };
        });

        const results = await Promise.all(promises);

        for (const { step, result, error } of results) {
          if (error) {
            await updatePlanStep(step.id, { status: "failed", result: JSON.stringify(result), error });
            socket.emit("claude:step_failed", { planId, stepId: step.id, error });
            socket.emit("claude:plan_paused", { planId, stepId: step.id, error, canRollback });

            const updatedPlan = await getPlan(planId);
            socket.emit("claude:plan_updated", { plan: updatedPlan });

            const action = await new Promise<PlanAction>((resolve) => {
              ctx.planResumeCallbacks.set(planId, resolve);
            });
            ctx.planResumeCallbacks.delete(planId);

            if (action === "cancel") { cancelled = true; break; }
            if (action === "retry") {
              await updatePlanStep(step.id, { status: "approved" });
            } else {
              skippedIds.add(step.id);
              completedIds.add(step.id);
            }
          } else {
            completedIds.add(step.id);
            await updatePlanStep(step.id, { status: "completed", result: JSON.stringify(result) });
            socket.emit("claude:step_completed", { planId, stepId: step.id, result: JSON.stringify(result) });
            const updatedPlan = await getPlan(planId);
            socket.emit("claude:plan_updated", { plan: updatedPlan });
          }
        }

        if (cancelled) {
          planExecutionCounts.set(email, (planExecutionCounts.get(email) ?? 1) - 1);
          planOwners.delete(planId);
          await updatePlanStatus(planId, "failed");
          const failedPlan = await getPlan(planId);
          socket.emit("claude:plan_updated", { plan: failedPlan });
          dispatchNotification("plan_failed", email, "Plan failed", "Plan execution failed and was stopped.").catch(() => {});
          return;
        }
      }

      planExecutionCounts.set(email, (planExecutionCounts.get(email) ?? 1) - 1);
      planOwners.delete(planId);
      await updatePlanStatus(planId, "completed");
      const completedPlan = await getPlan(planId);
      socket.emit("claude:plan_completed", { plan: completedPlan });
      dispatchNotification("plan_completed", email, "Plan completed", "Your plan has been executed successfully.").catch(() => {});
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


  socket.on("claude:rollback_stop", async ({ planId }: { planId: string }) => {
    try {
      if (!isValidPlanId(planId)) {
        socket.emit("claude:error", { message: "Invalid plan ID" });
        return;
      }
      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      // Discard uncommitted changes
      execFileSync("git", ["checkout", "--", "."], { cwd: projectRoot, stdio: "pipe" });

      // Reset any commits made during execution
      try {
        execFileSync("git", ["reset", "--mixed", `plan-checkpoint-${planId}`], { cwd: projectRoot, stdio: "pipe" });
      } catch { /* no commits to reset */ }

      // Clean up tag
      try {
        execFileSync("git", ["tag", "-d", `plan-checkpoint-${planId}`], { cwd: projectRoot, stdio: "pipe" });
      } catch { /* tag already deleted */ }

      // Mark steps as rolled back
      const plan = await getPlan(planId);
      for (const step of plan?.steps ?? []) {
        if (["executing", "completed", "failed"].includes(step.status)) {
          await updatePlanStep(step.id, { status: "rolled_back" });
        }
      }

      const cb = ctx.planResumeCallbacks.get(planId);
      if (cb) cb("cancel");
    } catch (err) {
      socket.emit("claude:error", { message: `Rollback failed: ${err}` });
    }
  });

  socket.on("claude:rollback_continue", async ({ planId }: { planId: string }) => {
    try {
      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      // Discard uncommitted changes (current step only — best effort)
      execFileSync("git", ["checkout", "--", "."], { cwd: projectRoot, stdio: "pipe" });

      const cb = ctx.planResumeCallbacks.get(planId);
      if (cb) cb("skip");
    } catch (err) {
      socket.emit("claude:error", { message: `Rollback failed: ${err}` });
    }
  });

  socket.on("claude:cancel_plan", async ({ planId }: { planId: string }) => {
    try {
      const activeSessionIds = ctx.activePlanSessions?.get(planId);
      if (activeSessionIds) {
        for (const sid of activeSessionIds) {
          provider.interrupt(sid);
          provider.closeSession(sid);
        }
        ctx.activePlanSessions?.delete(planId);
      }

      const cb = ctx.planResumeCallbacks.get(planId);
      if (cb) {
        cb("cancel");
      } else {
        await updatePlanStatus(planId, "cancelled");
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
        planExecutionCounts.set(email, Math.max(0, (planExecutionCounts.get(email) ?? 1) - 1));
        planOwners.delete(planId);
      }
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
    // Clean up active plan step sessions on disconnect
    if (ctx.activePlanSessions) {
      for (const [, sessions] of ctx.activePlanSessions) {
        for (const sid of sessions) {
          provider.interrupt(sid);
          provider.closeSession(sid);
        }
      }
      ctx.activePlanSessions.clear();
    }

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

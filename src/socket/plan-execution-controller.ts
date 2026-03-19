import { execFileSync } from "child_process";
import type { HandlerContext, PlanAction } from "./types";
import type { ClaudePlanStep } from "../lib/claude-db";
import {
  getPlan,
  getPlanSteps,
  updatePlanStatus,
  updatePlanStep,
  incrementPlanCost,
} from "../lib/claude-db";
import { dispatchNotification } from "../lib/notifications";
import { DEFAULT_MODEL } from "../lib/models";
import { buildSystemPrompt } from "../lib/system-prompt";
import { validateDependencyGraph, getReadySteps } from "../lib/plan-scheduler";
import type { ClaudeCodeProvider } from "../lib/claude/provider";

// ── Types ────────────────────────────────────────────────────────────────────

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

export type ControllerState = "idle" | "executing" | "paused" | "error_paused" | "done";

// ── Module-level execution tracking ──────────────────────────────────────────

const planExecutionCounts = new Map<string, number>();
const planOwners = new Map<string, string>();

export { planExecutionCounts, planOwners };

// ── Helpers ──────────────────────────────────────────────────────────────────

function isValidPlanId(id: string): boolean {
  return /^[0-9a-f-]+$/i.test(id) && id.length <= 64;
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

// ── executeStep — runs a single step in an isolated SDK session ──────────────

async function executeStep(
  ctx: HandlerContext,
  plan: NonNullable<Awaited<ReturnType<typeof getPlan>>>,
  step: ClaudePlanStep,
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

// ── PlanExecutionController ──────────────────────────────────────────────────

export class PlanExecutionController {
  readonly planId: string;
  readonly email: string;

  private state: ControllerState = "idle";
  private completedIds = new Set<string>();
  private runningIds = new Set<string>();
  private skippedIds = new Set<string>();
  private canRollback = false;

  // Pause control
  private pauseRequested = false;
  private pausePendingEmitted = false;
  private pauseResolve: (() => void) | null = null;

  // Error-pause control (replaces planResumeCallbacks)
  private errorPauseResolve: ((action: PlanAction) => void) | null = null;

  // Socket disconnect signal
  private disconnected = false;

  constructor(planId: string, email: string) {
    this.planId = planId;
    this.email = email;
  }

  getState(): ControllerState { return this.state; }
  getCanRollback(): boolean { return this.canRollback; }

  /** Resume from a manual pause. */
  resume(): void {
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }
  }

  /** Request a manual pause — running steps will finish first. */
  requestPause(): void {
    this.pauseRequested = true;
    this.pausePendingEmitted = false;
  }

  /** Resolve an error-pause (step failure). */
  resolveErrorPause(action: PlanAction): void {
    if (this.errorPauseResolve) {
      this.errorPauseResolve(action);
      this.errorPauseResolve = null;
    }
  }

  /** Signal that the socket disconnected. */
  markDisconnected(): void {
    this.disconnected = true;
    // Unblock any pending waits so the loop can exit
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }
    if (this.errorPauseResolve) {
      this.errorPauseResolve("cancel");
      this.errorPauseResolve = null;
    }
  }

  /** Interrupt all running step sessions and clean up. */
  interrupt(provider: ClaudeCodeProvider, ctx: HandlerContext): void {
    const activeSessionIds = ctx.activePlanSessions?.get(this.planId);
    if (activeSessionIds) {
      for (const sid of activeSessionIds) {
        provider.interrupt(sid);
        provider.closeSession(sid);
      }
      ctx.activePlanSessions?.delete(this.planId);
    }
    this.markDisconnected();
  }

  /**
   * Factory: reconstruct a controller from a paused plan (for reconnect/server restart).
   * Reads completed step IDs from DB. Steps stuck in "executing" are reset to "approved".
   */
  static async fromPausedPlan(planId: string, email: string): Promise<PlanExecutionController> {
    const controller = new PlanExecutionController(planId, email);
    const steps = await getPlanSteps(planId);
    for (const s of steps) {
      if (s.status === "completed") controller.completedIds.add(s.id);
      if (s.status === "executing") {
        await updatePlanStep(s.id, { status: "approved" });
      }
    }
    return controller;
  }

  /**
   * Main execution loop. Call this once — it runs until completion, failure, or cancel.
   */
  async execute(ctx: HandlerContext): Promise<void> {
    const { socket, email } = ctx;
    const planId = this.planId;

    try {
      const plan = await getPlan(planId);
      if (!plan) {
        socket.emit("claude:error", { message: "Plan not found" });
        return;
      }

      // For paused plan re-entry, skip setup that was already done
      const isResumeFromPause = plan.status === "paused";

      if (!isResumeFromPause) {
        // Concurrency gate
        const currentCount = planExecutionCounts.get(email) ?? 0;
        if (currentCount >= 2) {
          socket.emit("claude:error", { message: "Too many concurrent plan executions. Please wait for an existing plan to complete." });
          return;
        }
        planExecutionCounts.set(email, currentCount + 1);
        planOwners.set(planId, email);

        // Git checkpoint
        const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
        try {
          execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot, stdio: "pipe" });
          if (isValidPlanId(planId)) {
            execFileSync("git", ["tag", "-f", `plan-checkpoint-${planId}`], { cwd: projectRoot, stdio: "pipe" });
            this.canRollback = true;
          }
        } catch { /* not a git repo */ }
      } else {
        // Re-entry from pause: enforce same concurrency gate
        const currentCount = planExecutionCounts.get(email) ?? 0;
        if (currentCount >= 2) {
          socket.emit("claude:error", { message: "Too many concurrent plan executions. Please wait for an existing plan to complete." });
          return;
        }
        planExecutionCounts.set(email, currentCount + 1);
        planOwners.set(planId, email);
      }

      await updatePlanStatus(planId, "executing");
      socket.emit("claude:plan_executing", { planId, canRollback: this.canRollback });

      this.state = "executing";
      const systemPrompt = await buildSystemPrompt({ interfaceType: "plan_execution" });

      const MAX_PARALLEL = 3;
      let cancelled = false;

      // Main loop
      while (!cancelled && !this.disconnected) {
        const freshPlan = await getPlan(planId);
        if (!freshPlan) break;

        // Live-read approved steps from DB each iteration (enables hot-add)
        const dbSteps = freshPlan.steps ?? [];
        for (const s of dbSteps) {
          if (s.status === "completed") this.completedIds.add(s.id);
        }

        const liveApproved = dbSteps.filter(
          (s) => s.status === "approved" || s.status === "executing" || s.status === "completed",
        );

        // Validate dependency graph on first iteration or when step count changes
        const hasDeps = liveApproved.some((s) => s.depends_on && s.depends_on.length > 0);
        if (hasDeps && !validateDependencyGraph(liveApproved)) {
          for (const s of liveApproved) {
            (s as { depends_on: null }).depends_on = null;
          }
        }

        // ── Manual pause check ──
        if (this.pauseRequested && this.runningIds.size === 0) {
          this.pauseRequested = false;
          this.pausePendingEmitted = false;
          this.state = "paused";
          await updatePlanStatus(planId, "paused");
          const pausedPlan = await getPlan(planId);
          socket.emit("claude:plan_paused_manual", { planId });
          socket.emit("claude:plan_updated", { plan: pausedPlan });

          // Block until resume() or disconnect
          await new Promise<void>((resolve) => { this.pauseResolve = resolve; });

          if (this.disconnected) break;

          // Resumed
          this.state = "executing";
          await updatePlanStatus(planId, "executing");
          socket.emit("claude:plan_executing", { planId, canRollback: this.canRollback });
          continue;
        }

        if (this.pauseRequested && this.runningIds.size > 0) {
          if (!this.pausePendingEmitted) {
            socket.emit("claude:plan_pausing", { planId });
            this.pausePendingEmitted = true;
          }
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        const ready = getReadySteps(liveApproved, this.completedIds, this.runningIds);
        if (ready.length === 0 && this.runningIds.size === 0) break;
        if (ready.length === 0) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        const toLaunch = ready.slice(0, MAX_PARALLEL - this.runningIds.size);

        const promises = toLaunch.map(async (step) => {
          const allApproved = liveApproved.filter((s) => s.status === "approved" || s.status === "executing" || s.status === "completed");
          const stepIdx = allApproved.findIndex((s) => s.id === step.id);
          this.runningIds.add(step.id);

          await updatePlanStep(step.id, { status: "executing", executed_at: new Date().toISOString() });
          socket.emit("claude:step_executing", { planId, stepId: step.id });

          const { result, error } = await executeStep(
            ctx, freshPlan, step as ClaudePlanStep, stepIdx, allApproved.length, systemPrompt,
          );

          this.runningIds.delete(step.id);

          if (result.usage) {
            await updatePlanStep(step.id, {
              input_tokens: result.usage.input_tokens,
              output_tokens: result.usage.output_tokens,
              cost_usd: result.usage.cost_usd,
            });
            await incrementPlanCost(planId, result.usage.input_tokens, result.usage.output_tokens, result.usage.cost_usd);
          }

          return { step: step as ClaudePlanStep, result, error };
        });

        const results = await Promise.all(promises);

        for (const { step, result, error } of results) {
          if (error) {
            await updatePlanStep(step.id, { status: "failed", result: JSON.stringify(result), error });
            socket.emit("claude:step_failed", { planId, stepId: step.id, error });
            socket.emit("claude:plan_paused", { planId, stepId: step.id, error, canRollback: this.canRollback });

            const updatedPlan = await getPlan(planId);
            socket.emit("claude:plan_updated", { plan: updatedPlan });

            this.state = "error_paused";
            const action = await new Promise<PlanAction>((resolve) => {
              this.errorPauseResolve = resolve;
            });

            if (this.disconnected) { cancelled = true; break; }

            if (action === "cancel") { cancelled = true; break; }
            if (action === "retry") {
              await updatePlanStep(step.id, { status: "approved" });
              this.state = "executing";
            } else {
              this.skippedIds.add(step.id);
              this.completedIds.add(step.id);
              this.state = "executing";
            }
          } else {
            this.completedIds.add(step.id);
            await updatePlanStep(step.id, { status: "completed", result: JSON.stringify(result) });
            socket.emit("claude:step_completed", { planId, stepId: step.id, result: JSON.stringify(result) });
            const updatedPlan = await getPlan(planId);
            socket.emit("claude:plan_updated", { plan: updatedPlan });
          }
        }

        if (cancelled) {
          this.cleanup(email, planId);
          await updatePlanStatus(planId, "failed");
          const failedPlan = await getPlan(planId);
          socket.emit("claude:plan_updated", { plan: failedPlan });
          dispatchNotification("plan_failed", email, "Plan failed", "Plan execution failed and was stopped.").catch(() => {});
          this.state = "done";
          return;
        }
      }

      // If disconnected during execution (not paused), leave as-is in DB
      if (this.disconnected) {
        this.cleanup(email, planId);
        this.state = "done";
        return;
      }

      // Success
      this.cleanup(email, planId);
      await updatePlanStatus(planId, "completed");
      const completedPlan = await getPlan(planId);
      socket.emit("claude:plan_completed", { plan: completedPlan });
      dispatchNotification("plan_completed", email, "Plan completed", "Your plan has been executed successfully.").catch(() => {});
      this.state = "done";
    } catch (err) {
      this.cleanup(email, planId);
      socket.emit("claude:error", { message: String(err) });
      this.state = "done";
    }
  }

  private cleanup(email: string, planId: string): void {
    planExecutionCounts.set(email, Math.max(0, (planExecutionCounts.get(email) ?? 1) - 1));
    planOwners.delete(planId);
  }
}

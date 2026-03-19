# Plan Mode Execution Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken plan execution and make it feature-rich — per-step sessions, full tool activity streaming, cost tracking, dependencies, parallel execution, rollback.

**Architecture:** Replace the single long-lived SDK session (which hangs) with one fresh `query()` call per step. Each step gets its own session with a proper system prompt, full event relay, and clean lifecycle. Phase 1 fixes core execution; Phase 2 adds dependencies, parallelism, and rollback.

**Tech Stack:** Next.js 14, Socket.IO, SQLite (via libsql), @anthropic-ai/claude-agent-sdk (streaming input mode), TypeScript, React

**Spec:** `docs/superpowers/specs/2026-03-19-plan-mode-execution-overhaul-design.md`

---

## Phase 1: Core Execution Fix

---

### Task 1: DB Migration — Add Cost & Token Columns

**Files:**
- Modify: `src/lib/db.ts` (after line 579, migration 12)
- Modify: `src/lib/claude-db.ts:520-570` (interfaces + row mappers)

- [ ] **Step 1: Add migration 12 to `src/lib/db.ts`**

Add after migration 11 closing brace (line 579), before the `};` on line 580:

```typescript
  12: async () => {
    // Plan mode cost tracking
    await addColumnSafe("plan_steps", "input_tokens", "INTEGER NOT NULL DEFAULT 0");
    await addColumnSafe("plan_steps", "output_tokens", "INTEGER NOT NULL DEFAULT 0");
    await addColumnSafe("plan_steps", "cost_usd", "REAL NOT NULL DEFAULT 0");
    await addColumnSafe("plans", "total_input_tokens", "INTEGER NOT NULL DEFAULT 0");
    await addColumnSafe("plans", "total_output_tokens", "INTEGER NOT NULL DEFAULT 0");
    await addColumnSafe("plans", "total_cost_usd", "REAL NOT NULL DEFAULT 0");
    // Dependency support (Phase 2 column, added now to avoid a second migration)
    await addColumnSafe("plan_steps", "depends_on", "TEXT");
    console.log("[db] Migration 12: plan mode cost tracking + dependency columns");
  },
```

- [ ] **Step 2: Update `ClaudePlan` interface in `src/lib/claude-db.ts`**

Add after `updated_at: string;` (line 527):

```typescript
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
```

- [ ] **Step 3: Update `ClaudePlanStep` interface in `src/lib/claude-db.ts`**

Add after `created_at: string;` (line 542):

```typescript
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  depends_on: string[] | null;
```

- [ ] **Step 4: Update `rowToPlan` in `src/lib/claude-db.ts`**

Add to the return object after `updated_at`:

```typescript
    total_input_tokens: (row.total_input_tokens as number) ?? 0,
    total_output_tokens: (row.total_output_tokens as number) ?? 0,
    total_cost_usd: (row.total_cost_usd as number) ?? 0,
```

- [ ] **Step 5: Update `rowToPlanStep` in `src/lib/claude-db.ts`**

Add to the return object after `created_at`:

```typescript
    input_tokens: (row.input_tokens as number) ?? 0,
    output_tokens: (row.output_tokens as number) ?? 0,
    cost_usd: (row.cost_usd as number) ?? 0,
    depends_on: row.depends_on ? JSON.parse(row.depends_on as string) : null,
```

- [ ] **Step 6: Update `updatePlanStep` Partial type in `src/lib/claude-db.ts`**

Add to the Partial type (line 628):

```typescript
input_tokens: number; output_tokens: number; cost_usd: number; depends_on: string;
```

Add field handling in the body (after the `executed_at` block around line 639):

```typescript
  if (data.input_tokens !== undefined) { fields.push("input_tokens = ?"); values.push(data.input_tokens); }
  if (data.output_tokens !== undefined) { fields.push("output_tokens = ?"); values.push(data.output_tokens); }
  if (data.cost_usd !== undefined) { fields.push("cost_usd = ?"); values.push(data.cost_usd); }
  if (data.depends_on !== undefined) { fields.push("depends_on = ?"); values.push(data.depends_on); }
```

- [ ] **Step 7: Add `incrementPlanCost` function in `src/lib/claude-db.ts`**

Add after `deletePlan` function (after line 656):

```typescript
export async function incrementPlanCost(
  planId: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
): Promise<void> {
  await dbRun(
    `UPDATE plans SET
      total_input_tokens = total_input_tokens + ?,
      total_output_tokens = total_output_tokens + ?,
      total_cost_usd = total_cost_usd + ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    [inputTokens, outputTokens, costUsd, planId]
  );
}
```

- [ ] **Step 8: Verify the dev server starts without errors**

Run: `npm run build`
Expected: Build succeeds (types check out, no runtime errors on start)

- [ ] **Step 9: Commit**

```bash
git add src/lib/db.ts src/lib/claude-db.ts
git commit -m "feat(plan): add cost tracking and dependency columns (migration 12)"
```

---

### Task 2: Add `plan_execution` Interface Type to System Prompt

**Files:**
- Modify: `src/lib/system-prompt.ts:10` (InterfaceType union)
- Modify: `src/lib/system-prompt.ts:182-332` (buildSystemPrompt function)

- [ ] **Step 1: Extend `InterfaceType` union**

Change line 10 from:
```typescript
export type InterfaceType = "ui_chat" | "customization_interface" | "system_agent";
```
to:
```typescript
export type InterfaceType = "ui_chat" | "customization_interface" | "system_agent" | "plan_execution";
```

- [ ] **Step 2: Add `plan_execution` branch in `buildSystemPrompt`**

Add a new `else if` block after the `system_agent` check (line 202) and before the `else` (ui_chat) block at line 203:

```typescript
  } else if (interfaceType === "plan_execution") {
    // Plan execution: task-oriented, no personality/transformers/journal/agent-tools
    const parts: string[] = [];
    const selfIdentity = await getBotSelfIdentityPrompt();
    if (selfIdentity) parts.push(selfIdentity);
    systemPrompt = parts.length > 0 ? parts.join("\n\n") : undefined;
  } else {
```

This gives the plan execution prompt: security prefix + self-identity + CLAUDE.md + memories + context index. It skips personality, experience level, prompt transformers, session context journal, and agent tool injection because those are guarded by `if (interfaceType === "ui_chat")` checks later in the function.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/lib/system-prompt.ts
git commit -m "feat(plan): add plan_execution interface type to system prompt"
```

---

### Task 3: Rewrite Plan Execution Engine — Per-Step Sessions + Full Event Relay

This is the core fix. Replace the entire `claude:execute_plan` handler (lines 381-514 of `plan-handlers.ts`) with the per-step session model.

**Files:**
- Modify: `src/socket/plan-handlers.ts:381-535` (execution engine rewrite)

- [ ] **Step 1: Add imports and helper types at top of file**

Add after the existing imports (around line 25):

```typescript
import { buildSystemPrompt } from "../system-prompt";
```

Add after `sanitizePromptInput` function (around line 30):

```typescript
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
```

- [ ] **Step 2: Add step prompt builder function**

Add after the `parseStepResult` function:

```typescript
function buildStepPrompt(
  plan: { goal: string; steps?: { step_order: number; summary: string; status: string; result: string | null }[] },
  step: { summary: string; details: string | null },
  stepIdx: number,
  totalSteps: number,
): string {
  const lines: string[] = [];

  // Plan overview
  lines.push("## Plan Overview");
  lines.push(`Goal: ${plan.goal}`);
  lines.push("Steps:");
  for (const s of (plan.steps ?? []).slice().sort((a, b) => a.step_order - b.step_order)) {
    const marker = s.status === "completed" ? "✓" : s.status === "executing" ? "→" : s.status === "failed" ? "✗" : "○";
    lines.push(`  ${marker} ${s.step_order}. ${s.summary}`);
  }
  lines.push("");

  // Previous step results (condensed, capped at ~4000 chars)
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

  // Current step
  lines.push(`## Current Step (${stepIdx + 1} of ${totalSteps})`);
  lines.push(step.summary);
  if (step.details) lines.push(step.details);
  lines.push("");
  lines.push("Execute this step now. Use tools to make the actual changes.");

  return lines.join("\n");
}
```

- [ ] **Step 3: Add `executeStep` helper that runs a single step in its own session**

Add after `buildStepPrompt`:

```typescript
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
  const STEP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  // Collect tool activity during execution
  const toolCalls: StepResult["toolCalls"] = [];
  let stepOutput = "";
  let stepError = "";
  let stepUsage: StepResult["usage"] = null;

  // Build the plan-specific preamble to prepend to the system prompt
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

  // Store the active session ID so cancel can interrupt it
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

    // Step timeout
    timeoutHandle = setTimeout(() => {
      provider.interrupt(stepSessionId);
      cleanup();
      resolve({
        result: { summary: stepOutput, toolCalls, usage: stepUsage },
        error: `Step timed out after ${STEP_TIMEOUT_MS / 1000}s`,
      });
    }, STEP_TIMEOUT_MS);

    provider.onOutput(stepSessionId, (parsed) => {
      // Text streaming
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

      // Tool calls
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

      // Progress messages (e.g. "Using Bash")
      if (parsed.type === "progress" && parsed.message) {
        socket.emit("claude:step_progress", {
          planId, stepId: step.id, type: "progress", message: parsed.message,
        });
      }

      // Usage
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

      // Errors
      if (parsed.type === "error") {
        stepError = parsed.message ?? "Unknown error";
        socket.emit("claude:step_progress", {
          planId, stepId: step.id, type: "error", message: stepError,
        });
      }

      // Done — step complete
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
```

- [ ] **Step 4: Replace the `claude:execute_plan` handler**

Replace the entire handler from line 381 (`socket.on("claude:execute_plan"...`) through line 514 (closing `});`) with:

```typescript
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

      // Build system prompt once for all steps (same project context)
      const systemPrompt = await buildSystemPrompt({ interfaceType: "plan_execution" });

      let stepIdx = 0;
      while (stepIdx < approvedSteps.length) {
        const step = approvedSteps[stepIdx];

        // Refresh plan to get latest step results for context injection
        const freshPlan = await getPlan(planId);
        if (!freshPlan) break;

        await updatePlanStep(step.id, { status: "executing", executed_at: new Date().toISOString() });
        socket.emit("claude:step_executing", { planId, stepId: step.id });

        const { result, error } = await executeStep(
          ctx, freshPlan, step, stepIdx, approvedSteps.length, systemPrompt,
        );

        // Persist cost data
        if (result.usage) {
          await updatePlanStep(step.id, {
            input_tokens: result.usage.input_tokens,
            output_tokens: result.usage.output_tokens,
            cost_usd: result.usage.cost_usd,
          });
          await incrementPlanCost(planId, result.usage.input_tokens, result.usage.output_tokens, result.usage.cost_usd);
        }

        if (error) {
          await updatePlanStep(step.id, {
            status: "failed",
            result: JSON.stringify(result),
            error,
          });
          socket.emit("claude:step_failed", { planId, stepId: step.id, error });
          socket.emit("claude:plan_paused", { planId, stepId: step.id, error });

          // Emit updated plan with cost totals
          const updatedPlan = await getPlan(planId);
          socket.emit("claude:plan_updated", { plan: updatedPlan });

          // Wait for user action: retry / skip / cancel
          const action = await new Promise<PlanAction>((resolve) => {
            ctx.planResumeCallbacks.set(planId, resolve);
          });
          ctx.planResumeCallbacks.delete(planId);

          if (action === "cancel") {
            planExecutionCounts.set(email, (planExecutionCounts.get(email) ?? 1) - 1);
            planOwners.delete(planId);
            await updatePlanStatus(planId, "failed");
            const failedPlan = await getPlan(planId);
            socket.emit("claude:plan_updated", { plan: failedPlan });
            dispatchNotification("plan_failed", email, "Plan failed", "Plan execution failed and was stopped.").catch(() => {});
            return;
          }

          if (action === "retry") continue;
          // action === "skip": fall through to increment stepIdx
          stepIdx++;
          continue;
        }

        // Step succeeded
        await updatePlanStep(step.id, {
          status: "completed",
          result: JSON.stringify(result),
        });
        socket.emit("claude:step_completed", {
          planId, stepId: step.id, result: JSON.stringify(result),
        });

        // Emit updated plan with cost totals
        const updatedPlan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan: updatedPlan });

        stepIdx++;
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
```

- [ ] **Step 5: Fix the cancel handler to interrupt active step sessions**

Replace the `claude:cancel_plan` handler (find `socket.on("claude:cancel_plan"`) with:

```typescript
  socket.on("claude:cancel_plan", async ({ planId }: { planId: string }) => {
    try {
      // Interrupt all running step sessions for this plan
      const activeSessions = ctx.activePlanSessions?.get(planId);
      if (activeSessions) {
        for (const sid of activeSessions) {
          provider.interrupt(sid);
          provider.closeSession(sid);
        }
        ctx.activePlanSessions?.delete(planId);
      }

      // If plan is paused waiting for user action, resolve the callback as cancel
      const cb = ctx.planResumeCallbacks.get(planId);
      if (cb) {
        cb("cancel");
      } else {
        // Plan is actively executing (not paused) — update status directly
        await updatePlanStatus(planId, "cancelled");
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
        planExecutionCounts.set(email, (planExecutionCounts.get(email) ?? 1) - 1);
        planOwners.delete(planId);
      }
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });
```

- [ ] **Step 6: Add `activePlanSessions` to `HandlerContext` type**

Modify `src/socket/types.ts` — add to the `HandlerContext` interface:

```typescript
  activePlanSessions?: Map<string, Set<string>>; // planId → set of active step session IDs
```

- [ ] **Step 7: Add disconnect cleanup for `activePlanSessions`**

Find the socket disconnect handler in the file (search for `socket.on("disconnect"`). Add cleanup for active plan sessions:

```typescript
// Clean up active plan step sessions on disconnect
if (ctx.activePlanSessions) {
  for (const [planId, sessions] of ctx.activePlanSessions) {
    for (const sid of sessions) {
      provider.interrupt(sid);
      provider.closeSession(sid);
    }
  }
  ctx.activePlanSessions.clear();
}
```

- [ ] **Step 8: Add `incrementPlanCost` to imports at top of plan-handlers.ts**

Update the import from `../lib/claude-db` to include `incrementPlanCost`.

- [ ] **Step 9: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 10: Commit**

```bash
git add src/socket/plan-handlers.ts src/socket/types.ts
git commit -m "feat(plan): rewrite execution engine with per-step sessions and full event relay"
```

---

### Task 4: Frontend — New Socket Event Handlers + Tool Activity State

**Files:**
- Modify: `src/components/claude-code/plan-mode-tab.tsx`

- [ ] **Step 1: Add `ToolActivity` type and state**

Import `ToolActivity` from the step list component (we'll define it there in Task 5 since it's shared across components):

```typescript
import type { ToolActivity } from "./plan-step-list";
```

Add state after `stepProgress` state (around line 52):

```typescript
  const [stepToolActivity, setStepToolActivity] = useState<Map<string, ToolActivity[]>>(new Map());
```

- [ ] **Step 2: Update `claude:step_progress` handler for new event shape**

The backend now emits `claude:step_progress` with `{ planId, stepId, type, content?, message? }` instead of `{ planId, stepId, content }`. Update the existing handler (around line 205):

```typescript
    socket.on(
      "claude:step_progress",
      ({ stepId, type, content, message }: {
        planId: string; stepId: string;
        type?: "text" | "progress" | "error";
        content?: string; message?: string;
      }) => {
        const displayContent = content ?? message ?? "";
        setStepProgress((prev) => {
          const next = new Map(prev);
          next.set(stepId, displayContent);
          return next;
        });
      },
    );
```

- [ ] **Step 3: Add `claude:step_tool_activity` socket handler**

Add inside the `useEffect` that sets up socket listeners, after `claude:step_progress` handler:

```typescript
    socket.on(
      "claude:step_tool_activity",
      ({ stepId, toolCallId, toolName, toolInput, toolResult, toolStatus, exitCode }: {
        planId: string; stepId: string; toolCallId: string; toolName: string;
        toolInput?: unknown; toolResult?: string; toolStatus?: string; exitCode?: number;
      }) => {
        setStepToolActivity((prev) => {
          const next = new Map(prev);
          const existing = next.get(stepId) ?? [];
          const idx = existing.findIndex((t) => t.toolCallId === toolCallId);
          const entry: ToolActivity = {
            toolCallId,
            toolName,
            toolInput: toolInput ?? existing[idx]?.toolInput,
            toolResult: toolResult ?? existing[idx]?.toolResult,
            toolStatus: (toolStatus as ToolActivity["toolStatus"]) ?? "running",
            exitCode,
          };
          if (idx >= 0) {
            const updated = [...existing];
            updated[idx] = entry;
            next.set(stepId, updated);
          } else {
            next.set(stepId, [...existing, entry]);
          }
          return next;
        });
      },
    );
```

- [ ] **Step 4: Add `claude:step_usage` socket handler**

Add after the `claude:step_tool_activity` handler:

```typescript
    socket.on(
      "claude:step_usage",
      ({ planId, stepId, usage }: {
        planId: string; stepId: string;
        usage: { input_tokens: number; output_tokens: number; cost_usd: number };
      }) => {
        // Cost data is persisted on the plan via claude:plan_updated;
        // this event can be used for live cost display if needed.
      },
    );
```

- [ ] **Step 5: Add cleanup handlers to the return function**

Add to the cleanup return function (around line 237):

```typescript
      socket.off("claude:step_tool_activity");
      socket.off("claude:step_usage");
```

- [ ] **Step 6: Remove the duplicate `claude:step_progress` handler in the second useEffect**

The original code has a second `useEffect` that re-registers the `claude:step_progress` handler. Since we updated the handler in Step 2, remove the duplicate registration to avoid conflicts.

- [ ] **Step 7: Pass `stepToolActivity` to `PlanStepList`**

Update the `<PlanStepList>` component render to include:

```typescript
                stepToolActivity={stepToolActivity}
```

- [ ] **Step 8: Commit**

```bash
git add src/components/claude-code/plan-mode-tab.tsx
git commit -m "feat(plan): add tool activity and cost event handlers to plan mode UI"
```

---

### Task 5: Frontend — Tool Activity Panel in Step Card

**Files:**
- Modify: `src/components/claude-code/plan-step-list.tsx` (accept + pass new prop)
- Modify: `src/components/claude-code/plan-step-card.tsx` (render tool activity + cost)

- [ ] **Step 1: Update `PlanStepListProps` interface**

Add the shared `ToolActivity` type at the top of `plan-step-list.tsx` (exported so both plan-mode-tab and plan-step-card can import it):

```typescript
export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  toolInput?: unknown;
  toolResult?: string;
  toolStatus: "running" | "done" | "error";
  exitCode?: number;
}
```

Add to `PlanStepListProps` in `plan-step-list.tsx`:

```typescript
  stepToolActivity?: Map<string, ToolActivity[]>;
```

- [ ] **Step 2: Pass tool activity through to PlanStepCard**

In the `PlanStepCard` render inside `plan-step-list.tsx`, add prop:

```typescript
  toolActivity={stepToolActivity?.get(step.id)}
```

- [ ] **Step 3: Update `PlanStepCardProps` interface in `plan-step-card.tsx`**

Add:

```typescript
  toolActivity?: ToolActivity[];
```

Import the `ToolActivity` type from `plan-step-list.tsx`.

- [ ] **Step 4: Add tool activity panel to `plan-step-card.tsx`**

Add between the "Live output" section and the "Result" section (after line 277, before line 279):

```tsx
            {/* Tool activity */}
            {toolActivity && toolActivity.length > 0 && (
              <div className="px-4 pb-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-bot-muted/50">
                  Tool Activity
                </p>
                <div className="space-y-1">
                  {toolActivity.map((t) => (
                    <div
                      key={t.toolCallId}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-caption",
                        t.toolStatus === "running" && "bg-blue-500/8 text-blue-400",
                        t.toolStatus === "done" && "bg-bot-green/8 text-bot-green/70",
                        t.toolStatus === "error" && "bg-bot-red/8 text-bot-red/70",
                      )}
                    >
                      {t.toolStatus === "running" ? (
                        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                      ) : t.toolStatus === "done" ? (
                        <Check className="h-3 w-3 shrink-0" />
                      ) : (
                        <X className="h-3 w-3 shrink-0" />
                      )}
                      <span className="font-medium">{t.toolName}</span>
                      {t.toolResult && (
                        <span className="truncate text-[11px] opacity-60">
                          {t.toolResult.slice(0, 80)}
                        </span>
                      )}
                      {t.exitCode !== undefined && t.exitCode !== 0 && (
                        <span className="ml-auto text-[10px] font-mono text-bot-red">
                          exit {t.exitCode}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
```

- [ ] **Step 5: Add cost badge to completed step footer**

Replace the "Executing footer pulse" section (lines 417-423) with:

```tsx
            {/* Executing footer pulse */}
            {isExecuting && !stepProgress && (
              <div className="flex items-center gap-2 border-t border-blue-500/15 px-4 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-ping" />
                <span className="text-caption text-blue-400/70">Working…</span>
              </div>
            )}

            {/* Completed footer with cost */}
            {isCompleted && (step.cost_usd > 0 || step.input_tokens > 0) && (
              <div className="flex items-center gap-2 border-t border-bot-border/20 px-4 py-2 text-[10px] text-bot-muted/50">
                <Check className="h-3 w-3 text-bot-green/60" />
                <span>Completed</span>
                {step.cost_usd > 0 && <span>· ${step.cost_usd.toFixed(3)}</span>}
                {step.input_tokens > 0 && (
                  <span>· {((step.input_tokens + step.output_tokens) / 1000).toFixed(1)}k tokens</span>
                )}
                {toolActivity && toolActivity.length > 0 && (
                  <span>· {toolActivity.length} tool calls</span>
                )}
              </div>
            )}
```

- [ ] **Step 6: Add cost tracker to plan header in `plan-step-list.tsx`**

In the `ProgressBar` component or the plan header area, add after the progress percentage:

```tsx
        {plan.total_cost_usd > 0 && (
          <span className="text-[10px] text-bot-muted/50 ml-2">
            ${plan.total_cost_usd.toFixed(3)} · {((plan.total_input_tokens + plan.total_output_tokens) / 1000).toFixed(1)}k tokens
          </span>
        )}
```

- [ ] **Step 7: Handle JSON result parsing in step card**

The `result` field is now JSON. In `plan-step-card.tsx`, parse the result for display. Update the "Result" section (around line 280):

Change `{step.result}` to:

```tsx
                    {(() => {
                      try {
                        const parsed = JSON.parse(step.result!);
                        return parsed.summary || step.result;
                      } catch {
                        return step.result;
                      }
                    })()}
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
git add src/components/claude-code/plan-step-card.tsx src/components/claude-code/plan-step-list.tsx src/components/claude-code/plan-mode-tab.tsx
git commit -m "feat(plan): add tool activity panel, cost badges, and JSON result parsing to UI"
```

---

### Task 6: Manual Integration Test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Navigate to Plan Mode tab**

Open the app in a browser, go to Plan Mode.

- [ ] **Step 3: Create a test plan**

Enter goal: "Create a file called test-plan.txt with the text 'Hello from plan mode'"
Click "Generate Plan"

- [ ] **Step 4: Approve all steps and execute**

Click "Approve All", then "Execute".

- [ ] **Step 5: Verify execution**

Expected behavior:
- Steps flip to "executing" with live progress text
- Tool activity panel shows tool calls (Write tool or Bash)
- Steps complete with green status and result summary
- Cost badges appear after completion
- `test-plan.txt` file exists in project root

- [ ] **Step 6: Test cancel**

Create another simple plan, start executing, click "Cancel".
Expected: Current step stops, plan shows as cancelled.

- [ ] **Step 7: Test retry on failure**

Create a plan with an impossible step (e.g., "Run the command `exit 1`").
Expected: Step fails, pause UI appears, retry/skip/cancel buttons work.

- [ ] **Step 8: Clean up test files**

```bash
rm -f test-plan.txt
```

- [ ] **Step 9: Commit any fixes discovered during testing**

```bash
git add -A && git commit -m "fix(plan): address issues found during integration testing"
```

---

## Phase 2: Advanced Features

---

### Task 7: Step Dependencies & Dependency Graph

**Files:**
- Modify: `src/socket/plan-handlers.ts` (generation prompt + step creation)
- Create: `src/lib/plan-scheduler.ts` (dependency graph + scheduler)

- [ ] **Step 1: Update plan generation prompt**

In `plan-handlers.ts`, update the generation prompt (around line 211) to:

```typescript
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
```

- [ ] **Step 2: Update step creation to resolve dependencies**

In the `claude:generate_plan` handler, after parsing `cappedSteps` (around line 242), add dependency resolution:

```typescript
              // First pass: create all steps to get their IDs
              const createdSteps = [];
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
```

Replace the existing step creation loop with this.

- [ ] **Step 3: Create `src/lib/plan-scheduler.ts`**

```typescript
/**
 * Dependency graph utilities for plan step scheduling.
 */

interface SchedulableStep {
  id: string;
  depends_on: string[] | null;
  status: string;
}

/**
 * Returns true if the dependency graph is acyclic (valid).
 */
export function validateDependencyGraph(steps: SchedulableStep[]): boolean {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const s of steps) {
    adj.set(s.id, []);
    inDegree.set(s.id, 0);
  }

  for (const s of steps) {
    for (const dep of s.depends_on ?? []) {
      if (adj.has(dep)) {
        adj.get(dep)!.push(s.id);
        inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return visited === steps.length;
}

/**
 * Given completed step IDs, returns steps whose dependencies are all satisfied.
 */
export function getReadySteps(
  steps: SchedulableStep[],
  completedIds: Set<string>,
  runningIds: Set<string>,
): SchedulableStep[] {
  return steps.filter((s) => {
    if (s.status !== "approved") return false;
    if (completedIds.has(s.id) || runningIds.has(s.id)) return false;
    return (s.depends_on ?? []).every((dep) => completedIds.has(dep));
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/socket/plan-handlers.ts src/lib/plan-scheduler.ts
git commit -m "feat(plan): add dependency graph resolution and scheduler"
```

---

### Task 8: Parallel Step Execution

**Files:**
- Modify: `src/socket/plan-handlers.ts` (replace sequential loop with scheduler)

- [ ] **Step 1: Import scheduler functions**

Add to top of `plan-handlers.ts`:

```typescript
import { validateDependencyGraph, getReadySteps } from "../lib/plan-scheduler";
```

- [ ] **Step 2: Replace the sequential step loop in `claude:execute_plan`**

Replace the `while (stepIdx < approvedSteps.length)` loop with the dependency-aware scheduler:

```typescript
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
        // Clear all depends_on to force sequential
        for (const s of approvedSteps) {
          (s as { depends_on: null }).depends_on = null;
        }
      }

      while (!cancelled) {
        const freshPlan = await getPlan(planId);
        if (!freshPlan) break;

        // Refresh step statuses from DB
        const dbSteps = freshPlan.steps ?? [];
        for (const s of dbSteps) {
          if (s.status === "completed") completedIds.add(s.id);
        }

        const ready = getReadySteps(approvedSteps, completedIds, runningIds);
        if (ready.length === 0 && runningIds.size === 0) break; // All done or deadlocked
        if (ready.length === 0) {
          // Wait for running steps to finish
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        // Launch ready steps up to max parallel
        const toLaunch = ready.slice(0, MAX_PARALLEL - runningIds.size);

        const promises = toLaunch.map(async (step) => {
          const stepIdx = approvedSteps.findIndex((s) => s.id === step.id);
          runningIds.add(step.id);

          await updatePlanStep(step.id, { status: "executing", executed_at: new Date().toISOString() });
          socket.emit("claude:step_executing", { planId, stepId: step.id });

          const { result, error } = await executeStep(
            ctx, freshPlan, step, stepIdx, approvedSteps.length, systemPrompt,
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
            socket.emit("claude:plan_paused", { planId, stepId: step.id, error });

            const updatedPlan = await getPlan(planId);
            socket.emit("claude:plan_updated", { plan: updatedPlan });

            const action = await new Promise<PlanAction>((resolve) => {
              ctx.planResumeCallbacks.set(planId, resolve);
            });
            ctx.planResumeCallbacks.delete(planId);

            if (action === "cancel") { cancelled = true; break; }
            if (action === "retry") {
              // Reset step status so it gets picked up again
              await updatePlanStep(step.id, { status: "approved" });
            } else {
              // skip
              skippedIds.add(step.id);
              completedIds.add(step.id); // Treat as completed for dependency resolution
            }
          } else {
            completedIds.add(step.id);
            await updatePlanStep(step.id, { status: "completed", result: JSON.stringify(result) });
            socket.emit("claude:step_completed", { planId, stepId: step.id, result: JSON.stringify(result) });
            const updatedPlan = await getPlan(planId);
            socket.emit("claude:plan_updated", { plan: updatedPlan });
          }
        }
      }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/socket/plan-handlers.ts
git commit -m "feat(plan): add dependency-aware parallel step execution"
```

---

### Task 9: Git-Based Rollback

**Files:**
- Modify: `src/socket/plan-handlers.ts` (rollback handlers)

- [ ] **Step 1: Add git checkpoint creation before execution**

In the `claude:execute_plan` handler, **replace** the existing `socket.emit("claude:plan_executing", { planId });` line with:

```typescript
      // Create git checkpoint for rollback if project is a git repo
      let canRollback = false;
      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      try {
        const { execSync } = require("child_process");
        execSync("git rev-parse --is-inside-work-tree", { cwd: projectRoot, stdio: "pipe" });
        execSync(`git tag -f plan-checkpoint-${planId}`, { cwd: projectRoot, stdio: "pipe" });
        canRollback = true;
      } catch { /* not a git repo — rollback unavailable */ }

      socket.emit("claude:plan_executing", { planId, canRollback });
```

This replaces the original emit (not adds a second one).

- [ ] **Step 2: Wire rollback handlers**

Replace the `claude:rollback_stop` and `claude:rollback_continue` handlers:

```typescript
  socket.on("claude:rollback_stop", async ({ planId }: { planId: string }) => {
    try {
      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      const { execSync } = require("child_process");

      // Discard uncommitted changes
      execSync("git checkout -- .", { cwd: projectRoot, stdio: "pipe" });

      // Reset any commits made during execution
      try {
        execSync(`git reset --mixed plan-checkpoint-${planId}`, { cwd: projectRoot, stdio: "pipe" });
      } catch { /* no commits to reset */ }

      // Clean up tag
      try {
        execSync(`git tag -d plan-checkpoint-${planId}`, { cwd: projectRoot, stdio: "pipe" });
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
      const { execSync } = require("child_process");

      // Discard uncommitted changes (current step only — best effort)
      execSync("git checkout -- .", { cwd: projectRoot, stdio: "pipe" });

      const cb = ctx.planResumeCallbacks.get(planId);
      if (cb) cb("skip");
    } catch (err) {
      socket.emit("claude:error", { message: `Rollback failed: ${err}` });
    }
  });
```

- [ ] **Step 3: Update `plan_paused` emission to include `canRollback`**

In the execution handler where `claude:plan_paused` is emitted, add the `canRollback` flag:

```typescript
socket.emit("claude:plan_paused", { planId, stepId: step.id, error, canRollback });
```

- [ ] **Step 4: Commit**

```bash
git add src/socket/plan-handlers.ts
git commit -m "feat(plan): add git-based rollback with checkpoint tags"
```

---

### Task 10: UI — Dependency Indicators

**Files:**
- Modify: `src/components/claude-code/plan-step-card.tsx`
- Modify: `src/components/claude-code/plan-step-list.tsx`

- [ ] **Step 1: Add dependency badge to step card**

In `plan-step-card.tsx`, add a `dependsOn` prop to `PlanStepCardProps`:

```typescript
  dependsOnLabels?: string[]; // e.g. ["Step 2", "Step 3"]
```

Add rendering after the summary text in the header (around line 198):

```tsx
                {dependsOnLabels && dependsOnLabels.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {dependsOnLabels.map((label) => (
                      <span
                        key={label}
                        className="rounded-full bg-bot-elevated/80 px-2 py-0.5 text-[9px] font-medium text-bot-muted/60"
                      >
                        After {label}
                      </span>
                    ))}
                  </div>
                )}
```

- [ ] **Step 2: Compute and pass dependency labels in `plan-step-list.tsx`**

In the step rendering loop, compute labels:

```typescript
                  const dependsOnLabels = step.depends_on
                    ?.map((depId) => {
                      const depStep = steps.find((s) => s.id === depId);
                      return depStep ? `Step ${steps.indexOf(depStep) + 1}` : null;
                    })
                    .filter(Boolean) as string[] | undefined;
```

Pass to `PlanStepCard`:

```typescript
  dependsOnLabels={dependsOnLabels}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/claude-code/plan-step-card.tsx src/components/claude-code/plan-step-list.tsx
git commit -m "feat(plan): add dependency badges to step cards"
```

---

### Task 11: Final Integration Test & Polish

**Files:** None (testing only)

- [ ] **Step 1: Test full Phase 1 flow**

1. Create a plan with goal "Create three files: a.txt, b.txt, c.txt with numbered content"
2. Approve all, execute
3. Verify: steps execute sequentially, tool activity shows, cost displays, files created

- [ ] **Step 2: Test cancel during execution**

Start a plan, cancel mid-execution. Verify graceful stop.

- [ ] **Step 3: Test retry and skip on failure**

Create a plan with a step that will fail. Test retry, then skip.

- [ ] **Step 4: Test rollback**

Execute a plan that creates files. Use "Rollback & Stop". Verify files are cleaned up.

- [ ] **Step 5: Test parallel execution (Phase 2)**

Create a plan whose steps have independent dependencies. Verify multiple steps run simultaneously.

- [ ] **Step 6: Test backwards compat**

Load the app — verify existing plans still display correctly with null cost/dependency fields.

- [ ] **Step 7: Fix any issues and commit**

```bash
git add -A && git commit -m "fix(plan): polish and fixes from integration testing"
```

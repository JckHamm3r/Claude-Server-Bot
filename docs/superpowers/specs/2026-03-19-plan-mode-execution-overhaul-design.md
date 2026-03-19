# Plan Mode Execution Overhaul — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Scope:** Fix broken plan execution, add full event streaming, cost tracking, rollback, parallel steps, and step dependency support.

---

## 1. Problem Statement

Plan mode generates plans and tasks correctly, but execution is non-functional:

1. **Execution hangs indefinitely** — The per-step `done` event never fires. The current implementation uses a single long-lived streaming-input SDK session and waits for a `result` message after each step prompt. The `sendMessage` method is fire-and-forget (`void (async () => {...})()`), creating race conditions between handler registration and stream startup. Additionally, `onOutput` calls `removeAllListeners("output")` before adding the new handler, meaning events can be lost if the previous turn's `done` has not yet emitted when the new handler is registered. The combination of these timing issues causes the execution to hang.

2. **No system prompt on execution sessions** — `createSession()` passes no `systemPrompt`. Without project context, identity, or tool awareness, Claude just describes actions instead of invoking tools.

3. **Output handler drops tool events** — Only `text`, `streaming`, `error`, and `done` are handled. All `tool_call`, `tool_result`, and `progress` events are silently dropped, making execution invisible to users even if tools did run.

4. **Missing features** — No per-step cost tracking, no real rollback mechanism (stubs only), no step dependencies, no parallel execution, no mid-execution visibility into tool activity.

---

## 2. Architecture: Per-Step Session Model

### Core Change

Replace the single long-lived session with **one fresh SDK session per step**. Each step gets its own `query()` call with a clean lifecycle and guaranteed `result`/`done` event.

### Execution Flow

```
claude:execute_plan received
├── Validate plan ownership, concurrency (max 2 per user)
├── Update plan status → "executing"
├── For each approved step (sequential by default, parallel if dependencies allow):
│   ├── Create session: plan-step-{planId}-{stepId}
│   ├── Build system prompt via buildSystemPrompt({ interfaceType: "plan_execution" })
│   ├── Build step prompt with context injection (see §2.2)
│   ├── Register output handler that relays ALL event types (see §3)
│   ├── sendMessage → wait for done
│   ├── Collect structured result { summary, toolCalls[], usage }
│   ├── Store result in DB, update step status
│   ├── Close session immediately
│   └── If error → pause, wait for user action (retry/skip/cancel)
├── Update plan status → "completed" / "failed"
└── Dispatch notification
```

### 2.1 System Prompt for Plan Execution

Add `"plan_execution"` to the `InterfaceType` union type in `system-prompt.ts` (currently `"ui_chat" | "customization_interface" | "system_agent"`). Add a dedicated branch in `buildSystemPrompt()` — do NOT rely on the `else` (ui_chat) fallback, as it includes personality, prompt transformers, session context journal, and agent tools that plan execution should skip.

The `plan_execution` branch includes:
- Security prefix (guard rails)
- Self-identity prompt
- Project CLAUDE.md
- Memories
- Context index (.context/_index.md)

It explicitly skips:
- Personality customization (plan steps are task-oriented, not conversational)
- Session context journal (each step is isolated)
- Agent tool injection (steps shouldn't delegate to sub-agents)
- Prompt transformers (not a ui_chat session)
- Experience level instructions

Prepends a plan-specific preamble:

```
You are executing step {N} of {total} in a multi-step plan.

Goal: {plan.goal}

Your job is to EXECUTE this step by using your tools (Write, Bash, Edit, etc.).
Do not just describe what to do — actually do it. Use tools to create files, run
commands, and make changes. When done, provide a brief summary of what you did.
```

### 2.2 Context Injection per Step

Each step prompt includes:

```
## Plan Overview
Goal: {plan.goal}
Steps: {numbered list of all step summaries with status indicators}

## Previous Step Results (condensed)
{For each completed step: "Step N: {summary} → {first 500 chars of result}"}
(Capped at ~4000 chars total to avoid context bloat)

## Current Step ({N} of {total})
{step.summary}
{step.details if present}

Execute this step now. Use tools to make the actual changes.
```

### 2.3 Session Configuration

```typescript
provider.createSession(stepSessionId, {
  skipPermissions: true,
  systemPrompt: await buildSystemPrompt({ interfaceType: "plan_execution" }),
  model: DEFAULT_MODEL,
  maxTurns: 50,  // per-step limit (down from 200 for full plan)
  userEmail: email,
});
```

---

## 3. Real-Time Output Streaming

### 3.1 Full Event Relay

The output handler for each step relays all meaningful event types to the client:

| SDK Event Type | Socket Event | Payload |
|----------------|-------------|---------|
| `streaming` | `claude:step_progress` | `{ planId, stepId, type: "text", content }` |
| `text` | `claude:step_progress` | `{ planId, stepId, type: "text", content }` |
| `tool_call` | `claude:step_tool_activity` | `{ planId, stepId, toolCallId, toolName, toolInput, status: "running" }` |
| `tool_result` | `claude:step_tool_activity` | `{ planId, stepId, toolCallId, toolName, toolResult, toolStatus, exitCode }` |
| `progress` | `claude:step_progress` | `{ planId, stepId, type: "progress", message }` |
| `error` | `claude:step_progress` | `{ planId, stepId, type: "error", message }` |
| `usage` | `claude:step_usage` | `{ planId, stepId, usage: { input_tokens, output_tokens, cost_usd } }` |
| `done` | (internal) | Resolves step promise |

### 3.2 Structured Step Result

Instead of storing raw text in the `result` column, store JSON:

```typescript
interface StepResult {
  summary: string;          // Claude's final text response
  toolCalls: {
    tool: string;           // e.g. "Write", "Bash"
    input: string;          // file path or command (truncated)
    status: "done" | "error";
    exitCode?: number;      // for Bash
  }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
}
```

The `result` column remains TEXT — we JSON.stringify before storing and JSON.parse on read. Existing string results are treated as `{ summary: result, toolCalls: [], usage: null }` for backwards compat.

---

## 4. Cost & Token Tracking

### 4.1 DB Schema Changes

**plan_steps** — add columns:
- `input_tokens INTEGER DEFAULT 0`
- `output_tokens INTEGER DEFAULT 0`
- `cost_usd REAL DEFAULT 0`

**plans** — add columns:
- `total_input_tokens INTEGER DEFAULT 0`
- `total_output_tokens INTEGER DEFAULT 0`
- `total_cost_usd REAL DEFAULT 0`

### 4.2 Flow

1. Each step's `usage` event provides tokens + cost
2. On step completion → write to `plan_steps` row
3. Atomically increment `plans` totals: `UPDATE plans SET total_cost_usd = total_cost_usd + ? ...`
4. Emit `claude:plan_updated` with updated plan (includes running totals)

### 4.3 UI Display

- **Per-step**: small badge in step card footer after completion: `$0.03 · 2.1k tokens`
- **Per-plan**: running total in plan header next to progress bar

---

## 5. Step Dependencies & Parallel Execution

### 5.1 Dependency Model

Add a `depends_on` column to `plan_steps` (TEXT, JSON array of step IDs, default `null`).

During plan generation, Claude specifies dependencies as **1-based step order indices** (not UUIDs, since IDs are generated server-side):
```json
{
  "summary": "Run database migrations",
  "details": "...",
  "depends_on": []  // or [1, 2] — step order indices
}
```

After all steps are created, the server resolves order indices to actual step IDs before storing `depends_on` as a JSON array of UUIDs.

Steps with no dependencies and no unresolved predecessors can run in parallel.

**Cycle detection**: After resolving dependencies, validate the graph is acyclic (topological sort). If cycles are detected, reject the dependency graph and fall back to sequential execution with a warning.

### 5.2 Execution Scheduler

Replace the simple `while` loop with a dependency-aware scheduler:

```
Build dependency graph from steps
ready_queue = steps with no unresolved dependencies
running = Set()
max_parallel = 3  // configurable, respects plan concurrency limits

while ready_queue or running:
  while ready_queue and |running| < max_parallel:
    step = ready_queue.pop()
    launch step execution (async)
    running.add(step)

  await any running step to complete
  running.remove(completed_step)

  if completed_step failed:
    pause and wait for user action
    if cancel: abort all
    if skip: mark step skipped, continue
    if retry: re-launch step

  for each step that depended on completed_step:
    if all dependencies resolved:
      ready_queue.add(step)
```

### 5.3 UI Changes for Dependencies

- Step cards show dependency badges: "Depends on: Step 2, Step 3"
- Blocked steps show a lock icon instead of the step number
- Multiple steps can show "executing" simultaneously
- Progress bar tracks parallel execution

### 5.4 DB Schema

**plan_steps** — add column:
- `depends_on TEXT DEFAULT NULL` — JSON array of step IDs

---

## 6. Rollback Support

### 6.1 Git-Based Rollback

Before plan execution begins:
1. Check if the project root is a git repo
2. If yes, create a lightweight tag: `plan-checkpoint-{planId}`
3. Emit `claude:plan_executing` with `canRollback: true`

On rollback:
1. Run `git checkout -- .` to discard uncommitted changes
2. If any commits were made during execution, `git reset --soft plan-checkpoint-{planId}` to undo them while keeping changes staged
3. Delete the tag
4. Mark rolled-back steps as `rolled_back`

### 6.2 Per-Step Rollback

Track which files each step modified (from `tool_result` events for Write/Edit tools):

```typescript
interface StepFileChange {
  stepId: string;
  filePath: string;
  action: "created" | "modified" | "deleted";
}
```

This enables rolling back individual steps via `git checkout -- <files>` for modified files and `rm` for created files.

### 6.3 Rollback UI

The existing rollback buttons already exist in `plan-step-card.tsx`. Wire them to:
- **Rollback & Stop**: Roll back all changes from current + previous steps, stop plan
- **Rollback & Continue**: Roll back current step only, skip to next step

---

## 7. UI Enhancements

### 7.1 Plan Step Card — Tool Activity Panel

Add a new collapsible section between "Live output" and "Result":

**Tool Activity** (visible during and after execution)
- List of tool calls with: icon + name + input summary + status spinner/checkmark
- Expandable to show full input/output
- Color-coded: green for success, red for error, blue for running

### 7.2 Plan Step Card — Cost Badge

After completion, show in the card footer:
```
✓ Completed · $0.03 · 2.1k tokens · 4 tool calls
```

### 7.3 Plan Header — Cost Tracker

In the plan header (plan-step-list.tsx), add next to progress bar:
```
Running total: $0.15 · 12.3k tokens
```

### 7.4 Plan Step Card — Dependency Indicators

- Steps with unresolved dependencies show a dimmed lock icon
- Dependency chain visualization: small badges "After: Step 2, 3"
- Steps eligible for parallel execution get a "parallel" indicator

### 7.5 New Socket Events (Client Handlers)

Add handlers in `plan-mode-tab.tsx` for:
- `claude:step_tool_activity` — update tool activity state per step
- `claude:step_usage` — update per-step cost display

New state in PlanModeTab:
```typescript
const [stepToolActivity, setStepToolActivity] = useState<Map<string, ToolActivity[]>>(new Map());
```

Pass to PlanStepCard as a new `toolActivity` prop.

---

## 8. Error Handling Improvements

### 8.1 Step Timeout

Each step gets a configurable timeout (default: 5 minutes). If exceeded:
- Interrupt the step's SDK session
- Mark step as failed with error: "Step timed out after 5 minutes"
- Pause plan for user action

### 8.2 Graceful Cancellation

When user cancels a running plan:
- Call `provider.interrupt(stepSessionId)` first to cleanly stop the active query
- Then call `provider.closeSession(stepSessionId)` to clean up state
- Mark current step as "failed" with error "Cancelled by user"
- Mark remaining steps as unchanged (stay "approved")
- Update plan status to "cancelled"

**Important**: `interrupt()` must be called before `closeSession()`. Calling `closeSession()` alone deletes the session state from the map but may not cleanly abort the SDK query, leading to orphaned API connections.

Current implementation already handles cancel via `planResumeCallbacks`, but needs to also interrupt the active SDK session.

### 8.3 Concurrent Step Failure (Parallel Mode)

When running steps in parallel and one fails:
- Immediately pause all running steps (don't start new ones)
- Wait for currently-running steps to complete naturally
- Present all results (completed + failed) to user
- User can retry failed steps, skip them, or cancel

---

## 9. Plan Generation Updates

### 9.1 Updated Generation Prompt

The existing plan generation prompt (plan-handlers.ts) asks Claude for `{ summary, details }` per step. Update it to optionally produce dependencies:

```json
[
  { "summary": "...", "details": "...", "depends_on": [] },
  { "summary": "...", "details": "...", "depends_on": [1] }
]
```

The generation prompt should instruct Claude: "If a step requires the output of a previous step, include `depends_on` with the 1-based step numbers it depends on. Most steps should depend on the previous step (sequential). Only mark steps as independent (empty depends_on) if they can truly run in parallel."

### 9.2 Updated DB Functions

`updatePlanStep` in `claude-db.ts` must accept the new fields:
- `input_tokens`, `output_tokens`, `cost_usd` in the Partial type
- `depends_on` in the Partial type (stored as JSON string)

`addPlanStep` must accept optional `depends_on: string[]` and store as JSON.

`ClaudePlanStep` interface must add:
- `depends_on: string[] | null` (parsed from JSON)
- `input_tokens: number`
- `output_tokens: number`
- `cost_usd: number`

`rowToPlanStep` must parse `depends_on` from JSON string to array.

---

## 10. Implementation Phases

### Phase 1 — Core Fix (unblocks plan execution)
- Per-step session model (§2)
- Full event relay (§3)
- System prompt for plan_execution (§2.1)
- Cost tracking (§4)
- Fix cancel/interrupt (§8.2)

### Phase 2 — Advanced Features
- Step dependencies & parallel execution (§5)
- Git-based rollback (§6)
- Plan generation dependency output (§9)
- Step timeout (§8.1)

This allows shipping a working plan mode quickly while deferring the dependency/parallel features.

---

## 11. Files to Modify

### Backend
| File | Changes |
|------|---------|
| `src/socket/plan-handlers.ts` | Rewrite execution engine: per-step sessions, full event relay, dependency scheduler, rollback, cancel |
| `src/lib/system-prompt.ts` | Add `plan_execution` interface type |
| `src/lib/claude-db.ts` | Add new columns (cost, depends_on), update interfaces and CRUD functions |
| `src/lib/db.ts` | Migration for new columns |

### Frontend
| File | Changes |
|------|---------|
| `src/components/claude-code/plan-mode-tab.tsx` | New socket event handlers, tool activity + cost state |
| `src/components/claude-code/plan-step-card.tsx` | Tool activity panel, cost badge, dependency indicators |
| `src/components/claude-code/plan-step-list.tsx` | Cost tracker in header, parallel execution indicators |

---

## 12. Migration Strategy

1. Add new DB columns with defaults (non-breaking)
2. Existing plans continue to work (backwards-compatible result parsing)
3. New execution engine replaces old one entirely (old code is deleted)
4. No API changes needed — same socket events, new ones are additive

---

## 13. Testing Approach

1. **Unit**: Step prompt builder, context injection, dependency graph resolution, result parsing
2. **Integration**: Execute a 3-step plan that creates a file, modifies it, then runs a build command — verify files are created and tool activity is streamed
3. **Edge cases**: Step timeout, cancel mid-execution, retry after failure, parallel step with dependency failure, rollback with uncommitted changes
4. **Backwards compat**: Load a plan created before the migration, verify it displays correctly

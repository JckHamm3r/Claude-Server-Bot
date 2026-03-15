# Plan Mode

Multi-step execution plans with human-in-the-loop approval. Users describe a goal, Claude generates an ordered list of steps, the user reviews and approves them, and the system executes each step sequentially in isolated sessions.

## Workflow

1. **Generate** -- Describe a goal in natural language. Claude generates an ordered list of steps (up to 50).
2. **Review** -- Approve or reject individual steps, or approve/reject all at once.
3. **Reorder / Edit** -- Change step order, modify step summaries and details before execution.
4. **Refine** -- Provide additional instructions to regenerate or adjust the plan steps.
5. **Execute** -- Run approved steps sequentially. Each step executes in its own isolated session.
6. **Monitor** -- Watch step progress in real time. Each step shows its current status and output.
7. **Failure handling** -- If a step fails, execution pauses. Options: retry the failed step, skip it, or cancel the plan.
8. **Notifications** -- Alerts fire on plan completion or failure (both in-app and email if configured).

## Concurrency

Maximum 2 active plan executions per user at any time.

## Plan Statuses

| Status | Meaning |
|--------|---------|
| `drafting` | Plan is being generated |
| `reviewing` | User is reviewing/editing steps |
| `executing` | Steps are running sequentially |
| `completed` | All approved steps finished successfully |
| `failed` | A step failed and the plan was not recovered |
| `cancelled` | User cancelled the plan |

## Step Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Not yet reviewed |
| `approved` | Approved for execution |
| `rejected` | Skipped by user |
| `executing` | Currently running |
| `completed` | Finished successfully |
| `failed` | Execution failed |
| `rolled_back` | Step was rolled back |

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/plan-mode-tab.tsx` | Plan creation, review, and execution UI |
| `src/components/claude-code/plan-step-list.tsx` | Step list renderer |
| `src/components/claude-code/plan-step-card.tsx` | Individual step card |
| `src/socket/plan-handlers.ts` | Plan generation, approval, execution, refinement |
| `src/lib/claude-db.ts` | Plan and step database queries |

## Database Tables

| Table | Purpose |
|-------|---------|
| `plans` | Plan definitions (session_id, goal, status) |
| `plan_steps` | Individual steps (step_order, summary, details, status, result, error) |

## Socket Events

**Client to server:** `claude:list_plans`, `claude:create_plan`, `claude:update_plan`, `claude:approve_all_steps`, `claude:reject_all_steps`, `claude:update_step`, `claude:execute_plan`, `claude:refine_plan`, `claude:resume_plan`, `claude:skip_step`, `claude:cancel_plan`, `claude:delete_plan`

**Server to client:** `claude:plans`, `claude:plan_updated`, `claude:plan_generated`, `claude:plan_executing`, `claude:step_executing`, `claude:step_progress`, `claude:step_completed`, `claude:step_failed`, `claude:plan_paused`, `claude:plan_completed`, `claude:plan_deleted`

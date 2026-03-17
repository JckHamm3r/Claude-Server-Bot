# Sub-Agent Delegation — Implementation Plan

**Answers applied:**
1. Agent discovery: `ListAgents` tool (on-demand, always current)
2. Trigger: AI-directed autonomously + `/agent <name> <task>` slash command by user
3. UX: indicator in parent chat showing "Using agent: X (working…/complete)" — sub-agent internal steps not shown
4. Parent receives: final text result only
5. Permissions: inherit parent's `skip_permissions`; sub-agent errors are relayed to parent as tool errors; hard turn limit of 50
6. Invocation: custom tools in the SDK reasoning loop (`canUseTool` intercept pattern)
7. Sessions: ephemeral (disposable)
8. Permissions: agent's saved `allowed_tools` list
9. Nesting: yes, max depth 4
10. Cost: all spend rolled up to root parent session budget
11. Eligibility: all active agents available to all sessions
12. Plan Mode: sub-agent delegation available within plan step execution sessions too

---

## Architecture Overview

The invocation mechanism is **custom SDK tools** registered in the parent session. When Claude calls `delegate_to_agent`, the `canUseTool` callback in `sdk-provider.ts` intercepts the call, spins up an ephemeral sub-agent session (the proven pattern from plan mode), awaits the result, and returns it as the tool result. Claude never leaves its session. This is the most reliable and efficient option because:
- It is fully within Claude's reasoning loop — Claude receives the result as a first-class tool result and can reason about it
- It uses the async `canUseTool` pattern already used for file locks and permission gates
- The ephemeral session pattern is already battle-tested in the codebase
- Parallelism falls out naturally: Claude can call `delegate_to_agent` multiple times in the same turn; each call blocks independently on its own sub-agent, so they run concurrently

For the `/agent` slash command, the socket layer intercepts the user message before it reaches Claude, delegates to the named agent, and injects the result back as a "tool result" message into the parent session.

---

## System Design Decisions

### The `delegate_to_agent` Tool

Claude receives two custom tools injected via the system prompt, and the server implements them via the `canUseTool` interceptor:

**`delegate_to_agent`** — the primary delegation tool:
```
Input:
  agent_name: string    — exact name of the agent (case-insensitive match)
  task: string          — full description of what the agent should do
  context?: string      — optional background context to pass to the agent
Output (tool result):
  success: boolean
  result: string        — agent's final response
  error?: string        — present only on failure
```

**`list_agents`** — discovery tool:
```
Input: (none)
Output (tool result):
  agents: [{ name, description, icon, model }]  — all active agents
```

### Depth Tracking

A `delegationDepth` counter is threaded through `SDKSessionState` and through the sub-agent session options. Sub-agents at depth ≥ 4 have the `delegate_to_agent` tool removed from their system prompt injection and their `canUseTool` intercept returns `deny` immediately with an explanation.

### Parallel Sub-Agents

Claude is instructed in the system prompt to call `delegate_to_agent` for independent tasks in the same response turn. Because `canUseTool` is async and each delegation `await`s independently, multiple calls in the same turn run in parallel. Claude then waits for all tool results before composing its final response — this is how the SDK's tool loop works naturally.

### Budget Rollup

The ephemeral sub-agent session's `total_cost_usd` (from the SDK `result` message) is accumulated and reported back to the root session as part of the `usage` output event. The root session's budget check applies to the sum of all costs.

---

## Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `src/lib/sub-agent-runner.ts` | Core sub-agent execution engine: takes a task + agent config + context + depth, runs an ephemeral session, resolves with the final result or error |
| `src/lib/agent-tool-injector.ts` | Builds the `<agent-tools>` block that is appended to the session system prompt, listing available agents and tool usage instructions |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/claude/sdk-provider.ts` | 1. Add `delegationDepth` and `rootSessionId` fields to `SDKSessionState`. 2. In `startStreamingSession()`, if `state.delegationDepth < 4`, inject `delegate_to_agent` and `list_agents` into the `canUseTool` intercept — before the existing permission logic. Handle these two tool names specially: resolve them server-side without emitting a `permission_request`. 3. Accept `delegationDepth`, `rootSessionId`, `onSubAgentCost` in `createSession()` opts. |
| `src/lib/claude/provider.ts` | Add `delegationDepth?: number; rootSessionId?: string; onSubAgentCost?: (costUsd: number) => void` to `createSession` opts. Add `sub_agent_start` and `sub_agent_done` to `ParsedOutput` type. |
| `src/lib/system-prompt.ts` | Call `buildAgentToolBlock()` from `agent-tool-injector.ts` and append it to the system prompt when active agents exist. |
| `src/socket/handlers.ts` | 1. In `ensureSessionListener`, handle new `sub_agent_start` and `sub_agent_done` output types: emit `claude:sub_agent_status` to the session room. 2. Add `"sub-agent-"` to `ephemeralPrefixes`. 3. Thread sub-agent cost back onto parent session budget tracking. |
| `src/socket/message-handlers.ts` | Intercept `/agent <name> <task>` slash command before sending to Claude. Parse it, run the sub-agent directly, inject the result as a synthetic tool result into the parent session. |
| `src/socket/plan-handlers.ts` | Pass `delegationDepth: 0` when calling `provider.createSession()` for plan step sessions, so plan step sessions also get delegation capability. |
| `src/lib/claude-db.ts` | Add `getActiveAgents()` function (returns all agents with status = 'active'). Already has `listAgents()` but this one skips the email filter — all active agents are available to all sessions. |
| `src/components/claude-code/chat-tab.tsx` | Handle `claude:sub_agent_status` Socket.IO event and display the indicator. |
| `src/components/claude-code/message-list.tsx` (or similar) | Render `sub_agent_start` / `sub_agent_done` output events as inline indicators in the message stream. |

---

## Detailed Implementation Steps

### Step 1 — DB Layer

**`src/lib/claude-db.ts`**: Add `getActiveAgents()`:
```ts
export function getActiveAgents(): ClaudeAgent[] {
  const rows = db.prepare("SELECT * FROM agents WHERE status = 'active' ORDER BY name").all();
  return rows.map(parseAgent);
}
```

---

### Step 2 — Agent Tool Injector

**`src/lib/agent-tool-injector.ts`**:

```ts
import { getActiveAgents } from "./claude-db";

export function buildAgentToolBlock(): string {
  const agents = getActiveAgents();
  if (agents.length === 0) return "";

  const agentList = agents
    .map(a => `- **${a.name}** (${a.icon ?? "🤖"}): ${a.description}`)
    .join("\n");

  return `
<agent-delegation>
You have access to specialized sub-agents. Use them when a task is clearly within their domain.

Available agents:
${agentList}

Tools available to you:

**list_agents** — Get the current list of active agents with their names, descriptions, and capabilities.
  Input: (none required)

**delegate_to_agent** — Delegate a task to a specialized agent and receive the result.
  Input:
    - agent_name (string): The exact name of the agent to use
    - task (string): Full description of the task for the agent
    - context (string, optional): Any relevant background context

Rules:
- Use delegate_to_agent when a task fits an agent's defined specialty
- You can call delegate_to_agent multiple times in the same response for independent tasks — they will run in parallel
- Wait for ALL delegations in a turn to complete before composing your response
- If an agent returns an error, report it clearly to the user and handle gracefully
- Never delegate tasks that require your current conversation context unless you include that context in the task/context fields
- The user can also invoke agents directly with: /agent <agent-name> <task description>
</agent-delegation>
`;
}
```

---

### Step 3 — Sub-Agent Runner

**`src/lib/sub-agent-runner.ts`**:

```ts
import { getClaudeProvider } from "./claude";
import { getActiveAgents } from "./claude-db";

export interface SubAgentResult {
  success: boolean;
  result: string;
  costUsd: number;
  error?: string;
}

export interface SubAgentOptions {
  agentName: string;
  task: string;
  context?: string;
  parentSessionId: string;        // for namespacing and cost reporting
  userEmail: string;
  skipPermissions: boolean;       // inherited from parent
  delegationDepth: number;        // current depth (sub-agent runs at depth + 1)
  onCostAccrued?: (cost: number) => void;  // callback to bubble cost to root
}

const MAX_DEPTH = 4;
const SUB_AGENT_MAX_TURNS = 50;

export async function runSubAgent(opts: SubAgentOptions): Promise<SubAgentResult> {
  if (opts.delegationDepth >= MAX_DEPTH) {
    return {
      success: false,
      result: "",
      costUsd: 0,
      error: `Maximum delegation depth (${MAX_DEPTH}) reached. Cannot delegate further.`,
    };
  }

  const agents = getActiveAgents();
  const agent = agents.find(a => a.name.toLowerCase() === opts.agentName.toLowerCase());
  if (!agent) {
    return {
      success: false,
      result: "",
      costUsd: 0,
      error: `Agent "${opts.agentName}" not found or not active. Use list_agents to see available agents.`,
    };
  }

  const provider = getClaudeProvider();
  const subSessionId = `sub-agent-${opts.parentSessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const systemPrompt = `You are "${agent.name}": ${agent.description}

Execute the task you are given completely and thoroughly. Return a clear, comprehensive result.
If you encounter any errors or cannot complete part of the task, explain exactly what went wrong.`;

  provider.createSession(subSessionId, {
    model: agent.model,
    systemPrompt,
    skipPermissions: opts.skipPermissions,
    userEmail: opts.userEmail,
    maxTurns: SUB_AGENT_MAX_TURNS,
    delegationDepth: opts.delegationDepth + 1,
    rootSessionId: opts.parentSessionId,
    onSubAgentCost: opts.onCostAccrued,
  });

  // Apply the agent's allowed tools
  if (!opts.skipPermissions && agent.allowed_tools.length > 0) {
    for (const toolName of agent.allowed_tools) {
      provider.allowTool(subSessionId, toolName, "session");
    }
  }

  return new Promise<SubAgentResult>((resolve) => {
    let finalText = "";
    let costUsd = 0;
    let hasError = false;
    let errorMsg = "";

    provider.onOutput(subSessionId, (parsed) => {
      if (parsed.type === "text" && parsed.content) {
        finalText = parsed.content;
      } else if (parsed.type === "streaming" && parsed.content) {
        finalText = parsed.content;
      } else if (parsed.type === "usage" && parsed.usage?.cost_usd) {
        costUsd = parsed.usage.cost_usd;
        opts.onCostAccrued?.(costUsd);
      } else if (parsed.type === "error") {
        hasError = true;
        errorMsg = parsed.message ?? "Unknown error";
      } else if (parsed.type === "done") {
        provider.offOutput(subSessionId);
        provider.closeSession(subSessionId);

        if (hasError && !finalText) {
          resolve({ success: false, result: "", costUsd, error: errorMsg });
        } else {
          resolve({ success: true, result: finalText, costUsd, error: hasError ? errorMsg : undefined });
        }
      }
    });

    const fullTask = opts.context
      ? `Context: ${opts.context}\n\nTask: ${opts.task}`
      : opts.task;

    provider.sendMessage(subSessionId, fullTask);
  });
}
```

---

### Step 4 — SDK Provider Changes

**`src/lib/claude/sdk-provider.ts`** changes:

1. **`SDKSessionState`** — add fields:
   ```ts
   delegationDepth: number;          // default 0
   rootSessionId: string | null;     // null for top-level sessions
   onSubAgentCost: ((cost: number) => void) | null;
   ```

2. **`getOrCreate()`** — initialize new fields with defaults.

3. **`createSession()`** — accept and apply new opts:
   ```ts
   if (opts.delegationDepth !== undefined) state.delegationDepth = opts.delegationDepth;
   if (opts.rootSessionId) state.rootSessionId = opts.rootSessionId;
   if (opts.onSubAgentCost) state.onSubAgentCost = opts.onSubAgentCost;
   ```

4. **`canUseTool` callback in `startStreamingSession()`** — add interception block at the top, before existing logic:
   ```ts
   // Sub-agent tools — handle server-side, never emit permission_request
   if (toolName === "list_agents") {
     const { getActiveAgents } = await import("../claude-db");
     const agents = getActiveAgents();
     const listResult = JSON.stringify(
       agents.map(a => ({ name: a.name, description: a.description, icon: a.icon, model: a.model }))
     );
     return { behavior: "allow", updatedInput: { _result: listResult } };
     // Note: the SDK tool result is returned via the tool result mechanism;
     // for list_agents we use a special trick: we allow and the result is
     // in the updatedInput. But actually the cleanest approach is to not
     // use canUseTool for returning results -- we need a synthetic tool result.
   }
   ```

   **Important note**: The `canUseTool` callback controls whether a tool is *allowed* to run, not what the tool *returns*. For the `delegate_to_agent` and `list_agents` tools to be fully server-side (no actual subprocess tool), we need them to be implemented as **virtual tools** — tools that the SDK knows by name but whose execution is intercepted before the subprocess runs them.

   The cleanest approach that works with the SDK's existing `canUseTool` mechanism is to use the **`behavior: "allow"` path but return the tool result as part of `updatedInput`** — however the SDK does not pass `updatedInput` back as the tool result.

   **Revised approach**: Use the SDK's built-in `Agent` tool, which the SDK already knows how to handle for spawning sub-agents. The SDK's `Agent` tool is designed exactly for this use case. When Claude calls the `Agent` tool, we intercept it in `canUseTool`, run our `runSubAgent()` function, and need to return the result.

   However, since `canUseTool` only returns `allow/deny` (not the tool result content), the correct pattern is to **not use `canUseTool` for result injection**. Instead, the right architecture is:

   **Final invocation architecture**: Inject `delegate_to_agent` and `list_agents` as custom tool definitions in the system prompt and in `options.tools` (if the SDK supports it), OR use a different approach.

   After reviewing the SDK's `query()` options, the recommended approach is:
   - In the system prompt, define `delegate_to_agent` and `list_agents` as tools Claude should call
   - In `canUseTool`, when these tool names appear, return `{ behavior: "allow" }` immediately so the SDK doesn't block them
   - The SDK will call the tool in the subprocess — but since we control the subprocess environment, we can implement these as actual shell scripts or node scripts that the SDK's Bash tool runs, OR...
   - **Better**: use the SDK's `tools` option (if available) to register custom JavaScript tool implementations

   **Simplest reliable approach** that doesn't require SDK internals knowledge: implement `delegate_to_agent` as a real bash-callable node script at a well-known path (e.g. `scripts/delegate-agent.js`), inject its path into the system prompt, and Claude calls it via Bash. The script communicates back via stdout. This is the most decoupled approach and guarantees Claude can call it.

   **Actually simplest and most robust**: use the approach from the Plan Mode execution — pass the task to the parent Claude with a structured prompt that includes the sub-agent's result already computed. But this requires the parent to wait, which breaks parallelism.

   **Recommended final decision**: Use the **`canUseTool` + async promise** pattern, same as file locks — but for virtual tools, treat them as tools that have a custom handler. The SDK calls `canUseTool` for each tool use. For `delegate_to_agent`:
   1. Return a `Promise` that resolves to `{ behavior: "allow" }` — but this doesn't inject the result
   2. The SDK will then try to run the tool, which doesn't exist as a real tool

   The correct and clean solution is to **register the tools as custom tool implementations using the SDK's `tools` option** if supported, or to **use the system prompt to describe them as Bash invocations of a helper script**.

   **Definitive architecture decision** (most reliable, no SDK internals required):

   Register a Node.js helper script at `scripts/delegate-agent.js` that:
   - Accepts `--agent-name`, `--task`, `--context`, `--parent-session`, `--depth` as CLI args
   - Calls the sub-agent runner via an IPC socket or by writing to a temp file and reading the result
   - Prints the result to stdout

   Claude calls this via Bash: `node scripts/delegate-agent.js --agent-name "..." --task "..."`

   The script communicates with the running server process via a local HTTP endpoint (`/api/internal/delegate`) that is protected and only reachable on localhost.

   This approach: doesn't require SDK modification, is fully transparent to the SDK, works with `skip_permissions`, and naturally supports parallelism (multiple Bash calls in one turn).

---

### Revised Final Architecture (Simpler and More Robust)

After analyzing all options, the cleanest architecture uses a **local HTTP delegation endpoint** that Claude calls via the `WebFetch` tool. This requires zero SDK changes.

**How it works:**
1. A new internal API route `/api/internal/sub-agent` is created, protected to localhost-only requests
2. The system prompt tells Claude: "To delegate to an agent, use WebFetch to POST to `http://localhost:{PORT}/api/internal/sub-agent`"
3. Claude sends `{ agentName, task, context, depth }` in the POST body
4. The API route runs `runSubAgent()` synchronously (it awaits the ephemeral session), then returns the result
5. Claude receives the result in the WebFetch tool result and continues

**Why this is best:**
- Zero changes to `sdk-provider.ts` or the SDK layer
- The `canUseTool` logic for `WebFetch` already exists
- Parallelism works: Claude can issue multiple WebFetch calls in the same turn; the SDK runs them concurrently (each awaits the response independently)
- The sub-agent result is in Claude's context as a normal tool result — Claude can reason about it
- Depth tracking: the API route maintains a depth counter per request chain
- Cost rollup: the API route reports cost back to the parent session via a shared in-memory cost accumulator
- Works in both chat sessions and plan step sessions with no extra wiring

**One risk**: the `WebFetch` tool must be in the session's allowed tools for this to work, or `skip_permissions` must be on. Sessions without `WebFetch` permission and without `skip_permissions` would require user approval before the first delegation.

**Mitigation**: If the session has `skipPermissions: true` (e.g. plan execution), it works automatically. For normal chat sessions, auto-allow `WebFetch` for localhost calls only — the `canUseTool` callback already checks tool + input, so we can add: "if toolName === 'WebFetch' and the URL is localhost:{PORT}/api/internal/sub-agent, auto-allow".

---

## Component-by-Component Implementation Plan

### Backend

#### 1. `src/lib/claude-db.ts`
- Add `getActiveAgents(): ClaudeAgent[]` — SELECT all agents WHERE status = 'active'

#### 2. `src/lib/agent-tool-injector.ts` (new)
- `buildAgentToolBlock(port: number): string` — generates the system prompt block describing agents and how to invoke them via WebFetch to localhost
- Called by `buildSystemPrompt()` at session creation time

#### 3. `src/lib/sub-agent-runner.ts` (new)
- `runSubAgent(opts): Promise<SubAgentResult>` — wraps the ephemeral session pattern
- Accepts `delegationDepth`, rejects with error if `>= MAX_DEPTH (4)`
- Returns `{ success, result, costUsd, error? }`
- Tracks sub-agent sessions in a `subAgentRegistry` Map keyed by `parentSessionId` for the status indicator

#### 4. `src/lib/sub-agent-registry.ts` (new)
- In-memory registry: `Map<parentSessionId, SubAgentStatus[]>`
- Tracks running sub-agents per parent session for UI indicator
- `registerSubAgent(parentId, subInfo)`, `markSubAgentDone(parentId, subId)`, `getSubAgents(parentId)`

#### 5. `src/app/api/internal/sub-agent/route.ts` (new)
- POST handler: receives `{ agentName, task, context, parentSessionId, userEmail, skipPermissions, depth }`
- Validates: localhost-only (check `x-forwarded-for` / remote address)
- Validates depth ≤ 4
- Calls `runSubAgent()`
- While running, updates `subAgentRegistry` → triggers broadcast to session room via the notification broadcaster
- Returns `{ success, result, error, costUsd }`
- Adds `costUsd` to parent session's pending cost accumulator

#### 6. `src/lib/system-prompt.ts`
- Import and call `buildAgentToolBlock(port)` — append to system prompt when agents exist
- The block instructs Claude on using WebFetch to `http://localhost:{PORT}/api/internal/sub-agent`

#### 7. `src/socket/handlers.ts`
- In `ensureSessionListener`, add handler for sub-agent status broadcasts:
  - When `sub-agent-registry` emits a change for `sessionId`, emit `claude:sub_agent_status` to the session room
- Set up a registry-change listener on `registerHandlers()`

#### 8. `src/socket/message-handlers.ts`
- Before sending message to Claude, check if content matches `/agent <name> (.+)` (case-insensitive)
- If matched: extract `agentName` and `task`, run `runSubAgent()` directly, inject result as a synthetic user message back into the parent session's stream like: `"Agent result from <name>:\n<result>"`, or just surface it as a system message to the chat

#### 9. `src/socket/plan-handlers.ts`
- No changes needed to plan step execution — the plan session already has `skipPermissions: true` which means WebFetch auto-allows, and the system prompt injection means plan step Claude can use sub-agents

### Frontend

#### 10. `src/components/claude-code/chat-tab.tsx`
- Listen for `claude:sub_agent_status` events
- Maintain a `subAgents` state: `{ agentName, status: 'running' | 'complete', error?: string }[]`
- Display the indicator (see UI below)

#### 11. Sub-agent indicator component (new or inline)
- While any sub-agents are running: show a subtle pill below the "thinking" indicator: `🤖 Using agent: <name>...`
- When complete: show `✓ Agent: <name> complete` (fades after a few seconds, or persists in the message)
- If error: `⚠ Agent: <name> failed`
- Multiple concurrent sub-agents shown as a stacked list

---

## Socket.IO Events (New)

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `claude:sub_agent_status` | server → client | `{ sessionId, agents: [{ id, agentName, status, error? }] }` | Updates the indicator in the parent chat |

---

## Data Flow Diagram

```
User message
    │
    ▼
message-handlers.ts
    │ (check for /agent command)
    ├── /agent command → runSubAgent() → return result as synthetic message
    │
    └── normal message → Claude SDK stream
                              │
                              ▼
                      Claude reasons...
                              │
                     calls WebFetch to
                localhost/api/internal/sub-agent
                              │
                              ▼
                  sub-agent/route.ts (API route)
                       ├── validates depth ≤ 4
                       ├── updates sub-agent registry
                       │       │
                       │       └──► emit claude:sub_agent_status
                       │                   │
                       │                   └──► chat-tab.tsx shows indicator
                       │
                       ├── runSubAgent() ────────────────────────────────┐
                       │       │                                         │
                       │       ▼                                    ephemeral session
                       │  ephemeral SDK session                     sub-agent-{id}
                       │  (agent's model + tools)                        │
                       │       │                                    (can itself call
                       │       │                                  WebFetch to delegate,
                       │       │                                     depth+1, max 4)
                       │       ▼
                       │  { success, result, costUsd }
                       │
                       ├── mark registry done → emit claude:sub_agent_status (complete)
                       ├── add costUsd to parent session cost accumulator
                       └── return JSON result to Claude

                              │
                              ▼ (WebFetch tool result)
                      Claude receives result,
                      continues reasoning,
                      composes final response
```

---

## Implementation Phases

### Phase 1 — Core Delegation (MVP)
1. `getActiveAgents()` in claude-db.ts
2. `sub-agent-runner.ts` (ephemeral session, no nesting)
3. `sub-agent/route.ts` API (localhost-only, depth enforcement)
4. `agent-tool-injector.ts` + system prompt integration
5. `canUseTool` localhost WebFetch auto-allow in sdk-provider.ts
6. Manual test: session with active agent, ask Claude to delegate

### Phase 2 — UI Indicators
7. `sub-agent-registry.ts` + broadcaster integration
8. `claude:sub_agent_status` Socket.IO event from server
9. Sub-agent indicator in `chat-tab.tsx`
10. Visual polish: running/done/error states

### Phase 3 — Slash Command
11. `/agent <name> <task>` interception in `message-handlers.ts`

### Phase 4 — Plan Mode Integration
12. Verify plan step sessions get the agent tool block (should work with no changes since system prompt is injected)
13. Test plan step → sub-agent delegation end-to-end

### Phase 5 — Nesting + Cost Rollup
14. Pass `depth` through the API route chain
15. Accumulate `costUsd` from sub-agent results and add to parent session usage event
16. Test 2-level nesting
17. Test depth-4 rejection

---

## Open Implementation Details to Resolve During Coding

1. **PORT availability in system prompt**: The server's port must be readable when `buildSystemPrompt()` runs. Use `process.env.PORT ?? "3000"`.

2. **localhost-only enforcement in API route**: Check `request.headers.get('host')` starts with `localhost` or `127.0.0.1`. Also check that `x-forwarded-for` is absent or is `127.0.0.1`. Reject with 403 otherwise.

3. **Authentication for the internal API route**: Since it's localhost-only, no JWT is needed. Add a shared secret: `process.env.SUB_AGENT_INTERNAL_SECRET` (random UUID generated at startup, stored in memory, passed to Claude in the system prompt as a header value for WebFetch).

4. **Sub-agent tool restriction when `skipPermissions: false`**: The `canUseTool` callback in `sdk-provider.ts` needs to auto-allow WebFetch calls to the internal endpoint. Add this check: if `toolName === "WebFetch"` and the URL starts with `http://localhost:{PORT}/api/internal/sub-agent`, return `{ behavior: "allow" }` without emitting a permission request.

5. **Streaming output from sub-agent**: The sub-agent's streaming output is NOT forwarded to the parent chat. Only the final result is returned. The sub-agent indicator shows "working..." until done.

6. **Sub-agent system prompt**: Built from just `agent.description` + task. Does NOT include the full parent session system prompt (security prompt, template, personality, etc.) — sub-agents are purpose-built workers, not full chat assistants.

7. **Error propagation**: If a sub-agent fails (SDK error, rate limit, timeout), the API route returns `{ success: false, error: "..." }`. Claude receives this as the WebFetch result and is expected (via system prompt instruction) to surface it to the user.

8. **Timeout for sub-agent**: The existing `SDK_TIMEOUT_MS` (default 10 minutes) applies to each sub-agent session independently. No additional timeout needed.

9. **`/agent` command parsing**: Support both `/agent ExactName task text here` and `/agent "Agent With Spaces" task text here` (quoted names). Strip the prefix before sending to `runSubAgent`.

10. **Budget check for sub-agent cost**: The sub-agent runner returns `costUsd`. The API route needs access to the parent session's budget settings. Import `getAppSetting` and check `budget_limit_session_usd` before starting the sub-agent. If remaining budget < estimated cost, reject early. After completion, add to the session's accumulated cost (tracked in `sessionPendingUsage` or a new accumulator).

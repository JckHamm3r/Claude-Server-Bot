# Sub-Agent Delegation Plan

## Overview

This document captures the design analysis, clarifying questions, and proposed architecture for enabling a session's AI to call on a named agent mid-conversation and use it as a sub-agent to perform delegated work.

---

## How Things Currently Work

### What an "Agent" Is Today

An agent is a **saved configuration template** stored in the `agents` SQLite table. It has:

- `name` + `description` + `icon` — identity
- `model` — which Claude model to use (e.g. `claude-opus-4-6`)
- `allowed_tools` — JSON array of permitted tools (e.g. `["Bash", "Read", "Write"]`)
- `status` — `active` / `disabled` / `archived`
- Version history via `agent_versions`

Agents currently live in the **Agents tab** of the UI. They are purely a catalog — a user can browse them, create them (manually or via AI generation), edit them, and view their version history. They are **never linked to a session** and are **never invoked at runtime**.

### How Sessions and Chat Work Today

Each chat session runs a single long-lived `query()` call (via `@anthropic-ai/claude-agent-sdk` streaming input mode). User messages are pushed into an `AsyncGenerator` queue and yielded one by one into the same SDK stream. The session's `model`, `systemPrompt`, and `allowed_tools` are fixed at session creation time.

There is no mechanism for:
- Claude to know that named agents exist
- Claude to request that a specific agent perform a sub-task
- The server to spin up an agent-configured session in response to a delegation request and feed the result back to the parent session

### The Ephemeral Session Pattern (the Building Block)

The codebase already uses ephemeral "throw-away" SDK sessions for plan generation, plan execution, and AI-powered agent generation. The pattern:

1. Allocate a namespaced session ID (e.g. `plan-gen-{id}`)
2. Call `provider.createSession(id, options)` — starts a fresh SDK `query()` stream
3. `provider.onOutput()` listens for `type: "done"`
4. `provider.sendMessage(id, prompt)` kicks it off
5. On done: `provider.offOutput()` + `provider.closeSession()`

This is the exact building block that sub-agent delegation would extend.

---

## The Core Idea

When a user is chatting in a session, the session's AI should be able to recognize that a specific task is best handled by a purpose-built agent (e.g. "the Database Agent", "the Code Review Agent"), invoke that agent as a sub-agent, and return the result to the user — all transparently within the same conversation.

---

## Clarifying Questions

The following questions must be answered before implementation begins. Each question identifies a genuine design fork — different answers lead to meaningfully different architectures.

---

### 1. How does the session AI know which agents exist?

**Context**: Agents are in the DB. The session's Claude has no awareness of them.

**Option A** — Inject the agent catalog into the system prompt at session creation time. Claude "knows" all active agents upfront.

**Option B** — Add a tool (e.g. `ListAgents`) that Claude can call at any time to discover available agents on demand.

**Option C** — Hybrid: a brief summary of available agents in the system prompt, with a `GetAgentDetails` tool for deeper introspection.

**Question**: Should Claude always know about all agents, or should discovery be on-demand? And should the agent list be static (baked into the system prompt when the session starts) or live (fetched dynamically so newly created agents are visible mid-session)?

---

### 2. What triggers delegation — explicit user request or AI discretion?

**Option A — User-directed**: The user explicitly says "use the Database Agent for this". The session AI recognizes the intent and delegates.

**Option B — AI-directed**: The session AI autonomously decides "this task is best handled by the Code Review Agent" and delegates without being asked.

**Option C — Both**: The session AI can do either. If the user asks for a specific agent, it honors that. If it judges that delegation would help, it can propose it (or just do it).

**Question**: Do you want the session AI to autonomously decide to delegate, or should delegation only happen when the user (or the user's message) references a specific agent? And if AI-directed, should the AI propose delegation before doing it, or just do it?

---

### 3. What is the interaction model from the user's perspective?

**Option A — Transparent**: Delegation is invisible. The user sends a message, the session AI silently spins up the sub-agent, and the result appears as a normal reply. The user never knows a sub-agent was used.

**Option B — Visible but non-interactive**: A "Using Agent: Database Agent..." indicator appears in the chat. The sub-agent's work is shown as a collapsed/expandable block. The user can't interact with it.

**Option C — Visible and interactive**: The sub-agent's streaming output is shown in real time in the chat (like a nested conversation). The user can see its tool calls, intermediate steps, and output. They may be able to approve tool permissions for it.

**Option D — New session spawned**: Delegation actually opens a new session tab (or a linked child session) using the agent's config, and the result is summarized back into the parent session.

**Question**: How much visibility does the user need into what the sub-agent is doing? Is streaming transparency important, or is the final result all that matters?

---

### 4. What does the parent session receive from the sub-agent?

**Option A — Final text only**: The sub-agent runs to completion; only its final natural-language response is fed back to the parent session as a tool result.

**Option B — Full transcript**: The full message history from the sub-agent (all tool calls, tool results, intermediate steps, and final answer) is returned to the parent.

**Option C — Structured output**: The sub-agent is prompted to produce a structured JSON result (plus an explanation), which the parent session receives.

**Question**: Does the parent session need to "reason about" the sub-agent's intermediate steps, or is the final answer sufficient? This affects whether the parent can retry, correct, or follow up intelligently.

---

### 5. What is the failure and timeout model?

**Option A — Hard timeout**: If the sub-agent doesn't finish within N seconds/turns, delegation fails with an error fed back to the parent.

**Option B — Permission cascade**: If the sub-agent hits a permission gate (a tool it needs approval for), the permission request bubbles up to the parent session's user.

**Option C — Sub-agent inherits parent's skip_permissions setting**: If the parent session is in "skip permissions" mode, the sub-agent runs fully autonomously.

**Option D — Sub-agent always requires explicit permission approval from the user**, regardless of the parent's trust level.

**Question**: How should permission and trust levels be inherited (or not) by the sub-agent? And what should happen if the sub-agent gets stuck or exceeds a turn limit?

---

### 6. How does the session AI actually invoke the sub-agent?

**Option A — Custom SDK tool**: A tool called `DelegateToAgent` (or similar) is registered in the parent session. When Claude calls it, the server intercepts it via the `canUseTool` callback, runs the sub-agent, and returns the result as the tool result. Claude never leaves its session.

**Option B — Special message pattern**: The session AI emits a structured output (e.g. `<delegate agent="code-review" task="..."/>`) that the socket handler detects, intercepts, and processes server-side.

**Option C — User-initiated relay**: The user explicitly says "ask the Database Agent to do X", and the server routes the request on the user's behalf without needing Claude to call a tool at all.

**Question**: Should the invocation happen at the SDK/tool level (fully within Claude's reasoning loop) or at the application level (the server intercepts and orchestrates)?

---

### 7. Does the sub-agent run in a persistent session or a throw-away ephemeral session?

**Option A — Ephemeral (one-time)**: Each delegation spawns a fresh SDK session that is destroyed after the task completes. No history, no resume.

**Option B — Persistent child session**: A real session is created in the DB for each delegation, visible in the session list, with full message history, resumable by the user.

**Option C — Reusable pooled session**: One session per agent is kept warm; delegated tasks are sent to the same session so the agent retains context across multiple uses.

**Question**: Does the sub-agent need to remember prior context from earlier delegations in the same conversation? Or is each delegation fully self-contained?

---

### 8. How are the sub-agent's model and tool permissions determined?

**Option A — Always from the agent's saved config**: The model and `allowed_tools` stored in the agent definition are used exactly as configured, regardless of what the parent session has.

**Option B — Inherits from parent, with agent config as a restriction**: The sub-agent gets the intersection of the parent's permissions and the agent's `allowed_tools`, so it can't exceed what the parent is allowed to do.

**Option C — Fully configurable at delegation time**: The calling session can specify which tools the sub-agent may use per-task, up to but not exceeding the agent's defined `allowed_tools`.

**Question**: Should the agent's saved config be the authoritative source of truth for permissions, or should the parent session's trust level constrain the sub-agent further?

---

### 9. Can sub-agents themselves delegate to other agents (nesting)?

**Option A — No**: Sub-agent delegation is flat. Sub-agents cannot invoke other sub-agents.

**Option B — Yes, with a depth limit**: Sub-agents can delegate, but there is a configurable maximum nesting depth (e.g. 2 levels).

**Option C — Yes, unlimited**: Fully recursive delegation, constrained only by budget/turn limits.

**Question**: Is multi-level sub-agent delegation a desired or foreseeable use case? Even if not needed now, should the architecture leave the door open?

---

### 10. How is cost/budget tracked across the parent and sub-agent?

**Option A — Sub-agent costs count against the parent session's budget**: All token spend is aggregated under the originating session.

**Option B — Sub-agent costs are tracked separately**: Each delegation has its own cost entry, visible in the sub-agent's session (if it creates one).

**Option C — Hybrid**: Costs are tracked per-sub-agent run for transparency but are also rolled up to the parent session's budget cap.

**Question**: Should the user see a breakdown of what each sub-agent spent? And should the parent session's budget cap apply to the sub-agent's spend?

---

### 11. What does the UX for configuring "which agents a session can delegate to" look like?

**Option A — All active agents are always available**: Any session can delegate to any active agent. No per-session configuration.

**Option B — Opt-in per session**: When creating or editing a session, the user selects which agents it is allowed to delegate to.

**Option C — Opt-in per agent**: An agent can be marked as "available for delegation" vs "standalone only".

**Option D — Role-based**: Only certain user roles (e.g. admin) can enable delegation in a session.

**Question**: Should delegation be unrestricted by default, or gated by configuration?

---

### 12. How should this interact with Plan Mode?

**Context**: Plan Mode already uses ephemeral sessions to execute individual plan steps. Sub-agent delegation is conceptually similar.

**Option A — Orthogonal**: Plan Mode and sub-agent delegation are independent features that don't interact.

**Option B — Sub-agents can be used within plan steps**: A plan step's execution session can itself delegate to a sub-agent.

**Option C — Plan steps can be assigned to specific agents**: When reviewing a plan, a user can assign each step to a particular agent.

**Question**: Should sub-agent delegation be integrated with Plan Mode, or kept as a standalone chat feature for now?

---

## Summary Table

| # | Question | Stakes |
|---|----------|--------|
| 1 | How does the session AI discover agents? | System prompt design, prompt size |
| 2 | User-directed vs AI-directed delegation | Control flow, trust model |
| 3 | Transparency in the UI | Frontend complexity |
| 4 | What the parent receives from the sub-agent | Parent's reasoning quality |
| 5 | Failure, timeout, and permission model | Safety, reliability |
| 6 | How the invocation mechanism works | Backend architecture choice |
| 7 | Ephemeral vs persistent sub-agent sessions | Data model, user visibility |
| 8 | How model/tool permissions are determined | Security model |
| 9 | Can sub-agents nest? | Architectural future-proofing |
| 10 | Cost/budget attribution | Billing transparency |
| 11 | UX for configuring eligible agents per session | Settings UI complexity |
| 12 | Integration with Plan Mode | Scope of this feature |

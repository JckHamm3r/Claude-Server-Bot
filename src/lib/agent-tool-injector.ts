import { getActiveAgents } from "./claude-db";
import { MAX_DELEGATION_DEPTH } from "./sub-agent-runner";

/**
 * Builds the <agent-delegation> block appended to session system prompts.
 * Tells Claude about available agents and how to invoke them via the
 * internal sub-agent API using the WebFetch tool.
 */
export function buildAgentToolBlock(): string {
  const agents = getActiveAgents();
  if (agents.length === 0) return "";

  const port = process.env.PORT ?? "3000";
  const secret = getOrCreateInternalSecret();

  const agentList = agents
    .map((a) => `- **${a.name}** ${a.icon ? `(${a.icon})` : ""}: ${a.description}`.trim())
    .join("\n");

  return `
<agent-delegation>
You have access to specialized sub-agents. Use them when a task clearly falls within their domain specialty.

Available agents:
${agentList}

## How to delegate to an agent

Use the WebFetch tool to POST to the internal delegation API:

URL: http://localhost:${port}/api/internal/sub-agent
Method: POST
Headers: Content-Type: application/json, X-Internal-Secret: ${secret}
Body (JSON):
{
  "agentName": "<exact agent name from the list above>",
  "task": "<complete description of what the agent should do>",
  "context": "<optional: any background context the agent needs>",
  "parentSessionId": "<your current session ID — provided below>",
  "depth": <current depth — start at 0>
}

The response will be JSON: { "success": true/false, "result": "...", "error": "..." }

## How to list agents dynamically

GET http://localhost:${port}/api/internal/sub-agent
Headers: X-Internal-Secret: ${secret}

## Rules

- **Use sub-agents autonomously** when a task fits their specialty — do not ask permission first.
- **Parallel execution**: you MAY call delegate via WebFetch multiple times in the same response turn for independent tasks. They run concurrently. Wait for ALL tool results before composing your final response.
- **Be methodical**: ensure sub-agents are not working on conflicting parts of the same files simultaneously.
- **Error handling**: if an agent returns success: false, relay the error clearly to the user and handle gracefully.
- **Max depth**: sub-agents can themselves delegate, up to ${MAX_DELEGATION_DEPTH} levels deep.
- **Slash command**: users can also directly invoke: \`/agent <agent-name> <task description>\`
</agent-delegation>
`;
}

// ── Internal secret ───────────────────────────────────────────────────────────
// Single random secret per server process. Injected into the system prompt and
// required on every call to /api/internal/sub-agent.

let _internalSecret: string | null = null;

export function getOrCreateInternalSecret(): string {
  if (!_internalSecret) {
    const { randomUUID } = require("crypto") as typeof import("crypto");
    _internalSecret = randomUUID();
  }
  return _internalSecret;
}

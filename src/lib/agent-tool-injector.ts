import { getActiveAgents } from "./claude-db";
import { MAX_DELEGATION_DEPTH } from "./sub-agent-runner";
import { randomUUID } from "crypto";

/**
 * Builds the <agent-delegation> block appended to session system prompts.
 * Tells Claude about available agents and how to invoke them via the
 * internal sub-agent API using the WebFetch tool.
 */
export async function buildAgentToolBlock(): Promise<string> {
  const agents = await getActiveAgents();
  if (agents.length === 0) return "";

  const secret = getOrCreateInternalSecret();
  const baseUrl = getSubAgentBaseUrl();

  const agentList = agents
    .map((a) => {
      const phrases = a.trigger_phrases.length > 0
        ? `\n  Trigger phrases: ${a.trigger_phrases.map(p => `"${p}"`).join(", ")}`
        : "";
      const permNote = !a.skip_permissions ? " [sandboxed]" : "";
      return `- **${a.name}**${a.icon ? ` (${a.icon})` : ""}${permNote}: ${a.description}${phrases}`.trim();
    })
    .join("\n");

  return `
<agent-delegation>
You have access to specialized sub-agents. Use them when a task clearly falls within their domain specialty.

Available agents:
${agentList}

## How to delegate to an agent

Use the **WebFetch** tool to POST to the internal delegation API.
IMPORTANT: Use WebFetch, NOT Bash/curl. WebFetch to this endpoint is automatically approved.

URL: ${baseUrl}
Method: POST
Headers: Content-Type: application/json, X-Internal-Secret: ${secret}
Body (JSON):
{
  "agentName": "<exact agent name from the list above>",
  "task": "<complete description of what the agent should do>",
  "context": "<optional: any background context the agent needs>",
  "parentSessionId": "<your current session ID>",
  "userEmail": "<the user's email address>",
  "skipPermissions": "<use the agent's configured permission mode>",
  "depth": 0
}

The response will be JSON: { "success": true/false, "result": "...", "error": "..." }

WebFetch example call:
WebFetch(url="${baseUrl}", method="POST", headers={"Content-Type": "application/json", "X-Internal-Secret": "${secret}"}, body=JSON.stringify({agentName: "AgentName", task: "task description", parentSessionId: "sessionId", userEmail: "email", depth: 0}))

## How to list agents dynamically

Use WebFetch:
WebFetch(url="${baseUrl}", method="GET", headers={"X-Internal-Secret": "${secret}"})

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
// Stored in an env var so both the socket layer (server.ts) and the Next.js
// API route handler (which may run in a different module context) share the same value.

const ENV_KEY = "_OCTOBY_SUB_AGENT_SECRET";

export function getOrCreateInternalSecret(): string {
  if (!process.env[ENV_KEY]) {
    process.env[ENV_KEY] = randomUUID();
  }
  return process.env[ENV_KEY]!;
}

// ── Base URL helpers ──────────────────────────────────────────────────────────

/**
 * Returns the localhost URL to the sub-agent delegation endpoint.
 * Handles both development (no slug prefix) and production (slug-based path).
 *
 * In production the custom server (server.ts) uses slug-based routing and the
 * app is reachable at http(s)://host:port/<prefix>/<slug>/api/...
 * For sub-agent calls we always want to use localhost with the same path
 * structure so the request stays within the process.
 */
export function getSubAgentBaseUrl(): string {
  const port = process.env.PORT ?? "3000";
  // In production, NEXTAUTH_URL contains the full public base path including slug.
  // Extract its pathname to reconstruct the localhost URL.
  const nextAuthUrl = process.env.NEXTAUTH_URL ?? "";
  let pathname = "";
  try {
    const parsed = new URL(nextAuthUrl);
    pathname = parsed.pathname.replace(/\/$/, ""); // strip trailing slash
  } catch {
    // fallback: use env vars directly
    const pathPrefix = process.env.CLAUDE_BOT_PATH_PREFIX ?? "";
    const slug = process.env.CLAUDE_BOT_SLUG ?? "";
    if (pathPrefix && slug) pathname = `/${pathPrefix}/${slug}`;
  }
  return `http://localhost:${port}${pathname}/api/internal/sub-agent`;
}

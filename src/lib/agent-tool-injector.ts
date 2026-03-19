import { getActiveAgents } from "./claude-db";
import { MAX_DELEGATION_DEPTH } from "./sub-agent-runner";
import { randomUUID } from "crypto";

/**
 * Builds the <agent-delegation> block appended to session system prompts.
 * Tells Claude about available agents and how to invoke them via the
 * "delegate_to_agent" virtual tool (intercepted in canUseTool).
 *
 * The previous approach used WebFetch to POST to an internal API endpoint,
 * but the SDK's WebFetch tool only supports `url` + `prompt` (not method/headers/body),
 * so the calls always failed with "Invalid URL". The virtual tool pattern
 * (same as update_session_context) is intercepted server-side and works reliably.
 */
export async function buildAgentToolBlock(): Promise<string> {
  const agents = await getActiveAgents();
  if (agents.length === 0) return "";

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
You have access to specialized sub-agents. **You MUST delegate to the appropriate agent** when a task falls within their domain specialty. Do NOT attempt to handle a task yourself if a matching agent exists — delegate first.

Available agents:
${agentList}

## MANDATORY delegation rules

1. **If an agent's description or trigger phrases match the user's request, you MUST delegate to that agent.** Do not handle the task yourself. Do not ask the user for permission — delegate immediately.
2. **If you are unsure whether an agent matches, delegate anyway.** It is always better to delegate to a specialist than to handle it yourself when an agent exists for that domain.
3. **Only handle a task yourself if NO available agent is even remotely relevant.**

## How to delegate

You have a virtual tool called **"delegate_to_agent"**. Call it with this JSON input:

{
  "agentName": "<exact agent name from the list above>",
  "task": "<complete description of what the agent should do — include all user context and requirements>"
}

The tool returns JSON: { "success": true/false, "result": "...", "error": "..." }

Example tool call:
delegate_to_agent({ "agentName": "GameMaster", "task": "Create a snake game with neon cyberpunk aesthetics, power-ups, combo system, and particle effects" })

**IMPORTANT:** Do NOT use WebFetch, Bash, or curl to delegate. The delegate_to_agent tool is the ONLY way to invoke sub-agents. It is automatically approved and requires no user confirmation.

## Additional rules

- **Parallel execution**: you MAY call delegate_to_agent multiple times in the same response turn for independent tasks. They run concurrently. Wait for ALL tool results before composing your final response.
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

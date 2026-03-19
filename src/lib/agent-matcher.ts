import type { ClaudeAgent } from "./claude-db";
import { getActiveAgents } from "./claude-db";
import { getAppSetting } from "./app-settings";

/**
 * Uses Haiku to classify whether a user message should be routed to a
 * specific agent based on agent descriptions and trigger phrases.
 * Returns the matched agent or null if no match.
 *
 * This runs before the message reaches the main session Claude to enable
 * deterministic, server-side auto-delegation.
 */

async function getApiKey(): Promise<string> {
  return (await getAppSetting("anthropic_api_key", "")) || process.env.ANTHROPIC_API_KEY || "";
}

export interface AgentMatch {
  agent: ClaudeAgent;
  confidence: "high" | "medium";
  reasoning: string;
}

/**
 * Ask Haiku whether the user's message should be routed to one of the
 * available agents.  Returns `null` if no agent is a good match.
 *
 * The call is lightweight (~200-400 input tokens, ~60 output tokens)
 * and uses a short timeout so it doesn't noticeably slow down the
 * normal message flow.
 */
export async function matchAgentForMessage(
  userMessage: string,
): Promise<AgentMatch | null> {
  const agents = await getActiveAgents();
  if (agents.length === 0) return null;

  const apiKey = await getApiKey();
  if (!apiKey) return null;

  // Build a compact agent summary for the classifier
  const agentSummaries = agents
    .map((a, i) => {
      const triggers = a.trigger_phrases.length > 0
        ? ` | Triggers: ${a.trigger_phrases.join(", ")}`
        : "";
      return `${i}: "${a.name}" — ${a.description}${triggers}`;
    })
    .join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: `You are a request router. Given a user message and a list of specialized AI agents, determine if the message should be routed to one of the agents.

Agents:
${agentSummaries}

User message: "${userMessage.slice(0, 500)}"

If the message clearly fits an agent's specialty, respond with ONLY this JSON (no other text):
{"match": <agent index>, "confidence": "high"|"medium", "reason": "<brief reason>"}

If no agent is a good fit, respond with ONLY:
{"match": -1}

Rules:
- "high" = the request directly falls within the agent's domain (e.g., asking for a game from a game dev agent)
- "medium" = the request is related but not a perfect match
- Only match if the user is asking for something the agent is designed to DO, not just discuss
- When in doubt, return {"match": -1} — don't force a match`,
          },
        ],
      }),
      signal: AbortSignal.timeout(2500),
    });

    if (!res.ok) return null;

    const data = await res.json() as { content?: { type: string; text: string }[] };
    const rawText = data?.content?.[0]?.text?.trim() ?? "";

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      match: number;
      confidence?: "high" | "medium";
      reason?: string;
    };

    if (parsed.match < 0 || parsed.match >= agents.length) return null;

    const confidence = parsed.confidence ?? "medium";

    // Only auto-route on high confidence matches
    if (confidence !== "high") return null;

    return {
      agent: agents[parsed.match],
      confidence,
      reasoning: parsed.reason ?? "",
    };
  } catch (err) {
    // Classification failure should never block the message — fall through silently
    console.error("[agent-matcher] Classification error:", err);
    return null;
  }
}

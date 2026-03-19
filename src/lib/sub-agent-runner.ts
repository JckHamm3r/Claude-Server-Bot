import { getClaudeProvider } from "./claude";
import { getActiveAgents, recordAgentInvocation, getMemoriesForTarget } from "./claude-db";
import { registerSubAgent, updateSubAgentStatus } from "./sub-agent-registry";
import { randomUUID } from "crypto";

export const MAX_DELEGATION_DEPTH = 4;
const SUB_AGENT_MAX_TURNS = 50;

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
  parentSessionId: string;
  userEmail: string;
  skipPermissions: boolean;
  delegationDepth: number;
  onCostAccrued?: (cost: number) => void;
}

export async function runSubAgent(opts: SubAgentOptions): Promise<SubAgentResult> {
  if (opts.delegationDepth >= MAX_DELEGATION_DEPTH) {
    return {
      success: false,
      result: "",
      costUsd: 0,
      error: `Maximum delegation depth (${MAX_DELEGATION_DEPTH}) reached. Cannot delegate further.`,
    };
  }

  const agents = await getActiveAgents();
  const agent = agents.find((a) => a.name.toLowerCase() === opts.agentName.toLowerCase());
  if (!agent) {
    const names = agents.map((a) => `"${a.name}"`).join(", ");
    return {
      success: false,
      result: "",
      costUsd: 0,
      error: `Agent "${opts.agentName}" not found or not active. Available agents: ${names || "none"}`,
    };
  }

  const provider = getClaudeProvider();
  const subAgentId = randomUUID();
  const subSessionId = `sub-agent-${subAgentId}`;

  // Register in the UI registry before starting
  registerSubAgent(opts.parentSessionId, subAgentId, agent.name, agent.icon ?? null, opts.task);

  const basePromptParts = [
    `You are "${agent.name}": ${agent.system_prompt ?? agent.description}`,
    ``,
    `Execute the task you are given completely and thoroughly. Return a clear, comprehensive result.`,
    `If you encounter any errors or cannot complete part of the task, explain exactly what went wrong.`,
    `If you need to delegate a sub-task to another specialized agent, use the delegation mechanism described in your tools.`,
  ];

  const agentMemories = await getMemoriesForTarget(agent.id);
  if (agentMemories.length > 0) {
    const memoriesText = agentMemories
      .map((m) => `### ${m.title}\n${m.content}`)
      .join("\n\n");
    basePromptParts.push(
      ``,
      `<memories>\nThe following are important memory items for this project. Treat them as ground truth.\n\n${memoriesText}\n</memories>`,
    );
  }

  const systemPrompt = basePromptParts.join("\n");

  provider.createSession(subSessionId, {
    model: agent.model,
    systemPrompt,
    skipPermissions: agent.skip_permissions,
    userEmail: opts.userEmail,
    maxTurns: SUB_AGENT_MAX_TURNS,
    delegationDepth: opts.delegationDepth + 1,
    parentSessionId: opts.parentSessionId,
    onSubAgentCost: opts.onCostAccrued,
  });

  // Apply the agent's allowed tools (if not in skip-permissions mode)
  if (!agent.skip_permissions && agent.allowed_tools.length > 0) {
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
          updateSubAgentStatus(opts.parentSessionId, subAgentId, "error", errorMsg);
          void recordAgentInvocation(agent.id, false, costUsd);
          resolve({ success: false, result: "", costUsd, error: errorMsg });
        } else {
          updateSubAgentStatus(opts.parentSessionId, subAgentId, "complete");
          void recordAgentInvocation(agent.id, true, costUsd);
          resolve({
            success: true,
            result: finalText,
            costUsd,
            error: hasError ? errorMsg : undefined,
          });
        }
      }
    });

    const fullTask = opts.context
      ? `Context:\n${opts.context}\n\nTask:\n${opts.task}`
      : opts.task;

    provider.sendMessage(subSessionId, fullTask);
  });
}

/**
 * In-process MCP server that provides the `delegate_to_agent` tool.
 *
 * Registered as an SDK MCP server so Claude can call it as a real tool
 * (with proper input schema, result handling, and auto-approval).
 * Replaces the previous WebFetch-based approach which failed because
 * the SDK's WebFetch only supports url+prompt, not POST with headers/body.
 */

import { z } from "zod";
import { runSubAgent } from "./sub-agent-runner";
import { getActiveAgents } from "./claude-db";

// Lazy-loaded SDK reference — avoids import errors if SDK not installed
let createSdkMcpServerFn: typeof import("@anthropic-ai/claude-agent-sdk").createSdkMcpServer | null = null;

async function getCreateSdkMcpServer() {
  if (!createSdkMcpServerFn) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    createSdkMcpServerFn = sdk.createSdkMcpServer;
  }
  return createSdkMcpServerFn;
}

/**
 * Session-specific context needed by the delegation tool handler.
 * Passed in when creating the MCP server for a session.
 */
export interface DelegationContext {
  sessionId: string;
  userEmail: string;
  skipPermissions: boolean;
  delegationDepth: number;
}

/**
 * Creates an in-process MCP server instance with the delegate_to_agent tool.
 * Each session gets its own instance (since the handler needs session context).
 */
export async function createDelegationMcpServer(ctx: DelegationContext) {
  const createServer = await getCreateSdkMcpServer();

  return createServer({
    name: "octoby-delegation",
    version: "1.0.0",
    tools: [
      {
        name: "delegate_to_agent",
        description:
          "Delegate a task to a specialized sub-agent. " +
          "Use this when a task matches an available agent's specialty. " +
          "Returns the agent's result as JSON with success, result, and error fields.",
        inputSchema: {
          agentName: z
            .string()
            .describe("Exact name of the agent to delegate to (from the available agents list)"),
          task: z
            .string()
            .describe("Complete description of what the agent should do — include all user context and requirements"),
          context: z
            .string()
            .optional()
            .describe("Optional background context the agent needs"),
        },
        handler: async (args) => {
          const agentName = args.agentName as string;
          const task = args.task as string;
          const context = args.context as string | undefined;
          try {
            const result = await runSubAgent({
              agentName,
              task,
              context,
              parentSessionId: ctx.sessionId,
              userEmail: ctx.userEmail,
              skipPermissions: ctx.skipPermissions,
              delegationDepth: ctx.delegationDepth,
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result),
                },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    result: "",
                    costUsd: 0,
                    error: String(err),
                  }),
                },
              ],
              isError: true,
            };
          }
        },
      },
      {
        name: "list_agents",
        description: "List all available specialized agents and their descriptions.",
        inputSchema: {},
        handler: async () => {
          const agents = await getActiveAgents();
          const list = agents.map((a) => ({
            name: a.name,
            icon: a.icon,
            description: a.description,
            triggerPhrases: a.trigger_phrases,
          }));
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(list, null, 2),
              },
            ],
          };
        },
      },
    ],
  });
}

import { execFileSync } from "child_process";
import type { HandlerContext } from "./types";
import {
  type ClaudePlanStep,
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgent,
  getAgentVersions,
  createPlan,
  getPlan,
  updatePlanStatus,
  listPlansForUser,
  addPlanStep,
  getPlanSteps,
  updatePlanStep,
  deletePlanSteps,
  deletePlan,
  isUserAdmin,
  getAgentMemories,
  setMemoryAssignments,
  getMemories,
  checkAgentDeleteImpact,
  deleteAgentWithMemoryHandling,
  getAgentStats,
} from "../lib/claude-db";
import { logActivity } from "../lib/activity-log";
import { DEFAULT_MODEL } from "../lib/models";
import { PlanExecutionController, planOwners } from "./plan-execution-controller";
import { dbTransaction } from "../lib/db";

function sanitizePromptInput(input: string, maxLen = 2000): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen);
}

function isValidPlanId(id: string): boolean {
  return /^[0-9a-f-]+$/i.test(id) && id.length <= 64;
}

export function registerPlanHandlers(ctx: HandlerContext) {
  const { socket, email, provider } = ctx;

  // ── Agent handlers ────────────────────────────────────────────────────

  socket.on("claude:list_agents", async () => {
    try {
      const agents = await listAgents(email);
      socket.emit("claude:agents", { agents });
    } catch {
      socket.emit("claude:agents", { agents: [] });
    }
  });

  socket.on(
    "claude:create_agent",
    async ({ name, description, icon, model, allowed_tools, system_prompt, skip_permissions, trigger_phrases }: {
      name: string; description: string; icon?: string; model: string; allowed_tools: string[]; system_prompt?: string; skip_permissions?: boolean; trigger_phrases?: string[];
    }) => {
      try {
        await createAgent({ name, description, system_prompt, icon, model, allowed_tools, skip_permissions, trigger_phrases }, email);
        ctx.metricsBuffer.agent_count++;
        await logActivity("agent_created", email, { name });
        const agents = await listAgents(email);
        socket.emit("claude:agents", { agents });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:update_agent",
    async ({ agentId, data, changeDescription }: {
      agentId: string;
      data: Partial<{ name: string; description: string; icon: string; model: string; allowed_tools: string[]; status: string; system_prompt: string | null; skip_permissions: boolean; trigger_phrases: string[] }>;
      changeDescription?: string;
    }) => {
      try {
        const agent = await getAgent(agentId);
        if (!agent || (agent.created_by !== email && !await isUserAdmin(email))) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
        await updateAgent(agentId, data, email, changeDescription);
        const agents = await listAgents(email);
        socket.emit("claude:agents", { agents });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:check_agent_delete", async ({ agentId }: { agentId: string }) => {
    try {
      const agent = await getAgent(agentId);
      if (!agent || (agent.created_by !== email && !await isUserAdmin(email))) {
        socket.emit("claude:error", { message: "Access denied" });
        return;
      }
      const impact = await checkAgentDeleteImpact(agentId);
      socket.emit("claude:agent_delete_impact", impact);
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:confirm_agent_delete", async ({ agentId, deleteOrphanedMemoryIds }: { agentId: string; deleteOrphanedMemoryIds: string[] }) => {
    try {
      const agent = await getAgent(agentId);
      if (!agent || (agent.created_by !== email && !await isUserAdmin(email))) {
        socket.emit("claude:error", { message: "Access denied" });
        return;
      }
      await deleteAgentWithMemoryHandling(agentId, deleteOrphanedMemoryIds);
      await logActivity("agent_deleted", email, { name: agent.name, deleteOrphanedMemoryIds });
      const agents = await listAgents(email);
      socket.emit("claude:agents", { agents });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:delete_agent", async ({ agentId }: { agentId: string }) => {
    try {
      const agent = await getAgent(agentId);
      if (!agent || (agent.created_by !== email && !await isUserAdmin(email))) {
        socket.emit("claude:error", { message: "Access denied" });
        return;
      }
      await deleteAgent(agentId);
      const agents = await listAgents(email);
      socket.emit("claude:agents", { agents });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:get_agent_versions", async ({ agentId }: { agentId: string }) => {
    try {
      const versions = await getAgentVersions(agentId);
      socket.emit("claude:agent_versions", { agentId, versions });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:get_agent_memories", async ({ agentId }: { agentId: string }) => {
    try {
      const memories = await getAgentMemories(agentId);
      socket.emit("claude:agent_memories", { agentId, memories });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:get_agent_stats", async ({ agentId }: { agentId: string }) => {
    try {
      const stats = await getAgentStats(agentId);
      socket.emit("claude:agent_stats", { agentId, stats });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on(
    "claude:set_memory_assignments",
    async ({ memoryId, isGlobal, agentIds }: { memoryId: string; isGlobal: boolean; agentIds: string[] }) => {
      try {
        if (!await isUserAdmin(email)) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
        await setMemoryAssignments(memoryId, isGlobal, agentIds);
        const memories = await getMemories();
        socket.emit("claude:memories_updated", { memories });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  // ── Interactive Agent Builder ─────────────────────────────────────────
  const builderSessions = new Map<string, string>(); // builderId -> providerSessionId

  const BUILDER_SYSTEM_PROMPT = `You are an expert AI agent configuration designer for the Octoby platform.
Your goal is to help the user design a specialized AI agent through a brief, focused conversation.

Ask 2-3 targeted questions per turn to understand:
- The agent's primary purpose and domain expertise
- What tools it needs (Available: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent)
- Whether it should run in sandbox mode (restricted to specific tools) or have full access
- Key behavioral instructions and constraints

## CRITICAL: Trigger Phrases

You MUST generate comprehensive trigger phrases. These phrases are used by an automatic routing system to detect when a user's message should be handled by this agent. If trigger phrases are vague or missing, the agent will NEVER be automatically invoked.

**Always ask the user**: "What kinds of requests should automatically trigger this agent?"

Then generate 8-15 diverse trigger phrases that cover:
- Direct requests ("create a snake game", "build me a website")
- Variations in phrasing ("make a game", "I want a game", "develop a game for me")
- Related sub-tasks ("add power-ups to the game", "fix the game collision detection")
- Domain keywords that signal this agent's specialty
- Both casual and formal request styles

Bad trigger phrases: ["game", "code"] — too generic, will match everything
Good trigger phrases: ["create a game", "build me a game", "make a snake game", "develop a platformer", "I want a game with upgrades", "build a web game", "create an arcade game", "make a game with particle effects"]

After gathering enough information (typically 2-4 exchanges), produce the final configuration.
When ready, emit EXACTLY this XML tag with valid JSON inside:

<agent-config>
{
  "name": "Agent Name",
  "icon": "emoji",
  "description": "1-2 sentence summary for the agent list — be specific about what this agent DOES",
  "system_prompt": "Detailed behavioral instructions, personality, constraints, and domain knowledge. Include the agent's specialty areas, coding style preferences, quality standards, and any domain-specific rules.",
  "model": "claude-sonnet-4-6",
  "allowed_tools": ["Bash", "Read"],
  "skip_permissions": true,
  "trigger_phrases": ["8-15 diverse phrases covering different ways users might request this agent's specialty"]
}
</agent-config>

Available models: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
Be concise. Ask focused questions. When you have enough info, produce the config.`;

  socket.on("claude:start_agent_builder", async ({ builderId, initialMessage }: { builderId: string; initialMessage?: string }) => {
    const providerSessionId = `agent-builder-${builderId}`;
    try {
      // Clean up any existing builder session with this ID to prevent leaks
      const existingSession = builderSessions.get(builderId);
      if (existingSession) {
        try { provider.offOutput(existingSession); provider.closeSession(existingSession); } catch { /* ignore */ }
      }
      builderSessions.set(builderId, providerSessionId);
      provider.createSession(providerSessionId, {
        skipPermissions: true,
        systemPrompt: BUILDER_SYSTEM_PROMPT,
        useRawSystemPrompt: true,
      });

      let accumulated = "";
      provider.onOutput(providerSessionId, (parsed) => {
        if (parsed.type === "streaming" && parsed.content) {
          accumulated = parsed.content;
          socket.emit("claude:agent_builder_chunk", { builderId, content: accumulated });
        }
        if (parsed.type === "text" && parsed.content) {
          accumulated = parsed.content;
        }
        if (parsed.type === "done") {
          provider.offOutput(providerSessionId);
          const configMatch = accumulated.match(/<agent-config>([\s\S]*?)<\/agent-config>/);
          if (configMatch) {
            try {
              const config = JSON.parse(configMatch[1].trim());
              socket.emit("claude:agent_builder_complete", { builderId, config, content: accumulated });
              provider.closeSession(providerSessionId);
              builderSessions.delete(builderId);
              return;
            } catch { /* not valid JSON, continue conversation */ }
          }
          socket.emit("claude:agent_builder_done", { builderId, content: accumulated });
        }
        if (parsed.type === "error") {
          provider.offOutput(providerSessionId);
          socket.emit("claude:error", { message: parsed.message ?? "Builder error" });
        }
      });

      provider.sendMessage(providerSessionId, initialMessage || "I want to create a new AI agent. Help me design it.");
    } catch (err) {
      provider.closeSession(providerSessionId);
      builderSessions.delete(builderId);
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:agent_builder_message", async ({ builderId, message }: { builderId: string; message: string }) => {
    const providerSessionId = builderSessions.get(builderId);
    if (!providerSessionId) {
      socket.emit("claude:error", { message: "Builder session not found. Start a new one." });
      return;
    }
    // Remove any previous listener before registering a new one (prevents stacking)
    provider.offOutput(providerSessionId);
    let accumulated = "";
    provider.onOutput(providerSessionId, (parsed) => {
      if (parsed.type === "streaming" && parsed.content) {
        accumulated = parsed.content;
        socket.emit("claude:agent_builder_chunk", { builderId, content: accumulated });
      }
      if (parsed.type === "text" && parsed.content) {
        accumulated = parsed.content;
      }
      if (parsed.type === "done") {
        provider.offOutput(providerSessionId);
        const configMatch = accumulated.match(/<agent-config>([\s\S]*?)<\/agent-config>/);
        if (configMatch) {
          try {
            const config = JSON.parse(configMatch[1].trim());
            socket.emit("claude:agent_builder_complete", { builderId, config, content: accumulated });
            provider.closeSession(providerSessionId);
            builderSessions.delete(builderId);
            return;
          } catch { /* not valid JSON, continue conversation */ }
        }
        socket.emit("claude:agent_builder_done", { builderId, content: accumulated });
      }
      if (parsed.type === "error") {
        provider.offOutput(providerSessionId);
        provider.closeSession(providerSessionId);
        builderSessions.delete(builderId);
        socket.emit("claude:error", { message: parsed.message ?? "Builder error" });
      }
    });
    provider.sendMessage(providerSessionId, sanitizePromptInput(message));
  });

  socket.on("claude:cancel_agent_builder", ({ builderId }: { builderId: string }) => {
    const providerSessionId = builderSessions.get(builderId);
    if (providerSessionId) {
      provider.offOutput(providerSessionId);
      provider.closeSession(providerSessionId);
      builderSessions.delete(builderId);
    }
  });

  socket.on("claude:generate_agent", async ({ description }: { description: string }) => {
    const sessionId = `agent-gen-${Date.now()}`;
    try {
      provider.createSession(sessionId, { skipPermissions: true });

      const prompt = `Generate a Claude Code agent configuration for: ${sanitizePromptInput(description)}

Return ONLY valid JSON with these fields:
{
  "name": "string — short, memorable agent name",
  "description": "string — 1-2 sentence summary of what this agent specializes in",
  "system_prompt": "string — detailed behavioral instructions, personality, domain expertise, quality standards, and constraints for the agent",
  "model": "${DEFAULT_MODEL}",
  "allowed_tools": ["array", "of", "tool", "names"],
  "skip_permissions": true,
  "icon": "emoji",
  "trigger_phrases": ["8-15 diverse phrases covering different ways users might request this agent's specialty — include variations in phrasing, related sub-tasks, and both casual/formal styles"]
}

Available tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent

IMPORTANT: trigger_phrases are critical — they power automatic routing. Generate diverse, specific phrases (not single keywords). Cover synonyms, different sentence structures, and related tasks.

Return only the JSON object, no markdown, no explanation.`;

      let lastTextOutput = "";

      provider.onOutput(sessionId, (parsed) => {
        if (parsed.type === "text" && parsed.content) {
          lastTextOutput = parsed.content;
        } else if (parsed.type === "streaming" && parsed.content) {
          lastTextOutput = parsed.content;
        }
        if (parsed.type === "done") {
          provider.offOutput(sessionId);
          provider.closeSession(sessionId);
          try {
            const cleaned = lastTextOutput
              .replace(/^```(?:json)?\s*/i, "")
              .replace(/\s*```\s*$/, "")
              .trim();
            const config = JSON.parse(cleaned);
            socket.emit("claude:agent_generated", { config });
          } catch {
            socket.emit("claude:error", { message: "Failed to parse agent config from Claude response" });
          }
        }
        if (parsed.type === "error") {
          provider.offOutput(sessionId);
          provider.closeSession(sessionId);
          socket.emit("claude:error", { message: parsed.message ?? "Claude error during agent generation" });
        }
      });

      provider.sendMessage(sessionId, prompt);
    } catch (err) {
      provider.offOutput(sessionId);
      provider.closeSession(sessionId);
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Plan handlers ─────────────────────────────────────────────────────

  // ── Q&A + Plan Generation ─────────────────────────────────────────────

  socket.on(
    "claude:generate_plan",
    async ({ sessionId, goal }: { sessionId: string; goal: string }) => {
      try {
        if (!goal?.trim()) {
          socket.emit("claude:error", { message: "Goal is required" });
          return;
        }
        const plan = await createPlan(sessionId, goal, email);
        await logActivity("plan_created", email, { planId: plan.id, goal });

        // Start Q&A phase — always ask clarifying questions first
        const qaSessionId = `plan-qa-${plan.id}`;
        provider.createSession(qaSessionId, {
          skipPermissions: true,
          systemPrompt: [
            "You are a software planning assistant helping clarify requirements before generating a plan.",
            "You MUST respond with ONLY valid JSON — no markdown, no commentary.",
            "",
            "On each turn, respond with one of:",
            '  {"ready": false, "question": "your question", "options": ["option1", "option2"]}',
            '  {"ready": true, "context": "summary of all gathered context"}',
            "",
            "Ask focused questions about:",
            "- Ambiguous requirements",
            "- Technology choices or constraints",
            "- Scope boundaries",
            "- Edge cases that would change the plan",
            "",
            "Ask at most 5 questions total. Ask one question at a time.",
            "Options are optional — omit them for freeform questions.",
            "When you have enough context (or after 5 questions), respond with ready: true.",
          ].join("\n"),
          useRawSystemPrompt: true,
        });

        const qaTranscript: string[] = [];
        let round = 0;
        const MAX_QA_ROUNDS = 5;

        // Wait for answer helper
        const waitForAnswer = (): Promise<string | null> => {
          return new Promise((resolve) => {
            ctx.planQACallbacks.set(plan.id, resolve);
          });
        };

        // Async Q&A loop
        const runQALoop = async () => {
          // First round — send the goal
          const firstMessage = `Goal: ${sanitizePromptInput(goal)}\n\nAsk your first clarifying question.`;

          // Async iteration: send message, wait for AI response, wait for user answer, repeat
          const sendAndWait = (message: string): Promise<{ ready: boolean; context?: string; question?: string; options?: string[] }> => {
            return new Promise((resolve) => {
              let lastOutput = "";

              provider.onOutput(qaSessionId, (parsed) => {
                if (parsed.type === "text" && parsed.content) lastOutput = parsed.content;
                else if (parsed.type === "streaming" && parsed.content) lastOutput = parsed.content;

                if (parsed.type === "done") {
                  provider.offOutput(qaSessionId);
                  try {
                    const cleaned = lastOutput.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
                    resolve(JSON.parse(cleaned));
                  } catch {
                    resolve({ ready: true });
                  }
                }
                if (parsed.type === "error") {
                  provider.offOutput(qaSessionId);
                  resolve({ ready: true });
                }
              });

              provider.sendMessage(qaSessionId, message);
            });
          };

          // First AI turn
          const firstResponse = await sendAndWait(firstMessage);

          if (firstResponse.ready === true) {
            provider.closeSession(qaSessionId);
            const enrichedContext = firstResponse.context ? `\n\nClarification context:\n${firstResponse.context}` : "";
            generatePlanFromGoal(plan.id, goal + enrichedContext);
            return;
          }

          round = 1;
          socket.emit("claude:plan_questions", {
            planId: plan.id,
            question: firstResponse.question ?? "Could you provide more details?",
            options: firstResponse.options,
            round,
          });

          // Q&A loop — track current question for accurate transcript
          let currentQuestion = firstResponse.question ?? "";
          while (round <= MAX_QA_ROUNDS) {
            const answer = await waitForAnswer();
            ctx.planQACallbacks.delete(plan.id);

            if (answer === null) {
              // User clicked "You figure out the rest"
              provider.closeSession(qaSessionId);
              const transcript = qaTranscript.length > 0
                ? `\n\nQ&A transcript:\n${qaTranscript.join("\n")}`
                : "";
              generatePlanFromGoal(plan.id, goal + transcript);
              return;
            }

            qaTranscript.push(`Q${round}: ${currentQuestion}`);
            qaTranscript.push(`A${round}: ${answer}`);

            const response = await sendAndWait(`User answer: ${answer}`);

            if (response.ready === true || round >= MAX_QA_ROUNDS) {
              provider.closeSession(qaSessionId);
              const enrichedContext = response.context ? `\n\nClarification context:\n${response.context}` : "";
              const transcript = qaTranscript.length > 0
                ? `\n\nQ&A transcript:\n${qaTranscript.join("\n")}`
                : "";
              generatePlanFromGoal(plan.id, goal + enrichedContext + transcript);
              return;
            }

            currentQuestion = response.question ?? "Could you provide more details?";
            round++;
            socket.emit("claude:plan_questions", {
              planId: plan.id,
              question: currentQuestion,
              options: response.options,
              round,
            });
          }
        };

        runQALoop().catch((err) => {
          ctx.planQACallbacks.delete(plan.id);
          provider.closeSession(qaSessionId);
          socket.emit("claude:error", { message: String(err) });
        });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:answer_questions", ({ planId, answer }: { planId: string; answer: string }) => {
    const cb = ctx.planQACallbacks.get(planId);
    if (cb) cb(answer);
  });

  socket.on("claude:skip_questions", ({ planId }: { planId: string }) => {
    const cb = ctx.planQACallbacks.get(planId);
    if (cb) cb(null);
  });

  // ── Plan generation (called after Q&A completes) ──────────────────────

  function generatePlanFromGoal(planId: string, enrichedGoal: string) {
    const planSessionId = "plan-gen-" + planId;
    provider.createSession(planSessionId, {
      skipPermissions: true,
      systemPrompt: "You are a software planning assistant. Output ONLY valid JSON arrays — no markdown, no commentary.",
      useRawSystemPrompt: true,
    });

    const prompt = `You are helping plan a multi-step development task for a software project.

Goal: ${sanitizePromptInput(enrichedGoal, 8000)}

Generate a detailed step-by-step plan. Return ONLY a JSON array of steps:
[
  { "summary": "brief one-line summary", "details": "detailed explanation", "depends_on": [] },
  ...
]

The "depends_on" array contains 1-based step numbers that must complete before this step can start.
Most steps should depend on the previous step (sequential). Only mark steps as independent
(empty depends_on) if they can truly run in parallel with no shared state.

Be specific. Each step should be atomic and independently executable. Max 50 steps. Return only the JSON array.`;

    let lastOutput = "";

    provider.onOutput(planSessionId, async (parsed) => {
      if (parsed.type === "text" && parsed.content) {
        lastOutput = parsed.content;
        socket.emit("claude:plan_progress", { planId, content: lastOutput });
      } else if (parsed.type === "streaming" && parsed.content) {
        lastOutput = parsed.content;
        socket.emit("claude:plan_progress", { planId, content: lastOutput });
      }
      if (parsed.type === "done") {
        provider.offOutput(planSessionId);
        provider.closeSession(planSessionId);
        try {
          const cleaned = lastOutput
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/, "")
            .trim();
          const steps: { summary: string; details?: string; depends_on?: number[] }[] = JSON.parse(cleaned);
          const cappedSteps = steps.slice(0, 50);
          await updatePlanStatus(planId, "reviewing");

          const createdSteps: ClaudePlanStep[] = [];
          for (let i = 0; i < cappedSteps.length; i++) {
            const created = await addPlanStep(planId, {
              step_order: i + 1,
              summary: cappedSteps[i].summary,
              details: cappedSteps[i].details,
            });
            createdSteps.push(created);
          }

          for (let i = 0; i < cappedSteps.length; i++) {
            const deps = cappedSteps[i].depends_on;
            if (Array.isArray(deps) && deps.length > 0) {
              const resolvedIds = deps
                .filter((idx: number) => idx >= 1 && idx <= createdSteps.length && idx !== i + 1)
                .map((idx: number) => createdSteps[idx - 1].id);
              if (resolvedIds.length > 0) {
                await updatePlanStep(createdSteps[i].id, {
                  depends_on: JSON.stringify(resolvedIds),
                });
              }
            }
          }

          const fullPlan = await getPlan(planId);
          socket.emit("claude:plan_generated", { plan: fullPlan });
        } catch {
          await updatePlanStatus(planId, "failed");
          socket.emit("claude:error", { message: "Failed to parse plan steps from Claude response" });
        }
      }
      if (parsed.type === "error") {
        provider.offOutput(planSessionId);
        provider.closeSession(planSessionId);
        await updatePlanStatus(planId, "failed");
        socket.emit("claude:error", { message: parsed.message ?? "Claude error during plan generation" });
      }
    });

    provider.sendMessage(planSessionId, prompt);
  }

  // ── Plan listing ──────────────────────────────────────────────────────

  socket.on("claude:list_plans", async ({ sessionId }: { sessionId?: string }) => {
    try {
      const plans = await listPlansForUser(email);
      const plansWithSteps = await Promise.all(
        plans.map(async (p) => {
          const steps = await getPlanSteps(p.id);
          return { ...p, steps };
        }),
      );
      socket.emit("claude:plans", { sessionId: sessionId ?? "", plans: plansWithSteps });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Step approval / rejection / reorder / edit ────────────────────────

  socket.on(
    "claude:approve_step",
    async ({ stepId, planId }: { stepId: string; planId: string }) => {
      try {
        const existingPlan = await getPlan(planId);
        if (!existingPlan || (existingPlan.created_by !== email && !await isUserAdmin(email))) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
        await updatePlanStep(stepId, { status: "approved", approved_by: email });
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:reject_step",
    async ({ stepId, planId }: { stepId: string; planId: string }) => {
      try {
        const existingPlan = await getPlan(planId);
        if (!existingPlan || (existingPlan.created_by !== email && !await isUserAdmin(email))) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
        await updatePlanStep(stepId, { status: "rejected" });
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on("claude:approve_all_steps", async ({ planId }: { planId: string }) => {
    try {
      const steps = await getPlanSteps(planId);
      for (const step of steps) {
        if (step.status === "pending") {
          await updatePlanStep(step.id, { status: "approved", approved_by: email });
        }
      }
      const plan = await getPlan(planId);
      socket.emit("claude:plan_updated", { plan });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on("claude:reject_all_steps", async ({ planId }: { planId: string }) => {
    try {
      const steps = await getPlanSteps(planId);
      for (const step of steps) {
        if (step.status === "pending") {
          await updatePlanStep(step.id, { status: "rejected" });
        }
      }
      const plan = await getPlan(planId);
      socket.emit("claude:plan_updated", { plan });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  socket.on(
    "claude:reorder_step",
    async ({ stepId, planId, newOrder }: { stepId: string; planId: string; newOrder: number }) => {
      try {
        await updatePlanStep(stepId, { step_order: newOrder });
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  socket.on(
    "claude:edit_step",
    async ({ stepId, planId, summary, details }: { stepId: string; planId: string; summary: string; details: string }) => {
      try {
        await updatePlanStep(stepId, { summary, details });
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  // ── Plan execution (via controller) ───────────────────────────────────

  socket.on("claude:execute_plan", async ({ planId }: { planId: string }) => {
    try {
      // Guard against duplicate execution
      if (ctx.activePlanControllers?.has(planId)) {
        socket.emit("claude:error", { message: "Plan is already executing" });
        return;
      }

      const plan = await getPlan(planId);
      if (!plan) {
        socket.emit("claude:error", { message: "Plan not found" });
        return;
      }
      if (plan.created_by !== email && !await isUserAdmin(email)) {
        socket.emit("claude:error", { message: "Access denied" });
        return;
      }

      await logActivity("plan_executed", email, { planId });

      let controller: PlanExecutionController;

      if (plan.status === "paused") {
        // Resume from persisted pause
        controller = await PlanExecutionController.fromPausedPlan(planId, email);
      } else {
        const approvedSteps = (plan.steps ?? []).filter((s) => s.status === "approved");
        if (approvedSteps.length === 0) {
          socket.emit("claude:error", { message: "No approved steps to execute" });
          return;
        }
        controller = new PlanExecutionController(planId, email);
      }

      ctx.activePlanControllers ??= new Map();
      ctx.activePlanControllers.set(planId, controller);

      // Fire and forget — the controller manages its own lifecycle
      controller.execute(ctx).finally(() => {
        ctx.activePlanControllers?.delete(planId);
      });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Pause / Resume ────────────────────────────────────────────────────

  socket.on("claude:pause_plan", ({ planId }: { planId: string }) => {
    const controller = ctx.activePlanControllers?.get(planId);
    if (controller) {
      controller.requestPause();
    }
  });

  socket.on("claude:resume_plan", async ({ planId }: { planId: string }) => {
    // Check for manual pause first
    const controller = ctx.activePlanControllers?.get(planId);
    if (controller && controller.getState() === "paused") {
      controller.resume();
      return;
    }

    // Check for error-pause (existing behavior)
    if (controller && controller.getState() === "error_paused") {
      controller.resolveErrorPause("retry");
      return;
    }

    // No active controller — try to resume from DB-persisted pause
    const plan = await getPlan(planId);
    if (plan?.status === "paused") {
      const newController = await PlanExecutionController.fromPausedPlan(planId, email);
      ctx.activePlanControllers ??= new Map();
      ctx.activePlanControllers.set(planId, newController);
      newController.execute(ctx).finally(() => {
        ctx.activePlanControllers?.delete(planId);
      });
      return;
    }

    // Legacy: check planResumeCallbacks for backward compat
    const cb = ctx.planResumeCallbacks.get(planId);
    if (cb) cb("retry");
  });

  socket.on("claude:skip_step", ({ planId }: { planId: string }) => {
    const controller = ctx.activePlanControllers?.get(planId);
    if (controller && controller.getState() === "error_paused") {
      controller.resolveErrorPause("skip");
      return;
    }
    const cb = ctx.planResumeCallbacks.get(planId);
    if (cb) cb("skip");
  });

  socket.on("claude:rollback_stop", async ({ planId }: { planId: string }) => {
    try {
      if (!isValidPlanId(planId)) {
        socket.emit("claude:error", { message: "Invalid plan ID" });
        return;
      }
      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      execFileSync("git", ["checkout", "--", "."], { cwd: projectRoot, stdio: "pipe" });
      try {
        execFileSync("git", ["reset", "--mixed", `plan-checkpoint-${planId}`], { cwd: projectRoot, stdio: "pipe" });
      } catch { /* no commits to reset */ }
      try {
        execFileSync("git", ["tag", "-d", `plan-checkpoint-${planId}`], { cwd: projectRoot, stdio: "pipe" });
      } catch { /* tag already deleted */ }

      const plan = await getPlan(planId);
      for (const step of plan?.steps ?? []) {
        if (["executing", "completed", "failed"].includes(step.status)) {
          await updatePlanStep(step.id, { status: "rolled_back" });
        }
      }

      const controller = ctx.activePlanControllers?.get(planId);
      if (controller) {
        controller.resolveErrorPause("cancel");
      } else {
        const cb = ctx.planResumeCallbacks.get(planId);
        if (cb) cb("cancel");
      }
    } catch (err) {
      socket.emit("claude:error", { message: `Rollback failed: ${err}` });
    }
  });

  socket.on("claude:rollback_continue", async ({ planId }: { planId: string }) => {
    try {
      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      execFileSync("git", ["checkout", "--", "."], { cwd: projectRoot, stdio: "pipe" });

      const controller = ctx.activePlanControllers?.get(planId);
      if (controller) {
        controller.resolveErrorPause("skip");
      } else {
        const cb = ctx.planResumeCallbacks.get(planId);
        if (cb) cb("skip");
      }
    } catch (err) {
      socket.emit("claude:error", { message: `Rollback failed: ${err}` });
    }
  });

  socket.on("claude:cancel_plan", async ({ planId }: { planId: string }) => {
    try {
      const controller = ctx.activePlanControllers?.get(planId);
      if (controller) {
        controller.interrupt(provider, ctx);
        // Let the controller's execute() clean up
        return;
      }

      // No controller — direct cancel (plan might be paused in DB)
      const activeSessionIds = ctx.activePlanSessions?.get(planId);
      if (activeSessionIds) {
        for (const sid of activeSessionIds) {
          provider.interrupt(sid);
          provider.closeSession(sid);
        }
        ctx.activePlanSessions?.delete(planId);
      }

      const cb = ctx.planResumeCallbacks.get(planId);
      if (cb) {
        cb("cancel");
      } else {
        await updatePlanStatus(planId, "cancelled");
        const plan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan });
      }
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Hot-add step during execution ─────────────────────────────────────

  socket.on(
    "claude:add_plan_step",
    async ({ planId, summary, details, afterStepOrder }: {
      planId: string; summary: string; details?: string; afterStepOrder: number;
    }) => {
      try {
        const plan = await getPlan(planId);
        if (!plan || (plan.created_by !== email && !await isUserAdmin(email))) {
          socket.emit("claude:error", { message: "Access denied" });
          return;
        }
        if (!["executing", "paused", "reviewing"].includes(plan.status)) {
          socket.emit("claude:error", { message: "Can only add steps to executing, paused, or reviewing plans" });
          return;
        }
        if (!summary?.trim()) {
          socket.emit("claude:error", { message: "Step summary is required" });
          return;
        }

        const steps = plan.steps ?? [];

        // Clamp: cannot insert before/at executing or completed steps
        const minSafeOrder = Math.max(
          0,
          ...steps
            .filter((s) => ["executing", "completed"].includes(s.status))
            .map((s) => s.step_order),
        );
        const targetOrder = Math.max(afterStepOrder + 1, minSafeOrder + 1);

        // Atomic: shift + insert in a single transaction to prevent TOCTOU
        await dbTransaction(async ({ run }) => {
          await run(
            "UPDATE plan_steps SET step_order = step_order + 1 WHERE plan_id = ? AND step_order >= ?",
            [planId, targetOrder],
          );
        });

        // Insert the new step as auto-approved
        const newStep = await addPlanStep(planId, {
          step_order: targetOrder,
          summary: summary.trim(),
          details: details?.trim(),
        });
        await updatePlanStep(newStep.id, { status: "approved", approved_by: email });

        // Set depends_on to the step at afterStepOrder (if it exists)
        if (afterStepOrder > 0) {
          const prevStep = steps.find((s) => s.step_order === afterStepOrder);
          if (prevStep) {
            await updatePlanStep(newStep.id, { depends_on: JSON.stringify([prevStep.id]) });
          }
        }

        const updatedPlan = await getPlan(planId);
        socket.emit("claude:plan_updated", { plan: updatedPlan });
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  // ── Refine plan ───────────────────────────────────────────────────────

  socket.on(
    "claude:refine_plan",
    async ({ planId, instruction }: { planId: string; instruction: string }) => {
      try {
        const existingPlan = await getPlan(planId);
        if (!existingPlan) {
          socket.emit("claude:error", { message: "Plan not found" });
          return;
        }

        const existingSteps = existingPlan.steps ?? [];
        const numberedSteps = existingSteps
          .map((s, i) => `${i + 1}. ${s.summary}${s.details ? ` — ${s.details}` : ""}`)
          .join("\n");

        await updatePlanStatus(planId, "drafting");

        const refineSessionId = `plan-refine-${planId}-${Date.now()}`;
        provider.createSession(refineSessionId, {
          skipPermissions: true,
          systemPrompt: "You are a software planning assistant. Output ONLY valid JSON arrays — no markdown, no commentary.",
          useRawSystemPrompt: true,
        });

        const prompt = `You are helping refine a multi-step development plan.

Here is an existing plan for: ${sanitizePromptInput(existingPlan.goal)}

Current steps:
${numberedSteps}

User instruction: ${sanitizePromptInput(instruction)}

Generate an updated plan incorporating the user's instruction. Return ONLY a JSON array of steps:
[
  { "summary": "brief one-line summary", "details": "detailed explanation of what will be done" },
  ...
]

Be specific. Each step should be atomic and independently executable. Return only the JSON array.`;

        let lastOutput = "";

        provider.onOutput(refineSessionId, async (parsed) => {
          if (parsed.type === "text" && parsed.content) {
            lastOutput = parsed.content;
            socket.emit("claude:plan_progress", { planId, content: lastOutput });
          } else if (parsed.type === "streaming" && parsed.content) {
            lastOutput = parsed.content;
            socket.emit("claude:plan_progress", { planId, content: lastOutput });
          }
          if (parsed.type === "done") {
            provider.offOutput(refineSessionId);
            provider.closeSession(refineSessionId);
            try {
              const cleaned = lastOutput
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```\s*$/, "")
                .trim();
              const steps: { summary: string; details?: string }[] = JSON.parse(cleaned);
              const cappedSteps = steps.slice(0, 50);
              await deletePlanSteps(planId);
              for (let i = 0; i < cappedSteps.length; i++) {
                await addPlanStep(planId, {
                  step_order: i + 1,
                  summary: cappedSteps[i].summary,
                  details: cappedSteps[i].details,
                });
              }
              await updatePlanStatus(planId, "reviewing");
              const fullPlan = await getPlan(planId);
              socket.emit("claude:plan_generated", { plan: fullPlan });
            } catch {
              await updatePlanStatus(planId, "failed");
              socket.emit("claude:error", { message: "Failed to parse refined plan from Claude response" });
            }
          }
          if (parsed.type === "error") {
            provider.offOutput(refineSessionId);
            provider.closeSession(refineSessionId);
            await updatePlanStatus(planId, "failed");
            socket.emit("claude:error", { message: parsed.message ?? "Claude error during plan refinement" });
          }
        });

        provider.sendMessage(refineSessionId, prompt);
      } catch (err) {
        socket.emit("claude:error", { message: String(err) });
      }
    },
  );

  // ── Delete plan ───────────────────────────────────────────────────────

  socket.on("claude:delete_plan", async ({ planId }: { planId: string }) => {
    try {
      const existingPlan = await getPlan(planId);
      if (!existingPlan || (existingPlan.created_by !== email && !await isUserAdmin(email))) {
        socket.emit("claude:error", { message: "Access denied" });
        return;
      }
      await deletePlan(planId);
      socket.emit("claude:plan_deleted", { planId });
    } catch (err) {
      socket.emit("claude:error", { message: String(err) });
    }
  });

  // ── Disconnect cleanup ────────────────────────────────────────────────

  socket.on("disconnect", () => {
    // Clean up active plan step sessions
    if (ctx.activePlanSessions) {
      for (const [, sessions] of ctx.activePlanSessions) {
        for (const sid of sessions) {
          provider.interrupt(sid);
          provider.closeSession(sid);
        }
      }
      ctx.activePlanSessions.clear();
    }

    // Signal all controllers owned by this user
    if (ctx.activePlanControllers) {
      for (const [planId, controller] of ctx.activePlanControllers) {
        if (planOwners.get(planId) === email) {
          // markDisconnected() unblocks pending waits — for paused plans,
          // the DB status remains "paused" so the user can reconnect and resume.
          controller.markDisconnected();
        }
      }
    }

    // Cancel plans waiting for user action via legacy callbacks
    for (const [planId, cb] of ctx.planResumeCallbacks) {
      if (planOwners.get(planId) === email) {
        cb("cancel");
      }
    }

    // Clean up Q&A callbacks
    for (const [, cb] of ctx.planQACallbacks) {
      cb(null);
    }
    ctx.planQACallbacks.clear();

    // Clean up agent builder sessions
    for (const [builderId, providerSessionId] of builderSessions) {
      try {
        provider.offOutput(providerSessionId);
        provider.closeSession(providerSessionId);
      } catch { /* ignore cleanup errors */ }
      builderSessions.delete(builderId);
    }
  });
}

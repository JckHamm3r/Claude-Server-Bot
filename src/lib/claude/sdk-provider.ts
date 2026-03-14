import { EventEmitter } from "events";
import type { ClaudeCodeProvider, ParsedOutput, TokenUsage } from "./provider";

// ── Types ────────────────────────────────────────────────────────────────────

interface PermissionResolver {
  resolve: (result: { behavior: "allow" | "deny"; message?: string }) => void;
}

interface SDKSessionState {
  emitter: EventEmitter;
  running: boolean;
  model?: string;
  systemPrompt?: string;
  skipPermissions: boolean;
  claudeSessionId: string | null;
  lastActivity: number;
  firstMessage: boolean;
  allowedTools: Set<string>;
  pendingPermission: PermissionResolver | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeQuery: any | null;
  toolCallCounter: number;
}

const sessions = new Map<string, SDKSessionState>();

// ── Session GC ───────────────────────────────────────────────────────────────

const SDK_GC_INTERVAL = 5 * 60 * 1000;
const SDK_IDLE_THRESHOLD = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of sessions) {
    if (!state.running && (now - state.lastActivity) > SDK_IDLE_THRESHOLD) {
      state.emitter.removeAllListeners();
      if (state.activeQuery) {
        try { state.activeQuery.close(); } catch { /* ignore */ }
      }
      sessions.delete(id);
    }
  }
}, SDK_GC_INTERVAL).unref();

// ── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreate(sessionId: string): SDKSessionState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      emitter: new EventEmitter(),
      running: false,
      skipPermissions: false,
      claudeSessionId: null,
      lastActivity: Date.now(),
      firstMessage: true,
      allowedTools: new Set(),
      pendingPermission: null,
      activeQuery: null,
      toolCallCounter: 0,
    });
  }
  const state = sessions.get(sessionId)!;
  state.lastActivity = Date.now();
  return state;
}

function getApiKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = (require("../db") as { default: import("better-sqlite3").Database }).default;
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'anthropic_api_key'").get() as { value: string } | undefined;
    if (row?.value) return row.value;
  } catch { /* fallback to env */ }
  return process.env.ANTHROPIC_API_KEY ?? "";
}

function classifySDKError(err: unknown): { message: string; retryable: boolean } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return { message: "Rate limited by Claude API. Please wait a moment and try again.", retryable: true };
  }
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("econnreset") || lower.includes("etimedout") || lower.includes("fetch failed")) {
    return { message: "Network error communicating with Claude API. Check your connection.", retryable: true };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("authentication") || lower.includes("invalid api key") || lower.includes("invalid x-api-key")) {
    return { message: "Authentication error. Check your API key.", retryable: false };
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist") || lower.includes("not available"))) {
    return { message: "The requested model is not available. Try a different model.", retryable: false };
  }

  return { message: msg, retryable: false };
}

// ── Core SDK runner ──────────────────────────────────────────────────────────

async function runSDK(
  state: SDKSessionState,
  message: string,
  inputFiles: string[] = [],
): Promise<void> {
  if (state.running) return;
  state.running = true;
  state.lastActivity = Date.now();

  const apiKey = getApiKey();
  if (!apiKey) {
    state.running = false;
    state.emitter.emit("output", {
      type: "error",
      message: "No API key configured. Set ANTHROPIC_API_KEY or add one in Settings.",
    } as ParsedOutput);
    state.emitter.emit("output", { type: "done" } as ParsedOutput);
    return;
  }

  // Ensure API key is in env for the SDK subprocess
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  }

  // Dynamic import of ESM SDK
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryFn: (params: { prompt: string; options?: any }) => any;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    queryFn = sdk.query;
  } catch {
    state.running = false;
    state.emitter.emit("output", {
      type: "error",
      message: "Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk",
    } as ParsedOutput);
    state.emitter.emit("output", { type: "done" } as ParsedOutput);
    return;
  }

  // Build prompt with optional file references
  let fullPrompt = message;
  if (inputFiles.length > 0) {
    const fileList = inputFiles.map(f => `[Attached file: ${f}]`).join("\n");
    fullPrompt = fileList + "\n\n" + message;
  }

  // Build SDK options
  const allowedToolsList = Array.from(state.allowedTools);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: Record<string, any> = {
    model: state.model,
    maxTurns: 30,
    includePartialMessages: true,
    cwd: process.env.CLAUDE_PROJECT_ROOT ?? process.cwd(),
  };

  // System prompt: use SDK's systemPrompt option (not prepended to message)
  if (state.systemPrompt && state.firstMessage) {
    options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: state.systemPrompt,
    };
  }
  state.firstMessage = false;

  // Session resume
  if (state.claudeSessionId) {
    options.resume = state.claudeSessionId;
  }

  // Permission handling
  if (state.skipPermissions) {
    options.permissionMode = "bypassPermissions";
    options.allowDangerouslySkipPermissions = true;
  } else {
    options.permissionMode = "default";
    if (allowedToolsList.length > 0) {
      options.allowedTools = allowedToolsList;
    }

    // canUseTool callback: emit permission_request and wait for user response
    options.canUseTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      callOpts: { signal: AbortSignal; toolUseID: string },
    ) => {
      // If tool is already allowed for this session, permit it
      if (state.allowedTools.has(toolName)) {
        return { behavior: "allow" as const };
      }

      // Emit permission request and wait for user response
      state.emitter.emit("output", {
        type: "permission_request",
        toolName,
        toolInput,
        toolCallId: callOpts.toolUseID,
      } as ParsedOutput);

      // Create a Promise that resolves when allowTool/denyPermission is called
      return new Promise<{ behavior: "allow" | "deny"; message?: string }>((resolve) => {
        state.pendingPermission = { resolve };

        // If the query is aborted while waiting, deny
        const onAbort = () => {
          state.pendingPermission = null;
          resolve({ behavior: "deny", message: "Request interrupted" });
        };
        callOpts.signal.addEventListener("abort", onAbort, { once: true });
      });
    };
  }

  // Don't persist sessions to disk on the server — we manage state ourselves
  options.persistSession = false;

  // Suppress loading of filesystem settings from the server's home dir
  options.settingSources = [];

  // Environment: pass API key and identify ourselves
  options.env = {
    ...process.env,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_AGENT_SDK_CLIENT_APP: "claude-code-server-bot/1.0",
  };
  // Strip CLAUDECODE to avoid subprocess detection issues
  delete options.env.CLAUDECODE;

  let accumulatedText = "";
  let lastStreamedText = "";

  try {
    const queryInstance = queryFn({ prompt: fullPrompt, options });
    state.activeQuery = queryInstance;

    for await (const msg of queryInstance) {
      state.lastActivity = Date.now();
      const msgType = (msg as { type: string }).type;

      // ── System init: capture session ID ──
      if (msgType === "system") {
        const sysMsg = msg as { type: "system"; subtype: string; session_id?: string; model?: string };
        if (sysMsg.subtype === "init" && sysMsg.session_id) {
          state.claudeSessionId = sysMsg.session_id;
          state.emitter.emit("output", {
            type: "session_id",
            claudeSessionId: sysMsg.session_id,
          } as ParsedOutput);
        }
        continue;
      }

      // ── Streaming partial messages ──
      if (msgType === "stream_event") {
        const streamMsg = msg as {
          type: "stream_event";
          event: {
            type: string;
            index?: number;
            content_block?: { type: string; name?: string; id?: string };
            delta?: { type: string; text?: string; partial_json?: string };
          };
        };
        const event = streamMsg.event;

        // Text streaming
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          accumulatedText += event.delta.text;
          state.emitter.emit("output", {
            type: "streaming",
            content: accumulatedText,
          } as ParsedOutput);
          lastStreamedText = accumulatedText;
        }

        // Tool use start
        if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
          const callId = event.content_block.id ?? `tool_${++state.toolCallCounter}`;
          state.emitter.emit("output", {
            type: "tool_call",
            toolCallId: callId,
            toolName: event.content_block.name,
            toolInput: {},
            toolStatus: "running",
          } as ParsedOutput);

          state.emitter.emit("output", {
            type: "progress",
            message: `Using ${event.content_block.name}`,
            toolName: event.content_block.name,
          } as ParsedOutput);
        }
        continue;
      }

      // ── Full assistant message (non-streaming) ──
      if (msgType === "assistant") {
        const assistantMsg = msg as {
          type: "assistant";
          message: {
            content?: { type: string; text?: string; name?: string; input?: unknown; id?: string }[];
            stop_reason?: string | null;
            usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
          };
          error?: string;
          session_id: string;
        };

        if (!state.claudeSessionId && assistantMsg.session_id) {
          state.claudeSessionId = assistantMsg.session_id;
          state.emitter.emit("output", {
            type: "session_id",
            claudeSessionId: assistantMsg.session_id,
          } as ParsedOutput);
        }

        // Handle error on assistant message (rate limit, auth, etc.)
        if (assistantMsg.error) {
          const classified = classifySDKError(assistantMsg.error);
          state.emitter.emit("output", {
            type: "error",
            message: classified.message,
            retryable: classified.retryable,
          } as ParsedOutput);
        }

        const isFinal = assistantMsg.message?.stop_reason != null;

        for (const block of assistantMsg.message?.content ?? []) {
          if (block.type === "text" && block.text) {
            accumulatedText = block.text;
            state.emitter.emit("output", {
              type: isFinal ? "text" : "streaming",
              content: block.text,
            } as ParsedOutput);
            lastStreamedText = block.text;
          }
          if (block.type === "tool_use" && block.name) {
            const callId = block.id ?? `tool_${++state.toolCallCounter}`;
            state.emitter.emit("output", {
              type: "tool_call",
              toolCallId: callId,
              toolName: block.name,
              toolInput: block.input,
              toolStatus: "running",
            } as ParsedOutput);
            state.emitter.emit("output", {
              type: "progress",
              message: `Using ${block.name}`,
              toolName: block.name,
              toolInput: block.input,
            } as ParsedOutput);
          }
        }
        continue;
      }

      // ── Tool progress ──
      if (msgType === "tool_progress") {
        const toolMsg = msg as { type: "tool_progress"; tool_use_id: string; tool_name: string };
        state.emitter.emit("output", {
          type: "progress",
          message: `Using ${toolMsg.tool_name}`,
          toolName: toolMsg.tool_name,
        } as ParsedOutput);
        continue;
      }

      // ── Result message ──
      if (msgType === "result") {
        const resultMsg = msg as {
          type: "result";
          subtype: string;
          result?: string;
          usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
          total_cost_usd?: number;
          session_id: string;
          permission_denials?: { tool_name: string; tool_use_id: string; tool_input: Record<string, unknown> }[];
          errors?: string[];
        };

        if (!state.claudeSessionId && resultMsg.session_id) {
          state.claudeSessionId = resultMsg.session_id;
          state.emitter.emit("output", {
            type: "session_id",
            claudeSessionId: resultMsg.session_id,
          } as ParsedOutput);
        }

        // Emit final text if result provides it and differs from streamed
        if (resultMsg.result && resultMsg.result !== lastStreamedText) {
          state.emitter.emit("output", {
            type: "text",
            content: resultMsg.result,
          } as ParsedOutput);
        }

        // Emit usage
        if (resultMsg.usage) {
          const usage: TokenUsage = {
            input_tokens: resultMsg.usage.input_tokens,
            output_tokens: resultMsg.usage.output_tokens,
            cache_creation_input_tokens: resultMsg.usage.cache_creation_input_tokens,
            cache_read_input_tokens: resultMsg.usage.cache_read_input_tokens,
          };
          if (resultMsg.total_cost_usd !== undefined) {
            usage.cost_usd = resultMsg.total_cost_usd;
          }
          state.emitter.emit("output", { type: "usage", usage } as ParsedOutput);
        }

        // Handle errors in result
        if (resultMsg.subtype !== "success" && resultMsg.errors?.length) {
          for (const errMsg of resultMsg.errors) {
            const classified = classifySDKError(errMsg);
            state.emitter.emit("output", {
              type: "error",
              message: classified.message,
              retryable: classified.retryable,
            } as ParsedOutput);
          }
        }
        continue;
      }

      // ── Rate limit event ──
      if (msgType === "rate_limit_event") {
        const rlMsg = msg as { type: "rate_limit_event"; rate_limit_info: { status: string; resetsAt?: number } };
        if (rlMsg.rate_limit_info.status === "rejected") {
          state.emitter.emit("output", {
            type: "error",
            message: "Rate limited by Claude API. Please wait and try again.",
            retryable: true,
          } as ParsedOutput);
        }
        continue;
      }

      // Other message types (auth_status, compact_boundary, etc.) are ignored
    }
  } catch (err) {
    // AbortError means the user interrupted — not a real error
    if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
      // Interrupted — don't emit error
    } else {
      const classified = classifySDKError(err);
      state.emitter.emit("output", {
        type: "error",
        message: `SDK error: ${classified.message}`,
        retryable: classified.retryable,
      } as ParsedOutput);
    }
  } finally {
    state.running = false;
    state.activeQuery = null;
    state.pendingPermission = null;
    state.lastActivity = Date.now();
    state.emitter.emit("output", { type: "done" } as ParsedOutput);
  }
}

// ── Provider export ──────────────────────────────────────────────────────────

export const sdkProvider: ClaudeCodeProvider = {
  createSession(sessionId, opts = {}) {
    const state = getOrCreate(sessionId);
    state.skipPermissions = opts.skipPermissions ?? false;
    if (opts.systemPrompt) state.systemPrompt = opts.systemPrompt;
    if (opts.model) state.model = opts.model;
    if (opts.claudeSessionId && !state.claudeSessionId) {
      state.claudeSessionId = opts.claudeSessionId;
    }
  },

  sendMessage(sessionId, message, opts) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.lastActivity = Date.now();
    const skipPermissions = opts?.skipPermissions ?? state.skipPermissions;
    if (opts?.model) state.model = opts.model;
    if (skipPermissions !== state.skipPermissions) {
      state.skipPermissions = skipPermissions;
    }
    runSDK(state, message, opts?.inputFiles ?? []).catch(err => {
      console.error("SDK error:", err);
      state.emitter.emit("output", { type: "error", message: String(err) } as ParsedOutput);
      state.emitter.emit("output", { type: "done" } as ParsedOutput);
    });
  },

  allowTool(sessionId, toolName, scope) {
    const state = sessions.get(sessionId);
    if (!state) return;

    if (scope === "session") {
      state.allowedTools.add(toolName);
    }

    // Resolve the pending permission promise
    if (state.pendingPermission) {
      state.pendingPermission.resolve({ behavior: "allow" });
      state.pendingPermission = null;
    }
  },

  denyPermission(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;

    if (state.pendingPermission) {
      state.pendingPermission.resolve({ behavior: "deny", message: "Permission denied by user" });
      state.pendingPermission = null;
    }
  },

  interrupt(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.running = false;

    // Resolve any pending permission to unblock the canUseTool callback
    if (state.pendingPermission) {
      state.pendingPermission.resolve({ behavior: "deny", message: "Interrupted" });
      state.pendingPermission = null;
    }

    // Close the active query (kills the SDK subprocess)
    if (state.activeQuery) {
      try { state.activeQuery.close(); } catch { /* ignore */ }
      state.activeQuery = null;
    }
  },

  closeSession(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;

    if (state.pendingPermission) {
      state.pendingPermission.resolve({ behavior: "deny", message: "Session closed" });
      state.pendingPermission = null;
    }
    if (state.activeQuery) {
      try { state.activeQuery.close(); } catch { /* ignore */ }
    }
    state.emitter.removeAllListeners();
    sessions.delete(sessionId);
  },

  suspendSession(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;

    if (state.pendingPermission) {
      state.pendingPermission.resolve({ behavior: "deny", message: "Session suspended" });
      state.pendingPermission = null;
    }
    if (state.activeQuery) {
      try { state.activeQuery.close(); } catch { /* ignore */ }
      state.activeQuery = null;
    }
    state.running = false;
    state.emitter.removeAllListeners("output");
  },

  onOutput(sessionId, cb) {
    const state = getOrCreate(sessionId);
    state.emitter.removeAllListeners("output");
    state.emitter.on("output", cb);
  },

  offOutput(sessionId) {
    const state = sessions.get(sessionId);
    if (state) state.emitter.removeAllListeners("output");
  },

  isRunning(sessionId) {
    return sessions.get(sessionId)?.running ?? false;
  },

  getClaudeSessionId(sessionId) {
    return sessions.get(sessionId)?.claudeSessionId ?? null;
  },
};

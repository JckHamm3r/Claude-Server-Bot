import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
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
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, SDKSessionState>();

const SDK_TIMEOUT_MS = parseInt(process.env.CLAUDE_SDK_TIMEOUT_MS ?? "600000", 10); // 10 min default
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_SILENCE_THRESHOLD_MS = 8_000;

// ── Session GC ───────────────────────────────────────────────────────────────

const SDK_GC_INTERVAL = 5 * 60 * 1000;
const SDK_IDLE_THRESHOLD = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of sessions) {
    if (!state.running && (now - state.lastActivity) > SDK_IDLE_THRESHOLD) {
      clearTimers(state);
      state.emitter.removeAllListeners();
      if (state.activeQuery) {
        try { state.activeQuery.close(); } catch { /* ignore */ }
      }
      sessions.delete(id);
    }
  }
}, SDK_GC_INTERVAL).unref();

// ── Helpers ──────────────────────────────────────────────────────────────────

function clearTimers(state: SDKSessionState): void {
  if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
  if (state.timeoutTimer) { clearTimeout(state.timeoutTimer); state.timeoutTimer = null; }
}

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
      heartbeatTimer: null,
      timeoutTimer: null,
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

// ── Input file handling ─────────────────────────────────────────────────────

const projectRoot = () => process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();

function validateFilePath(filePath: string): boolean {
  if (filePath.startsWith("-")) return false;
  const resolved = path.resolve(filePath);
  const root = path.resolve(projectRoot());
  // Allow paths within project root OR in the data/uploads directory
  const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
  return resolved.startsWith(root + path.sep) || resolved.startsWith(dataDir + path.sep) || resolved === root;
}

function buildPromptWithFiles(message: string, inputFiles: string[]): string {
  if (inputFiles.length === 0) return message;

  const fileParts: string[] = [];
  for (const filePath of inputFiles) {
    if (!validateFilePath(filePath)) {
      fileParts.push(`[Skipped: ${path.basename(filePath)} — path outside allowed directories]`);
      continue;
    }

    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 10 * 1024 * 1024) {
        fileParts.push(`[Skipped: ${path.basename(filePath)} — file too large (${(stats.size / 1024 / 1024).toFixed(1)} MB)]`);
        continue;
      }

      const ext = path.extname(filePath).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext);

      if (isImage) {
        const data = fs.readFileSync(filePath);
        const base64 = data.toString("base64");
        const mimeMap: Record<string, string> = {
          ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        };
        const mime = mimeMap[ext] ?? "application/octet-stream";
        fileParts.push(`[Image: ${path.basename(filePath)}]\ndata:${mime};base64,${base64}`);
      } else {
        const content = fs.readFileSync(filePath, "utf-8");
        fileParts.push(`<file name="${path.basename(filePath)}">\n${content}\n</file>`);
      }
    } catch {
      fileParts.push(`[Error reading: ${path.basename(filePath)}]`);
    }
  }

  return fileParts.join("\n\n") + "\n\n" + message;
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

  // Build prompt with file contents inlined
  const fullPrompt = buildPromptWithFiles(message, inputFiles);

  // Build SDK options
  const allowedToolsList = Array.from(state.allowedTools);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: Record<string, any> = {
    model: state.model,
    maxTurns: 30,
    includePartialMessages: true,
    cwd: projectRoot(),
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

    options.canUseTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      callOpts: { signal: AbortSignal; toolUseID: string },
    ) => {
      if (state.allowedTools.has(toolName)) {
        return { behavior: "allow" as const };
      }

      state.emitter.emit("output", {
        type: "permission_request",
        toolName,
        toolInput,
        toolCallId: callOpts.toolUseID,
      } as ParsedOutput);

      return new Promise<{ behavior: "allow" | "deny"; message?: string }>((resolve) => {
        state.pendingPermission = { resolve };

        const onAbort = () => {
          state.pendingPermission = null;
          resolve({ behavior: "deny", message: "Request interrupted" });
        };
        callOpts.signal.addEventListener("abort", onAbort, { once: true });
      });
    };
  }

  options.persistSession = false;
  options.settingSources = [];

  options.env = {
    ...process.env,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_AGENT_SDK_CLIENT_APP: "claude-code-server-bot/1.0",
  };
  delete options.env.CLAUDECODE;

  let accumulatedText = "";
  let lastStreamedText = "";
  let lastOutputTime = Date.now();

  // Track active tool calls for tool_result emission
  const activeToolCalls = new Map<string, string>(); // toolUseId -> toolName

  // ── Heartbeat: emit progress when output is silent ──
  state.heartbeatTimer = setInterval(() => {
    if (!state.running) return;
    const silenceMs = Date.now() - lastOutputTime;
    if (silenceMs > HEARTBEAT_SILENCE_THRESHOLD_MS) {
      state.emitter.emit("output", {
        type: "progress",
        message: silenceMs > 30_000 ? "Still processing..." : "Processing...",
      } as ParsedOutput);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // ── Timeout: prevent infinite hangs ──
  state.timeoutTimer = setTimeout(() => {
    if (!state.running) return;
    state.emitter.emit("output", {
      type: "error",
      message: `Query timed out after ${SDK_TIMEOUT_MS / 1000}s. You can retry.`,
      retryable: true,
    } as ParsedOutput);
    if (state.activeQuery) {
      try { state.activeQuery.close(); } catch { /* ignore */ }
    }
  }, SDK_TIMEOUT_MS);

  try {
    const queryInstance = queryFn({ prompt: fullPrompt, options });
    state.activeQuery = queryInstance;

    for await (const msg of queryInstance) {
      state.lastActivity = Date.now();
      lastOutputTime = Date.now();
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

        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          accumulatedText += event.delta.text;
          state.emitter.emit("output", {
            type: "streaming",
            content: accumulatedText,
          } as ParsedOutput);
          lastStreamedText = accumulatedText;
        }

        if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
          const callId = event.content_block.id ?? `tool_${++state.toolCallCounter}`;
          const toolName = event.content_block.name ?? "unknown";
          activeToolCalls.set(callId, toolName);

          state.emitter.emit("output", {
            type: "tool_call",
            toolCallId: callId,
            toolName,
            toolInput: {},
            toolStatus: "running",
          } as ParsedOutput);

          state.emitter.emit("output", {
            type: "progress",
            message: `Using ${toolName}`,
            toolName,
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
            activeToolCalls.set(callId, block.name);

            // Intercept AskUserQuestion tool
            if (block.name === "AskUserQuestion") {
              const input = block.input as { question?: string; options?: { label: string; description?: string }[] } | undefined;
              if (input?.question) {
                state.emitter.emit("output", {
                  type: "user_question",
                  toolCallId: callId,
                  toolName: block.name,
                  questions: [{
                    question: input.question,
                    options: input.options ?? [],
                  }],
                } as ParsedOutput);
                continue;
              }
            }

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

      // ── User message with tool results ──
      if (msgType === "user") {
        const userMsg = msg as {
          type: "user";
          message: { content?: unknown };
          parent_tool_use_id: string | null;
          tool_use_result?: unknown;
        };

        // Extract tool results from the message content
        const content = userMsg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const tb = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
            if (tb.type === "tool_result" && tb.tool_use_id) {
              const toolName = activeToolCalls.get(tb.tool_use_id) ?? "unknown";
              let resultText = "";
              if (typeof tb.content === "string") {
                resultText = tb.content;
              } else if (Array.isArray(tb.content)) {
                resultText = (tb.content as { type?: string; text?: string }[])
                  .filter(c => c.type === "text" && c.text)
                  .map(c => c.text)
                  .join("\n");
              }

              state.emitter.emit("output", {
                type: "tool_result",
                toolCallId: tb.tool_use_id,
                toolName,
                toolResult: resultText.slice(0, 5000),
                toolStatus: tb.is_error ? "error" : "done",
              } as ParsedOutput);

              activeToolCalls.delete(tb.tool_use_id);
            }
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
    }
  } catch (err) {
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
    clearTimers(state);
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

    if (state.pendingPermission) {
      state.pendingPermission.resolve({ behavior: "deny", message: "Interrupted" });
      state.pendingPermission = null;
    }

    clearTimers(state);

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
    clearTimers(state);
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
    clearTimers(state);
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

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import type { ClaudeCodeProvider, ParsedOutput, TokenUsage } from "./provider";
import { updateClaudeSessionId, updateSessionContext } from "../claude-db";
import { 
  acquireLock, 
  queueOperation, 
  releaseLock, 
  extractFilePathsFromTool,
  lockEventEmitter 
} from "../file-lock-manager";

// ── Types ────────────────────────────────────────────────────────────────────

interface PermissionResolver {
  resolve: (result: { behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, unknown> }) => void;
  toolInput: Record<string, unknown>;
}

interface QueuedMessage {
  content: string;
  resolve: () => void;
}

interface QueuedOperationResolver {
  resolve: (result: { behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, unknown> }) => void;
  toolInput: Record<string, unknown>;
}

interface SDKSessionState {
  emitter: EventEmitter;
  running: boolean;
  model?: string;
  systemPrompt?: string;
  skipPermissions: boolean;
  claudeSessionId: string | null;
  lastActivity: number;
  lastOutputTime: number;
  allowedTools: Set<string>;
  pendingPermissions: Map<string, PermissionResolver>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeQuery: any | null;
  toolCallCounter: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  messageQueue: QueuedMessage[];
  messageReady: (() => void) | null;
  streamActive: boolean;
  streamEnded: boolean;
  // File lock tracking
  activeLocks: Map<string, string[]>; // toolCallId -> file paths
  queuedOperations: Map<string, QueuedOperationResolver>; // toolCallId -> resolver
  userEmail: string;
  maxTurns: number;
  // Sub-agent delegation
  delegationDepth: number;
  parentSessionId: string | null;
  onSubAgentCost: ((costUsd: number) => void) | null;
  // Group permissions (loaded at session creation)
  groupPermissions?: import("../claude-db").GroupPermissions | null;
}

const sessions = new Map<string, SDKSessionState>();

const SDK_TIMEOUT_MS = parseInt(process.env.CLAUDE_SDK_TIMEOUT_MS ?? "600000", 10);
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_SILENCE_THRESHOLD_MS = 8_000;

// ── Session GC ───────────────────────────────────────────────────────────────

const SDK_GC_INTERVAL = 5 * 60 * 1000;
const SDK_IDLE_THRESHOLD = parseInt(process.env.CLAUDE_SDK_IDLE_MS ?? String(30 * 60 * 1000), 10);
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of sessions) {
    if (!state.running && (now - state.lastActivity) > SDK_IDLE_THRESHOLD) {
      cleanupSession(state);
      sessions.delete(id);
    }
  }
}, SDK_GC_INTERVAL).unref();

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanupSession(state: SDKSessionState): void {
  clearTimers(state);
  endStream(state);
  for (const pending of state.pendingPermissions.values()) {
    pending.resolve({ behavior: "deny", message: "Session cleaned up" });
  }
  state.pendingPermissions.clear();
  if (state.activeQuery) {
    try { state.activeQuery.close(); } catch { /* ignore */ }
    state.activeQuery = null;
  }
  state.emitter.removeAllListeners();
}

function clearTimers(state: SDKSessionState): void {
  if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
  if (state.timeoutTimer) { clearTimeout(state.timeoutTimer); state.timeoutTimer = null; }
}

function endStream(state: SDKSessionState): void {
  state.streamEnded = true;
  if (state.messageReady) {
    state.messageReady();
    state.messageReady = null;
  }
}

function resetTimers(state: SDKSessionState): void {
  // Reset the per-message output timestamp so the heartbeat starts fresh for
  // this message. The heartbeat interval itself is owned by processOutputStream
  // and must NOT be restarted here — doing so would create a second timer that
  // reads a stale, disconnected lastOutputTime and fires spurious progress events.
  state.lastOutputTime = Date.now();

  if (state.timeoutTimer) {
    clearTimeout(state.timeoutTimer);
    state.timeoutTimer = null;
  }

  state.timeoutTimer = setTimeout(() => {
    if (!state.running) return;
    state.emitter.emit("output", {
      type: "error",
      message: `Query timed out after ${SDK_TIMEOUT_MS / 1000}s. You can retry.`,
      retryable: true,
    } as ParsedOutput);
    if (state.activeQuery) {
      try { state.activeQuery.interrupt(); } catch {
        try { state.activeQuery.close(); } catch { /* ignore */ }
      }
    }
  }, SDK_TIMEOUT_MS);
}

function getOrCreate(sessionId: string, userEmail = ""): SDKSessionState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      emitter: new EventEmitter(),
      running: false,
      skipPermissions: false,
      claudeSessionId: null,
      lastActivity: Date.now(),
      lastOutputTime: Date.now(),
      allowedTools: new Set(),
      pendingPermissions: new Map(),
      activeQuery: null,
      toolCallCounter: 0,
      heartbeatTimer: null,
      timeoutTimer: null,
      messageQueue: [],
      messageReady: null,
      streamActive: false,
      streamEnded: false,
      activeLocks: new Map(),
      queuedOperations: new Map(),
      userEmail,
      maxTurns: 30,
      delegationDepth: 0,
      parentSessionId: null,
      onSubAgentCost: null,
    });
  }
  const state = sessions.get(sessionId)!;
  state.lastActivity = Date.now();
  if (userEmail && !state.userEmail) {
    state.userEmail = userEmail;
  }
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

function isStaleResumeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("no conversation found") || lower.includes("conversation not found") || lower.includes("session not found");
}

function classifySDKError(err: unknown): { message: string; retryable: boolean } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (isStaleResumeError(err)) {
    return { message: "Reconnecting to conversation...", retryable: true };
  }
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

// ── Streaming input generator ───────────────────────────────────────────────
// Creates an AsyncGenerator that yields SDKUserMessage objects on demand.
// sendMessage() pushes into the queue; the generator yields when ready.

function createMessageStream(state: SDKSessionState, onBeforeYield?: () => void) {
  async function* generator() {
    while (!state.streamEnded) {
      if (state.messageQueue.length > 0) {
        const queued = state.messageQueue.shift()!;
        onBeforeYield?.();
        yield {
          type: "user" as const,
          message: {
            role: "user" as const,
            content: queued.content,
          },
        };
        queued.resolve();
      } else {
        await new Promise<void>((resolve) => {
          state.messageReady = resolve;
        });
      }
    }
  }
  return generator();
}

function pushMessage(state: SDKSessionState, content: string): Promise<void> {
  return new Promise<void>((resolve) => {
    state.messageQueue.push({ content, resolve });
    if (state.messageReady) {
      state.messageReady();
      state.messageReady = null;
    }
  });
}

// ── Start streaming session ─────────────────────────────────────────────────
// Launches a long-lived query() with the async generator as prompt.
// The output processing loop runs in the background.

async function startStreamingSession(
  state: SDKSessionState,
  sessionId: string,
): Promise<void> {
  if (state.streamActive) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    state.emitter.emit("output", {
      type: "error",
      message: "No API key configured. Set ANTHROPIC_API_KEY or add one in Settings.",
    } as ParsedOutput);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryFn: (params: { prompt: any; options?: any }) => any;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    queryFn = sdk.query;
  } catch {
    state.emitter.emit("output", {
      type: "error",
      message: "Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk",
    } as ParsedOutput);
    return;
  }

  const allowedToolsList = Array.from(state.allowedTools);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: Record<string, any> = {
    model: state.model,
    maxTurns: state.maxTurns,
    includePartialMessages: true,
    cwd: projectRoot(),
    persistSession: false,
    settingSources: [],
  };

  if (state.systemPrompt) {
    options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: state.systemPrompt,
    };
  }

  // Resume from a previous SDK session if available
  if (state.claudeSessionId) {
    options.resume = state.claudeSessionId;
  }

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
      // Auto-allow WebFetch calls to the internal sub-agent delegation endpoint
      // (localhost-only, so no security risk).
      if (toolName === "WebFetch") {
        const url = typeof toolInput.url === "string" ? toolInput.url : "";
        const port = process.env.PORT ?? "3000";
        const nextAuthUrl = process.env.NEXTAUTH_URL ?? "";
        let pathname = "";
        try {
          const parsed = new URL(nextAuthUrl);
          pathname = parsed.pathname.replace(/\/$/, "");
        } catch {
          const pathPrefix = process.env.CLAUDE_BOT_PATH_PREFIX ?? "";
          const slug = process.env.CLAUDE_BOT_SLUG ?? "";
          if (pathPrefix && slug) pathname = `/${pathPrefix}/${slug}`;
        }
        const internalBase = `http://localhost:${port}${pathname}/api/internal/sub-agent`;
        if (url.startsWith(internalBase)) {
          return { behavior: "allow" as const, updatedInput: toolInput };
        }
      }

      // Intercept update_session_context — virtual tool for per-session context journal
      if (toolName === "update_session_context") {
        const input = toolInput as { context?: string };
        if (input.context && sessionId) {
          try {
            updateSessionContext(sessionId, input.context);
          } catch (err) {
            console.error(`[sdk] Failed to update session context for ${sessionId}:`, err);
          }
        }
        return { behavior: "allow" as const, updatedInput: toolInput };
      }

      // File lock check for write operations
      if (["Write", "StrReplace", "Delete", "Bash", "Shell"].includes(toolName)) {
        const filePaths = extractFilePathsFromTool(toolName, toolInput);

        if (filePaths.length > 0) {
          // Try to acquire locks for all files
          const lockResults = await Promise.all(
            filePaths.map((filePath) => acquireLock(sessionId, state.userEmail, toolName, callOpts.toolUseID, filePath))
          );

          // Check if any locks were not acquired
          const failedLocks = lockResults.filter((result) => !result.acquired);

          if (failedLocks.length > 0) {
            // At least one file is locked - queue the entire operation
            const failedLock = failedLocks[0]; // Show info about first failed lock

            // Queue operations for all files
            await Promise.all(
              filePaths.map((filePath) =>
                queueOperation(sessionId, state.userEmail, toolName, callOpts.toolUseID, toolInput, filePath)
              )
            );

            // Emit queue notification to user
            state.emitter.emit("output", {
              type: "file_queued",
              filePath: filePaths[0],
              queuePosition: failedLock.queuePosition,
              lockedBy: failedLock.lockedBy,
              toolCallId: callOpts.toolUseID,
              toolName,
              message: `File operation queued. ${filePaths[0]} is currently being modified by ${failedLock.lockedBy?.userName || "another user"}.`,
            } as ParsedOutput);

            // Wait for lock to be released and operation to execute
            return new Promise((resolve) => {
              state.queuedOperations.set(callOpts.toolUseID, { resolve, toolInput });

              const onAbort = () => {
                state.queuedOperations.delete(callOpts.toolUseID);
                resolve({ behavior: "deny", message: "Operation cancelled while queued" });
              };
              callOpts.signal.addEventListener("abort", onAbort, { once: true });
            });
          }

          // All locks acquired - store for cleanup on completion
          state.activeLocks.set(callOpts.toolUseID, filePaths);
        }
      }

      // Continue with existing permission logic...
      // Apply group-level security checks before asking for user approval
      if (state.groupPermissions && !state.skipPermissions) {
        // Check guard rails with group permissions (directory/filetype restrictions)
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { checkProtectedPath } = require("../security-guard") as {
            checkProtectedPath: (toolName: string, toolInput: unknown, groupPerms?: import("../claude-db").GroupPermissions | null) => { blocked: boolean; reason?: string };
          };
          const pathCheck = checkProtectedPath(toolName, toolInput, state.groupPermissions);
          if (pathCheck.blocked) {
            state.emitter.emit("output", {
              type: "security_warn",
              message: pathCheck.reason ?? "Blocked by group policy",
              warnType: "group_policy",
            } as ParsedOutput);
            return { behavior: "deny" as const, message: pathCheck.reason ?? "Blocked by group policy" };
          }
        } catch { /* ignore security check errors */ }

        // For Bash/Shell tools, check command-level group restrictions
        if ((toolName === "Bash" || toolName === "Shell") && toolInput.command) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { classifyCommand } = require("../command-sandbox") as {
              classifyCommand: (cmd: string, opts?: { skipPermissions?: boolean }, groupAiPerms?: { commands_allowed: string[]; commands_blocked: string[]; shell_access: boolean } | null) => { category: string; reason?: string };
            };
            const classification = classifyCommand(
              String(toolInput.command),
              {},
              state.groupPermissions.ai
            );
            if (classification.category === "blocked" || classification.category === "custom_blocked") {
              state.emitter.emit("output", {
                type: "security_warn",
                message: classification.reason ?? "Command blocked by group policy",
                warnType: "group_policy",
              } as ParsedOutput);
              return { behavior: "deny" as const, message: classification.reason ?? "Command blocked by group policy" };
            }
          } catch { /* ignore */ }
        }
      }

      if (state.allowedTools.has(toolName)) {
        return { behavior: "allow" as const, updatedInput: toolInput };
      }

      state.emitter.emit("output", {
        type: "permission_request",
        toolName,
        toolInput,
        toolCallId: callOpts.toolUseID,
      } as ParsedOutput);

      return new Promise<{ behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, unknown> }>((resolve) => {
        state.pendingPermissions.set(callOpts.toolUseID, { resolve, toolInput });

        const onAbort = () => {
          state.pendingPermissions.delete(callOpts.toolUseID);
          resolve({ behavior: "deny", message: "Request interrupted" });
        };
        callOpts.signal.addEventListener("abort", onAbort, { once: true });
      });
    };
  }

  options.env = {
    ...process.env,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_AGENT_SDK_CLIENT_APP: "claude-code-server-bot/1.0",
  };
  delete options.env.CLAUDECODE;

  state.streamActive = true;
  state.streamEnded = false;
  state.messageQueue = [];
  state.messageReady = null;

  // Set up listener for queued operations becoming ready
  const queueExecutingHandler = (event: {
    queueId: string;
    sessionId: string;
    toolCallId: string;
    toolInput: Record<string, unknown>;
  }) => {
    if (event.sessionId === sessionId && state.queuedOperations.has(event.toolCallId)) {
      const queued = state.queuedOperations.get(event.toolCallId);
      if (queued) {
        state.queuedOperations.delete(event.toolCallId);
        // Resolve with allow so the tool executes
        queued.resolve({ behavior: "allow", updatedInput: event.toolInput });
      }
    }
  };
  lockEventEmitter.on("queue_executing", queueExecutingHandler);

  // Start output processing in background
  processOutputStream(state, queryFn, options, sessionId).catch((err) => {
    console.error(`[sdk] Stream processing error for session ${sessionId}:`, err);
    state.emitter.emit("output", { type: "error", message: String(err) } as ParsedOutput);
    state.emitter.emit("output", { type: "done" } as ParsedOutput);
  }).finally(() => {
    lockEventEmitter.off("queue_executing", queueExecutingHandler);
  });
}

// ── Tool result sanitisation ─────────────────────────────────────────────────

const ABORT_PATTERN = /^Error: Request was aborted\./;
const STACK_TRACE_PATTERN = /\n\s+at\s+/;

function cleanToolResultText(text: string): string {
  if (!text) return text;

  if (ABORT_PATTERN.test(text)) {
    return "Interrupted";
  }

  if (STACK_TRACE_PATTERN.test(text)) {
    const firstLine = text.split("\n")[0];
    return firstLine || text;
  }

  return text;
}

// ── Output processing loop ──────────────────────────────────────────────────

async function processOutputStream(
  state: SDKSessionState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFn: (params: { prompt: any; options?: any }) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: Record<string, any>,
  sessionId: string,
): Promise<void> {
  let accumulatedText = "";
  let lastStreamedText = "";
  let emittedDone = false;
  let lastTurnInputTokens = 0;

  const activeToolCalls = new Map<string, string>();
  const toolIdToName = new Map<string, string>();
  const emittedToolCallIds = new Set<string>();
  const resetTurnState = () => {
    accumulatedText = "";
    lastStreamedText = "";
    state.lastOutputTime = Date.now();
    emittedDone = false;
    activeToolCalls.clear();
    emittedToolCallIds.clear();
  };

  // Single authoritative heartbeat per streaming session. Uses state.lastOutputTime
  // so that resetTimers() (called on each sendMessage) can reset the silence clock
  // without killing and recreating this interval.
  state.heartbeatTimer = setInterval(() => {
    if (!state.running) return;
    const silenceMs = Date.now() - state.lastOutputTime;
    if (silenceMs > HEARTBEAT_SILENCE_THRESHOLD_MS) {
      state.emitter.emit("output", {
        type: "progress",
        message: silenceMs > 30_000 ? "Still processing..." : "Processing...",
      } as ParsedOutput);
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const messageStream = createMessageStream(state, resetTurnState);
    const queryInstance = queryFn({ prompt: messageStream, options });
    state.activeQuery = queryInstance;

    for await (const msg of queryInstance) {
      state.lastActivity = Date.now();
      state.lastOutputTime = Date.now();
      const msgType = (msg as { type: string }).type;
      if (msgType !== "stream_event" && msgType !== "system") {
        console.log(`[sdk] ${msgType} (session=${sessionId})`);
      }

      // ── System messages: init, status, compact_boundary ──
      if (msgType === "system") {
        const sysMsg = msg as { type: "system"; subtype: string; session_id?: string; status?: string; compact_metadata?: { pre_tokens: number } };
        if (sysMsg.subtype === "init" && sysMsg.session_id) {
          state.claudeSessionId = sysMsg.session_id;
          if (sessionId) {
            try { updateClaudeSessionId(sessionId, sysMsg.session_id); } catch { /* ignore */ }
          }
          state.emitter.emit("output", {
            type: "session_id",
            claudeSessionId: sysMsg.session_id,
          } as ParsedOutput);
        }
        if (sysMsg.subtype === "status" && sysMsg.status === "compacting") {
          state.emitter.emit("output", { type: "compacting" } as ParsedOutput);
        }
        if (sysMsg.subtype === "compact_boundary") {
          state.emitter.emit("output", { type: "compact_done" } as ParsedOutput);
        }
        continue;
      }

      // ── Streaming partial messages ──
      if (msgType === "stream_event") {
        if (emittedDone) continue;
        const streamMsg = msg as {
          type: "stream_event";
          event: {
            type: string;
            index?: number;
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            content_block?: { type: string; name?: string; id?: string };
            delta?: { type: string; text?: string; partial_json?: string };
          };
        };
        const event = streamMsg.event;

        if (event.type === "message_start") {
          console.log(`[sdk] stream message_start usage=${JSON.stringify(event.message?.usage)}`);
          if (event.message?.usage?.input_tokens) {
            lastTurnInputTokens = event.message.usage.input_tokens;
          }
        }

        // New text content block — reset accumulator so post-tool text
        // doesn't concatenate with the previous block's content.
        if (event.type === "content_block_start" && event.content_block?.type === "text") {
          accumulatedText = "";
        }

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
          toolIdToName.set(callId, toolName);
          emittedToolCallIds.add(callId);

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
          if (sessionId) {
            try { updateClaudeSessionId(sessionId, assistantMsg.session_id); } catch { /* ignore */ }
          }
          state.emitter.emit("output", {
            type: "session_id",
            claudeSessionId: assistantMsg.session_id,
          } as ParsedOutput);
        }

        console.log(`[sdk] assistant msg usage=${JSON.stringify(assistantMsg.message?.usage)}`);
        if (assistantMsg.message?.usage?.input_tokens) {
          lastTurnInputTokens = assistantMsg.message.usage.input_tokens;
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
            // Bookkeeping only — stream_event deltas are the authoritative
            // source for streaming text.  The assistant message is a replay
            // of the same content and must not re-emit it.
            accumulatedText = block.text;
            lastStreamedText = block.text;
          }
          if (block.type === "tool_use" && block.name && !emittedDone) {
            const callId = block.id ?? `tool_${++state.toolCallCounter}`;
            activeToolCalls.set(callId, block.name);
            toolIdToName.set(callId, block.name);

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

            // Skip if stream_event already emitted this tool call
            if (emittedToolCallIds.has(callId)) continue;

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

        // When stop_reason is set, reset accumulated text for the next turn.
        // Don't emit done here — the result message that follows handles it.
        if (isFinal) {
          accumulatedText = "";
        }
        continue;
      }

      // ── User message with tool results ──
      if (msgType === "user") {
        const userMsg = msg as {
          type: "user";
          message: { content?: unknown };
          parent_tool_use_id: string | null;
        };

        const content = userMsg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const tb = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
            if (tb.type === "tool_result" && tb.tool_use_id) {
              const toolName = activeToolCalls.get(tb.tool_use_id)
                ?? toolIdToName.get(tb.tool_use_id)
                ?? "unknown";
              let resultText = "";
              if (typeof tb.content === "string") {
                resultText = tb.content;
              } else if (Array.isArray(tb.content)) {
                resultText = (tb.content as { type?: string; text?: string }[])
                  .filter(c => c.type === "text" && c.text)
                  .map(c => c.text)
                  .join("\n");
              }

              resultText = cleanToolResultText(resultText);

              state.emitter.emit("output", {
                type: "tool_result",
                toolCallId: tb.tool_use_id,
                toolName,
                toolResult: resultText.slice(0, 5000),
                toolStatus: tb.is_error ? "error" : "done",
              } as ParsedOutput);

              activeToolCalls.delete(tb.tool_use_id);

              // NEW: Release locks when tool completes
              if (state.activeLocks.has(tb.tool_use_id)) {
                const filePaths = state.activeLocks.get(tb.tool_use_id) ?? [];
                state.activeLocks.delete(tb.tool_use_id);
                
                // Release locks asynchronously (don't block the stream)
                for (const filePath of filePaths) {
                  releaseLock(filePath, tb.tool_use_id).catch((err) => {
                    console.error(`[sdk] Error releasing lock for ${filePath}:`, err);
                  });
                }
              }
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
          modelUsage?: Record<string, { inputTokens: number; outputTokens: number; contextWindow: number; maxOutputTokens: number; costUSD: number }>;
          session_id: string;
          permission_denials?: { tool_name: string; tool_use_id: string; tool_input: Record<string, unknown> }[];
          errors?: string[];
        };

        if (!state.claudeSessionId && resultMsg.session_id) {
          state.claudeSessionId = resultMsg.session_id;
          if (sessionId) {
            try { updateClaudeSessionId(sessionId, resultMsg.session_id); } catch { /* ignore */ }
          }
          state.emitter.emit("output", {
            type: "session_id",
            claudeSessionId: resultMsg.session_id,
          } as ParsedOutput);
        }

        if (!lastStreamedText && resultMsg.result) {
          state.emitter.emit("output", {
            type: "text",
            content: resultMsg.result,
          } as ParsedOutput);
        }

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
          if (resultMsg.modelUsage) {
            const modelKey = Object.keys(resultMsg.modelUsage)[0];
            if (modelKey) {
              const mu = resultMsg.modelUsage[modelKey];
              usage.context_window = mu.contextWindow;
            }
          }
          if (lastTurnInputTokens > 0) {
            usage.context_input_tokens = lastTurnInputTokens;
          }
          console.log(`[sdk] result: lastTurnInputTokens=${lastTurnInputTokens}, context_window=${usage.context_window}, context_input_tokens=${usage.context_input_tokens}, modelUsage=${JSON.stringify(resultMsg.modelUsage)}`);
          if (usage.context_input_tokens && usage.context_window) {
            console.log(`[sdk] context: ${usage.context_input_tokens}/${usage.context_window} (${Math.round(usage.context_input_tokens / usage.context_window * 100)}%)`);
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

        // Result means this turn is done. Per-turn state resets when the next
        // queued user message is yielded into the long-lived SDK stream.
        state.running = false;
        clearTimers(state);
        emittedDone = true;
        state.emitter.emit("output", { type: "done" } as ParsedOutput);
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
    } else if (isStaleResumeError(err) && state.claudeSessionId) {
      // Stale resume — clear the ID and let the next message start fresh
      console.warn(`Stale resume ID detected for session ${sessionId}, clearing for fresh start`);
      state.claudeSessionId = null;
      try { updateClaudeSessionId(sessionId, null); } catch { /* ignore */ }
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
    state.streamActive = false;
    state.activeQuery = null;
    for (const pending of state.pendingPermissions.values()) {
      pending.resolve({ behavior: "deny", message: "Stream ended" });
    }
    state.pendingPermissions.clear();
    state.lastActivity = Date.now();
    clearTimers(state);
    if (!emittedDone) {
      state.emitter.emit("output", { type: "done" } as ParsedOutput);
    }
  }
}

// ── Provider export ──────────────────────────────────────────────────────────

export const sdkProvider: ClaudeCodeProvider = {
  createSession(sessionId, opts = {}) {
    const state = getOrCreate(sessionId, opts.userEmail);
    state.skipPermissions = opts.skipPermissions ?? false;
    if (opts.systemPrompt) state.systemPrompt = opts.systemPrompt;
    if (opts.model) state.model = opts.model;
    if (opts.maxTurns) state.maxTurns = opts.maxTurns;
    if (opts.claudeSessionId && !state.claudeSessionId) {
      state.claudeSessionId = opts.claudeSessionId;
    }
    if (opts.delegationDepth !== undefined) state.delegationDepth = opts.delegationDepth;
    if (opts.parentSessionId) state.parentSessionId = opts.parentSessionId;
    if (opts.onSubAgentCost) state.onSubAgentCost = opts.onSubAgentCost;

    // Load group permissions for this user (skip for admins — they bypass group restrictions)
    if (opts.userEmail && !opts.skipPermissions) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getUserGroupPermissions, isUserAdmin } = require("../claude-db") as {
          getUserGroupPermissions: (email: string) => import("../claude-db").GroupPermissions;
          isUserAdmin: (email: string) => boolean;
        };
        if (!isUserAdmin(opts.userEmail)) {
          state.groupPermissions = getUserGroupPermissions(opts.userEmail);
        } else {
          state.groupPermissions = null;
        }
      } catch {
        state.groupPermissions = null;
      }
    }
  },

  sendMessage(sessionId, message, opts) {
    let state = sessions.get(sessionId);
    if (!state) {
      // Session was GC'd — attempt to rebuild from DB.
      // System prompt rebuild (async) is handled by the message handler layer
      // via ensureSessionAlive() before calling sendMessage. This path is a
      // safety net that creates minimal state so the stream can start.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getSession: getDbSession } = require("../claude-db") as { getSession: (id: string) => { model: string; skip_permissions: boolean; claude_session_id: string | null; personality: string | null } | null };
        const dbSession = getDbSession(sessionId);
        if (!dbSession) {
          console.error(`[sdk] sendMessage: session ${sessionId} not found in memory or DB`);
          return;
        }
        state = getOrCreate(sessionId);
        state.model = dbSession.model;
        state.skipPermissions = dbSession.skip_permissions;
        if (dbSession.claude_session_id) {
          state.claudeSessionId = dbSession.claude_session_id;
        }
        console.log(`[sdk] Auto-rebuilt session ${sessionId} from DB after GC`);
      } catch (err) {
        console.error(`[sdk] Failed to rebuild session ${sessionId}:`, err);
        return;
      }
    }
    state.lastActivity = Date.now();
    const skipPermissions = opts?.skipPermissions ?? state.skipPermissions;
    if (opts?.model) state.model = opts.model;
    if (skipPermissions !== state.skipPermissions) {
      state.skipPermissions = skipPermissions;
    }

    state.running = true;

    const fullPrompt = buildPromptWithFiles(message, opts?.inputFiles ?? []);

    if (state.streamActive) {
      // Stream is alive — push message into the generator
      resetTimers(state);
      pushMessage(state, fullPrompt).catch((err) => {
        state.running = false;
        if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
          // Interrupted by user — don't surface as an error
          state.emitter.emit("output", { type: "done" } as ParsedOutput);
          return;
        }
        console.error("SDK push error:", err);
        state.emitter.emit("output", { type: "error", message: String(err) } as ParsedOutput);
        state.emitter.emit("output", { type: "done" } as ParsedOutput);
      });
    } else {
      // Stream not yet started — start it, then push the first message
      startStreamingSession(state, sessionId).then(() => {
        resetTimers(state);
        return pushMessage(state, fullPrompt);
      }).catch((err) => {
        state.running = false;
        if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
          // Interrupted by user — don't surface as an error
          state.emitter.emit("output", { type: "done" } as ParsedOutput);
          return;
        }
        console.error("SDK stream start error:", err);
        state.emitter.emit("output", { type: "error", message: String(err) } as ParsedOutput);
        state.emitter.emit("output", { type: "done" } as ParsedOutput);
      });
    }
  },

  allowTool(sessionId, toolName, scope, toolCallId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.lastActivity = Date.now();

    if (scope === "session") {
      state.allowedTools.add(toolName);
    }

    if (toolCallId && state.pendingPermissions.has(toolCallId)) {
      const pending = state.pendingPermissions.get(toolCallId)!;
      state.pendingPermissions.delete(toolCallId);
      pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
    } else if (!toolCallId && state.pendingPermissions.size > 0) {
      // Legacy fallback: if no toolCallId was provided (shouldn't happen with
      // updated client), resolve the first pending permission as a best-effort.
      console.warn(`[sdk] allowTool called without toolCallId for session ${sessionId}, tool ${toolName}`);
      for (const [id, pending] of state.pendingPermissions) {
        state.pendingPermissions.delete(id);
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
        break;
      }
    } else if (toolCallId) {
      console.warn(`[sdk] allowTool: toolCallId ${toolCallId} not found in pendingPermissions for session ${sessionId}`);
    }
  },

  denyPermission(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.lastActivity = Date.now();

    for (const [id, pending] of state.pendingPermissions) {
      pending.resolve({ behavior: "deny", message: "Permission denied by user" });
      state.pendingPermissions.delete(id);
      break;
    }
  },

  interrupt(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.running = false;

    for (const pending of state.pendingPermissions.values()) {
      pending.resolve({ behavior: "deny", message: "Interrupted" });
    }
    state.pendingPermissions.clear();

    clearTimers(state);

    if (state.activeQuery) {
      try { state.activeQuery.interrupt(); } catch {
        try { state.activeQuery.close(); } catch { /* ignore */ }
      }
    }
  },

  closeSession(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    cleanupSession(state);
    sessions.delete(sessionId);
  },

  suspendSession(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;

    for (const pending of state.pendingPermissions.values()) {
      pending.resolve({ behavior: "deny", message: "Session suspended" });
    }
    state.pendingPermissions.clear();
    clearTimers(state);
    endStream(state);
    if (state.activeQuery) {
      try { state.activeQuery.close(); } catch { /* ignore */ }
      state.activeQuery = null;
    }
    state.running = false;
    state.streamActive = false;
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

  hasSession(sessionId) {
    return sessions.has(sessionId);
  },
};

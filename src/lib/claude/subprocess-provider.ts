import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import type { ClaudeCodeProvider, ParsedOutput, TokenUsage } from "./provider";

const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH ?? "claude";
const SUBPROCESS_TIMEOUT_MS = parseInt(process.env.CLAUDE_SUBPROCESS_TIMEOUT_MS ?? "300000", 10); // 5min default
const IDLE_GC_MS = 30 * 60 * 1000; // 30min idle threshold for GC
const GC_INTERVAL_MS = 60 * 1000; // check every 60s

interface SessionState {
  claudeSessionId: string | null;
  emitter: EventEmitter;
  running: boolean;
  lastMessage: string;
  allowedTools: Set<string>;
  skipPermissions: boolean;
  systemPrompt?: string;
  pendingDeny?: boolean;
  activeProc?: ReturnType<typeof spawn>;
  model?: string;
  lastActivity: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  waitingForPermission: boolean;
  generation: number;
  permissionRetry: boolean;
  preRetryContentLength: number;
  lastEmittedContentLength: number;
  toolCallCounter: number;
}

const sessions = new Map<string, SessionState>();

// ── Session GC ───────────────────────────────────────────────────────────────

const gcInterval = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, state] of sessions) {
    if (!state.running && !state.activeProc && (now - state.lastActivity > IDLE_GC_MS)) {
      state.emitter.removeAllListeners();
      if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
      sessions.delete(sessionId);
    }
  }
}, GC_INTERVAL_MS);

// Prevent the interval from keeping Node alive during shutdown
if (gcInterval.unref) gcInterval.unref();

// ── Process kill helper ──────────────────────────────────────────────────────

function killProcess(proc: ChildProcess): void {
  try { proc.kill("SIGTERM"); } catch { /* ignore */ }
  const killTimer = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch { /* ignore */ }
  }, 5000);
  killTimer.unref();
}

// ── Error classification ─────────────────────────────────────────────────────

function classifyStderrError(text: string): { message: string; retryable: boolean } {
  const lower = text.toLowerCase();

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { message: "Rate limited by Claude API. Please wait a moment and try again.", retryable: true };
  }
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("econnreset") || lower.includes("etimedout") || lower.includes("fetch failed")) {
    return { message: "Network error communicating with Claude API. Check your connection.", retryable: true };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("authentication") || lower.includes("invalid api key") || lower.includes("invalid x-api-key")) {
    return { message: "Authentication error. Check your API key or Claude CLI configuration.", retryable: false };
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist") || lower.includes("not available"))) {
    return { message: "The requested model is not available. Try a different model.", retryable: false };
  }

  return { message: text, retryable: false };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreate(sessionId: string): SessionState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      claudeSessionId: null,
      emitter: new EventEmitter(),
      running: false,
      lastMessage: "",
      allowedTools: new Set(),
      skipPermissions: false,
      lastActivity: Date.now(),
      waitingForPermission: false,
      generation: 0,
      permissionRetry: false,
      preRetryContentLength: 0,
      lastEmittedContentLength: 0,
      toolCallCounter: 0,
    });
  }
  const state = sessions.get(sessionId)!;
  state.lastActivity = Date.now();
  return state;
}

function runClaude(
  state: SessionState,
  message: string,
  skipPermissions: boolean,
  extraTools: string[] = [],
  inputFiles: string[] = [],
): void {
  if (state.running) return;
  state.running = true;
  state.lastMessage = message;
  state.lastActivity = Date.now();
  state.waitingForPermission = false;
  state.lastEmittedContentLength = 0;

  // Capture generation at start — stale callbacks check this
  const gen = state.generation;

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  if (skipPermissions) args.push("--dangerously-skip-permissions");
  if (state.claudeSessionId) args.push("--resume", state.claudeSessionId);
  if (state.model) args.push("--model", state.model);

  const allAllowedTools = Array.from(state.allowedTools).concat(extraTools);
  if (allAllowedTools.length > 0) {
    args.push("--allowed-tools", allAllowedTools.join(","));
  }

  // Add input files for multimodal support (images) — validate paths
  const projectRoot = path.resolve(process.env.CLAUDE_PROJECT_ROOT ?? process.cwd());
  for (const filePath of inputFiles) {
    if (filePath.startsWith('-')) continue;
    if (filePath.includes('..')) continue;
    const resolved = path.resolve(projectRoot, filePath);
    if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) continue;
    args.push("--input-file", filePath);
  }

  // Pass system prompt via CLI flag for first message if set and no prior session
  if (state.systemPrompt && !state.claudeSessionId) {
    args.push("--system-prompt", state.systemPrompt);
  }
  const fullMessage = message;

  const MAX_MESSAGE_LENGTH = 2 * 1024 * 1024; // 2MB
  if (fullMessage.length > MAX_MESSAGE_LENGTH) {
    state.running = false;
    state.emitter.emit("output", { type: "error", message: "Message too long (max 2MB)" } as ParsedOutput);
    return;
  }

  const env = { ...process.env };
  delete (env as Record<string, string | undefined>).CLAUDECODE;

  const proc = spawn(CLAUDE_BIN, args, {
    cwd: process.env.CLAUDE_PROJECT_ROOT ?? process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  state.activeProc = proc;

  proc.stdin.write(fullMessage + "\n");
  proc.stdin.end();

  const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB
  let buffer = "";
  let producedContent = false;
  let lastStdoutTime = Date.now();

  // ── Subprocess timeout ──────────────────────────────────────────────────
  if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
  state.timeoutTimer = setTimeout(() => {
    if (state.generation !== gen) return;
    if (state.activeProc === proc) {
      killProcess(proc);
      state.emitter.emit("output", {
        type: "error",
        message: "Claude process timed out. You can retry your message.",
        retryable: true,
      } as ParsedOutput);
    }
  }, SUBPROCESS_TIMEOUT_MS);

  // ── Heartbeat for long operations ────────────────────────────────────────
  const heartbeatInterval = setInterval(() => {
    if (state.generation !== gen) { clearInterval(heartbeatInterval); return; }
    const silenceMs = Date.now() - lastStdoutTime;
    if (silenceMs > 8_000) {
      state.emitter.emit("output", {
        type: "progress",
        message: silenceMs > 60_000 ? "Still processing…" : "Processing…",
      } as ParsedOutput);
    }
  }, 10_000);
  if (heartbeatInterval.unref) heartbeatInterval.unref();

  proc.stdout.on("data", (chunk: Buffer) => {
    if (state.generation !== gen) return;
    lastStdoutTime = Date.now();
    state.lastActivity = Date.now();
    buffer += chunk.toString();
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer = buffer.slice(-MAX_BUFFER_SIZE);
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        handleEvent(state, event);
        producedContent = true;
      } catch {
        state.emitter.emit("output", { type: "text", content: line } as ParsedOutput);
        producedContent = true;
      }
    }
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    if (state.generation !== gen) return;
    const text = chunk.toString().trim();
    if (text) {
      const classified = classifyStderrError(text);
      state.emitter.emit("output", {
        type: "error",
        message: classified.message,
        retryable: classified.retryable,
      } as ParsedOutput);
    }
  });

  proc.on("close", (code) => {
    // Always clean up timers
    if (state.timeoutTimer) {
      clearTimeout(state.timeoutTimer);
      state.timeoutTimer = undefined;
    }
    clearInterval(heartbeatInterval);
    if (state.activeProc === proc) state.activeProc = undefined;

    // If generation has moved on, skip event emission
    if (state.generation !== gen) return;

    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer) as Record<string, unknown>;
        handleEvent(state, event);
        producedContent = true;
      } catch {
        state.emitter.emit("output", { type: "text", content: buffer } as ParsedOutput);
        producedContent = true;
      }
    }

    // Non-zero exit code with no content = emit error
    if (code !== null && code !== 0 && !producedContent) {
      state.emitter.emit("output", {
        type: "error",
        message: `Claude process exited with code ${code}`,
        retryable: code === 1, // general errors may be retryable
      } as ParsedOutput);
    }

    state.lastActivity = Date.now();
    if (state.waitingForPermission) {
      // Subprocess exited because of a permission denial — don't emit "done"
      // because we'll respawn after the user grants permission.
      return;
    }
    state.running = false;
    state.emitter.emit("output", { type: "done" } as ParsedOutput);
  });

  proc.on("error", (err) => {
    // Always clean up timers
    if (state.timeoutTimer) {
      clearTimeout(state.timeoutTimer);
      state.timeoutTimer = undefined;
    }
    clearInterval(heartbeatInterval);

    // If generation has moved on, skip event emission
    if (state.generation !== gen) return;

    state.running = false;
    state.lastActivity = Date.now();
    state.emitter.emit("output", {
      type: "error",
      message: `Failed to start claude: ${err.message}`,
    } as ParsedOutput);
  });
}

function handleEvent(state: SessionState, event: Record<string, unknown>): void {
  const type = event.type as string;
  state.lastActivity = Date.now();

  if (
    (type === "system" && (event.subtype as string) === "init") ||
    event.session_id
  ) {
    const sid = event.session_id as string;
    if (sid && !state.claudeSessionId) {
      state.claudeSessionId = sid;
    }
  }

  if (type === "assistant") {
    const msg = event.message as {
      content?: { type: string; text?: string; name?: string; input?: unknown; id?: string }[];
      stop_reason?: string | null;
      usage?: TokenUsage;
    };
    const isFinal = msg?.stop_reason != null;
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && block.text) {
        state.lastEmittedContentLength = block.text.length;
        // Permission retry duplicate suppression: skip re-emitted content
        if (state.permissionRetry && block.text.length <= state.preRetryContentLength) {
          continue;
        }
        if (state.permissionRetry) {
          state.permissionRetry = false;
        }
        state.emitter.emit("output", {
          type: isFinal ? "text" : "streaming",
          content: block.text,
        } as ParsedOutput);
      }
      if (block.type === "tool_use" && block.name) {
        state.permissionRetry = false;
        const callId = block.id ?? `tool_${++state.toolCallCounter}`;

        // Emit tool_call event for rich rendering
        state.emitter.emit("output", {
          type: "tool_call",
          toolCallId: callId,
          toolName: block.name,
          toolInput: block.input,
          toolStatus: "running",
        } as ParsedOutput);

        // Also emit progress for backward compat with activity strip
        state.emitter.emit("output", {
          type: "progress",
          message: `Using ${block.name}`,
          toolName: block.name,
          toolInput: block.input,
        } as ParsedOutput);
      }
    }
    return;
  }

  if (type === "result") {
    state.permissionRetry = false;
    const denials = (event.permission_denials as { tool_name?: string; tool_input?: unknown }[]) ?? [];
    for (const d of denials) {
      if (d.tool_name) {
        state.waitingForPermission = true;
        state.emitter.emit("output", {
          type: "permission_request",
          toolName: d.tool_name,
          toolInput: d.tool_input,
        } as ParsedOutput);
      }
    }

    // Emit tool results from the result event
    const resultContent = (event as Record<string, unknown>).content;
    if (Array.isArray(resultContent)) {
      for (const block of resultContent) {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_result") {
          const b = block as Record<string, unknown>;
          state.emitter.emit("output", {
            type: "tool_result",
            toolCallId: b.tool_use_id as string | undefined,
            toolName: b.name as string | undefined,
            toolResult: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
            toolStatus: b.is_error ? "error" : "done",
            exitCode: typeof b.exit_code === "number" ? b.exit_code : undefined,
          } as ParsedOutput);
        }
      }
    }

    // Extract token usage from result event
    const usage = event.usage as TokenUsage | undefined;
    const costUsd = event.cost_usd as number | undefined;
    if (usage) {
      if (costUsd !== undefined) usage.cost_usd = costUsd;
      state.emitter.emit("output", { type: "usage", usage } as ParsedOutput);
    }
    return;
  }

  if (type === "system" || type === "rate_limit_event") {
    return;
  }
}

export function getActiveSessionCount(): number {
  let count = 0;
  for (const state of sessions.values()) {
    if (state.running) count++;
  }
  return count;
}

export const subprocessProvider: ClaudeCodeProvider = {
  createSession(sessionId, opts = {}) {
    const state = getOrCreate(sessionId);
    state.skipPermissions = opts.skipPermissions ?? false;
    if (opts.systemPrompt) state.systemPrompt = opts.systemPrompt;
    if (opts.model) state.model = opts.model;
  },

  sendMessage(sessionId, message, opts) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.lastActivity = Date.now();
    const skipPermissions = opts?.skipPermissions ?? state.skipPermissions;
    if (opts?.model) state.model = opts.model;
    runClaude(state, message, skipPermissions, [], opts?.inputFiles ?? []);
  },

  allowTool(sessionId, toolName, scope) {
    const state = sessions.get(sessionId);
    if (!state) return;

    // Only proceed if we're actually waiting for permission
    if (!state.waitingForPermission) return;
    state.waitingForPermission = false;

    if (scope === "session") state.allowedTools.add(toolName);
    const extraTools = scope === "once" ? [toolName] : [];

    // Set permission retry state before killing — next run will suppress duplicates
    state.permissionRetry = true;
    state.preRetryContentLength = state.lastEmittedContentLength;

    // Increment generation so stale close handler is ignored
    state.generation++;

    // Kill current proc if running, then re-run with expanded tool list
    if (state.activeProc) {
      killProcess(state.activeProc);
      state.activeProc = undefined;
    }
    state.running = false;

    // Small delay to allow close event to fire before spawning new process
    setTimeout(() => {
      runClaude(state, state.lastMessage, state.skipPermissions, extraTools);
    }, 100);
  },

  denyPermission(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.waitingForPermission = false;
    state.running = false;

    if (state.activeProc) {
      killProcess(state.activeProc);
    }
    state.emitter.emit("output", { type: "done" } as ParsedOutput);
  },

  interrupt(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    // Increment generation first so stale close handler is ignored
    state.generation++;
    state.running = false;
    state.waitingForPermission = false;
    if (state.timeoutTimer) {
      clearTimeout(state.timeoutTimer);
      state.timeoutTimer = undefined;
    }
    if (state.activeProc) {
      killProcess(state.activeProc);
      state.activeProc = undefined;
    }
  },

  closeSession(sessionId) {
    const state = sessions.get(sessionId);
    if (state?.activeProc) {
      killProcess(state.activeProc);
    }
    if (state?.timeoutTimer) clearTimeout(state.timeoutTimer);
    sessions.delete(sessionId);
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
};

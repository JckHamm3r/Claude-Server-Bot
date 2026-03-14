import { EventEmitter } from "events";
import type { ClaudeCodeProvider, ParsedOutput, TokenUsage } from "./provider";

interface SDKSessionState {
  emitter: EventEmitter;
  running: boolean;
  model?: string;
  systemPrompt?: string;
  skipPermissions: boolean;
  abortController?: AbortController;
  lastActivity: number;
  firstMessage: boolean;
}

const sessions = new Map<string, SDKSessionState>();

function getOrCreate(sessionId: string): SDKSessionState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      emitter: new EventEmitter(),
      running: false,
      skipPermissions: false,
      lastActivity: Date.now(),
      firstMessage: true,
    });
  }
  const state = sessions.get(sessionId)!;
  state.lastActivity = Date.now();
  return state;
}

// ── Session GC ───────────────────────────────────────────────────────────────
const SDK_GC_INTERVAL = 5 * 60 * 1000;
const SDK_IDLE_THRESHOLD = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of sessions) {
    if (!state.running && (now - state.lastActivity) > SDK_IDLE_THRESHOLD) {
      state.emitter.removeAllListeners();
      if (state.abortController) state.abortController.abort();
      sessions.delete(id);
    }
  }
}, SDK_GC_INTERVAL).unref();

function getApiKey(): string {
  // Try app_settings first, then env
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = (require("../db") as { default: import("better-sqlite3").Database }).default;
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'anthropic_api_key'").get() as { value: string } | undefined;
    if (row?.value) return row.value;
  } catch { /* fallback to env */ }
  return process.env.ANTHROPIC_API_KEY ?? "";
}

async function runSDK(state: SDKSessionState, message: string): Promise<void> {
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
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: (opts: any) => Promise<any>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const sdk = require("@anthropic-ai/claude-code") as any;
    query = sdk.query;
  } catch {
    state.running = false;
    state.emitter.emit("output", {
      type: "error",
      message: "Claude Code SDK not installed. Run: npm install @anthropic-ai/claude-code",
    } as ParsedOutput);
    return;
  }

  const abortController = new AbortController();
  state.abortController = abortController;

  // Prepend system prompt on first message only
  let fullMessage = message;
  if (state.systemPrompt && state.firstMessage) {
    fullMessage = state.systemPrompt + "\n\n" + message;
  }
  state.firstMessage = false;

  const timeoutMs = 600_000; // 10 minutes
  const timeoutId = setTimeout(() => {
    state.abortController?.abort();
  }, timeoutMs);

  try {
    const result = await query({
      prompt: fullMessage,
      options: {
        model: state.model,
        maxTurns: 30,
      },
      abortController,
    });

    // Extract text from result
    let responseText = "";
    if (typeof result === "string") {
      responseText = result;
    } else if (Array.isArray(result)) {
      for (const block of result) {
        if (typeof block === "string") {
          responseText += block;
        } else if (block && typeof block === "object" && "text" in block) {
          responseText += (block as { text: string }).text;
        }
      }
    } else if (result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      if (typeof r.text === "string") responseText = r.text;
      else if (typeof r.content === "string") responseText = r.content;

      // Extract usage if available
      const usage = r.usage as TokenUsage | undefined;
      if (usage) {
        state.emitter.emit("output", { type: "usage", usage } as ParsedOutput);
      }
    }

    if (responseText) {
      state.emitter.emit("output", {
        type: "text",
        content: responseText,
      } as ParsedOutput);
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      // Interrupted — don't emit error
    } else {
      state.emitter.emit("output", {
        type: "error",
        message: `SDK error: ${err instanceof Error ? err.message : String(err)}`,
      } as ParsedOutput);
    }
  } finally {
    clearTimeout(timeoutId);
    state.running = false;
    state.abortController = undefined;
    state.lastActivity = Date.now();
    state.emitter.emit("output", { type: "done" } as ParsedOutput);
  }
}

export const sdkProvider: ClaudeCodeProvider = {
  createSession(sessionId, opts = {}) {
    const state = getOrCreate(sessionId);
    state.skipPermissions = opts.skipPermissions ?? false;
    if (opts.systemPrompt) state.systemPrompt = opts.systemPrompt;
    if (opts.model) state.model = opts.model;
  },

  sendMessage(sessionId, message, opts) {
    const state = sessions.get(sessionId);
    if (!state) return;
    if (opts?.model) state.model = opts.model;
    // TODO: inputFiles support for SDK (base64 encoding)
    runSDK(state, message).catch(err => {
      console.error("SDK error:", err);
      state.emitter.emit("output", { type: "error", message: String(err) } as ParsedOutput);
    });
  },

  interrupt(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.running = false;
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = undefined;
    }
  },

  closeSession(sessionId) {
    const state = sessions.get(sessionId);
    if (state?.abortController) {
      state.abortController.abort();
    }
    sessions.delete(sessionId);
  },

  suspendSession(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) return;
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = undefined;
    }
    state.running = false;
    state.emitter.removeAllListeners("output");
  },

  onOutput(sessionId, cb) {
    const state = getOrCreate(sessionId);
    state.emitter.on("output", cb);
  },

  offOutput(sessionId) {
    const state = sessions.get(sessionId);
    if (state) state.emitter.removeAllListeners("output");
  },

  allowTool(sessionId, _toolName, _scope) {
    // SDK handles permissions differently — no-op for now
    const state = sessions.get(sessionId);
    if (state) {
      state.emitter.emit("output", { type: "done" } as ParsedOutput);
    }
  },

  denyPermission(sessionId) {
    const state = sessions.get(sessionId);
    if (state) {
      state.emitter.emit("output", { type: "done" } as ParsedOutput);
    }
  },

  isRunning(sessionId) {
    return sessions.get(sessionId)?.running ?? false;
  },
};

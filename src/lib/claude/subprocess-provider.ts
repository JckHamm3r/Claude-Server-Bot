import { spawn } from "child_process";
import { EventEmitter } from "events";
import type { ClaudeCodeProvider, ParsedOutput } from "./provider";

const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH ?? "claude";

interface SessionState {
  claudeSessionId: string | null;
  emitter: EventEmitter;
  running: boolean;
  lastMessage: string;
  allowedTools: Set<string>;
  skipPermissions: boolean;
}

const sessions = new Map<string, SessionState>();

function getOrCreate(sessionId: string): SessionState {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      claudeSessionId: null,
      emitter: new EventEmitter(),
      running: false,
      lastMessage: "",
      allowedTools: new Set(),
      skipPermissions: false,
    });
  }
  return sessions.get(sessionId)!;
}

function runClaude(
  state: SessionState,
  message: string,
  skipPermissions: boolean,
  extraTools: string[] = [],
): void {
  if (state.running) return;
  state.running = true;
  state.lastMessage = message;

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  if (skipPermissions) args.push("--dangerously-skip-permissions");
  if (state.claudeSessionId) args.push("--resume", state.claudeSessionId);

  const allAllowedTools = Array.from(state.allowedTools).concat(extraTools);
  if (allAllowedTools.length > 0) {
    args.push("--allowed-tools", allAllowedTools.join(","));
  }

  const env = { ...process.env };
  delete (env as Record<string, string | undefined>).CLAUDECODE;

  const proc = spawn(CLAUDE_BIN, args, {
    cwd: process.env.CLAUDE_PROJECT_ROOT ?? process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdin.write(message + "\n");
  proc.stdin.end();

  let buffer = "";

  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        handleEvent(state, event);
      } catch {
        state.emitter.emit("output", { type: "text", content: line } as ParsedOutput);
      }
    }
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      state.emitter.emit("output", { type: "error", message: text } as ParsedOutput);
    }
  });

  proc.on("close", () => {
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer) as Record<string, unknown>;
        handleEvent(state, event);
      } catch {
        state.emitter.emit("output", { type: "text", content: buffer } as ParsedOutput);
      }
    }
    state.running = false;
    state.emitter.emit("output", { type: "done" } as ParsedOutput);
  });

  proc.on("error", (err) => {
    state.running = false;
    state.emitter.emit("output", {
      type: "error",
      message: `Failed to start claude: ${err.message}`,
    } as ParsedOutput);
  });
}

function handleEvent(state: SessionState, event: Record<string, unknown>): void {
  const type = event.type as string;

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
      content?: { type: string; text?: string; name?: string; input?: unknown }[];
      stop_reason?: string | null;
    };
    const isFinal = msg?.stop_reason != null;
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && block.text) {
        state.emitter.emit("output", {
          type: isFinal ? "text" : "streaming",
          content: block.text,
        } as ParsedOutput);
      }
      if (block.type === "tool_use" && block.name) {
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
    const denials = (event.permission_denials as { tool_name?: string; tool_input?: unknown }[]) ?? [];
    for (const d of denials) {
      if (d.tool_name) {
        state.emitter.emit("output", {
          type: "permission_request",
          toolName: d.tool_name,
          toolInput: d.tool_input,
        } as ParsedOutput);
      }
    }
    return;
  }

  if (type === "system" || type === "rate_limit_event") {
    return;
  }
}

export const subprocessProvider: ClaudeCodeProvider = {
  createSession(sessionId, { skipPermissions } = {}) {
    const state = getOrCreate(sessionId);
    state.skipPermissions = skipPermissions ?? false;
  },

  sendMessage(sessionId, message, opts) {
    const state = sessions.get(sessionId);
    if (!state) return;
    const skipPermissions = opts?.skipPermissions ?? state.skipPermissions;
    runClaude(state, message, skipPermissions);
  },

  allowTool(sessionId, toolName, scope) {
    const state = sessions.get(sessionId);
    if (!state || state.running) return;
    if (scope === "session") state.allowedTools.add(toolName);
    const extraTools = scope === "once" ? [toolName] : [];
    runClaude(state, state.lastMessage, state.skipPermissions, extraTools);
  },

  interrupt(sessionId) {
    const state = sessions.get(sessionId);
    if (state) state.running = false;
  },

  closeSession(sessionId) {
    sessions.delete(sessionId);
  },

  onOutput(sessionId, cb) {
    const state = getOrCreate(sessionId);
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

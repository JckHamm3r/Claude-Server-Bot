export interface DiffHunk {
  header: string;
  lines: { type: "add" | "remove" | "context"; content: string }[];
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cost_usd?: number;
}

export interface ParsedOutput {
  type: "text" | "streaming" | "options" | "confirm" | "diff" | "progress" | "done" | "error" | "permission_request" | "security_warn" | "usage" | "tool_call" | "tool_result";
  content?: string;
  choices?: string[];       // for 'options'
  prompt?: string;          // for 'confirm'
  file?: string;            // for 'diff'
  hunks?: DiffHunk[];       // for 'diff'
  message?: string;         // for 'progress' | 'error' | 'security_warn'
  toolName?: string;        // for 'permission_request' | 'tool_call' | 'tool_result'
  toolInput?: unknown;      // for 'permission_request' | 'tool_call'
  sandboxCategory?: string; // for 'permission_request' — sandbox classification
  sandboxReason?: string;   // for 'permission_request' — sandbox reason
  warnType?: string;        // for 'security_warn'
  usage?: TokenUsage;       // for 'usage'
  retryable?: boolean;      // for 'error' — whether the error is retryable
  toolCallId?: string;      // for 'tool_call' | 'tool_result'
  toolStatus?: "running" | "done" | "error"; // for 'tool_call' | 'tool_result'
  toolResult?: string;      // for 'tool_result'
  exitCode?: number;        // for 'tool_result'
}

export interface ClaudeCodeProvider {
  createSession(sessionId: string, opts?: { skipPermissions?: boolean; systemPrompt?: string; model?: string }): void;
  sendMessage(sessionId: string, message: string, opts?: { skipPermissions?: boolean; model?: string; inputFiles?: string[] }): void;
  interrupt(sessionId: string): void;
  closeSession(sessionId: string): void;
  onOutput(sessionId: string, cb: (output: ParsedOutput) => void): void;
  offOutput(sessionId: string): void;
  allowTool(sessionId: string, toolName: string, scope: "session" | "once"): void;
  denyPermission(sessionId: string): void;
  isRunning(sessionId: string): boolean;
}

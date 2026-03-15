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

export interface UserQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export interface ParsedOutput {
  type: "text" | "streaming" | "options" | "confirm" | "diff" | "progress" | "done" | "error" | "permission_request" | "security_warn" | "usage" | "tool_call" | "tool_result" | "user_question" | "session_id";
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
  questions?: UserQuestion[]; // for 'user_question'
  claudeSessionId?: string;   // for 'session_id' — SDK session resume ID
}

export interface ClaudeCodeProvider {
  createSession(sessionId: string, opts?: { skipPermissions?: boolean; systemPrompt?: string; model?: string; claudeSessionId?: string }): void;
  sendMessage(sessionId: string, message: string, opts?: { skipPermissions?: boolean; model?: string; inputFiles?: string[] }): void;
  interrupt(sessionId: string): void;
  /** Kill active process and remove all state — use for permanent deletion. */
  closeSession(sessionId: string): void;
  /** Kill active process but preserve claudeSessionId for later --resume. */
  suspendSession(sessionId: string): void;
  onOutput(sessionId: string, cb: (output: ParsedOutput) => void): void;
  offOutput(sessionId: string): void;
  allowTool(sessionId: string, toolName: string, scope: "session" | "once", toolCallId?: string): void;
  denyPermission(sessionId: string): void;
  isRunning(sessionId: string): boolean;
  getClaudeSessionId?(sessionId: string): string | null;
}

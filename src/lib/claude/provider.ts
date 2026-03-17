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
  context_window?: number;
  context_input_tokens?: number;
}

export interface UserQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export interface ParsedOutput {
  type: "text" | "streaming" | "options" | "confirm" | "diff" | "progress" | "done" | "error" | "permission_request" | "security_warn" | "usage" | "tool_call" | "tool_result" | "user_question" | "session_id" | "compacting" | "compact_done" | "file_queued" | "sub_agent_status";
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
  toolCallId?: string;      // for 'tool_call' | 'tool_result' | 'file_queued'
  toolStatus?: "running" | "done" | "error"; // for 'tool_call' | 'tool_result'
  toolResult?: string;      // for 'tool_result'
  exitCode?: number;        // for 'tool_result'
  questions?: UserQuestion[]; // for 'user_question'
  claudeSessionId?: string;   // for 'session_id' — SDK session resume ID
  filePath?: string;        // for 'file_queued' — the file that is locked
  queuePosition?: number;   // for 'file_queued' — position in queue
  lockedBy?: {              // for 'file_queued' — who holds the lock
    userEmail: string;
    userName: string;
  };
  // for 'sub_agent_status' — live status of sub-agents running for this session
  subAgents?: {
    id: string;
    agentName: string;
    agentIcon: string | null;
    task: string;
    status: "running" | "complete" | "error";
    error?: string;
  }[];
}

export interface ClaudeCodeProvider {
  createSession(sessionId: string, opts?: {
    skipPermissions?: boolean;
    systemPrompt?: string;
    model?: string;
    claudeSessionId?: string;
    userEmail?: string;
    maxTurns?: number;
    delegationDepth?: number;
    parentSessionId?: string;
    onSubAgentCost?: (costUsd: number) => void;
  }): void;
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
  /** Check whether in-memory state exists for this session (not GC'd). */
  hasSession?(sessionId: string): boolean;
}

export interface DiffHunk {
  header: string;
  lines: { type: "add" | "remove" | "context"; content: string }[];
}

export interface ParsedOutput {
  type: "text" | "streaming" | "options" | "confirm" | "diff" | "progress" | "done" | "error" | "permission_request" | "security_warn";
  content?: string;
  choices?: string[];       // for 'options'
  prompt?: string;          // for 'confirm'
  file?: string;            // for 'diff'
  hunks?: DiffHunk[];       // for 'diff'
  message?: string;         // for 'progress' | 'error' | 'security_warn'
  toolName?: string;        // for 'permission_request'
  toolInput?: unknown;      // for 'permission_request'
  sandboxCategory?: string; // for 'permission_request' — sandbox classification
  sandboxReason?: string;   // for 'permission_request' — sandbox reason
  warnType?: string;        // for 'security_warn'
}

export interface ClaudeCodeProvider {
  createSession(sessionId: string, opts: { skipPermissions?: boolean; systemPrompt?: string }): void;
  sendMessage(sessionId: string, message: string, opts?: { skipPermissions?: boolean }): void;
  interrupt(sessionId: string): void;
  closeSession(sessionId: string): void;
  onOutput(sessionId: string, cb: (output: ParsedOutput) => void): void;
  offOutput(sessionId: string): void;
  allowTool(sessionId: string, toolName: string, scope: "session" | "once"): void;
  denyPermission(sessionId: string): void;
  isRunning(sessionId: string): boolean;
}

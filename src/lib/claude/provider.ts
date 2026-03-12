export interface DiffHunk {
  header: string;
  lines: { type: "add" | "remove" | "context"; content: string }[];
}

export interface ParsedOutput {
  type: "text" | "streaming" | "options" | "confirm" | "diff" | "progress" | "done" | "error" | "permission_request";
  content?: string;
  choices?: string[];       // for 'options'
  prompt?: string;          // for 'confirm'
  file?: string;            // for 'diff'
  hunks?: DiffHunk[];       // for 'diff'
  message?: string;         // for 'progress' | 'error'
  toolName?: string;        // for 'permission_request'
  toolInput?: unknown;      // for 'permission_request'
}

export interface ClaudeCodeProvider {
  createSession(sessionId: string, opts: { skipPermissions?: boolean }): void;
  sendMessage(sessionId: string, message: string, opts?: { skipPermissions?: boolean }): void;
  interrupt(sessionId: string): void;
  closeSession(sessionId: string): void;
  onOutput(sessionId: string, cb: (output: ParsedOutput) => void): void;
  offOutput(sessionId: string): void;
  allowTool(sessionId: string, toolName: string, scope: "session" | "once"): void;
  isRunning(sessionId: string): boolean;
}

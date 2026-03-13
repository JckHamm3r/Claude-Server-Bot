import type { Server, Socket } from "socket.io";
import type { ClaudeCodeProvider, TokenUsage } from "../lib/claude/provider";
import type { SessionStatus } from "../lib/claude-db";

export type PlanAction = "retry" | "skip" | "cancel" | "rollback_stop" | "rollback_continue";

export interface HandlerContext {
  io: Server;
  socket: Socket;
  email: string;
  isAdmin: boolean;
  provider: ClaudeCodeProvider;
  // Shared state (passed by reference — Maps/Sets mutate in place)
  connectedUsers: Map<string, { email: string; activeSession: string | null }>;
  sessionStreamingContent: Map<string, string>;
  sessionListeners: Set<string>;
  sessionCommandSubmitter: Map<string, string>;
  sessionStartTimes: Map<string, number>;
  sessionProviders: Map<string, ClaudeCodeProvider>;
  sessionPendingUsage: Map<string, TokenUsage>;
  userSessionCommands: Map<string, Map<string, number>>;
  metricsBuffer: { session_count: number; command_count: number; agent_count: number; latencies: number[] };
  planResumeCallbacks: Map<string, (action: PlanAction) => void>;
  ptyProcesses: Map<string, import("node-pty").IPty>;
  // Helper functions
  getSessionProvider: (sessionId: string, providerType?: string) => ClaudeCodeProvider;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  ensureSessionListener: (sessionId: string) => void;
  broadcastPresence: () => void;
  checkRateLimit: (email: string, sessionId: string) => { ok: boolean; reason?: string };
  incrementSessionCommands: (email: string, sessionId: string) => void;
  retrySaveMessage: (
    sessionId: string,
    senderType: "admin" | "claude",
    content: string,
    senderId?: string,
    messageType?: "chat" | "system" | "error",
    metadata?: Record<string, unknown>,
  ) => Promise<boolean>;
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket, connectSocket } from "@/lib/socket";
import type { ParsedOutput } from "@/lib/claude/provider";
import type { ClaudeSession } from "@/lib/claude-db";
import { DEFAULT_MODEL } from "@/lib/models";
import type { ChatMessage, SessionUsage, BudgetLimits, ContextUsage } from "@/types/chat";
import type { ActivityState } from "@/components/claude-code/message-list";
import type { ChatInputHandle } from "@/components/claude-code/chat-input";

type PresenceUser = { email: string; activeSession: string | null };

interface StoredToolCall {
  toolCallId: string;
  toolName: string;
  toolInput?: unknown;
  status: string;
  result?: string;
  exitCode?: number;
}

function expandToolCallsFromMetadata(msgs: ChatMessage[]): ChatMessage[] {
  const expanded: ChatMessage[] = [];
  for (const msg of msgs) {
    const toolCalls = msg.metadata?.toolCalls as StoredToolCall[] | undefined;
    if (toolCalls && toolCalls.length > 0 && msg.sender_type === "claude") {
      for (const tc of toolCalls) {
        expanded.push({
          id: tc.toolCallId,
          sender_type: "claude",
          content: "",
          parsed: {
            type: "tool_result",
            toolName: tc.toolName,
            toolInput: tc.toolInput,
            toolCallId: tc.toolCallId,
            toolStatus: tc.status === "error" ? "error" : "done",
            toolResult: tc.result,
            exitCode: tc.exitCode,
          },
          timestamp: msg.timestamp,
        });
      }
      if (msg.content?.trim()) {
        expanded.push({ ...msg, metadata: { ...msg.metadata, toolCalls: undefined } });
      }
    } else {
      expanded.push(msg);
    }
  }
  return expanded;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function finalizeRunningTools(msgs: ChatMessage[]): ChatMessage[] {
  let changed = false;
  const result = msgs.map((m) => {
    if (m.parsed?.toolStatus === "running") {
      changed = true;
      return { ...m, parsed: { ...m.parsed, toolStatus: "done" as const } };
    }
    return m;
  });
  return changed ? result : msgs;
}

function findLastStreamingId(msgs: ChatMessage[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.sender_type === "claude" && m.parsed?.type === "streaming") return m.id;
    if (m.sender_type === "admin") break;
  }
  return null;
}

// ── Named constants ──────────────────────────────────────────────────────────

const WATCHDOG_POLL_MS = 15_000;
const WATCHDOG_MAX_CHECKS = 40;
const TYPING_CLEAR_MS = 3_000;
const EDIT_RECOVERY_TIMEOUT_MS = 120_000;

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UseChatSocketOptions {
  sessionStatus: string;
  activeSession: ClaudeSession | null;
  autoAccept: boolean;
  setSessions: React.Dispatch<React.SetStateAction<ClaudeSession[]>>;
  setLoadingSessions: React.Dispatch<React.SetStateAction<boolean>>;
  onSessionRemoved?: (sessionId: string) => void;
}

export interface UseChatSocketReturn {
  messages: ChatMessage[];
  isRunning: boolean;
  currentActivity: ActivityState | null;
  connected: boolean;
  reconnecting: boolean;
  presenceUsers: PresenceUser[];
  typingUsers: Set<string>;
  commandRunner: string | null;
  sessionUsage: SessionUsage | null;
  budgetLimits: BudgetLimits | null;
  contextUsage: ContextUsage | null;
  isCompacting: boolean;
  sessionModel: string;
  hasError: boolean;
  pendingInteractions: Map<string, string>;
  runStartTime: number | null;
  pendingCount: number;
  pendingQueue: string[];
  loadingMessages: boolean;
  runtimeLimited: boolean;
  aiPaused: boolean;
  aiPausedBy: string | null;

  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setSessionModel: React.Dispatch<React.SetStateAction<string>>;
  setSessionUsage: React.Dispatch<React.SetStateAction<SessionUsage | null>>;
  setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentActivity: React.Dispatch<React.SetStateAction<ActivityState | null>>;
  setLoadingMessages: React.Dispatch<React.SetStateAction<boolean>>;

  activeSessionRef: React.MutableRefObject<ClaudeSession | null>;
  initializedSessionsRef: React.MutableRefObject<Set<string>>;
  freshSessionsRef: React.MutableRefObject<Set<string>>;
  chatInputRef: React.RefObject<ChatInputHandle>;

  emit: (event: string, data?: unknown) => void;
  resetSessionState: () => void;
  handleSend: (content: string, attachments?: string[]) => void;
  handleInterrupt: () => void;
  handleRetryLast: () => void;
  handleSelectOption: (sessionId: string, choice: string) => void;
  handleConfirm: (sessionId: string, value: boolean) => void;
  handleAllowTool: (sessionId: string, toolName: string, scope: "session" | "once", toolCallId?: string, messageId?: string) => void;
  handleAnswerQuestion: (sessionId: string, answer: string) => void;
  handleAlwaysAllow: (sessionId: string, toolName: string, command: string, toolCallId?: string, messageId?: string) => void;
  handleEditMessage: (messageId: string, newContent: string) => void;
  handleDeleteMessage: (messageId: string) => void;
  handleEditQueueItem: (index: number, newContent: string) => void;
  handleDeleteQueueItem: (index: number) => void;
  handleResetRuntime: () => void;
}

export { type PresenceUser };

export function useChatSocket({
  sessionStatus,
  activeSession,
  autoAccept,
  setSessions,
  setLoadingSessions,
  onSessionRemoved,
}: UseChatSocketOptions): UseChatSocketReturn {
  // ── State ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentActivity, setCurrentActivity] = useState<ActivityState | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [commandRunner, setCommandRunner] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState(DEFAULT_MODEL);
  const [sessionUsage, setSessionUsage] = useState<SessionUsage | null>(null);
  const [budgetLimits, setBudgetLimits] = useState<BudgetLimits | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [pendingInteractions, setPendingInteractions] = useState<Map<string, string>>(new Map());
  const [hasError, setHasError] = useState(false);
  const [runStartTime, setRunStartTime] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [runtimeLimited, setRuntimeLimited] = useState(false);
  const [aiPaused, setAiPaused] = useState(false);
  const [aiPausedBy, setAiPausedBy] = useState<string | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const lastUserMsgRef = useRef<string>("");
  const activeSessionRef = useRef<ClaudeSession | null>(null);
  const initializedSessionsRef = useRef<Set<string>>(new Set());
  const freshSessionsRef = useRef<Set<string>>(new Set());
  const autoAcceptRef = useRef(false);
  const streamingMsgIdRef = useRef<string | null>(null);
  const turnDoneRef = useRef(false);
  const pendingQueueRef = useRef<string[]>([]);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const doneWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSessionRemovedRef = useRef(onSessionRemoved);
  const watchdogChecksRef = useRef(0);
  const editRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInteractionsRef = useRef<Map<string, string>>(new Map());
  const isCompactingRef = useRef(false);
  const autoCompactFiredRef = useRef(false);

  // ── Sync refs ──────────────────────────────────────────────────────────
  useEffect(() => {
    autoAcceptRef.current = autoAccept;
  }, [autoAccept]);

  useEffect(() => {
    onSessionRemovedRef.current = onSessionRemoved;
  }, [onSessionRemoved]);

  useEffect(() => {
    pendingInteractionsRef.current = pendingInteractions;
  }, [pendingInteractions]);

  useEffect(() => {
    if (!isRunning) {
      setRunStartTime(null);

      // When isRunning goes false but no pending interactions exist,
      // scan for unresolved permission_request or user_question and restore them.
      if (pendingInteractionsRef.current.size === 0) {
        setMessages((prev) => {
          const unresolvedInteractions = new Map<string, string>();
          for (const m of prev) {
            if (m.parsed?.type === "permission_request" || m.parsed?.type === "user_question") {
              const doneAfter = prev.some(
                (later, i) => i > prev.indexOf(m) && later.parsed?.type === "done",
              );
              if (!doneAfter) {
                unresolvedInteractions.set(m.id, m.parsed.type);
              }
            }
          }
          if (unresolvedInteractions.size > 0) {
            setPendingInteractions(new Map(unresolvedInteractions));
          }
          return prev;
        });
      }
    } else if (runStartTime === null) {
      setRunStartTime(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // ── Helpers ────────────────────────────────────────────────────────────
  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  const sendImmediate = useCallback(
    (content: string, sessionId: string, attachments?: string[]) => {
      streamingMsgIdRef.current = null;
      turnDoneRef.current = false;
      lastUserMsgRef.current = content;
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        sender_type: "admin",
        content,
        timestamp: new Date().toISOString(),
        metadata: attachments?.length ? { attachments } : undefined,
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(true);
      setRunStartTime(Date.now());
      setHasError(false);
      emit("claude:message", { sessionId, content, attachments });
    },
    [emit],
  );

  const syncQueue = useCallback((queue: string[]) => {
    pendingQueueRef.current = queue;
    setPendingCount(queue.length);
    setPendingQueue([...queue]);
  }, []);

  const drainPending = useCallback(() => {
    const sessionId = activeSessionRef.current?.id;
    if (!sessionId) return;
    if (pendingQueueRef.current.length > 0) {
      const [next, ...rest] = pendingQueueRef.current;
      syncQueue(rest);
      sendImmediate(next, sessionId);
    }
  }, [sendImmediate, syncQueue]);

  const clearEditRecoveryTimer = useCallback(() => {
    if (editRecoveryTimerRef.current) {
      clearTimeout(editRecoveryTimerRef.current);
      editRecoveryTimerRef.current = null;
    }
  }, []);

  const resetSessionState = useCallback(() => {
    streamingMsgIdRef.current = null;
    turnDoneRef.current = false;
    setMessages([]);
    setCurrentActivity(null);
    setCommandRunner(null);
    setTypingUsers(new Set());
    syncQueue([]);
  }, [syncQueue]);

  // ── Watchdog ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) {
      if (doneWatchdogRef.current) {
        clearTimeout(doneWatchdogRef.current);
        doneWatchdogRef.current = null;
      }
      watchdogChecksRef.current = 0;
      return;
    }
    watchdogChecksRef.current = 0;
    const poll = () => {
      // Don't count ticks while waiting for user input (permission / question)
      if (pendingInteractionsRef.current.size > 0) {
        watchdogChecksRef.current = 0;
        doneWatchdogRef.current = setTimeout(poll, WATCHDOG_POLL_MS);
        return;
      }
      watchdogChecksRef.current++;
      const session = activeSessionRef.current;
      if (session && socketRef.current?.connected) {
        socketRef.current.emit("claude:get_session_state", { sessionId: session.id });
      }
      if (watchdogChecksRef.current >= WATCHDOG_MAX_CHECKS) {
        setIsRunning(false);
        setCurrentActivity(null);
        drainPending();
        setMessages((prev) => [
          ...finalizeRunningTools(prev),
          {
            id: crypto.randomUUID(),
            sender_type: "claude",
            parsed: { type: "error", message: "Response timed out. You can retry your message." },
            content: "Response timed out. You can retry your message.",
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      doneWatchdogRef.current = setTimeout(poll, WATCHDOG_POLL_MS);
    };
    doneWatchdogRef.current = setTimeout(poll, WATCHDOG_POLL_MS);
    return () => {
      if (doneWatchdogRef.current) clearTimeout(doneWatchdogRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // ── Socket setup ───────────────────────────────────────────────────────
  useEffect(() => {
    socketRef.current = getSocket();
    const socket = socketRef.current;

    const handleConnect = () => {
      console.log("[socket] connected via", socket.io.engine.transport.name);
      setConnected(true);
      setReconnecting(false);
      socket.emit("claude:list_sessions");
      const session = activeSessionRef.current;
      if (session) {
        socket.emit("claude:rejoin_session", { sessionId: session.id });
        setLoadingMessages(true);
        socket.emit("claude:get_messages", { sessionId: session.id });
        socket.emit("claude:get_session_state", { sessionId: session.id });
      }
    };

    socket.on("connect", handleConnect);

    socket.on("disconnect", () => {
      setConnected(false);
      setReconnecting(false);
    });

    socket.on("connect_error", (err: Error & { description?: unknown }) => {
      console.warn("[socket] connect_error:", err.message, err.description ?? "");
      setConnected(false);

      if (err.message === "unauthorized") {
        // Auth was rejected — stop the reconnection loop and surface the error.
        // A page refresh will re-establish the session cookie.
        socket.disconnect();
        setReconnecting(false);
        setMessages((prev) => [
          ...prev,
          {
            id: "auth-error-" + Date.now(),
            sender_type: "claude",
            content: "Connection rejected — your session may have expired. Please refresh the page.",
            parsed: { type: "error", message: "Connection rejected — your session may have expired. Please refresh the page." },
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
      setReconnecting(true);
    });

    socket.on("reconnect_attempt", () => {
      setReconnecting(true);
    });

    socket.on("claude:sessions", ({ sessions: s }: { sessions: ClaudeSession[] }) => {
      setSessions(s);
      setLoadingSessions(false);
    });

    socket.on("claude:session_status", ({ sessionId, status }: { sessionId: string; status: string }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: status as ClaudeSession["status"] } : s)),
      );
    });

    socket.on("claude:session_renamed", ({ sessionId, name }: { sessionId: string; name: string }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, name } : s)),
      );
      if (activeSessionRef.current?.id === sessionId) {
        activeSessionRef.current = { ...activeSessionRef.current, name };
      }
    });

    socket.on("claude:session_removed", ({ sessionId }: { sessionId: string }) => {
      // Server pushed that this user was removed from a shared session
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionRef.current?.id === sessionId) {
        activeSessionRef.current = null;
        resetSessionState();
        setIsRunning(false);
      }
      if (onSessionRemovedRef.current) onSessionRemovedRef.current(sessionId);
    });

    socket.on("claude:presence_update", ({ presence }: { presence: PresenceUser[] }) => {
      setPresenceUsers(presence);
    });

    socket.on("claude:typing", ({ email: typingEmail, typing }: { email: string; typing: boolean }) => {
      const timers = typingTimersRef.current;
      if (typing) {
        setTypingUsers((prev) => new Set(Array.from(prev).concat(typingEmail)));
        if (timers.has(typingEmail)) clearTimeout(timers.get(typingEmail)!);
        timers.set(
          typingEmail,
          setTimeout(() => {
            setTypingUsers((prev) => { const next = new Set(prev); next.delete(typingEmail); return next; });
            timers.delete(typingEmail);
          }, TYPING_CLEAR_MS),
        );
      } else {
        setTypingUsers((prev) => { const next = new Set(prev); next.delete(typingEmail); return next; });
        if (timers.has(typingEmail)) { clearTimeout(timers.get(typingEmail)!); timers.delete(typingEmail); }
      }
    });

    socket.on("claude:command_started", ({ sessionId, submittedBy }: { sessionId: string; submittedBy: string }) => {
      if (activeSessionRef.current?.id === sessionId) setCommandRunner(submittedBy);
    });

    socket.on("claude:command_done", ({ sessionId }: { sessionId: string }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setCommandRunner(null);
        clearEditRecoveryTimer();
        socket.emit("claude:get_usage", { sessionId });
      }
    });

    socket.on(
      "claude:messages",
      ({ sessionId, messages: msgs }: { sessionId: string; messages: ChatMessage[] }) => {
        if (activeSessionRef.current?.id === sessionId) {
          const expanded = expandToolCallsFromMetadata(msgs);
          setMessages(expanded);
          setLoadingMessages(false);
          streamingMsgIdRef.current = null;
          turnDoneRef.current = false;

          // Restore pending interactions for unresolved permissions/questions after reconnect
          const restored = new Map<string, string>();
          for (const m of expanded) {
            if (m.parsed?.type === "permission_request" || m.parsed?.type === "user_question") {
              const idx = expanded.indexOf(m);
              const doneAfter = expanded.some(
                (later, i) => i > idx && later.parsed?.type === "done",
              );
              if (!doneAfter) {
                restored.set(m.id, m.parsed.type);
              }
            }
          }
          if (restored.size > 0) {
            setPendingInteractions(new Map(restored));
          }
        }
      },
    );

    socket.on(
      "claude:session_ready",
      ({ sessionId: readySessionId, running, status }: { sessionId: string; running?: boolean; status?: string }) => {
        setIsRunning(!!running);
        if (status) {
          setSessions((prev) =>
            prev.map((s) => (s.id === readySessionId ? { ...s, status: status as ClaudeSession["status"] } : s)),
          );
        }
      },
    );

    socket.on(
      "claude:output",
      ({ sessionId, parsed }: { sessionId: string; parsed: ParsedOutput }) => {
        if (!activeSessionRef.current || activeSessionRef.current.id !== sessionId) return;

        // Any output from the server means the session is alive — reset watchdog
        watchdogChecksRef.current = 0;

        if (parsed.type === "done") {
          turnDoneRef.current = true;
          const streamId = streamingMsgIdRef.current;
          streamingMsgIdRef.current = null;
          clearEditRecoveryTimer();
          setCurrentActivity(null);

          const hasWaitingInteractions = pendingInteractionsRef.current.size > 0;

          if (hasWaitingInteractions) {
            return;
          }

          setIsRunning(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.parsed?.type === "done") return prev;
            if (last?.parsed?.type === "error" && last.parsed.retryable) {
              return finalizeRunningTools(prev);
            }
            // Finalize any streaming message into a "text" type so it
            // gets the usage badge and timestamp footer in the UI.
            let resolved = finalizeRunningTools(prev);
            const targetId = streamId ?? findLastStreamingId(resolved);
            if (targetId) {
              resolved = resolved.map((m) =>
                m.id === targetId && m.parsed?.type === "streaming"
                  ? { ...m, parsed: { ...m.parsed, type: "text" } }
                  : m,
              );
            }
            return [
              ...resolved,
              {
                id: crypto.randomUUID(),
                sender_type: "claude",
                parsed: { type: "done" },
                content: "",
                timestamp: new Date().toISOString(),
              },
            ];
          });
          drainPending();
          return;
        }

        if (parsed.type === "progress") {
          setCurrentActivity((prev) => ({
            toolName: parsed.toolName ?? "…",
            message: parsed.message ?? `Using ${parsed.toolName ?? "tool"}`,
            toolInput: parsed.toolInput,
            count: (prev?.count ?? 0) + 1,
          }));
          setIsRunning(true);
          return;
        }

        if (parsed.type === "tool_call") {
          setCurrentActivity({
            toolName: parsed.toolName ?? "tool",
            message: `Using ${parsed.toolName ?? "tool"}`,
            toolInput: parsed.toolInput,
            count: 0,
          });
          setMessages((prev) => {
            if (parsed.toolCallId && prev.some((m) => m.id === parsed.toolCallId || m.parsed?.toolCallId === parsed.toolCallId)) {
              return prev;
            }
            return [
              ...prev,
              {
                id: parsed.toolCallId ?? crypto.randomUUID(),
                sender_type: "claude",
                parsed,
                content: "",
                timestamp: new Date().toISOString(),
              },
            ];
          });
          setIsRunning(true);
          return;
        }

        if (parsed.type === "tool_result") {
          setMessages((prev) => {
            const idx = parsed.toolCallId
              ? prev.findIndex((m) => m.id === parsed.toolCallId || m.parsed?.toolCallId === parsed.toolCallId)
              : -1;
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                parsed: {
                  ...updated[idx].parsed!,
                  type: "tool_result",
                  toolStatus: parsed.toolStatus,
                  toolResult: parsed.toolResult,
                  exitCode: parsed.exitCode,
                },
              };
              return updated;
            }
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender_type: "claude",
                parsed,
                content: "",
                timestamp: new Date().toISOString(),
              },
            ];
          });
          return;
        }

        if (parsed.type === "confirm" && autoAcceptRef.current) {
          socket.emit("claude:confirm", { sessionId, value: true });
          setIsRunning(true);
          return;
        }

        if (parsed.type === "error") {
          setIsRunning(false);
          setHasError(true);
          setCurrentActivity(null);
          setMessages((prev) => [
            ...finalizeRunningTools(prev),
            {
              id: crypto.randomUUID(),
              sender_type: "claude" as const,
              parsed,
              content: parsed.message ?? "",
              timestamp: new Date().toISOString(),
            },
          ]);
          return;
        }

        setIsRunning(true);

        if (parsed.type === "options" || parsed.type === "confirm" || parsed.type === "permission_request" || parsed.type === "user_question") {
          const interactionId = crypto.randomUUID();
          setPendingInteractions((prev) => {
            const next = new Map(prev);
            next.set(interactionId, parsed.type!);
            return next;
          });
          setMessages((prev) => [
            ...prev,
            {
              id: interactionId,
              sender_type: "claude" as const,
              parsed,
              content: parsed.content ?? parsed.prompt ?? "",
              timestamp: new Date().toISOString(),
            },
          ]);
          return;
        }

        if (parsed.type === "streaming") {
          if (turnDoneRef.current) return;
          setMessages((prev) => {
            const refId = streamingMsgIdRef.current;
            if (refId) {
              const idx = prev.findIndex((m) => m.id === refId);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], content: parsed.content ?? "", parsed };
                return updated;
              }
            }
            // Ref was lost (e.g. reconnect cleared it) — find the last
            // Claude streaming message and update it to avoid duplicates.
            for (let i = prev.length - 1; i >= 0; i--) {
              const m = prev[i];
              if (m.sender_type === "claude" && m.parsed?.type === "streaming") {
                streamingMsgIdRef.current = m.id;
                const updated = [...prev];
                updated[i] = { ...m, content: parsed.content ?? "", parsed };
                return updated;
              }
              if (m.sender_type === "admin") break;
            }
            const newId = crypto.randomUUID();
            streamingMsgIdRef.current = newId;
            return [
              ...prev,
              {
                id: newId,
                sender_type: "claude" as const,
                parsed,
                content: parsed.content ?? "",
                timestamp: new Date().toISOString(),
              },
            ];
          });
          return;
        }

        setMessages((prev) => {
          const refId = streamingMsgIdRef.current;
          let idx = refId ? prev.findIndex((m) => m.id === refId) : -1;
          if (idx < 0 && parsed.type === "text" && parsed.content) {
            const incoming = parsed.content;
            for (let i = prev.length - 1; i >= 0; i--) {
              const m = prev[i];
              if (m.sender_type === "admin") break;
              if (
                m.sender_type === "claude" &&
                (m.parsed?.type === "streaming" || m.parsed?.type === "text") &&
                m.content
              ) {
                if (m.content === incoming || incoming.startsWith(m.content)) {
                  idx = i;
                  break;
                }
              }
            }
          }
          const finalMsg: ChatMessage = {
            id: idx >= 0 ? prev[idx].id : crypto.randomUUID(),
            sender_type: "claude",
            parsed,
            content: parsed.content ?? parsed.message ?? "",
            timestamp: new Date().toISOString(),
          };
          streamingMsgIdRef.current = null;
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = finalMsg;
            return updated;
          }
          return [...prev, finalMsg];
        });
      },
    );

    socket.on("claude:usage", ({ sessionId, usage }: { sessionId: string; usage: { input_tokens: number; output_tokens: number; cost_usd?: number; context_window?: number; context_input_tokens?: number } }) => {
      if (activeSessionRef.current?.id !== sessionId) return;
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].sender_type === "claude" && updated[i].parsed?.type !== "done") {
            updated[i] = { ...updated[i], metadata: { ...updated[i].metadata, usage } };
            break;
          }
        }
        return updated;
      });
      setSessionUsage({
        total_input_tokens: usage.input_tokens ?? 0,
        total_output_tokens: usage.output_tokens ?? 0,
        total_cost_usd: usage.cost_usd ?? 0,
      });

      if (usage.context_input_tokens && usage.context_input_tokens > 0) {
        const ctxWindow = (usage.context_window && usage.context_window > 0) ? usage.context_window : 200_000;
        const pct = Math.min(100, Math.round((usage.context_input_tokens / ctxWindow) * 100));
        setContextUsage({ inputTokens: usage.context_input_tokens, contextWindow: ctxWindow, percentage: pct });

        if (pct >= 93 && !isCompactingRef.current && !autoCompactFiredRef.current) {
          autoCompactFiredRef.current = true;
          isCompactingRef.current = true;
          setIsCompacting(true);
          socket.emit("claude:message", { sessionId, content: "/compact" });
        }

        if (pct < 80) {
          autoCompactFiredRef.current = false;
        }
      }
    });

    socket.on("claude:session_usage", ({ sessionId, usage, budgetLimits: bl }: { sessionId: string; usage: SessionUsage; budgetLimits?: BudgetLimits }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setSessionUsage(usage);
        if (bl) setBudgetLimits(bl);
      }
    });

    socket.on("claude:compacting", ({ sessionId: compactSessionId }: { sessionId: string }) => {
      if (activeSessionRef.current?.id === compactSessionId) {
        isCompactingRef.current = true;
        setIsCompacting(true);
      }
    });

    socket.on("claude:compact_done", ({ sessionId: compactSessionId }: { sessionId: string }) => {
      if (activeSessionRef.current?.id === compactSessionId) {
        isCompactingRef.current = false;
        setIsCompacting(false);
        socket.emit("claude:get_usage", { sessionId: compactSessionId });
        setMessages((prev) => [
          ...prev,
          {
            id: "compact-" + Date.now(),
            sender_type: "claude",
            content: "Context window compacted. Summary of previous conversation has been preserved.",
            parsed: { type: "text", content: "Context window compacted. Summary of previous conversation has been preserved." },
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    });

    socket.on("claude:model_changed", ({ sessionId, model }: { sessionId: string; model: string }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setSessionModel(model);
      }
    });

    socket.on("claude:messages_updated", ({ sessionId, messages: msgs }: { sessionId: string; messages: ChatMessage[] }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setMessages(msgs);
        setIsRunning(true);
        clearEditRecoveryTimer();
        editRecoveryTimerRef.current = setTimeout(() => {
          setIsRunning((current) => {
            if (current) {
              console.warn("[chat] isRunning stuck after message edit, resetting");
            }
            return false;
          });
        }, EDIT_RECOVERY_TIMEOUT_MS);
      }
    });

    socket.on("claude:message_deleted", ({ sessionId, messageId }: { sessionId: string; messageId: string }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    });

    socket.on("claude:session_state", ({ sessionId, running }: { sessionId: string; running: boolean }) => {
      if (activeSessionRef.current?.id !== sessionId) return;
      if (running) {
        setIsRunning(true);
        watchdogChecksRef.current = 0;
      } else {
        // Don't mark idle while the user has pending permissions/questions to act on
        if (pendingInteractionsRef.current.size === 0) {
          setIsRunning(false);
          drainPending();
        }
        setCurrentActivity(null);
        setMessages((prev) => finalizeRunningTools(prev));
      }
    });

    socket.on("claude:error", ({ message }: { message: string }) => {
      streamingMsgIdRef.current = null;
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        sender_type: "claude",
        parsed: { type: "error", message },
        content: message,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...finalizeRunningTools(prev), msg]);
      setIsRunning(false);
      setCurrentActivity(null);
      setHasError(true);
    });

    socket.on("claude:rate_limited", ({ reason }: { reason?: string }) => {
      const text = reason ?? "You are being rate limited. Please wait before sending more messages.";
      const isRuntimeLimit = !!reason && reason.toLowerCase().includes("runtime");
      if (isRuntimeLimit) {
        setRuntimeLimited(true);
      }
      const msg: ChatMessage = {
        id: "rate-limited-" + Date.now(),
        sender_type: "claude",
        content: text,
        parsed: { type: "error", message: text },
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(false);
    });

    socket.on("claude:runtime_reset", () => {
      setRuntimeLimited(false);
    });

    socket.on("claude:budget_exceeded", ({ message, type }: { message?: string; type?: string }) => {
      const content = message ?? `Budget limit exceeded${type ? ` (${type})` : ""}. Please contact an admin.`;
      const msg: ChatMessage = {
        id: "budget-exceeded-" + Date.now(),
        sender_type: "claude",
        content,
        parsed: { type: "error", message: content },
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(false);
    });

    socket.on("claude:budget_warning", ({ message }: { message?: string }) => {
      const content = message ?? "Approaching budget limit. Usage may be restricted soon.";
      const msg: ChatMessage = {
        id: "budget-warning-" + Date.now(),
        sender_type: "claude",
        content,
        parsed: { type: "text", content },
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("claude:chat_toggled", ({ sessionId, paused, pausedBy }: { sessionId: string; paused: boolean; pausedBy: string | null }) => {
      if (activeSessionRef.current?.id !== sessionId) return;
      setAiPaused(paused);
      setAiPausedBy(pausedBy);
    });

    socket.on("claude:chat_broadcast", ({ sessionId, message, fromSocketId }: { sessionId: string; message: ChatMessage; fromSocketId: string }) => {
      if (activeSessionRef.current?.id !== sessionId) return;
      if (fromSocketId === socket.id) return;
      setMessages((prev) => [...prev, message]);
    });

    socket.on("security:warn", ({ type: warnType, message: warnMessage }: { type: string; message: string }) => {
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        sender_type: "claude",
        parsed: { type: "security_warn", warnType, message: warnMessage },
        content: warnMessage,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(false);
      setCurrentActivity(null);
    });

    if (socket.connected) {
      handleConnect();
    }

    if (sessionStatus === "authenticated") {
      connectSocket();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("reconnect_attempt");
      socket.off("claude:sessions");
      socket.off("claude:messages");
      socket.off("claude:session_ready");
      socket.off("claude:output");
      socket.off("claude:error");
      socket.off("claude:rate_limited");
      socket.off("claude:runtime_reset");
      socket.off("claude:budget_exceeded");
      socket.off("claude:budget_warning");
      socket.off("claude:session_state");
      socket.off("claude:presence_update");
      socket.off("claude:typing");
      socket.off("claude:command_started");
      socket.off("claude:command_done");
      socket.off("claude:usage");
      socket.off("claude:session_usage");
      socket.off("claude:model_changed");
      socket.off("claude:messages_updated");
      socket.off("claude:message_deleted");
      socket.off("claude:compacting");
      socket.off("claude:compact_done");
      socket.off("security:warn");
      socket.off("claude:chat_toggled");
      socket.off("claude:chat_broadcast");
      socket.off("claude:session_status");
      socket.off("claude:session_renamed");
      socket.off("claude:session_removed");
      clearEditRecoveryTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  // ── Active session change ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeSession || !connected) return;
    setSessionModel(activeSession.model ?? DEFAULT_MODEL);
    setSessionUsage(null);
    setBudgetLimits(null);
    setContextUsage(null);
    setIsCompacting(false);
    isCompactingRef.current = false;
    autoCompactFiredRef.current = false;
    setAiPaused(false);
    setAiPausedBy(null);
    emit("claude:get_chat_state", { sessionId: activeSession.id });
    if (!freshSessionsRef.current.has(activeSession.id)) {
      emit("claude:get_messages", { sessionId: activeSession.id });
      emit("claude:get_usage", { sessionId: activeSession.id });
    }
    freshSessionsRef.current.delete(activeSession.id);
    if (!initializedSessionsRef.current.has(activeSession.id)) {
      initializedSessionsRef.current.add(activeSession.id);
      emit("claude:create_session", {
        sessionId: activeSession.id,
        skipPermissions: activeSession.skip_permissions,
        model: activeSession.model,
        provider_type: activeSession.provider_type,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, connected]);

  // ── Action callbacks ───────────────────────────────────────────────────

  const handleSend = useCallback(
    (content: string, attachments?: string[]) => {
      if (!activeSession) return;
      if (isRunning) {
        syncQueue([...pendingQueueRef.current, content]);
        return;
      }
      sendImmediate(content, activeSession.id, attachments);
    },
    [activeSession, isRunning, sendImmediate, syncQueue],
  );

  const handleInterrupt = useCallback(() => {
    if (!activeSession) return;
    emit("claude:interrupt", { sessionId: activeSession.id });
    setIsRunning(false);
    setPendingInteractions(new Map());
    setCurrentActivity(null);
    setMessages((prev) => finalizeRunningTools(prev));
    syncQueue([]);
  }, [activeSession, emit, syncQueue]);

  const handleRetryLast = useCallback(() => {
    if (!lastUserMsgRef.current || !activeSession || isRunning) return;
    setMessages((prev) => {
      const cleaned = [...prev];
      while (cleaned.length > 0) {
        const last = cleaned[cleaned.length - 1];
        if (last.parsed?.type === "error" || last.parsed?.type === "done") {
          cleaned.pop();
        } else {
          break;
        }
      }
      return cleaned;
    });
    streamingMsgIdRef.current = null;
    setIsRunning(true);
    setHasError(false);
    emit("claude:message", { sessionId: activeSession.id, content: lastUserMsgRef.current });
  }, [activeSession, isRunning, emit]);

  const handleSelectOption = useCallback(
    (sessionId: string, choice: string) => {
      emit("claude:select_option", { sessionId, choice });
      setPendingInteractions(new Map());
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        sender_type: "admin",
        content: choice,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(true);
    },
    [emit],
  );

  const handleConfirm = useCallback(
    (sessionId: string, value: boolean) => {
      emit("claude:confirm", { sessionId, value });
      setPendingInteractions(new Map());
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        sender_type: "admin",
        content: value ? "Yes" : "No",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(true);
    },
    [emit],
  );

  const handleAllowTool = useCallback(
    (sessionId: string, toolName: string, scope: "session" | "once", toolCallId?: string, messageId?: string) => {
      emit("claude:allow_tool", { sessionId, toolName, scope, toolCallId });
      setPendingInteractions((prev) => {
        const next = new Map(prev);
        if (messageId) {
          next.delete(messageId);
        }
        if (next.size === 0) {
          setIsRunning(true);
        }
        return next;
      });
    },
    [emit],
  );

  const handleAnswerQuestion = useCallback(
    (sessionId: string, answer: string) => {
      emit("claude:answer_question", { sessionId, answer });
      setPendingInteractions(new Map());
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        sender_type: "admin",
        content: answer,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(true);
    },
    [emit],
  );

  const handleAlwaysAllow = useCallback(
    (sessionId: string, _toolName: string, command: string, toolCallId?: string, messageId?: string) => {
      emit("claude:always_allow_command", { pattern: command.trim().split(/\s+/)[0] });
      emit("claude:allow_tool", { sessionId, toolName: "Bash", scope: "once", toolCallId });
      setPendingInteractions((prev) => {
        const next = new Map(prev);
        if (messageId) {
          next.delete(messageId);
        } else {
          // Fallback: remove the first permission_request found
          for (const [msgId, type] of next) {
            if (type === "permission_request") {
              next.delete(msgId);
              break;
            }
          }
        }
        if (next.size === 0) {
          setIsRunning(true);
        }
        return next;
      });
    },
    [emit],
  );

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      if (!activeSession) return;
      lastUserMsgRef.current = newContent;
      emit("claude:edit_message", { sessionId: activeSession.id, messageId, newContent });
    },
    [activeSession, emit],
  );

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (!activeSession) return;
      emit("claude:delete_message", { sessionId: activeSession.id, messageId });
    },
    [activeSession, emit],
  );

  const handleEditQueueItem = useCallback(
    (index: number, newContent: string) => {
      const updated = [...pendingQueueRef.current];
      if (index < 0 || index >= updated.length) return;
      updated[index] = newContent;
      syncQueue(updated);
    },
    [syncQueue],
  );

  const handleDeleteQueueItem = useCallback(
    (index: number) => {
      const updated = [...pendingQueueRef.current];
      if (index < 0 || index >= updated.length) return;
      updated.splice(index, 1);
      syncQueue(updated);
    },
    [syncQueue],
  );

  const handleResetRuntime = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    emit("claude:reset_runtime", { sessionId: session.id });
  }, [emit]);

  return {
    messages, isRunning, currentActivity, connected, reconnecting,
    presenceUsers, typingUsers, commandRunner, sessionUsage, budgetLimits,
    contextUsage, isCompacting,
    sessionModel, hasError, pendingInteractions, runStartTime, pendingCount,
    pendingQueue, loadingMessages, runtimeLimited,
    aiPaused, aiPausedBy,
    setMessages, setSessionModel, setSessionUsage, setIsRunning,
    setCurrentActivity, setLoadingMessages,
    activeSessionRef, initializedSessionsRef, freshSessionsRef, chatInputRef,
    emit, resetSessionState, handleSend, handleInterrupt, handleRetryLast, handleSelectOption,
    handleConfirm, handleAllowTool, handleAnswerQuestion, handleAlwaysAllow,
    handleEditMessage, handleDeleteMessage, handleEditQueueItem, handleDeleteQueueItem,
    handleResetRuntime,
  };
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { getSocket, connectSocket } from "@/lib/socket";
import { MessageList } from "@/components/claude-code/message-list";
import { ChatInput } from "@/components/claude-code/chat-input";
import { apiUrl } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import type { ParsedOutput } from "@/lib/claude/provider";
import type { ChatInputHandle } from "@/components/claude-code/chat-input";
import { Wrench, RefreshCw } from "lucide-react";

const CUSTOMIZATION_SESSION_KEY = "claude:customization_session_id";

function generateSessionId(): string {
  return `customization_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

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

export function CustomizationSection() {
  const { status: sessionStatus } = useSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentActivity, setCurrentActivity] = useState<{
    toolName: string; message: string; toolInput?: unknown; count: number;
  } | null>(null);
  const [runStartTime, setRunStartTime] = useState<number | null>(null);
  const [pendingInteractions, setPendingInteractions] = useState<Map<string, string>>(new Map());
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [botAvatarUrl, setBotAvatarUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const sessionIdRef = useRef<string | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const turnDoneRef = useRef(false);
  const initializedRef = useRef(false);
  const pendingInteractionsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    pendingInteractionsRef.current = pendingInteractions;
  }, [pendingInteractions]);

  useEffect(() => {
    if (!isRunning) {
      setRunStartTime(null);
    } else if (runStartTime === null) {
      setRunStartTime(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  useEffect(() => {
    fetch(apiUrl("/api/bot-identity"))
      .then((r) => r.json())
      .then((d: { avatar?: string | null }) => setBotAvatarUrl(d.avatar ?? null))
      .catch(() => {});
  }, []);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  const initializeSession = useCallback((sid: string) => {
    if (!socketRef.current) return;
    const socket = socketRef.current;

    // Ask the server for the session list to check if our session already exists.
    // We listen for claude:sessions once to check, then either join or create.
    const onSessionsList = ({ sessions }: { sessions: { id: string }[] }) => {
      socket.off("claude:sessions", onSessionsList);
      const exists = sessions.some((s) => s.id === sid);
      if (exists) {
        // Rejoin existing session and load its messages
        socket.emit("claude:set_active_session", { sessionId: sid });
        setLoadingMessages(true);
        socket.emit("claude:get_messages", { sessionId: sid });
        setSessionReady(true);
        setInitializing(false);
      } else {
        // Create a fresh customization session
        socket.emit("claude:create_session", {
          sessionId: sid,
          interface_type: "customization_interface",
          skipPermissions: false,
        });
      }
    };

    socket.on("claude:sessions", onSessionsList);
    socket.emit("claude:list_sessions");
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || initializedRef.current) return;
    initializedRef.current = true;

    connectSocket();
    const socket = getSocket();
    socketRef.current = socket;

    // Restore or create a session ID
    let sid: string;
    try {
      sid = localStorage.getItem(CUSTOMIZATION_SESSION_KEY) ?? generateSessionId();
    } catch {
      sid = generateSessionId();
    }
    setSessionId(sid);
    sessionIdRef.current = sid;

    try {
      localStorage.setItem(CUSTOMIZATION_SESSION_KEY, sid);
    } catch { /* ignore */ }

    socket.on("connect", () => {
      initializeSession(sid);
    });

    socket.on("claude:session_ready", ({ sessionId: readySid, running }: { sessionId: string; running?: boolean }) => {
      if (readySid !== sessionIdRef.current) return;
      setIsRunning(!!running);
      setSessionReady(true);
      setInitializing(false);
    });

    socket.on("claude:messages", ({ sessionId: msgSid, messages: msgs }: { sessionId: string; messages: ChatMessage[] }) => {
      if (msgSid !== sessionIdRef.current) return;
      setMessages(msgs);
      setLoadingMessages(false);
    });

    socket.on("claude:output", ({ sessionId: outSid, parsed }: { sessionId: string; parsed: ParsedOutput }) => {
      if (outSid !== sessionIdRef.current) return;

      if (parsed.type === "done") {
        turnDoneRef.current = true;
        const streamId = streamingMsgIdRef.current;
        streamingMsgIdRef.current = null;
        setCurrentActivity(null);

        const hasWaiting = pendingInteractionsRef.current.size > 0;
        if (hasWaiting) return;

        setIsRunning(false);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.parsed?.type === "done") return prev;
          let resolved = finalizeRunningTools(prev);
          if (streamId) {
            resolved = resolved.map((m) =>
              m.id === streamId && m.parsed?.type === "streaming"
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
          return [...prev, {
            id: parsed.toolCallId ?? crypto.randomUUID(),
            sender_type: "claude",
            parsed,
            content: "",
            timestamp: new Date().toISOString(),
          }];
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
          return [...prev, {
            id: crypto.randomUUID(),
            sender_type: "claude",
            parsed,
            content: "",
            timestamp: new Date().toISOString(),
          }];
        });
        return;
      }

      setIsRunning(parsed.type !== "error");
      if (parsed.type === "error") {
        setHasError(true);
        setCurrentActivity(null);
        setMessages((prev) => finalizeRunningTools(prev));
      }

      if (parsed.type === "permission_request" || parsed.type === "user_question") {
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
          const newId = crypto.randomUUID();
          streamingMsgIdRef.current = newId;
          return [...prev, {
            id: newId,
            sender_type: "claude",
            parsed,
            content: parsed.content ?? "",
            timestamp: new Date().toISOString(),
          }];
        });
        setIsRunning(true);
        return;
      }

      if (parsed.type === "text") {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sender_type: "claude",
            parsed,
            content: parsed.content ?? "",
            timestamp: new Date().toISOString(),
          },
        ]);
        setIsRunning(true);
        return;
      }
    });

    socket.on("claude:error", ({ sessionId: errSid, message }: { sessionId: string; message: string }) => {
      if (errSid !== sessionIdRef.current) return;
      setIsRunning(false);
      setHasError(true);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender_type: "claude",
          parsed: { type: "error", content: message, retryable: false },
          content: message,
          timestamp: new Date().toISOString(),
        },
      ]);
    });

    if (socket.connected) {
      initializeSession(sid);
    }

    return () => {
      socket.off("connect");
      socket.off("claude:session_ready");
      socket.off("claude:messages");
      socket.off("claude:output");
      socket.off("claude:error");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  const handleSend = useCallback((content: string) => {
    const sid = sessionIdRef.current;
    if (!sid || !sessionReady || isRunning) return;
    streamingMsgIdRef.current = null;
    turnDoneRef.current = false;
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        sender_type: "admin",
        content,
        timestamp: new Date().toISOString(),
      },
    ]);
    setIsRunning(true);
    setRunStartTime(Date.now());
    setHasError(false);
    emit("claude:message", { sessionId: sid, content });
  }, [sessionReady, isRunning, emit]);

  const handleInterrupt = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    emit("claude:interrupt", { sessionId: sid });
    setIsRunning(false);
    setCurrentActivity(null);
  }, [emit]);

  const handleAllowTool = useCallback((sid: string, toolName: string, scope: "session" | "once", toolCallId?: string, messageId?: string) => {
    setPendingInteractions((prev) => {
      const next = new Map(prev);
      if (messageId) next.delete(messageId);
      return next;
    });
    emit("claude:allow_tool", { sessionId: sid, toolName, scope, toolCallId });
    setIsRunning(true);
  }, [emit]);

  const handleAnswerQuestion = useCallback((sid: string, answer: string) => {
    emit("claude:answer_question", { sessionId: sid, answer });
    setPendingInteractions(new Map());
    setIsRunning(true);
  }, [emit]);

  const handleConfirm = useCallback((sid: string, value: boolean) => {
    emit("claude:confirm", { sessionId: sid, value });
    setPendingInteractions(new Map());
    setIsRunning(true);
  }, [emit]);

  const handleSelectOption = useCallback((sid: string, choice: string) => {
    emit("claude:select_option", { sessionId: sid, choice });
    setPendingInteractions(new Map());
    setIsRunning(true);
  }, [emit]);

  const handleNewSession = useCallback(() => {
    const sid = generateSessionId();
    try { localStorage.setItem(CUSTOMIZATION_SESSION_KEY, sid); } catch { /* ignore */ }
    setSessionId(sid);
    sessionIdRef.current = sid;
    setMessages([]);
    setIsRunning(false);
    setSessionReady(false);
    setInitializing(true);
    setCurrentActivity(null);
    setPendingInteractions(new Map());
    setHasError(false);
    streamingMsgIdRef.current = null;
    turnDoneRef.current = false;

    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit("claude:create_session", {
        sessionId: sid,
        interface_type: "customization_interface",
        skipPermissions: false,
      });
    }
  }, []);

  return (
    <div className="flex flex-col h-full mx-auto max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-bot-accent" />
            <h2 className="text-subtitle font-bold text-bot-text">Customization</h2>
          </div>
          <p className="text-caption text-bot-muted mt-1">
            Chat with Claude to customize and extend this platform — add features, modify behavior, update configuration.
          </p>
        </div>
        <button
          onClick={handleNewSession}
          title="Start a new customization session"
          className="flex items-center gap-1.5 rounded-lg border border-bot-border px-3 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          New session
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm overflow-hidden">
        {initializing ? (
          <div className="flex-1 flex items-center justify-center text-bot-muted text-caption gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/60 animate-bounce [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/40 animate-bounce [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/20 animate-bounce [animation-delay:300ms]" />
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <MessageList
                messages={messages}
                sessionId={sessionId ?? ""}
                onSelectOption={handleSelectOption}
                onConfirm={handleConfirm}
                onAllowTool={handleAllowTool}
                onAnswerQuestion={handleAnswerQuestion}
                isRunning={isRunning}
                currentActivity={currentActivity}
                pendingInteractions={pendingInteractions}
                loadingMessages={loadingMessages}
                botAvatarUrl={botAvatarUrl}
                runStartTime={runStartTime}
                onSendStarter={handleSend}
              />
            </div>
            <div className="shrink-0 border-t border-bot-border/20 p-3">
              {isRunning && (
                <div className="flex justify-end mb-2">
                  <button
                    onClick={handleInterrupt}
                    className="text-caption text-bot-red hover:text-bot-red/80 transition-colors"
                  >
                    Stop
                  </button>
                </div>
              )}
              <ChatInput
                ref={chatInputRef}
                onSend={handleSend}
                disabled={!sessionReady || (isRunning && pendingInteractions.size === 0)}
                isRunning={isRunning}
                sessionId={sessionId ?? undefined}
              />
              {hasError && (
                <p className="mt-2 text-[11px] text-bot-red/70 text-center">
                  An error occurred. You can continue chatting or start a new session.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

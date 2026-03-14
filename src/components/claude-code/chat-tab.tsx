"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { getSocket, connectSocket } from "@/lib/socket";
import type { ParsedOutput } from "@/lib/claude/provider";
import type { ClaudeSession } from "@/lib/claude-db";
import { DEFAULT_MODEL } from "@/lib/models";
import type { AvatarState } from "@/lib/avatar-state";
import { SessionSidebar } from "./session-sidebar";
import { MessageList, type ChatMessage, type ActivityState } from "./message-list";
import { ChatInput, type ChatInputHandle } from "./chat-input";
import { ChatToolbar } from "./chat-toolbar";
import { NewSessionDialog } from "./new-session-dialog";
import { SkipPermissionsBanner } from "./skip-permissions-banner";
import { SessionSearchBar } from "./session-search-bar";
import { GlobalSearchDialog } from "./global-search-dialog";

type PresenceUser = { email: string; activeSession: string | null };

interface SessionUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

export function ChatTab() {
  const { status: sessionStatus } = useSession();
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [activeSession, setActiveSession] = useState<ClaudeSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentActivity, setCurrentActivity] = useState<ActivityState | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [commandRunner, setCommandRunner] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState(DEFAULT_MODEL);
  const [sessionUsage, setSessionUsage] = useState<SessionUsage | null>(null);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const lastUserMsgRef = useRef<string>("");
  const activeSessionRef = useRef<ClaudeSession | null>(null);
  const initializedSessionsRef = useRef<Set<string>>(new Set());
  const freshSessionsRef = useRef<Set<string>>(new Set());
  const autoAcceptRef = useRef(false);
  const streamingMsgIdRef = useRef<string | null>(null);

  // Pending message queue (typed while Claude is running)
  const pendingQueueRef = useRef<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  // Watchdog timer: if isRunning stays true for too long, force-reset
  const doneWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending interactive message (options/confirm/permission_request)
  const [pendingInteraction, setPendingInteraction] = useState<{ type: string; messageId: string } | null>(null);

  // Track whether last event was an error (for avatar state)
  const [hasError, setHasError] = useState(false);

  // Search state
  const [showSessionSearch, setShowSessionSearch] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [searchHighlights, setSearchHighlights] = useState<Set<string>>(new Set());
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);

  // Compute avatar state from current interaction state
  const avatarState: AvatarState = useMemo(() => {
    if (hasError) return "error";
    if (pendingInteraction) return "questioning";
    if (currentActivity) return "working";
    if (isRunning) return "thinking";
    return "waiting";
  }, [hasError, pendingInteraction, currentActivity, isRunning]);

  // Keep autoAcceptRef in sync
  useEffect(() => {
    autoAcceptRef.current = autoAccept;
  }, [autoAccept]);

  // Browser tab title badge: show count of sessions needing attention
  useEffect(() => {
    const needsAttention = sessions.filter((s) => s.status === "needs_attention").length;
    const baseTitle = "Claude Bot";
    document.title = needsAttention > 0 ? `(${needsAttention}) ${baseTitle}` : baseTitle;
  }, [sessions]);

  // Heartbeat: while isRunning, periodically ask server if Claude is still running.
  // Catches cases where the "done" event was lost (socket blip, race condition).
  useEffect(() => {
    if (!isRunning) {
      if (doneWatchdogRef.current) {
        clearTimeout(doneWatchdogRef.current);
        doneWatchdogRef.current = null;
      }
      return;
    }
    let checks = 0;
    const poll = () => {
      checks++;
      const session = activeSessionRef.current;
      if (session && socketRef.current?.connected) {
        socketRef.current.emit("claude:get_session_state", { sessionId: session.id });
      }
      // After 5 minutes of running with no response, force-reset
      if (checks >= 20) {
        setIsRunning(false);
        setCurrentActivity(null);
        drainPending();
        setMessages((prev) => [
          ...prev,
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
      doneWatchdogRef.current = setTimeout(poll, 15_000);
    };
    doneWatchdogRef.current = setTimeout(poll, 15_000);
    return () => {
      if (doneWatchdogRef.current) clearTimeout(doneWatchdogRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setShowGlobalSearch(true);
        return;
      }
      if (mod && e.key === "f" && activeSession) {
        e.preventDefault();
        setShowSessionSearch(true);
        return;
      }
      // Ctrl+/ or Cmd+/ — focus chat input
      if (mod && e.key === "/") {
        e.preventDefault();
        chatInputRef.current?.focus();
        return;
      }
      // Ctrl+Shift+C — copy last Claude message
      if (mod && e.shiftKey && e.key === "C") {
        e.preventDefault();
        const lastClaude = [...messages].reverse().find(
          (m) => m.sender_type === "claude" && (m.content || m.parsed?.content),
        );
        if (lastClaude) {
          const text = lastClaude.content ?? lastClaude.parsed?.content ?? "";
          navigator.clipboard.writeText(text);
        }
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSession, messages]);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  // Internal send — always dispatches immediately (no queue check)
  const sendImmediate = useCallback(
    (content: string, sessionId: string, attachments?: string[]) => {
      streamingMsgIdRef.current = null;
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
      setHasError(false);
      emit("claude:message", { sessionId, content, attachments });
    },
    [emit],
  );

  // Drain next pending message when Claude finishes
  const drainPending = useCallback(() => {
    const sessionId = activeSessionRef.current?.id;
    if (!sessionId) return;
    if (pendingQueueRef.current.length > 0) {
      const [next, ...rest] = pendingQueueRef.current;
      pendingQueueRef.current = rest;
      setPendingCount(rest.length);
      sendImmediate(next, sessionId);
    }
  }, [sendImmediate]);

  // Connect socket only after NextAuth session is confirmed (avoids
  // racing the cookie on the first post-login navigation).
  useEffect(() => {
    if (sessionStatus === "authenticated") {
      connectSocket();
    }
  }, [sessionStatus]);

  // Setup socket listeners once
  useEffect(() => {
    socketRef.current = getSocket();
    const socket = socketRef.current;

    socket.on("connect", () => {
      setConnected(true);
      setReconnecting(false);
      socket.emit("claude:list_sessions");
      // Rejoin the active session room after reconnect so we receive output events
      const session = activeSessionRef.current;
      if (session && initializedSessionsRef.current.has(session.id)) {
        socket.emit("claude:create_session", {
          sessionId: session.id,
          skipPermissions: session.skip_permissions,
          model: session.model,
          provider_type: session.provider_type,
        });
        // Re-fetch authoritative messages from server on reconnect
        setLoadingMessages(true);
        socket.emit("claude:get_messages", { sessionId: session.id });
        // Sync running state after reconnect
        socket.emit("claude:get_session_state", { sessionId: session.id });
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setReconnecting(false);
    });

    socket.on("connect_error", () => {
      setConnected(false);
      setReconnecting(true);
    });

    socket.on("reconnect_attempt", () => {
      setReconnecting(true);
    });

      socket.on("claude:sessions", ({ sessions: s }: { sessions: ClaudeSession[] }) => {
      setSessions(s);
      setLoadingSessions(false);
    });

    // Session status updates (background persistence)
    socket.on("claude:session_status", ({ sessionId, status }: { sessionId: string; status: string }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: status as ClaudeSession["status"] } : s)),
      );
    });

    socket.on("claude:presence_update", ({ presence }: { presence: PresenceUser[] }) => {
      setPresenceUsers(presence);
    });

    socket.on("claude:typing", ({ email: typingEmail, typing }: { email: string; typing: boolean }) => {
      const timers = typingTimersRef.current;
      if (typing) {
        setTypingUsers((prev) => new Set(Array.from(prev).concat(typingEmail)));
        // Auto-clear after 3s in case stop event is missed
        if (timers.has(typingEmail)) clearTimeout(timers.get(typingEmail)!);
        timers.set(
          typingEmail,
          setTimeout(() => {
            setTypingUsers((prev) => { const next = new Set(prev); next.delete(typingEmail); return next; });
            timers.delete(typingEmail);
          }, 3000),
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
        // Refresh session usage
        socket.emit("claude:get_usage", { sessionId });
      }
    });

    socket.on(
      "claude:messages",
      ({ sessionId, messages: msgs }: { sessionId: string; messages: ChatMessage[] }) => {
        if (activeSessionRef.current?.id === sessionId) {
          setMessages(msgs);
          setLoadingMessages(false);
        }
      },
    );

    socket.on(
      "claude:session_ready",
      ({ sessionId: readySessionId, running, status }: { sessionId: string; running?: boolean; status?: string }) => {
        if (running) {
          setIsRunning(true);
        } else {
          setIsRunning(false);
        }
        // Update session status from server
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

        if (parsed.type === "done") {
          streamingMsgIdRef.current = null;
          // If a permission request is pending, the subprocess exited but will
          // respawn after the user grants permission — don't reset the UI.
          setPendingInteraction((prev) => {
            if (prev?.type === "permission_request") return prev;
            return null;
          });
          setCurrentActivity(null);
          setIsRunning(false);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              sender_type: "claude",
              parsed: { type: "done" },
              content: "",
              timestamp: new Date().toISOString(),
            },
          ]);
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

        // Tool call events: add to message list for rich rendering
        if (parsed.type === "tool_call") {
          setMessages((prev) => [
            ...prev,
            {
              id: parsed.toolCallId ?? crypto.randomUUID(),
              sender_type: "claude",
              parsed,
              content: "",
              timestamp: new Date().toISOString(),
            },
          ]);
          setIsRunning(true);
          return;
        }

        // Tool result events: update matching tool_call message
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
            // If no matching tool_call found, add as standalone
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

        // Auto-accept: when a confirm prompt arrives, automatically say yes
        if (parsed.type === "confirm" && autoAcceptRef.current) {
          socket.emit("claude:confirm", { sessionId, value: true });
          setIsRunning(true);
          return;
        }

        setIsRunning(parsed.type !== "error");

        // Track interactive messages
        if (parsed.type === "options" || parsed.type === "confirm" || parsed.type === "permission_request") {
          const interactionId = crypto.randomUUID();
          setPendingInteraction({ type: parsed.type, messageId: interactionId });
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
            // No existing streaming message found — create one
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

        // Final text: replace streaming message by ref ID if present
        setMessages((prev) => {
          const refId = streamingMsgIdRef.current;
          const idx = refId ? prev.findIndex((m) => m.id === refId) : -1;
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

    // Token usage events
    socket.on("claude:usage", ({ sessionId, usage }: { sessionId: string; usage: { input_tokens: number; output_tokens: number; cost_usd?: number } }) => {
      if (activeSessionRef.current?.id !== sessionId) return;
      // Update the last claude message with usage metadata
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
      // Update session-level usage
      setSessionUsage((prev) => ({
        total_input_tokens: (prev?.total_input_tokens ?? 0) + (usage.input_tokens ?? 0),
        total_output_tokens: (prev?.total_output_tokens ?? 0) + (usage.output_tokens ?? 0),
        total_cost_usd: (prev?.total_cost_usd ?? 0) + (usage.cost_usd ?? 0),
      }));
    });

    socket.on("claude:session_usage", ({ sessionId, usage }: { sessionId: string; usage: SessionUsage }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setSessionUsage(usage);
      }
    });

    // Model change events
    socket.on("claude:model_changed", ({ sessionId, model }: { sessionId: string; model: string }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setSessionModel(model);
      }
    });

    // Message edit/delete events
    socket.on("claude:messages_updated", ({ sessionId, messages: msgs }: { sessionId: string; messages: ChatMessage[] }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setMessages(msgs);
        setIsRunning(true); // The edited message is being re-sent
        setTimeout(() => {
          setIsRunning((current) => {
            if (current) {
              console.warn("[chat] isRunning stuck after message edit, resetting");
            }
            return false;
          });
        }, 120000);
      }
    });

    socket.on("claude:message_deleted", ({ sessionId, messageId }: { sessionId: string; messageId: string }) => {
      if (activeSessionRef.current?.id === sessionId) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    });

    // Reconnection state sync
    socket.on("claude:session_state", ({ sessionId, running }: { sessionId: string; running: boolean }) => {
      if (activeSessionRef.current?.id !== sessionId) return;
      setIsRunning(running);
      if (!running) {
        setCurrentActivity(null);
        drainPending();
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
      setMessages((prev) => [...prev, msg]);
      setIsRunning(false);
      setCurrentActivity(null);
      setHasError(true);
    });

    socket.on("claude:rate_limited", ({ message }: { message?: string }) => {
      const msg: ChatMessage = {
        id: "rate-limited-" + Date.now(),
        sender_type: "claude",
        content: message ?? "You are being rate limited. Please wait before sending more messages.",
        parsed: { type: "error", message: message ?? "You are being rate limited. Please wait before sending more messages." },
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(false);
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
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
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
      setConnected(true);
      socket.emit("claude:list_sessions");
    }

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("reconnect_attempt");
      socket.off("claude:sessions");
      socket.off("claude:messages");
      socket.off("claude:session_ready");
      socket.off("claude:output");
      socket.off("claude:error");
      socket.off("claude:rate_limited");
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
      socket.off("security:warn");
      socket.off("claude:session_status");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When active session changes, load messages and init subprocess (once per session)
  useEffect(() => {
    if (!activeSession || !connected) return;
    // Update model from session
    setSessionModel(activeSession.model ?? DEFAULT_MODEL);
    setSessionUsage(null);
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

  const handleSelectSession = useCallback((session: ClaudeSession) => {
    streamingMsgIdRef.current = null;
    setMessages([]);
    setCurrentActivity(null);
    setCommandRunner(null);
    setTypingUsers(new Set());
    pendingQueueRef.current = [];
    setPendingCount(0);
    activeSessionRef.current = session;
    setActiveSession(session);
    emit("claude:set_active_session", { sessionId: session.id });
  }, [emit]);

  const handleCreateSession = useCallback(
    (name: string, skipPermissions: boolean, model?: string, providerType?: string, templateId?: string) => {
      const id = crypto.randomUUID();
      const sessionModelValue = model ?? DEFAULT_MODEL;
      const sessionProviderType = providerType ?? "subprocess";
      const optimistic: ClaudeSession = {
        id,
        name: name || null,
        tags: [],
        created_by: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        skip_permissions: skipPermissions,
        model: sessionModelValue,
        provider_type: sessionProviderType,
        status: "idle",
        personality: null,
      };
      setSessions((prev) => [optimistic, ...prev]);
      setMessages([]);
      setCurrentActivity(null);
      pendingQueueRef.current = [];
      setPendingCount(0);
      setSessionModel(sessionModelValue);
      setSessionUsage(null);
      activeSessionRef.current = optimistic;
      setActiveSession(optimistic);
      freshSessionsRef.current.add(id);
      initializedSessionsRef.current.add(id);
      emit("claude:create_session", {
        sessionId: id,
        skipPermissions,
        model: sessionModelValue,
        provider_type: sessionProviderType,
        templateId,
      });
      emit("claude:set_active_session", { sessionId: id });
      if (name) {
        emit("claude:rename_session", { sessionId: id, name });
      }
    },
    [emit],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (!activeSession) return;
      setSessionModel(model);
      emit("claude:set_model", { sessionId: activeSession.id, model });
    },
    [activeSession, emit],
  );

  const handleSend = useCallback(
    (content: string, attachments?: string[]) => {
      if (!activeSession) {
        handleCreateSession("", false);
        return;
      }
      // If Claude is running, queue the message (attachments not queued)
      if (isRunning) {
        pendingQueueRef.current = [...pendingQueueRef.current, content];
        setPendingCount(pendingQueueRef.current.length);
        return;
      }

      // Auto-name session on first user message if no name set
      const isFirstMessage = messages.filter((m) => m.sender_type === "admin").length === 0;
      if (isFirstMessage && !activeSession.name) {
        const autoName = content.trim().slice(0, 50) || "New Session";
        emit("claude:rename_session", { sessionId: activeSession.id, name: autoName });
        const updated = { ...activeSession, name: autoName };
        activeSessionRef.current = updated;
        setActiveSession(updated);
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSession.id ? { ...s, name: autoName } : s)),
        );
      }

      sendImmediate(content, activeSession.id, attachments);
    },
    [activeSession, isRunning, sendImmediate, handleCreateSession, messages, emit],
  );

  const handleInterrupt = useCallback(() => {
    if (!activeSession) return;
    emit("claude:interrupt", { sessionId: activeSession.id });
    setIsRunning(false);
    setCurrentActivity(null);
    pendingQueueRef.current = [];
    setPendingCount(0);
  }, [activeSession, emit]);

  const handleRetryLast = useCallback(() => {
    if (lastUserMsgRef.current && activeSession && !isRunning) {
      sendImmediate(lastUserMsgRef.current, activeSession.id);
    }
  }, [activeSession, isRunning, sendImmediate]);

  const handleDeleteSession = useCallback(
    (session: ClaudeSession) => {
      emit("claude:delete_session", { sessionId: session.id });
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      if (activeSessionRef.current?.id === session.id) {
        activeSessionRef.current = null;
        setActiveSession(null);
        setMessages([]);
        setCurrentActivity(null);
        setIsRunning(false);
        pendingQueueRef.current = [];
        setPendingCount(0);
      }
    },
    [emit],
  );

  const handleRenameSession = useCallback(
    (session: ClaudeSession, newName: string) => {
      emit("claude:rename_session", { sessionId: session.id, name: newName });
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, name: newName } : s)),
      );
      if (activeSessionRef.current?.id === session.id) {
        const updated = { ...session, name: newName };
        activeSessionRef.current = updated;
        setActiveSession(updated);
      }
    },
    [emit],
  );

  const handleUpdateTags = useCallback(
    (session: ClaudeSession, tags: string[]) => {
      emit("claude:update_session_tags", { sessionId: session.id, tags });
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, tags } : s)),
      );
      if (activeSessionRef.current?.id === session.id) {
        const updated = { ...session, tags };
        activeSessionRef.current = updated;
        setActiveSession(updated);
      }
    },
    [emit],
  );

  const handleClearContext = useCallback(() => {
    if (!activeSession) return;
    emit("claude:close_session", { sessionId: activeSession.id });
    setMessages([]);
    setCurrentActivity(null);
    setIsRunning(false);
    pendingQueueRef.current = [];
    setPendingCount(0);
    emit("claude:create_session", {
      sessionId: activeSession.id,
      skipPermissions: activeSession.skip_permissions,
      model: activeSession.model,
      provider_type: activeSession.provider_type,
    });
  }, [activeSession, emit]);

  const handleSelectOption = useCallback(
    (sessionId: string, choice: string) => {
      emit("claude:select_option", { sessionId, choice });
      setPendingInteraction(null);
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
      setPendingInteraction(null);
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
    (sessionId: string, toolName: string, scope: "session" | "once") => {
      emit("claude:allow_tool", { sessionId, toolName, scope });
      setPendingInteraction(null);
      setIsRunning(true);
    },
    [emit],
  );

  const handleAlwaysAllow = useCallback(
    (sessionId: string, _toolName: string, command: string) => {
      // Whitelist this command pattern permanently (admin only — server enforces)
      emit("claude:always_allow_command", { pattern: command.trim().split(/\s+/)[0] });
      // Also allow once for the current request
      emit("claude:allow_tool", { sessionId, toolName: "Bash", scope: "once" });
      setIsRunning(true);
    },
    [emit],
  );

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      if (!activeSession) return;
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

  return (
    <div className="flex h-full overflow-hidden">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSession?.id ?? null}
        onSelect={handleSelectSession}
        onNew={() => setShowNewDialog(true)}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
        onUpdateTags={handleUpdateTags}
        loading={loadingSessions}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {activeSession?.skip_permissions && (
          <div className="px-4 pt-3">
            <SkipPermissionsBanner />
          </div>
        )}

        {/* Presence bar: show other users viewing this session */}
        {(() => {
          const others = presenceUsers.filter((u) => u.activeSession === activeSession?.id);
          if (!others.length) return null;
          return (
            <div className="flex items-center gap-2 border-b border-bot-border bg-bot-surface px-4 py-1.5">
              <span className="text-caption text-bot-muted">Also here:</span>
              {others.map((u) => (
                <span
                  key={u.email}
                  className="inline-flex items-center gap-1 rounded-full bg-bot-accent/10 px-2 py-0.5 text-caption text-bot-accent"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-bot-accent" />
                  {u.email.split("@")[0]}
                </span>
              ))}
              {commandRunner && commandRunner !== activeSession?.created_by && (
                <span className="ml-auto text-caption text-bot-amber">
                  {commandRunner.split("@")[0]} is running a command…
                </span>
              )}
            </div>
          );
        })()}

        <ChatToolbar
          onInterrupt={handleInterrupt}
          onClearContext={handleClearContext}
          onRetryLast={handleRetryLast}
          isRunning={isRunning}
          autoAccept={autoAccept}
          onAutoAcceptChange={setAutoAccept}
          model={activeSession ? sessionModel : undefined}
          onModelChange={activeSession ? handleModelChange : undefined}
          sessionUsage={sessionUsage}
          onSearch={activeSession ? () => setShowSessionSearch(true) : undefined}
          onGlobalSearch={() => setShowGlobalSearch(true)}
          sessionId={activeSession?.id}
          messages={messages}
        />

        {showSessionSearch && activeSession && (
          <SessionSearchBar
            sessionId={activeSession.id}
            onClose={() => {
              setShowSessionSearch(false);
              setSearchHighlights(new Set());
              setActiveHighlight(null);
            }}
            onHighlightsChange={(highlights, activeId) => {
              setSearchHighlights(highlights);
              setActiveHighlight(activeId);
            }}
          />
        )}

        {!connected && (
          <div className="flex items-center justify-center gap-2 bg-bot-amber/10 border-b border-bot-amber/20 px-4 py-2 text-caption text-bot-amber">
            <div className="h-2 w-2 rounded-full bg-bot-amber animate-pulse" />
            {reconnecting ? "Reconnecting to server..." : "Connecting to server..."}
          </div>
        )}

        {!activeSession ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-bot-muted">
            <p className="text-body">Select a session or create a new one.</p>
            <button
              onClick={() => setShowNewDialog(true)}
              className="rounded-lg bg-bot-accent px-5 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
            >
              New Session
            </button>
          </div>
        ) : (
          <MessageList
            messages={messages}
            sessionId={activeSession.id}
            onSelectOption={handleSelectOption}
            onConfirm={handleConfirm}
            onAllowTool={handleAllowTool}
            onAlwaysAllow={handleAlwaysAllow}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            isRunning={isRunning}
            currentActivity={currentActivity}
            searchHighlights={searchHighlights}
            activeHighlight={activeHighlight}
            pendingInteraction={pendingInteraction}
            loadingMessages={loadingMessages}
            avatarState={avatarState}
            onSendStarter={(msg) => handleSend(msg)}
          />
        )}

        {/* Typing indicator */}
        {typingUsers.size > 0 && (
          <div className="px-6 pb-1 text-caption text-bot-muted italic">
            {Array.from(typingUsers).map((e) => e.split("@")[0]).join(", ")} {typingUsers.size === 1 ? "is" : "are"} typing…
          </div>
        )}

        <ChatInput
          ref={chatInputRef}
          onSend={handleSend}
          disabled={!connected || !activeSession}
          isRunning={isRunning}
          pendingCount={pendingCount}
          sessionId={activeSession?.id}
          onTypingStart={() => activeSession && emit("claude:typing_start", { sessionId: activeSession.id })}
          onTypingStop={() => activeSession && emit("claude:typing_stop", { sessionId: activeSession.id })}
        />
      </div>

      {showNewDialog && (
        <NewSessionDialog
          onClose={() => setShowNewDialog(false)}
          onCreate={handleCreateSession}
        />
      )}

      {showGlobalSearch && (
        <GlobalSearchDialog
          onClose={() => setShowGlobalSearch(false)}
          onNavigate={(sessionId, _messageId) => {
            // Navigate to the session
            const target = sessions.find((s) => s.id === sessionId);
            if (target) handleSelectSession(target);
          }}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import type { ParsedOutput } from "@/lib/claude/provider";
import type { ClaudeSession } from "@/lib/claude-db";
import { SessionSidebar } from "./session-sidebar";
import { MessageList, type ChatMessage, type ActivityState } from "./message-list";
import { ChatInput } from "./chat-input";
import { ChatToolbar } from "./chat-toolbar";
import { NewSessionDialog } from "./new-session-dialog";
import { SkipPermissionsBanner } from "./skip-permissions-banner";

type PresenceUser = { email: string; activeSession: string | null };

export function ChatTab() {
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
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const lastUserMsgRef = useRef<string>("");
  const activeSessionRef = useRef<ClaudeSession | null>(null);
  const initializedSessionsRef = useRef<Set<string>>(new Set());
  const freshSessionsRef = useRef<Set<string>>(new Set());
  const autoAcceptRef = useRef(false);

  // Pending message queue (typed while Claude is running)
  const pendingQueueRef = useRef<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  // Keep autoAcceptRef in sync
  useEffect(() => {
    autoAcceptRef.current = autoAccept;
  }, [autoAccept]);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  // Internal send — always dispatches immediately (no queue check)
  const sendImmediate = useCallback(
    (content: string, sessionId: string) => {
      lastUserMsgRef.current = content;
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        sender_type: "admin",
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      setIsRunning(true);
      emit("claude:message", { sessionId, content });
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
        });
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
      if (activeSessionRef.current?.id === sessionId) setCommandRunner(null);
    });

    socket.on(
      "claude:messages",
      ({ sessionId, messages: msgs }: { sessionId: string; messages: ChatMessage[] }) => {
        if (activeSessionRef.current?.id === sessionId) {
          setMessages((prev) => (prev.length === 0 ? msgs : prev));
        }
      },
    );

    socket.on(
      "claude:session_ready",
      ({ running }: { sessionId: string; running?: boolean }) => {
        if (running) {
          setIsRunning(true);
        } else {
          setIsRunning(false);
        }
      },
    );

    socket.on(
      "claude:output",
      ({ sessionId, parsed }: { sessionId: string; parsed: ParsedOutput }) => {
        if (!activeSessionRef.current || activeSessionRef.current.id !== sessionId) return;

        if (parsed.type === "done") {
          setIsRunning(false);
          setCurrentActivity(null);
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

        // Auto-accept: when a confirm prompt arrives, automatically say yes
        if (parsed.type === "confirm" && autoAcceptRef.current) {
          socket.emit("claude:confirm", { sessionId, value: true });
          setIsRunning(true);
          return;
        }

        setIsRunning(parsed.type !== "error");

        if (parsed.type === "streaming") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.parsed?.type === "streaming") {
              const updated = { ...last, content: parsed.content ?? "", parsed };
              return [...prev.slice(0, -1), updated];
            }
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender_type: "claude" as const,
                parsed,
                content: parsed.content ?? "",
                timestamp: new Date().toISOString(),
              },
            ];
          });
          return;
        }

        // Final text: replace last streaming message if present
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const finalMsg: ChatMessage = {
            id: last?.parsed?.type === "streaming" ? last.id : crypto.randomUUID(),
            sender_type: "claude",
            parsed,
            content: parsed.content ?? parsed.message ?? "",
            timestamp: new Date().toISOString(),
          };
          if (last?.parsed?.type === "streaming") {
            return [...prev.slice(0, -1), finalMsg];
          }
          return [...prev, finalMsg];
        });
      },
    );

    socket.on("claude:error", ({ message }: { message: string }) => {
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
      socket.off("claude:presence_update");
      socket.off("claude:typing");
      socket.off("claude:command_started");
      socket.off("claude:command_done");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When active session changes, load messages and init subprocess (once per session)
  useEffect(() => {
    if (!activeSession || !connected) return;
    if (!freshSessionsRef.current.has(activeSession.id)) {
      emit("claude:get_messages", { sessionId: activeSession.id });
    }
    freshSessionsRef.current.delete(activeSession.id);
    if (!initializedSessionsRef.current.has(activeSession.id)) {
      initializedSessionsRef.current.add(activeSession.id);
      emit("claude:create_session", {
        sessionId: activeSession.id,
        skipPermissions: activeSession.skip_permissions,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, connected]);

  const handleSelectSession = useCallback((session: ClaudeSession) => {
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
    (name: string, skipPermissions: boolean) => {
      const id = crypto.randomUUID();
      const optimistic: ClaudeSession = {
        id,
        name: name || null,
        tags: [],
        created_by: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        skip_permissions: skipPermissions,
      };
      setSessions((prev) => [optimistic, ...prev]);
      setMessages([]);
      setCurrentActivity(null);
      pendingQueueRef.current = [];
      setPendingCount(0);
      activeSessionRef.current = optimistic;
      setActiveSession(optimistic);
      freshSessionsRef.current.add(id);
      initializedSessionsRef.current.add(id);
      emit("claude:create_session", { sessionId: id, skipPermissions });
      emit("claude:set_active_session", { sessionId: id });
      if (name) {
        emit("claude:rename_session", { sessionId: id, name });
      }
    },
    [emit],
  );

  const handleSend = useCallback(
    (content: string) => {
      if (!activeSession) {
        handleCreateSession("", false);
        return;
      }
      // If Claude is running, queue the message
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

      sendImmediate(content, activeSession.id);
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
    });
  }, [activeSession, emit]);

  const handleSelectOption = useCallback(
    (sessionId: string, choice: string) => {
      emit("claude:select_option", { sessionId, choice });
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
      setIsRunning(true);
    },
    [emit],
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
        />

        {!connected && (
          <div className="px-4 py-2 text-caption text-bot-amber border-b border-bot-border bg-bot-amber/5 flex items-center gap-2">
            <span className="flex gap-0.5">
              <span className="h-1 w-1 rounded-full bg-bot-amber animate-bounce [animation-delay:0ms]" />
              <span className="h-1 w-1 rounded-full bg-bot-amber animate-bounce [animation-delay:150ms]" />
              <span className="h-1 w-1 rounded-full bg-bot-amber animate-bounce [animation-delay:300ms]" />
            </span>
            {reconnecting ? "Server restarted — reconnecting…" : "Connecting to server…"}
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
            isRunning={isRunning}
            currentActivity={currentActivity}
          />
        )}

        {/* Typing indicator */}
        {typingUsers.size > 0 && (
          <div className="px-6 pb-1 text-caption text-bot-muted italic">
            {Array.from(typingUsers).map((e) => e.split("@")[0]).join(", ")} {typingUsers.size === 1 ? "is" : "are"} typing…
          </div>
        )}

        <ChatInput
          onSend={handleSend}
          disabled={!connected || !activeSession}
          isRunning={isRunning}
          pendingCount={pendingCount}
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
    </div>
  );
}

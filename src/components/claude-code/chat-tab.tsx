"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import type { ClaudeSession } from "@/lib/claude-db";
import { DEFAULT_MODEL } from "@/lib/models";
import { apiUrl } from "@/lib/utils";
import { SessionSidebar } from "./session-sidebar";
import { MessageList, type ChatMessage } from "./message-list";
import { ChatToolbar } from "./chat-toolbar";
import { NewSessionDialog } from "./new-session-dialog";
import { SkipPermissionsBanner } from "./skip-permissions-banner";
import { SessionSearchBar } from "./session-search-bar";
import { GlobalSearchDialog } from "./global-search-dialog";
import { ChatInput } from "./chat-input";
import { useChatSocket } from "@/hooks/use-chat-socket";

export function ChatTab() {
  const { status: sessionStatus } = useSession();
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [activeSession, setActiveSession] = useState<ClaudeSession | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);

  // Search state
  const [showSessionSearch, setShowSessionSearch] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [searchHighlights, setSearchHighlights] = useState<Set<string>>(new Set());
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);

  const [botAvatarUrl, setBotAvatarUrl] = useState<string | null>(null);

  const chat = useChatSocket({
    sessionStatus,
    activeSession,
    autoAccept,
    setSessions,
    setLoadingSessions,
  });

  useEffect(() => {
    fetch(apiUrl("/api/bot-identity"))
      .then((r) => r.json())
      .then((d: { avatar?: string | null }) => setBotAvatarUrl(d.avatar ?? null))
      .catch(() => {});
  }, []);

  // Browser tab title badge: show count of sessions needing attention
  useEffect(() => {
    const needsAttention = sessions.filter((s) => s.status === "needs_attention").length;
    const baseTitle = "Claude Bot";
    document.title = needsAttention > 0 ? `(${needsAttention}) ${baseTitle}` : baseTitle;
  }, [sessions]);

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
      if (mod && e.key === "/") {
        e.preventDefault();
        chat.chatInputRef.current?.focus();
        return;
      }
      if (mod && e.shiftKey && e.key === "C") {
        e.preventDefault();
        const lastClaude = [...chat.messages].reverse().find(
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
  }, [activeSession, chat.messages, chat.chatInputRef]);

  const handleSelectSession = useCallback((session: ClaudeSession) => {
    chat.resetSessionState();
    chat.activeSessionRef.current = session;
    setActiveSession(session);
    chat.emit("claude:set_active_session", { sessionId: session.id });
  }, [chat]);

  const handleCreateSession = useCallback(
    (name: string, skipPermissions: boolean, model?: string, providerType?: string, templateId?: string, personality?: string, personalityCustom?: string) => {
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
        personality: personality ?? null,
        claude_session_id: null,
      };
      setSessions((prev) => [optimistic, ...prev]);
      chat.resetSessionState();
      chat.setSessionModel(sessionModelValue);
      chat.setSessionUsage(null);
      chat.activeSessionRef.current = optimistic;
      setActiveSession(optimistic);
      chat.freshSessionsRef.current.add(id);
      chat.initializedSessionsRef.current.add(id);
      chat.emit("claude:create_session", {
        sessionId: id,
        skipPermissions,
        model: sessionModelValue,
        provider_type: sessionProviderType,
        templateId,
        personality: personality ?? "professional",
        personality_custom: personalityCustom,
      });
      chat.emit("claude:set_active_session", { sessionId: id });
      if (name) {
        chat.emit("claude:rename_session", { sessionId: id, name });
      }
    },
    [chat],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (!activeSession) return;
      chat.setSessionModel(model);
      chat.emit("claude:set_model", { sessionId: activeSession.id, model });
    },
    [activeSession, chat],
  );

  const handleSendWithAutoName = useCallback(
    (content: string, attachments?: string[]) => {
      if (!activeSession) {
        handleCreateSession("", false);
        return;
      }

      const isFirstMessage = chat.messages.filter((m: ChatMessage) => m.sender_type === "admin").length === 0;
      if (isFirstMessage && !activeSession.name) {
        const autoName = content.trim().slice(0, 50) || "New Session";
        chat.emit("claude:rename_session", { sessionId: activeSession.id, name: autoName });
        const updated = { ...activeSession, name: autoName };
        chat.activeSessionRef.current = updated;
        setActiveSession(updated);
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSession.id ? { ...s, name: autoName } : s)),
        );
      }

      chat.handleSend(content, attachments);
    },
    [activeSession, chat, handleCreateSession],
  );

  const handleDeleteSession = useCallback(
    (session: ClaudeSession) => {
      chat.emit("claude:delete_session", { sessionId: session.id });
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      if (chat.activeSessionRef.current?.id === session.id) {
        chat.activeSessionRef.current = null;
        setActiveSession(null);
        chat.resetSessionState();
        chat.setIsRunning(false);
      }
    },
    [chat],
  );

  const handleRenameSession = useCallback(
    (session: ClaudeSession, newName: string) => {
      chat.emit("claude:rename_session", { sessionId: session.id, name: newName });
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, name: newName } : s)),
      );
      if (chat.activeSessionRef.current?.id === session.id) {
        const updated = { ...session, name: newName };
        chat.activeSessionRef.current = updated;
        setActiveSession(updated);
      }
    },
    [chat],
  );

  const handleUpdateTags = useCallback(
    (session: ClaudeSession, tags: string[]) => {
      chat.emit("claude:update_session_tags", { sessionId: session.id, tags });
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, tags } : s)),
      );
      if (chat.activeSessionRef.current?.id === session.id) {
        const updated = { ...session, tags };
        chat.activeSessionRef.current = updated;
        setActiveSession(updated);
      }
    },
    [chat],
  );

  const handleClearContext = useCallback(() => {
    if (!activeSession) return;
    chat.emit("claude:close_session", { sessionId: activeSession.id });
    chat.resetSessionState();
    chat.setIsRunning(false);
    chat.emit("claude:create_session", {
      sessionId: activeSession.id,
      skipPermissions: activeSession.skip_permissions,
      model: activeSession.model,
      provider_type: activeSession.provider_type,
    });
  }, [activeSession, chat]);

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

        {(() => {
          const others = chat.presenceUsers.filter((u) => u.activeSession === activeSession?.id);
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
              {chat.commandRunner && chat.commandRunner !== activeSession?.created_by && (
                <span className="ml-auto text-caption text-bot-amber">
                  {chat.commandRunner.split("@")[0]} is running a command…
                </span>
              )}
            </div>
          );
        })()}

        <ChatToolbar
          onInterrupt={chat.handleInterrupt}
          onClearContext={handleClearContext}
          onRetryLast={chat.handleRetryLast}
          isRunning={chat.isRunning}
          autoAccept={autoAccept}
          onAutoAcceptChange={setAutoAccept}
          model={activeSession ? chat.sessionModel : undefined}
          onModelChange={activeSession ? handleModelChange : undefined}
          sessionUsage={chat.sessionUsage}
          budgetLimits={chat.budgetLimits}
          onSearch={activeSession ? () => setShowSessionSearch(true) : undefined}
          onGlobalSearch={() => setShowGlobalSearch(true)}
          sessionId={activeSession?.id}
          messages={chat.messages}
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

        {!chat.connected && (
          <div className="flex items-center justify-center gap-2 bg-bot-amber/10 border-b border-bot-amber/20 px-4 py-2 text-caption text-bot-amber">
            <div className="h-2 w-2 rounded-full bg-bot-amber animate-pulse" />
            {chat.reconnecting ? "Reconnecting to server..." : "Connecting to server..."}
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
            messages={chat.messages}
            sessionId={activeSession.id}
            onSelectOption={chat.handleSelectOption}
            onConfirm={chat.handleConfirm}
            onAllowTool={chat.handleAllowTool}
            onAlwaysAllow={chat.handleAlwaysAllow}
            onAnswerQuestion={chat.handleAnswerQuestion}
            onEditMessage={chat.handleEditMessage}
            onDeleteMessage={chat.handleDeleteMessage}
            isRunning={chat.isRunning}
            currentActivity={chat.currentActivity}
            searchHighlights={searchHighlights}
            activeHighlight={activeHighlight}
            pendingInteraction={chat.pendingInteraction}
            loadingMessages={chat.loadingMessages}
            botAvatarUrl={botAvatarUrl}
            onSendStarter={(msg) => handleSendWithAutoName(msg)}
            onRetry={chat.handleRetryLast}
            runStartTime={chat.runStartTime}
          />
        )}

        {chat.typingUsers.size > 0 && (
          <div className="px-6 pb-1 text-caption text-bot-muted italic">
            {Array.from(chat.typingUsers).map((e) => e.split("@")[0]).join(", ")} {chat.typingUsers.size === 1 ? "is" : "are"} typing…
          </div>
        )}

        <ChatInput
          ref={chat.chatInputRef}
          onSend={handleSendWithAutoName}
          disabled={!chat.connected || !activeSession}
          isRunning={chat.isRunning}
          pendingCount={chat.pendingCount}
          pendingQueue={chat.pendingQueue}
          onEditQueueItem={chat.handleEditQueueItem}
          onDeleteQueueItem={chat.handleDeleteQueueItem}
          sessionId={activeSession?.id}
          onTypingStart={() => activeSession && chat.emit("claude:typing_start", { sessionId: activeSession.id })}
          onTypingStop={() => activeSession && chat.emit("claude:typing_stop", { sessionId: activeSession.id })}
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
            const target = sessions.find((s) => s.id === sessionId);
            if (target) handleSelectSession(target);
          }}
        />
      )}
    </div>
  );
}

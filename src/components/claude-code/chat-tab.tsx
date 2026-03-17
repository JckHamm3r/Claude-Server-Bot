"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Users, MessageCircleOff, MessageCircle } from "lucide-react";
import type { ClaudeSession } from "@/lib/claude-db";
import { DEFAULT_MODEL, AVAILABLE_MODELS, getModelLabel } from "@/lib/models";
import { apiUrl } from "@/lib/utils";
import { SessionSidebar } from "./session-sidebar";
import { MessageList } from "./message-list";
import { ChatToolbar } from "./chat-toolbar";
import { NewSessionDialog } from "./new-session-dialog";
import { SkipPermissionsBanner } from "./skip-permissions-banner";
import { UnifiedSearchDialog } from "./unified-search-dialog";
import { ChatInput } from "./chat-input";
import { useChatSocket } from "@/hooks/use-chat-socket";
import { getSocket } from "@/lib/socket";
import type { ChatMessage } from "@/types/chat";

interface ChatTabProps {
  isWidget?: boolean;
}

const ACTIVE_SESSION_KEY = "claude:activeSessionId";

export function ChatTab({ isWidget = false }: ChatTabProps) {
  const { status: sessionStatus, data: sessionData } = useSession();
  const currentEmail = sessionData?.user?.email ?? null;
  const userObj = sessionData?.user as { firstName?: string; lastName?: string; email?: string } | undefined;
  const userInitials = (() => {
    const first = userObj?.firstName?.trim();
    const last = userObj?.lastName?.trim();
    if (first && last) return (first[0] + last[0]).toUpperCase();
    if (first) return first[0].toUpperCase();
    const email = userObj?.email ?? "";
    const local = email.split("@")[0] ?? "";
    return (local[0] ?? "U").toUpperCase();
  })();
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [activeSession, setActiveSession] = useState<ClaudeSession | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isWidget);
  const [autoAccept, setAutoAccept] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const pendingRestoreRef = useRef<string | null>(null);

  // Read saved active session ID on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_SESSION_KEY);
      if (saved) pendingRestoreRef.current = saved;
    } catch { /* ignore */ }
  }, []);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchMode, setSearchMode] = useState<"session" | "global">("session");
  const [searchHighlights, setSearchHighlights] = useState<Set<string>>(new Set());
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);

  const [botAvatarUrl, setBotAvatarUrl] = useState<string | null>(null);

  const handleSessionRemoved = useCallback((sessionId: string) => {
    setActiveSession((current) => {
      if (current?.id === sessionId) {
        try { localStorage.removeItem(ACTIVE_SESSION_KEY); } catch { /* ignore */ }
        return null;
      }
      return current;
    });
  }, []);

  const chat = useChatSocket({
    sessionStatus,
    activeSession,
    autoAccept,
    setSessions,
    setLoadingSessions,
    onSessionRemoved: handleSessionRemoved,
  });

  useEffect(() => {
    fetch(apiUrl("/api/bot-identity"))
      .then((r) => r.json())
      .then((d: { avatar?: string | null }) => setBotAvatarUrl(d.avatar ?? null))
      .catch(() => {});
  }, []);

  // Listen for real-time bot identity updates
  useEffect(() => {
    const socket = getSocket();
    const handleIdentityUpdate = ({ avatar }: { name?: string; tagline?: string; avatar?: string | null }) => {
      setBotAvatarUrl(avatar ?? null);
    };
    socket.on("bot:identity_updated", handleIdentityUpdate);
    return () => { socket.off("bot:identity_updated", handleIdentityUpdate); };
  }, []);

  // Sync activeSession when the sessions list changes (e.g. server-side rename)
  useEffect(() => {
    if (!activeSession) return;
    const fresh = sessions.find((s) => s.id === activeSession.id);
    if (fresh && fresh.name !== activeSession.name) {
      const updated = { ...activeSession, name: fresh.name };
      chat.activeSessionRef.current = updated;
      setActiveSession(updated);
    }
  }, [sessions, activeSession, chat.activeSessionRef]);

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
        setSearchMode("global");
        setShowSearch(true);
        return;
      }
      if (mod && e.key === "f" && activeSession) {
        e.preventDefault();
        setSearchMode("session");
        setShowSearch(true);
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
    try { localStorage.setItem(ACTIVE_SESSION_KEY, session.id); } catch { /* ignore */ }
  }, [chat]);

  // Auto-restore active session from localStorage after session list loads
  useEffect(() => {
    const savedId = pendingRestoreRef.current;
    if (!savedId || !chat.connected || activeSession || sessions.length === 0) return;
    const match = sessions.find((s) => s.id === savedId);
    if (match) {
      pendingRestoreRef.current = null;
      chat.initializedSessionsRef.current.add(match.id);
      handleSelectSession(match);
    } else {
      pendingRestoreRef.current = null;
    }
  }, [sessions, chat.connected, activeSession, chat.initializedSessionsRef, handleSelectSession]);

  const handleCreateSession = useCallback(
    (name: string, skipPermissions: boolean, model?: string, providerType?: string, templateId?: string, personality?: string, personalityCustom?: string) => {
      const id = crypto.randomUUID();
      const sessionModelValue = model ?? DEFAULT_MODEL;
      const sessionProviderType = providerType ?? "sdk";
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
      try { localStorage.setItem(ACTIVE_SESSION_KEY, id); } catch { /* ignore */ }
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
      personality: activeSession.personality ?? "professional",
    });
  }, [activeSession, chat]);

  const handleDeleteSession = useCallback(
    (session: ClaudeSession) => {
      if (session.shared_by) {
        // For shared sessions, leave rather than delete
        chat.emit("claude:remove_from_session", { sessionId: session.id, removeEmail: currentEmail });
      } else {
        chat.emit("claude:delete_session", { sessionId: session.id });
      }
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      if (chat.activeSessionRef.current?.id === session.id) {
        chat.activeSessionRef.current = null;
        setActiveSession(null);
        chat.resetSessionState();
        chat.setIsRunning(false);
        try { localStorage.removeItem(ACTIVE_SESSION_KEY); } catch { /* ignore */ }
      }
    },
    [chat, currentEmail],
  );

  const handleCompact = useCallback(() => {
    if (!activeSession || chat.isRunning) return;
    chat.handleSend("/compact");
  }, [activeSession, chat]);

  const handleResetRuntime = useCallback(() => {
    chat.handleResetRuntime();
  }, [chat]);

  const injectLocalMessage = useCallback(
    (content: string) => {
      const msg: ChatMessage = {
        id: "local-" + Date.now(),
        sender_type: "claude",
        content,
        parsed: { type: "text", content },
        timestamp: new Date().toISOString(),
      };
      chat.setMessages((prev) => [...prev, msg]);
    },
    [chat],
  );

  const handleSendWithAutoName = useCallback(
    (content: string, attachments?: string[]) => {
      if (!activeSession) {
        handleCreateSession("", false);
        return;
      }

      // ── Client-side slash command interception ──────────────────────────
      const trimmed = content.trim();
      if (trimmed.startsWith("/") && !attachments?.length) {
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (cmd) {
          case "/chat": {
            chat.emit("claude:toggle_chat", { sessionId: activeSession.id });
            return;
          }

          case "/clear": {
            handleClearContext();
            return;
          }

          case "/help": {
            const lines = [
              "**Available Commands**",
              "",
              "| Command | Description |",
              "|---------|-------------|",
              "| `/chat` | Toggle AI responses — pause to chat freely, resume to re-enable AI |",
              "| `/compact [focus]` | Compact conversation history to save context |",
              "| `/clear` | Clear conversation context and start fresh |",
              "| `/help` | Show this help message |",
              "| `/cost` | Show token usage and cost for this session |",
              "| `/status` | Show current session info |",
              "| `/memory` | List and manage project memory files |",
              "| `/rename <name>` | Rename the current session |",
              "| `/new [name]` | Create a new session |",
              "| `/export [md\\|json]` | Export this session (default: markdown) |",
              "| `/model <model>` | Switch the AI model |",
              "",
              "**Keyboard Shortcuts**",
              "",
              "| Shortcut | Action |",
              "|----------|--------|",
              "| `Ctrl/Cmd+F` | Search in session |",
              "| `Ctrl/Cmd+Shift+F` | Global search across all sessions |",
              "| `Ctrl/Cmd+/` | Focus chat input |",
              "| `Ctrl/Cmd+Shift+C` | Copy last Claude reply |",
              "",
              "**@ File References** — type `@` to autocomplete project files.",
            ];
            injectLocalMessage(lines.join("\n"));
            return;
          }

          case "/cost": {
            const usage = chat.sessionUsage;
            if (!usage || usage.total_input_tokens === 0) {
              injectLocalMessage("No usage recorded for this session yet.");
            } else {
              const inputK = (usage.total_input_tokens / 1000).toFixed(1);
              const outputK = (usage.total_output_tokens / 1000).toFixed(1);
              const cost = usage.total_cost_usd.toFixed(4);
              injectLocalMessage(
                `**Session Token Usage**\n\n` +
                `- Input tokens: ${usage.total_input_tokens.toLocaleString()} (${inputK}k)\n` +
                `- Output tokens: ${usage.total_output_tokens.toLocaleString()} (${outputK}k)\n` +
                `- Total tokens: ${(usage.total_input_tokens + usage.total_output_tokens).toLocaleString()}\n` +
                `- Estimated cost: **$${cost}**`,
              );
            }
            return;
          }

          case "/status": {
            const modelLabel = getModelLabel(chat.sessionModel);
            const contextPct = chat.contextUsage?.percentage ?? 0;
            const contextToks = chat.contextUsage?.inputTokens ?? 0;
            const contextMax = chat.contextUsage?.contextWindow ?? 0;
            injectLocalMessage(
              `**Session Status**\n\n` +
              `- Session ID: \`${activeSession.id.slice(0, 8)}...\`\n` +
              `- Name: ${activeSession.name ?? "*(unnamed)*"}\n` +
              `- Model: ${modelLabel}\n` +
              `- Skip permissions: ${activeSession.skip_permissions ? "**enabled**" : "off"}\n` +
              `- Context window: ${contextToks > 0 ? `${contextPct}% (${(contextToks / 1000).toFixed(0)}k / ${(contextMax / 1000).toFixed(0)}k tokens)` : "n/a"}\n` +
              `- AI responses: ${chat.aiPaused ? "**paused** (use `/chat` to resume)" : "active"}\n` +
              `- Status: ${chat.isRunning ? "running" : "idle"}`,
            );
            return;
          }

          case "/rename": {
            const newName = args.join(" ").trim();
            if (!newName) {
              injectLocalMessage("Usage: `/rename <new session name>`");
            } else {
              handleRenameSession(activeSession, newName);
              injectLocalMessage(`Session renamed to **${newName}**.`);
            }
            return;
          }

          case "/new": {
            const newSessionName = args.join(" ").trim();
            if (newSessionName) {
              handleCreateSession(newSessionName, false);
            } else {
              setShowNewDialog(true);
            }
            return;
          }

          case "/export": {
            const fmt = (args[0] ?? "md").toLowerCase();
            const format = fmt === "json" ? "json" : "markdown";
            window.open(apiUrl(`/api/claude-code/export?sessionId=${activeSession.id}&format=${format}`), "_blank");
            injectLocalMessage(`Exporting session as **${format}**…`);
            return;
          }

          case "/model": {
            const modelArg = args[0]?.toLowerCase() ?? "";
            if (!modelArg) {
              const modelList = AVAILABLE_MODELS.map((m) => `- \`${m.value}\` — ${m.label}`).join("\n");
              injectLocalMessage(`**Available models:**\n\n${modelList}\n\nUsage: \`/model <model-id>\``);
            } else {
              const match = AVAILABLE_MODELS.find(
                (m) => m.value === modelArg || m.label.toLowerCase().includes(modelArg),
              );
              if (!match) {
                const modelList = AVAILABLE_MODELS.map((m) => `\`${m.value}\``).join(", ");
                injectLocalMessage(`Unknown model \`${modelArg}\`. Available: ${modelList}`);
              } else {
                handleModelChange(match.value);
                injectLocalMessage(`Model switched to **${match.label}**.`);
              }
            }
            return;
          }

          default:
            // Unknown slash command — pass through to Claude
            break;
        }
      }

      chat.handleSend(content, attachments);
    },
    [activeSession, chat, handleCreateSession, handleClearContext, handleRenameSession, handleModelChange, injectLocalMessage, setShowNewDialog],
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
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        currentEmail={currentEmail ?? undefined}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {activeSession?.skip_permissions && (
          <div className="px-4 pt-3">
            <SkipPermissionsBanner />
          </div>
        )}

        {(() => {
          const others = chat.presenceUsers.filter(
            (u) => u.activeSession === activeSession?.id && u.email !== currentEmail
          );
          const isGuest = activeSession && currentEmail && activeSession.created_by !== currentEmail && activeSession.shared_by;
          if (!others.length && !isGuest) return null;
          return (
            <div className="flex items-center gap-2 border-b border-bot-border bg-bot-surface px-4 py-1.5">
              {isGuest && (
                <span className="inline-flex items-center gap-1 rounded-full bg-bot-muted/15 px-2 py-0.5 text-caption font-medium text-bot-muted border border-bot-border/40">
                  <Users className="h-3 w-3" />
                  Guest — {activeSession?.shared_by?.split("@")[0]}&apos;s session
                </span>
              )}
              {others.length > 0 && (
                <>
                  <span className="text-caption text-bot-muted">{isGuest ? "·" : "Also here:"}</span>
                  {others.map((u) => (
                    <span
                      key={u.email}
                      className="inline-flex items-center gap-1 rounded-full bg-bot-accent/10 px-2 py-0.5 text-caption text-bot-accent"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-bot-accent" />
                      {u.email.split("@")[0]}
                    </span>
                  ))}
                </>
              )}
              {chat.commandRunner && chat.commandRunner !== activeSession?.created_by && (
                <span className="ml-auto text-caption text-bot-amber">
                  {chat.commandRunner.split("@")[0]} is running a command…
                </span>
              )}
              {isGuest && activeSession && (
                <button
                  onClick={() => handleDeleteSession(activeSession)}
                  className="ml-auto text-caption text-bot-muted hover:text-bot-amber hover:bg-bot-amber/10 rounded-lg px-2 py-1 transition-colors"
                  title="Leave this shared session"
                >
                  Leave session
                </button>
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
          contextUsage={chat.contextUsage}
          isCompacting={chat.isCompacting}
          onCompact={handleCompact}
          onOpenSearch={() => setShowSearch(true)}
          sessionId={activeSession?.id}
          messages={chat.messages}
          activeSession={activeSession}
          canShare={!!activeSession && !!currentEmail && activeSession.created_by === currentEmail}
        />

        {!chat.connected && (
          <div className="flex items-center justify-center gap-2 bg-bot-amber/10 border-b border-bot-amber/20 px-4 py-2 text-caption text-bot-amber">
            <div className="h-2 w-2 rounded-full bg-bot-amber animate-pulse" />
            {chat.reconnecting ? "Reconnecting to server..." : "Connecting to server..."}
          </div>
        )}

        {chat.runtimeLimited && chat.connected && (
          <div className="flex items-center justify-between gap-2 bg-bot-amber/10 border-b border-bot-amber/20 px-4 py-2 text-caption text-bot-amber">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-bot-amber" />
              Session runtime limit reached. Reset the timer to continue.
            </div>
            <button
              onClick={handleResetRuntime}
              className="rounded-md bg-bot-amber/20 px-3 py-1 text-caption font-medium text-bot-amber hover:bg-bot-amber/30 transition-colors"
            >
              Extend Session
            </button>
          </div>
        )}

        {chat.aiPaused && activeSession && (
          <div className="flex items-center justify-between gap-2 bg-bot-blue/10 border-b border-bot-blue/20 px-4 py-2 text-caption text-bot-blue">
            <div className="flex items-center gap-2">
              <MessageCircleOff className="h-4 w-4" />
              <span className="font-medium">AI paused</span>
              <span className="text-bot-blue/70">— messages won&apos;t be sent to AI. Type <code className="rounded bg-bot-blue/10 px-1.5 py-0.5 font-mono text-[11px]">/chat</code> to resume.</span>
            </div>
            <button
              onClick={() => chat.emit("claude:toggle_chat", { sessionId: activeSession.id })}
              className="flex items-center gap-1.5 rounded-md bg-bot-blue/20 px-3 py-1 text-caption font-medium text-bot-blue hover:bg-bot-blue/30 transition-colors"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Resume AI
            </button>
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
            pendingInteractions={chat.pendingInteractions}
            loadingMessages={chat.loadingMessages}
            botAvatarUrl={botAvatarUrl}
            onSendStarter={(msg) => handleSendWithAutoName(msg)}
            onFillStarter={(msg) => chat.chatInputRef.current?.setValue(msg)}
            onRetry={chat.handleRetryLast}
            runStartTime={chat.runStartTime}
            userInitials={userInitials}
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
          aiPaused={chat.aiPaused}
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

      {showSearch && (
        <UnifiedSearchDialog
          onClose={() => {
            setShowSearch(false);
            setSearchHighlights(new Set());
            setActiveHighlight(null);
          }}
          initialMode={searchMode}
          sessionId={activeSession?.id}
          onNavigate={(targetSessionId, _messageId) => {
            const target = sessions.find((s) => s.id === targetSessionId);
            if (target && target.id !== activeSession?.id) {
              handleSelectSession(target);
            }
          }}
          onHighlightsChange={(highlights, activeId) => {
            setSearchHighlights(highlights);
            setActiveHighlight(activeId);
          }}
        />
      )}
    </div>
  );
}

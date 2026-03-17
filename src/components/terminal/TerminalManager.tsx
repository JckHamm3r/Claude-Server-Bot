"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getSocket, connectSocket } from "@/lib/socket";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { TabBar } from "./TabBar";
import { BookmarkPanel } from "./BookmarkPanel";
import { ShareModal } from "./ShareModal";
import { HistorySearch } from "./HistorySearch";
import { AlertTriangle, Bookmark, Share2, RefreshCw, TerminalSquare, Columns2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_TABS = 4;
const ACTIVITY_DEBOUNCE_MS = 1500;

interface TerminalSessionData {
  id: string;
  name: string;
  cwd: string;
  is_default: number;
  order_index: number;
  user_email: string;
  tmux_session_name: string;
}

interface TerminalManagerProps {
  isAdmin: boolean;
}

export function TerminalManager({ isAdmin }: TerminalManagerProps) {
  const [ownedTabs, setOwnedTabs] = useState<TerminalSessionData[]>([]);
  const [sharedTabs, setSharedTabs] = useState<TerminalSessionData[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [rightTabId, setRightTabId] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<"left" | "right">("left");
  const [activityMap, setActivityMap] = useState<Record<string, boolean>>({});
  const [cwdMap, setCwdMap] = useState<Record<string, string>>({});
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [shareModalTabId, setShareModalTabId] = useState<string | null>(null);
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const activityTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const primaryPaneRef = useRef<TerminalPaneHandle>(null);
  const lineCountRef = useRef(0);

  const ownedTabsRef = useRef(ownedTabs);
  useEffect(() => { ownedTabsRef.current = ownedTabs; }, [ownedTabs]);

  const allTabs = useMemo(() => [...ownedTabs, ...sharedTabs], [ownedTabs, sharedTabs]);

  const focusedTabId = focusedPane === "right" && rightTabId ? rightTabId : activeTabId;

  // Close split if rightTabId points to a removed tab or only 1 tab remains
  useEffect(() => {
    if (!rightTabId) return;
    if (allTabs.length < 2 || !allTabs.find((t) => t.id === rightTabId)) {
      setRightTabId(null);
      setFocusedPane("left");
    }
  }, [rightTabId, allTabs]);

  const loadSessions = useCallback(() => {
    const socket = getSocket();
    connectSocket();
    socket.emit("terminal:list");
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    const socket = getSocket();
    connectSocket();

    const handleSessions = ({
      owned,
      shared,
    }: {
      owned: TerminalSessionData[];
      shared: TerminalSessionData[];
    }) => {
      setOwnedTabs(owned);
      setSharedTabs(shared);

      const newCwdMap: Record<string, string> = {};
      for (const t of [...owned, ...shared]) {
        if (t.cwd) newCwdMap[t.id] = t.cwd;
      }
      setCwdMap((prev) => ({ ...prev, ...newCwdMap }));

      setActiveTabId((current) => {
        if (current && [...owned, ...shared].find((t) => t.id === current)) return current;
        return owned[0]?.id ?? shared[0]?.id ?? null;
      });

      setInitialized(true);
    };

    const handleCreated = ({ session }: { session: TerminalSessionData }) => {
      setOwnedTabs((prev) => [...prev, session]);
      setActiveTabId(session.id);
      setFocusedPane("left");
    };

    const handleDestroyed = ({ tabId }: { tabId: string }) => {
      setOwnedTabs((prev) => prev.filter((t) => t.id !== tabId));
      setRightTabId((r) => (r === tabId ? null : r));
      setActiveTabId((current) => {
        if (current !== tabId) return current;
        return ownedTabsRef.current.find((t) => t.id !== tabId)?.id ?? null;
      });
    };

    const handleRenamed = ({ tabId, name }: { tabId: string; name: string }) => {
      setOwnedTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, name } : t)));
      setSharedTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, name } : t)));
    };

    const handleCwd = ({ tabId, cwd }: { tabId: string; cwd: string }) => {
      setCwdMap((prev) => ({ ...prev, [tabId]: cwd }));
    };

    const handleShareReceived = ({ session }: { session: TerminalSessionData }) => {
      setSharedTabs((prev) => {
        if (prev.find((t) => t.id === session.id)) return prev;
        return [...prev, session];
      });
    };

    const handleShareRemoved = ({ tabId }: { tabId: string }) => {
      setSharedTabs((prev) => prev.filter((t) => t.id !== tabId));
    };

    const handleAutoAttach = ({
      tabId: _tabId,
      cols: _cols,
      rows: _rows,
    }: {
      tabId: string;
      cols: number;
      rows: number;
    }) => {
      setActiveTabId(_tabId);
    };

    const handleError = ({ message }: { message: string }) => {
      setError(message);
    };

    socket.on("terminal:sessions", handleSessions);
    socket.on("terminal:created", handleCreated);
    socket.on("terminal:destroyed", handleDestroyed);
    socket.on("terminal:renamed", handleRenamed);
    socket.on("terminal:cwd", handleCwd);
    socket.on("terminal:share:received", handleShareReceived);
    socket.on("terminal:share:removed", handleShareRemoved);
    socket.on("terminal:auto_attach", handleAutoAttach);
    socket.on("terminal:error", handleError);

    loadSessions();

    const handleReconnect = () => {
      loadSessions();
    };
    socket.on("connect", handleReconnect);

    const initTimeout = setTimeout(() => {
      if (!initialized) loadSessions();
    }, 5000);

    return () => {
      socket.off("terminal:sessions", handleSessions);
      socket.off("terminal:created", handleCreated);
      socket.off("terminal:destroyed", handleDestroyed);
      socket.off("terminal:renamed", handleRenamed);
      socket.off("terminal:cwd", handleCwd);
      socket.off("terminal:share:received", handleShareReceived);
      socket.off("terminal:share:removed", handleShareRemoved);
      socket.off("terminal:auto_attach", handleAutoAttach);
      socket.off("terminal:error", handleError);
      socket.off("connect", handleReconnect);
      clearTimeout(initTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, loadSessions]);

  const markActivity = useCallback((tabId: string) => {
    setActivityMap((prev) => ({ ...prev, [tabId]: true }));
    const existing = activityTimersRef.current[tabId];
    if (existing) clearTimeout(existing);
    activityTimersRef.current[tabId] = setTimeout(() => {
      setActivityMap((prev) => ({ ...prev, [tabId]: false }));
    }, ACTIVITY_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "r" && focusedTabId) {
        e.preventDefault();
        setShowHistorySearch(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [focusedTabId]);

  const handleNewTab = useCallback(() => {
    const socket = getSocket();
    socket.emit("terminal:create", {});
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const socket = getSocket();
      socket.emit("terminal:destroy", { tabId });
    },
    []
  );

  const handleRenameTab = useCallback((tabId: string, name: string) => {
    const socket = getSocket();
    socket.emit("terminal:rename", { tabId, name });
  }, []);

  const handleSplitToggle = useCallback(() => {
    setRightTabId((current) => {
      if (current) {
        setFocusedPane("left");
        return null;
      }
      const allIds = allTabs.map((t) => t.id);
      const activeIdx = allIds.indexOf(activeTabId ?? "");
      const nextIdx = (activeIdx + 1) % allIds.length;
      const nextId = allIds[nextIdx];
      return nextId !== activeTabId ? (nextId ?? null) : null;
    });
  }, [allTabs, activeTabId]);

  const handleLeftSelect = useCallback((tabId: string) => {
    if (rightTabId && tabId === rightTabId) {
      setRightTabId(activeTabId);
    }
    setActiveTabId(tabId);
    setFocusedPane("left");
  }, [rightTabId, activeTabId]);

  const handleRightSelect = useCallback((tabId: string) => {
    if (tabId === activeTabId) {
      setActiveTabId(rightTabId);
    }
    setRightTabId(tabId);
    setFocusedPane("right");
  }, [activeTabId, rightTabId]);

  useEffect(() => {
    if (primaryPaneRef.current) {
      setTimeout(() => primaryPaneRef.current?.fit(), 50);
    }
  }, [activeTabId]);

  const handleHistorySelect = useCallback(
    (command: string) => {
      if (!focusedTabId) return;
      const socket = getSocket();
      socket.emit("terminal:input", { tabId: focusedTabId, data: command });
    },
    [focusedTabId]
  );

  const tabsWithCwd = allTabs.map((t) => ({
    ...t,
    cwd: cwdMap[t.id] ?? t.cwd ?? "",
  }));

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-4 text-bot-muted">
        <AlertTriangle className="h-12 w-12 text-bot-amber/50" />
        <p className="text-body font-medium text-bot-text">Admin access required</p>
        <p className="text-caption text-bot-muted">The terminal is only available to admin users.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a10] overflow-hidden">
      {/* Toolbar */}
      <div className="relative shrink-0">
        <div className="flex items-center justify-between px-4 py-2 bg-bot-surface/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-bot-accent" />
            <span className="text-caption font-semibold text-bot-text">Server Terminal</span>
            {focusedTabId && activityMap[focusedTabId] && (
              <span className="flex items-center gap-1 text-[10px] text-bot-green">
                <span className="h-1.5 w-1.5 rounded-full bg-bot-green animate-pulse" />
                active
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {focusedTabId && ownedTabs.find((t) => t.id === focusedTabId) && (
              <button
                onClick={() => setShareModalTabId(focusedTabId)}
                className="flex items-center gap-1.5 rounded-lg border border-bot-border/40 px-2.5 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all"
                title="Share terminal"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
            )}
            <button
              onClick={() => setShowBookmarks((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-caption transition-all",
                showBookmarks
                  ? "border-bot-accent/40 text-bot-accent bg-bot-accent/10"
                  : "border-bot-border/40 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40"
              )}
              title="Toggle bookmarks"
            >
              <Bookmark className="h-3.5 w-3.5" />
              Bookmarks
            </button>
            {allTabs.length >= 2 && (
              <button
                onClick={handleSplitToggle}
                title={rightTabId ? "Close split" : "Split pane"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-caption transition-all",
                  rightTabId
                    ? "border-bot-accent/40 text-bot-accent bg-bot-accent/10"
                    : "border-bot-border/40 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40"
                )}
              >
                <Columns2 className="h-3.5 w-3.5" />
                Split
              </button>
            )}
            <button
              onClick={loadSessions}
              className="flex items-center gap-1.5 rounded-lg border border-bot-border/40 px-2.5 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all"
              title="Refresh sessions"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px gradient-accent opacity-30" />
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bot-red/10 border-b border-bot-red/30 text-bot-red text-caption shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Tab bar row — side-by-side when split, full-width when single */}
      {initialized && (
        <div className={cn("flex shrink-0", rightTabId && "gap-px")}>
          <div className={cn(rightTabId ? "w-1/2" : "flex-1")}>
            <TabBar
              compact={!!rightTabId}
              focused={!rightTabId || focusedPane === "left"}
              tabs={tabsWithCwd}
              activeTabId={activeTabId}
              activityMap={activityMap}
              maxTabs={MAX_TABS}
              onSelectTab={handleLeftSelect}
              onNewTab={handleNewTab}
              onCloseTab={handleCloseTab}
              onRenameTab={handleRenameTab}
            />
          </div>
          {rightTabId && (
            <div className="w-1/2">
              <TabBar
                compact
                focused={focusedPane === "right"}
                tabs={tabsWithCwd}
                activeTabId={rightTabId}
                activityMap={activityMap}
                maxTabs={MAX_TABS}
                onSelectTab={handleRightSelect}
                onNewTab={handleNewTab}
                onCloseTab={handleCloseTab}
                onRenameTab={handleRenameTab}
              />
            </div>
          )}
        </div>
      )}

      {/* Terminal panes — single flex container, CSS order positions left/right */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {allTabs.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-bot-muted text-caption">
            {initialized ? "No terminal sessions found" : "Loading..."}
          </div>
        )}

        {allTabs.map((tab) => {
          const isLeft = tab.id === activeTabId;
          const isRight = tab.id === rightTabId;
          const visible = isLeft || isRight;

          return (
            <div
              key={tab.id}
              className="min-h-0 min-w-0"
              style={{
                display: visible ? "flex" : "none",
                flex: visible ? "1 1 0%" : undefined,
                order: isRight ? 2 : 0,
              }}
              onPointerDownCapture={() => {
                if (rightTabId) setFocusedPane(isRight ? "right" : "left");
              }}
            >
              <TerminalPane
                ref={isLeft ? primaryPaneRef : undefined}
                tabId={tab.id}
                className="flex-1 min-h-0 p-1"
                onActivity={() => markActivity(tab.id)}
                onCwd={(cwd) => setCwdMap((prev) => ({ ...prev, [tab.id]: cwd }))}
              />
            </div>
          );
        })}

        {/* Gradient divider between split panes */}
        {rightTabId && (
          <div
            className="w-px shrink-0 gradient-accent opacity-30"
            style={{ order: 1 }}
          />
        )}

        {/* Bookmark panel */}
        {showBookmarks && focusedTabId && (
          <div style={{ order: 10 }} className="shrink-0">
            <BookmarkPanel
              tabId={focusedTabId}
              currentLineCount={lineCountRef.current}
              onClose={() => setShowBookmarks(false)}
            />
          </div>
        )}
      </div>

      {/* History search overlay */}
      {showHistorySearch && focusedTabId && (
        <HistorySearch
          tabId={focusedTabId}
          onSelect={handleHistorySelect}
          onClose={() => setShowHistorySearch(false)}
        />
      )}

      {/* Share modal */}
      {shareModalTabId && (
        <ShareModal
          tabId={shareModalTabId}
          tabName={allTabs.find((t) => t.id === shareModalTabId)?.name ?? "Terminal"}
          onClose={() => setShareModalTabId(null)}
        />
      )}
    </div>
  );
}

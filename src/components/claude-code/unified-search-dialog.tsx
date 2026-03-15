"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, MessageSquare, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { apiUrl, sanitizeSnippet, cn } from "@/lib/utils";
import type { SearchResult } from "@/types/chat";
import { motion } from "framer-motion";

type SearchMode = "session" | "global";

interface UnifiedSearchDialogProps {
  onClose: () => void;
  initialMode: SearchMode;
  sessionId?: string;
  onNavigate: (sessionId: string, messageId: string) => void;
  onHighlightsChange?: (highlights: Set<string>, activeId: string | null) => void;
}

export function UnifiedSearchDialog({
  onClose,
  initialMode,
  sessionId,
  onNavigate,
  onHighlightsChange,
}: UnifiedSearchDialogProps) {
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const doSearch = useCallback(async (q: string, searchMode: SearchMode) => {
    if (!q.trim()) {
      setResults([]);
      if (mode === "session" && onHighlightsChange) {
        onHighlightsChange(new Set(), null);
      }
      return;
    }
    setLoading(true);
    try {
      const url = searchMode === "session" && sessionId
        ? apiUrl(`/api/claude-code/search?q=${encodeURIComponent(q)}&sessionId=${sessionId}`)
        : apiUrl(`/api/claude-code/search?q=${encodeURIComponent(q)}&limit=30`);
      
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.results ?? []);
      setActiveIndex(0);

      if (searchMode === "session" && onHighlightsChange) {
        const ids = new Set<string>((data.results ?? []).map((r: SearchResult) => r.messageId));
        onHighlightsChange(ids, data.results?.[0]?.messageId ?? null);
      }
    } catch (err) {
      console.warn("[unified-search] Search failed:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, onHighlightsChange, mode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query, mode), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode, doSearch]);

  const handleModeChange = (newMode: SearchMode) => {
    setMode(newMode);
    setResults([]);
    setActiveIndex(0);
    if (onHighlightsChange) {
      onHighlightsChange(new Set(), null);
    }
  };

  const navigate = (delta: number) => {
    if (results.length === 0) return;
    const next = (activeIndex + delta + results.length) % results.length;
    setActiveIndex(next);
    if (mode === "session" && onHighlightsChange) {
      const ids = new Set(results.map((r) => r.messageId));
      onHighlightsChange(ids, results[next]?.messageId ?? null);
    }
  };

  const handleNavigate = (targetSessionId: string, messageId: string) => {
    onNavigate(targetSessionId, messageId);
    onClose();
  };

  const grouped = mode === "global"
    ? results.reduce<Record<string, { sessionName: string | null; items: SearchResult[] }>>((acc, r) => {
        if (!acc[r.sessionId]) {
          acc[r.sessionId] = { sessionName: r.sessionName, items: [] };
        }
        acc[r.sessionId].items.push(r);
        return acc;
      }, {})
    : {};

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative w-full max-w-2xl rounded-2xl glass-heavy shadow-float overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-bot-border/30 px-5 py-4">
          <Search className="h-5 w-5 text-bot-accent shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "session") {
                e.preventDefault();
                navigate(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder={mode === "session" ? "Search in session..." : "Search all sessions..."}
            className="flex-1 bg-transparent text-body text-bot-text placeholder:text-bot-muted/50 outline-none"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-bot-accent" />}
          <button onClick={onClose} className="p-1.5 rounded-lg text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-all duration-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-bot-border/20 px-5 py-2 bg-bot-elevated/20">
          <button
            onClick={() => handleModeChange("session")}
            disabled={mode === "session" || !sessionId}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-caption font-medium transition-all duration-200",
              mode === "session"
                ? "bg-bot-accent text-white shadow-sm"
                : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50"
            )}
          >
            Session
          </button>
          <button
            onClick={() => handleModeChange("global")}
            disabled={mode === "global"}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-caption font-medium transition-all duration-200",
              mode === "global"
                ? "bg-bot-accent text-white shadow-sm"
                : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50"
            )}
          >
            All Sessions
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {!loading && query && results.length === 0 && (
            <div className="px-5 py-10 text-center">
              <Search className="h-8 w-8 text-bot-muted/30 mx-auto mb-2" />
              <p className="text-caption text-bot-muted">No results found</p>
            </div>
          )}

          {mode === "session" && results.length > 0 && (
            <div className="px-5 py-3 border-b border-bot-border/20 flex items-center justify-between">
              <span className="text-[11px] font-mono text-bot-muted">
                {activeIndex + 1} of {results.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navigate(-1)}
                  disabled={results.length === 0}
                  className="p-1 text-bot-muted hover:text-bot-text disabled:opacity-30 transition-colors"
                  title="Previous (Shift+Enter)"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => navigate(1)}
                  disabled={results.length === 0}
                  className="p-1 text-bot-muted hover:text-bot-text disabled:opacity-30 transition-colors"
                  title="Next (Enter)"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {mode === "global" && !loading && Object.entries(grouped).map(([sid, group]) => (
            <div key={sid} className="border-b border-bot-border/20 last:border-b-0">
              <div className="px-5 py-2.5 bg-bot-elevated/20 text-caption font-medium text-bot-muted flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-bot-accent/50" />
                {group.sessionName ?? "Untitled Session"}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.messageId}
                  onClick={() => handleNavigate(sid, item.messageId)}
                  className="w-full px-5 py-3 text-left hover:bg-bot-elevated/30 transition-all duration-150"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                      item.senderType === "admin" ? "bg-bot-accent/15 text-bot-accent" : "bg-bot-elevated/60 text-bot-muted"
                    }`}>
                      {item.senderType === "admin" ? "User" : "Claude"}
                    </span>
                    <span className="text-[10px] text-bot-muted/50">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p
                    className="text-caption text-bot-text/80 line-clamp-2"
                    dangerouslySetInnerHTML={{ __html: sanitizeSnippet(item.snippet) }}
                  />
                </button>
              ))}
            </div>
          ))}

          {mode === "session" && !loading && results.map((item, idx) => (
            <button
              key={item.messageId}
              onClick={() => handleNavigate(item.sessionId, item.messageId)}
              className={cn(
                "w-full px-5 py-3 text-left hover:bg-bot-elevated/30 transition-all duration-150 border-b border-bot-border/10 last:border-b-0",
                idx === activeIndex && "bg-bot-elevated/20"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                  item.senderType === "admin" ? "bg-bot-accent/15 text-bot-accent" : "bg-bot-elevated/60 text-bot-muted"
                }`}>
                  {item.senderType === "admin" ? "User" : "Claude"}
                </span>
                <span className="text-[10px] text-bot-muted/50">
                  {new Date(item.timestamp).toLocaleString()}
                </span>
              </div>
              <p
                className="text-caption text-bot-text/80 line-clamp-2"
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(item.snippet) }}
              />
            </button>
          ))}
        </div>

        <div className="border-t border-bot-border/20 px-5 py-2.5 text-[10px] text-bot-muted/50">
          <kbd className="rounded bg-bot-elevated/40 px-1.5 py-0.5 font-mono">Esc</kbd> to close
          {mode === "session" && results.length > 0 && (
            <>
              {" • "}
              <kbd className="rounded bg-bot-elevated/40 px-1.5 py-0.5 font-mono">Enter</kbd> next
              {" • "}
              <kbd className="rounded bg-bot-elevated/40 px-1.5 py-0.5 font-mono">Shift+Enter</kbd> previous
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

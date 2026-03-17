"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { Search, X, Clock, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

interface HistorySearchProps {
  tabId: string;
  onSelect: (command: string) => void;
  onClose: () => void;
}

export function HistorySearch({ tabId, onSelect, onClose }: HistorySearchProps) {
  const [query, setQuery] = useState("");
  const [allHistory, setAllHistory] = useState<string[]>([]);
  const [filtered, setFiltered] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = getSocket();

    const handleData = ({
      tabId: tid,
      shellHistory,
      tmuxHistory,
      scrollback,
    }: {
      tabId: string;
      shellHistory: string[];
      tmuxHistory: string[];
      scrollback: string[];
    }) => {
      if (tid !== tabId) return;

      // Deduplicate and combine, shell history first (most authoritative)
      const seen = new Set<string>();
      const combined: string[] = [];

      const addUnique = (lines: string[]) => {
        for (const line of [...lines].reverse()) {
          const trimmed = line.trim();
          if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            combined.push(trimmed);
          }
        }
      };

      addUnique(shellHistory);
      addUnique(tmuxHistory);
      addUnique(scrollback);

      setAllHistory(combined);
      setFiltered(combined.slice(0, 50));
      setLoading(false);
    };

    socket.on("terminal:history:data", handleData);
    socket.emit("terminal:history:get", { tabId });

    return () => {
      socket.off("terminal:history:data", handleData);
    };
  }, [tabId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setFiltered(allHistory.slice(0, 50));
      setSelectedIndex(0);
      return;
    }
    const lower = query.toLowerCase();
    const results = allHistory
      .filter((line) => line.toLowerCase().includes(lower))
      .slice(0, 50);
    setFiltered(results);
    setSelectedIndex(0);
  }, [query, allHistory]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex]);
          onClose();
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filtered, selectedIndex, onSelect, onClose]
  );

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return <span>{text}</span>;
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return <span>{text}</span>;
    return (
      <>
        <span>{text.slice(0, idx)}</span>
        <span className="bg-bot-accent/30 text-bot-accent">{text.slice(idx, idx + q.length)}</span>
        <span>{text.slice(idx + q.length)}</span>
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-bot-surface rounded-xl border border-bot-border/60 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-bot-border/40">
          <Search className="h-4 w-4 text-bot-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search command history..."
            className="flex-1 bg-transparent text-body text-bot-text placeholder:text-bot-muted focus:outline-none"
          />
          <button
            onClick={onClose}
            className="shrink-0 rounded p-0.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {loading && (
            <p className="text-center text-caption text-bot-muted py-6">Loading history...</p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-caption text-bot-muted py-6">No results found</p>
          )}
          {filtered.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors",
                idx === selectedIndex
                  ? "bg-bot-accent/15 text-bot-text"
                  : "hover:bg-bot-elevated/40 text-bot-muted"
              )}
              onClick={() => { onSelect(line); onClose(); }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <Terminal className="h-3.5 w-3.5 shrink-0 text-bot-muted" />
              <code className="flex-1 text-caption font-mono truncate">
                {highlightMatch(line, query)}
              </code>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-bot-border/40 text-[10px] text-bot-muted">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{allHistory.length} entries</span>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

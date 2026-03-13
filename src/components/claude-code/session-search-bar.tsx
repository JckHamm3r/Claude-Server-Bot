"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { apiUrl } from "@/lib/utils";

interface SearchResult {
  messageId: string;
  sessionId: string;
  sessionName: string | null;
  senderType: string;
  content: string;
  snippet: string;
  timestamp: string;
}

interface SessionSearchBarProps {
  sessionId: string;
  onClose: () => void;
  onHighlightsChange: (highlights: Set<string>, activeId: string | null) => void;
}

export function SessionSearchBar({ sessionId, onClose, onHighlightsChange }: SessionSearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      onHighlightsChange(new Set(), null);
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/claude-code/search?q=${encodeURIComponent(q)}&sessionId=${sessionId}`));
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.results ?? []);
      setActiveIndex(0);
      const ids = new Set<string>((data.results ?? []).map((r: SearchResult) => r.messageId));
      onHighlightsChange(ids, data.results?.[0]?.messageId ?? null);
    } catch {
      /* ignore */
    }
  }, [sessionId, onHighlightsChange]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const navigate = (delta: number) => {
    if (results.length === 0) return;
    const next = (activeIndex + delta + results.length) % results.length;
    setActiveIndex(next);
    const ids = new Set(results.map((r) => r.messageId));
    onHighlightsChange(ids, results[next]?.messageId ?? null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="flex items-center gap-2 border-b border-bot-border bg-bot-surface px-4 py-2">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            navigate(e.shiftKey ? -1 : 1);
          }
        }}
        placeholder="Search in session..."
        className="flex-1 rounded-md border border-bot-border bg-bot-elevated px-3 py-1.5 text-caption text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent"
      />
      {results.length > 0 && (
        <span className="text-[11px] font-mono text-bot-muted whitespace-nowrap">
          {activeIndex + 1} of {results.length}
        </span>
      )}
      <button onClick={() => navigate(-1)} disabled={results.length === 0} className="p-1 text-bot-muted hover:text-bot-text disabled:opacity-30 transition-colors">
        <ChevronUp className="h-4 w-4" />
      </button>
      <button onClick={() => navigate(1)} disabled={results.length === 0} className="p-1 text-bot-muted hover:text-bot-text disabled:opacity-30 transition-colors">
        <ChevronDown className="h-4 w-4" />
      </button>
      <button onClick={onClose} className="p-1 text-bot-muted hover:text-bot-text transition-colors">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

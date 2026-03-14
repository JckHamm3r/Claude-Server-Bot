"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, MessageSquare } from "lucide-react";
import { apiUrl, sanitizeSnippet } from "@/lib/utils";
import type { SearchResult } from "@/types/chat";

interface GlobalSearchDialogProps {
  onClose: () => void;
  onNavigate: (sessionId: string, messageId: string) => void;
}

export function GlobalSearchDialog({ onClose, onNavigate }: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/claude-code/search?q=${encodeURIComponent(q)}&limit=30`));
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // Group results by session
  const grouped = results.reduce<Record<string, { sessionName: string | null; items: SearchResult[] }>>((acc, r) => {
    if (!acc[r.sessionId]) {
      acc[r.sessionId] = { sessionName: r.sessionName, items: [] };
    }
    acc[r.sessionId].items.push(r);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-2xl rounded-xl border border-bot-border bg-bot-bg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-bot-border px-4 py-3">
          <Search className="h-5 w-5 text-bot-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all sessions..."
            className="flex-1 bg-transparent text-body text-bot-text placeholder-bot-muted outline-none"
          />
          <button onClick={onClose} className="p-1 text-bot-muted hover:text-bot-text transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-caption text-bot-muted">Searching...</div>
          )}
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-6 text-center text-caption text-bot-muted">No results found</div>
          )}
          {!loading && Object.entries(grouped).map(([sessionId, group]) => (
            <div key={sessionId} className="border-b border-bot-border/40 last:border-b-0">
              <div className="px-4 py-2 bg-bot-surface text-caption font-medium text-bot-muted flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" />
                {group.sessionName ?? "Untitled Session"}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.messageId}
                  onClick={() => {
                    onNavigate(sessionId, item.messageId);
                    onClose();
                  }}
                  className="w-full px-4 py-2.5 text-left hover:bg-bot-elevated transition-colors"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                      item.senderType === "admin" ? "bg-bot-accent/20 text-bot-accent" : "bg-bot-elevated text-bot-muted"
                    }`}>
                      {item.senderType === "admin" ? "User" : "Claude"}
                    </span>
                    <span className="text-[10px] text-bot-muted">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p
                    className="text-caption text-bot-text line-clamp-2"
                    dangerouslySetInnerHTML={{ __html: sanitizeSnippet(item.snippet) }}
                  />
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-bot-border px-4 py-2 text-[10px] text-bot-muted">
          Esc to close · Enter to search
        </div>
      </div>
    </div>
  );
}

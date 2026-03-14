"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, MessageSquare, Loader2 } from "lucide-react";
import { apiUrl, sanitizeSnippet } from "@/lib/utils";
import type { SearchResult } from "@/types/chat";
import { motion } from "framer-motion";

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

  const grouped = results.reduce<Record<string, { sessionName: string | null; items: SearchResult[] }>>((acc, r) => {
    if (!acc[r.sessionId]) {
      acc[r.sessionId] = { sessionName: r.sessionName, items: [] };
    }
    acc[r.sessionId].items.push(r);
    return acc;
  }, {});

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
            placeholder="Search all sessions..."
            className="flex-1 bg-transparent text-body text-bot-text placeholder:text-bot-muted/50 outline-none"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-bot-accent" />}
          <button onClick={onClose} className="p-1.5 rounded-lg text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-all duration-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {!loading && query && results.length === 0 && (
            <div className="px-5 py-10 text-center">
              <Search className="h-8 w-8 text-bot-muted/30 mx-auto mb-2" />
              <p className="text-caption text-bot-muted">No results found</p>
            </div>
          )}
          {!loading && Object.entries(grouped).map(([sessionId, group]) => (
            <div key={sessionId} className="border-b border-bot-border/20 last:border-b-0">
              <div className="px-5 py-2.5 bg-bot-elevated/20 text-caption font-medium text-bot-muted flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-bot-accent/50" />
                {group.sessionName ?? "Untitled Session"}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.messageId}
                  onClick={() => {
                    onNavigate(sessionId, item.messageId);
                    onClose();
                  }}
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
        </div>

        <div className="border-t border-bot-border/20 px-5 py-2.5 text-[10px] text-bot-muted/50">
          <kbd className="rounded bg-bot-elevated/40 px-1.5 py-0.5 font-mono">Esc</kbd> to close
        </div>
      </motion.div>
    </div>
  );
}

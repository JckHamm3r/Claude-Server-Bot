"use client";

import { useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Loader2, MessageSquare, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeSession } from "@/lib/claude-db";

interface SessionSidebarProps {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  onSelect: (session: ClaudeSession) => void;
  onNew: () => void;
  onDelete: (session: ClaudeSession) => void;
  onRename: (session: ClaudeSession, newName: string) => void;
  onUpdateTags: (session: ClaudeSession, tags: string[]) => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onUpdateTags,
}: SessionSidebarProps) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [tagEditingId, setTagEditingId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Collect all unique tags across all sessions
  const allTags = Array.from(
    new Set(sessions.flatMap((s) => s.tags ?? [])),
  ).sort();

  const filtered = sessions.filter((s) => {
    const q = search.toLowerCase();
    const nameMatch = !q || (s.name ?? "Untitled").toLowerCase().includes(q);
    const tagMatch =
      activeTagFilters.length === 0 ||
      activeTagFilters.every((t) => (s.tags ?? []).includes(t));
    return nameMatch && tagMatch;
  });

  function startRename(session: ClaudeSession, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(session.id);
    setEditingName(session.name ?? "");
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitRename(session: ClaudeSession) {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== session.name) {
      onRename(session, trimmed);
    }
    setEditingId(null);
  }

  function cancelRename() {
    setEditingId(null);
  }

  function openTagEditor(session: ClaudeSession, e: React.MouseEvent) {
    e.stopPropagation();
    setTagEditingId(session.id);
    setTagInput("");
    setTimeout(() => tagInputRef.current?.focus(), 0);
  }

  function removeTag(session: ClaudeSession, tag: string, e: React.MouseEvent) {
    e.stopPropagation();
    const newTags = (session.tags ?? []).filter((t) => t !== tag);
    onUpdateTags(session, newTags);
  }

  function commitTagInput(session: ClaudeSession) {
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !(session.tags ?? []).includes(tag)) {
      onUpdateTags(session, [...(session.tags ?? []), tag]);
    }
    setTagInput("");
    setTagEditingId(null);
  }

  function toggleTagFilter(tag: string) {
    setActiveTagFilters((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-bot-border bg-bot-surface">
      <div className="border-b border-bot-border p-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-bot-accent px-3 py-2 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Session
        </button>
      </div>

      <div className="border-b border-bot-border px-3 py-2 space-y-2">
        {/* Search input */}
        <div className="flex items-center gap-2 rounded-md border border-bot-border bg-bot-elevated px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-bot-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="w-full bg-transparent text-caption text-bot-text placeholder-bot-muted outline-none"
          />
        </div>

        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTagFilter(tag)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                  activeTagFilters.includes(tag)
                    ? "bg-bot-accent text-white"
                    : "bg-bot-elevated text-bot-muted hover:text-bot-text border border-bot-border",
                )}
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </button>
            ))}
            {activeTagFilters.length > 0 && (
              <button
                onClick={() => setActiveTagFilters([])}
                className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] text-bot-muted hover:text-bot-red transition-colors"
                title="Clear filters"
              >
                <X className="h-2.5 w-2.5" />
                clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-caption text-bot-muted">
            {search || activeTagFilters.length > 0 ? "No matches" : "No sessions yet"}
          </p>
        ) : (
          filtered.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group relative flex items-start gap-2.5 px-3 py-2.5 transition-colors cursor-pointer",
                session.id === activeSessionId
                  ? "bg-bot-accent/10 text-bot-accent border-l-2 border-bot-accent"
                  : "text-bot-muted hover:bg-bot-elevated hover:text-bot-text",
              )}
              onClick={() => editingId !== session.id && onSelect(session)}
            >
              <div className="relative mt-0.5 shrink-0">
                {session.status === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-bot-accent" />
                ) : session.status === "needs_attention" ? (
                  <AlertCircle className="h-4 w-4 text-bot-amber animate-pulse" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                {session.skip_permissions && (
                  <span title="Skip Permissions mode" className="absolute -right-1.5 -top-1.5">
                    <AlertTriangle className="h-3 w-3 text-bot-red" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {editingId === session.id ? (
                  <input
                    ref={inputRef}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => commitRename(session)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(session);
                      if (e.key === "Escape") cancelRename();
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded border border-bot-accent bg-bot-elevated px-1 py-0.5 text-body text-bot-text outline-none"
                    autoFocus
                  />
                ) : (
                  <p
                    className="truncate text-body font-medium"
                    onDoubleClick={(e) => startRename(session, e)}
                    title="Double-click to rename"
                  >
                    {session.name ?? "Untitled"}
                  </p>
                )}

                <p className="truncate text-caption text-bot-muted">
                  {new Date(session.updated_at).toLocaleDateString()}
                </p>

                {/* Tag pills */}
                {(session.tags ?? []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(session.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-0.5 rounded-full bg-bot-elevated px-1.5 py-0.5 text-[10px] text-bot-muted border border-bot-border"
                      >
                        {tag}
                        <button
                          onClick={(e) => removeTag(session, tag, e)}
                          className="hover:text-bot-red transition-colors"
                        >
                          <X className="h-2 w-2" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Inline tag editor */}
                {tagEditingId === session.id && (
                  <input
                    ref={tagInputRef}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onBlur={() => commitTagInput(session)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitTagInput(session); }
                      if (e.key === "Escape") { e.preventDefault(); setTagEditingId(null); }
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Add tag…"
                    className="mt-1 w-full rounded border border-bot-accent bg-bot-elevated px-1.5 py-0.5 text-caption text-bot-text outline-none"
                  />
                )}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {/* Add tag button */}
                <button
                  onClick={(e) => openTagEditor(session, e)}
                  className="hidden group-hover:flex items-center justify-center rounded p-0.5 text-bot-muted hover:text-bot-accent transition-colors"
                  title="Add tag"
                >
                  <Tag className="h-3.5 w-3.5" />
                </button>
                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session);
                  }}
                  className="hidden group-hover:flex items-center justify-center rounded p-0.5 text-bot-muted hover:text-bot-red transition-colors"
                  title="Delete session"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

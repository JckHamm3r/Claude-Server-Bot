"use client";

import { useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Loader2, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Search, Tag, Trash2, Users, X } from "lucide-react";
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
  loading?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  currentEmail?: string;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onUpdateTags,
  loading = false,
  collapsed = false,
  onToggleCollapse,
  currentEmail: _currentEmail,
}: SessionSidebarProps) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [tagEditingId, setTagEditingId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

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

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-bot-border/40 bg-bot-surface/80 backdrop-blur-sm py-2 gap-2">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center rounded-md p-1.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
          title="Show sessions"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <button
          onClick={onNew}
          className="flex items-center justify-center rounded-md p-1.5 text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-colors"
          title="New Session"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-bot-border/40 bg-bot-surface/80 backdrop-blur-sm">
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={onNew}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl gradient-accent px-3 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
        >
          <Plus className="h-4 w-4" />
          New Session
        </button>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="flex items-center justify-center rounded-md p-1.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-colors"
            title="Hide sessions"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="border-b border-bot-border/40 px-3 pb-2.5 space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-bot-border/50 bg-bot-elevated/40 px-2.5 py-2 focus-within:border-bot-accent/50 focus-within:shadow-glow-sm transition-all duration-200">
          <Search className="h-3.5 w-3.5 shrink-0 text-bot-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="w-full bg-transparent text-caption text-bot-text placeholder:text-bot-muted/60 outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-bot-muted hover:text-bot-text transition-colors">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTagFilter(tag)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all duration-200",
                  activeTagFilters.includes(tag)
                    ? "gradient-accent text-white shadow-glow-sm"
                    : "bg-bot-elevated/60 text-bot-muted hover:text-bot-text border border-bot-border/50 hover:border-bot-accent/40",
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
        {loading && (
          <div className="space-y-2 px-3 py-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg shimmer-bg" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <MessageSquare className="h-8 w-8 text-bot-muted/30 mb-2" />
            <p className="text-caption text-bot-muted">
              {search || activeTagFilters.length > 0 ? "No matches found" : "No sessions yet"}
            </p>
          </div>
        ) : !loading ? (
          filtered.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group relative flex items-start gap-2.5 mx-1.5 mb-0.5 rounded-lg px-2.5 py-2.5 transition-all duration-200 cursor-pointer",
                session.id === activeSessionId
                  ? "bg-bot-accent/10 text-bot-text border-l-2 border-bot-accent shadow-glow-sm"
                  : session.is_new_invite
                  ? "bg-bot-accent/5 text-bot-text border-l-2 border-bot-accent/50 hover:bg-bot-accent/10"
                  : "text-bot-muted hover:bg-bot-elevated/50 hover:text-bot-text",
              )}
              onClick={() => editingId !== session.id && onSelect(session)}
            >
              <div className="relative mt-0.5 shrink-0">
                {session.status === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-bot-accent" />
                ) : session.status === "needs_attention" ? (
                  <div className="relative">
                    <AlertCircle className="h-4 w-4 text-bot-amber" />
                    <div className="absolute -inset-1 rounded-full bg-bot-amber/20 animate-ping" />
                  </div>
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                {session.skip_permissions && (
                  <span title="Skip Permissions mode" className="absolute -right-1.5 -top-1.5">
                    <AlertTriangle className="h-3 w-3 text-bot-red" />
                  </span>
                )}
                {session.is_new_invite && (
                  <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bot-accent opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-bot-accent" />
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
                    className="w-full rounded-lg border border-bot-accent bg-bot-elevated/60 px-2 py-1 text-body text-bot-text outline-none shadow-glow-sm"
                    autoFocus
                  />
                ) : (
                  <p
                    className="truncate text-body font-medium"
                    onDoubleClick={(e) => !session.shared_by && startRename(session, e)}
                    title={session.shared_by ? `Shared by ${session.shared_by}` : "Double-click to rename"}
                  >
                    {session.name ?? "Untitled"}
                  </p>
                )}

                <p className="truncate text-caption text-bot-muted/70">
                  {new Date(session.updated_at).toLocaleDateString()}
                  {session.shared_by ? (
                    <>
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-bot-muted/15 px-1.5 py-px text-[10px] font-medium text-bot-muted border border-bot-border/40" title={`Shared by ${session.shared_by}`}>
                        <Users className="h-2.5 w-2.5" />
                        Guest
                      </span>
                      {session.is_new_invite && (
                        <span className="ml-1 inline-flex items-center rounded-full bg-bot-accent px-1.5 py-px text-[10px] font-bold text-white shadow-glow-sm">
                          New
                        </span>
                      )}
                    </>
                  ) : null}
                  {session.personality && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-bot-accent/10 px-1.5 py-px text-[10px] font-medium text-bot-accent">
                      {session.personality}
                    </span>
                  )}
                </p>

                {(session.tags ?? []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(session.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-0.5 rounded-full bg-bot-elevated/60 px-1.5 py-0.5 text-[10px] text-bot-muted border border-bot-border/40"
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
                    placeholder="Add tag..."
                    className="mt-1 w-full rounded-lg border border-bot-accent bg-bot-elevated/60 px-2 py-1 text-caption text-bot-text outline-none"
                  />
                )}
              </div>

              <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                {!session.shared_by && (
                  <button
                    onClick={(e) => openTagEditor(session, e)}
                    className="flex items-center justify-center rounded-md p-1 text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-colors"
                    title="Add tag"
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session);
                  }}
                  className={cn(
                    "flex items-center justify-center rounded-md p-1 transition-colors",
                    session.shared_by
                      ? "text-bot-muted hover:text-bot-amber hover:bg-bot-amber/10"
                      : "text-bot-muted hover:text-bot-red hover:bg-bot-red/10"
                  )}
                  title={session.shared_by ? "Leave shared session" : "Delete session"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        ) : null}
      </div>
    </div>
  );
}

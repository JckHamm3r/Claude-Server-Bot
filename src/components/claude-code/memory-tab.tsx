"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { apiUrl } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { MonacoEditor } from "./monaco-editor";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Upload,
  Check,
  X,
  FileText,
  Brain,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Sparkles,
  RotateCcw,
  Globe,
  Tag,
  Users,
  Filter,
  Search,
  MessageSquare,
} from "lucide-react";
import { TriggerPhraseInput } from "./trigger-phrase-input";

// ── Types ─────────────────────────────────────────────────────────────────────

const MAIN_SESSION_TARGET = "__main_session__";

interface Memory {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  is_global: boolean;
  source_session_id: string | null;
  assigned_agent_ids: string[];
}

interface AgentOption {
  id: string;
  name: string;
  icon: string | null;
}

type MainTab = "memories" | "files";
type SaveState = "idle" | "saving" | "saved" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FRIENDLY_NAMES: Record<string, string> = {
  "CLAUDE.md": "Project Instructions (CLAUDE.md)",
  "memory/MEMORY.md": "Memory Index",
  "memory/claude_code_interface.md": "Claude Code Interface Notes",
  "memory/feedback_nginx_rules.md": "Feedback Nginx Rules",
  "memory/reference_api_docs.md": "API Reference",
};

function friendlyName(file: string): string {
  if (FRIENDLY_NAMES[file]) return FRIENDLY_NAMES[file];
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.md$/, "").replace(/_/g, " ");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── Memory Item ───────────────────────────────────────────────────────────────

interface MemoryItemProps {
  memory: Memory;
  isAdmin: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: (memory: Memory) => void;
  onDelete: (id: string) => void;
  agents: AgentOption[];
}

function MemoryItem({ memory, isAdmin, isExpanded, onToggle, onEdit, onDelete, agents }: MemoryItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const scopeBadges = () => {
    if (memory.is_global) {
      return (
        <span className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 bg-bot-elevated/30 text-bot-muted border border-bot-border/25">
          <Globe className="h-2.5 w-2.5" />
          Global
        </span>
      );
    }
    if (memory.source_session_id) {
      return (
        <span className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 bg-bot-accent/10 text-bot-accent border border-bot-accent/25">
          <MessageSquare className="h-2.5 w-2.5" />
          Session
        </span>
      );
    }
    const ids = memory.assigned_agent_ids ?? [];
    if (ids.length === 0) {
      return (
        <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-bot-amber/10 text-bot-amber border border-bot-amber/25">
          Unassigned
        </span>
      );
    }
    const displayIds = ids.slice(0, 3);
    const remainder = ids.length - displayIds.length;
    return (
      <span className="flex items-center gap-1 flex-wrap">
        {displayIds.map((aid) => {
          const label =
            aid === MAIN_SESSION_TARGET
              ? "Main Session"
              : (agents.find((a) => a.id === aid)?.name ?? aid.slice(0, 8));
          return (
            <span
              key={aid}
              className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 bg-bot-elevated/30 text-bot-muted border border-bot-border/25"
            >
              <Tag className="h-2.5 w-2.5" />
              {label}
            </span>
          );
        })}
        {remainder > 0 && (
          <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-bot-elevated/30 text-bot-muted border border-bot-border/25">
            +{remainder} more
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="group border border-bot-border/25 rounded-lg bg-bot-surface/30 hover:bg-bot-surface/50 hover:border-bot-border/40 transition-all duration-150 overflow-hidden">
      <div
        className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer select-none"
        onClick={onToggle}
      >
        <span className="text-bot-muted/50 group-hover:text-bot-muted transition-colors shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <Brain className="h-3.5 w-3.5 text-bot-accent/60 shrink-0" />
        <span className="flex-1 text-[13px] font-medium text-bot-text truncate leading-snug">
          {memory.title}
        </span>
        {memory.tags?.length > 0 && (
          <span className="hidden sm:flex items-center gap-1 shrink-0">
            {memory.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[9.5px] rounded px-1.5 py-0.5 bg-bot-elevated/40 border border-bot-border/20 text-bot-muted/60">
                {tag}
              </span>
            ))}
            {memory.tags.length > 3 && (
              <span className="text-[9px] text-bot-muted/40">+{memory.tags.length - 3}</span>
            )}
          </span>
        )}
        <span className="hidden sm:flex items-center gap-1 shrink-0">
          {scopeBadges()}
        </span>
        <span className="text-[11px] text-bot-muted/50 shrink-0 hidden sm:block ml-1">
          {formatDate(memory.updated_at)}
        </span>
        {isAdmin && (
          <div
            className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onEdit(memory)}
              className="p-1 rounded-md text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-all"
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </button>
            {confirmDelete ? (
              <>
                <button
                  onClick={() => onDelete(memory.id)}
                  className="p-1 rounded-md text-bot-red hover:bg-bot-red/10 transition-all"
                  title="Confirm delete"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="p-1 rounded-md text-bot-muted hover:bg-bot-elevated/40 transition-all"
                  title="Cancel"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1 rounded-md text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-all"
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
      {isExpanded && (
        <div className="px-4 pb-3.5 pt-2 border-t border-bot-border/15 bg-bot-bg/30">
          <pre className="text-[12.5px] text-bot-text/75 whitespace-pre-wrap font-sans leading-relaxed">
            {memory.content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Memory Edit Modal ─────────────────────────────────────────────────────────

interface MemoryEditModalProps {
  memory: Memory | null;
  onSave: (title: string, content: string, isGlobal: boolean, agentIds: string[], tags: string[]) => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
  agents: AgentOption[];
}

function MemoryEditModal({ memory, onSave, onClose, saving, error, agents }: MemoryEditModalProps) {
  const [title, setTitle] = useState(memory?.title ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const [isGlobal, setIsGlobal] = useState(memory?.is_global ?? true);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(memory?.assigned_agent_ids ?? []);
  const [tags, setTags] = useState<string[]>(memory?.tags ?? []);
  const titleRef = useRef<HTMLInputElement>(null);

  // Refactor state
  const [refactoring, setRefactoring] = useState(false);
  const [refactorError, setRefactorError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [botName, setBotName] = useState("AI");

  useEffect(() => {
    titleRef.current?.focus();
    fetch(apiUrl("/api/bot-identity"))
      .then((r) => r.json())
      .then((d: { name?: string }) => { if (d.name) setBotName(d.name); })
      .catch(() => { /* keep default */ });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(title.trim(), content, isGlobal, isGlobal ? [] : selectedAgentIds, tags);
  };

  const handleRefactor = async () => {
    if (!title.trim() && !content.trim()) return;
    setRefactoring(true);
    setRefactorError(null);
    setPreview(null);
    try {
      const res = await fetch(apiUrl("/api/claude-code/memories/refactor"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json() as { title?: string; content?: string; error?: string };
      if (!res.ok || data.error) {
        setRefactorError(data.error ?? "Refactor failed.");
        return;
      }
      if (data.title && data.content) {
        setPreview({ title: data.title, content: data.content });
      }
    } catch {
      setRefactorError("Network error. Please try again.");
    } finally {
      setRefactoring(false);
    }
  };

  const applyPreview = () => {
    if (!preview) return;
    setTitle(preview.title);
    setContent(preview.content);
    setPreview(null);
  };

  const dismissPreview = () => setPreview(null);

  const hasContent = title.trim() || content.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-bot-surface border border-bot-border/40 rounded-2xl shadow-2xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-bot-border/30">
          <h2 className="text-[14px] font-semibold text-bot-text">
            {memory ? "Edit Memory" : "New Memory"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
            {/* Title */}
            <div className="px-5 pt-4 pb-3">
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => { setTitle(e.target.value); setPreview(null); }}
                placeholder="Title — short and descriptive"
                className="w-full px-3 py-2 rounded-lg bg-bot-bg border border-bot-border/30 text-[13px] text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all"
              />
            </div>

            {/* Content */}
            <div className="flex flex-col px-5 pb-3">
              <textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setPreview(null); }}
                placeholder="Memory content…"
                className="min-h-[140px] w-full px-3 py-2.5 rounded-lg bg-bot-bg border border-bot-border/30 text-[12.5px] text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all resize-none font-mono leading-relaxed"
              />
            </div>

            {/* Tags */}
            <div className="px-5 pb-3">
              <p className="text-[10.5px] uppercase tracking-wider text-bot-muted/50 font-semibold mb-2">Tags</p>
              <TriggerPhraseInput
                value={tags}
                onChange={setTags}
                placeholder="Add tags (press Enter)…"
              />
            </div>

            {/* Scope */}
            <div className="px-5 pb-3">
              <p className="text-[10.5px] uppercase tracking-wider text-bot-muted/50 font-semibold mb-2">Scope</p>
              <button
                type="button"
                onClick={() => setIsGlobal((v) => !v)}
                className={[
                  "flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-[12.5px] font-medium transition-all duration-150",
                  isGlobal
                    ? "gradient-accent text-white border-transparent shadow-glow-sm"
                    : "bg-bot-bg border-bot-border/30 text-bot-muted hover:border-bot-border/50",
                ].join(" ")}
              >
                {isGlobal ? (
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Users className="h-3.5 w-3.5 shrink-0" />
                )}
                {isGlobal ? "Global — apply to all agents" : "Agent-specific"}
              </button>

              {!isGlobal && (
                <div className="mt-2 border border-bot-border/25 rounded-lg overflow-hidden">
                  {[
                    { id: MAIN_SESSION_TARGET, name: "Main Session", icon: null as string | null },
                    ...agents,
                  ].map((target) => {
                    const checked = selectedAgentIds.includes(target.id);
                    return (
                      <label
                        key={target.id}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-bot-elevated/20 transition-colors border-b border-bot-border/15 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedAgentIds((prev) =>
                              checked ? prev.filter((id) => id !== target.id) : [...prev, target.id]
                            )
                          }
                          className="accent-bot-accent h-3.5 w-3.5 shrink-0"
                        />
                        <span className="text-[12.5px] shrink-0">
                          {target.icon ?? (target.id === MAIN_SESSION_TARGET ? "🖥️" : "🤖")}
                        </span>
                        <span className="text-[12.5px] text-bot-text">{target.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {!isGlobal && selectedAgentIds.length === 0 && (
                <p className="mt-1.5 text-[11px] text-bot-amber">Select at least one target.</p>
              )}
            </div>

            {/* AI Refactor preview */}
            {preview && (
              <div className="mx-5 mb-3 rounded-xl border border-bot-accent/25 bg-bot-accent/5 overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-bot-accent/15">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-bot-accent" />
                    <span className="text-[11.5px] font-semibold text-bot-accent">{botName} suggestion</span>
                  </div>
                  <button
                    type="button"
                    onClick={dismissPreview}
                    className="p-1 rounded text-bot-muted/60 hover:text-bot-muted transition-colors"
                    title="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="px-3.5 py-3 space-y-2">
                  <div>
                    <p className="text-[10.5px] uppercase tracking-wider text-bot-muted/50 font-semibold mb-0.5">Title</p>
                    <p className="text-[12.5px] font-medium text-bot-text">{preview.title}</p>
                  </div>
                  <div>
                    <p className="text-[10.5px] uppercase tracking-wider text-bot-muted/50 font-semibold mb-0.5">Content</p>
                    <pre className="text-[12px] text-bot-text/80 whitespace-pre-wrap font-sans leading-relaxed">
                      {preview.content}
                    </pre>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-bot-accent/15">
                  <button
                    type="button"
                    onClick={applyPreview}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-semibold gradient-accent text-white shadow-glow-sm hover:brightness-110 active:scale-[0.98] transition-all"
                  >
                    <Check className="h-3 w-3" />
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={dismissPreview}
                    className="px-3 py-1 rounded-lg text-[12px] text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30 transition-all"
                  >
                    Keep mine
                  </button>
                </div>
              </div>
            )}

            {/* Errors */}
            {(error || refactorError) && (
              <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-bot-red/10 border border-bot-red/20 text-bot-red text-[12px]">
                {error ?? refactorError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-bot-border/25 shrink-0">
            {/* Refactor button — left side */}
            <button
              type="button"
              onClick={handleRefactor}
              disabled={!hasContent || refactoring || saving}
              title={`Ask ${botName} to rewrite this memory for clarity and precision`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-bot-muted hover:text-bot-accent hover:bg-bot-accent/8 border border-bot-border/25 hover:border-bot-accent/30 disabled:opacity-40 transition-all duration-150"
            >
              {refactoring ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Refactoring…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Refactor with {botName}
                </>
              )}
            </button>

            {/* Cancel / Save — right side */}
            <div className="flex items-center gap-2">
              {preview && (
                <button
                  type="button"
                  onClick={handleRefactor}
                  disabled={refactoring || saving}
                  title="Re-run refactor"
                  className="p-1.5 rounded-lg text-bot-muted/60 hover:text-bot-muted hover:bg-bot-elevated/30 transition-all"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-[12.5px] text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || saving}
                className="px-4 py-1.5 rounded-lg text-[12.5px] font-semibold gradient-accent text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200 flex items-center gap-1.5"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {memory ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Import Modal ──────────────────────────────────────────────────────────────

interface ImportModalProps {
  onImport: (content: string) => void;
  onClose: () => void;
  importing: boolean;
  importError: string | null;
}

function ImportModal({ onImport, onClose, importing, importError }: ImportModalProps) {
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.name.endsWith(".md") && !file.type.includes("text")) return;
    const reader = new FileReader();
    reader.onload = (e) => setText(e.target?.result as string ?? "");
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-bot-surface border border-bot-border/40 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-bot-border/30">
          <div>
            <h2 className="text-[14px] font-semibold text-bot-text">Import from Markdown</h2>
            <p className="text-[11px] text-bot-muted/70 mt-0.5">
              AI extracts individual memory items from your file automatically.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={importing}
            className="p-1.5 rounded-lg text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col flex-1 min-h-0 p-5 gap-3.5 overflow-y-auto">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={[
              "border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-200",
              dragOver
                ? "border-bot-accent bg-bot-accent/5"
                : "border-bot-border/30 hover:border-bot-accent/40 hover:bg-bot-elevated/10",
            ].join(" ")}
          >
            <Upload className="h-5 w-5 mx-auto mb-1.5 text-bot-muted/60" />
            <p className="text-[12.5px] text-bot-muted/70">
              Drop a <span className="text-bot-accent font-medium">.md file</span> here, or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-bot-muted/70 font-semibold mb-1.5">
              Or paste markdown
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"# My Notes\n\n## Section 1\nSome important context…"}
              className="w-full h-40 px-3 py-2.5 rounded-lg bg-bot-bg border border-bot-border/30 text-[12px] text-bot-text placeholder:text-bot-muted/30 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all resize-none font-mono"
            />
          </div>

          {importError && (
            <div className="px-3 py-2 rounded-lg bg-bot-red/10 border border-bot-red/20 text-bot-red text-[12px]">
              {importError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-bot-border/25">
          <button
            onClick={onClose}
            disabled={importing}
            className="px-4 py-1.5 rounded-lg text-[12.5px] text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onImport(text)}
            disabled={!text.trim() || importing}
            className="px-4 py-1.5 rounded-lg text-[12.5px] font-semibold gradient-accent text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200 flex items-center gap-1.5"
          >
            {importing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Brain className="h-3.5 w-3.5" />
                Import with AI
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main MemoryTab ────────────────────────────────────────────────────────────

export function MemoryTab() {
  const { data: session } = useSession();
  const isAdmin = Boolean((session?.user as { isAdmin?: boolean })?.isAdmin);

  // Filters
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [agents, setAgents] = useState<AgentOption[]>([]);

  // Load agents via socket on mount
  useEffect(() => {
    const socket = getSocket();
    const handleAgents = (data: { agents: Array<{ id: string; name: string; icon?: string | null; status: string }> }) => {
      setAgents(
        (data.agents ?? [])
          .filter((a) => a.status === "active")
          .map((a) => ({ id: a.id, name: a.name, icon: a.icon ?? null }))
      );
    };
    socket.on("claude:agents", handleAgents);
    socket.emit("claude:list_agents");
    return () => {
      socket.off("claude:agents", handleAgents);
    };
  }, []);

  // Memories state
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Edit/Create modal
  const [editModal, setEditModal] = useState<{ open: boolean; memory: Memory | null }>({ open: false, memory: null });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Import modal
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // File browser state
  const [mainTab, setMainTab] = useState<MainTab>("memories");
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileSaveState, setFileSaveState] = useState<SaveState>("idle");
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);

  // ── Load memories ─────────────────────────────────────────────────────────

  const loadMemories = useCallback(async () => {
    setMemoriesLoading(true);
    setMemoriesError(null);
    try {
      const res = await fetch(apiUrl("/api/claude-code/memories"));
      const data = await res.json() as { memories?: Memory[]; error?: string };
      if (data.error) {
        setMemoriesError(data.error);
      } else {
        setMemories(data.memories ?? []);
      }
    } catch {
      setMemoriesError("Failed to load memories.");
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  // ── Load files ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (mainTab !== "files") return;
    if (files.length > 0) return;
    fetch(apiUrl("/api/claude-code/memory"))
      .then((r) => r.json())
      .then((data: { files?: string[] }) => {
        if (data.files && data.files.length > 0) {
          setFiles(data.files);
          if (!activeFile) setActiveFile(data.files[0]);
        }
      })
      .catch(() => setFileLoadError("Failed to load file list."));
  }, [mainTab, files.length, activeFile]);

  const loadFile = useCallback((file: string) => {
    setLoadingFile(true);
    setFileLoadError(null);
    setFileSaveState("idle");
    fetch(apiUrl(`/api/claude-code/memory?file=${encodeURIComponent(file)}`))
      .then((r) => r.json())
      .then((data: { content?: string; error?: string }) => {
        if (data.error) {
          setFileLoadError(data.error);
          setFileContent("");
        } else {
          setFileContent(data.content ?? "");
        }
      })
      .catch(() => setFileLoadError("Failed to load file."))
      .finally(() => setLoadingFile(false));
  }, []);

  useEffect(() => {
    if (activeFile) loadFile(activeFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile]);

  const handleFileSave = useCallback(() => {
    if (!activeFile) return;
    setFileSaveState("saving");
    fetch(apiUrl("/api/claude-code/memory"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: activeFile, content: fileContent }),
    })
      .then(async (r) => {
        const data = await r.json() as { ok?: boolean; error?: string };
        if (data.ok) {
          setFileSaveState("saved");
          setTimeout(() => setFileSaveState("idle"), 2500);
        } else {
          setFileSaveState("error");
          if (r.status === 403) setFileLoadError("Save requires admin access.");
        }
      })
      .catch(() => setFileSaveState("error"));
  }, [activeFile, fileContent]);

  // ── Memory CRUD ───────────────────────────────────────────────────────────

  const handleSaveMemory = useCallback(async (title: string, content: string, isGlobal: boolean, agentIds: string[], memTags: string[]) => {
    setEditSaving(true);
    setEditError(null);
    try {
      const isEdit = Boolean(editModal.memory);
      const res = await fetch(apiUrl("/api/claude-code/memories"), {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { id: editModal.memory!.id, title, content, is_global: isGlobal, agent_ids: agentIds, tags: memTags }
            : { title, content, is_global: isGlobal, agent_ids: agentIds, tags: memTags }
        ),
      });
      const data = await res.json() as { memory?: Memory; error?: string };
      if (data.error || !res.ok) {
        setEditError(data.error ?? "Save failed");
        return;
      }
      if (data.memory) {
        setMemories((prev) =>
          isEdit
            ? prev.map((m) => (m.id === data.memory!.id ? data.memory! : m))
            : [data.memory!, ...prev]
        );
      }
      setEditModal({ open: false, memory: null });
    } catch {
      setEditError("Network error. Please try again.");
    } finally {
      setEditSaving(false);
    }
  }, [editModal.memory]);

  const handleDeleteMemory = useCallback(async (id: string) => {
    try {
      const res = await fetch(apiUrl(`/api/claude-code/memories?id=${id}`), { method: "DELETE" });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
        setExpandedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      }
    } catch { /* silent */ }
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  // ── Import ────────────────────────────────────────────────────────────────

  const handleImport = useCallback(async (content: string) => {
    if (!content.trim()) return;
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const res = await fetch(apiUrl("/api/claude-code/memories/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json() as { memories?: Memory[]; count?: number; error?: string };
      if (data.error || !res.ok) {
        setImportError(data.error ?? "Import failed");
        return;
      }
      if (data.memories && data.memories.length > 0) {
        setMemories((prev) => [...data.memories!, ...prev]);
        setImportSuccess(`Imported ${data.count} ${data.count === 1 ? "memory" : "memories"}.`);
        setShowImport(false);
        setTimeout(() => setImportSuccess(null), 4000);
      }
    } catch {
      setImportError("Network error. Please try again.");
    } finally {
      setImporting(false);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bot-bg">
      {/* Top navigation */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-bot-border/25 bg-bot-surface/40 shrink-0">
        <button
          onClick={() => setMainTab("memories")}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-all duration-150",
            mainTab === "memories"
              ? "bg-bot-accent/10 text-bot-accent"
              : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30",
          ].join(" ")}
        >
          <Brain className="h-3.5 w-3.5" />
          Memories
          {memories.length > 0 && (
            <span className="ml-0.5 text-[10px] bg-bot-accent/15 text-bot-accent rounded-full px-1.5 py-0.5 font-semibold leading-none">
              {memories.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab("files")}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-all duration-150",
            mainTab === "files"
              ? "bg-bot-accent/10 text-bot-accent"
              : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30",
          ].join(" ")}
        >
          <FileText className="h-3.5 w-3.5" />
          Context Files
        </button>
      </div>

      {/* ── Memories Tab ─────────────────────────────────────────────────────── */}
      {mainTab === "memories" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-bot-border/20 shrink-0">
            <p className="text-[12px] text-bot-muted/60 leading-snug">
              Memories are injected into sessions based on their scope (global or agent-specific).
            </p>
            <div className="flex items-center gap-1.5">
              {/* Search input */}
              <div className="relative flex items-center">
                <Search className="absolute left-2 h-3 w-3 text-bot-muted/50 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-6 pr-3 py-1.5 rounded-lg text-[12px] bg-bot-bg border border-bot-border/25 text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 w-32 transition-all focus:w-48"
                />
              </div>
              {/* Filter dropdown */}
              <div className="relative flex items-center">
                <Filter className="absolute left-2 h-3 w-3 text-bot-muted/50 pointer-events-none" />
                <select
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  className="pl-6 pr-2 py-1.5 rounded-lg text-[12px] bg-bot-bg border border-bot-border/25 text-bot-muted hover:border-bot-border/40 focus:outline-none focus:border-bot-accent/50 transition-all appearance-none cursor-pointer"
                >
                  <option value="all">All memories</option>
                  <option value="global">Global only</option>
                  <option value={MAIN_SESSION_TARGET}>Main Session</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.icon ? `${a.icon} ` : ""}{a.name}
                    </option>
                  ))}
                </select>
              </div>
              {/* Tag filter — only show if any memories have tags */}
              {(() => {
                const allTags = [...new Set(memories.flatMap((m) => m.tags ?? []))];
                return allTags.length > 0 ? (
                  <div className="relative flex items-center">
                    <Tag className="absolute left-2 h-3 w-3 text-bot-muted/50 pointer-events-none" />
                    <select
                      value={tagFilter}
                      onChange={(e) => setTagFilter(e.target.value)}
                      className="pl-6 pr-2 py-1.5 rounded-lg text-[12px] bg-bot-bg border border-bot-border/25 text-bot-muted hover:border-bot-border/40 focus:outline-none focus:border-bot-accent/50 transition-all appearance-none cursor-pointer"
                    >
                      <option value="">All tags</option>
                      {allTags.map((tag) => (
                        <option key={tag} value={tag}>{tag}</option>
                      ))}
                    </select>
                  </div>
                ) : null;
              })()}
              {isAdmin && (
                <>
                  <button
                    onClick={() => { setShowImport(true); setImportError(null); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30 border border-bot-border/25 hover:border-bot-border/40 transition-all duration-150"
                  >
                    <Upload className="h-3 w-3" />
                    Import
                  </button>
                  <button
                    onClick={() => { setEditModal({ open: true, memory: null }); setEditError(null); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold gradient-accent text-white shadow-glow-sm hover:brightness-110 active:scale-[0.98] transition-all duration-150"
                  >
                    <Plus className="h-3 w-3" />
                    New
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Success banner */}
          {importSuccess && (
            <div className="flex items-center gap-2 px-4 py-2 bg-bot-green/8 border-b border-bot-green/15 text-bot-green text-[12px] shrink-0">
              <Check className="h-3.5 w-3.5 shrink-0" />
              {importSuccess}
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {memoriesLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-bot-muted/40" />
              </div>
            ) : memoriesError ? (
              <div className="text-center py-10 text-bot-red text-[12.5px]">{memoriesError}</div>
            ) : memories.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 px-6 text-center">
                <div className="p-3 rounded-xl bg-bot-elevated/20 border border-bot-border/20">
                  <BookOpen className="h-7 w-7 text-bot-muted/30" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-bot-muted/60">No memories yet</p>
                  <p className="text-[11.5px] text-bot-muted/40 mt-0.5">
                    {isAdmin
                      ? "Add memories to give Claude persistent project knowledge."
                      : "No memories have been added yet."}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() => setShowImport(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30 border border-bot-border/25 transition-all"
                    >
                      <Upload className="h-3 w-3" />
                      Import .md
                    </button>
                    <button
                      onClick={() => setEditModal({ open: true, memory: null })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold gradient-accent text-white shadow-glow-sm hover:brightness-110 transition-all"
                    >
                      <Plus className="h-3 w-3" />
                      Add Memory
                    </button>
                  </div>
                )}
              </div>
            ) : (() => {
              const sq = searchQuery.toLowerCase();
              const filteredMemories = memories.filter((m) => {
                // Agent/scope filter
                if (agentFilter !== "all") {
                  if (agentFilter === "global" && !m.is_global) return false;
                  if (agentFilter !== "global" && !m.is_global && !(m.assigned_agent_ids ?? []).includes(agentFilter)) return false;
                }
                // Tag filter
                if (tagFilter && !(m.tags ?? []).includes(tagFilter)) return false;
                // Search
                if (sq && !m.title.toLowerCase().includes(sq) && !m.content.toLowerCase().includes(sq)) return false;
                return true;
              });
              return filteredMemories.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-6">
                  <p className="text-[12.5px] text-bot-muted/50">No memories match the current filter.</p>
                </div>
              ) : (
                <div className="p-3 flex flex-col gap-1.5">
                  {filteredMemories.map((memory) => (
                    <MemoryItem
                      key={memory.id}
                      memory={memory}
                      isAdmin={isAdmin}
                      isExpanded={expandedIds.has(memory.id)}
                      onToggle={() => toggleExpand(memory.id)}
                      onEdit={(m) => { setEditModal({ open: true, memory: m }); setEditError(null); }}
                      onDelete={handleDeleteMemory}
                      agents={agents}
                    />
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Context Files Tab ─────────────────────────────────────────────────── */}
      {mainTab === "files" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-bot-border/20 shrink-0">
            <span className="text-[11px] font-semibold text-bot-amber/70 uppercase tracking-wider">Caution</span>
            <span className="text-[11.5px] text-bot-muted/50">
              These files directly influence Claude&apos;s behavior.
            </span>
          </div>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Sidebar */}
            <aside className="w-52 shrink-0 flex flex-col border-r border-bot-border/20 bg-bot-surface/30 overflow-y-auto">
              <div className="px-3 pt-3 pb-1.5">
                <span className="text-[10.5px] text-bot-muted/50 uppercase tracking-wider font-semibold">Files</span>
              </div>
              <ul className="flex-1 px-1.5 pb-2">
                {files.map((file) => {
                  const isActive = file === activeFile;
                  return (
                    <li key={file}>
                      <button
                        onClick={() => setActiveFile(file)}
                        className={[
                          "w-full text-left px-2.5 py-2 rounded-lg text-[12px] transition-all duration-150 truncate",
                          isActive
                            ? "bg-bot-accent/10 text-bot-accent font-medium"
                            : "text-bot-text/70 hover:text-bot-text hover:bg-bot-elevated/30",
                        ].join(" ")}
                      >
                        {friendlyName(file)}
                      </button>
                    </li>
                  );
                })}
                {files.length === 0 && (
                  <li className="px-3 py-4 text-[12px] text-bot-muted/40 italic text-center">
                    No files found.
                  </li>
                )}
              </ul>
            </aside>

            {/* Editor area */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-bot-border/20 bg-bot-surface/20 shrink-0">
                <span className="text-[13px] font-medium text-bot-text truncate">
                  {activeFile ? friendlyName(activeFile) : "No file selected"}
                </span>
                {isAdmin ? (
                  <button
                    onClick={handleFileSave}
                    disabled={!activeFile || fileSaveState === "saving" || loadingFile}
                    className={[
                      "px-3 py-1 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-40",
                      fileSaveState === "error"
                        ? "bg-bot-red text-white"
                        : fileSaveState === "saved"
                          ? "bg-bot-green text-white"
                          : "gradient-accent text-white shadow-glow-sm hover:brightness-110 active:scale-[0.98]",
                    ].join(" ")}
                  >
                    {{ idle: "Save", saving: "Saving…", saved: "Saved ✓", error: "Error" }[fileSaveState]}
                  </button>
                ) : (
                  <span className="text-[11px] text-bot-muted/40 italic">Read-only</span>
                )}
              </div>

              {fileLoadError && (
                <div className="px-4 py-2 bg-bot-red/5 border-b border-bot-border/20 text-bot-red text-[12px] shrink-0">
                  {fileLoadError}
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-hidden relative" style={{ background: "#0a0a10" }}>
                {loadingFile && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a10]/90 backdrop-blur-sm z-10">
                    <Loader2 className="h-5 w-5 animate-spin text-bot-muted/40" />
                  </div>
                )}
                {!activeFile ? (
                  <div className="flex items-center justify-center h-full text-[12.5px] text-bot-muted/30 italic">
                    Select a file from the sidebar.
                  </div>
                ) : (
                  <MonacoEditor
                    value={fileContent}
                    onChange={(v) => {
                      if (!isAdmin) return;
                      setFileContent(v);
                      if (fileSaveState === "saved" || fileSaveState === "error") setFileSaveState("idle");
                    }}
                    filePath={activeFile}
                    readOnly={!isAdmin}
                    onSave={isAdmin ? handleFileSave : undefined}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      {editModal.open && (
        <MemoryEditModal
          memory={editModal.memory}
          onSave={handleSaveMemory}
          onClose={() => setEditModal({ open: false, memory: null })}
          saving={editSaving}
          error={editError}
          agents={agents}
        />
      )}

      {showImport && (
        <ImportModal
          onImport={handleImport}
          onClose={() => { setShowImport(false); setImportError(null); }}
          importing={importing}
          importError={importError}
        />
      )}
    </div>
  );
}

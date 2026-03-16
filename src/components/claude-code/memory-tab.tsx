"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { apiUrl } from "@/lib/utils";
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
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Memory {
  id: string;
  title: string;
  content: string;
  created_by: string;
  created_at: string;
  updated_at: string;
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

// ── Memory Item Card ──────────────────────────────────────────────────────────

interface MemoryItemProps {
  memory: Memory;
  isAdmin: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: (memory: Memory) => void;
  onDelete: (id: string) => void;
}

function MemoryItemCard({ memory, isAdmin, isExpanded, onToggle, onEdit, onDelete }: MemoryItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="border border-bot-border/30 rounded-xl bg-bot-surface/40 hover:bg-bot-surface/60 transition-all duration-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" onClick={onToggle}>
        <button
          className="text-bot-muted hover:text-bot-text transition-colors shrink-0"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <Brain className="h-3.5 w-3.5 text-bot-accent/70 shrink-0" />
        <span className="flex-1 text-caption font-medium text-bot-text truncate">{memory.title}</span>
        <span className="text-[11px] text-bot-muted/60 shrink-0 hidden sm:block">{formatDate(memory.updated_at)}</span>
        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onEdit(memory)}
              className="p-1 rounded text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-all"
              title="Edit memory"
            >
              <Pencil className="h-3 w-3" />
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onDelete(memory.id)}
                  className="p-1 rounded text-bot-red hover:bg-bot-red/10 transition-all"
                  title="Confirm delete"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="p-1 rounded text-bot-muted hover:bg-bot-elevated/40 transition-all"
                  title="Cancel"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1 rounded text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-all"
                title="Delete memory"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
      {isExpanded && (
        <div className="px-4 pb-3 border-t border-bot-border/20 mt-0.5 pt-2.5">
          <pre className="text-caption text-bot-text/80 whitespace-pre-wrap font-sans leading-relaxed">
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
  onSave: (title: string, content: string) => void;
  onClose: () => void;
  saving: boolean;
}

function MemoryEditModal({ memory, onSave, onClose, saving }: MemoryEditModalProps) {
  const [title, setTitle] = useState(memory?.title ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave(title.trim(), content);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-bot-surface border border-bot-border/40 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bot-border/30">
          <h2 className="text-body font-semibold text-bot-text">
            {memory ? "Edit Memory" : "New Memory"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-bot-border/20">
            <label className="block text-[11px] uppercase tracking-wider text-bot-muted font-semibold mb-1.5">
              Title
            </label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short descriptive title…"
              className="w-full px-3 py-2 rounded-lg bg-bot-bg border border-bot-border/30 text-body text-bot-text placeholder:text-bot-muted/50 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all"
            />
          </div>
          <div className="flex flex-col flex-1 min-h-0 px-5 py-3">
            <label className="block text-[11px] uppercase tracking-wider text-bot-muted font-semibold mb-1.5">
              Content
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter the memory content…"
              className="flex-1 min-h-[200px] w-full px-3 py-2 rounded-lg bg-bot-bg border border-bot-border/30 text-caption text-bot-text placeholder:text-bot-muted/50 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all resize-none font-mono leading-relaxed"
            />
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-bot-border/30">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="px-4 py-2 rounded-lg text-caption font-semibold gradient-accent text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200 flex items-center gap-2"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {memory ? "Save Changes" : "Create Memory"}
            </button>
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
    if (!file.name.endsWith(".md") && !file.type.includes("text")) {
      return;
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-bot-surface border border-bot-border/40 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bot-border/30">
          <div>
            <h2 className="text-body font-semibold text-bot-text">Import from Markdown</h2>
            <p className="text-[11px] text-bot-muted mt-0.5">
              AI will analyze your .md file and extract individual memories automatically.
            </p>
          </div>
          <button onClick={onClose} disabled={importing} className="p-1.5 rounded-lg text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col flex-1 min-h-0 p-5 gap-4 overflow-y-auto">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={[
              "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200",
              dragOver
                ? "border-bot-accent bg-bot-accent/5"
                : "border-bot-border/40 hover:border-bot-accent/40 hover:bg-bot-elevated/20",
            ].join(" ")}
          >
            <Upload className="h-6 w-6 mx-auto mb-2 text-bot-muted" />
            <p className="text-caption text-bot-muted">
              Drop a <span className="text-bot-accent">.md file</span> here, or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>

          {/* Manual text area */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-bot-muted font-semibold mb-1.5">
              Or paste markdown content
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="# My Notes&#10;&#10;## Section 1&#10;Some important context…"
              className="w-full h-48 px-3 py-2 rounded-lg bg-bot-bg border border-bot-border/30 text-caption text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all resize-none font-mono"
            />
          </div>

          {importError && (
            <div className="px-3 py-2 rounded-lg bg-bot-red/10 border border-bot-red/20 text-bot-red text-caption">
              {importError}
            </div>
          )}

          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-bot-accent/5 border border-bot-accent/10">
            <Brain className="h-4 w-4 text-bot-accent shrink-0 mt-0.5" />
            <p className="text-[11px] text-bot-muted/80 leading-relaxed">
              Claude will read your document and intelligently extract individual memory items, giving each one a descriptive title. It handles any format: headers, lists, paragraphs, or mixed content.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-bot-border/30">
          <button
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 rounded-lg text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onImport(text)}
            disabled={!text.trim() || importing}
            className="px-4 py-2 rounded-lg text-caption font-semibold gradient-accent text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200 flex items-center gap-2"
          >
            {importing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing with AI…
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

  // File browser state (secondary tab)
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

  // ── Load files (for the Files tab) ───────────────────────────────────────

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
          if (r.status === 403) {
            setFileLoadError("Save requires admin access.");
          }
        }
      })
      .catch(() => setFileSaveState("error"));
  }, [activeFile, fileContent]);

  // ── Memory CRUD ──────────────────────────────────────────────────────────

  const handleSaveMemory = useCallback(async (title: string, content: string) => {
    setEditSaving(true);
    setEditError(null);
    try {
      const isEdit = Boolean(editModal.memory);
      const res = await fetch(apiUrl("/api/claude-code/memories"), {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { id: editModal.memory!.id, title, content }
            : { title, content }
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
    } catch {
      // silent
    }
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }, []);

  // ── Import ───────────────────────────────────────────────────────────────

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
        setImportSuccess(`Imported ${data.count} ${data.count === 1 ? "memory" : "memories"} successfully.`);
        setShowImport(false);
        setTimeout(() => setImportSuccess(null), 4000);
      }
    } catch {
      setImportError("Network error. Please try again.");
    } finally {
      setImporting(false);
    }
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  const fileSaveBtnClass =
    fileSaveState === "error"
      ? "px-4 py-1.5 rounded-lg text-caption font-semibold bg-bot-red text-white"
      : fileSaveState === "saved"
        ? "px-4 py-1.5 rounded-lg text-caption font-semibold bg-bot-green text-white shadow-[0_0_12px_2px_rgb(var(--bot-green)/0.2)]"
        : "px-4 py-1.5 rounded-lg text-caption font-semibold gradient-accent text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab selector */}
      <div className="flex items-center gap-1 px-4 py-2.5 border-b border-bot-border/30 bg-bot-surface/50 shrink-0">
        <button
          onClick={() => setMainTab("memories")}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption font-medium transition-all duration-200",
            mainTab === "memories"
              ? "bg-bot-accent/10 text-bot-accent shadow-glow-sm"
              : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30",
          ].join(" ")}
        >
          <Brain className="h-3.5 w-3.5" />
          Memories
          {memories.length > 0 && (
            <span className="text-[10px] bg-bot-accent/20 text-bot-accent rounded-full px-1.5 py-0.5 font-semibold">
              {memories.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab("files")}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption font-medium transition-all duration-200",
            mainTab === "files"
              ? "bg-bot-accent/10 text-bot-accent shadow-glow-sm"
              : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30",
          ].join(" ")}
        >
          <FileText className="h-3.5 w-3.5" />
          Context Files
        </button>
      </div>

      {/* ── Memories Tab ─────────────────────────────────────────────────── */}
      {mainTab === "memories" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-bot-border/30 bg-bot-surface/30 shrink-0">
            <div>
              <span className="text-caption text-bot-muted/80">
                Individual memory items used as project context for Claude.
              </span>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowImport(true); setImportError(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 border border-bot-border/30 hover:border-bot-accent/30 transition-all duration-200"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import .md
                </button>
                <button
                  onClick={() => { setEditModal({ open: true, memory: null }); setEditError(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption font-semibold gradient-accent text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Memory
                </button>
              </div>
            )}
          </div>

          {/* Import success banner */}
          {importSuccess && (
            <div className="flex items-center gap-2 px-4 py-2 bg-bot-green/10 border-b border-bot-green/20 text-bot-green text-caption shrink-0">
              <Check className="h-3.5 w-3.5" />
              {importSuccess}
            </div>
          )}

          {/* Memories list */}
          <div className="flex-1 overflow-y-auto p-4">
            {memoriesLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-bot-muted" />
              </div>
            ) : memoriesError ? (
              <div className="text-center py-8 text-bot-red text-caption">{memoriesError}</div>
            ) : memories.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                <Brain className="h-10 w-10 text-bot-muted/30" />
                <div>
                  <p className="text-body text-bot-muted font-medium">No memories yet</p>
                  <p className="text-caption text-bot-muted/60 mt-1">
                    {isAdmin
                      ? "Add individual memories or import from a .md file."
                      : "No memories have been added yet."}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setShowImport(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 border border-bot-border/30 hover:border-bot-accent/30 transition-all"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Import .md
                    </button>
                    <button
                      onClick={() => setEditModal({ open: true, memory: null })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption font-semibold gradient-accent text-white shadow-glow-sm hover:brightness-110 transition-all"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Memory
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {memories.map((memory) => (
                  <MemoryItemCard
                    key={memory.id}
                    memory={memory}
                    isAdmin={isAdmin}
                    isExpanded={expandedIds.has(memory.id)}
                    onToggle={() => toggleExpand(memory.id)}
                    onEdit={(m) => { setEditModal({ open: true, memory: m }); setEditError(null); }}
                    onDelete={handleDeleteMemory}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Context Files Tab ─────────────────────────────────────────────── */}
      {mainTab === "files" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-bot-amber/5 border-b border-bot-border/30 shrink-0">
            <span className="text-bot-amber font-bold text-body">⚠</span>
            <span className="text-caption text-bot-amber/80">
              These files guide Claude&apos;s behavior. Edit carefully.
            </span>
          </div>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <aside className="w-60 shrink-0 flex flex-col border-r border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm overflow-y-auto">
              <div className="px-3 py-2.5 border-b border-bot-border/30">
                <span className="text-caption text-bot-muted uppercase tracking-wider font-semibold">Files</span>
              </div>
              <ul className="flex-1 py-1">
                {files.map((file) => {
                  const isActive = file === activeFile;
                  return (
                    <li key={file}>
                      <button
                        onClick={() => setActiveFile(file)}
                        className={[
                          "w-full text-left px-3 py-2.5 mx-1 rounded-lg text-caption transition-all duration-200",
                          isActive
                            ? "bg-bot-accent/10 text-bot-accent font-medium shadow-glow-sm"
                            : "text-bot-text hover:bg-bot-elevated/40",
                        ].join(" ")}
                      >
                        {friendlyName(file)}
                      </button>
                    </li>
                  );
                })}
                {files.length === 0 && (
                  <li className="px-3 py-4 text-caption text-bot-muted italic text-center">
                    No files found.
                  </li>
                )}
              </ul>
            </aside>
            <div className="flex flex-col flex-1 min-w-0 bg-bot-bg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm shrink-0">
                <span className="text-body text-bot-text font-semibold truncate">
                  {activeFile ? friendlyName(activeFile) : "No file selected"}
                </span>
                {isAdmin ? (
                  <button
                    onClick={handleFileSave}
                    disabled={!activeFile || fileSaveState === "saving" || loadingFile}
                    className={fileSaveBtnClass}
                  >
                    {{ idle: "Save", saving: "Saving…", saved: "Saved ✓", error: "Error" }[fileSaveState]}
                  </button>
                ) : (
                  <span className="text-caption text-bot-muted/60 italic">Read-only</span>
                )}
              </div>
              {fileLoadError && (
                <div className="px-4 py-2 bg-bot-red/5 border-b border-bot-border/30 text-bot-red text-caption shrink-0">
                  {fileLoadError}
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-hidden relative" style={{ background: "#0a0a10" }}>
                {loadingFile && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a10]/90 backdrop-blur-sm z-10">
                    <Loader2 className="h-5 w-5 animate-spin text-bot-muted" />
                  </div>
                )}
                {!activeFile ? (
                  <div className="flex items-center justify-center h-full text-caption text-bot-muted italic">
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

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {editModal.open && (
        <MemoryEditModal
          memory={editModal.memory}
          onSave={handleSaveMemory}
          onClose={() => setEditModal({ open: false, memory: null })}
          saving={editSaving}
        />
      )}
      {editError && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl bg-bot-red/10 border border-bot-red/20 text-bot-red text-caption shadow-lg">
          {editError}
        </div>
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

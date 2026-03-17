"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Save, Eye, Code2, Loader2, AlertCircle,
  CheckCircle2, Clock, FileText, X, Trash2,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import { MonacoEditor, getMonacoLanguage } from "./monaco-editor";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ViewMode = "editor" | "preview";
type SaveState = "idle" | "saving" | "saved" | "error";

interface FileViewerProps {
  filePath: string | null;
  onClose?: () => void;
  onFileDeleted?: (path: string) => void;
}

export function FileViewer({ filePath, onClose, onFileDeleted }: FileViewerProps) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [mimeType, setMimeType] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [modified, setModified] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isDirty = content !== originalContent;
  const isMarkdown = mimeType.includes("markdown") ||
    (filePath?.endsWith(".md") ?? false) ||
    (filePath?.endsWith(".markdown") ?? false);

  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    setConfirmDelete(false);
    setDeleteError(null);
  }, [filePath]);

  useEffect(() => {
    if (!filePath) {
      setContent("");
      setOriginalContent("");
      setMimeType("");
      setLoadError(null);
      return;
    }
    if (filePath === prevPath.current) return;
    prevPath.current = filePath;

    setLoading(true);
    setLoadError(null);
    setSaveState("idle");
    setSaveError(null);
    setViewMode("editor");

    fetch(apiUrl(`/api/claude-code/files/content?path=${encodeURIComponent(filePath)}`))
      .then((r) => r.json())
      .then((data: { content?: string; mimeType?: string; size?: number; modified?: number; error?: string }) => {
        if (data.error) {
          setLoadError(data.error);
          setContent("");
          setOriginalContent("");
        } else {
          const c = data.content ?? "";
          setContent(c);
          setOriginalContent(c);
          setMimeType(data.mimeType ?? "text/plain");
          setFileSize(data.size ?? null);
          setModified(data.modified ?? null);
          // Auto-switch to preview for markdown
          if (data.mimeType?.includes("markdown") || filePath.endsWith(".md")) {
            setViewMode("preview");
          }
        }
      })
      .catch((err) => setLoadError(String(err)))
      .finally(() => setLoading(false));
  }, [filePath]);

  const handleSave = useCallback(async () => {
    if (!filePath || !isDirty || saveState === "saving") return;
    setSaveState("saving");
    setSaveError(null);

    try {
      const res = await fetch(apiUrl("/api/claude-code/files/content"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; size?: number; modified?: number };
      if (data.ok) {
        setOriginalContent(content);
        setFileSize(data.size ?? null);
        setModified(data.modified ?? null);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2500);
      } else {
        setSaveError(data.error ?? "Save failed");
        setSaveState("error");
      }
    } catch (err) {
      setSaveError(String(err));
      setSaveState("error");
    }
  }, [filePath, content, isDirty, saveState]);

  const handleDiscard = useCallback(() => {
    setContent(originalContent);
    setSaveState("idle");
    setSaveError(null);
  }, [originalContent]);

  const handleDelete = useCallback(async () => {
    if (!filePath) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(apiUrl("/api/claude-code/files/manage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", path: filePath }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        onFileDeleted?.(filePath);
        onClose?.();
      } else {
        setDeleteError(data.error ?? "Delete failed");
        setDeleting(false);
      }
    } catch (err) {
      setDeleteError(String(err));
      setDeleting(false);
    }
  }, [filePath, onFileDeleted, onClose]);

  if (!filePath) {
    return (
      <div className="flex flex-col flex-1 h-full items-center justify-center gap-4 text-bot-muted">
        <FileText className="h-16 w-16 text-bot-muted/20" />
        <div className="text-center">
          <p className="text-body font-medium text-bot-text">No file selected</p>
          <p className="text-caption text-bot-muted mt-1">Select a file from the tree to view or edit it</p>
        </div>
      </div>
    );
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  const lang = mimeType ? getMonacoLanguage(mimeType) : getMonacoLanguage(filePath);

  return (
    <div className="flex flex-col flex-1 h-full min-w-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm shrink-0 gap-3">
        {/* File path breadcrumb */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <FileText className="h-3.5 w-3.5 shrink-0 text-bot-muted/60" />
          <span className="text-caption text-bot-muted/60 truncate font-mono">
            {filePath.split("/").slice(0, -1).join("/")}
            {filePath.includes("/") && "/"}
          </span>
          <span className="text-caption text-bot-text font-semibold font-mono truncate">{fileName}</span>
          {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-bot-amber shrink-0" title="Unsaved changes" />}
        </div>

        {/* File metadata */}
        <div className="hidden sm:flex items-center gap-3 text-[10px] text-bot-muted/50 shrink-0">
          {fileSize !== null && (
            <span>{fileSize < 1024 ? `${fileSize}B` : fileSize < 1024 * 1024 ? `${(fileSize / 1024).toFixed(1)}KB` : `${(fileSize / 1024 / 1024).toFixed(1)}MB`}</span>
          )}
          {modified !== null && (
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {new Date(modified).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span className="font-mono uppercase">{lang}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* View mode toggle (markdown only) */}
          {isMarkdown && (
            <div className="flex items-center rounded-lg border border-bot-border/30 overflow-hidden">
              <button
                onClick={() => setViewMode("editor")}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1.5 text-caption transition-colors",
                  viewMode === "editor"
                    ? "bg-bot-accent/15 text-bot-accent"
                    : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40",
                )}
              >
                <Code2 className="h-3 w-3" />
                Edit
              </button>
              <button
                onClick={() => setViewMode("preview")}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1.5 text-caption transition-colors",
                  viewMode === "preview"
                    ? "bg-bot-accent/15 text-bot-accent"
                    : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40",
                )}
              >
                <Eye className="h-3 w-3" />
                Preview
              </button>
            </div>
          )}

          {/* Discard */}
          {isDirty && (
            <button
              onClick={handleDiscard}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-bot-border/30 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all duration-200"
            >
              Discard
            </button>
          )}

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={!isDirty || saveState === "saving" || loading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption font-medium transition-all duration-200",
              saveState === "saved"
                ? "bg-bot-green/15 text-bot-green border border-bot-green/30"
                : saveState === "error"
                  ? "bg-bot-red/15 text-bot-red border border-bot-red/30"
                  : isDirty
                    ? "gradient-accent text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98]"
                    : "bg-bot-elevated/40 text-bot-muted/50 border border-bot-border/20 cursor-not-allowed",
            )}
          >
            {saveState === "saving" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saveState === "saved" ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}
          </button>

          {/* Delete */}
          <button
            onClick={() => { setConfirmDelete((v) => !v); setDeleteError(null); }}
            className={cn(
              "rounded-md p-1.5 transition-all duration-200",
              confirmDelete
                ? "text-bot-red bg-bot-red/15 hover:bg-bot-red/25"
                : "text-bot-muted hover:text-bot-red hover:bg-bot-red/10",
            )}
            title="Delete file"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          {/* Close */}
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-all duration-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Delete error */}
      {deleteError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bot-red/10 border-b border-bot-red/20 text-bot-red text-caption shrink-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {deleteError}
          <button onClick={() => setDeleteError(null)} className="ml-auto text-bot-red/70 hover:text-bot-red">✕</button>
        </div>
      )}

      {/* Delete confirmation bar */}
      {confirmDelete && !deleteError && (
        <div className="flex items-center gap-3 px-4 py-2 bg-bot-red/10 border-b border-bot-red/20 shrink-0">
          <AlertCircle className="h-3.5 w-3.5 text-bot-red shrink-0" />
          <span className="text-caption text-bot-text flex-1 min-w-0 truncate">
            Delete <span className="font-semibold">{filePath?.split("/").pop()}</span>? This cannot be undone.
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
              disabled={deleting}
              className="px-3 py-1 rounded-lg border border-bot-border/30 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1 rounded-lg bg-bot-red/15 border border-bot-red/30 text-caption text-bot-red hover:bg-bot-red/25 transition-colors font-medium disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bot-red/10 border-b border-bot-red/20 text-bot-red text-caption shrink-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {saveError}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a10]/90 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-bot-muted" />
          </div>
        )}

        {loadError ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-bot-muted">
            <AlertCircle className="h-10 w-10 text-bot-red/50" />
            <p className="text-body text-bot-red">{loadError}</p>
          </div>
        ) : viewMode === "preview" && isMarkdown ? (
          // Markdown preview
          <div className="h-full overflow-y-auto px-8 py-6 bg-bot-bg">
            <div className="max-w-3xl mx-auto prose prose-invert prose-sm
              [&_h1]:text-subtitle [&_h1]:font-bold [&_h1]:text-bot-text [&_h1]:mb-4 [&_h1]:mt-0
              [&_h2]:text-body [&_h2]:font-semibold [&_h2]:text-bot-text [&_h2]:mb-3 [&_h2]:mt-6
              [&_h3]:text-body [&_h3]:font-medium [&_h3]:text-bot-text [&_h3]:mb-2 [&_h3]:mt-4
              [&_p]:text-body [&_p]:text-bot-text/90 [&_p]:mb-3 [&_p]:leading-relaxed
              [&_a]:text-bot-accent [&_a]:no-underline [&_a:hover]:underline
              [&_code]:text-bot-amber [&_code]:bg-bot-elevated [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-caption [&_code]:font-mono
              [&_pre]:bg-bot-elevated [&_pre]:rounded-xl [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-bot-border/20
              [&_blockquote]:border-l-2 [&_blockquote]:border-bot-accent/40 [&_blockquote]:pl-4 [&_blockquote]:text-bot-muted [&_blockquote]:italic
              [&_ul]:mb-3 [&_ol]:mb-3 [&_li]:text-bot-text/90 [&_li]:mb-1
              [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-bot-border/30 [&_th]:bg-bot-elevated [&_th]:px-3 [&_th]:py-2 [&_th]:text-caption [&_th]:font-medium
              [&_td]:border [&_td]:border-bot-border/30 [&_td]:px-3 [&_td]:py-2 [&_td]:text-caption
              [&_hr]:border-bot-border/30
              [&_img]:rounded-xl [&_img]:max-w-full
            ">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          // Monaco editor
          <div className="h-full" style={{ background: "#0a0a10" }}>
            <MonacoEditor
              value={content}
              onChange={setContent}
              filePath={filePath}
              onSave={handleSave}
            />
          </div>
        )}
      </div>
    </div>
  );
}

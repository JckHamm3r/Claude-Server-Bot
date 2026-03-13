"use client";

import { useState, useEffect, useCallback } from "react";

const FRIENDLY_NAMES: Record<string, string> = {
  "CLAUDE.md": "Project Instructions (CLAUDE.md)",
  "memory/MEMORY.md": "Memory Index",
  "memory/claude_code_interface.md": "Claude Code Interface Notes",
  "memory/feedback_nginx_rules.md": "Feedback Nginx Rules",
  "memory/reference_api_docs.md": "API Reference",
};

function friendlyName(file: string): string {
  if (FRIENDLY_NAMES[file]) return FRIENDLY_NAMES[file];
  // Fallback: basename without extension, title-cased
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.md$/, "").replace(/_/g, " ");
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function MemoryTab() {
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load file list on mount
  useEffect(() => {
    fetch("/api/claude-code/memory")
      .then((r) => r.json())
      .then((data: { files?: string[]; error?: string }) => {
        if (data.files && data.files.length > 0) {
          setFiles(data.files);
          setActiveFile(data.files[0]);
        }
      })
      .catch(() => setLoadError("Failed to load file list."));
  }, []);

  // Load file content when active file changes
  const loadFile = useCallback((file: string) => {
    setLoadingFile(true);
    setLoadError(null);
    setSaveState("idle");

    fetch(`/api/claude-code/memory?file=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then((data: { content?: string; error?: string }) => {
        if (data.error) {
          setLoadError(data.error);
          setContent("");
        } else {
          setContent(data.content ?? "");
        }
      })
      .catch(() => setLoadError("Failed to load file."))
      .finally(() => setLoadingFile(false));
  }, []);

  useEffect(() => {
    if (activeFile) {
      loadFile(activeFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile]);

  const handleSave = useCallback(() => {
    if (!activeFile) return;
    setSaveState("saving");

    fetch("/api/claude-code/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: activeFile, content }),
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; error?: string }) => {
        if (data.ok) {
          setSaveState("saved");
          setTimeout(() => setSaveState("idle"), 2500);
        } else {
          setSaveState("error");
        }
      })
      .catch(() => setSaveState("error"));
  }, [activeFile, content]);

  const saveLabelMap: Record<SaveState, string> = {
    idle: "Save",
    saving: "Saving…",
    saved: "Saved ✓",
    error: "Error",
  };

  const saveBtnClass =
    saveState === "error"
      ? "px-3 py-1 rounded text-caption font-medium bg-bot-red text-white"
      : saveState === "saved"
        ? "px-3 py-1 rounded text-caption font-medium bg-bot-green text-white"
        : "px-3 py-1 rounded text-caption font-medium bg-bot-accent text-white hover:opacity-90 disabled:opacity-50";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Warning banner */}
      <div className="flex items-center gap-2 px-4 py-2 bg-bot-amber/10 border-b border-bot-border shrink-0">
        <span className="text-bot-amber font-bold text-body">⚠</span>
        <span className="text-caption text-bot-amber">
          These files guide Claude&apos;s behavior. Edit carefully.
        </span>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-60 shrink-0 flex flex-col border-r border-bot-border bg-bot-surface overflow-y-auto">
          <div className="px-3 py-2 border-b border-bot-border">
            <span className="text-caption text-bot-muted uppercase tracking-wide font-medium">
              Files
            </span>
          </div>
          <ul className="flex-1 py-1">
            {files.map((file) => {
              const isActive = file === activeFile;
              return (
                <li key={file}>
                  <button
                    onClick={() => setActiveFile(file)}
                    className={[
                      "w-full text-left px-3 py-2 text-caption transition-colors",
                      isActive
                        ? "bg-bot-accent/10 text-bot-accent font-medium"
                        : "text-bot-text hover:bg-bot-elevated",
                    ].join(" ")}
                  >
                    {friendlyName(file)}
                  </button>
                </li>
              );
            })}
            {files.length === 0 && (
              <li className="px-3 py-2 text-caption text-bot-muted italic">
                No files found.
              </li>
            )}
          </ul>
        </aside>

        {/* Editor area */}
        <div className="flex flex-col flex-1 min-w-0 bg-bot-bg overflow-hidden">
          {/* Editor header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-bot-border bg-bot-surface shrink-0">
            <span className="text-body text-bot-text font-medium truncate">
              {activeFile ? friendlyName(activeFile) : "No file selected"}
            </span>
            <button
              onClick={handleSave}
              disabled={!activeFile || saveState === "saving" || loadingFile}
              className={saveBtnClass}
            >
              {saveLabelMap[saveState]}
            </button>
          </div>

          {/* Error banner */}
          {loadError && (
            <div className="px-4 py-2 bg-bot-red/10 border-b border-bot-border text-bot-red text-caption shrink-0">
              {loadError}
            </div>
          )}

          {/* Textarea */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {loadingFile && (
              <div className="absolute inset-0 flex items-center justify-center bg-bot-bg/60 z-10">
                <span className="text-caption text-bot-muted">Loading…</span>
              </div>
            )}
            <textarea
              className="w-full h-full resize-none bg-bot-bg text-bot-text font-mono text-caption p-4 outline-none border-none leading-relaxed"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (saveState === "saved" || saveState === "error") setSaveState("idle");
              }}
              spellCheck={false}
              disabled={loadingFile || !activeFile}
              placeholder={activeFile ? "File is empty." : "Select a file from the sidebar."}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

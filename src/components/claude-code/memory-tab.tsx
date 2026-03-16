"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { apiUrl } from "@/lib/utils";
import { MonacoEditor } from "./monaco-editor";
import { Loader2 } from "lucide-react";

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
  const { data: session } = useSession();
  const isAdmin = Boolean((session?.user as { isAdmin?: boolean })?.isAdmin);

  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load file list on mount
  useEffect(() => {
    fetch(apiUrl("/api/claude-code/memory"))
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

    fetch(apiUrl(`/api/claude-code/memory?file=${encodeURIComponent(file)}`))
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

    fetch(apiUrl("/api/claude-code/memory"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: activeFile, content }),
    })
      .then(async (r) => {
        const data = await r.json() as { ok?: boolean; error?: string };
        if (data.ok) {
          setSaveState("saved");
          setTimeout(() => setSaveState("idle"), 2500);
        } else {
          setSaveState("error");
          if (r.status === 403) {
            setLoadError("Save requires admin access. You can view but not edit memory files.");
          }
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
      ? "px-4 py-1.5 rounded-lg text-caption font-semibold bg-bot-red text-white"
      : saveState === "saved"
        ? "px-4 py-1.5 rounded-lg text-caption font-semibold bg-bot-green text-white shadow-[0_0_12px_2px_rgb(var(--bot-green)/0.2)]"
        : "px-4 py-1.5 rounded-lg text-caption font-semibold gradient-accent text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-bot-amber/5 border-b border-bot-border/30 shrink-0">
        <span className="text-bot-amber font-bold text-body">⚠</span>
        <span className="text-caption text-bot-amber/80">
          These files guide Claude&apos;s behavior. Edit carefully.
        </span>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-60 shrink-0 flex flex-col border-r border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm overflow-y-auto">
          <div className="px-3 py-2.5 border-b border-bot-border/30">
            <span className="text-caption text-bot-muted uppercase tracking-wider font-semibold">
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
                onClick={handleSave}
                disabled={!activeFile || saveState === "saving" || loadingFile}
                className={saveBtnClass}
              >
                {saveLabelMap[saveState]}
              </button>
            ) : (
              <span className="text-caption text-bot-muted/60 italic">Read-only (admin required to save)</span>
            )}
          </div>

          {loadError && (
            <div className="px-4 py-2 bg-bot-red/5 border-b border-bot-border/30 text-bot-red text-caption shrink-0">
              {loadError}
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
                value={content}
                onChange={(v) => {
                  if (!isAdmin) return;
                  setContent(v);
                  if (saveState === "saved" || saveState === "error") setSaveState("idle");
                }}
                filePath={activeFile}
                readOnly={!isAdmin}
                onSave={isAdmin ? handleSave : undefined}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

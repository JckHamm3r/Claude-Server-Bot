"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Folder, FolderOpen, FileText, FileCode, File,
  ChevronRight, ChevronDown, RefreshCw, Loader2,
  FileJson, FileSearch, Plus, FilePlus, FolderPlus,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import type { TreeEntry } from "@/app/api/claude-code/files/tree/route";
import { FileContextMenu, type FileAction } from "./file-context-menu";

// ── File icon ─────────────────────────────────────────────────────────────────
function FileIcon({ ext, className }: { ext?: string; className?: string }) {
  const cls = cn("h-3.5 w-3.5 shrink-0", className);
  switch (ext) {
    case "ts": case "tsx": case "js": case "jsx":
      return <FileCode className={cn(cls, "text-bot-amber/80")} />;
    case "json": case "jsonc":
      return <FileJson className={cn(cls, "text-bot-green/80")} />;
    case "md": case "markdown":
      return <FileText className={cn(cls, "text-bot-blue/80")} />;
    case "py": return <FileCode className={cn(cls, "text-bot-green/80")} />;
    case "css": case "scss": case "sass":
      return <FileCode className={cn(cls, "text-blue-400/80")} />;
    case "html": case "htm":
      return <FileCode className={cn(cls, "text-orange-400/80")} />;
    case "sh": case "bash": case "zsh":
      return <FileCode className={cn(cls, "text-bot-green/80")} />;
    case "yaml": case "yml": case "toml":
      return <FileSearch className={cn(cls, "text-bot-muted/70")} />;
    default:
      return <File className={cn(cls, "text-bot-muted/70")} />;
  }
}

// ── Tree state ─────────────────────────────────────────────────────────────────
interface TreeNodeState {
  entry: TreeEntry;
  children: TreeNodeState[] | null;
  expanded: boolean;
  loading: boolean;
  error?: string;
}

function buildInitialNodes(entries: TreeEntry[]): TreeNodeState[] {
  return entries.map((e) => ({
    entry: e,
    children: null,
    expanded: false,
    loading: false,
  }));
}

// ── Pending operation (inline input) ──────────────────────────────────────────
type PendingOp =
  | { type: "new-file" | "new-folder"; parentPath: string }
  | { type: "rename"; entry: TreeEntry };

// ── Context menu state ────────────────────────────────────────────────────────
interface ContextMenuState {
  x: number;
  y: number;
  target: TreeEntry | null;
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface FileBrowserSidebarProps {
  activeFile: string | null;
  onOpenFile: (path: string) => void;
  onFileDeleted?: (path: string) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
}

// ── Manage API helper ─────────────────────────────────────────────────────────
async function manageFile(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(apiUrl("/api/claude-code/files/manage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok?: boolean; error?: string }>;
}

// ── Inline input component ─────────────────────────────────────────────────────
function InlineInput({
  depth,
  placeholder,
  initialValue,
  icon: Icon,
  onSubmit,
  onCancel,
}: {
  depth: number;
  placeholder: string;
  initialValue?: string;
  icon: React.ElementType;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (initialValue) {
      // Select without extension for easier rename
      const dotIdx = initialValue.lastIndexOf(".");
      inputRef.current?.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialValue.length);
    }
  }, [initialValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim()) onSubmit(value.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    if (value.trim()) onSubmit(value.trim());
    else onCancel();
  };

  return (
    <div
      className="flex items-center gap-1.5 rounded-md px-2 py-1"
      style={{ paddingLeft: `${8 + depth * 14}px` }}
    >
      <span className="h-3 w-3 shrink-0" />
      <Icon className="h-3.5 w-3.5 shrink-0 text-bot-accent/70" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-bot-elevated/60 border border-bot-accent/40 rounded px-2 py-0.5 text-caption text-bot-text outline-none focus:border-bot-accent transition-colors"
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function FileBrowserSidebar({
  activeFile,
  onOpenFile,
  onFileDeleted,
  onFileRenamed,
}: FileBrowserSidebarProps) {
  const [roots, setRoots] = useState<TreeNodeState[]>([]);
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [rootError, setRootError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingOp, setPendingOp] = useState<PendingOp | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  // Close "+" dropdown on outside click
  useEffect(() => {
    if (!showNewMenu) return;
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNewMenu]);

  const fetchDir = useCallback(async (dir: string): Promise<TreeEntry[]> => {
    const res = await fetch(apiUrl(`/api/claude-code/files/tree?dir=${encodeURIComponent(dir)}`));
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Load failed");
    const data = (await res.json()) as { entries: TreeEntry[] };
    return data.entries;
  }, []);

  const loadRoot = useCallback(async () => {
    setLoadingRoot(true);
    setRootError(null);
    try {
      const entries = await fetchDir("");
      setRoots(buildInitialNodes(entries));
    } catch (err) {
      setRootError(String(err));
    } finally {
      setLoadingRoot(false);
    }
  }, [fetchDir]);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  // ── Partial refresh: re-fetch children of a directory by its path ─────────
  const refreshDir = useCallback(
    async (dirPath: string) => {
      if (dirPath === "") {
        await loadRoot();
        return;
      }
      try {
        const entries = await fetchDir(dirPath);
        const newChildren = buildInitialNodes(entries);

        const updateNodes = (nodes: TreeNodeState[]): TreeNodeState[] =>
          nodes.map((n) => {
            if (n.entry.path === dirPath && n.entry.type === "dir") {
              return { ...n, children: newChildren, expanded: true };
            }
            if (n.children) {
              return { ...n, children: updateNodes(n.children) };
            }
            return n;
          });

        setRoots((r) => updateNodes(r));
      } catch {
        // swallow — tree stays as-is
      }
    },
    [fetchDir, loadRoot],
  );

  // ── Toggle directory expansion ─────────────────────────────────────────────
  const toggleDir = useCallback(
    async (node: TreeNodeState, pathSoFar: string[]) => {
      if (node.entry.type !== "dir") return;

      const updateNodes = (nodes: TreeNodeState[], idx: number): TreeNodeState[] => {
        const key = pathSoFar[idx];
        return nodes.map((n) => {
          if (n.entry.name !== key) return n;
          if (idx < pathSoFar.length - 1) {
            return { ...n, children: n.children ? updateNodes(n.children, idx + 1) : n.children };
          }
          if (n.expanded) return { ...n, expanded: false };
          if (n.children !== null) return { ...n, expanded: true };
          return { ...n, loading: true, expanded: true };
        });
      };
      setRoots((r) => updateNodes(r, 0));

      if (node.children === null && !node.loading) {
        try {
          const entries = await fetchDir(node.entry.path);
          const setChildren = (nodes: TreeNodeState[], idx: number): TreeNodeState[] =>
            nodes.map((n) => {
              if (n.entry.name !== pathSoFar[idx]) return n;
              if (idx < pathSoFar.length - 1 && n.children)
                return { ...n, children: setChildren(n.children, idx + 1) };
              return { ...n, children: buildInitialNodes(entries), loading: false };
            });
          setRoots((r) => setChildren(r, 0));
        } catch (err) {
          const setError = (nodes: TreeNodeState[], idx: number): TreeNodeState[] =>
            nodes.map((n) => {
              if (n.entry.name !== pathSoFar[idx]) return n;
              if (idx < pathSoFar.length - 1 && n.children)
                return { ...n, children: setError(n.children, idx + 1) };
              return { ...n, loading: false, error: String(err), expanded: false };
            });
          setRoots((r) => setError(r, 0));
        }
      }
    },
    [fetchDir],
  );

  // ── Ensure a directory is expanded (for new-file/new-folder in collapsed dirs) ──
  const ensureExpanded = useCallback(
    async (dirPath: string) => {
      if (dirPath === "") return;
      const findAndExpand = async (nodes: TreeNodeState[]): Promise<TreeNodeState[] | null> => {
        for (const n of nodes) {
          if (n.entry.path === dirPath && n.entry.type === "dir") {
            if (!n.expanded) {
              let children = n.children;
              if (children === null) {
                try { children = buildInitialNodes(await fetchDir(dirPath)); } catch { children = []; }
              }
              return nodes.map((x) =>
                x.entry.path === dirPath ? { ...x, expanded: true, children } : x,
              );
            }
            return null;
          }
          if (n.children) {
            const updated = await findAndExpand(n.children);
            if (updated) return nodes.map((x) => x.entry.path === n.entry.path ? { ...x, children: updated } : x);
          }
        }
        return null;
      };
      const updated = await findAndExpand(roots);
      if (updated) setRoots(updated);
    },
    [roots, fetchDir],
  );

  // ── Handle context menu actions ────────────────────────────────────────────
  const handleAction = useCallback(
    async (action: FileAction) => {
      setOpError(null);

      if (action.type === "new-file" || action.type === "new-folder") {
        await ensureExpanded(action.parentPath);
        setPendingOp({ type: action.type, parentPath: action.parentPath });
        return;
      }

      if (action.type === "rename") {
        setPendingOp({ type: "rename", entry: action.entry });
        return;
      }

      if (action.type === "delete") {
        // File was already deleted by the context menu component
        const parentPath = action.entry.path.split("/").slice(0, -1).join("/");
        await refreshDir(parentPath);
        if (action.entry.type === "file") {
          onFileDeleted?.(action.entry.path);
        } else {
          // If a folder was deleted, clear active file if it was inside
          onFileDeleted?.(action.entry.path);
        }
      }
    },
    [ensureExpanded, refreshDir, onFileDeleted],
  );

  // ── Inline input submission ────────────────────────────────────────────────
  const handleInlineSubmit = useCallback(
    async (value: string) => {
      if (!pendingOp) return;
      setOpError(null);

      if (pendingOp.type === "new-file") {
        const filePath = pendingOp.parentPath
          ? `${pendingOp.parentPath}/${value}`
          : value;
        const result = await manageFile({ action: "create-file", path: filePath });
        if (result.ok) {
          setPendingOp(null);
          await refreshDir(pendingOp.parentPath);
          onOpenFile(filePath);
        } else {
          setOpError(result.error ?? "Failed to create file");
        }
      } else if (pendingOp.type === "new-folder") {
        const folderPath = pendingOp.parentPath
          ? `${pendingOp.parentPath}/${value}`
          : value;
        const result = await manageFile({ action: "create-folder", path: folderPath });
        if (result.ok) {
          setPendingOp(null);
          await refreshDir(pendingOp.parentPath);
        } else {
          setOpError(result.error ?? "Failed to create folder");
        }
      } else if (pendingOp.type === "rename") {
        const oldPath = pendingOp.entry.path;
        const parentDir = oldPath.split("/").slice(0, -1).join("/");
        const newPath = parentDir ? `${parentDir}/${value}` : value;
        const result = await manageFile({ action: "rename", oldPath, newPath });
        if (result.ok) {
          setPendingOp(null);
          await refreshDir(parentDir);
          onFileRenamed?.(oldPath, newPath);
        } else {
          setOpError(result.error ?? "Failed to rename");
        }
      }
    },
    [pendingOp, refreshDir, onOpenFile, onFileRenamed],
  );

  const handleInlineCancel = useCallback(() => {
    setPendingOp(null);
    setOpError(null);
  }, []);

  // ── Context menu open ──────────────────────────────────────────────────────
  const openContextMenu = useCallback((e: React.MouseEvent, target: TreeEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  // ── Flatten tree for search ────────────────────────────────────────────────
  const flattenSearch = useCallback((nodes: TreeNodeState[], results: TreeEntry[] = []) => {
    for (const n of nodes) {
      if (n.entry.type === "file") results.push(n.entry);
      if (n.children) flattenSearch(n.children, results);
    }
    return results;
  }, []);

  // ── Render a pending-op inline input at the right depth ───────────────────
  const renderInlineInput = (parentPath: string, depth: number) => {
    if (!pendingOp) return null;
    if (pendingOp.type === "rename") return null;
    if (pendingOp.parentPath !== parentPath) return null;
    return (
      <InlineInput
        key="__pending__"
        depth={depth}
        placeholder={pendingOp.type === "new-file" ? "filename.ext" : "folder-name"}
        icon={pendingOp.type === "new-file" ? FilePlus : FolderPlus}
        onSubmit={handleInlineSubmit}
        onCancel={handleInlineCancel}
      />
    );
  };

  // ── Render tree node ────────────────────────────────────────────────────────
  const renderNode = (node: TreeNodeState, depth: number, pathSoFar: string[]): React.ReactNode => {
    const isDir = node.entry.type === "dir";
    const isActive = !isDir && activeFile === node.entry.path;
    const nodePath = [...pathSoFar, node.entry.name];
    const isRenaming = pendingOp?.type === "rename" && pendingOp.entry.path === node.entry.path;

    return (
      <div key={node.entry.path}>
        {isRenaming ? (
          <InlineInput
            depth={depth}
            placeholder={node.entry.name}
            initialValue={node.entry.name}
            icon={isDir ? FolderPlus : FilePlus}
            onSubmit={handleInlineSubmit}
            onCancel={handleInlineCancel}
          />
        ) : (
          <button
            onClick={() => {
              if (isDir) toggleDir(node, nodePath);
              else onOpenFile(node.entry.path);
            }}
            onContextMenu={(e) => openContextMenu(e, node.entry)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-caption transition-all duration-150 group",
              isActive
                ? "bg-bot-accent/15 text-bot-accent"
                : "text-bot-text/80 hover:bg-bot-elevated/50 hover:text-bot-text",
            )}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            {isDir ? (
              <>
                {node.loading ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-bot-muted" />
                ) : node.expanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-bot-muted/60" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-bot-muted/60" />
                )}
                {node.expanded
                  ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-bot-amber/70" />
                  : <Folder className="h-3.5 w-3.5 shrink-0 text-bot-amber/70" />}
              </>
            ) : (
              <>
                <span className="h-3 w-3 shrink-0" />
                <FileIcon ext={node.entry.ext} />
              </>
            )}
            <span className="truncate min-w-0 flex-1">{node.entry.name}</span>
            {isDir && node.error && (
              <span className="text-bot-red text-[10px] shrink-0">!</span>
            )}
          </button>
        )}

        {isDir && node.expanded && node.children && (
          <div>
            {/* Inline input for new items inside this directory */}
            {renderInlineInput(node.entry.path, depth + 1)}

            {node.children.length === 0 && !pendingOp ? (
              <p
                className="py-1 text-[10px] text-bot-muted/50 italic"
                style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
              >
                Empty
              </p>
            ) : (
              node.children.map((child) => renderNode(child, depth + 1, nodePath))
            )}
          </div>
        )}
      </div>
    );
  };

  const searchResults = search.trim()
    ? flattenSearch(roots)
        .filter(
          (e) =>
            e.name.toLowerCase().includes(search.toLowerCase()) ||
            e.path.toLowerCase().includes(search.toLowerCase()),
        )
        .slice(0, 50)
    : null;

  return (
    <div
      className="flex flex-col h-full w-64 shrink-0 border-r border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm"
      onContextMenu={(e) => {
        // Right-click on empty space → root-level menu
        if (e.target === e.currentTarget) openContextMenu(e, null);
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-bot-border/30 shrink-0">
        <span className="text-caption text-bot-muted uppercase tracking-wider font-semibold">Files</span>
        <div className="flex items-center gap-1">
          {/* New file/folder button */}
          <div className="relative" ref={newMenuRef}>
            <button
              onClick={() => setShowNewMenu((v) => !v)}
              className="rounded-md p-1 text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-all duration-200"
              title="New file or folder"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {showNewMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-xl border border-bot-border/40 bg-bot-surface/95 backdrop-blur-md shadow-xl py-1.5">
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    setPendingOp({ type: "new-file", parentPath: "" });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-caption text-bot-text/80 hover:bg-bot-elevated/60 hover:text-bot-text transition-colors"
                >
                  <FilePlus className="h-3.5 w-3.5 text-bot-accent/70" />
                  New File
                </button>
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    setPendingOp({ type: "new-folder", parentPath: "" });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-caption text-bot-text/80 hover:bg-bot-elevated/60 hover:text-bot-text transition-colors"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-bot-amber/70" />
                  New Folder
                </button>
              </div>
            )}
          </div>
          <button
            onClick={loadRoot}
            className="rounded-md p-1 text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-all duration-200"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-bot-border/20 shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full rounded-lg border border-bot-border/30 bg-bot-elevated/40 px-3 py-1.5 text-caption text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 transition-colors"
        />
      </div>

      {/* Op error */}
      {opError && (
        <div className="px-3 py-1.5 text-[10px] text-bot-red bg-bot-red/10 border-b border-bot-red/20 flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">{opError}</span>
          <button onClick={() => setOpError(null)} className="shrink-0 text-bot-red/70 hover:text-bot-red">✕</button>
        </div>
      )}

      {/* Tree / Search results */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {loadingRoot ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-bot-muted" />
          </div>
        ) : rootError ? (
          <div className="px-3 py-4 text-caption text-bot-red">{rootError}</div>
        ) : searchResults ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-4 text-caption text-bot-muted italic">No files found</p>
          ) : (
            searchResults.map((entry) => (
              <button
                key={entry.path}
                onClick={() => onOpenFile(entry.path)}
                onContextMenu={(e) => openContextMenu(e, entry)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-caption transition-all duration-150",
                  activeFile === entry.path
                    ? "bg-bot-accent/15 text-bot-accent"
                    : "text-bot-text/80 hover:bg-bot-elevated/50 hover:text-bot-text",
                )}
              >
                <FileIcon ext={entry.ext} />
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium">{entry.name}</div>
                  <div className="truncate text-[10px] text-bot-muted/60">{entry.path}</div>
                </div>
              </button>
            ))
          )
        ) : (
          <>
            {/* Root-level inline input for new items */}
            {renderInlineInput("", 0)}
            {roots.map((node) => renderNode(node, 0, []))}
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          target={contextMenu.target}
          onAction={handleAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

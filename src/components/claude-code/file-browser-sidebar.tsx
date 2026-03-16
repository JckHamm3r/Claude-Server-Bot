"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Folder, FolderOpen, FileText, FileCode, File,
  ChevronRight, ChevronDown, RefreshCw, Loader2,
  FileJson, FileSearch,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import type { TreeEntry } from "@/app/api/claude-code/files/tree/route";

// Map file extensions to icons
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

interface TreeNodeState {
  entry: TreeEntry;
  children: TreeNodeState[] | null; // null = not loaded, [] = loaded but empty
  expanded: boolean;
  loading: boolean;
  error?: string;
}

function buildInitialNodes(entries: TreeEntry[]): TreeNodeState[] {
  return entries.map((e) => ({
    entry: e,
    children: e.type === "dir" ? null : null,
    expanded: false,
    loading: false,
  }));
}

interface FileBrowserSidebarProps {
  activeFile: string | null;
  onOpenFile: (path: string) => void;
}

export function FileBrowserSidebar({ activeFile, onOpenFile }: FileBrowserSidebarProps) {
  const [roots, setRoots] = useState<TreeNodeState[]>([]);
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [rootError, setRootError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchDir = useCallback(async (dir: string): Promise<TreeEntry[]> => {
    const res = await fetch(apiUrl(`/api/claude-code/files/tree?dir=${encodeURIComponent(dir)}`));
    if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Load failed");
    const data = await res.json() as { entries: TreeEntry[] };
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

  const toggleDir = useCallback(async (node: TreeNodeState, path: string[]) => {
    if (node.entry.type !== "dir") return;

    const updateNodes = (nodes: TreeNodeState[], pathIdx: number): TreeNodeState[] => {
      const key = path[pathIdx];
      return nodes.map((n) => {
        if (n.entry.name !== key) return n;
        if (pathIdx < path.length - 1) {
          return { ...n, children: n.children ? updateNodes(n.children, pathIdx + 1) : n.children };
        }
        // This is the target node
        if (n.expanded) {
          return { ...n, expanded: false };
        }
        if (n.children !== null) {
          return { ...n, expanded: true };
        }
        return { ...n, loading: true, expanded: true };
      });
    };

    setRoots((r) => updateNodes(r, 0));

    // If children not loaded yet, fetch them
    if (node.children === null && !node.loading) {
      try {
        const entries = await fetchDir(node.entry.path);
        const setChildren = (nodes: TreeNodeState[], pathIdx: number): TreeNodeState[] =>
          nodes.map((n) => {
            if (n.entry.name !== path[pathIdx]) return n;
            if (pathIdx < path.length - 1 && n.children) {
              return { ...n, children: setChildren(n.children, pathIdx + 1) };
            }
            return { ...n, children: buildInitialNodes(entries), loading: false };
          });
        setRoots((r) => setChildren(r, 0));
      } catch (err) {
        const setError = (nodes: TreeNodeState[], pathIdx: number): TreeNodeState[] =>
          nodes.map((n) => {
            if (n.entry.name !== path[pathIdx]) return n;
            if (pathIdx < path.length - 1 && n.children) {
              return { ...n, children: setError(n.children, pathIdx + 1) };
            }
            return { ...n, loading: false, error: String(err), expanded: false };
          });
        setRoots((r) => setError(r, 0));
      }
    }
  }, [fetchDir]);

  // Flatten tree for search results
  const flattenSearch = useCallback((nodes: TreeNodeState[], results: TreeEntry[] = []) => {
    for (const n of nodes) {
      if (n.entry.type === "file") results.push(n.entry);
      if (n.children) flattenSearch(n.children, results);
    }
    return results;
  }, []);

  const renderNode = (node: TreeNodeState, depth: number, pathSoFar: string[]) => {
    const isDir = node.entry.type === "dir";
    const isActive = !isDir && activeFile === node.entry.path;
    const nodePath = [...pathSoFar, node.entry.name];

    return (
      <div key={node.entry.path}>
        <button
          onClick={() => {
            if (isDir) toggleDir(node, nodePath);
            else onOpenFile(node.entry.path);
          }}
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
                : <Folder className="h-3.5 w-3.5 shrink-0 text-bot-amber/70" />
              }
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

        {isDir && node.expanded && node.children && (
          <div>
            {node.children.length === 0 ? (
              <p className="py-1 text-[10px] text-bot-muted/50 italic" style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}>
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
    ? flattenSearch(roots).filter((e) =>
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.path.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 50)
    : null;

  return (
    <div className="flex flex-col h-full w-64 shrink-0 border-r border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-bot-border/30 shrink-0">
        <span className="text-caption text-bot-muted uppercase tracking-wider font-semibold">Files</span>
        <button
          onClick={loadRoot}
          className="rounded-md p-1 text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-all duration-200"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
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
          roots.map((node) => renderNode(node, 0, []))
        )}
      </div>
    </div>
  );
}

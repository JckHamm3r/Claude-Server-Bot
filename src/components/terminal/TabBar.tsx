"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, X, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalSessionTab {
  id: string;
  name: string;
  cwd: string;
  is_default: number;
  order_index: number;
}

interface TabBarProps {
  tabs: TerminalSessionTab[];
  activeTabId: string | null;
  activityMap: Record<string, boolean>;
  maxTabs: number;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, name: string) => void;
  compact?: boolean;
  focused?: boolean;
}

export function TabBar({
  tabs,
  activeTabId,
  activityMap,
  maxTabs,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onRenameTab,
  compact,
  focused = true,
}: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startEdit = useCallback((tab: TerminalSessionTab, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(tab.id);
    setEditValue(tab.name);
  }, []);

  const commitEdit = useCallback(() => {
    if (editingId && editValue.trim()) {
      onRenameTab(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue("");
  }, [editingId, editValue, onRenameTab]);

  const formatCwd = (cwd: string) => {
    if (!cwd) return "";
    const home = process.env.HOME ?? "/root";
    const shortened = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
    const parts = shortened.split("/").filter(Boolean);
    if (parts.length <= 2) return shortened;
    return `…/${parts.slice(-2).join("/")}`;
  };

  return (
    <div className={cn(
      "flex items-center gap-0.5 overflow-x-auto shrink-0",
      "bg-bot-surface/50 backdrop-blur-sm border-b border-bot-border/20",
      compact ? "px-1.5 py-0.5 min-h-[30px]" : "px-2 py-1 min-h-[36px]",
      !focused && "opacity-60",
    )}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isEditing = editingId === tab.id;
        const hasActivity = activityMap[tab.id];

        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onDoubleClick={(e) => startEdit(tab, e)}
            className={cn(
              "group relative flex items-center gap-1.5 rounded-md cursor-pointer transition-all shrink-0 min-w-0 max-w-[180px]",
              compact ? "px-2 py-0.5" : "px-2.5 py-1",
              isActive
                ? "bg-bot-elevated/80 border border-bot-accent/25 text-bot-accent shadow-[0_0_10px_1px_rgb(var(--bot-glow)/0.08)]"
                : "text-bot-muted hover:text-bot-text/80 hover:bg-bot-elevated/40 border border-transparent",
            )}
          >
            {isActive && (
              <span className="absolute bottom-0 left-1.5 right-1.5 h-[2px] rounded-full gradient-accent" />
            )}

            {hasActivity && !isActive && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-bot-green animate-pulse" />
            )}

            {isEditing ? (
              <input
                ref={editInputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") { setEditingId(null); }
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full min-w-0 bg-transparent border-b border-bot-accent/60 text-caption text-bot-text focus:outline-none"
                style={{ maxWidth: 120 }}
              />
            ) : (
              <span className={cn(
                "font-medium truncate",
                compact ? "text-[10px]" : "text-[11px]",
                isActive && "text-bot-accent",
              )}>{tab.name}</span>
            )}

            {tab.cwd && !isEditing && !compact && (
              <span className="flex items-center gap-0.5 text-[9px] text-bot-accent/40 shrink-0">
                <FolderOpen className="h-2.5 w-2.5" />
                <span className="truncate max-w-[60px]">{formatCwd(tab.cwd)}</span>
              </span>
            )}

            {!tab.is_default && (
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                className={cn(
                  "ml-0.5 rounded p-0.5 transition-colors shrink-0",
                  "text-bot-muted opacity-0 group-hover:opacity-100",
                  "hover:text-bot-red hover:bg-bot-red/10",
                )}
              >
                <X className={cn(compact ? "h-2 w-2" : "h-2.5 w-2.5")} />
              </button>
            )}
          </div>
        );
      })}

      {tabs.length < maxTabs && (
        <button
          onClick={onNewTab}
          className={cn(
            "flex items-center gap-1 rounded-md text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-colors shrink-0",
            compact ? "px-1.5 py-0.5" : "px-2 py-1",
          )}
          title="New terminal tab"
        >
          <Plus className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
        </button>
      )}
    </div>
  );
}

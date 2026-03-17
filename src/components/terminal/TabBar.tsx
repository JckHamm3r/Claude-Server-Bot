"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, X, FolderOpen, Columns2 } from "lucide-react";
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
  splitTabId: string | null;
  maxTabs: number;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, name: string) => void;
  onSplitToggle: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  activityMap,
  splitTabId,
  maxTabs,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onRenameTab,
  onSplitToggle,
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
    // Show only last 2 segments
    const parts = shortened.split("/").filter(Boolean);
    if (parts.length <= 2) return shortened;
    return `…/${parts.slice(-2).join("/")}`;
  };

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 bg-[#0a0a10] border-b border-bot-border/30 overflow-x-auto shrink-0 min-h-[36px]">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isSplit = tab.id === splitTabId;
        const isEditing = editingId === tab.id;
        const hasActivity = activityMap[tab.id];

        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onDoubleClick={(e) => startEdit(tab, e)}
            className={cn(
              "group relative flex items-center gap-1.5 rounded-md px-2.5 py-1 cursor-pointer transition-all shrink-0 min-w-0 max-w-[180px]",
              isActive || isSplit
                ? "bg-bot-elevated/70 border border-bot-border/50 text-bot-text"
                : "text-bot-muted hover:text-bot-text/80 hover:bg-bot-elevated/30 border border-transparent"
            )}
          >
            {/* Activity indicator */}
            {hasActivity && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-bot-green animate-pulse" />
            )}

            {/* Tab label */}
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
              <span className="text-[11px] font-medium truncate">{tab.name}</span>
            )}

            {/* CWD badge */}
            {tab.cwd && !isEditing && (
              <span className="flex items-center gap-0.5 text-[9px] text-bot-muted shrink-0 opacity-70">
                <FolderOpen className="h-2.5 w-2.5" />
                <span className="truncate max-w-[60px]">{formatCwd(tab.cwd)}</span>
              </span>
            )}

            {/* Close button */}
            {!tab.is_default && (
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                className={cn(
                  "ml-0.5 rounded p-0.5 transition-colors shrink-0",
                  "text-bot-muted opacity-0 group-hover:opacity-100",
                  "hover:text-bot-red hover:bg-bot-red/10"
                )}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        );
      })}

      {/* New tab button */}
      {tabs.length < maxTabs && (
        <button
          onClick={onNewTab}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30 transition-colors shrink-0"
          title="New terminal tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Split pane toggle */}
      {tabs.length >= 2 && (
        <button
          onClick={onSplitToggle}
          title={splitTabId ? "Close split" : "Split pane"}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition-colors shrink-0",
            splitTabId
              ? "text-bot-accent bg-bot-accent/10 border border-bot-accent/30"
              : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/30"
          )}
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

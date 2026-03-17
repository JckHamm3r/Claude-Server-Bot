"use client";

import { useState, useEffect, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { Bookmark, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalBookmark {
  id: string;
  terminal_session_id: string;
  line_index: number;
  label: string;
  color: string;
  created_at: string;
}

interface BookmarkPanelProps {
  tabId: string;
  currentLineCount: number;
  onClose: () => void;
  onJumpToLine?: (lineIndex: number) => void;
}

const BOOKMARK_COLORS = [
  "#58a6ff", // blue
  "#3fb950", // green
  "#d29922", // yellow
  "#ff7b72", // red
  "#bc8cff", // purple
  "#39c5cf", // cyan
];

export function BookmarkPanel({ tabId, currentLineCount, onClose, onJumpToLine }: BookmarkPanelProps) {
  const [bookmarks, setBookmarks] = useState<TerminalBookmark[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [selectedColor, setSelectedColor] = useState(BOOKMARK_COLORS[0]);
  const [adding, setAdding] = useState(false);

  const loadBookmarks = useCallback(() => {
    const socket = getSocket();
    socket.emit("terminal:bookmark:list", { tabId });
  }, [tabId]);

  useEffect(() => {
    const socket = getSocket();

    const handleList = ({ tabId: tid, bookmarks: bms }: { tabId: string; bookmarks: TerminalBookmark[] }) => {
      if (tid !== tabId) return;
      setBookmarks(bms);
    };

    const handleAdded = ({ tabId: tid, bookmark }: { tabId: string; bookmark: TerminalBookmark }) => {
      if (tid !== tabId) return;
      setBookmarks((prev) => [...prev, bookmark].sort((a, b) => a.line_index - b.line_index));
    };

    const handleRemoved = ({ bookmarkId }: { bookmarkId: string }) => {
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
    };

    socket.on("terminal:bookmark:list", handleList);
    socket.on("terminal:bookmark:added", handleAdded);
    socket.on("terminal:bookmark:removed", handleRemoved);

    loadBookmarks();

    return () => {
      socket.off("terminal:bookmark:list", handleList);
      socket.off("terminal:bookmark:added", handleAdded);
      socket.off("terminal:bookmark:removed", handleRemoved);
    };
  }, [tabId, loadBookmarks]);

  const handleAdd = () => {
    if (!newLabel.trim()) return;
    const socket = getSocket();
    socket.emit("terminal:bookmark:add", {
      tabId,
      lineIndex: currentLineCount,
      label: newLabel.trim(),
      color: selectedColor,
    });
    setNewLabel("");
    setAdding(false);
  };

  const handleRemove = (bookmarkId: string) => {
    const socket = getSocket();
    socket.emit("terminal:bookmark:remove", { bookmarkId });
  };

  return (
    <div className="flex flex-col h-full bg-bot-surface/90 border-l border-bot-border/40 w-64 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bot-border/40">
        <div className="flex items-center gap-2">
          <Bookmark className="h-3.5 w-3.5 text-bot-accent" />
          <span className="text-caption font-semibold text-bot-text">Bookmarks</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/60 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Bookmark list */}
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {bookmarks.length === 0 && (
          <p className="text-center text-caption text-bot-muted py-6 px-3">
            No bookmarks yet. Add one to mark important output.
          </p>
        )}
        {bookmarks.map((bm) => (
          <div
            key={bm.id}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-bot-elevated/40 group cursor-pointer"
            onClick={() => onJumpToLine?.(bm.line_index)}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: bm.color }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-caption text-bot-text truncate">{bm.label}</p>
              <p className="text-[10px] text-bot-muted">line {bm.line_index.toLocaleString()}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleRemove(bm.id); }}
              className="opacity-0 group-hover:opacity-100 text-bot-muted hover:text-bot-red transition-all"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Add bookmark */}
      <div className="border-t border-bot-border/40 p-2">
        {adding ? (
          <div className="space-y-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="Bookmark label..."
              autoFocus
              className="w-full rounded border border-bot-border/60 bg-bot-elevated/40 px-2 py-1 text-caption text-bot-text placeholder:text-bot-muted focus:outline-none focus:border-bot-accent/60"
            />
            <div className="flex items-center gap-1.5">
              {BOOKMARK_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  className={cn(
                    "h-4 w-4 rounded-full border-2 transition-all",
                    selectedColor === c ? "border-white scale-110" : "border-transparent"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
              <button
                onClick={handleAdd}
                className="ml-auto text-caption text-bot-accent hover:text-bot-accent/80 font-medium"
              >
                Add
              </button>
              <button
                onClick={() => setAdding(false)}
                className="text-caption text-bot-muted hover:text-bot-text"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add bookmark at current line
          </button>
        )}
      </div>
    </div>
  );
}

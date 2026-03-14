"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Clock, Pencil, Trash2, X, Check, GripVertical } from "lucide-react";

interface QueuedMessagesProps {
  queue: string[];
  onEdit: (index: number, newContent: string) => void;
  onDelete: (index: number) => void;
}

export function QueuedMessages({ queue, onEdit, onDelete }: QueuedMessagesProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingIndex !== null && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [editingIndex]);

  if (queue.length === 0) return null;

  const startEdit = (index: number) => {
    setEditValue(queue[index]);
    setEditingIndex(index);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== queue[editingIndex]) {
      onEdit(editingIndex, trimmed);
    }
    setEditingIndex(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditValue("");
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const truncate = (text: string, maxLen = 80) =>
    text.length > maxLen ? text.slice(0, maxLen) + "…" : text;

  return (
    <div className="mb-2 animate-scaleIn">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 text-[11px] text-bot-muted group"
      >
        <Clock className="h-3 w-3 text-bot-amber" />
        <span className="text-bot-amber font-medium">
          {queue.length} message{queue.length > 1 ? "s" : ""} queued
        </span>
        <span className="opacity-50">— will send after Claude finishes</span>
        <span className="ml-auto text-[10px] opacity-40 group-hover:opacity-70 transition-opacity">
          {expanded ? "collapse" : "manage"}
        </span>
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1 rounded-lg border border-bot-amber/20 bg-bot-elevated/40 p-2">
          {queue.map((msg, i) => (
            <div
              key={`${i}-${msg.slice(0, 20)}`}
              className="group/item flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-bot-surface/50 transition-colors"
            >
              <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bot-muted/30" />
              <span className="mt-px text-[10px] font-medium text-bot-amber/60 tabular-nums shrink-0">
                #{i + 1}
              </span>

              {editingIndex === i ? (
                <div className="flex-1 flex flex-col gap-1">
                  <textarea
                    ref={textareaRef}
                    value={editValue}
                    onChange={(e) => {
                      setEditValue(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                    }}
                    onKeyDown={handleEditKeyDown}
                    rows={1}
                    className="w-full resize-none rounded border border-bot-amber/30 bg-bot-surface/60 px-2 py-1 text-[12px] text-bot-text outline-none focus:border-bot-amber/60"
                    style={{ maxHeight: 120 }}
                  />
                  <div className="flex items-center gap-1 text-[10px] text-bot-muted/50">
                    <button
                      onClick={saveEdit}
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-bot-green hover:bg-bot-green/10 transition-colors"
                      title="Save"
                    >
                      <Check className="h-3 w-3" /> Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-bot-muted hover:bg-bot-elevated transition-colors"
                      title="Cancel"
                    >
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <span className="ml-1 opacity-50">Enter save · Esc cancel</span>
                  </div>
                </div>
              ) : (
                <span className="flex-1 text-[12px] text-bot-text/80 leading-relaxed break-words">
                  {truncate(msg)}
                </span>
              )}

              {editingIndex !== i && (
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(i)}
                    className="rounded p-1 text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-colors"
                    title="Edit queued message"
                    aria-label="Edit queued message"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => {
                      onDelete(i);
                      if (editingIndex !== null && editingIndex > i) {
                        setEditingIndex(editingIndex - 1);
                      } else if (editingIndex === i) {
                        cancelEdit();
                      }
                    }}
                    className="rounded p-1 text-bot-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    title="Remove from queue"
                    aria-label="Remove from queue"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

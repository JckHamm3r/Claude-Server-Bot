"use client";

import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface Memory {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_global: boolean;
  source_session_id: string | null;
  assigned_agent_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SessionMemoryCleanupDialogProps {
  sessionName: string;
  memories: Memory[];
  onConfirm: (memoryIdsToDelete: string[]) => void;
  onClose: () => void;
}

export function SessionMemoryCleanupDialog({
  sessionName,
  memories,
  onConfirm,
  onClose,
}: SessionMemoryCleanupDialogProps) {
  const [memoriesToDelete, setMemoriesToDelete] = useState<Set<string>>(new Set());

  function toggleMemory(id: string) {
    setMemoriesToDelete((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function deleteAll() {
    setMemoriesToDelete(new Set(memories.map((m) => m.id)));
  }

  function keepAll() {
    setMemoriesToDelete(new Set());
  }

  function handleConfirm() {
    onConfirm(Array.from(memoriesToDelete));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative w-full max-w-md glass-heavy rounded-2xl shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bot-border/30 px-6 py-4">
          <h2 className="text-subtitle font-bold text-bot-text truncate pr-2">
            Delete Session: {sessionName}?
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated/50 hover:text-bot-text transition-all duration-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <p className="text-body text-bot-muted">
            This session created {memories.length} {memories.length === 1 ? "memory" : "memories"} via <code className="rounded-md bg-bot-elevated/60 px-1.5 py-0.5 text-caption font-mono text-bot-text">/remember</code>:
          </p>

          {/* Bulk actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={deleteAll}
              className="rounded-xl border border-bot-red/40 bg-bot-red/10 px-3 py-1.5 text-caption font-medium text-bot-red hover:bg-bot-red/20 transition-all duration-200"
            >
              Delete all
            </button>
            <button
              type="button"
              onClick={keepAll}
              className="rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-3 py-1.5 text-caption font-medium text-bot-muted hover:text-bot-text transition-all duration-200"
            >
              Keep all
            </button>
          </div>

          {/* Memory list */}
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
            {memories.map((m) => {
              const marked = memoriesToDelete.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMemory(m.id)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
                    marked
                      ? "border-bot-red/40 bg-bot-red/10"
                      : "border-bot-border/25 bg-bot-elevated/30 hover:border-bot-border/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn(
                      "text-[12px] font-medium leading-tight",
                      marked ? "text-bot-red line-through" : "text-bot-text",
                    )}>
                      {m.title}
                    </p>
                    <Trash2 className={cn(
                      "h-3.5 w-3.5 shrink-0 transition-colors duration-200",
                      marked ? "text-bot-red" : "text-bot-muted/40",
                    )} />
                  </div>
                  <p className="text-[11px] text-bot-muted/70 leading-snug line-clamp-1 mt-0.5">
                    {m.content.slice(0, 80)}{m.content.length > 80 ? "\u2026" : ""}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-bot-border/30 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-bot-border/40 px-4 py-2.5 text-body text-bot-muted hover:bg-bot-elevated/50 hover:text-bot-text transition-all duration-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-xl bg-bot-red px-5 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:brightness-110 active:scale-[0.98] transition-all duration-200"
          >
            Delete Session
          </button>
        </div>
      </motion.div>
    </div>
  );
}

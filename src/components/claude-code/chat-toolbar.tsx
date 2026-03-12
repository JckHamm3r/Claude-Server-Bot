"use client";

import { Square, RotateCcw, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatToolbarProps {
  onInterrupt: () => void;
  onClearContext: () => void;
  onRetryLast: () => void;
  isRunning: boolean;
  autoAccept: boolean;
  onAutoAcceptChange: (value: boolean) => void;
}

export function ChatToolbar({
  onInterrupt,
  onClearContext,
  onRetryLast,
  isRunning,
  autoAccept,
  onAutoAcceptChange,
}: ChatToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-bot-border bg-bot-surface px-4 py-2">
      <button
        onClick={onInterrupt}
        disabled={!isRunning}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium text-bot-red hover:bg-bot-red/10 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
        title="Interrupt (Ctrl+C)"
      >
        <Square className="h-3.5 w-3.5" />
        Interrupt
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => onAutoAcceptChange(!autoAccept)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium transition-colors",
            autoAccept
              ? "bg-bot-accent/15 text-bot-accent"
              : "text-bot-muted hover:bg-bot-elevated",
          )}
          title="Auto-Accept Edits — automatically confirm file edit prompts"
        >
          <Zap className="h-3.5 w-3.5" />
          Auto-Accept
          <span
            className={cn(
              "ml-1 rounded px-1.5 py-0.5 text-caption",
              autoAccept
                ? "bg-bot-accent/20 text-bot-accent"
                : "bg-bot-elevated text-bot-muted",
            )}
          >
            {autoAccept ? "ON" : "OFF"}
          </span>
        </button>

        <button
          onClick={onRetryLast}
          disabled={isRunning}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          title="Retry last message"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </button>
        <button
          onClick={onClearContext}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated transition-colors"
          title="Clear context (start new session)"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
    </div>
  );
}

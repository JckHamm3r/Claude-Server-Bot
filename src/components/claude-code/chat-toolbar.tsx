"use client";

import { useState } from "react";
import { Square, RotateCcw, Trash2, Zap, Search, Download, ChevronDown } from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import { ModelSelector } from "./model-selector";

interface SessionUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

interface BudgetLimits {
  session_usd: number;
  daily_usd: number;
  monthly_usd: number;
}

interface ChatToolbarProps {
  onInterrupt: () => void;
  onClearContext: () => void;
  onRetryLast: () => void;
  isRunning: boolean;
  autoAccept: boolean;
  onAutoAcceptChange: (value: boolean) => void;
  model?: string;
  onModelChange?: (model: string) => void;
  sessionUsage?: SessionUsage | null;
  onSearch?: () => void;
  onGlobalSearch?: () => void;
  sessionId?: string;
  budgetLimits?: BudgetLimits | null;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function ExportDropdown({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);

  const handleExport = (format: "markdown" | "json") => {
    setOpen(false);
    window.open(apiUrl(`/api/claude-code/export?sessionId=${sessionId}&format=${format}`), "_blank");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated transition-colors"
        title="Export session"
      >
        <Download className="h-3.5 w-3.5" />
        Export
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-bot-border bg-bot-elevated shadow-lg overflow-hidden">
            <button
              onClick={() => handleExport("markdown")}
              className="flex w-full items-center gap-2 px-3 py-2 text-caption text-bot-text hover:bg-bot-surface transition-colors"
            >
              Export as Markdown
            </button>
            <button
              onClick={() => handleExport("json")}
              className="flex w-full items-center gap-2 px-3 py-2 text-caption text-bot-text hover:bg-bot-surface transition-colors"
            >
              Export as JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ChatToolbar({
  onInterrupt,
  onClearContext,
  onRetryLast,
  isRunning,
  autoAccept,
  onAutoAcceptChange,
  model,
  onModelChange,
  sessionUsage,
  onSearch,
  onGlobalSearch,
  sessionId,
  budgetLimits,
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

      {model && onModelChange && (
        <ModelSelector
          value={model}
          onChange={onModelChange}
          compact
          disabled={isRunning}
        />
      )}

      <div className="ml-auto flex items-center gap-2">
        {sessionUsage && sessionUsage.total_input_tokens > 0 && (() => {
          const cost = sessionUsage.total_cost_usd;
          const sessionLimit = budgetLimits?.session_usd ?? 0;
          const pct = sessionLimit > 0 ? cost / sessionLimit : 0;
          const costColor = pct >= 1 ? "text-bot-red" : pct >= 0.8 ? "text-bot-amber" : pct >= 0.5 ? "text-bot-amber/70" : "text-bot-muted";
          const tooltip = `Input: ${sessionUsage.total_input_tokens} | Output: ${sessionUsage.total_output_tokens} | Cost: $${cost.toFixed(4)}${sessionLimit > 0 ? ` (limit: $${sessionLimit.toFixed(2)})` : ""}`;
          return (
            <span className={cn("text-[11px] font-mono", costColor)} title={tooltip}>
              {formatTokenCount(sessionUsage.total_input_tokens + sessionUsage.total_output_tokens)} tokens
              {cost > 0 && (
                <span className="ml-1">${cost.toFixed(3)}</span>
              )}
              {sessionLimit > 0 && (
                <span className="ml-0.5 opacity-50">/ ${sessionLimit.toFixed(0)}</span>
              )}
            </span>
          );
        })()}

        {onSearch && (
          <button
            onClick={onSearch}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated transition-colors"
            title="Search in session (Ctrl+F)"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        )}

        {onGlobalSearch && (
          <button
            onClick={onGlobalSearch}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated transition-colors"
            title="Search all sessions (Ctrl+Shift+F)"
          >
            <Search className="h-3.5 w-3.5" />
            All
          </button>
        )}

        {sessionId && <ExportDropdown sessionId={sessionId} />}

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

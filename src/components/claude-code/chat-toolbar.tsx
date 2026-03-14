"use client";

import { useState } from "react";
import { Square, RotateCcw, Trash2, Zap, Search, Download, ChevronDown, ClipboardCopy, Check } from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import { ModelSelector } from "./model-selector";
import type { ChatMessage, SessionUsage, BudgetLimits } from "@/types/chat";

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
  messages?: ChatMessage[];
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
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated/50 transition-all duration-200"
        title="Export session"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">Export</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl glass-heavy shadow-float overflow-hidden animate-scaleIn">
            <button
              onClick={() => handleExport("markdown")}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-caption text-bot-text hover:bg-bot-elevated/40 transition-all duration-150"
            >
              Export as Markdown
            </button>
            <button
              onClick={() => handleExport("json")}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-caption text-bot-text hover:bg-bot-elevated/40 transition-all duration-150"
            >
              Export as JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CopyAllButton({ messages }: { messages: ChatMessage[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const lines = messages
      .filter((m) => {
        const text = m.content ?? m.parsed?.content;
        return text && text.trim().length > 0;
      })
      .map((m) => {
        const sender = m.sender_type === "admin" ? "You" : "Claude";
        const text = m.content ?? m.parsed?.content ?? "";
        return `**${sender}:**\n${text}`;
      });
    if (lines.length === 0) return;
    navigator.clipboard.writeText(lines.join("\n\n---\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      disabled={messages.length === 0}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated/50 disabled:cursor-not-allowed disabled:opacity-40 transition-all duration-200"
      title="Copy entire conversation to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-bot-green" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
      <span className="hidden xl:inline">{copied ? "Copied" : "Copy All"}</span>
    </button>
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
  messages = [],
}: ChatToolbarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-bot-border/30 bg-bot-surface/60 backdrop-blur-md px-3 py-1.5">
      <button
        onClick={onInterrupt}
        disabled={!isRunning}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium text-bot-red hover:bg-bot-red/10 disabled:cursor-not-allowed disabled:opacity-40 transition-all duration-200"
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

      <div className="mx-2 h-4 w-px bg-bot-border/30" />

      <div className="ml-auto flex items-center gap-1">
        {sessionUsage && sessionUsage.total_input_tokens > 0 && (() => {
          const cost = sessionUsage.total_cost_usd;
          const sessionLimit = budgetLimits?.session_usd ?? 0;
          const pct = sessionLimit > 0 ? cost / sessionLimit : 0;
          const costColor = pct >= 1 ? "text-bot-red" : pct >= 0.8 ? "text-bot-amber" : pct >= 0.5 ? "text-bot-amber/70" : "text-bot-muted/60";
          const tooltip = `Input: ${sessionUsage.total_input_tokens} | Output: ${sessionUsage.total_output_tokens} | Cost: $${cost.toFixed(4)}${sessionLimit > 0 ? ` (limit: $${sessionLimit.toFixed(2)})` : ""}`;
          return (
            <span className={cn("text-[11px] font-mono mr-2", costColor)} title={tooltip}>
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
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated/50 transition-all duration-200"
            title="Search in session (Ctrl+F)"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        )}

        {onGlobalSearch && (
          <button
            onClick={onGlobalSearch}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated/50 transition-all duration-200"
            title="Search all sessions (Ctrl+Shift+F)"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">All</span>
          </button>
        )}

        <CopyAllButton messages={messages} />

        {sessionId && <ExportDropdown sessionId={sessionId} />}

        <div className="mx-1 h-4 w-px bg-bot-border/30" />

        <button
          onClick={() => onAutoAcceptChange(!autoAccept)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium transition-all duration-200",
            autoAccept
              ? "bg-bot-accent/10 text-bot-accent shadow-glow-sm"
              : "text-bot-muted hover:bg-bot-elevated/50",
          )}
          title="Auto-Accept Edits"
        >
          <Zap className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Auto-Accept</span>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
              autoAccept
                ? "bg-bot-accent/20 text-bot-accent"
                : "bg-bot-elevated/60 text-bot-muted",
            )}
          >
            {autoAccept ? "ON" : "OFF"}
          </span>
        </button>

        <button
          onClick={onRetryLast}
          disabled={isRunning}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated/50 disabled:cursor-not-allowed disabled:opacity-40 transition-all duration-200"
          title="Retry last message"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Retry</span>
        </button>
        <button
          onClick={onClearContext}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium text-bot-muted hover:bg-bot-elevated/50 transition-all duration-200"
          title="Clear context"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Clear</span>
        </button>
      </div>
    </div>
  );
}

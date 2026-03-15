"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Layers, Loader2, AlertTriangle } from "lucide-react";
import { ToolCallBlock } from "./tool-call-block";
import type { ChatMessage } from "./message-list";

interface ToolCallGroupProps {
  messages: ChatMessage[];
  searchHighlights?: Set<string>;
  activeHighlight?: string | null;
}

export function ToolCallGroup({ messages, searchHighlights, activeHighlight }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const activeElRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeElRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeHighlight]);

  const hasRunning = messages.some((m) => m.parsed?.toolStatus === "running");
  const hasError = messages.some((m) => m.parsed?.toolStatus === "error");
  const lastMsg = messages[messages.length - 1];
  const hiddenCount = messages.length - 1;

  const anyHighlighted = searchHighlights && messages.some((m) => searchHighlights.has(m.id));
  const anyActive = activeHighlight ? messages.some((m) => m.id === activeHighlight) : false;

  useEffect(() => {
    if (anyActive) setExpanded(true);
  }, [anyActive]);

  return (
    <div className={anyActive ? "rounded-lg ring-2 ring-bot-accent bg-bot-accent/5" : anyHighlighted ? "rounded-lg bg-bot-amber/5" : ""}>
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full px-1 py-1 text-left group"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-bot-muted shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-bot-muted shrink-0" />
          )}
          <Layers className="h-3 w-3 text-bot-muted" />
          <span className="text-[11px] font-mono text-bot-muted">
            {expanded ? `${messages.length} tool calls` : `${hiddenCount} more tool call${hiddenCount > 1 ? "s" : ""} · ${lastMsg.parsed?.toolName && lastMsg.parsed.toolName !== "unknown" ? lastMsg.parsed.toolName : "tool"}`}
          </span>
          {hasRunning && <Loader2 className="h-3 w-3 animate-spin text-bot-accent" />}
          {hasError && !hasRunning && <AlertTriangle className="h-3 w-3 text-bot-amber" />}
        </button>
      )}

      {expanded && hiddenCount > 0 && (
        <div className="space-y-0">
          {messages.slice(0, -1).map((msg) => {
            const isActive = activeHighlight === msg.id;
            const isHighlighted = searchHighlights?.has(msg.id);
            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={
                  isActive
                    ? "rounded-lg ring-2 ring-bot-accent bg-bot-accent/5"
                    : isHighlighted
                    ? "rounded-lg bg-bot-amber/5"
                    : ""
                }
                ref={isActive ? activeElRef : undefined}
              >
                <div className="py-0.5">
                  <ToolCallBlock parsed={msg.parsed!} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        id={`msg-${lastMsg.id}`}
        className={
          activeHighlight === lastMsg.id
            ? "rounded-lg ring-2 ring-bot-accent bg-bot-accent/5"
            : searchHighlights?.has(lastMsg.id)
            ? "rounded-lg bg-bot-amber/5"
            : ""
        }
        ref={activeHighlight === lastMsg.id ? activeElRef : undefined}
      >
        <div className="py-0.5">
          <ToolCallBlock parsed={lastMsg.parsed!} />
        </div>
      </div>
    </div>
  );
}

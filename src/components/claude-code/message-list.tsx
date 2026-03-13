"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { MessageItem } from "./message-item";
import type { ParsedOutput } from "@/lib/claude/provider";

export interface ChatMessage {
  id: string;
  sender_type: "admin" | "claude";
  content?: string;
  parsed?: ParsedOutput;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityState {
  toolName: string;
  message: string;
  toolInput?: unknown;
  count: number;
}

interface MessageListProps {
  messages: ChatMessage[];
  sessionId: string;
  onSelectOption: (sessionId: string, choice: string) => void;
  onConfirm: (sessionId: string, value: boolean) => void;
  onAllowTool?: (sessionId: string, toolName: string, scope: "session" | "once") => void;
  onAlwaysAllow?: (sessionId: string, toolName: string, command: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  isRunning?: boolean;
  currentActivity?: ActivityState | null;
  searchHighlights?: Set<string>;
  activeHighlight?: string | null;
  pendingInteraction?: { type: string; messageId: string } | null;
  loadingMessages?: boolean;
}

function ActivityStrip({ activity, isRunning }: { activity: ActivityState | null; isRunning: boolean }) {
  if (!isRunning) return null;

  const input = activity?.toolInput && typeof activity.toolInput === "object"
    ? activity.toolInput as Record<string, unknown>
    : null;

  const detail = input?.command
    ? `$ ${String(input.command)}`
    : input?.file_path
    ? String(input.file_path)
    : input?.pattern
    ? String(input.pattern)
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <div className="flex items-center gap-2 rounded-lg border border-bot-border/60 bg-bot-elevated/60 px-3 py-2 text-caption text-bot-muted">
        <span className="flex gap-0.5 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/70 animate-bounce [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/70 animate-bounce [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/70 animate-bounce [animation-delay:300ms]" />
        </span>
        <span className="font-mono text-[11px] truncate">
          {activity ? activity.message : "Thinking…"}
          {detail && (
            <span className="opacity-60"> · {detail}</span>
          )}
        </span>
        {activity && activity.count > 1 && (
          <span className="ml-auto shrink-0 text-[10px] opacity-40 font-mono">{activity.count}×</span>
        )}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  sessionId,
  onSelectOption,
  onConfirm,
  onAllowTool,
  onAlwaysAllow,
  onEditMessage,
  onDeleteMessage,
  isRunning,
  currentActivity,
  searchHighlights,
  activeHighlight,
  pendingInteraction,
  loadingMessages,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentActivity, isRunning]);

  if (messages.length === 0 && !isRunning) {
    if (loadingMessages) {
      return (
        <div className="flex flex-1 items-center justify-center text-body text-bot-muted">
          <span className="flex gap-1 items-center">
            <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:300ms]" />
            <span className="ml-2">Loading messages…</span>
          </span>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center text-body text-bot-muted">
        Start a conversation with Claude Code.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-4">
        <div className="mx-auto max-w-3xl px-4 space-y-1">
          {messages.map((msg, i) => {
            const isHighlighted = searchHighlights?.has(msg.id);
            const isActive = activeHighlight === msg.id;
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
                ref={isActive ? (el) => el?.scrollIntoView({ behavior: "smooth", block: "center" }) : undefined}
              >
                <MessageItem
                  message={msg}
                  sessionId={sessionId}
                  onSelectOption={onSelectOption}
                  onConfirm={onConfirm}
                  onAllowTool={onAllowTool}
                  onAlwaysAllow={onAlwaysAllow}
                  onEdit={onEditMessage}
                  onDelete={onDeleteMessage}
                  isLatest={i === messages.length - 1}
                  isRunning={isRunning}
                  isInteractive={pendingInteraction?.messageId === msg.id}
                />
              </div>
            );
          })}

          {/* Generic typing indicator when running but no text/streaming yet */}
          {isRunning && !currentActivity && (() => {
            const lastType = messages[messages.length - 1]?.parsed?.type;
            return lastType !== "streaming";
          })() && (
            <div className="flex gap-3 py-2 justify-start">
              <div className="mt-1 h-6 w-6 shrink-0 rounded-full overflow-hidden">
                <Image unoptimized src="/claude-code.png" alt="Claude" width={24} height={24} className="object-cover" />
              </div>
              <div className="rounded-2xl rounded-bl-sm bg-bot-elevated px-3 py-2.5 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <ActivityStrip activity={currentActivity ?? null} isRunning={isRunning ?? false} />
    </div>
  );
}

"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import Image from "next/image";
import { Terminal, Code2, FileSearch, MessageSquare, Slash } from "lucide-react";
import { MessageItem } from "./message-item";
import { ToolCallGroup } from "./tool-call-group";
import type { ParsedOutput } from "@/lib/claude/provider";
import { getAvatarPath, type AvatarState } from "@/lib/avatar-state";

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
  onRetry?: () => void;
  isRunning?: boolean;
  currentActivity?: ActivityState | null;
  searchHighlights?: Set<string>;
  activeHighlight?: string | null;
  pendingInteraction?: { type: string; messageId: string } | null;
  loadingMessages?: boolean;
  avatarState?: AvatarState;
  onSendStarter?: (message: string) => void;
  runStartTime?: number | null;
}

type Segment =
  | { kind: "single"; message: ChatMessage }
  | { kind: "tool-group"; messages: ChatMessage[] };

const STARTER_PROMPTS = [
  { icon: Terminal, label: "Run a command", prompt: "Run `git status` and summarize the current state of the repo" },
  { icon: Code2, label: "Write code", prompt: "Help me write a function that " },
  { icon: FileSearch, label: "Explore codebase", prompt: "Give me an overview of this project's architecture" },
  { icon: MessageSquare, label: "Explain something", prompt: "Explain how " },
];

function ThinkingBubble({ avatarState, runStartTime }: { avatarState?: AvatarState; runStartTime?: number | null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!runStartTime) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - runStartTime) / 1000));
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - runStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [runStartTime]);

  return (
    <div className="flex gap-3 py-2 justify-start">
      <div className="mt-1 h-6 w-6 shrink-0 rounded-full overflow-hidden">
        <Image unoptimized src={getAvatarPath(avatarState ?? "thinking")} alt="Claude" width={24} height={24} className="object-cover" />
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-bot-elevated px-3 py-2.5 flex items-center gap-2">
        <span className="flex gap-1 items-center">
          <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:300ms]" />
        </span>
        {elapsed >= 3 && (
          <span className="text-[11px] text-bot-muted font-mono tabular-nums">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function getThinkingPhase(seconds: number): string {
  if (seconds < 10) return "Thinking…";
  if (seconds < 30) return "Still thinking…";
  if (seconds < 60) return "Deep thinking, hang tight…";
  if (seconds < 120) return "Working on a complex response…";
  return "Still processing…";
}

function ActivityStrip({ activity, isRunning, runStartTime }: { activity: ActivityState | null; isRunning: boolean; runStartTime: number | null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRunning || !runStartTime) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - runStartTime) / 1000));
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - runStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning, runStartTime]);

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

  const label = activity ? activity.message : getThinkingPhase(elapsed);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <div className="flex items-center gap-2 rounded-lg border border-bot-border/60 bg-bot-elevated/60 px-3 py-2 text-caption text-bot-muted">
        <span className="flex gap-0.5 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/70 animate-bounce [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/70 animate-bounce [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/70 animate-bounce [animation-delay:300ms]" />
        </span>
        <span className="font-mono text-[11px] truncate">
          {label}
          {detail && (
            <span className="opacity-60"> · {detail}</span>
          )}
        </span>
        <span className="ml-auto shrink-0 text-[10px] opacity-40 font-mono tabular-nums">
          {activity && activity.count > 1 && <span className="mr-2">{activity.count}×</span>}
          {elapsed > 0 && formatElapsed(elapsed)}
        </span>
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
  onRetry,
  isRunning,
  currentActivity,
  searchHighlights,
  activeHighlight,
  pendingInteraction,
  loadingMessages,
  avatarState,
  onSendStarter,
  runStartTime,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentActivity, isRunning]);

  const segments = useMemo<Segment[]>(() => {
    const result: Segment[] = [];
    let toolGroup: ChatMessage[] = [];

    const flushGroup = () => {
      if (toolGroup.length === 0) return;
      if (toolGroup.length === 1) {
        result.push({ kind: "single", message: toolGroup[0] });
      } else {
        result.push({ kind: "tool-group", messages: [...toolGroup] });
      }
      toolGroup = [];
    };

    for (const msg of messages) {
      const t = msg.parsed?.type;
      if (t === "tool_call" || t === "tool_result") {
        toolGroup.push(msg);
      } else {
        flushGroup();
        result.push({ kind: "single", message: msg });
      }
    }
    flushGroup();
    return result;
  }, [messages]);

  if (messages.length === 0 && !isRunning) {
    if (loadingMessages) {
      return (
        <div className="flex flex-1 items-center justify-center text-body text-bot-muted">
          <span className="flex gap-1 items-center">
            <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-bot-muted animate-bounce [animation-delay:300ms]" />
            <span className="ml-2">Loading messages...</span>
          </span>
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <div className="max-w-lg w-full space-y-6 text-center">
          <div className="space-y-2">
            <h2 className="text-subtitle font-semibold text-bot-text">Start a conversation</h2>
            <p className="text-body text-bot-muted">
              Ask Claude Code to write code, run commands, search your codebase, or explain concepts.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {STARTER_PROMPTS.map((s) => (
              <button
                key={s.label}
                onClick={() => onSendStarter?.(s.prompt)}
                className="flex items-center gap-2.5 rounded-xl border border-bot-border/60 bg-bot-elevated/50 px-4 py-3 text-left text-caption text-bot-text hover:bg-bot-elevated hover:border-bot-border transition-colors group"
              >
                <s.icon className="h-4 w-4 text-bot-muted group-hover:text-bot-accent transition-colors shrink-0" />
                <span>{s.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-center gap-4 text-[11px] text-bot-muted">
            <span className="flex items-center gap-1">
              <Slash className="h-3 w-3" />
              Type <kbd className="rounded bg-bot-elevated px-1 py-0.5 font-mono text-[10px]">/</kbd> for commands
            </span>
            <span className="opacity-30">|</span>
            <span className="flex items-center gap-1">
              Type <kbd className="rounded bg-bot-elevated px-1 py-0.5 font-mono text-[10px]">@</kbd> to reference files
            </span>
          </div>

          <div className="text-[10px] text-bot-muted/50 space-x-3">
            <span>Ctrl+/ focus input</span>
            <span>Ctrl+F search</span>
            <span>Ctrl+Shift+C copy last reply</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-4 select-text">
        <div className="mx-auto max-w-3xl px-4 space-y-1">
          {segments.map((seg, segIdx) => {
            if (seg.kind === "tool-group") {
              const groupKey = seg.messages[0].id;
              return (
                <ToolCallGroup
                  key={groupKey}
                  messages={seg.messages}
                  searchHighlights={searchHighlights}
                  activeHighlight={activeHighlight}
                />
              );
            }
            const msg = seg.message;
            const isLastMsg = segIdx === segments.length - 1;
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
                  onRetry={msg.parsed?.type === "error" && msg.parsed.retryable ? onRetry : undefined}
                  isLatest={isLastMsg && msg.id === messages[messages.length - 1]?.id}
                  isRunning={isRunning}
                  isInteractive={pendingInteraction?.messageId === msg.id}
                  avatarState={avatarState}
                />
              </div>
            );
          })}

          {/* Generic typing indicator when running but no text/streaming yet */}
          {isRunning && !currentActivity && (() => {
            const lastType = messages[messages.length - 1]?.parsed?.type;
            return lastType !== "streaming";
          })() && (
            <ThinkingBubble avatarState={avatarState} runStartTime={runStartTime} />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <ActivityStrip activity={currentActivity ?? null} isRunning={isRunning ?? false} runStartTime={runStartTime ?? null} />
    </div>
  );
}

"use client";

import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState } from "react";
import { Copy, Check, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import type { ParsedOutput } from "@/lib/claude/provider";
import { OptionsButtons } from "./options-buttons";
import { ConfirmButtons } from "./confirm-buttons";
import { DiffView } from "./diff-view";
import { PermissionCard } from "./permission-card";

interface Message {
  id: string;
  sender_type: "admin" | "claude";
  content?: string;
  parsed?: ParsedOutput;
  timestamp: string;
}

interface MessageItemProps {
  message: Message;
  onSelectOption?: (sessionId: string, choice: string) => void;
  onConfirm?: (sessionId: string, value: boolean) => void;
  onAllowTool?: (sessionId: string, toolName: string, scope: "session" | "once") => void;
  sessionId: string;
  isLatest?: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1 rounded text-bot-muted hover:text-bot-text transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function MessageItem({
  message,
  onSelectOption,
  onConfirm,
  onAllowTool,
  sessionId,
  isLatest,
}: MessageItemProps) {
  const isUser = message.sender_type === "admin";

  if (message.parsed) {
    const p = message.parsed;

    // Progress messages are handled by the ActivityStrip — skip rendering here
    if (p.type === "progress") {
      return null;
    }

    if (p.type === "done") {
      return (
        <div className="flex items-center gap-3 py-3 my-1">
          <div className="h-px flex-1 bg-bot-border/40" />
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-bot-muted">
            <CheckCircle2 className="h-3.5 w-3.5 text-bot-green" />
            <span className="opacity-70">Task complete</span>
            <span className="opacity-40">·</span>
            <span className="opacity-40">{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </span>
          <div className="h-px flex-1 bg-bot-border/40" />
        </div>
      );
    }

    if (p.type === "options" && p.choices) {
      return (
        <div className="py-1">
          <OptionsButtons
            choices={p.choices}
            onSelect={(choice) => onSelectOption?.(sessionId, String(p.choices!.indexOf(choice) + 1))}
            disabled={!isLatest}
          />
        </div>
      );
    }

    if (p.type === "confirm" && p.prompt) {
      return (
        <div className="py-1">
          <ConfirmButtons
            prompt={p.prompt}
            onConfirm={(value) => onConfirm?.(sessionId, value)}
            disabled={!isLatest}
          />
        </div>
      );
    }

    if (p.type === "diff") {
      return (
        <div className="py-1">
          <DiffView file={p.file} hunks={p.hunks} />
        </div>
      );
    }

    if (p.type === "permission_request" && p.toolName) {
      return (
        <div className="py-1">
          <PermissionCard
            toolName={p.toolName}
            toolInput={p.toolInput}
            sessionId={sessionId}
            onAllow={onAllowTool!}
            disabled={!isLatest}
          />
        </div>
      );
    }

    if (p.type === "error") {
      return (
        <div className="rounded-xl border border-bot-red/40 bg-bot-red/10 px-4 py-3 text-body text-bot-red my-1">
          {p.message}
        </div>
      );
    }
  }

  const isStreaming = message.parsed?.type === "streaming" && isLatest;
  const content = message.content ?? message.parsed?.content ?? "";
  const displayContent = isStreaming ? content + "\u258C" : content;

  if (isUser) {
    return (
      <div className="flex justify-end gap-2.5 py-1">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-bot-accent/20 px-4 py-2.5 text-body text-bot-text">
          <p className="whitespace-pre-wrap break-words">{displayContent}</p>
        </div>
        <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-bot-elevated flex items-center justify-center">
          <span className="text-caption font-semibold text-bot-muted">U</span>
        </div>
      </div>
    );
  }

  // Claude message
  return (
    <div className="flex gap-2.5 py-1">
      <div className="mt-1 h-7 w-7 shrink-0 rounded-full overflow-hidden">
        <Image unoptimized src="/claude-code.png" alt="Claude" width={28} height={28} className="object-cover" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl rounded-bl-sm bg-bot-elevated px-4 py-2.5 text-body text-bot-text max-w-[90%]">
        <ReactMarkdown
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className ?? "");
              const codeText = String(children).replace(/\n$/, "");
              if (match) {
                return (
                  <div className="relative group my-2">
                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <CopyButton text={codeText} />
                    </div>
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      className="!rounded-lg text-caption"
                    >
                      {codeText}
                    </SyntaxHighlighter>
                  </div>
                );
              }
              return (
                <code
                  className="rounded bg-bot-surface px-1.5 py-0.5 font-mono text-caption text-bot-accent"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            p({ children }) {
              return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
            },
            ul({ children }) {
              return <ul className="mb-2 list-disc pl-4 space-y-1">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="mb-2 list-decimal pl-4 space-y-1">{children}</ol>;
            },
            h1({ children }) {
              return <h1 className="text-subtitle font-semibold mb-2 mt-3 first:mt-0">{children}</h1>;
            },
            h2({ children }) {
              return <h2 className="text-body font-semibold mb-1.5 mt-3 first:mt-0">{children}</h2>;
            },
            h3({ children }) {
              return <h3 className="text-body font-medium mb-1 mt-2 first:mt-0">{children}</h3>;
            },
            blockquote({ children }) {
              return (
                <blockquote className="border-l-2 border-bot-border pl-3 my-2 text-bot-muted">
                  {children}
                </blockquote>
              );
            },
          }}
        >
          {displayContent}
        </ReactMarkdown>
        {message.parsed?.type === "text" && (
          <div className="mt-1 text-right">
            <span className="text-[10px] text-bot-muted opacity-40">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

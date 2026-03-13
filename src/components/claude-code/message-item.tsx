"use client";

import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState } from "react";
import { Copy, Check, CheckCircle2, Pencil, Trash2, X, FileText } from "lucide-react";
import Image from "next/image";
import type { ParsedOutput } from "@/lib/claude/provider";
import { getAvatarPath, type AvatarState } from "@/lib/avatar-state";
import { OptionsButtons } from "./options-buttons";
import { ConfirmButtons } from "./confirm-buttons";
import { DiffView } from "./diff-view";
import { PermissionCard } from "./permission-card";
import { ToolCallBlock } from "./tool-call-block";

interface Message {
  id: string;
  sender_type: "admin" | "claude";
  content?: string;
  parsed?: ParsedOutput;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface MessageItemProps {
  message: Message;
  onSelectOption?: (sessionId: string, choice: string) => void;
  onConfirm?: (sessionId: string, value: boolean) => void;
  onAllowTool?: (sessionId: string, toolName: string, scope: "session" | "once") => void;
  onAlwaysAllow?: (sessionId: string, toolName: string, command: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onDelete?: (messageId: string) => void;
  sessionId: string;
  isLatest?: boolean;
  isRunning?: boolean;
  isInteractive?: boolean;
  avatarState?: AvatarState;
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

function TokenBadge({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata?.usage) return null;
  const usage = metadata.usage as { input_tokens?: number; output_tokens?: number; cost_usd?: number };
  const inp = usage.input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  if (inp === 0 && out === 0) return null;

  const cost = usage.cost_usd ?? 0;
  return (
    <span
      className="text-[10px] font-mono text-bot-muted opacity-50"
      title={`Input: ${inp} | Output: ${out}${cost > 0 ? ` | $${cost.toFixed(4)}` : ""}`}
    >
      {inp.toLocaleString()} in / {out.toLocaleString()} out
      {cost > 0 && ` ($${cost.toFixed(3)})`}
    </span>
  );
}

export function MessageItem({
  message,
  onSelectOption,
  onConfirm,
  onAllowTool,
  onAlwaysAllow,
  onEdit,
  onDelete,
  sessionId,
  isLatest,
  isRunning,
  isInteractive,
  avatarState,
}: MessageItemProps) {
  const isUser = message.sender_type === "admin";
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isHovered, setIsHovered] = useState(false);

  if (message.parsed) {
    const p = message.parsed;

    // Progress messages are handled by the ActivityStrip — skip rendering here
    if (p.type === "progress") {
      return null;
    }

    // Usage events are handled internally — skip rendering
    if (p.type === "usage") {
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
            disabled={!isInteractive}
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
            disabled={!isInteractive}
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

    if (p.type === "security_warn") {
      return (
        <div className="rounded-xl border border-bot-red/40 bg-bot-red/10 px-4 py-3 text-body text-bot-red my-1 flex items-start gap-2">
          <span className="shrink-0 text-lg">🛡</span>
          <div>
            <span className="font-semibold">Security:</span> {p.message}
          </div>
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
            onAlwaysAllow={onAlwaysAllow}
            disabled={!isInteractive}
            sandboxCategory={p.sandboxCategory}
            sandboxReason={p.sandboxReason}
          />
        </div>
      );
    }

    if (p.type === "tool_call" || p.type === "tool_result") {
      return (
        <div className="py-0.5">
          <ToolCallBlock parsed={p} />
        </div>
      );
    }

    if (p.type === "error") {
      return (
        <div className="rounded-xl border border-bot-red/40 bg-bot-red/10 px-4 py-3 text-body text-bot-red my-1">
          {p.message}
          {p.retryable && (
            <span className="ml-2 text-caption opacity-70">(retryable)</span>
          )}
        </div>
      );
    }
  }

  const isStreaming = message.parsed?.type === "streaming" && isLatest;
  const content = message.content ?? message.parsed?.content ?? "";
  const displayContent = isStreaming ? content + "\u258C" : content;
  const canEdit = isUser && onEdit && !isRunning;
  const canDelete = onDelete && !isRunning;

  // Render attachment badges for messages with attachments
  const attachmentIds = (message.metadata?.attachments as string[] | undefined) ?? [];
  const imageAttachments = (message.metadata?.imageAttachments as { id: string; name: string; mime_type: string }[] | undefined) ?? [];

  if (isUser) {
    if (isEditing) {
      return (
        <div className="flex justify-end gap-2.5 py-1">
          <div className="max-w-[75%] w-full">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full rounded-2xl rounded-tr-sm bg-bot-accent/20 px-4 py-2.5 text-body text-bot-text outline-none border border-bot-accent/40 resize-none"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  if (editContent.trim()) {
                    onEdit?.(message.id, editContent.trim());
                    setIsEditing(false);
                  }
                }
                if (e.key === "Escape") setIsEditing(false);
              }}
            />
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => setIsEditing(false)}
                className="rounded-md px-2 py-1 text-caption text-bot-muted hover:bg-bot-elevated transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => {
                  if (editContent.trim()) {
                    onEdit?.(message.id, editContent.trim());
                    setIsEditing(false);
                  }
                }}
                className="rounded-md bg-bot-accent px-3 py-1 text-caption font-medium text-white hover:bg-bot-accent/80 transition-colors"
              >
                Save & Resend
              </button>
            </div>
          </div>
          <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-bot-elevated flex items-center justify-center">
            <span className="text-caption font-semibold text-bot-muted">U</span>
          </div>
        </div>
      );
    }

    return (
      <div
        className="flex justify-end gap-2.5 py-1 group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {isHovered && !isRunning && (
          <div className="flex items-center gap-0.5 self-center opacity-0 group-hover:opacity-100 transition-opacity">
            {canEdit && (
              <button
                onClick={() => {
                  setEditContent(content);
                  setIsEditing(true);
                }}
                className="rounded p-1 text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors"
                title="Edit message"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => onDelete?.(message.id)}
                className="rounded p-1 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-colors"
                title="Delete message"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-bot-accent/20 px-4 py-2.5 text-body text-bot-text">
          {imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {imageAttachments.map((img) => (
                <a
                  key={img.id}
                  href={`/api/claude-code/upload/${img.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg overflow-hidden border border-bot-border hover:border-bot-accent transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/claude-code/upload/${img.id}`}
                    alt={img.name}
                    className="max-w-[200px] max-h-[150px] object-cover"
                  />
                </a>
              ))}
            </div>
          )}
          {attachmentIds.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {attachmentIds.filter((id) => !imageAttachments.some((img) => img.id === id)).map((id) => (
                <a
                  key={id}
                  href={`/api/claude-code/upload/${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-bot-accent/10 px-1.5 py-0.5 text-[10px] font-mono text-bot-accent hover:bg-bot-accent/20 transition-colors"
                >
                  <FileText className="h-2.5 w-2.5" />
                  attachment
                </a>
              ))}
            </div>
          )}
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
    <div
      className="flex gap-2.5 py-1 group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="mt-1 h-7 w-7 shrink-0 rounded-full overflow-hidden">
        <Image unoptimized src={getAvatarPath((isLatest && isRunning) ? (avatarState ?? "waiting") : "waiting")} alt="Claude" width={28} height={28} className="object-cover" />
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
          <div className="mt-1 flex items-center justify-between">
            <TokenBadge metadata={message.metadata} />
            <span className="text-[10px] text-bot-muted opacity-40">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}
      </div>
      {isHovered && canDelete && !isRunning && (
        <div className="flex items-center self-center opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onDelete?.(message.id)}
            className="rounded p-1 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-colors"
            title="Delete message"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

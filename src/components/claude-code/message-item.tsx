"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState, memo } from "react";
import { Copy, Check, CheckCircle2, Pencil, Trash2, FileText, ExternalLink, RotateCcw } from "lucide-react";
import { apiUrl } from "@/lib/utils";
import { OptionsButtons } from "./options-buttons";
import { ConfirmButtons } from "./confirm-buttons";
import { DiffView } from "./diff-view";
import { PermissionCard } from "./permission-card";
import { ToolCallBlock } from "./tool-call-block";
import { UserQuestionCard } from "./user-question-card";
import type { ChatMessage } from "@/types/chat";

export interface UserDisplayInfo {
  initials: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface MessageItemProps {
  message: ChatMessage;
  onSelectOption?: (sessionId: string, choice: string) => void;
  onConfirm?: (sessionId: string, value: boolean) => void;
  onAllowTool?: (sessionId: string, toolName: string, scope: "session" | "once", toolCallId?: string, messageId?: string) => void;
  onAlwaysAllow?: (sessionId: string, toolName: string, command: string, toolCallId?: string, messageId?: string) => void;
  onAnswerQuestion?: (sessionId: string, answer: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onDelete?: (messageId: string) => void;
  onRetry?: () => void;
  sessionId: string;
  isLatest?: boolean;
  isRunning?: boolean;
  isInteractive?: boolean;
  botAvatarUrl?: string | null;
  experienceLevel?: string;
  userInfo?: UserDisplayInfo;
  aiPaused?: boolean;
}

function CopyButton({ text, size = "sm" }: { text: string; size?: "sm" | "xs" }) {
  const [copied, setCopied] = useState(false);
  const iconClass = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1.5 rounded-lg text-bot-muted hover:text-bot-text hover:bg-bot-elevated/60 transition-all duration-200"
      title={copied ? "Copied!" : "Copy"}
      aria-label={copied ? "Copied" : "Copy"}
    >
      {copied ? <Check className={`${iconClass} text-bot-green`} /> : <Copy className={iconClass} />}
    </button>
  );
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateUrl(url: string, maxLen = 60): string {
  if (url.length <= maxLen) return url;
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const available = maxLen - u.origin.length - 3;
    if (available > 10) {
      return u.origin + path.slice(0, available) + "...";
    }
  } catch { /* not a valid URL, just truncate */ }
  return url.slice(0, maxLen - 3) + "...";
}

const REMARK_PLUGINS = [remarkGfm];

const sharedMarkdownComponents: Components = {
  a({ href, children }) {
    const url = href ?? "";
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-bot-blue hover:text-bot-blue/80 underline underline-offset-2 decoration-bot-blue/40 hover:decoration-bot-blue/70 transition-colors inline-flex items-baseline gap-0.5 break-all"
        title={url}
      >
        {children ?? truncateUrl(url)}
        <ExternalLink className="inline h-3 w-3 shrink-0 translate-y-[1px]" />
      </a>
    );
  },
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const codeText = String(children).replace(/\n$/, "");
    if (match) {
      return (
        <div className="relative group/code my-3 rounded-xl overflow-hidden border border-bot-border/30 shadow-elevated">
          <div className="flex items-center justify-between px-4 py-2 bg-bot-elevated/80 border-b border-bot-border/30">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-bot-red/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-bot-amber/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-bot-green/40" />
              </div>
              <span className="text-[10px] font-mono text-bot-muted uppercase tracking-wider">{match[1]}</span>
            </div>
            <CopyButton text={codeText} />
          </div>
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={match[1]}
            PreTag="div"
            className="!rounded-none !rounded-b-xl !mt-0"
            customStyle={{ fontSize: "0.75rem", lineHeight: "1.35rem", margin: 0, background: "rgb(var(--bot-bg))" }}
            showLineNumbers={codeText.split("\n").length > 5}
            lineNumberStyle={{ color: "rgb(var(--bot-muted) / 0.3)", fontSize: "11px", paddingRight: "1em", userSelect: "none" }}
          >
            {codeText}
          </SyntaxHighlighter>
        </div>
      );
    }
    return (
      <code
        className="rounded-md bg-bot-bg/60 px-1.5 py-0.5 font-mono text-caption text-bot-accent border border-bot-border/20"
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
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  h1({ children }) {
    return <h1 className="text-subtitle font-bold mb-2 mt-3 first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-body font-semibold mb-1.5 mt-3 first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-body font-medium mb-1 mt-2 first:mt-0">{children}</h3>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-bot-accent/40 pl-3 my-2 text-bot-muted italic">
        {children}
      </blockquote>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-xl border border-bot-border/30 shadow-elevated">
        <table className="min-w-full text-caption">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-bot-elevated/60">{children}</thead>;
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-bot-border/20">{children}</tbody>;
  },
  tr({ children }) {
    return <tr className="hover:bg-bot-elevated/30 transition-colors">{children}</tr>;
  },
  th({ children }) {
    return <th className="px-3 py-2 text-left font-semibold text-bot-text border-b border-bot-border/30">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-2 text-bot-text">{children}</td>;
  },
  del({ children }) {
    return <del className="text-bot-muted line-through">{children}</del>;
  },
  input({ checked, ...props }) {
    return (
      <input
        type="checkbox"
        checked={checked}
        disabled
        className="mr-1.5 accent-bot-accent"
        {...props}
      />
    );
  },
  hr() {
    return <hr className="my-3 border-bot-border/20" />;
  },
};

function TokenBadge({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata?.usage) return null;
  const usage = metadata.usage as { input_tokens?: number; output_tokens?: number; cost_usd?: number };
  const inp = usage.input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  if (inp === 0 && out === 0) return null;

  const cost = usage.cost_usd ?? 0;
  return (
    <span
      className="text-[10px] font-mono text-bot-muted/50"
      title={`Input: ${inp} | Output: ${out}${cost > 0 ? ` | $${cost.toFixed(4)}` : ""}`}
    >
      {inp.toLocaleString()} in / {out.toLocaleString()} out
      {cost > 0 && ` ($${cost.toFixed(3)})`}
    </span>
  );
}

function UserAvatar({ initials, displayName, avatarUrl }: { initials: string; displayName: string; avatarUrl?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <div className="mt-1 h-8 w-8 rounded-full bg-bot-accent/20 flex items-center justify-center border border-bot-accent/30 overflow-hidden">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] font-semibold text-bot-accent uppercase leading-none">{initials}</span>
        )}
      </div>
      {displayName && (
        <span className="text-[9px] text-bot-muted/60 max-w-[3rem] truncate leading-none" title={displayName}>
          {displayName}
        </span>
      )}
    </div>
  );
}

export const MessageItem = memo(function MessageItem({
  message,
  onSelectOption,
  onConfirm,
  onAllowTool,
  onAlwaysAllow,
  onAnswerQuestion,
  onEdit,
  onDelete,
  onRetry,
  sessionId,
  isLatest,
  isRunning,
  isInteractive,
  botAvatarUrl,
  experienceLevel,
  userInfo,
  aiPaused,
}: MessageItemProps) {
  const isUser = message.sender_type === "admin";
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  const senderEmail = message.sender_id ?? "";
  const fallbackInitial = (senderEmail.split("@")[0]?.[0] ?? "?").toUpperCase();
  const fallbackName = senderEmail.split("@")[0] ?? "";
  const displayInitials = userInfo?.initials || fallbackInitial;
  const displayName = userInfo?.displayName || fallbackName;
  const userAvatarUrl = userInfo?.avatarUrl;


  if (message.parsed) {
    const p = message.parsed;

    if (p.type === "progress") {
      return null;
    }

    if (p.type === "usage") {
      return null;
    }

    if (p.type === "done") {
      return (
        <div className="flex items-center gap-3 py-3 my-1">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-bot-border/40 to-transparent" />
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-bot-muted">
            <CheckCircle2 className="h-3.5 w-3.5 text-bot-green" />
            <span className="opacity-70">Task complete</span>
            <span className="opacity-30">·</span>
            <span className="opacity-30">{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-bot-border/40 to-transparent" />
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
        <div className="rounded-xl border border-bot-red/30 bg-bot-red/5 px-4 py-3 text-body text-bot-red my-1 flex items-start gap-2 shadow-elevated">
          <span className="shrink-0 text-lg">🛡</span>
          <div>
            <span className="font-semibold">Security:</span> {p.message}
          </div>
        </div>
      );
    }

    if (p.type === "user_question" && p.questions && p.questions.length > 0) {
      return (
        <div className="py-1">
          <UserQuestionCard
            questions={p.questions}
            sessionId={sessionId}
            onAnswer={onAnswerQuestion!}
            disabled={!isInteractive}
          />
        </div>
      );
    }

    if (p.type === "permission_request" && p.toolName) {
      return (
        <div className="py-1">
          <PermissionCard
            toolName={p.toolName}
            toolInput={p.toolInput}
            toolCallId={p.toolCallId}
            sessionId={sessionId}
            messageId={message.id}
            onAllow={onAllowTool!}
            onAlwaysAllow={onAlwaysAllow}
            disabled={!isInteractive}
            sandboxCategory={p.sandboxCategory}
            sandboxReason={p.sandboxReason}
            experienceLevel={experienceLevel}
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
        <div className="rounded-xl border border-bot-red/30 bg-bot-red/5 px-4 py-3 text-body text-bot-red my-1 shadow-elevated">
          <div className="flex items-center justify-between gap-3">
            <span>
              {p.message}
            </span>
            {p.retryable && onRetry && !isRunning && (
              <button
                onClick={onRetry}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-bot-red/30 bg-bot-red/10 px-3 py-1.5 text-caption font-medium text-bot-red hover:bg-bot-red/20 transition-all duration-200"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}
          </div>
        </div>
      );
    }
  }

  const isStreaming = message.parsed?.type === "streaming" && isLatest && !aiPaused;
  const content = message.content ?? message.parsed?.content ?? "";
  // Don't append cursor to the markdown string — it can corrupt code fences mid-stream.
  // Render it as a separate element after ReactMarkdown instead.
  const displayContent = content;
  const canEdit = isUser && onEdit && !isRunning;
  const canDelete = onDelete && !isRunning;

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
              className="w-full rounded-2xl rounded-tr-sm bg-bot-accent/10 px-4 py-3 text-body text-bot-text outline-none border border-bot-accent/30 focus:border-bot-accent focus:shadow-glow-sm resize-none transition-all duration-200"
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
            <div className="flex justify-end gap-2 mt-1.5">
              <button
                onClick={() => setIsEditing(false)}
                className="rounded-lg px-3 py-1.5 text-caption text-bot-muted hover:bg-bot-elevated/60 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editContent.trim()) {
                    onEdit?.(message.id, editContent.trim());
                    setIsEditing(false);
                  }
                }}
                className="rounded-lg gradient-accent px-3 py-1.5 text-caption font-medium text-white shadow-glow-sm hover:shadow-glow-md transition-all duration-200"
              >
                Save & Resend
              </button>
            </div>
          </div>
          <UserAvatar initials={displayInitials} displayName={displayName} avatarUrl={userAvatarUrl} />
        </div>
      );
    }

    return (
      <div className="flex justify-end gap-2.5 py-1 group">
        {!isRunning && (
          <div className="flex items-center gap-0.5 self-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
            <CopyButton text={content} size="xs" />
            {canEdit && (
              <button
                onClick={() => {
                  setEditContent(content);
                  setIsEditing(true);
                }}
                className="rounded-lg p-1.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated/60 transition-all duration-200"
                title="Edit message"
                aria-label="Edit message"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => onDelete?.(message.id)}
                className="rounded-lg p-1.5 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-all duration-200"
                title="Delete message"
                aria-label="Delete message"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-tr-sm bg-bot-accent/10 border border-bot-accent/15 px-4 py-3 text-body text-bot-text shadow-elevated">
            {imageAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {imageAttachments.map((img) => (
                  <a
                    key={img.id}
                    href={apiUrl(`/api/claude-code/upload/${img.id}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl overflow-hidden border border-bot-border/30 hover:border-bot-accent/40 hover:shadow-glow-sm transition-all duration-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={apiUrl(`/api/claude-code/upload/${img.id}`)}
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
                    href={apiUrl(`/api/claude-code/upload/${id}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-bot-accent/10 px-2 py-1 text-[10px] font-mono text-bot-accent hover:bg-bot-accent/20 transition-all duration-200"
                  >
                    <FileText className="h-2.5 w-2.5" />
                    attachment
                  </a>
                ))}
              </div>
            )}
            <div className="break-words [&_p]:mb-1 [&_p:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={sharedMarkdownComponents}>
                {displayContent}
              </ReactMarkdown>
              {isStreaming && <span className="inline-block text-bot-accent animate-pulse ml-0.5">{"\u258C"}</span>}
            </div>
          </div>
          <div className="mt-0.5 text-right opacity-0 group-hover:opacity-100 transition-all duration-200">
            <span className="text-[10px] text-bot-muted/60">
              {formatTimestamp(message.timestamp)}
            </span>
          </div>
        </div>
        <UserAvatar initials={displayInitials} displayName={displayName} avatarUrl={userAvatarUrl} />
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 py-1 group">
      <div className="mt-1 h-8 w-8 shrink-0 rounded-full overflow-hidden ring-1 ring-bot-border/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={botAvatarUrl || apiUrl("/avatars/waiting.png")} alt="Octoby" className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1 max-w-[90%]">
        <div className="rounded-2xl rounded-bl-sm glass px-4 py-3 text-body text-bot-text shadow-elevated">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={sharedMarkdownComponents}>
            {displayContent}
          </ReactMarkdown>
          {isStreaming && <span className="inline-block text-bot-accent animate-pulse ml-0.5">{"\u258C"}</span>}
          {message.parsed?.type === "text" && (
            <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-bot-border/15">
              <TokenBadge metadata={message.metadata} />
              <span className="text-[10px] text-bot-muted/40">
                {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          )}
        </div>
        {message.parsed?.type !== "text" && (
          <div className="mt-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
            <span className="text-[10px] text-bot-muted/60">
              {formatTimestamp(message.timestamp)}
            </span>
          </div>
        )}
      </div>
      {!isRunning && (
        <div className="flex flex-col items-center gap-0.5 self-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-200 -translate-x-2 group-hover:translate-x-0">
          <CopyButton text={content} size="xs" />
          {canDelete && (
            <button
              onClick={() => onDelete?.(message.id)}
              className="rounded-lg p-1.5 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-all duration-200"
              title="Delete message"
              aria-label="Delete message"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

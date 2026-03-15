"use client";

import { useState, useEffect, useRef, memo } from "react";
import { ChevronDown, ChevronRight, Terminal, FileText, FilePen, Search, Loader2, Check, X, Wrench, Plug } from "lucide-react";
import type { ParsedOutput } from "@/lib/claude/provider";
import { BashOutput } from "./tool-renderers/bash-output";
import { FileReadOutput } from "./tool-renderers/file-read-output";
import { FileWriteOutput } from "./tool-renderers/file-write-output";
import { SearchOutput } from "./tool-renderers/search-output";

interface ToolCallBlockProps {
  parsed: ParsedOutput;
}

function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

function formatMcpToolName(name: string): string {
  const parts = name.replace(/^mcp__/, "").split("__");
  return parts.join(" > ");
}

function inferToolName(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  if ("command" in input) return "Bash";
  if ("pattern" in input && ("path" in input || "glob" in input)) return "Grep";
  if ("glob_pattern" in input) return "Glob";
  if ("old_string" in input && "new_string" in input) return "Edit";
  if ("file_path" in input && "content" in input) return "Write";
  if ("file_path" in input) return "Read";
  return null;
}

function resolveToolName(parsed: ParsedOutput): string {
  const name = parsed.toolName;
  if (name && name !== "unknown") return name;
  const input = parsed.toolInput as Record<string, unknown> | undefined;
  return inferToolName(input) ?? "Tool";
}

function getToolIcon(name: string) {
  if (isMcpTool(name)) return <Plug className="h-3.5 w-3.5" />;
  switch (name) {
    case "Bash": return <Terminal className="h-3.5 w-3.5" />;
    case "Read": return <FileText className="h-3.5 w-3.5" />;
    case "Write":
    case "Edit": return <FilePen className="h-3.5 w-3.5" />;
    case "Glob":
    case "Grep": return <Search className="h-3.5 w-3.5" />;
    default: return <Wrench className="h-3.5 w-3.5" />;
  }
}

function StatusBadge({ status }: { status?: string }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-bot-accent" />;
  }
  if (status === "error") {
    return <X className="h-3.5 w-3.5 text-bot-red" />;
  }
  return <Check className="h-3.5 w-3.5 text-bot-green" />;
}

const SDK_CONFIRMATION_RE = /^The file .+ has been (updated|created|written) successfully\.?$/;
const STACK_TRACE_RE = /\n\s+at\s+\S/;

function sanitizeResult(result: string | undefined): string | null {
  if (!result) return null;
  if (SDK_CONFIRMATION_RE.test(result.trim())) return null;
  if (result.trim() === "Interrupted") return null;
  if (STACK_TRACE_RE.test(result)) {
    return result.split("\n")[0] || result;
  }
  return result;
}

function ToolDetail({ parsed }: { parsed: ParsedOutput }) {
  const toolName = resolveToolName(parsed);
  const input = parsed.toolInput as Record<string, unknown> | undefined;
  const result = parsed.toolResult;
  const exitCode = parsed.exitCode;

  if (toolName === "Bash") {
    return <BashOutput command={String(input?.command ?? "")} output={result} exitCode={exitCode} />;
  }
  if (toolName === "Read") {
    return <FileReadOutput filePath={String(input?.file_path ?? "")} content={result} />;
  }
  if (toolName === "Write" || toolName === "Edit") {
    const isEdit = toolName === "Edit";
    return (
      <FileWriteOutput
        filePath={String(input?.file_path ?? "")}
        content={isEdit ? undefined : result}
        oldString={isEdit ? String(input?.old_string ?? "") : undefined}
        newString={isEdit ? String(input?.new_string ?? "") : undefined}
        isEdit={isEdit}
      />
    );
  }
  if (toolName === "Glob" || toolName === "Grep") {
    return (
      <SearchOutput
        toolName={toolName}
        pattern={String(input?.pattern ?? "")}
        path={String(input?.path ?? "")}
        result={result}
      />
    );
  }

  const cleanResult = sanitizeResult(result);

  if (cleanResult) {
    return (
      <div className="p-3 bg-bot-bg/40 rounded-lg">
        <pre className="text-caption font-mono text-bot-text whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
          {cleanResult}
        </pre>
      </div>
    );
  }

  if (input) {
    return (
      <div className="p-3 bg-bot-bg/40 rounded-lg">
        <pre className="text-caption font-mono text-bot-muted whitespace-pre-wrap break-words">
          {JSON.stringify(input, null, 2)}
        </pre>
      </div>
    );
  }

  return null;
}

export const ToolCallBlock = memo(function ToolCallBlock({ parsed }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(parsed.toolStatus !== "running");
  const prevStatus = useRef(parsed.toolStatus);

  useEffect(() => {
    if (prevStatus.current === "running" && parsed.toolStatus !== "running") {
      setExpanded(true);
    }
    prevStatus.current = parsed.toolStatus;
  }, [parsed.toolStatus]);

  const rawToolName = resolveToolName(parsed);
  const toolName = isMcpTool(rawToolName) ? formatMcpToolName(rawToolName) : rawToolName;
  const hasDetail = !!(sanitizeResult(parsed.toolResult) || parsed.toolInput);

  return (
    <div className="my-1 rounded-xl border border-bot-border/20 bg-bot-elevated/30 backdrop-blur-sm overflow-hidden transition-all duration-200 hover:border-bot-border/40">
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3.5 py-2.5 text-left hover:bg-bot-surface/30 transition-all duration-200"
      >
        {hasDetail ? (
          expanded ? <ChevronDown className="h-3 w-3 text-bot-muted shrink-0" /> : <ChevronRight className="h-3 w-3 text-bot-muted shrink-0" />
        ) : (
          <span className="w-3" />
        )}
        <span className="text-bot-accent/60">{getToolIcon(rawToolName)}</span>
        <span className="text-caption font-mono font-medium text-bot-text">{toolName}</span>
        {parsed.toolInput && typeof parsed.toolInput === "object" && !!(parsed.toolInput as Record<string, unknown>).command ? (
          <span className="text-[11px] font-mono text-bot-muted/60 truncate max-w-[300px]">
            $ {String((parsed.toolInput as Record<string, unknown>).command).slice(0, 60)}
          </span>
        ) : null}
        {parsed.toolInput && typeof parsed.toolInput === "object" && !!(parsed.toolInput as Record<string, unknown>).file_path && !(parsed.toolInput as Record<string, unknown>).command ? (
          <span className="text-[11px] font-mono text-bot-muted/60 truncate max-w-[300px]">
            {String((parsed.toolInput as Record<string, unknown>).file_path)}
          </span>
        ) : null}
        <span className="ml-auto shrink-0">
          <StatusBadge status={parsed.toolStatus} />
        </span>
      </button>
      {expanded && hasDetail ? (
        <div className="border-t border-bot-border/15 px-3.5 py-2.5">
          <ToolDetail parsed={parsed} />
        </div>
      ) : null}
    </div>
  );
});

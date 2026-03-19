"use client";

import { X, Loader2, CheckCircle2, XCircle, Terminal, FileText, Search, Globe, Code, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

interface SubAgentActivity {
  toolName: string;
  toolCallId: string;
  status: "running" | "done" | "error";
}

interface SubAgentInfo {
  id: string;
  agentName: string;
  agentIcon: string | null;
  task: string;
  status: "running" | "complete" | "error";
  error?: string;
  currentActivity?: string;
  activityLog?: SubAgentActivity[];
}

interface SubAgentDrawerProps {
  agent: SubAgentInfo | null;
  onClose: () => void;
}

function getToolIcon(toolName: string) {
  const lower = toolName.toLowerCase();
  if (lower.includes("bash") || lower.includes("shell")) return <Terminal className="h-3 w-3" />;
  if (lower.includes("read") || lower.includes("write") || lower.includes("edit") || lower.includes("strreplace"))
    return <FileText className="h-3 w-3" />;
  if (lower.includes("glob") || lower.includes("grep") || lower.includes("search"))
    return <Search className="h-3 w-3" />;
  if (lower.includes("webfetch") || lower.includes("websearch"))
    return <Globe className="h-3 w-3" />;
  if (lower.includes("delegate") || lower.includes("agent"))
    return <Code className="h-3 w-3" />;
  return <Wrench className="h-3 w-3" />;
}

function StatusIcon({ status }: { status: SubAgentActivity["status"] }) {
  if (status === "running") return <Loader2 className="h-3 w-3 animate-spin text-bot-accent" />;
  if (status === "error") return <XCircle className="h-3 w-3 text-bot-red" />;
  return <CheckCircle2 className="h-3 w-3 text-bot-green" />;
}

function friendlyToolName(toolName: string): string {
  const stripped = toolName.includes("__") ? toolName.split("__").pop()! : toolName;
  return stripped.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function SubAgentDrawer({ agent, onClose }: SubAgentDrawerProps) {
  if (!agent) {
    onClose();
    return null;
  }

  const log = agent.activityLog ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-bot-bg border-l border-bot-border/30 shadow-2xl flex flex-col animate-slideInRight"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bot-border/30 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl flex-shrink-0">{agent.agentIcon ?? "🤖"}</span>
            <div className="min-w-0">
              <h2 className="text-body font-bold text-bot-text truncate">{agent.agentName}</h2>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  agent.status === "running" && "bg-bot-accent/10 text-bot-accent",
                  agent.status === "error" && "bg-bot-red/10 text-bot-red",
                  agent.status === "complete" && "bg-bot-green/10 text-bot-green",
                )}
              >
                {agent.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {agent.status === "error" && <XCircle className="h-2.5 w-2.5" />}
                {agent.status === "complete" && <CheckCircle2 className="h-2.5 w-2.5" />}
                {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated/40 hover:text-bot-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Task */}
        <div className="border-b border-bot-border/20 px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-bot-muted/70 font-semibold mb-1">Task</p>
          <p className="text-caption text-bot-text/80 line-clamp-3">{agent.task}</p>
        </div>

        {/* Activity Log */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-bot-muted/70 font-semibold mb-2">
            Activity ({log.length})
          </p>
          {log.length === 0 ? (
            <p className="text-caption text-bot-muted/50 italic">No tool calls yet…</p>
          ) : (
            <div className="flex flex-col gap-1">
              {log.map((activity, i) => (
                <div
                  key={`${activity.toolCallId}-${i}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-caption",
                    activity.status === "running" && "bg-bot-accent/5",
                    activity.status === "error" && "bg-bot-red/5",
                    activity.status === "done" && "bg-bot-surface/40",
                  )}
                >
                  <span className="text-bot-muted/60 flex-shrink-0">{getToolIcon(activity.toolName)}</span>
                  <span className={cn(
                    "truncate",
                    activity.status === "running" ? "text-bot-text" : "text-bot-muted",
                  )}>
                    {friendlyToolName(activity.toolName)}
                  </span>
                  <span className="ml-auto flex-shrink-0">
                    <StatusIcon status={activity.status} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {agent.error && (
          <div className="border-t border-bot-red/20 px-5 py-3 bg-bot-red/5">
            <p className="text-[10px] uppercase tracking-wider text-bot-red/70 font-semibold mb-1">Error</p>
            <p className="text-caption text-bot-red/80">{agent.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

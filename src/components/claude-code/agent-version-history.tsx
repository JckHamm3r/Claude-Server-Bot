"use client";

import { useState } from "react";
import { X, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeAgent, ClaudeAgentVersion } from "@/lib/claude-db";

interface AgentVersionHistoryProps {
  agent: ClaudeAgent;
  versions: ClaudeAgentVersion[];
  onClose: () => void;
  onRollback: (version: ClaudeAgentVersion) => void;
}

export function AgentVersionHistory({
  agent,
  versions,
  onClose,
  onRollback,
}: AgentVersionHistoryProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative flex w-full max-w-xl flex-col rounded-2xl border border-bot-border bg-bot-surface shadow-xl max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bot-border px-6 py-4 shrink-0">
          <div>
            <h2 className="text-subtitle font-semibold text-bot-text">
              Version History
            </h2>
            <p className="text-caption text-bot-muted mt-0.5">
              {agent.icon ?? "🤖"} {agent.name} — {versions.length} version{versions.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated hover:text-bot-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto py-2">
          {versions.length === 0 ? (
            <p className="px-6 py-8 text-center text-body text-bot-muted">
              No versions recorded yet.
            </p>
          ) : (
            versions.map((version) => {
              const isCurrent = version.version_number === agent.current_version;
              const isExpanded = expandedIds.has(version.id);

              return (
                <div
                  key={version.id}
                  className={cn(
                    "border-b border-bot-border last:border-b-0",
                    isCurrent && "bg-bot-accent/5",
                  )}
                >
                  {/* Version header row */}
                  <div className="flex items-center gap-3 px-6 py-3">
                    {/* Version badge */}
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-semibold shrink-0",
                        isCurrent
                          ? "bg-bot-accent/20 text-bot-accent"
                          : "bg-bot-elevated text-bot-muted",
                      )}
                    >
                      v{version.version_number}
                      {isCurrent && (
                        <span className="ml-1 text-caption font-normal">(current)</span>
                      )}
                    </span>

                    {/* Change description + timestamp */}
                    <div className="flex-1 min-w-0">
                      <p className="text-body text-bot-text truncate">
                        {version.change_description ?? "No description"}
                      </p>
                      <p className="text-caption text-bot-muted">
                        {new Date(version.created_at).toLocaleString()} · by {version.created_by}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Expand config */}
                      <button
                        onClick={() => toggleExpand(version.id)}
                        title="View config snapshot"
                        className="flex items-center justify-center rounded p-1.5 text-bot-muted hover:bg-bot-elevated hover:text-bot-text transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>

                      {/* Rollback */}
                      {!isCurrent && (
                        <button
                          onClick={() => onRollback(version)}
                          title="Rollback to this version"
                          className="flex items-center gap-1.5 rounded-md border border-bot-border px-2.5 py-1 text-caption font-medium text-bot-muted hover:border-bot-accent/50 hover:bg-bot-accent/5 hover:text-bot-accent transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Rollback
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded config snapshot */}
                  {isExpanded && (
                    <div className="px-6 pb-4">
                      <div className="rounded-lg border border-bot-border bg-bot-elevated overflow-auto max-h-64">
                        <pre className="p-3 text-caption font-mono text-bot-muted whitespace-pre-wrap">
                          {JSON.stringify(version.config_snapshot, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-bot-border px-6 py-3 shrink-0">
          <button
            onClick={onClose}
            className="rounded-lg border border-bot-border px-4 py-2 text-body text-bot-muted hover:bg-bot-elevated hover:text-bot-text transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

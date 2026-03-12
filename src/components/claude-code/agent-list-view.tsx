"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Archive, History, Power, PowerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeAgent } from "@/lib/claude-db";

type StatusFilter = "all" | "active" | "disabled" | "archived";

interface AgentListViewProps {
  agents: ClaudeAgent[];
  onEdit: (agent: ClaudeAgent) => void;
  onDelete: (agentId: string) => void;
  onToggleStatus: (agent: ClaudeAgent) => void;
  onArchive: (agentId: string) => void;
  onViewVersions: (agent: ClaudeAgent) => void;
  onNew: () => void;
}

function StatusBadge({ status }: { status: ClaudeAgent["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium",
        status === "active" && "bg-bot-green/15 text-bot-green",
        status === "disabled" && "bg-bot-amber/15 text-bot-amber",
        status === "archived" && "bg-bot-red/15 text-bot-red",
      )}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ModelBadge({ model }: { model: string }) {
  const short = model.replace("claude-", "").replace("-20251001", "");
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-caption font-mono bg-bot-elevated border border-bot-border text-bot-muted">
      {short}
    </span>
  );
}

export function AgentListView({
  agents,
  onEdit,
  onDelete,
  onToggleStatus,
  onArchive,
  onViewVersions,
  onNew,
}: AgentListViewProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  const filtered = agents.filter((a) => filter === "all" || a.status === filter);

  const filterCounts: Record<StatusFilter, number> = {
    all: agents.length,
    active: agents.filter((a) => a.status === "active").length,
    disabled: agents.filter((a) => a.status === "disabled").length,
    archived: agents.filter((a) => a.status === "archived").length,
  };

  const filterLabels: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "disabled", label: "Disabled" },
    { key: "archived", label: "Archived" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-bot-border px-6 py-4">
        <div>
          <h2 className="text-subtitle font-semibold text-bot-text">Agents</h2>
          <p className="text-caption text-bot-muted mt-0.5">
            Reusable Claude agent configurations
          </p>
        </div>
        <button
          onClick={onNew}
          className="flex items-center gap-2 rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-bot-border px-6 py-2">
        {filterLabels.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-medium transition-colors",
              filter === key
                ? "bg-bot-accent/10 text-bot-accent"
                : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated",
            )}
          >
            {label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-caption",
                filter === key
                  ? "bg-bot-accent/20 text-bot-accent"
                  : "bg-bot-elevated text-bot-muted",
              )}
            >
              {filterCounts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-bot-muted">
            <div className="text-4xl">🤖</div>
            <p className="text-body">
              {filter === "all" ? "No agents yet" : `No ${filter} agents`}
            </p>
            {filter === "all" && (
              <button
                onClick={onNew}
                className="rounded-lg bg-bot-accent px-5 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
              >
                Create your first agent
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleStatus={onToggleStatus}
                onArchive={onArchive}
                onViewVersions={onViewVersions}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface AgentCardProps {
  agent: ClaudeAgent;
  onEdit: (agent: ClaudeAgent) => void;
  onDelete: (agentId: string) => void;
  onToggleStatus: (agent: ClaudeAgent) => void;
  onArchive: (agentId: string) => void;
  onViewVersions: (agent: ClaudeAgent) => void;
}

function AgentCard({ agent, onEdit, onDelete, onToggleStatus, onArchive, onViewVersions }: AgentCardProps) {
  return (
    <div className="group relative flex flex-col rounded-xl border border-bot-border bg-bot-surface p-4 transition-all hover:border-bot-accent/40 hover:shadow-sm">
      {/* Icon + status */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bot-elevated text-2xl">
          {agent.icon ?? "🤖"}
        </div>
        <StatusBadge status={agent.status} />
      </div>

      {/* Name */}
      <p className="text-body font-semibold text-bot-text mb-1">{agent.name}</p>

      {/* Description */}
      <p className="text-caption text-bot-muted line-clamp-2 mb-3 flex-1">
        {agent.description}
      </p>

      {/* Footer row */}
      <div className="flex items-center justify-between mt-auto">
        <ModelBadge model={agent.model} />
        <span className="text-caption text-bot-muted">
          {new Date(agent.updated_at).toLocaleDateString()}
        </span>
      </div>

      {/* Hover actions */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 rounded-b-xl border-t border-bot-border bg-bot-elevated/95 px-3 py-2 opacity-0 transition-opacity group-hover:opacity-100">
        <ActionButton
          title="Edit"
          onClick={() => onEdit(agent)}
          icon={<Pencil className="h-3.5 w-3.5" />}
        />
        <ActionButton
          title={agent.status === "active" ? "Disable" : "Enable"}
          onClick={() => onToggleStatus(agent)}
          icon={
            agent.status === "active"
              ? <PowerOff className="h-3.5 w-3.5" />
              : <Power className="h-3.5 w-3.5" />
          }
        />
        <ActionButton
          title="Version History"
          onClick={() => onViewVersions(agent)}
          icon={<History className="h-3.5 w-3.5" />}
        />
        {agent.status !== "archived" && (
          <ActionButton
            title="Archive"
            onClick={() => onArchive(agent.id)}
            icon={<Archive className="h-3.5 w-3.5" />}
          />
        )}
        <ActionButton
          title="Delete"
          onClick={() => onDelete(agent.id)}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          destructive
        />
      </div>
    </div>
  );
}

function ActionButton({
  title,
  onClick,
  icon,
  destructive = false,
}: {
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded p-1.5 transition-colors",
        destructive
          ? "text-bot-muted hover:bg-bot-red/10 hover:text-bot-red"
          : "text-bot-muted hover:bg-bot-bg hover:text-bot-text",
      )}
    >
      {icon}
    </button>
  );
}

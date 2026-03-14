"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Archive, History, Power, PowerOff, Bot } from "lucide-react";
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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
        status === "active" && "bg-bot-green/10 text-bot-green",
        status === "disabled" && "bg-bot-amber/10 text-bot-amber",
        status === "archived" && "bg-bot-red/10 text-bot-red",
      )}
    >
      <span className={cn(
        "h-1.5 w-1.5 rounded-full",
        status === "active" && "bg-bot-green",
        status === "disabled" && "bg-bot-amber",
        status === "archived" && "bg-bot-red",
      )} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ModelBadge({ model }: { model: string }) {
  const short = model.replace("claude-", "").replace("-20251001", "");
  return (
    <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-mono bg-bot-elevated/40 border border-bot-border/30 text-bot-muted">
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
      <div className="flex items-center justify-between border-b border-bot-border/30 px-6 py-4 bg-bot-surface/50 backdrop-blur-sm">
        <div>
          <h2 className="text-subtitle font-bold text-bot-text">Agents</h2>
          <p className="text-caption text-bot-muted/70 mt-0.5">
            Reusable Claude agent configurations
          </p>
        </div>
        <button
          onClick={onNew}
          className="flex items-center gap-2 rounded-xl gradient-accent px-4 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </button>
      </div>

      <div className="flex gap-1 border-b border-bot-border/30 px-6 py-2 bg-bot-surface/30">
        {filterLabels.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-caption font-medium transition-all duration-200",
              filter === key
                ? "bg-bot-accent/10 text-bot-accent"
                : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40",
            )}
          >
            {label}
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                filter === key
                  ? "bg-bot-accent/20 text-bot-accent"
                  : "bg-bot-elevated/40 text-bot-muted",
              )}
            >
              {filterCounts[key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-bot-muted animate-fadeUp">
            <div className="relative">
              <div className="absolute -inset-4 rounded-full bg-bot-accent/5 blur-xl" />
              <Bot className="relative h-12 w-12 text-bot-muted/30" />
            </div>
            <p className="text-body font-medium">
              {filter === "all" ? "No agents yet" : `No ${filter} agents`}
            </p>
            {filter === "all" && (
              <button
                onClick={onNew}
                className="rounded-xl gradient-accent px-6 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
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
    <div className="group relative flex flex-col rounded-2xl border border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm p-5 transition-all duration-200 hover:border-bot-accent/30 hover:shadow-glow-sm hover:-translate-y-0.5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bot-elevated/40 border border-bot-border/20 text-2xl">
          {agent.icon ?? "🤖"}
        </div>
        <StatusBadge status={agent.status} />
      </div>

      <p className="text-body font-semibold text-bot-text mb-1">{agent.name}</p>

      <p className="text-caption text-bot-muted/70 line-clamp-2 mb-3 flex-1">
        {agent.description}
      </p>

      <div className="flex items-center justify-between mt-auto">
        <ModelBadge model={agent.model} />
        <span className="text-[10px] text-bot-muted/50">
          {new Date(agent.updated_at).toLocaleDateString()}
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 rounded-b-2xl border-t border-bot-border/20 glass px-3 py-2 opacity-0 transition-all duration-200 group-hover:opacity-100">
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
        "flex items-center justify-center rounded-lg p-1.5 transition-all duration-200",
        destructive
          ? "text-bot-muted hover:bg-bot-red/10 hover:text-bot-red"
          : "text-bot-muted hover:bg-bot-elevated/60 hover:text-bot-text",
      )}
    >
      {icon}
    </button>
  );
}

"use client";

import { useState } from "react";
import {
  Plus, Pencil, Trash2, Play, Pause, Power, Clock, Calendar,
  CheckCircle2, XCircle, Loader2, Timer, Sparkles, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/claude-db";

type StatusFilter = "all" | "active" | "paused" | "failed";

interface JobListViewProps {
  jobs: Job[];
  onNew: () => void;
  onAiBuilder: () => void;
  onEdit: (job: Job) => void;
  onDelete: (jobId: string) => void;
  onToggle: (job: Job) => void;
  onRunNow: (jobId: string) => void;
  onViewDetail: (job: Job) => void;
}

function JobStatusBadge({ status }: { status: Job["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold",
        status === "active" && "bg-bot-green/10 text-bot-green",
        status === "paused" && "bg-bot-muted/10 text-bot-muted",
        status === "failed" && "bg-bot-red/10 text-bot-red",
        status === "draft" && "bg-bot-amber/10 text-bot-amber",
      )}
    >
      <span className={cn(
        "h-1.5 w-1.5 rounded-full",
        status === "active" && "bg-bot-green",
        status === "paused" && "bg-bot-muted",
        status === "failed" && "bg-bot-red",
        status === "draft" && "bg-bot-amber",
      )} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function RunStatusIcon({ status }: { status: Job["last_run_status"] }) {
  if (!status) return <span className="text-[10px] text-bot-muted">Never run</span>;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-bot-blue" />;
  if (status === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-bot-green" />;
  return <XCircle className="h-3.5 w-3.5 text-bot-red" />;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export function JobListView({
  jobs, onNew, onAiBuilder, onEdit, onDelete, onToggle, onRunNow, onViewDetail,
}: JobListViewProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  const filtered = jobs.filter((j) => filter === "all" || j.status === filter);

  const filterCounts: Record<StatusFilter, number> = {
    all: jobs.length,
    active: jobs.filter((j) => j.status === "active").length,
    paused: jobs.filter((j) => j.status === "paused").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  const filterLabels: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "paused", label: "Paused" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-bot-border/30 px-6 py-4 bg-bot-surface/50 backdrop-blur-sm">
        <div>
          <h2 className="text-subtitle font-bold text-bot-text">Jobs</h2>
          <p className="text-caption text-bot-muted/70 mt-0.5">
            Scheduled tasks powered by systemd timers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onAiBuilder}
            className="flex items-center gap-2 rounded-xl border border-bot-accent/30 bg-bot-accent/5 px-4 py-2.5 text-body font-semibold text-bot-accent hover:bg-bot-accent/10 active:scale-[0.98] transition-all duration-200"
          >
            <Sparkles className="h-4 w-4" />
            Build with AI
          </button>
          <button
            onClick={onNew}
            className="flex items-center gap-2 rounded-xl gradient-accent px-4 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
          >
            <Plus className="h-4 w-4" />
            New Job
          </button>
        </div>
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
              <Timer className="relative h-12 w-12 text-bot-muted/30" />
            </div>
            <p className="text-body font-medium">
              {filter === "all" ? "No jobs yet" : `No ${filter} jobs`}
            </p>
            {filter === "all" && (
              <div className="flex items-center gap-3">
                <button
                  onClick={onAiBuilder}
                  className="rounded-xl border border-bot-accent/30 bg-bot-accent/5 px-6 py-2.5 text-body font-semibold text-bot-accent hover:bg-bot-accent/10 active:scale-[0.98] transition-all duration-200"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Build with AI
                  </span>
                </button>
                <button
                  onClick={onNew}
                  className="rounded-xl gradient-accent px-6 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
                >
                  Configure manually
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggle={onToggle}
                onRunNow={onRunNow}
                onViewDetail={onViewDetail}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface JobCardProps {
  job: Job;
  onEdit: (job: Job) => void;
  onDelete: (jobId: string) => void;
  onToggle: (job: Job) => void;
  onRunNow: (jobId: string) => void;
  onViewDetail: (job: Job) => void;
}

function JobCard({ job, onEdit, onDelete, onToggle, onRunNow, onViewDetail }: JobCardProps) {
  return (
    <div
      className="group relative flex flex-col rounded-2xl border border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm p-5 transition-all duration-200 hover:border-bot-accent/30 hover:shadow-glow-sm hover:-translate-y-0.5 cursor-pointer"
      onClick={() => onViewDetail(job)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bot-elevated/40 border border-bot-border/20">
          <Timer className="h-5 w-5 text-bot-accent" />
        </div>
        <JobStatusBadge status={job.status} />
      </div>

      <p className="text-body font-semibold text-bot-text mb-1">{job.name}</p>

      <p className="text-caption text-bot-muted/70 line-clamp-2 mb-3 flex-1">
        {job.description || job.script_path}
      </p>

      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-caption text-bot-muted">
          <Calendar className="h-3 w-3 shrink-0" />
          <span className="truncate">{job.schedule_display || job.schedule}</span>
        </div>
        <div className="flex items-center gap-2 text-caption text-bot-muted">
          <Clock className="h-3 w-3 shrink-0" />
          <span className="flex items-center gap-1.5">
            <RunStatusIcon status={job.last_run_status} />
            {job.last_run_at ? timeAgo(job.last_run_at) : "Never run"}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-auto">
        <span className="text-[10px] text-bot-muted/50 font-mono">
          {job.run_count} run{job.run_count !== 1 ? "s" : ""}
          {job.fail_count > 0 && <span className="text-bot-red"> ({job.fail_count} failed)</span>}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-bot-muted/30 group-hover:text-bot-accent transition-colors" />
      </div>

      <div
        className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 rounded-b-2xl border-t border-bot-border/20 glass px-3 py-2 opacity-0 transition-all duration-200 group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <ActionButton
          title="Edit"
          onClick={() => onEdit(job)}
          icon={<Pencil className="h-3.5 w-3.5" />}
        />
        <ActionButton
          title={job.status === "active" ? "Pause" : "Enable"}
          onClick={() => onToggle(job)}
          icon={
            job.status === "active"
              ? <Pause className="h-3.5 w-3.5" />
              : <Power className="h-3.5 w-3.5" />
          }
        />
        <ActionButton
          title="Run Now"
          onClick={() => onRunNow(job.id)}
          icon={<Play className="h-3.5 w-3.5" />}
        />
        <ActionButton
          title="Delete"
          onClick={() => {
            if (confirm(`Delete job "${job.name}"?`)) onDelete(job.id);
          }}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          destructive
        />
      </div>
    </div>
  );
}

function ActionButton({
  title, onClick, icon, destructive = false,
}: {
  title: string; onClick: () => void; icon: React.ReactNode; destructive?: boolean;
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

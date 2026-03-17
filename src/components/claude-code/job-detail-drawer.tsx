"use client";

import { useState } from "react";
import {
  X, Pencil, Play, Pause, Power, RefreshCw, Clock, Calendar, FileCode,
  FolderOpen, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight,
  Timer, AlertTriangle, Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job, JobRun } from "@/lib/claude-db";

interface JobDetailDrawerProps {
  job: Job;
  runs: JobRun[];
  onClose: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onRunNow: () => void;
  onRefreshRuns: () => void;
}

function RunStatusBadge({ status }: { status: JobRun["status"] }) {
  const config = {
    running: { bg: "bg-bot-blue/10", text: "text-bot-blue", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    success: { bg: "bg-bot-green/10", text: "text-bot-green", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { bg: "bg-bot-red/10", text: "text-bot-red", icon: <XCircle className="h-3 w-3" /> },
    cancelled: { bg: "bg-bot-muted/10", text: "text-bot-muted", icon: <X className="h-3 w-3" /> },
  }[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", config.bg, config.text)}>
      {config.icon}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  return d.toLocaleString();
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

export function JobDetailDrawer({ job, runs, onClose, onEdit, onToggle, onRunNow, onRefreshRuns }: JobDetailDrawerProps) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full bg-bot-bg border-l border-bot-border/30 shadow-2xl flex flex-col animate-slideInRight"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bot-border/30 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bot-elevated/40 border border-bot-border/20 shrink-0">
              <Timer className="h-5 w-5 text-bot-accent" />
            </div>
            <div className="min-w-0">
              <h2 className="text-body font-bold text-bot-text truncate">{job.name}</h2>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  job.status === "active" && "bg-bot-green/10 text-bot-green",
                  job.status === "paused" && "bg-bot-muted/10 text-bot-muted",
                  job.status === "failed" && "bg-bot-red/10 text-bot-red",
                )}
              >
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  job.status === "active" && "bg-bot-green",
                  job.status === "paused" && "bg-bot-muted",
                  job.status === "failed" && "bg-bot-red",
                )} />
                {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated/60 hover:text-bot-text transition-all">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-bot-border/20">
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-bot-border/30 bg-bot-surface/60 px-3 py-1.5 text-caption font-medium text-bot-text hover:bg-bot-elevated/60 transition-all"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 rounded-lg border border-bot-border/30 bg-bot-surface/60 px-3 py-1.5 text-caption font-medium text-bot-text hover:bg-bot-elevated/60 transition-all"
          >
            {job.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            {job.status === "active" ? "Pause" : "Enable"}
          </button>
          <button
            onClick={onRunNow}
            className="flex items-center gap-1.5 rounded-lg gradient-accent px-3 py-1.5 text-caption font-semibold text-white shadow-sm hover:brightness-110 active:scale-[0.98] transition-all"
          >
            <Play className="h-3.5 w-3.5" />
            Run Now
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Overview */}
          <div className="px-6 py-4 space-y-3 border-b border-bot-border/20">
            {job.description && (
              <p className="text-caption text-bot-muted">{job.description}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label="Schedule" value={job.schedule_display || job.schedule} />
              <InfoRow icon={<FileCode className="h-3.5 w-3.5" />} label="Script" value={job.script_path} mono />
              {job.working_directory && (
                <InfoRow icon={<FolderOpen className="h-3.5 w-3.5" />} label="Working Dir" value={job.working_directory} mono />
              )}
              <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="Last Run" value={job.last_run_at ? timeAgo(job.last_run_at) : "Never"} />
              {job.next_run_at && (
                <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="Next Run" value={job.next_run_at} />
              )}
              <InfoRow icon={<Hash className="h-3.5 w-3.5" />} label="Total Runs" value={`${job.run_count} (${job.fail_count} failed)`} />
            </div>

            {job.consecutive_failures > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-bot-amber/10 border border-bot-amber/20 px-3 py-2 text-caption text-bot-amber">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {job.consecutive_failures} consecutive failure{job.consecutive_failures > 1 ? "s" : ""}
                {job.auto_disable_after > 0 && ` (auto-disables after ${job.auto_disable_after})`}
              </div>
            )}
          </div>

          {/* Run History */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-caption font-semibold text-bot-text">Run History</p>
              <button
                onClick={onRefreshRuns}
                className="flex items-center gap-1.5 text-[10px] text-bot-muted hover:text-bot-text transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </div>

            {runs.length === 0 ? (
              <p className="text-caption text-bot-muted/60 py-8 text-center">No runs yet</p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-bot-border/20 bg-bot-surface/40 overflow-hidden">
                    <button
                      onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-bot-elevated/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <RunStatusBadge status={run.status} />
                        <span className="text-caption text-bot-muted">
                          {formatDate(run.started_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-bot-muted font-mono">
                          {formatDuration(run.duration_ms)}
                        </span>
                        {run.triggered_by !== "timer" && (
                          <span className="text-[10px] text-bot-accent">{run.triggered_by}</span>
                        )}
                        {expandedRun === run.id ? (
                          <ChevronDown className="h-3.5 w-3.5 text-bot-muted" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-bot-muted" />
                        )}
                      </div>
                    </button>

                    {expandedRun === run.id && (
                      <div className="border-t border-bot-border/10 px-4 py-3 space-y-2">
                        {run.exit_code !== null && (
                          <p className="text-[10px] text-bot-muted">
                            Exit code: <span className={cn("font-mono font-semibold", run.exit_code === 0 ? "text-bot-green" : "text-bot-red")}>{run.exit_code}</span>
                          </p>
                        )}
                        {run.error_summary && (
                          <p className="text-[10px] text-bot-red">{run.error_summary}</p>
                        )}
                        {run.output && (
                          <pre className="text-[10px] text-bot-muted font-mono whitespace-pre-wrap break-all bg-bot-elevated/30 rounded-lg p-3 max-h-48 overflow-y-auto">
                            {run.output}
                          </pre>
                        )}
                        {!run.output && run.status !== "running" && (
                          <p className="text-[10px] text-bot-muted/50 italic">No output captured</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-bot-muted mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-bot-muted/60">{label}</p>
        <p className={cn("text-caption text-bot-text truncate", mono && "font-mono text-[11px]")}>{value}</p>
      </div>
    </div>
  );
}

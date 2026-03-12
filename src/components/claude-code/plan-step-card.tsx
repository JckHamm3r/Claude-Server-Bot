"use client";

import { useState } from "react";
import {
  ChevronRight,
  Check,
  X,
  Pencil,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  SkipForward,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudePlanStep } from "@/lib/claude-db";

interface PlanStepCardProps {
  step: ClaudePlanStep;
  stepNumber: number;
  isFirst: boolean;
  isLast: boolean;
  totalSteps: number;
  onApprove: () => void;
  onReject: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: (summary: string, details: string) => void;
  onRetry?: () => void;
  onSkip?: () => void;
  onRollbackStop?: () => void;
  onRollbackContinue?: () => void;
  paused?: boolean;
  canRollback?: boolean;
}

const STATUS_CONFIG: Record<
  ClaudePlanStep["status"],
  { label: string; className: string }
> = {
  pending: { label: "Pending", className: "bg-bot-elevated text-bot-muted border border-bot-border" },
  approved: { label: "Approved", className: "bg-bot-green/15 text-bot-green border border-bot-green/30" },
  rejected: { label: "Rejected", className: "bg-bot-red/15 text-bot-red border border-bot-red/30" },
  executing: { label: "Executing", className: "bg-blue-500/15 text-blue-400 border border-blue-500/30" },
  completed: { label: "Completed", className: "bg-bot-green/15 text-bot-green border border-bot-green/30" },
  failed: { label: "Failed", className: "bg-bot-red/15 text-bot-red border border-bot-red/30" },
  rolled_back: { label: "Rolled Back", className: "bg-bot-amber/15 text-bot-amber border border-bot-amber/30" },
};

export function PlanStepCard({
  step,
  stepNumber,
  isFirst,
  isLast,
  onApprove,
  onReject,
  onMoveUp,
  onMoveDown,
  onEdit,
  onRetry,
  onSkip,
  onRollbackStop,
  onRollbackContinue,
  paused,
  canRollback,
}: PlanStepCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState(step.summary);
  const [editDetails, setEditDetails] = useState(step.details ?? "");

  const statusCfg = STATUS_CONFIG[step.status];
  const isExecuting = step.status === "executing";
  const isFailed = step.status === "failed";
  const isCompleted = step.status === "completed";
  const isPending = step.status === "pending";
  const isTerminal = ["completed", "failed", "rolled_back", "rejected"].includes(step.status);

  function handleSaveEdit() {
    onEdit(editSummary.trim(), editDetails.trim());
    setEditing(false);
  }

  function handleCancelEdit() {
    setEditSummary(step.summary);
    setEditDetails(step.details ?? "");
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-bot-surface transition-colors",
        isFailed && paused ? "border-bot-red/50" : "border-bot-border",
        isExecuting && "border-blue-500/40",
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-3">
        {/* Step number badge */}
        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
            isExecuting
              ? "bg-blue-500/20 text-blue-400"
              : isCompleted
              ? "bg-bot-green/20 text-bot-green"
              : isFailed
              ? "bg-bot-red/20 text-bot-red"
              : "bg-bot-elevated text-bot-muted",
          )}
        >
          {isExecuting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isCompleted ? (
            <Check className="h-3 w-3" />
          ) : isFailed ? (
            <X className="h-3 w-3" />
          ) : (
            stepNumber
          )}
        </div>

        {/* Summary */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editing ? (
            <input
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              className="w-full rounded border border-bot-border bg-bot-elevated px-2 py-1 text-body text-bot-text focus:border-bot-accent focus:outline-none"
              autoFocus
            />
          ) : (
            <span className="text-body font-medium text-bot-text">{step.summary}</span>
          )}
        </div>

        {/* Status badge */}
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-caption font-medium",
            statusCfg.className,
          )}
        >
          {statusCfg.label}
        </span>
      </div>

      {/* Inline edit details */}
      {editing && (
        <div className="px-3 pb-2">
          <textarea
            value={editDetails}
            onChange={(e) => setEditDetails(e.target.value)}
            rows={3}
            placeholder="Details (optional)"
            className="w-full rounded border border-bot-border bg-bot-elevated px-2 py-1 text-caption text-bot-text focus:border-bot-accent focus:outline-none resize-none"
          />
          <div className="mt-1.5 flex gap-2">
            <button
              onClick={handleSaveEdit}
              className="rounded bg-bot-accent px-3 py-1 text-caption font-medium text-white hover:bg-bot-accent/80 transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleCancelEdit}
              className="rounded border border-bot-border px-3 py-1 text-caption text-bot-muted hover:text-bot-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Expandable details */}
      {!editing && step.details && (
        <div className="px-3 pb-2">
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1 text-caption text-bot-muted hover:text-bot-text transition-colors"
          >
            <ChevronRight
              className={cn("h-3 w-3 transition-transform", detailsOpen && "rotate-90")}
            />
            Details
          </button>
          {detailsOpen && (
            <p className="mt-1.5 rounded bg-bot-elevated px-2 py-1.5 text-caption text-bot-muted whitespace-pre-wrap">
              {step.details}
            </p>
          )}
        </div>
      )}

      {/* Result (completed steps) */}
      {isCompleted && step.result && (
        <div className="px-3 pb-2">
          <button
            onClick={() => setResultOpen((v) => !v)}
            className="flex items-center gap-1 text-caption text-bot-green hover:text-bot-green/80 transition-colors"
          >
            <ChevronRight
              className={cn("h-3 w-3 transition-transform", resultOpen && "rotate-90")}
            />
            Result
          </button>
          {resultOpen && (
            <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-bot-elevated px-2 py-1.5 text-caption text-bot-muted whitespace-pre-wrap">
              {step.result}
            </pre>
          )}
        </div>
      )}

      {/* Error (failed steps) */}
      {isFailed && step.error && (
        <div className="px-3 pb-2">
          <p className="rounded bg-bot-red/10 px-2 py-1.5 text-caption text-bot-red">
            {step.error}
          </p>
        </div>
      )}

      {/* Action buttons */}
      {!isTerminal && !isExecuting && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-bot-border px-3 py-2">
          {isPending && (
            <>
              <button
                onClick={onApprove}
                className="flex items-center gap-1 rounded bg-bot-green/15 px-2.5 py-1 text-caption font-medium text-bot-green hover:bg-bot-green/25 transition-colors"
              >
                <Check className="h-3 w-3" />
                Approve
              </button>
              <button
                onClick={onReject}
                className="flex items-center gap-1 rounded bg-bot-red/15 px-2.5 py-1 text-caption font-medium text-bot-red hover:bg-bot-red/25 transition-colors"
              >
                <X className="h-3 w-3" />
                Reject
              </button>
            </>
          )}

          {/* Move up/down */}
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="rounded p-1 text-bot-muted hover:text-bot-text disabled:opacity-30 transition-colors"
            title="Move up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="rounded p-1 text-bot-muted hover:text-bot-text disabled:opacity-30 transition-colors"
            title="Move down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>

          {/* Edit */}
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded p-1 text-bot-muted hover:text-bot-text transition-colors"
              title="Edit step"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Failed + paused: retry / rollback / skip */}
      {isFailed && paused && (
        <div className="flex flex-wrap items-center gap-2 border-t border-bot-border px-3 py-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 rounded bg-bot-amber/15 px-2.5 py-1 text-caption font-medium text-bot-amber hover:bg-bot-amber/25 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
          )}
          {canRollback && onRollbackContinue && (
            <button
              onClick={onRollbackContinue}
              className="flex items-center gap-1 rounded bg-bot-red/10 px-2.5 py-1 text-caption font-medium text-bot-red hover:bg-bot-red/20 border border-bot-red/30 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Rollback &amp; Continue
            </button>
          )}
          {canRollback && onRollbackStop && (
            <button
              onClick={onRollbackStop}
              className="flex items-center gap-1 rounded bg-bot-red/10 px-2.5 py-1 text-caption font-medium text-bot-red hover:bg-bot-red/20 border border-bot-red/30 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Rollback &amp; Stop
            </button>
          )}
          {onSkip && (
            <button
              onClick={onSkip}
              className="flex items-center gap-1 rounded bg-bot-elevated px-2.5 py-1 text-caption font-medium text-bot-muted hover:text-bot-text border border-bot-border transition-colors"
            >
              <SkipForward className="h-3 w-3" />
              Skip
            </button>
          )}
          {canRollback && (
            <p className="w-full text-[10px] text-bot-muted/70 mt-0.5">
              Rollback uses <code className="font-mono">git checkout -- .</code> — undoes all uncommitted changes.
            </p>
          )}
        </div>
      )}

      {/* Executing indicator */}
      {isExecuting && (
        <div className="flex items-center gap-2 border-t border-blue-500/30 px-3 py-2">
          <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
          <span className="text-caption text-blue-400">Executing…</span>
        </div>
      )}
    </div>
  );
}

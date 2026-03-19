"use client";

import { useState } from "react";
import {
  Check,
  X,
  Pencil,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  SkipForward,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudePlanStep } from "@/lib/claude-db";
import type { ToolActivity } from "./plan-step-list";

interface PlanStepCardProps {
  step: ClaudePlanStep;
  stepNumber: number;
  isFirst: boolean;
  isLast: boolean;
  totalSteps: number;
  expanded: boolean;
  onToggleExpand: () => void;
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
  stepProgress?: string;
  toolActivity?: ToolActivity[];
}

// Step number badge styles per status
const BADGE_CONFIG: Record<
  ClaudePlanStep["status"],
  { bg: string; text: string; ring: string }
> = {
  pending:     { bg: "bg-bot-elevated",      text: "text-bot-muted",   ring: "ring-bot-border/50" },
  approved:    { bg: "bg-bot-green/15",       text: "text-bot-green",   ring: "ring-bot-green/40" },
  rejected:    { bg: "bg-bot-red/15",         text: "text-bot-red",     ring: "ring-bot-red/40" },
  executing:   { bg: "bg-blue-500/15",        text: "text-blue-400",    ring: "ring-blue-500/40" },
  completed:   { bg: "bg-bot-green/15",       text: "text-bot-green",   ring: "ring-bot-green/40" },
  failed:      { bg: "bg-bot-red/15",         text: "text-bot-red",     ring: "ring-bot-red/50" },
  rolled_back: { bg: "bg-bot-amber/15",       text: "text-bot-amber",   ring: "ring-bot-amber/40" },
};

// Card border accent per status
const CARD_BORDER: Record<ClaudePlanStep["status"], string> = {
  pending:     "border-bot-border/30",
  approved:    "border-bot-green/25",
  rejected:    "border-bot-border/20",
  executing:   "border-blue-500/40",
  completed:   "border-bot-green/30",
  failed:      "border-bot-red/50",
  rolled_back: "border-bot-amber/30",
};

const STATUS_LABEL: Record<ClaudePlanStep["status"], string> = {
  pending:     "Pending",
  approved:    "Approved",
  rejected:    "Rejected",
  executing:   "Executing",
  completed:   "Completed",
  failed:      "Failed",
  rolled_back: "Rolled back",
};

const STATUS_BADGE: Record<ClaudePlanStep["status"], string> = {
  pending:     "bg-bot-elevated text-bot-muted",
  approved:    "bg-bot-green/15 text-bot-green",
  rejected:    "bg-bot-red/10 text-bot-red",
  executing:   "bg-blue-500/15 text-blue-400",
  completed:   "bg-bot-green/15 text-bot-green",
  failed:      "bg-bot-red/15 text-bot-red",
  rolled_back: "bg-bot-amber/15 text-bot-amber",
};

export function PlanStepCard({
  step,
  stepNumber,
  isFirst,
  isLast,
  expanded,
  onToggleExpand,
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
  stepProgress,
  toolActivity,
}: PlanStepCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [resultOpen, setResultOpen]   = useState(false);
  const [progressOpen, setProgressOpen] = useState(true);
  const [editing, setEditing]         = useState(false);
  const [editSummary, setEditSummary] = useState(step.summary);
  const [editDetails, setEditDetails] = useState(step.details ?? "");

  const bc  = BADGE_CONFIG[step.status];
  const isExecuting  = step.status === "executing";
  const isCompleted  = step.status === "completed";
  const isFailed     = step.status === "failed";
  const isPending    = step.status === "pending";
  const isApproved   = step.status === "approved";
  const isRejected   = step.status === "rejected";
  const isTerminal   = ["completed", "failed", "rolled_back", "rejected"].includes(step.status);
  const canAct       = !isTerminal && !isExecuting;

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
    <div className="relative flex items-start gap-3 py-1.5 pl-1 pr-0">
      {/* ── Step number bubble (sits on the connector line) ── */}
      <div className="relative z-10 mt-3 shrink-0">
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full ring-1 transition-all duration-300",
          bc.bg, bc.ring,
          isExecuting && "shadow-glow-sm",
        )}>
          {isExecuting ? (
            <Loader2 className={cn("h-4 w-4 animate-spin", bc.text)} />
          ) : isCompleted ? (
            <Check className={cn("h-4 w-4", bc.text)} />
          ) : isFailed ? (
            <X className={cn("h-4 w-4", bc.text)} />
          ) : (
            <span className={cn("text-caption font-bold tabular-nums", bc.text)}>
              {stepNumber}
            </span>
          )}
        </div>
      </div>

      {/* ── Card body ────────────────────────────────────────── */}
      <div className={cn(
        "flex-1 min-w-0 rounded-2xl border bg-bot-surface/60 backdrop-blur-sm transition-all duration-200",
        CARD_BORDER[step.status],
        isExecuting && "shadow-glow-sm",
        isFailed && paused && "shadow-[0_0_12px_2px_rgb(248_113_113_/_0.1)]",
      )}>

        {/* Top strip for executing state */}
        {isExecuting && (
          <div className="h-0.5 rounded-t-2xl bg-gradient-to-r from-blue-500/60 via-bot-accent/60 to-bot-accent-2/40 animate-shimmer" />
        )}

        {/* Header — clickable to expand / collapse */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex w-full items-start gap-3 px-4 pt-3.5 pb-2 text-left cursor-pointer select-none"
        >
          <ChevronRight
            className={cn(
              "mt-1 h-3.5 w-3.5 shrink-0 text-bot-muted/50 transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full rounded-xl border border-bot-border/50 bg-bot-elevated/60 px-3 py-1.5 text-body text-bot-text focus:border-bot-accent/50 focus:shadow-glow-sm focus:outline-none transition-all"
                autoFocus
              />
            ) : (
              <p className={cn(
                "text-body font-medium leading-snug",
                isRejected ? "text-bot-muted/50 line-through" : "text-bot-text",
              )}>
                {step.summary}
              </p>
            )}
          </div>

          <span className={cn(
            "shrink-0 mt-0.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            STATUS_BADGE[step.status],
          )}>
            {STATUS_LABEL[step.status]}
          </span>
        </button>

        {/* ── Expandable body ── */}
        {expanded && (
          <>
            {/* Inline edit details textarea */}
            {editing && (
              <div className="px-4 pb-3">
                <textarea
                  value={editDetails}
                  onChange={(e) => setEditDetails(e.target.value)}
                  rows={3}
                  placeholder="Details (optional)"
                  className="w-full resize-none rounded-xl border border-bot-border/50 bg-bot-elevated/60 px-3 py-2 text-caption text-bot-text placeholder:text-bot-muted/40 focus:border-bot-accent/50 focus:shadow-glow-sm focus:outline-none transition-all"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    className="rounded-xl gradient-accent px-4 py-1.5 text-caption font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.97] transition-all duration-200"
                  >
                    Save
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="rounded-xl border border-bot-border/50 px-4 py-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Expandable Details */}
            {!editing && step.details && (
              <div className="px-4 pb-2">
                <button
                  onClick={() => setDetailsOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-caption text-bot-muted/60 hover:text-bot-muted transition-colors"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", detailsOpen && "rotate-180")} />
                  Details
                </button>
                {detailsOpen && (
                  <div className="mt-2 rounded-xl border border-bot-border/30 bg-bot-elevated/50 px-3 py-2.5 animate-fadeUp">
                    <p className="text-caption text-bot-muted/80 whitespace-pre-wrap leading-relaxed">
                      {step.details}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Live progress (executing) */}
            {stepProgress && (
              <div className="px-4 pb-2">
                <button
                  onClick={() => setProgressOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-caption text-blue-400/70 hover:text-blue-400 transition-colors"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="flex-1 text-left">Live output</span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", progressOpen && "rotate-180")} />
                </button>
                {progressOpen && (
                  <pre className="mt-2 max-h-36 overflow-auto rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-blue-300/70 whitespace-pre-wrap break-words animate-fadeUp">
                    {stepProgress}
                  </pre>
                )}
              </div>
            )}

            {/* Tool activity */}
            {toolActivity && toolActivity.length > 0 && (
              <div className="px-4 pb-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-bot-muted/50">
                  Tool Activity
                </p>
                <div className="space-y-1">
                  {toolActivity.map((t) => (
                    <div
                      key={t.toolCallId}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-caption",
                        t.toolStatus === "running" && "bg-blue-500/8 text-blue-400",
                        t.toolStatus === "done" && "bg-bot-green/8 text-bot-green/70",
                        t.toolStatus === "error" && "bg-bot-red/8 text-bot-red/70",
                      )}
                    >
                      {t.toolStatus === "running" ? (
                        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                      ) : t.toolStatus === "done" ? (
                        <Check className="h-3 w-3 shrink-0" />
                      ) : (
                        <X className="h-3 w-3 shrink-0" />
                      )}
                      <span className="font-medium">{t.toolName}</span>
                      {t.toolResult && (
                        <span className="truncate text-[11px] opacity-60">
                          {t.toolResult.slice(0, 80)}
                        </span>
                      )}
                      {t.exitCode !== undefined && t.exitCode !== 0 && (
                        <span className="ml-auto text-[10px] font-mono text-bot-red">
                          exit {t.exitCode}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Result (completed) */}
            {isCompleted && step.result && (
              <div className="px-4 pb-2">
                <button
                  onClick={() => setResultOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-caption text-bot-green/70 hover:text-bot-green transition-colors"
                >
                  <Check className="h-3 w-3" />
                  <span className="flex-1 text-left">Result</span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", resultOpen && "rotate-180")} />
                </button>
                {resultOpen && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-bot-green/20 bg-bot-green/5 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-bot-green/70 whitespace-pre-wrap break-words animate-fadeUp">
                    {(() => {
                      try {
                        const parsed = JSON.parse(step.result!);
                        return parsed.summary || step.result;
                      } catch {
                        return step.result;
                      }
                    })()}
                  </pre>
                )}
              </div>
            )}

            {/* Error (failed) */}
            {isFailed && step.error && (
              <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-bot-red/20 bg-bot-red/8 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bot-red" />
                <p className="text-caption text-bot-red/80 leading-snug">{step.error}</p>
              </div>
            )}

            {/* ── Action footer ──────────────────────────────────────── */}
            {canAct && !editing && (
              <div className="flex items-center gap-1.5 border-t border-bot-border/20 px-3 py-2">
                {isPending && (
                  <>
                    <button
                      onClick={onApprove}
                      className="flex items-center gap-1.5 rounded-xl border border-bot-green/30 bg-bot-green/10 px-3 py-1.5 text-caption font-semibold text-bot-green hover:bg-bot-green/20 hover:border-bot-green/50 active:scale-[0.97] transition-all duration-150"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      onClick={onReject}
                      className="flex items-center gap-1.5 rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-3 py-1.5 text-caption font-medium text-bot-muted hover:border-bot-red/30 hover:text-bot-red hover:bg-bot-red/8 active:scale-[0.97] transition-all duration-150"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </>
                )}
                {isApproved && (
                  <button
                    onClick={onReject}
                    className="flex items-center gap-1.5 rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-3 py-1.5 text-caption font-medium text-bot-muted hover:border-bot-red/30 hover:text-bot-red hover:bg-bot-red/8 transition-all duration-150"
                  >
                    <X className="h-3.5 w-3.5" />
                    Undo
                  </button>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={onMoveUp}
                    disabled={isFirst}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-bot-muted/60 hover:bg-bot-elevated hover:text-bot-text disabled:opacity-25 transition-all"
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={onMoveDown}
                    disabled={isLast}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-bot-muted/60 hover:bg-bot-elevated hover:text-bot-text disabled:opacity-25 transition-all"
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditing(true)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-bot-muted/60 hover:bg-bot-elevated hover:text-bot-text transition-all"
                    title="Edit step"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Paused failure — retry / rollback / skip ──────────── */}
            {isFailed && paused && (
              <div className="border-t border-bot-red/20 px-3 py-2.5">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-bot-red/60">
                  Step paused — choose an action
                </p>
                <div className="flex flex-wrap gap-2">
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="flex items-center gap-1.5 rounded-xl border border-bot-amber/30 bg-bot-amber/10 px-3 py-1.5 text-caption font-semibold text-bot-amber hover:bg-bot-amber/20 hover:border-bot-amber/50 active:scale-[0.97] transition-all duration-150"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry
                    </button>
                  )}
                  {onSkip && (
                    <button
                      onClick={onSkip}
                      className="flex items-center gap-1.5 rounded-xl border border-bot-border/50 bg-bot-elevated/40 px-3 py-1.5 text-caption font-medium text-bot-muted hover:text-bot-text hover:border-bot-border active:scale-[0.97] transition-all duration-150"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      Skip
                    </button>
                  )}
                  {canRollback && onRollbackContinue && (
                    <button
                      onClick={onRollbackContinue}
                      className="flex items-center gap-1.5 rounded-xl border border-bot-red/25 bg-bot-red/8 px-3 py-1.5 text-caption font-medium text-bot-red/80 hover:bg-bot-red/15 hover:border-bot-red/40 active:scale-[0.97] transition-all duration-150"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Rollback &amp; Continue
                    </button>
                  )}
                  {canRollback && onRollbackStop && (
                    <button
                      onClick={onRollbackStop}
                      className="flex items-center gap-1.5 rounded-xl border border-bot-red/25 bg-bot-red/8 px-3 py-1.5 text-caption font-medium text-bot-red/80 hover:bg-bot-red/15 hover:border-bot-red/40 active:scale-[0.97] transition-all duration-150"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Rollback &amp; Stop
                    </button>
                  )}
                </div>
                {canRollback && (
                  <p className="mt-2 text-[10px] text-bot-muted/50">
                    Rollback uses <code className="font-mono">git checkout -- .</code> to undo uncommitted changes.
                  </p>
                )}
              </div>
            )}

            {/* Executing footer pulse */}
            {isExecuting && !stepProgress && (
              <div className="flex items-center gap-2 border-t border-blue-500/15 px-4 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-ping" />
                <span className="text-caption text-blue-400/70">Working…</span>
              </div>
            )}

            {/* Completed footer with cost */}
            {isCompleted && (step.cost_usd > 0 || step.input_tokens > 0) && (
              <div className="flex items-center gap-2 border-t border-bot-border/20 px-4 py-2 text-[10px] text-bot-muted/50">
                <Check className="h-3 w-3 text-bot-green/60" />
                <span>Completed</span>
                {step.cost_usd > 0 && <span>· ${step.cost_usd.toFixed(3)}</span>}
                {step.input_tokens > 0 && (
                  <span>· {((step.input_tokens + step.output_tokens) / 1000).toFixed(1)}k tokens</span>
                )}
                {toolActivity && toolActivity.length > 0 && (
                  <span>· {toolActivity.length} tool calls</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

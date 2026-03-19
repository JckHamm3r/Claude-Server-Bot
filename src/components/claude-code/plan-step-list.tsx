"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  X,
  CheckCheck,
  XCircle,
  Loader2,
  Trash2,
  Zap,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudePlan, ClaudePlanStep } from "@/lib/claude-db";
import { PlanStepCard } from "./plan-step-card";

export interface ToolActivity {
  toolCallId: string;
  toolName: string;
  toolInput?: unknown;
  toolResult?: string;
  toolStatus: "running" | "done" | "error";
  exitCode?: number;
}

interface PlanStepListProps {
  plan: ClaudePlan;
  onApprove: (stepId: string) => void;
  onReject: (stepId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onReorder: (stepId: string, newOrder: number) => void;
  onEdit: (stepId: string, summary: string, details: string) => void;
  onExecute: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onSkip: () => void;
  onRollbackStop?: () => void;
  onRollbackContinue?: () => void;
  onDelete?: () => void;
  executing: boolean;
  pausedStepId?: string | null;
  pausedCanRollback?: boolean;
  stepProgress?: Map<string, string>;
  stepToolActivity?: Map<string, ToolActivity[]>;
}

const PLAN_STATUS_CONFIG: Record<
  ClaudePlan["status"],
  { label: string; dot: string; bar: string }
> = {
  drafting:  { label: "Drafting",  dot: "bg-bot-amber animate-pulse", bar: "bg-bot-amber/30" },
  reviewing: { label: "Reviewing", dot: "bg-blue-400",                bar: "bg-blue-400/30" },
  executing: { label: "Executing", dot: "bg-bot-accent animate-pulse", bar: "bg-bot-accent/40" },
  completed: { label: "Completed", dot: "bg-bot-green",               bar: "bg-bot-green/30" },
  failed:    { label: "Failed",    dot: "bg-bot-red",                 bar: "bg-bot-red/30" },
  cancelled: { label: "Cancelled", dot: "bg-bot-muted",               bar: "bg-bot-muted/20" },
};

function ProgressBar({ status, steps, plan }: { status: ClaudePlan["status"]; steps: ClaudePlanStep[]; plan: ClaudePlan }) {
  if (!steps.length) return null;
  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const executing = steps.filter((s) => s.status === "executing").length;
  const pct = Math.round((done / total) * 100);

  if (status !== "executing" && status !== "completed" && status !== "failed") return null;

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium text-bot-muted/60">
          {done}/{total} steps complete
          {executing > 0 && ` · ${executing} running`}
          {failed > 0 && ` · ${failed} failed`}
        </span>
        <span className="text-[10px] font-bold text-bot-accent">{pct}%</span>
        {plan.total_cost_usd > 0 && (
          <span className="text-[10px] text-bot-muted/50 ml-2">
            ${plan.total_cost_usd.toFixed(3)} · {((plan.total_input_tokens + plan.total_output_tokens) / 1000).toFixed(1)}k tokens
          </span>
        )}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-bot-elevated">
        {failed > 0 && (
          <div
            className="h-full rounded-full bg-bot-red/60 transition-all duration-500"
            style={{ width: `${Math.round(((done + failed) / total) * 100)}%` }}
          />
        )}
        <div
          className="h-full -mt-1 rounded-full bg-bot-green transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function shouldAutoExpand(step: ClaudePlanStep): boolean {
  return ["executing", "failed", "pending", "approved"].includes(step.status);
}

export function PlanStepList({
  plan,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
  onReorder,
  onEdit,
  onExecute,
  onCancel,
  onRetry,
  onSkip,
  onRollbackStop,
  onRollbackContinue,
  onDelete,
  executing,
  pausedStepId,
  pausedCanRollback,
  stepProgress,
  stepToolActivity,
}: PlanStepListProps) {
  const steps = (plan.steps ?? []).slice().sort((a, b) => a.step_order - b.step_order);
  const hasApproved = steps.some((s) => s.status === "approved");
  const hasPending  = steps.some((s) => s.status === "pending");
  const canExecute  = hasApproved && plan.status === "reviewing" && !executing;
  const cfg = PLAN_STATUS_CONFIG[plan.status];

  const approvedCount = steps.filter((s) => s.status === "approved").length;
  const pendingCount  = steps.filter((s) => s.status === "pending").length;

  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const s of steps) {
      if (shouldAutoExpand(s)) initial.add(s.id);
    }
    return initial;
  });

  const prevStatusRef = useRef<Map<string, ClaudePlanStep["status"]>>(new Map());

  useEffect(() => {
    const prev = prevStatusRef.current;
    let changed = false;
    const next = new Set(expandedSteps);

    for (const step of steps) {
      const oldStatus = prev.get(step.id);
      if (oldStatus !== step.status) {
        if (step.status === "executing" || step.status === "failed") {
          next.add(step.id);
          changed = true;
        }
        if (oldStatus === "executing" && step.status === "completed") {
          next.delete(step.id);
          changed = true;
        }
      }
    }

    const nextPrev = new Map<string, ClaudePlanStep["status"]>();
    for (const step of steps) nextPrev.set(step.id, step.status);
    prevStatusRef.current = nextPrev;

    if (changed) setExpandedSteps(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.map((s) => `${s.id}:${s.status}`).join(",")]);

  const toggleStep = useCallback((stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedSteps(new Set(steps.map((s) => s.id)));
  }, [steps]);

  const collapseAll = useCallback(() => {
    setExpandedSteps(new Set());
  }, []);

  const allExpanded = steps.length > 0 && steps.every((s) => expandedSteps.has(s.id));

  return (
    <div className="flex flex-col gap-3">
      {/* ── Plan header ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-bot-border/40 bg-bot-surface/60 backdrop-blur-sm shadow-elevated overflow-hidden">
        {/* Status bar */}
        <div className={cn("h-0.5 w-full", cfg.bar)} />

        <div className="p-4">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-subtitle font-semibold text-bot-text leading-snug flex-1">
              {plan.goal}
            </h2>
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
              <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
              <span className="text-caption font-medium text-bot-muted">{cfg.label}</span>
            </div>
          </div>

          <ProgressBar status={plan.status} steps={steps} plan={plan} />

          {/* Action row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {hasPending && (
              <>
                <button
                  onClick={onApproveAll}
                  className="flex items-center gap-1.5 rounded-xl border border-bot-green/30 bg-bot-green/10 px-3 py-1.5 text-caption font-semibold text-bot-green hover:bg-bot-green/20 hover:border-bot-green/50 transition-all duration-150"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Approve All
                  {pendingCount > 0 && (
                    <span className="ml-0.5 rounded-full bg-bot-green/20 px-1.5 text-[10px] font-bold">
                      {pendingCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={onRejectAll}
                  className="flex items-center gap-1.5 rounded-xl border border-bot-red/30 bg-bot-red/10 px-3 py-1.5 text-caption font-semibold text-bot-red hover:bg-bot-red/20 hover:border-bot-red/50 transition-all duration-150"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Reject All
                </button>
              </>
            )}

            {canExecute && (
              <button
                onClick={onExecute}
                className="flex items-center gap-1.5 rounded-xl gradient-accent px-4 py-1.5 text-caption font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.97] transition-all duration-200"
              >
                <Zap className="h-3.5 w-3.5" />
                Execute
                {approvedCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-white/20 px-1.5 text-[10px] font-bold">
                    {approvedCount}
                  </span>
                )}
              </button>
            )}

            {executing && (
              <div className="flex items-center gap-1.5 rounded-xl border border-bot-accent/20 bg-bot-accent/8 px-3 py-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-bot-accent" />
                <span className="text-caption font-medium text-bot-accent">Running…</span>
              </div>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {steps.length > 0 && (
                <button
                  onClick={allExpanded ? collapseAll : expandAll}
                  className="flex items-center gap-1.5 rounded-xl border border-bot-border/40 px-3 py-1.5 text-caption text-bot-muted hover:border-bot-accent/30 hover:text-bot-text transition-all duration-150"
                  title={allExpanded ? "Collapse all steps" : "Expand all steps"}
                >
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                  {allExpanded ? "Collapse All" : "Expand All"}
                </button>
              )}
              {(plan.status === "reviewing" || plan.status === "executing") && (
                <button
                  onClick={onCancel}
                  className="flex items-center gap-1.5 rounded-xl border border-bot-border/50 px-3 py-1.5 text-caption text-bot-muted hover:border-bot-red/40 hover:text-bot-red transition-all duration-150"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
              )}
              {onDelete && !executing && (
                <button
                  onClick={onDelete}
                  className="flex h-7 w-7 items-center justify-center rounded-xl border border-bot-border/40 text-bot-muted/50 hover:border-bot-red/40 hover:text-bot-red transition-all duration-150"
                  title="Delete plan"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Steps ──────────────────────────────────────────────────────── */}
      {steps.length === 0 ? (
        <p className="py-8 text-center text-body text-bot-muted/50">No steps yet.</p>
      ) : (
        <div className="relative flex flex-col">
          {/* Vertical connector line */}
          <div className="absolute left-[19px] top-8 bottom-8 w-px bg-bot-border/40 pointer-events-none" />

          {steps.map((step: ClaudePlanStep, idx: number) => {
            const progress = stepProgress?.get(step.id);
            return (
              <div key={step.id} className="flex flex-col">
                <PlanStepCard
                  step={step}
                  stepNumber={idx + 1}
                  isFirst={idx === 0}
                  isLast={idx === steps.length - 1}
                  totalSteps={steps.length}
                  expanded={expandedSteps.has(step.id)}
                  onToggleExpand={() => toggleStep(step.id)}
                  onApprove={() => onApprove(step.id)}
                  onReject={() => onReject(step.id)}
                  onMoveUp={() => {
                    if (idx === 0) return;
                    const prev = steps[idx - 1];
                    onReorder(step.id, prev.step_order);
                    onReorder(prev.id, step.step_order);
                  }}
                  onMoveDown={() => {
                    if (idx === steps.length - 1) return;
                    const next = steps[idx + 1];
                    onReorder(step.id, next.step_order);
                    onReorder(next.id, step.step_order);
                  }}
                  onEdit={(summary, details) => onEdit(step.id, summary, details)}
                  onRetry={pausedStepId === step.id ? onRetry : undefined}
                  onSkip={pausedStepId === step.id ? onSkip : undefined}
                  onRollbackStop={pausedStepId === step.id ? onRollbackStop : undefined}
                  onRollbackContinue={pausedStepId === step.id ? onRollbackContinue : undefined}
                  paused={pausedStepId === step.id}
                  canRollback={pausedStepId === step.id ? pausedCanRollback : false}
                  stepProgress={progress}
                  toolActivity={stepToolActivity?.get(step.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

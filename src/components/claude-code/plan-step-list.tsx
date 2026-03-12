"use client";

import { Play, X, CheckCheck, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudePlan, ClaudePlanStep } from "@/lib/claude-db";
import { PlanStepCard } from "./plan-step-card";

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
  executing: boolean;
  pausedStepId?: string | null;
  pausedCanRollback?: boolean;
}

const PLAN_STATUS_CONFIG: Record<
  ClaudePlan["status"],
  { label: string; className: string }
> = {
  drafting: { label: "Drafting", className: "bg-bot-amber/15 text-bot-amber border border-bot-amber/30" },
  reviewing: { label: "Reviewing", className: "bg-blue-500/15 text-blue-400 border border-blue-500/30" },
  executing: { label: "Executing", className: "bg-bot-accent/15 text-bot-accent border border-bot-accent/30" },
  completed: { label: "Completed", className: "bg-bot-green/15 text-bot-green border border-bot-green/30" },
  failed: { label: "Failed", className: "bg-bot-red/15 text-bot-red border border-bot-red/30" },
  cancelled: { label: "Cancelled", className: "bg-bot-elevated text-bot-muted border border-bot-border" },
};

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
  executing,
  pausedStepId,
  pausedCanRollback,
}: PlanStepListProps) {
  const steps = (plan.steps ?? []).slice().sort((a, b) => a.step_order - b.step_order);
  const hasApproved = steps.some((s) => s.status === "approved");
  const hasPending = steps.some((s) => s.status === "pending");
  const canExecute = hasApproved && plan.status === "reviewing" && !executing;
  const statusCfg = PLAN_STATUS_CONFIG[plan.status];

  return (
    <div className="flex flex-col gap-4">
      {/* Plan header */}
      <div className="flex flex-col gap-2 rounded-lg border border-bot-border bg-bot-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-subtitle font-semibold text-bot-text leading-snug">
            {plan.goal}
          </h2>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-caption font-medium",
              statusCfg.className,
            )}
          >
            {statusCfg.label}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {hasPending && (
            <>
              <button
                onClick={onApproveAll}
                className="flex items-center gap-1.5 rounded bg-bot-green/15 px-3 py-1.5 text-caption font-medium text-bot-green hover:bg-bot-green/25 transition-colors"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Approve All
              </button>
              <button
                onClick={onRejectAll}
                className="flex items-center gap-1.5 rounded bg-bot-red/15 px-3 py-1.5 text-caption font-medium text-bot-red hover:bg-bot-red/25 transition-colors"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject All
              </button>
            </>
          )}

          {canExecute && (
            <button
              onClick={onExecute}
              className="flex items-center gap-1.5 rounded bg-bot-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-bot-accent/80 transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
              Execute Approved Steps
            </button>
          )}

          {executing && (
            <div className="flex items-center gap-1.5 text-caption text-bot-accent">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Executing plan…
            </div>
          )}

          {(plan.status === "reviewing" || plan.status === "executing") && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 rounded border border-bot-border px-3 py-1.5 text-caption text-bot-muted hover:text-bot-red hover:border-bot-red/40 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Cancel Plan
            </button>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-2">
        {steps.length === 0 ? (
          <p className="text-center text-body text-bot-muted py-8">No steps generated yet.</p>
        ) : (
          steps.map((step: ClaudePlanStep, idx: number) => (
            <PlanStepCard
              key={step.id}
              step={step}
              stepNumber={idx + 1}
              isFirst={idx === 0}
              isLast={idx === steps.length - 1}
              totalSteps={steps.length}
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
            />
          ))
        )}
      </div>
    </div>
  );
}

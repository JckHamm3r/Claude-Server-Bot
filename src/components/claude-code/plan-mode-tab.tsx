"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { Loader2, Plus, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudePlan } from "@/lib/claude-db";
import { PlanStepList } from "./plan-step-list";

type PlanMap = Map<string, ClaudePlan>;

export function PlanModeTab() {
  const [connected, setConnected] = useState(false);
  const [plans, setPlans] = useState<PlanMap>(new Map());
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [pausedStepId, setPausedStepId] = useState<string | null>(null);
  const [pausedCanRollback, setPausedCanRollback] = useState(false);
  const [goal, setGoal] = useState("");
  const [sessionId] = useState(() => `plan-session-${crypto.randomUUID()}`);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  const activePlan = activePlanId ? plans.get(activePlanId) ?? null : null;

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  const upsertPlan = useCallback((plan: ClaudePlan) => {
    setPlans((prev) => {
      const next = new Map(prev);
      next.set(plan.id, plan);
      return next;
    });
  }, []);

  useEffect(() => {
    socketRef.current = getSocket();
    const socket = socketRef.current;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("claude:list_plans", { sessionId });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on(
      "claude:plans",
      ({ plans: incoming }: { sessionId: string; plans: ClaudePlan[] }) => {
        setPlans((prev) => {
          const next = new Map(prev);
          for (const p of incoming) {
            next.set(p.id, p);
          }
          return next;
        });
      },
    );

    socket.on("claude:plan_generated", ({ plan }: { plan: ClaudePlan }) => {
      setGenerating(false);
      upsertPlan(plan);
      setActivePlanId(plan.id);
    });

    socket.on("claude:plan_updated", ({ plan }: { plan: ClaudePlan }) => {
      upsertPlan(plan);
      if (plan.id === activePlanId) {
        // keep active
      }
    });

    socket.on("claude:plan_executing", ({ planId }: { planId: string }) => {
      setExecuting(true);
      setPlans((prev) => {
        const p = prev.get(planId);
        if (!p) return prev;
        const next = new Map(prev);
        next.set(planId, { ...p, status: "executing" });
        return next;
      });
    });

    socket.on("claude:plan_completed", ({ plan }: { plan: ClaudePlan }) => {
      setExecuting(false);
      setPausedStepId(null);
      upsertPlan(plan);
    });

    socket.on(
      "claude:plan_paused",
      ({ stepId, canRollback }: { planId: string; stepId: string; error: string; canRollback?: boolean }) => {
        setExecuting(false);
        setPausedStepId(stepId);
        setPausedCanRollback(canRollback ?? false);
      },
    );

    socket.on(
      "claude:step_executing",
      ({ planId, stepId }: { planId: string; stepId: string }) => {
        setPlans((prev) => {
          const p = prev.get(planId);
          if (!p || !p.steps) return prev;
          const next = new Map(prev);
          next.set(planId, {
            ...p,
            steps: p.steps.map((s) =>
              s.id === stepId ? { ...s, status: "executing" as const } : s,
            ),
          });
          return next;
        });
      },
    );

    socket.on(
      "claude:step_completed",
      ({ planId, stepId, result }: { planId: string; stepId: string; result: string }) => {
        setPlans((prev) => {
          const p = prev.get(planId);
          if (!p || !p.steps) return prev;
          const next = new Map(prev);
          next.set(planId, {
            ...p,
            steps: p.steps.map((s) =>
              s.id === stepId ? { ...s, status: "completed" as const, result } : s,
            ),
          });
          return next;
        });
      },
    );

    socket.on(
      "claude:step_failed",
      ({ planId, stepId, error }: { planId: string; stepId: string; error: string }) => {
        setPlans((prev) => {
          const p = prev.get(planId);
          if (!p || !p.steps) return prev;
          const next = new Map(prev);
          next.set(planId, {
            ...p,
            steps: p.steps.map((s) =>
              s.id === stepId ? { ...s, status: "failed" as const, error } : s,
            ),
          });
          return next;
        });
      },
    );

    socket.on("claude:error", ({ message }: { message: string }) => {
      setGenerating(false);
      setExecuting(false);
      console.error("[plan-mode] socket error:", message);
    });

    if (socket.connected) {
      setConnected(true);
      socket.emit("claude:list_plans", { sessionId });
    }

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("claude:plans");
      socket.off("claude:plan_generated");
      socket.off("claude:plan_updated");
      socket.off("claude:plan_executing");
      socket.off("claude:plan_completed");
      socket.off("claude:plan_paused");
      socket.off("claude:step_executing");
      socket.off("claude:step_completed");
      socket.off("claude:step_failed");
      socket.off("claude:error");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep plan_updated handler's activePlanId reference current
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handler = ({ plan }: { plan: ClaudePlan }) => {
      upsertPlan(plan);
    };
    socket.off("claude:plan_updated");
    socket.on("claude:plan_updated", handler);
    return () => {
      socket.off("claude:plan_updated", handler);
    };
  }, [activePlanId, upsertPlan]);

  const handleGeneratePlan = useCallback(() => {
    if (!goal.trim() || generating) return;
    setGenerating(true);
    emit("claude:generate_plan", { sessionId, goal: goal.trim() });
    setGoal("");
  }, [goal, generating, emit, sessionId]);

  const handleApprove = useCallback((stepId: string) => {
    if (!activePlanId) return;
    emit("claude:approve_step", { stepId, planId: activePlanId });
  }, [activePlanId, emit]);

  const handleReject = useCallback((stepId: string) => {
    if (!activePlanId) return;
    emit("claude:reject_step", { stepId, planId: activePlanId });
  }, [activePlanId, emit]);

  const handleApproveAll = useCallback(() => {
    if (!activePlanId) return;
    emit("claude:approve_all_steps", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleRejectAll = useCallback(() => {
    if (!activePlanId) return;
    emit("claude:reject_all_steps", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleReorder = useCallback((stepId: string, newOrder: number) => {
    if (!activePlanId) return;
    emit("claude:reorder_step", { stepId, planId: activePlanId, newOrder });
  }, [activePlanId, emit]);

  const handleEdit = useCallback((stepId: string, summary: string, details: string) => {
    if (!activePlanId) return;
    emit("claude:edit_step", { stepId, planId: activePlanId, summary, details });
  }, [activePlanId, emit]);

  const handleExecute = useCallback(() => {
    if (!activePlanId) return;
    setExecuting(true);
    emit("claude:execute_plan", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleCancel = useCallback(() => {
    if (!activePlanId) return;
    setExecuting(false);
    setPausedStepId(null);
    setPausedCanRollback(false);
    emit("claude:cancel_plan", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleRetry = useCallback(() => {
    if (!activePlanId) return;
    setExecuting(true);
    setPausedStepId(null);
    setPausedCanRollback(false);
    emit("claude:resume_plan", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleSkip = useCallback(() => {
    if (!activePlanId) return;
    setExecuting(true);
    setPausedStepId(null);
    setPausedCanRollback(false);
    emit("claude:skip_step", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleRollbackStop = useCallback(() => {
    if (!activePlanId) return;
    setExecuting(false);
    setPausedStepId(null);
    setPausedCanRollback(false);
    emit("claude:rollback_stop", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleRollbackContinue = useCallback(() => {
    if (!activePlanId) return;
    setExecuting(true);
    setPausedStepId(null);
    setPausedCanRollback(false);
    emit("claude:rollback_continue", { planId: activePlanId });
  }, [activePlanId, emit]);

  const planList = Array.from(plans.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: plan history */}
      <div className="flex w-56 shrink-0 flex-col border-r border-bot-border bg-bot-surface">
        <div className="flex items-center justify-between px-3 py-3 border-b border-bot-border">
          <span className="text-caption font-semibold text-bot-muted uppercase tracking-wide">
            Plans
          </span>
          <button
            onClick={() => setActivePlanId(null)}
            className="rounded p-1 text-bot-muted hover:text-bot-text transition-colors"
            title="New plan"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {planList.length === 0 ? (
            <p className="px-3 py-4 text-caption text-bot-muted text-center">
              No plans yet
            </p>
          ) : (
            planList.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setActivePlanId(plan.id)}
                className={cn(
                  "w-full px-3 py-2 text-left transition-colors hover:bg-bot-elevated",
                  activePlanId === plan.id && "bg-bot-elevated",
                )}
              >
                <p className="line-clamp-2 text-caption font-medium text-bot-text leading-snug">
                  {plan.goal}
                </p>
                <p className="mt-0.5 text-caption text-bot-muted capitalize">
                  {plan.status}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 flex-col overflow-hidden bg-bot-bg">
        {!connected && (
          <div className="px-4 py-2 text-caption text-bot-amber border-b border-bot-border bg-bot-amber/5">
            Connecting to server…
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {!activePlan ? (
            /* Goal input area */
            <div className="flex flex-col items-center justify-center min-h-full gap-6 py-12">
              <div className="flex flex-col items-center gap-2 text-bot-muted">
                <ClipboardList className="h-10 w-10 opacity-40" />
                <p className="text-subtitle font-medium text-bot-text">Plan Mode</p>
                <p className="text-body text-bot-muted text-center max-w-sm">
                  Describe a development goal and Claude will generate a step-by-step plan for
                  you to review and approve before execution.
                </p>
              </div>

              <div className="w-full max-w-xl flex flex-col gap-3">
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleGeneratePlan();
                    }
                  }}
                  disabled={generating}
                  rows={4}
                  placeholder="e.g. Add a dark mode toggle to the sidebar and persist the preference in localStorage"
                  className="w-full rounded-lg border border-bot-border bg-bot-surface px-4 py-3 text-body text-bot-text placeholder:text-bot-muted focus:border-bot-accent focus:outline-none resize-none disabled:opacity-60"
                />

                <button
                  onClick={handleGeneratePlan}
                  disabled={!goal.trim() || generating || !connected}
                  className="self-end flex items-center gap-2 rounded-lg bg-bot-accent px-5 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    "Generate Plan"
                  )}
                </button>

                {generating && (
                  <p className="text-center text-caption text-bot-muted">
                    Claude is drafting your plan…
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* Plan display */
            <PlanStepList
              plan={activePlan}
              onApprove={handleApprove}
              onReject={handleReject}
              onApproveAll={handleApproveAll}
              onRejectAll={handleRejectAll}
              onReorder={handleReorder}
              onEdit={handleEdit}
              onExecute={handleExecute}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onSkip={handleSkip}
              onRollbackStop={handleRollbackStop}
              onRollbackContinue={handleRollbackContinue}
              executing={executing}
              pausedStepId={pausedStepId}
              pausedCanRollback={pausedCanRollback}
            />
          )}
        </div>
      </div>
    </div>
  );
}

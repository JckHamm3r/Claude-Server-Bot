"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import {
  Loader2,
  Plus,
  ClipboardList,
  AlertCircle,
  X,
  Send,
  ChevronDown,
} from "lucide-react";
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
  // Use a stable per-browser session ID so plans persist across page refreshes.
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return `plan-session-${crypto.randomUUID()}`;
    const stored = localStorage.getItem("plan-mode-session-id");
    if (stored) return stored;
    const id = `plan-session-${crypto.randomUUID()}`;
    localStorage.setItem("plan-mode-session-id", id);
    return id;
  });

  const [planError, setPlanError] = useState<string | null>(null);
  const [generatingProgress, setGeneratingProgress] = useState("");
  const [stepProgress, setStepProgress] = useState<Map<string, string>>(
    new Map(),
  );
  const [refineInput, setRefineInput] = useState("");
  const [showThinking, setShowThinking] = useState(false);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const progressRef = useRef<HTMLPreElement>(null);

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
      setGeneratingProgress("");
      upsertPlan(plan);
      setActivePlanId(plan.id);
    });

    socket.on("claude:plan_updated", ({ plan }: { plan: ClaudePlan }) => {
      upsertPlan(plan);
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
      ({
        stepId,
        canRollback,
      }: {
        planId: string;
        stepId: string;
        error: string;
        canRollback?: boolean;
      }) => {
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
      ({
        planId,
        stepId,
        result,
      }: {
        planId: string;
        stepId: string;
        result: string;
      }) => {
        setPlans((prev) => {
          const p = prev.get(planId);
          if (!p || !p.steps) return prev;
          const next = new Map(prev);
          next.set(planId, {
            ...p,
            steps: p.steps.map((s) =>
              s.id === stepId
                ? { ...s, status: "completed" as const, result }
                : s,
            ),
          });
          return next;
        });
        setStepProgress((prev) => {
          if (!prev.has(stepId)) return prev;
          const next = new Map(prev);
          next.delete(stepId);
          return next;
        });
      },
    );

    socket.on(
      "claude:step_failed",
      ({
        planId,
        stepId,
        error,
      }: {
        planId: string;
        stepId: string;
        error: string;
      }) => {
        setPlans((prev) => {
          const p = prev.get(planId);
          if (!p || !p.steps) return prev;
          const next = new Map(prev);
          next.set(planId, {
            ...p,
            steps: p.steps.map((s) =>
              s.id === stepId
                ? { ...s, status: "failed" as const, error }
                : s,
            ),
          });
          return next;
        });
        setStepProgress((prev) => {
          if (!prev.has(stepId)) return prev;
          const next = new Map(prev);
          next.delete(stepId);
          return next;
        });
      },
    );

    socket.on(
      "claude:plan_progress",
      ({ content }: { planId: string; content: string }) => {
        setGeneratingProgress(content);
      },
    );

    socket.on(
      "claude:step_progress",
      ({
        stepId,
        content,
      }: {
        planId: string;
        stepId: string;
        content: string;
      }) => {
        setStepProgress((prev) => {
          const next = new Map(prev);
          next.set(stepId, content);
          return next;
        });
      },
    );

    socket.on("claude:plan_deleted", ({ planId }: { planId: string }) => {
      setPlans((prev) => {
        const next = new Map(prev);
        next.delete(planId);
        return next;
      });
      setActivePlanId((prev) => (prev === planId ? null : prev));
    });

    socket.on("claude:error", ({ message }: { message: string }) => {
      setGenerating(false);
      setExecuting(false);
      setGeneratingProgress("");
      setPlanError(message);
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
      socket.off("claude:plan_progress");
      socket.off("claude:step_progress");
      socket.off("claude:plan_deleted");
      socket.off("claude:error");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.scrollTop = progressRef.current.scrollHeight;
    }
  }, [generatingProgress]);

  const handleGeneratePlan = useCallback(() => {
    if (!goal.trim() || generating) return;
    setGenerating(true);
    setGeneratingProgress("");
    setPlanError(null);
    setShowThinking(false);
    emit("claude:generate_plan", { sessionId, goal: goal.trim() });
    setGoal("");
  }, [goal, generating, emit, sessionId]);

  const handleApprove = useCallback(
    (stepId: string) => {
      if (!activePlanId) return;
      emit("claude:approve_step", { stepId, planId: activePlanId });
    },
    [activePlanId, emit],
  );

  const handleReject = useCallback(
    (stepId: string) => {
      if (!activePlanId) return;
      emit("claude:reject_step", { stepId, planId: activePlanId });
    },
    [activePlanId, emit],
  );

  const handleApproveAll = useCallback(() => {
    if (!activePlanId) return;
    emit("claude:approve_all_steps", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleRejectAll = useCallback(() => {
    if (!activePlanId) return;
    emit("claude:reject_all_steps", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleReorder = useCallback(
    (stepId: string, newOrder: number) => {
      if (!activePlanId) return;
      emit("claude:reorder_step", {
        stepId,
        planId: activePlanId,
        newOrder,
      });
    },
    [activePlanId, emit],
  );

  const handleEdit = useCallback(
    (stepId: string, summary: string, details: string) => {
      if (!activePlanId) return;
      emit("claude:edit_step", {
        stepId,
        planId: activePlanId,
        summary,
        details,
      });
    },
    [activePlanId, emit],
  );

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

  const handleRefinePlan = useCallback(() => {
    if (!activePlanId || !refineInput.trim() || generating) return;
    setGenerating(true);
    setGeneratingProgress("");
    setPlanError(null);
    setShowThinking(false);
    emit("claude:refine_plan", {
      planId: activePlanId,
      instruction: refineInput.trim(),
    });
    setRefineInput("");
  }, [activePlanId, refineInput, generating, emit]);

  const handleDeletePlan = useCallback(() => {
    if (!activePlanId) return;
    emit("claude:delete_plan", { planId: activePlanId });
  }, [activePlanId, emit]);

  const handleDismissError = useCallback(() => {
    setPlanError(null);
  }, []);

  const planList = Array.from(plans.values()).sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: plan history */}
      <div className="flex w-56 shrink-0 flex-col border-r border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm">
        <div className="flex items-center justify-between px-3 py-3 border-b border-bot-border/30">
          <span className="text-caption font-semibold text-bot-muted uppercase tracking-wider">
            Plans
          </span>
          <button
            onClick={() => setActivePlanId(null)}
            className="rounded-lg p-1.5 text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-all duration-200"
            title="New plan"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {planList.length === 0 ? (
            <div className="flex flex-col items-center py-8 px-3">
              <ClipboardList className="h-8 w-8 text-bot-muted/20 mb-2" />
              <p className="text-caption text-bot-muted text-center">No plans yet</p>
            </div>
          ) : (
            planList.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setActivePlanId(plan.id)}
                className={cn(
                  "w-full px-3 py-2.5 mx-1 rounded-lg text-left transition-all duration-200 hover:bg-bot-elevated/40",
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
          <div className="px-4 py-2.5 text-caption text-bot-amber border-b border-bot-border/30 bg-bot-amber/5 backdrop-blur-sm">
            Connecting to server...
          </div>
        )}

        {planError && (
          <div className="flex items-start gap-2 px-4 py-2.5 border-b border-bot-red/20 bg-bot-red/5">
            <AlertCircle className="h-4 w-4 text-bot-red shrink-0 mt-0.5" />
            <p className="flex-1 text-caption text-bot-red">{planError}</p>
            <button
              onClick={handleDismissError}
              className="rounded-lg p-1 text-bot-red hover:text-bot-red/70 transition-all duration-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {!activePlan ? (
            <div className="flex flex-col items-center justify-center min-h-full gap-6 py-12 animate-fadeUp">
              <div className="flex flex-col items-center gap-3 text-bot-muted">
                <div className="relative">
                  <div className="absolute -inset-4 rounded-full bg-bot-accent/5 blur-xl" />
                  <ClipboardList className="relative h-12 w-12 text-bot-muted/30" />
                </div>
                <p className="text-title font-bold text-bot-text">
                  Plan Mode
                </p>
                <p className="text-body text-bot-muted text-center max-w-sm">
                  Describe a development goal and Claude will generate a
                  step-by-step plan for you to review and approve before
                  execution.
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
                  className="w-full rounded-xl border border-bot-border/40 bg-bot-surface/60 backdrop-blur-sm px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/50 focus:border-bot-accent/50 focus:shadow-glow-sm focus:outline-none resize-none disabled:opacity-60 transition-all duration-200"
                />

                <button
                  onClick={handleGeneratePlan}
                  disabled={!goal.trim() || generating || !connected}
                  className="self-end flex items-center gap-2 rounded-xl gradient-accent px-6 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
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
                  <div className="flex flex-col gap-2">
                    <p className="text-center text-caption text-bot-muted">
                      Claude is drafting your plan…
                    </p>

                    {generatingProgress && (
                      <div className="rounded-lg border border-bot-border bg-bot-surface overflow-hidden">
                        <button
                          onClick={() => setShowThinking((v) => !v)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-caption text-bot-muted hover:text-bot-text transition-colors"
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform",
                              !showThinking && "-rotate-90",
                            )}
                          />
                          Claude is thinking…
                        </button>
                        {showThinking && (
                          <pre
                            ref={progressRef}
                            className="max-h-48 overflow-auto border-t border-bot-border px-3 py-2 font-mono text-caption text-bot-muted whitespace-pre-wrap break-words"
                          >
                            {generatingProgress}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
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
                stepProgress={stepProgress}
                onDelete={handleDeletePlan}
              />

              {generating && generatingProgress && (
                <div className="rounded-lg border border-bot-border bg-bot-surface overflow-hidden">
                  <button
                    onClick={() => setShowThinking((v) => !v)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-caption text-bot-muted hover:text-bot-text transition-colors"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="flex-1 text-left">
                      Claude is thinking…
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        !showThinking && "-rotate-90",
                      )}
                    />
                  </button>
                  {showThinking && (
                    <pre
                      ref={progressRef}
                      className="max-h-48 overflow-auto border-t border-bot-border px-3 py-2 font-mono text-caption text-bot-muted whitespace-pre-wrap break-words"
                    >
                      {generatingProgress}
                    </pre>
                  )}
                </div>
              )}

              {activePlan.status === "reviewing" && !executing && (
                <div className="flex items-center gap-2 rounded-xl border border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm px-4 py-2.5 focus-within:border-bot-accent/40 focus-within:shadow-glow-sm transition-all duration-200">
                  <input
                    type="text"
                    value={refineInput}
                    onChange={(e) => setRefineInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleRefinePlan();
                      }
                    }}
                    disabled={generating}
                    placeholder="Refine this plan... e.g. 'Add a testing step' or 'Combine steps 2 and 3'"
                    className="flex-1 bg-transparent text-body text-bot-text placeholder:text-bot-muted/50 focus:outline-none disabled:opacity-60"
                  />
                  <button
                    onClick={handleRefinePlan}
                    disabled={!refineInput.trim() || generating}
                    className="rounded-lg p-2 text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                    title="Refine plan"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin text-bot-accent" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

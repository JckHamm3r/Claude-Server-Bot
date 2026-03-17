"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import {
  Loader2,
  Plus,
  Sparkles,
  AlertCircle,
  X,
  Send,
  ChevronDown,
  ListChecks,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudePlan } from "@/lib/claude-db";
import { PlanStepList } from "./plan-step-list";

type PlanMap = Map<string, ClaudePlan>;

const PLAN_STATUS_DOT: Record<ClaudePlan["status"], string> = {
  drafting: "bg-bot-amber animate-pulse",
  reviewing: "bg-blue-400",
  executing: "bg-bot-accent animate-pulse",
  completed: "bg-bot-green",
  failed: "bg-bot-red",
  cancelled: "bg-bot-muted",
};

export function PlanModeTab() {
  const [connected, setConnected] = useState(false);
  const [plans, setPlans] = useState<PlanMap>(new Map());
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [pausedStepId, setPausedStepId] = useState<string | null>(null);
  const [pausedCanRollback, setPausedCanRollback] = useState(false);
  const [goal, setGoal] = useState("");
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
  const [stepProgress, setStepProgress] = useState<Map<string, string>>(new Map());
  const [refineInput, setRefineInput] = useState("");
  const [showThinking, setShowThinking] = useState(false);

  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const progressRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
          for (const p of incoming) next.set(p.id, p);
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
      ({ stepId, content }: { planId: string; stepId: string; content: string }) => {
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
    const handler = ({ plan }: { plan: ClaudePlan }) => { upsertPlan(plan); };
    socket.off("claude:plan_updated");
    socket.on("claude:plan_updated", handler);
    return () => { socket.off("claude:plan_updated", handler); };
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

  const handleRefinePlan = useCallback(() => {
    if (!activePlanId || !refineInput.trim() || generating) return;
    setGenerating(true);
    setGeneratingProgress("");
    setPlanError(null);
    setShowThinking(false);
    emit("claude:refine_plan", { planId: activePlanId, instruction: refineInput.trim() });
    setRefineInput("");
  }, [activePlanId, refineInput, generating, emit]);

  const handleDeletePlan = useCallback(() => {
    if (!activePlanId) return;
    emit("claude:delete_plan", { planId: activePlanId });
  }, [activePlanId, emit]);

  const planList = Array.from(plans.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm">
        <div className="flex items-center justify-between px-3 pt-4 pb-2">
          <span className="text-caption font-bold uppercase tracking-widest text-bot-muted/70">
            Plans
          </span>
          <button
            onClick={() => setActivePlanId(null)}
            title="New plan"
            className="group flex h-6 w-6 items-center justify-center rounded-lg text-bot-muted transition-all duration-150 hover:bg-bot-accent/15 hover:text-bot-accent"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 pb-3 space-y-0.5">
          {planList.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-2 px-3 text-center">
              <ListChecks className="h-7 w-7 text-bot-muted/20" />
              <p className="text-caption text-bot-muted/50">No plans yet</p>
            </div>
          ) : (
            planList.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setActivePlanId(plan.id)}
                className={cn(
                  "group relative w-full rounded-xl px-3 py-2.5 text-left transition-all duration-150",
                  activePlanId === plan.id
                    ? "bg-bot-accent/10 shadow-glow-sm"
                    : "hover:bg-bot-elevated/50",
                )}
              >
                {activePlanId === plan.id && (
                  <span className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-bot-accent" />
                )}
                <p className={cn(
                  "line-clamp-2 text-caption font-medium leading-snug",
                  activePlanId === plan.id ? "text-bot-text" : "text-bot-muted group-hover:text-bot-text/80",
                )}>
                  {plan.goal}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", PLAN_STATUS_DOT[plan.status])} />
                  <span className="text-[10px] font-medium capitalize text-bot-muted/60">
                    {plan.status}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Main panel ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-bot-bg">

        {/* Connection / error banners */}
        {!connected && (
          <div className="flex items-center gap-2 border-b border-bot-amber/20 bg-bot-amber/5 px-4 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-bot-amber animate-pulse" />
            <span className="text-caption text-bot-amber/80">Connecting…</span>
          </div>
        )}

        {planError && (
          <div className="flex items-center gap-2.5 border-b border-bot-red/20 bg-bot-red/5 px-4 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-bot-red" />
            <p className="flex-1 text-caption text-bot-red/90">{planError}</p>
            <button
              onClick={() => setPlanError(null)}
              className="rounded-md p-0.5 text-bot-red/60 hover:text-bot-red transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {!activePlan ? (
            /* ── New plan / empty state ──────────────────────────────── */
            <div className="flex min-h-full flex-col items-center justify-center px-6 py-8 animate-fadeUp">
              {/* Hero */}
              <div className="mb-6 flex flex-col items-center gap-3 text-center">
                <div className="relative">
                  <div className="absolute -inset-5 rounded-full bg-bot-accent/8 blur-2xl" />
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-bot-accent/20 bg-bot-surface shadow-glow-sm">
                    <Zap className="h-6 w-6 text-bot-accent" />
                  </div>
                </div>
                <div>
                  <h2 className="text-title font-bold text-bot-text">Plan Mode</h2>
                  <p className="mt-1 max-w-sm text-body text-bot-muted">
                    Describe a goal — Claude generates a step-by-step plan for you to review, tweak, and execute.
                  </p>
                </div>
              </div>

              {/* Input card */}
              <div className="w-full max-w-2xl">
                <div className={cn(
                  "rounded-2xl border bg-bot-surface/60 backdrop-blur-sm shadow-elevated transition-all duration-200",
                  goal.trim() ? "border-bot-accent/30 shadow-glow-sm" : "border-bot-border/40",
                )}>
                  <textarea
                    ref={textareaRef}
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
                    placeholder="e.g. Add dark mode to the sidebar and persist the preference in localStorage…"
                    className="w-full resize-none rounded-t-2xl bg-transparent px-5 py-4 text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none disabled:opacity-50"
                  />
                  <div className="flex items-center justify-between border-t border-bot-border/30 px-4 py-2.5">
                    <span className="text-caption text-bot-muted/40">
                      {goal.length > 0 ? `${goal.length} chars` : "⌘↩ to generate"}
                    </span>
                    <button
                      onClick={handleGeneratePlan}
                      disabled={!goal.trim() || generating || !connected}
                      className="flex items-center gap-2 rounded-xl gradient-accent px-5 py-2 text-caption font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {generating ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
                      ) : (
                        <><Sparkles className="h-3.5 w-3.5" /> Generate Plan</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Thinking block */}
                {generating && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-bot-border/30 bg-bot-surface/40 backdrop-blur-sm animate-fadeUp">
                    <button
                      onClick={() => setShowThinking((v) => !v)}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-caption text-bot-muted hover:text-bot-text/70 transition-colors"
                    >
                      <Loader2 className="h-3 w-3 animate-spin text-bot-accent" />
                      <span className="flex-1 text-left">Claude is thinking…</span>
                      <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", showThinking && "rotate-180")} />
                    </button>
                    {showThinking && generatingProgress && (
                      <pre
                        ref={progressRef}
                        className="max-h-40 overflow-auto border-t border-bot-border/20 px-4 py-3 font-mono text-[11px] leading-relaxed text-bot-muted/70 whitespace-pre-wrap break-words"
                      >
                        {generatingProgress}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              {/* Example prompts */}
              {!generating && (
                <div className="mt-4 flex flex-wrap justify-center gap-2 animate-fadeUp" style={{ animationDelay: "0.1s" }}>
                  {[
                    "Add user authentication",
                    "Write unit tests for the API",
                    "Set up a CI/CD pipeline",
                    "Refactor the database schema",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => { setGoal(suggestion); textareaRef.current?.focus(); }}
                      className="rounded-full border border-bot-border/40 bg-bot-surface/40 px-3 py-1.5 text-caption text-bot-muted hover:border-bot-accent/30 hover:bg-bot-accent/5 hover:text-bot-text transition-all duration-150"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── Active plan view ────────────────────────────────────── */
            <div className="flex flex-col gap-4 p-4 pb-6 animate-fadeUp">
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

              {/* Thinking block during refine */}
              {generating && (
                <div className="overflow-hidden rounded-xl border border-bot-border/30 bg-bot-surface/40 backdrop-blur-sm animate-fadeUp">
                  <button
                    onClick={() => setShowThinking((v) => !v)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-caption text-bot-muted hover:text-bot-text/70 transition-colors"
                  >
                    <Loader2 className="h-3 w-3 animate-spin text-bot-accent" />
                    <span className="flex-1 text-left">Claude is thinking…</span>
                    <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", showThinking && "rotate-180")} />
                  </button>
                  {showThinking && generatingProgress && (
                    <pre
                      ref={progressRef}
                      className="max-h-40 overflow-auto border-t border-bot-border/20 px-4 py-3 font-mono text-[11px] leading-relaxed text-bot-muted/70 whitespace-pre-wrap break-words"
                    >
                      {generatingProgress}
                    </pre>
                  )}
                </div>
              )}

              {/* Refine bar */}
              {activePlan.status === "reviewing" && !executing && (
                <div className={cn(
                  "flex items-center gap-3 rounded-2xl border bg-bot-surface/60 backdrop-blur-sm px-4 py-2.5 transition-all duration-200",
                  refineInput.trim() ? "border-bot-accent/30 shadow-glow-sm" : "border-bot-border/30",
                )}>
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-bot-muted/50" />
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
                    placeholder="Refine this plan… e.g. 'Add a rollback step' or 'Merge steps 2 and 3'"
                    className="flex-1 bg-transparent text-body text-bot-text placeholder:text-bot-muted/40 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={handleRefinePlan}
                    disabled={!refineInput.trim() || generating}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-bot-muted hover:bg-bot-accent/15 hover:text-bot-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                    title="Refine plan"
                  >
                    {generating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
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

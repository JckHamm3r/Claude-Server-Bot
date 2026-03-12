"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CheckCircle2, XCircle, Loader2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;

interface ProjectStatus {
  hasClaudeMd: boolean;
  hasClaudeDir: boolean;
  path: string;
}

interface TestResult {
  ok: boolean;
  latency?: number;
  error?: string;
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1: project
  const [projectRoot, setProjectRoot] = useState(process.env.NEXT_PUBLIC_CLAUDE_PROJECT_ROOT ?? "");
  const [projectInput, setProjectInput] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [projectError, setProjectError] = useState("");

  // Step 3: Claude test
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Load initial project status
  useEffect(() => {
    checkProject(projectRoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkProject(path: string) {
    if (!path) return;
    try {
      const res = await fetch("/api/settings/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: path }),
      });
      const data = await res.json();
      if (res.ok) {
        setProjectStatus({ hasClaudeMd: data.hasClaudeMd, hasClaudeDir: data.hasClaudeDir, path });
      }
    } catch {
      // ignore
    }
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projectInput.trim() || savingProject) return;
    setSavingProject(true);
    setProjectError("");
    try {
      const res = await fetch("/api/settings/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: projectInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setProjectRoot(projectInput.trim());
        setProjectInput("");
        setProjectStatus({ hasClaudeMd: data.hasClaudeMd, hasClaudeDir: data.hasClaudeDir, path: projectInput.trim() });
      } else {
        setProjectError(data.error ?? "Failed to update");
      }
    } finally {
      setSavingProject(false);
    }
  }

  async function handleTestClaude() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/claude-code/test");
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function handleComplete() {
    try {
      await fetch("/api/setup/complete", { method: "POST" });
    } catch {
      // ignore
    }
    router.push("/");
  }

  // Determine if step 2 (init) should be shown
  const showInitStep = step === 2 && projectStatus && !projectStatus.hasClaudeMd;

  const steps = [
    { n: 1, label: "Project" },
    { n: 2, label: "Initialize" },
    { n: 3, label: "Test Claude" },
    { n: 4, label: "Done" },
  ];

  // Compute effective steps (skip step 2 if CLAUDE.md exists)
  const skipInit = projectStatus?.hasClaudeMd ?? false;

  function advanceStep(from: Step) {
    if (from === 1) {
      if (skipInit) setStep(3);
      else setStep(2);
    } else if (from === 2) {
      setStep(3);
    } else if (from === 3) {
      setStep(4);
    }
  }

  return (
    <main className="min-h-screen bg-bot-bg flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-full overflow-hidden mb-4">
            <Image unoptimized src="/claude-code.png" alt="Claude" width={56} height={56} className="object-cover" />
          </div>
          <h1 className="text-title font-semibold text-bot-text">Setup Wizard</h1>
          <p className="text-caption text-bot-muted mt-1">Let&apos;s get Claude Server Bot ready</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map(({ n, label }) => {
            const effectiveN = skipInit && n > 1 ? n - 1 : n;
            const effectiveStep = skipInit && step > 1 ? step - 1 : step;
            const isDone = effectiveN < effectiveStep;
            const isActive = n === step;
            return (
              <div key={n} className="flex items-center gap-2">
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-caption font-semibold",
                  isDone ? "bg-bot-accent text-white" : isActive ? "bg-bot-accent/20 text-bot-accent border border-bot-accent" : "bg-bot-elevated text-bot-muted",
                )}>
                  {isDone ? "✓" : n}
                </div>
                <span className={cn("text-caption hidden sm:block", isActive ? "text-bot-text" : "text-bot-muted")}>{label}</span>
                {n < 4 && <div className="w-8 h-px bg-bot-border" />}
              </div>
            );
          })}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-bot-border bg-bot-surface p-8">
          {/* STEP 1: Project */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-subtitle font-semibold text-bot-text mb-1">Project Directory</h2>
                <p className="text-caption text-bot-muted">This is the directory Claude will work in.</p>
              </div>

              <div className="rounded-lg border border-bot-border bg-bot-elevated p-4">
                <p className="text-caption text-bot-muted mb-1">Current directory</p>
                <p className="font-mono text-body text-bot-text">{projectRoot || "Not set"}</p>
                {projectStatus && (
                  <div className="mt-3 flex gap-6 text-caption">
                    <span className={projectStatus.hasClaudeMd ? "text-bot-green" : "text-bot-muted"}>
                      {projectStatus.hasClaudeMd ? "✓" : "✗"} CLAUDE.md
                    </span>
                    <span className={projectStatus.hasClaudeDir ? "text-bot-green" : "text-bot-muted"}>
                      {projectStatus.hasClaudeDir ? "✓" : "✗"} .claude/
                    </span>
                  </div>
                )}
              </div>

              <form onSubmit={handleSaveProject} className="space-y-3">
                <label className="text-caption font-medium text-bot-muted">Change directory (optional)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={projectInput}
                    onChange={(e) => setProjectInput(e.target.value)}
                    placeholder="/home/user/my-project"
                    className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 font-mono text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent"
                  />
                  <button
                    type="submit"
                    disabled={!projectInput.trim() || savingProject}
                    className="rounded-lg border border-bot-border px-3 py-2 text-body text-bot-muted hover:text-bot-text hover:bg-bot-elevated disabled:opacity-50 transition-colors"
                  >
                    {savingProject ? "…" : "Set"}
                  </button>
                </div>
                {projectError && <p className="text-caption text-bot-red">{projectError}</p>}
              </form>

              <button
                onClick={() => advanceStep(1)}
                disabled={!projectRoot}
                className="w-full rounded-lg bg-bot-accent px-4 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
              >
                Next →
              </button>
            </div>
          )}

          {/* STEP 2: Initialize (only shown if no CLAUDE.md) */}
          {step === 2 && showInitStep && (
            <div className="space-y-6">
              <div>
                <h2 className="text-subtitle font-semibold text-bot-text mb-1">Initialize Project</h2>
                <p className="text-caption text-bot-muted">
                  No <code className="font-mono text-bot-amber">CLAUDE.md</code> found. This file helps Claude understand your project.
                </p>
              </div>

              <div className="rounded-lg border border-bot-amber/30 bg-bot-amber/10 p-4">
                <p className="text-body text-bot-amber font-medium mb-1">CLAUDE.md not found</p>
                <p className="text-caption text-bot-muted">
                  Run <code className="font-mono text-bot-text">/init</code> in the chat to let Claude analyze your project and create one automatically.
                </p>
              </div>

              <p className="text-caption text-bot-muted">
                You can skip this and do it later from the Chat tab using the <code className="font-mono text-bot-text">/init</code> command.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => advanceStep(2)}
                  className="text-bot-muted text-body hover:text-bot-text transition-colors"
                >
                  Skip →
                </button>
                <button
                  onClick={() => advanceStep(2)}
                  className="flex-1 rounded-lg bg-bot-accent px-4 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
                >
                  Continue to Test →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Test Claude */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-subtitle font-semibold text-bot-text mb-1">Test Claude</h2>
                <p className="text-caption text-bot-muted">
                  Verify that Claude is authenticated and responding.
                </p>
              </div>

              <div className="flex flex-col items-center gap-4 py-4">
                {!testResult && !testing && (
                  <button
                    onClick={handleTestClaude}
                    className="flex items-center gap-2 rounded-lg bg-bot-accent px-6 py-3 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
                  >
                    <Terminal className="h-4 w-4" />
                    Run Test
                  </button>
                )}

                {testing && (
                  <div className="flex items-center gap-3 text-body text-bot-muted">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Testing Claude…
                  </div>
                )}

                {testResult && (
                  <div className={cn(
                    "w-full rounded-lg p-4 flex items-start gap-3",
                    testResult.ok ? "bg-bot-green/10 border border-bot-green/30" : "bg-bot-red/10 border border-bot-red/30",
                  )}>
                    {testResult.ok ? (
                      <CheckCircle2 className="h-5 w-5 text-bot-green shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-5 w-5 text-bot-red shrink-0 mt-0.5" />
                    )}
                    <div>
                      {testResult.ok ? (
                        <>
                          <p className="text-body font-medium text-bot-green">Claude responded in {testResult.latency}ms</p>
                          <p className="text-caption text-bot-muted mt-0.5">Authentication successful</p>
                        </>
                      ) : (
                        <>
                          <p className="text-body font-medium text-bot-red">Claude is not authenticated</p>
                          {testResult.error && (
                            <p className="text-caption text-bot-muted mt-0.5">{testResult.error}</p>
                          )}
                          <div className="mt-3 rounded bg-bot-elevated px-3 py-2 text-caption font-mono text-bot-text">
                            SSH into your server and run: <span className="text-bot-amber">claude</span>
                          </div>
                          <p className="text-caption text-bot-muted mt-2">Complete the browser login, then retry.</p>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {testResult && (
                  <button
                    onClick={handleTestClaude}
                    className="text-caption text-bot-muted hover:text-bot-text transition-colors"
                  >
                    Retry
                  </button>
                )}
              </div>

              <button
                onClick={() => advanceStep(3)}
                disabled={!testResult?.ok}
                className="w-full rounded-lg bg-bot-accent px-4 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}

          {/* STEP 4: Done */}
          {step === 4 && (
            <div className="space-y-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <CheckCircle2 className="h-16 w-16 text-bot-green" />
                <h2 className="text-subtitle font-semibold text-bot-text">You&apos;re all set!</h2>
              </div>

              <div className="rounded-lg border border-bot-border bg-bot-elevated p-4 text-left space-y-2">
                <p className="text-caption text-bot-muted">Project directory</p>
                <p className="font-mono text-body text-bot-text">{projectRoot}</p>
                {projectStatus && (
                  <div className="flex gap-6 text-caption pt-1">
                    <span className={projectStatus.hasClaudeMd ? "text-bot-green" : "text-bot-muted"}>
                      {projectStatus.hasClaudeMd ? "✓" : "✗"} CLAUDE.md
                    </span>
                    <span className={projectStatus.hasClaudeDir ? "text-bot-green" : "text-bot-muted"}>
                      {projectStatus.hasClaudeDir ? "✓" : "✗"} .claude/
                    </span>
                  </div>
                )}
              </div>

              <button
                onClick={handleComplete}
                className="w-full rounded-lg bg-bot-accent px-4 py-3 text-body font-semibold text-white hover:bg-bot-accent/80 transition-colors"
              >
                Start chatting with Claude →
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

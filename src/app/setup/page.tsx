"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { CheckCircle2, XCircle, Loader2, Terminal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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

function getBasePath() {
  const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
  const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
  return slug ? `/${prefix}/${slug}` : "";
}

const stepVariants = {
  enter: { opacity: 0, x: 20 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

export default function SetupPage() {
  const bp = getBasePath();
  const [step, setStep] = useState<Step>(1);

  const [projectRoot, setProjectRoot] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [projectError, setProjectError] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${bp}/api/bot-identity`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.projectRoot) {
          setProjectRoot(data.projectRoot);
          checkProject(data.projectRoot);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkProject(path: string) {
    if (!path) return;
    try {
      const res = await fetch(`${bp}/api/settings/project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: path }),
      });
      const data = await res.json();
      if (res.ok) {
        setProjectStatus({ hasClaudeMd: data.hasClaudeMd, hasClaudeDir: data.hasClaudeDir, path });
      }
    } catch (err) {
      console.error("[setup] checkProject error:", err);
    }
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projectInput.trim() || savingProject) return;
    setSavingProject(true);
    setProjectError("");
    try {
      const res = await fetch(`${bp}/api/settings/project`, {
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
    } catch (err) {
      setProjectError("Failed to save project: " + String(err));
    } finally {
      setSavingProject(false);
    }
  }

  async function handleTestClaude() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${bp}/api/claude-code/test`);
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
      const res = await fetch(`${bp}/api/setup/complete`, { method: "POST" });
      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error");
        console.error("[setup] complete failed:", res.status, text);
        setError(`Setup completion failed: ${text}`);
        return;
      }
    } catch (err) {
      console.error("[setup] complete error:", err);
      setError("Setup completion failed. Please try again.");
      return;
    }
    window.location.href = bp || "/";
  }

  const showInitStep = step === 2 && projectStatus && !projectStatus.hasClaudeMd;

  const steps = [
    { n: 1, label: "Project" },
    { n: 2, label: "Initialize" },
    { n: 3, label: "Test Claude" },
    { n: 4, label: "Done" },
  ];

  const skipInit = projectStatus?.hasClaudeMd ?? false;

  useEffect(() => {
    if (step === 2 && projectStatus !== null && skipInit) {
      setStep(3);
    }
  }, [step, skipInit, projectStatus]);

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

  const progressPercent = ((step - 1) / 3) * 100;

  return (
    <main className="min-h-screen gradient-mesh-bg flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/5 w-80 h-80 rounded-full bg-bot-accent/5 blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 rounded-full bg-bot-accent-2/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-lg relative z-10"
      >
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-5">
            <div className="absolute -inset-1.5 rounded-full gradient-accent opacity-40 blur-md" />
            <div className="relative h-16 w-16 rounded-full overflow-hidden border-2 border-bot-accent/30">
              <Image unoptimized src="/avatars/waiting.png" alt="Claude" width={64} height={64} className="object-cover" />
            </div>
          </div>
          <h1 className="text-title font-bold text-bot-text tracking-tight">Setup Wizard</h1>
          <p className="text-body text-bot-muted mt-1">Let&apos;s get Claude Server Bot ready</p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {steps.map(({ n, label }) => {
              const isDone = n < step;
              const isActive = n === step;
              return (
                <div key={n} className="flex flex-col items-center gap-1.5">
                  <motion.div
                    animate={{
                      scale: isActive ? 1 : 1,
                      backgroundColor: isDone
                        ? "rgb(var(--bot-accent))"
                        : isActive
                          ? "rgb(var(--bot-accent) / 0.2)"
                          : "rgb(var(--bot-elevated))",
                    }}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-caption font-semibold transition-all duration-300",
                      isDone ? "text-white shadow-glow-sm" : isActive ? "text-bot-accent border border-bot-accent" : "text-bot-muted",
                    )}
                  >
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : n}
                  </motion.div>
                  <span className={cn("text-[11px] hidden sm:block font-medium", isActive ? "text-bot-text" : "text-bot-muted/60")}>{label}</span>
                </div>
              );
            })}
          </div>
          <div className="h-1 rounded-full bg-bot-elevated overflow-hidden">
            <motion.div
              className="h-full rounded-full gradient-accent"
              initial={{ width: "0%" }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Card */}
        <div className="glass-heavy rounded-2xl p-8 shadow-glass">
          <AnimatePresence mode="wait">
            {/* STEP 1: Project */}
            {step === 1 && (
              <motion.div key="step1" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6">
                <div>
                  <h2 className="text-subtitle font-semibold text-bot-text mb-1">Project Directory</h2>
                  <p className="text-body text-bot-muted">This is the directory Claude will work in.</p>
                </div>

                <div className="rounded-xl border border-bot-border/60 bg-bot-elevated/40 p-4">
                  <p className="text-caption text-bot-muted mb-1">Current directory</p>
                  <p className="font-mono text-body text-bot-text">{projectRoot || "Not set"}</p>
                  {projectStatus && (
                    <div className="mt-3 flex gap-6 text-caption">
                      <span className={projectStatus.hasClaudeMd ? "text-bot-green" : "text-bot-muted"}>
                        {projectStatus.hasClaudeMd ? <CheckCircle2 className="h-3 w-3 inline mr-1" /> : "—"} CLAUDE.md
                      </span>
                      <span className={projectStatus.hasClaudeDir ? "text-bot-green" : "text-bot-muted"}>
                        {projectStatus.hasClaudeDir ? <CheckCircle2 className="h-3 w-3 inline mr-1" /> : "—"} .claude/
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
                      className="flex-1 rounded-xl border border-bot-border bg-bot-elevated/60 px-4 py-2.5 font-mono text-body text-bot-text placeholder:text-bot-muted/60 outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200"
                    />
                    <button
                      type="submit"
                      disabled={!projectInput.trim() || savingProject}
                      className="rounded-xl border border-bot-border px-4 py-2.5 text-body text-bot-muted hover:text-bot-text hover:bg-bot-elevated disabled:opacity-50 transition-all duration-200"
                    >
                      {savingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
                    </button>
                  </div>
                  {projectError && <p className="text-caption text-bot-red">{projectError}</p>}
                </form>

                <button
                  onClick={() => advanceStep(1)}
                  disabled={!projectRoot}
                  className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  Continue
                </button>
              </motion.div>
            )}

            {/* STEP 2: Initialize */}
            {step === 2 && showInitStep && (
              <motion.div key="step2" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6">
                <div>
                  <h2 className="text-subtitle font-semibold text-bot-text mb-1">Initialize Project</h2>
                  <p className="text-body text-bot-muted">
                    No <code className="font-mono text-bot-amber px-1.5 py-0.5 rounded bg-bot-amber/10">CLAUDE.md</code> found.
                  </p>
                </div>

                <div className="rounded-xl border border-bot-amber/30 bg-bot-amber/10 p-4">
                  <p className="text-body text-bot-amber font-medium mb-1">CLAUDE.md not found</p>
                  <p className="text-caption text-bot-muted">
                    Run <code className="font-mono text-bot-text px-1.5 py-0.5 rounded bg-bot-elevated">/init</code> in the chat to let Claude analyze your project and create one automatically.
                  </p>
                </div>

                <p className="text-caption text-bot-muted">
                  You can skip this and do it later from the Chat tab.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => advanceStep(2)}
                    className="rounded-xl border border-bot-border px-4 py-2.5 text-body text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-all duration-200"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => advanceStep(2)}
                    className="flex-1 rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
                  >
                    Continue to Test
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 3: Test Claude */}
            {step === 3 && (
              <motion.div key="step3" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6">
                <div>
                  <h2 className="text-subtitle font-semibold text-bot-text mb-1">Test Claude</h2>
                  <p className="text-body text-bot-muted">
                    Verify that Claude is authenticated and responding.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-4 py-4">
                  {!testResult && !testing && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleTestClaude}
                      className="flex items-center gap-2 rounded-xl gradient-accent px-8 py-3.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md transition-all duration-200"
                    >
                      <Terminal className="h-4 w-4" />
                      Run Test
                    </motion.button>
                  )}

                  {testing && (
                    <div className="flex items-center gap-3 text-body text-bot-muted">
                      <Loader2 className="h-5 w-5 animate-spin text-bot-accent" />
                      Testing Claude...
                    </div>
                  )}

                  {testResult && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={cn(
                        "w-full rounded-xl p-5 flex items-start gap-3",
                        testResult.ok ? "bg-bot-green/10 border border-bot-green/30" : "bg-bot-red/10 border border-bot-red/30",
                      )}
                    >
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
                            <div className="mt-3 rounded-lg bg-bot-elevated/60 px-3 py-2 text-caption font-mono text-bot-text">
                              SSH into your server and run: <span className="text-bot-amber">claude</span>
                            </div>
                            <p className="text-caption text-bot-muted mt-2">Complete the browser login, then retry.</p>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {testResult && (
                    <button
                      onClick={handleTestClaude}
                      className="text-caption text-bot-muted hover:text-bot-accent transition-colors"
                    >
                      Retry test
                    </button>
                  )}
                </div>

                <button
                  onClick={() => advanceStep(3)}
                  disabled={!testResult?.ok}
                  className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  Continue
                </button>
              </motion.div>
            )}

            {/* STEP 4: Done */}
            {step === 4 && (
              <motion.div key="step4" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                  className="flex flex-col items-center gap-3"
                >
                  <div className="relative">
                    <div className="absolute -inset-3 rounded-full bg-bot-green/20 blur-xl" />
                    <Sparkles className="relative h-16 w-16 text-bot-green" />
                  </div>
                  <h2 className="text-subtitle font-bold text-bot-text">You&apos;re all set!</h2>
                </motion.div>

                <div className="rounded-xl border border-bot-border/60 bg-bot-elevated/40 p-5 text-left space-y-2">
                  <p className="text-caption text-bot-muted">Project directory</p>
                  <p className="font-mono text-body text-bot-text">{projectRoot}</p>
                  {projectStatus && (
                    <div className="flex gap-6 text-caption pt-1">
                      <span className={projectStatus.hasClaudeMd ? "text-bot-green" : "text-bot-muted"}>
                        {projectStatus.hasClaudeMd ? "✓" : "—"} CLAUDE.md
                      </span>
                      <span className={projectStatus.hasClaudeDir ? "text-bot-green" : "text-bot-muted"}>
                        {projectStatus.hasClaudeDir ? "✓" : "—"} .claude/
                      </span>
                    </div>
                  )}
                </div>

                {error && (
                  <p className="text-caption text-bot-red">{error}</p>
                )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleComplete}
                  className="w-full rounded-xl gradient-accent px-4 py-3.5 text-body font-bold text-white shadow-glow-md hover:shadow-glow-lg hover:brightness-110 transition-all duration-200"
                >
                  Start chatting with Claude
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </main>
  );
}

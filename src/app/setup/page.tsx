"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CheckCircle2, XCircle, Loader2, Key, Sparkles, Server, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { SERVER_PURPOSES } from "@/lib/user-profile-constants";

// Steps:
//  1 = AdminName (your first & last name)
//  2 = BotName
//  3 = APIKey
//  4 = TestClaude
//  5 = ProjectDir
//  6 = ServerProfile
//  7 = Done
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STEPS = [
  { n: 1, label: "You" },
  { n: 2, label: "Bot" },
  { n: 3, label: "API Key" },
  { n: 4, label: "Test" },
  { n: 5, label: "Project" },
  { n: 6, label: "Server" },
  { n: 7, label: "Done" },
];

function getBasePath() {
  const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
  const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
  return slug ? `/${prefix}/${slug}` : "";
}

export default function SetupPage() {
  const bp = getBasePath();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [navDir, setNavDir] = useState<"forward" | "back">("forward");

  const stepVariants = {
    enter: { opacity: 0, x: navDir === "forward" ? 20 : -20 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: navDir === "forward" ? -20 : 20 },
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — Admin name
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nameError, setNameError] = useState("");

  // Step 2 — Bot name
  const [botName, setBotName] = useState("Octoby");

  // Step 3 — API key
  const [apiKey, setApiKey] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");

  // Step 4 — Test Claude
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latency?: number; error?: string } | null>(null);

  // Step 5 — Project directory
  const [projectRoot, setProjectRoot] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const [projectStatus, setProjectStatus] = useState<{ hasClaudeMd: boolean; hasClaudeDir: boolean } | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [projectError, setProjectError] = useState("");

  // Step 7 — Server purpose
  const [selectedPurposes, setSelectedPurposes] = useState<string[]>([]);
  const [customPurpose, setCustomPurpose] = useState("");
  const [projectType, setProjectType] = useState<"new" | "existing" | "">("");

  // Load bot identity on mount
  useEffect(() => {
    fetch(`${bp}/api/bot-identity`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { name?: string; projectRoot?: string } | null) => {
        if (data?.name && data.name !== "Octoby") setBotName(data.name);
        if (data?.projectRoot) {
          setProjectRoot(data.projectRoot);
          checkProject(data.projectRoot);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard: non-admin users should never see this page — redirect to dashboard
  useEffect(() => {
    if (status === "authenticated" && !(session?.user as { isAdmin?: boolean })?.isAdmin) {
      router.replace(bp || "/");
    }
  }, [status, session, router, bp]);

  async function checkProject(path: string) {
    if (!path) return;
    try {
      const res = await fetch(`${bp}/api/settings/project`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: path }),
      });
      if (res.ok) {
        const data = await res.json() as { hasClaudeMd: boolean; hasClaudeDir: boolean };
        setProjectStatus({ hasClaudeMd: data.hasClaudeMd, hasClaudeDir: data.hasClaudeDir });
      }
    } catch { /* ignore */ }
  }

  // ── Step handlers ─────────────────────────────────────────────────────────

  async function saveAdminName() {
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first) { setNameError("First name is required."); return; }
    if (saving) return;
    setSaving(true);
    setNameError("");
    try {
      const res = await fetch(`${bp}/api/setup/name`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: first, last_name: last }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setNameError(d.error ?? "Failed to save name. Try again.");
        return;
      }
      setNavDir("forward"); setStep(2);
    } catch { setNameError("Network error. Try again."); }
    finally { setSaving(false); }
  }

  async function saveBotName() {
    if (!botName.trim() || saving) return;
    setSaving(true);
    try {
      await fetch(`${bp}/api/bot-identity`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: botName.trim() }),
      });
      setNavDir("forward"); setStep(3);
    } catch { /* proceed anyway */ setNavDir("forward"); setStep(3); }
    finally { setSaving(false); }
  }

  async function saveApiKey() {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setApiKeyError("");
    try {
      const res = await fetch(`${bp}/api/app-settings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anthropic_api_key: apiKey.trim() }),
      });
      if (!res.ok) { setApiKeyError("Failed to save key. Try again."); return; }
      setNavDir("forward"); setStep(4);
    } catch { setApiKeyError("Network error. Try again."); }
    finally { setSaving(false); }
  }

  async function handleTestClaude() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${bp}/api/claude-code/test`);
      const data = await res.json() as { ok: boolean; latency?: number; error?: string };
      setTestResult(data);
    } catch (err) { setTestResult({ ok: false, error: String(err) }); }
    finally { setTesting(false); }
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projectInput.trim() || savingProject) return;
    setSavingProject(true);
    setProjectError("");
    try {
      const res = await fetch(`${bp}/api/settings/project`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: projectInput.trim() }),
      });
      const data = await res.json() as { hasClaudeMd?: boolean; hasClaudeDir?: boolean; error?: string };
      if (res.ok) {
        setProjectRoot(projectInput.trim());
        setProjectInput("");
        setProjectStatus({ hasClaudeMd: data.hasClaudeMd ?? false, hasClaudeDir: data.hasClaudeDir ?? false });
      } else { setProjectError(data.error ?? "Failed to update"); }
    } catch (err) { setProjectError(String(err)); }
    finally { setSavingProject(false); }
  }

  function togglePurpose(id: string) {
    setSelectedPurposes((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  const handleComplete = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const purposes = [...selectedPurposes];
      if (customPurpose.trim()) purposes.push(`custom:${customPurpose.trim()}`);

      await fetch(`${bp}/api/users/profile`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_purposes: purposes,
          project_type: projectType,
          profile_wizard_complete: true,
          update_claude_md: true,
        }),
      });

      const res = await fetch(`${bp}/api/setup/complete`, { method: "POST" });
      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error");
        setError(`Setup completion failed: ${text}`);
        return;
      }
      window.location.href = bp || "/";
    } catch (err) { setError(String(err)); }
    finally { setSaving(false); }
  }, [bp, selectedPurposes, customPurpose, projectType]);

  const progressPercent = ((step - 1) / (STEPS.length - 1)) * 100;
  const displayName = firstName.trim() || "there";

  // Show blank while checking admin status (avoids a flash of the wizard for non-admin users)
  if (status === "loading" || (status === "authenticated" && !(session?.user as { isAdmin?: boolean })?.isAdmin)) {
    return null;
  }

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
        className="w-full max-w-xl relative z-10"
      >
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-5">
            <div className="absolute -inset-1.5 rounded-full gradient-accent opacity-40 blur-md" />
            <div className="relative h-16 w-16 rounded-full overflow-hidden border-2 border-bot-accent/30">
              <Image unoptimized src="/avatars/waiting.png" alt="Assistant" width={64} height={64} className="object-cover" />
            </div>
          </div>
          <h1 className="text-title font-bold text-bot-text tracking-tight">Welcome!</h1>
          <p className="text-body text-bot-muted mt-1">Let&apos;s get your assistant set up</p>
        </div>

        {/* Step indicators */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3 overflow-x-auto pb-1">
            {STEPS.map(({ n, label }) => {
              const isDone = n < step;
              const isActive = n === step;
              return (
                <div key={n} className="flex flex-col items-center gap-1 min-w-0 shrink-0 px-1">
                  <div
                    onClick={isDone && step !== 7 ? () => { setNavDir("back"); setStep(n as Step); } : undefined}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300",
                      isDone ? "gradient-accent text-white shadow-glow-sm" : isActive ? "border-2 border-bot-accent text-bot-accent bg-bot-accent/10" : "bg-bot-elevated text-bot-muted",
                      isDone && step !== 7 ? "cursor-pointer hover:opacity-75" : "cursor-default",
                    )}
                  >
                    {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
                  </div>
                  <span className={cn("text-[10px] font-medium", isActive ? "text-bot-text" : "text-bot-muted/50")}>{label}</span>
                </div>
              );
            })}
          </div>
          <div className="h-1 rounded-full bg-bot-elevated overflow-hidden">
            <motion.div className="h-full rounded-full gradient-accent" initial={{ width: "0%" }} animate={{ width: `${progressPercent}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
          </div>
        </div>

        {/* Card */}
        <div className="glass-heavy rounded-2xl p-8 shadow-glass">
          <AnimatePresence mode="wait">

            {/* ── STEP 1: Admin Name ── */}
            {step === 1 && (
              <motion.div key="s1" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <User className="h-5 w-5 text-bot-accent" />
                    <h2 className="text-subtitle font-semibold text-bot-text">Who are you?</h2>
                  </div>
                  <p className="text-body text-bot-muted">Your name will be associated with your admin account.</p>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-caption font-medium text-bot-muted block mb-1.5">First name <span className="text-bot-red">*</span></label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => { setFirstName(e.target.value); setNameError(""); }}
                        onKeyDown={(e) => { if (e.key === "Enter" && firstName.trim()) saveAdminName(); }}
                        placeholder="Jane"
                        autoFocus
                        autoComplete="given-name"
                        className="w-full rounded-xl border border-bot-border bg-bot-elevated/60 px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/60 outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200"
                      />
                    </div>
                    <div>
                      <label className="text-caption font-medium text-bot-muted block mb-1.5">Last name <span className="text-bot-muted/50">(optional)</span></label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && firstName.trim()) saveAdminName(); }}
                        placeholder="Smith"
                        autoComplete="family-name"
                        className="w-full rounded-xl border border-bot-border bg-bot-elevated/60 px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/60 outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200"
                      />
                    </div>
                  </div>
                  {nameError && <p className="text-caption text-bot-red">{nameError}</p>}
                </div>

                <button
                  onClick={saveAdminName}
                  disabled={!firstName.trim() || saving}
                  className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Continue →"}
                </button>
              </motion.div>
            )}

            {/* ── STEP 2: Bot Name ── */}
            {step === 2 && (
              <motion.div key="s2" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6">
                <div>
                  <h2 className="text-subtitle font-semibold text-bot-text mb-1">Name your assistant</h2>
                  <p className="text-body text-bot-muted">What would you like to call it, {displayName}? You can always change this later.</p>
                </div>

                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && botName.trim()) saveBotName(); }}
                  placeholder="e.g. Jarvis, Friday, Claude…"
                  autoFocus
                  className="w-full rounded-xl border border-bot-border bg-bot-elevated/60 px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/60 outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200"
                />

                <button
                  onClick={saveBotName}
                  disabled={!botName.trim() || saving}
                  className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Continue →"}
                </button>
              </motion.div>
            )}

            {/* ── STEP 3: API Key ── */}
            {step === 3 && (
              <motion.div key="s3" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6">
                <div>
                  <h2 className="text-subtitle font-semibold text-bot-text mb-1">Connect to Anthropic</h2>
                  <p className="text-body text-bot-muted">
                    Your assistant needs an Anthropic API key to work.{" "}
                    <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-bot-accent hover:underline">
                      Get one here ↗
                    </a>
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="relative">
                    <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-bot-muted/50" />
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => { setApiKey(e.target.value); setApiKeyError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") saveApiKey(); }}
                      placeholder="sk-ant-api03-…"
                      className="w-full rounded-xl border border-bot-border bg-bot-elevated/60 pl-10 pr-4 py-3 text-body text-bot-text placeholder:text-bot-muted/60 font-mono outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200"
                    />
                  </div>
                  {apiKeyError && <p className="text-caption text-bot-red">{apiKeyError}</p>}
                </div>

                <div className="space-y-2">
                  <button
                    onClick={saveApiKey}
                    disabled={!apiKey.trim() || saving}
                    className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Save & Continue →"}
                  </button>
                  <button
                    onClick={() => { setNavDir("forward"); setStep(4); }}
                    className="w-full text-caption text-bot-muted hover:text-bot-text transition-colors py-1"
                  >
                    Skip for now (add in Settings later)
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── STEP 4: Test Claude ── */}
            {step === 4 && (
              <motion.div key="s4" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6">
                <div>
                  <h2 className="text-subtitle font-semibold text-bot-text mb-1">Test your connection</h2>
                  <p className="text-body text-bot-muted">Let&apos;s make sure Claude is responding.</p>
                </div>

                <div className="flex flex-col items-center gap-4 py-2">
                  {!testResult && !testing && (
                    <button onClick={handleTestClaude} className="flex items-center gap-2 rounded-xl gradient-accent px-8 py-3.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md transition-all duration-200">
                      Run Test
                    </button>
                  )}
                  {testing && (
                    <div className="flex items-center gap-3 text-body text-bot-muted">
                      <Loader2 className="h-5 w-5 animate-spin text-bot-accent" /> Testing…
                    </div>
                  )}
                  {testResult && (
                    <div className={cn("w-full rounded-xl p-4 flex items-start gap-3", testResult.ok ? "bg-bot-green/10 border border-bot-green/30" : "bg-bot-red/10 border border-bot-red/30")}>
                      {testResult.ok ? <CheckCircle2 className="h-5 w-5 text-bot-green shrink-0" /> : <XCircle className="h-5 w-5 text-bot-red shrink-0" />}
                      <div>
                        {testResult.ok ? (
                          <>
                            <p className="text-body font-medium text-bot-green">Connected! Responded in {testResult.latency}ms</p>
                            <p className="text-caption text-bot-muted mt-0.5">Your API key is working correctly.</p>
                          </>
                        ) : (
                          <>
                            <p className="text-body font-medium text-bot-red">Couldn&apos;t connect to Claude</p>
                            {testResult.error && <p className="text-caption text-bot-muted mt-0.5">{testResult.error}</p>}
                            <p className="text-caption text-bot-muted mt-1">Check your API key in the previous step.</p>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {testResult && (
                    <button onClick={handleTestClaude} className="text-caption text-bot-muted hover:text-bot-accent transition-colors">Retry</button>
                  )}
                </div>

                <div className="space-y-2">
                  <button
                    onClick={() => { setNavDir("forward"); setStep(5); }}
                    disabled={!testResult?.ok}
                    className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
                  >
                    Continue →
                  </button>
                  {!testResult?.ok && (
                    <button onClick={() => { setNavDir("forward"); setStep(5); }} className="w-full text-caption text-bot-muted hover:text-bot-text transition-colors py-1">
                      Skip (set up API key in Settings)
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── STEP 5: Project Directory ── */}
            {step === 5 && (
              <motion.div key="s5" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6">
                <div>
                  <h2 className="text-subtitle font-semibold text-bot-text mb-1">Working directory</h2>
                  <p className="text-body text-bot-muted">Where should your assistant look for files and run commands?</p>
                </div>

                <div className="rounded-xl border border-bot-border/60 bg-bot-elevated/40 p-4">
                  <p className="text-caption text-bot-muted mb-1">Current directory</p>
                  <p className="font-mono text-body text-bot-text">{projectRoot || "Not set"}</p>
                  {projectStatus && (
                    <div className="mt-3 flex gap-6 text-caption">
                      <span className={projectStatus.hasClaudeMd ? "text-bot-green" : "text-bot-muted"}>{projectStatus.hasClaudeMd ? "✓" : "—"} CLAUDE.md</span>
                      <span className={projectStatus.hasClaudeDir ? "text-bot-green" : "text-bot-muted"}>{projectStatus.hasClaudeDir ? "✓" : "—"} .claude/</span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSaveProject} className="space-y-3">
                  <label className="text-caption font-medium text-bot-muted">Change directory (optional)</label>
                  <div className="flex gap-2">
                    <input type="text" value={projectInput} onChange={(e) => setProjectInput(e.target.value)} placeholder="/home/user/my-project"
                      className="flex-1 rounded-xl border border-bot-border bg-bot-elevated/60 px-4 py-2.5 font-mono text-body text-bot-text placeholder:text-bot-muted/60 outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200" />
                    <button type="submit" disabled={!projectInput.trim() || savingProject}
                      className="rounded-xl border border-bot-border px-4 py-2.5 text-body text-bot-muted hover:text-bot-text hover:bg-bot-elevated disabled:opacity-50 transition-all duration-200">
                      {savingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
                    </button>
                  </div>
                  {projectError && <p className="text-caption text-bot-red">{projectError}</p>}
                </form>

                <button onClick={() => { setNavDir("forward"); setStep(6); }} disabled={!projectRoot}
                  className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all duration-200">
                  Continue →
                </button>
              </motion.div>
            )}

            {/* ── STEP 6: Server Purpose ── */}
            {step === 6 && (
              <motion.div key="s6" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-5">
                <div>
                  <h2 className="text-subtitle font-semibold text-bot-text mb-1">What is this server for?</h2>
                  <p className="text-body text-bot-muted">This helps your assistant give better advice. Pick all that apply.</p>
                </div>

                <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                  {SERVER_PURPOSES.map((p) => {
                    const selected = selectedPurposes.includes(p.id);
                    return (
                      <button key={p.id} onClick={() => togglePurpose(p.id)}
                        className={cn(
                          "text-left rounded-lg border px-3 py-2.5 text-caption transition-all duration-150",
                          selected ? "border-bot-accent bg-bot-accent/10 text-bot-accent" : "border-bot-border/40 text-bot-text/80 hover:border-bot-accent/40 hover:bg-bot-elevated/30"
                        )}>
                        <div className="font-medium">{p.label}</div>
                        <div className={cn("text-[10px] mt-0.5", selected ? "text-bot-accent/70" : "text-bot-muted/60")}>{p.description}</div>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label className="text-caption font-medium text-bot-muted block mb-1.5">Other (optional)</label>
                  <input type="text" value={customPurpose} onChange={(e) => setCustomPurpose(e.target.value)} placeholder="Describe what else this server does…"
                    className="w-full rounded-xl border border-bot-border bg-bot-elevated/60 px-4 py-2.5 text-body text-bot-text placeholder:text-bot-muted/60 outline-none focus:border-bot-accent focus:shadow-glow-sm transition-all duration-200" />
                </div>

                <div className="space-y-3 pt-1">
                  <p className="text-body font-medium text-bot-text flex items-center gap-2"><Server className="h-4 w-4 text-bot-accent" /> Is there already a project here?</p>
                  <div className="grid grid-cols-2 gap-3">
                    {(["existing", "new"] as const).map((type) => (
                      <button key={type} onClick={() => setProjectType(type)}
                        className={cn(
                          "rounded-xl border p-3.5 text-caption font-medium transition-all duration-200 text-left",
                          projectType === type ? "border-bot-accent bg-bot-accent/10 text-bot-accent" : "border-bot-border/40 text-bot-text/80 hover:border-bot-accent/40"
                        )}>
                        {type === "existing" ? "✅ Yes — I'm already working on something" : "🌱 No — starting fresh"}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={() => { setNavDir("forward"); setStep(7); }}
                  className="w-full rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200">
                  Continue →
                </button>
              </motion.div>
            )}

            {/* ── STEP 7: Done ── */}
            {step === 7 && (
              <motion.div key="s7" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="space-y-6 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                  className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <div className="absolute -inset-3 rounded-full bg-bot-green/20 blur-xl" />
                    <Sparkles className="relative h-16 w-16 text-bot-green" />
                  </div>
                  <h2 className="text-subtitle font-bold text-bot-text">All set, {firstName.trim() || "there"}!</h2>
                  <p className="text-body text-bot-muted">{botName} is personalised and ready to go.</p>
                </motion.div>

                {/* Profile summary */}
                <div className="rounded-xl border border-bot-border/60 bg-bot-elevated/40 p-4 text-left space-y-3">
                  <div className="flex items-center gap-2">
                    <span>👤</span>
                    <span className="text-caption text-bot-muted">Admin:</span>
                    <span className="text-caption text-bot-text font-medium">
                      {[firstName.trim(), lastName.trim()].filter(Boolean).join(" ")}
                    </span>
                  </div>
                  {(selectedPurposes.length > 0 || customPurpose) && (
                    <div className="flex items-start gap-2">
                      <span>🖥</span>
                      <span className="text-caption text-bot-muted shrink-0">Server:</span>
                      <span className="text-caption text-bot-text">
                        {[
                          ...selectedPurposes.map((id) => SERVER_PURPOSES.find((p) => p.id === id)?.label ?? id),
                          ...(customPurpose ? [customPurpose] : []),
                        ].join(", ")}
                      </span>
                    </div>
                  )}
                  {projectType && (
                    <div className="flex items-center gap-2">
                      <span>{projectType === "existing" ? "📁" : "✨"}</span>
                      <span className="text-caption text-bot-muted">Project:</span>
                      <span className="text-caption text-bot-text font-medium">
                        {projectType === "existing" ? "Existing project" : "Starting fresh"}
                      </span>
                    </div>
                  )}
                  <p className="text-[10px] text-bot-muted/60 pt-1">These settings have been saved to your assistant&apos;s context. Change them any time in Settings → General.</p>
                </div>

                {error && <p className="text-caption text-bot-red">{error}</p>}

                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleComplete} disabled={saving}
                  className="w-full rounded-xl gradient-accent px-4 py-3.5 text-body font-bold text-white shadow-glow-md hover:shadow-glow-lg hover:brightness-110 disabled:opacity-50 transition-all duration-200">
                  {saving ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : `Start chatting with ${botName} →`}
                </motion.button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </main>
  );
}

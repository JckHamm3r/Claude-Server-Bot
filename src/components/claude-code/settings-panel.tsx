"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { getSocket } from "@/lib/socket";
import { cn, apiUrl } from "@/lib/utils";
import type { ClaudeUserSettings } from "@/lib/claude-db";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Upload,
  Skull,
  RefreshCw,
  ChevronDown,
  Database,
  HardDrive,
} from "lucide-react";

import { DomainsSection } from "@/components/claude-code/settings/domains-section";
import { SmtpSection } from "@/components/claude-code/settings/smtp-section";
import { NotificationsSection } from "@/components/claude-code/settings/notifications-section";
import { SecuritySection } from "@/components/claude-code/settings/security-section";
import { TemplatesSection } from "@/components/claude-code/settings/templates-section";
import { CustomizationSection } from "@/components/claude-code/settings/customization-section";
import { useUserProfile, invalidateProfileCache } from "@/hooks/use-user-profile";

type SectionKey =
  | "general"
  | "bot_identity"
  | "customization"
  | "rate_limits"
  | "users"
  | "project"
  | "activity_log"
  | "backup"
  | "database"
  | "system"
  | "updates"
  | "domains"
  | "smtp"
  | "notifications"
  | "security"
  | "api_key"
  | "templates"
  | "budgets";

export function SettingsPanel() {
  const { data: sessionData } = useSession();
  const currentEmail = sessionData?.user?.email ?? "";
  const [settings, setSettings] = useState<ClaudeUserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("general");
  const [isAdmin, setIsAdmin] = useState(false);
  const userProfile = useUserProfile();
  const userExperienceLevel = userProfile.experience_level;

  // Users state
  const [users, setUsers] = useState<{ email: string; is_admin: number; created_at: string }[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [newUserPassword, setNewUserPassword] = useState<{ email: string; password: string } | null>(null);
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<{ email: string; is_admin: number } | null>(null);
  const [editForm, setEditForm] = useState({ email: "", isAdmin: false });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Project state
  const [projectRoot, setProjectRoot] = useState(process.env.NEXT_PUBLIC_CLAUDE_PROJECT_ROOT ?? "");
  const [projectInput, setProjectInput] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [projectMsg, setProjectMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [projectStatus, setProjectStatus] = useState<{ hasClaudeMd: boolean; hasClaudeDir: boolean } | null>(null);

  // Bot identity
  const [botName, setBotName] = useState("Claude Server Bot");
  const [botTagline, setBotTagline] = useState("Your AI assistant");
  const [botAvatar, setBotAvatar] = useState<string | null>(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityMsg, setIdentityMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Rate limits
  const [rateCmds, setRateCmds] = useState("100");
  const [rateRuntime, setRateRuntime] = useState("30");
  const [rateConcurrent, setRateConcurrent] = useState("3");
  const [savingRates, setSavingRates] = useState(false);
  const [ratesMsg, setRatesMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Activity log
  const [activityEntries, setActivityEntries] = useState<{
    id: number; timestamp: string; event_type: string; user_email: string | null; details: string | null;
  }[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityOffset, setActivityOffset] = useState(0);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // Health
  const [health, setHealth] = useState<Record<string, boolean> | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  // Resources
  const [resources, setResources] = useState<{
    cpu_pct: number; ram_pct: number; ram_used_mb: number; ram_total_mb: number;
    disk_pct: number; disk_used_gb: number; disk_total_gb: number;
  } | null>(null);

  // System actions
  const [killingAll, setKillingAll] = useState(false);
  const [killMsg, setKillMsg] = useState<string | null>(null);

  // Backup/restore
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Auto-update

  useEffect(() => {
    const socket = getSocket();
    socket.emit("claude:get_settings");
    socket.on("claude:settings", ({ settings: s }: { settings: ClaudeUserSettings }) => {
      setSettings(s);
    });
    // Determine admin via users endpoint (gracefully)
    fetch(apiUrl("/api/users"))
      .then((r) => { if (r.ok) setIsAdmin(true); })
      .catch(() => {});
    // Load bot identity
    fetch(apiUrl("/api/bot-identity"))
      .then((r) => r.json())
      .then((d) => { setBotName(d.name); setBotTagline(d.tagline); setBotAvatar(d.avatar); })
      .catch(() => {});
    // Load app settings
    fetch(apiUrl("/api/app-settings"))
      .then((r) => r.json())
      .then((d) => {
        setRateCmds(d.rate_limit_commands ?? "100");
        setRateRuntime(d.rate_limit_runtime_min ?? "30");
        setRateConcurrent(d.rate_limit_concurrent ?? "3");
      })
      .catch(() => {});
    return () => { socket.off("claude:settings"); };
  }, []);

  useEffect(() => {
    if (activeSection === "users") {
      fetch(apiUrl("/api/users"))
        .then((r) => r.json())
        .then((data) => setUsers(data.users ?? []))
        .catch(() => {});
    }
    if (activeSection === "activity_log" && activityEntries.length === 0) {
      loadActivity(0);
    }
    if (activeSection === "system") {
      runHealthCheck();
      loadResources();
    }
    if (activeSection === "project" && !projectStatus) {
      // Load current project status on first open
      fetch(apiUrl("/api/bot-identity"))
        .then((r) => r.json())
        .then((data: { projectRoot?: string }) => {
          if (data.projectRoot) setProjectRoot(data.projectRoot);
          return fetch(apiUrl("/api/settings/project"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectRoot: data.projectRoot ?? process.env.NEXT_PUBLIC_CLAUDE_PROJECT_ROOT ?? "" }),
          });
        })
        .then((r) => r.json())
        .then((d: { hasClaudeMd?: boolean; hasClaudeDir?: boolean }) => {
          setProjectStatus({ hasClaudeMd: d.hasClaudeMd ?? false, hasClaudeDir: d.hasClaudeDir ?? false });
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  // Poll resources every 30s when on system tab
  useEffect(() => {
    if (activeSection !== "system") return;
    const t = setInterval(loadResources, 30_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  function update(patch: Partial<ClaudeUserSettings>) {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    setSaving(true);
    const socket = getSocket();
    socket.emit("claude:update_settings", {
      full_trust_mode: updated.full_trust_mode,
      custom_default_context: updated.custom_default_context,
      auto_naming_enabled: updated.auto_naming_enabled,
    });
    const cleanup = () => { setSaving(false); };
    const onDone = () => {
      cleanup();
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    };
    socket.once("claude:settings", onDone);
    // Fallback: clear spinner after 5s if server never responds
    setTimeout(() => {
      socket.off("claude:settings", onDone);
      setSaving(false);
    }, 5000);
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || addingUser) return;
    setAddingUser(true);
    try {
      const res = await fetch(apiUrl("/api/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewUserPassword({ email: data.email, password: data.password });
        setNewEmail("");
        setUsers((prev) => [...prev, { email: data.email, is_admin: 0, created_at: new Date().toISOString() }]);
      }
    } finally {
      setAddingUser(false);
    }
  }

  async function handleDeleteUser(email: string) {
    if (deletingEmail === email) {
      try {
        const res = await fetch(apiUrl("/api/users"), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          setUsers((prev) => prev.filter((u) => u.email !== email));
        }
      } catch { /* ignore */ }
      setDeletingEmail(null);
    } else {
      setDeletingEmail(email);
    }
  }

  function startEditUser(user: { email: string; is_admin: number }) {
    setEditingUser(user);
    setEditForm({ email: user.email, isAdmin: Boolean(user.is_admin) });
    setEditError(null);
    setDeletingEmail(null);
  }

  async function handleSaveEdit() {
    if (!editingUser || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const patch: Record<string, unknown> = { email: editingUser.email };
      if (editForm.email.trim() && editForm.email.trim() !== editingUser.email) {
        patch.newEmail = editForm.email.trim();
      }
      if (editForm.isAdmin !== Boolean(editingUser.is_admin)) {
        patch.is_admin = editForm.isAdmin;
      }
      const res = await fetch(apiUrl("/api/users"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error ?? "Failed to update user");
        return;
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.email === editingUser.email
            ? { ...u, email: data.email, is_admin: editForm.isAdmin ? 1 : 0 }
            : u
        )
      );
      setEditingUser(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleResetPassword(email: string) {
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(apiUrl("/api/users"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, resetPassword: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error ?? "Failed to reset password");
        return;
      }
      if (data.password) {
        setNewUserPassword({ email: data.email, password: data.password });
      }
      setEditingUser(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projectInput.trim() || savingProject) return;
    setSavingProject(true);
    setProjectMsg(null);
    try {
      const res = await fetch(apiUrl("/api/settings/project"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: projectInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setProjectRoot(projectInput.trim());
        setProjectInput("");
        setProjectStatus({ hasClaudeMd: data.hasClaudeMd, hasClaudeDir: data.hasClaudeDir });
        setProjectMsg({ ok: true, text: "Project directory updated. Service restarting…" });
      } else {
        setProjectMsg({ ok: false, text: data.error ?? "Failed to update" });
      }
    } finally {
      setSavingProject(false);
    }
  }

  async function handleSaveIdentity(e: React.FormEvent) {
    e.preventDefault();
    setSavingIdentity(true);
    setIdentityMsg(null);
    try {
      const res = await fetch(apiUrl("/api/bot-identity"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: botName, tagline: botTagline, avatar: botAvatar }),
      });
      if (res.ok) {
        setIdentityMsg({ ok: true, text: "Identity saved" });
      } else {
        setIdentityMsg({ ok: false, text: "Failed to save" });
      }
    } finally {
      setSavingIdentity(false);
      setTimeout(() => setIdentityMsg(null), 3000);
    }
  }

  function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBotAvatar(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveRates(e: React.FormEvent) {
    e.preventDefault();
    setSavingRates(true);
    setRatesMsg(null);
    try {
      const res = await fetch(apiUrl("/api/app-settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rate_limit_commands: rateCmds,
          rate_limit_runtime_min: rateRuntime,
          rate_limit_concurrent: rateConcurrent,
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setRatesMsg(res.ok ? { ok: true, text: "Rate limits saved." } : { ok: false, text: data.error ?? "Save failed" });
      setTimeout(() => setRatesMsg(null), 3000);
    } catch (err) {
      setRatesMsg({ ok: false, text: String(err) });
    } finally {
      setSavingRates(false);
    }
  }

  async function loadActivity(offset: number) {
    setLoadingActivity(true);
    try {
      const res = await fetch(apiUrl(`/api/activity-log?limit=50&offset=${offset}`));
      const data = await res.json();
      if (offset === 0) {
        setActivityEntries(data.entries ?? []);
      } else {
        setActivityEntries((prev) => [...prev, ...(data.entries ?? [])]);
      }
      setActivityTotal(data.total ?? 0);
      setActivityOffset(offset + (data.entries?.length ?? 0));
    } finally {
      setLoadingActivity(false);
    }
  }

  async function runHealthCheck() {
    setLoadingHealth(true);
    try {
      const res = await fetch(apiUrl("/api/health"));
      setHealth(await res.json());
    } finally {
      setLoadingHealth(false);
    }
  }

  async function loadResources() {
    try {
      const res = await fetch(apiUrl("/api/system/resources"));
      setResources(await res.json());
    } catch { /* ignore */ }
  }

  async function handleKillAll() {
    setKillingAll(true);
    setKillMsg(null);
    try {
      const socket = getSocket();
      let responded = false;
      socket.emit("claude:kill_all");
      socket.once("claude:kill_all_done", ({ killed }: { killed: number }) => {
        responded = true;
        setKillMsg(`Killed ${killed} session(s)`);
        setKillingAll(false);
      });
      // Fallback timeout — only fires if socket never responded
      setTimeout(() => {
        setKillingAll(false);
        if (!responded) setKillMsg("Kill signal sent");
      }, 3000);
    } catch {
      setKillingAll(false);
    }
  }

  async function handleRestoreUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    setRestoreMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(apiUrl("/api/settings/restore"), { method: "POST", body: formData });
      const data = await res.json();
      setRestoreMsg(res.ok ? { ok: true, text: "Restore complete. Service restarting…" } : { ok: false, text: data.error ?? "Restore failed" });
    } finally {
      setRestoring(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-bot-muted text-body">
        Loading settings…
      </div>
    );
  }

  const allSections: { key: SectionKey; label: string; adminOnly?: boolean }[] = [
    { key: "general", label: "General" },
    { key: "bot_identity", label: "Bot Identity", adminOnly: true },
    { key: "customization", label: "Customization", adminOnly: true },
    { key: "rate_limits", label: "Rate Limits", adminOnly: true },
    { key: "users", label: "Users", adminOnly: true },
    { key: "project", label: "Project", adminOnly: true },
    { key: "notifications", label: "Notifications" },
    { key: "activity_log", label: "Activity Log", adminOnly: true },
    { key: "backup", label: "Backup & Restore", adminOnly: true },
    { key: "database", label: "Database", adminOnly: true },
    { key: "system", label: "System", adminOnly: true },
    { key: "updates", label: "Updates", adminOnly: true },
    { key: "domains", label: "Domains", adminOnly: true },
    { key: "smtp", label: "Email / SMTP", adminOnly: true },
    { key: "security", label: "Security", adminOnly: true },
    { key: "templates", label: "Templates", adminOnly: true },
    { key: "budgets", label: "Budgets", adminOnly: true },
    { key: "api_key", label: "API Key (SDK)", adminOnly: true },
  ];

  // Apply experience-level gating
  // Import inline to avoid circular deps
  const levelSections: Record<string, string[]> = {
    beginner: ["general", "bot_identity", "notifications"],
    intermediate: [
      "general", "bot_identity", "customization", "rate_limits",
      "users", "project", "notifications", "activity_log",
      "backup", "database", "system", "smtp", "budgets", "api_key",
    ],
    expert: allSections.map((s) => s.key),
  };
  const userLevel = settings ? "expert" : "expert"; // will be overridden below
  void userLevel; // suppress unused warning — level comes from useUserProfile in parent
  // Sections are filtered by adminOnly AND by experience level (fetched in SettingsPanel)
  const visibleLevelSections = levelSections[userExperienceLevel] ?? levelSections.expert;
  const sections = allSections.filter((s) =>
    (!s.adminOnly || isAdmin) && visibleLevelSections.includes(s.key)
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-48 shrink-0 border-r border-bot-border/30 bg-bot-surface/60 backdrop-blur-sm flex flex-col py-2 overflow-y-auto space-y-0.5 px-1.5">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={cn(
              "w-full text-left px-3.5 py-2.5 rounded-lg text-body transition-all duration-200",
              activeSection === s.key
                ? "bg-bot-accent/10 text-bot-accent font-medium shadow-glow-sm"
                : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={activeSection === "customization"
        ? "flex-1 overflow-hidden p-6 flex flex-col"
        : "flex-1 overflow-y-auto p-8 pb-12 space-y-6"}>

        {/* ── General ── */}
        {activeSection === "general" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-bold text-bot-text">General</h2>
            <div className="space-y-6">

              {/* Experience Level */}
              <ProfileSection />

              <SettingRow title="Session Auto-Naming" description="Automatically name new sessions based on the first message sent.">
                <Toggle checked={settings.auto_naming_enabled} onChange={(v) => update({ auto_naming_enabled: v })} />
              </SettingRow>
              {userExperienceLevel !== "beginner" && (
                <>
                  <SettingRow
                    title="Full Trust Mode"
                    description="Skip confirmation prompts for destructive operations."
                    warning={settings.full_trust_mode}
                    warningText="Full Trust Mode is active. Claude will execute destructive operations without confirmation."
                  >
                    <Toggle checked={settings.full_trust_mode} onChange={(v) => update({ full_trust_mode: v })} danger />
                  </SettingRow>
                  <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5">
                    <div className="mb-3">
                      <p className="text-body font-medium text-bot-text">Custom Default Context</p>
                      <p className="mt-0.5 text-caption text-bot-muted">Prepended to every new session as additional context for Claude.</p>
                    </div>
                    <textarea
                      value={settings.custom_default_context ?? ""}
                      onChange={(e) => setSettings((s) => s ? { ...s, custom_default_context: e.target.value || null } : s)}
                      onBlur={(e) => update({ custom_default_context: e.target.value || null })}
                      rows={5}
                      placeholder="e.g. Focus on the authentication module. Always prefer TypeScript…"
                      className="w-full rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-2.5 text-body text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 focus:shadow-glow-sm transition-all duration-200 resize-none"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="mt-4 flex items-center gap-2 text-caption">
              {saving && <span className="text-bot-muted">Saving…</span>}
              {savedMsg && <span className="text-bot-green">Saved</span>}
            </div>
          </div>
        )}

        {/* ── Bot Identity ── */}
        {activeSection === "bot_identity" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-bold text-bot-text">Bot Identity</h2>
            <form onSubmit={handleSaveIdentity} className="space-y-5">
              {/* Avatar */}
              <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5">
                <p className="text-body font-medium text-bot-text mb-3">Avatar</p>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full overflow-hidden border border-bot-border bg-bot-elevated shrink-0">
                    {botAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={botAvatar} alt="Bot avatar" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={apiUrl("/avatars/waiting.png")} alt="Default avatar" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="rounded-lg border border-bot-border px-3 py-2 text-body text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors"
                    >
                      Upload image
                    </button>
                    {botAvatar && (
                      <button
                        type="button"
                        onClick={() => setBotAvatar(null)}
                        className="rounded-lg border border-bot-border px-3 py-2 text-body text-bot-red hover:bg-bot-red/10 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
                </div>
              </div>
              {/* Name */}
              <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5">
                <label className="block text-body font-medium text-bot-text mb-2">Bot Name</label>
                <input
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              {/* Tagline */}
              <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5">
                <label className="block text-body font-medium text-bot-text mb-2">Tagline</label>
                <input
                  value={botTagline}
                  onChange={(e) => setBotTagline(e.target.value)}
                  className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={savingIdentity} className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors">
                  {savingIdentity ? "Saving…" : "Save Identity"}
                </button>
                {identityMsg && <p className={cn("text-caption", identityMsg.ok ? "text-bot-green" : "text-bot-red")}>{identityMsg.text}</p>}
              </div>
            </form>
          </div>
        )}

        {/* ── Customization ── */}
        {activeSection === "customization" && <CustomizationSection />}

        {/* ── Rate Limits ── */}
        {activeSection === "rate_limits" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-bold text-bot-text">Rate Limits</h2>
            <p className="text-body text-bot-muted mb-6">Per-user limits applied to chat sessions.</p>
            <form onSubmit={handleSaveRates} className="space-y-4">
              <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5">
                <label className="block text-body font-medium text-bot-text mb-1">Commands per session</label>
                <p className="text-caption text-bot-muted mb-2">Max number of messages a user can send in one session.</p>
                <input
                  type="number" min="1" value={rateCmds} onChange={(e) => setRateCmds(e.target.value)}
                  className="w-32 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5">
                <label className="block text-body font-medium text-bot-text mb-1">Session runtime (minutes)</label>
                <p className="text-caption text-bot-muted mb-2">Max duration of a session before it is terminated.</p>
                <input
                  type="number" min="1" value={rateRuntime} onChange={(e) => setRateRuntime(e.target.value)}
                  className="w-32 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5">
                <label className="block text-body font-medium text-bot-text mb-1">Concurrent sessions</label>
                <p className="text-caption text-bot-muted mb-2">Max number of active sessions per user at one time.</p>
                <input
                  type="number" min="1" value={rateConcurrent} onChange={(e) => setRateConcurrent(e.target.value)}
                  className="w-32 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              <div className="flex items-center gap-4">
                <button
                  type="submit" disabled={savingRates}
                  className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
                >
                  {savingRates ? "Saving…" : "Save Limits"}
                </button>
                {ratesMsg && (
                  <span className={cn("text-caption", ratesMsg.ok ? "text-bot-green" : "text-bot-red")}>{ratesMsg.text}</span>
                )}
              </div>
            </form>
          </div>
        )}

        {/* ── Users ── */}
        {activeSection === "users" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-bold text-bot-text">Users</h2>
            {newUserPassword && (
              <div className="mb-6 rounded-lg border border-bot-green/40 bg-bot-green/10 p-4">
                <p className="text-body font-medium text-bot-green mb-2">{newUserPassword.email}</p>
                <p className="text-caption text-bot-muted mb-2">Password (shown once only):</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-bot-elevated px-3 py-2 font-mono text-caption text-bot-text break-all">{newUserPassword.password}</code>
                  <button onClick={() => navigator.clipboard.writeText(newUserPassword.password)} className="shrink-0 rounded px-3 py-2 bg-bot-accent text-white text-caption hover:bg-bot-accent/80 transition-colors">Copy</button>
                </div>
                <p className="mt-2 text-caption text-bot-red">This password will not be shown again.</p>
                <button onClick={() => setNewUserPassword(null)} className="mt-2 text-caption text-bot-muted hover:text-bot-text transition-colors">Dismiss</button>
              </div>
            )}
            <form onSubmit={handleAddUser} className="mb-6 flex gap-2">
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@example.com" className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent" />
              <button type="submit" disabled={!newEmail.trim() || addingUser} className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors">
                {addingUser ? "Adding…" : "Add User"}
              </button>
            </form>
            <div className="rounded-lg border border-bot-border overflow-hidden">
              {users.length === 0 ? (
                <p className="px-4 py-6 text-center text-body text-bot-muted">No users yet</p>
              ) : (
                users.map((user) => (
                  <div key={user.email} className="border-b border-bot-border last:border-b-0">
                    {editingUser?.email === user.email ? (
                      <div className="px-4 py-4 space-y-3 bg-bot-surface/50">
                        <div className="space-y-2">
                          <label className="block text-caption font-medium text-bot-muted">Email</label>
                          <input
                            type="email"
                            value={editForm.email}
                            onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                            className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-body text-bot-text">Admin role</p>
                            <p className="text-caption text-bot-muted">Grant full administrative privileges</p>
                          </div>
                          <button
                            type="button"
                            disabled={user.email === currentEmail}
                            onClick={() => setEditForm((f) => ({ ...f, isAdmin: !f.isAdmin }))}
                            className={cn(
                              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                              editForm.isAdmin ? "bg-bot-accent" : "bg-bot-muted/40",
                              user.email === currentEmail && "opacity-50 cursor-not-allowed"
                            )}
                            title={user.email === currentEmail ? "Cannot change your own admin role" : undefined}
                          >
                            <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", editForm.isAdmin ? "translate-x-4" : "translate-x-1")} />
                          </button>
                        </div>
                        {editError && <p className="text-caption text-bot-red">{editError}</p>}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={handleSaveEdit}
                            disabled={savingEdit}
                            className="rounded-lg bg-bot-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingUser(null)}
                            disabled={savingEdit}
                            className="rounded-lg border border-bot-border px-3 py-1.5 text-caption font-medium text-bot-muted hover:text-bot-text transition-colors"
                          >
                            Cancel
                          </button>
                          <div className="flex-1" />
                          <button
                            onClick={() => handleResetPassword(user.email)}
                            disabled={savingEdit}
                            className="rounded-lg bg-bot-amber/10 px-3 py-1.5 text-caption font-medium text-bot-amber hover:bg-bot-amber/20 disabled:opacity-50 transition-colors"
                          >
                            Reset Password
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-body text-bot-text">{user.email}</p>
                          <p className="text-caption text-bot-muted">{user.is_admin ? "Admin" : "User"} · Joined {new Date(user.created_at).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => startEditUser(user)}
                            className="rounded px-3 py-1.5 text-caption font-medium text-bot-muted hover:text-bot-accent hover:bg-bot-accent/10 transition-colors"
                          >
                            Edit
                          </button>
                          {user.email !== currentEmail && (
                            <button
                              onClick={() => handleDeleteUser(user.email)}
                              className={cn("rounded px-3 py-1.5 text-caption font-medium transition-colors", deletingEmail === user.email ? "bg-bot-red text-white" : "text-bot-muted hover:text-bot-red hover:bg-bot-red/10")}
                            >
                              {deletingEmail === user.email ? "Confirm Delete" : "Delete"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Project ── */}
        {activeSection === "project" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-bold text-bot-text">Project</h2>
            <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5 mb-6">
              <p className="text-caption text-bot-muted mb-1">Current project directory</p>
              <p className="text-body font-mono text-bot-text">{projectRoot || "Not set"}</p>
              {projectStatus && (
                <div className="mt-2 flex gap-4 text-caption">
                  <span className={projectStatus.hasClaudeMd ? "text-bot-green" : "text-bot-muted"}>{projectStatus.hasClaudeMd ? "✓" : "✗"} CLAUDE.md</span>
                  <span className={projectStatus.hasClaudeDir ? "text-bot-green" : "text-bot-muted"}>{projectStatus.hasClaudeDir ? "✓" : "✗"} .claude/</span>
                </div>
              )}
            </div>
            <form onSubmit={handleSaveProject} className="flex flex-col gap-3">
              <label className="text-caption font-medium text-bot-muted">Change project directory</label>
              <div className="flex gap-2">
                <input type="text" value={projectInput} onChange={(e) => setProjectInput(e.target.value)} placeholder="/home/user/my-project" className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 font-mono text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent" />
                <button type="submit" disabled={!projectInput.trim() || savingProject} className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors">
                  {savingProject ? "Saving…" : "Save"}
                </button>
              </div>
              {projectMsg && <p className={cn("text-caption", projectMsg.ok ? "text-bot-green" : "text-bot-red")}>{projectMsg.text}</p>}
              <p className="text-caption text-bot-muted">Changing the project directory will restart the service (~10s downtime).</p>
            </form>
          </div>
        )}

        {/* ── Activity Log ── */}
        {activeSection === "activity_log" && (
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-6 text-subtitle font-bold text-bot-text">Activity Log</h2>
            <div className="rounded-lg border border-bot-border overflow-hidden">
              {activityEntries.length === 0 && !loadingActivity ? (
                <p className="px-4 py-6 text-center text-body text-bot-muted">No activity recorded yet</p>
              ) : (
                <>
                  <div className="divide-y divide-bot-border">
                    {activityEntries.map((entry) => (
                      <div key={entry.id} className="px-4 py-3 flex items-start gap-4">
                        <div className="shrink-0 min-w-0 w-36">
                          <p className="text-caption font-mono text-bot-muted truncate">{new Date(entry.timestamp).toLocaleString()}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-body text-bot-text font-medium">{entry.event_type}</p>
                          {entry.user_email && <p className="text-caption text-bot-muted">{entry.user_email}</p>}
                          {entry.details && (
                            <p className="text-caption font-mono text-bot-muted mt-0.5 truncate">{entry.details}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {activityOffset < activityTotal && (
                    <div className="px-4 py-3 border-t border-bot-border">
                      <button
                        onClick={() => loadActivity(activityOffset)}
                        disabled={loadingActivity}
                        className="flex items-center gap-2 text-body text-bot-muted hover:text-bot-text transition-colors disabled:opacity-50"
                      >
                        {loadingActivity ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                        Load more ({activityTotal - activityOffset} remaining)
                      </button>
                    </div>
                  )}
                </>
              )}
              {loadingActivity && activityEntries.length === 0 && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-bot-muted" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Backup & Restore ── */}
        {activeSection === "backup" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-bold text-bot-text">Backup & Restore</h2>
            <div className="space-y-6">
              <div className="rounded-lg border border-bot-border bg-bot-surface p-6">
                <div className="flex items-start gap-4">
                  <Download className="h-8 w-8 text-bot-accent shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-body font-medium text-bot-text mb-1">Export Backup</p>
                    <p className="text-caption text-bot-muted mb-4">Downloads a .tar.gz containing the database, project .claude/ directory, and CLAUDE.md.</p>
                    <a
                      href={apiUrl("/api/settings/backup")}
                      download
                      className="inline-flex items-center gap-2 rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      Download Backup (.db)
                    </a>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-bot-border bg-bot-surface p-6">
                <div className="flex items-start gap-4">
                  <Upload className="h-8 w-8 text-bot-amber shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-body font-medium text-bot-text mb-1">Restore from Backup</p>
                    <p className="text-caption text-bot-muted mb-1">Upload a backup .tar.gz to restore. The service will restart automatically.</p>
                    <p className="text-caption text-bot-red mb-4">Warning: this will overwrite current data.</p>
                    <button
                      onClick={() => restoreInputRef.current?.click()}
                      disabled={restoring}
                      className="inline-flex items-center gap-2 rounded-lg border border-bot-amber text-bot-amber px-4 py-2 text-body font-medium hover:bg-bot-amber/10 disabled:opacity-50 transition-colors"
                    >
                      {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {restoring ? "Restoring…" : "Upload & Restore"}
                    </button>
                    <input ref={restoreInputRef} type="file" accept=".tar.gz,.tgz" className="hidden" onChange={handleRestoreUpload} />
                    {restoreMsg && <p className={cn("mt-3 text-caption", restoreMsg.ok ? "text-bot-green" : "text-bot-red")}>{restoreMsg.text}</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Database ── */}
        {activeSection === "database" && <DatabaseSection />}

        {/* ── System ── */}
        {activeSection === "system" && (
          <div className="mx-auto max-w-2xl space-y-6">
            <h2 className="mb-2 text-subtitle font-bold text-bot-text">System</h2>

            {/* Health checks */}
            <div className="rounded-lg border border-bot-border bg-bot-surface p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-body font-medium text-bot-text">Health Checks</p>
                <button onClick={runHealthCheck} disabled={loadingHealth} className="flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors disabled:opacity-50">
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingHealth && "animate-spin")} />
                  Refresh
                </button>
              </div>
              {health ? (
                <div className="space-y-2">
                  {[
                    { key: "database", label: "Database connected" },
                    { key: "apiKeyConfigured", label: "Anthropic API key configured" },
                    { key: "sdkInstalled", label: "Claude Agent SDK installed" },
                    { key: "socketServer", label: "Socket.IO server running" },
                  ].map((c) => (
                    <div key={c.key} className="flex items-center gap-3">
                      {health[c.key] ? (
                        <CheckCircle2 className="h-4 w-4 text-bot-green shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-bot-red shrink-0" />
                      )}
                      <span className="text-body text-bot-text">{c.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-body text-bot-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running checks…
                </div>
              )}
            </div>

            {/* Resource gauges */}
            <div className="rounded-lg border border-bot-border bg-bot-surface p-5">
              <p className="text-body font-medium text-bot-text mb-4">Resources</p>
              {resources ? (
                <div className="space-y-4">
                  <ResourceGauge label="CPU" pct={resources.cpu_pct} detail={`${resources.cpu_pct}%`} />
                  <ResourceGauge label="RAM" pct={resources.ram_pct} detail={`${resources.ram_used_mb} MB / ${resources.ram_total_mb} MB`} />
                  <ResourceGauge label="Disk" pct={resources.disk_pct} detail={`${resources.disk_used_gb} GB / ${resources.disk_total_gb} GB`} />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-body text-bot-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              )}
            </div>

            {/* Kill all */}
            <div className="rounded-lg border border-bot-red/30 bg-bot-red/5 p-5">
              <div className="flex items-start gap-4">
                <Skull className="h-6 w-6 text-bot-red shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-body font-medium text-bot-text mb-1">Kill All Sessions</p>
                  <p className="text-caption text-bot-muted mb-3">Immediately terminate all active Claude sessions.</p>
                  <button
                    onClick={handleKillAll}
                    disabled={killingAll}
                    className="inline-flex items-center gap-2 rounded-lg bg-bot-red px-4 py-2 text-body font-medium text-white hover:bg-bot-red/80 disabled:opacity-50 transition-colors"
                  >
                    {killingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Skull className="h-4 w-4" />}
                    {killingAll ? "Killing…" : "Kill All"}
                  </button>
                  {killMsg && <p className="mt-2 text-caption text-bot-green">{killMsg}</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Updates ── */}
        {activeSection === "updates" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-bold text-bot-text">Updates</h2>
            <p className="text-body text-bot-muted">
              To update, run the update script on your server or re-run the install command.
            </p>
          </div>
        )}

        {/* ── Domains ── */}
        {activeSection === "domains" && <DomainsSection />}

        {/* ── Email / SMTP ── */}
        {activeSection === "smtp" && <SmtpSection />}

        {/* ── Notifications ── */}
        {activeSection === "notifications" && <NotificationsSection />}

        {activeSection === "security" && <SecuritySection />}

        {/* ── Templates ── */}
        {activeSection === "templates" && <TemplatesSection />}

        {/* ── Budgets ── */}
        {activeSection === "budgets" && <BudgetSection />}

        {/* ── API Key ── */}
        {activeSection === "api_key" && <ApiKeySection />}

      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

interface DbHealth {
  dbSize: number;
  walSize: number;
  rowCounts: Record<string, number>;
  schemaVersion: number;
  lastVacuumAt: string | null;
  messageRetentionDays: number;
  autoVacuumMode: string;
  lastManualBackup: { name: string; created: string; size: number } | null;
  lastUpgradeBackup: { name: string; created: string; size: number } | null;
}

interface BackupEntry {
  name: string;
  pool: string;
  size: number;
  created: string;
}

function DatabaseSection() {
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [backups, setBackups] = useState<{ manual: BackupEntry[]; upgrade: BackupEntry[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [vacuuming, setVacuuming] = useState(false);
  const [retentionDays, setRetentionDays] = useState("0");
  const [savingRetention, setSavingRetention] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchHealth = () => {
    fetch(apiUrl("/api/settings/db/health"))
      .then((r) => r.json())
      .then((data: DbHealth) => {
        setHealth(data);
        setRetentionDays(String(data.messageRetentionDays));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchBackups = () => {
    fetch(apiUrl("/api/settings/db/backups"))
      .then((r) => r.json())
      .then((data: { manual: BackupEntry[]; upgrade: BackupEntry[] }) => setBackups(data))
      .catch(() => {});
  };

  useEffect(() => {
    fetchHealth();
    fetchBackups();
  }, []);

  const handleBackup = async () => {
    setBackingUp(true);
    setMessage(null);
    try {
      const res = await fetch(apiUrl("/api/settings/db/backup"), { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ ok: true, text: `Backup created: ${data.backup?.name}` });
        fetchBackups();
        fetchHealth();
      } else {
        setMessage({ ok: false, text: data.error ?? "Backup failed" });
      }
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setBackingUp(false);
    }
  };

  const handleVacuum = async () => {
    setVacuuming(true);
    setMessage(null);
    try {
      const res = await fetch(apiUrl("/api/settings/db/vacuum"), { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ ok: true, text: `VACUUM complete. Freed ${formatBytes(data.freedBytes)}` });
        fetchHealth();
      } else {
        setMessage({ ok: false, text: data.error ?? "VACUUM failed" });
      }
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setVacuuming(false);
    }
  };

  const handleSaveRetention = () => {
    setSavingRetention(true);
    const socket = getSocket();
    socket.emit("claude:set_app_setting", { key: "message_retention_days", value: retentionDays });
    setTimeout(() => {
      setSavingRetention(false);
      setMessage({ ok: true, text: retentionDays === "0" ? "Messages will be kept forever." : `Messages older than ${retentionDays} days will be cleaned up.` });
      setTimeout(() => setMessage(null), 3000);
    }, 300);
  };

  if (loading) return <div className="text-bot-muted text-caption p-8">Loading database health...</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="mb-2 text-subtitle font-bold text-bot-text">Database</h2>

      {message && (
        <div className={cn("rounded-lg px-4 py-3 text-caption", message.ok ? "bg-bot-green/10 text-bot-green" : "bg-bot-red/10 text-bot-red")}>
          {message.text}
        </div>
      )}

      {/* Overview */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <HardDrive className="h-5 w-5 text-bot-accent" />
          <p className="text-body font-medium text-bot-text">Storage</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-caption text-bot-muted">Database file</p>
            <p className="text-body text-bot-text font-mono">{health ? formatBytes(health.dbSize) : "—"}</p>
          </div>
          <div>
            <p className="text-caption text-bot-muted">WAL file</p>
            <p className="text-body text-bot-text font-mono">{health ? formatBytes(health.walSize) : "—"}</p>
          </div>
          <div>
            <p className="text-caption text-bot-muted">Auto-vacuum</p>
            <p className="text-body text-bot-text">{health?.autoVacuumMode ?? "—"}</p>
          </div>
          <div>
            <p className="text-caption text-bot-muted">Schema version</p>
            <p className="text-body text-bot-text font-mono">{health?.schemaVersion ?? "—"}</p>
          </div>
        </div>
      </div>

      {/* Row counts */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-5">
        <div className="flex items-center gap-2 mb-3">
          <Database className="h-5 w-5 text-bot-accent" />
          <p className="text-body font-medium text-bot-text">Row Counts</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {health && Object.entries(health.rowCounts).map(([table, count]) => (
            <div key={table}>
              <p className="text-caption text-bot-muted">{table}</p>
              <p className="text-body text-bot-text font-mono">{count >= 0 ? count.toLocaleString() : "—"}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Message retention */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-5 space-y-3">
        <p className="text-body font-medium text-bot-text">Message Retention</p>
        <p className="text-caption text-bot-muted">
          Automatically delete messages from sessions that haven&apos;t been updated in the specified number of days. Set to 0 to keep messages forever.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="0"
            step="1"
            value={retentionDays}
            onChange={(e) => setRetentionDays(e.target.value)}
            className="w-32 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
          />
          <span className="text-caption text-bot-muted">days (0 = forever)</span>
          <button
            onClick={handleSaveRetention}
            disabled={savingRetention}
            className="rounded-md bg-bot-accent px-3 py-2 text-caption font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
          >
            {savingRetention ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Vacuum */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-5 space-y-3">
        <p className="text-body font-medium text-bot-text">VACUUM</p>
        <p className="text-caption text-bot-muted">
          Reclaim disk space from deleted rows. The database is locked during this operation.
        </p>
        {health?.lastVacuumAt && (
          <p className="text-caption text-bot-muted">Last vacuum: {new Date(health.lastVacuumAt + "Z").toLocaleString()}</p>
        )}
        <button
          onClick={handleVacuum}
          disabled={vacuuming}
          className="inline-flex items-center gap-2 rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
        >
          {vacuuming ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {vacuuming ? "Running VACUUM..." : "Run VACUUM"}
        </button>
      </div>

      {/* Backups */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-body font-medium text-bot-text">Database Backups</p>
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="inline-flex items-center gap-2 rounded-md bg-bot-accent px-3 py-2 text-caption font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
          >
            {backingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {backingUp ? "Creating..." : "Create Backup"}
          </button>
        </div>
        <p className="text-caption text-bot-muted">
          Manual backups (max 3) and pre-upgrade backups (max 3) are stored on the server.
        </p>

        {backups && (backups.manual.length > 0 || backups.upgrade.length > 0) ? (
          <div className="space-y-3">
            {backups.manual.length > 0 && (
              <div>
                <p className="text-caption font-medium text-bot-muted mb-1">Manual</p>
                {backups.manual.map((b) => (
                  <div key={b.name} className="flex justify-between items-center py-1 text-caption">
                    <span className="text-bot-text font-mono">{b.name}</span>
                    <span className="text-bot-muted">{formatBytes(b.size)}</span>
                  </div>
                ))}
              </div>
            )}
            {backups.upgrade.length > 0 && (
              <div>
                <p className="text-caption font-medium text-bot-muted mb-1">Pre-upgrade</p>
                {backups.upgrade.map((b) => (
                  <div key={b.name} className="flex justify-between items-center py-1 text-caption">
                    <span className="text-bot-text font-mono">{b.name}</span>
                    <span className="text-bot-muted">{formatBytes(b.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-caption text-bot-muted/60">No backups yet.</p>
        )}
      </div>
    </div>
  );
}

function BudgetSection() {
  const [sessionLimit, setSessionLimit] = useState("0");
  const [dailyLimit, setDailyLimit] = useState("0");
  const [monthlyLimit, setMonthlyLimit] = useState("0");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    const handle = ({ settings: s }: { settings: Record<string, string> }) => {
      setSessionLimit(s.budget_limit_session_usd ?? "0");
      setDailyLimit(s.budget_limit_daily_usd ?? "0");
      setMonthlyLimit(s.budget_limit_monthly_usd ?? "0");
    };
    socket.on("claude:app_settings", handle);
    socket.emit("claude:get_app_settings");
    return () => { socket.off("claude:app_settings", handle); };
  }, []);

  const handleSave = () => {
    setSaving(true);
    const socket = getSocket();
    socket.emit("claude:set_app_setting", { key: "budget_limit_session_usd", value: sessionLimit });
    socket.emit("claude:set_app_setting", { key: "budget_limit_daily_usd", value: dailyLimit });
    socket.emit("claude:set_app_setting", { key: "budget_limit_monthly_usd", value: monthlyLimit });
    setTimeout(() => { setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); }, 300);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-subtitle font-bold text-bot-text">Budget Limits</h2>
      <p className="text-caption text-bot-muted">Set spending limits for Claude usage. Set to 0 to disable.</p>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Per-session limit (USD)</label>
          <input type="number" step="0.01" min="0" value={sessionLimit} onChange={(e) => setSessionLimit(e.target.value)}
            className="w-48 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent" />
        </div>
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Daily limit (USD)</label>
          <input type="number" step="0.01" min="0" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)}
            className="w-48 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent" />
        </div>
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Monthly limit (USD)</label>
          <input type="number" step="0.01" min="0" value={monthlyLimit} onChange={(e) => setMonthlyLimit(e.target.value)}
            className="w-48 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent" />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors">
        {saving ? "Saving..." : saved ? "Saved!" : "Save Budget Limits"}
      </button>
    </div>
  );
}

function ApiKeySection() {
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState("");
  const [inputKey, setInputKey] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(apiUrl("/api/app-settings/api-key"))
      .then((r) => r.json())
      .then((data: { hasKey: boolean; maskedKey: string }) => {
        setHasKey(data.hasKey);
        setMaskedKey(data.maskedKey);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(apiUrl("/api/app-settings/api-key"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: inputKey }),
      });
      const data = await res.json();
      if (data.success) {
        setHasKey(data.hasKey);
        setMaskedKey(data.maskedKey);
        setInputKey("");
        setShowInput(false);
        setMessage({ ok: true, text: "API key saved. SDK provider is now available." });
      } else {
        setMessage({ ok: false, text: data.error ?? "Failed to save" });
      }
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      await fetch(apiUrl("/api/app-settings/api-key"), { method: "DELETE" });
      setHasKey(false);
      setMaskedKey("");
      setMessage({ ok: true, text: "API key cleared. SDK provider is no longer available." });
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-bot-muted text-caption">Loading...</div>;

  return (
    <div className="space-y-4">
      <h3 className="text-subtitle font-bold text-bot-text">Anthropic API Key</h3>
      <p className="text-caption text-bot-muted">
        Your Anthropic API key is used to communicate with Claude. Get one at console.anthropic.com.
      </p>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "h-2 w-2 rounded-full",
            hasKey ? "bg-bot-green" : "bg-bot-muted",
          )} />
          <span className="text-body text-bot-text">
            {hasKey ? `SDK Available (${maskedKey})` : "CLI Only (no API key)"}
          </span>
        </div>

        {!showInput && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowInput(true)}
              className="rounded-md bg-bot-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-bot-accent/80 transition-colors"
            >
              {hasKey ? "Update Key" : "Add API Key"}
            </button>
            {hasKey && (
              <button
                onClick={handleClear}
                disabled={saving}
                className="rounded-md border border-bot-red/40 px-3 py-1.5 text-caption font-medium text-bot-red hover:bg-bot-red/10 transition-colors disabled:opacity-50"
              >
                Remove Key
              </button>
            )}
          </div>
        )}

        {showInput && (
          <div className="space-y-2">
            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-2.5 text-body text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 focus:shadow-glow-sm transition-all duration-200 transition-colors font-mono"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !inputKey.trim()}
                className="rounded-md bg-bot-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setShowInput(false); setInputKey(""); }}
                className="rounded-md border border-bot-border px-3 py-1.5 text-caption text-bot-muted hover:bg-bot-elevated transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {message && (
          <div className={cn(
            "rounded-md px-3 py-2 text-caption",
            message.ok ? "bg-bot-green/10 text-bot-green" : "bg-bot-red/10 text-bot-red",
          )}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}

function ResourceGauge({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const color = pct > 85 ? "bg-bot-red" : pct > 65 ? "bg-bot-amber" : "bg-bot-green";
  return (
    <div>
      <div className="flex justify-between text-caption mb-1">
        <span className="text-bot-muted">{label}</span>
        <span className="text-bot-text font-mono">{detail}</span>
      </div>
      <div className="h-2 rounded-full bg-bot-elevated overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function SettingRow({
  title,
  description,
  warning,
  warningText,
  children,
}: {
  title: string;
  description: string;
  warning?: boolean;
  warningText?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-body font-semibold text-bot-text">{title}</p>
          <p className="mt-0.5 text-caption text-bot-muted/70">{description}</p>
          {warning && warningText && <p className="mt-2 text-caption text-bot-red">{warningText}</p>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  danger,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 focus:outline-none",
        checked
          ? danger
            ? "bg-bot-red shadow-[0_0_10px_2px_rgb(var(--bot-red)/0.25)]"
            : "bg-bot-accent shadow-glow-sm"
          : "bg-bot-elevated border border-bot-border/40",
      )}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-300", checked ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

// ── Profile Section (experience level, server purpose, project type) ─────────

function ProfileSection() {
  const profile = useUserProfile();
  const [experienceLevel, setExperienceLevel] = useState(profile.experience_level);
  const [autSummary, setAutoSummary] = useState(profile.auto_summary);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const bp = getBasePath();

  const LEVEL_OPTIONS = [
    { id: "beginner", label: "🌱 Beginner", desc: "Plain language, step-by-step" },
    { id: "intermediate", label: "🔧 Intermediate", desc: "Technical when needed" },
    { id: "expert", label: "⚡ Expert", desc: "Full detail, no hand-holding" },
  ];

  async function save() {
    setSaving(true);
    try {
      await fetch(`${bp}/api/users/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experience_level: experienceLevel,
          auto_summary: autSummary,
          update_claude_md: true,
        }),
      });
      invalidateProfileCache(); // force refetch on next render
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5 space-y-4">
      <div>
        <p className="text-body font-medium text-bot-text">Experience Level</p>
        <p className="mt-0.5 text-caption text-bot-muted">Changes how the assistant communicates and which features are shown.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {LEVEL_OPTIONS.map((opt) => (
          <button key={opt.id} onClick={() => setExperienceLevel(opt.id as typeof experienceLevel)}
            className={cn(
              "rounded-xl border px-3 py-3 text-left text-caption transition-all duration-200",
              experienceLevel === opt.id
                ? "border-bot-accent bg-bot-accent/10 text-bot-accent"
                : "border-bot-border/40 text-bot-text/80 hover:border-bot-accent/40 hover:bg-bot-elevated/30"
            )}>
            <div className="font-medium">{opt.label}</div>
            <div className={cn("text-[10px] mt-0.5", experienceLevel === opt.id ? "text-bot-accent/70" : "text-bot-muted/60")}>{opt.desc}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-body text-bot-text">Summarize completed actions</p>
          <p className="text-caption text-bot-muted mt-0.5">Assistant explains what it did after each task.</p>
        </div>
        <button
          onClick={() => setAutoSummary((v) => !v)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300",
            autSummary ? "bg-bot-accent shadow-glow-sm" : "bg-bot-elevated"
          )}
        >
          <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-300", autSummary ? "translate-x-6" : "translate-x-1")} />
        </button>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving}
          className="rounded-lg gradient-accent px-4 py-2 text-caption font-semibold text-white shadow-glow-sm hover:brightness-110 disabled:opacity-50 transition-all duration-200">
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="text-caption text-bot-green">✓ Saved — effective in new sessions</span>}
      </div>
    </div>
  );
}

function getBasePath() {
  const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
  const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
  return slug ? `/${prefix}/${slug}` : "";
}

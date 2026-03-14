"use client";

import { useEffect, useState, useRef } from "react";
import { getSocket } from "@/lib/socket";
import { cn, apiUrl } from "@/lib/utils";
import type { ClaudeUserSettings } from "@/lib/claude-db";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Upload,
  Zap,
  Skull,
  RefreshCw,
  ChevronDown,
} from "lucide-react";

import { DomainsSection } from "@/components/claude-code/settings/domains-section";
import { SmtpSection } from "@/components/claude-code/settings/smtp-section";
import { NotificationsSection } from "@/components/claude-code/settings/notifications-section";

import { SecuritySection } from "@/components/claude-code/settings/security-section";
import { TemplatesSection } from "@/components/claude-code/settings/templates-section";

type SectionKey =
  | "general"
  | "bot_identity"
  | "rate_limits"
  | "users"
  | "project"
  | "activity_log"
  | "backup"
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
  const [settings, setSettings] = useState<ClaudeUserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("general");
  const [isAdmin, setIsAdmin] = useState(false);

  // Users state
  const [users, setUsers] = useState<{ email: string; is_admin: number; created_at: string }[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [newUserPassword, setNewUserPassword] = useState<{ email: string; password: string } | null>(null);
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null);

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
  const [updatingClaude, setUpdatingClaude] = useState(false);
  const [updateOutput, setUpdateOutput] = useState<string | null>(null);
  const [killingAll, setKillingAll] = useState(false);
  const [killMsg, setKillMsg] = useState<string | null>(null);

  // Backup/restore
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Auto-update
  const [autoUpdate, setAutoUpdate] = useState("false");
  const [savingAutoUpdate, setSavingAutoUpdate] = useState(false);

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
        setAutoUpdate(d.auto_update_enabled ?? "false");
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
    socket.once("claude:settings", () => {
      setSaving(false);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    });
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
      await fetch(apiUrl("/api/users"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setUsers((prev) => prev.filter((u) => u.email !== email));
      setDeletingEmail(null);
    } else {
      setDeletingEmail(email);
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
    await fetch(apiUrl("/api/app-settings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rate_limit_commands: rateCmds,
        rate_limit_runtime_min: rateRuntime,
        rate_limit_concurrent: rateConcurrent,
      }),
    });
    setSavingRates(false);
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

  async function handleClaudeUpdate() {
    setUpdatingClaude(true);
    setUpdateOutput(null);
    try {
      const res = await fetch(apiUrl("/api/system/claude-update"), { method: "POST" });
      const data = await res.json();
      setUpdateOutput(data.output ?? (data.ok ? "Updated successfully" : "Update failed"));
    } finally {
      setUpdatingClaude(false);
    }
  }

  async function handleKillAll() {
    setKillingAll(true);
    setKillMsg(null);
    try {
      const socket = getSocket();
      socket.emit("claude:kill_all");
      socket.once("claude:kill_all_done", ({ killed }: { killed: number }) => {
        setKillMsg(`Killed ${killed} session(s)`);
        setKillingAll(false);
      });
      // Fallback timeout
      setTimeout(() => {
        setKillingAll(false);
        if (!killMsg) setKillMsg("Kill signal sent");
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
      formData.append("backup", file);
      const res = await fetch(apiUrl("/api/settings/restore"), { method: "POST", body: formData });
      const data = await res.json();
      setRestoreMsg(res.ok ? { ok: true, text: "Restore complete. Service restarting…" } : { ok: false, text: data.error ?? "Restore failed" });
    } finally {
      setRestoring(false);
    }
  }

  async function handleAutoUpdateToggle() {
    const newVal = autoUpdate === "true" ? "false" : "true";
    setSavingAutoUpdate(true);
    await fetch(apiUrl("/api/app-settings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_update_enabled: newVal }),
    });
    setAutoUpdate(newVal);
    setSavingAutoUpdate(false);
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
    { key: "bot_identity", label: "Bot Identity" },
    { key: "rate_limits", label: "Rate Limits", adminOnly: true },
    { key: "users", label: "Users", adminOnly: true },
    { key: "project", label: "Project", adminOnly: true },
    { key: "notifications", label: "Notifications" },
    { key: "activity_log", label: "Activity Log" },
    { key: "backup", label: "Backup & Restore", adminOnly: true },
    { key: "system", label: "System", adminOnly: true },
    { key: "updates", label: "Updates", adminOnly: true },
    { key: "domains", label: "Domains", adminOnly: true },
    { key: "smtp", label: "Email / SMTP", adminOnly: true },
    { key: "security", label: "Security", adminOnly: true },
    { key: "templates", label: "Templates", adminOnly: true },
    { key: "budgets", label: "Budgets", adminOnly: true },
    { key: "api_key", label: "API Key (SDK)", adminOnly: true },
  ];
  const sections = allSections.filter((s) => !s.adminOnly || isAdmin);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-44 shrink-0 border-r border-bot-border bg-bot-surface flex flex-col py-2 overflow-y-auto space-y-1">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={cn(
              "w-full text-left px-4 py-2.5 text-body transition-colors",
              activeSection === s.key
                ? "bg-bot-accent/10 text-bot-accent font-medium"
                : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 pb-12 space-y-6">

        {/* ── General ── */}
        {activeSection === "general" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">General</h2>
            <div className="space-y-6">
              <SettingRow title="Session Auto-Naming" description="Automatically name new sessions based on the first message sent.">
                <Toggle checked={settings.auto_naming_enabled} onChange={(v) => update({ auto_naming_enabled: v })} />
              </SettingRow>
              <SettingRow
                title="Full Trust Mode"
                description="Skip confirmation prompts for destructive operations."
                warning={settings.full_trust_mode}
                warningText="Full Trust Mode is active. Claude will execute destructive operations without confirmation."
              >
                <Toggle checked={settings.full_trust_mode} onChange={(v) => update({ full_trust_mode: v })} danger />
              </SettingRow>
              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
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
                  className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent resize-none"
                />
              </div>
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
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Bot Identity</h2>
            <form onSubmit={handleSaveIdentity} className="space-y-5">
              {/* Avatar */}
              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
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
              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
                <label className="block text-body font-medium text-bot-text mb-2">Bot Name</label>
                <input
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              {/* Tagline */}
              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
                <label className="block text-body font-medium text-bot-text mb-2">Tagline</label>
                <input
                  value={botTagline}
                  onChange={(e) => setBotTagline(e.target.value)}
                  className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              {/* Preview */}
              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
                <p className="text-caption text-bot-muted mb-3">Login page preview</p>
                <div className="flex flex-col items-center gap-2 py-4 bg-bot-bg rounded-lg">
                  <div className="h-14 w-14 rounded-full overflow-hidden border border-bot-border">
                    {botAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={botAvatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src="/claude-code.png" alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <p className="text-title font-semibold text-bot-text">{botName || "Bot Name"}</p>
                  <p className="text-caption text-bot-muted">{botTagline || "Tagline"}</p>
                </div>
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

        {/* ── Rate Limits ── */}
        {activeSection === "rate_limits" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Rate Limits</h2>
            <p className="text-body text-bot-muted mb-6">Per-user limits applied to chat sessions.</p>
            <form onSubmit={handleSaveRates} className="space-y-4">
              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
                <label className="block text-body font-medium text-bot-text mb-1">Commands per session</label>
                <p className="text-caption text-bot-muted mb-2">Max number of messages a user can send in one session.</p>
                <input
                  type="number" min="1" value={rateCmds} onChange={(e) => setRateCmds(e.target.value)}
                  className="w-32 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
                <label className="block text-body font-medium text-bot-text mb-1">Session runtime (minutes)</label>
                <p className="text-caption text-bot-muted mb-2">Max duration of a session before it is terminated.</p>
                <input
                  type="number" min="1" value={rateRuntime} onChange={(e) => setRateRuntime(e.target.value)}
                  className="w-32 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
                <label className="block text-body font-medium text-bot-text mb-1">Concurrent sessions</label>
                <p className="text-caption text-bot-muted mb-2">Max number of active sessions per user at one time.</p>
                <input
                  type="number" min="1" value={rateConcurrent} onChange={(e) => setRateConcurrent(e.target.value)}
                  className="w-32 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                />
              </div>
              <button
                type="submit" disabled={savingRates}
                className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
              >
                {savingRates ? "Saving…" : "Save Limits"}
              </button>
            </form>
          </div>
        )}

        {/* ── Users ── */}
        {activeSection === "users" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Users</h2>
            {newUserPassword && (
              <div className="mb-6 rounded-lg border border-bot-green/40 bg-bot-green/10 p-4">
                <p className="text-body font-medium text-bot-green mb-2">User created: {newUserPassword.email}</p>
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
                  <div key={user.email} className="flex items-center justify-between px-4 py-3 border-b border-bot-border last:border-b-0">
                    <div>
                      <p className="text-body text-bot-text">{user.email}</p>
                      <p className="text-caption text-bot-muted">{user.is_admin ? "Admin" : "User"} · Joined {new Date(user.created_at).toLocaleDateString()}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteUser(user.email)}
                      className={cn("rounded px-3 py-1.5 text-caption font-medium transition-colors", deletingEmail === user.email ? "bg-bot-red text-white" : "text-bot-muted hover:text-bot-red hover:bg-bot-red/10")}
                    >
                      {deletingEmail === user.email ? "Confirm Delete" : "Delete"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Project ── */}
        {activeSection === "project" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Project</h2>
            <div className="rounded-lg border border-bot-border bg-bot-surface p-4 mb-6">
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
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Activity Log</h2>
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
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Backup & Restore</h2>
            <div className="space-y-6">
              <div className="rounded-lg border border-bot-border bg-bot-surface p-6">
                <div className="flex items-start gap-4">
                  <Download className="h-8 w-8 text-bot-accent shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-body font-medium text-bot-text mb-1">Export Backup</p>
                    <p className="text-caption text-bot-muted mb-4">Downloads a .tar.gz containing the database, project .claude/ directory, and CLAUDE.md.</p>
                    <a
                      href="/api/settings/backup"
                      download
                      className="inline-flex items-center gap-2 rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      Download Backup
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

        {/* ── System ── */}
        {activeSection === "system" && (
          <div className="mx-auto max-w-2xl space-y-6">
            <h2 className="mb-2 text-subtitle font-semibold text-bot-text">System</h2>

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
                    { key: "cli_exists", label: "Claude CLI installed" },
                    { key: "authenticated", label: "Authenticated with Anthropic" },
                    { key: "responding", label: "Claude is responding" },
                    { key: "project_accessible", label: "Project directory accessible" },
                    { key: "disk_ok", label: "Sufficient disk space (>10% free)" },
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

            {/* Claude update */}
            <div className="rounded-lg border border-bot-border bg-bot-surface p-5">
              <div className="flex items-start gap-4">
                <Zap className="h-6 w-6 text-bot-accent shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-body font-medium text-bot-text mb-1">Update Claude CLI</p>
                  <p className="text-caption text-bot-muted mb-3">Runs <code className="font-mono text-bot-text">npm update -g @anthropic-ai/claude-code</code>.</p>
                  <button
                    onClick={handleClaudeUpdate}
                    disabled={updatingClaude}
                    className="inline-flex items-center gap-2 rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
                  >
                    {updatingClaude ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    {updatingClaude ? "Updating…" : "Run Update"}
                  </button>
                  {updateOutput && (
                    <pre className="mt-3 rounded-md bg-bot-elevated p-3 text-caption font-mono text-bot-text overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                      {updateOutput}
                    </pre>
                  )}
                </div>
              </div>
            </div>

            {/* Kill all */}
            <div className="rounded-lg border border-bot-red/30 bg-bot-red/5 p-5">
              <div className="flex items-start gap-4">
                <Skull className="h-6 w-6 text-bot-red shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-body font-medium text-bot-text mb-1">Kill All Sessions</p>
                  <p className="text-caption text-bot-muted mb-3">Immediately terminate all active Claude subprocesses.</p>
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
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Updates</h2>
            <SettingRow title="Auto-Update Claude CLI" description="Automatically update Claude CLI every Sunday at 3:00 AM (fixed schedule).">
              <Toggle checked={autoUpdate === "true"} onChange={handleAutoUpdateToggle} />
            </SettingRow>
            {savingAutoUpdate && <p className="mt-2 text-caption text-bot-muted">Saving…</p>}
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
      <h2 className="text-subtitle font-semibold text-bot-text">Budget Limits</h2>
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
      <h3 className="text-subtitle font-semibold text-bot-text">Anthropic API Key</h3>
      <p className="text-caption text-bot-muted">
        Configure an API key to enable the SDK provider. This allows sessions to use the Anthropic API directly
        instead of the Claude CLI subprocess.
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
              className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors font-mono"
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
    <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-body font-medium text-bot-text">{title}</p>
          <p className="mt-0.5 text-caption text-bot-muted">{description}</p>
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
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none",
        checked ? (danger ? "bg-bot-red" : "bg-bot-accent") : "bg-bot-elevated border border-bot-border",
      )}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

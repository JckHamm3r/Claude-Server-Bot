"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { ClaudeUserSettings } from "@/lib/claude-db";

export function SettingsPanel() {
  const [settings, setSettings] = useState<ClaudeUserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [activeSection, setActiveSection] = useState<"general" | "users" | "project">("general");

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

  useEffect(() => {
    const socket = getSocket();
    socket.emit("claude:get_settings");
    socket.on("claude:settings", ({ settings: s }: { settings: ClaudeUserSettings }) => {
      setSettings(s);
    });
    return () => { socket.off("claude:settings"); };
  }, []);

  useEffect(() => {
    if (activeSection === "users") {
      fetch("/api/users")
        .then((r) => r.json())
        .then((data) => setUsers(data.users ?? []))
        .catch(() => {});
    }
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
      const res = await fetch("/api/users", {
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
      await fetch("/api/users", {
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
      const res = await fetch("/api/settings/project", {
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

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-bot-muted text-body">
        Loading settings…
      </div>
    );
  }

  const sections = [
    { key: "general" as const, label: "General" },
    { key: "users" as const, label: "Users" },
    { key: "project" as const, label: "Project" },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-40 shrink-0 border-r border-bot-border bg-bot-surface flex flex-col py-2">
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
      <div className="flex-1 overflow-y-auto p-8">
        {activeSection === "general" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">General</h2>

            <div className="space-y-6">
              <SettingRow
                title="Session Auto-Naming"
                description="Automatically name new sessions based on the first message sent."
              >
                <Toggle
                  checked={settings.auto_naming_enabled}
                  onChange={(v) => update({ auto_naming_enabled: v })}
                />
              </SettingRow>

              <SettingRow
                title="Full Trust Mode"
                description="Skip confirmation prompts for destructive operations."
                warning={settings.full_trust_mode}
                warningText="Full Trust Mode is active. Claude will execute destructive operations without confirmation."
              >
                <Toggle
                  checked={settings.full_trust_mode}
                  onChange={(v) => update({ full_trust_mode: v })}
                  danger={true}
                />
              </SettingRow>

              <div className="rounded-lg border border-bot-border bg-bot-surface p-4">
                <div className="mb-3">
                  <p className="text-body font-medium text-bot-text">Custom Default Context</p>
                  <p className="mt-0.5 text-caption text-bot-muted">
                    This text is prepended to every new session as additional context for Claude.
                  </p>
                </div>
                <textarea
                  value={settings.custom_default_context ?? ""}
                  onChange={(e) =>
                    setSettings((s) => s ? { ...s, custom_default_context: e.target.value || null } : s)
                  }
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

        {activeSection === "users" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Users</h2>

            {newUserPassword && (
              <div className="mb-6 rounded-lg border border-bot-green/40 bg-bot-green/10 p-4">
                <p className="text-body font-medium text-bot-green mb-2">User created: {newUserPassword.email}</p>
                <p className="text-caption text-bot-muted mb-2">Password (shown once only):</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-bot-elevated px-3 py-2 font-mono text-caption text-bot-text break-all">
                    {newUserPassword.password}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(newUserPassword.password)}
                    className="shrink-0 rounded px-3 py-2 bg-bot-accent text-white text-caption hover:bg-bot-accent/80 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-2 text-caption text-bot-red">This password will not be shown again.</p>
                <button onClick={() => setNewUserPassword(null)} className="mt-2 text-caption text-bot-muted hover:text-bot-text transition-colors">
                  Dismiss
                </button>
              </div>
            )}

            <form onSubmit={handleAddUser} className="mb-6 flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@example.com"
                className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent"
              />
              <button
                type="submit"
                disabled={!newEmail.trim() || addingUser}
                className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
              >
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
                      <p className="text-caption text-bot-muted">
                        {user.is_admin ? "Admin" : "User"} · Joined {new Date(user.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteUser(user.email)}
                      className={cn(
                        "rounded px-3 py-1.5 text-caption font-medium transition-colors",
                        deletingEmail === user.email
                          ? "bg-bot-red text-white"
                          : "text-bot-muted hover:text-bot-red hover:bg-bot-red/10",
                      )}
                    >
                      {deletingEmail === user.email ? "Confirm Delete" : "Delete"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeSection === "project" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-6 text-subtitle font-semibold text-bot-text">Project</h2>

            <div className="rounded-lg border border-bot-border bg-bot-surface p-4 mb-6">
              <p className="text-caption text-bot-muted mb-1">Current project directory</p>
              <p className="text-body font-mono text-bot-text">{projectRoot || "Not set"}</p>
              {projectStatus && (
                <div className="mt-2 flex gap-4 text-caption">
                  <span className={projectStatus.hasClaudeMd ? "text-bot-green" : "text-bot-muted"}>
                    {projectStatus.hasClaudeMd ? "✓" : "✗"} CLAUDE.md
                  </span>
                  <span className={projectStatus.hasClaudeDir ? "text-bot-green" : "text-bot-muted"}>
                    {projectStatus.hasClaudeDir ? "✓" : "✗"} .claude/
                  </span>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveProject} className="flex flex-col gap-3">
              <label className="text-caption font-medium text-bot-muted">Change project directory</label>
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
                  className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
                >
                  {savingProject ? "Saving…" : "Save"}
                </button>
              </div>
              {projectMsg && (
                <p className={cn("text-caption", projectMsg.ok ? "text-bot-green" : "text-bot-red")}>
                  {projectMsg.text}
                </p>
              )}
              <p className="text-caption text-bot-muted">
                Changing the project directory will restart the service (~10s downtime).
              </p>
            </form>
          </div>
        )}
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
          {warning && warningText && (
            <p className="mt-2 text-caption text-bot-red">{warningText}</p>
          )}
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
        checked
          ? danger
            ? "bg-bot-red"
            : "bg-bot-accent"
          : "bg-bot-elevated border border-bot-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

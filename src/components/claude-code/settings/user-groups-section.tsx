"use client";

import React, { useEffect, useState, useCallback, KeyboardEvent } from "react";
import {
  Plus, Pencil, Trash2, X, ArrowLeft, Users, Shield, Terminal,
  FolderOpen, Settings, FileText, MessageSquare, ChevronDown, ChevronUp, Copy, Layout
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";

interface UserGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  is_system: number;
  created_at: string;
  updated_at: string;
  member_count: number;
}

interface GroupPermissions {
  platform: {
    sessions_create: boolean;
    sessions_view_others: boolean;
    sessions_collaborate: boolean;
    templates_view: boolean;
    templates_manage: boolean;
    memories_view: boolean;
    memories_manage: boolean;
    files_browse: boolean;
    files_upload: boolean;
    terminal_access: boolean;
    observe_only: boolean;
    visible_tabs: string[];
    visible_settings: string[];
  };
  ai: {
    commands_allowed: string[];
    commands_blocked: string[];
    shell_access: boolean;
    full_trust_allowed: boolean;
    directories_allowed: string[];
    directories_blocked: string[];
    filetypes_allowed: string[];
    filetypes_blocked: string[];
    read_only: boolean;
  };
  session: {
    max_active: number;
    max_turns: number;
    models_allowed: string[];
    delegation_enabled: boolean;
    delegation_max_depth: number;
    default_model: string;
    default_template: string;
  };
  prompt: {
    system_prompt_append: string;
    default_context: string;
    communication_style: string;
  };
}

interface GroupMember {
  email: string;
  first_name: string;
  last_name: string;
  is_admin: number;
  avatar_url: string | null;
}

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#6b7280",
];

const DEFAULT_PERMISSIONS: GroupPermissions = {
  platform: {
    sessions_create: true,
    sessions_view_others: false,
    sessions_collaborate: false,
    templates_view: true,
    templates_manage: false,
    memories_view: true,
    memories_manage: false,
    files_browse: true,
    files_upload: false,
    terminal_access: false,
    observe_only: false,
    visible_tabs: ["chat", "agents", "plan", "memory"],
    visible_settings: ["general", "notifications"],
  },
  ai: {
    commands_allowed: [],
    commands_blocked: [],
    shell_access: false,
    full_trust_allowed: false,
    directories_allowed: [],
    directories_blocked: [],
    filetypes_allowed: [],
    filetypes_blocked: [],
    read_only: false,
  },
  session: {
    max_active: 0,
    max_turns: 0,
    models_allowed: [],
    delegation_enabled: false,
    delegation_max_depth: 2,
    default_model: "",
    default_template: "",
  },
  prompt: {
    system_prompt_append: "",
    default_context: "",
    communication_style: "intermediate",
  },
};

// ── Tag Input ────────────────────────────────────────────────────────────────

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const tag = input.trim();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setInput("");
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 rounded-md border border-bot-border bg-bot-bg px-2 py-1.5 min-h-[38px] focus-within:border-bot-accent">
      {value.map((tag) => (
        <span key={tag} className="flex items-center gap-1 rounded bg-bot-accent/15 px-2 py-0.5 text-caption text-bot-accent">
          {tag}
          <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} className="hover:text-bot-red transition-colors">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={addTag}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[120px] bg-transparent text-body text-bot-text outline-none placeholder:text-bot-muted"
      />
    </div>
  );
}

// ── Toggle Row ───────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer py-2 border-b border-bot-border/50 last:border-0">
      <div>
        <p className="text-body text-bot-text">{label}</p>
        {description && <p className="text-caption text-bot-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors",
          checked ? "bg-bot-accent" : "bg-bot-border"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </button>
    </label>
  );
}

// ── Group List ───────────────────────────────────────────────────────────────

type EditorTab = "members" | "platform" | "ai" | "files" | "sessions" | "prompt" | "ui_access";

export function UserGroupsSection() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createColor, setCreateColor] = useState(PRESET_COLORS[0]);
  const [createCloneFrom, setCreateCloneFrom] = useState("");
  const [creating, setCreating] = useState(false);

  // Editor state
  const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("members");

  const flash = useCallback((ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3500);
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/groups"));
      const data = await res.json();
      if (data.groups) setGroups(data.groups);
    } catch {
      flash(false, "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreateGroup = async () => {
    if (!createName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(apiUrl("/api/groups"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          description: createDesc.trim(),
          color: createColor,
          icon: "👥",
          ...(createCloneFrom ? { clone_from: createCloneFrom } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      setShowCreate(false);
      setCreateName("");
      setCreateDesc("");
      setCreateColor(PRESET_COLORS[0]);
      setCreateCloneFrom("");
      await fetchGroups();
      // Open editor immediately for new group
      setEditingGroup(data.group);
      setActiveTab("members");
    } catch (e: unknown) {
      flash(false, e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (group: UserGroup) => {
    if (confirmDelete !== group.id) {
      setConfirmDelete(group.id);
      return;
    }
    setConfirmDelete(null);
    try {
      const res = await fetch(apiUrl(`/api/groups/${group.id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setGroups((prev) => prev.filter((g) => g.id !== group.id));
      flash(true, `"${group.name}" deleted`);
    } catch {
      flash(false, "Delete failed");
    }
  };

  const handleClone = async (group: UserGroup) => {
    setCreateName(`${group.name} (Copy)`);
    setCreateDesc(group.description ?? "");
    setCreateColor(group.color ?? PRESET_COLORS[0]);
    setCreateCloneFrom(group.id);
    setShowCreate(true);
  };

  if (editingGroup) {
    return (
      <GroupEditor
        group={editingGroup}
        allGroups={groups}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onBack={() => { setEditingGroup(null); fetchGroups(); }}
        onGroupUpdate={(updated) => setEditingGroup(updated)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-subtitle font-semibold text-bot-text">User Groups</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-md bg-bot-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-bot-accent/80 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Group
        </button>
      </div>

      <p className="text-caption text-bot-muted">
        Organize users into groups and configure per-group permissions, AI access, and session limits.
      </p>

      {msg && (
        <p className={cn("text-caption", msg.ok ? "text-bot-green" : "text-bot-red")}>{msg.text}</p>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="rounded-lg border border-bot-border bg-bot-elevated p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-body font-medium text-bot-text">New Group</span>
            <button onClick={() => setShowCreate(false)} className="rounded p-1 text-bot-muted hover:bg-bot-surface transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-caption font-medium text-bot-muted">Name</label>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Developers"
                className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-caption font-medium text-bot-muted">Color</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCreateColor(c)}
                    className={cn("h-6 w-6 rounded-full border-2 transition-all", createColor === c ? "border-white scale-110" : "border-transparent")}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-caption font-medium text-bot-muted">Description</label>
            <input
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder="Brief description"
              className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-caption font-medium text-bot-muted">Clone from (optional)</label>
            <select
              value={createCloneFrom}
              onChange={(e) => setCreateCloneFrom(e.target.value)}
              className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
            >
              <option value="">— No clone —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowCreate(false)} className="rounded-md border border-bot-border px-4 py-2 text-body text-bot-muted hover:bg-bot-surface transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreateGroup}
              disabled={!createName.trim() || creating}
              className="rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Group Cards */}
      {loading ? (
        <p className="text-body text-bot-muted py-4">Loading groups…</p>
      ) : groups.length === 0 && !showCreate ? (
        <p className="text-body text-bot-muted py-4">No groups yet. Create one to get started.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <div
              key={group.id}
              className="relative flex flex-col rounded-lg border border-bot-border bg-bot-elevated overflow-hidden group"
              style={{ borderLeftColor: group.color, borderLeftWidth: 3 }}
            >
              <div className="flex-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-semibold text-bot-text truncate">{group.name}</span>
                      {group.is_system === 1 && (
                        <span className="rounded-full bg-bot-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-bot-accent shrink-0">
                          system
                        </span>
                      )}
                    </div>
                    {group.description && (
                      <p className="text-caption text-bot-muted mt-0.5 line-clamp-2">{group.description}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-bot-muted" />
                  <span className="text-caption text-bot-muted">{group.member_count} member{group.member_count !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 border-t border-bot-border/50 px-3 py-2 bg-bot-surface/30 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => { setEditingGroup(group); setActiveTab("members"); }}
                  className="flex items-center gap-1 rounded px-2 py-1 text-caption text-bot-muted hover:text-bot-accent hover:bg-bot-surface transition-colors"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                <button
                  onClick={() => handleClone(group)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-caption text-bot-muted hover:text-bot-accent hover:bg-bot-surface transition-colors"
                >
                  <Copy className="h-3 w-3" /> Clone
                </button>
                {group.is_system !== 1 && (
                  confirmDelete === group.id ? (
                    <button
                      onClick={() => handleDelete(group)}
                      className="ml-auto rounded px-2 py-1 text-caption text-bot-red bg-bot-red/10 hover:bg-bot-red/20 transition-colors"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDelete(group)}
                      className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-caption text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Group Editor ─────────────────────────────────────────────────────────────

const EDITOR_TABS: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
  { id: "members", label: "Members", icon: <Users className="h-3.5 w-3.5" /> },
  { id: "platform", label: "Platform", icon: <Shield className="h-3.5 w-3.5" /> },
  { id: "ai", label: "AI & Commands", icon: <Terminal className="h-3.5 w-3.5" /> },
  { id: "files", label: "Files & Dirs", icon: <FolderOpen className="h-3.5 w-3.5" /> },
  { id: "sessions", label: "Sessions", icon: <Settings className="h-3.5 w-3.5" /> },
  { id: "prompt", label: "Prompt", icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "ui_access", label: "UI Access", icon: <Layout className="h-3.5 w-3.5" /> },
];

function GroupEditor({
  group,
  allGroups: _allGroups,
  activeTab,
  setActiveTab,
  onBack,
  onGroupUpdate,
}: {
  group: UserGroup;
  allGroups: UserGroup[];
  activeTab: EditorTab;
  setActiveTab: (t: EditorTab) => void;
  onBack: () => void;
  onGroupUpdate: (g: UserGroup) => void;
}) {
  const [editName, setEditName] = useState(group.name);
  const [editDesc, setEditDesc] = useState(group.description ?? "");
  const [editColor, setEditColor] = useState(group.color ?? PRESET_COLORS[0]);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaMsg, setMetaMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [permissions, setPermissions] = useState<GroupPermissions>(DEFAULT_PERMISSIONS);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [loadingPerms, setLoadingPerms] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [tabMsg, setTabMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPerms, setSavingPerms] = useState(false);

  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiMessages, setAiMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [aiHistory, setAiHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const flashTab = useCallback((ok: boolean, text: string) => {
    setTabMsg({ ok, text });
    setTimeout(() => setTabMsg(null), 3500);
  }, []);

  useEffect(() => {
    const fetchPerms = async () => {
      try {
        const res = await fetch(apiUrl(`/api/groups/${group.id}/permissions`));
        const data = await res.json();
        if (data.permissions) setPermissions(data.permissions);
      } finally {
        setLoadingPerms(false);
      }
    };
    const fetchMembers = async () => {
      try {
        const res = await fetch(apiUrl(`/api/groups/${group.id}/members`));
        const data = await res.json();
        if (data.members) setMembers(data.members);
      } finally {
        setLoadingMembers(false);
      }
    };
    fetchPerms();
    fetchMembers();
  }, [group.id]);

  const saveMeta = async () => {
    if (savingMeta) return;
    setSavingMeta(true);
    try {
      const res = await fetch(apiUrl(`/api/groups/${group.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim(), color: editColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onGroupUpdate({ ...group, name: editName, description: editDesc, color: editColor });
      setMetaMsg({ ok: true, text: "Saved" });
      setTimeout(() => setMetaMsg(null), 2500);
    } catch (e: unknown) {
      setMetaMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
      setTimeout(() => setMetaMsg(null), 3500);
    } finally {
      setSavingMeta(false);
    }
  };

  const savePermSection = async (section: keyof GroupPermissions) => {
    if (savingPerms) return;
    setSavingPerms(true);
    try {
      const res = await fetch(apiUrl(`/api/groups/${group.id}/permissions`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [section]: permissions[section] }),
      });
      if (!res.ok) throw new Error("Save failed");
      flashTab(true, "Permissions saved");
    } catch {
      flashTab(false, "Save failed");
    } finally {
      setSavingPerms(false);
    }
  };

  const removeMember = async (email: string) => {
    try {
      const res = await fetch(apiUrl(`/api/groups/${group.id}/members`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Remove failed");
      setMembers((prev) => prev.filter((m) => m.email !== email));
      flashTab(true, `${email} removed`);
    } catch {
      flashTab(false, "Remove failed");
    }
  };

  const sendAiMessage = async () => {
    const text = aiInput.trim();
    if (!text || aiLoading) return;
    setAiMessages((prev) => [...prev, { role: "user", text }]);
    setAiInput("");
    setAiLoading(true);
    try {
      const res = await fetch(apiUrl("/api/groups/ai-assist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: group.id,
          message: text,
          conversationHistory: aiHistory,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI request failed");
      const reply = data.response as string;
      setAiMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      setAiHistory((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: reply },
      ]);
    } catch (e: unknown) {
      setAiMessages((prev) => [...prev, { role: "assistant", text: e instanceof Error ? e.message : "AI request failed" }]);
    } finally {
      setAiLoading(false);
    }
  };

  const filteredMembers = members.filter(
    (m) =>
      memberSearch === "" ||
      m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const upd = <S extends keyof GroupPermissions>(section: S) =>
    (patch: Partial<GroupPermissions[S]>) =>
      setPermissions((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="mt-0.5 rounded p-1 text-bot-muted hover:bg-bot-surface hover:text-bot-text transition-colors"
          title="Back to groups"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="h-4 w-4 rounded-full border-2 border-white/20 shrink-0"
                style={{ backgroundColor: editColor }}
              />
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-transparent text-subtitle font-semibold text-bot-text outline-none border-b border-transparent focus:border-bot-accent"
              />
              {group.is_system === 1 && (
                <span className="rounded-full bg-bot-accent/15 px-2 py-0.5 text-[10px] font-medium text-bot-accent">
                  system
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 ml-6">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditColor(c)}
                  className={cn("h-5 w-5 rounded-full border-2 transition-all", editColor === c ? "border-white scale-110" : "border-transparent")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="Group description…"
              className="flex-1 rounded-md border border-bot-border bg-bot-bg px-3 py-1.5 text-body text-bot-text outline-none focus:border-bot-accent"
            />
            <button
              onClick={saveMeta}
              disabled={savingMeta}
              className="rounded-md bg-bot-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
            >
              {savingMeta ? "Saving…" : "Save"}
            </button>
            {metaMsg && (
              <span className={cn("text-caption", metaMsg.ok ? "text-bot-green" : "text-bot-red")}>
                {metaMsg.text}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-bot-border overflow-x-auto">
        {EDITOR_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-caption font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
              activeTab === tab.id
                ? "border-bot-accent text-bot-accent"
                : "border-transparent text-bot-muted hover:text-bot-text"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {tabMsg && (
        <p className={cn("text-caption", tabMsg.ok ? "text-bot-green" : "text-bot-red")}>{tabMsg.text}</p>
      )}

      {/* Tab Content */}
      <div className="min-h-[300px]">
        {activeTab === "members" && (
          <MembersTab
            members={filteredMembers}
            loading={loadingMembers}
            search={memberSearch}
            onSearchChange={setMemberSearch}
            onRemove={removeMember}
          />
        )}
        {activeTab === "platform" && (
          <PlatformTab
            perms={permissions.platform}
            onChange={(p) => upd("platform")(p)}
            onSave={() => savePermSection("platform")}
            saving={savingPerms}
            loading={loadingPerms}
          />
        )}
        {activeTab === "ai" && (
          <AITab
            perms={permissions.ai}
            onChange={(p) => upd("ai")(p)}
            onSave={() => savePermSection("ai")}
            saving={savingPerms}
            loading={loadingPerms}
          />
        )}
        {activeTab === "files" && (
          <FilesTab
            perms={permissions.ai}
            onChange={(p) => upd("ai")(p)}
            onSave={() => savePermSection("ai")}
            saving={savingPerms}
            loading={loadingPerms}
          />
        )}
        {activeTab === "sessions" && (
          <SessionsTab
            perms={permissions.session}
            onChange={(p) => upd("session")(p)}
            onSave={() => savePermSection("session")}
            saving={savingPerms}
            loading={loadingPerms}
          />
        )}
        {activeTab === "prompt" && (
          <PromptTab
            perms={permissions.prompt}
            onChange={(p) => upd("prompt")(p)}
            onSave={() => savePermSection("prompt")}
            saving={savingPerms}
            loading={loadingPerms}
          />
        )}
        {activeTab === "ui_access" && (
          <UIAccessTab
            perms={permissions.platform}
            onChange={(p) => upd("platform")(p)}
            onSave={() => savePermSection("platform")}
            saving={savingPerms}
            loading={loadingPerms}
          />
        )}
      </div>

      {/* AI Assistant Panel */}
      <div className="rounded-lg border border-bot-border bg-bot-elevated overflow-hidden">
        <button
          onClick={() => setAiPanelOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-body font-medium text-bot-text hover:bg-bot-surface/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-bot-accent" />
            Ask AI to help configure
          </div>
          {aiPanelOpen ? <ChevronUp className="h-4 w-4 text-bot-muted" /> : <ChevronDown className="h-4 w-4 text-bot-muted" />}
        </button>
        {aiPanelOpen && (
          <div className="border-t border-bot-border p-4 space-y-3">
            {aiMessages.length === 0 && (
              <p className="text-caption text-bot-muted">Describe what this group should be able to do and get permission recommendations.</p>
            )}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {aiMessages.map((m, i) => (
                <div key={i} className={cn("rounded-md px-3 py-2 text-body", m.role === "user" ? "bg-bot-accent/10 text-bot-text ml-8" : "bg-bot-surface text-bot-text mr-8")}>
                  <p className="text-[10px] font-medium text-bot-muted mb-1">{m.role === "user" ? "You" : "AI"}</p>
                  {m.text}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiMessage(); } }}
                placeholder="e.g. This group should only be able to read files and create sessions…"
                rows={2}
                className="flex-1 rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent resize-none"
              />
              <button
                onClick={sendAiMessage}
                disabled={!aiInput.trim() || aiLoading}
                className="self-end rounded-md bg-bot-accent px-3 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
              >
                {aiLoading ? "…" : "Send"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Members Tab ──────────────────────────────────────────────────────────────

function MembersTab({
  members,
  loading,
  search,
  onSearchChange,
  onRemove,
}: {
  members: GroupMember[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onRemove: (email: string) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (loading) return <p className="text-body text-bot-muted py-4">Loading members…</p>;

  return (
    <div className="space-y-3">
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search members…"
        className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
      />
      {members.length === 0 ? (
        <p className="text-body text-bot-muted py-4">No members{search ? " matching search" : ""}.</p>
      ) : (
        <div className="space-y-1">
          {members.map((m) => (
            <div key={m.email} className="flex items-center gap-3 rounded-lg border border-bot-border bg-bot-elevated px-4 py-2.5 group">
              <div className="h-8 w-8 rounded-full bg-bot-accent/20 flex items-center justify-center text-caption font-medium text-bot-accent shrink-0">
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  `${m.first_name?.[0] ?? ""}${m.last_name?.[0] ?? ""}`.toUpperCase() || m.email[0].toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body text-bot-text">{m.first_name} {m.last_name}</p>
                <p className="text-caption text-bot-muted truncate">{m.email}</p>
              </div>
              {m.is_admin === 1 && (
                <span className="rounded-full bg-bot-amber/15 px-1.5 py-0.5 text-[10px] font-medium text-bot-amber">admin</span>
              )}
              {confirmRemove === m.email ? (
                <button
                  onClick={() => { onRemove(m.email); setConfirmRemove(null); }}
                  className="rounded px-2 py-1 text-caption text-bot-red bg-bot-red/10 hover:bg-bot-red/20 transition-colors"
                >
                  Confirm
                </button>
              ) : (
                <button
                  onClick={() => setConfirmRemove(m.email)}
                  className="opacity-0 group-hover:opacity-100 rounded p-1 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-all"
                  title="Remove from group"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Platform Tab ─────────────────────────────────────────────────────────────

function PlatformTab({
  perms,
  onChange,
  onSave,
  saving,
  loading,
}: {
  perms: GroupPermissions["platform"];
  onChange: (p: Partial<GroupPermissions["platform"]>) => void;
  onSave: () => void;
  saving: boolean;
  loading: boolean;
}) {
  if (loading) return <p className="text-body text-bot-muted py-4">Loading…</p>;

  const rows: { key: keyof GroupPermissions["platform"]; label: string; desc?: string }[] = [
    { key: "sessions_create", label: "Create Sessions", desc: "Allow creating new AI sessions" },
    { key: "sessions_view_others", label: "View Others' Sessions", desc: "See sessions created by other users" },
    { key: "sessions_collaborate", label: "Collaborate on Sessions", desc: "Join and interact in others' sessions" },
    { key: "templates_view", label: "View Templates", desc: "Access session templates" },
    { key: "templates_manage", label: "Manage Templates", desc: "Create, edit, and delete templates" },
    { key: "memories_view", label: "View Memories", desc: "Access saved memories" },
    { key: "memories_manage", label: "Manage Memories", desc: "Create and delete memories" },
    { key: "files_browse", label: "Browse Files", desc: "Navigate the file system" },
    { key: "files_upload", label: "Upload Files", desc: "Upload files to the server" },
    { key: "terminal_access", label: "Terminal Access", desc: "Access the built-in terminal" },
    { key: "observe_only", label: "Observe Only", desc: "User can only view sessions — cannot create sessions or interact with AI" },
  ];

  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <ToggleRow
          key={row.key}
          label={row.label}
          description={row.desc}
          checked={perms[row.key]}
          onChange={(v) => onChange({ [row.key]: v })}
        />
      ))}
      <div className="flex justify-end pt-3">
        <SaveButton onClick={onSave} saving={saving} label="Save Platform" />
      </div>
    </div>
  );
}

// ── AI Tab ───────────────────────────────────────────────────────────────────

function AITab({
  perms,
  onChange,
  onSave,
  saving,
  loading,
}: {
  perms: GroupPermissions["ai"];
  onChange: (p: Partial<GroupPermissions["ai"]>) => void;
  onSave: () => void;
  saving: boolean;
  loading: boolean;
}) {
  if (loading) return <p className="text-body text-bot-muted py-4">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <ToggleRow label="Shell Access" description="Allow running shell commands" checked={perms.shell_access} onChange={(v) => onChange({ shell_access: v })} />
        <ToggleRow label="Full Trust Allowed" description="Skip AI safety guardrails" checked={perms.full_trust_allowed} onChange={(v) => onChange({ full_trust_allowed: v })} />
        <ToggleRow label="Read Only" description="Prevent any file writes or modifications" checked={perms.read_only} onChange={(v) => onChange({ read_only: v })} />
      </div>
      <div className="space-y-3 pt-2">
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Commands Allowed</label>
          <p className="mb-1.5 text-[11px] text-bot-muted">Commands explicitly permitted. Leave empty to allow all (unless blocked).</p>
          <TagInput value={perms.commands_allowed} onChange={(v) => onChange({ commands_allowed: v })} placeholder="e.g. git, npm, ls (Enter to add)" />
        </div>
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Commands Blocked</label>
          <p className="mb-1.5 text-[11px] text-bot-muted">Commands always denied.</p>
          <TagInput value={perms.commands_blocked} onChange={(v) => onChange({ commands_blocked: v })} placeholder="e.g. rm, sudo (Enter to add)" />
        </div>
      </div>
      <div className="flex justify-end pt-1">
        <SaveButton onClick={onSave} saving={saving} label="Save AI & Commands" />
      </div>
    </div>
  );
}

// ── Files Tab ────────────────────────────────────────────────────────────────

function FilesTab({
  perms,
  onChange,
  onSave,
  saving,
  loading,
}: {
  perms: GroupPermissions["ai"];
  onChange: (p: Partial<GroupPermissions["ai"]>) => void;
  onSave: () => void;
  saving: boolean;
  loading: boolean;
}) {
  if (loading) return <p className="text-body text-bot-muted py-4">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-caption font-medium text-bot-muted">Directories Allowed</label>
        <p className="mb-1.5 text-[11px] text-bot-muted">Restrict access to these paths. Empty = all directories.</p>
        <TagInput value={perms.directories_allowed} onChange={(v) => onChange({ directories_allowed: v })} placeholder="src/components/** (Enter to add)" />
      </div>
      <div>
        <label className="mb-1 block text-caption font-medium text-bot-muted">Directories Blocked</label>
        <TagInput value={perms.directories_blocked} onChange={(v) => onChange({ directories_blocked: v })} placeholder=".env, secrets/** (Enter to add)" />
      </div>
      <div>
        <label className="mb-1 block text-caption font-medium text-bot-muted">File Types Allowed</label>
        <p className="mb-1.5 text-[11px] text-bot-muted">Empty = all file types allowed.</p>
        <TagInput value={perms.filetypes_allowed} onChange={(v) => onChange({ filetypes_allowed: v })} placeholder=".ts, .tsx (Enter to add)" />
      </div>
      <div>
        <label className="mb-1 block text-caption font-medium text-bot-muted">File Types Blocked</label>
        <TagInput value={perms.filetypes_blocked} onChange={(v) => onChange({ filetypes_blocked: v })} placeholder=".env, .key (Enter to add)" />
      </div>
      <div className="flex justify-end pt-1">
        <SaveButton onClick={onSave} saving={saving} label="Save Files & Dirs" />
      </div>
    </div>
  );
}

// ── Sessions Tab ─────────────────────────────────────────────────────────────

function SessionsTab({
  perms,
  onChange,
  onSave,
  saving,
  loading,
}: {
  perms: GroupPermissions["session"];
  onChange: (p: Partial<GroupPermissions["session"]>) => void;
  onSave: () => void;
  saving: boolean;
  loading: boolean;
}) {
  if (loading) return <p className="text-body text-bot-muted py-4">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Max Active Sessions</label>
          <p className="mb-1.5 text-[11px] text-bot-muted">0 = unlimited</p>
          <input
            type="number"
            min={0}
            value={perms.max_active}
            onChange={(e) => onChange({ max_active: parseInt(e.target.value) || 0 })}
            className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Max Turns per Session</label>
          <p className="mb-1.5 text-[11px] text-bot-muted">0 = unlimited</p>
          <input
            type="number"
            min={0}
            value={perms.max_turns}
            onChange={(e) => onChange({ max_turns: parseInt(e.target.value) || 0 })}
            className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
          />
        </div>
      </div>

      <div className="space-y-1">
        <ToggleRow
          label="Enable Delegation"
          description="Allow sub-agent delegation in sessions"
          checked={perms.delegation_enabled}
          onChange={(v) => onChange({ delegation_enabled: v })}
        />
      </div>
      {perms.delegation_enabled && (
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Max Delegation Depth</label>
          <input
            type="number"
            min={1}
            max={10}
            value={perms.delegation_max_depth}
            onChange={(e) => onChange({ delegation_max_depth: parseInt(e.target.value) || 2 })}
            className="w-32 rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-caption font-medium text-bot-muted">Models Allowed</label>
        <p className="mb-1.5 text-[11px] text-bot-muted">Empty = all models allowed.</p>
        <TagInput value={perms.models_allowed} onChange={(v) => onChange({ models_allowed: v })} placeholder="claude-3-5-sonnet-20241022 (Enter to add)" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Default Model</label>
          <input
            value={perms.default_model}
            onChange={(e) => onChange({ default_model: e.target.value })}
            placeholder="claude-3-5-sonnet-20241022"
            className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-caption font-medium text-bot-muted">Default Template</label>
          <input
            value={perms.default_template}
            onChange={(e) => onChange({ default_template: e.target.value })}
            placeholder="Template ID or name"
            className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
          />
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <SaveButton onClick={onSave} saving={saving} label="Save Sessions" />
      </div>
    </div>
  );
}

// ── Prompt Tab ───────────────────────────────────────────────────────────────

function PromptTab({
  perms,
  onChange,
  onSave,
  saving,
  loading,
}: {
  perms: GroupPermissions["prompt"];
  onChange: (p: Partial<GroupPermissions["prompt"]>) => void;
  onSave: () => void;
  saving: boolean;
  loading: boolean;
}) {
  if (loading) return <p className="text-body text-bot-muted py-4">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-caption font-medium text-bot-muted">Communication Style</label>
        <p className="mb-1.5 text-[11px] text-bot-muted">Controls how Claude communicates with users in this group.</p>
        <select
          value={perms.communication_style}
          onChange={(e) => onChange({ communication_style: e.target.value })}
          className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
        >
          <option value="expert">Expert — terse, fully technical, no hand-holding</option>
          <option value="intermediate">Intermediate — technical but explains complex parts</option>
          <option value="beginner">Beginner — plain language, step-by-step, no jargon</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-caption font-medium text-bot-muted">System Prompt Append</label>
        <p className="mb-1.5 text-[11px] text-bot-muted">Appended to the system prompt for all sessions in this group.</p>
        <textarea
          value={perms.system_prompt_append}
          onChange={(e) => onChange({ system_prompt_append: e.target.value })}
          rows={5}
          placeholder="Additional instructions appended to the system prompt…"
          className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent resize-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-caption font-medium text-bot-muted">Default Context</label>
        <p className="mb-1.5 text-[11px] text-bot-muted">Pre-filled context injected at the start of each session.</p>
        <textarea
          value={perms.default_context}
          onChange={(e) => onChange({ default_context: e.target.value })}
          rows={5}
          placeholder="Default context for sessions in this group…"
          className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent resize-none"
        />
      </div>
      <div className="flex justify-end pt-1">
        <SaveButton onClick={onSave} saving={saving} label="Save Prompt" />
      </div>
    </div>
  );
}

// ── UI Access Tab ─────────────────────────────────────────────────────────────

const ALL_TABS: { id: string; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "agents", label: "Agents" },
  { id: "plan", label: "Plan" },
  { id: "jobs", label: "Jobs" },
  { id: "memory", label: "Memory" },
  { id: "files", label: "Files" },
  { id: "terminal", label: "Terminal" },
];

const ALL_SETTINGS_SECTIONS: { id: string; label: string; group: string }[] = [
  { id: "general", label: "General", group: "User" },
  { id: "notifications", label: "Notifications", group: "User" },
  { id: "bot_identity", label: "Bot Identity", group: "Bot" },
  { id: "customization", label: "Customization", group: "Bot" },
  { id: "templates", label: "Templates", group: "Bot" },
  { id: "user_management", label: "User Management", group: "Access & Security" },
  { id: "user_groups", label: "User Groups", group: "Access & Security" },
  { id: "security", label: "Security", group: "Access & Security" },
  { id: "rate_limits", label: "Rate Limits", group: "Access & Security" },
  { id: "budgets", label: "Budgets", group: "Access & Security" },
  { id: "api_key", label: "API Key (SDK)", group: "Access & Security" },
  { id: "secrets", label: "Secrets", group: "Access & Security" },
  { id: "system", label: "System", group: "Server" },
  { id: "services", label: "Services", group: "Server" },
  { id: "service_manager", label: "Service Manager", group: "Server" },
  { id: "packages", label: "Packages", group: "Server" },
  { id: "updates", label: "Updates", group: "Server" },
  { id: "project", label: "Project", group: "Server" },
  { id: "domains", label: "Domains", group: "Networking & Data" },
  { id: "smtp", label: "Email / SMTP", group: "Networking & Data" },
  { id: "backup", label: "Backup & Restore", group: "Networking & Data" },
  { id: "database", label: "Database", group: "Networking & Data" },
  { id: "activity_log", label: "Activity Log", group: "Networking & Data" },
];

function UIAccessTab({
  perms,
  onChange,
  onSave,
  saving,
  loading,
}: {
  perms: GroupPermissions["platform"];
  onChange: (p: Partial<GroupPermissions["platform"]>) => void;
  onSave: () => void;
  saving: boolean;
  loading: boolean;
}) {
  if (loading) return <p className="text-body text-bot-muted py-4">Loading…</p>;

  const toggleTab = (tabId: string) => {
    const current = perms.visible_tabs ?? [];
    const next = current.includes(tabId) ? current.filter((t) => t !== tabId) : [...current, tabId];
    onChange({ visible_tabs: next });
  };

  const toggleSetting = (sectionId: string) => {
    const current = perms.visible_settings ?? [];
    const next = current.includes(sectionId) ? current.filter((s) => s !== sectionId) : [...current, sectionId];
    onChange({ visible_settings: next });
  };

  const settingGroups = ALL_SETTINGS_SECTIONS.reduce<Record<string, typeof ALL_SETTINGS_SECTIONS>>((acc, s) => {
    if (!acc[s.group]) acc[s.group] = [];
    acc[s.group].push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <p className="text-caption text-bot-muted">
        Controls which tabs and settings sections are visible to users in this group.
        Admins always bypass these restrictions.
      </p>

      {/* Sidebar Tabs */}
      <div>
        <h3 className="mb-2 text-body font-medium text-bot-text">Visible Tabs</h3>
        <div className="flex flex-wrap gap-2">
          {ALL_TABS.map((tab) => {
            const active = (perms.visible_tabs ?? []).includes(tab.id);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => toggleTab(tab.id)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-caption font-medium transition-colors",
                  active
                    ? "border-bot-accent bg-bot-accent/15 text-bot-accent"
                    : "border-bot-border bg-bot-bg text-bot-muted hover:border-bot-accent/50 hover:text-bot-text"
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Settings Sections */}
      <div>
        <h3 className="mb-3 text-body font-medium text-bot-text">Visible Settings Sections</h3>
        <div className="space-y-4">
          {Object.entries(settingGroups).map(([groupName, sections]) => (
            <div key={groupName}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-bot-muted">{groupName}</p>
              <div className="flex flex-wrap gap-2">
                {sections.map((section) => {
                  const active = (perms.visible_settings ?? []).includes(section.id);
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => toggleSetting(section.id)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-caption font-medium transition-colors",
                        active
                          ? "border-bot-accent bg-bot-accent/15 text-bot-accent"
                          : "border-bot-border bg-bot-bg text-bot-muted hover:border-bot-accent/50 hover:text-bot-text"
                      )}
                    >
                      {section.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <SaveButton onClick={onSave} saving={saving} label="Save UI Access" />
      </div>
    </div>
  );
}

// ── Save Button ──────────────────────────────────────────────────────────────

function SaveButton({ onClick, saving, label }: { onClick: () => void; saving: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
    >
      {saving ? "Saving…" : label}
    </button>
  );
}

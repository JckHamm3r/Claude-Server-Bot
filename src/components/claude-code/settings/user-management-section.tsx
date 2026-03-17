"use client";

import { useEffect, useState, useMemo } from "react";
import { cn, apiUrl } from "@/lib/utils";
import {
  UserPlus, Search, Edit2, Trash2, ChevronDown,
  Shield, User, Check, X, Copy, RefreshCw, Users2,
  CheckSquare, Square, AlertTriangle, Network, Plus,
} from "lucide-react";

interface UserGroupBadge {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface AdminUser {
  email: string;
  is_admin: number;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  created_at: string;
  group_id: string | null;
  group_name: string | null;
  group_color: string | null;
  allowed_ips: string | null;
  security_groups: Array<{ id: string; name: string }>;
}

interface SecurityGroupOption {
  id: string;
  name: string;
  description: string;
  allowed_ips: string;
}

const AVATAR_PALETTE = [
  "bg-violet-600", "bg-blue-600", "bg-cyan-600", "bg-teal-600",
  "bg-emerald-600", "bg-amber-600", "bg-orange-600", "bg-rose-600",
  "bg-pink-600", "bg-indigo-600",
];

function avatarColor(email: string): string {
  const sum = email.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

function avatarInitial(user: AdminUser): string {
  if (user.first_name) return user.first_name[0].toUpperCase();
  return user.email[0].toUpperCase();
}

function displayName(user: AdminUser): string {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : user.email;
}

function GroupBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-bot-surface text-bot-muted border border-bot-border">
        No Group
      </span>
    );
  }
  const hex = color ?? "#6366f1";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: hex + "22", color: hex, border: `1px solid ${hex}44` }}
    >
      {name}
    </span>
  );
}

function RoleBadge({ isAdmin }: { isAdmin: number }) {
  if (isAdmin) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-bot-red/15 text-bot-red">
        <Shield className="w-2.5 h-2.5" />
        Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-bot-surface text-bot-muted border border-bot-border">
      <User className="w-2.5 h-2.5" />
      User
    </span>
  );
}

function IPRestrictedBadge({ securityGroups, directIPs }: { securityGroups: Array<{ id: string; name: string }>; directIPs: string[] }) {
  const total = securityGroups.length + (directIPs.length > 0 ? 1 : 0);
  if (total === 0) return null;
  const title = [
    directIPs.length > 0 ? `${directIPs.length} direct IP${directIPs.length !== 1 ? "s" : ""}` : "",
    securityGroups.length > 0 ? `Groups: ${securityGroups.map((g) => g.name).join(", ")}` : "",
  ].filter(Boolean).join(" | ");
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30"
    >
      <Network className="w-2.5 h-2.5" />
      IP Restricted
    </span>
  );
}

function PasswordBanner({
  password,
  label,
  onDismiss,
}: {
  password: string;
  label: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-bot-green/40 bg-bot-green/10 p-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-caption font-medium text-bot-green mb-1">{label} — shown once only</p>
        <code className="text-[11px] font-mono text-bot-text break-all">{password}</code>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={copy}
          className="rounded p-1 text-bot-muted hover:text-bot-green hover:bg-bot-green/10 transition-colors"
          title="Copy password"
        >
          {copied ? <Check className="h-4 w-4 text-bot-green" /> : <Copy className="h-4 w-4" />}
        </button>
        <button
          onClick={onDismiss}
          className="rounded p-1 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-colors"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function UserManagementSection() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<UserGroupBadge[]>([]);
  const [securityGroups, setSecurityGroups] = useState<SecurityGroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // New user form
  const [addEmail, setAddEmail] = useState("");
  const [addFirst, setAddFirst] = useState("");
  const [addLast, setAddLast] = useState("");
  const [addGroupId, setAddGroupId] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  // Search / filter
  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | "admin" | "user">("all");

  // Edit state
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editPassword, setEditPassword] = useState<string | null>(null);
  const [editAllowedIPs, setEditAllowedIPs] = useState<string[]>([]);
  const [editSecurityGroupIds, setEditSecurityGroupIds] = useState<string[]>([]);
  const [editIPInput, setEditIPInput] = useState("");
  const [editIPError, setEditIPError] = useState("");

  // Bulk
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(null);

  // Current session email (for disabling self-admin toggle)
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/auth/session"))
      .then((r) => r.json())
      .then((d) => setSessionEmail(d?.user?.email ?? null))
      .catch(() => {});
  }, []);

  const showMsg = (ok: boolean, text: string, ttl = 3500) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), ttl);
  };

  useEffect(() => {
    Promise.all([
      fetch(apiUrl("/api/users")).then((r) => r.json()),
      fetch(apiUrl("/api/groups")).then((r) => r.json()),
      fetch(apiUrl("/api/security-groups")).then((r) => r.json()),
    ])
      .then(([ud, gd, sgd]) => {
        setUsers(ud.users ?? []);
        setGroups(gd.groups ?? []);
        setSecurityGroups(sgd.groups ?? []);
      })
      .catch(() => showMsg(false, "Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      if (q) {
        const name = displayName(u).toLowerCase();
        if (!name.includes(q) && !u.email.toLowerCase().includes(q)) return false;
      }
      if (filterGroup === "__none__") {
        if (u.group_id !== null) return false;
      } else if (filterGroup) {
        if (u.group_id !== filterGroup) return false;
      }
      if (filterRole === "admin" && !u.is_admin) return false;
      if (filterRole === "user" && u.is_admin) return false;
      return true;
    });
  }, [users, search, filterGroup, filterRole]);

  const allChecked =
    filteredUsers.length > 0 && filteredUsers.every((u) => selected.has(u.email));
  const someChecked = filteredUsers.some((u) => selected.has(u.email));

  const toggleAll = () => {
    if (allChecked) {
      const next = new Set(selected);
      filteredUsers.forEach((u) => next.delete(u.email));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filteredUsers.forEach((u) => next.add(u.email));
      setSelected(next);
    }
  };

  const toggleOne = (email: string) => {
    const next = new Set(selected);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    setSelected(next);
  };

  const handleAdd = async () => {
    if (!addEmail.trim() || addSaving) return;
    setAddSaving(true);
    try {
      const res = await fetch(apiUrl("/api/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: addEmail.trim(),
          firstName: addFirst.trim(),
          lastName: addLast.trim(),
          groupId: addGroupId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(false, data.error ?? "Failed to add user");
      } else {
        const grp = groups.find((g) => g.id === addGroupId);
        const newUser: AdminUser = {
          email: data.email,
          is_admin: 0,
          first_name: addFirst.trim(),
          last_name: addLast.trim(),
          avatar_url: null,
          created_at: new Date().toISOString(),
          group_id: addGroupId || null,
          group_name: grp?.name ?? null,
          group_color: grp?.color ?? null,
          allowed_ips: null,
          security_groups: [],
        };
        setUsers((prev) => [...prev, newUser]);
        setNewPassword(data.password);
        setAddEmail("");
        setAddFirst("");
        setAddLast("");
        setAddGroupId("");
      }
    } catch {
      showMsg(false, "Network error");
    } finally {
      setAddSaving(false);
    }
  };

  const startEdit = (u: AdminUser) => {
    setEditingEmail(u.email);
    setEditEmail(u.email);
    setEditFirst(u.first_name ?? "");
    setEditLast(u.last_name ?? "");
    setEditGroupId(u.group_id ?? "");
    setEditIsAdmin(!!u.is_admin);
    setEditPassword(null);
    setConfirmDeleteEmail(null);
    // IP allowlist
    try { setEditAllowedIPs(JSON.parse(u.allowed_ips ?? "[]") ?? []); } catch { setEditAllowedIPs([]); }
    setEditSecurityGroupIds((u.security_groups ?? []).map((sg) => sg.id));
    setEditIPInput("");
    setEditIPError("");
  };

  const cancelEdit = () => {
    setEditingEmail(null);
    setEditPassword(null);
    setEditIPInput("");
    setEditIPError("");
  };

  const handleSave = async () => {
    if (!editingEmail || editSaving) return;
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = { email: editingEmail };
      if (editEmail !== editingEmail) body.newEmail = editEmail;
      body.first_name = editFirst;
      body.last_name = editLast;
      body.is_admin = editIsAdmin;
      body.group_id = editGroupId || null;
      body.allowed_ips = editAllowedIPs;

      const res = await fetch(apiUrl("/api/users"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(false, data.error ?? "Save failed");
        return;
      }

      const effectiveEmail = data.email ?? editingEmail;
      const grp = groups.find((g) => g.id === editGroupId);

      // Reconcile security group assignments
      const currentUser = users.find((u) => u.email === editingEmail);
      const previousSecGroupIds = (currentUser?.security_groups ?? []).map((sg) => sg.id);
      const toAdd = editSecurityGroupIds.filter((id) => !previousSecGroupIds.includes(id));
      const toRemove = previousSecGroupIds.filter((id) => !editSecurityGroupIds.includes(id));

      await Promise.all([
        ...toAdd.map((id) => fetch(apiUrl(`/api/security-groups/${id}/members`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: effectiveEmail }),
        })),
        ...toRemove.map((id) => fetch(apiUrl(`/api/security-groups/${id}/members`), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: effectiveEmail }),
        })),
      ]);

      setUsers((prev) =>
        prev.map((u) =>
          u.email === editingEmail
            ? {
                ...u,
                email: effectiveEmail,
                first_name: editFirst,
                last_name: editLast,
                is_admin: editIsAdmin ? 1 : 0,
                group_id: editGroupId || null,
                group_name: grp?.name ?? null,
                group_color: grp?.color ?? null,
                allowed_ips: JSON.stringify(editAllowedIPs),
                security_groups: editSecurityGroupIds.map((id) => {
                  const sg = securityGroups.find((s) => s.id === id);
                  return { id, name: sg?.name ?? id };
                }),
              }
            : u
        )
      );
      setEditingEmail(null);
      showMsg(true, "User updated");
    } catch {
      showMsg(false, "Network error");
    } finally {
      setEditSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!editingEmail) return;
    try {
      const res = await fetch(apiUrl("/api/users"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: editingEmail, resetPassword: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(false, data.error ?? "Reset failed");
      } else {
        setEditPassword(data.password);
      }
    } catch {
      showMsg(false, "Network error");
    }
  };

  const handleDelete = async (email: string) => {
    if (confirmDeleteEmail !== email) {
      setConfirmDeleteEmail(email);
      return;
    }
    setConfirmDeleteEmail(null);
    try {
      const res = await fetch(apiUrl("/api/users"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(false, data.error ?? "Delete failed");
      } else {
        setUsers((prev) => prev.filter((u) => u.email !== email));
        setSelected((prev) => { const n = new Set(prev); n.delete(email); return n; });
        if (editingEmail === email) cancelEdit();
        showMsg(true, "User deleted");
      }
    } catch {
      showMsg(false, "Network error");
    }
  };

  const handleBulkAssignGroup = async () => {
    if (!bulkGroupId) return;
    const emails = Array.from(selected);
    const grp = groups.find((g) => g.id === bulkGroupId);
    try {
      await Promise.all(
        emails.map((email) =>
          fetch(apiUrl("/api/users"), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, group_id: bulkGroupId }),
          })
        )
      );
      setUsers((prev) =>
        prev.map((u) =>
          selected.has(u.email)
            ? { ...u, group_id: bulkGroupId, group_name: grp?.name ?? null, group_color: grp?.color ?? null }
            : u
        )
      );
      setSelected(new Set());
      setBulkGroupId("");
      showMsg(true, `Assigned ${emails.length} user(s) to ${grp?.name ?? "group"}`);
    } catch {
      showMsg(false, "Bulk assign failed");
    }
  };

  const handleBulkDelete = async () => {
    if (!bulkConfirmDelete) {
      setBulkConfirmDelete(true);
      return;
    }
    setBulkConfirmDelete(false);
    const emails = Array.from(selected).filter((e) => e !== sessionEmail);
    try {
      await Promise.all(
        emails.map((email) =>
          fetch(apiUrl("/api/users"), {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          })
        )
      );
      setUsers((prev) => prev.filter((u) => !emails.includes(u.email)));
      setSelected(new Set());
      showMsg(true, `Deleted ${emails.length} user(s)`);
    } catch {
      showMsg(false, "Bulk delete failed");
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-bot-muted">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        Loading users…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-subtitle font-semibold text-bot-text">User Management</h2>
        <span className="text-caption text-bot-muted">{users.length} user{users.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Global message */}
      {msg && (
        <p className={cn("text-caption", msg.ok ? "text-bot-green" : "text-bot-red")}>{msg.text}</p>
      )}

      {/* New password banner (from add user) */}
      {newPassword && (
        <PasswordBanner
          password={newPassword}
          label="New user password"
          onDismiss={() => setNewPassword(null)}
        />
      )}

      {/* Add User Form */}
      <div className="rounded-lg border border-bot-border bg-bot-elevated p-4">
        <div className="flex items-center gap-2 mb-3">
          <UserPlus className="h-4 w-4 text-bot-accent" />
          <span className="text-body font-medium text-bot-text">Add User</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input
            type="email"
            placeholder="Email *"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="col-span-2 sm:col-span-1 rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent placeholder:text-bot-muted"
          />
          <input
            type="text"
            placeholder="First name"
            value={addFirst}
            onChange={(e) => setAddFirst(e.target.value)}
            className="rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent placeholder:text-bot-muted"
          />
          <input
            type="text"
            placeholder="Last name"
            value={addLast}
            onChange={(e) => setAddLast(e.target.value)}
            className="rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent placeholder:text-bot-muted"
          />
          <div className="relative">
            <select
              value={addGroupId}
              onChange={(e) => setAddGroupId(e.target.value)}
              className="w-full appearance-none rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent pr-7"
            >
              <option value="">No Group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.icon} {g.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-bot-muted" />
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <button
            onClick={handleAdd}
            disabled={!addEmail.trim() || addSaving}
            className="flex items-center gap-1.5 rounded-md bg-bot-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {addSaving ? "Adding…" : "Add User"}
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-40">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-bot-muted" />
          <input
            type="text"
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-bot-border bg-bot-elevated pl-8 pr-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent placeholder:text-bot-muted"
          />
        </div>
        <div className="relative">
          <select
            value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value)}
            className="appearance-none rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent pr-7"
          >
            <option value="">All Groups</option>
            <option value="__none__">No Group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-bot-muted" />
        </div>
        <div className="relative">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as "all" | "admin" | "user")}
            className="appearance-none rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent pr-7"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-bot-muted" />
        </div>
      </div>

      {/* Bulk action toolbar */}
      {someChecked && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-bot-accent/30 bg-bot-accent/10 px-3 py-2">
          <span className="text-caption font-medium text-bot-accent">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="relative flex items-center gap-1">
              <select
                value={bulkGroupId}
                onChange={(e) => setBulkGroupId(e.target.value)}
                className="appearance-none rounded-md border border-bot-border bg-bot-elevated px-3 py-1.5 text-caption text-bot-text outline-none focus:border-bot-accent pr-7"
              >
                <option value="">Assign to group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-bot-muted" />
            </div>
            <button
              onClick={handleBulkAssignGroup}
              disabled={!bulkGroupId}
              className="flex items-center gap-1 rounded-md border border-bot-border px-2.5 py-1.5 text-caption text-bot-text hover:bg-bot-surface disabled:opacity-40 transition-colors"
            >
              <Users2 className="h-3.5 w-3.5" />
              Assign
            </button>
            {bulkConfirmDelete ? (
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1 rounded-md bg-bot-red/20 border border-bot-red/40 px-2.5 py-1.5 text-caption text-bot-red hover:bg-bot-red/30 transition-colors"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Confirm Delete
              </button>
            ) : (
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1 rounded-md border border-bot-border px-2.5 py-1.5 text-caption text-bot-muted hover:text-bot-red hover:border-bot-red/40 hover:bg-bot-red/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected
              </button>
            )}
            <button
              onClick={() => { setSelected(new Set()); setBulkConfirmDelete(false); }}
              className="rounded p-1 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* User list */}
      {filteredUsers.length === 0 ? (
        <p className="py-8 text-center text-body text-bot-muted">No users match the current filters.</p>
      ) : (
        <div className="rounded-lg border border-bot-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-3 px-4 py-2 border-b border-bot-border bg-bot-elevated text-[10px] font-medium uppercase tracking-wide text-bot-muted">
            <button onClick={toggleAll} className="flex items-center text-bot-muted hover:text-bot-accent transition-colors">
              {allChecked ? <CheckSquare className="h-4 w-4 text-bot-accent" /> : <Square className="h-4 w-4" />}
            </button>
            <span>User</span>
            <span>Group</span>
            <span>Role</span>
            <span>IP</span>
            <span>Joined</span>
            <span>Actions</span>
          </div>

          <div className="divide-y divide-bot-border">
            {filteredUsers.map((u) => {
              const isEditing = editingEmail === u.email;
              return (
                <div key={u.email}>
                  {/* User row */}
                  <div
                    className={cn(
                      "grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-3 px-4 py-3 group transition-colors",
                      isEditing ? "bg-bot-elevated" : "hover:bg-bot-elevated/60"
                    )}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleOne(u.email)}
                      className="flex items-center text-bot-muted hover:text-bot-accent transition-colors"
                    >
                      {selected.has(u.email)
                        ? <CheckSquare className="h-4 w-4 text-bot-accent" />
                        : <Square className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      }
                    </button>

                    {/* Avatar + name */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-body font-semibold text-white", avatarColor(u.email))}>
                        {avatarInitial(u)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-body font-medium text-bot-text truncate">{displayName(u)}</p>
                        <p className="text-caption text-bot-muted truncate">{u.email}</p>
                      </div>
                    </div>

                    {/* Group */}
                    <GroupBadge name={u.group_name} color={u.group_color} />

                    {/* Role */}
                    <RoleBadge isAdmin={u.is_admin} />

                    {/* IP Restricted badge */}
                    <div>
                      {(() => {
                        let directIPs: string[] = [];
                        try { directIPs = JSON.parse(u.allowed_ips ?? "[]") ?? []; } catch { directIPs = []; }
                        return <IPRestrictedBadge securityGroups={u.security_groups ?? []} directIPs={directIPs} />;
                      })()}
                    </div>

                    {/* Date */}
                    <span className="text-caption text-bot-muted whitespace-nowrap">{formatDate(u.created_at)}</span>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => isEditing ? cancelEdit() : startEdit(u)}
                        className={cn(
                          "rounded p-1 transition-colors",
                          isEditing
                            ? "text-bot-accent bg-bot-accent/10"
                            : "text-bot-muted hover:text-bot-accent hover:bg-bot-surface opacity-0 group-hover:opacity-100"
                        )}
                        title={isEditing ? "Close" : "Edit user"}
                      >
                        {isEditing ? <X className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
                      </button>
                      {confirmDeleteEmail === u.email ? (
                        <button
                          onClick={() => handleDelete(u.email)}
                          className="rounded px-2 py-0.5 text-caption text-bot-red bg-bot-red/10 hover:bg-bot-red/20 transition-colors whitespace-nowrap"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setConfirmDeleteEmail(u.email);
                          }}
                          disabled={u.email === sessionEmail}
                          className="rounded p-1 text-bot-muted hover:text-bot-red hover:bg-bot-red/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors opacity-0 group-hover:opacity-100"
                          title={u.email === sessionEmail ? "Cannot delete yourself" : "Delete user"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline edit panel */}
                  {isEditing && (
                    <div className="border-t border-bot-border bg-bot-elevated/80 px-4 py-4 space-y-4">
                      {/* Reset password banner */}
                      {editPassword && (
                        <PasswordBanner
                          password={editPassword}
                          label="New password for this user"
                          onDismiss={() => setEditPassword(null)}
                        />
                      )}

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-caption font-medium text-bot-muted">Email</label>
                          <input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-caption font-medium text-bot-muted">First Name</label>
                          <input
                            type="text"
                            value={editFirst}
                            onChange={(e) => setEditFirst(e.target.value)}
                            className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-caption font-medium text-bot-muted">Last Name</label>
                          <input
                            type="text"
                            value={editLast}
                            onChange={(e) => setEditLast(e.target.value)}
                            className="w-full rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent"
                          />
                        </div>
                        <div className="relative">
                          <label className="mb-1 block text-caption font-medium text-bot-muted">Group</label>
                          <select
                            value={editGroupId}
                            onChange={(e) => setEditGroupId(e.target.value)}
                            className="w-full appearance-none rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent pr-7"
                          >
                            <option value="">No Group</option>
                            {groups.map((g) => (
                              <option key={g.id} value={g.id}>{g.icon} {g.name}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 bottom-2.5 h-3.5 w-3.5 text-bot-muted" />
                        </div>
                        <div>
                          <label className="mb-1 block text-caption font-medium text-bot-muted">Admin</label>
                          <label className={cn(
                            "flex items-center gap-2 cursor-pointer h-[38px]",
                            u.email === sessionEmail && "opacity-50 cursor-not-allowed"
                          )}>
                            <div
                              onClick={() => {
                                if (u.email !== sessionEmail) setEditIsAdmin(!editIsAdmin);
                              }}
                              className={cn(
                                "relative h-5 w-9 rounded-full transition-colors",
                                editIsAdmin ? "bg-bot-accent" : "bg-bot-border"
                              )}
                            >
                              <div className={cn(
                                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                                editIsAdmin ? "translate-x-4" : "translate-x-0.5"
                              )} />
                            </div>
                            <span className="text-body text-bot-text">
                              {editIsAdmin ? "Admin" : "Regular user"}
                            </span>
                            {u.email === sessionEmail && (
                              <span className="text-caption text-bot-muted">(cannot demote self)</span>
                            )}
                          </label>
                        </div>
                      </div>

                      {/* IP Allowlist */}
                      <div className="space-y-2">
                        <label className="block text-caption font-medium text-bot-muted">
                          Direct IP Allowlist
                          <span className="ml-1 font-normal text-bot-muted">(leave empty for unrestricted)</span>
                        </label>
                        <div className="flex gap-2">
                          <input
                            value={editIPInput}
                            onChange={(e) => { setEditIPInput(e.target.value); setEditIPError(""); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const trimmed = editIPInput.trim();
                                if (!trimmed) return;
                                if (editAllowedIPs.includes(trimmed)) { setEditIPInput(""); return; }
                                setEditAllowedIPs((prev) => [...prev, trimmed]);
                                setEditIPInput("");
                              }
                            }}
                            placeholder="e.g. 192.168.1.0/24 or 10.0.0.5"
                            className="flex-1 rounded-md border border-bot-border bg-bot-bg px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent placeholder:text-bot-muted font-mono text-sm"
                          />
                          <button
                            onClick={() => {
                              const trimmed = editIPInput.trim();
                              if (!trimmed) return;
                              if (editAllowedIPs.includes(trimmed)) { setEditIPInput(""); return; }
                              setEditAllowedIPs((prev) => [...prev, trimmed]);
                              setEditIPInput("");
                            }}
                            className="px-3 py-2 rounded-md bg-bot-accent text-white text-sm hover:bg-bot-accent/90 flex items-center gap-1"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {editIPError && <p className="text-[11px] text-red-400">{editIPError}</p>}
                        {editAllowedIPs.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {editAllowedIPs.map((ip) => (
                              <span key={ip} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-bot-elevated border border-bot-border text-bot-text font-mono">
                                {ip}
                                <button onClick={() => setEditAllowedIPs((prev) => prev.filter((v) => v !== ip))} className="text-bot-muted hover:text-red-400 ml-0.5">
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Security Groups assignment */}
                      {securityGroups.length > 0 && (
                        <div className="space-y-2">
                          <label className="block text-caption font-medium text-bot-muted">
                            Security Groups
                            <span className="ml-1 font-normal text-bot-muted">(IP allowlists from groups are merged)</span>
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {securityGroups.map((sg) => {
                              const assigned = editSecurityGroupIds.includes(sg.id);
                              return (
                                <button
                                  key={sg.id}
                                  onClick={() => {
                                    setEditSecurityGroupIds((prev) =>
                                      assigned ? prev.filter((id) => id !== sg.id) : [...prev, sg.id]
                                    );
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors",
                                    assigned
                                      ? "bg-bot-accent/15 border-bot-accent/40 text-bot-accent"
                                      : "bg-bot-elevated border-bot-border text-bot-muted hover:border-bot-accent/40 hover:text-bot-text"
                                  )}
                                >
                                  <Network className="h-2.5 w-2.5" />
                                  {sg.name}
                                  {assigned && <Check className="h-2.5 w-2.5" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          onClick={handleResetPassword}
                          className="flex items-center gap-1.5 rounded-md border border-bot-amber/40 bg-bot-amber/10 px-3 py-1.5 text-caption font-medium text-bot-amber hover:bg-bot-amber/20 transition-colors"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Reset Password
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={cancelEdit}
                            className="rounded-md border border-bot-border px-4 py-2 text-body text-bot-muted hover:bg-bot-surface transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={editSaving}
                            className="flex items-center gap-1.5 rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
                          >
                            <Check className="h-4 w-4" />
                            {editSaving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

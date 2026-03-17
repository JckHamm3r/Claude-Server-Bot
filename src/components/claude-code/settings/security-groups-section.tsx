"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ShieldCheck, Plus, X, Edit2, Trash2, Users, Search,
  CheckCircle, AlertTriangle, RefreshCw, ChevronDown, ChevronRight,
  Network, TestTube, Wifi, Copy, UserMinus, UserPlus,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";

interface SecurityGroup {
  id: string;
  name: string;
  description: string;
  allowed_ips: string;
  created_at: string;
  updated_at: string;
  member_count: number;
}

interface SecurityGroupMember {
  email: string;
  first_name: string;
  last_name: string;
  is_admin: number;
  avatar_url: string | null;
  assigned_at: string;
  assigned_by: string | null;
}

interface UserOption {
  email: string;
  first_name: string;
  last_name: string;
}

interface CheckIPResult {
  ip: string;
  matching_groups: Array<{ id: string; name: string; matched_ips: string[] }>;
  user_results: Array<{
    email: string;
    first_name: string;
    last_name: string;
    restricted: boolean;
    allowed: boolean;
  }>;
}

const AVATAR_PALETTE = [
  "bg-violet-600", "bg-blue-600", "bg-cyan-600", "bg-teal-600",
  "bg-emerald-600", "bg-amber-600", "bg-orange-600", "bg-rose-600",
];

function avatarColor(email: string) {
  const sum = email.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

function avatarInitial(email: string, firstName?: string) {
  if (firstName) return firstName[0].toUpperCase();
  return email[0].toUpperCase();
}

function parseIPs(json: string): string[] {
  try { return JSON.parse(json) ?? []; } catch { return []; }
}

// ─── IPTagInput ───────────────────────────────────────────────────────────────

function IPTagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ips: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  function addEntry() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) { setInput(""); return; }
    // basic client-side validation (full validation is server-side)
    const isIPv4Like = /^[\d./]+$/.test(trimmed);
    const isIPv6Like = /^[0-9a-fA-F:./]+$/.test(trimmed);
    if (!isIPv4Like && !isIPv6Like) {
      setError("Enter a valid IP address or CIDR (e.g. 10.0.0.0/8)");
      return;
    }
    setError("");
    onChange([...value, trimmed]);
    setInput("");
  }

  function removeEntry(ip: string) {
    onChange(value.filter((v) => v !== ip));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEntry(); } }}
          placeholder="e.g. 192.168.1.0/24 or 10.0.0.5"
          className="flex-1 px-2.5 py-1.5 text-sm rounded-md bg-bot-surface border border-bot-border text-bot-text placeholder:text-bot-muted focus:outline-none focus:border-bot-accent"
        />
        <button
          onClick={addEntry}
          className="px-2.5 py-1.5 rounded-md bg-bot-accent text-white text-sm hover:bg-bot-accent/90 flex items-center gap-1"
        >
          <Plus size={13} /> Add
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((ip) => (
            <span
              key={ip}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-bot-elevated border border-bot-border text-bot-text font-mono"
            >
              {ip}
              <button onClick={() => removeEntry(ip)} className="text-bot-muted hover:text-red-400 ml-0.5">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SecurityGroupEditor ──────────────────────────────────────────────────────

function SecurityGroupEditor({
  group,
  onSave,
  onCancel,
}: {
  group: SecurityGroup | null; // null = create mode
  onSave: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [ips, setIps] = useState<string[]>(group ? parseIPs(group.allowed_ips) : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Member management (only in edit mode)
  const [members, setMembers] = useState<SecurityGroupMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [addEmail, setAddEmail] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!group) return;
    const res = await fetch(apiUrl(`/api/security-groups/${group.id}`));
    if (res.ok) {
      const data = await res.json();
      setMembers(data.members ?? []);
    }
  }, [group]);

  useEffect(() => {
    loadMembers();
    fetch(apiUrl("/api/users")).then((r) => r.json()).then((d) => {
      setAllUsers((d.users ?? []).map((u: UserOption) => ({ email: u.email, first_name: u.first_name, last_name: u.last_name })));
    }).catch(() => {});
  }, [loadMembers]);

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    try {
      const url = group ? apiUrl(`/api/security-groups/${group.id}`) : apiUrl("/api/security-groups");
      const method = group ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description, allowed_ips: ips }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save"); return; }
      onSave();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMember() {
    if (!addEmail.trim() || !group) return;
    setAddingMember(true);
    try {
      const res = await fetch(apiUrl(`/api/security-groups/${group.id}/members`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addEmail.trim() }),
      });
      if (res.ok) { setAddEmail(""); await loadMembers(); }
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(email: string) {
    if (!group) return;
    setRemovingEmail(email);
    try {
      await fetch(apiUrl(`/api/security-groups/${group.id}/members`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      await loadMembers();
    } finally {
      setRemovingEmail(null);
    }
  }

  const memberEmailSet = new Set(members.map((m) => m.email));
  const assignableUsers = allUsers.filter((u) => !memberEmailSet.has(u.email));
  const filteredMembers = members.filter(
    (m) => !memberSearch || m.email.includes(memberSearch) || m.first_name.includes(memberSearch) || m.last_name.includes(memberSearch)
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-bot-muted mb-1">Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Office Network"
            className="w-full px-2.5 py-1.5 text-sm rounded-md bg-bot-surface border border-bot-border text-bot-text placeholder:text-bot-muted focus:outline-none focus:border-bot-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-bot-muted mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description"
            className="w-full px-2.5 py-1.5 text-sm rounded-md bg-bot-surface border border-bot-border text-bot-text placeholder:text-bot-muted focus:outline-none focus:border-bot-accent"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-bot-muted mb-1.5">
          Allowed IPs / CIDRs
          <span className="ml-1 text-bot-muted font-normal">(IPv4 and IPv6 supported)</span>
        </label>
        <IPTagInput value={ips} onChange={setIps} />
        {ips.length === 0 && (
          <p className="text-xs text-amber-400 mt-1.5">No IPs added — users in this group will not be restricted by it.</p>
        )}
      </div>

      {/* Member management (edit mode only) */}
      {group && (
        <div>
          <label className="block text-xs font-medium text-bot-muted mb-1.5">Members ({members.length})</label>
          <div className="rounded-lg border border-bot-border bg-bot-surface overflow-hidden">
            {/* Add member */}
            <div className="flex gap-2 p-2.5 border-b border-bot-border">
              <select
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm rounded-md bg-bot-elevated border border-bot-border text-bot-text focus:outline-none focus:border-bot-accent"
              >
                <option value="">Select user to add…</option>
                {assignableUsers.map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.first_name || u.last_name ? `${u.first_name} ${u.last_name} (${u.email})` : u.email}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddMember}
                disabled={!addEmail || addingMember}
                className="px-2.5 py-1.5 rounded-md bg-bot-accent text-white text-sm hover:bg-bot-accent/90 disabled:opacity-40 flex items-center gap-1"
              >
                {addingMember ? <RefreshCw size={12} className="animate-spin" /> : <UserPlus size={12} />}
                Add
              </button>
            </div>

            {/* Member search */}
            {members.length > 0 && (
              <div className="px-2.5 py-2 border-b border-bot-border">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-bot-muted" />
                  <input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search members…"
                    className="w-full pl-6 pr-2.5 py-1 text-xs rounded-md bg-bot-elevated border border-bot-border text-bot-text placeholder:text-bot-muted focus:outline-none focus:border-bot-accent"
                  />
                </div>
              </div>
            )}

            {/* Member list */}
            {filteredMembers.length === 0 ? (
              <p className="text-xs text-bot-muted p-3 text-center">No members</p>
            ) : (
              <div className="divide-y divide-bot-border max-h-48 overflow-y-auto">
                {filteredMembers.map((m) => (
                  <div key={m.email} className="flex items-center gap-2.5 px-2.5 py-2">
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0", avatarColor(m.email))}>
                      {avatarInitial(m.email, m.first_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-bot-text truncate">
                        {m.first_name || m.last_name ? `${m.first_name} ${m.last_name}`.trim() : m.email}
                      </p>
                      <p className="text-[10px] text-bot-muted truncate">{m.email}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveMember(m.email)}
                      disabled={removingEmail === m.email}
                      className="text-bot-muted hover:text-red-400 transition-colors p-0.5 shrink-0"
                      title="Remove from group"
                    >
                      {removingEmail === m.email ? <RefreshCw size={12} className="animate-spin" /> : <UserMinus size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-sm text-bot-muted hover:text-bot-text border border-bot-border hover:bg-bot-surface"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-sm bg-bot-accent text-white hover:bg-bot-accent/90 disabled:opacity-40 flex items-center gap-1.5"
        >
          {saving && <RefreshCw size={12} className="animate-spin" />}
          {group ? "Save Changes" : "Create Group"}
        </button>
      </div>
    </div>
  );
}

// ─── TestIPTool ───────────────────────────────────────────────────────────────

function TestIPTool() {
  const [ip, setIp] = useState("");
  const [result, setResult] = useState<CheckIPResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentIP, setCurrentIP] = useState<string>("");

  useEffect(() => {
    fetch(apiUrl("/api/health/ping")).then((r) => {
      const realIP = r.headers.get("x-real-ip") ?? "";
      if (realIP) setCurrentIP(realIP);
    }).catch(() => {});
    // Fallback: try to get from a simple endpoint
    fetch(apiUrl("/api/app-settings")).then(async (r) => {
      if (r.ok) {
        const forwarded = r.headers.get("x-forwarded-for");
        if (forwarded) setCurrentIP(forwarded.split(",")[0].trim());
      }
    }).catch(() => {});
  }, []);

  async function handleCheck() {
    setError("");
    setResult(null);
    if (!ip.trim()) { setError("Enter an IP address"); return; }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/security-groups/check-ip"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: ip.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Check failed"); return; }
      setResult(data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const restrictedUsers = result?.user_results.filter((u) => u.restricted) ?? [];
  const allowedRestricted = restrictedUsers.filter((u) => u.allowed);
  const blockedRestricted = restrictedUsers.filter((u) => !u.allowed);

  return (
    <div className="space-y-3">
      {currentIP && (
        <p className="text-xs text-bot-muted">
          Your current IP: <span className="font-mono text-bot-text">{currentIP}</span>
          <button
            onClick={() => setIp(currentIP)}
            className="ml-2 text-bot-accent hover:underline"
          >
            Use this IP
          </button>
        </p>
      )}
      <div className="flex gap-2">
        <input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCheck()}
          placeholder="Enter IP to test (e.g. 10.0.0.5)"
          className="flex-1 px-2.5 py-1.5 text-sm rounded-md bg-bot-surface border border-bot-border text-bot-text placeholder:text-bot-muted focus:outline-none focus:border-bot-accent font-mono"
        />
        <button
          onClick={handleCheck}
          disabled={loading}
          className="px-3 py-1.5 rounded-md bg-bot-accent text-white text-sm hover:bg-bot-accent/90 disabled:opacity-40 flex items-center gap-1.5"
        >
          {loading ? <RefreshCw size={12} className="animate-spin" /> : <TestTube size={12} />}
          Test
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <div className="space-y-3 rounded-lg border border-bot-border bg-bot-surface p-3">
          <p className="text-xs font-medium text-bot-text font-mono">Results for {result.ip}</p>

          {/* Matching security groups */}
          <div>
            <p className="text-[10px] font-medium text-bot-muted uppercase tracking-wide mb-1.5">Security Groups that match</p>
            {result.matching_groups.length === 0 ? (
              <p className="text-xs text-bot-muted">No security groups match this IP</p>
            ) : (
              <div className="space-y-1">
                {result.matching_groups.map((g) => (
                  <div key={g.id} className="flex items-start gap-2 text-xs">
                    <CheckCircle size={12} className="text-green-400 mt-0.5 shrink-0" />
                    <span className="font-medium text-bot-text">{g.name}</span>
                    <span className="text-bot-muted font-mono text-[10px]">({g.matched_ips.join(", ")})</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Restricted users */}
          {restrictedUsers.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-bot-muted uppercase tracking-wide mb-1.5">IP-restricted users</p>
              <div className="space-y-1">
                {allowedRestricted.map((u) => (
                  <div key={u.email} className="flex items-center gap-2 text-xs">
                    <CheckCircle size={12} className="text-green-400 shrink-0" />
                    <span className="text-bot-text">{u.first_name || u.last_name ? `${u.first_name} ${u.last_name} (${u.email})` : u.email}</span>
                    <span className="text-green-400 text-[10px]">ALLOWED</span>
                  </div>
                ))}
                {blockedRestricted.map((u) => (
                  <div key={u.email} className="flex items-center gap-2 text-xs">
                    <X size={12} className="text-red-400 shrink-0" />
                    <span className="text-bot-text">{u.first_name || u.last_name ? `${u.first_name} ${u.last_name} (${u.email})` : u.email}</span>
                    <span className="text-red-400 text-[10px]">BLOCKED</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {restrictedUsers.length === 0 && (
            <p className="text-xs text-bot-muted">No users have IP restrictions configured.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SecurityGroupsSection() {
  const [groups, setGroups] = useState<SecurityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingGroup, setEditingGroup] = useState<SecurityGroup | null | "new">(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showTestIP, setShowTestIP] = useState(false);
  const [copiedIP, setCopiedIP] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/security-groups"));
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(apiUrl(`/api/security-groups/${id}`), { method: "DELETE" });
      await loadGroups();
    } finally {
      setDeletingId(null);
    }
  }

  function copyIPs(ips: string[]) {
    navigator.clipboard.writeText(ips.join("\n")).catch(() => {});
    setCopiedIP(ips[0]);
    setTimeout(() => setCopiedIP(null), 2000);
  }

  const filtered = groups.filter(
    (g) => !search || g.name.toLowerCase().includes(search.toLowerCase()) || g.description.toLowerCase().includes(search.toLowerCase())
  );

  if (editingGroup !== null) {
    const isNew = editingGroup === "new";
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditingGroup(null)}
            className="text-xs text-bot-muted hover:text-bot-text flex items-center gap-1"
          >
            <ChevronRight size={12} className="rotate-180" /> Back
          </button>
          <span className="text-body font-semibold text-bot-text">
            {isNew ? "New Security Group" : `Edit: ${(editingGroup as SecurityGroup).name}`}
          </span>
        </div>
        <div className="rounded-lg border border-bot-border bg-bot-elevated p-4">
          <SecurityGroupEditor
            group={isNew ? null : editingGroup as SecurityGroup}
            onSave={() => { setEditingGroup(null); loadGroups(); }}
            onCancel={() => setEditingGroup(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-bot-text flex items-center gap-2">
            <ShieldCheck size={16} className="text-bot-accent" />
            Security Groups
          </h2>
          <p className="text-xs text-bot-muted mt-0.5">
            Reusable IP allowlists. Assign groups to users to restrict platform access by IP or subnet.
          </p>
        </div>
        <button
          onClick={() => setEditingGroup("new")}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bot-accent text-white text-sm hover:bg-bot-accent/90"
        >
          <Plus size={13} /> New Group
        </button>
      </div>

      {/* Test IP tool */}
      <div className="rounded-lg border border-bot-border bg-bot-elevated overflow-hidden">
        <button
          onClick={() => setShowTestIP((v) => !v)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-medium text-bot-text hover:bg-bot-surface/50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <TestTube size={13} className="text-bot-accent" />
            Test IP Access
          </span>
          {showTestIP ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {showTestIP && (
          <div className="px-3.5 pb-3.5 border-t border-bot-border pt-3">
            <TestIPTool />
          </div>
        )}
      </div>

      {/* Search */}
      {groups.length > 3 && (
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bot-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search security groups…"
            className="w-full pl-7 pr-3 py-1.5 text-sm rounded-md bg-bot-surface border border-bot-border text-bot-text placeholder:text-bot-muted focus:outline-none focus:border-bot-accent"
          />
        </div>
      )}

      {/* Group list */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-bot-muted">
          <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-bot-border p-8 text-center">
          <ShieldCheck size={24} className="mx-auto mb-2 text-bot-muted" />
          <p className="text-sm text-bot-muted">
            {search ? "No groups match your search." : "No security groups yet. Create one to start restricting user access by IP."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((group) => {
            const ips = parseIPs(group.allowed_ips);
            const isExpanded = expandedId === group.id;
            const isDeleting = deletingId === group.id;

            return (
              <div
                key={group.id}
                className="rounded-lg border border-bot-border bg-bot-elevated overflow-hidden"
              >
                {/* Row header */}
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : group.id)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                  >
                    <div className="w-7 h-7 rounded-md bg-bot-accent/15 flex items-center justify-center shrink-0">
                      <Network size={13} className="text-bot-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-bot-text">{group.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bot-surface border border-bot-border text-bot-muted font-mono">
                          {ips.length} IP{ips.length !== 1 ? "s" : ""}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bot-surface border border-bot-border text-bot-muted flex items-center gap-0.5">
                          <Users size={9} /> {group.member_count}
                        </span>
                      </div>
                      {group.description && (
                        <p className="text-xs text-bot-muted truncate mt-0.5">{group.description}</p>
                      )}
                    </div>
                    {isExpanded ? <ChevronDown size={13} className="text-bot-muted shrink-0" /> : <ChevronRight size={13} className="text-bot-muted shrink-0" />}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingGroup(group)}
                      className="p-1.5 rounded-md text-bot-muted hover:text-bot-text hover:bg-bot-surface"
                      title="Edit"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(group.id)}
                      disabled={isDeleting}
                      className="p-1.5 rounded-md text-bot-muted hover:text-red-400 hover:bg-red-500/10"
                      title="Delete"
                    >
                      {isDeleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>

                {/* Expanded: IPs preview */}
                {isExpanded && (
                  <div className="border-t border-bot-border px-3.5 py-3 space-y-2">
                    {ips.length === 0 ? (
                      <p className="text-xs text-bot-muted">No IPs configured — this group has no effect.</p>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-medium text-bot-muted uppercase tracking-wide">Allowed IPs / CIDRs</p>
                          <button
                            onClick={() => copyIPs(ips)}
                            className="text-[10px] text-bot-muted hover:text-bot-text flex items-center gap-0.5"
                          >
                            {copiedIP === ips[0] ? <CheckCircle size={10} className="text-green-400" /> : <Copy size={10} />}
                            {copiedIP === ips[0] ? "Copied" : "Copy all"}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {ips.map((ip) => (
                            <span key={ip} className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-bot-surface border border-bot-border text-bot-text">
                              {ip}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-bot-muted">
                      Updated {new Date(group.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Info callout */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-3 flex gap-2.5">
        <Wifi size={13} className="text-bot-accent mt-0.5 shrink-0" />
        <div className="text-xs text-bot-muted space-y-1">
          <p className="text-bot-text font-medium">How IP restrictions work</p>
          <p>Assign one or more security groups to a user (in User Management) to restrict their access. You can also set per-user IPs directly on each user.</p>
          <p>The effective allowlist is the <strong className="text-bot-text">union</strong> of all their security groups plus any direct IPs. An empty allowlist means unrestricted access.</p>
          <p>Restrictions are checked at login and re-evaluated every 5 minutes during active sessions.</p>
        </div>
      </div>
    </div>
  );
}

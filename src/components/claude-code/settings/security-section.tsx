"use client";

import { useEffect, useState } from "react";
import { Shield, Wifi, Terminal, ScrollText, Plus, X, RefreshCw, Lock, Unlock } from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";

type SecuritySubTab = "guard_rails" | "ip_protection" | "sandbox" | "security_log";

interface BlockedIP {
  id: number;
  ip_address: string;
  block_reason: string;
  block_type: "temporary" | "permanent";
  failed_attempt_count: number;
  blocked_at: string;
  unblock_at: string | null;
  blocked_by: string;
}

interface SecuritySettings {
  guard_rails_enabled: boolean;
  sandbox_enabled: boolean;
  ip_protection_enabled: boolean;
}

interface IPProtectionSettings {
  enabled: boolean;
  maxAttempts: number;
  windowMinutes: number;
  blockDurationMinutes: number;
}

interface SandboxData {
  enabled: boolean;
  safeCommands: string[];
  restrictedCommands: string[];
  dangerousPatterns: string[];
  alwaysAllowed: string[];
  alwaysBlocked: string[];
}

interface SecurityEvent {
  id: number;
  timestamp: string;
  event_type: string;
  user_email: string | null;
  details: string | null;
}

export function SecuritySection() {
  const [activeTab, setActiveTab] = useState<SecuritySubTab>("guard_rails");

  // Guard Rails
  const [secSettings, setSecSettings] = useState<SecuritySettings | null>(null);
  const [savingGuard, setSavingGuard] = useState(false);
  const [guardMsg, setGuardMsg] = useState("");

  // IP Protection
  const [ipSettings, setIpSettings] = useState<IPProtectionSettings | null>(null);
  const [blockedIPs, setBlockedIPs] = useState<BlockedIP[]>([]);
  const [ipLoading, setIpLoading] = useState(false);
  const [ipMsg, setIpMsg] = useState("");
  const [manualIP, setManualIP] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualType, setManualType] = useState<"temporary" | "permanent">("temporary");
  const [manualDuration, setManualDuration] = useState(60);
  const [blockingIP, setBlockingIP] = useState(false);

  // Sandbox
  const [sandboxData, setSandboxData] = useState<SandboxData | null>(null);
  const [sandboxMsg, setSandboxMsg] = useState("");
  const [newAllowedPattern, setNewAllowedPattern] = useState("");
  const [newBlockedPattern, setNewBlockedPattern] = useState("");
  const [sandboxLoading, setSandboxLoading] = useState(false);

  // Security Log
  const [secEvents, setSecEvents] = useState<SecurityEvent[]>([]);
  const [logCursor, setLogCursor] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);

  // ── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(apiUrl("/api/security/settings"))
      .then((r) => r.json())
      .then((d: SecuritySettings) => setSecSettings(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === "ip_protection") loadIPData();
    if (activeTab === "sandbox") loadSandboxData();
    if (activeTab === "security_log") loadSecurityLog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  function loadIPData() {
    setIpLoading(true);
    fetch(apiUrl("/api/security/ip-protection"))
      .then((r) => r.json())
      .then((d: { settings: IPProtectionSettings; blockedIPs: BlockedIP[] }) => {
        setIpSettings(d.settings);
        setBlockedIPs(d.blockedIPs);
      })
      .catch(() => {})
      .finally(() => setIpLoading(false));
  }

  function loadSandboxData() {
    setSandboxLoading(true);
    fetch(apiUrl("/api/security/sandbox"))
      .then((r) => r.json())
      .then((d: SandboxData) => setSandboxData(d))
      .catch(() => {})
      .finally(() => setSandboxLoading(false));
  }

  function loadSecurityLog(reset = false) {
    setLogLoading(true);
    const cursor = reset ? "" : logCursor ?? "";
    const url = apiUrl(cursor ? `/api/security/log?cursor=${cursor}` : "/api/security/log");
    fetch(url)
      .then((r) => r.json())
      .then((d: { events: SecurityEvent[]; nextCursor: string | null }) => {
        if (reset) {
          setSecEvents(d.events);
        } else {
          setSecEvents((prev) => [...prev, ...d.events]);
        }
        setLogCursor(d.nextCursor);
      })
      .catch(() => {})
      .finally(() => setLogLoading(false));
  }

  // ── Guard Rails handlers ───────────────────────────────────────────────────

  async function saveGuardSettings(updates: Partial<SecuritySettings>) {
    setSavingGuard(true);
    setGuardMsg("");
    const updated = { ...secSettings, ...updates };
    setSecSettings(updated as SecuritySettings);
    try {
      await fetch(apiUrl("/api/security/settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setGuardMsg("Saved");
      setTimeout(() => setGuardMsg(""), 2000);
    } catch {
      setGuardMsg("Error saving");
    } finally {
      setSavingGuard(false);
    }
  }

  // ── IP Protection handlers ─────────────────────────────────────────────────

  async function saveIPSettings(updates: Partial<IPProtectionSettings>) {
    setIpMsg("");
    const body: Record<string, unknown> = {};
    if ("enabled" in updates) body.ip_protection_enabled = updates.enabled;
    if ("maxAttempts" in updates) body.ip_max_attempts = updates.maxAttempts;
    if ("windowMinutes" in updates) body.ip_window_minutes = updates.windowMinutes;
    if ("blockDurationMinutes" in updates) body.ip_block_duration_minutes = updates.blockDurationMinutes;
    setIpSettings((prev) => prev ? { ...prev, ...updates } : prev);
    try {
      await fetch(apiUrl("/api/security/ip-protection"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setIpMsg("Saved");
      setTimeout(() => setIpMsg(""), 2000);
    } catch {
      setIpMsg("Error saving");
    }
  }

  async function unblockIP(ip: string) {
    await fetch(apiUrl(`/api/security/ip-protection/${encodeURIComponent(ip)}/unblock`), { method: "POST" });
    setBlockedIPs((prev) => prev.filter((b) => b.ip_address !== ip));
  }

  async function manualBlockIP() {
    if (!manualIP.trim()) return;
    setBlockingIP(true);
    try {
      await fetch(apiUrl("/api/security/ip-protection/block"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: manualIP.trim(),
          reason: manualReason || "Manually blocked by admin",
          type: manualType,
          durationMinutes: manualDuration,
        }),
      });
      setManualIP("");
      setManualReason("");
      loadIPData();
    } catch {
      setIpMsg("Error blocking IP");
    } finally {
      setBlockingIP(false);
    }
  }

  // ── Sandbox handlers ───────────────────────────────────────────────────────

  async function saveSandboxEnabled(enabled: boolean) {
    setSandboxData((prev) => prev ? { ...prev, enabled } : prev);
    await fetch(apiUrl("/api/security/sandbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  async function addAlwaysAllowed() {
    const pattern = newAllowedPattern.trim();
    if (!pattern) return;
    await fetch(apiUrl("/api/security/sandbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addAlwaysAllowed: pattern }),
    });
    setSandboxData((prev) => prev ? { ...prev, alwaysAllowed: [...prev.alwaysAllowed, pattern] } : prev);
    setNewAllowedPattern("");
    setSandboxMsg("Added");
    setTimeout(() => setSandboxMsg(""), 2000);
  }

  async function removeAlwaysAllowed(pattern: string) {
    await fetch(apiUrl("/api/security/sandbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeAlwaysAllowed: pattern }),
    });
    setSandboxData((prev) => prev ? { ...prev, alwaysAllowed: prev.alwaysAllowed.filter((p) => p !== pattern) } : prev);
  }

  async function addAlwaysBlocked() {
    const pattern = newBlockedPattern.trim();
    if (!pattern) return;
    await fetch(apiUrl("/api/security/sandbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addAlwaysBlocked: pattern }),
    });
    setSandboxData((prev) => prev ? { ...prev, alwaysBlocked: [...prev.alwaysBlocked, pattern] } : prev);
    setNewBlockedPattern("");
    setSandboxMsg("Added");
    setTimeout(() => setSandboxMsg(""), 2000);
  }

  async function removeAlwaysBlocked(pattern: string) {
    await fetch(apiUrl("/api/security/sandbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeAlwaysBlocked: pattern }),
    });
    setSandboxData((prev) => prev ? { ...prev, alwaysBlocked: prev.alwaysBlocked.filter((p) => p !== pattern) } : prev);
  }

  // ── Sub-tab definitions ────────────────────────────────────────────────────

  const tabs: { key: SecuritySubTab; label: string; icon: React.ReactNode }[] = [
    { key: "guard_rails", label: "Guard Rails", icon: <Shield className="h-4 w-4" /> },
    { key: "ip_protection", label: "IP Protection", icon: <Wifi className="h-4 w-4" /> },
    { key: "sandbox", label: "Command Sandbox", icon: <Terminal className="h-4 w-4" /> },
    { key: "security_log", label: "Security Log", icon: <ScrollText className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="h-5 w-5 text-bot-accent" />
        <h2 className="text-subtitle font-semibold text-bot-text">Security</h2>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-bot-border pb-0 mb-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-caption font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
              activeTab === t.key
                ? "border-bot-accent text-bot-accent"
                : "border-transparent text-bot-muted hover:text-bot-text",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Guard Rails ───────────────────────────────────────────────────── */}
      {activeTab === "guard_rails" && (
        <div className="space-y-5">
          {secSettings && (
            <>
              <ToggleRow
                label="Guard Rails Enabled"
                description="Prevents Claude from accessing protected files and making bot config changes via chat"
                checked={secSettings.guard_rails_enabled}
                onChange={(v) => saveGuardSettings({ guard_rails_enabled: v })}
                disabled={savingGuard}
              />
              {guardMsg && (
                <p className="text-caption text-bot-green">{guardMsg}</p>
              )}
            </>
          )}

          <div className="space-y-2">
            <h3 className="text-body font-medium text-bot-text">Protected Paths</h3>
            <p className="text-caption text-bot-muted">
              Claude will refuse to read, write, or execute commands targeting any of these paths.
            </p>
            <div className="rounded-lg border border-bot-border bg-bot-elevated p-3">
              <div className="flex flex-wrap gap-2">
                {[
                  ".env, *.env, .env.*",
                  "data/*.db, data/*.sqlite",
                  "/etc/nginx/, /etc/ssl/",
                  "**/*.key, **/*.pem, **/*.crt",
                  "/root/, ~/.ssh/",
                  "src/lib/auth.ts",
                  "src/lib/db.ts",
                  "server.ts",
                ].map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center rounded bg-bot-surface px-2 py-1 text-caption font-mono text-bot-muted border border-bot-border"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-body font-medium text-bot-text">Bot Config Protection</h3>
            <p className="text-caption text-bot-muted">
              When enabled, Claude will refuse chat requests to modify users, rate limits, SMTP settings, and
              other bot configuration — and redirect to the Settings UI instead.
            </p>
          </div>
        </div>
      )}

      {/* ── IP Protection ─────────────────────────────────────────────────── */}
      {activeTab === "ip_protection" && (
        <div className="space-y-5">
          {ipLoading && !ipSettings ? (
            <p className="text-caption text-bot-muted">Loading…</p>
          ) : ipSettings ? (
            <>
              <ToggleRow
                label="IP Protection Enabled"
                description="Track failed login attempts by IP and auto-block brute-force attackers"
                checked={ipSettings.enabled}
                onChange={(v) => saveIPSettings({ enabled: v })}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <LabeledInput
                  label="Max failed attempts"
                  type="number"
                  value={ipSettings.maxAttempts}
                  onChange={(v) => setIpSettings((p) => p ? { ...p, maxAttempts: parseInt(v) || 5 } : p)}
                  onBlur={(v) => saveIPSettings({ maxAttempts: parseInt(v) || 5 })}
                  min={1}
                  max={50}
                />
                <LabeledInput
                  label="Time window (minutes)"
                  type="number"
                  value={ipSettings.windowMinutes}
                  onChange={(v) => setIpSettings((p) => p ? { ...p, windowMinutes: parseInt(v) || 10 } : p)}
                  onBlur={(v) => saveIPSettings({ windowMinutes: parseInt(v) || 10 })}
                  min={1}
                  max={1440}
                />
                <LabeledInput
                  label="Block duration (minutes)"
                  type="number"
                  value={ipSettings.blockDurationMinutes}
                  onChange={(v) => setIpSettings((p) => p ? { ...p, blockDurationMinutes: parseInt(v) || 60 } : p)}
                  onBlur={(v) => saveIPSettings({ blockDurationMinutes: parseInt(v) || 60 })}
                  min={1}
                  max={43200}
                />
              </div>

              {ipMsg && <p className="text-caption text-bot-green">{ipMsg}</p>}

              {/* Blocked IPs table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-body font-medium text-bot-text">Blocked IPs</h3>
                  <button onClick={loadIPData} className="text-caption text-bot-muted hover:text-bot-text flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </button>
                </div>

                {blockedIPs.length === 0 ? (
                  <p className="text-caption text-bot-muted py-2">No blocked IPs.</p>
                ) : (
                  <div className="rounded-lg border border-bot-border overflow-hidden">
                    <table className="w-full text-caption">
                      <thead className="bg-bot-surface border-b border-bot-border">
                        <tr>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium">IP</th>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium">Reason</th>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium">Type</th>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium">Blocked at</th>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium">Unblocks at</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-bot-border">
                        {blockedIPs.map((b) => (
                          <tr key={b.id} className="bg-bot-elevated">
                            <td className="px-3 py-2 font-mono text-bot-text">{b.ip_address}</td>
                            <td className="px-3 py-2 text-bot-muted">{b.block_reason}</td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                "rounded px-1.5 py-0.5 text-caption",
                                b.block_type === "permanent" ? "bg-bot-red/20 text-bot-red" : "bg-bot-amber/20 text-bot-amber"
                              )}>
                                {b.block_type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-bot-muted">{b.blocked_at.slice(0, 16)}</td>
                            <td className="px-3 py-2 text-bot-muted">{b.unblock_at ? b.unblock_at.slice(0, 16) : "—"}</td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => unblockIP(b.ip_address)}
                                className="flex items-center gap-1 text-caption text-bot-green hover:text-bot-green/80"
                              >
                                <Unlock className="h-3 w-3" /> Unblock
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Manual block form */}
              <div className="space-y-3 rounded-lg border border-bot-border bg-bot-elevated p-4">
                <h3 className="text-body font-medium text-bot-text flex items-center gap-2">
                  <Lock className="h-4 w-4" /> Manual Block
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-caption text-bot-muted mb-1">IP Address</label>
                    <input
                      value={manualIP}
                      onChange={(e) => setManualIP(e.target.value)}
                      placeholder="1.2.3.4"
                      className="w-full rounded-lg border border-bot-border bg-bot-surface px-3 py-2 text-caption text-bot-text font-mono outline-none focus:border-bot-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-bot-muted mb-1">Reason</label>
                    <input
                      value={manualReason}
                      onChange={(e) => setManualReason(e.target.value)}
                      placeholder="Suspicious activity"
                      className="w-full rounded-lg border border-bot-border bg-bot-surface px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-caption text-bot-muted mb-1">Block type</label>
                    <select
                      value={manualType}
                      onChange={(e) => setManualType(e.target.value as "temporary" | "permanent")}
                      className="w-full rounded-lg border border-bot-border bg-bot-surface px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent"
                    >
                      <option value="temporary">Temporary</option>
                      <option value="permanent">Permanent</option>
                    </select>
                  </div>
                  {manualType === "temporary" && (
                    <div>
                      <label className="block text-caption text-bot-muted mb-1">Duration (minutes)</label>
                      <input
                        type="number"
                        value={manualDuration}
                        min={1}
                        onChange={(e) => setManualDuration(parseInt(e.target.value) || 60)}
                        className="w-full rounded-lg border border-bot-border bg-bot-surface px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent"
                      />
                    </div>
                  )}
                </div>
                <button
                  onClick={manualBlockIP}
                  disabled={!manualIP.trim() || blockingIP}
                  className="rounded-lg bg-bot-red px-4 py-2 text-caption font-medium text-white hover:bg-bot-red/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {blockingIP ? "Blocking…" : "Block IP"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── Command Sandbox ───────────────────────────────────────────────── */}
      {activeTab === "sandbox" && (
        <div className="space-y-5">
          {sandboxLoading && !sandboxData ? (
            <p className="text-caption text-bot-muted">Loading…</p>
          ) : sandboxData ? (
            <>
              <ToggleRow
                label="Command Sandbox Enabled"
                description="Classify bash commands and auto-block dangerous ones; flag restricted commands in permission dialogs"
                checked={sandboxData.enabled}
                onChange={saveSandboxEnabled}
              />

              {sandboxMsg && <p className="text-caption text-bot-green">{sandboxMsg}</p>}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <CommandList
                  title="Safe Commands"
                  color="green"
                  commands={sandboxData.safeCommands}
                  description="Pass through silently"
                />
                <CommandList
                  title="Restricted Commands"
                  color="amber"
                  commands={sandboxData.restrictedCommands}
                  description="Shown with warning in permission dialog"
                />
                <CommandList
                  title="Dangerous Patterns"
                  color="red"
                  commands={sandboxData.dangerousPatterns}
                  description="Auto-blocked — never allowed"
                />
              </div>

              {/* Always-allowed whitelist */}
              <div className="space-y-2">
                <h3 className="text-body font-medium text-bot-text">Always Allowed</h3>
                <p className="text-caption text-bot-muted">Commands you have permanently whitelisted. These bypass the sandbox.</p>
                <div className="flex flex-wrap gap-2">
                  {sandboxData.alwaysAllowed.map((p) => (
                    <span key={p} className="inline-flex items-center gap-1 rounded bg-bot-green/10 border border-bot-green/30 px-2 py-1 text-caption font-mono text-bot-green">
                      {p}
                      <button onClick={() => removeAlwaysAllowed(p)} className="hover:text-bot-red ml-1">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {sandboxData.alwaysAllowed.length === 0 && (
                    <span className="text-caption text-bot-muted">None added yet.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newAllowedPattern}
                    onChange={(e) => setNewAllowedPattern(e.target.value)}
                    placeholder="e.g. docker ps"
                    onKeyDown={(e) => { if (e.key === "Enter") addAlwaysAllowed(); }}
                    className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-caption font-mono text-bot-text outline-none focus:border-bot-accent"
                  />
                  <button
                    onClick={addAlwaysAllowed}
                    disabled={!newAllowedPattern.trim()}
                    className="flex items-center gap-1 rounded-lg bg-bot-accent px-3 py-2 text-caption font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
              </div>

              {/* Always-blocked list */}
              <div className="space-y-2">
                <h3 className="text-body font-medium text-bot-text">Custom Always Blocked</h3>
                <p className="text-caption text-bot-muted">Extra patterns to auto-block (in addition to built-in dangerous patterns).</p>
                <div className="flex flex-wrap gap-2">
                  {sandboxData.alwaysBlocked.map((p) => (
                    <span key={p} className="inline-flex items-center gap-1 rounded bg-bot-red/10 border border-bot-red/30 px-2 py-1 text-caption font-mono text-bot-red">
                      {p}
                      <button onClick={() => removeAlwaysBlocked(p)} className="hover:text-bot-red ml-1">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {sandboxData.alwaysBlocked.length === 0 && (
                    <span className="text-caption text-bot-muted">None added yet.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newBlockedPattern}
                    onChange={(e) => setNewBlockedPattern(e.target.value)}
                    placeholder="e.g. curl http://"
                    onKeyDown={(e) => { if (e.key === "Enter") addAlwaysBlocked(); }}
                    className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-caption font-mono text-bot-text outline-none focus:border-bot-accent"
                  />
                  <button
                    onClick={addAlwaysBlocked}
                    disabled={!newBlockedPattern.trim()}
                    className="flex items-center gap-1 rounded-lg bg-bot-red px-3 py-2 text-caption font-medium text-white hover:bg-bot-red/80 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── Security Log ─────────────────────────────────────────────────── */}
      {activeTab === "security_log" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-body font-medium text-bot-text">Security Events</h3>
            <button onClick={() => loadSecurityLog(true)} className="text-caption text-bot-muted hover:text-bot-text flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>

          {secEvents.length === 0 && !logLoading ? (
            <p className="text-caption text-bot-muted py-2">No security events recorded yet.</p>
          ) : (
            <div className="rounded-lg border border-bot-border overflow-hidden">
              <table className="w-full text-caption">
                <thead className="bg-bot-surface border-b border-bot-border">
                  <tr>
                    <th className="text-left px-3 py-2 text-bot-muted font-medium">Time</th>
                    <th className="text-left px-3 py-2 text-bot-muted font-medium">Event</th>
                    <th className="text-left px-3 py-2 text-bot-muted font-medium">User</th>
                    <th className="text-left px-3 py-2 text-bot-muted font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bot-border">
                  {secEvents.map((e) => (
                    <>
                      <tr
                        key={e.id}
                        className="bg-bot-elevated cursor-pointer hover:bg-bot-surface transition-colors"
                        onClick={() => setExpandedEvent(expandedEvent === e.id ? null : e.id)}
                      >
                        <td className="px-3 py-2 font-mono text-bot-muted whitespace-nowrap">{e.timestamp.slice(0, 16)}</td>
                        <td className="px-3 py-2">
                          <EventTypeBadge type={e.event_type} />
                        </td>
                        <td className="px-3 py-2 text-bot-muted">{e.user_email ?? "—"}</td>
                        <td className="px-3 py-2 text-bot-muted truncate max-w-[200px]">
                          {e.details ? (() => { try { return JSON.stringify(JSON.parse(e.details)).slice(0, 80); } catch { return e.details.slice(0, 80); } })() : "—"}
                        </td>
                      </tr>
                      {expandedEvent === e.id && e.details && (
                        <tr key={`${e.id}-detail`} className="bg-bot-surface">
                          <td colSpan={4} className="px-3 py-2">
                            <pre className="text-caption font-mono text-bot-text whitespace-pre-wrap break-all">
                              {(() => { try { return JSON.stringify(JSON.parse(e.details), null, 2); } catch { return e.details; } })()}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {logLoading && <p className="text-caption text-bot-muted">Loading…</p>}
          {logCursor && !logLoading && (
            <button
              onClick={() => loadSecurityLog(false)}
              className="text-caption text-bot-accent hover:underline"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small helper components ────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-bot-border bg-bot-elevated px-4 py-3">
      <div>
        <p className="text-body font-medium text-bot-text">{label}</p>
        <p className="text-caption text-bot-muted mt-0.5">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none",
          checked ? "bg-bot-accent" : "bg-bot-border",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}

function LabeledInput({
  label,
  type = "text",
  value,
  onChange,
  onBlur,
  min,
  max,
}: {
  label: string;
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="block text-caption text-bot-muted mb-1">{label}</label>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlur?.(e.target.value)}
        className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent"
      />
    </div>
  );
}

function CommandList({
  title,
  color,
  commands,
  description,
}: {
  title: string;
  color: "green" | "amber" | "red";
  commands: string[];
  description: string;
}) {
  const colorMap = {
    green: "bg-bot-green/10 border-bot-green/20 text-bot-green",
    amber: "bg-bot-amber/10 border-bot-amber/20 text-bot-amber",
    red: "bg-bot-red/10 border-bot-red/20 text-bot-red",
  };
  const titleMap = {
    green: "text-bot-green",
    amber: "text-bot-amber",
    red: "text-bot-red",
  };
  return (
    <div className="space-y-2">
      <h4 className={cn("text-caption font-semibold", titleMap[color])}>{title}</h4>
      <p className="text-caption text-bot-muted">{description}</p>
      <div className="rounded-lg border border-bot-border bg-bot-elevated p-2 max-h-40 overflow-y-auto">
        <div className="flex flex-wrap gap-1">
          {commands.map((c) => (
            <span key={c} className={cn("rounded px-1.5 py-0.5 text-caption font-mono border", colorMap[color])}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const colorMap: Record<string, string> = {
    security_ip_blocked: "bg-bot-red/20 text-bot-red",
    security_ip_unblocked: "bg-bot-green/20 text-bot-green",
    security_manual_ip_block: "bg-bot-red/20 text-bot-red",
    security_command_blocked: "bg-bot-amber/20 text-bot-amber",
    security_mod_blocked: "bg-bot-amber/20 text-bot-amber",
    security_failed_login: "bg-bot-red/10 text-bot-red",
    security_prompt_injection_detected: "bg-bot-red/20 text-bot-red",
    security_command_policy_changed: "bg-bot-muted/20 text-bot-muted",
  };
  const label = type.replace("security_", "").replace(/_/g, " ");
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-caption", colorMap[type] ?? "bg-bot-surface text-bot-muted")}>
      {label}
    </span>
  );
}

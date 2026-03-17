"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Shield, Wifi, Terminal, ScrollText, Plus, X, RefreshCw, Lock, Unlock,
  AlertTriangle, Bot, User, Activity, CircleDot, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Zap, Globe, Flame, Trash2, Info
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";

type SecuritySubTab = "guard_rails" | "ip_protection" | "sandbox" | "security_log" | "firewall";

interface BlockedIP {
  id: number;
  ip_address: string;
  block_reason: string;
  block_type: "temporary" | "permanent";
  failed_attempt_count: number;
  blocked_at: string;
  unblock_at: string | null;
  blocked_by: string;
  source_type: "app" | "manual" | "fail2ban" | "api_abuse";
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

interface ApiAbuseSettings {
  enabled: boolean;
  maxRequests: number;
  windowSeconds: number;
  blockMinutes: number;
}

interface Fail2BanSettings {
  enabled: boolean;
  jail: string;
  syncIntervalSeconds: number;
}

interface Fail2BanStatus {
  available: boolean;
  running: boolean;
  version?: string;
  jailName: string;
  jailExists: boolean;
  bannedIPs: string[];
  error?: string;
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
  const [apiAbuseSettings, setApiAbuseSettings] = useState<ApiAbuseSettings | null>(null);
  const [fail2banSettings, setFail2BanSettings] = useState<Fail2BanSettings | null>(null);
  const [fail2banStatus, setFail2BanStatus] = useState<Fail2BanStatus | null>(null);
  const [blockedIPs, setBlockedIPs] = useState<BlockedIP[]>([]);
  const [ipLoading, setIpLoading] = useState(false);
  const [ipMsg, setIpMsg] = useState("");
  const [ipMsgType, setIpMsgType] = useState<"success" | "error">("success");
  const [manualIP, setManualIP] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualType, setManualType] = useState<"temporary" | "permanent">("temporary");
  const [manualDuration, setManualDuration] = useState(60);
  const [blockingIP, setBlockingIP] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expandedIP, setExpandedIP] = useState<number | null>(null);
  const [activeIPFilter, setActiveIPFilter] = useState<BlockedIP["source_type"] | "all">("all");

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

  const loadIPData = useCallback(() => {
    setIpLoading(true);
    fetch(apiUrl("/api/security/ip-protection"))
      .then((r) => r.json())
      .then((d: {
        settings: IPProtectionSettings;
        apiAbuseSettings: ApiAbuseSettings;
        fail2banSettings: Fail2BanSettings;
        fail2banStatus: Fail2BanStatus;
        blockedIPs: BlockedIP[];
      }) => {
        setIpSettings(d.settings);
        setApiAbuseSettings(d.apiAbuseSettings);
        setFail2BanSettings(d.fail2banSettings);
        setFail2BanStatus(d.fail2banStatus);
        setBlockedIPs(d.blockedIPs);
      })
      .catch(() => {})
      .finally(() => setIpLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "ip_protection") loadIPData();
    if (activeTab === "sandbox") loadSandboxData();
    if (activeTab === "security_log") loadSecurityLog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Auto-refresh fail2ban sync when on ip_protection tab
  useEffect(() => {
    if (activeTab !== "ip_protection" || !fail2banSettings?.enabled) return;
    const interval = Math.max((fail2banSettings.syncIntervalSeconds ?? 30) * 1000, 15_000);
    const timer = setInterval(() => {
      fetch(apiUrl("/api/security/ip-protection"))
        .then((r) => r.json())
        .then((d: { blockedIPs: BlockedIP[]; fail2banStatus: Fail2BanStatus }) => {
          setBlockedIPs(d.blockedIPs);
          setFail2BanStatus(d.fail2banStatus);
        })
        .catch(() => {});
    }, interval);
    return () => clearInterval(timer);
  }, [activeTab, fail2banSettings]);

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

  function showMsg(msg: string, type: "success" | "error" = "success") {
    setIpMsg(msg);
    setIpMsgType(type);
    setTimeout(() => setIpMsg(""), 3000);
  }

  // ── Guard Rails handlers ───────────────────────────────────────────────────

  async function saveGuardSettings(updates: Partial<SecuritySettings>) {
    setSavingGuard(true);
    setGuardMsg("");
    const previous = secSettings;
    const updated = { ...secSettings, ...updates };
    setSecSettings(updated as SecuritySettings);
    try {
      const res = await fetch(apiUrl("/api/security/settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        setSecSettings(previous as SecuritySettings);
        setGuardMsg("Error saving");
      } else {
        setGuardMsg("Saved");
        setTimeout(() => setGuardMsg(""), 2000);
      }
    } catch {
      setSecSettings(previous as SecuritySettings);
      setGuardMsg("Error saving");
    } finally {
      setSavingGuard(false);
    }
  }

  // ── IP Protection handlers ─────────────────────────────────────────────────

  async function saveIPSettings(updates: Record<string, unknown>) {
    try {
      await fetch(apiUrl("/api/security/ip-protection"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      showMsg("Saved");
    } catch {
      showMsg("Error saving", "error");
    }
  }

  async function unblockIPAction(ip: string) {
    try {
      const res = await fetch(apiUrl(`/api/security/ip-protection/${encodeURIComponent(ip)}/unblock`), { method: "POST" });
      if (res.ok) {
        setBlockedIPs((prev) => prev.filter((b) => b.ip_address !== ip));
        showMsg("IP unblocked");
      } else {
        showMsg("Failed to unblock IP", "error");
      }
    } catch {
      showMsg("Error unblocking IP", "error");
    }
  }

  async function manualBlockIP() {
    if (!manualIP.trim()) return;
    setBlockingIP(true);
    try {
      const res = await fetch(apiUrl("/api/security/ip-protection/block"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: manualIP.trim(),
          reason: manualReason || "Manually blocked by admin",
          type: manualType,
          durationMinutes: manualDuration,
        }),
      });
      if (res.ok) {
        setManualIP("");
        setManualReason("");
        showMsg("IP blocked successfully");
        loadIPData();
      } else {
        const data = await res.json() as { error?: string };
        showMsg(data.error ?? "Error blocking IP", "error");
      }
    } catch {
      showMsg("Error blocking IP", "error");
    } finally {
      setBlockingIP(false);
    }
  }

  async function triggerFail2BanSync() {
    setSyncing(true);
    try {
      const res = await fetch(apiUrl("/api/security/ip-protection/fail2ban-sync"), { method: "POST" });
      const data = await res.json() as { ok?: boolean; added?: number; removed?: number; error?: string };
      if (res.ok) {
        showMsg(`Synced — ${data.added ?? 0} added, ${data.removed ?? 0} removed`);
        loadIPData();
      } else {
        showMsg(data.error ?? "Sync failed", "error");
      }
    } catch {
      showMsg("Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }

  // ── Sandbox handlers ───────────────────────────────────────────────────────

  async function sandboxPost(body: Record<string, unknown>) {
    const res = await fetch(apiUrl("/api/security/sandbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Server error");
  }

  async function saveSandboxEnabled(enabled: boolean) {
    const prev = sandboxData;
    setSandboxData((s) => s ? { ...s, enabled } : s);
    try {
      await sandboxPost({ enabled });
      setSandboxMsg(enabled ? "Sandbox enabled" : "Sandbox disabled");
      setTimeout(() => setSandboxMsg(""), 2000);
    } catch {
      setSandboxData(prev);
      setSandboxMsg("Error saving");
    }
  }

  async function addAlwaysAllowed() {
    const pattern = newAllowedPattern.trim();
    if (!pattern) return;
    try {
      await sandboxPost({ addAlwaysAllowed: pattern });
      setSandboxData((s) => s ? { ...s, alwaysAllowed: [...s.alwaysAllowed, pattern] } : s);
      setNewAllowedPattern("");
      setSandboxMsg("Added");
      setTimeout(() => setSandboxMsg(""), 2000);
    } catch {
      setSandboxMsg("Error adding pattern");
    }
  }

  async function removeAlwaysAllowed(pattern: string) {
    try {
      await sandboxPost({ removeAlwaysAllowed: pattern });
      setSandboxData((s) => s ? { ...s, alwaysAllowed: s.alwaysAllowed.filter((p) => p !== pattern) } : s);
    } catch {
      setSandboxMsg("Error removing pattern");
    }
  }

  async function addAlwaysBlocked() {
    const pattern = newBlockedPattern.trim();
    if (!pattern) return;
    try {
      await sandboxPost({ addAlwaysBlocked: pattern });
      setSandboxData((s) => s ? { ...s, alwaysBlocked: [...s.alwaysBlocked, pattern] } : s);
      setNewBlockedPattern("");
      setSandboxMsg("Added");
      setTimeout(() => setSandboxMsg(""), 2000);
    } catch {
      setSandboxMsg("Error adding pattern");
    }
  }

  async function removeAlwaysBlocked(pattern: string) {
    try {
      await sandboxPost({ removeAlwaysBlocked: pattern });
      setSandboxData((s) => s ? { ...s, alwaysBlocked: s.alwaysBlocked.filter((p) => p !== pattern) } : s);
    } catch {
      setSandboxMsg("Error removing pattern");
    }
  }

  // ── UFW Firewall state & handlers ─────────────────────────────────────────

  interface UfwRule { number: number; to: string; action: string; from: string; comment?: string }
  interface UfwStatus {
    active: boolean; logging: string;
    defaultPolicies: { incoming: string; outgoing: string; routed: string };
    rules: UfwRule[];
    error?: string;
  }
  interface UfwData { available: boolean; status: UfwStatus | null; appPort: number | null; sshPort: number; error?: string }
  interface PendingUfwChange { changeId: string; confirmDeadlineMs: number; startedAt: number }

  const [ufwData, setUfwData] = useState<UfwData | null>(null);
  const [ufwLoading, setUfwLoading] = useState(false);
  const [ufwMsg, setUfwMsg] = useState("");
  const [ufwMsgType, setUfwMsgType] = useState<"success" | "error">("success");
  const [ufwRuleLoading, setUfwRuleLoading] = useState(false);

  // Add rule form state
  const [ufwNewAction, setUfwNewAction] = useState<"allow" | "deny" | "limit">("allow");
  const [ufwNewPort, setUfwNewPort] = useState("");
  const [ufwNewProto, setUfwNewProto] = useState<"tcp" | "udp" | "any">("tcp");
  const [ufwNewFrom, setUfwNewFrom] = useState("");
  const [ufwFromAnywhere, setUfwFromAnywhere] = useState(true);

  // Rollback / confirm
  const [pendingUfw, setPendingUfw] = useState<PendingUfwChange | null>(null);
  const [rollbackSecondsLeft, setRollbackSecondsLeft] = useState(60);
  const rollbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Delete confirm
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<UfwRule | null>(null);

  const loadUfwData = useCallback(() => {
    setUfwLoading(true);
    fetch(apiUrl("/api/security/ufw"))
      .then((r) => r.json())
      .then((d: UfwData) => setUfwData(d))
      .catch(() => setUfwMsg("Failed to load firewall data"))
      .finally(() => setUfwLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "firewall") loadUfwData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Rollback countdown timer
  useEffect(() => {
    if (!pendingUfw) {
      if (rollbackTimerRef.current) clearInterval(rollbackTimerRef.current);
      return;
    }
    const elapsed = Date.now() - pendingUfw.startedAt;
    const remaining = Math.ceil((pendingUfw.confirmDeadlineMs - elapsed) / 1000);
    setRollbackSecondsLeft(Math.max(0, remaining));

    rollbackTimerRef.current = setInterval(() => {
      const el = Date.now() - pendingUfw.startedAt;
      const rem = Math.ceil((pendingUfw.confirmDeadlineMs - el) / 1000);
      setRollbackSecondsLeft(Math.max(0, rem));
      if (rem <= 0) {
        if (rollbackTimerRef.current) clearInterval(rollbackTimerRef.current);
        setPendingUfw(null);
        loadUfwData();
        showUfwMsg("Change was auto-rolled back (timeout)", "error");
      }
    }, 1000);

    return () => { if (rollbackTimerRef.current) clearInterval(rollbackTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUfw]);

  function showUfwMsg(msg: string, type: "success" | "error" = "success") {
    setUfwMsg(msg);
    setUfwMsgType(type);
    setTimeout(() => setUfwMsg(""), 4000);
  }

  async function ufwPost(body: Record<string, unknown>): Promise<{ success: boolean; pendingConfirmation?: boolean; changeId?: string; confirmDeadlineMs?: number; error?: string }> {
    const res = await fetch(apiUrl("/api/security/ufw"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<{ success: boolean; pendingConfirmation?: boolean; changeId?: string; confirmDeadlineMs?: number; error?: string }>;
  }

  async function handleUfwToggle(enable: boolean) {
    setUfwRuleLoading(true);
    try {
      const result = await ufwPost({ action: enable ? "enable" : "disable" });
      if (!result.success) { showUfwMsg(result.error ?? "Failed", "error"); return; }
      if (result.pendingConfirmation && result.changeId) {
        setPendingUfw({ changeId: result.changeId, confirmDeadlineMs: result.confirmDeadlineMs ?? 60_000, startedAt: Date.now() });
      }
      showUfwMsg(enable ? "UFW enabled" : "UFW disabled — confirm access within 60s");
      loadUfwData();
    } catch { showUfwMsg("Request failed", "error"); }
    finally { setUfwRuleLoading(false); }
  }

  async function handleAddRule() {
    if (!ufwNewPort.trim()) { showUfwMsg("Port is required", "error"); return; }
    setUfwRuleLoading(true);
    try {
      const result = await ufwPost({
        action: "add_rule",
        rule: {
          action: ufwNewAction,
          port: ufwNewPort.trim(),
          protocol: ufwNewProto,
          from: ufwFromAnywhere ? undefined : ufwNewFrom.trim() || undefined,
        },
      });
      if (!result.success) { showUfwMsg(result.error ?? "Failed", "error"); return; }
      if (result.pendingConfirmation && result.changeId) {
        setPendingUfw({ changeId: result.changeId, confirmDeadlineMs: result.confirmDeadlineMs ?? 60_000, startedAt: Date.now() });
        showUfwMsg("Rule added — confirm access within 60s");
      } else {
        showUfwMsg("Rule added");
      }
      setUfwNewPort("");
      setUfwNewFrom("");
      setUfwFromAnywhere(true);
      loadUfwData();
    } catch { showUfwMsg("Request failed", "error"); }
    finally { setUfwRuleLoading(false); }
  }

  async function handleDeleteRule(rule: UfwRule) {
    setConfirmDeleteRule(null);
    setUfwRuleLoading(true);
    try {
      const result = await ufwPost({ action: "delete_rule", ruleNumber: rule.number });
      if (!result.success) { showUfwMsg(result.error ?? "Failed", "error"); return; }
      if (result.pendingConfirmation && result.changeId) {
        setPendingUfw({ changeId: result.changeId, confirmDeadlineMs: result.confirmDeadlineMs ?? 60_000, startedAt: Date.now() });
        showUfwMsg("Rule deleted — confirm access within 60s");
      } else {
        showUfwMsg("Rule deleted");
      }
      loadUfwData();
    } catch { showUfwMsg("Request failed", "error"); }
    finally { setUfwRuleLoading(false); }
  }

  async function handleConfirmChange() {
    if (!pendingUfw) return;
    try {
      const result = await ufwPost({ action: "confirm_change", changeId: pendingUfw.changeId });
      if (!result.success) { showUfwMsg(result.error ?? "Confirm failed", "error"); return; }
      setPendingUfw(null);
      showUfwMsg("Changes confirmed and locked in");
    } catch { showUfwMsg("Confirm failed", "error"); }
  }

  async function handleRollback() {
    if (!pendingUfw) return;
    try {
      const result = await ufwPost({ action: "rollback", changeId: pendingUfw.changeId });
      if (!result.success) { showUfwMsg(result.error ?? "Rollback failed", "error"); return; }
      setPendingUfw(null);
      loadUfwData();
      showUfwMsg("Changes rolled back");
    } catch { showUfwMsg("Rollback failed", "error"); }
  }

  function ufwQuickPreset(action: "allow", port: string, proto: "tcp" | "udp" | "any") {
    setUfwNewAction(action);
    setUfwNewPort(port);
    setUfwNewProto(proto);
    setUfwFromAnywhere(true);
  }

  function isProtectedPort(rule: UfwRule, appPort: number | null): boolean {
    const portNum = parseInt(rule.to.split("/")[0], 10);
    return portNum === 22 || (appPort !== null && portNum === appPort);
  }

  // ── Sub-tab definitions ────────────────────────────────────────────────────

  const tabs: { key: SecuritySubTab; label: string; icon: React.ReactNode }[] = [
    { key: "guard_rails", label: "Guard Rails", icon: <Shield className="h-4 w-4" /> },
    { key: "ip_protection", label: "IP Protection", icon: <Wifi className="h-4 w-4" /> },
    { key: "sandbox", label: "Command Sandbox", icon: <Terminal className="h-4 w-4" /> },
    { key: "security_log", label: "Security Log", icon: <ScrollText className="h-4 w-4" /> },
    { key: "firewall" as const, label: "Firewall", icon: <Flame className="h-4 w-4" /> },
  ];

  // Filter + counts
  const filteredIPs = activeIPFilter === "all" ? blockedIPs : blockedIPs.filter((b) => b.source_type === activeIPFilter);
  const countBySource = {
    all: blockedIPs.length,
    app: blockedIPs.filter((b) => b.source_type === "app").length,
    manual: blockedIPs.filter((b) => b.source_type === "manual").length,
    fail2ban: blockedIPs.filter((b) => b.source_type === "fail2ban").length,
    api_abuse: blockedIPs.filter((b) => b.source_type === "api_abuse").length,
  };

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
        <div className="space-y-6">
          {ipLoading && !ipSettings ? (
            <p className="text-caption text-bot-muted">Loading…</p>
          ) : ipSettings ? (
            <>
              {/* Status message */}
              {ipMsg && (
                <div className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-caption",
                  ipMsgType === "success" ? "bg-bot-green/10 text-bot-green border border-bot-green/20" : "bg-bot-red/10 text-bot-red border border-bot-red/20"
                )}>
                  {ipMsgType === "success" ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                  {ipMsg}
                </div>
              )}

              {/* ── Login Protection ──────────────────────────────────────── */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-bot-accent" />
                  <h3 className="text-body font-semibold text-bot-text">Login Protection</h3>
                </div>
                <ToggleRow
                  label="IP Protection Enabled"
                  description="Track failed login attempts by IP and auto-block brute-force attackers"
                  checked={ipSettings.enabled}
                  onChange={(v) => {
                    setIpSettings((p) => p ? { ...p, enabled: v } : p);
                    saveIPSettings({ ip_protection_enabled: v });
                  }}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <LabeledInput
                    label="Max failed attempts"
                    type="number"
                    value={ipSettings.maxAttempts}
                    onChange={(v) => setIpSettings((p) => p ? { ...p, maxAttempts: parseInt(v) || 5 } : p)}
                    onBlur={(v) => saveIPSettings({ ip_max_attempts: parseInt(v) || 5 })}
                    min={1}
                    max={50}
                  />
                  <LabeledInput
                    label="Time window (minutes)"
                    type="number"
                    value={ipSettings.windowMinutes}
                    onChange={(v) => setIpSettings((p) => p ? { ...p, windowMinutes: parseInt(v) || 10 } : p)}
                    onBlur={(v) => saveIPSettings({ ip_window_minutes: parseInt(v) || 10 })}
                    min={1}
                    max={1440}
                  />
                  <LabeledInput
                    label="Block duration (minutes)"
                    type="number"
                    value={ipSettings.blockDurationMinutes}
                    onChange={(v) => setIpSettings((p) => p ? { ...p, blockDurationMinutes: parseInt(v) || 60 } : p)}
                    onBlur={(v) => saveIPSettings({ ip_block_duration_minutes: parseInt(v) || 60 })}
                    min={1}
                    max={43200}
                  />
                </div>
              </section>

              {/* ── API Abuse Protection ───────────────────────────────────── */}
              {apiAbuseSettings && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-bot-accent" />
                    <h3 className="text-body font-semibold text-bot-text">API Abuse Protection</h3>
                  </div>
                  <ToggleRow
                    label="API Abuse Detection"
                    description="Auto-block IPs that send excessive API requests — guards against scanning and scraping"
                    checked={apiAbuseSettings.enabled}
                    onChange={(v) => {
                      setApiAbuseSettings((p) => p ? { ...p, enabled: v } : p);
                      saveIPSettings({ api_abuse_protection_enabled: v });
                    }}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <LabeledInput
                      label="Max requests per window"
                      type="number"
                      value={apiAbuseSettings.maxRequests}
                      onChange={(v) => setApiAbuseSettings((p) => p ? { ...p, maxRequests: parseInt(v) || 200 } : p)}
                      onBlur={(v) => saveIPSettings({ api_abuse_max_requests: parseInt(v) || 200 })}
                      min={10}
                      max={10000}
                    />
                    <LabeledInput
                      label="Window (seconds)"
                      type="number"
                      value={apiAbuseSettings.windowSeconds}
                      onChange={(v) => setApiAbuseSettings((p) => p ? { ...p, windowSeconds: parseInt(v) || 60 } : p)}
                      onBlur={(v) => saveIPSettings({ api_abuse_window_seconds: parseInt(v) || 60 })}
                      min={10}
                      max={3600}
                    />
                    <LabeledInput
                      label="Block duration (minutes)"
                      type="number"
                      value={apiAbuseSettings.blockMinutes}
                      onChange={(v) => setApiAbuseSettings((p) => p ? { ...p, blockMinutes: parseInt(v) || 30 } : p)}
                      onBlur={(v) => saveIPSettings({ api_abuse_block_minutes: parseInt(v) || 30 })}
                      min={1}
                      max={10080}
                    />
                  </div>
                </section>
              )}

              {/* ── Fail2Ban Integration ───────────────────────────────────── */}
              {fail2banSettings && fail2banStatus && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-bot-accent" />
                    <h3 className="text-body font-semibold text-bot-text">Fail2Ban Integration</h3>
                  </div>

                  {/* Fail2Ban status indicator */}
                  <Fail2BanStatusCard status={fail2banStatus} />

                  <ToggleRow
                    label="Enable fail2ban Sync"
                    description="Bidirectional sync: bans in this app propagate to fail2ban, and fail2ban bans appear here"
                    checked={fail2banSettings.enabled}
                    onChange={(v) => {
                      setFail2BanSettings((p) => p ? { ...p, enabled: v } : p);
                      saveIPSettings({ fail2ban_enabled: v });
                    }}
                    disabled={!fail2banStatus.available}
                  />

                  {fail2banSettings.enabled && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-caption text-bot-muted mb-1">Jail name</label>
                        <input
                          value={fail2banSettings.jail}
                          onChange={(e) => setFail2BanSettings((p) => p ? { ...p, jail: e.target.value } : p)}
                          onBlur={(e) => saveIPSettings({ fail2ban_jail: e.target.value })}
                          placeholder="octoby-auth"
                          className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-caption font-mono text-bot-text outline-none focus:border-bot-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-caption text-bot-muted mb-1">Auto-sync interval (seconds)</label>
                        <input
                          type="number"
                          value={fail2banSettings.syncIntervalSeconds}
                          min={10}
                          max={3600}
                          onChange={(e) => setFail2BanSettings((p) => p ? { ...p, syncIntervalSeconds: parseInt(e.target.value) || 30 } : p)}
                          onBlur={(e) => saveIPSettings({ fail2ban_sync_interval_seconds: parseInt(e.target.value) || 30 })}
                          className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent"
                        />
                      </div>
                    </div>
                  )}

                  {fail2banSettings.enabled && (
                    <button
                      onClick={triggerFail2BanSync}
                      disabled={syncing || !fail2banStatus.available || !fail2banStatus.running}
                      className="flex items-center gap-2 rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-caption text-bot-text hover:bg-bot-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                      {syncing ? "Syncing…" : "Sync now"}
                    </button>
                  )}
                </section>
              )}

              {/* ── Blocked IPs ────────────────────────────────────────────── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-bot-accent" />
                    <h3 className="text-body font-semibold text-bot-text">
                      Blocked IPs
                      {blockedIPs.length > 0 && (
                        <span className="ml-2 rounded-full bg-bot-red/20 text-bot-red px-2 py-0.5 text-caption font-normal">
                          {blockedIPs.length}
                        </span>
                      )}
                    </h3>
                  </div>
                  <button onClick={loadIPData} disabled={ipLoading} className="text-caption text-bot-muted hover:text-bot-text flex items-center gap-1 transition-colors">
                    <RefreshCw className={cn("h-3 w-3", ipLoading && "animate-spin")} /> Refresh
                  </button>
                </div>

                {/* Source filter tabs */}
                {blockedIPs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(["all", "app", "manual", "api_abuse", "fail2ban"] as const).map((f) => {
                      const count = countBySource[f];
                      if (f !== "all" && count === 0) return null;
                      return (
                        <button
                          key={f}
                          onClick={() => setActiveIPFilter(f)}
                          className={cn(
                            "flex items-center gap-1 rounded-full px-2.5 py-1 text-caption font-medium transition-colors",
                            activeIPFilter === f
                              ? sourceFilterActiveStyle(f)
                              : "bg-bot-elevated border border-bot-border text-bot-muted hover:text-bot-text"
                          )}
                        >
                          {f === "all" ? "All" : <SourceBadgeInline type={f} />}
                          <span className="ml-0.5 opacity-70">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {filteredIPs.length === 0 ? (
                  <p className="text-caption text-bot-muted py-3">
                    {blockedIPs.length === 0 ? "No blocked IPs." : `No IPs in the "${activeIPFilter}" category.`}
                  </p>
                ) : (
                  <div className="rounded-xl border border-bot-border overflow-hidden">
                    <div className="divide-y divide-bot-border">
                      {filteredIPs.map((b) => (
                        <BlockedIPRow
                          key={b.id}
                          entry={b}
                          expanded={expandedIP === b.id}
                          onToggle={() => setExpandedIP(expandedIP === b.id ? null : b.id)}
                          onUnblock={() => unblockIPAction(b.ip_address)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* ── Manual Block ───────────────────────────────────────────── */}
              <section className="space-y-3 rounded-xl border border-bot-border bg-bot-elevated p-4">
                <h3 className="text-body font-semibold text-bot-text flex items-center gap-2">
                  <Lock className="h-4 w-4 text-bot-accent" /> Manual Block
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
                  className="rounded-lg bg-bot-red px-4 py-2 text-caption font-medium text-white hover:bg-bot-red/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {blockingIP ? "Blocking…" : "Block IP"}
                </button>
              </section>
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
                    <React.Fragment key={e.id}>
                      <tr
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
                    </React.Fragment>
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

      {/* ── Firewall (UFW) ────────────────────────────────────────────────── */}
      {activeTab === "firewall" && (
        <div className="space-y-4">
          {/* Rollback confirmation modal */}
          {pendingUfw && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-2xl border border-bot-border bg-bot-surface p-6 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="rounded-full bg-bot-amber/15 p-2">
                    <AlertTriangle className="h-5 w-5 text-bot-amber" />
                  </div>
                  <div>
                    <h3 className="text-body font-semibold text-bot-text">Confirm Access</h3>
                    <p className="text-caption text-bot-muted">Verify you still have access to this panel</p>
                  </div>
                </div>
                <p className="text-caption text-bot-muted mb-5">
                  A firewall change was applied. If you can still see this, confirm the change to make it permanent. Otherwise it will be automatically reverted.
                </p>
                <div className="flex items-center justify-center mb-6">
                  <div className="relative h-20 w-20">
                    <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6" className="text-bot-border" />
                      <circle
                        cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6"
                        className="text-bot-amber transition-all duration-1000"
                        strokeDasharray={`${2 * Math.PI * 34}`}
                        strokeDashoffset={`${2 * Math.PI * 34 * (1 - rollbackSecondsLeft / 60)}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-subtitle font-bold text-bot-text">
                      {rollbackSecondsLeft}
                    </span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleConfirmChange}
                    className="flex-1 rounded-lg bg-bot-green px-4 py-2.5 text-caption font-semibold text-white hover:bg-bot-green/80 transition-colors"
                  >
                    <CheckCircle className="inline h-4 w-4 mr-1.5" />
                    I still have access — Keep Changes
                  </button>
                  <button
                    onClick={handleRollback}
                    className="flex-1 rounded-lg bg-bot-red px-4 py-2.5 text-caption font-semibold text-white hover:bg-bot-red/80 transition-colors"
                  >
                    <X className="inline h-4 w-4 mr-1.5" />
                    Undo Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete confirmation modal */}
          {confirmDeleteRule && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="w-full max-w-sm rounded-2xl border border-bot-border bg-bot-surface p-6 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="rounded-full bg-bot-red/15 p-2">
                    <Trash2 className="h-5 w-5 text-bot-red" />
                  </div>
                  <h3 className="text-body font-semibold text-bot-text">Delete Rule</h3>
                </div>
                <p className="text-caption text-bot-muted mb-2">Delete rule #{confirmDeleteRule.number}?</p>
                <code className="block rounded-lg bg-bot-elevated px-3 py-2 text-caption font-mono text-bot-text mb-5">
                  {confirmDeleteRule.action.toUpperCase()} {confirmDeleteRule.to} from {confirmDeleteRule.from}
                </code>
                {(confirmDeleteRule.to.startsWith("22") || (ufwData?.appPort && confirmDeleteRule.to.startsWith(String(ufwData.appPort)))) && (
                  <div className="mb-4 rounded-lg border border-bot-amber/30 bg-bot-amber/10 px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-bot-amber mt-0.5 shrink-0" />
                    <p className="text-caption text-bot-amber">This is a protected port. Deleting this rule may block access to SSH or this admin panel.</p>
                  </div>
                )}
                <p className="text-caption text-bot-muted mb-4">You will have 60 seconds to confirm you still have access before the change auto-reverts.</p>
                <div className="flex gap-3">
                  <button onClick={() => setConfirmDeleteRule(null)} className="flex-1 rounded-lg border border-bot-border px-4 py-2 text-caption text-bot-muted hover:text-bot-text transition-colors">
                    Cancel
                  </button>
                  <button onClick={() => handleDeleteRule(confirmDeleteRule)} className="flex-1 rounded-lg bg-bot-red px-4 py-2 text-caption font-semibold text-white hover:bg-bot-red/80 transition-colors">
                    Delete Rule
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <h3 className="text-body font-medium text-bot-text">UFW Firewall</h3>
            <button onClick={loadUfwData} disabled={ufwLoading} className="text-caption text-bot-muted hover:text-bot-text flex items-center gap-1 disabled:opacity-50">
              <RefreshCw className={cn("h-3 w-3", ufwLoading && "animate-spin")} /> Refresh
            </button>
          </div>

          {ufwMsg && (
            <div className={cn("rounded-lg border px-3 py-2 text-caption flex items-center gap-2",
              ufwMsgType === "success" ? "border-bot-green/30 bg-bot-green/10 text-bot-green" : "border-bot-red/30 bg-bot-red/10 text-bot-red"
            )}>
              {ufwMsgType === "success" ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {ufwMsg}
            </div>
          )}

          {ufwLoading && !ufwData && (
            <p className="text-caption text-bot-muted">Loading firewall status…</p>
          )}

          {ufwData && !ufwData.available && (
            <div className="rounded-lg border border-bot-amber/30 bg-bot-amber/10 px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-bot-amber mt-0.5 shrink-0" />
              <div>
                <p className="text-caption font-medium text-bot-amber">UFW not available</p>
                <p className="text-caption text-bot-muted mt-0.5">{ufwData.error ?? "ufw binary not found. Install with: sudo apt install ufw"}</p>
              </div>
            </div>
          )}

          {ufwData?.available && ufwData.status && (
            <>
              {/* Status Banner */}
              <div className="rounded-lg border border-bot-border bg-bot-elevated p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CircleDot className={cn("h-4 w-4", ufwData.status.active ? "text-bot-green" : "text-bot-muted")} />
                    <span className="text-caption font-semibold text-bot-text">
                      UFW is {ufwData.status.active ? "active" : "inactive"}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-caption font-medium",
                      ufwData.status.active ? "bg-bot-green/15 text-bot-green" : "bg-bot-muted/15 text-bot-muted"
                    )}>
                      {ufwData.status.active ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <button
                    onClick={() => handleUfwToggle(!ufwData.status!.active)}
                    disabled={ufwRuleLoading}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-caption font-medium transition-colors disabled:opacity-50",
                      ufwData.status.active
                        ? "bg-bot-red/15 text-bot-red hover:bg-bot-red/25"
                        : "bg-bot-green/15 text-bot-green hover:bg-bot-green/25"
                    )}
                  >
                    {ufwData.status.active ? "Disable" : "Enable"}
                  </button>
                </div>

                {/* Default policies */}
                <div className="flex gap-4 text-caption">
                  <div>
                    <span className="text-bot-muted">Incoming: </span>
                    <span className={cn("font-medium", ufwData.status.defaultPolicies.incoming === "deny" ? "text-bot-red" : "text-bot-green")}>
                      {ufwData.status.defaultPolicies.incoming}
                    </span>
                  </div>
                  <div>
                    <span className="text-bot-muted">Outgoing: </span>
                    <span className={cn("font-medium", ufwData.status.defaultPolicies.outgoing === "allow" ? "text-bot-green" : "text-bot-red")}>
                      {ufwData.status.defaultPolicies.outgoing}
                    </span>
                  </div>
                  <div>
                    <span className="text-bot-muted">Logging: </span>
                    <span className="font-medium text-bot-text">{ufwData.status.logging}</span>
                  </div>
                </div>

                {/* Protected port info */}
                {(ufwData.appPort || ufwData.sshPort) && (
                  <div className="flex items-start gap-2 rounded-lg bg-bot-surface/50 px-3 py-2 border border-bot-border/50">
                    <Info className="h-3.5 w-3.5 text-bot-muted mt-0.5 shrink-0" />
                    <p className="text-caption text-bot-muted">
                      Protected ports:{" "}
                      <span className="text-bot-text font-medium">SSH (22)</span>
                      {ufwData.appPort && ufwData.appPort !== 22 && (
                        <>, <span className="text-bot-text font-medium">App ({ufwData.appPort})</span></>
                      )}
                      {" "}— rules on these ports will show a warning before deletion.
                    </p>
                  </div>
                )}
              </div>

              {/* Quick Presets */}
              <div>
                <p className="text-caption text-bot-muted mb-2">Quick presets</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "SSH (22)", port: "22", proto: "tcp" as const },
                    { label: "HTTP (80)", port: "80", proto: "tcp" as const },
                    { label: "HTTPS (443)", port: "443", proto: "tcp" as const },
                    ...(ufwData.appPort && ufwData.appPort !== 80 && ufwData.appPort !== 443
                      ? [{ label: `App (${ufwData.appPort})`, port: String(ufwData.appPort), proto: "tcp" as const }]
                      : []),
                  ].map((preset) => (
                    <button
                      key={preset.port}
                      onClick={() => ufwQuickPreset("allow", preset.port, preset.proto)}
                      className="rounded-lg border border-bot-border bg-bot-elevated px-3 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:border-bot-accent transition-colors"
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Add Rule Form */}
              <div className="rounded-lg border border-bot-border bg-bot-elevated p-4 space-y-3">
                <h4 className="text-caption font-semibold text-bot-text">Add Rule</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Action */}
                  <div>
                    <label className="block text-caption text-bot-muted mb-1.5">Action</label>
                    <div className="flex gap-1">
                      {(["allow", "deny", "limit"] as const).map((a) => (
                        <button
                          key={a}
                          onClick={() => setUfwNewAction(a)}
                          className={cn(
                            "flex-1 rounded-lg border px-2 py-1.5 text-caption font-medium capitalize transition-colors",
                            ufwNewAction === a
                              ? a === "allow" ? "border-bot-green bg-bot-green/15 text-bot-green" : a === "deny" ? "border-bot-red bg-bot-red/15 text-bot-red" : "border-bot-amber bg-bot-amber/15 text-bot-amber"
                              : "border-bot-border bg-bot-surface text-bot-muted hover:text-bot-text"
                          )}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Protocol */}
                  <div>
                    <label className="block text-caption text-bot-muted mb-1.5">Protocol</label>
                    <div className="flex gap-1">
                      {(["tcp", "udp", "any"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setUfwNewProto(p)}
                          className={cn(
                            "flex-1 rounded-lg border px-2 py-1.5 text-caption font-medium uppercase transition-colors",
                            ufwNewProto === p
                              ? "border-bot-accent bg-bot-accent/15 text-bot-accent"
                              : "border-bot-border bg-bot-surface text-bot-muted hover:text-bot-text"
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Port */}
                  <div>
                    <label className="block text-caption text-bot-muted mb-1">Port / Range</label>
                    <input
                      type="text"
                      placeholder="e.g. 8080 or 6000:6100"
                      value={ufwNewPort}
                      onChange={(e) => setUfwNewPort(e.target.value)}
                      className="w-full rounded-lg border border-bot-border bg-bot-surface px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent font-mono"
                    />
                  </div>

                  {/* From */}
                  <div>
                    <label className="block text-caption text-bot-muted mb-1">From</label>
                    <div className="flex items-center gap-2 mb-1.5">
                      <button
                        role="switch"
                        aria-checked={ufwFromAnywhere}
                        onClick={() => setUfwFromAnywhere((v) => !v)}
                        className={cn(
                          "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors",
                          ufwFromAnywhere ? "bg-bot-accent" : "bg-bot-border"
                        )}
                      >
                        <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform", ufwFromAnywhere ? "translate-x-4" : "translate-x-0")} />
                      </button>
                      <span className="text-caption text-bot-muted">Anywhere</span>
                    </div>
                    {!ufwFromAnywhere && (
                      <input
                        type="text"
                        placeholder="e.g. 192.168.1.0/24"
                        value={ufwNewFrom}
                        onChange={(e) => setUfwNewFrom(e.target.value)}
                        className="w-full rounded-lg border border-bot-border bg-bot-surface px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent font-mono"
                      />
                    )}
                  </div>
                </div>

                <button
                  onClick={handleAddRule}
                  disabled={ufwRuleLoading || !ufwNewPort.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-bot-accent px-4 py-2 text-caption font-semibold text-white hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Rule
                </button>
              </div>

              {/* Rules Table */}
              <div>
                <h4 className="text-caption font-semibold text-bot-text mb-2">
                  Current Rules
                  <span className="ml-2 text-bot-muted font-normal">({ufwData.status.rules.length})</span>
                </h4>
                {ufwData.status.rules.length === 0 ? (
                  <p className="text-caption text-bot-muted py-2">No rules configured.</p>
                ) : (
                  <div className="rounded-lg border border-bot-border overflow-hidden">
                    <table className="w-full text-caption">
                      <thead className="bg-bot-surface border-b border-bot-border">
                        <tr>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium w-8">#</th>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium">To</th>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium">Action</th>
                          <th className="text-left px-3 py-2 text-bot-muted font-medium">From</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-bot-border">
                        {ufwData.status.rules.map((rule) => {
                          const protected_ = isProtectedPort(rule, ufwData.appPort);
                          return (
                            <tr key={rule.number} className="bg-bot-elevated hover:bg-bot-surface transition-colors">
                              <td className="px-3 py-2 font-mono text-bot-muted">{rule.number}</td>
                              <td className="px-3 py-2 font-mono text-bot-text">
                                <span className="flex items-center gap-1">
                                  {rule.to}
                                  {protected_ && (
                                    <span title="Protected port — deleting may block access" className="text-bot-amber">
                                      <AlertTriangle className="h-3 w-3" />
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={cn("rounded-full px-2 py-0.5 text-caption font-medium",
                                  rule.action === "allow" ? "bg-bot-green/15 text-bot-green" :
                                  rule.action === "deny" || rule.action === "reject" ? "bg-bot-red/15 text-bot-red" :
                                  "bg-bot-amber/15 text-bot-amber"
                                )}>
                                  {rule.action.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono text-bot-muted">{rule.from}</td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => setConfirmDeleteRule(rule)}
                                  disabled={ufwRuleLoading}
                                  className="text-bot-muted hover:text-bot-red transition-colors disabled:opacity-50"
                                  title="Delete rule"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Source badge helpers ──────────────────────────────────────────────────────

function sourceFilterActiveStyle(type: string): string {
  switch (type) {
    case "app":      return "bg-bot-amber/15 border border-bot-amber/30 text-bot-amber";
    case "manual":   return "bg-bot-blue/15 border border-bot-blue/30 text-bot-blue";
    case "fail2ban": return "bg-bot-purple/15 border border-bot-purple/30 text-bot-purple";
    case "api_abuse":return "bg-bot-red/15 border border-bot-red/30 text-bot-red";
    default:         return "bg-bot-elevated border border-bot-accent text-bot-accent";
  }
}

function SourceBadgeInline({ type }: { type: BlockedIP["source_type"] }) {
  const configs: Record<BlockedIP["source_type"], { label: string; icon: React.ReactNode; cls: string }> = {
    app:      { label: "Auto",     icon: <Bot className="h-3 w-3" />,          cls: "text-bot-amber" },
    manual:   { label: "Manual",   icon: <User className="h-3 w-3" />,         cls: "text-bot-blue" },
    fail2ban: { label: "fail2ban", icon: <Zap className="h-3 w-3" />,          cls: "text-bot-purple" },
    api_abuse:{ label: "API Abuse",icon: <Activity className="h-3 w-3" />,     cls: "text-bot-red" },
  };
  const c = configs[type];
  return (
    <span className={cn("flex items-center gap-1", c.cls)}>
      {c.icon}
      {c.label}
    </span>
  );
}

function SourceBadge({ type }: { type: BlockedIP["source_type"] }) {
  const configs: Record<BlockedIP["source_type"], { label: string; icon: React.ReactNode; cls: string }> = {
    app:      { label: "Auto",      icon: <Bot className="h-3 w-3" />,      cls: "bg-bot-amber/15 border-bot-amber/30 text-bot-amber" },
    manual:   { label: "Manual",    icon: <User className="h-3 w-3" />,     cls: "bg-bot-blue/15 border-bot-blue/30 text-bot-blue" },
    fail2ban: { label: "fail2ban",  icon: <Zap className="h-3 w-3" />,      cls: "bg-bot-purple/15 border-bot-purple/30 text-bot-purple" },
    api_abuse:{ label: "API Abuse", icon: <Activity className="h-3 w-3" />, cls: "bg-bot-red/15 border-bot-red/30 text-bot-red" },
  };
  const c = configs[type] ?? { label: type, icon: null, cls: "bg-bot-surface border-bot-border text-bot-muted" };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium", c.cls)}>
      {c.icon}
      {c.label}
    </span>
  );
}

// ── Blocked IP row ────────────────────────────────────────────────────────────

function BlockedIPRow({
  entry,
  expanded,
  onToggle,
  onUnblock,
}: {
  entry: BlockedIP;
  expanded: boolean;
  onToggle: () => void;
  onUnblock: () => void;
}) {
  return (
    <>
      <div
        className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-3 bg-bot-elevated hover:bg-bot-surface transition-colors cursor-pointer"
        onClick={onToggle}
      >
        {/* IP + reason */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-caption font-semibold text-bot-text">{entry.ip_address}</span>
            <SourceBadge type={entry.source_type} />
            <BlockTypeBadge type={entry.block_type} />
          </div>
          <p className="text-caption text-bot-muted mt-0.5 truncate">{entry.block_reason}</p>
        </div>

        {/* Blocked at */}
        <div className="hidden sm:block text-right">
          <p className="text-caption text-bot-muted whitespace-nowrap">{entry.blocked_at.slice(0, 16)}</p>
          {entry.unblock_at && (
            <p className="text-caption text-bot-muted/60 whitespace-nowrap">until {entry.unblock_at.slice(0, 16)}</p>
          )}
        </div>

        {/* Unblock button */}
        <button
          onClick={(e) => { e.stopPropagation(); onUnblock(); }}
          className="flex items-center gap-1 text-caption text-bot-green hover:text-bot-green/80 transition-colors whitespace-nowrap"
        >
          <Unlock className="h-3.5 w-3.5" /> Unblock
        </button>

        {/* Expand chevron */}
        <div className="text-bot-muted">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 bg-bot-surface border-t border-bot-border">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-caption">
            <DetailRow label="IP" value={entry.ip_address} mono />
            <DetailRow label="Source" value={<SourceBadge type={entry.source_type} />} />
            <DetailRow label="Block type" value={<BlockTypeBadge type={entry.block_type} />} />
            <DetailRow label="Blocked by" value={entry.blocked_by} />
            <DetailRow label="Blocked at" value={entry.blocked_at.slice(0, 19).replace("T", " ")} mono />
            {entry.unblock_at && <DetailRow label="Unblocks at" value={entry.unblock_at.slice(0, 19).replace("T", " ")} mono />}
            {entry.failed_attempt_count > 0 && <DetailRow label="Failed attempts" value={String(entry.failed_attempt_count)} />}
            <DetailRow label="Reason" value={entry.block_reason} />
          </div>
        </div>
      )}
    </>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-bot-muted shrink-0 w-28">{label}</span>
      <span className={cn("text-bot-text break-all", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function BlockTypeBadge({ type }: { type: "temporary" | "permanent" }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium",
      type === "permanent"
        ? "bg-bot-red/15 border-bot-red/30 text-bot-red"
        : "bg-bot-amber/15 border-bot-amber/30 text-bot-amber"
    )}>
      {type === "permanent" ? <AlertTriangle className="h-3 w-3 mr-1" /> : <CircleDot className="h-3 w-3 mr-1" />}
      {type}
    </span>
  );
}

// ── Fail2Ban status card ──────────────────────────────────────────────────────

function Fail2BanStatusCard({ status }: { status: Fail2BanStatus }) {
  const dot = status.available && status.running && status.jailExists
    ? "bg-bot-green"
    : status.available && status.running
    ? "bg-bot-amber"
    : "bg-bot-red";

  const label = status.available && status.running && status.jailExists
    ? "Active"
    : status.available && status.running
    ? "Running — jail missing"
    : status.available
    ? "Installed — not running"
    : "Not installed";

  return (
    <div className="flex items-start gap-3 rounded-lg border border-bot-border bg-bot-surface px-4 py-3">
      <div className={cn("mt-1 h-2 w-2 rounded-full flex-shrink-0", dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-caption font-medium text-bot-text">fail2ban {status.version ? `v${status.version}` : ""}</span>
          <span className={cn(
            "text-caption",
            dot === "bg-bot-green" ? "text-bot-green" : dot === "bg-bot-amber" ? "text-bot-amber" : "text-bot-red"
          )}>{label}</span>
        </div>
        <p className="text-caption text-bot-muted mt-0.5">
          Jail: <span className="font-mono">{status.jailName}</span>
          {status.jailExists && status.bannedIPs.length > 0 && (
            <> · {status.bannedIPs.length} IP{status.bannedIPs.length !== 1 ? "s" : ""} currently banned in jail</>
          )}
        </p>
        {status.error && (
          <p className="text-caption text-bot-amber mt-1">{status.error}</p>
        )}
      </div>
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

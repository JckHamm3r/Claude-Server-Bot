"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  X,
  Play,
  Square,
  RotateCcw,
  RefreshCcw,
  Power,
  PowerOff,
  Shield,
  ShieldOff,
  Loader2,
  RefreshCw,
  FileText,
  Terminal,
  BarChart2,
  AlertTriangle,
  Copy,
  Download,
  CheckCircle2,
  Info,
} from "lucide-react";import { cn, apiUrl } from "@/lib/utils";
import type { SystemdUnit } from "./system-service-manager-section";
import { statusLabel, statusDotColor, isOctobyManaged } from "./system-service-manager-section";
import { SparklineChart } from "./service-sparkline";
import type { ServiceDetailMetrics } from "./service-sparkline";

interface ServiceDetail {
  unit: string;
  type: string;
  isDanger: boolean;
  ActiveState?: string;
  SubState?: string;
  LoadState?: string;
  UnitFileState?: string;
  Description?: string;
  ExecStart?: string;
  FragmentPath?: string;
  MainPID?: string;
  MemoryCurrent?: string;
  CPUUsageNSec?: string;
  ActiveEnterTimestamp?: string;
  InactiveEnterTimestamp?: string;
  NRestarts?: string;
  Restart?: string;
  User?: string;
  WorkingDirectory?: string;
  Environment?: string;
  WantedBy?: string;
  After?: string;
  Requires?: string;
  PartOf?: string;
}

type DrawerTab = "overview" | "journal" | "unit-file" | "resources";

const DANGER_ACTIONS = new Set(["stop", "disable", "mask"]);

function formatMemory(bytes: string | undefined): string {
  const n = parseInt(bytes ?? "0", 10);
  if (!n || n < 0 || n === 18446744073709552000) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts || ts === "n/a" || ts === "") return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function formatCpuNs(ns: string | undefined): string {
  const n = parseInt(ns ?? "0", 10);
  if (!n || n <= 0) return "—";
  const ms = n / 1_000_000;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function ServiceDetailDrawer({
  unit,
  onClose,
  onAction,
  actionLoading,
}: {
  unit: SystemdUnit;
  onClose: () => void;
  onAction: (unit: SystemdUnit, action: string) => void;
  actionLoading: string | null;
  onUnitUpdated: (updated: Partial<SystemdUnit>) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("overview");
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [journal, setJournal] = useState<string>("");
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [unitFile, setUnitFile] = useState<string>("");
  const [loadingUnitFile, setLoadingUnitFile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const [autoScrollLog] = useState(true);
  const [logPriority, setLogPriority] = useState("");
  const [refreshingLog, setRefreshingLog] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true);
    try {
      const res = await fetch(apiUrl(`/api/system/services/${encodeURIComponent(unit.unit)}?type=${unit.type}`));
      if (res.ok) {
        const d = await res.json() as ServiceDetail;
        setDetail(d);
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [unit.unit, unit.type]);

  const loadJournal = useCallback(async () => {
    setLoadingJournal(true);
    try {
      const params = new URLSearchParams({ action: "journal", type: unit.type, lines: "500" });
      if (logPriority) params.set("priority", logPriority);
      const res = await fetch(apiUrl(`/api/system/services/${encodeURIComponent(unit.unit)}?${params}`));
      if (res.ok) {
        const d = await res.json() as { logs: string };
        setJournal(d.logs ?? "");
        if (autoScrollLog) {
          requestAnimationFrame(() => {
            if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
          });
        }
      }
    } finally {
      setLoadingJournal(false);
      setRefreshingLog(false);
    }
  }, [unit.unit, unit.type, logPriority, autoScrollLog]);

  const loadUnitFile = useCallback(async () => {
    setLoadingUnitFile(true);
    try {
      const res = await fetch(apiUrl(`/api/system/services/${encodeURIComponent(unit.unit)}?action=unit-file&type=${unit.type}`));
      if (res.ok) {
        const d = await res.json() as { content: string };
        setUnitFile(d.content ?? "");
      }
    } finally {
      setLoadingUnitFile(false);
    }
  }, [unit.unit, unit.type]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (tab === "journal" && !journal) {
      loadJournal();
    }
    if (tab === "unit-file" && !unitFile) {
      loadUnitFile();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Auto-refresh journal every 10s when on journal tab
  useEffect(() => {
    if (tab !== "journal") return;
    const t = setInterval(() => {
      setRefreshingLog(true);
      loadJournal();
    }, 10_000);
    return () => clearInterval(t);
  }, [tab, loadJournal]);

  const isRunning = unit.active === "active" && unit.sub === "running";
  const isFailed = unit.active === "failed";
  const label = statusLabel(unit.active, unit.sub);
  const dotColor = statusDotColor(unit.active, unit.sub);
  const octoby = isOctobyManaged(unit.unit);
  const isDanger = detail?.isDanger ?? false;
  const isEnabled = detail?.UnitFileState === "enabled" || detail?.UnitFileState === "enabled-runtime";
  const isMasked = detail?.UnitFileState === "masked";

  const handleAction = (action: string) => {
    if (DANGER_ACTIONS.has(action) && !confirmAction) {
      setConfirmAction(action);
      return;
    }
    setConfirmAction(null);
    onAction(unit, action);
    // Re-fetch detail after action
    setTimeout(() => loadDetail(), 2000);
  };

  const isActing = (action: string) => actionLoading === `${unit.unit}:${action}`;
  const anyActing = ["start", "stop", "restart", "reload", "enable", "disable", "mask", "unmask"].some(
    (a) => isActing(a),
  );

  const copyLogs = () => {
    navigator.clipboard.writeText(journal).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const downloadLogs = () => {
    const blob = new Blob([journal], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${unit.unit.replace(".service", "")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex" aria-modal="true">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="flex flex-col w-full max-w-2xl bg-bot-background border-l border-bot-border/40 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-bot-border/30 bg-bot-surface/60">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="relative flex h-2.5 w-2.5 shrink-0 mt-0.5">
                {isRunning && (
                  <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-40", dotColor)} />
                )}
                <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", dotColor)} />
              </span>
              <h3 className="text-body font-bold font-mono text-bot-text truncate">{unit.unit}</h3>
              {octoby && (
                <span className="shrink-0 rounded-full bg-bot-accent/10 border border-bot-accent/20 px-2 py-0.5 text-[10px] font-medium text-bot-accent">
                  Octoby Managed
                </span>
              )}
              {isDanger && (
                <span className="shrink-0 rounded-full bg-bot-red/10 border border-bot-red/20 px-2 py-0.5 text-[10px] font-medium text-bot-red flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Danger Zone
                </span>
              )}
              <span className={cn(
                "shrink-0 text-caption capitalize font-medium px-2 py-0.5 rounded-full",
                isFailed ? "bg-bot-red/10 text-bot-red" : isRunning ? "bg-bot-green/10 text-bot-green" : "bg-bot-muted/10 text-bot-muted",
              )}>
                {label}
              </span>
            </div>
            <p className="text-caption text-bot-muted mt-1 truncate">{detail?.Description ?? unit.description}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-bot-border/30 bg-bot-surface/40 flex-wrap">
          {isDanger && (
            <div className="flex items-center gap-1.5 text-caption text-bot-amber mr-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Critical system service</span>
            </div>
          )}

          {/* Confirm zone */}
          {confirmAction && (
            <div className="flex items-center gap-2 rounded-lg border border-bot-red/30 bg-bot-red/10 px-3 py-1.5 mr-2">
              <AlertTriangle className="h-3.5 w-3.5 text-bot-red shrink-0" />
              <span className="text-caption text-bot-red">Confirm {confirmAction}?</span>
              <button
                onClick={() => { setConfirmAction(null); handleAction(confirmAction); }}
                className="rounded-md bg-bot-red px-2 py-0.5 text-caption font-medium text-white hover:bg-bot-red/80 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmAction(null)}
                className="text-caption text-bot-muted hover:text-bot-text transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {!isRunning && (
              <ServiceActionBtn
                icon={<Play className="h-3.5 w-3.5" />}
                label="Start"
                loading={isActing("start")}
                disabled={anyActing}
                onClick={() => handleAction("start")}
                variant="green"
              />
            )}
            {isRunning && (
              <ServiceActionBtn
                icon={<Square className="h-3.5 w-3.5" />}
                label="Stop"
                loading={isActing("stop")}
                disabled={anyActing}
                onClick={() => handleAction("stop")}
                variant="danger"
              />
            )}
            <ServiceActionBtn
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="Restart"
              loading={isActing("restart")}
              disabled={anyActing}
              onClick={() => handleAction("restart")}
              variant="default"
            />
            {isRunning && (
              <ServiceActionBtn
                icon={<RefreshCcw className="h-3.5 w-3.5" />}
                label="Reload"
                loading={isActing("reload")}
                disabled={anyActing}
                onClick={() => handleAction("reload")}
                variant="default"
              />
            )}
          </div>

          <div className="h-4 w-px bg-bot-border/30" />

          <div className="flex items-center gap-1.5">
            {!isEnabled && !isMasked && (
              <ServiceActionBtn
                icon={<Power className="h-3.5 w-3.5" />}
                label="Enable"
                loading={isActing("enable")}
                disabled={anyActing}
                onClick={() => handleAction("enable")}
                variant="default"
              />
            )}
            {isEnabled && (
              <ServiceActionBtn
                icon={<PowerOff className="h-3.5 w-3.5" />}
                label="Disable"
                loading={isActing("disable")}
                disabled={anyActing}
                onClick={() => handleAction("disable")}
                variant="danger"
              />
            )}
            {!isMasked ? (
              <ServiceActionBtn
                icon={<Shield className="h-3.5 w-3.5" />}
                label="Mask"
                loading={isActing("mask")}
                disabled={anyActing}
                onClick={() => handleAction("mask")}
                variant="danger"
              />
            ) : (
              <ServiceActionBtn
                icon={<ShieldOff className="h-3.5 w-3.5" />}
                label="Unmask"
                loading={isActing("unmask")}
                disabled={anyActing}
                onClick={() => handleAction("unmask")}
                variant="default"
              />
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-bot-border/30 bg-bot-surface/30 px-5">
          {(["overview", "journal", "unit-file", "resources"] as DrawerTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-caption font-medium border-b-2 transition-colors capitalize",
                tab === t
                  ? "border-bot-accent text-bot-accent"
                  : "border-transparent text-bot-muted hover:text-bot-text",
              )}
            >
              {t === "overview" && <Info className="h-3.5 w-3.5" />}
              {t === "journal" && <Terminal className="h-3.5 w-3.5" />}
              {t === "unit-file" && <FileText className="h-3.5 w-3.5" />}
              {t === "resources" && <BarChart2 className="h-3.5 w-3.5" />}
              {t === "unit-file" ? "Unit File" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">

          {/* Overview */}
          {tab === "overview" && (
            <div className="p-5 space-y-4">
              {loadingDetail ? (
                <div className="flex items-center justify-center py-12 gap-2 text-bot-muted">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <>
                  <DetailGrid items={[
                    { label: "Unit", value: unit.unit },
                    { label: "Type", value: unit.type },
                    { label: "Load State", value: detail?.LoadState ?? "—" },
                    { label: "Active State", value: detail?.ActiveState ?? unit.active, highlight: isFailed ? "red" : isRunning ? "green" : undefined },
                    { label: "Sub State", value: detail?.SubState ?? unit.sub },
                    { label: "Startup", value: detail?.UnitFileState ?? "—" },
                    { label: "PID", value: detail?.MainPID && detail.MainPID !== "0" ? detail.MainPID : "—" },
                    { label: "Restart Policy", value: detail?.Restart ?? "—" },
                    { label: "Restart Count", value: detail?.NRestarts ?? "—" },
                    { label: "Run As", value: detail?.User ?? "root" },
                    { label: "Working Dir", value: detail?.WorkingDirectory ?? "—", mono: true },
                    { label: "Active Since", value: formatTimestamp(detail?.ActiveEnterTimestamp) },
                    { label: "Last Inactive", value: formatTimestamp(detail?.InactiveEnterTimestamp) },
                    { label: "Memory", value: formatMemory(detail?.MemoryCurrent) },
                    { label: "CPU Time", value: formatCpuNs(detail?.CPUUsageNSec) },
                    { label: "Fragment Path", value: detail?.FragmentPath ?? "—", mono: true },
                  ]} />

                  {detail?.ExecStart && (
                    <div className="rounded-lg border border-bot-border/30 bg-bot-elevated/40 p-4">
                      <p className="text-caption text-bot-muted mb-2">ExecStart</p>
                      <pre className="text-caption font-mono text-bot-text whitespace-pre-wrap break-all">{detail.ExecStart}</pre>
                    </div>
                  )}

                  {detail?.Environment && detail.Environment !== "" && (
                    <div className="rounded-lg border border-bot-border/30 bg-bot-elevated/40 p-4">
                      <p className="text-caption text-bot-muted mb-2">Environment</p>
                      <pre className="text-caption font-mono text-bot-text whitespace-pre-wrap break-all">{detail.Environment.split(" ").join("\n")}</pre>
                    </div>
                  )}

                  {(detail?.WantedBy || detail?.Requires || detail?.After || detail?.PartOf) && (
                    <div className="rounded-lg border border-bot-border/30 bg-bot-elevated/40 p-4 space-y-2">
                      <p className="text-caption text-bot-muted mb-2">Dependencies</p>
                      {detail?.WantedBy && <DepRow label="WantedBy" value={detail.WantedBy} />}
                      {detail?.Requires && <DepRow label="Requires" value={detail.Requires} />}
                      {detail?.After && <DepRow label="After" value={detail.After} />}
                      {detail?.PartOf && <DepRow label="PartOf" value={detail.PartOf} />}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Journal */}
          {tab === "journal" && (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bot-border/20 bg-bot-surface/30">
                <select
                  value={logPriority}
                  onChange={(e) => setLogPriority(e.target.value)}
                  className="rounded-md border border-bot-border/40 bg-bot-elevated px-2 py-1 text-caption text-bot-text outline-none focus:border-bot-accent"
                >
                  <option value="">All priorities</option>
                  <option value="emerg">Emergency</option>
                  <option value="alert">Alert</option>
                  <option value="crit">Critical</option>
                  <option value="err">Error</option>
                  <option value="warning">Warning</option>
                  <option value="notice">Notice</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>
                <button
                  onClick={() => { setRefreshingLog(true); loadJournal(); }}
                  disabled={loadingJournal}
                  className="flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshingLog && "animate-spin")} />
                  Refresh
                </button>
                <div className="flex items-center gap-1.5 ml-auto">
                  <button
                    onClick={copyLogs}
                    className="flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors"
                  >
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-bot-green" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={downloadLogs}
                    className="flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden relative">
                {loadingJournal && !journal ? (
                  <div className="flex items-center justify-center h-full gap-2 text-bot-muted">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  <pre
                    ref={logRef}
                    className="h-full overflow-y-auto p-4 text-[11px] font-mono leading-relaxed text-bot-text/90 bg-black/20 whitespace-pre-wrap break-all"
                  >
                    {journal || "No journal entries found."}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Unit file */}
          {tab === "unit-file" && (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bot-border/20 bg-bot-surface/30">
                <span className="text-caption text-bot-muted font-mono">{detail?.FragmentPath ?? unit.unit}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(unitFile)}
                  className="ml-auto flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {loadingUnitFile ? (
                  <div className="flex items-center justify-center h-full gap-2 text-bot-muted">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  <pre className="h-full overflow-y-auto p-4 text-[11px] font-mono leading-relaxed text-bot-text/90 bg-black/20 whitespace-pre-wrap">
                    {unitFile || "Unit file not found or not readable."}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Resources */}
          {tab === "resources" && (
            <div className="p-5">
              <SparklineChart unit={unit} detail={detail as ServiceDetailMetrics | null} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailGrid({ items }: { items: { label: string; value: string; mono?: boolean; highlight?: "red" | "green" }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-caption text-bot-muted">{item.label}</p>
          <p className={cn(
            "text-body mt-0.5 break-all",
            item.mono ? "font-mono text-caption" : "",
            item.highlight === "red" ? "text-bot-red font-medium" : item.highlight === "green" ? "text-bot-green font-medium" : "text-bot-text",
          )}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function DepRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-caption text-bot-muted w-20 shrink-0">{label}</span>
      <span className="text-caption font-mono text-bot-text/80 break-all">{value}</span>
    </div>
  );
}

function ServiceActionBtn({
  icon,
  label,
  loading,
  disabled,
  onClick,
  variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: "green" | "danger" | "default";
}) {
  return (
    <button
      title={label}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium transition-colors disabled:opacity-40",
        variant === "green" && "bg-bot-green/10 text-bot-green hover:bg-bot-green/20 border border-bot-green/20",
        variant === "danger" && "bg-bot-red/10 text-bot-red hover:bg-bot-red/20 border border-bot-red/20",
        variant === "default" && "bg-bot-elevated/60 text-bot-text hover:bg-bot-elevated border border-bot-border/30",
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  ArrowUpCircle,
  GitCommit,
  Tag,
  ExternalLink,
  Server,
  Database,
  Mail,
  Cpu,
  Clock,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";

interface ServiceStatus {
  status: "active" | "inactive" | "unknown";
  uptime: string | null;
  serviceName: string;
}

interface VersionInfo {
  currentCommit: string;
  currentTag: string | null;
  latestCommit: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  checkError: string | null;
  installedAt: string | null;
  repo: string;
}

interface ComponentHealth {
  database: boolean;
  apiKeyConfigured: boolean;
  sdkInstalled: boolean;
  socketServer: boolean;
}

type OpState = "idle" | "loading" | "success" | "error";

export function ServicesSection() {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [loadingService, setLoadingService] = useState(true);

  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(true);

  const [health, setHealth] = useState<ComponentHealth | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);

  const [restartState, setRestartState] = useState<OpState>("idle");
  const [restartMsg, setRestartMsg] = useState<string | null>(null);

  const [updateState, setUpdateState] = useState<OpState>("idle");
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);

  const loadService = useCallback(() => {
    setLoadingService(true);
    fetch(apiUrl("/api/system/service"))
      .then((r) => r.json())
      .then((d: ServiceStatus) => setServiceStatus(d))
      .catch(() => setServiceStatus(null))
      .finally(() => setLoadingService(false));
  }, []);

  const loadVersion = useCallback(() => {
    setLoadingVersion(true);
    fetch(apiUrl("/api/system/version"))
      .then((r) => r.json())
      .then((d: VersionInfo) => setVersionInfo(d))
      .catch(() => setVersionInfo(null))
      .finally(() => setLoadingVersion(false));
  }, []);

  const loadHealth = useCallback(() => {
    setLoadingHealth(true);
    fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then((d: ComponentHealth) => setHealth(d))
      .catch(() => setHealth(null))
      .finally(() => setLoadingHealth(false));
  }, []);

  useEffect(() => {
    loadService();
    loadVersion();
    loadHealth();

    // Check SMTP configured
    fetch(apiUrl("/api/settings/smtp"))
      .then((r) => r.json())
      .then((d: { host?: string; enabled?: boolean }) => setSmtpConfigured(!!(d.host && d.enabled)))
      .catch(() => setSmtpConfigured(false));
  }, [loadService, loadVersion, loadHealth]);

  const handleRestart = async () => {
    if (!confirm("Restart the service? There will be ~5 seconds of downtime.")) return;
    setRestartState("loading");
    setRestartMsg(null);
    try {
      const r = await fetch(apiUrl("/api/system/service"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const d = await r.json() as { ok: boolean; message: string };
      if (d.ok) {
        setRestartState("success");
        setRestartMsg(d.message);
        // Re-check status after a delay
        setTimeout(() => { loadService(); setRestartState("idle"); }, 6000);
      } else {
        setRestartState("error");
        setRestartMsg(d.message ?? "Restart failed");
      }
    } catch {
      setRestartState("error");
      setRestartMsg("Request failed");
    }
  };

  const handleUpdate = async () => {
    if (!confirm("Apply update? The server will rebuild and restart. This may take 1–3 minutes.")) return;
    setUpdateState("loading");
    setUpdateMsg(null);
    try {
      const r = await fetch(apiUrl("/api/system/service"), {
        method: "PATCH",
      });
      const d = await r.json() as { ok: boolean; message: string };
      if (d.ok) {
        setUpdateState("success");
        setUpdateMsg(d.message);
      } else {
        setUpdateState("error");
        setUpdateMsg(d.message ?? "Update failed to start");
      }
    } catch {
      setUpdateState("error");
      setUpdateMsg("Request failed");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="mb-2 text-subtitle font-bold text-bot-text">Services</h2>
      <p className="text-caption text-bot-muted -mt-4 mb-2">
        Monitor and manage the platform service components.
      </p>

      {/* ── Service Status ── */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-bot-accent" />
            <p className="text-body font-semibold text-bot-text">App Service</p>
          </div>
          <button
            onClick={loadService}
            disabled={loadingService}
            className="flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loadingService && "animate-spin")} />
            Refresh
          </button>
        </div>

        {loadingService ? (
          <div className="flex items-center gap-2 text-body text-bot-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking…
          </div>
        ) : serviceStatus ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <StatusDot active={serviceStatus.status === "active"} unknown={serviceStatus.status === "unknown"} />
              <span className="text-body text-bot-text capitalize">{serviceStatus.status}</span>
              <span className="text-caption text-bot-muted font-mono">{serviceStatus.serviceName}.service</span>
            </div>
            {serviceStatus.uptime && (
              <div className="flex items-center gap-2 text-caption text-bot-muted">
                <Clock className="h-3.5 w-3.5" />
                Started: {new Date(serviceStatus.uptime).toLocaleString()}
              </div>
            )}
            {serviceStatus.status === "unknown" && (
              <p className="text-caption text-bot-amber">
                systemd is not available on this system. The service may have been started manually.
              </p>
            )}
          </div>
        ) : (
          <p className="text-caption text-bot-muted">Unable to read service status.</p>
        )}

        {/* Restart button */}
        <div className="flex items-center gap-3 pt-1 border-t border-bot-border/30">
          <button
            onClick={handleRestart}
            disabled={restartState === "loading"}
            className="inline-flex items-center gap-2 rounded-lg bg-bot-elevated border border-bot-border/40 px-3 py-1.5 text-caption font-medium text-bot-text hover:bg-bot-elevated/70 disabled:opacity-50 transition-colors"
          >
            {restartState === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {restartState === "loading" ? "Restarting…" : "Restart Service"}
          </button>
          {restartMsg && (
            <span className={cn("text-caption", restartState === "error" ? "text-bot-red" : "text-bot-green")}>
              {restartMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── Version & Updates ── */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitCommit className="h-4 w-4 text-bot-accent" />
            <p className="text-body font-semibold text-bot-text">Version & Updates</p>
          </div>
          <button
            onClick={loadVersion}
            disabled={loadingVersion}
            className="flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loadingVersion && "animate-spin")} />
            Check
          </button>
        </div>

        {loadingVersion ? (
          <div className="flex items-center gap-2 text-body text-bot-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : versionInfo ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-caption">
              <VersionRow
                icon={<GitCommit className="h-3.5 w-3.5 text-bot-muted" />}
                label="Installed"
                value={versionInfo.currentTag ?? versionInfo.currentCommit}
              />
              {versionInfo.currentTag && (
                <VersionRow
                  icon={<Tag className="h-3.5 w-3.5 text-bot-muted" />}
                  label="Tag"
                  value={versionInfo.currentTag}
                />
              )}
              {versionInfo.installedAt && (
                <VersionRow
                  icon={<Clock className="h-3.5 w-3.5 text-bot-muted" />}
                  label="Commit date"
                  value={new Date(versionInfo.installedAt).toLocaleDateString()}
                />
              )}
              {versionInfo.latestCommit && (
                <VersionRow
                  icon={<Activity className="h-3.5 w-3.5 text-bot-muted" />}
                  label="Latest"
                  value={versionInfo.latestTag ?? versionInfo.latestCommit}
                />
              )}
            </div>

            {versionInfo.checkError && (
              <div className="flex items-center gap-2 text-caption text-bot-amber">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Could not reach GitHub: {versionInfo.checkError}
              </div>
            )}

            {versionInfo.updateAvailable && (
              <div className="flex items-center gap-2 rounded-md bg-bot-accent/10 border border-bot-accent/20 px-3 py-2 text-caption text-bot-accent">
                <ArrowUpCircle className="h-4 w-4 shrink-0" />
                A newer version is available on GitHub.
              </div>
            )}

            {!versionInfo.updateAvailable && !versionInfo.checkError && versionInfo.latestCommit && (
              <div className="flex items-center gap-2 text-caption text-bot-green">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Up to date
              </div>
            )}

            <div className="flex items-center gap-3 pt-1 border-t border-bot-border/30">
              <button
                onClick={handleUpdate}
                disabled={updateState === "loading"}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-caption font-medium transition-colors disabled:opacity-50",
                  versionInfo.updateAvailable
                    ? "bg-bot-accent text-white hover:bg-bot-accent/80"
                    : "bg-bot-elevated border border-bot-border/40 text-bot-text hover:bg-bot-elevated/70",
                )}
              >
                {updateState === "loading" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                )}
                {updateState === "loading" ? "Starting update…" : "Apply Update"}
              </button>

              <a
                href={versionInfo.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View on GitHub
              </a>
            </div>

            {updateMsg && (
              <p className={cn("text-caption", updateState === "error" ? "text-bot-red" : "text-bot-green")}>
                {updateMsg}
              </p>
            )}
          </div>
        ) : (
          <p className="text-caption text-bot-muted">Unable to load version information.</p>
        )}
      </div>

      {/* ── Component Health ── */}
      <div className="rounded-lg border border-bot-border bg-bot-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-bot-accent" />
            <p className="text-body font-semibold text-bot-text">Component Health</p>
          </div>
          <button
            onClick={loadHealth}
            disabled={loadingHealth}
            className="flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loadingHealth && "animate-spin")} />
            Refresh
          </button>
        </div>

        {loadingHealth ? (
          <div className="flex items-center gap-2 text-body text-bot-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking…
          </div>
        ) : (
          <div className="space-y-2.5">
            <ComponentRow
              icon={<Database className="h-4 w-4" />}
              label="Database"
              ok={health?.database ?? false}
              description="SQLite connected"
            />
            <ComponentRow
              icon={<Activity className="h-4 w-4" />}
              label="Claude SDK"
              ok={health?.sdkInstalled ?? false}
              description="@anthropic-ai/claude-agent-sdk"
            />
            <ComponentRow
              icon={<Activity className="h-4 w-4" />}
              label="Anthropic API Key"
              ok={health?.apiKeyConfigured ?? false}
              description="API key configured"
            />
            <ComponentRow
              icon={<Server className="h-4 w-4" />}
              label="Socket.IO Server"
              ok={health?.socketServer ?? false}
              description="Real-time socket layer"
            />
            <ComponentRow
              icon={<Mail className="h-4 w-4" />}
              label="Email (SMTP)"
              ok={smtpConfigured ?? false}
              description={smtpConfigured ? "Configured" : "Not configured"}
              optional
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ active, unknown }: { active: boolean; unknown?: boolean }) {
  if (unknown) {
    return (
      <span className="relative flex h-3 w-3">
        <span className="block h-3 w-3 rounded-full bg-bot-amber" />
      </span>
    );
  }
  return (
    <span className="relative flex h-3 w-3">
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bot-green opacity-40" />
      )}
      <span className={cn("relative inline-flex rounded-full h-3 w-3", active ? "bg-bot-green" : "bg-bot-red")} />
    </span>
  );
}

function VersionRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-bot-muted">{label}:</span>
      <span className="font-mono text-bot-text">{value}</span>
    </div>
  );
}

function ComponentRow({
  icon,
  label,
  ok,
  description,
  optional,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  description: string;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn("shrink-0", ok ? "text-bot-green" : optional ? "text-bot-muted" : "text-bot-red")}>
        {ok ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
      </div>
      <div className={cn("shrink-0 text-bot-muted", ok ? "text-bot-green/70" : optional ? "text-bot-muted" : "text-bot-red/70")}>
        {icon}
      </div>
      <div className="flex-1">
        <span className="text-body text-bot-text">{label}</span>
        <span className="ml-2 text-caption text-bot-muted">{description}</span>
      </div>
    </div>
  );
}

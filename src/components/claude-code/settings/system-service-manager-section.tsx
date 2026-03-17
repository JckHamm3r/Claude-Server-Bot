"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  RefreshCw,
  Loader2,
  ChevronRight,
  Play,
  Square,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Server,
  Filter,
  X,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { ServiceDetailDrawer } from "./service-detail-drawer";

export interface SystemdUnit {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
  type: "system" | "user";
}

type FilterStatus = "all" | "running" | "failed" | "inactive" | "other";
type FilterType = "all" | "system" | "user";

const OCTOBY_PREFIX = "octoby-";

function isOctobyManaged(unit: string): boolean {
  return unit === "claude-bot.service" || unit.startsWith(OCTOBY_PREFIX);
}

function statusColor(active: string, sub: string): string {
  if (active === "active" && sub === "running") return "bg-bot-green text-bot-green";
  if (active === "failed") return "bg-bot-red text-bot-red";
  if (active === "activating" || active === "deactivating") return "bg-bot-amber text-bot-amber";
  if (active === "active") return "bg-bot-green/70 text-bot-green";
  return "bg-bot-muted/40 text-bot-muted";
}

function statusDotColor(active: string, sub: string): string {
  if (active === "active" && sub === "running") return "bg-bot-green";
  if (active === "failed") return "bg-bot-red";
  if (active === "activating" || active === "deactivating") return "bg-bot-amber";
  if (active === "active") return "bg-bot-green/60";
  return "bg-bot-muted/40";
}

function statusLabel(active: string, sub: string): string {
  if (active === "active" && sub === "running") return "running";
  if (active === "active" && sub === "exited") return "exited";
  if (active === "active") return active;
  if (active === "failed") return "failed";
  if (active === "activating") return "starting";
  if (active === "deactivating") return "stopping";
  return sub || active || "inactive";
}

export function SystemServiceManagerSection() {
  const [units, setUnits] = useState<SystemdUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [selectedUnit, setSelectedUnit] = useState<SystemdUnit | null>(null);
  const [totalFailed, setTotalFailed] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadUnits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/system/services"));
      if (res.ok) {
        const data = await res.json() as { units: SystemdUnit[] };
        setUnits(data.units ?? []);
        const failed = (data.units ?? []).filter((u) => u.active === "failed").length;
        setTotalFailed(failed);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // Subscribe to real-time updates
  useEffect(() => {
    loadUnits();
    const socket = getSocket();
    socket.emit("system:subscribe_services");

    socket.on("system:service_status_changed", ({ changes }: { changes: { unit: string; active: string; sub: string }[] }) => {
      setUnits((prev) => {
        const updated = [...prev];
        for (const change of changes) {
          const idx = updated.findIndex((u) => u.unit === change.unit);
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], active: change.active, sub: change.sub };
          }
        }
        return updated;
      });
    });

    socket.on("system:services_summary", ({ totalFailed: tf }: { totalFailed: number }) => {
      setTotalFailed(tf);
    });

    return () => {
      socket.emit("system:unsubscribe_services");
      socket.off("system:service_status_changed");
      socket.off("system:services_summary");
    };
  }, [loadUnits]);

  const handleAction = useCallback(async (unit: SystemdUnit, action: string) => {
    const key = `${unit.unit}:${action}`;
    setActionLoading(key);
    try {
      await fetch(apiUrl(`/api/system/services/${encodeURIComponent(unit.unit)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, type: unit.type }),
      });
      // Re-fetch after a short delay for start/stop/restart
      if (["start", "stop", "restart"].includes(action)) {
        setTimeout(() => loadUnits(), 2500);
      } else {
        setTimeout(() => loadUnits(), 500);
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }, [loadUnits]);

  // Filtering
  const filtered = units.filter((u) => {
    if (filterType !== "all" && u.type !== filterType) return false;
    if (filterStatus === "running" && !(u.active === "active" && u.sub === "running")) return false;
    if (filterStatus === "failed" && u.active !== "failed") return false;
    if (filterStatus === "inactive" && u.active !== "inactive") return false;
    if (filterStatus === "other" && (u.active === "active" || u.active === "failed" || u.active === "inactive")) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!u.unit.toLowerCase().includes(q) && !u.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sort: Octoby-managed first, then running, then failed, then rest alphabetically
  const sorted = [...filtered].sort((a, b) => {
    const aOctoby = isOctobyManaged(a.unit) ? 0 : 1;
    const bOctoby = isOctobyManaged(b.unit) ? 0 : 1;
    if (aOctoby !== bOctoby) return aOctoby - bOctoby;
    const statusOrder = (u: SystemdUnit) => {
      if (u.active === "active" && u.sub === "running") return 0;
      if (u.active === "failed") return 1;
      if (u.active === "activating" || u.active === "deactivating") return 2;
      return 3;
    };
    const so = statusOrder(a) - statusOrder(b);
    if (so !== 0) return so;
    return a.unit.localeCompare(b.unit);
  });

  const counts = {
    running: units.filter((u) => u.active === "active" && u.sub === "running").length,
    failed: units.filter((u) => u.active === "failed").length,
    inactive: units.filter((u) => u.active === "inactive").length,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-subtitle font-bold text-bot-text">System Service Manager</h2>
          <p className="text-caption text-bot-muted mt-0.5">
            Manage systemd services on this host. Changes take effect immediately.
          </p>
        </div>
        <button
          onClick={loadUnits}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-bot-border/40 bg-bot-elevated/40 px-3 py-1.5 text-caption text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Failed alert banner */}
      {totalFailed > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-bot-red/30 bg-bot-red/8 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-bot-red shrink-0" />
          <p className="text-caption text-bot-red">
            <strong>{totalFailed}</strong> service{totalFailed !== 1 ? "s" : ""} in failed state
          </p>
          <button
            onClick={() => setFilterStatus("failed")}
            className="ml-auto text-caption text-bot-red/70 hover:text-bot-red transition-colors underline underline-offset-2"
          >
            Show only failed
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Running" value={counts.running} color="text-bot-green" icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Failed" value={counts.failed} color="text-bot-red" icon={<XCircle className="h-4 w-4" />} />
        <StatCard label="Total" value={units.length} color="text-bot-muted" icon={<Server className="h-4 w-4" />} />
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-bot-muted pointer-events-none" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or description…"
            className="w-full rounded-lg border border-bot-border/40 bg-bot-elevated/40 pl-9 pr-9 py-2 text-body text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-bot-muted hover:text-bot-text transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 rounded-lg border border-bot-border/40 bg-bot-elevated/40 p-1">
          {(["all", "running", "failed", "inactive"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={cn(
                "px-3 py-1 rounded-md text-caption font-medium transition-all capitalize",
                filterStatus === f
                  ? "bg-bot-accent text-white shadow-sm"
                  : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/60",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1 rounded-lg border border-bot-border/40 bg-bot-elevated/40 p-1">
          {(["all", "system", "user"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilterType(f)}
              className={cn(
                "px-3 py-1 rounded-md text-caption font-medium transition-all capitalize",
                filterType === f
                  ? "bg-bot-elevated text-bot-text shadow-sm"
                  : "text-bot-muted hover:text-bot-text",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Service List */}
      <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 overflow-hidden">
        {loading && units.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-bot-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-body">Loading services…</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-bot-muted">
            <Filter className="h-8 w-8 opacity-30" />
            <p className="text-body">No services match the current filters</p>
          </div>
        ) : (
          <div className="divide-y divide-bot-border/20">
            {sorted.map((unit) => (
              <ServiceRow
                key={`${unit.type}:${unit.unit}`}
                unit={unit}
                actionLoading={actionLoading}
                onSelect={() => setSelectedUnit(unit)}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>

      <p className="text-caption text-bot-muted/50 text-center">
        {sorted.length} of {units.length} services shown · Live updates via Socket.IO
      </p>

      {/* Detail Drawer */}
      {selectedUnit && (
        <ServiceDetailDrawer
          unit={selectedUnit}
          onClose={() => setSelectedUnit(null)}
          onAction={handleAction}
          actionLoading={actionLoading}
          onUnitUpdated={(updated) => {
            setUnits((prev) => prev.map((u) => u.unit === updated.unit && u.type === updated.type ? { ...u, ...updated } : u));
            setSelectedUnit((prev) => prev ? { ...prev, ...updated } : null);
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 p-4 flex items-center gap-3">
      <div className={cn("shrink-0", color)}>{icon}</div>
      <div>
        <p className={cn("text-xl font-bold leading-none", color)}>{value}</p>
        <p className="text-caption text-bot-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function ServiceRow({
  unit,
  actionLoading,
  onSelect,
  onAction,
}: {
  unit: SystemdUnit;
  actionLoading: string | null;
  onSelect: () => void;
  onAction: (unit: SystemdUnit, action: string) => void;
}) {
  const octoby = isOctobyManaged(unit.unit);
  const isRunning = unit.active === "active" && unit.sub === "running";
  const isFailed = unit.active === "failed";
  const isActivating = unit.active === "activating" || unit.active === "deactivating";
  const dotColor = statusDotColor(unit.active, unit.sub);
  const label = statusLabel(unit.active, unit.sub);

  const isActing = (action: string) => actionLoading === `${unit.unit}:${action}`;
  const anyActing = ["start", "stop", "restart", "reload"].some((a) => isActing(a));

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3 hover:bg-bot-elevated/30 transition-colors cursor-pointer",
        isFailed && "bg-bot-red/3",
      )}
      onClick={onSelect}
    >
      {/* Status dot */}
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {isRunning && (
          <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-40", dotColor)} />
        )}
        <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", dotColor)} />
      </span>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("text-body font-mono truncate", isFailed ? "text-bot-red" : "text-bot-text")}>
            {unit.unit}
          </span>
          {octoby && (
            <span className="shrink-0 rounded-full bg-bot-accent/10 border border-bot-accent/20 px-2 py-0.5 text-[10px] font-medium text-bot-accent">
              Octoby
            </span>
          )}
          <span className={cn("shrink-0 text-caption capitalize", isFailed ? "text-bot-red" : isActivating ? "text-bot-amber" : "text-bot-muted")}>
            {label}
          </span>
        </div>
        {unit.description && (
          <p className="text-caption text-bot-muted/70 truncate mt-0.5">{unit.description}</p>
        )}
      </div>

      {/* Type badge */}
      <span className="hidden sm:block shrink-0 text-caption text-bot-muted/50 font-mono">{unit.type}</span>

      {/* Quick action buttons */}
      <div
        className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {!isRunning && unit.active !== "activating" && (
          <ActionButton
            icon={<Play className="h-3.5 w-3.5" />}
            label="Start"
            loading={isActing("start")}
            disabled={anyActing}
            onClick={() => onAction(unit, "start")}
            variant="green"
          />
        )}
        {isRunning && (
          <ActionButton
            icon={<Square className="h-3.5 w-3.5" />}
            label="Stop"
            loading={isActing("stop")}
            disabled={anyActing}
            onClick={() => onAction(unit, "stop")}
            variant="red"
          />
        )}
        <ActionButton
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label="Restart"
          loading={isActing("restart")}
          disabled={anyActing}
          onClick={() => onAction(unit, "restart")}
          variant="default"
        />
      </div>

      <ChevronRight className="h-4 w-4 text-bot-muted/40 shrink-0 group-hover:text-bot-muted transition-colors" />
    </div>
  );
}

function ActionButton({
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
  variant?: "green" | "red" | "default";
}) {
  return (
    <button
      title={label}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 transition-colors disabled:opacity-40",
        variant === "green" && "text-bot-green hover:bg-bot-green/10",
        variant === "red" && "text-bot-red hover:bg-bot-red/10",
        variant === "default" && "text-bot-muted hover:text-bot-text hover:bg-bot-elevated",
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
    </button>
  );
}

// Re-export icons used in drawer too
export { statusLabel, statusDotColor, statusColor, isOctobyManaged, ActionButton };
export type { FilterStatus };

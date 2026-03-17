"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Package,
  Trash2,
  Download,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowUpCircle,
  Terminal,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";

interface PackageInfo {
  name: string;
  version: string;
  description: string;
  status: "installed" | "available";
  upgradable?: boolean;
}

interface SearchResult {
  name: string;
  version: string;
  description: string;
  installed: boolean;
}

type OpState = "idle" | "loading" | "success" | "error";

interface OpStatus {
  name: string;
  state: OpState;
  output: string;
}

export function PackagesSection() {
  const [packageManager, setPackageManager] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [installedSearch, setInstalledSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"installed" | "search">("installed");

  // Search-in-cache state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Operation output panels
  const [opStatus, setOpStatus] = useState<OpStatus | null>(null);
  const [expandedOutput, setExpandedOutput] = useState(false);

  // Confirm-before-uninstall
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);

  const loadInstalled = useCallback(
    (q?: string) => {
      setLoadingPackages(true);
      const query = q !== undefined ? q : installedSearch;
      fetch(apiUrl(`/api/packages?filter=installed&search=${encodeURIComponent(query)}`))
        .then((r) => r.json())
        .then(
          (d: {
            packages?: PackageInfo[];
            packageManager?: string;
            error?: string;
          }) => {
            if (d.error) {
              setPackages([]);
            } else {
              setPackages(d.packages ?? []);
              if (d.packageManager) setPackageManager(d.packageManager);
            }
          },
        )
        .catch(() => setPackages([]))
        .finally(() => setLoadingPackages(false));
    },
    [installedSearch],
  );

  useEffect(() => {
    loadInstalled();
  }, [loadInstalled]);

  // Debounce installed search
  const handleInstalledSearch = (val: string) => {
    setInstalledSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadInstalled(val), 400);
  };

  // Debounce available-package search
  const handleAvailableSearch = (val: string) => {
    setSearchQuery(val);
    setSearchError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (val.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      fetch(apiUrl(`/api/packages/search?q=${encodeURIComponent(val.trim())}`))
        .then((r) => r.json())
        .then(
          (d: {
            results?: SearchResult[];
            error?: string;
          }) => {
            if (d.error) {
              setSearchError(d.error);
              setSearchResults([]);
            } else {
              setSearchResults(d.results ?? []);
            }
          },
        )
        .catch(() => setSearchError("Search failed. Check network or package manager."))
        .finally(() => setSearching(false));
    }, 500);
  };

  const doInstall = async (name: string) => {
    setOpStatus({ name, state: "loading", output: "" });
    setExpandedOutput(false);
    try {
      const r = await fetch(apiUrl("/api/packages"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = (await r.json()) as { ok: boolean; output?: string };
      setOpStatus({ name, state: d.ok ? "success" : "error", output: d.output ?? "" });
      if (d.ok) {
        // Refresh installed list
        loadInstalled();
        // Update search results to mark as installed
        setSearchResults((prev) => prev.map((p) => (p.name === name ? { ...p, installed: true } : p)));
      }
    } catch (e) {
      setOpStatus({ name, state: "error", output: String(e) });
    }
  };

  const doUninstall = async (name: string, purge = false) => {
    setConfirmUninstall(null);
    setOpStatus({ name, state: "loading", output: "" });
    setExpandedOutput(false);
    try {
      const r = await fetch(apiUrl("/api/packages"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, purge }),
      });
      const d = (await r.json()) as { ok: boolean; output?: string };
      setOpStatus({ name, state: d.ok ? "success" : "error", output: d.output ?? "" });
      if (d.ok) {
        loadInstalled();
        setSearchResults((prev) => prev.map((p) => (p.name === name ? { ...p, installed: false } : p)));
      }
    } catch (e) {
      setOpStatus({ name, state: "error", output: String(e) });
    }
  };

  const upgradableCount = packages.filter((p) => p.upgradable).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-subtitle font-bold text-bot-text">Package Manager</h2>
        <p className="mt-1 text-caption text-bot-muted">
          Install, uninstall, and search Linux packages.{" "}
          {packageManager && (
            <span className="font-mono text-bot-accent">{packageManager}</span>
          )}
        </p>
      </div>

      {/* Operation status banner */}
      {opStatus && (
        <div
          className={cn(
            "rounded-lg border p-4 space-y-2",
            opStatus.state === "loading"
              ? "border-bot-border bg-bot-elevated"
              : opStatus.state === "success"
              ? "border-bot-green/30 bg-bot-green/5"
              : "border-bot-red/30 bg-bot-red/5",
          )}
        >
          <div className="flex items-center gap-2">
            {opStatus.state === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin text-bot-muted" />
            ) : opStatus.state === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-bot-green" />
            ) : (
              <XCircle className="h-4 w-4 text-bot-red" />
            )}
            <span className="text-body font-medium text-bot-text">
              {opStatus.state === "loading"
                ? `Running…`
                : opStatus.state === "success"
                ? `Done`
                : `Failed`}
            </span>
            <span className="font-mono text-caption text-bot-muted">{opStatus.name}</span>
            <div className="flex-1" />
            {opStatus.state !== "loading" && opStatus.output && (
              <button
                onClick={() => setExpandedOutput((v) => !v)}
                className="flex items-center gap-1 text-caption text-bot-muted hover:text-bot-text transition-colors"
              >
                <Terminal className="h-3.5 w-3.5" />
                Output
                {expandedOutput ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            {opStatus.state !== "loading" && (
              <button
                onClick={() => setOpStatus(null)}
                className="text-caption text-bot-muted hover:text-bot-text transition-colors"
              >
                Dismiss
              </button>
            )}
          </div>
          {expandedOutput && opStatus.output && (
            <pre className="mt-2 rounded bg-bot-surface border border-bot-border/40 p-3 text-xs font-mono text-bot-text overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
              {opStatus.output}
            </pre>
          )}
        </div>
      )}

      {/* Upgradable banner */}
      {upgradableCount > 0 && activeTab === "installed" && (
        <div className="flex items-center gap-3 rounded-lg border border-bot-amber/30 bg-bot-amber/5 px-4 py-3">
          <ArrowUpCircle className="h-4 w-4 shrink-0 text-bot-amber" />
          <p className="text-caption text-bot-amber flex-1">
            {upgradableCount} package{upgradableCount > 1 ? "s" : ""} can be upgraded.
            Run <span className="font-mono">apt-get upgrade</span> to upgrade all.
          </p>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-bot-border/30">
        {(["installed", "search"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2.5 text-body font-medium transition-colors capitalize",
              activeTab === tab
                ? "border-b-2 border-bot-accent text-bot-accent -mb-px"
                : "text-bot-muted hover:text-bot-text",
            )}
          >
            {tab === "installed" ? "Installed" : "Search / Install"}
          </button>
        ))}
      </div>

      {/* ── Installed packages tab ── */}
      {activeTab === "installed" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-bot-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Filter installed packages…"
                value={installedSearch}
                onChange={(e) => handleInstalledSearch(e.target.value)}
                className="w-full rounded-lg border border-bot-border bg-bot-elevated pl-9 pr-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent transition-colors"
              />
            </div>
            <button
              onClick={() => loadInstalled()}
              disabled={loadingPackages}
              className="flex items-center gap-1.5 text-caption text-bot-muted hover:text-bot-text transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", loadingPackages && "animate-spin")} />
              Refresh
            </button>
          </div>

          {loadingPackages ? (
            <div className="flex items-center justify-center py-12 gap-2 text-bot-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-body">Loading packages…</span>
            </div>
          ) : packages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-bot-muted">
              <Package className="h-8 w-8 opacity-30" />
              <p className="text-body">No packages found.</p>
            </div>
          ) : (
            <>
              <p className="text-caption text-bot-muted">
                Showing {packages.length} package{packages.length !== 1 ? "s" : ""}
                {installedSearch && ` matching "${installedSearch}"`}
              </p>
              <div className="rounded-lg border border-bot-border overflow-hidden">
                <table className="w-full text-caption">
                  <thead className="bg-bot-surface border-b border-bot-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-bot-muted font-medium">Package</th>
                      <th className="text-left px-4 py-2.5 text-bot-muted font-medium hidden sm:table-cell">Version</th>
                      <th className="text-left px-4 py-2.5 text-bot-muted font-medium hidden md:table-cell">Description</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bot-border/50">
                    {packages.map((pkg) => (
                      <tr key={pkg.name} className="bg-bot-elevated hover:bg-bot-elevated/70 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-bot-text">{pkg.name}</span>
                            {pkg.upgradable && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-bot-amber/10 border border-bot-amber/20 px-1.5 py-0.5 text-[10px] font-medium text-bot-amber">
                                <ArrowUpCircle className="h-2.5 w-2.5" />
                                update
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-bot-muted hidden sm:table-cell">
                          {pkg.version}
                        </td>
                        <td className="px-4 py-2.5 text-bot-muted max-w-xs truncate hidden md:table-cell">
                          {pkg.description}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {confirmUninstall === pkg.name ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-caption text-bot-red">Confirm?</span>
                              <button
                                onClick={() => doUninstall(pkg.name)}
                                disabled={opStatus?.state === "loading"}
                                className="rounded px-2 py-1 text-[11px] font-medium bg-bot-red/10 text-bot-red hover:bg-bot-red/20 transition-colors disabled:opacity-50"
                              >
                                Remove
                              </button>
                              <button
                                onClick={() => doUninstall(pkg.name, true)}
                                disabled={opStatus?.state === "loading"}
                                className="rounded px-2 py-1 text-[11px] font-medium bg-bot-red/20 text-bot-red hover:bg-bot-red/30 transition-colors disabled:opacity-50"
                              >
                                Purge
                              </button>
                              <button
                                onClick={() => setConfirmUninstall(null)}
                                className="text-caption text-bot-muted hover:text-bot-text transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmUninstall(pkg.name)}
                              disabled={opStatus?.state === "loading"}
                              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Uninstall
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Search / Install tab ── */}
      {activeTab === "search" && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-bot-muted pointer-events-none" />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-bot-muted" />
            )}
            <input
              type="text"
              placeholder="Search available packages (e.g. nginx, python3, git)…"
              value={searchQuery}
              onChange={(e) => handleAvailableSearch(e.target.value)}
              className="w-full rounded-lg border border-bot-border bg-bot-elevated pl-9 pr-9 py-2.5 text-body text-bot-text outline-none focus:border-bot-accent transition-colors"
              autoFocus
            />
          </div>

          {searchError && (
            <div className="flex items-center gap-2 text-caption text-bot-red">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {searchError}
            </div>
          )}

          {!searchQuery && (
            <p className="text-caption text-bot-muted text-center py-8">
              Type at least 2 characters to search available packages.
            </p>
          )}

          {searchQuery && !searching && searchResults.length === 0 && !searchError && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-bot-muted">
              <Package className="h-8 w-8 opacity-30" />
              <p className="text-body">No packages found for &quot;{searchQuery}&quot;.</p>
            </div>
          )}

          {searchResults.length > 0 && (
            <>
              <p className="text-caption text-bot-muted">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
              </p>
              <div className="rounded-lg border border-bot-border overflow-hidden">
                <table className="w-full text-caption">
                  <thead className="bg-bot-surface border-b border-bot-border">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-bot-muted font-medium">Package</th>
                      <th className="text-left px-4 py-2.5 text-bot-muted font-medium hidden sm:table-cell">Version</th>
                      <th className="text-left px-4 py-2.5 text-bot-muted font-medium hidden md:table-cell">Description</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bot-border/50">
                    {searchResults.map((pkg) => (
                      <tr key={pkg.name} className="bg-bot-elevated hover:bg-bot-elevated/70 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-bot-text">{pkg.name}</span>
                            {pkg.installed && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-bot-green/10 border border-bot-green/20 px-1.5 py-0.5 text-[10px] font-medium text-bot-green">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                installed
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-bot-muted hidden sm:table-cell">
                          {pkg.version || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-bot-muted max-w-xs truncate hidden md:table-cell">
                          {pkg.description}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {pkg.installed ? (
                            confirmUninstall === pkg.name ? (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-caption text-bot-red">Confirm?</span>
                                <button
                                  onClick={() => doUninstall(pkg.name)}
                                  disabled={opStatus?.state === "loading"}
                                  className="rounded px-2 py-1 text-[11px] font-medium bg-bot-red/10 text-bot-red hover:bg-bot-red/20 transition-colors disabled:opacity-50"
                                >
                                  Remove
                                </button>
                                <button
                                  onClick={() => doUninstall(pkg.name, true)}
                                  disabled={opStatus?.state === "loading"}
                                  className="rounded px-2 py-1 text-[11px] font-medium bg-bot-red/20 text-bot-red hover:bg-bot-red/30 transition-colors disabled:opacity-50"
                                >
                                  Purge
                                </button>
                                <button
                                  onClick={() => setConfirmUninstall(null)}
                                  className="text-caption text-bot-muted hover:text-bot-text transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmUninstall(pkg.name)}
                                disabled={opStatus?.state === "loading"}
                                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-bot-muted hover:text-bot-red hover:bg-bot-red/10 transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Uninstall
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => doInstall(pkg.name)}
                              disabled={opStatus?.state === "loading"}
                              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium bg-bot-accent/10 text-bot-accent hover:bg-bot-accent/20 transition-colors disabled:opacity-50"
                            >
                              {opStatus?.state === "loading" && opStatus.name === pkg.name ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="h-3.5 w-3.5" />
                              )}
                              Install
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

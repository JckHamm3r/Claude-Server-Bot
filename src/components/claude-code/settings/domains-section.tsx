"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Globe,
  Plus,
  X,
  CheckCircle2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Search,
  ShieldCheck,
  ShieldAlert,
  Info,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { apiUrl } from "@/lib/utils";

interface Domain {
  id: string;
  hostname: string;
  is_primary: boolean;
  ssl_enabled: boolean;
  verified: boolean;
  added_at: string;
  notes: string | null;
}

interface SetupResult {
  ok: boolean;
  error?: string;
}

interface DnsCheckResult {
  hostname: string;
  dns_resolved: boolean;
  resolved_ips: string[];
  server_ip: string | null;
  ip_match: boolean;
  port80_open: boolean;
  ready: boolean;
  issues: string[];
  hints: string[];
}

function openAiHelpSession(context: {
  hostname: string;
  serverIp: string | null;
  dnsCheck: DnsCheckResult | null;
  setupError: string | null;
}) {
  const lines: string[] = [
    `I'm having trouble setting up the domain **${context.hostname}** on my Octoby AI server.`,
    "",
  ];

  if (context.serverIp) {
    lines.push(`**Server IP:** ${context.serverIp}`);
  }

  if (context.dnsCheck) {
    lines.push(
      `**DNS resolved:** ${context.dnsCheck.dns_resolved ? "yes" : "no"}`,
      context.dnsCheck.resolved_ips.length > 0
        ? `**Resolved IPs:** ${context.dnsCheck.resolved_ips.join(", ")}`
        : "",
      `**IP match:** ${context.dnsCheck.ip_match ? "yes" : "no"}`,
      `**Port 80 open:** ${context.dnsCheck.port80_open ? "yes" : "no"}`
    );
  }

  if (context.setupError) {
    lines.push("", `**Error:** ${context.setupError}`);
  }

  if (context.dnsCheck?.issues?.length) {
    lines.push("", "**Detected issues:**");
    context.dnsCheck.issues.forEach((i) => lines.push(`- ${i}`));
  }

  lines.push(
    "",
    "Can you help me diagnose and resolve this? Please guide me step by step."
  );

  const message = lines.filter((l) => l !== undefined).join("\n");

  // Emit a global event that chat-tab.tsx listens for
  window.dispatchEvent(
    new CustomEvent("octoby:open-ai-help", { detail: { message } })
  );
}

function DnsStatusBadge({ check }: { check: DnsCheckResult }) {
  if (check.ready) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-bot-green/10 text-bot-green">
        <CheckCircle2 className="w-3 h-3" /> Ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-bot-amber/10 text-bot-amber">
      <AlertTriangle className="w-3 h-3" /> Not ready
    </span>
  );
}

function CheckRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      {ok ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-bot-green mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 text-bot-amber mt-0.5 shrink-0" />
      )}
      <span className={ok ? "text-bot-text" : "text-bot-amber"}>
        {label}
        {detail && (
          <span className="ml-1 text-bot-muted font-mono text-[11px]">
            ({detail})
          </span>
        )}
      </span>
    </div>
  );
}

export function DomainsSection() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [settingUp, setSettingUp] = useState<string | null>(null);
  const [newHostname, setNewHostname] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // DNS pre-check state
  const [checking, setChecking] = useState(false);
  const [dnsCheck, setDnsCheck] = useState<DnsCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Expandable hints
  const [hintsOpen, setHintsOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(apiUrl("/api/settings/domains"))
      .then((r) => r.json())
      .then((d: { domains?: Domain[] }) => setDomains(d.domains ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reset check state when hostname changes
  useEffect(() => {
    setDnsCheck(null);
    setCheckError(null);
    setSetupError(null);
    setHintsOpen(false);
  }, [newHostname]);

  const handleCheck = useCallback(async () => {
    const h = newHostname.trim();
    if (!h) return;
    setChecking(true);
    setDnsCheck(null);
    setCheckError(null);
    setSetupError(null);
    try {
      const res = await fetch(
        apiUrl(
          `/api/settings/domains/check?hostname=${encodeURIComponent(h)}`
        )
      );
      const data = (await res.json()) as DnsCheckResult & { error?: string };
      if (data.error) {
        setCheckError(data.error);
      } else {
        setDnsCheck(data);
        setHintsOpen(!data.ready);
      }
    } catch {
      setCheckError("Network error — could not run DNS check");
    } finally {
      setChecking(false);
    }
  }, [newHostname]);

  const handleAdd = useCallback(async () => {
    const h = newHostname.trim();
    if (!h) return;
    setAdding(true);
    setMsg(null);
    setSetupError(null);
    try {
      const res = await fetch(apiUrl("/api/settings/domains"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: h }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        setup?: SetupResult;
      };
      if (data.ok) {
        setNewHostname("");
        setDnsCheck(null);
        load();
        if (data.setup?.ok) {
          setMsg({
            ok: true,
            text: "Domain added — nginx and SSL configured successfully.",
          });
        } else if (data.setup?.error) {
          const err = data.setup.error;
          setSetupError(err);
          setMsg({
            ok: false,
            text: `Domain saved but SSL setup failed. See details below.`,
          });
        } else {
          setMsg({ ok: true, text: "Domain added." });
        }
      } else {
        setMsg({ ok: false, text: data.error ?? "Failed to add domain" });
      }
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setAdding(false);
    }
  }, [newHostname, load]);

  const handleRetrySetup = useCallback(
    async (id: string) => {
      setSettingUp(id);
      setMsg(null);
      setSetupError(null);
      try {
        const res = await fetch(apiUrl("/api/settings/domains"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          setup?: SetupResult;
        };
        if (data.setup?.ok) {
          setMsg({ ok: true, text: "SSL setup completed successfully." });
        } else {
          const err = data.setup?.error ?? "unknown error";
          setSetupError(err);
          setMsg({ ok: false, text: "Setup failed. See details below." });
        }
        load();
      } catch {
        setMsg({ ok: false, text: "Network error during setup" });
      } finally {
        setSettingUp(null);
      }
    },
    [load]
  );

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await fetch(
          apiUrl(`/api/settings/domains?id=${encodeURIComponent(id)}`),
          { method: "DELETE" }
        );
        load();
      } catch {
        setMsg({ ok: false, text: "Failed to remove domain" });
      }
    },
    [load]
  );

  const serverIp = dnsCheck?.server_ip ?? null;

  const canAdd =
    !adding &&
    newHostname.trim().length > 0 &&
    // Allow adding if check passed, or if no check was run yet (user skipped)
    (dnsCheck === null || dnsCheck.ready);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="mb-6 text-subtitle font-bold text-bot-text">Domains</h2>

      {/* Prerequisites info panel */}
      <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-4 space-y-2">
        <div className="flex items-center gap-2 text-body font-semibold text-bot-text">
          <Info className="w-4 h-4 text-bot-accent shrink-0" />
          Before adding a domain
        </div>
        <ul className="text-[12px] text-bot-muted space-y-1.5 ml-6 list-none">
          <li className="flex items-start gap-1.5">
            <span className="text-bot-accent mt-0.5">1.</span>
            <span>
              Create an <strong>A record</strong> pointing your domain to this
              server&apos;s public IP.
              {serverIp && (
                <span className="ml-1 font-mono text-bot-text bg-bot-elevated px-1.5 py-0.5 rounded text-[11px]">
                  {serverIp}
                </span>
              )}
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-bot-accent mt-0.5">2.</span>
            <span>
              Ensure <strong>port 80</strong> (HTTP) is open in your
              firewall — Let&apos;s Encrypt requires it for certificate
              issuance.
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-bot-accent mt-0.5">3.</span>
            <span>
              Enter your domain below, click <strong>Check DNS</strong> to
              verify, then <strong>Setup SSL</strong>.
            </span>
          </li>
        </ul>
      </div>

      {/* Domain list */}
      <div className="rounded-xl border border-bot-border/30 bg-bot-surface/50 backdrop-blur-sm p-5 space-y-4">
        {loading ? (
          <p className="text-caption text-bot-muted">Loading…</p>
        ) : domains.length === 0 ? (
          <p className="text-caption text-bot-muted italic">
            No custom domains configured.
          </p>
        ) : (
          <div className="rounded-lg border border-bot-border overflow-hidden">
            <table className="w-full text-caption">
              <thead className="bg-bot-surface border-b border-bot-border">
                <tr>
                  <th className="text-left px-3 py-2 text-bot-muted font-medium">
                    Hostname
                  </th>
                  <th className="text-left px-3 py-2 text-bot-muted font-medium">
                    SSL
                  </th>
                  <th className="text-left px-3 py-2 text-bot-muted font-medium">
                    Status
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-bot-border">
                {domains.map((d) => (
                  <tr key={d.id} className="bg-bot-elevated">
                    <td className="px-3 py-2 font-mono text-bot-text">
                      {d.hostname}
                      {d.is_primary && (
                        <span className="ml-2 text-bot-accent text-[10px] uppercase font-bold">
                          primary
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d.ssl_enabled ? (
                        <ShieldCheck className="w-4 h-4 text-bot-green" />
                      ) : (
                        <Globe className="w-4 h-4 text-bot-muted" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d.verified ? (
                        <CheckCircle2 className="w-4 h-4 text-bot-green" />
                      ) : (
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-bot-amber" />
                          <button
                            onClick={() => handleRetrySetup(d.id)}
                            disabled={settingUp === d.id}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-bot-accent/10 text-bot-accent hover:bg-bot-accent/20 disabled:opacity-50 transition-colors"
                          >
                            {settingUp === d.id ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />{" "}
                                Setting up…
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-3 h-3" /> Retry SSL
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleRemove(d.id)}
                        className="p-1 rounded hover:bg-bot-surface text-bot-muted hover:text-bot-red transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Per-domain error notes with AI help */}
            {domains
              .filter((d) => !d.verified && d.notes)
              .map((d) => (
                <div
                  key={d.id + "-note"}
                  className="px-3 py-2.5 text-[11px] text-bot-red bg-bot-surface border-t border-bot-border space-y-1.5"
                >
                  <div>
                    <span className="font-medium">{d.hostname}:</span>{" "}
                    {d.notes}
                  </div>
                  <button
                    onClick={() =>
                      openAiHelpSession({
                        hostname: d.hostname,
                        serverIp: null,
                        dnsCheck: null,
                        setupError: d.notes,
                      })
                    }
                    className="flex items-center gap-1 text-[11px] text-bot-accent hover:underline"
                  >
                    <MessageSquare className="w-3 h-3" /> Ask AI for help
                  </button>
                </div>
              ))}
          </div>
        )}

        {/* Add domain row */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="example.com"
            value={newHostname}
            onChange={(e) => setNewHostname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (dnsCheck?.ready) {
                  handleAdd();
                } else if (!checking) {
                  handleCheck();
                }
              }
            }}
            className="flex-1 rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent"
          />
          <button
            onClick={handleCheck}
            disabled={checking || !newHostname.trim()}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-body font-medium border border-bot-border bg-bot-elevated text-bot-text hover:border-bot-accent hover:text-bot-accent disabled:opacity-50 transition-colors"
            title="Check DNS and port 80 before setting up SSL"
          >
            {checking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            {checking ? "Checking…" : "Check"}
          </button>
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-body font-medium bg-bot-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            title={
              dnsCheck && !dnsCheck.ready
                ? "Fix DNS issues before setting up SSL"
                : "Add domain and configure nginx + SSL"
            }
          >
            {adding ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Setting
                up…
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" /> Setup SSL
              </>
            )}
          </button>
        </div>

        {/* DNS check results */}
        {(dnsCheck || checkError) && (
          <div
            className={`rounded-lg border p-3 space-y-2 text-[12px] ${
              checkError
                ? "border-bot-red/30 bg-bot-red/5"
                : dnsCheck?.ready
                ? "border-bot-green/30 bg-bot-green/5"
                : "border-bot-amber/30 bg-bot-amber/5"
            }`}
          >
            {checkError && (
              <p className="text-bot-red font-medium">{checkError}</p>
            )}
            {dnsCheck && (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-bot-text">
                    DNS check: {dnsCheck.hostname}
                  </span>
                  <DnsStatusBadge check={dnsCheck} />
                </div>

                <div className="space-y-1.5">
                  <CheckRow
                    label="DNS resolves"
                    ok={dnsCheck.dns_resolved}
                    detail={
                      dnsCheck.dns_resolved
                        ? dnsCheck.resolved_ips.join(", ")
                        : "no A record found"
                    }
                  />
                  <CheckRow
                    label="Points to this server"
                    ok={dnsCheck.ip_match}
                    detail={
                      dnsCheck.server_ip
                        ? `server IP: ${dnsCheck.server_ip}`
                        : undefined
                    }
                  />
                  <CheckRow
                    label="Port 80 reachable"
                    ok={dnsCheck.port80_open}
                  />
                </div>

                {!dnsCheck.ready && dnsCheck.hints.length > 0 && (
                  <div className="border-t border-bot-border/40 pt-2">
                    <button
                      onClick={() => setHintsOpen((v) => !v)}
                      className="flex items-center gap-1 text-bot-accent text-[11px] font-medium hover:underline"
                    >
                      {hintsOpen ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                      {hintsOpen ? "Hide" : "Show"} remediation steps
                    </button>
                    {hintsOpen && (
                      <ul className="mt-2 space-y-1 text-bot-muted">
                        {dnsCheck.hints.map((h, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-bot-accent mt-0.5 shrink-0">→</span>
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {!dnsCheck.ready && (
                  <div className="pt-1 flex items-center gap-3 border-t border-bot-border/40">
                    <button
                      onClick={() =>
                        openAiHelpSession({
                          hostname: dnsCheck.hostname,
                          serverIp: dnsCheck.server_ip,
                          dnsCheck,
                          setupError: null,
                        })
                      }
                      className="flex items-center gap-1 text-[11px] text-bot-accent hover:underline"
                    >
                      <MessageSquare className="w-3 h-3" /> Ask AI for help
                    </button>
                    <span className="text-bot-muted text-[11px]">
                      DNS changes can take up to 24h to propagate.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Global status message */}
      {msg && (
        <p
          className={`text-caption mt-2 ${msg.ok ? "text-bot-green" : "text-bot-red"}`}
        >
          {msg.text}
        </p>
      )}

      {/* Setup error detail with AI help */}
      {setupError && (
        <div className="rounded-lg border border-bot-red/30 bg-bot-red/5 p-3 space-y-2 text-[12px]">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-bot-red shrink-0 mt-0.5" />
            <p className="text-bot-text">{setupError}</p>
          </div>
          <button
            onClick={() =>
              openAiHelpSession({
                hostname: newHostname.trim() || domains.find((d) => !d.verified)?.hostname ?? "your domain",
                serverIp: dnsCheck?.server_ip ?? null,
                dnsCheck,
                setupError,
              })
            }
            className="flex items-center gap-1 text-bot-accent text-[11px] hover:underline ml-6"
          >
            <MessageSquare className="w-3 h-3" /> Ask AI for help resolving
            this
          </button>
        </div>
      )}
    </div>
  );
}

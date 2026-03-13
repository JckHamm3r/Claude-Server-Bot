"use client";

import { useEffect, useState } from "react";
import { Globe, Plus, X, CheckCircle2, RefreshCw, Loader2, AlertTriangle } from "lucide-react";

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

export function DomainsSection() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [settingUp, setSettingUp] = useState<string | null>(null);
  const [newHostname, setNewHostname] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/settings/domains")
      .then((r) => r.json())
      .then((d: { domains?: Domain[] }) => setDomains(d.domains ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newHostname.trim()) return;
    setAdding(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: newHostname.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; setup?: SetupResult };
      if (data.ok) {
        setNewHostname("");
        load();
        if (data.setup?.ok) {
          setMsg({ ok: true, text: "Domain added — nginx and SSL configured successfully." });
        } else if (data.setup?.error) {
          setMsg({ ok: false, text: `Domain saved but setup failed: ${data.setup.error}. You can retry with the Setup SSL button.` });
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
  };

  const handleRetrySetup = async (id: string) => {
    setSettingUp(id);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/domains", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json() as { ok?: boolean; setup?: SetupResult };
      if (data.setup?.ok) {
        setMsg({ ok: true, text: "SSL setup completed successfully." });
      } else {
        setMsg({ ok: false, text: `Setup failed: ${data.setup?.error ?? "unknown error"}` });
      }
      load();
    } catch {
      setMsg({ ok: false, text: "Network error during setup" });
    } finally {
      setSettingUp(null);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch(`/api/settings/domains?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      load();
    } catch {
      setMsg({ ok: false, text: "Failed to remove domain" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-semibold text-bot-text mb-1">Custom Domains</h3>
        <p className="text-caption text-bot-muted mb-4">
          Add a domain to automatically configure nginx and SSL.
        </p>

        {loading ? (
          <p className="text-caption text-bot-muted">Loading…</p>
        ) : domains.length === 0 ? (
          <p className="text-caption text-bot-muted italic">No custom domains configured.</p>
        ) : (
          <div className="rounded-lg border border-bot-border overflow-hidden mb-4">
            <table className="w-full text-caption">
              <thead className="bg-bot-surface border-b border-bot-border">
                <tr>
                  <th className="text-left px-3 py-2 text-bot-muted font-medium">Hostname</th>
                  <th className="text-left px-3 py-2 text-bot-muted font-medium">SSL</th>
                  <th className="text-left px-3 py-2 text-bot-muted font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-bot-border">
                {domains.map((d) => (
                  <tr key={d.id} className="bg-bot-elevated">
                    <td className="px-3 py-2 font-mono text-bot-text">
                      {d.hostname}
                      {d.is_primary && (
                        <span className="ml-2 text-bot-accent text-[10px] uppercase font-bold">primary</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d.ssl_enabled
                        ? <CheckCircle2 className="w-4 h-4 text-bot-green" />
                        : <Globe className="w-4 h-4 text-bot-muted" />
                      }
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
                              <><Loader2 className="w-3 h-3 animate-spin" /> Setting up…</>
                            ) : (
                              <><RefreshCw className="w-3 h-3" /> Setup SSL</>
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
            {/* Show notes for failed domains */}
            {domains.filter(d => !d.verified && d.notes).map(d => (
              <div key={d.id + "-note"} className="px-3 py-2 text-[11px] text-bot-red bg-bot-surface border-t border-bot-border">
                <span className="font-medium">{d.hostname}:</span> {d.notes}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="example.com"
            value={newHostname}
            onChange={(e) => setNewHostname(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-1.5 text-caption text-bot-text outline-none focus:border-bot-accent"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newHostname.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-caption font-medium bg-bot-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            {adding ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Setting up…</>
            ) : (
              <><Plus className="w-3.5 h-3.5" /> Add</>
            )}
          </button>
        </div>

        {msg && (
          <p className={`text-caption mt-2 ${msg.ok ? "text-bot-green" : "text-bot-red"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

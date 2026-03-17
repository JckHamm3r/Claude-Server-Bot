"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/utils";

interface SmtpFormData {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from_name: string;
  from_address: string;
  reply_to: string;
  enabled: boolean;
}

const DEFAULT_FORM: SmtpFormData = {
  host: "",
  port: 587,
  secure: false,
  username: "",
  password: "",
  from_name: "",
  from_address: "",
  reply_to: "",
  enabled: true,
};

export function SmtpSection() {
  const [form, setForm] = useState<SmtpFormData>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/settings/smtp"))
      .then((r) => r.json())
      .then((d: Partial<SmtpFormData>) => setForm({ ...DEFAULT_FORM, ...d }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof SmtpFormData>(key: K, value: SmtpFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(apiUrl("/api/settings/smtp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setMsg(data.ok ? { ok: true, text: "SMTP settings saved." } : { ok: false, text: data.error ?? "Save failed" });
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail.trim()) return;
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch(apiUrl("/api/settings/smtp/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setMsg(data.ok ? { ok: true, text: "Test email sent!" } : { ok: false, text: data.error ?? "Test failed" });
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <p className="text-caption text-bot-muted">Loading…</p>;

  const inputClass =
    "w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-1.5 text-caption text-bot-text outline-none focus:border-bot-accent";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-semibold text-bot-text mb-1">SMTP Configuration</h3>
        <p className="text-caption text-bot-muted mb-4">
          Configure email delivery for notifications.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-bot-border bg-bot-elevated px-4 py-3">
            <span className="text-body font-medium text-bot-text">Enable email notifications</span>
            <button
              onClick={() => set("enabled", !form.enabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.enabled ? "bg-bot-accent" : "bg-bot-muted/40"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.enabled ? "translate-x-4" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-bot-muted mb-1">SMTP Host</label>
              <input className={inputClass} value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div>
              <label className="block text-caption font-medium text-bot-muted mb-1">Port</label>
              <input className={inputClass} type="number" value={form.port} onChange={(e) => set("port", parseInt(e.target.value) || 587)} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="smtp-secure"
              checked={form.secure}
              onChange={(e) => set("secure", e.target.checked)}
              className="rounded border-bot-border"
            />
            <label htmlFor="smtp-secure" className="text-caption text-bot-text">Use TLS/SSL</label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-bot-muted mb-1">Username</label>
              <input className={inputClass} value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="user@example.com" autoComplete="off" />
            </div>
            <div>
              <label className="block text-caption font-medium text-bot-muted mb-1">Password</label>
              <input className={inputClass} type="password" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-caption font-medium text-bot-muted mb-1">From Name</label>
              <input className={inputClass} value={form.from_name} onChange={(e) => set("from_name", e.target.value)} placeholder="Octoby AI" />
            </div>
            <div>
              <label className="block text-caption font-medium text-bot-muted mb-1">From Address</label>
              <input className={inputClass} value={form.from_address} onChange={(e) => set("from_address", e.target.value)} placeholder="bot@example.com" />
            </div>
          </div>

          <div>
            <label className="block text-caption font-medium text-bot-muted mb-1">Reply-To (optional)</label>
            <input className={inputClass} value={form.reply_to} onChange={(e) => set("reply_to", e.target.value)} placeholder="admin@example.com" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded text-caption font-medium bg-bot-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </div>

      <div className="border-t border-bot-border pt-4">
        <h4 className="text-body font-semibold text-bot-text mb-1">Send Test Email</h4>
        <p className="text-caption text-bot-muted mb-2">Tests the saved SMTP configuration. Save your settings first if you made changes.</p>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-bot-border bg-bot-elevated px-3 py-1.5 text-caption text-bot-text outline-none focus:border-bot-accent"
            placeholder="recipient@example.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleTest(); }}
          />
          <button
            onClick={handleTest}
            disabled={testing || !testEmail.trim()}
            className="px-3 py-1.5 rounded text-caption font-medium border border-bot-border text-bot-text hover:bg-bot-elevated disabled:opacity-50"
          >
            {testing ? "Sending…" : "Send Test"}
          </button>
        </div>
      </div>

      {msg && (
        <p className={`text-caption ${msg.ok ? "text-bot-green" : "text-bot-red"}`}>{msg.text}</p>
      )}
    </div>
  );
}

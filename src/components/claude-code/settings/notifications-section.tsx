"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/utils";

interface NotificationPref {
  event_type: string;
  label: string;
  email_enabled: boolean;
  inapp_enabled: boolean;
}

export function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPref[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/settings/notifications"))
      .then((r) => r.json())
      .then((d: { preferences?: NotificationPref[] }) => setPrefs(d.preferences ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (index: number, field: "email_enabled" | "inapp_enabled") => {
    setPrefs((prev) =>
      prev.map((p, i) =>
        i === index ? { ...p, [field]: !p[field] } : p
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(apiUrl("/api/settings/notifications"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: prefs }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setMsg(data.ok ? { ok: true, text: "Preferences saved." } : { ok: false, text: data.error ?? "Save failed" });
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-caption text-bot-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-semibold text-bot-text mb-1">Notification Preferences</h3>
        <p className="text-caption text-bot-muted mb-4">
          Choose which events trigger notifications and how you receive them.
        </p>

        {prefs.length === 0 ? (
          <p className="text-caption text-bot-muted italic">No notification types configured.</p>
        ) : (
          <div className="rounded-lg border border-bot-border overflow-hidden">
            <table className="w-full text-caption">
              <thead className="bg-bot-surface border-b border-bot-border">
                <tr>
                  <th className="text-left px-3 py-2 text-bot-muted font-medium">Event</th>
                  <th className="text-center px-3 py-2 text-bot-muted font-medium">In-App</th>
                  <th className="text-center px-3 py-2 text-bot-muted font-medium">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bot-border">
                {prefs.map((pref, i) => (
                  <tr key={pref.event_type} className="bg-bot-elevated hover:bg-bot-surface transition-colors">
                    <td className="px-3 py-2 text-bot-text">{pref.label}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggle(i, "inapp_enabled")}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pref.inapp_enabled ? "bg-bot-accent" : "bg-bot-muted/40"}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${pref.inapp_enabled ? "translate-x-4" : "translate-x-1"}`} />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggle(i, "email_enabled")}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pref.email_enabled ? "bg-bot-accent" : "bg-bot-muted/40"}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${pref.email_enabled ? "translate-x-4" : "translate-x-1"}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded text-caption font-medium bg-bot-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Preferences"}
          </button>
          {msg && (
            <span className={`text-caption ${msg.ok ? "text-bot-green" : "text-bot-red"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

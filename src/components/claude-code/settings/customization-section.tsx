"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/utils";

interface PersonalityOption {
  value: string;
  label: string;
  description: string;
}

const PERSONALITY_OPTIONS: PersonalityOption[] = [
  { value: "professional", label: "Professional", description: "Clear, formal, and precise" },
  { value: "friendly", label: "Friendly", description: "Warm, approachable, and encouraging" },
  { value: "technical", label: "Technical", description: "Expert-level, detailed, and precise" },
  { value: "concise", label: "Concise", description: "Brief and to-the-point" },
  { value: "creative", label: "Creative", description: "Innovative and outside-the-box" },
  { value: "custom", label: "Custom", description: "Write your own system prompt prefix" },
];

export function CustomizationSection() {
  const [personality, setPersonality] = useState("professional");
  const [customPrompt, setCustomPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/settings/customization"))
      .then((r) => r.json())
      .then((d: { personality?: string; personality_custom?: string }) => {
        if (d.personality) setPersonality(d.personality);
        if (d.personality_custom) setCustomPrompt(d.personality_custom);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(apiUrl("/api/settings/customization"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personality, personality_custom: customPrompt }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setMsg(data.ok ? { ok: true, text: "Saved!" } : { ok: false, text: data.error ?? "Save failed" });
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-semibold text-bot-text mb-1">Personality</h3>
        <p className="text-caption text-bot-muted mb-4">
          Choose how Claude responds in chat sessions.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PERSONALITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPersonality(opt.value)}
              className={[
                "flex flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors",
                personality === opt.value
                  ? "border-bot-accent bg-bot-accent/10 text-bot-accent"
                  : "border-bot-border bg-bot-elevated text-bot-text hover:bg-bot-surface",
              ].join(" ")}
            >
              <span className="font-medium text-body">{opt.label}</span>
              <span className="text-caption text-bot-muted mt-0.5">{opt.description}</span>
            </button>
          ))}
        </div>
      </div>

      {personality === "custom" && (
        <div>
          <label className="block text-caption font-medium text-bot-text mb-1">
            Custom System Prompt Prefix
          </label>
          <textarea
            className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent resize-y min-h-[120px]"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Enter a custom system prompt prefix…"
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded text-caption font-medium bg-bot-accent text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && (
          <span className={`text-caption ${msg.ok ? "text-bot-green" : "text-bot-red"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

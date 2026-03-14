"use client";

import { useState, useEffect, useRef } from "react";
import { X, AlertTriangle } from "lucide-react";
import { ModelSelector } from "./model-selector";
import { DEFAULT_MODEL } from "@/lib/models";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

interface PersonalityOption {
  value: string;
  label: string;
  description: string;
}

const PERSONALITY_OPTIONS: PersonalityOption[] = [
  { value: "professional", label: "Professional", description: "Clear, formal, and business-like" },
  { value: "friendly", label: "Friendly", description: "Warm and encouraging" },
  { value: "technical", label: "Technical", description: "Expert-level and precise" },
  { value: "concise", label: "Concise", description: "Brief, to the point" },
  { value: "verbose", label: "Verbose", description: "Detailed with examples" },
  { value: "creative", label: "Creative", description: "Inventive, unconventional" },
  { value: "strict_engineer", label: "Strict Engineer", description: "Correctness-first" },
  { value: "custom", label: "Custom", description: "Your own prompt prefix" },
];

interface SessionTemplate {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  model: string;
  skip_permissions: boolean;
  provider_type: string;
  icon: string | null;
}

interface NewSessionDialogProps {
  onClose: () => void;
  onCreate: (name: string, skipPermissions: boolean, model: string, providerType: string, templateId?: string, personality?: string, personalityCustom?: string) => void;
}

export function NewSessionDialog({ onClose, onCreate }: NewSessionDialogProps) {
  const [name, setName] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [providerType, setProviderType] = useState("subprocess");
  const [personality, setPersonality] = useState("professional");
  const [customPrompt, setCustomPrompt] = useState("");
  const [showPersonality, setShowPersonality] = useState(false);
  const [sdkAvailable, setSdkAvailable] = useState(false);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  useEffect(() => {
    socketRef.current = getSocket();
    const socket = socketRef.current;

    const handleCapabilities = ({ sdkAvailable: avail }: { sdkAvailable: boolean }) => {
      setSdkAvailable(avail);
    };

    const handleTemplates = ({ templates: t }: { templates: SessionTemplate[] }) => {
      setTemplates(t);
    };

    socket.on("claude:capabilities", handleCapabilities);
    socket.on("claude:templates", handleTemplates);
    socket.emit("claude:get_capabilities");
    socket.emit("claude:list_templates");

    return () => {
      socket.off("claude:capabilities", handleCapabilities);
      socket.off("claude:templates", handleTemplates);
    };
  }, []);

  const handleSelectTemplate = (template: SessionTemplate) => {
    setSelectedTemplate(template.id);
    setModel(template.model);
    setSkipPermissions(template.skip_permissions);
    setProviderType(template.provider_type);
    if (!name) setName(template.name);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(
      name.trim(),
      skipPermissions,
      model,
      providerType,
      selectedTemplate ?? undefined,
      personality,
      personality === "custom" ? customPrompt : undefined,
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-bot-border bg-bot-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-subtitle font-semibold text-bot-text">New Session</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-bot-muted hover:bg-bot-elevated transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {templates.length > 0 && (
            <div>
              <label className="mb-1.5 block text-caption font-medium text-bot-muted">
                Template
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplate(null);
                    setModel(DEFAULT_MODEL);
                    setSkipPermissions(false);
                    setProviderType("subprocess");
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-caption font-medium transition-colors",
                    !selectedTemplate
                      ? "border-bot-accent bg-bot-accent/10 text-bot-accent"
                      : "border-bot-border bg-bot-elevated text-bot-muted hover:border-bot-accent/50",
                  )}
                >
                  Blank
                </button>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelectTemplate(t)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-caption font-medium transition-colors",
                      selectedTemplate === t.id
                        ? "border-bot-accent bg-bot-accent/10 text-bot-accent"
                        : "border-bot-border bg-bot-elevated text-bot-muted hover:border-bot-accent/50",
                    )}
                    title={t.description ?? undefined}
                  >
                    {t.icon && <span className="mr-1">{t.icon}</span>}
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-caption font-medium text-bot-muted">
              Session name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fix fleet data bug"
              className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-caption font-medium text-bot-muted">
              Model
            </label>
            <ModelSelector value={model} onChange={setModel} />
          </div>

          <div>
            <label className="mb-1.5 block text-caption font-medium text-bot-muted">
              Provider
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setProviderType("subprocess")}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-caption font-medium transition-colors",
                  providerType === "subprocess"
                    ? "border-bot-accent bg-bot-accent/10 text-bot-accent"
                    : "border-bot-border bg-bot-elevated text-bot-muted hover:border-bot-accent/50",
                )}
              >
                CLI
              </button>
              <button
                type="button"
                onClick={() => sdkAvailable && setProviderType("sdk")}
                disabled={!sdkAvailable}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-caption font-medium transition-colors",
                  providerType === "sdk"
                    ? "border-bot-accent bg-bot-accent/10 text-bot-accent"
                    : "border-bot-border bg-bot-elevated text-bot-muted hover:border-bot-accent/50",
                  !sdkAvailable && "opacity-40 cursor-not-allowed",
                )}
                title={!sdkAvailable ? "Add API key in Settings to enable SDK" : "Use Anthropic SDK directly"}
              >
                SDK
                {!sdkAvailable && <span className="ml-1 text-[10px] opacity-60">(no key)</span>}
              </button>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowPersonality((p) => !p)}
              className="mb-1.5 flex items-center gap-1.5 text-caption font-medium text-bot-muted hover:text-bot-text transition-colors"
            >
              <span className={cn("transition-transform text-[10px]", showPersonality ? "rotate-90" : "")}>&#9654;</span>
              Personality
              <span className="rounded bg-bot-elevated px-1.5 py-px text-[10px] font-normal text-bot-accent">
                {PERSONALITY_OPTIONS.find((o) => o.value === personality)?.label ?? "Professional"}
              </span>
            </button>
            {showPersonality && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {PERSONALITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPersonality(opt.value)}
                      className={cn(
                        "flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors",
                        personality === opt.value
                          ? "border-bot-accent bg-bot-accent/10 text-bot-accent"
                          : "border-bot-border bg-bot-elevated text-bot-text hover:bg-bot-surface",
                      )}
                    >
                      <span className="font-medium text-caption">{opt.label}</span>
                      <span className="text-[10px] text-bot-muted">{opt.description}</span>
                    </button>
                  ))}
                </div>
                {personality === "custom" && (
                  <textarea
                    className="w-full rounded-md border border-bot-border bg-bot-elevated px-3 py-2 text-caption text-bot-text outline-none focus:border-bot-accent resize-y min-h-[80px]"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Enter a custom system prompt prefix..."
                  />
                )}
              </div>
            )}
          </div>

          <div>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={(e) => setSkipPermissions(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-bot-border accent-bot-accent"
              />
              <span className="text-body text-bot-text">
                Skip permissions (--dangerously-skip-permissions)
              </span>
            </label>
            {skipPermissions && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-bot-red/40 bg-bot-red/10 px-3 py-2 text-caption text-bot-red">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Claude will be able to execute any command, read/write any file, and take
                  irreversible actions without confirmation. Use only for trusted tasks.
                </span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-bot-border px-4 py-2 text-body text-bot-muted hover:bg-bot-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

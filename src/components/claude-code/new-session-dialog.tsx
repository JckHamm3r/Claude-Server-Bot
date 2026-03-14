"use client";

import { useState, useEffect, useRef } from "react";
import { X, AlertTriangle, ChevronRight } from "lucide-react";
import { ModelSelector } from "./model-selector";
import { DEFAULT_MODEL } from "@/lib/models";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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
  const [personality, setPersonality] = useState("professional");
  const [customPrompt, setCustomPrompt] = useState("");
  const [showPersonality, setShowPersonality] = useState(false);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  useEffect(() => {
    socketRef.current = getSocket();
    const socket = socketRef.current;

    const handleTemplates = ({ templates: t }: { templates: SessionTemplate[] }) => {
      setTemplates(t);
    };

    socket.on("claude:templates", handleTemplates);
    socket.emit("claude:list_templates");

    return () => {
      socket.off("claude:templates", handleTemplates);
    };
  }, []);

  const handleSelectTemplate = (template: SessionTemplate) => {
    setSelectedTemplate(template.id);
    setModel(template.model);
    setSkipPermissions(template.skip_permissions);
    if (!name) setName(template.name);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(
      name.trim(),
      skipPermissions,
      model,
      "sdk",
      selectedTemplate ?? undefined,
      personality,
      personality === "custom" ? customPrompt : undefined,
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="w-full max-w-md glass-heavy rounded-2xl p-6 shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-subtitle font-bold text-bot-text">New Session</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated/50 hover:text-bot-text transition-all duration-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {templates.length > 0 && (
            <div>
              <label className="mb-2 block text-caption font-medium text-bot-muted">
                Template
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplate(null);
                    setModel(DEFAULT_MODEL);
                    setSkipPermissions(false);
                  }}
                  className={cn(
                    "rounded-xl border px-3.5 py-2 text-caption font-medium transition-all duration-200",
                    !selectedTemplate
                      ? "border-bot-accent/50 bg-bot-accent/10 text-bot-accent shadow-glow-sm"
                      : "border-bot-border/40 bg-bot-elevated/40 text-bot-muted hover:border-bot-accent/30",
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
                      "rounded-xl border px-3.5 py-2 text-caption font-medium transition-all duration-200",
                      selectedTemplate === t.id
                        ? "border-bot-accent/50 bg-bot-accent/10 text-bot-accent shadow-glow-sm"
                        : "border-bot-border/40 bg-bot-elevated/40 text-bot-muted hover:border-bot-accent/30",
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
            <label className="mb-2 block text-caption font-medium text-bot-muted">
              Session name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fix fleet data bug"
              className="w-full rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-2.5 text-body text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 focus:shadow-glow-sm transition-all duration-200"
            />
          </div>

          <div>
            <label className="mb-2 block text-caption font-medium text-bot-muted">
              Model
            </label>
            <ModelSelector value={model} onChange={setModel} />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowPersonality((p) => !p)}
              className="mb-2 flex items-center gap-1.5 text-caption font-medium text-bot-muted hover:text-bot-text transition-all duration-200"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform duration-200", showPersonality && "rotate-90")} />
              Personality
              <span className="rounded-lg bg-bot-accent/10 px-2 py-0.5 text-[10px] font-semibold text-bot-accent">
                {PERSONALITY_OPTIONS.find((o) => o.value === personality)?.label ?? "Professional"}
              </span>
            </button>
            <AnimatePresence>
              {showPersonality && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {PERSONALITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setPersonality(opt.value)}
                          className={cn(
                            "flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
                            personality === opt.value
                              ? "border-bot-accent/50 bg-bot-accent/10 text-bot-accent shadow-glow-sm"
                              : "border-bot-border/30 bg-bot-elevated/30 text-bot-text hover:bg-bot-elevated/50 hover:border-bot-accent/20",
                          )}
                        >
                          <span className="font-medium text-caption">{opt.label}</span>
                          <span className="text-[10px] text-bot-muted/70">{opt.description}</span>
                        </button>
                      ))}
                    </div>
                    {personality === "custom" && (
                      <textarea
                        className="w-full rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-2.5 text-caption text-bot-text outline-none focus:border-bot-accent/50 focus:shadow-glow-sm resize-y min-h-[80px] transition-all duration-200"
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="Enter a custom system prompt prefix..."
                      />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
                Skip permissions (bypass all tool approvals)
              </span>
            </label>
            <AnimatePresence>
              {skipPermissions && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-bot-red/30 bg-bot-red/5 px-4 py-3 text-caption text-bot-red">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Claude will be able to execute any command, read/write any file, and take
                      irreversible actions without confirmation. Use only for trusted tasks.
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-bot-border/40 px-4 py-2.5 text-body text-bot-muted hover:bg-bot-elevated/50 hover:text-bot-text transition-all duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl gradient-accent px-5 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
            >
              Create
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

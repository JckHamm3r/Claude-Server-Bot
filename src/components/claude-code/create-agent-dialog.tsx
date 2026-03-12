"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Sparkles, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import type { ClaudeAgent } from "@/lib/claude-db";

const AVAILABLE_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Agent"];
const AVAILABLE_MODELS = [
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

type Tab = "generate" | "manual";

interface AgentFormData {
  icon: string;
  name: string;
  description: string;
  model: string;
  allowed_tools: string[];
}

interface CreateAgentDialogProps {
  onClose: () => void;
  onSave: (data: AgentFormData) => void;
  initialData?: Partial<ClaudeAgent>;
  isEditing?: boolean;
}


export function CreateAgentDialog({
  onClose,
  onSave,
  initialData,
  isEditing = false,
}: CreateAgentDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>(isEditing ? "manual" : "generate");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [form, setForm] = useState<AgentFormData>({
    icon: initialData?.icon ?? "",
    name: initialData?.name ?? "",
    description: initialData?.description ?? "",
    model: initialData?.model ?? "claude-opus-4-6",
    allowed_tools: initialData?.allowed_tools ?? [],
  });
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  useEffect(() => {
    socketRef.current = getSocket();
    const socket = socketRef.current;

    const handleGenerated = ({ config }: { config: Partial<AgentFormData> }) => {
      setIsGenerating(false);
      if (config) {
        setForm((prev) => ({
          icon: config.icon ?? prev.icon,
          name: config.name ?? prev.name,
          description: config.description ?? prev.description,
          model: config.model ?? prev.model,
          allowed_tools: config.allowed_tools ?? prev.allowed_tools,
        }));
        setActiveTab("manual");
      }
    };

    const handleError = ({ message }: { message: string }) => {
      setIsGenerating(false);
      console.error("[create-agent] generation error:", message);
    };

    socket.on("claude:agent_generated", handleGenerated);
    socket.on("claude:error", handleError);

    return () => {
      socket.off("claude:agent_generated", handleGenerated);
      socket.off("claude:error", handleError);
    };
  }, []);

  function handleGenerate() {
    if (!generatePrompt.trim() || isGenerating) return;
    setIsGenerating(true);
    socketRef.current?.emit("claude:generate_agent", { description: generatePrompt.trim() });
  }

  function handleToolToggle(tool: string) {
    setForm((prev) => ({
      ...prev,
      allowed_tools: prev.allowed_tools.includes(tool)
        ? prev.allowed_tools.filter((t) => t !== tool)
        : [...prev.allowed_tools, tool],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.description.trim()) return;
    onSave({
      ...form,
      icon: form.icon.trim() || "🤖",
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-bot-border bg-bot-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bot-border px-6 py-4">
          <h2 className="text-subtitle font-semibold text-bot-text">
            {isEditing ? "Edit Agent" : "New Agent"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated hover:text-bot-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs (only show for new agents) */}
        {!isEditing && (
          <div className="flex border-b border-bot-border px-6">
            <TabButton
              active={activeTab === "generate"}
              onClick={() => setActiveTab("generate")}
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label="Generate with Claude"
            />
            <TabButton
              active={activeTab === "manual"}
              onClick={() => setActiveTab("manual")}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              label="Manual Setup"
            />
          </div>
        )}

        <div className="px-6 py-5">
          {/* Generate tab */}
          {activeTab === "generate" && !isEditing && (
            <div className="flex flex-col gap-4">
              <p className="text-caption text-bot-muted">
                Describe what you want the agent to do and Claude will generate a configuration.
              </p>
              <textarea
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder="e.g. An agent that analyzes TypeScript code for potential bugs and suggests improvements..."
                rows={5}
                className="w-full resize-none rounded-lg border border-bot-border bg-bot-elevated px-3 py-2.5 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
              />
              <button
                onClick={handleGenerate}
                disabled={!generatePrompt.trim() || isGenerating}
                className="flex items-center justify-center gap-2 rounded-lg bg-bot-accent px-4 py-2.5 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Agent
                  </>
                )}
              </button>
              {isGenerating && (
                <p className="text-caption text-bot-muted text-center">
                  Claude is crafting your agent configuration…
                </p>
              )}
            </div>
          )}

          {/* Manual / edit tab */}
          {(activeTab === "manual" || isEditing) && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex gap-3">
                {/* Icon */}
                <div className="flex flex-col gap-1.5 w-20 shrink-0">
                  <label className="text-caption font-medium text-bot-muted">Icon</label>
                  <input
                    type="text"
                    value={form.icon}
                    onChange={(e) => setForm((p) => ({ ...p, icon: e.target.value }))}
                    placeholder="🤖"
                    className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-center text-xl outline-none focus:border-bot-accent transition-colors"
                    maxLength={4}
                  />
                </div>

                {/* Name */}
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-caption font-medium text-bot-muted">
                    Name <span className="text-bot-red">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="My Agent"
                    required
                    className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <label className="text-caption font-medium text-bot-muted">
                  Description <span className="text-bot-red">*</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Describe what this agent does…"
                  required
                  rows={3}
                  className="w-full resize-none rounded-lg border border-bot-border bg-bot-elevated px-3 py-2.5 text-body text-bot-text placeholder-bot-muted outline-none focus:border-bot-accent transition-colors"
                />
              </div>

              {/* Model */}
              <div className="flex flex-col gap-1.5">
                <label className="text-caption font-medium text-bot-muted">Model</label>
                <select
                  value={form.model}
                  onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                  className="w-full rounded-lg border border-bot-border bg-bot-elevated px-3 py-2 text-body text-bot-text outline-none focus:border-bot-accent transition-colors"
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Allowed Tools */}
              <div className="flex flex-col gap-1.5">
                <label className="text-caption font-medium text-bot-muted">
                  Allowed Tools
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_TOOLS.map((tool) => {
                    const checked = form.allowed_tools.includes(tool);
                    return (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => handleToolToggle(tool)}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-caption font-medium transition-colors",
                          checked
                            ? "border-bot-accent bg-bot-accent/10 text-bot-accent"
                            : "border-bot-border bg-bot-elevated text-bot-muted hover:border-bot-accent/50 hover:text-bot-text",
                        )}
                      >
                        {tool}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-bot-border px-4 py-2 text-body text-bot-muted hover:bg-bot-elevated hover:text-bot-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!form.name.trim() || !form.description.trim()}
                  className="rounded-lg bg-bot-accent px-4 py-2 text-body font-medium text-white hover:bg-bot-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isEditing ? "Save Changes" : "Create Agent"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-1 py-3 mr-5 text-body font-medium transition-colors",
        active
          ? "border-bot-accent text-bot-accent"
          : "border-transparent text-bot-muted hover:text-bot-text",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Sparkles, SlidersHorizontal, Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import type { ClaudeAgent } from "@/lib/claude-db";
import { motion } from "framer-motion";

import { ModelSelector } from "@/components/claude-code/model-selector";

const AVAILABLE_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Agent"];

type Tab = "generate" | "manual";

interface AgentFormData {
  icon: string;
  name: string;
  description: string;
  model: string;
  allowed_tools: string[];
}

interface Memory {
  id: string;
  title: string;
  content: string;
  is_global: boolean;
  assigned_agent_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface CreateAgentDialogProps {
  onClose: () => void;
  onSave: (data: AgentFormData) => void;
  initialData?: Partial<ClaudeAgent>;
  isEditing?: boolean;
  globalMemoryCount?: number;
}


export function CreateAgentDialog({
  onClose,
  onSave,
  initialData,
  isEditing = false,
  globalMemoryCount = 0,
}: CreateAgentDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>(isEditing ? "manual" : "generate");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [form, setForm] = useState<AgentFormData>({
    icon: initialData?.icon ?? "",
    name: initialData?.name ?? "",
    description: initialData?.description ?? "",
    model: initialData?.model ?? "claude-sonnet-4-6",
    allowed_tools: initialData?.allowed_tools ?? [],
  });
  const [agentMemories, setAgentMemories] = useState<Memory[]>([]);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
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

    const handleAgentMemories = ({ agentId, memories }: { agentId: string; memories: Memory[] }) => {
      if (initialData?.id && agentId === initialData.id) {
        setAgentMemories(memories.filter((m) => !m.is_global));
      }
    };

    socket.on("claude:agent_generated", handleGenerated);
    socket.on("claude:error", handleError);
    socket.on("claude:agent_memories", handleAgentMemories);

    if (isEditing && initialData?.id) {
      socket.emit("claude:get_agent_memories", { agentId: initialData.id });
    }

    return () => {
      socket.off("claude:agent_generated", handleGenerated);
      socket.off("claude:error", handleError);
      socket.off("claude:agent_memories", handleAgentMemories);
    };
  }, [isEditing, initialData?.id]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative w-full max-w-lg glass-heavy rounded-2xl shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-bot-border/30 px-6 py-4">
          <h2 className="text-subtitle font-bold text-bot-text">
            {isEditing ? "Edit Agent" : "New Agent"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated/50 hover:text-bot-text transition-all duration-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!isEditing && (
          <div className="flex border-b border-bot-border/30 px-6">
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
                className="w-full resize-none rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 focus:shadow-glow-sm transition-all duration-200"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
              />
              <button
                onClick={handleGenerate}
                disabled={!generatePrompt.trim() || isGenerating}
                className="flex items-center justify-center gap-2 rounded-xl gradient-accent px-4 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
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
                  Claude is crafting your agent configuration...
                </p>
              )}
            </div>
          )}

          {(activeTab === "manual" || isEditing) && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 w-20 shrink-0">
                  <label className="text-caption font-medium text-bot-muted">Icon</label>
                  <input
                    type="text"
                    value={form.icon}
                    onChange={(e) => setForm((p) => ({ ...p, icon: e.target.value }))}
                    placeholder="🤖"
                    className="w-full rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-3 py-2.5 text-center text-xl outline-none focus:border-bot-accent/50 focus:shadow-glow-sm transition-all duration-200"
                    maxLength={4}
                  />
                </div>

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
                    className="w-full rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-2.5 text-body text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 focus:shadow-glow-sm transition-all duration-200"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-caption font-medium text-bot-muted">
                  Description <span className="text-bot-red">*</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Describe what this agent does..."
                  required
                  rows={3}
                  className="w-full resize-none rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 focus:shadow-glow-sm transition-all duration-200"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-caption font-medium text-bot-muted">Model</label>
                <ModelSelector
                  value={form.model}
                  onChange={(model) => setForm((p) => ({ ...p, model }))}
                />
              </div>

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
                          "rounded-xl border px-3 py-1.5 text-caption font-medium transition-all duration-200",
                          checked
                            ? "border-bot-accent/50 bg-bot-accent/10 text-bot-accent shadow-glow-sm"
                            : "border-bot-border/40 bg-bot-elevated/40 text-bot-muted hover:border-bot-accent/30 hover:text-bot-text",
                        )}
                      >
                        {tool}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isEditing && (
                <div className="rounded-xl border border-bot-border/25 bg-bot-elevated/20 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setMemoriesOpen((o) => !o)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-caption font-medium text-bot-muted hover:text-bot-text transition-colors duration-200"
                  >
                    <span className="flex items-center gap-1.5">
                      <Brain className="h-3.5 w-3.5" />
                      Assigned Memories
                      <span className="rounded-md bg-bot-elevated/60 px-1.5 py-0.5 text-[10px] font-semibold text-bot-muted">
                        {agentMemories.length} specific + {globalMemoryCount} global
                      </span>
                    </span>
                    {memoriesOpen
                      ? <ChevronDown className="h-3.5 w-3.5" />
                      : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>

                  {memoriesOpen && (
                    <div className="border-t border-bot-border/25 px-4 py-3 flex flex-col gap-2">
                      <p className="text-[11px] text-bot-muted/60">
                        Global memories are always included. Manage assignments from the Memory tab.
                      </p>
                      {agentMemories.length === 0 ? (
                        <p className="text-[11px] text-bot-muted/50 italic">No agent-specific memories assigned.</p>
                      ) : (
                        agentMemories.map((m) => (
                          <div key={m.id} className="rounded-lg bg-bot-elevated/30 border border-bot-border/20 px-3 py-2">
                            <p className="text-[12px] font-medium text-bot-text leading-tight mb-0.5">{m.title}</p>
                            <p className="text-[11px] text-bot-muted/70 leading-snug line-clamp-2">
                              {m.content.slice(0, 80)}{m.content.length > 80 ? "…" : ""}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-bot-border/40 px-4 py-2.5 text-body text-bot-muted hover:bg-bot-elevated/50 hover:text-bot-text transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!form.name.trim() || !form.description.trim()}
                  className="rounded-xl gradient-accent px-5 py-2.5 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {isEditing ? "Save Changes" : "Create Agent"}
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
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
        "flex items-center gap-1.5 border-b-2 px-1 py-3 mr-5 text-body font-medium transition-all duration-200",
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

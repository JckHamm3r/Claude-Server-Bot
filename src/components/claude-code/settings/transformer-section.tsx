"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Sparkles,
  Palette,
  Bell,
  Globe,
  BarChart,
  Brain,
  Layout,
  ArrowLeft,
  Plus,
  RefreshCw,
} from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";
import type { TransformerRecord, TransformerType } from "@/lib/transformer-types";
import { TransformerCard } from "./transformer-card";
import { CustomizationSection } from "./customization-section";

type View = "gallery" | "chat";

const STARTER_IDEAS = [
  {
    name: "Dark Purple Theme",
    description: "A rich dark purple color scheme for the entire interface.",
    type: "theme" as TransformerType,
    Icon: Palette,
  },
  {
    name: "Slack Notifications",
    description: "Post AI session events and summaries to a Slack channel.",
    type: "hook" as TransformerType,
    Icon: Bell,
  },
  {
    name: "Custom Welcome Page",
    description: "A branded static landing page served from your instance.",
    type: "static" as TransformerType,
    Icon: Globe,
  },
  {
    name: "Usage Dashboard",
    description: "REST endpoint exposing token usage and session analytics.",
    type: "api" as TransformerType,
    Icon: BarChart,
  },
  {
    name: "Strict Engineer Mode",
    description: "System prompt that enforces terse, code-first responses.",
    type: "prompt" as TransformerType,
    Icon: Brain,
  },
  {
    name: "Chat Widget Pro",
    description: "Embeddable chat widget with custom branding and theming.",
    type: "widget" as TransformerType,
    Icon: Layout,
  },
];

const TYPE_BADGE_COLORS: Record<TransformerType, string> = {
  theme: "bg-bot-blue/15 text-bot-blue border-bot-blue/25",
  prompt: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  api: "bg-bot-green/15 text-bot-green border-bot-green/25",
  hook: "bg-bot-amber/15 text-bot-amber border-bot-amber/25",
  static: "bg-teal-500/15 text-teal-400 border-teal-500/25",
  widget: "bg-pink-500/15 text-pink-400 border-pink-500/25",
};

export function TransformerSection() {
  const [view, setView] = useState<View>("gallery");
  const [transformers, setTransformers] = useState<TransformerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchTransformers = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/transformers"));
      if (res.ok) {
        const data = (await res.json()) as TransformerRecord[];
        setTransformers(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransformers();
  }, [fetchTransformers]);

  const handleToggleEnabled = useCallback((id: string) => {
    setTransformers((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, enabled: !t.enabled } : t
      )
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setTransformers((prev) => prev.filter((t) => t.id !== id));
    setExpandedId((prev) => (prev === id ? null : prev));
  }, []);

  const handleEdit = useCallback((_transformer: TransformerRecord) => {
    setView("chat");
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const openChat = useCallback(() => {
    setView("chat");
  }, []);

  const goBack = useCallback(() => {
    setView("gallery");
    fetchTransformers();
  }, [fetchTransformers]);

  // Chat view
  if (view === "chat") {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 mb-3">
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-xs text-bot-muted hover:text-bot-text transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to gallery
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <CustomizationSection />
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/60 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/40 animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-bot-accent/20 animate-bounce [animation-delay:300ms]" />
      </div>
    );
  }

  // Empty state
  if (transformers.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 px-4 max-w-3xl mx-auto w-full">
        {/* Hero */}
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full bg-bot-accent/20 blur-2xl scale-150" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-bot-accent/30 bg-bot-surface">
            <Sparkles className="h-7 w-7 text-bot-accent" />
          </div>
        </div>

        <h2 className="text-xl font-bold text-bot-text text-center mb-2">
          Transform Your Instance
        </h2>
        <p className="text-sm text-bot-muted text-center max-w-md leading-relaxed mb-8">
          Create custom themes, AI behaviors, integrations, and more — all
          update-safe and version-controlled.
        </p>

        {/* Starter ideas grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full mb-8">
          {STARTER_IDEAS.map((idea) => (
            <div
              key={idea.name}
              className="relative rounded-xl border border-bot-border/50 bg-bot-surface/50 p-4 opacity-60"
            >
              <div
                className={cn(
                  "mb-3 flex h-8 w-8 items-center justify-center rounded-lg border",
                  TYPE_BADGE_COLORS[idea.type]
                )}
              >
                <idea.Icon className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-sm font-semibold text-bot-text">
                  {idea.name}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    TYPE_BADGE_COLORS[idea.type]
                  )}
                >
                  {idea.type}
                </span>
              </div>
              <p className="text-xs text-bot-muted leading-relaxed">
                {idea.description}
              </p>
              <div className="absolute top-3 right-3">
                <span className="text-[10px] font-medium text-bot-muted/60 bg-bot-elevated rounded-full px-2 py-0.5 border border-bot-border/30">
                  Coming soon
                </span>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={openChat}
          className="flex items-center gap-2 rounded-xl bg-bot-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-bot-accent/25 hover:bg-bot-accent/90 active:scale-[0.98] transition-all"
        >
          <Sparkles className="h-4 w-4" />
          Create with AI
        </button>
      </div>
    );
  }

  // Gallery view
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-bot-accent" />
          <h2 className="text-base font-bold text-bot-text">
            Transformer Gallery
          </h2>
          <span className="ml-1 rounded-full bg-bot-elevated border border-bot-border px-2 py-0.5 text-[11px] text-bot-muted">
            {transformers.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchTransformers}
            className="flex items-center gap-1.5 rounded-lg border border-bot-border px-3 py-1.5 text-xs text-bot-muted hover:text-bot-text hover:bg-bot-elevated transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={openChat}
            className="flex items-center gap-1.5 rounded-lg bg-bot-accent/10 border border-bot-accent/20 px-3 py-1.5 text-xs font-medium text-bot-accent hover:bg-bot-accent/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Transformer
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-4">
          {transformers.map((transformer) => (
            <TransformerCard
              key={transformer.id}
              transformer={transformer}
              expanded={expandedId === transformer.id}
              onToggleExpand={() => handleToggleExpand(transformer.id)}
              onToggleEnabled={handleToggleEnabled}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onRefresh={fetchTransformers}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

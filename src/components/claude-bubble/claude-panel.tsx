"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatTab } from "@/components/claude-code/chat-tab";
import { AgentsTab } from "@/components/claude-code/agents-tab";
import { PlanModeTab } from "@/components/claude-code/plan-mode-tab";
import { MemoryTab } from "@/components/claude-code/memory-tab";
import { SettingsPanel } from "@/components/claude-code/settings-panel";

interface ClaudePanelProps {
  onClose: () => void;
}

type TabKey = "chat" | "agents" | "plan" | "memory" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "agents", label: "Agents" },
  { key: "plan", label: "Plan Mode" },
  { key: "memory", label: "Memory" },
  { key: "settings", label: "Settings" },
];

export function ClaudePanel({ onClose }: ClaudePanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Slide-up animation on mount
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setVisible(true);
      });
    });
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          "relative flex flex-col w-full max-w-5xl h-[90vh] bg-bot-bg border-l border-t border-bot-border rounded-tl-2xl shadow-2xl transition-transform duration-300",
          visible ? "translate-y-0" : "translate-y-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bot-border px-4 py-3 shrink-0">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-body font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-bot-accent/10 text-bot-accent"
                    : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated hover:text-bot-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === "chat" && <ChatTab />}
          {activeTab === "agents" && <AgentsTab />}
          {activeTab === "plan" && <PlanModeTab />}
          {activeTab === "memory" && <MemoryTab />}
          {activeTab === "settings" && <SettingsPanel />}
        </div>
      </div>
    </div>
  );
}

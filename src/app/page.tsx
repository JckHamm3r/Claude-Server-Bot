"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChatTab } from "@/components/claude-code/chat-tab";
import { AgentsTab } from "@/components/claude-code/agents-tab";
import { PlanModeTab } from "@/components/claude-code/plan-mode-tab";
import { MemoryTab } from "@/components/claude-code/memory-tab";
import { SettingsPanel } from "@/components/claude-code/settings-panel";

type TabKey = "chat" | "agents" | "plan" | "memory" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "agents", label: "Agents" },
  { key: "plan", label: "Plan Mode" },
  { key: "memory", label: "Memory" },
  { key: "settings", label: "Settings" },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("chat");

  return (
    <div className="flex flex-col h-screen bg-bot-bg">
      {/* Tab bar */}
      <div className="flex items-center border-b border-bot-border px-4 py-2 shrink-0">
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
  );
}

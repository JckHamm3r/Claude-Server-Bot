"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { ChatTab } from "@/components/claude-code/chat-tab";
import { AgentsTab } from "@/components/claude-code/agents-tab";
import { PlanModeTab } from "@/components/claude-code/plan-mode-tab";
import { MemoryTab } from "@/components/claude-code/memory-tab";
import { SettingsPanel } from "@/components/claude-code/settings-panel";
import { TerminalTab } from "@/components/claude-code/terminal-tab";
import { MessageSquare, Bot, ListChecks, Brain, Settings, TerminalSquare } from "lucide-react";
import { motion } from "framer-motion";
import { NotificationBell } from "@/components/claude-code/notification-bell";

type TabKey = "chat" | "agents" | "plan" | "memory" | "settings" | "terminal";

const BASE_TABS: { key: TabKey; label: string; icon: typeof MessageSquare; adminOnly?: boolean }[] = [
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "agents", label: "Agents", icon: Bot },
  { key: "plan", label: "Plan Mode", icon: ListChecks },
  { key: "memory", label: "Memory", icon: Brain },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "terminal", label: "Terminal", icon: TerminalSquare, adminOnly: true },
];

export default function DashboardPage() {
  const { data: session } = useSession();
  const isAdmin = Boolean((session?.user as { isAdmin?: boolean })?.isAdmin);
  const TABS = BASE_TABS.filter((t) => !t.adminOnly || isAdmin);

  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = tabRefs.current[activeTab];
    if (el) {
      const parent = el.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        setIndicatorStyle({
          left: elRect.left - parentRect.left,
          width: elRect.width,
        });
      }
    }
  }, [activeTab]);

  return (
    <div className="flex flex-col h-screen bg-bot-bg">
      {/* Tab bar */}
      <div className="relative border-b border-bot-border/60 bg-bot-surface/80 backdrop-blur-md shrink-0">
        <div className="flex items-center justify-between px-4 py-1">
          <div className="relative flex items-center gap-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  ref={(el) => { tabRefs.current[tab.key] = el; }}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "relative flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-body font-medium transition-colors duration-200",
                    isActive
                      ? "text-bot-text"
                      : "text-bot-muted hover:text-bot-text/80 hover:bg-bot-elevated/40",
                  )}
                >
                  <Icon className={cn("h-4 w-4", isActive && "text-bot-accent")} />
                  {tab.label}
                </button>
              );
            })}
            <motion.div
              className="absolute bottom-0 h-0.5 rounded-full gradient-accent"
              animate={indicatorStyle}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          </div>
          <NotificationBell />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "chat" && <ChatTab />}
        {activeTab === "agents" && <AgentsTab />}
        {activeTab === "plan" && <PlanModeTab />}
        {activeTab === "memory" && <MemoryTab />}
        {activeTab === "settings" && <SettingsPanel />}
        {activeTab === "terminal" && <TerminalTab isAdmin={isAdmin} />}
      </div>
    </div>
  );
}

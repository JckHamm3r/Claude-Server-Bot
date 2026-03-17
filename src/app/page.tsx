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
import { FilesTab } from "@/components/claude-code/files-tab";
import { JobsTab } from "@/components/claude-code/jobs-tab";
import { MessageSquare, Bot, ListChecks, Brain, Settings, TerminalSquare, FolderTree, Timer } from "lucide-react";
import { motion } from "framer-motion";
import { NotificationBell } from "@/components/claude-code/notification-bell";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";
import { useUserProfile } from "@/hooks/use-user-profile";

type TabKey = "chat" | "agents" | "plan" | "jobs" | "memory" | "settings" | "terminal" | "files";

const ALL_TABS: { key: TabKey; label: string; icon: typeof MessageSquare }[] = [
  { key: "chat",     label: "Chat",      icon: MessageSquare },
  { key: "plan",     label: "Plan Mode", icon: ListChecks },
  { key: "agents",   label: "Agents",    icon: Bot },
  { key: "memory",   label: "Memory",    icon: Brain },
  { key: "files",    label: "Files",     icon: FolderTree },
  { key: "terminal", label: "Terminal",  icon: TerminalSquare },
  { key: "jobs",     label: "Jobs",      icon: Timer },
];

export default function DashboardPage() {
  const { data: session } = useSession();
  const isAdmin = Boolean((session?.user as { isAdmin?: boolean })?.isAdmin);
  const profile = useUserProfile();
  // Admins (groupPermissions=null) see all tabs; others are limited to their group's visible_tabs
  const allowedTabKeys: string[] = profile.isAdmin
    ? ALL_TABS.map((t) => t.key)
    : (profile.groupPermissions?.platform?.visible_tabs ?? ["chat"]);

  const TABS = ALL_TABS.filter((t) => allowedTabKeys.includes(t.key));

  const [activeTab, setActiveTab] = useState<TabKey>("chat");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Switch to chat tab when AI help is requested from any settings section
  useEffect(() => {
    const handler = () => setActiveTab("chat");
    window.addEventListener("octoby:open-ai-help", handler);
    return () => window.removeEventListener("octoby:open-ai-help", handler);
  }, []);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = tabRefs.current[activeTab];
    if (!el) {
      setIndicatorStyle({ left: 0, width: 0 });
      return;
    }
    const parent = el.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setIndicatorStyle({
        left: elRect.left - parentRect.left,
        width: elRect.width,
      });
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
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              onClick={() => setActiveTab("settings")}
              className={cn(
                "p-2 rounded-lg transition-colors",
                activeTab === "settings"
                  ? "text-bot-accent bg-bot-accent/10"
                  : "text-bot-muted hover:text-bot-text hover:bg-bot-elevated/40",
              )}
              title="Settings"
            >
              <Settings className="h-[18px] w-[18px]" />
            </button>
            <UserProfileDropdown />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "chat" && <ChatTab />}
        {activeTab === "agents" && <AgentsTab />}
        {activeTab === "plan" && <PlanModeTab />}
        {activeTab === "jobs" && <JobsTab />}
        {activeTab === "memory" && <MemoryTab />}
        {activeTab === "settings" && <SettingsPanel />}
        {activeTab === "files" && <FilesTab />}
        {/* Keep TerminalTab mounted always (when admin) so xterm instances and PTYs stay alive */}
        {isAdmin && (
          <div className="h-full" style={{ display: activeTab === "terminal" ? "flex" : "none", flexDirection: "column" }}>
            <TerminalTab isAdmin={isAdmin} />
          </div>
        )}
      </div>
    </div>
  );
}

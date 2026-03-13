"use client";

import { useState, useEffect } from "react";
import { ClaudeBubble, useIsRunning } from "@/components/claude-bubble/bubble";
import { ClaudePanel } from "@/components/claude-bubble/claude-panel";

export default function DashboardPage() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [projectRoot, setProjectRoot] = useState("");
  const isRunning = useIsRunning();

  const hostname = typeof window !== "undefined" ? window.location.hostname : "";

  useEffect(() => {
    // Fetch project root only after authentication (not baked into client bundle)
    const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
    const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
    const bp = slug ? `/${prefix}/${slug}` : "";
    fetch(`${bp}/api/bot-identity`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.projectRoot) setProjectRoot(data.projectRoot);
      })
      .catch(() => {});
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-bot-bg select-none">
      <div className="text-center space-y-2">
        <h1 className="text-h1 font-semibold text-bot-text">{hostname}</h1>
        {projectRoot && (
          <p className="text-body text-bot-muted font-mono">{projectRoot}</p>
        )}
        <p className="text-caption text-bot-muted">
          Click the bubble to open Claude Code
        </p>
      </div>

      <ClaudeBubble onOpen={() => setPanelOpen(true)} isRunning={isRunning} />

      {panelOpen && (
        <ClaudePanel onClose={() => setPanelOpen(false)} />
      )}
    </main>
  );
}

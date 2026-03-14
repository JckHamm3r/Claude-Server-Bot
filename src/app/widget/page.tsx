"use client";

import { ChatTab } from "@/components/claude-code/chat-tab";

export default function WidgetPage() {
  return (
    <div className="flex flex-col h-screen bg-bot-bg">
      <ChatTab isWidget />
    </div>
  );
}

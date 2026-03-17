"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { cn, apiUrl } from "@/lib/utils";

interface AiJobBuilderProps {
  onClose: () => void;
  onJobCreated: (data: Record<string, unknown>) => void;
}

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

const SYSTEM_CONTEXT = `You are a Job Builder assistant for the Octoby AI platform. Your purpose is to help the user create a scheduled job (automated task) that will run on their server using systemd timers.

You need to determine:
1. What task the user wants to automate (backup, cleanup, monitoring, etc.)
2. The path to a script that should run (the user must have an existing script file)
3. How often it should run (schedule)
4. Any additional configuration (working directory, environment variables, timeout)

Guidelines:
- Be friendly and conversational but efficient
- Ask one or two questions at a time, not everything at once
- The script must be a file path on the server (not inline code)
- Schedules use systemd OnCalendar format. Common examples:
  - Every 5 min: *-*-* *:0/5:00
  - Hourly: *-*-* *:00:00  
  - Daily 2am: *-*-* 02:00:00
  - Weekly Mon 9am: Mon *-*-* 09:00:00
- When you have enough info, present a summary and ask for confirmation
- When confirmed, respond with EXACTLY this JSON block (and nothing else after it):

\`\`\`job-config
{
  "name": "Job Name",
  "description": "What this job does",
  "script_path": "/path/to/script.sh",
  "schedule": "*-*-* 02:00:00",
  "schedule_display": "Daily at 2:00 AM",
  "working_directory": "",
  "timeout_seconds": 0,
  "notify_on_failure": true,
  "notify_on_success": false
}
\`\`\`

Start by greeting the user and asking what they'd like to automate.`;

export function AiJobBuilder({ onClose, onJobCreated }: AiJobBuilderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [extractedJob, setExtractedJob] = useState<Record<string, unknown> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  const sendToAi = useCallback(async (conversationMessages: ChatMessage[]) => {
    setLoading(true);
    try {
      const response = await fetch(apiUrl("/api/jobs/ai-builder"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationMessages,
          systemContext: SYSTEM_CONTEXT,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error || "AI request failed");
      }

      const data = await response.json() as { reply: string };
      const assistantMsg: ChatMessage = { role: "assistant", content: data.reply };
      setMessages((prev) => [...prev, assistantMsg]);

      const jobMatch = data.reply.match(/```job-config\n([\s\S]*?)```/);
      if (jobMatch) {
        try {
          const jobConfig = JSON.parse(jobMatch[1]);
          setExtractedJob(jobConfig);
        } catch { /* invalid JSON, ignore */ }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.` },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      sendToAi([]);
    }
  }, [sendToAi]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    sendToAi(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCreateJob = () => {
    if (extractedJob) {
      onJobCreated(extractedJob);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg h-[600px] max-h-[80vh] flex flex-col rounded-2xl border border-bot-border/30 bg-bot-bg shadow-2xl animate-fadeUp">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bot-border/30 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-accent">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-body font-bold text-bot-text">AI Job Builder</h3>
              <p className="text-[10px] text-bot-muted">Describe what you want to automate</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-bot-muted hover:bg-bot-elevated/60 hover:text-bot-text transition-all">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-caption",
                  msg.role === "user"
                    ? "bg-bot-accent text-white rounded-br-md"
                    : "bg-bot-surface border border-bot-border/20 text-bot-text rounded-bl-md",
                )}
              >
                <div className="whitespace-pre-wrap">{
                  msg.content.replace(/```job-config\n[\s\S]*?```/g, "").trim() || msg.content
                }</div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-bot-surface border border-bot-border/20 rounded-2xl rounded-bl-md px-4 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-bot-accent" />
              </div>
            </div>
          )}

          {extractedJob && (
            <div className="flex justify-center">
              <button
                onClick={handleCreateJob}
                className="flex items-center gap-2 rounded-xl gradient-accent px-6 py-3 text-body font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200 animate-fadeUp"
              >
                <CheckCircle2 className="h-4 w-4" />
                Create This Job
              </button>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-bot-border/30 px-5 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={extractedJob ? "Make changes or create the job above" : "Describe what you want to automate..."}
              disabled={loading}
              className="flex-1 rounded-xl border border-bot-border/30 bg-bot-elevated/30 px-4 py-2.5 text-caption text-bot-text placeholder:text-bot-muted/40 focus:outline-none focus:border-bot-accent/50 focus:ring-1 focus:ring-bot-accent/20 transition-all disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl gradient-accent text-white disabled:opacity-50 hover:brightness-110 active:scale-[0.95] transition-all"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

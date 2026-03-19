"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";

interface AgentFormData {
  icon: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  allowed_tools: string[];
  skip_permissions: boolean;
  trigger_phrases: string[];
}

interface AgentBuilderChatProps {
  onApply: (config: Partial<AgentFormData>) => void;
  onClose: () => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export function AgentBuilderChat({ onApply, onClose: _onClose }: AgentBuilderChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<Partial<AgentFormData> | null>(null);
  const builderIdRef = useRef(crypto.randomUUID());
  const hasStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const socket = getSocket();
    const builderId = builderIdRef.current;

    const handleChunk = (data: { builderId: string; content: string }) => {
      if (data.builderId !== builderId) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.isStreaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content + data.content }];
        }
        return [...prev, { role: "assistant", content: data.content, isStreaming: true }];
      });
    };

    const handleDone = (data: { builderId: string; content: string }) => {
      if (data.builderId !== builderId) return;
      setIsStreaming(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.isStreaming) {
          return [...prev.slice(0, -1), { role: "assistant", content: data.content || last.content }];
        }
        return [...prev, { role: "assistant", content: data.content }];
      });
    };

    const handleComplete = (data: { builderId: string; config: Partial<AgentFormData>; content: string }) => {
      if (data.builderId !== builderId) return;
      setIsStreaming(false);
      setPendingConfig(data.config);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.isStreaming) {
          return [...prev.slice(0, -1), { role: "assistant", content: data.content || last.content }];
        }
        return [...prev, { role: "assistant", content: data.content }];
      });
    };

    socket.on("claude:agent_builder_chunk", handleChunk);
    socket.on("claude:agent_builder_done", handleDone);
    socket.on("claude:agent_builder_complete", handleComplete);

    return () => {
      socket.off("claude:agent_builder_chunk", handleChunk);
      socket.off("claude:agent_builder_done", handleDone);
      socket.off("claude:agent_builder_complete", handleComplete);
      socket.emit("claude:cancel_agent_builder", { builderId });
    };
  }, []);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const socket = getSocket();
    const builderId = builderIdRef.current;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsStreaming(true);
    setPendingConfig(null);

    if (!hasStartedRef.current) {
      socket.emit("claude:start_agent_builder", { builderId, initialMessage: text });
      hasStartedRef.current = true;
    } else {
      socket.emit("claude:agent_builder_message", { builderId, message: text });
    }

    // Refocus textarea
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [input, isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[460px]">
      {/* Chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 py-3 space-y-3 scrollbar-thin">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <div className="rounded-2xl bg-bot-accent/10 p-4">
              <Sparkles className="h-7 w-7 text-bot-accent" />
            </div>
            <p className="text-body font-medium text-bot-text">Describe the agent you want to build...</p>
            <p className="text-caption text-bot-muted/70 max-w-xs">
              I&apos;ll ask clarifying questions and generate a full configuration when ready.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-body leading-relaxed whitespace-pre-wrap break-words",
                msg.role === "user"
                  ? "bg-bot-accent/10 border border-bot-accent/25 text-bot-text"
                  : "bg-bot-elevated/30 border border-bot-border/20 text-bot-text",
              )}
            >
              {msg.content}
              {msg.isStreaming && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-bot-accent/70 rounded-sm animate-pulse align-text-bottom" />
              )}
            </div>
          </div>
        ))}

        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="bg-bot-elevated/30 border border-bot-border/20 rounded-2xl px-4 py-2.5">
              <Loader2 className="h-4 w-4 text-bot-muted animate-spin" />
            </div>
          </div>
        )}
      </div>

      {/* Config ready banner */}
      {pendingConfig && (
        <div className="mx-1 mb-2 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <span className="text-caption text-emerald-300 flex-1">Agent configuration ready</span>
          <button
            onClick={() => onApply(pendingConfig)}
            className="rounded-lg gradient-accent px-3.5 py-1.5 text-caption font-semibold text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] transition-all duration-200"
          >
            Apply Configuration
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-bot-border/30 px-1 pt-3 pb-1">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your agent or answer questions..."
            rows={2}
            disabled={isStreaming}
            className="flex-1 resize-none rounded-xl border border-bot-border/40 bg-bot-elevated/40 px-4 py-2.5 text-body text-bot-text placeholder:text-bot-muted/50 outline-none focus:border-bot-accent/50 focus:shadow-glow-sm disabled:opacity-50 transition-all duration-200"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 rounded-xl gradient-accent p-2.5 text-white shadow-glow-sm hover:shadow-glow-md hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-bot-muted/50 mt-1.5 text-right">
          {navigator.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to send
        </p>
      </div>
    </div>
  );
}

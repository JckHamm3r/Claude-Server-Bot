"use client";

import { useRef, KeyboardEvent, useState, useEffect, useCallback } from "react";
import { Send, Clock } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isRunning?: boolean;
  pendingCount?: number;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
}

// ── Slash command palette ────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { cmd: "/compact", args: "[focus]", desc: "Compact conversation history to save context" },
  { cmd: "/clear",   args: "",        desc: "Clear conversation context completely" },
  { cmd: "/memory",  args: "",        desc: "View and manage Claude's memory files" },
  { cmd: "/help",    args: "",        desc: "Show available commands and usage" },
  { cmd: "/cost",    args: "",        desc: "Show token usage for this session" },
  { cmd: "/doctor",  args: "",        desc: "Run diagnostics on Claude Code setup" },
  { cmd: "/status",  args: "",        desc: "Show current session info" },
  { cmd: "/init",    args: "",        desc: "Initialize Claude Code in a project" },
  { cmd: "/bug",     args: "",        desc: "Report a Claude Code bug" },
];

// ── Main component ───────────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  disabled,
  isRunning,
  pendingCount = 0,
  onTypingStart,
  onTypingStop,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // ── Slash palette state ──────────────────────────────────────────────────
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  // ── @ file picker state ──────────────────────────────────────────────────
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const [atFiles, setAtFiles] = useState<string[]>([]);
  const [atIndex, setAtIndex] = useState(0);
  const atDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────────

  const slashMatches = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(slashFilter) || c.cmd.slice(1).startsWith(slashFilter.slice(1)),
  );

  // ── Effects ──────────────────────────────────────────────────────────────

  // Fetch file suggestions when @ query changes
  useEffect(() => {
    if (!atOpen) return;
    if (atDebounceRef.current) clearTimeout(atDebounceRef.current);
    atDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/claude-code/files?q=${encodeURIComponent(atQuery)}`);
        if (!res.ok) return;
        const data = await res.json();
        setAtFiles(data.files ?? []);
        setAtIndex(0);
      } catch {
        /* ignore */
      }
    }, 150);
    return () => {
      if (atDebounceRef.current) clearTimeout(atDebounceRef.current);
    };
  }, [atOpen, atQuery]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const stopTyping = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTypingStop?.();
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, [onTypingStop]);

  function closePalettes() {
    setSlashOpen(false);
    setAtOpen(false);
  }

  function applySlashCommand(cmd: { cmd: string; args: string }) {
    const newVal = cmd.args ? `${cmd.cmd} ` : cmd.cmd;
    setValue(newVal);
    setSlashOpen(false);
    setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newVal.length, newVal.length);
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 180) + "px";
    }, 0);
  }

  function applyAtFile(file: string) {
    // Replace the @<partial> at the end of the textarea value
    const atPos = value.lastIndexOf("@");
    const newVal = value.slice(0, atPos) + `@${file}`;
    setValue(newVal);
    setAtOpen(false);
    setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newVal.length, newVal.length);
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 180) + "px";
    }, 0);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);

    // Typing indicator
    if (v && !isTypingRef.current) {
      isTypingRef.current = true;
      onTypingStart?.();
    }
    if (!v) {
      stopTyping();
    } else {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(stopTyping, 2000);
    }

    // Slash palette: open if value starts with /
    if (v.match(/^\//)) {
      setSlashFilter(v.split(" ")[0]); // only the first token
      setSlashIndex(0);
      setSlashOpen(true);
      setAtOpen(false);
    } else {
      setSlashOpen(false);
    }

    // @ picker: open if last @ is followed by non-space content (or just @)
    const atMatch = v.match(/@([^\s]*)$/);
    if (atMatch) {
      setAtQuery(atMatch[1]);
      setAtIndex(0);
      setAtOpen(true);
      setSlashOpen(false);
    } else {
      setAtOpen(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash palette navigation
    if (slashOpen && slashMatches.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySlashCommand(slashMatches[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    // Handle @ picker navigation
    if (atOpen && atFiles.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtIndex((i) => (i - 1 + atFiles.length) % atFiles.length);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtIndex((i) => (i + 1) % atFiles.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyAtFile(atFiles[atIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAtOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    stopTyping();
    closePalettes();
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  };

  const willQueue = isRunning && !disabled;
  const placeholder = disabled
    ? "Connecting…"
    : willQueue
    ? "Type to queue next message…"
    : "Message Claude Code… (/ for commands, @ for files)";

  return (
    <div className="border-t border-bot-border bg-bot-surface py-3">
      <div className="mx-auto max-w-3xl px-4">
        {/* Queued indicator */}
        {pendingCount > 0 && (
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-bot-muted">
            <Clock className="h-3 w-3 text-bot-amber" />
            <span className="text-bot-amber font-medium">
              {pendingCount} message{pendingCount > 1 ? "s" : ""} queued
            </span>
            <span className="opacity-50">— will send after Claude finishes</span>
          </div>
        )}

        {/* Slash command palette */}
        {slashOpen && slashMatches.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-xl border border-bot-border bg-bot-elevated shadow-lg">
            {slashMatches.map((c, i) => (
              <button
                key={c.cmd}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent textarea blur
                  applySlashCommand(c);
                }}
                className={`flex w-full items-baseline gap-3 px-3 py-2 text-left transition-colors ${
                  i === slashIndex
                    ? "bg-bot-accent/10 text-bot-accent"
                    : "text-bot-text hover:bg-bot-surface"
                }`}
              >
                <span className="font-mono text-body font-semibold">{c.cmd}</span>
                {c.args && (
                  <span className="font-mono text-caption text-bot-muted">{c.args}</span>
                )}
                <span className="ml-auto text-caption text-bot-muted">{c.desc}</span>
              </button>
            ))}
            <div className="border-t border-bot-border px-3 py-1.5 text-[10px] text-bot-muted">
              ↑↓ navigate · Enter/Tab select · Esc dismiss
            </div>
          </div>
        )}

        {/* @ file picker */}
        {atOpen && (
          <div className="mb-2 overflow-hidden rounded-xl border border-bot-border bg-bot-elevated shadow-lg">
            {atFiles.length === 0 ? (
              <div className="px-3 py-2 text-caption text-bot-muted">
                {atQuery ? "No matches" : "Loading…"}
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {atFiles.map((f, i) => (
                  <button
                    key={f}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyAtFile(f);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                      i === atIndex
                        ? "bg-bot-accent/10 text-bot-accent"
                        : "text-bot-text hover:bg-bot-surface"
                    }`}
                  >
                    <span className="font-mono text-caption">{f}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-bot-border px-3 py-1.5 text-[10px] text-bot-muted">
              ↑↓ navigate · Enter/Tab select · Esc dismiss
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            className={`flex-1 resize-none rounded-xl border px-4 py-2.5 text-body text-bot-text placeholder-bot-muted/60 outline-none transition-colors ${
              willQueue
                ? "border-bot-amber/40 bg-bot-elevated focus:border-bot-amber/70"
                : "border-bot-border bg-bot-elevated focus:border-bot-accent"
            } disabled:opacity-50`}
            style={{ maxHeight: 180 }}
          />
          <button
            onClick={submit}
            disabled={disabled || !value.trim()}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              willQueue
                ? "bg-bot-amber text-white hover:bg-bot-amber/80"
                : "bg-bot-accent text-white hover:bg-bot-accent/80"
            }`}
            title={willQueue ? "Queue message" : "Send"}
          >
            {willQueue ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

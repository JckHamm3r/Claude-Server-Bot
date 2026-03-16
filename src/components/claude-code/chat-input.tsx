"use client";

import { useRef, useImperativeHandle, forwardRef, KeyboardEvent, useState, useEffect, useCallback } from "react";
import { Send, Clock, Paperclip } from "lucide-react";
import { AttachmentPreview, type PendingAttachment } from "./attachment-preview";
import { QueuedMessages } from "./queued-messages";
import { apiUrl } from "@/lib/utils";

const FILE_SEARCH_DEBOUNCE_MS = 150;
const TYPING_STOP_DELAY_MS = 2_000;

interface ChatInputProps {
  onSend: (message: string, attachments?: string[]) => void;
  disabled?: boolean;
  isRunning?: boolean;
  pendingCount?: number;
  pendingQueue?: string[];
  onEditQueueItem?: (index: number, newContent: string) => void;
  onDeleteQueueItem?: (index: number) => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  sessionId?: string;
}

const SLASH_COMMANDS = [
  { cmd: "/compact", args: "[focus]",    desc: "Compact conversation history to save context" },
  { cmd: "/clear",   args: "",           desc: "Clear conversation context and start fresh" },
  { cmd: "/help",    args: "",           desc: "Show available commands" },
  { cmd: "/cost",    args: "",           desc: "Show token usage and cost for this session" },
  { cmd: "/status",  args: "",           desc: "Show current session info" },
  { cmd: "/memory",  args: "",           desc: "List and manage project memory files" },
  { cmd: "/rename",  args: "<name>",     desc: "Rename the current session" },
  { cmd: "/new",     args: "[name]",     desc: "Create a new session" },
  { cmd: "/export",  args: "[md|json]",  desc: "Export this session" },
  { cmd: "/model",   args: "<model>",    desc: "Switch the AI model" },
];

export interface ChatInputHandle {
  focus: () => void;
  setValue: (value: string) => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  onSend,
  disabled,
  isRunning,
  pendingCount = 0,
  pendingQueue = [],
  onEditQueueItem,
  onDeleteQueueItem,
  onTypingStart,
  onTypingStop,
  sessionId,
}, ref) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setValue: (v: string) => {
      setValue(v);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
  }), []);

  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const [atFiles, setAtFiles] = useState<string[]>([]);
  const [atIndex, setAtIndex] = useState(0);
  const atDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slashMatches = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(slashFilter) || c.cmd.slice(1).startsWith(slashFilter.slice(1)),
  );

  useEffect(() => {
    if (!atOpen) return;
    if (atDebounceRef.current) clearTimeout(atDebounceRef.current);
    atDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/claude-code/files?q=${encodeURIComponent(atQuery)}`));
        if (!res.ok) return;
        const data = await res.json();
        setAtFiles(data.files ?? []);
        setAtIndex(0);
      } catch (err) {
        console.warn("[chat-input] File search failed:", err);
      }
    }, FILE_SEARCH_DEBOUNCE_MS);
    return () => {
      if (atDebounceRef.current) clearTimeout(atDebounceRef.current);
    };
  }, [atOpen, atQuery]);

  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const addFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      newAttachments.push({ id, file, previewUrl });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const uploadAttachments = useCallback(async (): Promise<string[]> => {
    if (attachments.length === 0 || !sessionId) return [];

    const uploadIds: string[] = [];
    const updated = [...attachments];

    for (let i = 0; i < updated.length; i++) {
      const att = updated[i];
      if (att.uploadId) {
        uploadIds.push(att.uploadId);
        continue;
      }

      updated[i] = { ...att, uploading: true };
      setAttachments([...updated]);

      try {
        const formData = new FormData();
        formData.append("file", att.file);
        formData.append("sessionId", sessionId);

        const res = await fetch(apiUrl("/api/claude-code/upload"), {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Upload failed" }));
          updated[i] = { ...att, uploading: false, error: data.error };
          setAttachments([...updated]);
          continue;
        }

        const data = await res.json();
        updated[i] = { ...att, uploading: false, uploadId: data.id };
        setAttachments([...updated]);
        uploadIds.push(data.id);
      } catch {
        updated[i] = { ...att, uploading: false, error: "Upload failed" };
        setAttachments([...updated]);
      }
    }

    return uploadIds;
  }, [attachments, sessionId]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);

    if (v && !isTypingRef.current) {
      isTypingRef.current = true;
      onTypingStart?.();
    }
    if (!v) {
      stopTyping();
    } else {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(stopTyping, TYPING_STOP_DELAY_MS);
    }

    if (v.match(/^\//)) {
      setSlashFilter(v.split(" ")[0]);
      setSlashIndex(0);
      setSlashOpen(true);
      setAtOpen(false);
    } else {
      setSlashOpen(false);
    }

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

  const submit = async () => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    stopTyping();
    closePalettes();

    const uploadIds = await uploadAttachments();
    const hasErrors = attachments.some((a) => a.error);
    if (hasErrors && uploadIds.length === 0 && !trimmed) return;

    onSend(trimmed || "(attached files)", uploadIds.length > 0 ? uploadIds : undefined);
    setValue("");
    attachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
    setAttachments([]);
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const willQueue = isRunning && !disabled;
  const placeholder = disabled
    ? "Connecting..."
    : willQueue
    ? "Type to queue next message..."
    : "Message Claude Code... (/ for commands, @ for files)";

  return (
    <div className="border-t border-bot-border/30 bg-bot-surface/80 backdrop-blur-md py-3">
      <div className="mx-auto max-w-3xl px-4">
        {pendingCount > 0 && onEditQueueItem && onDeleteQueueItem && (
          <QueuedMessages
            queue={pendingQueue}
            onEdit={onEditQueueItem}
            onDelete={onDeleteQueueItem}
          />
        )}

        {slashOpen && slashMatches.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-xl glass-heavy shadow-float animate-scaleIn" role="listbox" aria-label="Slash commands" id="slash-palette">
            {slashMatches.map((c, i) => (
              <button
                key={c.cmd}
                role="option"
                aria-selected={i === slashIndex}
                id={`slash-option-${i}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySlashCommand(c);
                }}
                className={`flex w-full items-baseline gap-3 px-4 py-2.5 text-left transition-all duration-150 ${
                  i === slashIndex
                    ? "bg-bot-accent/10 text-bot-accent"
                    : "text-bot-text hover:bg-bot-elevated/40"
                }`}
              >
                <span className="font-mono text-body font-semibold">{c.cmd}</span>
                {c.args && (
                  <span className="font-mono text-caption text-bot-muted/60">{c.args}</span>
                )}
                <span className="ml-auto text-caption text-bot-muted/60">{c.desc}</span>
              </button>
            ))}
            <div className="border-t border-bot-border/30 px-4 py-2 text-[10px] text-bot-muted/50">
              ↑↓ navigate · Enter/Tab select · Esc dismiss
            </div>
          </div>
        )}

        {atOpen && (
          <div className="mb-2 overflow-hidden rounded-xl glass-heavy shadow-float animate-scaleIn" role="listbox" aria-label="File suggestions" id="file-palette">
            {atFiles.length === 0 ? (
              <div className="px-4 py-3 text-caption text-bot-muted/60">
                {atQuery ? "No matches" : "Loading..."}
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {atFiles.map((f, i) => (
                  <button
                    key={f}
                    role="option"
                    aria-selected={i === atIndex}
                    id={`file-option-${i}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyAtFile(f);
                    }}
                    className={`flex w-full items-center gap-2 px-4 py-2.5 text-left transition-all duration-150 ${
                      i === atIndex
                        ? "bg-bot-accent/10 text-bot-accent"
                        : "text-bot-text hover:bg-bot-elevated/40"
                    }`}
                  >
                    <span className="font-mono text-caption">{f}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-bot-border/30 px-4 py-2 text-[10px] text-bot-muted/50">
              ↑↓ navigate · Enter/Tab select · Esc dismiss
            </div>
          </div>
        )}

        <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />

        <div
          className="flex items-end gap-2"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-bot-muted hover:text-bot-text hover:bg-bot-elevated/50 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Attach file"
            aria-label="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Message input"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={slashOpen || atOpen}
            aria-controls={slashOpen ? "slash-palette" : atOpen ? "file-palette" : undefined}
            aria-activedescendant={slashOpen ? `slash-option-${slashIndex}` : atOpen ? `file-option-${atIndex}` : undefined}
            className={`flex-1 resize-none rounded-xl border px-4 py-3 text-body text-bot-text placeholder:text-bot-muted/50 outline-none transition-all duration-200 ${
              willQueue
                ? "border-bot-amber/30 bg-bot-elevated/40 focus:border-bot-amber/60 focus:shadow-[0_0_12px_2px_rgb(var(--bot-amber)/0.15)]"
                : "border-bot-border/40 bg-bot-elevated/40 focus:border-bot-accent/60 focus:shadow-glow-sm"
            } disabled:opacity-50`}
            style={{ maxHeight: 180 }}
          />
          <button
            onClick={submit}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 active:scale-90 ${
              willQueue
                ? "bg-bot-amber text-white hover:brightness-110 shadow-[0_0_12px_2px_rgb(var(--bot-amber)/0.2)]"
                : "gradient-accent text-white hover:brightness-110 shadow-glow-sm hover:shadow-glow-md"
            }`}
            title={willQueue ? "Queue message" : "Send"}
            aria-label={willQueue ? "Queue message" : "Send message"}
          >
            {willQueue ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
});

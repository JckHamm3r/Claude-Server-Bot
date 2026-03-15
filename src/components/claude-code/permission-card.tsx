"use client";

import { cn } from "@/lib/utils";

interface PermissionCardProps {
  toolName: string;
  toolInput?: unknown;
  toolCallId?: string;
  sessionId: string;
  onAllow: (sessionId: string, toolName: string, scope: "session" | "once", toolCallId?: string) => void;
  onAlwaysAllow?: (sessionId: string, toolName: string, command: string) => void;
  disabled?: boolean;
  sandboxCategory?: string;
  sandboxReason?: string;
}

function ToolInputPreview({ toolName, toolInput }: { toolName: string; toolInput: unknown }) {
  if (!toolInput || typeof toolInput !== "object") return null;
  const input = toolInput as Record<string, unknown>;

  if (toolName === "Bash" && input.command) {
    return (
      <pre className="text-caption font-mono bg-bot-bg/40 rounded-lg p-2.5 overflow-x-auto text-bot-text">
        $ {String(input.command)}
      </pre>
    );
  }

  if (toolName === "Edit" && input.file_path) {
    const oldStr = String(input.old_string ?? "").split("\n").slice(0, 4).join("\n");
    const newStr = String(input.new_string ?? "").split("\n").slice(0, 4).join("\n");
    return (
      <div className="space-y-1">
        <p className="text-caption text-bot-muted font-mono truncate">{String(input.file_path)}</p>
        <div className="rounded-lg bg-bot-bg/40 p-2.5 text-caption font-mono space-y-0.5 overflow-x-auto">
          {oldStr && <div className="text-bot-red whitespace-pre">- {oldStr}</div>}
          {newStr && <div className="text-bot-green whitespace-pre">+ {newStr}</div>}
        </div>
      </div>
    );
  }

  if (toolName === "Write" && input.file_path) {
    const lines = String(input.content ?? "").split("\n");
    const preview = lines.slice(0, 5).join("\n");
    return (
      <div className="space-y-1">
        <p className="text-caption text-bot-muted font-mono truncate">{String(input.file_path)}</p>
        <pre className="text-caption font-mono bg-bot-bg/40 rounded-lg p-2.5 overflow-x-auto text-bot-text">
          {preview}{lines.length > 5 ? "\n..." : ""}
        </pre>
      </div>
    );
  }

  if ((toolName === "Read" || toolName === "Glob" || toolName === "Grep") && (input.file_path ?? input.pattern ?? input.path)) {
    return (
      <p className="text-caption font-mono text-bot-muted truncate">
        {String(input.file_path ?? input.pattern ?? input.path)}
      </p>
    );
  }

  return (
    <pre className="text-caption text-bot-muted bg-bot-bg/40 rounded-lg p-2.5 overflow-x-auto">
      {JSON.stringify(toolInput, null, 2)}
    </pre>
  );
}

export function PermissionCard({ toolName, toolInput, toolCallId, sessionId, onAllow, onAlwaysAllow, disabled, sandboxCategory, sandboxReason }: PermissionCardProps) {
  const isDangerous = sandboxCategory === "dangerous";
  const isRestricted = sandboxCategory === "restricted";
  const hasSandboxWarning = isDangerous || isRestricted;

  const borderColor = isDangerous ? "border-bot-red/30" : "border-bot-amber/30";
  const bgColor = isDangerous ? "bg-bot-red/5" : "bg-bot-amber/5";
  const iconColor = isDangerous ? "text-bot-red" : "text-bot-amber";

  const command = toolInput && typeof toolInput === "object"
    ? String((toolInput as Record<string, unknown>).command ?? "")
    : "";

  return (
    <div className={cn(
      "rounded-xl border px-4 py-3 space-y-3 shadow-elevated",
      borderColor,
      bgColor,
      isDangerous && "animate-pulse-slow",
    )}>
      <div className="flex items-center gap-2">
        <span className={cn("text-body", iconColor)}>⚠</span>
        <span className="text-body text-bot-text">
          Claude wants to use <code className="font-mono text-bot-amber px-1.5 py-0.5 rounded-md bg-bot-amber/10">{toolName}</code>
        </span>
      </div>

      {hasSandboxWarning && sandboxReason && (
        <div className={cn(
          "rounded-lg px-3 py-2 text-caption flex items-start gap-1.5",
          isDangerous ? "bg-bot-red/10 text-bot-red" : "bg-bot-amber/10 text-bot-amber"
        )}>
          <span className="font-bold shrink-0">{isDangerous ? "DANGER:" : "Warning:"}</span>
          <span>{sandboxReason}</span>
        </div>
      )}

      {toolInput != null && (
        <ToolInputPreview toolName={toolName} toolInput={toolInput} />
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onAllow(sessionId, toolName, "session", toolCallId)}
          disabled={disabled}
          className={cn(
            "rounded-xl px-4 py-1.5 text-white text-caption font-semibold disabled:opacity-50 transition-all duration-200 active:scale-[0.98]",
            isDangerous
              ? "bg-bot-red hover:brightness-110 shadow-[0_0_12px_2px_rgb(var(--bot-red)/0.15)]"
              : "gradient-accent hover:brightness-110 shadow-glow-sm"
          )}
        >
          Allow for Session
        </button>
        <button
          onClick={() => onAllow(sessionId, toolName, "once", toolCallId)}
          disabled={disabled}
          className="rounded-xl px-4 py-1.5 border border-bot-border/40 text-caption font-medium text-bot-muted hover:bg-bot-elevated/40 hover:text-bot-text disabled:opacity-50 transition-all duration-200"
        >
          Allow Once
        </button>
        {onAlwaysAllow && (isRestricted || isDangerous) && command && (
          <button
            onClick={() => onAlwaysAllow(sessionId, toolName, command)}
            disabled={disabled}
            className="rounded-xl px-4 py-1.5 border border-bot-green/30 text-caption font-medium text-bot-green hover:bg-bot-green/10 disabled:opacity-50 transition-all duration-200"
          >
            Always allow
          </button>
        )}
      </div>
    </div>
  );
}

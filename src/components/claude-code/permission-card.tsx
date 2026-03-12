"use client";

import { cn } from "@/lib/utils";

interface PermissionCardProps {
  toolName: string;
  toolInput?: unknown;
  sessionId: string;
  onAllow: (sessionId: string, toolName: string, scope: "session" | "once") => void;
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
      <pre className="text-caption font-mono bg-bot-surface rounded p-2 overflow-x-auto text-bot-text">
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
        <div className="rounded bg-bot-surface p-2 text-caption font-mono space-y-0.5 overflow-x-auto">
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
        <pre className="text-caption font-mono bg-bot-surface rounded p-2 overflow-x-auto text-bot-text">
          {preview}{lines.length > 5 ? "\n…" : ""}
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

  // Fallback: compact JSON
  return (
    <pre className="text-caption text-bot-muted bg-bot-surface rounded p-2 overflow-x-auto">
      {JSON.stringify(toolInput, null, 2)}
    </pre>
  );
}

export function PermissionCard({ toolName, toolInput, sessionId, onAllow, onAlwaysAllow, disabled, sandboxCategory, sandboxReason }: PermissionCardProps) {
  const isDangerous = sandboxCategory === "dangerous";
  const isRestricted = sandboxCategory === "restricted";
  const hasSandboxWarning = isDangerous || isRestricted;

  const borderColor = isDangerous ? "border-bot-red/40" : "border-bot-amber/40";
  const bgColor = isDangerous ? "bg-bot-red/10" : "bg-bot-amber/10";
  const iconColor = isDangerous ? "text-bot-red" : "text-bot-amber";

  const command = toolInput && typeof toolInput === "object"
    ? String((toolInput as Record<string, unknown>).command ?? "")
    : "";

  return (
    <div className={cn("rounded-md border px-3 py-2 space-y-2", borderColor, bgColor)}>
      <div className="flex items-center gap-2">
        <span className={cn("text-body", iconColor)}>⚠</span>
        <span className="text-body text-bot-text">
          Claude wants to use <code className="font-mono text-bot-amber">{toolName}</code>
        </span>
      </div>

      {hasSandboxWarning && sandboxReason && (
        <div className={cn(
          "rounded px-2 py-1.5 text-caption flex items-start gap-1.5",
          isDangerous ? "bg-bot-red/20 text-bot-red" : "bg-bot-amber/20 text-bot-amber"
        )}>
          <span className="font-semibold shrink-0">{isDangerous ? "DANGER:" : "Warning:"}</span>
          <span>{sandboxReason}</span>
        </div>
      )}

      {toolInput != null && (
        <ToolInputPreview toolName={toolName} toolInput={toolInput} />
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onAllow(sessionId, toolName, "session")}
          disabled={disabled}
          className={cn(
            "rounded px-3 py-1 text-white text-caption disabled:opacity-50 transition-colors",
            isDangerous ? "bg-bot-red hover:bg-bot-red/80" : "bg-bot-accent hover:bg-bot-accent/80"
          )}
        >
          Allow for Session
        </button>
        <button
          onClick={() => onAllow(sessionId, toolName, "once")}
          disabled={disabled}
          className="rounded px-3 py-1 border border-bot-border text-caption text-bot-muted hover:bg-bot-elevated disabled:opacity-50 transition-colors"
        >
          Allow Once
        </button>
        {onAlwaysAllow && (isRestricted || isDangerous) && command && (
          <button
            onClick={() => onAlwaysAllow(sessionId, toolName, command)}
            disabled={disabled}
            className="rounded px-3 py-1 border border-bot-green/40 text-caption text-bot-green hover:bg-bot-green/10 disabled:opacity-50 transition-colors"
          >
            Always allow
          </button>
        )}
      </div>
    </div>
  );
}

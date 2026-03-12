"use client";

interface PermissionCardProps {
  toolName: string;
  toolInput?: unknown;
  sessionId: string;
  onAllow: (sessionId: string, toolName: string, scope: "session" | "once") => void;
  disabled?: boolean;
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

export function PermissionCard({ toolName, toolInput, sessionId, onAllow, disabled }: PermissionCardProps) {
  return (
    <div className="rounded-md border border-bot-amber/40 bg-bot-amber/10 px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-bot-amber text-body">⚠</span>
        <span className="text-body text-bot-text">
          Claude wants to use <code className="font-mono text-bot-amber">{toolName}</code>
        </span>
      </div>
      {toolInput != null && (
        <ToolInputPreview toolName={toolName} toolInput={toolInput} />
      )}
      <div className="flex gap-2">
        <button
          onClick={() => onAllow(sessionId, toolName, "session")}
          disabled={disabled}
          className="rounded px-3 py-1 bg-bot-accent text-white text-caption hover:bg-bot-accent/80 disabled:opacity-50 transition-colors"
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
      </div>
    </div>
  );
}

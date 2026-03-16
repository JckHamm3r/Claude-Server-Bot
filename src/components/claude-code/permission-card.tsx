"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface PermissionCardProps {
  toolName: string;
  toolInput?: unknown;
  toolCallId?: string;
  sessionId: string;
  messageId?: string;
  onAllow: (sessionId: string, toolName: string, scope: "session" | "once", toolCallId?: string, messageId?: string) => void;
  onAlwaysAllow?: (sessionId: string, toolName: string, command: string, toolCallId?: string) => void;
  disabled?: boolean;
  sandboxCategory?: string;
  sandboxReason?: string;
  experienceLevel?: string;
}

/** Plain-English description of what a tool call does — for Beginner mode. */
function getPlainDescription(toolName: string, toolInput: unknown): string {
  const input = (typeof toolInput === "object" && toolInput) ? toolInput as Record<string, unknown> : {};
  const cmd = String(input.command ?? "");
  const filePath = String(input.file_path ?? input.path ?? "");

  switch (toolName) {
    case "Bash": {
      if (/apt(-get)?\s+install/i.test(cmd)) return "Install software on your server";
      if (/npm\s+install|yarn\s+add|pip\s+install|pip3\s+install/i.test(cmd)) return "Install project dependencies";
      if (/git\s+clone/i.test(cmd)) return "Download a project from the internet";
      if (/git\s+(pull|push|fetch)/i.test(cmd)) return "Sync code changes";
      if (/systemctl\s+start/i.test(cmd)) return "Start a service";
      if (/systemctl\s+stop/i.test(cmd)) return "Stop a service";
      if (/systemctl\s+restart/i.test(cmd)) return "Restart a service";
      if (/systemctl\s+enable/i.test(cmd)) return "Set a service to start automatically";
      if (/nginx.*reload|service\s+nginx/i.test(cmd)) return "Apply web server settings";
      if (/rm\s+-rf/i.test(cmd)) return "⚠️ Delete files (review carefully before allowing)";
      if (/rm\b/i.test(cmd)) return "Delete a file";
      if (/chmod|chown/i.test(cmd)) return "Change file permissions";
      if (/mkdir/i.test(cmd)) return "Create a new folder";
      if (/cat|less|head|tail/i.test(cmd)) return "Read the contents of a file";
      if (/ls|dir\b/i.test(cmd)) return "List files in a folder";
      if (/echo|printf/i.test(cmd)) return "Write text to a file or display it";
      if (/curl|wget/i.test(cmd)) return "Download something from the internet";
      return "Run a command on your server";
    }
    case "Write": {
      if (filePath.startsWith("/etc/")) return "Create a configuration file";
      if (/\/var\/www\//i.test(filePath) || /\/html\//i.test(filePath)) return "Create a website file";
      if (filePath.endsWith(".html") || filePath.endsWith(".htm")) return "Create a web page";
      if (filePath.endsWith(".css")) return "Create a stylesheet";
      if (filePath.endsWith(".js") || filePath.endsWith(".ts")) return "Create a code file";
      if (filePath.endsWith(".json") || filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "Create a configuration file";
      return "Create a file";
    }
    case "Edit": return "Make changes to a file";
    case "Read": return "Read a file to understand it";
    case "Glob": return "Search for files by name";
    case "Grep": return "Search inside files for text";
    case "WebFetch": return "Look something up on the web";
    case "WebSearch": return "Search the web";
    default: return `Use the ${toolName} tool`;
  }
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

export function PermissionCard({ toolName, toolInput, toolCallId, sessionId, messageId, onAllow, onAlwaysAllow, disabled, sandboxCategory, sandboxReason, experienceLevel }: PermissionCardProps) {
  const isDangerous = sandboxCategory === "dangerous";
  const isRestricted = sandboxCategory === "restricted";
  const hasSandboxWarning = isDangerous || isRestricted;
  const isBeginner = experienceLevel === "beginner";
  const [showRaw, setShowRaw] = useState(false);

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
      {/* Header — plain English for beginners, technical for others */}
      <div className="flex items-center gap-2">
        <span className={cn("text-body", iconColor)}>⚠</span>
        <span className="text-body text-bot-text">
          {isBeginner
            ? <strong>{getPlainDescription(toolName, toolInput)}</strong>
            : <>Claude wants to use <code className="font-mono text-bot-amber px-1.5 py-0.5 rounded-md bg-bot-amber/10">{toolName}</code></>
          }
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

      {/* For beginners: show plain description prominently, raw details collapsed */}
      {isBeginner && toolInput != null && (
        <div>
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-bot-muted hover:text-bot-accent transition-colors"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", showRaw && "rotate-180")} />
            {showRaw ? "Hide technical details" : "What does this do exactly?"}
          </button>
          {showRaw && <div className="mt-2"><ToolInputPreview toolName={toolName} toolInput={toolInput} /></div>}
        </div>
      )}

      {/* For intermediate/expert: show raw details normally */}
      {!isBeginner && toolInput != null && (
        <ToolInputPreview toolName={toolName} toolInput={toolInput} />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onAllow(sessionId, toolName, "session", toolCallId, messageId)}
          disabled={disabled}
          className={cn(
            "rounded-xl px-4 py-1.5 text-white text-caption font-semibold disabled:opacity-50 transition-all duration-200 active:scale-[0.98]",
            isDangerous
              ? "bg-bot-red hover:brightness-110 shadow-[0_0_12px_2px_rgb(var(--bot-red)/0.15)]"
              : "gradient-accent hover:brightness-110 shadow-glow-sm"
          )}
        >
          {isBeginner ? "Yes, for this whole chat" : "Allow for Session"}
        </button>
        <button
          onClick={() => onAllow(sessionId, toolName, "once", toolCallId, messageId)}
          disabled={disabled}
          className="rounded-xl px-4 py-1.5 border border-bot-border/40 text-caption font-medium text-bot-muted hover:bg-bot-elevated/40 hover:text-bot-text disabled:opacity-50 transition-all duration-200"
        >
          {isBeginner ? "Yes, just this once" : "Allow Once"}
        </button>
        {onAlwaysAllow && (isRestricted || isDangerous) && command && (
          <button
            onClick={() => onAlwaysAllow(sessionId, toolName, command, toolCallId)}
            disabled={disabled}
            className="rounded-xl px-4 py-1.5 border border-bot-green/30 text-caption font-medium text-bot-green hover:bg-bot-green/10 disabled:opacity-50 transition-all duration-200"
          >
            {isBeginner ? "Always yes" : "Always allow"}
          </button>
        )}
      </div>
    </div>
  );
}

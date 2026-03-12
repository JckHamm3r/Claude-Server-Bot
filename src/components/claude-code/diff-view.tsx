"use client";

import type { DiffHunk } from "@/lib/claude/provider";

interface DiffViewProps {
  file?: string;
  hunks?: DiffHunk[];
}

export function DiffView({ file, hunks = [] }: DiffViewProps) {
  return (
    <div className="rounded-md border border-bot-border overflow-hidden text-caption font-mono">
      {file && (
        <div className="border-b border-bot-border bg-bot-elevated px-3 py-1.5 text-bot-muted">
          {file}
        </div>
      )}
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <div className="bg-bot-elevated px-3 py-0.5 text-bot-muted">
            {hunk.header}
          </div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={
                line.type === "add"
                  ? "bg-bot-green/10 text-bot-green px-3 py-0.5"
                  : line.type === "remove"
                    ? "bg-bot-red/10 text-bot-red px-3 py-0.5"
                    : "px-3 py-0.5 text-bot-muted"
              }
            >
              <span className="select-none mr-1">
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              {line.content}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

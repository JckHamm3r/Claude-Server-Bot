"use client";

import type { DiffHunk } from "@/lib/claude/provider";

interface DiffViewProps {
  file?: string;
  hunks?: DiffHunk[];
}

export function DiffView({ file, hunks = [] }: DiffViewProps) {
  return (
    <div className="rounded-xl border border-bot-border/30 overflow-hidden text-caption font-mono shadow-elevated">
      {file && (
        <div className="border-b border-bot-border/20 bg-bot-elevated/40 px-4 py-2 text-bot-muted flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-bot-amber/40" />
          {file}
        </div>
      )}
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <div className="bg-bot-elevated/20 px-4 py-1 text-bot-muted/50 text-[10px]">
            {hunk.header}
          </div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={
                line.type === "add"
                  ? "bg-bot-green/5 text-bot-green px-4 py-0.5 border-l-2 border-bot-green/40"
                  : line.type === "remove"
                    ? "bg-bot-red/5 text-bot-red px-4 py-0.5 border-l-2 border-bot-red/40"
                    : "px-4 py-0.5 text-bot-muted/60"
              }
            >
              <span className="select-none mr-2 w-4 inline-block text-right opacity-40">
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

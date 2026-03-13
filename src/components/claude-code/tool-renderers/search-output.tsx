"use client";

import { useState } from "react";
import { Search, File, ChevronDown, ChevronUp } from "lucide-react";

interface SearchOutputProps {
  toolName: string;
  pattern: string;
  path: string;
  result?: string;
}

export function SearchOutput({ toolName, pattern, path, result }: SearchOutputProps) {
  const [showAll, setShowAll] = useState(false);
  const lines = result?.split("\n").filter(Boolean) ?? [];
  const isLong = lines.length > 20;
  const displayLines = showAll ? lines : lines.slice(0, 20);

  return (
    <div className="rounded-lg border border-bot-border/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-bot-surface border-b border-bot-border/40">
        <Search className="h-3.5 w-3.5 text-bot-muted" />
        <span className="text-caption font-mono text-bot-accent">{pattern}</span>
        {path && <span className="text-[10px] text-bot-muted">in {path}</span>}
        <span className="ml-auto text-[10px] text-bot-muted">{lines.length} result{lines.length !== 1 ? "s" : ""}</span>
      </div>

      {lines.length > 0 && (
        <div>
          <div className="px-3 py-2 space-y-0.5 max-h-[300px] overflow-y-auto">
            {displayLines.map((line, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] font-mono">
                <File className="h-3 w-3 text-bot-muted shrink-0" />
                <span className="text-bot-text truncate">{line}</span>
              </div>
            ))}
          </div>
          {isLong && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="flex items-center gap-1 w-full px-3 py-1.5 text-[11px] text-bot-muted hover:text-bot-text bg-bot-surface border-t border-bot-border/40 transition-colors"
            >
              {showAll ? (
                <><ChevronUp className="h-3 w-3" /> Show less</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> Show all {lines.length} results</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

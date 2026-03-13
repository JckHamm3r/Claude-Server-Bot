"use client";

import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

interface BashOutputProps {
  command: string;
  output?: string;
  exitCode?: number;
}

export function BashOutput({ command, output, exitCode }: BashOutputProps) {
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const lines = output?.split("\n") ?? [];
  const isLong = lines.length > 20;
  const displayLines = showAll ? lines : lines.slice(0, 20);

  return (
    <div className="rounded-lg bg-[#1e1e1e] overflow-hidden font-mono text-[12px]">
      {/* Command header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#2d2d2d] border-b border-[#404040]">
        <span className="text-green-400">$</span>
        <span className="text-gray-200 flex-1 truncate">{command}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
          title="Copy command"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
        {exitCode !== undefined && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            exitCode === 0 ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"
          }`}>
            exit {exitCode}
          </span>
        )}
      </div>

      {/* Output */}
      {output && (
        <div className="relative">
          <div className="px-3 py-2 max-h-[300px] overflow-y-auto">
            <div className="flex">
              <div className="pr-3 text-right text-gray-600 select-none shrink-0" style={{ minWidth: "2.5em" }}>
                {displayLines.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre className="text-gray-300 whitespace-pre-wrap break-words flex-1">
                {displayLines.join("\n")}
              </pre>
            </div>
          </div>
          {isLong && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="flex items-center gap-1 w-full px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 bg-[#252525] border-t border-[#404040] transition-colors"
            >
              {showAll ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Show all {lines.length} lines
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

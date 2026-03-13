"use client";

import { useState } from "react";
import { FileText, ChevronDown, ChevronUp } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface FileReadOutputProps {
  filePath: string;
  content?: string;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rb: "ruby", rs: "rust", go: "go", java: "java",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", html: "html", css: "css", scss: "scss",
  sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
  xml: "xml", dockerfile: "dockerfile", makefile: "makefile",
};

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  return EXT_TO_LANG[ext] ?? "text";
}

export function FileReadOutput({ filePath, content }: FileReadOutputProps) {
  const [showAll, setShowAll] = useState(false);
  const lang = detectLanguage(filePath);
  const lines = content?.split("\n") ?? [];
  const isLong = lines.length > 30;
  const displayContent = showAll ? content : lines.slice(0, 30).join("\n");

  return (
    <div className="rounded-lg border border-bot-border/40 overflow-hidden">
      {/* File path header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bot-surface border-b border-bot-border/40">
        <FileText className="h-3.5 w-3.5 text-bot-muted" />
        <span className="text-caption font-mono text-bot-text truncate">{filePath}</span>
        <span className="text-[10px] text-bot-muted ml-auto">{lines.length} lines</span>
      </div>

      {content && (
        <div>
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={lang}
            showLineNumbers
            customStyle={{ margin: 0, fontSize: "12px", maxHeight: isLong && !showAll ? "none" : "400px", overflow: showAll ? "auto" : "hidden" }}
          >
            {displayContent ?? ""}
          </SyntaxHighlighter>
          {isLong && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="flex items-center gap-1 w-full px-3 py-1.5 text-[11px] text-bot-muted hover:text-bot-text bg-bot-surface border-t border-bot-border/40 transition-colors"
            >
              {showAll ? (
                <><ChevronUp className="h-3 w-3" /> Show less</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> Show all {lines.length} lines</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

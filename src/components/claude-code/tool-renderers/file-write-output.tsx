"use client";

import { FilePlus, FilePen } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface FileWriteOutputProps {
  filePath: string;
  content?: string;
  oldString?: string;
  newString?: string;
  isEdit?: boolean;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rb: "ruby", rs: "rust", go: "go", java: "java",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", html: "html", css: "css", scss: "scss",
  sql: "sql", sh: "bash", bash: "bash",
};

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "text";
}

export function FileWriteOutput({ filePath, content, oldString, newString, isEdit }: FileWriteOutputProps) {
  const lang = detectLanguage(filePath);

  return (
    <div className="rounded-lg border border-bot-border/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-bot-surface border-b border-bot-border/40">
        {isEdit ? (
          <FilePen className="h-3.5 w-3.5 text-bot-amber" />
        ) : (
          <FilePlus className="h-3.5 w-3.5 text-bot-green" />
        )}
        <span className="text-caption font-mono text-bot-text truncate">{filePath}</span>
        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium ${
          isEdit ? "bg-bot-amber/20 text-bot-amber" : "bg-bot-green/20 text-bot-green"
        }`}>
          {isEdit ? "Modified" : "Created"}
        </span>
      </div>

      {isEdit && oldString && newString ? (
        <div className="text-[12px] font-mono">
          <div className="bg-red-900/20 px-3 py-1.5 border-b border-bot-border/20">
            <div className="text-[10px] text-red-400 mb-1">- Removed</div>
            <pre className="text-red-300 whitespace-pre-wrap break-words">{oldString}</pre>
          </div>
          <div className="bg-green-900/20 px-3 py-1.5">
            <div className="text-[10px] text-green-400 mb-1">+ Added</div>
            <pre className="text-green-300 whitespace-pre-wrap break-words">{newString}</pre>
          </div>
        </div>
      ) : content ? (
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={lang}
          showLineNumbers
          customStyle={{ margin: 0, fontSize: "12px", maxHeight: "300px", overflow: "auto" }}
        >
          {content}
        </SyntaxHighlighter>
      ) : null}
    </div>
  );
}

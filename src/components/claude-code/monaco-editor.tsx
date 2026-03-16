"use client";

import { useRef, useCallback } from "react";
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";

// Detect Monaco language from file extension or MIME type
export function getMonacoLanguage(filePathOrMime: string): string {
  const lower = filePathOrMime.toLowerCase();

  // By MIME
  if (lower.includes("markdown")) return "markdown";
  if (lower.includes("typescript") || lower.includes("tsx")) return "typescript";
  if (lower.includes("javascript") || lower.includes("jsx")) return "javascript";
  if (lower.includes("json")) return "json";
  if (lower.includes("python")) return "python";
  if (lower.includes("html")) return "html";
  if (lower.includes("css")) return "css";
  if (lower.includes("scss")) return "scss";
  if (lower.includes("yaml")) return "yaml";
  if (lower.includes("shell") || lower.includes("bash")) return "shell";
  if (lower.includes("xml")) return "xml";
  if (lower.includes("sql")) return "sql";
  if (lower.includes("rust")) return "rust";
  if (lower.includes("go")) return "go";
  if (lower.includes("java")) return "java";
  if (lower.includes("c++") || lower.includes("cpp")) return "cpp";
  if (lower.includes("ruby")) return "ruby";

  // By extension (file path)
  const ext = lower.split(".").pop() ?? "";
  const extMap: Record<string, string> = {
    md: "markdown", markdown: "markdown",
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    json: "json", jsonc: "json",
    py: "python", rb: "ruby",
    html: "html", htm: "html",
    css: "css", scss: "scss", sass: "sass",
    yaml: "yaml", yml: "yaml",
    sh: "shell", bash: "shell", zsh: "shell",
    toml: "toml", ini: "ini",
    xml: "xml", svg: "xml",
    sql: "sql", rs: "rust",
    go: "go", java: "java",
    c: "c", cpp: "cpp", h: "c",
    env: "shell", gitignore: "shell",
    dockerfile: "dockerfile",
  };
  return extMap[ext] ?? "plaintext";
}

function defineTheme(monaco: Monaco) {
  monaco.editor.defineTheme("claude-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6e7681", fontStyle: "italic" },
      { token: "keyword", foreground: "79c0ff" },
      { token: "string", foreground: "a5d6ff" },
      { token: "number", foreground: "79c0ff" },
      { token: "type", foreground: "ffa657" },
      { token: "function", foreground: "d2a8ff" },
      { token: "variable", foreground: "ffa657" },
      { token: "operator", foreground: "79c0ff" },
    ],
    colors: {
      "editor.background": "#0a0a10",
      "editor.foreground": "#c9d1d9",
      "editor.lineHighlightBackground": "#161b22",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#1e3a5f",
      "editorLineNumber.foreground": "#484f58",
      "editorLineNumber.activeForeground": "#8b949e",
      "editorCursor.foreground": "#58a6ff",
      "editor.findMatchBackground": "#9e6a0350",
      "editor.findMatchHighlightBackground": "#9e6a0330",
      "editorGutter.background": "#0a0a10",
      "editorWidget.background": "#161b22",
      "editorWidget.border": "#30363d",
      "input.background": "#0d1117",
      "input.border": "#30363d",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#484f5840",
      "scrollbarSlider.hoverBackground": "#484f5870",
      "scrollbarSlider.activeBackground": "#58a6ff50",
      "minimap.background": "#0a0a10",
    },
  });
}

interface MonacoEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  filePath?: string;
  readOnly?: boolean;
  height?: string;
  onSave?: () => void;
}

export function MonacoEditor({
  value,
  onChange,
  language,
  filePath,
  readOnly = false,
  height = "100%",
  onSave,
}: MonacoEditorProps) {
  const monacoRef = useRef<Monaco | null>(null);
  const resolvedLang = language ?? (filePath ? getMonacoLanguage(filePath) : "plaintext");

  const handleMount: OnMount = useCallback((editor, monaco) => {
    monacoRef.current = monaco;
    defineTheme(monaco);
    monaco.editor.setTheme("claude-dark");

    // Ctrl/Cmd+S → save
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => { onSave?.(); }
    );

    // Focus the editor
    editor.focus();
  }, [onSave]);

  return (
    <Editor
      height={height}
      language={resolvedLang}
      value={value}
      onChange={(v) => onChange?.(v ?? "")}
      onMount={handleMount}
      loading={
        <div className="flex h-full items-center justify-center bg-[#0a0a10]">
          <Loader2 className="h-5 w-5 animate-spin text-bot-muted" />
        </div>
      }
      options={{
        readOnly,
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
        fontLigatures: true,
        lineNumbers: "on",
        minimap: { enabled: true, maxColumn: 80 },
        scrollBeyondLastLine: false,
        wordWrap: resolvedLang === "markdown" || resolvedLang === "plaintext" ? "on" : "off",
        theme: "claude-dark",
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        overviewRulerBorder: false,
        renderLineHighlight: "line",
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        cursorBlinking: "smooth",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true },
        suggest: { showWords: !readOnly },
        quickSuggestions: !readOnly,
        fixedOverflowWidgets: true,
      }}
    />
  );
}

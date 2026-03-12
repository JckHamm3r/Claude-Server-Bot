import type { ParsedOutput, DiffHunk } from "./provider";

const NUMBERED_OPTION = /^\s*(\d+)[.)]\s+(.+)/;
const YN_CONFIRM = /\[y\/n\]|\byes\/no\b|\(y\/n\)/i;
const DIFF_FILE_HEADER = /^(---|\+\+\+)\s+/;
const DIFF_HUNK_HEADER = /^@@\s+-\d+/;
const SPINNER_CHARS = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\-\\|\/]/;

export function parseChunk(raw: string): ParsedOutput[] {
  // Strip ANSI escape codes
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/\x1B\[[0-9;]*[mGKHF]/g, "").replace(/\r/g, "");

  const lines = text.split("\n");
  const results: ParsedOutput[] = [];

  const optionLines: string[] = [];
  let inDiff = false;
  let diffFile = "";
  let diffHunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  const flushOptions = () => {
    if (optionLines.length >= 2) {
      results.push({ type: "options", choices: [...optionLines] });
    } else if (optionLines.length === 1) {
      results.push({ type: "text", content: optionLines[0] });
    }
    optionLines.length = 0;
  };

  const flushDiff = () => {
    if (currentHunk) diffHunks.push(currentHunk);
    if (diffHunks.length > 0) {
      results.push({ type: "diff", file: diffFile, hunks: diffHunks });
    }
    inDiff = false;
    diffFile = "";
    diffHunks = [];
    currentHunk = null;
  };

  for (const line of lines) {
    if (!line) continue;

    if (DIFF_FILE_HEADER.test(line)) {
      flushOptions();
      inDiff = true;
      if (line.startsWith("--- ")) diffFile = line.replace(/^--- (a\/)?/, "");
      continue;
    }

    if (inDiff) {
      if (DIFF_HUNK_HEADER.test(line)) {
        if (currentHunk) diffHunks.push(currentHunk);
        currentHunk = { header: line, lines: [] };
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk?.lines.push({ type: "add", content: line.slice(1) });
        continue;
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk?.lines.push({ type: "remove", content: line.slice(1) });
        continue;
      }
      if (line.startsWith(" ")) {
        currentHunk?.lines.push({ type: "context", content: line.slice(1) });
        continue;
      }
      flushDiff();
    }

    const optionMatch = NUMBERED_OPTION.exec(line);
    if (optionMatch) {
      optionLines.push(optionMatch[2].trim());
      continue;
    }

    flushOptions();

    if (YN_CONFIRM.test(line)) {
      results.push({ type: "confirm", prompt: line.trim() });
      continue;
    }

    if (SPINNER_CHARS.test(line.trim())) {
      results.push({ type: "progress", message: line.trim() });
      continue;
    }

    results.push({ type: "text", content: line });
  }

  flushOptions();
  if (inDiff) flushDiff();

  return results;
}

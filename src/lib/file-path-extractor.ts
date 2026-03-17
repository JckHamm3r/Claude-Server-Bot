/**
 * File Path Extractor
 *
 * Extracts file paths from tool inputs for lock tracking.
 * For Bash commands, uses heuristic-based pattern matching.
 */

import path from "path";

/**
 * Extract file paths from tool inputs based on tool type
 */
export function extractFilePaths(toolName: string, toolInput: Record<string, unknown>): string[] {
  switch (toolName) {
    case "Write":
    case "StrReplace":
    case "Delete":
      return extractPathFromFileTools(toolInput);
    case "Bash":
    case "Shell":
      return extractPathsFromBashCommand(toolInput);
    default:
      return [];
  }
}

/**
 * Extract path from Write, StrReplace, Delete tools
 */
function extractPathFromFileTools(toolInput: Record<string, unknown>): string[] {
  const filePath = toolInput.path;
  if (typeof filePath === "string" && filePath.trim() !== "") {
    return [normalizePath(filePath)];
  }
  return [];
}

/**
 * Extract file paths from Bash/Shell commands using pattern matching
 * Conservative approach: only extract paths from high-confidence patterns
 */
function extractPathsFromBashCommand(toolInput: Record<string, unknown>): string[] {
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  if (!command) return [];

  const paths: Set<string> = new Set();

  // Pattern 1: Output redirects (>, >>, &>, 2>)
  // Matches: echo "text" > file.txt, command >> output.log
  const redirectMatches = command.matchAll(/(?:^|[;&|]\s*)(?:[^;&|>]*?)\s+(?:>>?|&>>?|2>>?)\s+([^\s;&|<>]+)/g);
  for (const match of redirectMatches) {
    const filePath = match[1].trim();
    if (filePath && !isSpecialPath(filePath)) {
      paths.add(normalizePath(filePath));
    }
  }

  // Pattern 2: tee command (writes to file)
  // Matches: command | tee file.txt, tee -a output.log
  const teeMatches = command.matchAll(/\btee\s+(?:-a\s+)?([^\s;&|<>]+)/g);
  for (const match of teeMatches) {
    const filePath = match[1].trim();
    if (filePath && !isSpecialPath(filePath)) {
      paths.add(normalizePath(filePath));
    }
  }

  // Pattern 3: sed -i (in-place edit)
  // Matches: sed -i 's/old/new/' file.txt, sed -i.bak 's/x/y/' file.txt
  const sedMatches = command.matchAll(/\bsed\s+-i(?:\.\w+)?\s+['"][^'"]+['"]\s+([^\s;&|<>]+)/g);
  for (const match of sedMatches) {
    const filePath = match[1].trim();
    if (filePath && !isSpecialPath(filePath)) {
      paths.add(normalizePath(filePath));
    }
  }

  // Pattern 4: cat with redirect (write to file)
  // Matches: cat file1 > file2, cat << EOF > file.txt
  const catRedirectMatches = command.matchAll(/\bcat\s+.*?\s+>\s+([^\s;&|<>]+)/g);
  for (const match of catRedirectMatches) {
    const filePath = match[1].trim();
    if (filePath && !isSpecialPath(filePath)) {
      paths.add(normalizePath(filePath));
    }
  }

  // Pattern 5: mv (move/rename files - affects destination)
  // Matches: mv source dest, mv -f old new
  const mvMatches = command.matchAll(/\bmv\s+(?:-[fivn]+\s+)?([^\s;&|<>]+)\s+([^\s;&|<>]+)/g);
  for (const match of mvMatches) {
    const destPath = match[2].trim();
    // Only track if destination looks like a file (not a directory)
    if (destPath && !isSpecialPath(destPath) && !destPath.endsWith("/")) {
      paths.add(normalizePath(destPath));
    }
  }

  // Pattern 6: cp (copy files - affects destination)
  // Matches: cp source dest, cp -f old new
  const cpMatches = command.matchAll(/\bcp\s+(?:-[rfpiv]+\s+)?([^\s;&|<>]+)\s+([^\s;&|<>]+)/g);
  for (const match of cpMatches) {
    const destPath = match[2].trim();
    // Only track if destination looks like a file (not a directory)
    if (destPath && !isSpecialPath(destPath) && !destPath.endsWith("/")) {
      paths.add(normalizePath(destPath));
    }
  }

  // Pattern 7: touch (create/update files)
  // Matches: touch file.txt, touch -a file1 file2
  const touchMatches = command.matchAll(/\btouch\s+(?:-[acdmt]+\s+)?([^\s;&|<>]+(?:\s+[^\s;&|<>]+)*)/g);
  for (const match of touchMatches) {
    const fileArgs = match[1].trim().split(/\s+/);
    for (const filePath of fileArgs) {
      if (filePath && !isSpecialPath(filePath) && !filePath.startsWith("-")) {
        paths.add(normalizePath(filePath));
      }
    }
  }

  // Pattern 8: Direct file writes with echo
  // Matches: echo "text" > file.txt (already covered by pattern 1, but being explicit)

  // Pattern 9: dd command (disk/file operations)
  // Matches: dd if=/dev/zero of=file.img
  const ddMatches = command.matchAll(/\bdd\s+.*?\bof=([^\s;&|<>]+)/g);
  for (const match of ddMatches) {
    const filePath = match[1].trim();
    if (filePath && !isSpecialPath(filePath)) {
      paths.add(normalizePath(filePath));
    }
  }

  return Array.from(paths);
}

/**
 * Normalize file path (resolve relative paths, remove quotes)
 */
function normalizePath(filePath: string): string {
  // Remove quotes
  let cleaned = filePath.replace(/^["']|["']$/g, "");

  // Remove escape characters
  cleaned = cleaned.replace(/\\(.)/g, "$1");

  // Resolve to absolute path if relative
  if (!path.isAbsolute(cleaned)) {
    cleaned = path.resolve(process.env.CLAUDE_PROJECT_ROOT || process.cwd(), cleaned);
  }

  return cleaned;
}

/**
 * Check if path is a special/system path that should not be locked
 */
function isSpecialPath(filePath: string): boolean {
  const special = [
    "/dev/null",
    "/dev/zero",
    "/dev/stdin",
    "/dev/stdout",
    "/dev/stderr",
    "/dev/urandom",
    "/dev/random",
    "/proc/",
    "/sys/",
  ];

  const normalized = filePath.toLowerCase();

  for (const specialPath of special) {
    if (normalized === specialPath || normalized.startsWith(specialPath)) {
      return true;
    }
  }

  // Variables and expressions should not be tracked
  if (filePath.includes("$") || filePath.includes("`")) {
    return true;
  }

  return false;
}

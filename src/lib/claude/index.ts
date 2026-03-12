// Server-only: used by src/socket/handlers.ts via server.ts
// NOT imported by any Next.js page or client component.
import type { ClaudeCodeProvider } from "./provider";

let _provider: ClaudeCodeProvider | null = null;

export function getClaudeProvider(): ClaudeCodeProvider {
  if (_provider) return _provider;
  const mode = process.env.CLAUDE_PROVIDER ?? "subprocess";
  if (mode === "sdk") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sdkProvider } = require("./sdk-provider") as { sdkProvider: ClaudeCodeProvider };
    _provider = sdkProvider;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { subprocessProvider } = require("./subprocess-provider") as { subprocessProvider: ClaudeCodeProvider };
    _provider = subprocessProvider;
  }
  return _provider!;
}

export type { ClaudeCodeProvider, ParsedOutput, DiffHunk } from "./provider";

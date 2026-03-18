// Server-only: used by src/socket/handlers.ts via server.ts
// NOT imported by any Next.js page or client component.
import type { ClaudeCodeProvider } from "./provider";

let _sdkProvider: ClaudeCodeProvider | null = null;

function getSDKProvider(): ClaudeCodeProvider {
  if (!_sdkProvider) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sdkProvider } = require("./sdk-provider") as { sdkProvider: ClaudeCodeProvider };
    _sdkProvider = sdkProvider;
  }
  return _sdkProvider;
}

export function isSDKAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY);
}

// SDK is the only provider. _type is accepted for future extensibility but currently unused.
export function getClaudeProvider(_type?: string): ClaudeCodeProvider {
  return getSDKProvider();
}

export type { ClaudeCodeProvider, ParsedOutput, DiffHunk, TokenUsage } from "./provider";

// Server-only: used by src/socket/handlers.ts via server.ts
// NOT imported by any Next.js page or client component.
import type { ClaudeCodeProvider } from "./provider";

let _subprocessProvider: ClaudeCodeProvider | null = null;
let _sdkProvider: ClaudeCodeProvider | null = null;

function getSubprocessProvider(): ClaudeCodeProvider {
  if (!_subprocessProvider) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { subprocessProvider } = require("./subprocess-provider") as { subprocessProvider: ClaudeCodeProvider };
    _subprocessProvider = subprocessProvider;
  }
  return _subprocessProvider;
}

function getSDKProvider(): ClaudeCodeProvider {
  if (!_sdkProvider) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sdkProvider } = require("./sdk-provider") as { sdkProvider: ClaudeCodeProvider };
    _sdkProvider = sdkProvider;
  }
  return _sdkProvider;
}

export function isSDKAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = (require("../db") as { default: import("better-sqlite3").Database }).default;
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'anthropic_api_key'").get() as { value: string } | undefined;
    const keyFromDB = row?.value ?? "";
    const keyFromEnv = process.env.ANTHROPIC_API_KEY ?? "";
    return !!(keyFromDB || keyFromEnv);
  } catch {
    return !!process.env.ANTHROPIC_API_KEY;
  }
}

export function getClaudeProvider(type?: string): ClaudeCodeProvider {
  const mode = type ?? process.env.CLAUDE_PROVIDER ?? "subprocess";
  if (mode === "sdk") {
    return getSDKProvider();
  }
  if (mode !== "subprocess") {
    console.warn(`Unknown provider type "${mode}", falling back to subprocess`);
  }
  return getSubprocessProvider();
}

export type { ClaudeCodeProvider, ParsedOutput, DiffHunk, TokenUsage } from "./provider";

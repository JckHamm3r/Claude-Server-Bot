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
    if (!(keyFromDB || keyFromEnv)) return false;
    // Verify the SDK package is importable (installed via install.sh)
    try {
      require.resolve("@anthropic-ai/claude-agent-sdk");
    } catch {
      return false;
    }
    return true;
  } catch {
    return !!process.env.ANTHROPIC_API_KEY;
  }
}

export function getClaudeProvider(type?: string): ClaudeCodeProvider {
  // Explicit override always wins
  const explicit = type ?? process.env.CLAUDE_PROVIDER;
  if (explicit === "sdk") return getSDKProvider();
  if (explicit === "subprocess") return getSubprocessProvider();
  if (explicit && explicit !== "sdk" && explicit !== "subprocess") {
    console.warn(`Unknown provider type "${explicit}", falling back to subprocess`);
    return getSubprocessProvider();
  }

  // Auto-select: prefer SDK when an API key is available, else subprocess
  if (isSDKAvailable()) {
    return getSDKProvider();
  }
  return getSubprocessProvider();
}

export type { ClaudeCodeProvider, ParsedOutput, DiffHunk, TokenUsage } from "./provider";

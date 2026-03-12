import type { ClaudeCodeProvider } from "./provider";

export const sdkProvider: ClaudeCodeProvider = {
  createSession() {
    throw new Error(
      "SDK provider not yet configured — set ANTHROPIC_API_KEY and CLAUDE_PROVIDER=sdk",
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sendMessage(..._args: unknown[]) {
    throw new Error("SDK provider not configured");
  },
  interrupt() {},
  closeSession() {},
  onOutput() {},
  offOutput() {},
  allowTool() {},
  denyPermission() {},
  isRunning() { return false; },
};

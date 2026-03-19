/**
 * In-memory registry tracking active sub-agent invocations per parent session.
 * Used to broadcast live status indicators to the frontend.
 */

export type SubAgentStatus = "running" | "complete" | "error";

export interface SubAgentActivity {
  toolName: string;
  toolCallId: string;
  status: "running" | "done" | "error";
}

export interface SubAgentEntry {
  id: string;
  agentName: string;
  agentIcon: string | null;
  task: string;
  status: SubAgentStatus;
  error?: string;
  currentActivity?: string;
  activityLog: SubAgentActivity[];
  startedAt: number;
  finishedAt?: number;
}

// parentSessionId → list of sub-agent entries
const registry = new Map<string, SubAgentEntry[]>();

// Called when the status changes — wired up by handlers.ts
let statusEmitter: ((parentSessionId: string, entries: SubAgentEntry[]) => void) | null = null;

export function setSubAgentStatusEmitter(fn: (parentSessionId: string, entries: SubAgentEntry[]) => void) {
  statusEmitter = fn;
}

export function registerSubAgent(
  parentSessionId: string,
  id: string,
  agentName: string,
  agentIcon: string | null,
  task: string,
): void {
  const existing = registry.get(parentSessionId) ?? [];
  existing.push({ id, agentName, agentIcon, task, status: "running", activityLog: [], startedAt: Date.now() });
  registry.set(parentSessionId, existing);
  statusEmitter?.(parentSessionId, existing);
}

export function addSubAgentActivity(
  parentSessionId: string,
  subAgentId: string,
  toolName: string,
  toolCallId: string,
): void {
  const entries = registry.get(parentSessionId);
  if (!entries) return;
  const entry = entries.find((e) => e.id === subAgentId);
  if (!entry) return;

  // Humanize the tool name for the banner
  const friendly = humanizeToolName(toolName);
  entry.currentActivity = friendly;
  entry.activityLog.push({ toolName, toolCallId, status: "running" });

  // Cap log at 100 entries to avoid unbounded growth
  if (entry.activityLog.length > 100) {
    entry.activityLog = entry.activityLog.slice(-100);
  }

  statusEmitter?.(parentSessionId, entries);
}

export function updateSubAgentActivity(
  parentSessionId: string,
  subAgentId: string,
  toolCallId: string,
  status: "done" | "error",
): void {
  const entries = registry.get(parentSessionId);
  if (!entries) return;
  const entry = entries.find((e) => e.id === subAgentId);
  if (!entry) return;

  const activity = entry.activityLog.find((a) => a.toolCallId === toolCallId);
  if (activity) activity.status = status;

  // Update currentActivity to the last running tool, or clear it
  const lastRunning = [...entry.activityLog].reverse().find((a) => a.status === "running");
  entry.currentActivity = lastRunning ? humanizeToolName(lastRunning.toolName) : undefined;

  statusEmitter?.(parentSessionId, entries);
}

export function updateSubAgentStatus(
  parentSessionId: string,
  id: string,
  status: SubAgentStatus,
  error?: string,
): void {
  const entries = registry.get(parentSessionId);
  if (!entries) return;
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.status = status;
  entry.currentActivity = undefined;
  entry.finishedAt = Date.now();
  if (error) entry.error = error;
  statusEmitter?.(parentSessionId, entries);

  // Auto-cleanup completed entries after 30 seconds
  setTimeout(() => {
    const current = registry.get(parentSessionId);
    if (!current) return;
    const filtered = current.filter((e) => e.id !== id);
    if (filtered.length === 0) {
      registry.delete(parentSessionId);
    } else {
      registry.set(parentSessionId, filtered);
    }
    statusEmitter?.(parentSessionId, filtered);
  }, 30_000);
}

export function getSubAgents(parentSessionId: string): SubAgentEntry[] {
  return registry.get(parentSessionId) ?? [];
}

export function clearSubAgents(parentSessionId: string): void {
  registry.delete(parentSessionId);
  statusEmitter?.(parentSessionId, []);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function humanizeToolName(toolName: string): string {
  // Strip MCP server prefix (e.g., "mcp__server__tool" → "tool")
  const stripped = toolName.includes("__") ? toolName.split("__").pop()! : toolName;
  // Convert camelCase/PascalCase to readable form
  const spaced = stripped.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  // Map known tool names to friendly descriptions
  const friendlyMap: Record<string, string> = {
    bash: "running command",
    shell: "running command",
    read: "reading file",
    write: "writing file",
    edit: "editing file",
    strreplace: "editing file",
    glob: "searching files",
    grep: "searching code",
    ls: "listing directory",
    webfetch: "fetching URL",
    websearch: "searching web",
    "list agents": "listing agents",
    "delegate to agent": "delegating to agent",
  };
  return friendlyMap[spaced] ?? spaced;
}

/**
 * In-memory registry tracking active sub-agent invocations per parent session.
 * Used to broadcast live status indicators to the frontend.
 */

export type SubAgentStatus = "running" | "complete" | "error";

export interface SubAgentEntry {
  id: string;
  agentName: string;
  agentIcon: string | null;
  task: string;
  status: SubAgentStatus;
  error?: string;
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
  existing.push({ id, agentName, agentIcon, task, status: "running", startedAt: Date.now() });
  registry.set(parentSessionId, existing);
  statusEmitter?.(parentSessionId, existing);
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

import { execFileSync } from "child_process";
import { randomUUID } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export type UfwAction = "allow" | "deny" | "limit" | "reject";
export type UfwProtocol = "tcp" | "udp" | "any";
export type UfwDirection = "in" | "out" | "any";

export interface UfwRule {
  number: number;
  to: string;
  action: UfwAction;
  from: string;
  comment?: string;
}

export interface UfwDefaultPolicies {
  incoming: string;
  outgoing: string;
  routed: string;
}

export interface UfwStatus {
  active: boolean;
  logging: string;
  defaultPolicies: UfwDefaultPolicies;
  rules: UfwRule[];
}

export interface PendingChange {
  changeId: string;
  snapshot: UfwRule[];
  wasActive: boolean;
  deadlineMs: number;
  timer: ReturnType<typeof setTimeout>;
  appliedAt: number;
}

// ── Module-level rollback state ───────────────────────────────────────────────

const pendingChanges = new Map<string, PendingChange>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function runUfw(args: string[], timeoutMs = 10_000): { stdout: string; error?: string } {
  try {
    const stdout = execFileSync("sudo", ["ufw", ...args], {
      timeout: timeoutMs,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout: stdout.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: e.stdout?.trim() ?? "",
      error: e.stderr?.trim() || e.message || String(err),
    };
  }
}

// ── Status / Rule parsing ─────────────────────────────────────────────────────

export function isUfwAvailable(): boolean {
  try {
    execFileSync("which", ["ufw"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse `sudo ufw status numbered` output into structured rules.
 * Example lines:
 *   [ 1] 22/tcp                     ALLOW IN    Anywhere
 *   [ 2] 80/tcp                     ALLOW IN    Anywhere (v6)
 *   [ 3] Nginx Full                 ALLOW IN    Anywhere
 */
function parseRules(output: string): UfwRule[] {
  const rules: UfwRule[] = [];
  const lineRegex =
    /^\[\s*(\d+)\]\s+(\S+(?:\s+\S+)?)\s+(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT))?\s+(Anywhere(?:\s+\(v6\))?|[\d./]+(?:\s+\(v6\))?|\S+)\s*(?:#\s*(.+))?$/i;

  for (const line of output.split("\n")) {
    const m = line.match(lineRegex);
    if (!m) continue;
    const action = m[3].toLowerCase() as UfwAction;
    rules.push({
      number: parseInt(m[1], 10),
      to: m[2].trim(),
      action,
      from: m[5].trim(),
      comment: m[6]?.trim() || undefined,
    });
  }
  return rules;
}

export function getUfwStatus(): UfwStatus & { error?: string } {
  const numbered = runUfw(["status", "numbered"]);
  const verbose = runUfw(["status", "verbose"]);

  if (numbered.error && !numbered.stdout) {
    return {
      active: false,
      logging: "unknown",
      defaultPolicies: { incoming: "unknown", outgoing: "unknown", routed: "unknown" },
      rules: [],
      error: numbered.error,
    };
  }

  const active = /Status:\s*active/i.test(numbered.stdout);

  // Parse default policies from verbose output
  const defaultPolicies: UfwDefaultPolicies = { incoming: "deny", outgoing: "allow", routed: "disabled" };
  const inMatch = verbose.stdout.match(/Default:\s*(\w+)\s*\(incoming\)/i);
  const outMatch = verbose.stdout.match(/(\w+)\s*\(outgoing\)/i);
  const routedMatch = verbose.stdout.match(/(\w+)\s*\(routed\)/i);
  if (inMatch) defaultPolicies.incoming = inMatch[1].toLowerCase();
  if (outMatch) defaultPolicies.outgoing = outMatch[1].toLowerCase();
  if (routedMatch) defaultPolicies.routed = routedMatch[1].toLowerCase();

  const loggingMatch = verbose.stdout.match(/Logging:\s*(\S+)/i);
  const logging = loggingMatch?.[1] ?? "on";

  const rules = parseRules(numbered.stdout);

  return { active, logging, defaultPolicies, rules };
}

// ── Rule mutations ────────────────────────────────────────────────────────────

export function addRule(
  action: UfwAction,
  port: string,
  protocol: UfwProtocol,
  fromIP?: string,
  comment?: string
): { success: boolean; error?: string } {
  const protoSuffix = protocol === "any" ? "" : `/${protocol}`;
  const portSpec = `${port}${protoSuffix}`;

  let args: string[];
  if (fromIP && fromIP !== "Anywhere" && fromIP !== "") {
    // e.g. sudo ufw allow from 1.2.3.4 to any port 22 proto tcp
    const protoArgs = protocol === "any" ? [] : ["proto", protocol];
    args = [action, "from", fromIP, "to", "any", "port", port, ...protoArgs];
  } else {
    args = [action, portSpec];
  }

  if (comment) {
    args.push("comment", comment);
  }

  const { error } = runUfw(args);
  if (error) return { success: false, error };
  return { success: true };
}

export function deleteRule(ruleNumber: number): { success: boolean; error?: string } {
  // --force skips the "y/n" interactive prompt
  const { stdout, error } = runUfw(["--force", "delete", String(ruleNumber)]);
  if (error && !stdout.includes("Rule deleted")) return { success: false, error };
  return { success: true };
}

export function setUfwEnabled(enabled: boolean): { success: boolean; error?: string } {
  const args = enabled ? ["--force", "enable"] : ["disable"];
  const { error } = runUfw(args);
  if (error) return { success: false, error };
  return { success: true };
}

// ── Rollback timer ────────────────────────────────────────────────────────────

const ROLLBACK_TIMEOUT_MS = 60_000;

/**
 * Snapshot current state and create a rollback entry.
 * Returns the changeId the client must confirm.
 */
export function createPendingChange(snapshot: UfwRule[], wasActive: boolean): string {
  const changeId = randomUUID();

  const timer = setTimeout(() => {
    const pending = pendingChanges.get(changeId);
    if (!pending) return;
    pendingChanges.delete(changeId);
    // Revert: reset and re-add all snapshot rules
    rollbackToSnapshot(pending.snapshot, pending.wasActive);
    console.warn(`[ufw-manager] Auto-rolled back change ${changeId} after timeout`);
  }, ROLLBACK_TIMEOUT_MS);

  pendingChanges.set(changeId, {
    changeId,
    snapshot,
    wasActive,
    deadlineMs: ROLLBACK_TIMEOUT_MS,
    timer,
    appliedAt: Date.now(),
  });

  return changeId;
}

export function confirmChange(changeId: string): boolean {
  const pending = pendingChanges.get(changeId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingChanges.delete(changeId);
  return true;
}

export function getPendingChange(changeId: string): PendingChange | undefined {
  return pendingChanges.get(changeId);
}

export function rollbackChange(changeId: string): { success: boolean; error?: string } {
  const pending = pendingChanges.get(changeId);
  if (!pending) return { success: false, error: "No pending change found with that ID" };
  clearTimeout(pending.timer);
  pendingChanges.delete(changeId);
  return rollbackToSnapshot(pending.snapshot, pending.wasActive);
}

function rollbackToSnapshot(snapshot: UfwRule[], wasActive: boolean): { success: boolean; error?: string } {
  // Reset UFW (removes all rules) then re-add snapshot rules
  const resetResult = runUfw(["--force", "reset"]);
  if (resetResult.error) return { success: false, error: `Reset failed: ${resetResult.error}` };

  // Re-enable if it was active before the change
  if (wasActive) {
    const enableResult = runUfw(["--force", "enable"]);
    if (enableResult.error) return { success: false, error: `Re-enable failed: ${enableResult.error}` };
  }

  // Re-add all snapshot rules in order (by rule number)
  const sorted = [...snapshot].sort((a, b) => a.number - b.number);
  for (const rule of sorted) {
    // Parse port+proto from rule.to, e.g. "22/tcp" -> port "22", proto "tcp"
    const portProtoMatch = rule.to.match(/^(\S+?)(?:\/(tcp|udp))?$/);
    if (!portProtoMatch) continue;
    const port = portProtoMatch[1];
    const proto: UfwProtocol = (portProtoMatch[2] as UfwProtocol) ?? "any";
    const from = rule.from === "Anywhere" || rule.from === "Anywhere (v6)" ? undefined : rule.from;
    addRule(rule.action, port, proto, from, rule.comment);
  }

  return { success: true };
}

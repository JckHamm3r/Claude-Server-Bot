import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import {
  isUfwAvailable,
  getUfwStatus,
  addRule,
  deleteRule,
  setUfwEnabled,
  createPendingChange,
  confirmChange,
  rollbackChange,
  getPendingChange,
  type UfwAction,
  type UfwProtocol,
} from "@/lib/ufw-manager";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function checkAdminAuth(): Promise<{ error: NextResponse } | { email: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(session.user as { isAdmin?: boolean }).isAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { email: session.user.email };
}

// ── GET: status + rules ───────────────────────────────────────────────────────

export async function GET() {
  const auth = await checkAdminAuth();
  if ("error" in auth) return auth.error;

  const available = isUfwAvailable();
  if (!available) {
    return NextResponse.json({
      available: false,
      status: null,
      appPort: getAppPort(),
      error: "ufw not found on this system",
    });
  }

  const status = getUfwStatus();
  const appPort = getAppPort();

  return NextResponse.json({
    available: true,
    status,
    appPort,
    sshPort: 22,
  });
}

function getAppPort(): number | null {
  try {
    const url = process.env.NEXTAUTH_URL;
    if (!url) return null;
    const parsed = new URL(url);
    if (parsed.port) return parseInt(parsed.port, 10);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

// ── POST: mutations ───────────────────────────────────────────────────────────

interface AddRuleBody {
  action: "add_rule";
  rule: {
    action: UfwAction;
    port: string;
    protocol: UfwProtocol;
    from?: string;
    comment?: string;
  };
}

interface DeleteRuleBody {
  action: "delete_rule";
  ruleNumber: number;
}

interface EnableBody {
  action: "enable" | "disable";
}

interface ConfirmBody {
  action: "confirm_change";
  changeId: string;
}

interface RollbackBody {
  action: "rollback";
  changeId: string;
}

type PostBody = AddRuleBody | DeleteRuleBody | EnableBody | ConfirmBody | RollbackBody;

export async function POST(request: Request) {
  const auth = await checkAdminAuth();
  if ("error" in auth) return auth.error;
  const { email } = auth;

  if (!isUfwAvailable()) {
    return NextResponse.json({ error: "ufw not found on this system" }, { status: 503 });
  }

  let body: PostBody;
  try {
    body = await request.json() as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Enable / Disable UFW ─────────────────────────────────────────────────

  if (body.action === "enable" || body.action === "disable") {
    const enabling = body.action === "enable";
    const currentStatus = getUfwStatus();

    if (enabling) {
      // Enabling is safe — no rollback needed
      const result = setUfwEnabled(true);
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });
      await logActivity("security_ufw_enabled", email, {});
      return NextResponse.json({ success: true, pendingConfirmation: false });
    } else {
      // Disabling is destructive — create rollback
      const snapshot = currentStatus.rules;
      const wasActive = currentStatus.active;
      const result = setUfwEnabled(false);
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });
      await logActivity("security_ufw_disabled", email, {});
      const changeId = createPendingChange(snapshot, wasActive);
      return NextResponse.json({
        success: true,
        pendingConfirmation: true,
        changeId,
        confirmDeadlineMs: 60_000,
      });
    }
  }

  // ── Add Rule ─────────────────────────────────────────────────────────────

  if (body.action === "add_rule") {
    const { rule } = body;
    if (!rule?.action || !rule?.port || !rule?.protocol) {
      return NextResponse.json({ error: "Missing rule fields" }, { status: 400 });
    }

    const result = addRule(rule.action, rule.port, rule.protocol, rule.from, rule.comment);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

    await logActivity("security_ufw_rule_added", email, {
      action: rule.action,
      port: rule.port,
      protocol: rule.protocol,
      from: rule.from ?? "Anywhere",
    });

    // Adding deny/limit is considered destructive; allow is safe
    const isDestructive = rule.action === "deny" || rule.action === "reject" || rule.action === "limit";
    if (isDestructive) {
      const currentStatus = getUfwStatus();
      // Snapshot was taken before this add — the snapshot doesn't have the new rule
      const snapshotWithoutNew = currentStatus.rules.filter(
        (r) => !(r.to.startsWith(rule.port) && r.action === rule.action)
      );
      const changeId = createPendingChange(snapshotWithoutNew, currentStatus.active);
      return NextResponse.json({
        success: true,
        pendingConfirmation: true,
        changeId,
        confirmDeadlineMs: 60_000,
      });
    }

    return NextResponse.json({ success: true, pendingConfirmation: false });
  }

  // ── Delete Rule ───────────────────────────────────────────────────────────

  if (body.action === "delete_rule") {
    const { ruleNumber } = body;
    if (typeof ruleNumber !== "number") {
      return NextResponse.json({ error: "ruleNumber must be a number" }, { status: 400 });
    }

    // Snapshot BEFORE deleting
    const currentStatus = getUfwStatus();
    const ruleToDelete = currentStatus.rules.find((r) => r.number === ruleNumber);
    const snapshot = currentStatus.rules;

    const result = deleteRule(ruleNumber);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

    await logActivity("security_ufw_rule_deleted", email, {
      ruleNumber,
      rule: ruleToDelete ? `${ruleToDelete.action} ${ruleToDelete.to} from ${ruleToDelete.from}` : "unknown",
    });

    const changeId = createPendingChange(snapshot, currentStatus.active);
    return NextResponse.json({
      success: true,
      pendingConfirmation: true,
      changeId,
      confirmDeadlineMs: 60_000,
    });
  }

  // ── Confirm Change ────────────────────────────────────────────────────────

  if (body.action === "confirm_change") {
    const { changeId } = body as ConfirmBody;
    if (!changeId) return NextResponse.json({ error: "changeId required" }, { status: 400 });

    const confirmed = confirmChange(changeId);
    if (!confirmed) {
      return NextResponse.json({ error: "Change not found or already expired" }, { status: 404 });
    }
    await logActivity("security_ufw_change_confirmed", email, { changeId });
    return NextResponse.json({ success: true });
  }

  // ── Manual Rollback ───────────────────────────────────────────────────────

  if (body.action === "rollback") {
    const { changeId } = body as RollbackBody;
    if (!changeId) return NextResponse.json({ error: "changeId required" }, { status: 400 });

    const pending = getPendingChange(changeId);
    if (!pending) {
      return NextResponse.json({ error: "Change not found or already expired" }, { status: 404 });
    }

    const result = rollbackChange(changeId);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

    await logActivity("security_ufw_rollback", email, { changeId, manual: true });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

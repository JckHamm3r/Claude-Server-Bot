import { dbGet, dbAll, dbRun, dbTransaction } from "./db";
import { randomUUID } from "crypto";

// ==================== SESSIONS ====================

export type SessionStatus = 'idle' | 'running' | 'needs_attention';

export interface ClaudeSession {
  id: string;
  name: string | null;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  skip_permissions: boolean;
  model: string;
  provider_type: string;
  status: SessionStatus;
  personality: string | null;
  claude_session_id: string | null;
  context_journal: string | null;
  /** Set when the session is shared with the current user (not owned by them) */
  shared_by?: string;
  /** Ephemeral flag: set client-side when this session was just pushed via a live invite */
  is_new_invite?: boolean;
}

export interface ClaudeMessage {
  id: string;
  session_id: string;
  sender_type: "admin" | "claude";
  sender_id: string | null;
  content: string;
  message_type: "chat" | "system" | "error";
  timestamp: string;
  metadata: Record<string, unknown>;
}

function safeJsonParse<T>(val: unknown, fallback: T): T {
  if (val == null || val === "") return fallback;
  try {
    return JSON.parse(val as string);
  } catch {
    return fallback;
  }
}

function rowToSession(row: Record<string, unknown>): ClaudeSession {
  return {
    id: row.id as string,
    name: row.name as string | null,
    tags: safeJsonParse(row.tags, [] as string[]),
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    skip_permissions: Boolean(row.skip_permissions),
    model: (row.model as string) ?? "claude-sonnet-4-6",
    provider_type: (row.provider_type as string) ?? "sdk",
    status: (row.status as SessionStatus) ?? "idle",
    personality: (row.personality as string | null) ?? null,
    claude_session_id: (row.claude_session_id as string | null) ?? null,
    context_journal: (row.context_journal as string | null) ?? null,
  };
}

function rowToMessage(row: Record<string, unknown>): ClaudeMessage {
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    sender_type: row.sender_type as "admin" | "claude",
    sender_id: row.sender_id as string | null,
    content: row.content as string,
    message_type: row.message_type as "chat" | "system" | "error",
    timestamp: row.timestamp as string,
    metadata: safeJsonParse(row.metadata, {} as Record<string, unknown>),
  };
}

export async function createSession(
  id: string,
  createdBy: string,
  skipPermissions = false,
  model = "claude-sonnet-4-6",
  providerType = "sdk",
  personality?: string,
): Promise<ClaudeSession> {
  await dbRun(`
    INSERT INTO sessions (id, created_by, skip_permissions, model, provider_type, personality)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')
  `, [id, createdBy, skipPermissions ? 1 : 0, model, providerType, personality ?? null]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM sessions WHERE id = ?", [id]);
  return rowToSession(row!);
}

export async function updateSessionModel(id: string, model: string): Promise<void> {
  await dbRun("UPDATE sessions SET model = ?, updated_at = datetime('now') WHERE id = ?", [model, id]);
}

export async function getSession(id: string): Promise<ClaudeSession | null> {
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM sessions WHERE id = ?", [id]);
  return row ? rowToSession(row) : null;
}

export async function listSessions(createdBy: string): Promise<ClaudeSession[]> {
  const ownRows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM sessions WHERE created_by = ? ORDER BY updated_at DESC",
    [createdBy]
  );
  const sharedRows = await dbAll<Record<string, unknown>>(`
    SELECT s.*, sp.user_email as _participant_email
    FROM sessions s
    JOIN session_participants sp ON sp.session_id = s.id
    WHERE sp.user_email = ? AND s.created_by != ?
    ORDER BY s.updated_at DESC
  `, [createdBy, createdBy]);

  const own = ownRows.map(rowToSession);
  const shared = sharedRows.map((row) => {
    const session = rowToSession(row);
    session.shared_by = row.created_by as string;
    return session;
  });

  const seen = new Set<string>(own.map((s) => s.id));
  const merged = [...own];
  for (const s of shared) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }
  merged.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  return merged;
}

export async function renameSession(id: string, name: string): Promise<void> {
  await dbRun("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, id]);
}

export async function saveMessage(
  sessionId: string,
  senderType: "admin" | "claude",
  content: string,
  senderId?: string,
  messageType: "chat" | "system" | "error" = "chat",
  metadata?: Record<string, unknown>,
): Promise<ClaudeMessage> {
  const id = randomUUID();
  await dbTransaction(async ({ run, get }) => {
    await run(`
      INSERT INTO messages (id, session_id, sender_type, sender_id, content, message_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, sessionId, senderType, senderId ?? null, content, messageType, JSON.stringify(metadata ?? {})]);
    await run("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?", [sessionId]);
    return get<Record<string, unknown>>("SELECT * FROM messages WHERE id = ?", [id]);
  });
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM messages WHERE id = ?", [id]);
  return rowToMessage(row!);
}

export async function getMessages(sessionId: string): Promise<ClaudeMessage[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
    [sessionId]
  );
  return rows.map(rowToMessage);
}

export async function deleteSession(id: string): Promise<void> {
  await dbRun("DELETE FROM sessions WHERE id = ?", [id]);
}

export async function updateSessionTags(id: string, tags: string[]): Promise<void> {
  await dbRun("UPDATE sessions SET tags = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(tags), id]);
}

// ==================== SESSION STATUS ====================

export async function updateSessionStatus(id: string, status: SessionStatus): Promise<void> {
  await dbRun("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id]);
}

export async function updateClaudeSessionId(id: string, claudeSessionId: string | null): Promise<void> {
  await dbRun("UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?", [claudeSessionId, id]);
}

// ==================== MESSAGE EDIT / DELETE ====================

export async function deleteMessage(messageId: string): Promise<void> {
  await dbRun("DELETE FROM messages WHERE id = ?", [messageId]);
}

export async function deleteMessagesAfter(sessionId: string, timestamp: string): Promise<void> {
  await dbRun("DELETE FROM messages WHERE session_id = ? AND timestamp > ?", [sessionId, timestamp]);
}

export async function updateMessageContent(messageId: string, content: string): Promise<void> {
  await dbRun("UPDATE messages SET content = ? WHERE id = ?", [content, messageId]);
}

export async function getMessage(messageId: string): Promise<ClaudeMessage | null> {
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM messages WHERE id = ?", [messageId]);
  return row ? rowToMessage(row) : null;
}

// ==================== TOKEN USAGE ====================

export interface SessionTokenUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  message_count: number;
}

export async function getSessionTokenUsage(sessionId: string): Promise<SessionTokenUsage> {
  const rows = await dbAll<{ metadata: string }>(
    "SELECT metadata FROM messages WHERE session_id = ? AND sender_type = 'claude' ORDER BY timestamp ASC",
    [sessionId]
  );
  let latestInput = 0;
  let latestOutput = 0;
  let latestCost = 0;
  let count = 0;
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata);
      if (meta.usage) {
        latestInput = meta.usage.input_tokens ?? latestInput;
        latestOutput = meta.usage.output_tokens ?? latestOutput;
        latestCost = meta.usage.cost_usd ?? latestCost;
        count++;
      }
    } catch { /* skip */ }
  }
  return { total_input_tokens: latestInput, total_output_tokens: latestOutput, total_cost_usd: latestCost, message_count: count };
}

export async function getGlobalTokenUsage(opts?: { since?: string; userId?: string }): Promise<SessionTokenUsage> {
  // Push aggregation to SQL instead of loading every message into memory.
  // The last claude message per session has the cumulative usage for that session.
  const conditions: string[] = ["m.sender_type = 'claude'", "json_extract(m.metadata, '$.usage') IS NOT NULL"];
  const params: unknown[] = [];
  let joinClause = "";

  if (opts?.userId) {
    joinClause = " JOIN sessions s ON m.session_id = s.id";
    conditions.push("s.created_by = ?");
    params.push(opts.userId);
  }
  if (opts?.since) {
    conditions.push("m.timestamp >= ?");
    params.push(opts.since);
  }

  const whereClause = " WHERE " + conditions.join(" AND ");

  // Count all messages with usage data
  const countRow = await dbGet<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM messages m${joinClause}${whereClause}`,
    params as string[]
  );

  // Sum usage from the latest message per session (last message has cumulative usage)
  const sumRow = await dbGet<{ total_input: number; total_output: number; total_cost: number }>(
    `SELECT
      COALESCE(SUM(json_extract(sub.metadata, '$.usage.input_tokens')), 0) as total_input,
      COALESCE(SUM(json_extract(sub.metadata, '$.usage.output_tokens')), 0) as total_output,
      COALESCE(SUM(json_extract(sub.metadata, '$.usage.cost_usd')), 0) as total_cost
    FROM (
      SELECT m.session_id, m.metadata,
        ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY m.timestamp DESC) as rn
      FROM messages m${joinClause}${whereClause}
    ) sub
    WHERE sub.rn = 1`,
    params as string[]
  );

  return {
    total_input_tokens: sumRow?.total_input ?? 0,
    total_output_tokens: sumRow?.total_output ?? 0,
    total_cost_usd: sumRow?.total_cost ?? 0,
    message_count: countRow?.cnt ?? 0,
  };
}

// ==================== SESSION TEMPLATES ====================

export interface SessionTemplate {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  model: string;
  skip_permissions: boolean;
  provider_type: string;
  icon: string | null;
  is_default: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: Record<string, unknown>): SessionTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    system_prompt: row.system_prompt as string | null,
    model: (row.model as string) ?? "claude-sonnet-4-6",
    skip_permissions: Boolean(row.skip_permissions),
    provider_type: (row.provider_type as string) ?? "sdk",
    icon: row.icon as string | null,
    is_default: Boolean(row.is_default),
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function listTemplates(): Promise<SessionTemplate[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM session_templates ORDER BY is_default DESC, name ASC"
  );
  return rows.map(rowToTemplate);
}

export async function getTemplate(id: string): Promise<SessionTemplate | null> {
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM session_templates WHERE id = ?", [id]);
  return row ? rowToTemplate(row) : null;
}

export async function createTemplate(
  data: { name: string; description?: string; system_prompt?: string; model?: string; skip_permissions?: boolean; provider_type?: string; icon?: string; is_default?: boolean },
  createdBy: string,
): Promise<SessionTemplate> {
  const id = randomUUID();
  await dbRun(`
    INSERT INTO session_templates (id, name, description, system_prompt, model, skip_permissions, provider_type, icon, is_default, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    data.name,
    data.description ?? null,
    data.system_prompt ?? null,
    data.model ?? "claude-sonnet-4-6",
    data.skip_permissions ? 1 : 0,
    data.provider_type ?? "sdk",
    data.icon ?? null,
    data.is_default ? 1 : 0,
    createdBy,
  ]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM session_templates WHERE id = ?", [id]);
  return rowToTemplate(row!);
}

export async function updateTemplate(
  id: string,
  data: Partial<{ name: string; description: string; system_prompt: string; model: string; skip_permissions: boolean; provider_type: string; icon: string; is_default: boolean }>,
): Promise<SessionTemplate> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.system_prompt !== undefined) { fields.push("system_prompt = ?"); values.push(data.system_prompt); }
  if (data.model !== undefined) { fields.push("model = ?"); values.push(data.model); }
  if (data.skip_permissions !== undefined) { fields.push("skip_permissions = ?"); values.push(data.skip_permissions ? 1 : 0); }
  if (data.provider_type !== undefined) { fields.push("provider_type = ?"); values.push(data.provider_type); }
  if (data.icon !== undefined) { fields.push("icon = ?"); values.push(data.icon); }
  if (data.is_default !== undefined) { fields.push("is_default = ?"); values.push(data.is_default ? 1 : 0); }
  fields.push("updated_at = datetime('now')");
  values.push(id);
  await dbRun(`UPDATE session_templates SET ${fields.join(", ")} WHERE id = ?`, values as string[]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM session_templates WHERE id = ?", [id]);
  return rowToTemplate(row!);
}

export async function deleteTemplate(id: string): Promise<void> {
  await dbRun("DELETE FROM session_templates WHERE id = ?", [id]);
}

// ==================== AGENTS ====================

export interface ClaudeAgent {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  model: string;
  allowed_tools: string[];
  status: "active" | "disabled" | "archived";
  current_version: number;
  use_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ClaudeAgentVersion {
  id: string;
  agent_id: string;
  version_number: number;
  config_snapshot: Omit<ClaudeAgent, "id" | "created_by" | "created_at" | "updated_at">;
  change_description: string | null;
  created_by: string;
  created_at: string;
}

function rowToAgent(row: Record<string, unknown>): ClaudeAgent {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    icon: row.icon as string | null,
    model: row.model as string,
    allowed_tools: safeJsonParse(row.allowed_tools, [] as string[]),
    status: row.status as "active" | "disabled" | "archived",
    current_version: row.current_version as number,
    use_count: (row.use_count as number) ?? 0,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToAgentVersion(row: Record<string, unknown>): ClaudeAgentVersion {
  return {
    id: row.id as string,
    agent_id: row.agent_id as string,
    version_number: row.version_number as number,
    config_snapshot: safeJsonParse(row.config_snapshot, {} as ClaudeAgentVersion["config_snapshot"]),
    change_description: row.change_description as string | null,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
  };
}

export async function listAgents(createdBy: string): Promise<ClaudeAgent[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM agents WHERE created_by = ? AND status != 'archived' ORDER BY updated_at DESC",
    [createdBy]
  );
  return rows.map(rowToAgent);
}

export async function getActiveAgents(): Promise<ClaudeAgent[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM agents WHERE status = 'active' ORDER BY name ASC"
  );
  return rows.map(rowToAgent);
}

export async function getAgent(id: string): Promise<ClaudeAgent | null> {
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM agents WHERE id = ?", [id]);
  return row ? rowToAgent(row) : null;
}

export async function createAgent(
  data: { name: string; description: string; icon?: string; model: string; allowed_tools: string[] },
  createdBy: string,
): Promise<ClaudeAgent> {
  const id = randomUUID();
  const versionId = randomUUID();
  await dbTransaction(async ({ run }) => {
    await run(`
      INSERT INTO agents (id, name, description, icon, model, allowed_tools, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, data.name, data.description, data.icon ?? null, data.model, JSON.stringify(data.allowed_tools), createdBy]);
    await run(`
      INSERT INTO agent_versions (id, agent_id, version_number, config_snapshot, change_description, created_by)
      VALUES (?, ?, 1, ?, 'Initial version', ?)
    `, [versionId, id, JSON.stringify({ name: data.name, description: data.description, icon: data.icon ?? null, model: data.model, allowed_tools: data.allowed_tools, status: 'active', current_version: 1 }), createdBy]);
  });
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM agents WHERE id = ?", [id]);
  return rowToAgent(row!);
}

export async function updateAgent(
  id: string,
  data: Partial<{ name: string; description: string; icon: string; model: string; allowed_tools: string[]; status: string }>,
  updatedBy: string,
  changeDescription?: string,
): Promise<ClaudeAgent> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.icon !== undefined) { fields.push("icon = ?"); values.push(data.icon); }
  if (data.model !== undefined) { fields.push("model = ?"); values.push(data.model); }
  if (data.allowed_tools !== undefined) { fields.push("allowed_tools = ?"); values.push(JSON.stringify(data.allowed_tools)); }
  if (data.status !== undefined) { fields.push("status = ?"); values.push(data.status); }
  fields.push("updated_at = datetime('now')");
  fields.push("current_version = current_version + 1");
  values.push(id);
  // Wrap in transaction to prevent concurrent updates from producing duplicate version numbers
  const agent = await dbTransaction(async ({ run, get }) => {
    await run(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`, values as string[]);
    const row = await get<Record<string, unknown>>("SELECT * FROM agents WHERE id = ?", [id]);
    const updated = rowToAgent(row!);
    const versionId = randomUUID();
    await run(`
      INSERT INTO agent_versions (id, agent_id, version_number, config_snapshot, change_description, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [versionId, id, updated.current_version, JSON.stringify({ name: updated.name, description: updated.description, icon: updated.icon, model: updated.model, allowed_tools: updated.allowed_tools, status: updated.status, current_version: updated.current_version }), changeDescription ?? null, updatedBy]);
    return updated;
  });
  return agent;
}

export async function deleteAgent(id: string): Promise<void> {
  await dbRun("DELETE FROM agents WHERE id = ?", [id]);
}

export async function incrementAgentUseCount(id: string): Promise<void> {
  await dbRun("UPDATE agents SET use_count = use_count + 1 WHERE id = ?", [id]);
}

export async function getAgentVersions(agentId: string): Promise<ClaudeAgentVersion[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version_number DESC",
    [agentId]
  );
  return rows.map(rowToAgentVersion);
}

// ==================== PLANS ====================

export interface ClaudePlan {
  id: string;
  session_id: string;
  goal: string;
  status: "drafting" | "reviewing" | "executing" | "completed" | "failed" | "cancelled";
  created_by: string;
  created_at: string;
  updated_at: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  steps?: ClaudePlanStep[];
}

export interface ClaudePlanStep {
  id: string;
  plan_id: string;
  step_order: number;
  summary: string;
  details: string | null;
  status: "pending" | "approved" | "rejected" | "executing" | "completed" | "failed" | "rolled_back";
  result: string | null;
  error: string | null;
  approved_by: string | null;
  executed_at: string | null;
  created_at: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  depends_on: string[] | null;
}

function rowToPlan(row: Record<string, unknown>): ClaudePlan {
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    goal: row.goal as string,
    status: row.status as ClaudePlan["status"],
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    total_input_tokens: (row.total_input_tokens as number) ?? 0,
    total_output_tokens: (row.total_output_tokens as number) ?? 0,
    total_cost_usd: (row.total_cost_usd as number) ?? 0,
  };
}

function rowToPlanStep(row: Record<string, unknown>): ClaudePlanStep {
  return {
    id: row.id as string,
    plan_id: row.plan_id as string,
    step_order: row.step_order as number,
    summary: row.summary as string,
    details: row.details as string | null,
    status: row.status as ClaudePlanStep["status"],
    result: row.result as string | null,
    error: row.error as string | null,
    approved_by: row.approved_by as string | null,
    executed_at: row.executed_at as string | null,
    created_at: row.created_at as string,
    input_tokens: (row.input_tokens as number) ?? 0,
    output_tokens: (row.output_tokens as number) ?? 0,
    cost_usd: (row.cost_usd as number) ?? 0,
    depends_on: row.depends_on ? JSON.parse(row.depends_on as string) : null,
  };
}

export async function createPlan(sessionId: string, goal: string, createdBy: string): Promise<ClaudePlan> {
  const id = randomUUID();
  await dbRun("INSERT INTO plans (id, session_id, goal, created_by) VALUES (?, ?, ?, ?)", [id, sessionId, goal, createdBy]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM plans WHERE id = ?", [id]);
  return rowToPlan(row!);
}

export async function getPlan(id: string): Promise<ClaudePlan | null> {
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM plans WHERE id = ?", [id]);
  if (!row) return null;
  const plan = rowToPlan(row);
  plan.steps = await getPlanSteps(id);
  return plan;
}

export async function updatePlanStatus(id: string, status: ClaudePlan["status"]): Promise<void> {
  await dbRun("UPDATE plans SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id]);
}

export async function listPlans(sessionId: string): Promise<ClaudePlan[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM plans WHERE session_id = ? ORDER BY created_at DESC",
    [sessionId]
  );
  return rows.map(rowToPlan);
}

export async function listPlansForUser(email: string): Promise<ClaudePlan[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM plans WHERE created_by = ? ORDER BY created_at DESC",
    [email]
  );
  return rows.map(rowToPlan);
}

export async function addPlanStep(planId: string, step: { step_order: number; summary: string; details?: string }): Promise<ClaudePlanStep> {
  const id = randomUUID();
  await dbRun(
    "INSERT INTO plan_steps (id, plan_id, step_order, summary, details) VALUES (?, ?, ?, ?, ?)",
    [id, planId, step.step_order, step.summary, step.details ?? null]
  );
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM plan_steps WHERE id = ?", [id]);
  return rowToPlanStep(row!);
}

export async function getPlanSteps(planId: string): Promise<ClaudePlanStep[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY step_order ASC",
    [planId]
  );
  return rows.map(rowToPlanStep);
}

export async function updatePlanStep(
  id: string,
  data: Partial<{ summary: string; details: string; status: ClaudePlanStep["status"]; step_order: number; result: string; error: string; approved_by: string; executed_at: string; input_tokens: number; output_tokens: number; cost_usd: number; depends_on: string }>,
): Promise<ClaudePlanStep> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.summary !== undefined) { fields.push("summary = ?"); values.push(data.summary); }
  if (data.details !== undefined) { fields.push("details = ?"); values.push(data.details); }
  if (data.status !== undefined) { fields.push("status = ?"); values.push(data.status); }
  if (data.step_order !== undefined) { fields.push("step_order = ?"); values.push(data.step_order); }
  if (data.result !== undefined) { fields.push("result = ?"); values.push(data.result); }
  if (data.error !== undefined) { fields.push("error = ?"); values.push(data.error); }
  if (data.approved_by !== undefined) { fields.push("approved_by = ?"); values.push(data.approved_by); }
  if (data.executed_at !== undefined) { fields.push("executed_at = ?"); values.push(data.executed_at); }
  if (data.input_tokens !== undefined) { fields.push("input_tokens = ?"); values.push(data.input_tokens); }
  if (data.output_tokens !== undefined) { fields.push("output_tokens = ?"); values.push(data.output_tokens); }
  if (data.cost_usd !== undefined) { fields.push("cost_usd = ?"); values.push(data.cost_usd); }
  if (data.depends_on !== undefined) { fields.push("depends_on = ?"); values.push(data.depends_on); }
  if (fields.length === 0) {
    const row = await dbGet<Record<string, unknown>>("SELECT * FROM plan_steps WHERE id = ?", [id]);
    return rowToPlanStep(row!);
  }
  values.push(id);
  await dbRun(`UPDATE plan_steps SET ${fields.join(", ")} WHERE id = ?`, values as string[]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM plan_steps WHERE id = ?", [id]);
  return rowToPlanStep(row!);
}

export async function deletePlanSteps(planId: string): Promise<void> {
  await dbRun("DELETE FROM plan_steps WHERE plan_id = ?", [planId]);
}

export async function deletePlan(planId: string): Promise<void> {
  await dbRun("DELETE FROM plans WHERE id = ?", [planId]);
}

export async function incrementPlanCost(
  planId: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
): Promise<void> {
  await dbRun(
    `UPDATE plans SET
      total_input_tokens = total_input_tokens + ?,
      total_output_tokens = total_output_tokens + ?,
      total_cost_usd = total_cost_usd + ?,
      updated_at = datetime('now')
    WHERE id = ?`,
    [inputTokens, outputTokens, costUsd, planId]
  );
}

// ==================== USER SETTINGS ====================

export interface ClaudeUserSettings {
  email: string;
  full_trust_mode: boolean;
  custom_default_context: string | null;
  auto_naming_enabled: boolean;
  setup_complete: boolean;
  experience_level: string;
  server_purposes: string[];
  project_type: string;
  auto_summary: boolean;
  profile_wizard_complete: boolean;
  updated_at: string;
}

function rowToSettings(row: Record<string, unknown>): ClaudeUserSettings {
  let server_purposes: string[] = [];
  try { server_purposes = JSON.parse(row.server_purposes as string ?? "[]"); } catch { /* ignore */ }
  return {
    email: row.email as string,
    full_trust_mode: Boolean(row.full_trust_mode),
    custom_default_context: row.custom_default_context as string | null,
    auto_naming_enabled: Boolean(row.auto_naming_enabled),
    setup_complete: Boolean(row.setup_complete),
    experience_level: (row.experience_level as string) || "expert",
    server_purposes,
    project_type: (row.project_type as string) || "",
    auto_summary: row.auto_summary !== undefined ? Boolean(row.auto_summary) : true,
    profile_wizard_complete: Boolean(row.profile_wizard_complete),
    updated_at: row.updated_at as string,
  };
}

export async function getUserSettings(email: string): Promise<ClaudeUserSettings> {
  await dbRun("INSERT OR IGNORE INTO user_settings (email) VALUES (?)", [email]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM user_settings WHERE email = ?", [email]);
  return rowToSettings(row!);
}

export async function updateUserSettings(
  email: string,
  data: Partial<{
    full_trust_mode: boolean;
    custom_default_context: string | null;
    auto_naming_enabled: boolean;
    setup_complete: boolean;
    experience_level: string;
    server_purposes: string[];
    project_type: string;
    auto_summary: boolean;
    profile_wizard_complete: boolean;
  }>,
): Promise<ClaudeUserSettings> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.full_trust_mode !== undefined) { fields.push("full_trust_mode = ?"); values.push(data.full_trust_mode ? 1 : 0); }
  if (data.custom_default_context !== undefined) { fields.push("custom_default_context = ?"); values.push(data.custom_default_context); }
  if (data.auto_naming_enabled !== undefined) { fields.push("auto_naming_enabled = ?"); values.push(data.auto_naming_enabled ? 1 : 0); }
  if (data.setup_complete !== undefined) { fields.push("setup_complete = ?"); values.push(data.setup_complete ? 1 : 0); }
  if (data.experience_level !== undefined) { fields.push("experience_level = ?"); values.push(data.experience_level); }
  if (data.server_purposes !== undefined) { fields.push("server_purposes = ?"); values.push(JSON.stringify(data.server_purposes)); }
  if (data.project_type !== undefined) { fields.push("project_type = ?"); values.push(data.project_type); }
  if (data.auto_summary !== undefined) { fields.push("auto_summary = ?"); values.push(data.auto_summary ? 1 : 0); }
  if (data.profile_wizard_complete !== undefined) { fields.push("profile_wizard_complete = ?"); values.push(data.profile_wizard_complete ? 1 : 0); }
  if (fields.length === 0) return getUserSettings(email);
  fields.push("updated_at = datetime('now')");
  values.push(email);
  await dbRun("INSERT OR IGNORE INTO user_settings (email) VALUES (?)", [email]);
  await dbRun(`UPDATE user_settings SET ${fields.join(", ")} WHERE email = ?`, values as string[]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM user_settings WHERE email = ?", [email]);
  return rowToSettings(row!);
}

// ==================== UPLOADS ====================

export interface ClaudeUpload {
  id: string;
  session_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
}

function rowToUpload(row: Record<string, unknown>): ClaudeUpload {
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    original_name: row.original_name as string,
    stored_name: row.stored_name as string,
    mime_type: row.mime_type as string,
    size_bytes: row.size_bytes as number,
    uploaded_by: row.uploaded_by as string,
    created_at: row.created_at as string,
  };
}

export async function createUpload(data: {
  id: string;
  sessionId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
}): Promise<ClaudeUpload> {
  await dbRun(`
    INSERT INTO uploads (id, session_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [data.id, data.sessionId, data.originalName, data.storedName, data.mimeType, data.sizeBytes, data.uploadedBy]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM uploads WHERE id = ?", [data.id]);
  return rowToUpload(row!);
}

export async function getUpload(id: string): Promise<ClaudeUpload | null> {
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM uploads WHERE id = ?", [id]);
  return row ? rowToUpload(row) : null;
}

export async function getSessionUploads(sessionId: string): Promise<ClaudeUpload[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM uploads WHERE session_id = ? ORDER BY created_at ASC",
    [sessionId]
  );
  return rows.map(rowToUpload);
}

export async function deleteUpload(id: string): Promise<void> {
  await dbRun("DELETE FROM uploads WHERE id = ?", [id]);
}

export async function deleteSessionUploads(sessionId: string): Promise<void> {
  await dbRun("DELETE FROM uploads WHERE session_id = ?", [sessionId]);
}

// ==================== JOBS ====================

export type JobStatus = "active" | "paused" | "failed" | "draft";
export type JobRunStatus = "running" | "success" | "failed" | "cancelled";
export type JobRunTrigger = "timer" | "manual" | "retry";

export interface Job {
  id: string;
  name: string;
  description: string;
  script_path: string;
  schedule: string;
  schedule_display: string;
  working_directory: string;
  environment: Record<string, string>;
  status: JobStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_run_status: "success" | "failed" | "running" | null;
  next_run_at: string | null;
  run_count: number;
  fail_count: number;
  consecutive_failures: number;
  max_retries: number;
  timeout_seconds: number;
  auto_disable_after: number;
  notify_on_failure: boolean;
  notify_on_success: boolean;
  tags: string[];
  ai_generated: boolean;
  systemd_unit: string | null;
}

export interface JobRun {
  id: string;
  job_id: string;
  started_at: string;
  finished_at: string | null;
  status: JobRunStatus;
  exit_code: number | null;
  output: string;
  output_log_path: string | null;
  duration_ms: number | null;
  triggered_by: JobRunTrigger;
  error_summary: string | null;
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    script_path: row.script_path as string,
    schedule: row.schedule as string,
    schedule_display: (row.schedule_display as string) ?? "",
    working_directory: (row.working_directory as string) ?? "",
    environment: safeJsonParse(row.environment, {} as Record<string, string>),
    status: row.status as JobStatus,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    last_run_at: row.last_run_at as string | null,
    last_run_status: row.last_run_status as "success" | "failed" | "running" | null,
    next_run_at: row.next_run_at as string | null,
    run_count: (row.run_count as number) ?? 0,
    fail_count: (row.fail_count as number) ?? 0,
    consecutive_failures: (row.consecutive_failures as number) ?? 0,
    max_retries: (row.max_retries as number) ?? 0,
    timeout_seconds: (row.timeout_seconds as number) ?? 0,
    auto_disable_after: (row.auto_disable_after as number) ?? 0,
    notify_on_failure: Boolean(row.notify_on_failure ?? 1),
    notify_on_success: Boolean(row.notify_on_success),
    tags: safeJsonParse(row.tags, [] as string[]),
    ai_generated: Boolean(row.ai_generated),
    systemd_unit: row.systemd_unit as string | null,
  };
}

function rowToJobRun(row: Record<string, unknown>): JobRun {
  return {
    id: row.id as string,
    job_id: row.job_id as string,
    started_at: row.started_at as string,
    finished_at: row.finished_at as string | null,
    status: row.status as JobRunStatus,
    exit_code: row.exit_code as number | null,
    output: (row.output as string) ?? "",
    output_log_path: row.output_log_path as string | null,
    duration_ms: row.duration_ms as number | null,
    triggered_by: (row.triggered_by as JobRunTrigger) ?? "timer",
    error_summary: row.error_summary as string | null,
  };
}

export async function createJob(data: {
  name: string;
  description?: string;
  script_path: string;
  schedule: string;
  schedule_display?: string;
  working_directory?: string;
  environment?: Record<string, string>;
  max_retries?: number;
  timeout_seconds?: number;
  auto_disable_after?: number;
  notify_on_failure?: boolean;
  notify_on_success?: boolean;
  tags?: string[];
  ai_generated?: boolean;
}, createdBy: string): Promise<Job> {
  const id = randomUUID().replace(/-/g, "").slice(0, 32);
  await dbRun(`
    INSERT INTO jobs (id, name, description, script_path, schedule, schedule_display,
      working_directory, environment, max_retries, timeout_seconds, auto_disable_after,
      notify_on_failure, notify_on_success, tags, ai_generated, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    data.name,
    data.description ?? "",
    data.script_path,
    data.schedule,
    data.schedule_display ?? "",
    data.working_directory ?? "",
    JSON.stringify(data.environment ?? {}),
    data.max_retries ?? 0,
    data.timeout_seconds ?? 0,
    data.auto_disable_after ?? 0,
    (data.notify_on_failure ?? true) ? 1 : 0,
    (data.notify_on_success ?? false) ? 1 : 0,
    JSON.stringify(data.tags ?? []),
    (data.ai_generated ?? false) ? 1 : 0,
    createdBy,
  ]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM jobs WHERE id = ?", [id]);
  return rowToJob(row!);
}

export async function getJob(id: string): Promise<Job | null> {
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM jobs WHERE id = ?", [id]);
  return row ? rowToJob(row) : null;
}

export async function listJobs(): Promise<Job[]> {
  const rows = await dbAll<Record<string, unknown>>("SELECT * FROM jobs ORDER BY updated_at DESC");
  return rows.map(rowToJob);
}

export async function updateJob(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    script_path: string;
    schedule: string;
    schedule_display: string;
    working_directory: string;
    environment: Record<string, string>;
    status: JobStatus;
    max_retries: number;
    timeout_seconds: number;
    auto_disable_after: number;
    notify_on_failure: boolean;
    notify_on_success: boolean;
    tags: string[];
    systemd_unit: string;
    last_run_at: string;
    last_run_status: "success" | "failed" | "running" | null;
    next_run_at: string | null;
    run_count: number;
    fail_count: number;
    consecutive_failures: number;
  }>,
): Promise<Job> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.script_path !== undefined) { fields.push("script_path = ?"); values.push(data.script_path); }
  if (data.schedule !== undefined) { fields.push("schedule = ?"); values.push(data.schedule); }
  if (data.schedule_display !== undefined) { fields.push("schedule_display = ?"); values.push(data.schedule_display); }
  if (data.working_directory !== undefined) { fields.push("working_directory = ?"); values.push(data.working_directory); }
  if (data.environment !== undefined) { fields.push("environment = ?"); values.push(JSON.stringify(data.environment)); }
  if (data.status !== undefined) { fields.push("status = ?"); values.push(data.status); }
  if (data.max_retries !== undefined) { fields.push("max_retries = ?"); values.push(data.max_retries); }
  if (data.timeout_seconds !== undefined) { fields.push("timeout_seconds = ?"); values.push(data.timeout_seconds); }
  if (data.auto_disable_after !== undefined) { fields.push("auto_disable_after = ?"); values.push(data.auto_disable_after); }
  if (data.notify_on_failure !== undefined) { fields.push("notify_on_failure = ?"); values.push(data.notify_on_failure ? 1 : 0); }
  if (data.notify_on_success !== undefined) { fields.push("notify_on_success = ?"); values.push(data.notify_on_success ? 1 : 0); }
  if (data.tags !== undefined) { fields.push("tags = ?"); values.push(JSON.stringify(data.tags)); }
  if (data.systemd_unit !== undefined) { fields.push("systemd_unit = ?"); values.push(data.systemd_unit); }
  if (data.last_run_at !== undefined) { fields.push("last_run_at = ?"); values.push(data.last_run_at); }
  if (data.last_run_status !== undefined) { fields.push("last_run_status = ?"); values.push(data.last_run_status); }
  if (data.next_run_at !== undefined) { fields.push("next_run_at = ?"); values.push(data.next_run_at); }
  if (data.run_count !== undefined) { fields.push("run_count = ?"); values.push(data.run_count); }
  if (data.fail_count !== undefined) { fields.push("fail_count = ?"); values.push(data.fail_count); }
  if (data.consecutive_failures !== undefined) { fields.push("consecutive_failures = ?"); values.push(data.consecutive_failures); }
  if (fields.length === 0) return (await getJob(id))!;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  await dbRun(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`, values as string[]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM jobs WHERE id = ?", [id]);
  return rowToJob(row!);
}

export async function deleteJob(id: string): Promise<void> {
  await dbRun("DELETE FROM jobs WHERE id = ?", [id]);
}

export async function createJobRun(jobId: string, triggeredBy: JobRunTrigger = "timer"): Promise<JobRun> {
  const id = randomUUID().replace(/-/g, "").slice(0, 32);
  await dbRun("INSERT INTO job_runs (id, job_id, triggered_by) VALUES (?, ?, ?)", [id, jobId, triggeredBy]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM job_runs WHERE id = ?", [id]);
  return rowToJobRun(row!);
}

export async function updateJobRun(
  id: string,
  data: Partial<{
    finished_at: string;
    status: JobRunStatus;
    exit_code: number;
    output: string;
    output_log_path: string;
    duration_ms: number;
    error_summary: string;
  }>,
): Promise<JobRun> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.finished_at !== undefined) { fields.push("finished_at = ?"); values.push(data.finished_at); }
  if (data.status !== undefined) { fields.push("status = ?"); values.push(data.status); }
  if (data.exit_code !== undefined) { fields.push("exit_code = ?"); values.push(data.exit_code); }
  if (data.output !== undefined) { fields.push("output = ?"); values.push(data.output); }
  if (data.output_log_path !== undefined) { fields.push("output_log_path = ?"); values.push(data.output_log_path); }
  if (data.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(data.duration_ms); }
  if (data.error_summary !== undefined) { fields.push("error_summary = ?"); values.push(data.error_summary); }
  if (fields.length === 0) return (await getJobRun(id))!;
  values.push(id);
  await dbRun(`UPDATE job_runs SET ${fields.join(", ")} WHERE id = ?`, values as string[]);
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM job_runs WHERE id = ?", [id]);
  return rowToJobRun(row!);
}

export async function getJobRun(id: string): Promise<JobRun | null> {
  const row = await dbGet<Record<string, unknown>>("SELECT * FROM job_runs WHERE id = ?", [id]);
  return row ? rowToJobRun(row) : null;
}

export async function listJobRuns(jobId: string, limit = 50): Promise<JobRun[]> {
  const rows = await dbAll<Record<string, unknown>>(
    "SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?",
    [jobId, limit]
  );
  return rows.map(rowToJobRun);
}

export async function getActiveJobRun(jobId: string): Promise<JobRun | null> {
  const row = await dbGet<Record<string, unknown>>(
    "SELECT * FROM job_runs WHERE job_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1",
    [jobId]
  );
  return row ? rowToJobRun(row) : null;
}

// ==================== SEARCH ====================

export interface SearchResult {
  messageId: string;
  sessionId: string;
  sessionName: string | null;
  senderType: string;
  content: string;
  snippet: string;
  timestamp: string;
}

export async function searchMessages(query: string, limit = 50): Promise<SearchResult[]> {
  try {
    const safeQuery = '"' + query.replace(/"/g, '""') + '"';
    const rows = await dbAll<SearchResult>(`
      SELECT m.id as messageId, m.session_id as sessionId, s.name as sessionName,
             m.sender_type as senderType, m.content, m.timestamp,
             snippet(messages_fts, 0, '[[highlight]]', '[[/highlight]]', '...', 40) as snippet
      FROM messages_fts
      JOIN messages m ON messages_fts.rowid = m.rowid
      LEFT JOIN sessions s ON m.session_id = s.id
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `, [safeQuery, limit]);
    return rows;
  } catch {
    return [];
  }
}

export async function searchSessionMessages(sessionId: string, query: string, limit = 50): Promise<SearchResult[]> {
  try {
    const safeQuery = '"' + query.replace(/"/g, '""') + '"';
    const rows = await dbAll<SearchResult>(`
      SELECT m.id as messageId, m.session_id as sessionId, s.name as sessionName,
             m.sender_type as senderType, m.content, m.timestamp,
             snippet(messages_fts, 0, '[[highlight]]', '[[/highlight]]', '...', 40) as snippet
      FROM messages_fts
      JOIN messages m ON messages_fts.rowid = m.rowid
      LEFT JOIN sessions s ON m.session_id = s.id
      WHERE messages_fts MATCH ? AND m.session_id = ?
      ORDER BY rank
      LIMIT ?
    `, [safeQuery, sessionId, limit]);
    return rows;
  } catch {
    return [];
  }
}

// ==================== USER HELPERS ====================

export interface DbUser {
  email: string;
  is_admin: number;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  must_change_password: number;
  created_at: string;
}

export async function getUser(email: string): Promise<DbUser | null> {
  try {
    const row = await dbGet<DbUser>(
      "SELECT email, is_admin, first_name, last_name, avatar_url, must_change_password, created_at FROM users WHERE email = ?",
      [email]
    );
    return row ?? null;
  } catch {
    return null;
  }
}

// ==================== SESSION ACCESS CONTROL ====================

export async function isUserAdmin(email: string): Promise<boolean> {
  try {
    const row = await dbGet<{ is_admin: number }>("SELECT is_admin FROM users WHERE email = ?", [email]);
    return Boolean(row?.is_admin);
  } catch {
    return false;
  }
}

export async function canAccessSession(sessionId: string, email: string): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session) return false;
  if (session.created_by === email) return true;
  if (await isUserAdmin(email)) return true;
  const participant = await dbGet(
    "SELECT 1 FROM session_participants WHERE session_id = ? AND user_email = ?",
    [sessionId, email]
  );
  return Boolean(participant);
}

export async function canModifySession(sessionId: string, email: string): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session) return false;
  if (session.created_by === email) return true;
  if (await isUserAdmin(email)) return true;
  return false;
}

export async function addSessionParticipant(sessionId: string, userEmail: string, role = "collaborator"): Promise<void> {
  await dbRun(
    "INSERT OR IGNORE INTO session_participants (session_id, user_email, role) VALUES (?, ?, ?)",
    [sessionId, userEmail, role]
  );
}

export async function removeSessionParticipant(sessionId: string, userEmail: string): Promise<void> {
  await dbRun(
    "DELETE FROM session_participants WHERE session_id = ? AND user_email = ?",
    [sessionId, userEmail]
  );
}

export async function listSessionParticipants(sessionId: string): Promise<Array<{ user_email: string; role: string; invited_at: string }>> {
  return dbAll<{ user_email: string; role: string; invited_at: string }>(
    "SELECT user_email, role, invited_at FROM session_participants WHERE session_id = ?",
    [sessionId]
  );
}

// ==================== MEMORIES ====================

export interface Memory {
  id: string;
  title: string;
  content: string;
  is_global: boolean;
  assigned_agent_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const MAIN_SESSION_TARGET = "__main_session__";

type MemoryRow = Omit<Memory, "is_global" | "assigned_agent_ids"> & { is_global: number };

async function hydrateMemo(row: MemoryRow): Promise<Memory> {
  const assignments = await dbAll<{ agent_id: string }>(
    "SELECT agent_id FROM memory_agent_assignments WHERE memory_id = ?",
    [row.id]
  );
  const ids = assignments.map((r) => r.agent_id);
  return { ...row, is_global: row.is_global === 1, assigned_agent_ids: ids };
}

export async function getMemories(): Promise<Memory[]> {
  const rows = await dbAll<MemoryRow>(
    "SELECT id, title, content, is_global, created_by, created_at, updated_at FROM memories ORDER BY created_at ASC"
  );
  return Promise.all(rows.map(hydrateMemo));
}

export async function getMemoriesForTarget(targetId: string): Promise<Memory[]> {
  const rows = await dbAll<MemoryRow>(`
    SELECT id, title, content, is_global, created_by, created_at, updated_at
    FROM memories
    WHERE is_global = 1
       OR id IN (SELECT memory_id FROM memory_agent_assignments WHERE agent_id = ?)
    ORDER BY created_at ASC
  `, [targetId]);
  return Promise.all(rows.map(hydrateMemo));
}

export async function setMemoryAssignments(memoryId: string, isGlobal: boolean, agentIds: string[]): Promise<void> {
  await dbTransaction(async ({ run }) => {
    await run("UPDATE memories SET is_global = ?, updated_at = datetime('now') WHERE id = ?", [isGlobal ? 1 : 0, memoryId]);
    await run("DELETE FROM memory_agent_assignments WHERE memory_id = ?", [memoryId]);
    if (!isGlobal) {
      for (const agentId of agentIds) {
        await run("INSERT OR IGNORE INTO memory_agent_assignments (memory_id, agent_id) VALUES (?, ?)", [memoryId, agentId]);
      }
    }
  });
}

export async function getMemoryAssignments(memoryId: string): Promise<string[]> {
  const rows = await dbAll<{ agent_id: string }>(
    "SELECT agent_id FROM memory_agent_assignments WHERE memory_id = ?",
    [memoryId]
  );
  return rows.map((r) => r.agent_id);
}

export async function getAgentMemories(agentId: string): Promise<Memory[]> {
  const rows = await dbAll<MemoryRow>(`
    SELECT m.id, m.title, m.content, m.is_global, m.created_by, m.created_at, m.updated_at
    FROM memories m
    JOIN memory_agent_assignments maa ON maa.memory_id = m.id
    WHERE maa.agent_id = ? AND m.is_global = 0
    ORDER BY m.created_at ASC
  `, [agentId]);
  return Promise.all(rows.map(hydrateMemo));
}

// ==================== FILE LOCKS ====================

export interface FileLock {
  file_path: string;
  session_id: string;
  user_email: string;
  tool_name: string;
  tool_call_id: string;
  locked_at: string;
}

export interface QueuedOperation {
  id: string;
  file_path: string;
  session_id: string;
  user_email: string;
  tool_name: string;
  tool_call_id: string;
  tool_input: string;
  queued_at: string;
  status: "queued" | "executing" | "completed" | "failed" | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export async function createFileLock(
  sessionId: string,
  userEmail: string,
  toolName: string,
  toolCallId: string,
  filePath: string
): Promise<boolean> {
  try {
    await dbRun(
      "INSERT INTO file_locks (file_path, session_id, user_email, tool_name, tool_call_id) VALUES (?, ?, ?, ?, ?)",
      [filePath, sessionId, userEmail, toolName, toolCallId]
    );
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return false;
    }
    throw err;
  }
}

export async function removeFileLock(filePath: string, toolCallId: string): Promise<void> {
  await dbRun("DELETE FROM file_locks WHERE file_path = ? AND tool_call_id = ?", [filePath, toolCallId]);
}

export async function getFileLock(filePath: string): Promise<FileLock | null> {
  const result = await dbGet<FileLock>(
    "SELECT file_path, session_id, user_email, tool_name, tool_call_id, locked_at FROM file_locks WHERE file_path = ?",
    [filePath]
  );
  return result ?? null;
}

export async function getSessionLocks(sessionId: string): Promise<FileLock[]> {
  return dbAll<FileLock>(
    "SELECT file_path, session_id, user_email, tool_name, tool_call_id, locked_at FROM file_locks WHERE session_id = ?",
    [sessionId]
  );
}

export async function removeSessionLocks(sessionId: string): Promise<void> {
  await dbRun("DELETE FROM file_locks WHERE session_id = ?", [sessionId]);
}

export async function removeStaleLocks(timeoutMinutes: number): Promise<FileLock[]> {
  // Atomic select-then-delete inside a transaction to avoid TOCTOU race
  // where a new lock could be acquired between SELECT and DELETE.
  return dbTransaction(async ({ all, run }) => {
    const staleLocks = await all<FileLock>(
      `SELECT file_path, session_id, user_email, tool_name, tool_call_id, locked_at
       FROM file_locks
       WHERE datetime(locked_at) < datetime('now', '-' || ? || ' minutes')`,
      [timeoutMinutes]
    );

    if (staleLocks.length > 0) {
      await run(
        `DELETE FROM file_locks WHERE datetime(locked_at) < datetime('now', '-' || ? || ' minutes')`,
        [timeoutMinutes]
      );
    }

    return staleLocks;
  });
}

// ==================== FILE OPERATION QUEUE ====================

export async function createQueuedOperation(data: {
  filePath: string;
  sessionId: string;
  userEmail: string;
  toolName: string;
  toolCallId: string;
  toolInput: string;
}): Promise<string> {
  // Use RETURNING to get the generated id
  const row = await dbGet<{ id: string }>(
    `INSERT INTO file_operation_queue (file_path, session_id, user_email, tool_name, tool_call_id, tool_input)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [data.filePath, data.sessionId, data.userEmail, data.toolName, data.toolCallId, data.toolInput]
  );
  return row!.id;
}

export async function getNextQueuedOperation(filePath: string): Promise<QueuedOperation | null> {
  const result = await dbGet<QueuedOperation>(
    `SELECT id, file_path, session_id, user_email, tool_name, tool_call_id, tool_input, 
            queued_at, status, started_at, completed_at, error
     FROM file_operation_queue
     WHERE file_path = ? AND status = 'queued'
     ORDER BY queued_at ASC
     LIMIT 1`,
    [filePath]
  );
  return result ?? null;
}

export async function updateQueuedOperationStatus(
  queueId: string,
  status: "queued" | "executing" | "completed" | "failed" | "cancelled",
  error?: string
): Promise<void> {
  if (status === "executing") {
    await dbRun(
      "UPDATE file_operation_queue SET status = ?, started_at = datetime('now') WHERE id = ?",
      [status, queueId]
    );
  } else if (status === "completed" || status === "failed" || status === "cancelled") {
    await dbRun(
      "UPDATE file_operation_queue SET status = ?, completed_at = datetime('now'), error = ? WHERE id = ?",
      [status, error ?? null, queueId]
    );
  } else {
    await dbRun("UPDATE file_operation_queue SET status = ? WHERE id = ?", [status, queueId]);
  }
}

export async function getSessionQueuedOps(sessionId: string): Promise<QueuedOperation[]> {
  return dbAll<QueuedOperation>(
    `SELECT id, file_path, session_id, user_email, tool_name, tool_call_id, tool_input,
            queued_at, status, started_at, completed_at, error
     FROM file_operation_queue
     WHERE session_id = ? AND status IN ('queued', 'executing')
     ORDER BY queued_at ASC`,
    [sessionId]
  );
}

export async function getQueuedOperation(queueId: string): Promise<QueuedOperation | null> {
  const result = await dbGet<QueuedOperation>(
    `SELECT id, file_path, session_id, user_email, tool_name, tool_call_id, tool_input,
            queued_at, status, started_at, completed_at, error
     FROM file_operation_queue
     WHERE id = ?`,
    [queueId]
  );
  return result ?? null;
}

export async function cancelQueuedOperation(queueId: string): Promise<boolean> {
  const result = await dbRun(
    "UPDATE file_operation_queue SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status = 'queued'",
    [queueId]
  );
  return result.changes > 0;
}

export async function cancelSessionQueuedOps(sessionId: string): Promise<void> {
  await dbRun(
    "UPDATE file_operation_queue SET status = 'cancelled', completed_at = datetime('now') WHERE session_id = ? AND status = 'queued'",
    [sessionId]
  );
}

export async function getQueuePosition(filePath: string, queueId: string): Promise<number> {
  const result = await dbGet<{ position: number }>(
    `SELECT COUNT(*) as position
     FROM file_operation_queue
     WHERE file_path = ? AND status = 'queued' AND queued_at < (
       SELECT queued_at FROM file_operation_queue WHERE id = ?
     )`,
    [filePath, queueId]
  );
  return (result?.position ?? 0) + 1;
}

export async function getQueueLength(filePath: string): Promise<number> {
  const result = await dbGet<{ count: number }>(
    "SELECT COUNT(*) as count FROM file_operation_queue WHERE file_path = ? AND status = 'queued'",
    [filePath]
  );
  return result?.count ?? 0;
}

export async function getAllActiveLocks(): Promise<FileLock[]> {
  return dbAll<FileLock>(
    "SELECT file_path, session_id, user_email, tool_name, tool_call_id, locked_at FROM file_locks ORDER BY locked_at DESC"
  );
}

export async function getAllQueuedOperations(): Promise<QueuedOperation[]> {
  return dbAll<QueuedOperation>(
    `SELECT id, file_path, session_id, user_email, tool_name, tool_call_id, tool_input,
            queued_at, status, started_at, completed_at, error
     FROM file_operation_queue
     WHERE status IN ('queued', 'executing')
     ORDER BY queued_at ASC`
  );
}

// ==================== SESSION CONTEXT JOURNAL ====================

export async function getSessionContext(sessionId: string): Promise<string | null> {
  const row = await dbGet<{ context_journal: string | null }>(
    "SELECT context_journal FROM sessions WHERE id = ?",
    [sessionId]
  );
  return row?.context_journal ?? null;
}

export async function updateSessionContext(sessionId: string, context: string): Promise<void> {
  const maxLength = 8000;
  const trimmed = context.length > maxLength ? context.slice(-maxLength) : context;
  await dbRun("UPDATE sessions SET context_journal = ?, updated_at = datetime('now') WHERE id = ?", [trimmed, sessionId]);
}

export async function clearSessionContext(sessionId: string): Promise<void> {
  await dbRun("UPDATE sessions SET context_journal = NULL, updated_at = datetime('now') WHERE id = ?", [sessionId]);
}

// ==================== GROUP MANAGEMENT ====================

export interface UserGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  is_system: number;
  created_at: string;
  updated_at: string;
}

export interface GroupPermissions {
  platform: {
    sessions_create: boolean;
    sessions_view_others: boolean;
    sessions_collaborate: boolean;
    templates_view: boolean;
    templates_manage: boolean;
    memories_view: boolean;
    memories_manage: boolean;
    files_browse: boolean;
    files_upload: boolean;
    terminal_access: boolean;
    observe_only: boolean;
    visible_tabs: string[];
    visible_settings: string[];
  };
  ai: {
    commands_allowed: string[];
    commands_blocked: string[];
    shell_access: boolean;
    full_trust_allowed: boolean;
    directories_allowed: string[];
    directories_blocked: string[];
    filetypes_allowed: string[];
    filetypes_blocked: string[];
    read_only: boolean;
  };
  session: {
    max_active: number;
    max_turns: number;
    models_allowed: string[];
    delegation_enabled: boolean;
    delegation_max_depth: number;
    default_model: string;
    default_template: string;
  };
  prompt: {
    system_prompt_append: string;
    default_context: string;
    communication_style: string;
  };
}

export const DEFAULT_GROUP_PERMISSIONS: GroupPermissions = {
  platform: {
    sessions_create: true,
    sessions_view_others: false,
    sessions_collaborate: true,
    templates_view: true,
    templates_manage: false,
    memories_view: true,
    memories_manage: true,
    files_browse: true,
    files_upload: true,
    terminal_access: true,
    observe_only: false,
    visible_tabs: ["chat", "agents", "plan", "memory"],
    visible_settings: ["general", "notifications"],
  },
  ai: {
    commands_allowed: [],
    commands_blocked: [],
    shell_access: true,
    full_trust_allowed: true,
    directories_allowed: [],
    directories_blocked: [],
    filetypes_allowed: [],
    filetypes_blocked: [],
    read_only: false,
  },
  session: {
    max_active: 0,
    max_turns: 0,
    models_allowed: [],
    delegation_enabled: true,
    delegation_max_depth: 5,
    default_model: '',
    default_template: '',
  },
  prompt: {
    system_prompt_append: '',
    default_context: '',
    communication_style: 'intermediate',
  },
};

function parsePermValue(value: string, type: 'bool' | 'int' | 'array' | 'string'): boolean | number | string[] | string {
  if (type === 'bool') return value === 'true';
  if (type === 'int') return parseInt(value, 10) || 0;
  if (type === 'array') { try { return JSON.parse(value) as string[]; } catch { return []; } }
  return value;
}

export async function getGroupPermissions(groupId: string): Promise<GroupPermissions> {
  const rows = await dbAll<{ category: string; permission_key: string; permission_value: string }>(
    "SELECT category, permission_key, permission_value FROM group_permissions WHERE group_id = ?",
    [groupId]
  );

  const perms: GroupPermissions = JSON.parse(JSON.stringify(DEFAULT_GROUP_PERMISSIONS));

  for (const row of rows) {
    const { category, permission_key: key, permission_value: value } = row;
    if (category === 'platform') {
      const k = key as keyof GroupPermissions['platform'];
      if (k in perms.platform) {
        if (['visible_tabs', 'visible_settings'].includes(key)) {
          (perms.platform as Record<string, unknown>)[k] = parsePermValue(value, 'array');
        } else {
          (perms.platform as Record<string, unknown>)[k] = parsePermValue(value, 'bool');
        }
      }
    } else if (category === 'ai') {
      if (['commands_allowed', 'commands_blocked', 'directories_allowed', 'directories_blocked', 'filetypes_allowed', 'filetypes_blocked'].includes(key)) {
        (perms.ai as Record<string, unknown>)[key] = parsePermValue(value, 'array');
      } else if (['shell_access', 'full_trust_allowed', 'read_only'].includes(key)) {
        (perms.ai as Record<string, unknown>)[key] = parsePermValue(value, 'bool');
      }
    } else if (category === 'session') {
      if (['models_allowed'].includes(key)) {
        (perms.session as Record<string, unknown>)[key] = parsePermValue(value, 'array');
      } else if (['delegation_enabled'].includes(key)) {
        (perms.session as Record<string, unknown>)[key] = parsePermValue(value, 'bool');
      } else if (['max_active', 'max_turns', 'delegation_max_depth'].includes(key)) {
        (perms.session as Record<string, unknown>)[key] = parsePermValue(value, 'int');
      } else {
        (perms.session as Record<string, unknown>)[key] = parsePermValue(value, 'string');
      }
    } else if (category === 'prompt') {
      (perms.prompt as Record<string, unknown>)[key] = parsePermValue(value, 'string');
    }
  }

  return perms;
}

export async function getUserGroupPermissions(email: string): Promise<GroupPermissions> {
  try {
    const row = await dbGet<{ group_id: string | null }>("SELECT group_id FROM users WHERE email = ?", [email]);
    if (!row?.group_id) return DEFAULT_GROUP_PERMISSIONS;
    return getGroupPermissions(row.group_id);
  } catch {
    return DEFAULT_GROUP_PERMISSIONS;
  }
}

export async function getUserGroup(email: string): Promise<UserGroup | null> {
  try {
    const row = await dbGet<UserGroup>(
      "SELECT g.* FROM user_groups g JOIN users u ON u.group_id = g.id WHERE u.email = ?",
      [email]
    );
    return row ?? null;
  } catch {
    return null;
  }
}

export async function listGroups(): Promise<Array<UserGroup & { member_count: number }>> {
  try {
    return dbAll<UserGroup & { member_count: number }>(`
      SELECT g.*, COUNT(u.email) as member_count
      FROM user_groups g
      LEFT JOIN users u ON u.group_id = g.id
      GROUP BY g.id
      ORDER BY g.is_system DESC, g.name ASC
    `);
  } catch {
    return [];
  }
}

export async function getGroup(id: string): Promise<UserGroup | null> {
  try {
    const row = await dbGet<UserGroup>("SELECT * FROM user_groups WHERE id = ?", [id]);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function createGroup(id: string, name: string, description: string, color: string, icon: string): Promise<UserGroup> {
  await dbRun(
    "INSERT INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, 0)",
    [id, name, description, color, icon]
  );
  const defaultPerms = Object.entries(DEFAULT_GROUP_PERMISSIONS).flatMap(([cat, keys]) =>
    Object.entries(keys as Record<string, unknown>).map(([key, val]) => {
      const strVal = Array.isArray(val) ? JSON.stringify(val) : String(val);
      return [cat, key, strVal];
    })
  );
  for (const [cat, key, val] of defaultPerms) {
    await dbRun(
      "INSERT OR IGNORE INTO group_permissions (group_id, category, permission_key, permission_value) VALUES (?, ?, ?, ?)",
      [id, cat, key, val]
    );
  }
  return (await getGroup(id))!;
}

export async function updateGroup(id: string, updates: Partial<Pick<UserGroup, 'name' | 'description' | 'color' | 'icon'>>): Promise<void> {
  const fields = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  if (fields) {
    await dbRun(`UPDATE user_groups SET ${fields}, updated_at = datetime('now') WHERE id = ?`, [...values, id] as string[]);
  }
}

export async function deleteGroup(id: string): Promise<void> {
  await dbRun("UPDATE users SET group_id = NULL WHERE group_id = ?", [id]);
  await dbRun("DELETE FROM user_groups WHERE id = ? AND is_system = 0", [id]);
}

export async function setGroupPermission(groupId: string, category: string, key: string, value: string): Promise<void> {
  await dbRun(
    "INSERT INTO group_permissions (group_id, category, permission_key, permission_value) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, category, permission_key) DO UPDATE SET permission_value = excluded.permission_value",
    [groupId, category, key, value]
  );
  await dbRun("UPDATE user_groups SET updated_at = datetime('now') WHERE id = ?", [groupId]);
}

export async function setGroupPermissions(groupId: string, permissions: Partial<{
  [category: string]: Record<string, unknown>;
}>): Promise<void> {
  for (const [cat, keys] of Object.entries(permissions)) {
    for (const [key, val] of Object.entries(keys as Record<string, unknown>)) {
      const strVal = Array.isArray(val) ? JSON.stringify(val) : String(val);
      await dbRun(
        "INSERT INTO group_permissions (group_id, category, permission_key, permission_value) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, category, permission_key) DO UPDATE SET permission_value = excluded.permission_value",
        [groupId, cat, key, strVal]
      );
    }
  }
  await dbRun("UPDATE user_groups SET updated_at = datetime('now') WHERE id = ?", [groupId]);
}

export async function listGroupMembers(groupId: string): Promise<Array<{ email: string; first_name: string; last_name: string; is_admin: number; avatar_url: string | null }>> {
  try {
    return dbAll<{ email: string; first_name: string; last_name: string; is_admin: number; avatar_url: string | null }>(
      "SELECT email, first_name, last_name, is_admin, avatar_url FROM users WHERE group_id = ? ORDER BY email ASC",
      [groupId]
    );
  } catch {
    return [];
  }
}

export async function assignUserToGroup(email: string, groupId: string | null): Promise<void> {
  await dbRun("UPDATE users SET group_id = ? WHERE email = ?", [groupId, email]);
}

export async function cloneGroup(sourceId: string, newId: string, newName: string): Promise<UserGroup> {
  const source = await getGroup(sourceId);
  if (!source) throw new Error('Source group not found');

  await dbRun(
    "INSERT INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, 0)",
    [newId, newName, source.description, source.color, source.icon]
  );

  await dbRun(`
    INSERT INTO group_permissions (group_id, category, permission_key, permission_value)
    SELECT ?, category, permission_key, permission_value FROM group_permissions WHERE group_id = ?
  `, [newId, sourceId]);

  return (await getGroup(newId))!;
}

// ==================== SECURITY GROUPS (IP ALLOWLISTS) ====================

export interface SecurityGroup {
  id: string;
  name: string;
  description: string;
  allowed_ips: string;
  created_at: string;
  updated_at: string;
}

export interface SecurityGroupWithCount extends SecurityGroup {
  member_count: number;
}

export async function listSecurityGroups(): Promise<SecurityGroupWithCount[]> {
  try {
    return dbAll<SecurityGroupWithCount>(`
      SELECT sg.*, COUNT(usg.user_email) as member_count
      FROM security_groups sg
      LEFT JOIN user_security_groups usg ON usg.security_group_id = sg.id
      GROUP BY sg.id
      ORDER BY sg.name ASC
    `);
  } catch {
    return [];
  }
}

export async function getSecurityGroup(id: string): Promise<SecurityGroup | null> {
  try {
    const row = await dbGet<SecurityGroup>("SELECT * FROM security_groups WHERE id = ?", [id]);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function createSecurityGroup(id: string, name: string, description: string, allowedIps: string[]): Promise<SecurityGroup> {
  await dbRun(
    "INSERT INTO security_groups (id, name, description, allowed_ips) VALUES (?, ?, ?, ?)",
    [id, name, description, JSON.stringify(allowedIps)]
  );
  return (await getSecurityGroup(id))!;
}

export async function updateSecurityGroup(id: string, updates: { name?: string; description?: string; allowed_ips?: string[] }): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
  if (updates.description !== undefined) { sets.push("description = ?"); vals.push(updates.description); }
  if (updates.allowed_ips !== undefined) { sets.push("allowed_ips = ?"); vals.push(JSON.stringify(updates.allowed_ips)); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  await dbRun(`UPDATE security_groups SET ${sets.join(", ")} WHERE id = ?`, [...vals, id] as string[]);
}

export async function deleteSecurityGroup(id: string): Promise<void> {
  await dbRun("DELETE FROM security_groups WHERE id = ?", [id]);
}

export async function assignUserSecurityGroup(userEmail: string, groupId: string, assignedBy: string): Promise<void> {
  await dbRun(
    "INSERT OR IGNORE INTO user_security_groups (user_email, security_group_id, assigned_by) VALUES (?, ?, ?)",
    [userEmail, groupId, assignedBy]
  );
}

export async function removeUserSecurityGroup(userEmail: string, groupId: string): Promise<void> {
  await dbRun(
    "DELETE FROM user_security_groups WHERE user_email = ? AND security_group_id = ?",
    [userEmail, groupId]
  );
}

export async function getUserSecurityGroups(userEmail: string): Promise<SecurityGroup[]> {
  try {
    return dbAll<SecurityGroup>(`
      SELECT sg.* FROM security_groups sg
      INNER JOIN user_security_groups usg ON usg.security_group_id = sg.id
      WHERE usg.user_email = ?
      ORDER BY sg.name ASC
    `, [userEmail]);
  } catch {
    return [];
  }
}

export async function getSecurityGroupMembers(groupId: string): Promise<Array<{
  email: string;
  first_name: string;
  last_name: string;
  is_admin: number;
  avatar_url: string | null;
  assigned_at: string;
  assigned_by: string | null;
}>> {
  try {
    return dbAll<{
      email: string;
      first_name: string;
      last_name: string;
      is_admin: number;
      avatar_url: string | null;
      assigned_at: string;
      assigned_by: string | null;
    }>(`
      SELECT u.email, u.first_name, u.last_name, u.is_admin, u.avatar_url,
             usg.assigned_at, usg.assigned_by
      FROM users u
      INNER JOIN user_security_groups usg ON usg.user_email = u.email
      WHERE usg.security_group_id = ?
      ORDER BY u.email ASC
    `, [groupId]);
  } catch {
    return [];
  }
}

export async function getUserEffectiveAllowedIPs(email: string): Promise<string[]> {
  try {
    const userRow = await dbGet<{ allowed_ips: string | null }>(
      "SELECT allowed_ips FROM users WHERE email = ?",
      [email]
    );
    const userIPs: string[] = parseStoredIPsDB(userRow?.allowed_ips);

    const groups = await dbAll<{ allowed_ips: string }>(`
      SELECT sg.allowed_ips FROM security_groups sg
      INNER JOIN user_security_groups usg ON usg.security_group_id = sg.id
      WHERE usg.user_email = ?
    `, [email]);

    const groupIPs: string[] = groups.flatMap((g) => parseStoredIPsDB(g.allowed_ips));
    return [...new Set([...userIPs, ...groupIPs])];
  } catch {
    return [];
  }
}

function parseStoredIPsDB(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === "string" && x.trim()) : [];
  } catch {
    return [];
  }
}

export async function findSecurityGroupsMatchingIP(ip: string): Promise<Array<{ id: string; name: string; matched_ips: string[] }>> {
  try {
    const { isIPInCIDR } = await import("./ip-allowlist");
    const groups = await dbAll<{ id: string; name: string; allowed_ips: string }>(
      "SELECT id, name, allowed_ips FROM security_groups"
    );
    const result = [];
    for (const g of groups) {
      const ips = parseStoredIPsDB(g.allowed_ips);
      const matched = ips.filter((entry) => isIPInCIDR(ip, entry));
      if (matched.length > 0) result.push({ id: g.id, name: g.name, matched_ips: matched });
    }
    return result;
  } catch {
    return [];
  }
}

export async function findUsersBlockedByIP(ip: string): Promise<Array<{ email: string; first_name: string; last_name: string }>> {
  try {
    const { isIPInAllowList } = await import("./ip-allowlist");
    const users = await dbAll<{ email: string; first_name: string; last_name: string }>(
      "SELECT email, first_name, last_name FROM users"
    );
    const blocked = [];
    for (const u of users) {
      const allowedIPs = await getUserEffectiveAllowedIPs(u.email);
      if (allowedIPs.length > 0 && !isIPInAllowList(ip, allowedIPs)) {
        blocked.push(u);
      }
    }
    return blocked;
  } catch {
    return [];
  }
}

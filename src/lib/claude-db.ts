import db from "./db";
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

export function createSession(
  id: string,
  createdBy: string,
  skipPermissions = false,
  model = "claude-sonnet-4-6",
  providerType = "sdk",
  personality?: string,
): ClaudeSession {
  db.prepare(`
    INSERT INTO sessions (id, created_by, skip_permissions, model, provider_type, personality)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')
  `).run(id, createdBy, skipPermissions ? 1 : 0, model, providerType, personality ?? null);
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown>;
  return rowToSession(row);
}

export function updateSessionModel(id: string, model: string): void {
  db.prepare("UPDATE sessions SET model = ?, updated_at = datetime('now') WHERE id = ?").run(model, id);
}

export function getSession(id: string): ClaudeSession | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function listSessions(createdBy: string): ClaudeSession[] {
  // Own sessions
  const ownRows = db.prepare("SELECT * FROM sessions WHERE created_by = ? ORDER BY updated_at DESC").all(createdBy) as Record<string, unknown>[];
  // Shared sessions (participant but not owner)
  const sharedRows = db.prepare(`
    SELECT s.*, sp.user_email as _participant_email
    FROM sessions s
    JOIN session_participants sp ON sp.session_id = s.id
    WHERE sp.user_email = ? AND s.created_by != ?
    ORDER BY s.updated_at DESC
  `).all(createdBy, createdBy) as Record<string, unknown>[];

  const own = ownRows.map(rowToSession);
  const shared = sharedRows.map((row) => {
    const session = rowToSession(row);
    session.shared_by = row.created_by as string;
    return session;
  });

  // Merge: own first, then shared; de-duplicate by id
  const seen = new Set<string>(own.map((s) => s.id));
  const merged = [...own];
  for (const s of shared) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }
  // Sort combined list by updated_at desc
  merged.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  return merged;
}

export function renameSession(id: string, name: string): void {
  db.prepare("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
}

export function saveMessage(
  sessionId: string,
  senderType: "admin" | "claude",
  content: string,
  senderId?: string,
  messageType: "chat" | "system" | "error" = "chat",
  metadata?: Record<string, unknown>,
): ClaudeMessage {
  return db.transaction(() => {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO messages (id, session_id, sender_type, sender_id, content, message_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, senderType, senderId ?? null, content, messageType, JSON.stringify(metadata ?? {}));
    db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
    const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown>;
    return rowToMessage(row);
  })();
}

export function getMessages(sessionId: string): ClaudeMessage[] {
  const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC").all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

export function deleteSession(id: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function updateSessionTags(id: string, tags: string[]): void {
  db.prepare("UPDATE sessions SET tags = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(tags), id);
}

// ==================== SESSION STATUS ====================

export function updateSessionStatus(id: string, status: SessionStatus): void {
  db.prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function updateClaudeSessionId(id: string, claudeSessionId: string | null): void {
  db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?").run(claudeSessionId, id);
}

// ==================== MESSAGE EDIT / DELETE ====================

export function deleteMessage(messageId: string): void {
  db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
}

export function deleteMessagesAfter(sessionId: string, timestamp: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ? AND timestamp > ?").run(sessionId, timestamp);
}

export function updateMessageContent(messageId: string, content: string): void {
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, messageId);
}

export function getMessage(messageId: string): ClaudeMessage | null {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as Record<string, unknown> | undefined;
  return row ? rowToMessage(row) : null;
}

// ==================== TOKEN USAGE ====================

export interface SessionTokenUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  message_count: number;
}

export function getSessionTokenUsage(sessionId: string): SessionTokenUsage {
  const rows = db.prepare("SELECT metadata FROM messages WHERE session_id = ? AND sender_type = 'claude' ORDER BY timestamp ASC").all(sessionId) as { metadata: string }[];
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

export function getGlobalTokenUsage(opts?: { since?: string; userId?: string }): SessionTokenUsage {
  let query = "SELECT m.session_id, m.metadata FROM messages m";
  const conditions: string[] = ["m.sender_type = 'claude'"];
  const params: unknown[] = [];

  if (opts?.userId) {
    query += " JOIN sessions s ON m.session_id = s.id";
    conditions.push("s.created_by = ?");
    params.push(opts.userId);
  }
  if (opts?.since) {
    conditions.push("m.timestamp >= ?");
    params.push(opts.since);
  }

  query += " WHERE " + conditions.join(" AND ") + " ORDER BY m.timestamp ASC";
  const rows = db.prepare(query).all(...params) as { session_id: string; metadata: string }[];

  const perSession = new Map<string, { input: number; output: number; cost: number }>();
  let count = 0;
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata);
      if (meta.usage) {
        perSession.set(row.session_id, {
          input: meta.usage.input_tokens ?? 0,
          output: meta.usage.output_tokens ?? 0,
          cost: meta.usage.cost_usd ?? 0,
        });
        count++;
      }
    } catch { /* skip */ }
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  for (const usage of perSession.values()) {
    totalInput += usage.input;
    totalOutput += usage.output;
    totalCost += usage.cost;
  }
  return { total_input_tokens: totalInput, total_output_tokens: totalOutput, total_cost_usd: totalCost, message_count: count };
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

export function listTemplates(): SessionTemplate[] {
  const rows = db.prepare("SELECT * FROM session_templates ORDER BY is_default DESC, name ASC").all() as Record<string, unknown>[];
  return rows.map(rowToTemplate);
}

export function getTemplate(id: string): SessionTemplate | null {
  const row = db.prepare("SELECT * FROM session_templates WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToTemplate(row) : null;
}

export function createTemplate(
  data: { name: string; description?: string; system_prompt?: string; model?: string; skip_permissions?: boolean; provider_type?: string; icon?: string; is_default?: boolean },
  createdBy: string,
): SessionTemplate {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO session_templates (id, name, description, system_prompt, model, skip_permissions, provider_type, icon, is_default, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
  );
  return rowToTemplate(db.prepare("SELECT * FROM session_templates WHERE id = ?").get(id) as Record<string, unknown>);
}

export function updateTemplate(
  id: string,
  data: Partial<{ name: string; description: string; system_prompt: string; model: string; skip_permissions: boolean; provider_type: string; icon: string; is_default: boolean }>,
): SessionTemplate {
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
  db.prepare(`UPDATE session_templates SET ${fields.join(", ")} WHERE id = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
  return rowToTemplate(db.prepare("SELECT * FROM session_templates WHERE id = ?").get(id) as Record<string, unknown>);
}

export function deleteTemplate(id: string): void {
  db.prepare("DELETE FROM session_templates WHERE id = ?").run(id);
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

export function listAgents(createdBy: string): ClaudeAgent[] {
  const rows = db.prepare("SELECT * FROM agents WHERE created_by = ? AND status != 'archived' ORDER BY updated_at DESC").all(createdBy) as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

export function getActiveAgents(): ClaudeAgent[] {
  const rows = db.prepare("SELECT * FROM agents WHERE status = 'active' ORDER BY name ASC").all() as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

export function getAgent(id: string): ClaudeAgent | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function createAgent(
  data: { name: string; description: string; icon?: string; model: string; allowed_tools: string[] },
  createdBy: string,
): ClaudeAgent {
  return db.transaction(() => {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO agents (id, name, description, icon, model, allowed_tools, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.description, data.icon ?? null, data.model, JSON.stringify(data.allowed_tools), createdBy);
    const agent = rowToAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown>);
    const versionId = randomUUID();
    db.prepare(`
      INSERT INTO agent_versions (id, agent_id, version_number, config_snapshot, change_description, created_by)
      VALUES (?, ?, 1, ?, 'Initial version', ?)
    `).run(versionId, id, JSON.stringify({ name: agent.name, description: agent.description, icon: agent.icon, model: agent.model, allowed_tools: agent.allowed_tools, status: agent.status, current_version: 1 }), createdBy);
    return agent;
  })();
}

export function updateAgent(
  id: string,
  data: Partial<{ name: string; description: string; icon: string; model: string; allowed_tools: string[]; status: string }>,
  updatedBy: string,
  changeDescription?: string,
): ClaudeAgent {
  return db.transaction(() => {
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
    db.prepare(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
    const agent = rowToAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown>);
    const versionId = randomUUID();
    db.prepare(`
      INSERT INTO agent_versions (id, agent_id, version_number, config_snapshot, change_description, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(versionId, id, agent.current_version, JSON.stringify({ name: agent.name, description: agent.description, icon: agent.icon, model: agent.model, allowed_tools: agent.allowed_tools, status: agent.status, current_version: agent.current_version }), changeDescription ?? null, updatedBy);
    return agent;
  })();
}

export function deleteAgent(id: string): void {
  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
}

export function incrementAgentUseCount(id: string): void {
  db.prepare("UPDATE agents SET use_count = use_count + 1 WHERE id = ?").run(id);
}

export function getAgentVersions(agentId: string): ClaudeAgentVersion[] {
  const rows = db.prepare("SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version_number DESC").all(agentId) as Record<string, unknown>[];
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
  };
}

export function createPlan(sessionId: string, goal: string, createdBy: string): ClaudePlan {
  const id = randomUUID();
  db.prepare("INSERT INTO plans (id, session_id, goal, created_by) VALUES (?, ?, ?, ?)").run(id, sessionId, goal, createdBy);
  return rowToPlan(db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Record<string, unknown>);
}

export function getPlan(id: string): ClaudePlan | null {
  const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const plan = rowToPlan(row);
  plan.steps = getPlanSteps(id);
  return plan;
}

export function updatePlanStatus(id: string, status: ClaudePlan["status"]): void {
  db.prepare("UPDATE plans SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function listPlans(sessionId: string): ClaudePlan[] {
  const rows = db.prepare("SELECT * FROM plans WHERE session_id = ? ORDER BY created_at DESC").all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToPlan);
}

export function listPlansForUser(email: string): ClaudePlan[] {
  const rows = db.prepare("SELECT * FROM plans WHERE created_by = ? ORDER BY created_at DESC").all(email) as Record<string, unknown>[];
  return rows.map(rowToPlan);
}

export function addPlanStep(planId: string, step: { step_order: number; summary: string; details?: string }): ClaudePlanStep {
  const id = randomUUID();
  db.prepare("INSERT INTO plan_steps (id, plan_id, step_order, summary, details) VALUES (?, ?, ?, ?, ?)").run(id, planId, step.step_order, step.summary, step.details ?? null);
  return rowToPlanStep(db.prepare("SELECT * FROM plan_steps WHERE id = ?").get(id) as Record<string, unknown>);
}

export function getPlanSteps(planId: string): ClaudePlanStep[] {
  const rows = db.prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY step_order ASC").all(planId) as Record<string, unknown>[];
  return rows.map(rowToPlanStep);
}

export function updatePlanStep(
  id: string,
  data: Partial<{ summary: string; details: string; status: ClaudePlanStep["status"]; step_order: number; result: string; error: string; approved_by: string; executed_at: string }>,
): ClaudePlanStep {
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
  if (fields.length === 0) {
    return rowToPlanStep(db.prepare("SELECT * FROM plan_steps WHERE id = ?").get(id) as Record<string, unknown>);
  }
  values.push(id);
  db.prepare(`UPDATE plan_steps SET ${fields.join(", ")} WHERE id = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
  return rowToPlanStep(db.prepare("SELECT * FROM plan_steps WHERE id = ?").get(id) as Record<string, unknown>);
}

export function deletePlanSteps(planId: string): void {
  db.prepare("DELETE FROM plan_steps WHERE plan_id = ?").run(planId);
}

export function deletePlan(planId: string): void {
  db.prepare("DELETE FROM plans WHERE id = ?").run(planId);
}

// ==================== USER SETTINGS ====================

export interface ClaudeUserSettings {
  email: string;
  full_trust_mode: boolean;
  custom_default_context: string | null;
  auto_naming_enabled: boolean;
  setup_complete: boolean;
  // User profile fields
  experience_level: string;        // 'beginner' | 'intermediate' | 'expert'
  server_purposes: string[];       // parsed from JSON
  project_type: string;            // 'new' | 'existing' | ''
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

export function getUserSettings(email: string): ClaudeUserSettings {
  db.prepare("INSERT OR IGNORE INTO user_settings (email) VALUES (?)").run(email);
  const row = db.prepare("SELECT * FROM user_settings WHERE email = ?").get(email) as Record<string, unknown>;
  return rowToSettings(row);
}

export function updateUserSettings(
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
): ClaudeUserSettings {
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
  db.prepare("INSERT OR IGNORE INTO user_settings (email) VALUES (?)").run(email);
  db.prepare(`UPDATE user_settings SET ${fields.join(", ")} WHERE email = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
  return rowToSettings(db.prepare("SELECT * FROM user_settings WHERE email = ?").get(email) as Record<string, unknown>);
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

export function createUpload(data: {
  id: string;
  sessionId: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
}): ClaudeUpload {
  db.prepare(`
    INSERT INTO uploads (id, session_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(data.id, data.sessionId, data.originalName, data.storedName, data.mimeType, data.sizeBytes, data.uploadedBy);
  const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(data.id) as Record<string, unknown>;
  return rowToUpload(row);
}

export function getUpload(id: string): ClaudeUpload | null {
  const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToUpload(row) : null;
}

export function getSessionUploads(sessionId: string): ClaudeUpload[] {
  const rows = db.prepare("SELECT * FROM uploads WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToUpload);
}

export function deleteUpload(id: string): void {
  db.prepare("DELETE FROM uploads WHERE id = ?").run(id);
}

export function deleteSessionUploads(sessionId: string): void {
  db.prepare("DELETE FROM uploads WHERE session_id = ?").run(sessionId);
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

export function createJob(data: {
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
}, createdBy: string): Job {
  const id = randomUUID().replace(/-/g, "").slice(0, 32);
  db.prepare(`
    INSERT INTO jobs (id, name, description, script_path, schedule, schedule_display,
      working_directory, environment, max_retries, timeout_seconds, auto_disable_after,
      notify_on_failure, notify_on_success, tags, ai_generated, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
  );
  return rowToJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown>);
}

export function getJob(id: string): Job | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function listJobs(): Job[] {
  const rows = db.prepare("SELECT * FROM jobs ORDER BY updated_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToJob);
}

export function updateJob(
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
): Job {
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
  if (fields.length === 0) return getJob(id)!;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
  return rowToJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown>);
}

export function deleteJob(id: string): void {
  db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

export function createJobRun(jobId: string, triggeredBy: JobRunTrigger = "timer"): JobRun {
  const id = randomUUID().replace(/-/g, "").slice(0, 32);
  db.prepare(
    "INSERT INTO job_runs (id, job_id, triggered_by) VALUES (?, ?, ?)"
  ).run(id, jobId, triggeredBy);
  return rowToJobRun(db.prepare("SELECT * FROM job_runs WHERE id = ?").get(id) as Record<string, unknown>);
}

export function updateJobRun(
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
): JobRun {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.finished_at !== undefined) { fields.push("finished_at = ?"); values.push(data.finished_at); }
  if (data.status !== undefined) { fields.push("status = ?"); values.push(data.status); }
  if (data.exit_code !== undefined) { fields.push("exit_code = ?"); values.push(data.exit_code); }
  if (data.output !== undefined) { fields.push("output = ?"); values.push(data.output); }
  if (data.output_log_path !== undefined) { fields.push("output_log_path = ?"); values.push(data.output_log_path); }
  if (data.duration_ms !== undefined) { fields.push("duration_ms = ?"); values.push(data.duration_ms); }
  if (data.error_summary !== undefined) { fields.push("error_summary = ?"); values.push(data.error_summary); }
  if (fields.length === 0) return getJobRun(id)!;
  values.push(id);
  db.prepare(`UPDATE job_runs SET ${fields.join(", ")} WHERE id = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
  return rowToJobRun(db.prepare("SELECT * FROM job_runs WHERE id = ?").get(id) as Record<string, unknown>);
}

export function getJobRun(id: string): JobRun | null {
  const row = db.prepare("SELECT * FROM job_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToJobRun(row) : null;
}

export function listJobRuns(jobId: string, limit = 50): JobRun[] {
  const rows = db.prepare(
    "SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(jobId, limit) as Record<string, unknown>[];
  return rows.map(rowToJobRun);
}

export function getActiveJobRun(jobId: string): JobRun | null {
  const row = db.prepare(
    "SELECT * FROM job_runs WHERE job_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1"
  ).get(jobId) as Record<string, unknown> | undefined;
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

export function searchMessages(query: string, limit = 50): SearchResult[] {
  try {
    const safeQuery = '"' + query.replace(/"/g, '""') + '"';
    const rows = db.prepare(`
      SELECT m.id as messageId, m.session_id as sessionId, s.name as sessionName,
             m.sender_type as senderType, m.content, m.timestamp,
             snippet(messages_fts, 0, '[[highlight]]', '[[/highlight]]', '...', 40) as snippet
      FROM messages_fts
      JOIN messages m ON messages_fts.rowid = m.rowid
      LEFT JOIN sessions s ON m.session_id = s.id
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(safeQuery, limit) as SearchResult[];
    return rows;
  } catch {
    return [];
  }
}

export function searchSessionMessages(sessionId: string, query: string, limit = 50): SearchResult[] {
  try {
    const safeQuery = '"' + query.replace(/"/g, '""') + '"';
    const rows = db.prepare(`
      SELECT m.id as messageId, m.session_id as sessionId, s.name as sessionName,
             m.sender_type as senderType, m.content, m.timestamp,
             snippet(messages_fts, 0, '[[highlight]]', '[[/highlight]]', '...', 40) as snippet
      FROM messages_fts
      JOIN messages m ON messages_fts.rowid = m.rowid
      LEFT JOIN sessions s ON m.session_id = s.id
      WHERE messages_fts MATCH ? AND m.session_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(safeQuery, sessionId, limit) as SearchResult[];
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

export function getUser(email: string): DbUser | null {
  try {
    const row = db
      .prepare("SELECT email, is_admin, first_name, last_name, avatar_url, must_change_password, created_at FROM users WHERE email = ?")
      .get(email) as DbUser | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

// ==================== SESSION ACCESS CONTROL ====================

export function isUserAdmin(email: string): boolean {
  try {
    const row = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(email) as { is_admin: number } | undefined;
    return Boolean(row?.is_admin);
  } catch {
    return false;
  }
}

export function canAccessSession(sessionId: string, email: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  if (session.created_by === email) return true;
  if (isUserAdmin(email)) return true;
  const participant = db.prepare(
    "SELECT 1 FROM session_participants WHERE session_id = ? AND user_email = ?"
  ).get(sessionId, email);
  return Boolean(participant);
}

export function canModifySession(sessionId: string, email: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  if (session.created_by === email) return true;
  if (isUserAdmin(email)) return true;
  return false;
}

export function addSessionParticipant(sessionId: string, userEmail: string, role = "collaborator"): void {
  db.prepare(
    "INSERT OR IGNORE INTO session_participants (session_id, user_email, role) VALUES (?, ?, ?)"
  ).run(sessionId, userEmail, role);
}

export function removeSessionParticipant(sessionId: string, userEmail: string): void {
  db.prepare(
    "DELETE FROM session_participants WHERE session_id = ? AND user_email = ?"
  ).run(sessionId, userEmail);
}

export function listSessionParticipants(sessionId: string): Array<{ user_email: string; role: string; invited_at: string }> {
  return db.prepare(
    "SELECT user_email, role, invited_at FROM session_participants WHERE session_id = ?"
  ).all(sessionId) as Array<{ user_email: string; role: string; invited_at: string }>;
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

/** Sentinel agent_id used for the main chat session */
export const MAIN_SESSION_TARGET = "__main_session__";

type MemoryRow = Omit<Memory, "is_global" | "assigned_agent_ids"> & { is_global: number };

function hydrateMemo(row: MemoryRow): Memory {
  const ids = (db.prepare(
    "SELECT agent_id FROM memory_agent_assignments WHERE memory_id = ?"
  ).all(row.id) as { agent_id: string }[]).map((r) => r.agent_id);
  return { ...row, is_global: row.is_global === 1, assigned_agent_ids: ids };
}

export function getMemories(): Memory[] {
  const rows = db.prepare(
    "SELECT id, title, content, is_global, created_by, created_at, updated_at FROM memories ORDER BY created_at ASC"
  ).all() as MemoryRow[];
  return rows.map(hydrateMemo);
}

/**
 * Returns memories that should be injected for a given target.
 * targetId is either MAIN_SESSION_TARGET or an agent.id.
 * A memory is included if it is global OR explicitly assigned to this target.
 */
export function getMemoriesForTarget(targetId: string): Memory[] {
  const rows = db.prepare(`
    SELECT id, title, content, is_global, created_by, created_at, updated_at
    FROM memories
    WHERE is_global = 1
       OR id IN (SELECT memory_id FROM memory_agent_assignments WHERE agent_id = ?)
    ORDER BY created_at ASC
  `).all(targetId) as MemoryRow[];
  return rows.map(hydrateMemo);
}

/**
 * Replace the full set of assignments for a memory.
 * If isGlobal is true, junction rows are cleared (they are irrelevant when global).
 */
export function setMemoryAssignments(memoryId: string, isGlobal: boolean, agentIds: string[]): void {
  const update = db.prepare(
    "UPDATE memories SET is_global = ?, updated_at = datetime('now') WHERE id = ?"
  );
  const deleteAssignments = db.prepare(
    "DELETE FROM memory_agent_assignments WHERE memory_id = ?"
  );
  const insertAssignment = db.prepare(
    "INSERT OR IGNORE INTO memory_agent_assignments (memory_id, agent_id) VALUES (?, ?)"
  );
  db.transaction(() => {
    update.run(isGlobal ? 1 : 0, memoryId);
    deleteAssignments.run(memoryId);
    if (!isGlobal) {
      for (const agentId of agentIds) {
        insertAssignment.run(memoryId, agentId);
      }
    }
  })();
}

/** Returns all agent_ids assigned to a specific memory */
export function getMemoryAssignments(memoryId: string): string[] {
  return (db.prepare(
    "SELECT agent_id FROM memory_agent_assignments WHERE memory_id = ?"
  ).all(memoryId) as { agent_id: string }[]).map((r) => r.agent_id);
}

/** Returns all non-global memories assigned to a specific agent (for agent-side UI) */
export function getAgentMemories(agentId: string): Memory[] {
  const rows = db.prepare(`
    SELECT m.id, m.title, m.content, m.is_global, m.created_by, m.created_at, m.updated_at
    FROM memories m
    JOIN memory_agent_assignments maa ON maa.memory_id = m.id
    WHERE maa.agent_id = ? AND m.is_global = 0
    ORDER BY m.created_at ASC
  `).all(agentId) as MemoryRow[];
  return rows.map(hydrateMemo);
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

/**
 * Create a file lock
 * Returns true if lock was created, false if file is already locked
 */
export function createFileLock(
  sessionId: string,
  userEmail: string,
  toolName: string,
  toolCallId: string,
  filePath: string
): boolean {
  try {
    db.prepare(
      "INSERT INTO file_locks (file_path, session_id, user_email, tool_name, tool_call_id) VALUES (?, ?, ?, ?, ?)"
    ).run(filePath, sessionId, userEmail, toolName, toolCallId);
    return true;
  } catch (err: unknown) {
    // Primary key violation means file is already locked
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return false;
    }
    throw err;
  }
}

/**
 * Remove a file lock
 */
export function removeFileLock(filePath: string, toolCallId: string): void {
  db.prepare("DELETE FROM file_locks WHERE file_path = ? AND tool_call_id = ?").run(filePath, toolCallId);
}

/**
 * Get the current lock for a file
 */
export function getFileLock(filePath: string): FileLock | null {
  const result = db.prepare(
    "SELECT file_path, session_id, user_email, tool_name, tool_call_id, locked_at FROM file_locks WHERE file_path = ?"
  ).get(filePath);
  return result as FileLock | null;
}

/**
 * Get all locks for a session
 */
export function getSessionLocks(sessionId: string): FileLock[] {
  return db.prepare(
    "SELECT file_path, session_id, user_email, tool_name, tool_call_id, locked_at FROM file_locks WHERE session_id = ?"
  ).all(sessionId) as FileLock[];
}

/**
 * Remove all locks for a session
 */
export function removeSessionLocks(sessionId: string): void {
  db.prepare("DELETE FROM file_locks WHERE session_id = ?").run(sessionId);
}

/**
 * Remove stale locks (older than timeout in minutes)
 */
export function removeStaleLocks(timeoutMinutes: number): FileLock[] {
  const staleLocks = db.prepare(
    `SELECT file_path, session_id, user_email, tool_name, tool_call_id, locked_at 
     FROM file_locks 
     WHERE datetime(locked_at) < datetime('now', '-' || ? || ' minutes')`
  ).all(timeoutMinutes) as FileLock[];

  if (staleLocks.length > 0) {
    db.prepare(
      `DELETE FROM file_locks WHERE datetime(locked_at) < datetime('now', '-' || ? || ' minutes')`
    ).run(timeoutMinutes);
  }

  return staleLocks;
}

// ==================== FILE OPERATION QUEUE ====================

/**
 * Create a queued operation
 */
export function createQueuedOperation(data: {
  filePath: string;
  sessionId: string;
  userEmail: string;
  toolName: string;
  toolCallId: string;
  toolInput: string;
}): string {
  const result = db.prepare(
    `INSERT INTO file_operation_queue (file_path, session_id, user_email, tool_name, tool_call_id, tool_input)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id`
  ).get(data.filePath, data.sessionId, data.userEmail, data.toolName, data.toolCallId, data.toolInput) as { id: string };
  return result.id;
}

/**
 * Get the next queued operation for a file (oldest first)
 */
export function getNextQueuedOperation(filePath: string): QueuedOperation | null {
  const result = db.prepare(
    `SELECT id, file_path, session_id, user_email, tool_name, tool_call_id, tool_input, 
            queued_at, status, started_at, completed_at, error
     FROM file_operation_queue
     WHERE file_path = ? AND status = 'queued'
     ORDER BY queued_at ASC
     LIMIT 1`
  ).get(filePath);
  return result as QueuedOperation | null;
}

/**
 * Update the status of a queued operation
 */
export function updateQueuedOperationStatus(
  queueId: string,
  status: "queued" | "executing" | "completed" | "failed" | "cancelled",
  error?: string
): void {
  if (status === "executing") {
    db.prepare(
      "UPDATE file_operation_queue SET status = ?, started_at = datetime('now') WHERE id = ?"
    ).run(status, queueId);
  } else if (status === "completed" || status === "failed" || status === "cancelled") {
    db.prepare(
      "UPDATE file_operation_queue SET status = ?, completed_at = datetime('now'), error = ? WHERE id = ?"
    ).run(status, error ?? null, queueId);
  } else {
    db.prepare("UPDATE file_operation_queue SET status = ? WHERE id = ?").run(status, queueId);
  }
}

/**
 * Get all queued operations for a session
 */
export function getSessionQueuedOps(sessionId: string): QueuedOperation[] {
  return db.prepare(
    `SELECT id, file_path, session_id, user_email, tool_name, tool_call_id, tool_input,
            queued_at, status, started_at, completed_at, error
     FROM file_operation_queue
     WHERE session_id = ? AND status IN ('queued', 'executing')
     ORDER BY queued_at ASC`
  ).all(sessionId) as QueuedOperation[];
}

/**
 * Get a queued operation by ID
 */
export function getQueuedOperation(queueId: string): QueuedOperation | null {
  const result = db.prepare(
    `SELECT id, file_path, session_id, user_email, tool_name, tool_call_id, tool_input,
            queued_at, status, started_at, completed_at, error
     FROM file_operation_queue
     WHERE id = ?`
  ).get(queueId);
  return result as QueuedOperation | null;
}

/**
 * Cancel a queued operation
 */
export function cancelQueuedOperation(queueId: string): boolean {
  const result = db.prepare(
    "UPDATE file_operation_queue SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status = 'queued'"
  ).run(queueId);
  return result.changes > 0;
}

/**
 * Cancel all queued operations for a session
 */
export function cancelSessionQueuedOps(sessionId: string): void {
  db.prepare(
    "UPDATE file_operation_queue SET status = 'cancelled', completed_at = datetime('now') WHERE session_id = ? AND status = 'queued'"
  ).run(sessionId);
}

/**
 * Get the queue position for a specific operation
 */
export function getQueuePosition(filePath: string, queueId: string): number {
  const result = db.prepare(
    `SELECT COUNT(*) as position
     FROM file_operation_queue
     WHERE file_path = ? AND status = 'queued' AND queued_at < (
       SELECT queued_at FROM file_operation_queue WHERE id = ?
     )`
  ).get(filePath, queueId) as { position: number };
  return result.position + 1; // +1 because count starts at 0
}

/**
 * Get queue length for a file
 */
export function getQueueLength(filePath: string): number {
  const result = db.prepare(
    "SELECT COUNT(*) as count FROM file_operation_queue WHERE file_path = ? AND status = 'queued'"
  ).get(filePath) as { count: number };
  return result.count;
}

/**
 * Get all active locks (for admin dashboard)
 */
export function getAllActiveLocks(): FileLock[] {
  return db.prepare(
    "SELECT file_path, session_id, user_email, tool_name, tool_call_id, locked_at FROM file_locks ORDER BY locked_at DESC"
  ).all() as FileLock[];
}

/**
 * Get all queued operations (for admin dashboard)
 */
export function getAllQueuedOperations(): QueuedOperation[] {
  return db.prepare(
    `SELECT id, file_path, session_id, user_email, tool_name, tool_call_id, tool_input,
            queued_at, status, started_at, completed_at, error
     FROM file_operation_queue
     WHERE status IN ('queued', 'executing')
     ORDER BY queued_at ASC`
  ).all() as QueuedOperation[];
}

// ==================== SESSION CONTEXT JOURNAL ====================

export function getSessionContext(sessionId: string): string | null {
  const row = db.prepare("SELECT context_journal FROM sessions WHERE id = ?").get(sessionId) as { context_journal: string | null } | undefined;
  return row?.context_journal ?? null;
}

export function updateSessionContext(sessionId: string, context: string): void {
  const maxLength = 8000;
  const trimmed = context.length > maxLength ? context.slice(-maxLength) : context;
  db.prepare("UPDATE sessions SET context_journal = ?, updated_at = datetime('now') WHERE id = ?").run(trimmed, sessionId);
}

export function clearSessionContext(sessionId: string): void {
  db.prepare("UPDATE sessions SET context_journal = NULL, updated_at = datetime('now') WHERE id = ?").run(sessionId);
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

export function getGroupPermissions(groupId: string): GroupPermissions {
  const rows = db.prepare(
    "SELECT category, permission_key, permission_value FROM group_permissions WHERE group_id = ?"
  ).all(groupId) as Array<{ category: string; permission_key: string; permission_value: string }>;

  const perms: GroupPermissions = JSON.parse(JSON.stringify(DEFAULT_GROUP_PERMISSIONS));

  for (const row of rows) {
    const { category, permission_key: key, permission_value: value } = row;
    if (category === 'platform') {
      const k = key as keyof GroupPermissions['platform'];
      if (k in perms.platform) {
        if (['visible_tabs', 'visible_settings'].includes(key)) {
          (perms.platform as Record<string, unknown>)[k] = parsePermValue(value, 'array');
        } else if (key === 'observe_only') {
          (perms.platform as Record<string, unknown>)[k] = parsePermValue(value, 'bool');
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

export function getUserGroupPermissions(email: string): GroupPermissions {
  try {
    const row = db.prepare("SELECT group_id FROM users WHERE email = ?").get(email) as { group_id: string | null } | undefined;
    if (!row?.group_id) return DEFAULT_GROUP_PERMISSIONS;
    return getGroupPermissions(row.group_id);
  } catch {
    return DEFAULT_GROUP_PERMISSIONS;
  }
}

export function getUserGroup(email: string): UserGroup | null {
  try {
    const row = db.prepare("SELECT g.* FROM user_groups g JOIN users u ON u.group_id = g.id WHERE u.email = ?").get(email) as UserGroup | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export function listGroups(): Array<UserGroup & { member_count: number }> {
  try {
    return db.prepare(`
      SELECT g.*, COUNT(u.email) as member_count
      FROM user_groups g
      LEFT JOIN users u ON u.group_id = g.id
      GROUP BY g.id
      ORDER BY g.is_system DESC, g.name ASC
    `).all() as Array<UserGroup & { member_count: number }>;
  } catch {
    return [];
  }
}

export function getGroup(id: string): UserGroup | null {
  try {
    return db.prepare("SELECT * FROM user_groups WHERE id = ?").get(id) as UserGroup | undefined ?? null;
  } catch {
    return null;
  }
}

export function createGroup(id: string, name: string, description: string, color: string, icon: string): UserGroup {
  db.prepare(
    "INSERT INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(id, name, description, color, icon);
  const defaultPerms = Object.entries(DEFAULT_GROUP_PERMISSIONS).flatMap(([cat, keys]) =>
    Object.entries(keys as Record<string, unknown>).map(([key, val]) => {
      let strVal: string;
      if (Array.isArray(val)) strVal = JSON.stringify(val);
      else strVal = String(val);
      return [cat, key, strVal];
    })
  );
  const insertPerm = db.prepare("INSERT OR IGNORE INTO group_permissions (group_id, category, permission_key, permission_value) VALUES (?, ?, ?, ?)");
  for (const [cat, key, val] of defaultPerms) {
    insertPerm.run(id, cat, key, val);
  }
  return getGroup(id)!;
}

export function updateGroup(id: string, updates: Partial<Pick<UserGroup, 'name' | 'description' | 'color' | 'icon'>>): void {
  const fields = Object.entries(updates).map(([k]) => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  if (fields) {
    db.prepare(`UPDATE user_groups SET ${fields}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  }
}

export function deleteGroup(id: string): void {
  db.prepare("UPDATE users SET group_id = NULL WHERE group_id = ?").run(id);
  db.prepare("DELETE FROM user_groups WHERE id = ? AND is_system = 0").run(id);
}

export function setGroupPermission(groupId: string, category: string, key: string, value: string): void {
  db.prepare(
    "INSERT INTO group_permissions (group_id, category, permission_key, permission_value) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, category, permission_key) DO UPDATE SET permission_value = excluded.permission_value"
  ).run(groupId, category, key, value);
  db.prepare("UPDATE user_groups SET updated_at = datetime('now') WHERE id = ?").run(groupId);
}

export function setGroupPermissions(groupId: string, permissions: Partial<{
  [category: string]: Record<string, unknown>;
}>): void {
  const stmt = db.prepare(
    "INSERT INTO group_permissions (group_id, category, permission_key, permission_value) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, category, permission_key) DO UPDATE SET permission_value = excluded.permission_value"
  );
  for (const [cat, keys] of Object.entries(permissions)) {
    for (const [key, val] of Object.entries(keys as Record<string, unknown>)) {
      let strVal: string;
      if (Array.isArray(val)) strVal = JSON.stringify(val);
      else strVal = String(val);
      stmt.run(groupId, cat, key, strVal);
    }
  }
  db.prepare("UPDATE user_groups SET updated_at = datetime('now') WHERE id = ?").run(groupId);
}

export function listGroupMembers(groupId: string): Array<{ email: string; first_name: string; last_name: string; is_admin: number; avatar_url: string | null }> {
  try {
    return db.prepare("SELECT email, first_name, last_name, is_admin, avatar_url FROM users WHERE group_id = ? ORDER BY email ASC").all(groupId) as Array<{ email: string; first_name: string; last_name: string; is_admin: number; avatar_url: string | null }>;
  } catch {
    return [];
  }
}

export function assignUserToGroup(email: string, groupId: string | null): void {
  db.prepare("UPDATE users SET group_id = ? WHERE email = ?").run(groupId, email);
}

export function cloneGroup(sourceId: string, newId: string, newName: string): UserGroup {
  const source = getGroup(sourceId);
  if (!source) throw new Error('Source group not found');

  db.prepare(
    "INSERT INTO user_groups (id, name, description, color, icon, is_system) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(newId, newName, source.description, source.color, source.icon);

  db.prepare(`
    INSERT INTO group_permissions (group_id, category, permission_key, permission_value)
    SELECT ?, category, permission_key, permission_value FROM group_permissions WHERE group_id = ?
  `).run(newId, sourceId);

  return getGroup(newId)!;
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

export function listSecurityGroups(): SecurityGroupWithCount[] {
  try {
    return db.prepare(`
      SELECT sg.*, COUNT(usg.user_email) as member_count
      FROM security_groups sg
      LEFT JOIN user_security_groups usg ON usg.security_group_id = sg.id
      GROUP BY sg.id
      ORDER BY sg.name ASC
    `).all() as SecurityGroupWithCount[];
  } catch {
    return [];
  }
}

export function getSecurityGroup(id: string): SecurityGroup | null {
  try {
    return db.prepare("SELECT * FROM security_groups WHERE id = ?").get(id) as SecurityGroup | undefined ?? null;
  } catch {
    return null;
  }
}

export function createSecurityGroup(id: string, name: string, description: string, allowedIps: string[]): SecurityGroup {
  db.prepare(
    "INSERT INTO security_groups (id, name, description, allowed_ips) VALUES (?, ?, ?, ?)"
  ).run(id, name, description, JSON.stringify(allowedIps));
  return getSecurityGroup(id)!;
}

export function updateSecurityGroup(id: string, updates: { name?: string; description?: string; allowed_ips?: string[] }): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
  if (updates.description !== undefined) { sets.push("description = ?"); vals.push(updates.description); }
  if (updates.allowed_ips !== undefined) { sets.push("allowed_ips = ?"); vals.push(JSON.stringify(updates.allowed_ips)); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE security_groups SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function deleteSecurityGroup(id: string): void {
  db.prepare("DELETE FROM security_groups WHERE id = ?").run(id);
}

export function assignUserSecurityGroup(userEmail: string, groupId: string, assignedBy: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user_security_groups (user_email, security_group_id, assigned_by) VALUES (?, ?, ?)"
  ).run(userEmail, groupId, assignedBy);
}

export function removeUserSecurityGroup(userEmail: string, groupId: string): void {
  db.prepare(
    "DELETE FROM user_security_groups WHERE user_email = ? AND security_group_id = ?"
  ).run(userEmail, groupId);
}

export function getUserSecurityGroups(userEmail: string): SecurityGroup[] {
  try {
    return db.prepare(`
      SELECT sg.* FROM security_groups sg
      INNER JOIN user_security_groups usg ON usg.security_group_id = sg.id
      WHERE usg.user_email = ?
      ORDER BY sg.name ASC
    `).all(userEmail) as SecurityGroup[];
  } catch {
    return [];
  }
}

export function getSecurityGroupMembers(groupId: string): Array<{
  email: string;
  first_name: string;
  last_name: string;
  is_admin: number;
  avatar_url: string | null;
  assigned_at: string;
  assigned_by: string | null;
}> {
  try {
    return db.prepare(`
      SELECT u.email, u.first_name, u.last_name, u.is_admin, u.avatar_url,
             usg.assigned_at, usg.assigned_by
      FROM users u
      INNER JOIN user_security_groups usg ON usg.user_email = u.email
      WHERE usg.security_group_id = ?
      ORDER BY u.email ASC
    `).all(groupId) as Array<{
      email: string;
      first_name: string;
      last_name: string;
      is_admin: number;
      avatar_url: string | null;
      assigned_at: string;
      assigned_by: string | null;
    }>;
  } catch {
    return [];
  }
}

/**
 * Returns the merged IP allowlist for a user:
 * union of users.allowed_ips + all assigned security_groups.allowed_ips.
 * Returns [] if the user has no restrictions (unrestricted access).
 */
export function getUserEffectiveAllowedIPs(email: string): string[] {
  try {
    const userRow = db.prepare("SELECT allowed_ips FROM users WHERE email = ?").get(email) as { allowed_ips: string | null } | undefined;
    const userIPs: string[] = parseStoredIPsDB(userRow?.allowed_ips);

    const groups = db.prepare(`
      SELECT sg.allowed_ips FROM security_groups sg
      INNER JOIN user_security_groups usg ON usg.security_group_id = sg.id
      WHERE usg.user_email = ?
    `).all(email) as Array<{ allowed_ips: string }>;

    const groupIPs: string[] = groups.flatMap((g) => parseStoredIPsDB(g.allowed_ips));

    const merged = [...new Set([...userIPs, ...groupIPs])];
    return merged;
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

/**
 * For the "Test IP" tool — find all security groups that would allow the given IP.
 */
export function findSecurityGroupsMatchingIP(ip: string): Array<{ id: string; name: string; matched_ips: string[] }> {
  try {
    const { isIPInCIDR } = require("./ip-allowlist") as typeof import("./ip-allowlist");
    const groups = db.prepare("SELECT id, name, allowed_ips FROM security_groups").all() as Array<{ id: string; name: string; allowed_ips: string }>;
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

/**
 * For the "Test IP" tool — find all users whose effective allowlist covers the given IP.
 * Returns users that would be BLOCKED (IP not in their allowlist) when they have restrictions.
 */
export function findUsersBlockedByIP(ip: string): Array<{ email: string; first_name: string; last_name: string }> {
  try {
    const { isIPInAllowList } = require("./ip-allowlist") as typeof import("./ip-allowlist");
    const users = db.prepare("SELECT email, first_name, last_name FROM users").all() as Array<{ email: string; first_name: string; last_name: string }>;
    const blocked = [];
    for (const u of users) {
      const allowedIPs = getUserEffectiveAllowedIPs(u.email);
      if (allowedIPs.length > 0 && !isIPInAllowList(ip, allowedIPs)) {
        blocked.push(u);
      }
    }
    return blocked;
  } catch {
    return [];
  }
}

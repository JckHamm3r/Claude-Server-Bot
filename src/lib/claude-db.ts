import db from "./db";

// ==================== SESSIONS ====================

export interface ClaudeSession {
  id: string;
  name: string | null;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  skip_permissions: boolean;
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

function rowToSession(row: Record<string, unknown>): ClaudeSession {
  return {
    id: row.id as string,
    name: row.name as string | null,
    tags: JSON.parse((row.tags as string) || "[]"),
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    skip_permissions: Boolean(row.skip_permissions),
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
    metadata: JSON.parse((row.metadata as string) || "{}"),
  };
}

export async function createSession(
  id: string,
  createdBy: string,
  skipPermissions = false,
): Promise<ClaudeSession> {
  db.prepare(`
    INSERT INTO sessions (id, created_by, skip_permissions)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')
  `).run(id, createdBy, skipPermissions ? 1 : 0);
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown>;
  return rowToSession(row);
}

export async function getSession(id: string): Promise<ClaudeSession | null> {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export async function listSessions(createdBy: string): Promise<ClaudeSession[]> {
  const rows = db.prepare("SELECT * FROM sessions WHERE created_by = ? ORDER BY updated_at DESC").all(createdBy) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export async function renameSession(id: string, name: string): Promise<void> {
  db.prepare("UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
}

export async function saveMessage(
  sessionId: string,
  senderType: "admin" | "claude",
  content: string,
  senderId?: string,
  messageType: "chat" | "system" | "error" = "chat",
  metadata?: Record<string, unknown>,
): Promise<ClaudeMessage> {
  const id = require("crypto").randomUUID();
  db.prepare(`
    INSERT INTO messages (id, session_id, sender_type, sender_id, content, message_type, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, senderType, senderId ?? null, content, messageType, JSON.stringify(metadata ?? {}));
  db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown>;
  return rowToMessage(row);
}

export async function getMessages(sessionId: string): Promise<ClaudeMessage[]> {
  const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC").all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

export async function deleteSession(id: string): Promise<void> {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export async function updateSessionTags(id: string, tags: string[]): Promise<void> {
  db.prepare("UPDATE sessions SET tags = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(tags), id);
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
    allowed_tools: JSON.parse((row.allowed_tools as string) || "[]"),
    status: row.status as "active" | "disabled" | "archived",
    current_version: row.current_version as number,
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
    config_snapshot: JSON.parse((row.config_snapshot as string) || "{}"),
    change_description: row.change_description as string | null,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
  };
}

export async function listAgents(createdBy: string): Promise<ClaudeAgent[]> {
  const rows = db.prepare("SELECT * FROM agents WHERE created_by = ? AND status != 'archived' ORDER BY updated_at DESC").all(createdBy) as Record<string, unknown>[];
  return rows.map(rowToAgent);
}

export async function getAgent(id: string): Promise<ClaudeAgent | null> {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export async function createAgent(
  data: { name: string; description: string; icon?: string; model: string; allowed_tools: string[] },
  createdBy: string,
): Promise<ClaudeAgent> {
  const id = require("crypto").randomUUID();
  db.prepare(`
    INSERT INTO agents (id, name, description, icon, model, allowed_tools, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.description, data.icon ?? null, data.model, JSON.stringify(data.allowed_tools), createdBy);
  const agent = rowToAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown>);
  // Create initial version
  const versionId = require("crypto").randomUUID();
  db.prepare(`
    INSERT INTO agent_versions (id, agent_id, version_number, config_snapshot, change_description, created_by)
    VALUES (?, ?, 1, ?, 'Initial version', ?)
  `).run(versionId, id, JSON.stringify({ name: agent.name, description: agent.description, icon: agent.icon, model: agent.model, allowed_tools: agent.allowed_tools, status: agent.status, current_version: 1 }), createdBy);
  return agent;
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
  db.prepare(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
  const agent = rowToAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown>);
  const versionId = require("crypto").randomUUID();
  db.prepare(`
    INSERT INTO agent_versions (id, agent_id, version_number, config_snapshot, change_description, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(versionId, id, agent.current_version, JSON.stringify({ name: agent.name, description: agent.description, icon: agent.icon, model: agent.model, allowed_tools: agent.allowed_tools, status: agent.status, current_version: agent.current_version }), changeDescription ?? null, updatedBy);
  return agent;
}

export async function deleteAgent(id: string): Promise<void> {
  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
}

export async function getAgentVersions(agentId: string): Promise<ClaudeAgentVersion[]> {
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

export async function createPlan(sessionId: string, goal: string, createdBy: string): Promise<ClaudePlan> {
  const id = require("crypto").randomUUID();
  db.prepare("INSERT INTO plans (id, session_id, goal, created_by) VALUES (?, ?, ?, ?)").run(id, sessionId, goal, createdBy);
  return rowToPlan(db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Record<string, unknown>);
}

export async function getPlan(id: string): Promise<ClaudePlan | null> {
  const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const plan = rowToPlan(row);
  plan.steps = await getPlanSteps(id);
  return plan;
}

export async function updatePlanStatus(id: string, status: ClaudePlan["status"]): Promise<void> {
  db.prepare("UPDATE plans SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export async function listPlans(sessionId: string): Promise<ClaudePlan[]> {
  const rows = db.prepare("SELECT * FROM plans WHERE session_id = ? ORDER BY created_at DESC").all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToPlan);
}

export async function addPlanStep(planId: string, step: { step_order: number; summary: string; details?: string }): Promise<ClaudePlanStep> {
  const id = require("crypto").randomUUID();
  db.prepare("INSERT INTO plan_steps (id, plan_id, step_order, summary, details) VALUES (?, ?, ?, ?, ?)").run(id, planId, step.step_order, step.summary, step.details ?? null);
  return rowToPlanStep(db.prepare("SELECT * FROM plan_steps WHERE id = ?").get(id) as Record<string, unknown>);
}

export async function getPlanSteps(planId: string): Promise<ClaudePlanStep[]> {
  const rows = db.prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY step_order ASC").all(planId) as Record<string, unknown>[];
  return rows.map(rowToPlanStep);
}

export async function updatePlanStep(
  id: string,
  data: Partial<{ summary: string; details: string; status: ClaudePlanStep["status"]; step_order: number; result: string; error: string; approved_by: string; executed_at: string }>,
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
  values.push(id);
  db.prepare(`UPDATE plan_steps SET ${fields.join(", ")} WHERE id = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
  return rowToPlanStep(db.prepare("SELECT * FROM plan_steps WHERE id = ?").get(id) as Record<string, unknown>);
}

// ==================== USER SETTINGS ====================

export interface ClaudeUserSettings {
  email: string;
  full_trust_mode: boolean;
  custom_default_context: string | null;
  auto_naming_enabled: boolean;
  setup_complete: boolean;
  updated_at: string;
}

function rowToSettings(row: Record<string, unknown>): ClaudeUserSettings {
  return {
    email: row.email as string,
    full_trust_mode: Boolean(row.full_trust_mode),
    custom_default_context: row.custom_default_context as string | null,
    auto_naming_enabled: Boolean(row.auto_naming_enabled),
    setup_complete: Boolean(row.setup_complete),
    updated_at: row.updated_at as string,
  };
}

export async function getUserSettings(email: string): Promise<ClaudeUserSettings> {
  db.prepare("INSERT OR IGNORE INTO user_settings (email) VALUES (?)").run(email);
  const row = db.prepare("SELECT * FROM user_settings WHERE email = ?").get(email) as Record<string, unknown>;
  return rowToSettings(row);
}

export async function updateUserSettings(
  email: string,
  data: Partial<{ full_trust_mode: boolean; custom_default_context: string | null; auto_naming_enabled: boolean; setup_complete: boolean }>,
): Promise<ClaudeUserSettings> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.full_trust_mode !== undefined) { fields.push("full_trust_mode = ?"); values.push(data.full_trust_mode ? 1 : 0); }
  if (data.custom_default_context !== undefined) { fields.push("custom_default_context = ?"); values.push(data.custom_default_context); }
  if (data.auto_naming_enabled !== undefined) { fields.push("auto_naming_enabled = ?"); values.push(data.auto_naming_enabled ? 1 : 0); }
  if (data.setup_complete !== undefined) { fields.push("setup_complete = ?"); values.push(data.setup_complete ? 1 : 0); }
  fields.push("updated_at = datetime('now')");
  values.push(email);
  db.prepare(`UPDATE user_settings SET ${fields.join(", ")} WHERE email = ?`).run(...values as Parameters<typeof db.prepare>[0][]);
  return rowToSettings(db.prepare("SELECT * FROM user_settings WHERE email = ?").get(email) as Record<string, unknown>);
}

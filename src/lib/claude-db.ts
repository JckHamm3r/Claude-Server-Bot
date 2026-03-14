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
    provider_type: (row.provider_type as string) ?? "subprocess",
    status: (row.status as SessionStatus) ?? "idle",
    personality: (row.personality as string | null) ?? null,
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
  providerType = "subprocess",
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
  const rows = db.prepare("SELECT * FROM sessions WHERE created_by = ? ORDER BY updated_at DESC").all(createdBy) as Record<string, unknown>[];
  return rows.map(rowToSession);
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
  const rows = db.prepare("SELECT metadata FROM messages WHERE session_id = ? AND sender_type = 'claude'").all(sessionId) as { metadata: string }[];
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let count = 0;
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata);
      if (meta.usage) {
        totalInput += meta.usage.input_tokens ?? 0;
        totalOutput += meta.usage.output_tokens ?? 0;
        totalCost += meta.usage.cost_usd ?? 0;
        count++;
      }
    } catch { /* skip */ }
  }
  return { total_input_tokens: totalInput, total_output_tokens: totalOutput, total_cost_usd: totalCost, message_count: count };
}

export function getGlobalTokenUsage(opts?: { since?: string; userId?: string }): SessionTokenUsage {
  let query = "SELECT m.metadata FROM messages m";
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

  query += " WHERE " + conditions.join(" AND ");
  const rows = db.prepare(query).all(...params) as { metadata: string }[];

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let count = 0;
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata);
      if (meta.usage) {
        totalInput += meta.usage.input_tokens ?? 0;
        totalOutput += meta.usage.output_tokens ?? 0;
        totalCost += meta.usage.cost_usd ?? 0;
        count++;
      }
    } catch { /* skip */ }
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
    provider_type: (row.provider_type as string) ?? "subprocess",
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
    data.provider_type ?? "subprocess",
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

export function getUserSettings(email: string): ClaudeUserSettings {
  db.prepare("INSERT OR IGNORE INTO user_settings (email) VALUES (?)").run(email);
  const row = db.prepare("SELECT * FROM user_settings WHERE email = ?").get(email) as Record<string, unknown>;
  return rowToSettings(row);
}

export function updateUserSettings(
  email: string,
  data: Partial<{ full_trust_mode: boolean; custom_default_context: string | null; auto_naming_enabled: boolean; setup_complete: boolean }>,
): ClaudeUserSettings {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.full_trust_mode !== undefined) { fields.push("full_trust_mode = ?"); values.push(data.full_trust_mode ? 1 : 0); }
  if (data.custom_default_context !== undefined) { fields.push("custom_default_context = ?"); values.push(data.custom_default_context); }
  if (data.auto_naming_enabled !== undefined) { fields.push("auto_naming_enabled = ?"); values.push(data.auto_naming_enabled ? 1 : 0); }
  if (data.setup_complete !== undefined) { fields.push("setup_complete = ?"); values.push(data.setup_complete ? 1 : 0); }
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

import db from "./db";

export interface TerminalSession {
  id: string;
  user_email: string;
  name: string;
  tmux_session_name: string;
  order_index: number;
  is_default: number;
  scrollback_json: string;
  cwd: string;
  created_at: string;
  last_active_at: string;
}

export interface TerminalBookmark {
  id: string;
  terminal_session_id: string;
  line_index: number;
  label: string;
  color: string;
  created_at: string;
}

export interface TerminalShare {
  id: string;
  terminal_session_id: string;
  owner_email: string;
  invited_email: string;
  created_at: string;
}

export const MAX_TABS_PER_USER = 4;
export const MAX_SCROLLBACK_LINES = 500;

// ── Terminal Sessions ──────────────────────────────────────────────────────

export function getTerminalSessions(userEmail: string): TerminalSession[] {
  return db
    .prepare("SELECT * FROM terminal_sessions WHERE user_email = ? ORDER BY order_index ASC, created_at ASC")
    .all(userEmail) as TerminalSession[];
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return db.prepare("SELECT * FROM terminal_sessions WHERE id = ?").get(id) as TerminalSession | undefined;
}

export function getTerminalSessionByTmuxName(tmuxName: string): TerminalSession | undefined {
  return db.prepare("SELECT * FROM terminal_sessions WHERE tmux_session_name = ?").get(tmuxName) as TerminalSession | undefined;
}

export function createTerminalSession(userEmail: string, name: string, isDefault = false): TerminalSession {
  const id = db.prepare("SELECT lower(hex(randomblob(16))) as v").get() as { v: string };
  const sessionId = id.v;
  const tmuxName = `octoby_${userEmail.replace(/[^a-zA-Z0-9]/g, "_")}_${sessionId.slice(0, 8)}`;

  const existing = getTerminalSessions(userEmail);
  const orderIndex = existing.length;

  db.prepare(`
    INSERT INTO terminal_sessions (id, user_email, name, tmux_session_name, order_index, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userEmail, name, tmuxName, orderIndex, isDefault ? 1 : 0);

  return getTerminalSession(sessionId)!;
}

export function updateTerminalSessionName(id: string, name: string) {
  db.prepare("UPDATE terminal_sessions SET name = ?, last_active_at = datetime('now') WHERE id = ?").run(name, id);
}

export function updateTerminalSessionCwd(id: string, cwd: string) {
  db.prepare("UPDATE terminal_sessions SET cwd = ?, last_active_at = datetime('now') WHERE id = ?").run(cwd, id);
}

export function updateTerminalScrollback(id: string, lines: string[]) {
  const truncated = lines.slice(-MAX_SCROLLBACK_LINES);
  db.prepare("UPDATE terminal_sessions SET scrollback_json = ?, last_active_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(truncated), id);
}

export function touchTerminalSession(id: string) {
  db.prepare("UPDATE terminal_sessions SET last_active_at = datetime('now') WHERE id = ?").run(id);
}

export function deleteTerminalSession(id: string) {
  db.prepare("DELETE FROM terminal_sessions WHERE id = ?").run(id);
}

export function reorderTerminalSessions(userEmail: string, orderedIds: string[]) {
  const update = db.prepare("UPDATE terminal_sessions SET order_index = ? WHERE id = ? AND user_email = ?");
  const tx = db.transaction(() => {
    orderedIds.forEach((id, idx) => update.run(idx, id, userEmail));
  });
  tx();
}

export function countTerminalSessions(userEmail: string): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM terminal_sessions WHERE user_email = ?").get(userEmail) as { c: number };
  return row.c;
}

// ── Terminal Bookmarks ─────────────────────────────────────────────────────

export function getBookmarks(terminalSessionId: string): TerminalBookmark[] {
  return db
    .prepare("SELECT * FROM terminal_bookmarks WHERE terminal_session_id = ? ORDER BY line_index ASC")
    .all(terminalSessionId) as TerminalBookmark[];
}

export function addBookmark(terminalSessionId: string, lineIndex: number, label: string, color = "#58a6ff"): TerminalBookmark {
  const id = db.prepare("SELECT lower(hex(randomblob(16))) as v").get() as { v: string };
  db.prepare(`
    INSERT INTO terminal_bookmarks (id, terminal_session_id, line_index, label, color)
    VALUES (?, ?, ?, ?, ?)
  `).run(id.v, terminalSessionId, lineIndex, label, color);
  return db.prepare("SELECT * FROM terminal_bookmarks WHERE id = ?").get(id.v) as TerminalBookmark;
}

export function removeBookmark(bookmarkId: string, userEmail: string) {
  // Verify ownership via join
  db.prepare(`
    DELETE FROM terminal_bookmarks WHERE id = ? AND terminal_session_id IN (
      SELECT id FROM terminal_sessions WHERE user_email = ?
    )
  `).run(bookmarkId, userEmail);
}

// ── Terminal Shares ────────────────────────────────────────────────────────

export function getShares(terminalSessionId: string): TerminalShare[] {
  return db
    .prepare("SELECT * FROM terminal_shares WHERE terminal_session_id = ?")
    .all(terminalSessionId) as TerminalShare[];
}

export function addShare(terminalSessionId: string, ownerEmail: string, invitedEmail: string): TerminalShare {
  const id = db.prepare("SELECT lower(hex(randomblob(16))) as v").get() as { v: string };
  db.prepare(`
    INSERT OR IGNORE INTO terminal_shares (id, terminal_session_id, owner_email, invited_email)
    VALUES (?, ?, ?, ?)
  `).run(id.v, terminalSessionId, ownerEmail, invitedEmail);
  return db.prepare("SELECT * FROM terminal_shares WHERE terminal_session_id = ? AND invited_email = ?")
    .get(terminalSessionId, invitedEmail) as TerminalShare;
}

export function removeShare(terminalSessionId: string, ownerEmail: string, invitedEmail: string) {
  db.prepare("DELETE FROM terminal_shares WHERE terminal_session_id = ? AND owner_email = ? AND invited_email = ?")
    .run(terminalSessionId, ownerEmail, invitedEmail);
}

export function getSharedSessionsForUser(invitedEmail: string): TerminalSession[] {
  return db.prepare(`
    SELECT ts.* FROM terminal_sessions ts
    JOIN terminal_shares sh ON sh.terminal_session_id = ts.id
    WHERE sh.invited_email = ?
    ORDER BY ts.order_index ASC
  `).all(invitedEmail) as TerminalSession[];
}

export function canAccessTerminalSession(sessionId: string, userEmail: string): boolean {
  const session = getTerminalSession(sessionId);
  if (!session) return false;
  if (session.user_email === userEmail) return true;
  // Check if shared
  const share = db.prepare("SELECT id FROM terminal_shares WHERE terminal_session_id = ? AND invited_email = ?")
    .get(sessionId, userEmail);
  return !!share;
}

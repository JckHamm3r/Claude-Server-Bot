import { randomUUID } from "crypto";
import { dbGet, dbAll, dbRun, dbTransaction } from "./db";

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

export async function getTerminalSessions(userEmail: string): Promise<TerminalSession[]> {
  return dbAll<TerminalSession>("SELECT * FROM terminal_sessions WHERE user_email = ? ORDER BY order_index ASC, created_at ASC", [userEmail]);
}

export async function getTerminalSession(id: string): Promise<TerminalSession | undefined> {
  return dbGet<TerminalSession>("SELECT * FROM terminal_sessions WHERE id = ?", [id]);
}

export async function getTerminalSessionByTmuxName(tmuxName: string): Promise<TerminalSession | undefined> {
  return dbGet<TerminalSession>("SELECT * FROM terminal_sessions WHERE tmux_session_name = ?", [tmuxName]);
}

export async function createTerminalSession(userEmail: string, name: string, isDefault = false): Promise<TerminalSession> {
  const sessionId = randomUUID().replace(/-/g, "");
  const tmuxName = `octoby_${userEmail.replace(/[^a-zA-Z0-9]/g, "_")}_${sessionId.slice(0, 8)}`;
  const existing = await getTerminalSessions(userEmail);
  const orderIndex = existing.length;
  await dbRun(
    `INSERT INTO terminal_sessions (id, user_email, name, tmux_session_name, order_index, is_default) VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, userEmail, name, tmuxName, orderIndex, isDefault ? 1 : 0]
  );
  return (await getTerminalSession(sessionId))!;
}

export async function updateTerminalSessionName(id: string, name: string): Promise<void> {
  await dbRun("UPDATE terminal_sessions SET name = ?, last_active_at = datetime('now') WHERE id = ?", [name, id]);
}

export async function updateTerminalSessionCwd(id: string, cwd: string): Promise<void> {
  await dbRun("UPDATE terminal_sessions SET cwd = ?, last_active_at = datetime('now') WHERE id = ?", [cwd, id]);
}

export async function updateTerminalScrollback(id: string, lines: string[]): Promise<void> {
  const truncated = lines.slice(-MAX_SCROLLBACK_LINES);
  await dbRun("UPDATE terminal_sessions SET scrollback_json = ?, last_active_at = datetime('now') WHERE id = ?", [JSON.stringify(truncated), id]);
}

export async function touchTerminalSession(id: string): Promise<void> {
  await dbRun("UPDATE terminal_sessions SET last_active_at = datetime('now') WHERE id = ?", [id]);
}

export async function deleteTerminalSession(id: string): Promise<void> {
  await dbRun("DELETE FROM terminal_sessions WHERE id = ?", [id]);
}

export async function reorderTerminalSessions(userEmail: string, orderedIds: string[]): Promise<void> {
  await dbTransaction(async ({ run }) => {
    for (let idx = 0; idx < orderedIds.length; idx++) {
      await run("UPDATE terminal_sessions SET order_index = ? WHERE id = ? AND user_email = ?", [idx, orderedIds[idx], userEmail]);
    }
  });
}

export async function countTerminalSessions(userEmail: string): Promise<number> {
  const row = await dbGet<{ c: number }>("SELECT COUNT(*) as c FROM terminal_sessions WHERE user_email = ?", [userEmail]);
  return row?.c ?? 0;
}

export async function getBookmarks(terminalSessionId: string): Promise<TerminalBookmark[]> {
  return dbAll<TerminalBookmark>("SELECT * FROM terminal_bookmarks WHERE terminal_session_id = ? ORDER BY line_index ASC", [terminalSessionId]);
}

export async function addBookmark(terminalSessionId: string, lineIndex: number, label: string, color = "#58a6ff"): Promise<TerminalBookmark> {
  const id = randomUUID().replace(/-/g, "");
  await dbRun(
    `INSERT INTO terminal_bookmarks (id, terminal_session_id, line_index, label, color) VALUES (?, ?, ?, ?, ?)`,
    [id, terminalSessionId, lineIndex, label, color]
  );
  return (await dbGet<TerminalBookmark>("SELECT * FROM terminal_bookmarks WHERE id = ?", [id]))!;
}

export async function removeBookmark(bookmarkId: string, userEmail: string): Promise<void> {
  await dbRun(
    `DELETE FROM terminal_bookmarks WHERE id = ? AND terminal_session_id IN (SELECT id FROM terminal_sessions WHERE user_email = ?)`,
    [bookmarkId, userEmail]
  );
}

export async function getShares(terminalSessionId: string): Promise<TerminalShare[]> {
  return dbAll<TerminalShare>("SELECT * FROM terminal_shares WHERE terminal_session_id = ?", [terminalSessionId]);
}

export async function addShare(terminalSessionId: string, ownerEmail: string, invitedEmail: string): Promise<TerminalShare> {
  const id = randomUUID().replace(/-/g, "");
  await dbRun(
    `INSERT OR IGNORE INTO terminal_shares (id, terminal_session_id, owner_email, invited_email) VALUES (?, ?, ?, ?)`,
    [id, terminalSessionId, ownerEmail, invitedEmail]
  );
  return (await dbGet<TerminalShare>("SELECT * FROM terminal_shares WHERE terminal_session_id = ? AND invited_email = ?", [terminalSessionId, invitedEmail]))!;
}

export async function removeShare(terminalSessionId: string, ownerEmail: string, invitedEmail: string): Promise<void> {
  await dbRun("DELETE FROM terminal_shares WHERE terminal_session_id = ? AND owner_email = ? AND invited_email = ?", [terminalSessionId, ownerEmail, invitedEmail]);
}

export async function getSharedSessionsForUser(invitedEmail: string): Promise<TerminalSession[]> {
  return dbAll<TerminalSession>(
    `SELECT ts.* FROM terminal_sessions ts JOIN terminal_shares sh ON sh.terminal_session_id = ts.id WHERE sh.invited_email = ? ORDER BY ts.order_index ASC`,
    [invitedEmail]
  );
}

export async function canAccessTerminalSession(sessionId: string, userEmail: string): Promise<boolean> {
  const session = await getTerminalSession(sessionId);
  if (!session) return false;
  if (session.user_email === userEmail) return true;
  const share = await dbGet("SELECT id FROM terminal_shares WHERE terminal_session_id = ? AND invited_email = ?", [sessionId, userEmail]);
  return !!share;
}

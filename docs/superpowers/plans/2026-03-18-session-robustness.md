# Session Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 14 bugs in the session/chat/multiplayer system and add a SessionRoomManager to centralize room lifecycle.

**Architecture:** A new `SessionRoomManager` class (one per socket) owns all room join/leave operations, replacing scattered `socket.join()` calls. Server-side fixes scope broadcasts, clean up leaked state, and add missing cleanup. Client-side fixes eliminate false messages, duplicate renders, and stale refs.

**Tech Stack:** TypeScript, Socket.IO, React hooks, Next.js 14

**Spec:** `docs/superpowers/specs/2026-03-18-session-robustness-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/socket/session-room-manager.ts` | **Create** | SessionRoomManager class — owns room join/leave lifecycle per socket |
| `src/socket/types.ts` | Modify | Add `roomManager` and `flushStreamingThrottle` to `HandlerContext` |
| `src/socket/handlers.ts` | Modify | Instantiate room manager; scope status broadcast to room; expose `flushStreamingThrottle` |
| `src/socket/session-handlers.ts` | Modify | Replace `socket.join`/`connectedUsers.set`/`broadcastPresence` with room manager; add delete cleanup; fix error emissions |
| `src/socket/message-handlers.ts` | Modify | Export `clearAiPauseState`; add `isSync` flag; thread `clientMsgId` through broadcast |
| `src/socket/presence-handlers.ts` | Modify | Use room manager for disconnect; emit typing-stop; include `sessionId` in typing events |
| `src/hooks/use-chat-socket.ts` | Modify | `clientMsgId` dedup; `isSync` handling; ref sync; typing filter; reset cleanup; reconnect `get_chat_state` |
| `src/components/claude-code/chat-tab.tsx` | Modify | Remove redundant `set_active_session` after `create_session` |

---

### Task 1: Create SessionRoomManager

**Files:**
- Create: `src/socket/session-room-manager.ts`

- [ ] **Step 1: Create the SessionRoomManager class**

```ts
// src/socket/session-room-manager.ts
import type { Socket } from "socket.io";

/**
 * Owns the room lifecycle for a single socket connection.
 * Enforces: one socket = one session room at a time.
 */
export class SessionRoomManager {
  private currentSessionId: string | null = null;

  constructor(
    private socket: Socket,
    private connectedUsers: Map<string, { email: string; activeSession: string | null }>,
    private broadcastPresence: () => void,
  ) {}

  /** Leave current room (if any), join new room, update tracking + presence. */
  switchTo(sessionId: string, email: string): void {
    if (this.currentSessionId && this.currentSessionId !== sessionId) {
      this.socket.leave(`session:${this.currentSessionId}`);
    }
    this.socket.join(`session:${sessionId}`);
    this.currentSessionId = sessionId;
    this.connectedUsers.set(this.socket.id, { email, activeSession: sessionId });
    this.broadcastPresence();
  }

  /** Returns current session ID or null. */
  current(): string | null {
    return this.currentSessionId;
  }

  /** Leave current room without joining a new one. */
  leave(email: string): void {
    if (this.currentSessionId) {
      this.socket.leave(`session:${this.currentSessionId}`);
      this.currentSessionId = null;
    }
    this.connectedUsers.set(this.socket.id, { email, activeSession: null });
    this.broadcastPresence();
  }

  /** Full cleanup on disconnect — leaves room, removes socket from tracking. */
  disconnect(): void {
    if (this.currentSessionId) {
      this.socket.leave(`session:${this.currentSessionId}`);
      this.currentSessionId = null;
    }
    this.connectedUsers.delete(this.socket.id);
    this.broadcastPresence();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/socket/session-room-manager.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/socket/session-room-manager.ts
git commit -m "feat: add SessionRoomManager for room lifecycle"
```

---

### Task 2: Update HandlerContext type

**Files:**
- Modify: `src/socket/types.ts:7-42`

- [ ] **Step 1: Add `roomManager` and `flushStreamingThrottle` to HandlerContext**

In `src/socket/types.ts`, add to the `HandlerContext` interface:

```ts
// After the existing import of SessionStatus:
import type { SessionRoomManager } from "./session-room-manager";
```

Add these two fields to the interface body, after the `retrySaveMessage` field (line 41):

```ts
  roomManager: SessionRoomManager;
  flushStreamingThrottle: (sessionId: string) => void;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: Errors in handlers.ts (roomManager/flushStreamingThrottle not yet provided) — this is expected, will be fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/socket/types.ts
git commit -m "feat: add roomManager and flushStreamingThrottle to HandlerContext"
```

---

### Task 3: Wire up room manager and fix handlers.ts

**Files:**
- Modify: `src/socket/handlers.ts:436-439` (status broadcast)
- Modify: `src/socket/handlers.ts:748-781` (connection handler — create room manager, add to context)

- [ ] **Step 1: Fix session status broadcast (Bug #1)**

In `src/socket/handlers.ts`, in the `setSessionStatus` function (~line 436-443), change:

```ts
// OLD (line 439):
io.emit("claude:session_status", { sessionId, status });

// NEW:
io.to(`session:${sessionId}`).emit("claude:session_status", { sessionId, status });
```

- [ ] **Step 2: Import SessionRoomManager**

At the top of `src/socket/handlers.ts`, add:

```ts
import { SessionRoomManager } from "./session-room-manager";
```

- [ ] **Step 3: Create room manager per socket and add to context**

In the `io.on("connection")` handler (~line 748-781):

Replace lines 752-753:
```ts
// OLD:
connectedUsers.set(socket.id, { email, activeSession: null });
broadcastPresence(io);
```

With:
```ts
// NEW:
const roomManager = new SessionRoomManager(socket, connectedUsers, () => broadcastPresence(io));
connectedUsers.set(socket.id, { email, activeSession: null });
broadcastPresence(io);
```

Then add `roomManager` and `flushStreamingThrottle` to the `ctx` object (~line 756-781):

```ts
// Add after retrySaveMessage (line 780):
roomManager,
flushStreamingThrottle,
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors (downstream handlers may still use old patterns — that's fine, we'll fix them next).

- [ ] **Step 5: Commit**

```bash
git add src/socket/handlers.ts
git commit -m "fix: scope session status broadcast to room; wire room manager"
```

---

### Task 4: Migrate session-handlers.ts to room manager

**Files:**
- Modify: `src/socket/session-handlers.ts:139-142` (create_session)
- Modify: `src/socket/session-handlers.ts:157-167` (set_active_session)
- Modify: `src/socket/session-handlers.ts:248-289` (delete_session)
- Modify: `src/socket/session-handlers.ts:369-371` (rejoin_session)
- Modify: `src/socket/session-handlers.ts:505-527` (kill_all)
- Modify: `src/socket/session-handlers.ts` (error emissions)

- [ ] **Step 1: Import `clearAiPauseState`**

At the top of `src/socket/session-handlers.ts`, add to imports:

```ts
import { clearAiPauseState } from "./message-handlers";
```

Note: `clearAiPauseState` doesn't exist yet — will be created in Task 5. For now, just add the import. The build will error until Task 5 is complete.

- [ ] **Step 2: Replace room operations in `create_session` handler**

At `src/socket/session-handlers.ts` lines 139-142, replace:

```ts
// OLD:
socket.join(`session:${sessionId}`);

ctx.connectedUsers.set(socket.id, { email, activeSession: sessionId });
ctx.broadcastPresence();
```

With:

```ts
// NEW:
ctx.roomManager.switchTo(sessionId, email);
```

- [ ] **Step 3: Replace room operations in `set_active_session` handler**

At `src/socket/session-handlers.ts` lines 164-166, replace:

```ts
// OLD:
ctx.connectedUsers.set(socket.id, { email, activeSession: sessionId });
if (sessionId) socket.join(`session:${sessionId}`);
ctx.broadcastPresence();
```

With:

```ts
// NEW:
if (sessionId) {
  ctx.roomManager.switchTo(sessionId, email);
} else {
  ctx.roomManager.leave(email);
}
```

- [ ] **Step 4: Replace room operations in `rejoin_session` handler**

At `src/socket/session-handlers.ts` lines 369-371, replace:

```ts
// OLD:
socket.join(`session:${sessionId}`);
ctx.connectedUsers.set(socket.id, { email, activeSession: sessionId });
ctx.broadcastPresence();
```

With:

```ts
// NEW:
ctx.roomManager.switchTo(sessionId, email);
```

- [ ] **Step 5: Add cleanup to `delete_session` handler**

At `src/socket/session-handlers.ts`, in the `delete_session` handler (~line 248), add **before** the existing cleanup (before `sp.offOutput`):

```ts
// Notify participants and evict all sockets from the room
io.to(`session:${sessionId}`).emit("claude:session_deleted", { sessionId });
io.in(`session:${sessionId}`).socketsLeave(`session:${sessionId}`);
```

Then add **after** line 260 (`ctx.sessionEventBuffers.delete(sessionId)`):

```ts
ctx.flushStreamingThrottle(sessionId);
clearAiPauseState(sessionId);
```

- [ ] **Step 6: Add cleanup to `kill_all` handler**

At `src/socket/session-handlers.ts`, in the `kill_all` handler (~line 515-526), add after `ctx.sessionEventBuffers.delete(sid)` (line 526):

```ts
ctx.flushStreamingThrottle(sid);
clearAiPauseState(sid);
```

- [ ] **Step 7: Fix missing `sessionId` in error emissions**

Fix these specific lines in `src/socket/session-handlers.ts`:

Line 237 — `rename_session` error:
```ts
// OLD:
socket.emit("claude:error", { message: "Failed to rename session." });
// NEW:
socket.emit("claude:error", { sessionId, message: "Failed to rename session." });
```

Line 300 — `update_session_tags` error:
```ts
// OLD:
socket.emit("claude:error", { message: "Failed to update session tags." });
// NEW:
socket.emit("claude:error", { sessionId, message: "Failed to update session tags." });
```

Line 343 — `update_session_model` error:
```ts
// OLD:
socket.emit("claude:error", { message: String(err) });
// NEW:
socket.emit("claude:error", { sessionId, message: String(err) });
```

Line 479 — `get_session_usage` error:
```ts
// OLD:
socket.emit("claude:error", { message: String(err) });
// NEW:
socket.emit("claude:error", { sessionId, message: String(err) });
```

- [ ] **Step 8: Verify it compiles (will error on missing `clearAiPauseState` — expected)**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: Error about `clearAiPauseState` not being exported from `./message-handlers` — this is resolved in Task 5.

- [ ] **Step 9: Commit**

```bash
git add src/socket/session-handlers.ts
git commit -m "fix: use room manager in session handlers; add delete/kill_all cleanup; fix error emissions"
```

---

### Task 5: Fix message-handlers.ts (server-side)

**Files:**
- Modify: `src/socket/message-handlers.ts:30-39` (export `clearAiPauseState`)
- Modify: `src/socket/message-handlers.ts:141-142` (thread `clientMsgId`)
- Modify: `src/socket/message-handlers.ts:445-451` (echo `clientMsgId` in broadcast)
- Modify: `src/socket/message-handlers.ts:686-695` (add `isSync` flag)

- [ ] **Step 1: Export `clearAiPauseState` function (Bug #7)**

In `src/socket/message-handlers.ts`, after `getAiPauseState` (~line 39), add:

```ts
export function clearAiPauseState(sessionId: string): void {
  aiPausedSessions.delete(sessionId);
}
```

- [ ] **Step 2: Accept `clientMsgId` in `claude:message` handler (Bug #4)**

At `src/socket/message-handlers.ts` line 142, change the destructured parameters:

```ts
// OLD:
async ({ sessionId, content, attachments }: { sessionId: string; content: string; attachments?: string[] }) => {

// NEW:
async ({ sessionId, content, attachments, clientMsgId }: { sessionId: string; content: string; attachments?: string[]; clientMsgId?: string }) => {
```

- [ ] **Step 3: Echo `clientMsgId` in user_message broadcast**

In `src/socket/message-handlers.ts`, find all `claude:user_message` emissions and add `clientMsgId`. There are two locations:

**Location 1** — main message broadcast (~line 447):
```ts
// OLD:
io.to(`session:${sessionId}`).emit("claude:user_message", {
  sessionId,
  message: savedUserMessage,
  fromSocketId: socket.id,
});

// NEW:
io.to(`session:${sessionId}`).emit("claude:user_message", {
  sessionId,
  message: savedUserMessage,
  fromSocketId: socket.id,
  clientMsgId,
});
```

**Location 2** — `/remember` command broadcast (~line 325):
```ts
// OLD:
io.to(`session:${sessionId}`).emit("claude:user_message", {
  sessionId,
  message: savedUserMessage,
  fromSocketId: socket.id,
});

// NEW:
io.to(`session:${sessionId}`).emit("claude:user_message", {
  sessionId,
  message: savedUserMessage,
  fromSocketId: socket.id,
  clientMsgId,
});
```

- [ ] **Step 4: Add `isSync` flag to `get_chat_state` response (Bug #2)**

At `src/socket/message-handlers.ts` (~line 690), modify the `get_chat_state` handler:

```ts
// OLD:
socket.emit("claude:chat_toggled", {
  sessionId,
  paused: state.paused,
  pausedBy: state.pausedBy,
});

// NEW:
socket.emit("claude:chat_toggled", {
  sessionId,
  paused: state.paused,
  pausedBy: state.pausedBy,
  isSync: true,
});
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/socket/message-handlers.ts
git commit -m "fix: export clearAiPauseState; add isSync flag; thread clientMsgId through broadcast"
```

---

### Task 6: Fix presence-handlers.ts

**Files:**
- Modify: `src/socket/presence-handlers.ts:17-37` (add `sessionId` to typing events)
- Modify: `src/socket/presence-handlers.ts:61-79` (typing-stop on disconnect; use room manager)

- [ ] **Step 1: Add `sessionId` to typing event payloads (Bug #10)**

At `src/socket/presence-handlers.ts` line 25, add `sessionId` to the emitted payload:

```ts
// OLD:
socket.to(`session:${sessionId}`).emit("claude:typing", {
  email,
  typing: true,
  firstName: user?.first_name || "",
  lastName: user?.last_name || "",
  avatarUrl: user?.avatar_url || null,
});

// NEW:
socket.to(`session:${sessionId}`).emit("claude:typing", {
  sessionId,
  email,
  typing: true,
  firstName: user?.first_name || "",
  lastName: user?.last_name || "",
  avatarUrl: user?.avatar_url || null,
});
```

At line 36, same for typing_stop:

```ts
// OLD:
socket.to(`session:${sessionId}`).emit("claude:typing", { email, typing: false });

// NEW:
socket.to(`session:${sessionId}`).emit("claude:typing", { sessionId, email, typing: false });
```

- [ ] **Step 2: Emit typing-stop on disconnect and use room manager (Bug #11)**

Replace the disconnect handler at `src/socket/presence-handlers.ts` lines 61-79 with:

```ts
  socket.on("disconnect", async () => {
    await logActivity("user_logout", email);

    // Emit typing-stop so other users in the session clear the indicator
    const userInfo = ctx.connectedUsers.get(socket.id);
    if (userInfo?.activeSession) {
      socket.to(`session:${userInfo.activeSession}`).emit("claude:typing", {
        sessionId: userInfo.activeSession,
        email,
        typing: false,
      });
    }

    // Clean up rate-limit command counts for this user
    for (const [key] of ctx.userSessionCommands) {
      if (key === email) {
        ctx.userSessionCommands.delete(key);
      }
    }

    ctx.roomManager.disconnect();
  });
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/socket/presence-handlers.ts
git commit -m "fix: emit typing-stop on disconnect; add sessionId to typing events; use room manager"
```

---

### Task 7: Fix use-chat-socket.ts (client-side)

**Files:**
- Modify: `src/hooks/use-chat-socket.ts:280-297` (sendImmediate — add `clientMsgId`)
- Modify: `src/hooks/use-chat-socket.ts:307-326` (drainPending — add `clientMsgId` for paused flush)
- Modify: `src/hooks/use-chat-socket.ts:340-349` (resetSessionState — clear refs)
- Modify: `src/hooks/use-chat-socket.ts:406-418` (handleConnect — add `get_chat_state`)
- Modify: `src/hooks/use-chat-socket.ts:506-531` (typing listener — add `sessionId` filter)
- Modify: `src/hooks/use-chat-socket.ts:1034-1051` (chat_toggled — add `isSync`)
- Modify: `src/hooks/use-chat-socket.ts:1053-1057` (user_message — `clientMsgId` dedup)
- Modify: `src/hooks/use-chat-socket.ts:1122-1151` (active session effect — sync ref)
- Modify: `src/hooks/use-chat-socket.ts:1170-1187` (handleSend — add `clientMsgId` for paused path)

- [ ] **Step 1: Add `clientMsgId` to `sendImmediate` (Bug #4)**

At `src/hooks/use-chat-socket.ts` lines 280-297, modify `sendImmediate`:

```ts
// OLD:
const sendImmediate = useCallback(
  (content: string, sessionId: string, attachments?: string[]) => {
    streamingMsgIdRef.current = null;
    turnDoneRef.current = false;
    lastUserMsgRef.current = content;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sender_type: "admin",
      content,
      timestamp: new Date().toISOString(),
      metadata: attachments?.length ? { attachments } : undefined,
    };
    setMessages((prev) => [...prev, msg]);
    setIsRunning(true);
    setRunStartTime(Date.now());
    setHasError(false);
    emit("claude:message", { sessionId, content, attachments });
  },
  [emit],
);

// NEW:
const sendImmediate = useCallback(
  (content: string, sessionId: string, attachments?: string[]) => {
    streamingMsgIdRef.current = null;
    turnDoneRef.current = false;
    lastUserMsgRef.current = content;
    const clientMsgId = crypto.randomUUID();
    const msg: ChatMessage = {
      id: clientMsgId,
      sender_type: "admin",
      content,
      timestamp: new Date().toISOString(),
      metadata: attachments?.length ? { attachments } : undefined,
    };
    setMessages((prev) => [...prev, msg]);
    setIsRunning(true);
    setRunStartTime(Date.now());
    setHasError(false);
    emit("claude:message", { sessionId, content, attachments, clientMsgId });
  },
  [emit],
);
```

- [ ] **Step 2: Add `clientMsgId` to `drainPending` paused flush path**

At `src/hooks/use-chat-socket.ts` lines 312-324, in the `aiPausedRef.current` branch of `drainPending`:

```ts
// OLD:
if (aiPausedRef.current) {
  for (const content of pendingQueueRef.current) {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sender_type: "admin",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    socketRef.current?.emit("claude:message", { sessionId, content });
  }
  syncQueue([]);
  return;
}

// NEW:
if (aiPausedRef.current) {
  for (const content of pendingQueueRef.current) {
    const clientMsgId = crypto.randomUUID();
    const msg: ChatMessage = {
      id: clientMsgId,
      sender_type: "admin",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    socketRef.current?.emit("claude:message", { sessionId, content, clientMsgId });
  }
  syncQueue([]);
  return;
}
```

- [ ] **Step 3: Expand `resetSessionState` to clear all refs (Bug #12)**

At `src/hooks/use-chat-socket.ts` lines 340-349, replace:

```ts
// OLD:
const resetSessionState = useCallback(() => {
  streamingMsgIdRef.current = null;
  turnDoneRef.current = false;
  setMessages([]);
  setIsRunning(false);
  setCurrentActivity(null);
  setCommandRunner(null);
  setTypingUsers([]);
  syncQueue([]);
}, [syncQueue]);

// NEW:
const resetSessionState = useCallback(() => {
  streamingMsgIdRef.current = null;
  turnDoneRef.current = false;
  lastUserMsgRef.current = "";
  autoCompactFiredRef.current = false;
  isCompactingRef.current = false;
  aiPausedRef.current = false;
  watchdogChecksRef.current = 0;
  setMessages([]);
  setIsRunning(false);
  setCurrentActivity(null);
  setCommandRunner(null);
  setTypingUsers([]);
  setPendingInteractions(new Map());
  syncQueue([]);
  // Clear edit recovery timer
  if (editRecoveryTimerRef.current) {
    clearTimeout(editRecoveryTimerRef.current);
    editRecoveryTimerRef.current = null;
  }
  // Clear typing timers
  for (const timer of typingTimersRef.current.values()) {
    clearTimeout(timer);
  }
  typingTimersRef.current.clear();
}, [syncQueue]);
```

- [ ] **Step 4: Add `get_chat_state` to `handleConnect` reconnect path (Bug #2)**

At `src/hooks/use-chat-socket.ts` lines 411-417, add `get_chat_state` after `get_session_state`:

```ts
// OLD:
const session = activeSessionRef.current;
if (session) {
  socket.emit("claude:rejoin_session", { sessionId: session.id });
  setLoadingMessages(true);
  socket.emit("claude:get_messages", { sessionId: session.id });
  socket.emit("claude:get_session_state", { sessionId: session.id });
}

// NEW:
const session = activeSessionRef.current;
if (session) {
  socket.emit("claude:rejoin_session", { sessionId: session.id });
  setLoadingMessages(true);
  socket.emit("claude:get_messages", { sessionId: session.id });
  socket.emit("claude:get_session_state", { sessionId: session.id });
  socket.emit("claude:get_chat_state", { sessionId: session.id });
}
```

- [ ] **Step 5: Add `sessionId` filter to typing listener (Bug #10)**

At `src/hooks/use-chat-socket.ts` lines 506-531, add a `sessionId` guard:

```ts
// OLD:
socket.on("claude:typing", ({ email: typingEmail, typing, firstName, lastName, avatarUrl }:
  { email: string; typing: boolean; firstName?: string; lastName?: string; avatarUrl?: string | null }) => {

// NEW:
socket.on("claude:typing", ({ sessionId, email: typingEmail, typing, firstName, lastName, avatarUrl }:
  { sessionId?: string; email: string; typing: boolean; firstName?: string; lastName?: string; avatarUrl?: string | null }) => {
  // Ignore typing indicators from other sessions (defense-in-depth)
  if (sessionId && sessionId !== activeSessionRef.current?.id) return;
```

Note: `sessionId` is optional (`?`) for backwards compatibility during rolling deploys.

- [ ] **Step 6: Add `isSync` handling to `chat_toggled` listener (Bug #2)**

At `src/hooks/use-chat-socket.ts` lines 1034-1051:

```ts
// OLD:
socket.on("claude:chat_toggled", ({ sessionId, paused, pausedBy }: { sessionId: string; paused: boolean; pausedBy: string | null }) => {
  if (activeSessionRef.current?.id !== sessionId) return;
  setAiPaused(paused);
  setAiPausedBy(pausedBy);

  const label = pausedBy ? pausedBy.split("@")[0] : "Someone";

// NEW:
socket.on("claude:chat_toggled", ({ sessionId, paused, pausedBy, isSync }: { sessionId: string; paused: boolean; pausedBy: string | null; isSync?: boolean }) => {
  if (activeSessionRef.current?.id !== sessionId) return;
  setAiPaused(paused);
  setAiPausedBy(pausedBy);
  // State sync (from get_chat_state) — update state silently, no chat message
  if (isSync) return;

  const label = pausedBy ? pausedBy.split("@")[0] : "Someone";
```

- [ ] **Step 7: Add `session_deleted` listener**

The server (Task 4, Step 5) emits `claude:session_deleted` when a session is deleted. The client needs a handler. Add it near the existing `claude:session_removed` listener (~line 491):

```ts
socket.on("claude:session_deleted", ({ sessionId }: { sessionId: string }) => {
  // Session was deleted — remove from sidebar and deactivate if open
  setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  if (activeSessionRef.current?.id === sessionId) {
    activeSessionRef.current = null;
    resetSessionState();
    setIsRunning(false);
  }
  if (onSessionRemovedRef.current) onSessionRemovedRef.current(sessionId);
});
```

Also add cleanup in the `return` cleanup function of the same effect:

```ts
socket.off("claude:session_deleted");
```

- [ ] **Step 8: Replace `user_message` handler with `clientMsgId` dedup (Bug #4)**

At `src/hooks/use-chat-socket.ts` lines 1053-1057:

```ts
// OLD:
socket.on("claude:user_message", ({ sessionId, message, fromSocketId }: { sessionId: string; message: ChatMessage; fromSocketId: string }) => {
  if (activeSessionRef.current?.id !== sessionId) return;
  if (fromSocketId === socket.id) return;
  setMessages((prev) => [...prev, message]);
});

// NEW:
socket.on("claude:user_message", ({ sessionId, message, fromSocketId, clientMsgId }: { sessionId: string; message: ChatMessage; fromSocketId: string; clientMsgId?: string }) => {
  if (activeSessionRef.current?.id !== sessionId) return;
  if (fromSocketId === socket.id) {
    // Replace the optimistic local message with the server-persisted version
    if (clientMsgId) {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === clientMsgId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = message;
          return updated;
        }
        return prev;
      });
    }
    return;
  }
  setMessages((prev) => [...prev, message]);
});
```

- [ ] **Step 9: Sync `activeSessionRef` at top of session-switch effect (Bug #5)**

At `src/hooks/use-chat-socket.ts` line 1123, add ref sync:

```ts
// OLD:
useEffect(() => {
  if (!activeSession || !connected) return;
  setSessionModel(activeSession.model ?? DEFAULT_MODEL);

// NEW:
useEffect(() => {
  if (!activeSession || !connected) return;
  activeSessionRef.current = activeSession;
  setSessionModel(activeSession.model ?? DEFAULT_MODEL);
```

- [ ] **Step 10: Add `clientMsgId` to `handleSend` paused path**

At `src/hooks/use-chat-socket.ts` lines 1176-1186, in the `aiPausedRef.current` branch of `handleSend`:

```ts
// OLD:
if (aiPausedRef.current) {
  const msg: ChatMessage = {
    id: crypto.randomUUID(),
    sender_type: "admin",
    content,
    timestamp: new Date().toISOString(),
    metadata: attachments?.length ? { attachments } : undefined,
  };
  setMessages((prev) => [...prev, msg]);
  emit("claude:message", { sessionId: activeSession.id, content, attachments });
  return;
}

// NEW:
if (aiPausedRef.current) {
  const clientMsgId = crypto.randomUUID();
  const msg: ChatMessage = {
    id: clientMsgId,
    sender_type: "admin",
    content,
    timestamp: new Date().toISOString(),
    metadata: attachments?.length ? { attachments } : undefined,
  };
  setMessages((prev) => [...prev, msg]);
  emit("claude:message", { sessionId: activeSession.id, content, attachments, clientMsgId });
  return;
}
```

- [ ] **Step 11: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add src/hooks/use-chat-socket.ts
git commit -m "fix: clientMsgId dedup; isSync handling; ref sync; typing filter; reset cleanup"
```

---

### Task 8: Fix chat-tab.tsx (remove redundant set_active_session)

**Files:**
- Modify: `src/components/claude-code/chat-tab.tsx:270-279`
- Modify: `src/components/claude-code/chat-tab.tsx:319-326`

- [ ] **Step 1: Remove redundant `set_active_session` after `create_session` in `handleCreateSession` (Bug #6)**

At `src/components/claude-code/chat-tab.tsx` line 279, delete this line:

```ts
// DELETE this line:
chat.emit("claude:set_active_session", { sessionId: id });
```

- [ ] **Step 2: Remove redundant `set_active_session` in domain-help session creation**

At `src/components/claude-code/chat-tab.tsx` line 326, delete this line:

```ts
// DELETE this line:
chat.emit("claude:set_active_session", { sessionId: id });
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/claude-code/chat-tab.tsx
git commit -m "fix: remove redundant set_active_session after create_session"
```

---

### Task 9: Build verification and smoke test

**Files:** None (verification only)

- [ ] **Step 1: Full TypeScript build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Lint check**

Run: `npm run lint`
Expected: No new warnings or errors introduced.

- [ ] **Step 3: Final commit (if any lint fixes needed)**

```bash
git add -A
git commit -m "chore: lint fixes for session robustness changes"
```

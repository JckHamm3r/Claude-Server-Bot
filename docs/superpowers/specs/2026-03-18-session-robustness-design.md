# Session System Robustness — Design Spec

**Date**: 2026-03-18
**Approach**: Hybrid — targeted bug fixes + SessionRoomManager structural guard

## Problem Statement

The session/chat system has 14 bugs across broadcasting, room lifecycle, state synchronization, memory leaks, and race conditions. Key user-visible symptoms:

1. False "AI resumed" message appears when opening any session
2. Multiplayer message visibility is intermittent — User B sometimes doesn't see User A's messages
3. Session status changes broadcast to all clients instead of session participants
4. Typing indicators leak across sessions
5. Sender sees duplicate messages (optimistic local + server broadcast)

## Bug Catalog

| # | Severity | Bug | File(s) | Root Cause |
|---|----------|-----|---------|------------|
| 1 | Critical | Session status broadcast to ALL clients | handlers.ts:439 | `io.emit()` instead of `io.to(room).emit()` |
| 2 | High | False "AI resumed" message on session open | message-handlers.ts:686, use-chat-socket.ts:1034 | `get_chat_state` responds with `chat_toggled` event; client injects visible message for every `chat_toggled` |
| 3 | High | No `socket.leave()` on session switch | session-handlers.ts:165 | Room membership accumulates; sockets stay in old rooms |
| 4 | High | Sender duplicate messages | use-chat-socket.ts:292 vs :1053 | Local optimistic message + server broadcast both rendered |
| 5 | High | `activeSessionRef` not synced in session-switch effect | use-chat-socket.ts:1122 | Ref updated by parent component, gap between render and effect |
| 6 | High | Race: `create_session` + `set_active_session` concurrent | chat-tab.tsx:270-279 | Both emitted back-to-back; `set_active_session` may process before room exists |
| 7 | High | `aiPausedSessions` map never cleaned on delete | message-handlers.ts:31 | No cleanup call in session delete handler |
| 8 | High | Streaming state leaks on crash/timeout | handlers.ts:118,128 | `sessionStreamingContent` and `sessionEventBuffers` only cleared on "done" |
| 9 | High | Event buffer replay on reconnect causes duplicates | handlers.ts:191 | Buffer replayed via `get_messages` without dedup |
| 10 | Medium | Typing indicators leak across sessions | use-chat-socket.ts | No `sessionId` filter on `claude:typing` listener |
| 11 | Medium | Typing timers not cleared on disconnect | presence-handlers.ts:61 | Server doesn't emit typing-stop on disconnect |
| 12 | Medium | `resetSessionState` doesn't clear refs | use-chat-socket.ts:340 | Stale refs persist across session switches |
| 13 | Medium | Missing `sessionId` in error emissions | message-handlers.ts, session-handlers.ts | Client can't match errors to sessions |
| 14 | Low | Presence broadcast is O(n) on every connect/disconnect | handlers.ts:212 | Not addressed in this spec (acceptable at current scale) |

## Solution Design

### 1. SessionRoomManager (New File)

**File**: `src/socket/session-room-manager.ts`

A thin class (~60 lines) that owns the room lifecycle for a single socket. Enforces the invariant: **one socket = one session room at a time**.

```ts
class SessionRoomManager {
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

  /** Full cleanup on disconnect. */
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

**Integration**: Created per-socket in `handlers.ts` during the `connection` event. Passed to all handler registration functions via `HandlerContext`. All direct `socket.join()` / `connectedUsers.set()` / `broadcastPresence()` calls replaced with room manager methods.

**Call sites to replace**:
- `session-handlers.ts:139` (`create_session`) → `roomManager.switchTo(sessionId, email)`
- `session-handlers.ts:165` (`set_active_session`) → `sessionId ? roomManager.switchTo(sessionId, email) : roomManager.leave(email)` (handler accepts `sessionId: string | null`)
- `session-handlers.ts:369` (`rejoin_session`) → `roomManager.switchTo(sessionId, email)`
- `presence-handlers.ts:77` (disconnect) → `roomManager.disconnect()`

### 2. Server-Side Bug Fixes

#### 2a. Session status broadcast scoped to room (Bug #1)

**File**: `handlers.ts:439`

```diff
- io.emit("claude:session_status", { sessionId, status });
+ io.to(`session:${sessionId}`).emit("claude:session_status", { sessionId, status });
```

#### 2b. `get_chat_state` silent sync (Bug #2)

**File**: `message-handlers.ts:686-695`

Add `isSync: true` to the payload when responding to `get_chat_state`:

```diff
  socket.emit("claude:chat_toggled", {
    sessionId,
    paused: state.paused,
    pausedBy: state.pausedBy,
+   isSync: true,
  });
```

Client handler updated to skip message injection when `isSync` is true (see Section 3).

#### 2c. `aiPausedSessions` cleanup on delete (Bug #7)

**File**: `message-handlers.ts` — export a `clearAiPauseState(sessionId)` function.

**File**: `session-handlers.ts:248` (delete handler) — call `clearAiPauseState(sessionId)` alongside other map cleanups.

#### 2d. Streaming state cleanup (Bug #8)

**File**: `session-handlers.ts:248` (delete handler) — add `sessionStreamingThrottles` cleanup via `ctx.flushStreamingThrottle(sessionId)` (currently missing; `sessionStreamingContent` and `sessionEventBuffers` already cleaned).

**File**: `session-handlers.ts` (`kill_all` handler, ~line 505) — also add `sessionStreamingThrottles` cleanup (same omission as delete).

**File**: `handlers.ts` — expose `sessionStreamingThrottles` cleanup via `HandlerContext` by adding `flushStreamingThrottle` to the context (already defined as a local function at line 469; just needs to be added to the context object).

**Note**: Crash/timeout error-path cleanup (provider dies without emitting "done") is a separate concern. The existing watchdog timer (15s * 40 checks) already handles stuck sessions by emitting `command_done` client-side. Server-side, the `done` handler in `ensureSessionListener` cleans up streaming maps. If the provider process crashes, the SDK's `onOutput` will emit an error event that hits the `done` path. No additional mechanism needed for this spec.

#### 2e. Missing `sessionId` in error emissions (Bug #13)

Audit all `socket.emit("claude:error", ...)` calls and ensure `sessionId` is included. Known locations:
- `session-handlers.ts:343` (`model_changed` error)
- Any other error paths missing the field

#### 2f. Typing stop on disconnect (Bug #11)

**File**: `presence-handlers.ts:61` (disconnect handler)

Before cleanup, emit typing-stop to the user's current session room:

```ts
const userInfo = ctx.connectedUsers.get(socket.id);
if (userInfo?.activeSession) {
  socket.to(`session:${userInfo.activeSession}`).emit("claude:typing", {
    email, typing: false
  });
}
```

#### 2g. Session delete notifies room (Bug #3 related)

**File**: `session-handlers.ts:248` (delete handler)

Before cleanup, notify and evict all sockets:

```ts
io.to(`session:${sessionId}`).emit("claude:session_deleted", { sessionId });
io.in(`session:${sessionId}`).socketsLeave(`session:${sessionId}`);
```

### 3. Client-Side Bug Fixes

#### 3a. Sender message dedup via `clientMsgId` (Bug #4)

**File**: `use-chat-socket.ts`

Use a deterministic `clientMsgId` to match optimistic and server-persisted messages. Content-based matching is fragile (duplicate messages would collide).

**Client sends `clientMsgId`**: In `sendImmediate` (line 281), generate a UUID and include it in both the local optimistic message and the `claude:message` emit:

```ts
const clientMsgId = crypto.randomUUID();
const msg = { id: clientMsgId, sender_type: "admin", content, ... };
setMessages((prev) => [...prev, msg]);
emit("claude:message", { sessionId, content, attachments, clientMsgId });
```

Same for the `aiPaused` send path in `handleSend` and the `drainPending` flush.

**Server echoes `clientMsgId`**: In `message-handlers.ts`, pass `clientMsgId` through to the `claude:user_message` broadcast:

```ts
io.to(`session:${sessionId}`).emit("claude:user_message", {
  sessionId, message: savedUserMessage, fromSocketId: socket.id, clientMsgId,
});
```

**Client replaces optimistic message**: In the `claude:user_message` handler (line 1053):

```ts
if (fromSocketId === socket.id) {
  // Replace optimistic message with server-persisted version
  setMessages((prev) => {
    const idx = prev.findIndex((m) => m.id === clientMsgId);
    if (idx !== -1) {
      const updated = [...prev];
      updated[idx] = message;
      return updated;
    }
    return prev; // no match — don't duplicate
  });
} else {
  setMessages((prev) => [...prev, message]);
}
```

This ensures all clients end up with the same server-persisted message IDs.

#### 3b. `activeSessionRef` sync in effect (Bug #5)

**File**: `use-chat-socket.ts:1122`

```diff
  useEffect(() => {
    if (!activeSession || !connected) return;
+   activeSessionRef.current = activeSession;
    setSessionModel(activeSession.model ?? DEFAULT_MODEL);
```

#### 3c. `handleConnect` emits `get_chat_state` on reconnect (Bug #2 related)

**File**: `use-chat-socket.ts:406` (`handleConnect`)

The reconnect path calls `rejoin_session`, `get_messages`, `get_session_state` but not `get_chat_state`. Without it, the AI pause state isn't restored on reconnect. Add:

```ts
socket.emit("claude:get_chat_state", { sessionId: session.id });
```

This uses the same `isSync: true` path so no false message is injected.

#### 3d. `chat_toggled` handler respects `isSync` (Bug #2)

**File**: `use-chat-socket.ts:1034`

```diff
- socket.on("claude:chat_toggled", ({ sessionId, paused, pausedBy }) => {
+ socket.on("claude:chat_toggled", ({ sessionId, paused, pausedBy, isSync }) => {
    if (activeSessionRef.current?.id !== sessionId) return;
    setAiPaused(paused);
    setAiPausedBy(pausedBy);
+   if (isSync) return; // State sync only — no visible message
    const label = ...
```

#### 3e. Typing indicator sessionId filter (Bug #10)

**File**: `use-chat-socket.ts` (typing listener)

Add guard: `if (sessionId !== activeSessionRef.current?.id) return;` — requires the server to include `sessionId` in the typing event payload (already scoped to room, but belt-and-suspenders).

#### 3f. `resetSessionState` clears refs (Bug #12)

**File**: `use-chat-socket.ts:340`

Add to `resetSessionState()`:
```ts
streamingMsgIdRef.current = null;
turnDoneRef.current = false;
lastUserMsgRef.current = null;
autoCompactFiredRef.current = false;
isCompactingRef.current = false;
aiPausedRef.current = false;
watchdogChecksRef.current = 0;
// Clear pending interactions
setPendingInteractions(new Map());
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
```

#### 3g. Remove redundant `set_active_session` on create (Bug #6)

**File**: `chat-tab.tsx:279`

```diff
  chat.emit("claude:create_session", { ... });
- chat.emit("claude:set_active_session", { sessionId: id });
```

Same for the other `create_session` + `set_active_session` pair (around line 326).

## Files Changed

| File | Type | Description |
|------|------|-------------|
| `src/socket/session-room-manager.ts` | **New** | SessionRoomManager class |
| `src/socket/types.ts` | Edit | Add `roomManager` and `flushStreamingThrottle` to HandlerContext |
| `src/socket/handlers.ts` | Edit | Create room manager per socket; scope status broadcast; expose `flushStreamingThrottle` |
| `src/socket/session-handlers.ts` | Edit | Use room manager; add delete cleanup; remove redundant join/presence calls |
| `src/socket/message-handlers.ts` | Edit | `isSync` flag on chat state; export `clearAiPauseState`; fix error emissions |
| `src/socket/presence-handlers.ts` | Edit | Use room manager for disconnect; emit typing-stop on disconnect |
| `src/hooks/use-chat-socket.ts` | Edit | Dedup sender messages; sync ref; typing filter; reset refs; `isSync` handling |
| `src/components/claude-code/chat-tab.tsx` | Edit | Remove redundant `set_active_session` after `create_session` |

## Out of Scope

- **Presence broadcast optimization** (Bug #14): O(n) broadcast is acceptable at current user scale. Can be addressed later with debouncing or delta updates if needed.
- **Hook refactor**: The 1300-line hook is large but the bugs aren't caused by its size. A reducer refactor would be high-risk churn.
- **Event buffer dedup on reconnect** (Bug #9): The `get_messages` handler replays buffer events for in-progress streams. With the room manager fix preventing stale room membership, this becomes less likely. If it recurs, a sequence number can be added later.

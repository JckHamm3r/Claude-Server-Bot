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

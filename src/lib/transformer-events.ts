import { EventEmitter } from "events";

export type TransformerEventType =
  | "session:created"
  | "session:ended"
  | "message:sent"
  | "message:received"
  | "tool:executed";

export interface SessionCreatedPayload {
  sessionId: string;
  interfaceType: string;
  userId?: string;
}

export interface SessionEndedPayload {
  sessionId: string;
  durationMs?: number;
}

export interface MessageSentPayload {
  sessionId: string;
  content: string;
  senderId?: string;
}

export interface MessageReceivedPayload {
  sessionId: string;
  content: string;
  type: string;
}

export interface ToolExecutedPayload {
  sessionId: string;
  toolName: string;
  exitCode?: number;
}

export type TransformerEventPayload =
  | SessionCreatedPayload
  | SessionEndedPayload
  | MessageSentPayload
  | MessageReceivedPayload
  | ToolExecutedPayload;

class TransformerEventBus extends EventEmitter {
  emit(event: TransformerEventType, payload: TransformerEventPayload): boolean {
    return super.emit(event, payload);
  }
  on(event: TransformerEventType, listener: (payload: TransformerEventPayload) => void): this {
    return super.on(event, listener);
  }
  off(event: TransformerEventType, listener: (payload: TransformerEventPayload) => void): this {
    return super.off(event, listener);
  }
}

export const transformerEvents = new TransformerEventBus();
transformerEvents.setMaxListeners(100);

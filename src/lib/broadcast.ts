/**
 * Global broadcast utility for pushing real-time events from REST API routes.
 * The socket handler registers a broadcaster; API routes call the exported functions.
 */

type BroadcastFn = (event: string, data: unknown) => void;

let broadcaster: BroadcastFn | null = null;

export function setBroadcaster(fn: BroadcastFn): void {
  broadcaster = fn;
}

/** Broadcast an event to ALL connected clients. */
export function broadcastToAll(event: string, data: unknown): void {
  if (broadcaster) {
    broadcaster(event, data);
  }
}

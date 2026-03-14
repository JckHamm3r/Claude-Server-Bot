import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

function buildSocketPath(): string {
  const slug = process.env.NEXT_PUBLIC_CLAUDE_BOT_SLUG ?? "";
  const prefix = process.env.NEXT_PUBLIC_CLAUDE_BOT_PATH_PREFIX ?? "c";
  return slug ? `/${prefix}/${slug}/socket.io` : "/socket.io";
}

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io({
    path: buildSocketPath(),
    transports: ["websocket", "polling"],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    randomizationFactor: 0.3,
    timeout: 10000,
  });

  return socket;
}

/**
 * Connect the socket. If it's already in a reconnection loop with stale
 * credentials (from before login), disconnect first so the next connect()
 * performs a fresh handshake carrying the current session cookie.
 */
export function connectSocket(): void {
  const s = getSocket();
  if (s.connected) return;

  if (s.active) {
    // Socket is reconnecting with a stale handshake — stop it and
    // reconnect so the new handshake picks up the current cookie.
    s.disconnect();
  }

  s.connect();
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

# PTY Terminal

Admin-only terminal access to the server via Socket.IO. Provides a direct shell session from within the dashboard UI.

## Access

The Terminal tab appears in the main navigation bar only for admin users. Non-admin users do not see the tab.

Only users with the `is_admin` flag can open and use the PTY terminal.

## How It Works

The terminal runs as a PTY (pseudo-terminal) process on the server, managed through Socket.IO events. Input and output are streamed in real time, giving admins a full interactive shell without needing SSH access.

## Capabilities

- Full interactive shell session
- Terminal resize support (adapts to browser window size)
- Session close/cleanup

## Socket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `terminal:input` | Client to server | Send keystrokes to the PTY |
| `terminal:resize` | Client to server | Resize the terminal dimensions |
| `terminal:close` | Client to server | Close the terminal session |

## Key Files

| File | Purpose |
|------|---------|
| `src/socket/presence-handlers.ts` | Terminal event handlers (input, resize, close) |
| `src/socket/handlers.ts` | PTY process management |

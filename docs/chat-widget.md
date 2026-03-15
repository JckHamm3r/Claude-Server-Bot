# Chat Widget

An embeddable chat interface for external pages. Authenticated users see a floating chat button; unauthenticated visitors see nothing.

## How It Works

1. A site includes the widget loader script: `<script src="{origin}/api/w.js"></script>`
2. The script calls `/api/w/init` to check authentication via session cookie.
3. If authenticated, a floating chat button is injected into the page.
4. Clicking the button opens the chat interface in a new window/tab pointing to the `/widget` route.
5. If not authenticated, nothing is rendered -- no button, no requests, no indication that a bot exists.

## Embedding

Add this script tag before the closing `</body>` tag on any page served from the same origin:

```html
<script src="{scheme}://{host}:{port}/api/w.js"></script>
```

- **Scheme:** `https` if SSL certs are configured, otherwise `http`
- **Host:** The server's public hostname or IP (from `NEXTAUTH_URL`)
- **Port:** `$PORT` (default 3000)

The script URL (`/api/w.js`) contains no slug or secret paths, so it is safe to include on any page. The slug and base path are only returned by the auth-gated init endpoint, never embedded in page source.

## Widget Route (`/widget`)

A full-height chat interface (`ChatTab` in widget mode) designed to be loaded in an iframe or new window. The page sets `frame-ancestors *` in its Content Security Policy so it can be embedded anywhere.

## React Components

For embedding the full chat experience inside a React app:

| Component | Path | Purpose |
|-----------|------|---------|
| `ClaudeBubble` | `src/components/claude-bubble/bubble.tsx` | Draggable floating chat button (position persisted in localStorage) |
| `ClaudePanel` | `src/components/claude-bubble/claude-panel.tsx` | Slide-up panel with Chat, Agents, Plan, Memory, and Settings tabs |

## Key Files

| File | Purpose |
|------|---------|
| `server.ts` | Serves `/api/w.js` and `/api/w/init` |
| `src/app/widget/page.tsx` | Widget page (iframe target) |
| `src/components/claude-bubble/bubble.tsx` | Floating chat button |
| `src/components/claude-bubble/claude-panel.tsx` | Chat panel |

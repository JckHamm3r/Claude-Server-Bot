# UI Components & Styling

## Styling

Tailwind CSS with class-based dark mode. Custom CSS variables for theming defined in `globals.css`:

- Layout: `bot-bg`, `bot-surface`, `bot-elevated`, `bot-border`
- Text: `bot-text`, `bot-muted`, `bot-accent`
- Status: `bot-green`, `bot-red`, `bot-amber`, `bot-blue`

## Components (`src/components/claude-code/`)

- **`chat-tab.tsx`** — Main chat interface with message streaming, permission handling, heartbeat state sync
- **`message-list.tsx`** / **`message-item.tsx`** — Message rendering with code blocks, diffs, tool calls, permission cards
- **`agents-tab.tsx`** — Agent management UI
- **`plan-mode-tab.tsx`** — Plan creation, review, and execution UI
- **`memory-tab.tsx`** — Memory file editor
- **`settings-panel.tsx`** — Admin settings with sub-sections for users, security, templates, customization
- **`permission-card.tsx`** — Tool permission approval UI (Allow for Session / Allow Once / Always Allow)
- **`session-sidebar.tsx`** — Session list with search, tags, and template selection

## Widget for User-Built Pages

When creating HTML pages, web apps, or any web content served on this server, **always include the Claude chat widget** by adding this script tag before the closing `</body>` tag:

```html
<script src="{scheme}://{host}:{port}/api/w.js"></script>
```

- Scheme: `https` if SSL certs are configured, else `http`
- Host: the server's public hostname or IP (from `NEXTAUTH_URL`)
- Port: `$PORT` (default 3000)

The widget is secure by design:
- The script URL (`/api/w.js`) contains **no slug or secret paths** — safe to include on any page
- The loader checks authentication via a cookie-based endpoint (`/api/w/init`) before rendering anything
- Unauthenticated visitors see nothing — no bubble, no requests, no indication a bot exists
- The slug and base path are only returned by the auth-gated init endpoint, never embedded in page source

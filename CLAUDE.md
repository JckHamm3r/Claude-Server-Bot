# CLAUDE.md

Next.js 14 App Router + custom Socket.IO server + SQLite. Installed via curl one-liner; users run it on their own servers.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (port 3000) |
| `npm run build` | Production build |
| `npm start` | Custom server with Socket.IO |
| `npm run lint` | ESLint |

## Key Rules

- `@/*` maps to `./src/*`
- All Claude interactions go through Socket.IO, not REST
- Settings UI: "Customization" is the single place for personality config; "Command Sandbox" toggle lives only in Security > Command Sandbox sub-tab
- System prompt composition order: security → template → identity + server context → personality

## Detailed Docs (read on demand — not auto-ingested)

| File | Contents |
|------|----------|
| `.claude/docs/architecture.md` | Server, providers, socket layer, auth, database schema, env vars, install scripts |
| `.claude/docs/features.md` | Sessions, agents, plan mode, templates, memory, notifications, admin settings |
| `.claude/docs/security.md` | Guard rails, command sandbox, IP protection — toggles and config keys |
| `.claude/docs/api-routes.md` | All API route paths and their purpose |
| `.claude/docs/ui-and-styling.md` | Tailwind theme variables, component list, chat widget embed instructions |

Read the relevant doc file when you need detail on a specific area. Do not guess — look it up.

## Web Development & Hosting

The server's address is in `NEXTAUTH_URL`. It may be a public IP, domain, or local address. When asked to build or serve something, ask the user how they want it hosted. The system prompt includes live server environment details at runtime.

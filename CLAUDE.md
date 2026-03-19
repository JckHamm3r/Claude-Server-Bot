# CLAUDE.md

Octoby AI platform: Next.js 14 App Router + custom Socket.IO server + SQLite. Powered by `@anthropic-ai/claude-agent-sdk` (TypeScript) in streaming input mode. Installed via curl one-liner; users run it on their own servers.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (port 3000) |
| `npm run build` | Production build |
| `npm start` | Custom server with Socket.IO |
| `npm run lint` | ESLint |

## Key Rules

- `@/*` maps to `./src/*`
- All Claude AI interactions go through Socket.IO, not REST. Exception: lightweight utility calls (session naming, memory import/refactor, AI job builder) use direct Haiku REST calls for simplicity — these bypass guard rails, sandbox, and budget tracking by design.
- SDK provider uses streaming input mode — one long-lived `query()` per session with messages fed via AsyncGenerator. Do not call `query()` per message.
- `persistSession: false` and `settingSources: []` — we manage persistence in SQLite. CLAUDE.md from `CLAUDE_PROJECT_ROOT` is read and appended to the system prompt manually.
- Personality is set per-session at creation time (in the New Session dialog), not in global settings; "Command Sandbox" toggle lives only in Security > Command Sandbox sub-tab
- System prompt composition order: security → template → identity + personality → transformers → role → project CLAUDE.md → memories → context-index → session-journal → agent-tools

## Detailed Docs (read on demand — not auto-ingested)

| File | Contents |
|------|----------|
| `.claude/docs/architecture.md` | Server, providers, socket layer, auth, database schema, env vars, install scripts |
| `.claude/docs/features.md` | Sessions, agents, plan mode, templates, memory, notifications, admin settings |
| `.claude/docs/security.md` | Guard rails, command sandbox, IP protection — toggles and config keys |
| `.claude/docs/api-routes.md` | All API route paths and their purpose |
| `.claude/docs/ui-and-styling.md` | Tailwind theme variables, component list, chat widget embed instructions |
| `.claude/docs/sub-agent-delegation-plan.md` | Design analysis and clarifying questions for sub-agent delegation feature |

Read the relevant doc file when you need detail on a specific area. Do not guess — look it up.

## Web Development & Hosting

The server's address is in `NEXTAUTH_URL`. It may be a public IP, domain, or local address. When asked to build or serve something, ask the user how they want it hosted. The system prompt includes live server environment details at runtime.

<!-- ASSISTANT-PROFILE:START -->
## Assistant Configuration

**Communication style**: The user is an expert developer and sysadmin.
- Use full technical terminology without explanation.
- Be concise and direct. Skip hand-holding and introductory context.
- Provide technical summaries focused on what changed, configuration details, and things to watch.
- Assume deep familiarity with Linux, networking, deployment, and software development.

**Summary requirement**: After completing any task or group of actions, always provide a concise summary of what was done.

<!-- ASSISTANT-PROFILE:END -->

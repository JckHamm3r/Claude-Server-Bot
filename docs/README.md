# Claude Code Server Bot

A self-hosted AI assistant platform powered by Claude. It provides a real-time chat interface, reusable agent configurations, multi-step plan execution, project memory, and a full admin panel -- all installable on any server with a single curl command.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) |
| Real-time | Socket.IO (WebSocket) |
| Database | SQLite (better-sqlite3, WAL mode) |
| AI | `@anthropic-ai/claude-agent-sdk` (streaming input mode) |
| Auth | NextAuth (Credentials + JWT) |
| Styling | Tailwind CSS (dark mode, CSS variable theming) |
| Install | Bash scripts (curl one-liner) |

## Architecture at a Glance

The app runs on a custom HTTP/HTTPS server (`server.ts`) rather than the default Next.js server. Socket.IO is attached for all real-time Claude interactions -- chat messages, tool approvals, presence, and notifications all flow over WebSocket, not REST. A long-lived `query()` call per session keeps conversation context alive via an AsyncGenerator that feeds messages into the SDK stream. SQLite stores sessions, messages, users, settings, and metrics. The system prompt is composed at session creation from security rules, templates, personality, and project CLAUDE.md.

## Feature Index

| Feature | Description | Doc |
|---------|-------------|-----|
| Sessions & Chat | Create sessions, chat with Claude, approve tools, search messages, collaborate | [sessions-and-chat.md](sessions-and-chat.md) |
| Agents | Reusable agent configs with model, tools, and AI-powered generation | [agents.md](agents.md) |
| Plan Mode | Multi-step execution plans with human approval and sequential execution | [plan-mode.md](plan-mode.md) |
| Memory | Project context files (CLAUDE.md, docs, memory) readable/writable from UI | [memory.md](memory.md) |
| Session Templates | Admin-defined presets for new sessions (prompt, model, permissions) | [session-templates.md](session-templates.md) |
| Notifications | In-app and email alerts for system events with per-user preferences | [notifications.md](notifications.md) |
| Bot Customization | Identity (name, avatar, tagline), personality presets, theme colors | [bot-customization.md](bot-customization.md) |
| Security | Guard rails, command sandbox, and IP-based brute-force protection | [security.md](security.md) |
| Admin Settings | Global config store for rate limits, budgets, API key, and toggles | [admin-settings.md](admin-settings.md) |
| User Management | User CRUD, admin privileges, password reset, per-user settings | [user-management.md](user-management.md) |
| File Browser & Uploads | Browse project files and attach uploads to chat messages | [file-browser-and-uploads.md](file-browser-and-uploads.md) |
| Chat Widget | Embeddable chat for external pages with auth-gated script loader | [chat-widget.md](chat-widget.md) |
| Installation & Deployment | Install, update, uninstall, and domain/SSL setup scripts | [installation-and-deployment.md](installation-and-deployment.md) |
| PTY Terminal | Admin-only server terminal access via Socket.IO | [pty-terminal.md](pty-terminal.md) |

## Installation

Install on any server with:

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/install.sh | bash
```

The installer handles dependencies, environment generation, builds, and initial setup. See [installation-and-deployment.md](installation-and-deployment.md) for details.

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Main dashboard (Chat, Agents, Plan Mode, Memory, Settings tabs) |
| `/login` | Authentication |
| `/setup` | First-run setup wizard |
| `/widget` | Embeddable chat (iframe target) |

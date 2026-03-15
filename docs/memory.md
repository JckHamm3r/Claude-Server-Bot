# Memory

Project context files stored on disk (not in the database) that Claude reads at session startup. Memory gives Claude persistent knowledge about the project across sessions.

## File Structure

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | Main project instructions. Kept slim -- contains build commands, key rules, and a reference table pointing to detailed docs. Auto-ingested by AI tools on every turn. |
| `.claude/docs/*.md` | Detailed reference docs (architecture, features, security, etc.). Read on demand, not auto-ingested. |
| `.claude/memory/*.md` | Additional memory files for project-specific context. |
| `.context/_index.md` | Agent-maintained context index. Auto-injected into every session's system prompt (~200 tokens). |
| `.context/*.md` | Agent-maintained detail files (services, stack, structure, connections, history). Read on demand. |

## How It Works

- At session creation, `system-prompt.ts` reads `CLAUDE.md` from the `CLAUDE_PROJECT_ROOT` directory and appends it to the system prompt.
- `.claude/docs/` and `.claude/memory/` files are available for Claude to read on demand during a session but are not automatically loaded into the system prompt.
- The Memory tab in the UI lets users browse, read, and edit all memory files.
- Write access to memory files via the API is restricted to admins.

## Memory Tab

The Memory tab in the dashboard provides a file list and editor for managing all memory files. Users can:

- Browse the list of memory files across all three locations.
- Read file contents in the editor.
- Edit and save changes (admin only via API).

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/memory-tab.tsx` | Memory file browser and editor UI |
| `src/app/api/claude-code/memory/route.ts` | Memory file read/write API |
| `src/lib/system-prompt.ts` | System prompt composition (reads CLAUDE.md) |

## Agent Context System (.context/)

The `.context/` folder is a persistent knowledge base the agent builds and maintains automatically. It prevents the agent from wasting context window tokens rediscovering installed services, project structure, and infrastructure state every session.

### How It Works

- `system-prompt.ts` reads `.context/_index.md` and appends it to every session's system prompt inside `<project-context>` tags.
- If no `.context/` folder exists yet, a bootstrap instruction is injected instead, telling the agent to create the folder when it first discovers something notable.
- The agent uses its Write/Edit tools to create and update `.context/` files. No special API is needed.
- `.context/` files also appear in the Memory tab for admin viewing and editing.

### Expected Files

| File | Contents |
|------|----------|
| `_index.md` | Master table of contents — one-line summaries and last-updated dates. Must stay under 40 lines. |
| `services.md` | Installed services with versions, config paths, and status (nginx, postgres, redis, etc.) |
| `stack.md` | Languages, frameworks, package managers, build tools |
| `structure.md` | Key directories and what lives where |
| `connections.md` | Ports, hostnames, usernames — never secrets or passwords |
| `history.md` | Chronological log of what the agent has built or changed |

### Token Budget

- `_index.md` in the system prompt: ~200 tokens
- Context system instruction: ~100 tokens
- Detail files: loaded on demand, zero baseline cost

## API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/claude-code/memory` | List and read memory and context files |
| POST | `/api/claude-code/memory` | Write memory files (admin only) |

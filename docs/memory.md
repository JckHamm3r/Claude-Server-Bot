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

The Memory tab in the dashboard has two sub-tabs:

### Memories (individual items)

Users can manage individual, standalone memory items:

- Browse the list of all saved memories with expand/collapse
- Add new memories with a title and content (admin only)
- Edit existing memories — update title and/or content (admin only)
- Delete memories (admin only, with confirmation)
- Import from a `.md` file using AI — Claude parses the document and extracts individual titled memories automatically (admin only)

### Context Files

The traditional file browser/editor for raw memory files:

- Browse files across `CLAUDE.md`, `.claude/memory/`, and `.context/`
- Read file contents in the Monaco editor
- Edit and save changes (admin only via API)

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/memory-tab.tsx` | Memory tab UI — individual items + file browser |
| `src/app/api/claude-code/memories/route.ts` | Individual memory items CRUD API (GET/POST/PUT/DELETE) |
| `src/app/api/claude-code/memories/import/route.ts` | AI-powered .md import endpoint |
| `src/app/api/claude-code/memory/route.ts` | Memory file read/write API (CLAUDE.md, .claude/memory, .context) |
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
| PUT | `/api/claude-code/memory` | Write memory files (admin only) |
| GET | `/api/claude-code/memories` | List all individual memory items |
| POST | `/api/claude-code/memories` | Create a memory item (admin only) |
| PUT | `/api/claude-code/memories` | Update a memory item (admin only) |
| DELETE | `/api/claude-code/memories?id=<id>` | Delete a memory item (admin only) |
| POST | `/api/claude-code/memories/import` | AI-parse a .md file and bulk-create memories (admin only) |

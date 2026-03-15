# Memory

Project context files stored on disk (not in the database) that Claude reads at session startup. Memory gives Claude persistent knowledge about the project across sessions.

## File Structure

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | Main project instructions. Kept slim -- contains build commands, key rules, and a reference table pointing to detailed docs. Auto-ingested by AI tools on every turn. |
| `.claude/docs/*.md` | Detailed reference docs (architecture, features, security, etc.). Read on demand, not auto-ingested. |
| `.claude/memory/*.md` | Additional memory files for project-specific context. |

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

## API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/claude-code/memory` | List and read memory files |
| POST | `/api/claude-code/memory` | Write memory files (admin only) |

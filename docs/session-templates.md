# Session Templates

Admin-created presets for starting new sessions. Templates let admins define standard configurations so users can quickly create sessions with the right system prompt, model, and permissions without manual setup each time.

## Template Properties

| Property | Description |
|----------|-------------|
| Name | Display name for the template |
| System prompt | Custom system prompt prepended to the session |
| Model | Pre-selected Claude model |
| Skip permissions | Whether tool use is auto-approved |
| Provider type | Provider selection |
| Icon | Visual identifier |
| Description | Explanation of what the template is for |
| Is default | Whether this template is auto-selected for new sessions |

## Usage

When creating a new session via the New Session dialog, users see a list of available templates. Selecting a template pre-fills the session configuration. If a default template exists, it is pre-selected automatically.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/settings/templates-section.tsx` | Template management UI in Settings |
| `src/components/claude-code/new-session-dialog.tsx` | Template selection in new session flow |
| `src/socket/session-handlers.ts` | Template CRUD socket handlers |
| `src/lib/claude-db.ts` | Template database queries |

## Database Table

| Table | Purpose |
|-------|---------|
| `session_templates` | Template definitions (name, system_prompt, model, skip_permissions, icon, description, is_default) |

## Socket Events

**Client to server:** `claude:list_templates`

**Server to client:** Templates are returned as part of session-related responses.

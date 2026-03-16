# Sessions & Chat

The core interaction surface. Users create sessions to chat with Claude, approve tool use, search across conversations, collaborate with other users, and manage message history.

## Session Lifecycle

- **Create** -- Open a new session from the sidebar or via the New Session dialog. Choose a name, model, personality, template, and whether to enable skip-permissions mode. The system prompt includes the `.context/_index.md` (or a bootstrap instruction) so the agent has persistent knowledge of installed services and project state from the start.
- **Auto-naming** -- If no name is provided at creation, the server generates one using Haiku after the first exchange completes. Controlled by the per-user `auto_naming_enabled` setting (default on). Falls back to a truncated first message on error.
- **Rename** -- Double-click the session name in the sidebar or use inline edit.
- **Delete** -- Remove a session and its messages permanently.
- **Close** -- Suspend the Claude SDK session while preserving the `claudeSessionId` for later resume.
- **Tags** -- Add or remove tags on sessions for organization. Filter sessions by tag in the sidebar.

## Models

Each session can use a different Claude model. Available models include Claude Opus 4.6, Claude Sonnet 4.6, and Claude Haiku 4.5. The model can be changed mid-session from the toolbar.

## Skip-Permissions Mode

When enabled, tool use is auto-approved without prompting the user. A banner is displayed in the chat to indicate this mode is active. Can be set per-session at creation time.

## Chat Features

- **Message sending** -- Type in the input area and send. Messages are queued if Claude is currently processing.
- **Slash commands** -- `/compact`, `/clear`, `/memory`, and others for quick actions.
- **@ file references** -- Type `@` to autocomplete and reference project files.
- **File attachments** -- Attach uploaded files (including images) to messages.
- **Tool approval** -- When Claude wants to use a tool, a permission card appears with three options: Allow Once, Allow for Session, or Always Allow. Multiple permission requests can be pending simultaneously; each card remains interactive and can be approved independently. The session resumes only after all pending permissions are resolved.
- **AskUserQuestion** -- Claude can ask the user structured questions; dedicated UI cards handle these.
- **Message editing** -- Edit a previously sent message and re-execute from that point.
- **Message deletion** -- Remove individual messages from the conversation.
- **Interrupt** -- Stop Claude mid-response.
- **Retry** -- Re-send the last message.
- **Clear context** -- Reset conversation context.

## Tool Calls

Claude can use these tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, and Agent. Each tool call is rendered with a specialized output view:

| Tool | Renderer |
|------|----------|
| Bash | Terminal-style output |
| Read | File content viewer |
| Write / Edit | Diff view |
| Glob / Grep | Search results |
| WebSearch | Search result cards |

## Search

- **Session search** (`Ctrl/Cmd + F`) -- Search within the current session's messages.
- **Global search** (`Ctrl/Cmd + Shift + F`) -- Full-text search across all sessions using SQLite FTS5.

## Session Export

Export session messages as JSON from the toolbar.

## Collaboration

- **Invite users** -- Share a session with other users on the platform.
- **Remove participants** -- Revoke access to a shared session.
- **Presence** -- See who else is currently viewing the session.
- **Typing indicators** -- See when other users are typing.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + F` | Search in session |
| `Ctrl/Cmd + Shift + F` | Global search |
| `Ctrl/Cmd + /` | Focus input |
| `Ctrl/Cmd + Shift + C` | Copy last Claude reply |

## Token Usage

Token count and cost are displayed in the toolbar per session. Budget warnings appear when approaching configured limits.

## Context Window Management

A circular context usage indicator in the toolbar shows the current context window consumption as a percentage.

- **Indicator** -- A ring that fills proportionally. Color changes from neutral (< 50%) to amber (50-80%) to warning (80-93%) to red (93%+).
- **Auto-compaction** -- When context usage reaches 93%, the system automatically sends `/compact` to the SDK, which summarizes earlier conversation history and resets the context. A system message confirms when compaction completes.
- **Manual compact** -- Click the ring indicator or type `/compact` in the chat input to trigger compaction at any time.
- **Data source** -- The SDK's `modelUsage` on each result message provides the authoritative `contextWindow` size and cumulative `inputTokens`. These flow through `claude:usage` socket events to the client.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/chat-tab.tsx` | Main chat UI |
| `src/components/claude-code/message-list.tsx` | Message rendering |
| `src/components/claude-code/message-item.tsx` | Individual message |
| `src/components/claude-code/chat-input.tsx` | Input with slash commands and @ autocomplete |
| `src/components/claude-code/chat-toolbar.tsx` | Toolbar (model, search, export, interrupt) |
| `src/components/claude-code/permission-card.tsx` | Tool approval UI |
| `src/components/claude-code/session-sidebar.tsx` | Session list and management |
| `src/components/claude-code/new-session-dialog.tsx` | New session dialog |
| `src/components/claude-code/tool-call-block.tsx` | Tool call rendering |
| `src/components/claude-code/tool-renderers/` | Specialized tool output renderers |
| `src/socket/session-handlers.ts` | Session CRUD, model switching, collaboration |
| `src/socket/message-handlers.ts` | Message send, edit, delete, tool permissions |
| `src/hooks/use-chat-socket.ts` | Client-side Socket.IO hook |
| `src/lib/claude/session-namer.ts` | AI-powered session name generation (Haiku API) |
| `src/lib/claude-db.ts` | Database queries for sessions and messages |

## Socket Events

**Client to server:** `claude:create_session`, `claude:set_active_session`, `claude:list_sessions`, `claude:get_messages`, `claude:rename_session`, `claude:delete_session`, `claude:update_session_tags`, `claude:close_session`, `claude:set_model`, `claude:get_session_state`, `claude:rejoin_session`, `claude:invite_to_session`, `claude:remove_from_session`, `claude:list_session_participants`, `claude:message`, `claude:interrupt`, `claude:allow_tool`, `claude:edit_message`, `claude:delete_message`, `claude:confirm`

**Server to client:** `claude:sessions`, `claude:session_status`, `claude:session_renamed`, `claude:presence_update`, `claude:typing`, `claude:command_started`, `claude:command_done`, `claude:output`, `claude:usage`, `claude:session_usage`, `claude:model_changed`, `claude:messages_updated`, `claude:message_deleted`, `claude:session_state`, `claude:error`, `claude:rate_limited`, `claude:budget_exceeded`, `claude:budget_warning`, `claude:compacting`, `claude:compact_done`

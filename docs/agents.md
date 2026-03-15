# Agents

Reusable agent configurations that define a specific persona, model, and tool set for Claude sessions. Agents let admins create purpose-built assistants (e.g., a code reviewer that only uses Read and Grep, or a deployment bot with Bash access).

## Capabilities

- **Name and description** -- Human-readable identity for the agent.
- **Emoji icon** -- Visual identifier shown in the agent list.
- **Model selection** -- Pin the agent to a specific Claude model.
- **Allowed tools** -- Restrict which tools the agent can use: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Agent.
- **Status management** -- Agents can be active, disabled, or archived.
- **Version history** -- Every configuration change creates a version snapshot. Previous versions can be reviewed.

## AI-Powered Generation

Create agents from a natural language description. Describe what you want the agent to do and the system generates the name, description, icon, model, and tool selection automatically.

## Agent List UI

Agents are displayed in a grid/card layout. Each card shows the agent's icon, name, description, model, and status. Cards support enable/disable toggling and opening the edit form.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/agents-tab.tsx` | Agent management tab |
| `src/components/claude-code/agent-list-view.tsx` | Agent grid/card layout |
| `src/components/claude-code/create-agent-dialog.tsx` | Create/edit agent form |
| `src/components/claude-code/agent-version-history.tsx` | Version history viewer |
| `src/socket/plan-handlers.ts` | Agent CRUD socket handlers |
| `src/lib/claude-db.ts` | Agent database queries |

## Database Tables

| Table | Purpose |
|-------|---------|
| `agents` | Agent definitions (name, description, icon, model, allowed_tools, status) |
| `agent_versions` | Version history with config snapshots |

## Socket Events

**Client to server:** `claude:list_agents`, `claude:create_agent`, `claude:update_agent`, `claude:delete_agent`, `claude:get_agent_versions`, `claude:generate_agent`

**Server to client:** `claude:agents`, `claude:agent_versions`, `claude:agent_generated`

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import db from "@/lib/db";
import { getGroup, getGroupPermissions } from "@/lib/claude-db";
import { getAppSetting } from "@/lib/app-settings";

const GROUP_ASSISTANT_SYSTEM_PROMPT = `You are an expert AI assistant helping an administrator configure user group permissions for the Octoby AI platform.

## Your Purpose
You help admins set up and configure user groups with appropriate permissions. You understand the full permission model and can:
- Suggest appropriate permission configurations based on the role description
- Explain what each permission does
- Flag security concerns in a configuration
- Generate complete group configurations from plain English descriptions
- Review existing configurations and suggest improvements

## Permission Categories

### Platform Permissions (boolean toggles)
- sessions_create: Can users create new AI sessions
- sessions_view_others: Can users see sessions created by other users
- sessions_collaborate: Can users join shared/collaborative sessions
- templates_view: Can users see session templates
- templates_manage: Can users create/edit/delete templates
- memories_view: Can users view platform memories
- memories_manage: Can users create/edit/delete memories
- files_browse: Can users browse project files
- files_upload: Can users upload files
- terminal_access: Can users access the terminal

### AI Permissions
- shell_access (boolean): Whether the AI agent can run shell commands at all
- full_trust_allowed (boolean): Whether users can enable full-trust mode (auto-approve all tools)
- read_only (boolean): Restrict AI to read-only operations (no file writes)
- commands_allowed (array): Command patterns that are always allowed even if restricted globally
- commands_blocked (array): Command patterns that are always blocked
- directories_allowed (array): Glob patterns for allowed working directories (empty = all). Example: ["src/frontend/**", "public/**"]
- directories_blocked (array): Glob patterns for blocked directories
- filetypes_allowed (array): File extensions AI can modify (empty = all). Example: [".tsx", ".ts", ".css"]
- filetypes_blocked (array): File extensions AI cannot modify

### Session Permissions
- max_active (integer, 0=unlimited): Max concurrent active sessions
- max_turns (integer, 0=unlimited): Max turns per session
- delegation_enabled (boolean): Can AI use sub-agent delegation
- delegation_max_depth (integer): Max sub-agent nesting depth
- models_allowed (array): Allowed Claude model identifiers (empty = all)
- default_model (string): Default model when creating sessions
- default_template (string): Default template ID for new sessions

### Prompt Additions
- system_prompt_append (string): Text added to AI system prompt for all sessions
- default_context (string): Default context included in every session

## Common Group Templates

**Developer (full access)**:
All platform permissions true, shell_access true, no directory restrictions

**Frontend Developer**:
sessions_create true, shell_access true, directories_allowed: ["src/frontend/**", "src/components/**", "public/**"], filetypes_allowed: [".tsx", ".ts", ".css", ".html", ".json"]

**Viewer/Observer**:
sessions_create false, files_browse true, files_upload false, terminal_access false, read_only true

**DevOps**:
All permissions true, commands_allowed: ["docker", "systemctl", "nginx", "pm2"]

**Junior Developer (restricted)**:
sessions_create true, directories_allowed: ["src/**"], delegation_enabled false, max_turns 20

## Response Format
When suggesting permissions, format your response clearly with explanations. Use markdown.
If the user asks you to generate a complete configuration, provide a JSON block they can apply.

Be concise, practical, and security-conscious. Always explain the security implications of permissive settings.`;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = db.prepare("SELECT is_admin FROM users WHERE email = ?").get(session.user.email) as { is_admin: number } | undefined;
  if (!user?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { groupId?: string; message: string; currentPermissions?: unknown; conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { groupId, message, currentPermissions, conversationHistory = [] } = body;
  if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });

  const apiKey = getAppSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No API key configured" }, { status: 503 });

  // Build context about the current group
  let groupContext = "";
  if (groupId) {
    const group = getGroup(groupId);
    if (group) {
      const perms = getGroupPermissions(groupId);
      groupContext = `\n\n## Current Group Being Edited\nName: ${group.name}\nDescription: ${group.description}\n\nCurrent Permissions:\n\`\`\`json\n${JSON.stringify(perms, null, 2)}\n\`\`\``;
    }
  } else if (currentPermissions) {
    groupContext = `\n\n## Current Group Permissions\n\`\`\`json\n${JSON.stringify(currentPermissions, null, 2)}\n\`\`\``;
  }

  // Build messages for the API
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...conversationHistory,
    { role: 'user', content: message },
  ];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system: GROUP_ASSISTANT_SYSTEM_PROMPT + groupContext,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `API error: ${errText}` }, { status: response.status });
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = data.content.find((c) => c.type === "text")?.text ?? "";
    return NextResponse.json({ response: text });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

# Bot Customization

Customize the bot's identity, visual theme, and platform-level behavior. The **Customization** section in Settings provides a dedicated chat interface for making structural changes to the platform itself.

## Identity

| Setting | Description |
|---------|-------------|
| Name | Bot display name (shown in login, chat header, widget) |
| Avatar | Bot avatar image |
| Tagline | Short description shown on the login page |

Identity is stored in the `bot_settings` database table and served via `/api/bot-identity`.

## Personality

Personality defines the tone and style of Claude's responses. It is set **per-session** at creation time in the New Session dialog — not as a global setting.

Available presets:

| Preset | Behavior |
|--------|----------|
| Professional | Formal, business-appropriate tone |
| Friendly | Warm, conversational tone |
| Technical | Precise, detail-oriented responses |
| Concise | Brief, to-the-point answers |
| Verbose | Thorough explanations with examples and step-by-step walkthroughs |
| Creative | Imaginative, expressive style |
| Strict Engineer | Correctness-first; challenges assumptions, flags edge cases and bugs |
| Custom | Free-text personality description |

The selected personality is injected into the system prompt at session creation time.

## Theme

Visual theming uses CSS variables defined in `globals.css`. Admins can adjust colors through the Customization section in Settings.

| Variable | Purpose |
|----------|---------|
| `bot-bg` | Background color |
| `bot-surface` | Surface/card background |
| `bot-elevated` | Elevated element background |
| `bot-border` | Border color |
| `bot-text` | Primary text color |
| `bot-muted` | Secondary/muted text |
| `bot-accent` | Accent/highlight color |
| `bot-green` | Success status |
| `bot-red` | Error/danger status |
| `bot-amber` | Warning status |
| `bot-blue` | Info status |

## Customization Chat (Platform Self-Customization)

The **Customization** section in Settings is a dedicated chat interface where admins can talk to Claude to customize and extend the platform itself. This is distinct from normal chat sessions — it operates in `customization_interface` mode with a system prompt that instructs Claude:

- It is in platform customization mode, not user-project mode
- Its purpose is to help add features, modify behavior, update configuration, and edit documentation for the platform itself
- The platform's own source code lives at `BOT_INSTALL_DIR` (the install root)
- Changes require a rebuild + restart (`npm run build && npm start`)
- The user's external project (at `CLAUDE_PROJECT_ROOT`) is out of scope here

Each admin gets a persistent customization session stored in `localStorage` under the key `claude:customization_session_id`. A "New session" button lets admins start fresh.

The customization chat uses `interface_type: "customization_interface"` when creating the session, which causes `buildSystemPrompt` to call `getCustomizationSystemPrompt()` instead of the normal chat system prompt.

## Server Environment Awareness

The system prompt includes live server environment details at session creation time (computed in `src/lib/customization.ts`). This gives the bot context about:

- **Network context** -- hostname/IP, scheme (HTTP/HTTPS), port, whether the address is public or private, reverse proxy (nginx) status
- **Port usage** -- which TCP ports are currently in use on the server and suggested available ports (scanned via `ss`, `netstat`, or `lsof`)
- **Hosting decision guidance** -- when asked to build something new (a page, app, API, etc.), the bot is instructed to ask the user:
  1. Whether it should be publicly accessible or local-only
  2. Whether the user wants a specific port or an auto-suggested one (only available ports are offered)
  3. Whether the service should persist after the session ends

The bot will never use a port that's already in use, and never assume public/private without asking.

## System Prompt Composition Order

1. Security prompt (guard rails, sandbox rules)
2. Template prompt (if session uses a template)
3. Identity + personality prefix (includes server environment context) — for normal `ui_chat` sessions
4. Project CLAUDE.md content

For `customization_interface` sessions, a dedicated system prompt is used (from `getCustomizationSystemPrompt()`) instead of steps 3–4.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/settings/customization-section.tsx` | Customization chat UI (platform self-customization) |
| `src/components/claude-code/new-session-dialog.tsx` | Personality selection at session creation |
| `src/app/api/bot-identity/route.ts` | Bot identity API |
| `src/lib/customization.ts` | Customization helpers + `getCustomizationSystemPrompt()` |
| `src/lib/system-prompt.ts` | System prompt composition |

## Database Tables

| Table | Purpose |
|-------|---------|
| `bot_settings` | Bot identity (name, avatar, tagline) |
| `app_settings` | Legacy personality keys (`personality`, `personality_custom`) — no longer used by the Customization section UI |

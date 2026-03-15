# Bot Customization

Customize the bot's identity, personality, and visual theme. These settings affect how Claude presents itself across the login page, chat interface, and embedded widget.

## Identity

| Setting | Description |
|---------|-------------|
| Name | Bot display name (shown in login, chat header, widget) |
| Avatar | Bot avatar image |
| Tagline | Short description shown on the login page |

Identity is stored in the `bot_settings` database table and served via `/api/bot-identity`.

## Personality

Personality defines the tone and style of Claude's responses. It is set per-session at creation time in the New Session dialog -- not as a global setting.

Available presets:

| Preset | Behavior |
|--------|----------|
| Professional | Formal, business-appropriate tone |
| Friendly | Warm, conversational tone |
| Technical | Precise, detail-oriented responses |
| Concise | Brief, to-the-point answers |
| Creative | Imaginative, expressive style |
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

## System Prompt Composition Order

1. Security prompt (guard rails, sandbox rules)
2. Template prompt (if session uses a template)
3. Identity + personality prefix
4. Project CLAUDE.md content

## Key Files

| File | Purpose |
|------|---------|
| `src/components/claude-code/settings/customization-section.tsx` | Customization settings UI |
| `src/components/claude-code/new-session-dialog.tsx` | Personality selection at session creation |
| `src/app/api/bot-identity/route.ts` | Bot identity API |
| `src/app/api/settings/customization/route.ts` | Personality/customization API |
| `src/lib/customization.ts` | Customization helpers |
| `src/lib/system-prompt.ts` | System prompt composition |

## Database Tables

| Table | Purpose |
|-------|---------|
| `bot_settings` | Bot identity (name, avatar, tagline) |
| `app_settings` | Personality and customization preferences (keys: `personality`, `personality_custom`) |

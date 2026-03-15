# User Management

Admin-managed user accounts with role-based access and per-user settings.

## User Accounts

Admins can create, edit, and delete user accounts from the Users section in Settings. Each user has:

| Field | Description |
|-------|-------------|
| Email | Login identifier (unique) |
| Password | Bcrypt-hashed credential |
| Is admin | Admin flag granting full platform access |

## Admin Privileges

Admin users have access to:
- All settings sections
- User management (create, edit, delete users)
- Session templates management
- Security configuration
- Database maintenance (backup, restore, vacuum)
- PTY terminal access
- System monitoring (CPU, RAM, disk)
- Kill All Sessions

Non-admin users can create sessions, chat with Claude, and manage their own preferences but cannot access admin-only features.

## Password Reset

Admins can reset any user's password from the Users section in Settings. There is no self-service password reset flow.

## Per-User Settings

Each user has individual preferences stored in the `user_settings` table:

| Setting | Description |
|---------|-------------|
| `full_trust_mode` | Auto-approve all tool use for this user |
| `custom_default_context` | Custom default context for this user's sessions |
| `auto_naming_enabled` | Automatically generate session names from first message |

## Authentication

Authentication uses NextAuth with the Credentials provider and JWT strategy. The middleware (`src/middleware.ts`) handles:

- **Public routes** -- `/api/auth/*`, `/api/bot-identity`, `/api/health/*`, static assets
- **Setup gate** -- Redirects to `/setup` if initial setup is not complete
- **Protected routes** -- All other routes require a valid JWT

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/users/route.ts` | User CRUD API |
| `src/components/claude-code/settings-panel.tsx` | Users section in Settings |
| `src/lib/auth.ts` | NextAuth configuration |
| `src/middleware.ts` | Route protection middleware |
| `src/lib/claude-db.ts` | User database queries |

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (email, password hash, is_admin) |
| `user_settings` | Per-user preferences |

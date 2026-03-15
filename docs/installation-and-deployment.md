# Installation & Deployment

The platform is installed on user servers via a curl one-liner. Bash scripts handle installation, updates, uninstallation, and domain/SSL setup.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/install.sh | bash
```

## Scripts

| Script | Purpose |
|--------|---------|
| `install.sh` | Full installation: dependency setup, API key prompt, environment file generation, npm build, initial setup |
| `update.sh` | Pull latest from main, rebuild, run health check, auto-rollback on failure |
| `uninstall.sh` | Clean removal (optionally keeps data directory) |
| `scripts/setup-domain.sh` | Custom domain + SSL setup (nginx, certbot) |
| `scripts/generate-env.js` | Generate `.env` file with hashed credentials |

## install.sh

Interactive or unattended installation that:

1. Checks and installs system dependencies (Node.js, npm, git)
2. Clones the repository
3. Prompts for Anthropic API key
4. Generates the `.env` file with secrets (NextAuth secret, hashed admin credentials)
5. Runs `npm install` and `npm run build`
6. Starts the server and runs initial health checks

## update.sh

Safe update process:

1. Pulls latest changes from `origin/main`
2. Runs `npm install` and `npm run build`
3. Performs a health check against `/api/health`
4. If the health check fails, automatically rolls back to the previous version

## uninstall.sh

Removes the installation. Prompts whether to keep the data directory (database, uploads, backups).

## setup-domain.sh

Configures a custom domain with SSL:

1. Installs and configures nginx as a reverse proxy
2. Sets up certbot for Let's Encrypt SSL certificates
3. Updates the application's `NEXTAUTH_URL` to use the new domain
4. Blocks external access to the app port (only localhost allowed) to prevent basePath/slug leakage via the Next.js 404 page

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Claude (also settable via Settings UI) |
| `CLAUDE_PROJECT_ROOT` | Working directory for Claude |
| `CLAUDE_BOT_PATH_PREFIX` | URL path prefix derived from bot name |
| `CLAUDE_BOT_SLUG` | Random URL slug for basePath routing |
| `NEXTAUTH_SECRET` | JWT signing secret |
| `DATA_DIR` | Database directory (default: `./data`) |
| `SSL_CERT_PATH` | Optional SSL certificate path for HTTPS |
| `SSL_KEY_PATH` | Optional SSL key path for HTTPS |
| `PORT` | Server port (default: 3000) |

## SSL / HTTPS

When `SSL_CERT_PATH` and `SSL_KEY_PATH` are set, the custom server creates an HTTPS server instead of HTTP and sets `x-forwarded-proto: https` on requests so Next.js generates correct redirect URLs.

## Setup Wizard

On first launch, the app presents a 4-step setup wizard at `/setup`:

1. **Project directory** -- Set the project root path
2. **Init** -- Create CLAUDE.md if it doesn't exist
3. **Test Claude** -- Verify API key and SDK connectivity
4. **Done** -- Mark setup as complete

## Key Files

| File | Purpose |
|------|---------|
| `install.sh` | Installation script |
| `update.sh` | Update script |
| `uninstall.sh` | Uninstallation script |
| `scripts/setup-domain.sh` | Domain + SSL setup |
| `scripts/generate-env.js` | Environment file generator |
| `server.ts` | Custom HTTP/HTTPS server |
| `src/app/setup/page.tsx` | Setup wizard UI |

## Database

| Table | Purpose |
|-------|---------|
| `domains` | Custom domain configuration |

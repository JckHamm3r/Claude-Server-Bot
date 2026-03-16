# Installation & Deployment

The platform is installed on user servers via a curl one-liner. Bash scripts handle installation, updates, uninstallation, and domain/SSL setup.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/install.sh | bash
```

## Scripts

| Script | Purpose |
|--------|---------|
| `install.sh` | Full installation: dependency setup, environment file generation, npm build, initial setup |
| `update.sh` | Pull latest from main, rebuild, run health check, auto-rollback on failure |
| `uninstall.sh` | Clean removal (optionally keeps data directory) |
| `scripts/setup-domain.sh` | Custom domain + SSL setup (nginx, certbot) |
| `scripts/generate-env.js` | Generate `.env` file with hashed credentials |
| `scripts/verify-credentials.js` | Verify that hashed credentials in `.env` are correct |

## install.sh

Interactive or unattended installation that:

1. Checks disk space (500 MB minimum required before installing any dependencies)
2. Checks and installs system dependencies (Node.js 20+, pnpm, git, openssl, build tools)
3. Clones the repository
4. Generates the `.env` file with secrets (NextAuth secret, hashed admin credentials)
5. Runs `pnpm install` and `pnpm build`
6. Sets up HTTPS (self-signed cert, Let's Encrypt, or Cloudflare Tunnel)
7. Configures systemd (Linux) or launchd (macOS) service
8. Starts the server and runs health checks (up to 39 seconds to allow slow starts)

The API key is not required at install time. The web setup wizard prompts for it on first login.

### Unattended mode

```bash
bash install.sh --unattended \
  --mode vps \
  --email admin@example.com \
  --domain example.com \
  --https letsencrypt \
  --api-key sk-ant-...
```

`--https` accepts: `letsencrypt`, `cloudflare`, `selfsigned`, `none`

### Config file mode

```bash
bash install.sh --config install.conf
```

Config file format (`key=value`, one per line):
```
mode=vps
email=admin@example.com
domain=example.com
https=letsencrypt
project_root=/home/user/project
port=3000
install_dir=/home/user/claude-server-bot
api_key=sk-ant-...
```

## update.sh

Safe update process:

1. Checks for Node.js and pnpm availability
2. Backs up `.next/`, `certs/`, `pnpm-lock.yaml`, and SQLite database (keeps last 3 upgrade backups)
3. Pulls latest changes from the tracking branch (`git pull --ff-only`)
4. Migrates `.env` — adds missing keys from `.env.example`, warns about deprecated keys
5. Runs `pnpm install` and `pnpm build`
6. Restarts the service and runs a health check (up to 39 seconds)
7. On health check failure, automatically rolls back to the previous git SHA, restored `.next/` and `certs/`

Supports `--yes` flag for non-interactive use (skips disk-space prompt):

```bash
./update.sh --yes
```

## uninstall.sh

Removes the installation. Prompts whether to keep the data directory.

- Stops and removes the systemd/launchd service
- Removes nginx configuration and reloads nginx
- Removes UFW rules (ports 80/443 and the app port deny rule)
- Removes the sudoers entry for passwordless `setup-domain.sh`
- Removes `/usr/local/bin/setup-domain.sh`
- Optionally removes the data directory (database, uploads)
- If the install directory is being removed but data is being kept, data is moved out first to a sibling directory

Options:
- `--keep-data` — preserve the data directory
- `--force` — skip all confirmation prompts

## setup-domain.sh

Configures a custom domain with SSL:

1. Validates all inputs (domain format, port range, path prefix, slug, install dir)
2. Installs and configures nginx as a reverse proxy (supports apt, dnf, yum)
3. Sets up certbot for Let's Encrypt SSL certificates
4. Updates the application's `NEXTAUTH_URL` to use the new domain
5. Opens UFW/iptables ports 80 and 443
6. Blocks external access to the app port (only localhost allowed) to prevent basePath/slug leakage

**Note:** Both `path-prefix` and `slug` are required arguments. The script will not configure an overly-broad catch-all proxy.

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

Self-signed certificates are stored in `$INSTALL_DIR/certs/`. Both `install.sh` (upgrade path) and `update.sh` preserve this directory during updates.

The self-signed cert generation falls back gracefully from OpenSSL `-addext` (requires OpenSSL ≥ 1.1.1) to a temporary extension config file for older OpenSSL versions.

## Setup Wizard

On first launch, the app presents a setup wizard at `/setup`. The wizard covers:
- Bot name and identity
- Anthropic API key (tested via SDK connectivity check)
- Project directory and context
- Experience level and purpose
- Completion

## Key Files

| File | Purpose |
|------|---------|
| `install.sh` | Installation script |
| `update.sh` | Update script |
| `uninstall.sh` | Uninstallation script |
| `scripts/setup-domain.sh` | Domain + SSL setup |
| `scripts/generate-env.js` | Environment file generator |
| `scripts/verify-credentials.js` | Credential verifier |
| `server.ts` | Custom HTTP/HTTPS server |
| `src/app/setup/page.tsx` | Setup wizard UI |

## Database

| Table | Purpose |
|-------|---------|
| `domains` | Custom domain configuration |

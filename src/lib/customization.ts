import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { dbGet } from "./db";

/**
 * The bot's own install directory. The subprocess cwd (CLAUDE_PROJECT_ROOT) may
 * point to the user's project, so we resolve from this source file to reach the
 * repo root where the bot's own CLAUDE.md lives.
 */
const BOT_INSTALL_DIR = path.resolve(__dirname, "../..");

interface BotSettings {
  name: string;
  tagline: string;
}

async function getBotSettings(): Promise<BotSettings> {
  try {
    const row = await dbGet<{ name: string; tagline: string }>(
      "SELECT name, tagline FROM bot_settings WHERE id = 1"
    );
    return {
      name: row?.name ?? "Octoby AI",
      tagline: row?.tagline ?? "Your AI assistant",
    };
  } catch {
    return { name: "Octoby AI", tagline: "Your AI assistant" };
  }
}

function _getBotClaudeMd(): string | null {
  const claudeMdPath = path.join(BOT_INSTALL_DIR, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    try {
      const content = fs.readFileSync(claudeMdPath, "utf-8").trim();
      return content || null;
    } catch {
      return null;
    }
  }
  return null;
}

function isPublicHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return false;
  // RFC-1918 private ranges
  if (hostname.startsWith("10.")) return false;
  if (hostname.startsWith("192.168.")) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
  // Link-local
  if (hostname.startsWith("169.254.")) return false;
  // If it has dots and isn't a private IP, treat it as public (domain or public IP)
  return true;
}

/**
 * Scan for ports currently in use on the server by parsing `ss` or `netstat` output.
 * Returns a sorted list of listening TCP port numbers.
 */
function getPortsInUse(): number[] {
  try {
    // Try ss first (modern Linux), fall back to netstat, then lsof (macOS)
    let output = "";
    try {
      output = execSync("ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null", {
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
      }).toString();
    } catch {
      try {
        output = execSync("lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null", {
          timeout: 3000,
          stdio: ["pipe", "pipe", "pipe"],
        }).toString();
      } catch { return []; }
    }

    const ports = new Set<number>();
    for (const line of output.split("\n")) {
      // ss format: "LISTEN  0  128  0.0.0.0:3000  0.0.0.0:*"
      // netstat format: "tcp  0  0  0.0.0.0:3000  0.0.0.0:*  LISTEN"
      // lsof format: "node  1234  user  21u  IPv4  ...  TCP *:3000 (LISTEN)"
      const matches = line.match(/:(\d+)\b/g);
      if (matches) {
        for (const m of matches) {
          const port = parseInt(m.slice(1), 10);
          if (port > 0 && port <= 65535) ports.add(port);
        }
      }
    }
    return Array.from(ports).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Suggest a few available ports in common ranges (3000-9999).
 * Avoids ports already in use and well-known system ports.
 */
function suggestAvailablePorts(portsInUse: number[], count: number = 5): number[] {
  const candidates = [3001, 4000, 5000, 5173, 5500, 8000, 8080, 8081, 8443, 8888, 9000, 9090];
  const inUseSet = new Set(portsInUse);
  const available: number[] = [];

  for (const port of candidates) {
    if (!inUseSet.has(port)) {
      available.push(port);
      if (available.length >= count) break;
    }
  }

  // If we didn't find enough, scan 3001-9999 for gaps
  if (available.length < count) {
    for (let p = 3001; p <= 9999 && available.length < count; p++) {
      if (!inUseSet.has(p) && !available.includes(p)) {
        available.push(p);
      }
    }
  }

  return available;
}

/**
 * Detect whether nginx is installed and proxying to the app's port.
 * Returns { installed, proxyDomain, proxyPort } or null fields.
 */
function detectNginxProxy(appPort: string): { installed: boolean; proxyDomain: string | null; proxyPort: string | null } {
  try {
    execSync("command -v nginx", { stdio: "ignore" });
  } catch {
    return { installed: false, proxyDomain: null, proxyPort: null };
  }

  // nginx is installed — try to find a config that proxies to our app port
  try {
    const confDirs = ["/etc/nginx/sites-enabled", "/etc/nginx/conf.d"];
    for (const dir of confDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f === "default" || f.startsWith(".")) continue;
        try {
          const content = fs.readFileSync(path.join(dir, f), "utf-8");
          if (content.includes(`proxy_pass http://127.0.0.1:${appPort}`) || content.includes(`proxy_pass http://localhost:${appPort}`)) {
            const domainMatch = content.match(/server_name\s+([^\s;]+)/);
            const listenMatch = content.match(/listen\s+(\d+)/);
            return {
              installed: true,
              proxyDomain: domainMatch?.[1] ?? null,
              proxyPort: listenMatch?.[1] ?? "80",
            };
          }
        } catch { /* skip unreadable files */ }
      }
    }
    return { installed: true, proxyDomain: null, proxyPort: null };
  } catch {
    return { installed: true, proxyDomain: null, proxyPort: null };
  }
}

/**
 * Derives scheme, hostname, and port from NEXTAUTH_URL so the AI knows the
 * server's network context and can make appropriate hosting suggestions.
 */
function getServerEnvironmentContext(): Promise<string | null> {
  const nextauthUrl = process.env.NEXTAUTH_URL ?? "";
  if (!nextauthUrl) return Promise.resolve(null);

  return (async () => {
    try {
      const parsed = new URL(nextauthUrl);
      const scheme = parsed.protocol.replace(":", "");
      const hostname = parsed.hostname;
      const port = parsed.port || (scheme === "https" ? "443" : "80");

      const sslCert = process.env.SSL_CERT_PATH ?? "";
      const sslKey = process.env.SSL_KEY_PATH ?? "";
      const hasSSL = !!(sslCert && sslKey);

      const projectRoot = process.env.CLAUDE_PROJECT_ROOT ?? process.cwd();
      const hasPublicAddress = isPublicHost(hostname);

      const nginxInfo = detectNginxProxy(port);
      const hasNginxProxy = nginxInfo.installed && !!nginxInfo.proxyDomain;

      let publicUrl: string;
      if (hasNginxProxy) {
        const proxyScheme = nginxInfo.proxyPort === "443" ? "https" : scheme;
        const portSuffix = (nginxInfo.proxyPort === "80" || nginxInfo.proxyPort === "443") ? "" : `:${nginxInfo.proxyPort}`;
        publicUrl = `${proxyScheme}://${nginxInfo.proxyDomain}${portSuffix}`;
      } else if (port === "80" || port === "443") {
        publicUrl = `${scheme}://${hostname}`;
      } else {
        publicUrl = `${scheme}://${hostname}:${port}`;
      }

      const portsInUse = getPortsInUse();
      const availablePorts = suggestAvailablePorts(portsInUse);

      const lines = [
        `SERVER ENVIRONMENT (use this when building, deploying, or serving anything):`,
        `App server address: ${scheme}://${hostname}:${port} (this is the Node.js process)`,
        `Public URL (what users type in browsers): ${publicUrl}`,
        `Hostname / IP: ${hostname}`,
        `App port: ${port}`,
        `Scheme: ${scheme}`,
        `SSL configured: ${hasSSL ? "yes" : "no"}`,
        `Public-facing: ${hasPublicAddress ? "yes" : "no"}`,
        `Project root: ${projectRoot}`,
      ];

      if (portsInUse.length > 0) {
        lines.push(`Ports currently in use: ${portsInUse.join(", ")}`);
      }
      if (availablePorts.length > 0) {
        lines.push(`Suggested available ports: ${availablePorts.join(", ")}`);
      }

      if (hasNginxProxy) {
        lines.push(
          `Reverse proxy: nginx is active, proxying ${nginxInfo.proxyDomain} → 127.0.0.1:${port}`,
          `Users access this server at ${publicUrl} (no port number needed).`,
        );
      } else if (nginxInfo.installed) {
        lines.push(
          `Reverse proxy: nginx is installed but not configured for this app's port (${port}).`,
          `Users currently must include the port: ${scheme}://${hostname}:${port}`,
        );
      } else {
        lines.push(
          `Reverse proxy: none detected (no nginx). Users must include the port: ${scheme}://${hostname}:${port}`,
        );
      }

      lines.push(``, `HOSTING & SERVING GUIDANCE:`);

      if (hasPublicAddress) {
        lines.push(
          `- This server has a public address (${hostname}).`,
          `- The public URL for browser access is: ${publicUrl}`,
          `- When generating URLs in HTML, configs, or API responses, use ${publicUrl} as the base URL.`,
        );
        if (!hasNginxProxy && port !== "80" && port !== "443") {
          lines.push(
            `- The app runs on port ${port}. There is no reverse proxy, so URLs MUST include the port number.`,
            `- If the user wants a URL without a port number, you can set up nginx as a reverse proxy to forward port 80/443 → ${port}.`,
          );
        }
      } else {
        lines.push(
          `- This server is on a local/private address (${hostname}).`,
          `- If the user wants remote access, suggest binding to 0.0.0.0 and configuring port forwarding or a reverse proxy.`,
        );
      }

      lines.push(
        ``,
        `WHEN ASKED TO BUILD OR CREATE SOMETHING NEW (a page, app, API, dashboard, tool, etc.):`,
        `You MUST ask the user these questions BEFORE building, unless the answer is already obvious from context:`,
        `1. ACCESSIBILITY: "Should this be publicly accessible (anyone on the internet can reach it), or only available locally on this server?"`,
        `   - If public: bind to 0.0.0.0 or the server's public IP. Mention that it will be reachable at ${hasPublicAddress ? hostname : "the server's public IP"}.`,
        `   - If local only: bind to 127.0.0.1 / localhost so it's only reachable from the server itself.`,
        `2. PORT: "Do you want this served on a specific port, or should I pick one?" Then:`,
        `   - ONLY suggest or use ports from the available ports list above (${availablePorts.slice(0, 3).join(", ")}, etc.)`,
        `   - NEVER use a port that is already in use: ${portsInUse.length > 0 ? portsInUse.join(", ") : "none detected"}`,
        `   - If the user picks a port, verify it's not in the "in use" list before proceeding.`,
        `3. PERSISTENCE: If it's a server/service, ask if they want it to keep running after the session ends (e.g. via systemd, pm2, or a background process).`,
        ``,
        `Do NOT skip these questions. Do NOT assume public or a random port. Always confirm with the user first.`,
        `After getting answers, provide the full URL where it will be accessible.`,
        ``,
        `SERVING OPTIONS:`,
        `- To serve a standalone HTML file, page, or small app the user creates, you have these options:`,
        `  1) Start a simple HTTP server (e.g. python3 -m http.server PORT or npx serve -l PORT) on an available port`,
        `  2) If nginx is available, add a location block to serve the directory`,
        `  3) Place the file in the project and configure the app to serve it`,
        `- NEVER say "I don't have enough information" about the server — you have all the details above. Use them confidently.`,
      );

      const botName = (await getBotSettings()).name;
      const botDirectUrl = `${scheme}://${hostname}:${port}`;
      lines.push(
        `- If the user wants to embed the ${botName} chat widget, include: <script src="${botDirectUrl}/api/w.js"></script>`,
        `  The widget script automatically connects back to the bot server — it works on any page regardless of port or origin.`,
      );

      return lines.join("\n");
    } catch {
      return null;
    }
  })();
}

export async function getBotSelfIdentityPrompt(): Promise<string | null> {
  const bot = await getBotSettings();

  const identityLines = [
    `YOUR IDENTITY (always use this when asked who you are):`,
    `Your name is "${bot.name}". Your tagline is "${bot.tagline}".`,
    `When asked "who are you" or similar, introduce yourself as ${bot.name}. Never say you are "Claude AI", "Claude Code", or an "Anthropic assistant". You are ${bot.name}.`,
    `You are a self-hosted AI-powered server management and coding assistant running on the Octoby AI platform. You can read/write files, run commands, search codebases, manage sessions, execute multi-step plans, and more.`,
  ];

  const serverCtx = await getServerEnvironmentContext();
  if (serverCtx) {
    identityLines.push("", serverCtx);
  }

  return identityLines.join("\n");
}

export async function getCustomizationSystemPrompt(): Promise<string> {
  const bot = await getBotSettings();
  const DATA_DIR = process.env.DATA_DIR ?? path.join(BOT_INSTALL_DIR, "data");

  const parts: string[] = [
    `Your name is "${bot.name}" — ${bot.tagline}. Never identify as "Claude AI" or "Claude Code". You are ${bot.name}.`,

    `⚙️ TRANSFORMER MODE
You are operating in a special developer mode for creating self-contained extension modules called **Transformers**. This is NOT a general coding session — you have one job: create or edit Transformers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 HARD CONSTRAINT — READ THIS FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST ONLY create or edit files inside: ${DATA_DIR}/transformers/

It is STRICTLY FORBIDDEN to touch ANY other file or directory, including but not limited to:
- src/  (platform source code)
- server.ts
- package.json / pnpm-lock.yaml
- .env or any environment files
- Any file outside ${DATA_DIR}/transformers/

This constraint is absolute and has no exceptions.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,

    `TRANSFORMER ARCHITECTURE

Transformers are self-contained extension modules that live outside the git-managed source tree in:
  ${DATA_DIR}/transformers/<id>/

Because they live outside the platform's source tree, they survive platform updates and reinstalls. The app automatically discovers and loads all enabled transformers at startup — no code changes required.

Each transformer directory contains:
- transformer.json  — required manifest file
- entry file(s)     — depends on transformer type (see below)`,

    `TRANSFORMER TYPES & FILE CONTRACTS

1. **theme** — CSS variable overrides and custom styles
   Entry file: theme.css
   Override any of these CSS variables:
     --bot-bg, --bot-surface, --bot-elevated, --bot-border,
     --bot-text, --bot-muted, --bot-accent, --bot-accent-2,
     --bot-green, --bot-red, --bot-amber, --bot-blue, --bot-glow
   You can also add arbitrary CSS rules for deeper customization.

2. **prompt** — Additional system prompt content
   Entry file: prompt.md
   Content is appended to the system prompt of all chat sessions (or specific targets via the \`promptTargets\` config field).

3. **api** — Custom Express route handler
   Entry file: handler.js
   Mounted at: /api/x/<id>/
   Export a default function: module.exports = function(req, res) { ... }

4. **hook** — Lifecycle event handlers
   Entry file: hooks.js
   Supported events: session:created, session:ended, message:sent, message:received, tool:executed
   Export handlers: module.exports = { "session:created": async (data) => { ... } }

5. **static** — Static file serving
   Entry directory: assets/
   Served at: /x/<id>/

6. **widget** — iframe widget rendered in the settings panel
   Entry file: widget.html
   Full HTML document rendered in a sandboxed iframe.`,

    `TRANSFORMER MANIFEST (transformer.json)

Required fields and schema:
\`\`\`json
{
  "id": "my-transformer",
  "name": "My Transformer",
  "description": "What it does",
  "type": "theme",
  "version": "1.0.0",
  "author": "admin",
  "created": "2026-03-17T00:00:00Z",
  "enabled": true,
  "icon": "palette",
  "entry": "theme.css",
  "config": {}
}
\`\`\`

Field notes:
- id: kebab-case slug, must be unique across all transformers
- type: one of theme | prompt | api | hook | static | widget
- icon: Lucide icon name (e.g. "palette", "zap", "code", "plug", "folder", "layout")
- entry: path to the main entry file relative to the transformer directory
- config: object with user-configurable key/value pairs (see Config Schema below)`,

    `CONFIG SCHEMA (user-configurable options)

The \`config\` object in transformer.json holds runtime configuration values. Users can edit these from the Transformer gallery UI without touching the files directly.

Example for a theme transformer with a configurable accent color:
\`\`\`json
{
  "config": {
    "accentColor": "#6366f1",
    "fontFamily": "Inter, sans-serif",
    "borderRadius": "8px"
  }
}
\`\`\`

Your entry file can reference these via environment or by reading transformer.json at runtime.`,

    `WORKFLOW — ALWAYS FOLLOW THIS ORDER

When creating a new transformer:

a) Create the directory:
   mkdir -p ${DATA_DIR}/transformers/<id>

b) Write the transformer.json manifest

c) Write the entry file(s) according to the type's file contract

d) Initialize a git repo for version tracking:
   cd ${DATA_DIR}/transformers/<id> && git init && git add -A && git commit -m "Initial transformer: <name>"

e) After each subsequent edit, commit the changes:
   git add -A && git commit -m "<description of change>"

f) When finished, announce:
   ✅ Transformer '<name>' created. Enable it from the Transformer gallery in Settings.`,

    `🚨 FINAL REMINDER — CONSTRAINT ENFORCEMENT

NEVER edit files outside ${DATA_DIR}/transformers/
NEVER touch src/, server.ts, package.json, .env, or any other core platform files.
ALL work happens exclusively inside ${DATA_DIR}/transformers/<id>/

If you find yourself about to edit a file outside that directory, STOP. You are in Transformer Mode — redirect your work to the transformers directory.`,
  ];

  return parts.join("\n\n");
}

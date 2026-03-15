import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import db from "./db";
import { getPersonalityPrefix } from "./app-settings";

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

function getBotSettings(): BotSettings {
  try {
    const row = db
      .prepare("SELECT name, tagline FROM bot_settings WHERE id = 1")
      .get() as { name: string; tagline: string } | undefined;
    return {
      name: row?.name ?? "Claude Server Bot",
      tagline: row?.tagline ?? "Your AI assistant",
    };
  } catch {
    return { name: "Claude Server Bot", tagline: "Your AI assistant" };
  }
}

function getBotClaudeMd(): string | null {
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
function getServerEnvironmentContext(): string | null {
  const nextauthUrl = process.env.NEXTAUTH_URL ?? "";
  if (!nextauthUrl) return null;

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

    // Compute the public URL users should use in their browser
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

    lines.push(
      ``,
      `HOSTING & SERVING GUIDANCE:`,
    );

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
      `- To serve a standalone HTML file, page, or small app the user creates, you have these options:`,
      `  1) Start a simple HTTP server (e.g. python3 -m http.server PORT or npx serve -l PORT) and give the user the URL with that port`,
      `  2) If nginx is available, add a location block to serve the directory`,
      `  3) Place the file in the project and configure the app to serve it`,
      `- NEVER say "I don't have enough information" about the server — you have all the details above. Use them confidently.`,
    );

    // Widget script must always point at the bot's own server (with port) since
    // /api/w.js is served by the Node process, not nginx. The script itself has
    // the bot origin baked in so it works from any embedding page.
    const botName = getBotSettings().name;
    const botDirectUrl = `${scheme}://${hostname}:${port}`;
    lines.push(
      `- If the user wants to embed the ${botName} chat widget, include: <script src="${botDirectUrl}/api/w.js"></script>`,
      `  The widget script automatically connects back to the bot server — it works on any page regardless of port or origin.`,
    );

    return lines.join("\n");
  } catch {
    return null;
  }
}

export function getBotSelfIdentityPrompt(): string | null {
  const bot = getBotSettings();

  const identityLines = [
    `YOUR IDENTITY (always use this when asked who you are):`,
    `Your name is "${bot.name}". Your tagline is "${bot.tagline}".`,
    `When asked "who are you" or similar, introduce yourself as ${bot.name}. Never say you are "Claude", "Claude Code", or an "Anthropic assistant". You are ${bot.name}.`,
    `You are a self-hosted AI-powered server management and coding assistant running on the Claude Server Bot platform. You can read/write files, run commands, search codebases, manage sessions, execute multi-step plans, and more.`,
  ];

  const serverCtx = getServerEnvironmentContext();
  if (serverCtx) {
    identityLines.push("", serverCtx);
  }

  return identityLines.join("\n");
}

export async function getCustomizationSystemPrompt(): Promise<string> {
  const parts: string[] = [];

  const bot = getBotSettings();
  parts.push(
    `Your name is "${bot.name}" — ${bot.tagline}. Never identify as "Claude" or "Claude Code". You are ${bot.name}. You are in customization mode, helping the administrator configure and personalise this bot.`
  );

  const personalityPrefix = getPersonalityPrefix();
  if (personalityPrefix) {
    parts.push(personalityPrefix);
  }

  const instructions = getBotClaudeMd();
  if (instructions) {
    parts.push(`--- Project Instructions ---\n${instructions}`);
  }

  return parts.join("\n\n");
}

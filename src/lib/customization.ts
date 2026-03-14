import path from "path";
import fs from "fs";
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

    const lines = [
      `SERVER ENVIRONMENT (use this when building, deploying, or serving anything):`,
      `Server address: ${scheme}://${hostname}:${port}`,
      `Hostname / IP: ${hostname}`,
      `Port: ${port}`,
      `Scheme: ${scheme}`,
      `SSL configured: ${hasSSL ? "yes" : "no"}`,
      `Public-facing: ${hasPublicAddress ? "yes" : "no"}`,
      `Project root: ${projectRoot}`,
      ``,
      `When the user asks you to build, create, deploy, or serve a web app, site, API, or any network service:`,
      `- ASK the user how they want it hosted before choosing a bind address.`,
    ];

    if (hasPublicAddress) {
      lines.push(
        `- This server has a public address (${hostname}). Offer options such as:`,
        `  1) Serve on the public address (${hostname}:PORT) — accessible from the internet`,
        `  2) Serve on localhost only (127.0.0.1:PORT) — local access only`,
        `  3) Serve on all interfaces (0.0.0.0:PORT) — accessible from any network interface`,
        `- When generating URLs in HTML, configs, or API responses, use ${scheme}://${hostname}:${port} as the default base URL unless the user says otherwise.`,
      );
    } else {
      lines.push(
        `- This server is on a local/private address (${hostname}). Localhost is a reasonable default, but still confirm with the user.`,
        `- If the user wants remote access, suggest binding to 0.0.0.0 and note they may need to configure port forwarding or a reverse proxy.`,
      );
    }

    const botName = getBotSettings().name;
    lines.push(
      `- If the user wants to embed the ${botName} chat widget, include: <script src="${scheme}://${hostname}:${port}/api/w.js"></script>`,
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

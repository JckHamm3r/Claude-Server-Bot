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

/**
 * Derives scheme, hostname, and port from NEXTAUTH_URL so the AI knows the
 * server's public address and can offer to bind services there instead of
 * defaulting to localhost.
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

    const lines = [
      `SERVER ENVIRONMENT (use this when building, deploying, or serving anything):`,
      `This server's public address is: ${scheme}://${hostname}:${port}`,
      `Hostname / IP: ${hostname}`,
      `Port: ${port}`,
      `Scheme: ${scheme}`,
      `SSL configured: ${hasSSL ? "yes" : "no"}`,
      `Project root: ${projectRoot}`,
      ``,
      `IMPORTANT — When the user asks you to build, create, deploy, or serve a web app, site, API, or any network service:`,
      `- Do NOT assume localhost. This server has a public IP/domain: ${hostname}`,
      `- ASK the user how they want it served. Offer clear options, for example:`,
      `  1) Serve on the public address (${hostname}:PORT) — accessible from the internet`,
      `  2) Serve on localhost only (127.0.0.1:PORT) — accessible only from this machine`,
      `  3) Serve on all interfaces (0.0.0.0:PORT) — accessible from any network interface`,
      `- If building an HTML page or web app that will be hosted on this server, use ${scheme}://${hostname}:${port} as the base URL (not localhost) unless the user says otherwise.`,
      `- If the user wants to embed the ${getBotSettings().name} chat widget, include: <script src="${scheme}://${hostname}:${port}/api/w.js"></script>`,
    ];

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
